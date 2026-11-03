/**
 * 无言以队 · 分析引擎（纯本地确定性计算）
 *
 * 设计要点：
 *  - 输入：数据集 D（26 张表数组）+ 查询条件 params + 外部上传数据 manual
 *  - 输出：结构化结果 + trace（数据来源表 / 查询条件 / 命中规则编号）
 *  - 全部计算可复现：不调用任何模型服务，不使用随机数
 *  - 所有文本经 sanitizeText 过滤禁用定性词
 *
 * 功能：
 *   aggregate()   功能1 多源数据聚合
 *   riskSignal()  功能2 舞弊风险信号识别（三步法 + 5 视角 + 关联交易口径）
 *   clues()       功能3 可疑交易线索梳理（主体主线 + 四视图）
 *   score()       功能4 舞弊可能性评估（评分卡 + 舞弊三角）
 *   evidence()    功能5 证据分析与资料核对（5 方法）
 *   report()      功能6 舞弊调查分析报告初稿
 *   qa()          功能7 合规问答
 *   reminders()   功能7 待办提醒
 */
(function (root, factory) {
  const core = (typeof module === 'object' && module.exports) ? require('./core.js') : root.WyCore;
  const api = factory(core);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WyEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core) {
  'use strict';

  const {
    RULES, RULE_MAP, SCORECARD, SCORE_BANDS, GRADES, GRADE_ORDER,
    DISCLAIMER_LONG, SCORE_DECLARATION, REPORT_COVER_DECLARATION, CORNER_BADGE,
    TABLE_META, FUND_VIEWS, RELATED_PARTY_BASIS, EVIDENCE_METHODS, QA_TOPICS, CHAINS,
    sanitizeText, money, wan,
    parseNaturalQuery, normalizeUploadRow, UPLOAD_COLUMN_MAP
  } = core;

  /* ============================================================
   * 通用工具
   * ============================================================ */
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const r2 = (n) => Math.round(num(n) * 100) / 100;
  const ymd = (v) => (v == null ? '' : String(v).slice(0, 10));
  const ym = (v) => ymd(v).slice(0, 7);
  const inRange = (dateStr, from, to) => {
    const d = ymd(dateStr);
    if (!d) return false;
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  };
  const isWeekend = (v) => {
    const d = new Date(ymd(v) + 'T00:00:00Z');
    if (isNaN(d.getTime())) return false;
    const w = d.getUTCDay();
    return w === 0 || w === 6;
  };
  const dayDiff = (a, b) => {
    const ta = new Date(ymd(a) + 'T00:00:00Z').getTime();
    const tb = new Date(ymd(b) + 'T00:00:00Z').getTime();
    if (isNaN(ta) || isNaN(tb)) return null;
    return Math.round((tb - ta) / 86400000);
  };
  const pct = (a, b) => (b ? r2((a / b) * 100) : 0);
  const uniq = (arr) => Array.from(new Set(arr));
  const sumBy = (arr, fn) => arr.reduce((a, x) => a + num(fn(x)), 0);

  /** 构建 trace 对象（溯源轨迹） */
  function trace(tables, query, ruleIds, extra) {
    const t = {
      tables: uniq(tables || []).map((tb) => ({
        name: tb,
        label: (TABLE_META[tb] && TABLE_META[tb].name) || tb,
        system: (TABLE_META[tb] && TABLE_META[tb].sys) || '—'
      })),
      query: query || {},
      ruleIds: uniq(ruleIds || []),
      sql: (query && query.sql) || null
    };
    return Object.assign(t, extra || {});
  }

  /** 生成只读 SQL 文本（仅用于展示与审计留痕，不直接执行） */
  function buildSql(table, where, limit) {
    const conds = Object.keys(where || {}).map((k) => {
      const v = where[k];
      if (Array.isArray(v)) return `${k} IN (${v.map((x) => typeof x === 'number' ? x : `'${String(x).replace(/'/g, "''")}'`).join(',')})`;
      if (typeof v === 'number') return `${k} = ${v}`;
      return `${k} = '${String(v).replace(/'/g, "''")}'`;
    });
    return `SELECT * FROM ${table}${conds.length ? ' WHERE ' + conds.join(' AND ') : ''} LIMIT ${limit || 5000};`;
  }

  /* ============================================================
   * 数据上下文：建立索引，供各模块复用
   * ============================================================ */
  function makeContext(D, params) {
    const p = Object.assign({
      entityType: 'all', entityCode: '', entityName: '',
      periodFrom: '', periodTo: '', minAmount: 0, maxAmount: null,
      chains: [], methods: [], viewsOnly: [], ruleParams: {}
    }, params || {});
    const ctx = { D, p };
    const byId = (arr) => { const m = new Map(); arr.forEach((x) => m.set(x.id, x)); return m; };
    ctx.vchById = byId(D.gl_vouchers);
    ctx.poById = byId(D.pur_orders);
    ctx.soById = byId(D.sal_orders);
    ctx.empByCode = D.employees.reduce((m, e) => { m[e.emp_code] = e; return m; }, {});
    ctx.supByCode = D.suppliers.reduce((m, s) => { m[s.supplier_code] = s; return m; }, {});
    ctx.cusByCode = D.customers.reduce((m, c) => { m[c.customer_code] = c; return m; }, {});
    ctx.prodByCode = D.products.reduce((m, x) => { m[x.product_code] = x; return m; }, {});
    ctx.receiptByPoId = D.pur_receipts.reduce((m, x) => { m[x.po_id] = x; return m; }, {});
    ctx.receiptByNo = D.pur_receipts.reduce((m, x) => { m[x.receipt_no] = x; return m; }, {});
    ctx.deliveryBySoId = D.sal_deliveries.reduce((m, x) => { m[x.so_id] = x; return m; }, {});
    ctx.invBySourceRef = D.tax_invoice_pool.reduce((m, x) => {
      (m[x.source_ref] = m[x.source_ref] || []).push(x); return m;
    }, {});
    ctx.approvalsByReportId = D.oa_approval_records.reduce((m, x) => {
      (m[x.report_id] = m[x.report_id] || []).push(x); return m;
    }, {});
    ctx.entriesByVoucher = D.gl_voucher_entries.reduce((m, x) => {
      (m[x.voucher_id] = m[x.voucher_id] || []).push(x); return m;
    }, {});
    ctx.empNameSet = new Set(D.employees.map((e) => e.emp_name));
    ctx.empByName = D.employees.reduce((m, e) => { m[e.emp_name] = e; return m; }, {});
    return ctx;
  }

  /** 规则参数合并（用户可调） */
  function ruleParam(rule, overrides) {
    const o = (overrides || {})[rule.id] || {};
    return Object.assign({}, rule.param || {}, o || {});
  }

  /** 主体过滤：返回符合主体条件的银行流水 */
  function filterBank(ctx) {
    const { D, p } = ctx;
    /* 非交易对手：银行手续费、利息等对手方为"银行"的记录不参与主体类分析 */
    const NON_COUNTERPARTY = ['银行', '银行手续费', '本公司'];
    return D.bank_transactions.filter((t) => {
      if (NON_COUNTERPARTY.indexOf(String(t.counterparty || '').trim()) >= 0) return false;
      if (!inRange(t.tx_date, p.periodFrom, p.periodTo)) return false;
      if (p.minAmount && num(t.amount) < p.minAmount) return false;
      if (p.maxAmount != null && p.maxAmount !== '' && num(t.amount) > p.maxAmount) return false;
      if (p.entityType === 'supplier' && p.entityName) {
        if (p.entityCode) {
          const sup = ctx.supByCode[p.entityCode];
          const nm = sup ? sup.supplier_name : p.entityName;
          return t.counterparty === nm;
        }
        return t.counterparty === p.entityName;
      }
      if (p.entityType === 'customer' && p.entityName) {
        if (p.entityCode) {
          const c = ctx.cusByCode[p.entityCode];
          const nm = c ? c.customer_name : p.entityName;
          return t.counterparty === nm;
        }
        return t.counterparty === p.entityName;
      }
      if (p.entityType === 'employee' && p.entityName) {
        const e = p.entityCode ? ctx.empByCode[p.entityCode] : ctx.empByName[p.entityName];
        return t.counterparty === (e ? e.emp_name : p.entityName);
      }
      return true;
    });
  }

  /* ============================================================
   * 功能1：多源数据聚合台
   * ============================================================ */
  /** 主体清单（供自然语言解析使用） */
  function entityIndex(D) {
    return {
      supplier: (D.suppliers || []).map((s) => ({ code: s.supplier_code, name: s.supplier_name })),
      customer: (D.customers || []).map((c) => ({ code: c.customer_code, name: c.customer_name })),
      employee: (D.employees || []).map((e) => ({ code: e.emp_code, name: e.emp_name }))
    };
  }

  /**
   * 功能1 · chat 触发：解析自然语言为聚合参数
   * 仅做词典/规则匹配，不调用任何模型服务。
   */
  function parseIntent(D, params) {
    const text = String((params && (params.text || params.question || params.q)) || '');
    const parsed = parseNaturalQuery(text, { entities: entityIndex(D) });
    const applied = {};
    if (parsed.entityType !== 'all') { applied.entityType = parsed.entityType; applied.entityCode = parsed.entityCode; applied.entityName = parsed.entityName; }
    if (parsed.period) { applied.periodFrom = parsed.period.from; applied.periodTo = parsed.period.to; }
    if (parsed.amount) {
      if (parsed.amount.min != null) applied.minAmount = parsed.amount.min;
      if (parsed.amount.max != null) applied.maxAmount = parsed.amount.max;
    }
    if (parsed.chains.length) applied.chains = parsed.chains;

    return {
      module: 'data_aggregate', title: '自然语言调查意图解析',
      text, matched: parsed.matched, params: applied, raw: parsed,
      note: parsed.matched
        ? '已按词典匹配识别调查条件，识别结果如下表单，可人工调整后运行。本解析为规则匹配，不构成调查结论。'
        : '未能从描述中识别出可用的调查条件。请补充主体名称/编码、期间或金额区间，或直接使用「筛选条件」表单。',
      examples: ['聚合S028供应商2026年全年的采购与付款数据', '沈立国2026年的报销数据', '2026年第2季度金额50万元以上的银行流水'],
      disclaimer: DISCLAIMER_LONG,
      trace: trace(parsed.entityType === 'supplier' ? ['suppliers'] : parsed.entityType === 'customer' ? ['customers'] : parsed.entityType === 'employee' ? ['employees'] : [],
        { text, applied }, [])
    };
  }

  /**
   * 功能1 · upload 触发：导入并解析用户上传的辅助数据（仅会话内，不写库）
   * @param {Array<{name:string, rows:Array<object>, type?:string}>} files
   */
  function uploadSummary(D, params) {
    const files = (params && params.files) || [];
    const tables = [];
    const notes = [];
    let totalRows = 0;
    const parsed = files.map((f) => {
      const raw = Array.isArray(f.rows) ? f.rows : [];
      const rows = raw.map(normalizeUploadRow);
      totalRows += rows.length;
      const cols = raw.length ? Object.keys(raw[0]) : [];
      const mapped = Object.keys(UPLOAD_COLUMN_MAP).filter((c) => rows.some((r) => r[c] != null));
      const unmapped = cols.filter((c) => !mapped.some((m) =>
        UPLOAD_COLUMN_MAP[m].some((a) => String(c).trim().toLowerCase() === a.toLowerCase())));
      const amounts = rows.map((r) => Number(r.金额)).filter((n) => Number.isFinite(n));
      const dates = rows.map((r) => r.日期).filter(Boolean).sort();
      const subjects = Array.from(new Set(rows.map((r) => r.主体).filter(Boolean)));
      if (!rows.length) notes.push(`${f.name}：未解析到数据行，请确认首行为表头`);
      if (unmapped.length) notes.push(`${f.name}：列「${unmapped.slice(0, 5).join('、')}」未匹配到内置口径，已原样保留`);
      if (rows.length && !amounts.length) notes.push(`${f.name}：未识别到「金额」列，金额类校验跳过`);
      const t = {
        name: f.name || '上传数据',
        type: f.type || 'csv',
        rows: rows.length,
        columns: cols,
        mappedColumns: mapped,
        unmappedColumns: unmapped,
        subjects: subjects.slice(0, 20),
        subjectCount: subjects.length,
        amountSum: amounts.length ? r2(amounts.reduce((a, b) => a + b, 0)) : null,
        amountMin: amounts.length ? Math.min.apply(null, amounts) : null,
        amountMax: amounts.length ? Math.max.apply(null, amounts) : null,
        dateFrom: dates[0] || null,
        dateTo: dates[dates.length - 1] || null,
        sample: rows.slice(0, 5)
      };
      tables.push({ table: 'upload:' + t.name, label: t.name, system: '上传辅助数据' });
      return t;
    });
    if (!files.length) notes.push('尚未上传文件。支持 CSV（UTF-8/GBK）及 Excel（.xlsx/.xls）。上传数据仅在本次会话内使用，不写库、不上传外部。');

    return {
      module: 'data_aggregate', title: '上传辅助数据解析',
      files: parsed, totalRows, notes,
      defaultStartDate: '', defaultDateSource: '',
      usage: '上传数据用于辅助分析：可作为线索补充材料、外部对账单、举报材料整理表等。它不会替代数据库数据，也不参与规则命中判断。',
      disclaimer: DISCLAIMER_LONG,
      trace: trace([], { files: files.map((f) => f.name) }, [], { uploaded: tables })
    };
  }

  function aggregate(D, params) {
    const ctx = makeContext(D, params);
    const { p } = ctx;
    const chains = (p.chains && p.chains.length) ? p.chains : ['purchase'];
    const tables = [];
    const rows = [];
    const stats = { 笔数: 0, 金额合计: 0, 时间跨度: { from: '', to: '' }, 涉及主体数: 0 };
    const entities = new Set();
    const dates = [];

    /* —— 采购付款链 —— */
    if (chains.indexOf('purchase') >= 0) {
      tables.push('pur_orders', 'pur_order_items', 'pur_receipts', 'tax_invoice_pool', 'gl_vouchers', 'gl_voucher_entries', 'bank_transactions', 'suppliers', 'products');
      D.pur_orders.forEach((po) => {
        if (!inRange(po.order_date, p.periodFrom, p.periodTo)) return;
        if (p.entityType === 'supplier' && p.entityCode && po.supplier_code !== p.entityCode) return;
        if (p.entityType === 'supplier' && !p.entityCode && p.entityName) {
          const sup = Object.values(ctx.supByCode).find((s) => s.supplier_name === p.entityName);
          if (sup && po.supplier_code !== sup.supplier_code) return;
        }
        if (p.minAmount && num(po.grand_total) < p.minAmount) return;
        const sup = ctx.supByCode[po.supplier_code] || {};
        const items = D.pur_order_items.filter((x) => x.po_id === po.id);
        const rcpt = ctx.receiptByPoId[po.id];
        const invs = D.tax_invoice_pool.filter((i) => i.invoice_type === '进项' &&
          (i.source_ref === po.po_no || (rcpt && i.source_ref === rcpt.receipt_no)));
        /* 付款按凭证来源单据号精确归集到本订单，避免跨单串号 */
        const poVoucherIds = new Set(D.gl_vouchers.filter((v) => v.source_ref === po.po_no).map((v) => v.id));
        const pays = D.bank_transactions.filter((t) =>
          t.tx_type === '支出' && inRange(t.tx_date, p.periodFrom, p.periodTo) &&
          (poVoucherIds.has(t.voucher_id) ||
            (t.counterparty === sup.supplier_name && t.voucher_id == null)));
        /* 未挂接凭证的付款按对手方+金额近似归属（仅用于总量统计，标注为近似） */
        const approxPays = pays.filter((t) => !poVoucherIds.has(t.voucher_id));
        rows.push({
          chain: '采购付款链',
          主体: sup.supplier_name || po.supplier_code,
          主体编码: po.supplier_code,
          单据号: po.po_no,
          业务日期: ymd(po.order_date),
          金额: r2(po.grand_total),
          物料: uniq(items.map((i) => i.product_name)).join('、') || '—',
          入库单号: rcpt ? rcpt.receipt_no : '（无）',
          入库日期: rcpt ? ymd(rcpt.receipt_date) : '—',
          发票号: invs.map((i) => i.invoice_no).join('、') || '（无）',
          发票金额: r2(sumBy(invs, (i) => i.total_amount)),
          付款笔数: pays.length,
          付款金额: r2(sumBy(pays, (t) => t.amount)),
          制单人: po.maker || '—',
          链条完整: (rcpt && invs.length) ? (pays.length ? '完整' : '未付款') : '缺失',
          _poId: po.id
        });
        entities.add(po.supplier_code);
        dates.push(ymd(po.order_date));
        stats.笔数 += 1;
        stats.金额合计 = r2(stats.金额合计 + num(po.grand_total));
      });
    }

    /* —— 销售收款链 —— */
    if (chains.indexOf('sales') >= 0) {
      tables.push('sal_orders', 'sal_order_items', 'sal_deliveries', 'tax_invoice_pool', 'gl_vouchers', 'bank_transactions', 'customers');
      D.sal_orders.forEach((so) => {
        if (!inRange(so.order_date, p.periodFrom, p.periodTo)) return;
        if (p.entityType === 'customer' && p.entityCode && so.customer_code !== p.entityCode) return;
        if (p.minAmount && num(so.grand_total) < p.minAmount) return;
        const cus = ctx.cusByCode[so.customer_code] || {};
        const dl = ctx.deliveryBySoId[so.id];
        const invs = D.tax_invoice_pool.filter((i) => i.invoice_type === '销项' && i.source_ref === so.so_no);
        const recvs = D.bank_transactions.filter((t) =>
          t.tx_type === '收入' && t.counterparty === cus.customer_name && inRange(t.tx_date, p.periodFrom, p.periodTo));
        rows.push({
          chain: '销售收款链',
          主体: cus.customer_name || so.customer_code,
          主体编码: so.customer_code,
          单据号: so.so_no,
          业务日期: ymd(so.order_date),
          金额: r2(so.grand_total),
          物料: uniq(D.sal_order_items.filter((x) => x.so_id === so.id).map((x) => x.product_name)).join('、') || '—',
          入库单号: dl ? dl.delivery_no : '（无）',
          入库日期: dl ? ymd(dl.delivery_date) : '—',
          发票号: invs.map((i) => i.invoice_no).join('、') || '（无）',
          发票金额: r2(sumBy(invs, (i) => i.total_amount)),
          付款笔数: recvs.length,
          付款金额: r2(sumBy(recvs, (t) => t.amount)),
          制单人: so.sales_emp || '—',
          链条完整: dl && invs.length ? '完整' : '缺失',
          _soId: so.id
        });
        entities.add(so.customer_code);
        dates.push(ymd(so.order_date));
        stats.笔数 += 1;
        stats.金额合计 = r2(stats.金额合计 + num(so.grand_total));
      });
    }

    /* —— 费用报销链 —— */
    if (chains.indexOf('expense') >= 0) {
      tables.push('oa_expense_reports', 'oa_approval_records', 'gl_vouchers', 'bank_transactions', 'employees');
      D.oa_expense_reports.forEach((o) => {
        if (!inRange(o.submit_date, p.periodFrom, p.periodTo)) return;
        if (p.entityType === 'employee' && p.entityCode && o.emp_code !== p.entityCode) return;
        if (p.minAmount && num(o.amount) < p.minAmount) return;
        const emp = ctx.empByCode[o.emp_code] || {};
        const aprv = ctx.approvalsByReportId[o.id] || [];
        const v = ctx.vchById.get(o.voucher_id);
        rows.push({
          chain: '费用报销链', 主体: emp.emp_name || o.emp_code, 主体编码: o.emp_code,
          单据号: o.report_no, 业务日期: ymd(o.submit_date), 金额: r2(o.amount),
          物料: o.expense_type, 入库单号: '—', 入库日期: '—',
          发票号: '—', 发票金额: 0,
          付款笔数: 1, 付款金额: r2(o.amount),
          制单人: emp.position || '—',
          链条完整: aprv.length >= 2 && v ? '完整' : '缺失',
          _reportId: o.id
        });
        entities.add(o.emp_code);
        dates.push(ymd(o.submit_date));
        stats.笔数 += 1;
        stats.金额合计 = r2(stats.金额合计 + num(o.amount));
      });
    }

    /* —— 资金流链 —— */
    if (chains.indexOf('fund') >= 0) {
      tables.push('bank_accounts', 'bank_transactions', 'gl_vouchers');
      filterBank(ctx).forEach((t) => {
        const v = t.voucher_id ? ctx.vchById.get(t.voucher_id) : null;
        rows.push({
          chain: '资金流链', 主体: t.counterparty, 主体编码: t.counterparty_account,
          单据号: t.bank_tx_id, 业务日期: ymd(t.tx_date), 金额: r2(t.amount),
          物料: t.tx_type, 入库单号: '—', 入库日期: '—',
          发票号: v ? v.voucher_no : '（未挂接）', 发票金额: v ? r2(v.total_debit) : 0,
          付款笔数: 1, 付款金额: r2(t.amount),
          制单人: '—', 链条完整: v ? '完整' : '缺失',
          _txId: t.id
        });
        entities.add(t.counterparty);
        dates.push(ymd(t.tx_date));
        stats.笔数 += 1;
        stats.金额合计 = r2(stats.金额合计 + num(t.amount));
      });
    }

    /* 结果行合并（采购链已含银行付款，资金流链可能重复，这里按单据号去重） */
    const seen = new Set();
    const dedup = rows.filter((r) => {
      const k = r.chain + '|' + r.单据号;
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });

    /* —— 数据完整度校验 —— */
    const integrity = [];
    /* 借贷平衡校验 */
    const unbal = D.gl_vouchers.filter((v) => Math.abs(num(v.total_debit) - num(v.total_credit)) > 0.01);
    integrity.push({
      校验项: '凭证借贷平衡', 结果: unbal.length ? '存在不平' : '通过',
      说明: unbal.length ? `${unbal.length} 张凭证借贷不平` : '全部凭证借贷平衡',
      涉及表: 'gl_vouchers'
    });
    /* 分录平衡 */
    let entryUnbal = 0;
    Object.keys(ctx.entriesByVoucher).forEach((vid) => {
      const es = ctx.entriesByVoucher[vid];
      const d = sumBy(es, (e) => e.debit_amount), c = sumBy(es, (e) => e.credit_amount);
      if (Math.abs(d - c) > 0.01) entryUnbal++;
    });
    integrity.push({
      校验项: '分录借贷平衡', 结果: entryUnbal ? '存在不平' : '通过',
      说明: entryUnbal ? `${entryUnbal} 张凭证分录不平` : '全部分录借贷平衡',
      涉及表: 'gl_voucher_entries'
    });
    /* 孤立记录：单据引用不到主数据 */
    const orphan = {
      '采购订单未匹配到供应商': D.pur_orders.filter((po) => !ctx.supByCode[po.supplier_code]).length,
      '销售订单未匹配到客户': D.sal_orders.filter((so) => !ctx.cusByCode[so.customer_code]).length,
      '入库单未匹配到采购订单': D.pur_receipts.filter((r) => !ctx.poById.has(r.po_id)).length,
      '银行流水未挂接凭证': D.bank_transactions.filter((t) => !t.voucher_id || !ctx.vchById.has(t.voucher_id)).length,
      '报销单未挂接凭证': D.oa_expense_reports.filter((o) => !o.voucher_id || !ctx.vchById.has(o.voucher_id)).length
    };
    Object.keys(orphan).forEach((k) => {
      integrity.push({ 校验项: k, 结果: orphan[k] ? '存在孤立记录' : '通过', 说明: `${orphan[k]} 条`, 涉及表: '关联校验' });
    });

    const sorted = dates.filter(Boolean).sort();
    stats.时间跨度 = { from: sorted[0] || '—', to: sorted[sorted.length - 1] || '—' };
    stats.涉及主体数 = entities.size;
    stats.纳入分析的表 = tables.length;

    return {
      module: 'data_aggregate',
      title: '多源数据聚合结果',
      params: p,
      chains: chains.map((k) => CHAINS[k] && CHAINS[k].name).filter(Boolean),
      columns: ['chain', '主体', '单据号', '业务日期', '金额', '物料', '入库单号', '发票号', '发票金额', '付款笔数', '付款金额', '链条完整'],
      rows: dedup.slice(0, 500),
      rowTotal: dedup.length,
      stats,
      integrity,
      disclaimer: DISCLAIMER_LONG,
      trace: trace(tables, {
        entity: p.entityType, code: p.entityCode, period: [p.periodFrom, p.periodTo],
        sql: buildSql('pur_orders', p.periodFrom ? {} : {}, 5000)
      }, [], { note: '聚合为只读 SELECT，单次上限 5000 行；超限请缩小调查范围' })
    };
  }

  /* ============================================================
   * 数据质量预检
   *
   * 作用：识别"系统性缺陷"——近全部样本都命中的规则不再具备区分度，
   * 继续逐条输出会淹没真实线索。此类情况应提示为数据质量问题，
   * 而不是当作舞弊信号；仅在覆盖率低于阈值时才逐条输出信号。
   * ============================================================ */
  /**
   * 系统性缺陷判定阈值。
   * 说明：舞弊调查中经验法则是"异常比例显著高于行业基线"。
   * 进项发票无法追溯入库单在正常企业通常 <5%，供应商准入资料不全 <10%；
   * 因此 30% 的命中率已属系统性异常，应作为数据质量提示而非逐条信号。
   *
   * 浏览器与 Node 双环境：Node 下可用环境变量覆盖，浏览器下取默认值。
   */
  const SYSTEMIC_RATE = (function () {
    if (typeof process !== 'undefined' && process.env && process.env.SYSTEMIC_RATE) {
      const v = Number(process.env.SYSTEMIC_RATE);
      if (Number.isFinite(v) && v > 0) return v;
    }
    return 0.3;
  })();

  function preflight(D, ctx) {
    const checks = [];
    const rec = (id, name, total, hit, note, tables) => {
      const rate = total ? hit / total : 0;
      checks.push({
        id, name, total, hit, rate: r2(rate * 100),
        systemic: total > 0 && rate >= SYSTEMIC_RATE,
        note, tables
      });
    };
    /* 银行流水与凭证金额一致性 */
    const bankAll = D.bank_transactions;
    const bankWithV = bankAll.filter((t) => t.voucher_id);
    const bankBad = bankWithV.filter((t) => {
      const v = ctx.vchById.get(t.voucher_id);
      return !v || Math.abs(num(t.amount) - num(v.total_debit)) > 1;
    });
    rec('DQ01', '银行流水与凭证金额一致', bankWithV.length, bankBad.length,
      '银行流水挂接的凭证金额普遍不一致时，说明两系统取数口径不同（如汇总记账），不宜直接判为账实不符', ['bank_transactions', 'gl_vouchers']);

    /* 报销单与凭证金额一致性 */
    const oaWithV = D.oa_expense_reports.filter((o) => o.voucher_id);
    const oaBad = oaWithV.filter((o) => {
      const v = ctx.vchById.get(o.voucher_id);
      return !v || Math.abs(num(o.amount) - num(v.total_debit)) > 1;
    });
    rec('DQ02', '报销单与凭证金额一致', oaWithV.length, oaBad.length,
      '报销单与凭证金额普遍不一致时，需先核对两系统的金额口径（含税/不含税、净额入账）', ['oa_expense_reports', 'gl_vouchers']);

    /* 进项发票与入库单可追溯 */
    const ctrInv = D.tax_invoice_pool.filter((i) => i.invoice_type === '进项');
    const ctrOrphan = ctrInv.filter((i) => !ctx.receiptByNo[i.source_ref] &&
      !(D.pur_orders.some((x) => x.po_no === i.source_ref && ctx.receiptByPoId[x.id])));
    rec('DQ03', '进项发票可追溯到入库单', ctrInv.length, ctrOrphan.length,
      '进项发票普遍无法匹配入库单时，通常是两系统单据号规则不一致，而非全部为"有票无货"', ['tax_invoice_pool', 'pur_receipts']);

    /* 采购订单与入库单可追溯 */
    const poDone = D.pur_orders.filter((p) => p.status !== '已下单');
    const poNoR = poDone.filter((p) => !ctx.receiptByPoId[p.id]);
    rec('DQ04', '采购订单可追溯到入库单', poDone.length, poNoR.length,
      '已完成订单普遍缺少入库单时，需核实仓储系统与采购系统的单据对应关系', ['pur_orders', 'pur_receipts']);

    /* 采购单价与基准价可比 */
    const items = D.pur_order_items.filter((i) => ctx.prodByCode[i.product_code] && num(ctx.prodByCode[i.product_code].unit_price));
    const priceOff = items.filter((i) => num(i.unit_price) / num(ctx.prodByCode[i.product_code].unit_price) > 1.5);
    rec('DQ05', '采购单价与基准价可比', items.length, priceOff.length,
      '大量采购行单价高于物料基准价时，通常是基准价维护过期或物料口径不同，不宜全部判为价格不公允', ['pur_order_items', 'products']);

    /* 单据日期顺序 */
    const poWithR = D.pur_orders.filter((p) => ctx.receiptByPoId[p.id]);
    const dateRev = poWithR.filter((p) => ymd(ctx.receiptByPoId[p.id].receipt_date) < ymd(p.order_date));
    rec('DQ06', '单据日期顺序正确', poWithR.length, dateRev.length,
      '入库日期普遍早于订单日期时，通常是系统补录导致，需核实单据录入时点', ['pur_orders', 'pur_receipts']);

    /* 银行流水可挂接凭证 */
    const noV = bankAll.filter((t) => !t.voucher_id);
    rec('DQ07', '银行流水挂接凭证', bankAll.length, noV.length,
      '大量银行流水未挂接凭证时，需先核对账务系统与银行流水的取数范围', ['bank_transactions', 'gl_vouchers']);

    /* 供应商准入资料完整性 */
    const supAll = D.suppliers;
    const supBad = supAll.filter((s) => {
      const taxOk = s.tax_no && [15, 18, 20].indexOf(String(s.tax_no).length) >= 0;
      return !taxOk || !s.phone || !s.address;
    });
    rec('DQ08', '供应商准入资料完整', supAll.length, supBad.length,
      '供应商税号/电话/地址普遍缺失或格式不符时，通常是主数据维护标准问题（如境外供应商证照规则不同），需先规范准入字段', ['suppliers']);

    return {
      checks,
      systemic: checks.filter((c) => c.systemic),
      passed: checks.filter((c) => !c.systemic && c.hit === 0),
      warnings: checks.filter((c) => !c.systemic && c.hit > 0),
      summary: checks.filter((c) => c.systemic).length
        ? `${checks.filter((c) => c.systemic).length} 项数据质量校验命中率过高，相关规则在本数据集上区分度不足，已转为数据质量提示而非风险信号`
        : '数据质量校验通过，规则具备区分度'
    };
  }

  /* ============================================================
   * 功能2：舞弊风险信号识别（三步法）
   * ============================================================ */
  function riskSignal(D, params) {
    const ctx = makeContext(D, params);
    const { p } = ctx;
    const overrides = p.ruleParams || {};
    const pre = preflight(D, ctx);
    /* 数据质量门控：命中的规则若被判定为系统性缺陷，则抑制逐条输出 */
    const suppressed = new Set();
    pre.systemic.forEach((c) => {
      if (c.id === 'DQ01') { suppressed.add('R14'); suppressed.add('R08'); }
      if (c.id === 'DQ02') suppressed.add('R13');
      if (c.id === 'DQ03') { suppressed.add('R10'); suppressed.add('R11'); }
      if (c.id === 'DQ04') suppressed.add('R09');
      if (c.id === 'DQ05') suppressed.add('R15');
      if (c.id === 'DQ06') suppressed.add('R12');
      if (c.id === 'DQ07') suppressed.add('R07');
      if (c.id === 'DQ08') suppressed.add('R16');
    });
    const isSuppressed = (ruleId) => suppressed.has(ruleId);
    const signals = [];
    let sid = 0;
    const addSignal = (ruleId, data) => {
      if (isSuppressed(ruleId)) return;   /* 系统性缺陷不逐条输出 */
      sid++;
      const rule = RULE_MAP[ruleId] || {};
      const grade = data.grade || rule.defaultGrade || 'medium';
      signals.push(Object.assign({
        id: 'SIG-' + String(sid).padStart(3, '0'),
        ruleId,
        ruleName: rule.name || ruleId,
        step: rule.step || 'rule',
        stepLabel: rule.step === 'rule' ? '第一步·规则阈值初筛' : rule.step === 'metric' ? '第二步·指标比率分析' : '第三步·关联图谱复核',
        category: rule.category || '异常交易',
        view: rule.view || null,
        viewName: rule.view ? (FUND_VIEWS[rule.view] ? FUND_VIEWS[rule.view].name : '') : '',
        grade,
        gradeLabel: GRADES[grade] ? GRADES[grade].label : '',
        basis: (data.basisTypes || []).map((b) => RELATED_PARTY_BASIS[b] ? RELATED_PARTY_BASIS[b].name : b),
        falsePositive: rule.falsePositive || '需结合业务实质判断',
        action: rule.action || '进一步核查原始单据',
        weight: rule.weight || 5,
        evidence: data.evidence || []
      }, data));
    };

    const bank = filterBank(ctx);
    const totalExp = sumBy(bank.filter((t) => t.tx_type === '支出'), (t) => t.amount);

    /* ---------------- R01 大额付款超阈值 ---------------- */
    (function () {
      const rule = RULE_MAP.R01, pp = ruleParam(rule, overrides);
      bank.filter((t) => t.tx_type === '支出' && num(t.amount) >= pp.amount).forEach((t) => {
        addSignal('R01', {
          subject: t.counterparty, date: ymd(t.tx_date), amount: r2(t.amount),
          reason: rule.reason(pp),
          evidence: [{ table: 'bank_transactions', field: 'bank_tx_id', value: t.bank_tx_id },
            { table: 'bank_transactions', field: 'amount', value: money(t.amount) }]
        });
      });
    })();

    /* ---------------- R02 单体供应商付款占比过高 ---------------- */
    (function () {
      const rule = RULE_MAP.R02, pp = ruleParam(rule, overrides);
      const byCp = {};
      bank.filter((t) => t.tx_type === '支出').forEach((t) => {
        byCp[t.counterparty] = (byCp[t.counterparty] || 0) + num(t.amount);
      });
      Object.keys(byCp).forEach((cp) => {
        const ratio = totalExp ? byCp[cp] / totalExp : 0;
        const cnt = bank.filter((t) => t.tx_type === '支出' && t.counterparty === cp).length;
        if (ratio >= pp.ratio && cnt >= pp.minCount) {
          addSignal('R02', {
            subject: cp, date: p.periodTo || '', amount: r2(byCp[cp]),
            reason: rule.reason(Object.assign({}, pp, { ratio })),
            evidence: [{ table: 'bank_transactions', field: 'counterparty', value: cp },
              { table: 'bank_transactions', field: '付款占比', value: pct(byCp[cp], totalExp) + '%' }]
          });
        }
      });
    })();

    /* ---------------- R03 非工作日交易 ---------------- */
    (function () {
      const rule = RULE_MAP.R03, pp = ruleParam(rule, overrides);
      bank.filter((t) => isWeekend(t.tx_date) && num(t.amount) >= 1000000).forEach((t) => {
        addSignal('R03', {
          subject: t.counterparty, date: ymd(t.tx_date), amount: r2(t.amount),
          reason: rule.reason(pp),
          evidence: [{ table: 'bank_transactions', field: 'tx_date', value: ymd(t.tx_date) },
            { table: 'bank_transactions', field: 'bank_tx_id', value: t.bank_tx_id }]
        });
      });
    })();

    /* ---------------- R04 临近期末集中付款 ---------------- */
    (function () {
      const rule = RULE_MAP.R04, pp = ruleParam(rule, overrides);
      bank.filter((t) => {
        if (num(t.amount) < pp.amount) return false;
        const d = ymd(t.tx_date);
        const day = Number(d.slice(8, 10));
        const month = Number(d.slice(5, 7)), year = Number(d.slice(0, 4));
        const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
        return day > last - pp.lastDays;
      }).forEach((t) => {
        addSignal('R04', {
          subject: t.counterparty, date: ymd(t.tx_date), amount: r2(t.amount), grade: 'low',
          reason: rule.reason(pp),
          evidence: [{ table: 'bank_transactions', field: 'tx_date', value: ymd(t.tx_date) }]
        });
      });
    })();

    /* ---------------- R05 拆分付款（同对手方短周期多笔小额） ---------------- */
    (function () {
      const rule = RULE_MAP.R05, pp = ruleParam(rule, overrides);
      const groups = {};
      bank.filter((t) => t.tx_type === '支出').forEach((t) => {
        const key = t.counterparty + '|' + ym(t.tx_date);
        (groups[key] = groups[key] || []).push(t);
      });
      Object.keys(groups).forEach((key) => {
        const list = groups[key].sort((a, b) => ymd(a.tx_date).localeCompare(ymd(b.tx_date)));
        const cp = key.split('|')[0];
        /* 在 30 天窗口内滑动，找出连续多笔落在审批阈值下沿区间的记录 */
        for (let i = 0; i < list.length; i++) {
          const win = list.filter((t) => {
            const g = dayDiff(list[i].tx_date, t.tx_date);
            return g != null && g >= 0 && g <= 30;
          }).filter((t) => num(t.amount) >= pp.band[0] && num(t.amount) <= pp.band[1]);
          if (win.length >= pp.minCount) {
            addSignal('R05', {
              subject: cp, date: ymd(win[0].tx_date), amount: r2(sumBy(win, (t) => t.amount)),
              grade: 'high',
              reason: rule.reason(pp),
              splitDetail: win.map((t) => ({ 流水号: t.bank_tx_id, 日期: ymd(t.tx_date), 金额: r2(t.amount) })),
              evidence: win.map((t) => ({ table: 'bank_transactions', field: 'bank_tx_id', value: t.bank_tx_id }))
            });
            break;
          }
        }
      });
    })();

    /* ---------------- R06 大额现金/个人账户收付 ---------------- */
    (function () {
      const rule = RULE_MAP.R06, pp = ruleParam(rule, overrides);
      bank.filter((t) => num(t.amount) >= pp.amount &&
        (t.channel === '现金' || t.channel === '个人网银' ||
          String(t.counterparty || '').indexOf('个人') === 0 ||
          (String(t.counterparty).length <= 3 && ctx.empNameSet.has(t.counterparty))))
        .forEach((t) => {
          addSignal('R06', {
            subject: t.counterparty, date: ymd(t.tx_date), amount: r2(t.amount), grade: 'high',
            reason: rule.reason(pp),
            evidence: [{ table: 'bank_transactions', field: 'channel', value: t.channel || '—' },
              { table: 'bank_transactions', field: 'counterparty', value: t.counterparty }]
          });
        });
    })();

    /* ---------------- R07 银行流水无账面凭证 ---------------- */
    (function () {
      const rule = RULE_MAP.R07, pp = ruleParam(rule, overrides);
      bank.filter((t) => num(t.amount) >= pp.amount && (!t.voucher_id || !ctx.vchById.has(t.voucher_id)))
        .forEach((t) => {
          addSignal('R07', {
            subject: t.counterparty, date: ymd(t.tx_date), amount: r2(t.amount), grade: 'high',
            reason: rule.reason(pp),
            evidence: [{ table: 'bank_transactions', field: 'bank_tx_id', value: t.bank_tx_id },
              { table: 'gl_vouchers', field: 'voucher_id', value: '未挂接' }]
          });
        });
    })();

    /* ---------------- R08 账面无银行流水支撑 ---------------- */
    (function () {
      const rule = RULE_MAP.R08, pp = ruleParam(rule, overrides);
      bank.filter((t) => num(t.matched) === 0 && num(t.amount) >= pp.amount).forEach((t) => {
        addSignal('R08', {
          subject: t.counterparty, date: ymd(t.tx_date), amount: r2(t.amount), grade: 'high',
          reason: rule.reason(pp),
          evidence: [{ table: 'bank_transactions', field: 'matched', value: '0（未对账）' }]
        });
      });
    })();

    /* ---------------- R09 采购订单无入库记录 ---------------- */
    (function () {
      const rule = RULE_MAP.R09, pp = ruleParam(rule, overrides);
      D.pur_orders.forEach((po) => {
        if (!inRange(po.order_date, p.periodFrom, p.periodTo)) return;
        if (p.entityType === 'supplier' && p.entityCode && po.supplier_code !== p.entityCode) return;
        if (num(po.grand_total) < pp.amount) return;
        if (ctx.receiptByPoId[po.id]) return;
        if (po.status === '已下单') return;
        const sup = ctx.supByCode[po.supplier_code] || {};
        addSignal('R09', {
          subject: sup.supplier_name || po.supplier_code, date: ymd(po.order_date), amount: r2(po.grand_total),
          grade: 'high', reason: rule.reason(pp) + `（订单状态：${po.status}）`,
          evidence: [{ table: 'pur_orders', field: 'po_no', value: po.po_no },
            { table: 'pur_receipts', field: 'po_id', value: '无对应入库单' }]
        });
      });
    })();

    /* ---------------- R10 进项发票无入库支撑 ---------------- */
    (function () {
      const rule = RULE_MAP.R10, pp = ruleParam(rule, overrides);
      D.tax_invoice_pool.filter((i) => i.invoice_type === '进项').forEach((i) => {
        if (!inRange(i.invoice_date, p.periodFrom, p.periodTo)) return;
        if (p.entityType === 'supplier' && p.entityCode && i.party_code !== p.entityCode) return;
        if (ctx.receiptByNo[i.source_ref]) return;
        /* source_ref 是订单号时，检查该订单是否有入库 */
        const po = D.pur_orders.find((x) => x.po_no === i.source_ref);
        if (po && ctx.receiptByPoId[po.id]) return;
        addSignal('R10', {
          subject: i.party_name || i.party_code, date: ymd(i.invoice_date), amount: r2(i.total_amount),
          grade: 'high', reason: rule.reason(pp),
          evidence: [{ table: 'tax_invoice_pool', field: 'invoice_no', value: i.invoice_no },
            { table: 'pur_receipts', field: 'receipt_no', value: `无法匹配 ${i.source_ref}` }]
        });
      });
    })();

    /* ---------------- R11 发票金额与订单金额不符 ---------------- */
    (function () {
      const rule = RULE_MAP.R11, pp = ruleParam(rule, overrides);
      D.tax_invoice_pool.filter((i) => i.invoice_type === '进项').forEach((i) => {
        let po = ctx.receiptByNo[i.source_ref] ? ctx.poById.get(ctx.receiptByNo[i.source_ref].po_id) : null;
        if (!po) po = D.pur_orders.find((x) => x.po_no === i.source_ref);
        if (!po) return;
        if (!inRange(po.order_date, p.periodFrom, p.periodTo)) return;
        if (p.entityType === 'supplier' && p.entityCode && po.supplier_code !== p.entityCode) return;
        const diff = r2(num(i.total_amount) - num(po.grand_total));
        if (Math.abs(diff) > pp.tolerance) {
          addSignal('R11', {
            subject: i.party_name || i.party_code, date: ymd(i.invoice_date), amount: r2(i.total_amount),
            grade: 'high', reason: `发票价税合计 ${money(i.total_amount)} 与订单价税合计 ${money(po.grand_total)} 相差 ${money(diff)}`,
            evidence: [{ table: 'tax_invoice_pool', field: 'invoice_no', value: i.invoice_no },
              { table: 'pur_orders', field: 'po_no', value: po.po_no }]
          });
        }
      });
    })();

    /* ---------------- R12 单据日期倒挂 ---------------- */
    (function () {
      const rule = RULE_MAP.R12, pp = ruleParam(rule, overrides);
      D.pur_orders.forEach((po) => {
        if (!inRange(po.order_date, p.periodFrom, p.periodTo)) return;
        if (p.entityType === 'supplier' && p.entityCode && po.supplier_code !== p.entityCode) return;
        const rcpt = ctx.receiptByPoId[po.id];
        const sup = ctx.supByCode[po.supplier_code] || {};
        if (rcpt && ymd(rcpt.receipt_date) < ymd(po.order_date)) {
          addSignal('R12', {
            subject: sup.supplier_name || po.supplier_code, date: ymd(po.order_date), amount: r2(po.grand_total),
            grade: 'medium', reason: `入库日期 ${ymd(rcpt.receipt_date)} 早于订单日期 ${ymd(po.order_date)}`,
            evidence: [{ table: 'pur_orders', field: 'order_date', value: ymd(po.order_date) },
              { table: 'pur_receipts', field: 'receipt_date', value: ymd(rcpt.receipt_date) }]
          });
        }
        const invs = D.tax_invoice_pool.filter((i) => i.invoice_type === '进项' &&
          (i.source_ref === po.po_no || (rcpt && i.source_ref === rcpt.receipt_no)));
        invs.forEach((i) => {
          const base = rcpt ? ymd(rcpt.receipt_date) : ymd(po.order_date);
          if (ymd(i.invoice_date) < base) {
            addSignal('R12', {
              subject: sup.supplier_name || po.supplier_code, date: ymd(i.invoice_date), amount: r2(i.total_amount),
              grade: 'medium', reason: `开票日期 ${ymd(i.invoice_date)} 早于入库日期 ${base}`,
              evidence: [{ table: 'tax_invoice_pool', field: 'invoice_date', value: ymd(i.invoice_date) }]
            });
          }
        });
      });
    })();

    /* ---------------- R13 报销金额与凭证不符 ---------------- */
    (function () {
      const rule = RULE_MAP.R13, pp = ruleParam(rule, overrides);
      D.oa_expense_reports.forEach((o) => {
        if (!inRange(o.submit_date, p.periodFrom, p.periodTo)) return;
        if (p.entityType === 'employee' && p.entityCode && o.emp_code !== p.entityCode) return;
        const v = ctx.vchById.get(o.voucher_id);
        if (!v) return;
        const diff = r2(num(o.amount) - num(v.total_debit));
        if (Math.abs(diff) > pp.tolerance) {
          const emp = ctx.empByCode[o.emp_code] || {};
          addSignal('R13', {
            subject: emp.emp_name || o.emp_code, date: ymd(o.submit_date), amount: r2(o.amount),
            grade: 'medium', reason: `报销金额 ${money(o.amount)} 与凭证 ${v.voucher_no} 金额 ${money(v.total_debit)} 相差 ${money(diff)}`,
            evidence: [{ table: 'oa_expense_reports', field: 'report_no', value: o.report_no },
              { table: 'gl_vouchers', field: 'voucher_no', value: v.voucher_no }]
          });
        }
      });
    })();

    /* ---------------- R14 凭证金额与银行流水不符 ---------------- */
    (function () {
      const rule = RULE_MAP.R14, pp = ruleParam(rule, overrides);
      bank.forEach((t) => {
        if (!t.voucher_id) return;
        const v = ctx.vchById.get(t.voucher_id);
        if (!v) return;
        const diff = r2(num(t.amount) - num(v.total_debit));
        if (Math.abs(diff) > pp.tolerance) {
          addSignal('R14', {
            subject: t.counterparty, date: ymd(t.tx_date), amount: r2(t.amount),
            grade: 'medium', reason: `银行流水 ${money(t.amount)} 与凭证 ${v.voucher_no} 金额 ${money(v.total_debit)} 相差 ${money(diff)}`,
            evidence: [{ table: 'bank_transactions', field: 'bank_tx_id', value: t.bank_tx_id },
              { table: 'gl_vouchers', field: 'voucher_no', value: v.voucher_no }]
          });
        }
      });
    })();

    /* ---------------- R15 大额采购单价偏离基准价 ---------------- */
    (function () {
      const rule = RULE_MAP.R15, pp = ruleParam(rule, overrides);
      D.pur_order_items.forEach((it) => {
        const po = ctx.poById.get(it.po_id);
        if (!po || !inRange(po.order_date, p.periodFrom, p.periodTo)) return;
        if (p.entityType === 'supplier' && p.entityCode && po.supplier_code !== p.entityCode) return;
        if (num(po.total_amount) < pp.minAmount) return;
        const prod = ctx.prodByCode[it.product_code];
        if (!prod || !num(prod.unit_price)) return;
        const ratio = r2(num(it.unit_price) / num(prod.unit_price));
        if (ratio > pp.ratio) {
          const sup = ctx.supByCode[po.supplier_code] || {};
          addSignal('R15', {
            subject: sup.supplier_name || po.supplier_code, date: ymd(po.order_date), amount: r2(it.amount),
            grade: 'medium', reason: `物料「${it.product_name}」采购单价 ${money(it.unit_price)} 高于基准价 ${money(prod.unit_price)} 的 ${ratio} 倍`,
            evidence: [{ table: 'pur_order_items', field: 'unit_price', value: money(it.unit_price) },
              { table: 'products', field: 'unit_price', value: money(prod.unit_price) },
              { table: 'pur_orders', field: 'po_no', value: po.po_no }]
          });
        }
      });
    })();

    /* ---------------- R16 供应商主数据不完整 ---------------- */
    (function () {
      const rule = RULE_MAP.R16, pp = ruleParam(rule, overrides);
      D.suppliers.forEach((s) => {
        const issues = [];
        if (!s.tax_no) issues.push('缺少纳税人识别号');
        else if ([15, 18].indexOf(String(s.tax_no).length) < 0) issues.push(`税号长度 ${String(s.tax_no).length} 位异常`);
        if (!s.phone) issues.push('缺少联系电话');
        if (!s.address) issues.push('缺少地址');
        if (issues.length) {
          addSignal('R16', {
            subject: s.supplier_name, date: ymd(s.created_at), amount: 0, grade: 'medium',
            reason: `供应商准入资料：${issues.join('、')}`,
            evidence: [{ table: 'suppliers', field: 'supplier_code', value: s.supplier_code },
              { table: 'suppliers', field: 'tax_no', value: s.tax_no || '（空）' }]
          });
        }
      });
    })();

    /* ---------------- R17 同一供应商长期单一对接人 ---------------- */
    (function () {
      const rule = RULE_MAP.R17, pp = ruleParam(rule, overrides);
      const grp = {};
      D.pur_orders.forEach((po) => {
        if (!inRange(po.order_date, p.periodFrom, p.periodTo)) return;
        const k = po.supplier_code + '|' + po.maker;
        grp[k] = (grp[k] || 0) + 1;
      });
      Object.keys(grp).forEach((k) => {
        if (grp[k] < pp.minOrders) return;
        const [sc, mk] = k.split('|');
        const sup = ctx.supByCode[sc] || {};
        const emp = ctx.empByCode[mk] || {};
        addSignal('R17', {
          subject: sup.supplier_name || sc, date: '', amount: 0, grade: 'medium',
          reason: `采购经办人 ${emp.emp_name || mk}（${emp.position || '—'}）对同一供应商下单 ${grp[k]} 笔，缺少轮换`,
          evidence: [{ table: 'pur_orders', field: 'maker', value: mk },
            { table: 'suppliers', field: 'supplier_code', value: sc }]
        });
      });
    })();

    /* ---------------- R18 研发工时异常 ---------------- */
    (function () {
      const rule = RULE_MAP.R18, pp = ruleParam(rule, overrides);
      D.rd_timesheets.filter((x) => num(x.hours) > pp.hours && inRange(x.work_date, p.periodFrom, p.periodTo))
        .forEach((x) => {
          const emp = ctx.empByCode[x.emp_code] || {};
          addSignal('R18', {
            subject: emp.emp_name || x.emp_code, date: ymd(x.work_date), amount: r2(x.labor_cost), grade: 'low',
            reason: rule.reason(pp) + `（填报 ${x.hours} 小时）`,
            evidence: [{ table: 'rd_timesheets', field: 'hours', value: x.hours }]
          });
        });
    })();

    /* ---------------- R19 月末报销集中提交 ---------------- */
    (function () {
      const rule = RULE_MAP.R19, pp = ruleParam(rule, overrides);
      D.oa_expense_reports.forEach((o) => {
        if (!inRange(o.submit_date, p.periodFrom, p.periodTo)) return;
        if (num(o.amount) < pp.amount) return;
        const d = ymd(o.submit_date);
        const month = Number(d.slice(5, 7)), year = Number(d.slice(0, 4));
        const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
        if (Number(d.slice(8, 10)) > last - pp.lastDays) {
          const emp = ctx.empByCode[o.emp_code] || {};
          addSignal('R19', {
            subject: emp.emp_name || o.emp_code, date: d, amount: r2(o.amount), grade: 'low',
            reason: rule.reason(pp),
            evidence: [{ table: 'oa_expense_reports', field: 'report_no', value: o.report_no }]
          });
        }
      });
    })();

    /* ---------------- R20 关联方收款占比异常 ---------------- */
    (function () {
      const rule = RULE_MAP.R20, pp = ruleParam(rule, overrides);
      const inSum = {}, outSum = {};
      const totalIn = sumBy(bank.filter((t) => t.tx_type === '收入'), (t) => t.amount);
      bank.filter((t) => t.tx_type === '收入').forEach((t) => { inSum[t.counterparty] = (inSum[t.counterparty] || 0) + num(t.amount); });
      bank.filter((t) => t.tx_type === '支出').forEach((t) => { outSum[t.counterparty] = (outSum[t.counterparty] || 0) + num(t.amount); });
      Object.keys(inSum).forEach((cp) => {
        const ratio = totalIn ? inSum[cp] / totalIn : 0;
        if (ratio >= pp.ratio && outSum[cp]) {
          addSignal('R20', {
            subject: cp, date: p.periodTo || '', amount: r2(inSum[cp]),
            grade: 'medium', reason: rule.reason(pp),
            evidence: [{ table: 'bank_transactions', field: 'counterparty', value: cp },
              { table: 'bank_transactions', field: '收款占比', value: pct(inSum[cp], totalIn) + '%' }]
          });
        }
      });
    })();

    /* ============ 第二步：指标/比率分析 ============ */
    const metrics = [];
    (function () {
      /* 月度毛利率：收入 vs 成本 */
      const monthAgg = {};
      D.gl_ledger.forEach((l) => {
        const per = String(l.period || '');
        if (per.length !== 6) return;
        if (!monthAgg[per]) monthAgg[per] = { rev: 0, cost: 0, exp: 0 };
        if (String(l.subject_code).indexOf('6001') === 0) monthAgg[per].rev += num(l.credit_amount) - num(l.debit_amount);
        if (String(l.subject_code).indexOf('6401') === 0) monthAgg[per].cost += num(l.debit_amount);
        if (['6601-01', '6601-02', '6602-01', '6602-02', '6604-02'].indexOf(String(l.subject_code)) >= 0) monthAgg[per].exp += num(l.debit_amount);
      });
      const periods = Object.keys(monthAgg).sort();
      const gm = periods.map((k) => {
        const a = monthAgg[k];
        const g = a.rev ? (a.rev - a.cost) / a.rev : 0;
        return { period: k, revenue: r2(a.rev), cost: r2(a.cost), gross: r2(g * 100) };
      });
      const gmVals = gm.map((x) => x.gross);
      const gmAvg = gmVals.length ? gmVals.reduce((a, b) => a + b, 0) / gmVals.length : 0;
      const gmSd = Math.sqrt(gmVals.reduce((a, b) => a + (b - gmAvg) * (b - gmAvg), 0) / Math.max(gmVals.length, 1));
      const m1 = RULE_MAP.M01, p1 = ruleParam(m1, overrides);
      const bad = gm.filter((x) => gmSd > 0 && Math.abs(x.gross - gmAvg) > p1.deviation * gmSd);
      metrics.push({
        id: 'M01', name: '毛利率', unit: '%', series: gm, value: r2(gmAvg), avg: r2(gmAvg), sd: r2(gmSd),
        deviation: r2(gmSd ? (gm.length ? Math.max.apply(null, gm.map((x) => Math.abs(x.gross - gmAvg))) / gmSd : 0) : 0),
        abnormal: bad.length > 0, detail: bad.map((x) => `${x.period}：${x.gross}%`),
        tables: ['gl_ledger']
      });
      /* 月度费用率 */
      const er = periods.map((k) => {
        const a = monthAgg[k];
        return { period: k, revenue: r2(a.rev), expense: r2(a.exp), rate: a.rev ? r2(a.exp / a.rev * 100) : 0 };
      });
      const erVals = er.map((x) => x.rate);
      const erAvg = erVals.length ? erVals.reduce((a, b) => a + b, 0) / erVals.length : 0;
      const erSd = Math.sqrt(erVals.reduce((a, b) => a + (b - erAvg) * (b - erAvg), 0) / Math.max(erVals.length, 1));
      metrics.push({
        id: 'M02', name: '费用率', unit: '%', series: er, value: r2(erAvg), avg: r2(erAvg), sd: r2(erSd),
        deviation: r2(erSd ? Math.max.apply(null, er.map((x) => Math.abs(x.rate - erAvg))) / erSd : 0),
        abnormal: false, detail: [], tables: ['gl_ledger']
      });
      /* 应收周转天数（按应收账款余额 / 月均收入） */
      const arBal = D.gl_ledger.filter((l) => String(l.subject_code) === '1122');
      const arByPeriod = {};
      arBal.forEach((l) => { arByPeriod[l.period] = Math.max(arByPeriod[l.period] || 0, num(l.balance)); });
      const turn = periods.map((k) => {
        const bal = arByPeriod[k] || 0;
        const rev = monthAgg[k].rev || 1;
        return { period: k, ar: r2(bal), revenue: r2(rev), days: r2(bal / rev * 30) };
      });
      const tv = turn.map((x) => x.days);
      const tAvg = tv.length ? tv.reduce((a, b) => a + b, 0) / tv.length : 0;
      const tSd = Math.sqrt(tv.reduce((a, b) => a + (b - tAvg) * (b - tAvg), 0) / Math.max(tv.length, 1));
      metrics.push({
        id: 'M03', name: '应收周转天数', unit: '天', series: turn, value: r2(tAvg), avg: r2(tAvg), sd: r2(tSd),
        deviation: r2(tSd ? Math.max.apply(null, tv.map((x) => Math.abs(x - tAvg))) / tSd : 0),
        abnormal: false, detail: [], tables: ['gl_ledger']
      });
      /* 票款不一致率 */
      let invCnt = 0, invBad = 0;
      D.tax_invoice_pool.filter((i) => i.invoice_type === '进项').forEach((i) => {
        if (!inRange(i.invoice_date, p.periodFrom, p.periodTo)) return;
        let po = ctx.receiptByNo[i.source_ref] ? ctx.poById.get(ctx.receiptByNo[i.source_ref].po_id) : null;
        if (!po) po = D.pur_orders.find((x) => x.po_no === i.source_ref);
        if (!po) return;
        invCnt++;
        if (Math.abs(num(i.total_amount) - num(po.grand_total)) > 1) invBad++;
      });
      const m4 = RULE_MAP.M04, p4 = ruleParam(m4, overrides);
      const m4rate = invCnt ? invBad / invCnt : 0;
      metrics.push({
        id: 'M04', name: '票款不一致率', unit: '%',
        series: [{ period: '统计期间', 不一致笔数: invBad, 总笔数: invCnt }],
        value: r2(m4rate * 100), avg: r2(p4.rate * 100), sd: 0, deviation: r2(p4.rate ? m4rate / p4.rate : 0),
        abnormal: m4rate > p4.rate,
        detail: [`不一致 ${invBad} 笔 / 比对 ${invCnt} 笔`], tables: ['tax_invoice_pool', 'pur_orders']
      });
      /* 现金/个人渠道占比 */
      const cashTx = bank.filter((t) => t.channel === '现金' || t.channel === '个人网银' || String(t.counterparty || '').indexOf('个人') === 0);
      const m5 = RULE_MAP.M05, p5 = ruleParam(m5, overrides);
      const m5rate = bank.length ? cashTx.length / bank.length : 0;
      metrics.push({
        id: 'M05', name: '现金/个人渠道占比', unit: '%',
        series: [{ period: '统计期间', 非对公笔数: cashTx.length, 总笔数: bank.length }],
        value: r2(m5rate * 100), avg: r2(p5.rate * 100), sd: 0, deviation: r2(p5.rate ? m5rate / p5.rate : 0),
        abnormal: m5rate > p5.rate,
        detail: [`非对公渠道 ${cashTx.length} 笔 / 总 ${bank.length} 笔`], tables: ['bank_transactions']
      });
      /* 银企差异率 */
      let bc = 0, bbad = 0;
      bank.forEach((t) => {
        if (!t.voucher_id) { bbad++; bc++; return; }
        const v = ctx.vchById.get(t.voucher_id);
        bc++;
        if (!v || Math.abs(num(t.amount) - num(v.total_debit)) > 1) bbad++;
      });
      const m6 = RULE_MAP.M06, p6 = ruleParam(m6, overrides);
      const m6rate = bc ? bbad / bc : 0;
      metrics.push({
        id: 'M06', name: '银企差异率', unit: '%',
        series: [{ period: '统计期间', 差异笔数: bbad, 总笔数: bc }],
        value: r2(m6rate * 100), avg: r2(p6.rate * 100), sd: 0, deviation: r2(p6.rate ? m6rate / p6.rate : 0),
        abnormal: m6rate > p6.rate,
        detail: [`差异 ${bbad} 笔 / 核对 ${bc} 笔`], tables: ['bank_transactions', 'gl_vouchers']
      });
      /* 非工作日交易占比 */
      const wkCnt = bank.filter((t) => isWeekend(t.tx_date)).length;
      const m7 = RULE_MAP.M07, p7 = ruleParam(m7, overrides);
      const m7rate = bank.length ? wkCnt / bank.length : 0;
      metrics.push({
        id: 'M07', name: '非工作日交易占比', unit: '%',
        series: [{ period: '统计期间', 非工作日笔数: wkCnt, 总笔数: bank.length }],
        value: r2(m7rate * 100), avg: r2(p7.rate * 100), sd: 0, deviation: r2(p7.rate ? m7rate / p7.rate : 0),
        abnormal: m7rate > p7.rate,
        detail: [`非工作日 ${wkCnt} 笔 / 总 ${bank.length} 笔`], tables: ['bank_transactions']
      });

      /* 第二步按异常指标生成信号 */
      metrics.filter((m) => m.abnormal).forEach((m) => {
        addSignal(m.id, {
          subject: '（期间汇总）', date: '', amount: 0,
          grade: RULE_MAP[m.id].defaultGrade,
          reason: RULE_MAP[m.id].reason(ruleParam(RULE_MAP[m.id], overrides)) +
            `；实测 ${m.value}${m.unit}，参考 ${m.avg}${m.unit}`,
          evidence: [{ table: m.tables[0], field: '指标', value: m.name + ' ' + m.value + m.unit }]
        });
      });
    })();

    /* ============ 第三步：关联图谱与模型复核 ============ */
    const graph = { nodes: [], edges: [], sharedInfo: [], personLinks: [], roundTrips: [] };
    (function () {
      /* 节点：本公司、供应商、客户、内部人员 */
      graph.nodes.push({ id: 'SELF', label: '本公司', type: 'self' });

      /* 资金回流：付款后窗口期内资金回流到本公司 */
      const g1 = RULE_MAP.G01, q1 = ruleParam(g1, overrides);
      const outTx = bank.filter((t) => t.tx_type === '支出');
      const inTx = bank.filter((t) => t.tx_type === '收入');
      /* 判定"回流方"：同对手方本人，或与该对手方存在人员关联的自然人（如法定代表人） */
      const personOf = {};
      graph.personLinks.forEach((pl) => { personOf[pl.party] = personOf[pl.party] || []; personOf[pl.party].push(pl.emp); });
      /* 交易对手联系人为自然人时，视为该对手方的关联自然人 */
      D.suppliers.forEach((s) => {
        if (s.contact && s.contact.length <= 4) {
          personOf[s.supplier_name] = personOf[s.supplier_name] || [];
          if (personOf[s.supplier_name].indexOf(s.contact) < 0) personOf[s.supplier_name].push(s.contact);
        }
      });
      const seenTrip = new Set();
      outTx.forEach((o) => {
        const relatedIn = inTx.filter((i) => {
          if (i.counterparty === o.counterparty) return true;
          const rel = personOf[o.counterparty] || [];
          return rel.indexOf(i.counterparty) >= 0;
        });
        relatedIn.forEach((i) => {
          const gap = dayDiff(o.tx_date, i.tx_date);
          if (gap == null || gap < 0 || gap > q1.windowDays) return;
          if (num(i.amount) < num(o.amount) * q1.tolerance || num(i.amount) > num(o.amount) * 1.3) return;
          const key = o.bank_tx_id + '>' + i.bank_tx_id;
          if (seenTrip.has(key)) return;
          seenTrip.add(key);
          const viaSelf = i.counterparty === o.counterparty;
          addSignal('G01', {
            subject: o.counterparty, date: ymd(o.tx_date), amount: r2(o.amount), grade: 'high',
            reason: `付款 ${money(o.amount)}（${ymd(o.tx_date)}）后 ${gap} 天，` +
              (viaSelf ? '收到同对手方回款' : `收到其关联自然人「${i.counterparty}」转入`) +
              ` ${money(i.amount)}（${ymd(i.tx_date)}）`,
            basisTypes: viaSelf ? ['substance'] : ['substance', 'person'],
            evidence: [{ table: 'bank_transactions', field: 'bank_tx_id', value: o.bank_tx_id },
              { table: 'bank_transactions', field: 'bank_tx_id', value: i.bank_tx_id },
              { table: 'bank_transactions', field: 'counterparty', value: i.counterparty }]
          });
          graph.roundTrips.push({ from: o.counterparty, via: i.counterparty,
            outDate: ymd(o.tx_date), outAmt: r2(o.amount),
            inDate: ymd(i.tx_date), inAmt: r2(i.amount), gap });
        });
      });

      /* 共用联系方式/地址（供应商之间、供应商与客户之间） */
      const phoneMap = {}, addrMap = {};
      D.suppliers.forEach((s) => {
        if (s.phone) (phoneMap[s.phone] = phoneMap[s.phone] || []).push({ code: s.supplier_code, name: s.supplier_name, type: 'supplier' });
        if (s.address && s.address !== '海外地址') (addrMap[s.address] = addrMap[s.address] || []).push({ code: s.supplier_code, name: s.supplier_name, type: 'supplier' });
      });
      D.customers.forEach((c) => {
        if (c.phone) (phoneMap[c.phone] = phoneMap[c.phone] || []).push({ code: c.customer_code, name: c.customer_name, type: 'customer' });
        if (c.address && c.address !== '海外地址') (addrMap[c.address] = addrMap[c.address] || []).push({ code: c.customer_code, name: c.customer_name, type: 'customer' });
      });
      const reportShared = (map, kind) => {
        Object.keys(map).forEach((k) => {
          const list = map[k];
          if (list.length < 2) return;
          if (kind === '地址' && k === '海外地址') return;
          const names = list.map((x) => x.name);
          graph.sharedInfo.push({ kind, value: k, parties: names });
          addSignal('G02', {
            subject: names.join(' / '), date: '', amount: 0, grade: 'high',
            reason: `${list.length} 个交易对手共用${kind}「${k}」`,
            basisTypes: ['substance'],
            evidence: [{ table: 'suppliers', field: kind === '电话' ? 'phone' : 'address', value: k }]
          });
          list.forEach((x) => {
            graph.edges.push({ from: 'SELF', to: x.name, kind, weight: 1 });
          });
        });
      };
      reportShared(phoneMap, '电话');
      reportShared(addrMap, '地址');

      /* 内部人员与交易对手重名 */
      const sensitivePositions = q1 && RULE_MAP.G03.param.sensitivePositions ? RULE_MAP.G03.param.sensitivePositions : [];
      const isSensitive = (pos) => sensitivePositions.some((k) => String(pos || '').indexOf(k) >= 0);
      D.suppliers.forEach((s) => {
        if (!ctx.empNameSet.has(s.contact)) return;
        const emp = ctx.empByName[s.contact];
        addSignal('G03', {
          subject: s.supplier_name, date: '', amount: 0, grade: isSensitive(emp.position) ? 'high' : 'medium',
          reason: `供应商「${s.supplier_name}」联系人与本公司员工「${emp.emp_name}」（${emp.position}，${emp.emp_code}）姓名一致`,
          basisTypes: ['person'],
          evidence: [{ table: 'suppliers', field: 'contact', value: s.contact },
            { table: 'employees', field: 'emp_code', value: emp.emp_code }]
        });
        graph.personLinks.push({ party: s.supplier_name, partyType: 'supplier', emp: emp.emp_name,
          empCode: emp.emp_code, position: emp.position, sensitive: isSensitive(emp.position) });
        graph.edges.push({ from: emp.emp_name, to: s.supplier_name, kind: '人员关联', weight: 2 });
        graph.nodes.push({ id: emp.emp_name, label: emp.emp_name, type: 'employee', position: emp.position });
      });
      D.customers.forEach((c) => {
        if (!ctx.empNameSet.has(c.contact)) return;
        const emp = ctx.empByName[c.contact];
        addSignal('G03', {
          subject: c.customer_name, date: '', amount: 0, grade: 'medium',
          reason: `客户「${c.customer_name}」联系人与本公司员工「${emp.emp_name}」（${emp.position}）姓名一致`,
          basisTypes: ['person'],
          evidence: [{ table: 'customers', field: 'contact', value: c.contact },
            { table: 'employees', field: 'emp_code', value: emp.emp_code }]
        });
        graph.personLinks.push({ party: c.customer_name, partyType: 'customer', emp: emp.emp_name,
          empCode: emp.emp_code, position: emp.position, sensitive: isSensitive(emp.position) });
      });

      /* 同一实际控制人密集往来 */
      const relatedNames = new Set(graph.sharedInfo.flatMap((x) => x.parties).concat(graph.personLinks.map((x) => x.party)));
      const relatedSum = sumBy(bank.filter((t) => relatedNames.has(t.counterparty)), (t) => t.amount);
      const allSum = sumBy(bank, (t) => t.amount);
      const g4 = RULE_MAP.G04, q4 = ruleParam(g4, overrides);
      if (relatedNames.size && allSum && relatedSum / allSum >= q4.ratio) {
        addSignal('G04', {
          subject: Array.from(relatedNames).join(' / '), date: '', amount: r2(relatedSum), grade: 'medium',
          reason: `疑似关联对手方合计资金往来 ${money(relatedSum)}，占全部流水 ${pct(relatedSum, allSum)}%`,
          basisTypes: ['equity', 'person', 'substance'],
          evidence: [{ table: 'bank_transactions', field: 'counterparty', value: '疑似关联对手方集合' }]
        });
      }

      /* 付款由同一账户集中完成 */
      const acctAgg = {};
      bank.filter((t) => t.tx_type === '支出').forEach((t) => { acctAgg[t.account_no] = (acctAgg[t.account_no] || 0) + 1; });
      const acctKeys = Object.keys(acctAgg);
      if (acctKeys.length === 1 && acctAgg[acctKeys[0]] > 50) {
        addSignal('G05', {
          subject: acctKeys[0], date: '', amount: 0, grade: 'low',
          reason: `全部 ${acctAgg[acctKeys[0]]} 笔付款集中通过单一银行账户办理`,
          evidence: [{ table: 'bank_transactions', field: 'account_no', value: acctKeys[0] },
            { table: 'bank_accounts', field: 'account_no', value: acctKeys[0] }]
        });
      }

      /* 制单审核同一人 */
      D.gl_vouchers.forEach((v) => {
        if (v.maker && v.reviewer && v.maker === v.reviewer) {
          addSignal('G06', {
            subject: ctx.empByCode[v.maker] ? ctx.empByCode[v.maker].emp_name : v.maker,
            date: ymd(v.voucher_date), amount: r2(v.total_debit), grade: 'high',
            reason: `凭证 ${v.voucher_no} 制单人 ${v.maker} 与审核人 ${v.reviewer} 相同`,
            evidence: [{ table: 'gl_vouchers', field: 'voucher_no', value: v.voucher_no }]
          });
        }
      });

      /* 审批链不完整 */
      D.oa_expense_reports.forEach((o) => {
        if (!inRange(o.submit_date, p.periodFrom, p.periodTo)) return;
        const aprv = ctx.approvalsByReportId[o.id] || [];
        if (aprv.length < RULE_MAP.G07.param.minSteps) {
          const emp = ctx.empByCode[o.emp_code] || {};
          addSignal('G07', {
            subject: emp.emp_name || o.emp_code, date: ymd(o.submit_date), amount: r2(o.amount),
            grade: 'medium', reason: `报销单 ${o.report_no} 审批记录仅 ${aprv.length} 级，少于 ${RULE_MAP.G07.param.minSteps} 级`,
            evidence: [{ table: 'oa_expense_reports', field: 'report_no', value: o.report_no },
              { table: 'oa_approval_records', field: 'report_id', value: o.id }]
          });
        }
      });

      /* 图谱节点/边补充 */
      D.suppliers.forEach((s) => {
        if (bank.some((t) => t.counterparty === s.supplier_name)) {
          graph.edges.push({ from: 'SELF', to: s.supplier_name, kind: '付款/往来', weight: 1 });
        }
      });
    })();

    /* 视角过滤 */
    let out = signals;
    if (p.viewsOnly && p.viewsOnly.length) {
      out = out.filter((s) => !s.view || p.viewsOnly.indexOf(s.view) >= 0);
    }

    /* 信号统计 */
    const byGrade = GRADE_ORDER.reduce((m, g) => { m[g] = 0; return m; }, {});
    const byView = {};
    const bySubject = {};
    const byRule = {};
    out.forEach((s) => {
      byGrade[s.grade] = (byGrade[s.grade] || 0) + 1;
      if (s.view) byView[s.view] = (byView[s.view] || 0) + 1;
      bySubject[s.subject] = (bySubject[s.subject] || 0) + 1;
      byRule[s.ruleId] = (byRule[s.ruleId] || 0) + 1;
    });

    /* 供线索模块复用的原始信号 */
    const tablesUsed = ['bank_transactions', 'gl_vouchers', 'pur_orders', 'pur_receipts', 'tax_invoice_pool',
      'oa_expense_reports', 'oa_approval_records', 'suppliers', 'customers', 'employees', 'products', 'rd_timesheets'];

    return {
      module: 'risk_signal',
      title: '舞弊风险信号识别结果',
      method: 'hybrid_three_step',
      methodLabel: '三步法：规则阈值初筛 → 指标/比率分析 → 关联图谱与模型复核',
      params: p,
      signals: out.slice(0, 800),
      total: out.length,
      steps: [
        { key: 'rule', label: '第一步 · 规则阈值初筛', desc: '对全量数据跑规则引擎，规则编号可追溯', count: out.filter((s) => s.step === 'rule').length },
        { key: 'metric', label: '第二步 · 指标/比率分析', desc: '输出毛利率、费用率、周转、票款不一致率等偏离度', count: out.filter((s) => s.step === 'metric').length },
        { key: 'graph', label: '第三步 · 关联图谱与模型复核', desc: '环状资金流、共用联系方式、实控人密集往来等复核信号', count: out.filter((s) => s.step === 'graph').length }
      ],
      metrics,
      graph,
      fundViews: Object.keys(FUND_VIEWS).map((k) => ({
        key: k, name: FUND_VIEWS[k].name, desc: FUND_VIEWS[k].desc, count: byView[k] || 0
      })),
      relatedPartyBasis: Object.keys(RELATED_PARTY_BASIS).map((k) => ({
        key: k, name: RELATED_PARTY_BASIS[k].name, desc: RELATED_PARTY_BASIS[k].desc,
        count: out.filter((s) => (s.basis || []).indexOf(RELATED_PARTY_BASIS[k].name) >= 0).length
      })),
      summary: { byGrade, byView, bySubject, byRule, total: out.length },
      dataQuality: pre,
      suppressedRules: Array.from(suppressed).map((id) => ({
        id, name: (RULE_MAP[id] || {}).name || id,
        reason: '数据质量校验显示该规则在本数据集上命中率过高，区分度不足'
      })),
      disclaimer: DISCLAIMER_LONG,
      trace: trace(tablesUsed, {
        period: [p.periodFrom, p.periodTo], entity: p.entityType,
        sql: buildSql('bank_transactions', { tx_date: `BETWEEN ${p.periodFrom || '2026-01-01'} AND ${p.periodTo || '2026-12-31'}` }, 5000)
      }, uniq(out.map((s) => s.ruleId)))
    };
  }

  /* ============================================================
   * 功能3：可疑交易线索梳理
   * ============================================================ */
  function clues(D, params, riskResult) {
    const ctx = makeContext(D, params);
    const { p } = ctx;
    const risk = riskResult || riskSignal(D, params);
    /* 按主体分组 */
    const groups = {};
    risk.signals.forEach((s) => {
      const key = s.subject || '（未指定主体）';
      if (!groups[key]) groups[key] = [];
      groups[key].push(s);
    });

    const gradeRank = { high: 1, medium: 2, low: 3, unknown: 4 };
    const list = Object.keys(groups).map((subject, idx) => {
      const sigs = groups[subject];
      const best = sigs.slice().sort((a, b) => gradeRank[a.grade] - gradeRank[b.grade])[0];
      const amount = r2(sumBy(sigs.filter((s) => s.ruleId !== 'R17' && s.ruleId !== 'G02' && s.ruleId !== 'G03'), (s) => s.amount));
      const dates = sigs.map((s) => s.date).filter(Boolean).sort();
      const isSup = D.suppliers.some((x) => x.supplier_name === subject);
      const isCus = D.customers.some((x) => x.customer_name === subject);
      const emp = ctx.empByName[subject];
      const entityType = isSup ? '供应商' : isCus ? '客户' : emp ? '员工' : '其他';

      /* —— 资金视图 —— */
      const tx = D.bank_transactions.filter((t) => t.counterparty === subject);
      const fundView = {
        收付款对象: subject,
        支出笔数: tx.filter((t) => t.tx_type === '支出').length,
        支出金额: r2(sumBy(tx.filter((t) => t.tx_type === '支出'), (t) => t.amount)),
        收入笔数: tx.filter((t) => t.tx_type === '收入').length,
        收入金额: r2(sumBy(tx.filter((t) => t.tx_type === '收入'), (t) => t.amount)),
        路径: tx.length ? '本公司账户 → 对方账户（单层）' : '（本期无直接流水）',
        主要渠道: uniq(tx.map((t) => t.channel || '网银')).join('、') || '—',
        时间分布: uniq(tx.map((t) => ym(t.tx_date))).sort().join('、') || '—'
      };

      /* —— 单据视图 —— */
      const sup = D.suppliers.find((x) => x.supplier_name === subject);
      let docView = { 链条完整性: '不适用' };
      if (sup) {
        const pos = D.pur_orders.filter((x) => x.supplier_code === sup.supplier_code);
        const withR = pos.filter((x) => ctx.receiptByPoId[x.id]).length;
        const withInv = pos.filter((x) => {
          const r = ctx.receiptByPoId[x.id];
          return D.tax_invoice_pool.some((i) => i.invoice_type === '进项' && (i.source_ref === x.po_no || (r && i.source_ref === r.receipt_no)));
        }).length;
        docView = {
          合同: D.pur_contracts.some((c) => c.supplier_code === sup.supplier_code) ? '有' : '缺失',
          采购订单: pos.length + ' 单',
          已入库: withR + ' 单',
          已开票: withInv + ' 单',
          链条完整性: `${pos.length} 单中 ${withR} 单入库、${withInv} 单开票`,
          缺失环节: [
            pos.length - withR > 0 ? `${pos.length - withR} 单无入库` : '',
            pos.length - withInv > 0 ? `${pos.length - withInv} 单无发票` : ''
          ].filter(Boolean).join('；') || '无明显缺失'
        };
      } else if (emp) {
        const reps = D.oa_expense_reports.filter((o) => o.emp_code === emp.emp_code);
        const aprvOk = reps.filter((o) => (ctx.approvalsByReportId[o.id] || []).length >= 2).length;
        docView = {
          合同: '不适用', 采购订单: reps.length + ' 张报销单', 已入库: '—', 已开票: '—',
          链条完整性: `${reps.length} 张报销单中 ${aprvOk} 张审批链完整`,
          缺失环节: reps.length - aprvOk > 0 ? `${reps.length - aprvOk} 张审批链不足` : '无明显缺失'
        };
      }

      /* —— 关联方视图 —— */
      const sharedTel = risk.graph.sharedInfo.filter((x) => x.parties.indexOf(subject) >= 0);
      const personLink = risk.graph.personLinks.filter((x) => x.party === subject);
      const relView = {
        股权关联: '（本期数据无股权穿透字段，需调取工商登记信息）',
        人员关联: personLink.length ? personLink.map((x) => `${x.emp}（${x.position}）`).join('、') : '未发现',
        实质关联: sharedTel.length ? sharedTel.map((x) => `共用${x.kind}：${x.value}`).join('；') : '未发现',
        关联交易口径: '股权 + 人员及近亲属 + 交易实质（equity_person_substance）'
      };

      /* —— 时间视图 —— */
      const timeline = sigs.filter((s) => s.date).map((s) => ({
        节点: s.ruleName, 时间: s.date, 金额: r2(s.amount), 信号编号: s.id, 等级: GRADES[s.grade] ? GRADES[s.grade].label : ''
      })).sort((a, b) => a.时间.localeCompare(b.时间));

      /* —— 六要素 —— */
      return {
        clueId: 'CLUE-' + String(idx + 1).padStart(3, '0'),
        subject, entityType,
        触发信号: uniq(sigs.map((s) => `${s.ruleId} ${s.ruleName}`)).slice(0, 6),
        signalCount: sigs.length,
        时间范围: dates.length ? `${dates[0]} ~ ${dates[dates.length - 1]}` : '—',
        金额: amount,
        证据位置: uniq(sigs.flatMap((s) => (s.evidence || []).map((e) => {
          const meta = TABLE_META[e.table];
          return `${meta ? meta.name : e.table}.${(meta && meta.fields[e.field]) || e.field}=${e.value}`;
        }))).slice(0, 8),
        建议核查动作: uniq(sigs.map((s) => s.action)).slice(0, 4),
        可疑等级: best ? best.grade : 'unknown',
        可疑等级说明: 'AI建议，待人工确认',
        gradeLabel: best ? (GRADES[best.grade] ? GRADES[best.grade].label : '') : '信息不足待补充',
        可能误报: uniq(sigs.map((s) => s.falsePositive)).slice(0, 3),
        views: { 资金视图: fundView, 单据视图: docView, 关联方视图: relView, 时间视图: timeline },
        signals: sigs
      };
    }).sort((a, b) => gradeRank[a.可疑等级] - gradeRank[b.可疑等级] || b.金额 - a.金额);

    /* 线索热度：按主体信号数 */
    const heat = list.slice(0, 20).map((c) => ({ subject: c.subject, count: c.signalCount, grade: c.可疑等级, amount: c.金额 }));

    return {
      module: 'clue_sort',
      title: '待核查线索清单',
      method: 'entity_primary_with_views',
      methodLabel: '以涉及主体为主线，资金/单据/关联方/时间四视图呈现',
      params: p,
      clues: list,
      total: list.length,
      heat,
      columns: ['clueId', 'subject', 'entityType', '触发信号', '时间范围', '金额', '可疑等级', '建议核查动作'],
      sixElements: ['① 触发信号', '② 涉及主体', '③ 时间与金额', '④ 证据所在位置', '⑤ 建议核查动作', '⑥ 可疑等级（AI建议，待人工确认）'],
      summary: risk.summary,
      disclaimer: DISCLAIMER_LONG,
      trace: risk.trace
    };
  }

  /* ============================================================
   * 功能4：舞弊可能性评估（评分卡 + 舞弊三角）
   * ============================================================ */
  function score(D, params, riskResult) {
    const ctx = makeContext(D, params);
    const { p } = ctx;
    const risk = riskResult || riskSignal(D, params);
    const hitRules = new Set(risk.signals.map((s) => s.ruleId));
    const subjectSignals = risk.signals;

    const dims = {};
    let totalScore = 0;
    Object.keys(SCORECARD).forEach((dimKey) => {
      const dim = SCORECARD[dimKey];
      const round2 = (n) => Math.round(n * 100) / 100;
      const items = dim.items.map((it) => {
        const refs = it.ruleRefs || [];
        const hit = refs.filter((r) => hitRules.has(r));
        const hitSignals = subjectSignals.filter((s) => refs.indexOf(s.ruleId) >= 0);
        const isHit = hit.length > 0;
        /* 命中比例法：命中规则数 / 参考规则数，取值 (0, 1]，上限 1 */
        const ratio = refs.length ? Math.min(1, hit.length / refs.length) : 0;
        /* 指标得分 = 权重 × (0.6 + 0.4 × 命中比例)，最大不超过权重 */
        const itemScore = isHit ? round2(Math.min(it.weight, it.weight * (0.6 + 0.4 * ratio))) : 0;
        return {
          id: it.id, name: it.name, weight: it.weight, basis: it.basis,
          ruleRefs: refs, hitRules: hit, hit: isHit, score: itemScore,
          evidence: hitSignals.slice(0, 3).map((s) => `${s.id} ${s.ruleName}（${s.subject}）`),
          note: refs.length === 0 ? '无数据支撑，需调查人员访谈判断' : ''
        };
      });
      /* 维度得分上限为该维度权重，保证总分不超过 100 */
      const dimScore = Math.min(dim.weight, round2(sumBy(items, (i) => i.score)));
      dims[dimKey] = { key: dimKey, name: dim.name, desc: dim.desc, weight: dim.weight, items, score: dimScore,
        ratio: round2(dim.weight ? dimScore / dim.weight * 100 : 0) };
      totalScore = round2(totalScore + dimScore);
    });

    /* 总分按 100 分制封顶 */
    const normalized = Math.min(100, r2(totalScore));
    const band = SCORE_BANDS.find((b) => normalized >= b.min) || SCORE_BANDS[SCORE_BANDS.length - 1];

    /* 数据充分性判断 */
    const hasTri = subjectSignals.length;
    let gradeKey = band.key, gradeLabel = band.label, advice = band.advice;
    if (!hasTri) {
      gradeKey = 'unknown'; gradeLabel = '信息不足待补充';
      advice = '当前数据不足以支持判断，建议补充核查后再评估';
    }

    /* 舞弊三角解释 */
    const triangle = Object.keys(SCORECARD).map((k) => ({
      key: k, name: SCORECARD[k].name, desc: SCORECARD[k].desc,
      score: dims[k].score, weight: dims[k].weight,
      hitItems: dims[k].items.filter((i) => i.hit).map((i) => i.name),
      explain: dims[k].items.filter((i) => i.hit).map((i) => `${i.name}：${i.basis}；命中规则 ${i.hitRules.join('、')}`)
    }));

    return {
      module: 'risk_score',
      title: '舞弊可能性评估（参考分值）',
      method: 'scorecard_plus_triangle',
      methodLabel: '评分卡打分为主 + 舞弊三角模型做解释框架',
      params: p,
      dimensions: dims,
      triangle,
      totalScore: normalized,
      maxScore: 100,
      band,
      grade: gradeKey,
      gradeLabel,
      advice,
      declaration: SCORE_DECLARATION,
      hitSummary: subjectSignals.slice(0, 30).map((s) => ({ id: s.id, rule: s.ruleId, name: s.ruleName, subject: s.subject, grade: s.gradeLabel })),
      disclaimer: DISCLAIMER_LONG,
      trace: trace(['gl_vouchers', 'oa_expense_reports', 'oa_approval_records', 'bank_transactions', 'suppliers', 'employees', 'pur_orders'],
        { period: [p.periodFrom, p.periodTo], entity: p.entityType, code: p.entityCode },
        uniq(subjectSignals.map((s) => s.ruleId)))
    };
  }

  /* ============================================================
   * 功能5：证据分析与资料核对
   * ============================================================ */
  function evidence(D, params) {
    const ctx = makeContext(D, params);
    const { p } = ctx;
    const methods = (p.methods && p.methods.length) ? p.methods : Object.keys(EVIDENCE_METHODS);
    const out = [];

    /* ---------- three_way_match 三单匹配 ---------- */
    if (methods.indexOf('three_way_match') >= 0) {
      const diffs = [];
      let checked = 0;
      D.pur_orders.forEach((po) => {
        if (!inRange(po.order_date, p.periodFrom, p.periodTo)) return;
        if (p.entityType === 'supplier' && p.entityCode && po.supplier_code !== p.entityCode) return;
        checked++;
        const sup = ctx.supByCode[po.supplier_code] || {};
        const rcpt = ctx.receiptByPoId[po.id];
        const items = D.pur_order_items.filter((x) => x.po_id === po.id);
        const invs = D.tax_invoice_pool.filter((i) => i.invoice_type === '进项' &&
          (i.source_ref === po.po_no || (rcpt && i.source_ref === rcpt.receipt_no)));
        /* 缺入库 */
        if (!rcpt && po.status !== '已下单') {
          diffs.push({
            差异类型: '缺入库单', 涉及单据: po.po_no, 涉及主体: sup.supplier_name || po.supplier_code,
            订单金额: r2(po.grand_total), 入库金额: 0, 发票金额: r2(sumBy(invs, (i) => i.total_amount)),
            金额差异: r2(po.grand_total), 时间差异: '—',
            可能原因: '直发客户业务、系统延迟同步，或存在"有票无货"风险，需人工判断',
            等级: 'high'
          });
        }
        /* 缺发票 */
        if (!invs.length) {
          diffs.push({
            差异类型: '缺进项发票', 涉及单据: po.po_no, 涉及主体: sup.supplier_name || po.supplier_code,
            订单金额: r2(po.grand_total), 入库金额: rcpt ? r2(rcpt.total_amount) : 0, 发票金额: 0,
            金额差异: r2(po.grand_total), 时间差异: '—',
            可能原因: '尚未结算开票、供应商延迟开票', 等级: 'medium'
          });
        }
        /* 金额不符 */
        invs.forEach((i) => {
          const diff = r2(num(i.total_amount) - num(po.grand_total));
          if (Math.abs(diff) > 1) {
            diffs.push({
              差异类型: '票款金额不符', 涉及单据: `${po.po_no} / ${i.invoice_no}`,
              涉及主体: sup.supplier_name || po.supplier_code,
              订单金额: r2(po.grand_total), 入库金额: rcpt ? r2(rcpt.total_amount) : 0,
              发票金额: r2(i.total_amount), 金额差异: diff, 时间差异: '—',
              可能原因: '分期开票、价外费用、价格调整', 等级: 'high'
            });
          }
        });
        /* 日期顺序倒挂 */
        if (rcpt && ymd(rcpt.receipt_date) < ymd(po.order_date)) {
          diffs.push({
            差异类型: '日期倒挂（入库早于订单）', 涉及单据: `${po.po_no} / ${rcpt.receipt_no}`,
            涉及主体: sup.supplier_name || po.supplier_code,
            订单金额: r2(po.grand_total), 入库金额: r2(rcpt.total_amount), 发票金额: r2(sumBy(invs, (i) => i.total_amount)),
            金额差异: 0, 时间差异: `${dayDiff(rcpt.receipt_date, po.order_date)} 天`, 可能原因: '系统补录、紧急放行后补单', 等级: 'medium'
          });
        }
        /* 订单行合计校验 */
        const lineSum = r2(sumBy(items, (i) => i.amount));
        if (Math.abs(lineSum - num(po.total_amount)) > 1) {
          diffs.push({
            差异类型: '订单行合计不符', 涉及单据: po.po_no, 涉及主体: sup.supplier_name || po.supplier_code,
            订单金额: r2(po.total_amount), 入库金额: 0, 发票金额: 0,
            金额差异: r2(lineSum - num(po.total_amount)), 时间差异: '—', 可能原因: '系统录入错误', 等级: 'low'
          });
        }
      });
      out.push({
        key: 'three_way_match', ...EVIDENCE_METHODS.three_way_match,
        coverage: { checked, hit: diffs.length, rate: checked ? r2(diffs.length / checked * 100) : 0 },
        rows: diffs.slice(0, 300),
        columns: ['差异类型', '涉及单据', '涉及主体', '订单金额', '入库金额', '发票金额', '金额差异', '时间差异', '可能原因'],
        conclusion: diffs.length
          ? `共比对 ${checked} 张采购订单，发现 ${diffs.length} 项差异，需调查人员判断差异性质。`
          : `共比对 ${checked} 张采购订单，未发现单据链断裂。`
      });
    }

    /* ---------- voucher_sampling 凭证抽凭 ---------- */
    if (methods.indexOf('voucher_sampling') >= 0) {
      const pool = D.gl_vouchers.filter((v) => inRange(v.voucher_date, p.periodFrom, p.periodTo));
      const sorted = pool.slice().sort((a, b) => num(b.total_debit) - num(a.total_debit));
      const top = sorted.slice(0, 30);
      /* 金额分层：大额/中额/小额各取 */
      const n = sorted.length;
      const strata = {
        大额: sorted.slice(0, Math.ceil(n * 0.1)).slice(0, 10),
        中额: sorted.slice(Math.floor(n * 0.4), Math.floor(n * 0.4) + 10),
        小额: sorted.slice(Math.max(0, n - 10))
      };
      const samples = [];
      const seenIds = new Set();
      Object.keys(strata).forEach((k) => {
        strata[k].forEach((v) => {
          if (seenIds.has(v.id)) return;
          seenIds.add(v.id);
          samples.push({ strategy: '金额分层-' + k, v });
        });
      });
      /* 异常特征：临近期末 / 无来源单据号 / 制单审核同一人 */
      const anomalyPool = pool.filter((v) => {
        const d = ymd(v.voucher_date);
        const month = Number(d.slice(5, 7)), year = Number(d.slice(0, 4));
        const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
        return Number(d.slice(8, 10)) > last - 3;
      });
      anomalyPool.slice(0, 8).forEach((v) => {
        if (seenIds.has(v.id)) return;
        seenIds.add(v.id);
        samples.push({ strategy: '异常特征-临近期末', v });
      });
      /* 无来源单据号的凭证：抽凭重点（无法追溯的关键特征） */
      pool.filter((v) => !v.source_ref).slice(0, 10).forEach((v) => {
        if (seenIds.has(v.id)) return;
        seenIds.add(v.id);
        samples.push({ strategy: '异常特征-无来源单据号', v });
      });
      /* 制单人与审核人相同 */
      pool.filter((v) => v.maker && v.reviewer && v.maker === v.reviewer).slice(0, 8).forEach((v) => {
        if (seenIds.has(v.id)) return;
        seenIds.add(v.id);
        samples.push({ strategy: '异常特征-制单审核同人', v });
      });

      const untraceable = [];
      samples.forEach(({ strategy, v }) => {
        /* 可追溯性：source_ref 能否匹配业务单据 */
        const ref = v.source_ref;
        let traceable = false, refTable = '';
        if (ref) {
          if (D.pur_orders.some((x) => x.po_no === ref)) { traceable = true; refTable = 'pur_orders.po_no'; }
          else if (D.sal_orders.some((x) => x.so_no === ref)) { traceable = true; refTable = 'sal_orders.so_no'; }
          else if (D.oa_expense_reports.some((x) => x.report_no === ref)) { traceable = true; refTable = 'oa_expense_reports.report_no'; }
          else if (D.pur_receipts.some((x) => x.receipt_no === ref)) { traceable = true; refTable = 'pur_receipts.receipt_no'; }
          else if (D.bank_transactions.some((x) => x.bank_tx_id === ref)) { traceable = true; refTable = 'bank_transactions.bank_tx_id'; }
        }
        if (!traceable) {
          untraceable.push({
            抽样策略: strategy, 凭证号: v.voucher_no, 凭证日期: ymd(v.voucher_date),
            来源系统: v.source_system || '—', 来源单据号: ref || '（空）',
            金额: r2(v.total_debit), 制单人: v.maker, 审核人: v.reviewer,
            无法追溯原因: ref ? `来源单据号 ${ref} 在业务系统中未匹配到` : '凭证未登记来源单据号',
            建议: '调阅原始凭证与附件，确认业务发生依据'
          });
        }
      });
      out.push({
        key: 'voucher_sampling', ...EVIDENCE_METHODS.voucher_sampling,
        coverage: { checked: samples.length, pool: n, hit: untraceable.length,
          rate: samples.length ? r2(untraceable.length / samples.length * 100) : 0 },
        rows: untraceable.slice(0, 200),
        columns: ['抽样策略', '凭证号', '凭证日期', '来源系统', '来源单据号', '金额', '制单人', '审核人', '无法追溯原因'],
        conclusion: `按三种策略抽取 ${samples.length} 张凭证（总体 ${n} 张），其中 ${untraceable.length} 张无法追溯到业务单据，需调查人员确认。`,
        extra: { strategies: { 金额分层: '按借方金额降序分层抽样', 随机: '（本演示按确定性抽样，保证结果可复现）', 异常特征: '临近期末：每月最后 3 天' },
          topAmount: top.slice(0, 10).map((v) => ({ 凭证号: v.voucher_no, 金额: r2(v.total_debit), 日期: ymd(v.voucher_date) })) }
      });
    }

    /* ---------- cross_system_compare 跨系统比对 ---------- */
    if (methods.indexOf('cross_system_compare') >= 0) {
      const diffs = [];
      D.oa_expense_reports.forEach((o) => {
        if (!inRange(o.submit_date, p.periodFrom, p.periodTo)) return;
        const emp = ctx.empByCode[o.emp_code] || {};
        const aprv = (ctx.approvalsByReportId[o.id] || []).sort((a, b) => num(a.step) - num(b.step));
        const v = ctx.vchById.get(o.voucher_id);
        /* 审批链完整性 */
        if (aprv.length < 2) {
          diffs.push({
            差异类型: '审批链不完整', 涉及单据: o.report_no, 涉及主体: emp.emp_name || o.emp_code,
            报销金额: r2(o.amount), 凭证金额: v ? r2(v.total_debit) : 0, 银行流水金额: 0,
            金额差异: 0, 审批步骤: aprv.length, 可能原因: '小额简化审批或补签', 等级: 'medium'
          });
        }
        /* 金额一致性 */
        if (v) {
          const d = r2(num(o.amount) - num(v.total_debit));
          if (Math.abs(d) > 1) {
            diffs.push({
              差异类型: '报销金额与凭证不符', 涉及单据: `${o.report_no} / ${v.voucher_no}`,
              涉及主体: emp.emp_name || o.emp_code,
              报销金额: r2(o.amount), 凭证金额: r2(v.total_debit), 银行流水金额: 0,
              金额差异: d, 审批步骤: aprv.length, 可能原因: '按净额入账、税费扣除', 等级: 'high'
            });
          }
        } else {
          diffs.push({
            差异类型: '报销单未生成凭证', 涉及单据: o.report_no, 涉及主体: emp.emp_name || o.emp_code,
            报销金额: r2(o.amount), 凭证金额: 0, 银行流水金额: 0, 金额差异: r2(o.amount),
            审批步骤: aprv.length, 可能原因: '审批未完成或未入账', 等级: 'high'
          });
        }
        /* 审批人与收款人重合 */
        const pay = D.bank_transactions.find((t) => t.counterparty === emp.emp_name &&
          Math.abs(num(t.amount) - num(o.amount)) < 1);
        if (pay) {
          const same = aprv.find((a) => a.approver_code === emp.emp_code);
          if (same) {
            diffs.push({
              差异类型: '审批人即收款人', 涉及单据: o.report_no, 涉及主体: emp.emp_name,
              报销金额: r2(o.amount), 凭证金额: v ? r2(v.total_debit) : 0, 银行流水金额: r2(pay.amount),
              金额差异: 0, 审批步骤: aprv.length, 可能原因: '自我审批，不相容职务未分离', 等级: 'high'
            });
          }
        }
      });
      out.push({
        key: 'cross_system_compare', ...EVIDENCE_METHODS.cross_system_compare,
        coverage: { checked: D.oa_expense_reports.filter((o) => inRange(o.submit_date, p.periodFrom, p.periodTo)).length,
          hit: diffs.length, rate: 0 },
        rows: diffs.slice(0, 300),
        columns: ['差异类型', '涉及单据', '涉及主体', '报销金额', '凭证金额', '银行流水金额', '金额差异', '审批步骤', '可能原因'],
        conclusion: `比对 OA 报销、总账凭证与银行付款，发现 ${diffs.length} 项不一致，需调查人员判断差异性质。`
      });
      out[out.length - 1].coverage.rate = out[out.length - 1].coverage.checked
        ? r2(diffs.length / out[out.length - 1].coverage.checked * 100) : 0;
    }

    /* ---------- bank_book_reconcile 银企对账 ---------- */
    if (methods.indexOf('bank_book_reconcile') >= 0) {
      const bank = filterBank(ctx);
      const diffs = [];
      let matched = 0;
      bank.forEach((t) => {
        const v = t.voucher_id ? ctx.vchById.get(t.voucher_id) : null;
        if (!v) {
          diffs.push({
            差异类型: '银行有账上无', 银行流水号: t.bank_tx_id, 交易日期: ymd(t.tx_date),
            金额: r2(t.amount), 对方户名: t.counterparty, 挂接凭证: '（未挂接）',
            凭证金额: 0, 金额差异: r2(t.amount), 可能原因: '账外资金收付或尚未入账', 等级: 'high'
          });
          return;
        }
        if (num(t.matched) === 0) {
          diffs.push({
            差异类型: '未达账项', 银行流水号: t.bank_tx_id, 交易日期: ymd(t.tx_date),
            金额: r2(t.amount), 对方户名: t.counterparty, 挂接凭证: v.voucher_no,
            凭证金额: r2(v.total_debit), 金额差异: r2(num(t.amount) - num(v.total_debit)),
            可能原因: '期末在途资金或银行系统延迟', 等级: 'medium'
          });
        }
        const d = r2(num(t.amount) - num(v.total_debit));
        if (Math.abs(d) > 1) {
          diffs.push({
            差异类型: '金额不符', 银行流水号: t.bank_tx_id, 交易日期: ymd(t.tx_date),
            金额: r2(t.amount), 对方户名: t.counterparty, 挂接凭证: v.voucher_no,
            凭证金额: r2(v.total_debit), 金额差异: d, 可能原因: '一笔凭证汇总多笔流水、手续费单列', 等级: 'medium'
          });
        } else {
          matched++;
        }
      });
      /* 长期未匹配：流水日期距今超过 60 天仍未对账 */
      const longUnmatched = diffs.filter((d) => d.差异类型 === '未达账项').filter((d) => {
        const gap = dayDiff(d.交易日期, p.periodTo || '2026-12-31');
        return gap != null && gap > 60;
      });
      out.push({
        key: 'bank_book_reconcile', ...EVIDENCE_METHODS.bank_book_reconcile,
        coverage: { checked: bank.length, hit: diffs.length, matched,
          rate: bank.length ? r2(matched / bank.length * 100) : 0 },
        rows: diffs.slice(0, 300),
        columns: ['差异类型', '银行流水号', '交易日期', '金额', '对方户名', '挂接凭证', '凭证金额', '金额差异', '可能原因'],
        conclusion: `核对 ${bank.length} 笔银行流水，金额一致 ${matched} 笔，差异 ${diffs.length} 项${longUnmatched.length ? `，其中长期未匹配 ${longUnmatched.length} 项` : ''}。`
      });
    }

    /* ---------- external_confirmation 外部函证 ---------- */
    if (methods.indexOf('external_confirmation') >= 0) {
      const letters = [];
      D.suppliers.forEach((s) => {
        const pos = D.pur_orders.filter((x) => x.supplier_code === s.supplier_code &&
          inRange(x.order_date, p.periodFrom, p.periodTo));
        const pays = D.bank_transactions.filter((t) => t.tx_type === '支出' && t.counterparty === s.supplier_name &&
          inRange(t.tx_date, p.periodFrom, p.periodTo));
        if (!pos.length && !pays.length) return;
        letters.push({
          函证对象类型: '供应商', 函证对象: s.supplier_name, 纳税人识别号: s.tax_no,
          回函地址: s.address, 联系人: s.contact, 联系电话: s.phone,
          函证期间: `${p.periodFrom || '2026-01-01'} 至 ${p.periodTo || '2026-12-31'}`,
          采购订单笔数: pos.length, 采购订单金额: r2(sumBy(pos, (x) => x.grand_total)),
          付款笔数: pays.length, 付款金额: r2(sumBy(pays, (t) => t.amount)),
          待确认往来余额: r2(sumBy(pos, (x) => x.grand_total) - sumBy(pays, (t) => t.amount)),
          建议: '需调查人员或审计人员对外发函确认'
        });
      });
      const bankAccts = D.bank_accounts.map((a) => ({
        函证对象类型: '银行', 函证对象: a.bank_name, 银行账号: a.account_no, 账户类型: a.account_type,
        币种: a.currency, 函证期间: `${p.periodFrom || '2026-01-01'} 至 ${p.periodTo || '2026-12-31'}`,
        待确认余额: '（需取得银行对账单核对）', 建议: '需调查人员或审计人员对外发函确认'
      }));
      out.push({
        key: 'external_confirmation', ...EVIDENCE_METHODS.external_confirmation,
        coverage: { checked: letters.length, hit: letters.length, rate: 100 },
        rows: letters.concat(bankAccts).slice(0, 300),
        columns: ['函证对象类型', '函证对象', '函证期间', '采购订单笔数', '采购订单金额', '付款笔数', '付款金额', '待确认往来余额', '建议'],
        conclusion: `已生成 ${letters.length} 份供应商函证与 ${bankAccts.length} 份银行函证要素初稿，实际发函需调查人员或审计人员执行。`,
        notice: '本清单仅为函证要素初稿，不触发任何对外发送动作。'
      });
    }

    /* 核对覆盖率统计 + 待取证清单 */
    const coverage = out.map((m) => ({ 方法: m.name, key: m.key, 核对数: m.coverage.checked, 差异数: m.coverage.hit, 说明: m.conclusion }));
    const pending = [];
    out.forEach((m) => {
      const rows = m.rows || [];
      rows.slice(0, 50).forEach((r) => {
        const grade = r.等级 || 'medium';
        if (grade !== 'high' && grade !== 'medium') return;
        pending.push({
          来源方法: m.name,
          涉及主体: r.涉及主体 || r.对方户名 || r.函证对象 || '—',
          涉及单据: r.涉及单据 || r.银行流水号 || r.凭证号 || '—',
          待取证材料: m.key === 'three_way_match' ? '入库单、验收单、发票及合同'
            : m.key === 'voucher_sampling' ? '原始凭证及附件'
            : m.key === 'cross_system_compare' ? 'OA 报销单、审批记录、记账凭证'
            : m.key === 'bank_book_reconcile' ? '银行对账单、银行存款日记账'
            : '往来余额确认函、工商登记信息',
          可疑等级: grade,
          说明: r.可能原因 || r.无法追溯原因 || '需人工核实'
        });
      });
    });

    return {
      module: 'evidence_check',
      title: '证据核对结果与差异说明',
      params: p,
      methods: out,
      coverage,
      pending: pending.slice(0, 200),
      pendingColumns: ['来源方法', '涉及主体', '涉及单据', '待取证材料', '可疑等级', '说明'],
      disclaimer: DISCLAIMER_LONG,
      trace: trace(uniq(out.flatMap((m) => m.tables)), { period: [p.periodFrom, p.periodTo], methods: methods },
        ['R09', 'R10', 'R11', 'R12', 'R13', 'R14', 'G01', 'G07'])
    };
  }

  /* ============================================================
   * 功能7：合规问答（关键词/规则匹配 + 口径字典）
   * ============================================================ */
  function qa(D, params) {
    const question = String((params && params.question) || '').trim();
    const q = question.toLowerCase();
    if (!question) {
      return {
        module: 'qa', question: '', matched: false, scope: '无输入',
        answer: '请输入问题。本助理可回答：分析方法说明、数据表与字段口径、规则阈值含义、报告章节说明、下一步建议核查动作。',
        refs: { tables: [], rules: [] }, suggestions: QA_TOPICS.filter((t) => t.scope === '在范围内').slice(0, 6).map((t) => t.title),
        disclaimer: DISCLAIMER_LONG, trace: trace([], {}, [])
      };
    }
    /* 先对全部主题打分（含超范围主题），再按「得分高者优先、同分时在范围内优先」裁决。
       这样可以避免"关联交易的认定口径"因含"认定"二字被误判为超范围问题。 */
    const scored = QA_TOPICS.map((t) => {
      let sc = 0;
      t.keywords.forEach((k) => {
        if (q.indexOf(k.toLowerCase()) >= 0) sc += k.length >= 3 ? 2 : 1;
      });
      /* 在范围内的口径类主题，命中时给少量加权，抑制"认定/结论"等泛词误伤 */
      if (sc > 0 && t.scope === '在范围内') sc += 0.5;
      return { topic: t, score: sc };
    }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);

    /* 超范围判定：仅当超范围主题得分严格高于所有在范围内主题，或问题明确指向判断性诉求时才拒答 */
    const outHit = scored.filter((x) => x.topic.scope === '超出范围');
    const inHit = scored.filter((x) => x.topic.scope === '在范围内');
    const bestOut = outHit.length ? outHit[0].score : 0;
    const bestInHit = inHit.length ? inHit[0] : null;
    const bestIn = bestInHit ? bestInHit.score : 0;
    /* 明确的判断性诉求：直接表达要结论/要认定 */
    const STRONG_JUDGEMENT = /(是否|是不是|能不能|可不可以|该不该|要不要|有没有).{0,8}(构成|立案|移交|追责|处罚|处分|报案|认定)|(直接|帮我|给我).{0,6}(结论|定性|认定)|责任人|损失金额.{0,4}认定|是否违法|是否违规/;
    const strongJudgement = STRONG_JUDGEMENT.test(question);

    if (bestOut > 0 && (strongJudgement || bestOut > bestIn)) {
      const outTopic = outHit[0].topic;
      return {
        module: 'qa', question, matched: true, scope: '超出范围', topicId: outTopic.id, topicTitle: outTopic.title,
        answer: outTopic.answer, refs: outTopic.refs,
        note: '本问题涉及调查结论或判断性意见，超出本助理回答范围。如您询问的是"分析方法/口径说明"，可换个问法（例如"关联方的认定口径是什么""评分卡怎么算"）。',
        suggestions: QA_TOPICS.filter((t) => t.scope === '在范围内').map((t) => t.title),
        disclaimer: DISCLAIMER_LONG, trace: trace([], { question }, [])
      };
    }

    const best = bestInHit ? bestInHit.topic : null;
    const bestScore = bestInHit ? bestInHit.score : 0;
    if (!best || bestScore === 0) {
      return {
        module: 'qa', question, matched: false, scope: '未匹配',
        answer: '该问题暂未匹配到本地口径字典。本助理为规则匹配式问答（非开放式对话），可回答范围限于：分析方法说明、数据表与字段口径、规则阈值含义、报告章节说明、下一步建议核查动作。如涉及是否立案、责任认定、法律定性等判断性诉求，需由调查人员或合规部门专业判断。建议切换到对应功能页查看结构化结果。',
        refs: { tables: [], rules: [] },
        suggestions: QA_TOPICS.filter((t) => t.scope === '在范围内').map((t) => t.title),
        disclaimer: DISCLAIMER_LONG, trace: trace([], { question }, [])
      };
    }
    /* 附带口径字典明细 */
    const refs = best.refs || { tables: [], rules: [] };
    const ruleDetail = (refs.rules || []).map((id) => {
      const r = RULE_MAP[id];
      if (!r) return { id, name: id };
      return { id, name: r.name, step: r.step, category: r.category, param: r.param, falsePositive: r.falsePositive };
    });
    const tableDetail = (refs.tables || []).map((tb) => ({
      name: tb, label: (TABLE_META[tb] || {}).name || tb, system: (TABLE_META[tb] || {}).sys || '—',
      fields: Object.keys((TABLE_META[tb] || {}).fields || {}).length
    }));
    return {
      module: 'qa', question, matched: true, scope: '在范围内',
      topicId: best.id, topicTitle: best.title,
      answer: best.answer, refs,
      ruleDetail: ruleDetail.slice(0, 12), tableDetail: tableDetail.slice(0, 26),
      suggestions: QA_TOPICS.filter((t) => t.scope === '在范围内' && t.id !== best.id).map((t) => t.title),
      disclaimer: DISCLAIMER_LONG,
      trace: trace(refs.tables, { question }, refs.rules)
    };
  }

  /* ============================================================
   * 功能7：待办提醒
   * ============================================================ */
  function reminders(D, params, cluesResult, evidenceResult) {
    const ctx = makeContext(D, params || {});
    const list = [];
    const cl = cluesResult || clues(D, params);
    const ev = evidenceResult || evidence(D, params);
    /* 未完成核查的高可疑线索 */
    cl.clues.filter((c) => c.可疑等级 === 'high').slice(0, 10).forEach((c) => {
      list.push({
        id: 'TODO-' + c.clueId, type: '未完成核查线索', subject: c.subject,
        content: `线索 ${c.clueId} 命中 ${c.signalCount} 条高度可疑信号：${c.触发信号.slice(0, 2).join('；')}`,
        level: 'high', action: c.建议核查动作[0] || '调阅原始单据', status: '待处理'
      });
    });
    /* 待取证事项 */
    (ev.pending || []).filter((x) => x.可疑等级 === 'high').slice(0, 8).forEach((x, i) => {
      list.push({
        id: 'TODO-EV' + (i + 1), type: '未取证事项', subject: x.涉及主体,
        content: `${x.来源方法}：${x.涉及单据} 需取得「${x.待取证材料}」`,
        level: 'high', action: '按待取证清单收集原始材料', status: '待处理'
      });
    });
    /* 数据缺口 */
    const gaps = [];
    if (!D.tax_invoice_pool.length) gaps.push('发票池为空，无法执行票款核对');
    const poNoR = D.pur_orders.filter((po) => !ctx.receiptByPoId[po.id]).length;
    if (poNoR) gaps.push(`${poNoR} 张采购订单缺少入库记录，三单匹配覆盖率受限`);
    const noApproval = D.oa_expense_reports.filter((o) => !(ctx.approvalsByReportId[o.id] || []).length).length;
    if (noApproval) gaps.push(`${noApproval} 张报销单缺少审批记录`);
    if (!D.suppliers.some((s) => s.tax_no && String(s.tax_no).length >= 15) === false) {
      /* 股权穿透数据缺失是常态，固定提示 */
    }
    gaps.push('供应商/客户股权穿透与工商登记信息不在本系统内，关联方认定需外部调取');
    gaps.push('个人征信与消费数据不可得，舞弊三角"压力"维度仅能基于交易数据提示');
    gaps.forEach((g, i) => {
      list.push({ id: 'TODO-DATA' + (i + 1), type: '数据缺口', subject: '—', content: g,
        level: 'medium', action: '补充外部数据或说明数据局限', status: '待处理' });
    });
    /* 报告待复核节点 */
    list.push({ id: 'TODO-RPT1', type: '报告复核节点', subject: '报告初稿',
      content: '风险信号识别结果需调查人员确认后方可进入下一环节', level: 'medium', action: '召开线索研判会', status: '待处理' });
    list.push({ id: 'TODO-RPT2', type: '报告复核节点', subject: '报告初稿',
      content: '报告初稿生成后需复核人签字确认，所有定性表述由调查人员重写', level: 'high',
      action: '提交复核人审阅并签字', status: '待处理' });

    return {
      module: 'reminder',
      title: '待办提醒',
      items: list,
      counts: {
        total: list.length,
        high: list.filter((x) => x.level === 'high').length,
        medium: list.filter((x) => x.level === 'medium').length,
        byType: list.reduce((m, x) => { m[x.type] = (m[x.type] || 0) + 1; return m; }, {})
      },
      notice: '标记已办仅记录本地状态，不触发任何对外发送、报送或移交动作。',
      disclaimer: DISCLAIMER_LONG,
      trace: trace(['oa_expense_reports', 'oa_approval_records', 'pur_orders', 'pur_receipts', 'tax_invoice_pool'],
        { period: [params && params.periodFrom, params && params.periodTo] }, [])
    };
  }

  /* ============================================================
   * 功能6：报告初稿
   * ============================================================ */
  function report(D, params, provided) {
    const p = Object.assign({}, params || {});
    const ctx = makeContext(D, p);
    const risk = provided && provided.risk ? provided.risk : riskSignal(D, p);
    const cl = provided && provided.clues ? provided.clues : clues(D, p, risk);
    const sc = provided && provided.score ? provided.score : score(D, p, risk);
    const ev = provided && provided.evidence ? provided.evidence : evidence(D, p);

    const byGrade = risk.summary.byGrade;
    const usedTables = uniq(risk.trace.tables.map((t) => t.name).concat(ev.trace.tables.map((t) => t.name)));
    const ruleIds = uniq(risk.signals.map((s) => s.ruleId)).sort();
    const generatedAt = new Date().toISOString();

    /* ---------- 七个固定章节 ---------- */
    const sec1 = {
      no: 1, title: '报告说明与免责声明',
      paragraphs: [
        '本报告由「无言以队」舞弊审计调查辅助台依据既定规则与财务分析方法自动生成，属辅助分析材料。',
        '报告中的风险信号、参考分值、可疑等级均为规则化计算结果，供调查人员参考，不构成调查结论，不构成对任何主体或个人的定性意见。',
        '报告中所有可疑事项的最终判断、定性表述与对外口径，均由调查人员依据职权和专业判断作出。'
      ],
      declaration: REPORT_COVER_DECLARATION
    };
    const sec2 = {
      no: 2, title: '调查背景与范围',
      paragraphs: [
        `调查主题：${p.topic || '（本次未填写调查主题，可按需补充）'}`,
        `调查期间：${p.periodFrom || '（未限定）'} 至 ${p.periodTo || '（未限定）'}`,
        `主体范围：${p.entityType === 'all' || !p.entityType ? '全量主体' : (p.entityName || p.entityCode || '（未指定）')}`,
        `金额区间：${p.minAmount ? '≥ ' + wan(p.minAmount) : '不限'}${p.maxAmount ? ' 且 ≤ ' + wan(p.maxAmount) : ''}`,
        `数据口径：以企业后端数据库 26 张业务表为准，期间内全部业务单据与资金流水。`
      ]
    };
    const sec3 = {
      no: 3, title: '数据来源与分析方法',
      paragraphs: [
        `本次分析实际使用 ${usedTables.length} 张表：${usedTables.map((t) => `${t}（${(TABLE_META[t] || {}).name || t}）`).join('、')}。`,
        `风险信号识别采用三步法（hybrid_three_step）：规则阈值初筛 → 指标/比率分析 → 关联图谱与模型复核，共执行 ${ruleIds.length} 条规则。`,
        `关联交易认定口径：股权 + 人员及近亲属 + 交易实质（equity_person_substance）。`,
        `可疑度评估方法：评分卡打分为主 + 舞弊三角模型做解释框架（scorecard_plus_triangle）。`,
        `证据核对方法：${ev.methods.map((m) => m.name).join('、')}。`
      ],
      rules: ruleIds
    };
    const sec4 = {
      no: 4, title: '风险信号识别结果',
      paragraphs: [
        `共识别风险信号 ${risk.total} 条，其中高度可疑 ${byGrade.high || 0} 条、中度可疑 ${byGrade.medium || 0} 条、低度可疑 ${byGrade.low || 0} 条、信息不足待补充 ${byGrade.unknown || 0} 条。`,
        risk.steps.map((s) => `${s.label}：${s.count} 条`).join('；') + '。',
        '以下信号均为规则化提示，是否成立、是否与舞弊相关，需调查人员判断。'
      ],
      table: {
        columns: ['信号编号', '信号名称', '命中规则', '涉及主体', '时间', '金额', '可疑等级'],
        rows: risk.signals.slice(0, 60).map((s) => [s.id, s.ruleName, s.ruleId, s.subject, s.date || '—', money(s.amount), s.gradeLabel])
      },
      chart: { byGrade }
    };
    const sec5 = {
      no: 5, title: '可疑线索梳理',
      paragraphs: [
        `按涉及主体归集，共形成待核查线索 ${cl.total} 条。每条线索固定包含 6 要素：触发信号、涉及主体、时间与金额、证据所在位置、建议核查动作、可疑等级。`,
        '线索可疑等级为 AI 建议，待人工确认。'
      ],
      clues: cl.clues.slice(0, 25).map((c) => ({
        clueId: c.clueId, subject: c.subject, entityType: c.entityType,
        signals: c.触发信号, timeRange: c.时间范围, amount: c.金额,
        evidence: c.证据位置, actions: c.建议核查动作, grade: c.可疑等级, gradeLabel: c.gradeLabel,
        falsePositive: c.可能误报
      }))
    };
    const sec6 = {
      no: 6, title: '证据核对结果与差异说明',
      paragraphs: ev.methods.map((m) => `${m.name}：${m.conclusion}`),
      table: {
        columns: ['核对方法', '核对数', '差异数', '说明'],
        rows: ev.coverage.map((c) => [c.方法, c.核对数, c.差异数, c.说明])
      }
    };
    const sec7 = {
      no: 7, title: '待核查事项与建议核查动作',
      paragraphs: [
        '以下为建议的核查动作，均为过程性建议，不含任何结论性建议，不代表对相关事项的判断。',
        `参考分值：${sc.totalScore} 分（${sc.gradeLabel}）。${SCORE_DECLARATION}`
      ],
      actions: uniq(risk.signals.map((s) => s.action)).slice(0, 15),
      pending: (ev.pending || []).slice(0, 30)
    };

    const sections = [sec1, sec2, sec3, sec4, sec5, sec6, sec7];
    /* 全文禁用词自检 */
    let fullText = sections.map((s) => JSON.stringify(s)).join('');
    const forbidden = core.detectForbidden(fullText);
    if (forbidden.length) {
      fullText = sanitizeText(fullText);
    }

    return {
      module: 'report_draft',
      title: '舞弊调查分析报告（初稿）',
      reportNo: 'RPT-' + generatedAt.slice(0, 10).replace(/-/g, '') + '-' + String(Math.abs(hashCode(fullText)) % 9000 + 1000),
      generatedAt,
      params: p,
      sections,
      footer: REPORT_COVER_DECLARATION,
      coverDeclaration: REPORT_COVER_DECLARATION,
      cornerBadge: CORNER_BADGE,
      forbiddenCheck: { passed: forbidden.length === 0, hits: forbidden },
      disclaimer: DISCLAIMER_LONG,
      trace: trace(usedTables, { period: [p.periodFrom, p.periodTo] }, ruleIds)
    };
  }

  function hashCode(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; }
    return h;
  }

  /** 报告导出 Markdown */
  function reportToMarkdown(rep) {
    const L = [];
    L.push(`# ${rep.title}`);
    L.push('');
    L.push(`报告编号：${rep.reportNo}　生成时间：${rep.generatedAt}`);
    L.push('');
    L.push('> **【声明】** ' + rep.coverDeclaration.split('\n').join('  \n> '));
    L.push('');
    L.push('---');
    L.push('');
    rep.sections.forEach((s) => {
      L.push(`## ${s.no}. ${s.title}`);
      L.push('');
      (s.paragraphs || []).forEach((x) => { L.push(x); L.push(''); });
      if (s.declaration) {
        L.push('```');
        L.push(s.declaration);
        L.push('```');
        L.push('');
      }
      if (s.rules) { L.push('命中规则：' + s.rules.join('、')); L.push(''); }
      if (s.table) {
        L.push('| ' + s.table.columns.join(' | ') + ' |');
        L.push('|' + s.table.columns.map(() => '---').join('|') + '|');
        s.table.rows.forEach((r) => { L.push('| ' + r.map((c) => String(c).replace(/\|/g, '/')).join(' | ') + ' |'); });
        L.push('');
      }
      if (s.clues) {
        s.clues.forEach((c) => {
          L.push(`### ${c.clueId}　${c.subject}（${c.entityType}）　[${c.gradeLabel}]`);
          L.push('');
          L.push(`- ① 触发信号：${(c.signals || []).join('；')}`);
          L.push(`- ② 涉及主体：${c.subject}`);
          L.push(`- ③ 时间与金额：${c.timeRange}，${money(c.amount)} 元`);
          L.push(`- ④ 证据所在位置：${(c.evidence || []).join('；')}`);
          L.push(`- ⑤ 建议核查动作：${(c.actions || []).join('；')}`);
          L.push(`- ⑥ 可疑等级：${c.gradeLabel}（AI建议，待人工确认）`);
          L.push(`- 可能误报：${(c.falsePositive || []).join('；')}`);
          L.push('');
        });
      }
      if (s.actions) {
        L.push('建议核查动作：');
        L.push('');
        s.actions.forEach((a, i) => L.push(`${i + 1}. ${a}`));
        L.push('');
      }
      if (s.pending && s.pending.length) {
        L.push('| 来源方法 | 涉及主体 | 涉及单据 | 待取证材料 | 可疑等级 |');
        L.push('|---|---|---|---|---|');
        s.pending.forEach((x) => L.push(`| ${x.来源方法} | ${x.涉及主体} | ${x.涉及单据} | ${x.待取证材料} | ${x.可疑等级} |`));
        L.push('');
      }
    });
    L.push('---');
    L.push('');
    L.push('```');
    L.push(rep.footer);
    L.push('```');
    L.push('');
    L.push('> ' + DISCLAIMER_LONG);
    return L.join('\n');
  }

  /** CSV 导出（通用） */
  function toCsv(columns, rows) {
    const esc = (v) => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const head = columns.map(esc).join(',');
    const body = rows.map((r) => columns.map((c) => esc(r[c])).join(',')).join('\n');
    return '\uFEFF' + head + '\n' + body;
  }

  return {
    aggregate, parseIntent, uploadSummary, entityIndex,
    riskSignal, clues, score, evidence, report, qa, reminders,
    reportToMarkdown, toCsv, makeContext, trace, buildSql,
    utils: { num, r2, ymd, ym, inRange, isWeekend, dayDiff, pct, uniq, sumBy, money, wan }
  };
});
