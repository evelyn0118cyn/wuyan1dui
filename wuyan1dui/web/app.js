/**
 * 无言以队 · 主应用（7 个辅助模块 + 测试示例）
 *
 * 模块与 Prompt 文档功能一一对应：
 *   1 data_aggregate 多源数据聚合台
 *   2 risk_signal    舞弊风险信号识别（三步法 + 5 视角 + 关联交易口径）
 *   3 clue_sort      可疑交易线索梳理（主体主线 + 四视图）
 *   4 risk_score     舞弊可能性评估（评分卡 + 舞弊三角）
 *   5 evidence_check 证据分析与资料核对（5 方法）
 *   6 report_draft   舞弊调查分析报告初稿（固定 7 节）
 *   7 qa / reminder  合规问答与待办提醒
 *   8 examples       测试示例
 */
(function (root) {
  'use strict';

  var Wy = root.Wy;
  var U = Wy.U;
  var C = root.WyCore;

  /* ============================================================
   * 全局状态
   * ============================================================ */
  var STATE = {
    view: 'aggregate',
    filters: {},
    results: {},        /* 各模块最近一次结果 */
    uploads: [],        /* 上传的辅助数据（仅会话内） */
    todoDone: {},       /* 待办已办状态（本地记录） */
    chat: []
  };

  /* 默认筛选条件 */
  function defaultFilters() {
    return {
      entityType: 'all', entityCode: '', entityName: '',
      periodFrom: '2026-01-01', periodTo: '2026-12-31',
      minAmount: 0, maxAmount: '',
      chains: ['purchase'], methods: Object.keys(C.EVIDENCE_METHODS),
      viewsOnly: Object.keys(C.FUND_VIEWS),
      keyword: ''
    };
  }
  STATE.filters = defaultFilters();

  /* 从存储恢复常用设置（remember_all） */
  (function restore() {
    var saved = Wy.store.get('filters', null);
    if (saved && typeof saved === 'object') {
      STATE.filters = Object.assign(defaultFilters(), saved);
    }
    STATE.todoDone = Wy.store.get('todoDone', {}) || {};
  })();

  function saveFilters() {
    Wy.store.set('filters', STATE.filters);
  }

  /* ============================================================
   * 实体选项（用于主体下拉）
   * ============================================================ */
  var ENTITY_OPTIONS = {
    supplier: [
      ['S028', '安徽宏远机电设备有限公司'], ['S049', '深圳市前海万通贸易有限公司'],
      ['S050', '上海泰和商务咨询有限公司'], ['S008', '宁波塑料制品有限公司'],
      ['S001', '东莞五金精密制造有限公司'], ['S002', '佛山钢材贸易有限公司'],
      ['S032', '万华化学供应公司'], ['S033', '太钢不锈销售有限公司'],
      ['S035', '正泰电器股份公司'], ['S030', '江苏武进不锈泵阀']
    ],
    customer: [
      ['C001', '深圳智造科技有限公司'], ['C003', '北京中科仪器股份有限公司'],
      ['C007', '无锡先导智能装备股份有限公司'], ['C012', '杭州海康智能科技公司']
    ],
    employee: [
      ['EMP031', '沈立国（采购专员）'], ['EMP030', '罗建国（采购总监）'],
      ['EMP005', '梁秀兰（财务总监）'], ['EMP023', '黄志远（IT经理）'],
      ['EMP040', '李海燕（生产总监）']
    ]
  };

  /* ============================================================
   * 通用 UI 片段
   * ============================================================ */
  function notice(text, type) {
    return '<div class="notice notice-' + (type || 'info') + '">' + text + '</div>';
  }

  function emptyState(title, sub, ico) {
    return '<div class="empty-state"><div class="ico">' + (ico || '📋') + '</div>'
      + '<div class="t1">' + U.esc(title) + '</div>'
      + '<div class="t2">' + (sub || '') + '</div></div>';
  }

  function statCard(label, value, cls, foot) {
    return '<div class="stat-card"><div class="stat-label">' + U.esc(label) + '</div>'
      + '<div class="stat-value ' + (cls || '') + '">' + value + '</div>'
      + (foot ? '<div class="stat-foot">' + foot + '</div>' : '') + '</div>';
  }

  function dataSourceBadge(ds) {
    if (!ds) return '';
    var cls = ds.mode === 'live' ? 'tag-ok' : 'tag-warn';
    var t = '数据源：' + (ds.label || ds.mode);
    return '<span class="tag ' + cls + '" title="' + U.esc((ds.gaps || []).join('; ')) + '">'
      + U.esc(t) + '</span>';
  }

  function gapsNotice(ds) {
    if (!ds || !ds.gaps || !ds.gaps.length) return '';
    return notice('⚠️ <b>数据完整性提示：</b>' + ds.gaps.map(U.esc).join('；'), 'warn');
  }

  /* ============================================================
   * 筛选条件区（各模块共用，按需渲染字段）
   * ============================================================ */
  function renderFilterBar(opts) {
    opts = opts || {};
    var f = STATE.filters;
    var h = '<div class="filter-bar"><div class="filter-bar-title">'
      + '<span>🎛 筛选条件（设定调查范围与规则参数）</span>'
      + '<span class="dim" style="font-weight:400;font-size:11.5px">'
      + (opts.collapsible ? '' : '条件将保存为常用设置') + '</span></div>';
    h += '<div class="filter-grid">';

    /* 主体类型 */
    h += '<div class="field"><label>主体类型</label><select id="f_entityType">'
      + '<option value="all"' + (f.entityType === 'all' ? ' selected' : '') + '>全量主体</option>'
      + '<option value="supplier"' + (f.entityType === 'supplier' ? ' selected' : '') + '>供应商</option>'
      + '<option value="customer"' + (f.entityType === 'customer' ? ' selected' : '') + '>客户</option>'
      + '<option value="employee"' + (f.entityType === 'employee' ? ' selected' : '') + '>员工/经办人</option>'
      + '</select></div>';

    /* 具体主体 */
    h += '<div class="field"><label>具体主体 <span class="hint">（可选）</span></label>'
      + '<select id="f_entityCode"><option value="">— 不限定 —</option></select></div>';

    /* 期间 */
    h += '<div class="field"><label>期间起</label><input type="date" id="f_periodFrom" value="' + U.esc(f.periodFrom) + '"></div>';
    h += '<div class="field"><label>期间止</label><input type="date" id="f_periodTo" value="' + U.esc(f.periodTo) + '"></div>';

    /* 金额区间 */
    h += '<div class="field"><label>金额下限 <span class="hint">（元）</span></label>'
      + '<input type="number" id="f_minAmount" min="0" step="10000" value="' + U.esc(f.minAmount) + '"></div>';
    h += '<div class="field"><label>金额上限 <span class="hint">（元，空=不限）</span></label>'
      + '<input type="number" id="f_maxAmount" min="0" step="10000" value="' + U.esc(f.maxAmount) + '" placeholder="不限"></div>';

    /* 链条选择（聚合台） */
    if (opts.chains) {
      h += '<div class="field field-wide"><label>聚合链条 <span class="hint">（多选）</span></label><div class="checkbox-row">';
      Object.keys(C.CHAINS).forEach(function (k) {
        h += '<label><input type="checkbox" class="f_chain" value="' + k + '"'
          + (f.chains.indexOf(k) >= 0 ? ' checked' : '') + '>' + U.esc(C.CHAINS[k].name) + '</label>';
      });
      h += '</div></div>';
    }

    /* 资金视角（风险识别） */
    if (opts.views) {
      h += '<div class="field field-wide"><label>资金流向异常视角 <span class="hint">（5 项全部启用，可单独筛选）</span></label><div class="checkbox-row">';
      Object.keys(C.FUND_VIEWS).forEach(function (k) {
        h += '<label title="' + U.esc(C.FUND_VIEWS[k].desc) + '"><input type="checkbox" class="f_view" value="' + k + '"'
          + (f.viewsOnly.indexOf(k) >= 0 ? ' checked' : '') + '>' + U.esc(C.FUND_VIEWS[k].name) + '</label>';
      });
      h += '</div></div>';
    }

    /* 核对方法（证据核对） */
    if (opts.methods) {
      h += '<div class="field field-wide"><label>核对方法 <span class="hint">（5 种全部具备，可选择性执行）</span></label><div class="checkbox-row">';
      Object.keys(C.EVIDENCE_METHODS).forEach(function (k) {
        h += '<label title="' + U.esc(C.EVIDENCE_METHODS[k].desc) + '"><input type="checkbox" class="f_method" value="' + k + '"'
          + (f.methods.indexOf(k) >= 0 ? ' checked' : '') + '>' + U.esc(C.EVIDENCE_METHODS[k].name) + '</label>';
      });
      h += '</div></div>';
    }

    h += '</div>';  /* filter-grid */

    /* 操作按钮 */
    h += '<div class="filter-actions">';
    h += '<button class="btn btn-primary" id="f_run">▶ 开始分析</button>';
    h += '<button class="btn" id="f_reset">↺ 恢复默认</button>';
    h += '<span class="spacer"></span>';
    h += '<span class="dim" style="font-size:11.5px">数据窗口：26 张业务表 · 规则库 ' + C.RULES.length + ' 条</span>';
    h += '</div></div>';
    return h;
  }

  /** 绑定筛选条件事件 */
  function bindFilterBar(host, onRun) {
    var f = STATE.filters;
    var typeSel = host.querySelector('#f_entityType');
    var codeSel = host.querySelector('#f_entityCode');

    function fillCodes() {
      var t = typeSel.value;
      codeSel.innerHTML = '<option value="">— 不限定 —</option>';
      if (ENTITY_OPTIONS[t]) {
        ENTITY_OPTIONS[t].forEach(function (pair) {
          var o = document.createElement('option');
          o.value = pair[0];
          o.textContent = pair[1];
          if (f.entityCode === pair[0]) o.selected = true;
          codeSel.appendChild(o);
        });
      }
    }
    fillCodes();

    typeSel.addEventListener('change', function () {
      f.entityType = typeSel.value;
      f.entityCode = '';
      fillCodes();
      saveFilters();
    });
    codeSel.addEventListener('change', function () {
      f.entityCode = codeSel.value;
      var list = ENTITY_OPTIONS[f.entityType] || [];
      var found = null;
      list.forEach(function (p) { if (p[0] === f.entityCode) found = p[1]; });
      f.entityName = found || '';
      saveFilters();
    });

    ['f_periodFrom', 'f_periodTo', 'f_minAmount', 'f_maxAmount'].forEach(function (id) {
      var el = host.querySelector('#' + id);
      if (!el) return;
      el.addEventListener('change', function () {
        f[id.replace('f_', '')] = (id.indexOf('Amount') > 0) ? (el.value === '' ? '' : Number(el.value)) : el.value;
        saveFilters();
      });
    });

    host.querySelectorAll('.f_chain').forEach(function (cb) {
      cb.addEventListener('change', function () {
        f.chains = Array.prototype.slice.call(host.querySelectorAll('.f_chain:checked')).map(function (x) { return x.value; });
        saveFilters();
      });
    });
    host.querySelectorAll('.f_view').forEach(function (cb) {
      cb.addEventListener('change', function () {
        f.viewsOnly = Array.prototype.slice.call(host.querySelectorAll('.f_view:checked')).map(function (x) { return x.value; });
        saveFilters();
      });
    });
    host.querySelectorAll('.f_method').forEach(function (cb) {
      cb.addEventListener('change', function () {
        f.methods = Array.prototype.slice.call(host.querySelectorAll('.f_method:checked')).map(function (x) { return x.value; });
        saveFilters();
      });
    });

    host.querySelector('#f_run').addEventListener('click', onRun);
    host.querySelector('#f_reset').addEventListener('click', function () {
      STATE.filters = defaultFilters();
      saveFilters();
      Wy.toast('已恢复默认筛选条件', 'ok');
      render();
    });
  }

  /** 组装请求参数 */
  function payload() {
    var f = STATE.filters;
    var p = {
      entityType: f.entityType, entityCode: f.entityCode, entityName: f.entityName,
      periodFrom: f.periodFrom, periodTo: f.periodTo,
      minAmount: Number(f.minAmount) || 0,
      maxAmount: (f.maxAmount === '' || f.maxAmount === null) ? null : Number(f.maxAmount)
    };
    return p;
  }

  /* ============================================================
   * 交互辅助：自然语言解析（chat）+ 文件上传（upload）
   * ============================================================ */

  /** 把解析结果回填到筛选条件，并刷新界面 */
  function applyParsedParams(ap) {
    var f = STATE.filters;
    Object.keys(ap || {}).forEach(function (k) {
      if (k === 'chains') f.chains = ap.chains.slice();
      else if (k === 'minAmount' || k === 'maxAmount') f[k] = ap[k];
      else f[k] = ap[k];
    });
    saveFilters();
    render();
  }

  /** 渲染自然语言输入区（数据聚合台顶部） */
  function renderNlBox() {
    var h = '<div class="nl-box">';
    h += '<div class="nl-label">💬 用一句话描述调查主题 <span class="nl-tag">chat · 规则匹配</span></div>';
    h += '<div class="nl-row">';
    h += '<input type="text" class="nl-input" id="nl_input" placeholder="例如：聚合S028供应商2026年全年的采购与付款数据">';
    h += '<button class="btn btn-primary" id="nl_parse">解析并回填</button>';
    h += '<button class="btn" id="nl_parse_run">解析并执行</button>';
    h += '</div>';
    h += '<div class="nl-examples"><span>示例：</span>';
    ['聚合安徽宏远机电设备有限公司2026年全年的采购与付款数据',
      '沈立国2026年的报销数据',
      '2026年第2季度金额50万元以上的银行流水',
      '10万到50万之间的付款记录'].forEach(function (s, i) {
        h += '<span class="nl-chip" data-nl="' + i + '">' + U.esc(s) + '</span>';
      });
    h += '</div></div>';
    return h;
  }

  /** 绑定自然语言输入 */
  function bindNlBox(host, runFn) {
    var input = host.querySelector('#nl_input');
    if (!input) return;
    var chips = Array.prototype.slice.call(host.querySelectorAll('.nl-chip'));
    var SAMPLES = chips.map(function (c) { return c.textContent; });

    function doParse(thenRun) {
      var text = input.value.trim();
      if (!text) { Wy.toast('请先输入调查主题描述', 'warn'); return; }
      Wy.api.call('parseIntent', { text: text }).then(function (r) {
        if (r.matched) {
          applyParsedParams(r.params);
          Wy.toast('已识别调查条件' + (r.note ? '：' + r.note : ''), 'ok');
          if (thenRun) setTimeout(runFn, 60);
        } else {
          Wy.toast(r.note, 'warn');
        }
      }).catch(function (e) {
        Wy.toast('解析失败：' + e.message, 'err');
      });
    }

    host.querySelector('#nl_parse').addEventListener('click', function () { doParse(false); });
    host.querySelector('#nl_parse_run').addEventListener('click', function () { doParse(true); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); doParse(false); }
    });
    chips.forEach(function (c, i) {
      c.addEventListener('click', function () { input.value = SAMPLES[i]; });
    });
  }

  /* ---------- CSV / Excel 读取（浏览器本地，不上传外部） ---------- */
  /** 解析 CSV 文本（支持引号转义与 BOM） */
  function parseCsvText(text) {
    var s = String(text || '').replace(/^\uFEFF/, '');
    var rows = [], row = [], cur = '', q = false;
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (q) {
        if (ch === '"') {
          if (s[i + 1] === '"') { cur += '"'; i++; }
          else q = false;
        } else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cur); cur = ''; }
      else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else if (ch === '\r') { /* 忽略 */ }
      else cur += ch;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    var clean = rows.filter(function (r) { return r.length && !(r.length === 1 && !String(r[0]).trim()); });
    if (!clean.length) return [];
    var head = clean[0].map(function (h) { return String(h).trim(); });
    return clean.slice(1).map(function (r) {
      var o = {};
      head.forEach(function (h, idx) { if (h) o[h] = r[idx] == null ? '' : String(r[idx]).trim(); });
      return o;
    });
  }

  /** 按需加载 SheetJS（CDN）；离线或加载失败时 reject，由调用方降级提示 */
  function loadSheetJS() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (window.__xlsxLoading) return window.__xlsxLoading;
    window.__xlsxLoading = new Promise(function (resolve, reject) {
      var urls = [
        'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
        'https://unpkg.com/xlsx@0.18.5/dist/xlsx.full.min.js'
      ];
      var i = 0;
      function tryNext() {
        if (i >= urls.length) { reject(new Error('Excel 解析库加载失败')); return; }
        var s = document.createElement('script');
        s.src = urls[i++];
        s.onload = function () { window.XLSX ? resolve(window.XLSX) : tryNext(); };
        s.onerror = tryNext;
        document.head.appendChild(s);
      }
      tryNext();
    });
    return window.__xlsxLoading;
  }

  /** 读取文件为行数组（CSV 本地解析；Excel 经 SheetJS 解析，离线时明确降级） */
  function readFileRows(file) {
    var name = file.name || '';
    var isExcel = /\.(xlsx|xls)$/i.test(name);

    function fromText(txt) {
      return { name: name, type: 'csv', rows: parseCsvText(txt) };
    }

    if (isExcel) {
      return loadSheetJS().then(function (XLSX) {
        return new Promise(function (resolve, reject) {
          var fr = new FileReader();
          fr.onload = function () {
            try {
              var wb = XLSX.read(new Uint8Array(fr.result), { type: 'array' });
              var ws = wb.Sheets[wb.SheetNames[0]];
              var rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });
              resolve({ name: name, type: 'excel', rows: rows });
            } catch (e) { reject(new Error(name + ' 解析失败：' + e.message)); }
          };
          fr.onerror = function () { reject(new Error(name + ' 读取失败')); };
          fr.readAsArrayBuffer(file);
        });
      }).catch(function () {
        throw new Error('Excel 解析库（SheetJS CDN）不可用。请将文件另存为 CSV（UTF-8）后重试，或在联网环境打开本页面。');
      });
    }

    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var txt = String(reader.result || '');
        /* UTF-8 读取出现大量替换字符，说明文件是 GBK 编码，改按 GBK 重读 */
        var bad = (txt.match(/\uFFFD/g) || []).length;
        if (bad > 3) {
          var r2 = new FileReader();
          r2.onload = function () {
            try { resolve(fromText(r2.result)); }
            catch (e) { reject(new Error(name + ' 解析失败：' + e.message)); }
          };
          r2.onerror = function () { reject(new Error(name + ' 读取失败')); };
          r2.readAsText(file, 'gbk');
        } else {
          try { resolve(fromText(txt)); }
          catch (e) { reject(new Error(name + ' 解析失败：' + e.message)); }
        }
      };
      reader.onerror = function () { reject(new Error(name + ' 读取失败')); };
      reader.readAsText(file, 'utf-8');
    });
  }

  /** 渲染上传区 */
  function renderUploadBox() {
    var h = '<div class="nl-box">';
    h += '<div class="nl-label">📎 上传辅助数据 <span class="nl-tag">upload · 仅本次会话</span></div>';
    h += '<div class="up-drop" id="up_drop">'
      + '<span class="up-ico">📄</span>'
      + '<div><div class="up-main">拖拽文件到此处，或 <a href="javascript:void(0)" id="up_pick">选择文件</a></div>'
      + '<div class="up-sub">支持 CSV（UTF-8/GBK）与 Excel（.xlsx/.xls）。数据仅在本次会话内使用，不写库、不上传外部。</div></div>'
      + '<input type="file" id="up_file" accept=".csv,.xlsx,.xls,text/csv" multiple style="display:none">'
      + '</div>';
    h += '<div class="up-files" id="up_files"></div>';
    h += '<div id="up_result"></div>';
    h += '</div>';
    return h;
  }

  /** 绑定上传区 */
  function bindUploadBox(host) {
    var drop = host.querySelector('#up_drop');
    if (!drop) return;
    var input = host.querySelector('#up_file');
    var pick = host.querySelector('#up_pick');

    function handle(files) {
      var list = Array.prototype.slice.call(files || []);
      if (!list.length) return;
      Promise.all(list.map(function (f) {
        return readFileRows(f).catch(function (e) { Wy.toast(e.message, 'warn'); return null; });
      })).then(function (outs) {
        var ok = outs.filter(Boolean).filter(function (o) { return o.rows.length; });
        if (!ok.length) { Wy.toast('未解析到有效数据行', 'warn'); return; }
        STATE.uploads = STATE.uploads.concat(ok);
        Wy.store.set('uploadsMeta', STATE.uploads.map(function (f) { return { name: f.name, rows: f.rows.length }; }));
        paintUploadFiles(host);
        Wy.toast('已导入 ' + ok.length + ' 个文件，共 ' + ok.reduce(function (a, f) { return a + f.rows.length; }, 0) + ' 行（仅本次会话）', 'ok');
        /* 输出解析摘要（表 + 溯源），构成本次上传的结构化"输出形式" */
        Wy.api.call('upload', { files: STATE.uploads }).then(function (r) {
          var rid = host.querySelector('#up_result');
          if (!rid) return;
          var h = '<div class="card">' + Wy.aiBadge() + '<div class="card-head">'
            + '<h3 class="card-title"><span class="num">✓</span>上传数据解析摘要</h3>'
            + '<span class="card-sub">共 ' + r.totalRows + ' 行 · 仅本次会话使用 · 不写库</span></div>';
          if (r.notes && r.notes.length) {
            h += notice(r.notes.map(function (n) { return U.esc(n); }).join('<br>'), 'info');
          }
          h += '<div id="up_sum_table"></div>'
            + notice(U.esc(r.usage), 'info')
            + '<div style="margin-top:8px">' + Wy.renderTrace(r.trace, { extra: ['上传数据不参与规则命中判断'] }) + '</div>'
            + '</div>';
          rid.innerHTML = h;
          Wy.bindTrace(rid);
          var t = rid.querySelector('#up_sum_table');
          if (t) {
            t.appendChild(Wy.renderTable({
              columns: [
                { key: 'name', label: '文件' },
                { key: 'type', label: '类型' },
                { key: 'rows', label: '行数', type: 'int', align: 'right' },
                { key: 'subjectCount', label: '涉及主体', type: 'int', align: 'right' },
                { key: 'amountSum', label: '金额合计(元)', type: 'num' },
                { key: 'dateFrom', label: '最早日期', type: 'date' },
                { key: 'dateTo', label: '最晚日期', type: 'date' },
                { key: 'mappedColumns', label: '已识别口径列', render: function (v) {
                  return U.esc((v || []).join('、') || '—');
                } },
                { key: 'unmappedColumns', label: '未识别列', render: function (v) {
                  return (v || []).length ? '<span class="tag tag-warn">' + U.esc(v.join('、')) + '</span>' : '<span class="tag tag-ok">无</span>';
                } }
              ],
              rows: r.files || [], pageSize: 0
            }));
          }
        }).catch(function (e) { Wy.toast('解析摘要生成失败：' + e.message, 'err'); });
      });
    }

    pick.addEventListener('click', function () { input.click(); });
    input.addEventListener('change', function () { handle(input.files); input.value = ''; });
    drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', function () { drop.classList.remove('over'); });
    drop.addEventListener('drop', function (e) {
      e.preventDefault(); drop.classList.remove('over');
      handle(e.dataTransfer.files);
    });
    paintUploadFiles(host);
  }

  /** 渲染已导入文件列表 + 解析摘要（调用 upload-summary） */
  function paintUploadFiles(host) {
    var box = host.querySelector('#up_files');
    if (!box) return;
    if (!STATE.uploads.length) {
      box.innerHTML = '';
      var rid = host.querySelector('#up_result');
      if (rid) rid.innerHTML = '';
      return;
    }
    box.innerHTML = STATE.uploads.map(function (f, i) {
      return '<div class="up-file"><span><span class="up-name">' + U.esc(f.name) + '</span>'
        + ' <span class="up-meta">' + f.rows.length + ' 行 · ' + U.esc(f.type || 'csv') + '</span></span>'
        + '<button class="up-del" data-i="' + i + '">移除</button></div>';
    }).join('');
    Array.prototype.slice.call(box.querySelectorAll('.up-del')).forEach(function (b) {
      b.addEventListener('click', function () {
        STATE.uploads.splice(Number(b.getAttribute('data-i')), 1);
        Wy.store.set('uploadsMeta', STATE.uploads.map(function (f) { return { name: f.name, rows: f.rows.length }; }));
        var rid = host.querySelector('#up_result');
        if (rid) rid.innerHTML = '';
        paintUploadFiles(host);
      });
    });
  }

  /* ============================================================
   * 模块 1：多源数据聚合台
   * ============================================================ */
  var M1 = {
    title: '数据聚合台',
    desc: '【助理辅助：取数与汇总】【人工决策：认定哪些数据纳入调查范围】按调查主题从 26 张业务表中拉取并关联数据，输出统一口径的聚合数据集与汇总统计。',
    render: function () {
      var h = renderNlBox();
      h += renderFilterBar({ chains: true });
      h += renderUploadBox();
      h += '<div id="m1_result">' + (STATE.results.aggregate ? '' : emptyState(
        '尚未执行数据聚合',
        '设定调查范围后点击「▶ 开始分析」，系统将按采购/销售/费用/资金链条跨表关联，<br>输出统一口径的聚合明细与数据完整度校验。',
        '🗂')) + '</div>';
      return h;
    },
    bind: function (host) {
      bindNlBox(host, function () { M1.run(); });
      bindFilterBar(host, function () { M1.run(); });
      bindUploadBox(host);
      if (STATE.results.aggregate) M1.paint(STATE.results.aggregate);
    },
    run: function () {
      var f = STATE.filters;
      var p = payload();
      p.chains = f.chains.length ? f.chains : ['purchase'];
      runAndPaint('m1_result', 'aggregate', p, M1.paint, '数据聚合');
    },
    paint: function (r) {
      var host = document.getElementById('m1_result');
      if (!host) return;
      var s = r.stats || {};
      var h = gapsNotice(r.dataSource);
      h += '<div class="card">' + Wy.aiBadge() + '<div class="card-head">'
        + '<h3 class="card-title"><span class="num">1</span>汇总统计</h3>'
        + '<span class="card-sub">' + dataSourceBadge(r.dataSource)
        + ' · 聚合链条：' + U.esc((r.chains || []).join('、') || '—') + '</span></div>';
      h += '<div class="stat-grid">';
      h += statCard('记录数（笔）', U.esc(String(s['笔数'] || 0)), '', '聚合明细行');
      h += statCard('金额合计', U.esc(U.moneyShort(s['金额合计'] || 0)), '', '元');
      h += statCard('涉及主体数', U.esc(String(s['涉及主体数'] || 0)), '', '去重后');
      h += statCard('纳入分析的表', U.esc(String(s['纳入分析的表'] || 0)) + ' / 26', '', '关联表');
      h += statCard('时间跨度', '<span style="font-size:13px">' + U.esc((s['时间跨度'] || {}).from || '—')
        + '<br>~ ' + U.esc((s['时间跨度'] || {}).to || '—') + '</span>', 'sm', '业务日期');
      h += '</div></div>';

      /* 数据完整度校验 */
      h += '<div class="card"><div class="card-head"><h3 class="card-title"><span class="num">✓</span>数据完整度校验</h3>'
        + '<span class="card-sub">借贷平衡 · 孤立记录 · 关联完整性</span></div>';
      var integrity = r.integrity || [];
      var bad = integrity.filter(function (x) { return x['结果'] !== '通过'; });
      h += bad.length
        ? notice('发现 <b>' + bad.length + '</b> 项完整性提示，相关数据在作为调查依据前需先核实口径。', 'warn')
        : notice('全部完整性校验通过。', 'ok');
      h += '<div id="m1_integrity"></div></div>';

      /* 聚合明细 */
      h += '<div class="card">' + Wy.aiBadge() + '<div class="card-head">'
        + '<h3 class="card-title"><span class="num">2</span>聚合明细表</h3>'
        + '<span class="card-sub">统一口径 · 支持列排序 · 按链条完整度标示</span></div>'
        + '<div id="m1_table"></div></div>';

      h += '<div class="card"><div class="card-head"><h3 class="card-title">🔎 溯源</h3></div>'
        + Wy.renderTrace(r.trace, { extra: ['聚合为只读 SELECT，单次上限 5000 行'] }) + '</div>';

      host.innerHTML = h;
      Wy.bindTrace(host);

      /* 完整性表 */
      var ih = document.getElementById('m1_integrity');
      if (ih) {
        ih.appendChild(Wy.renderTable({
          columns: [
            { key: '校验项', label: '校验项' },
            { key: '结果', label: '结果', render: function (v) {
              return v === '通过' ? '<span class="tag tag-ok">通过</span>' : '<span class="tag tag-warn">' + U.esc(v) + '</span>';
            } },
            { key: '说明', label: '说明' },
            { key: '涉及表', label: '涉及表', mono: true }
          ],
          rows: integrity, pageSize: 0, sortKey: null
        }));
      }

      /* 明细表 */
      var th = document.getElementById('m1_table');
      if (th) {
        th.appendChild(Wy.renderTable({
          columns: [
            { key: 'chain', label: '链条' },
            { key: '主体', label: '涉及主体' },
            { key: '单据号', label: '单据号', mono: true },
            { key: '业务日期', label: '业务日期', type: 'date' },
            { key: '金额', label: '金额(元)', type: 'num' },
            { key: '物料', label: '物料/费用类型' },
            { key: '入库单号', label: '入库/发货单', mono: true },
            { key: '发票号', label: '发票号', mono: true },
            { key: '付款笔数', label: '付款笔数', type: 'int', align: 'right' },
            { key: '付款金额', label: '付款金额(元)', type: 'num' },
            { key: '链条完整', label: '链条完整度', render: function (v) {
              var cls = v === '完整' ? 'tag-ok' : (v === '未付款' ? 'tag' : 'tag-danger');
              return '<span class="tag ' + cls + '">' + U.esc(v || '—') + '</span>';
            } }
          ],
          rows: r.rows || [], pageSize: 50,
          emptyText: '当前筛选条件下无聚合记录，请调整期间或主体范围'
        }));
      }
    }
  };

  /* ============================================================
   * 模块 2：舞弊风险信号识别
   * ============================================================ */
  var M2 = {
    title: '风险信号识别',
    desc: '【助理辅助：识别与提示】【人工决策：异常是否成立、是否与舞弊相关】采用三步法识别异常交易、资金流向异常与疑似关联交易，输出"信号 + 命中理由"。',
    render: function () {
      var h = renderFilterBar({ views: true });
      h += '<div id="m2_result">' + (STATE.results.risk ? '' : emptyState(
        '尚未执行风险信号识别',
        '三步法：①规则阈值初筛 → ②指标/比率分析 → ③关联图谱与模型复核。<br>点击「▶ 开始分析」运行全部规则（' + C.RULES.length + ' 条）。',
        '🚨')) + '</div>';
      return h;
    },
    bind: function (host) {
      bindFilterBar(host, function () { M2.run(); });
      if (STATE.results.risk) M2.paint(STATE.results.risk);
    },
    run: function () {
      var p = payload();
      p.viewsOnly = STATE.filters.viewsOnly;
      runAndPaint('m2_result', 'risk', p, M2.paint, '风险信号识别');
    },
    paint: function (r) {
      var host = document.getElementById('m2_result');
      if (!host) return;
      var sum = r.summary || {};
      var byGrade = sum.byGrade || {};
      var h = gapsNotice(r.dataSource);

      /* 数据质量提示 */
      if (r.dataQuality && r.dataQuality.systemic && r.dataQuality.systemic.length) {
        h += notice('📊 <b>数据质量提示：</b>' + U.esc(r.dataQuality.summary)
          + '<div style="margin-top:6px">已转为数据质量提示的规则：'
          + (r.suppressedRules || []).map(function (x) {
              return '<span class="tag tag-warn">' + U.esc(x.id) + ' ' + U.esc(x.name) + '</span>';
            }).join(' ') + '</div>'
          + '<div class="dim" style="margin-top:5px;font-size:11.5px">说明：命中的是"数据本身的口径或维护问题"，逐条输出会淹没真实线索，因此单独列为数据质量事项，建议先核对两系统口径。</div>',
          'warn');
      }

      /* 统计 */
      h += '<div class="card">' + Wy.aiBadge() + '<div class="card-head">'
        + '<h3 class="card-title"><span class="num">1</span>信号总览</h3>'
        + '<span class="card-sub">' + dataSourceBadge(r.dataSource) + ' · 方法：' + U.esc(r.methodLabel || '') + '</span></div>';
      h += '<div class="stat-grid">';
      h += statCard('风险信号总数', U.esc(String(r.total || 0)), '', '全部命中');
      h += statCard('高度可疑', U.esc(String(byGrade.high || 0)), 'high', '建议优先核查');
      h += statCard('中度可疑', U.esc(String(byGrade.medium || 0)), 'medium', '纳入核查计划');
      h += statCard('低度可疑', U.esc(String(byGrade.low || 0)), 'low', '常规抽查');
      h += statCard('信息不足', U.esc(String(byGrade.unknown || 0)), 'unknown', '待补充');
      h += '</div></div>';

      /* 三步法步骤条 */
      h += '<div class="card"><div class="card-head"><h3 class="card-title"><span class="num">2</span>三步法执行情况</h3>'
        + '<span class="card-sub">必须按序执行并分别标注</span></div><div class="steps">';
      (r.steps || []).forEach(function (s, i) {
        h += '<div class="step done"><span class="step-count">' + s.count + '</span>'
          + '<div class="step-label">' + (i + 1) + '. ' + U.esc(s.label) + '</div>'
          + '<div class="step-desc">' + U.esc(s.desc) + '</div></div>';
      });
      h += '</div></div>';

      /* 图表：等级分布 + 视角分布 */
      h += '<div class="card">' + Wy.aiBadge() + '<div class="card-head"><h3 class="card-title"><span class="num">3</span>分布图表</h3>'
        + '<span class="card-sub">按可疑等级与信号类型</span></div><div class="chart-grid">';

      h += '<div class="chart-box"><div class="chart-title">可疑等级分布</div>'
        + Wy.Chart.donut([
          { label: '高度可疑', value: byGrade.high || 0, color: '#D93025' },
          { label: '中度可疑', value: byGrade.medium || 0, color: '#F29900' },
          { label: '低度可疑', value: byGrade.low || 0, color: '#1E8E3E' },
          { label: '信息不足', value: byGrade.unknown || 0, color: '#5F6368' }
        ]) + '</div>';

      h += '<div class="chart-box"><div class="chart-title">资金流向异常 5 视角命中数</div>'
        + Wy.Chart.bar((r.fundViews || []).map(function (v) {
          return { label: v.name, value: v.count, color: '#2F80ED' };
        })) + '</div>';

      /* 规则命中 TOP10 */
      var byRule = sum.byRule || {};
      var ruleItems = Object.keys(byRule).map(function (id) {
        var rule = C.RULE_MAP[id] || {};
        return { label: id + ' ' + (rule.name || ''), value: byRule[id], color: '#7C4DFF' };
      }).sort(function (a, b) { return b.value - a.value; }).slice(0, 10);
      h += '<div class="chart-box"><div class="chart-title">命中规则 TOP 10</div>'
        + Wy.Chart.bar(ruleItems) + '</div>';

      /* 主体分布 TOP10 */
      var bySub = sum.bySubject || {};
      var subItems = Object.keys(bySub).map(function (s) {
        return { label: s, value: bySub[s], color: '#1E5AA8' };
      }).sort(function (a, b) { return b.value - a.value; }).slice(0, 10);
      h += '<div class="chart-box"><div class="chart-title">涉及主体 TOP 10</div>'
        + Wy.Chart.bar(subItems) + '</div>';
      h += '</div></div>';

      /* 关联交易口径 */
      h += '<div class="card"><div class="card-head"><h3 class="card-title"><span class="num">4</span>关联交易识别口径</h3>'
        + '<span class="card-sub">equity_person_substance（股权 + 人员及近亲属 + 交易实质）</span></div>'
        + '<div class="stat-grid">';
      (r.relatedPartyBasis || []).forEach(function (b) {
        h += statCard(b.name, U.esc(String(b.count || 0)), b.count ? 'medium' : '', U.esc(b.desc));
      });
      h += '</div>';

      var g = r.graph || {};
      if ((g.roundTrips || []).length) {
        h += '<h4 style="font-size:13px;margin:14px 0 6px;color:#123A6B">🔁 资金回流路径</h4>';
        var rt = document.createElement('div');
        h += '<div id="m2_rt"></div>';
      }
      if ((g.sharedInfo || []).length) {
        h += '<h4 style="font-size:13px;margin:14px 0 6px;color:#123A6B">🔗 共用联系方式/地址</h4><div id="m2_shared"></div>';
      }
      if ((g.personLinks || []).length) {
        h += '<h4 style="font-size:13px;margin:14px 0 6px;color:#123A6B">👤 内部人员与交易对手重名</h4><div id="m2_person"></div>';
      }
      h += '</div>';

      /* 指标比率 */
      if ((r.metrics || []).length) {
        h += '<div class="card">' + Wy.aiBadge() + '<div class="card-head"><h3 class="card-title"><span class="num">5</span>指标/比率分析（第二步）</h3>'
          + '<span class="card-sub">输出偏离度，异常项已生成信号</span></div><div id="m2_metrics"></div></div>';
      }

      /* 信号清单 */
      h += '<div class="card">' + Wy.aiBadge() + '<div class="card-head"><h3 class="card-title"><span class="num">6</span>风险信号清单</h3>'
        + '<span class="card-sub">' + (r.total || 0) + ' 条 · 点击列头排序</span></div>'
        + '<div id="m2_table"></div></div>';

      h += '<div class="card"><div class="card-head"><h3 class="card-title">🔎 溯源</h3>'
        + '<span class="card-sub">数据来源表 · 查询条件 · 命中规则编号</span></div>'
        + Wy.renderTrace(r.trace) + '</div>';

      host.innerHTML = h;
      Wy.bindTrace(host);

      /* 资金回流表 */
      var rtHost = document.getElementById('m2_rt');
      if (rtHost && g.roundTrips) {
        rtHost.appendChild(Wy.renderTable({
          columns: [
            { key: 'from', label: '付款对手方' },
            { key: 'via', label: '回流方', render: function (v, row) {
              return U.esc(v) + (v !== row.from ? ' <span class="tag tag-danger">关联自然人</span>' : '');
            } },
            { key: 'outDate', label: '付款日期', type: 'date' },
            { key: 'outAmt', label: '付款金额', type: 'num' },
            { key: 'inDate', label: '回款日期', type: 'date' },
            { key: 'inAmt', label: '回款金额', type: 'num' },
            { key: 'gap', label: '间隔(天)', type: 'int', align: 'right' }
          ], rows: g.roundTrips, pageSize: 10
        }));
      }
      var shHost = document.getElementById('m2_shared');
      if (shHost && g.sharedInfo) {
        shHost.appendChild(Wy.renderTable({
          columns: [
            { key: 'kind', label: '共用类型' },
            { key: 'value', label: '共用值', mono: true },
            { key: 'parties', label: '涉及主体', render: function (v) {
              return (v || []).map(function (x) { return '<span class="tag">' + U.esc(x) + '</span>'; }).join(' ');
            } }
          ], rows: g.sharedInfo, pageSize: 10
        }));
      }
      var pHost = document.getElementById('m2_person');
      if (pHost && g.personLinks) {
        pHost.appendChild(Wy.renderTable({
          columns: [
            { key: 'party', label: '交易对手' },
            { key: 'partyType', label: '类型', render: function (v) { return v === 'supplier' ? '供应商' : '客户'; } },
            { key: 'emp', label: '本司员工' },
            { key: 'empCode', label: '工号', mono: true },
            { key: 'position', label: '岗位' },
            { key: 'sensitive', label: '敏感岗位', render: function (v) {
              return v ? '<span class="tag tag-danger">是</span>' : '<span class="tag">否</span>';
            } }
          ], rows: g.personLinks, pageSize: 10
        }));
      }

      /* 指标表 */
      var mHost = document.getElementById('m2_metrics');
      if (mHost && r.metrics) {
        mHost.appendChild(Wy.renderTable({
          columns: [
            { key: 'id', label: '编号', mono: true },
            { key: 'name', label: '指标' },
            { key: 'value', label: '实测值', render: function (v, row) { return U.esc(v) + ' ' + U.esc(row.unit || ''); } },
            { key: 'avg', label: '参考值', render: function (v, row) { return U.esc(v) + ' ' + U.esc(row.unit || ''); } },
            { key: 'deviation', label: '偏离度(σ)', type: 'num', dp: 2 },
            { key: 'abnormal', label: '是否异常', render: function (v) {
              return v ? '<span class="tag tag-danger">异常</span>' : '<span class="tag tag-ok">正常</span>';
            } },
            { key: 'detail', label: '说明', render: function (v) {
              return (v && v.length) ? U.esc(v.join('；')) : '—';
            } }
          ], rows: r.metrics, pageSize: 0
        }));
      }

      /* 信号清单 */
      var tHost = document.getElementById('m2_table');
      if (tHost) {
        tHost.appendChild(Wy.renderTable({
          columns: [
            { key: 'id', label: '信号编号', mono: true },
            { key: 'ruleId', label: '规则', mono: true },
            { key: 'ruleName', label: '信号名称' },
            { key: 'stepLabel', label: '步骤', render: function (v) { return '<span class="tag">' + U.esc(v) + '</span>'; } },
            { key: 'subject', label: '涉及主体' },
            { key: 'date', label: '时间', type: 'date' },
            { key: 'amount', label: '金额(元)', type: 'num' },
            { key: 'reason', label: '命中依据', render: function (v) { return '<span style="font-size:12px">' + U.esc(v) + '</span>'; } },
            { key: 'falsePositive', label: '可能误报', render: function (v) {
              return '<span class="dim" style="font-size:11.5px">' + U.esc(v) + '</span>';
            } },
            { key: 'grade', label: '初判可疑等级', type: 'grade' }
          ],
          rows: r.signals || [], pageSize: 30, gradeField: 'grade'
        }));
      }
    }
  };

  /* ============================================================
   * 模块 3：可疑交易线索梳理
   * ============================================================ */
  var M3 = {
    title: '线索梳理',
    desc: '【助理辅助：组织与排序】【人工决策：线索取舍、核查顺序、是否深挖】以涉及主体为主线归集疑点，每条线索固定包含 6 要素，并提供资金/单据/关联方/时间四视图。',
    render: function () {
      var h = renderFilterBar({});
      h += '<div id="m3_result">' + (STATE.results.clue ? '' : emptyState(
        '尚未梳理线索',
        '点击「▶ 开始分析」，将以"涉及主体"为主线，把散点疑点组织成可执行、可追溯、可核查的线索清单。',
        '🧩')) + '</div>';
      return h;
    },
    bind: function (host) {
      bindFilterBar(host, function () { M3.run(); });
      if (STATE.results.clue) M3.paint(STATE.results.clue);
    },
    run: function () { runAndPaint('m3_result', 'clue', payload(), M3.paint, '线索梳理'); },
    paint: function (r) {
      var host = document.getElementById('m3_result');
      if (!host) return;
      var clues = r.clues || [];
      var h = gapsNotice(r.dataSource);

      h += '<div class="card">' + Wy.aiBadge() + '<div class="card-head">'
        + '<h3 class="card-title"><span class="num">1</span>线索总览</h3>'
        + '<span class="card-sub">' + dataSourceBadge(r.dataSource) + ' · ' + U.esc(r.methodLabel || '') + '</span></div>';
      var cnt = { high: 0, medium: 0, low: 0, unknown: 0 };
      clues.forEach(function (c) { cnt[c['可疑等级']] = (cnt[c['可疑等级']] || 0) + 1; });
      h += '<div class="stat-grid">';
      h += statCard('线索总数', U.esc(String(clues.length)), '', '按主体归集');
      h += statCard('高度可疑', U.esc(String(cnt.high)), 'high', '建议优先核查');
      h += statCard('中度可疑', U.esc(String(cnt.medium)), 'medium', '纳入核查计划');
      h += statCard('低度可疑', U.esc(String(cnt.low)), 'low', '常规抽查');
      h += '</div>';
      h += notice('每条线索固定包含 <b>6 要素</b>：' + (r.sixElements || []).map(U.esc).join(' · '), 'info');
      h += '</div>';

      /* 线索热度图 */
      if ((r.heat || []).length) {
        h += '<div class="card">' + Wy.aiBadge() + '<div class="card-head"><h3 class="card-title"><span class="num">2</span>线索热度图</h3>'
          + '<span class="card-sub">按主体命中信号数排序</span></div><div class="chart-box">'
          + Wy.Chart.bar((r.heat || []).map(function (x) {
            var color = x.grade === 'high' ? '#D93025' : x.grade === 'medium' ? '#F29900' : '#1E8E3E';
            return { label: x.subject, value: x.count, color: color };
          })) + '</div></div>';
      }

      /* 待核查线索清单表 */
      h += '<div class="card">' + Wy.aiBadge() + '<div class="card-head">'
        + '<h3 class="card-title"><span class="num">3</span>待核查线索清单</h3>'
        + '<div class="page-actions"><button class="btn btn-sm" id="m3_csv">⬇ 导出 CSV</button></div></div>'
        + '<div id="m3_table"></div></div>';

      /* 主体线索卡片 */
      h += '<div class="card">' + Wy.aiBadge() + '<div class="card-head">'
        + '<h3 class="card-title"><span class="num">4</span>主体线索卡片</h3>'
        + '<span class="card-sub">点击卡片展开四视图（资金 / 单据 / 关联方 / 时间）</span></div>'
        + '<div class="clue-list" id="m3_clues"></div></div>';

      h += '<div class="card"><div class="card-head"><h3 class="card-title">🔎 溯源</h3></div>'
        + Wy.renderTrace(r.trace) + '</div>';

      host.innerHTML = h;
      Wy.bindTrace(host);

      /* 线索表 */
      var tHost = document.getElementById('m3_table');
      if (tHost) {
        tHost.appendChild(Wy.renderTable({
          columns: [
            { key: 'clueId', label: '线索编号', mono: true },
            { key: 'subject', label: '涉及主体' },
            { key: 'entityType', label: '类型' },
            { key: '触发信号', label: '触发信号', type: 'array', render: function (v) {
              return (v || []).slice(0, 3).map(function (x) { return '<span class="tag">' + U.esc(x) + '</span>'; }).join(' ')
                + ((v || []).length > 3 ? ' <span class="dim">+' + (v.length - 3) + '</span>' : '');
            } },
            { key: '时间范围', label: '时间与金额', render: function (v, row) {
              return U.esc(v) + '<br><b>' + U.money(row['金额']) + '</b> 元';
            } },
            { key: '证据位置', label: '证据所在位置', render: function (v) {
              return '<span class="mono" style="font-size:11px">' + (v || []).slice(0, 3).map(U.esc).join('<br>') + '</span>';
            } },
            { key: '建议核查动作', label: '建议核查动作', render: function (v) {
              return '<span style="font-size:12px">' + (v || []).slice(0, 2).map(U.esc).join('<br>') + '</span>';
            } },
            { key: '可疑等级', label: '可疑等级', type: 'grade' }
          ],
          rows: clues, pageSize: 30, gradeField: '可疑等级'
        }));
      }

      /* 卡片列表 */
      var cHost = document.getElementById('m3_clues');
      if (cHost) {
        var ch = '';
        clues.slice(0, 40).forEach(function (c, idx) {
          ch += '<div class="clue ' + c['可疑等级'] + '" data-clue="' + idx + '">';
          ch += '<div class="clue-head"><div class="clue-title">'
            + '<span class="clue-id">' + U.esc(c.clueId) + '</span>'
            + '<span class="clue-name">' + U.esc(c.subject) + '</span>'
            + '<span class="tag">' + U.esc(c.entityType) + '</span>'
            + '</div><div class="clue-meta">'
            + '<span>' + c.signalCount + ' 条信号</span>'
            + '<span>' + U.moneyShort(c['金额']) + ' 元</span>'
            + U.gradeBadge(c['可疑等级']) + '</div></div>';
          ch += '<div class="clue-body">';
          ch += '<div class="six-grid">';
          ch += sixItem('① 触发信号', (c['触发信号'] || []).map(function (x) { return '<li>' + U.esc(x) + '</li>'; }).join(''), true);
          ch += sixItem('② 涉及主体', U.esc(c.subject) + '<br><span class="dim">类型：' + U.esc(c.entityType) + '</span>');
          ch += sixItem('③ 时间与金额', (c['时间范围'] || '—') + '<br><b>' + U.money(c['金额']) + '</b> 元');
          ch += sixItem('④ 证据所在位置', (c['证据位置'] || []).map(function (x) { return '<li class="mono" style="font-size:11.5px">' + U.esc(x) + '</li>'; }).join(''), true);
          ch += sixItem('⑤ 建议核查动作', (c['建议核查动作'] || []).map(function (x) { return '<li>' + U.esc(x) + '</li>'; }).join(''), true);
          ch += sixItem('⑥ 可疑等级', U.gradeBadge(c['可疑等级']) + '<div class="dim" style="font-size:11px;margin-top:3px">' + U.esc(c['可疑等级说明'] || 'AI建议，待人工确认') + '</div>');
          ch += '</div>';

          /* 四视图 */
          var v = c.views || {};
          ch += '<div class="view-tabs" data-clueviews="' + idx + '">'
            + '<button class="view-tab active" data-vt="0">资金视图</button>'
            + '<button class="view-tab" data-vt="1">单据视图</button>'
            + '<button class="view-tab" data-vt="2">关联方视图</button>'
            + '<button class="view-tab" data-vt="3">时间视图</button></div>';
          ch += '<div data-vp="' + idx + '">' + renderClueView(c, 0) + '</div>';

          if ((c['可能误报'] || []).length) {
            ch += '<div class="mt10"><span class="dim" style="font-size:11.5px">可能误报原因：'
              + (c['可能误报'] || []).map(U.esc).join('；') + '</span></div>';
          }
          ch += '</div></div>';
        });
        cHost.innerHTML = ch || emptyState('暂无线索', '请先执行风险信号识别');

        /* 卡片展开 */
        cHost.querySelectorAll('.clue-head').forEach(function (head) {
          head.addEventListener('click', function () {
            head.parentNode.classList.toggle('open');
          });
        });
        /* 视图切换 */
        cHost.querySelectorAll('.view-tab').forEach(function (btn) {
          btn.addEventListener('click', function (e) {
            e.stopPropagation();
            var tabs = btn.parentNode;
            var idx = tabs.getAttribute('data-clueviews');
            var vt = Number(btn.getAttribute('data-vt'));
            tabs.querySelectorAll('.view-tab').forEach(function (b) { b.classList.remove('active'); });
            btn.classList.add('active');
            var vp = cHost.querySelector('[data-vp="' + idx + '"]');
            if (vp) vp.innerHTML = renderClueView(clues[Number(idx)], vt);
          });
        });
      }

      /* 导出 CSV */
      var csv = document.getElementById('m3_csv');
      if (csv) {
        csv.addEventListener('click', function () {
          var cols = ['clueId', 'subject', 'entityType', '触发信号', '时间范围', '金额', '证据位置', '建议核查动作', '可疑等级', '可疑等级说明'];
          var rows = clues.map(function (c) {
            var o = {};
            cols.forEach(function (k) {
              o[k] = Array.isArray(c[k]) ? c[k].join('；') : (c[k] === undefined ? '' : c[k]);
            });
            o['可疑等级'] = U.gradeLabel(c['可疑等级']);
            return o;
          });
          var csvText = root.WyEngine.toCsv(cols, rows);
          if (U.download('待核查线索清单_' + U.todayStr() + '.csv', csvText, 'text/csv;charset=utf-8')) {
            Wy.toast('已导出 CSV（' + rows.length + ' 条线索）', 'ok');
          } else {
            Wy.toast('当前环境不允许下载，请改用复制', 'err');
          }
        });
      }
    }
  };

  function sixItem(label, valueHtml, isList) {
    return '<div class="six-item"><div class="six-label">' + U.esc(label) + '</div>'
      + '<div class="six-value">' + (isList ? '<ul>' + valueHtml + '</ul>' : valueHtml) + '</div></div>';
  }

  function renderClueView(c, idx) {
    var v = (c.views || {});
    if (idx === 0) {
      var fv = v['资金视图'] || {};
      var h = '<dl class="kv-list">';
      Object.keys(fv).forEach(function (k) {
        var val = fv[k];
        if (k.indexOf('金额') >= 0 || k.indexOf('笔数') >= 0) val = U.money(val, 0);
        h += '<dt>' + U.esc(k) + '</dt><dd>' + U.esc(val) + '</dd>';
      });
      return h + '</dl>';
    }
    if (idx === 1) {
      var dv = v['单据视图'] || {};
      var h2 = '<dl class="kv-list">';
      Object.keys(dv).forEach(function (k) {
        h2 += '<dt>' + U.esc(k) + '</dt><dd>' + U.esc(dv[k]) + '</dd>';
      });
      return h2 + '</dl>';
    }
    if (idx === 2) {
      var rv = v['关联方视图'] || {};
      var h3 = '<dl class="kv-list">';
      Object.keys(rv).forEach(function (k) {
        h3 += '<dt>' + U.esc(k) + '</dt><dd>' + U.esc(rv[k]) + '</dd>';
      });
      return h3 + '</dl>';
    }
    var tl = v['时间视图'] || [];
    if (!tl.length) return '<div class="dim" style="font-size:12px">本期无带时间戳的信号节点。</div>';
    var h4 = '<div class="timeline">';
    tl.forEach(function (n) {
      var g = n['等级'] === '高度可疑' ? 'high' : n['等级'] === '中度可疑' ? 'medium' : 'low';
      h4 += '<div class="timeline-item ' + g + '">'
        + '<span class="timeline-date">' + U.esc(n['时间']) + '</span>'
        + U.esc(n['节点']) + '　<b>' + U.money(n['金额']) + '</b> 元'
        + ' <span class="tag mono">' + U.esc(n['信号编号']) + '</span>'
        + '</div>';
    });
    return h4 + '</div>';
  }

  /* ============================================================
   * 模块 4：可疑度评估
   * ============================================================ */
  var M4 = {
    title: '可疑度评估',
    desc: '【助理辅助：计分与解释】【人工决策：最终可疑等级与是否构成舞弊】评分卡打分为主 + 舞弊三角模型做解释框架，输出参考分值与分级建议。',
    render: function () {
      var h = renderFilterBar({});
      h += '<div id="m4_result">' + (STATE.results.score ? '' : emptyState(
        '尚未计算参考分值',
        '按评分卡（压力 30 / 机会 45 / 借口 25）计分，附舞弊三角维度解释。<br>分值仅供排序参考，最终可疑等级由调查人员确定。',
        '📊')) + '</div>';
      return h;
    },
    bind: function (host) {
      bindFilterBar(host, function () { M4.run(); });
      if (STATE.results.score) M4.paint(STATE.results.score);
    },
    run: function () { runAndPaint('m4_result', 'score', payload(), M4.paint, '可疑度评估'); },
    paint: function (r) {
      var host = document.getElementById('m4_result');
      if (!host) return;
      var score = Number(r.totalScore || 0);
      var color = r.grade === 'high' ? '#D93025' : r.grade === 'medium' ? '#F29900' : r.grade === 'low' ? '#1E8E3E' : '#5F6368';
      var circ = 2 * Math.PI * 42;
      var dash = (Math.min(score, 100) / 100) * circ;

      var h = gapsNotice(r.dataSource);

      /* 分数英雄区 */
      h += '<div class="card">' + Wy.aiBadge() + '<div class="card-head">'
        + '<h3 class="card-title"><span class="num">1</span>参考分值</h3>'
        + '<span class="card-sub">' + dataSourceBadge(r.dataSource) + ' · ' + U.esc(r.methodLabel || '') + '</span></div>';
      h += '<div class="score-hero">';
      h += '<div class="score-ring"><svg viewBox="0 0 100 100" width="112" height="112">'
        + '<circle cx="50" cy="50" r="42" fill="none" stroke="#EDF1F7" stroke-width="9"></circle>'
        + '<circle cx="50" cy="50" r="42" fill="none" stroke="' + color + '" stroke-width="9" stroke-linecap="round"'
        + ' stroke-dasharray="' + dash.toFixed(1) + ' ' + circ.toFixed(1) + '"></circle></svg>'
        + '<div class="score-ring-text"><div class="score-num" style="color:' + color + '">' + score + '</div>'
        + '<div class="score-max">/ 100 分</div></div></div>';
      h += '<div class="score-info">';
      h += '<div class="score-band" style="background:' + (r.grade === 'high' ? '#FDECEA' : r.grade === 'medium' ? '#FEF3E0' : r.grade === 'low' ? '#E9F6EE' : '#F1F3F6')
        + ';color:' + color + '">' + U.esc(r.gradeLabel || '') + '</div>';
      h += '<div class="score-advice">' + U.esc(r.advice || '') + '</div>';
      h += '<div class="score-decl">⚠️ ' + U.esc(r.declaration || C.SCORE_DECLARATION) + '</div>';
      h += '</div></div></div>';

      /* 舞弊三角维度 */
      h += '<div class="card"><div class="card-head"><h3 class="card-title"><span class="num">2</span>舞弊三角维度得分</h3>'
        + '<span class="card-sub">压力 / 机会 / 借口（合理化）</span></div>';
      (r.triangle || []).forEach(function (t) {
        var dim = (r.dimensions || {})[t.key] || {};
        var pctVal = dim.weight ? (t.score / dim.weight) * 100 : 0;
        var cls = pctVal >= 70 ? 'high' : pctVal >= 40 ? 'medium' : 'low';
        h += '<div class="dim-bar"><div class="dim-bar-head">'
          + '<span class="dim-bar-name">' + U.esc(t.name) + '（权重 ' + t.weight + ' 分）</span>'
          + '<span class="dim-bar-val">' + t.score + ' / ' + t.weight + '</span></div>'
          + '<div class="dim-bar-track"><div class="dim-bar-fill ' + cls + '" style="width:' + Math.min(pctVal, 100) + '%"></div></div>'
          + '<div class="dim-desc">' + U.esc(t.desc) + '</div>';
        if ((t.explain || []).length) {
          h += '<div class="dim-desc" style="color:#1F2937;margin-top:4px">命中依据：'
            + t.explain.map(U.esc).join('；') + '</div>';
        }
        h += '</div>';
      });
      if (r.grade === 'unknown') {
        h += notice('当前数据不足以支持判断，建议补充核查后再评估。', 'warn');
      }
      h += '</div>';

      /* 评分卡明细 */
      h += '<div class="card">' + Wy.aiBadge() + '<div class="card-head"><h3 class="card-title"><span class="num">3</span>评分卡明细</h3>'
        + '<span class="card-sub">每个维度下的具体指标、权重与命中情况</span></div><div id="m4_table"></div></div>';

      /* 命中的信号 */
      h += '<div class="card"><div class="card-head"><h3 class="card-title"><span class="num">4</span>计分依据：命中的信号</h3>'
        + '<span class="card-sub">' + (r.hitSummary || []).length + ' 条</span></div><div id="m4_signals"></div></div>';

      h += '<div class="card"><div class="card-head"><h3 class="card-title">🔎 溯源</h3></div>'
        + Wy.renderTrace(r.trace) + '</div>';

      host.innerHTML = h;
      Wy.bindTrace(host);

      /* 明细表 */
      var tHost = document.getElementById('m4_table');
      if (tHost) {
        var rows = [];
        Object.keys(r.dimensions || {}).forEach(function (k) {
          var d = r.dimensions[k];
          (d.items || []).forEach(function (it) {
            rows.push({
              dim: d.name, id: it.id, name: it.name, weight: it.weight,
              hit: it.hit ? '是' : '否', score: it.score,
              ruleRefs: (it.hitRules || []).join('、') || (it.ruleRefs || []).join('、'),
              basis: it.basis, note: it.note || ''
            });
          });
        });
        tHost.appendChild(Wy.renderTable({
          columns: [
            { key: 'dim', label: '维度' },
            { key: 'id', label: '指标', mono: true },
            { key: 'name', label: '指标名称' },
            { key: 'weight', label: '权重', type: 'int', align: 'right' },
            { key: 'hit', label: '是否命中', render: function (v) {
              return v === '是' ? '<span class="tag tag-danger">命中</span>' : '<span class="tag">未命中</span>';
            } },
            { key: 'score', label: '得分', type: 'num' },
            { key: 'ruleRefs', label: '关联规则', mono: true },
            { key: 'basis', label: '计分依据' },
            { key: 'note', label: '说明' }
          ], rows: rows, pageSize: 0
        }));
      }

      var sHost = document.getElementById('m4_signals');
      if (sHost) {
        sHost.appendChild(Wy.renderTable({
          columns: [
            { key: 'id', label: '信号编号', mono: true },
            { key: 'rule', label: '规则', mono: true },
            { key: 'name', label: '信号名称' },
            { key: 'subject', label: '涉及主体' },
            { key: 'gradeLabel', label: '等级' }
          ], rows: r.hitSummary || [], pageSize: 15
        }));
      }
    }
  };

  /* ============================================================
   * 模块 5：证据核对
   * ============================================================ */
  var M5 = {
    title: '证据核对',
    desc: '【助理辅助：核对与差异定位】【人工决策：差异性质判断、是否需外部取证】执行五种机械性勾稽核对，输出差异明细、核对覆盖率与待取证清单。',
    render: function () {
      var h = renderFilterBar({ methods: true });
      h += '<div id="m5_result">' + (STATE.results.evidence ? '' : emptyState(
        '尚未执行证据核对',
        '五种方法：三单匹配 · 凭证抽凭 · 跨系统比对 · 银企对账 · 外部函证。<br>选择方法后点击「▶ 开始分析」。',
        '🔍')) + '</div>';
      return h;
    },
    bind: function (host) {
      bindFilterBar(host, function () { M5.run(); });
      if (STATE.results.evidence) M5.paint(STATE.results.evidence);
    },
    run: function () {
      var p = payload();
      p.methods = STATE.filters.methods.length ? STATE.filters.methods : Object.keys(C.EVIDENCE_METHODS);
      runAndPaint('m5_result', 'evidence', p, M5.paint, '证据核对');
    },
    paint: function (r) {
      var host = document.getElementById('m5_result');
      if (!host) return;
      var methods = r.methods || [];
      var h = gapsNotice(r.dataSource);

      /* 覆盖率 */
      h += '<div class="card">' + Wy.aiBadge() + '<div class="card-head">'
        + '<h3 class="card-title"><span class="num">1</span>核对覆盖率统计</h3>'
        + '<span class="card-sub">' + dataSourceBadge(r.dataSource) + '</span></div>';
      h += '<div id="m5_cov"></div></div>';

      /* 各方法详情 */
      h += '<div class="card"><div class="card-head"><h3 class="card-title"><span class="num">2</span>核对结果详情</h3>'
        + '<span class="card-sub">按方法分标签页查看差异明细</span></div>';
      h += '<div class="tabs" id="m5_tabs">';
      methods.forEach(function (m, i) {
        h += '<button class="tab' + (i === 0 ? ' active' : '') + '" data-mt="' + i + '">'
          + U.esc(m.name) + '<span class="count">' + (m.rows || []).length + '</span></button>';
      });
      h += '</div>';
      methods.forEach(function (m, i) {
        h += '<div class="tab-panel' + (i === 0 ? ' active' : '') + '" data-mp="' + i + '">';
        h += notice(U.esc(m.conclusion || ''), m.coverage.hit > 0 ? 'warn' : 'ok');
        if (m.notice) h += notice(U.esc(m.notice), 'info');
        h += '<div class="dim" style="font-size:12px;margin-bottom:8px">' + U.esc(m.desc || '') + '</div>';
        h += '<div id="m5_tbl_' + i + '"></div></div>';
      });
      h += '</div>';

      /* 待取证清单 */
      h += '<div class="card">' + Wy.aiBadge() + '<div class="card-head"><h3 class="card-title"><span class="num">3</span>待取证清单</h3>'
        + '<div class="page-actions"><button class="btn btn-sm" id="m5_csv">⬇ 导出 CSV</button></div></div>'
        + '<div id="m5_pending"></div></div>';

      h += '<div class="card"><div class="card-head"><h3 class="card-title">🔎 溯源</h3></div>'
        + Wy.renderTrace(r.trace) + '</div>';

      host.innerHTML = h;
      Wy.bindTrace(host);

      /* 覆盖率表 */
      var covHost = document.getElementById('m5_cov');
      if (covHost) {
        covHost.appendChild(Wy.renderTable({
          columns: [
            { key: '方法', label: '核对方法' },
            { key: '核对数', label: '核对数', type: 'int', align: 'right' },
            { key: '差异数', label: '差异数', type: 'int', align: 'right' },
            { key: '说明', label: '结论' }
          ], rows: r.coverage || [], pageSize: 0
        }));
      }

      /* 各方法明细表 */
      methods.forEach(function (m, i) {
        var th = document.getElementById('m5_tbl_' + i);
        if (!th) return;
        if (!(m.rows || []).length) {
          th.innerHTML = '<div class="table-empty">本次核对未发现差异</div>';
          return;
        }
        var cols = (m.columns || Object.keys(m.rows[0])).map(function (c) {
          var isNum = /金额|差异|差额|余额/.test(c) && c.indexOf('差异类型') < 0;
          return { key: c, label: c, type: isNum ? 'num' : undefined, mono: /单据|流水号|凭证号|账号|发票/.test(c) };
        });
        th.appendChild(Wy.renderTable({
          columns: cols, rows: m.rows, pageSize: 25,
          gradeField: '等级', sortKey: null
        }));
      });

      /* 标签页切换 */
      var tabsEl = document.getElementById('m5_tabs');
      if (tabsEl) {
        tabsEl.querySelectorAll('.tab').forEach(function (t) {
          t.addEventListener('click', function () {
            var i = t.getAttribute('data-mt');
            tabsEl.querySelectorAll('.tab').forEach(function (x) { x.classList.remove('active'); });
            t.classList.add('active');
            host.querySelectorAll('[data-mp]').forEach(function (p) {
              p.classList.toggle('active', p.getAttribute('data-mp') === i);
            });
          });
        });
      }

      /* 待取证 */
      var pHost = document.getElementById('m5_pending');
      if (pHost) {
        pHost.appendChild(Wy.renderTable({
          columns: [
            { key: '来源方法', label: '来源方法' },
            { key: '涉及主体', label: '涉及主体' },
            { key: '涉及单据', label: '涉及单据', mono: true },
            { key: '待取证材料', label: '待取证材料' },
            { key: '可疑等级', label: '等级', type: 'grade' },
            { key: '说明', label: '说明' }
          ], rows: r.pending || [], pageSize: 25, gradeField: '可疑等级'
        }));
      }

      var csv = document.getElementById('m5_csv');
      if (csv) {
        csv.addEventListener('click', function () {
          var cols = r.pendingColumns || ['来源方法', '涉及主体', '涉及单据', '待取证材料', '可疑等级', '说明'];
          var txt = root.WyEngine.toCsv(cols, r.pending || []);
          if (U.download('待取证清单_' + U.todayStr() + '.csv', txt, 'text/csv;charset=utf-8')) {
            Wy.toast('已导出待取证清单', 'ok');
          } else Wy.toast('当前环境不允许下载', 'err');
        });
      }
    }
  };

  /* ============================================================
   * 模块 6：报告初稿
   * ============================================================ */
  var M6 = {
    title: '报告初稿',
    desc: '【助理辅助：起草与排版】【人工决策：结论、定性、表述定稿】生成固定 7 节结构的舞弊调查分析报告初稿，含固定免责标注与人工复核签字位。',
    render: function () {
      var f = STATE.filters;
      var h = '<div class="filter-bar"><div class="filter-bar-title"><span>📄 报告要素</span></div>';
      h += '<div class="filter-grid">';
      h += '<div class="field field-wide"><label>调查主题 <span class="hint">（将写入第 2 节）</span></label>'
        + '<input type="text" id="r_topic" placeholder="例如：2026年度采购付款环节异常交易专项核查" value="'
        + U.esc(Wy.store.get('reportTopic', '2026年度采购付款与费用报销环节舞弊风险信号分析')) + '"></div>';
      h += '<div class="field"><label>期间起</label><input type="date" id="r_from" value="' + U.esc(f.periodFrom) + '"></div>';
      h += '<div class="field"><label>期间止</label><input type="date" id="r_to" value="' + U.esc(f.periodTo) + '"></div>';
      h += '<div class="field"><label>生成口径</label><select id="r_scope">'
        + '<option value="all">全量主体</option>'
        + '<option value="supplier">仅供应商相关</option>'
        + '</select></div>';
      h += '</div>';
      h += '<div class="filter-actions"><button class="btn btn-primary" id="r_run">📝 生成报告初稿</button>'
        + '<span class="dim" style="font-size:11.5px;margin-left:8px">报告将汇总风险信号、线索、评分与证据核对结果</span></div>';
      h += '</div>';
      h += '<div id="m6_result">' + (STATE.results.report ? '' : emptyState(
        '尚未生成报告',
        '报告结构固定 7 节：①免责声明 ②调查背景与范围 ③数据来源与分析方法 ④风险信号识别结果<br>⑤可疑线索梳理 ⑥证据核对结果 ⑦待核查事项与建议核查动作。',
        '📄')) + '</div>';
      return h;
    },
    bind: function (host) {
      var run = host.querySelector('#r_run');
      if (run) {
        run.addEventListener('click', function () {
          var topic = host.querySelector('#r_topic').value.trim();
          Wy.store.set('reportTopic', topic);
          var scope = host.querySelector('#r_scope').value;
          var p = payload();
          p.periodFrom = host.querySelector('#r_from').value;
          p.periodTo = host.querySelector('#r_to').value;
          p.topic = topic;
          if (scope === 'supplier') { p.entityType = 'supplier'; }
          runAndPaint('m6_result', 'report', p, M6.paint, '报告初稿');
        });
      }
      if (STATE.results.report) M6.paint(STATE.results.report);
    },
    paint: function (r) {
      var host = document.getElementById('m6_result');
      if (!host) return;
      var h = gapsNotice(r.dataSource);
      h += '<div class="card">' + Wy.aiBadge() + '<div class="card-head">'
        + '<h3 class="card-title"><span class="num">1</span>报告预览</h3>'
        + '<div class="page-actions">'
        + '<button class="btn btn-sm" id="r_html">⬇ 导出 HTML</button>'
        + '<button class="btn btn-sm" id="r_md">⬇ 导出 Markdown</button>'
        + '<button class="btn btn-sm" id="r_print">🖨 打印 / 另存 PDF</button>'
        + '</div></div>';
      h += '<div class="dim" style="font-size:12px;margin-bottom:8px">'
        + '报告编号 <b class="mono">' + U.esc(r.reportNo || '') + '</b> · 生成时间 ' + U.esc(U.datetime(r.generatedAt))
        + ' · ' + dataSourceBadge(r.dataSource) + '</div>';
      h += '<div class="report-preview" id="reportBody">' + renderReportHtml(r) + '</div></div>';

      /* 导出说明 */
      h += '<div class="card"><div class="card-head"><h3 class="card-title"><span class="num">2</span>导出说明</h3></div>'
        + notice('本报告为 <b>AI 辅助生成的初稿</b>。所有结论、定性表述与对外口径均由调查人员作出。'
          + '系统<b>不提供</b>"直接发送/报送/移交"类功能，如需对外使用请由调查人员完成复核签字后自行处理。', 'info')
        + '<div class="dim" style="font-size:12px">禁用定性词自检：'
        + (r.forbiddenCheck && r.forbiddenCheck.passed
          ? '<span class="tag tag-ok">通过</span>'
          : '<span class="tag tag-danger">检出 ' + ((r.forbiddenCheck || {}).hits || []).length + ' 处</span>')
        + '</div></div>';

      h += '<div class="card"><div class="card-head"><h3 class="card-title">🔎 溯源</h3></div>'
        + Wy.renderTrace(r.trace) + '</div>';

      host.innerHTML = h;
      Wy.bindTrace(host);

      /* 导出 HTML */
      var bh = document.getElementById('r_html');
      if (bh) {
        bh.addEventListener('click', function () {
          var body = document.getElementById('reportBody').innerHTML;
          var full = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">'
            + '<title>' + U.esc(r.title) + ' · ' + U.esc(r.reportNo) + '</title>'
            + '<style>' + reportExportCss() + '</style></head><body>'
            + '<div class="rp">' + body + '</div></body></html>';
          if (U.download((r.reportNo || '报告初稿') + '.html', full, 'text/html;charset=utf-8')) {
            Wy.toast('已导出 HTML 报告', 'ok');
          } else Wy.toast('当前环境不允许下载', 'err');
        });
      }
      /* 导出 Markdown */
      var bm = document.getElementById('r_md');
      if (bm) {
        bm.addEventListener('click', function () {
          var md = r.markdown || root.WyEngine.reportToMarkdown(r);
          if (U.download((r.reportNo || '报告初稿') + '.md', md, 'text/markdown;charset=utf-8')) {
            Wy.toast('已导出 Markdown 报告', 'ok');
          } else Wy.toast('当前环境不允许下载', 'err');
        });
      }
      var bp = document.getElementById('r_print');
      if (bp) {
        bp.addEventListener('click', function () {
          try { window.print(); } catch (e) { Wy.toast('打印不可用', 'err'); }
        });
      }
    }
  };

  function renderReportHtml(r) {
    var h = '';
    /* 封面声明 */
    h += '<h1>' + U.esc(r.title || '舞弊调查分析报告') + '</h1>';
    h += '<div class="report-no">报告编号：' + U.esc(r.reportNo || '') + '　生成时间：' + U.esc(U.datetime(r.generatedAt)) + '</div>';
    h += '<div class="report-decl-box">' + U.esc(r.coverDeclaration || C.REPORT_COVER_DECLARATION) + '</div>';

    (r.sections || []).forEach(function (s) {
      h += '<h2>' + s.no + '. ' + U.esc(s.title) + '</h2>';
      (s.paragraphs || []).forEach(function (p) {
        h += '<p>' + U.esc(p) + '</p>';
      });
      if (s.declaration) {
        h += '<div class="report-decl-box" style="background:#F7F9FC;border-color:#E3E8EF;border-left-color:#1E5AA8;color:#1F2937">'
          + U.esc(s.declaration) + '</div>';
      }
      if (s.rules && s.rules.length) {
        h += '<p><b>命中规则：</b>' + s.rules.map(function (x) {
          return '<span class="tag tag-warn mono" style="margin-right:4px">' + U.esc(x) + '</span>';
        }).join('') + '</p>';
      }
      if (s.table) {
        h += '<table><thead><tr>' + s.table.columns.map(function (c) {
          return '<th>' + U.esc(c) + '</th>';
        }).join('') + '</tr></thead><tbody>';
        (s.table.rows || []).forEach(function (row) {
          h += '<tr>' + row.map(function (c) { return '<td>' + U.esc(c) + '</td>'; }).join('') + '</tr>';
        });
        h += '</tbody></table>';
      }
      if (s.clues && s.clues.length) {
        s.clues.forEach(function (c) {
          h += '<div class="report-clue"><div class="report-clue-head">'
            + U.esc(c.clueId) + '　' + U.esc(c.subject) + '（' + U.esc(c.entityType) + '）' + U.gradeBadge(c.grade)
            + '</div><dl>';
          h += '<dt>① 触发信号</dt><dd>' + U.esc((c.signals || []).join('；')) + '</dd>';
          h += '<dt>② 涉及主体</dt><dd>' + U.esc(c.subject) + '</dd>';
          h += '<dt>③ 时间与金额</dt><dd>' + U.esc(c.timeRange) + '，' + U.money(c.amount) + ' 元</dd>';
          h += '<dt>④ 证据所在位置</dt><dd>' + U.esc((c.evidence || []).join('；')) + '</dd>';
          h += '<dt>⑤ 建议核查动作</dt><dd>' + U.esc((c.actions || []).join('；')) + '</dd>';
          h += '<dt>⑥ 可疑等级</dt><dd>' + U.gradeLabel(c.grade) + '（AI建议，待人工确认）</dd>';
          if ((c.falsePositive || []).length) {
            h += '<dt>可能误报</dt><dd>' + U.esc((c.falsePositive || []).join('；')) + '</dd>';
          }
          h += '</dl></div>';
        });
      }
      if (s.actions && s.actions.length) {
        h += '<ol>';
        s.actions.forEach(function (a) { h += '<li>' + U.esc(a) + '</li>'; });
        h += '</ol>';
      }
      if (s.pending && s.pending.length) {
        h += '<table><thead><tr><th>来源方法</th><th>涉及主体</th><th>涉及单据</th><th>待取证材料</th><th>可疑等级</th></tr></thead><tbody>';
        s.pending.forEach(function (x) {
          h += '<tr><td>' + U.esc(x['来源方法']) + '</td><td>' + U.esc(x['涉及主体']) + '</td><td>'
            + U.esc(x['涉及单据']) + '</td><td>' + U.esc(x['待取证材料']) + '</td><td>'
            + U.esc(U.gradeLabel(x['可疑等级'])) + '</td></tr>';
        });
        h += '</tbody></table>';
      }
    });

    /* 页脚声明 */
    h += '<div class="report-footer-box">' + U.esc(r.footer || C.REPORT_COVER_DECLARATION) + '</div>';
    h += '<p style="font-size:11px;color:#8A93A3;margin-top:8px">' + U.esc(C.DISCLAIMER_LONG) + '</p>';
    return h;
  }

  function reportExportCss() {
    return 'body{font-family:"Microsoft YaHei","PingFang SC",Arial,sans-serif;font-size:13px;line-height:1.85;color:#1F2937;margin:0;padding:36px 46px;max-width:900px;margin:0 auto}'
      + 'h1{font-size:20px;text-align:center;color:#123A6B;letter-spacing:1px;margin:0 0 4px}'
      + '.report-no{text-align:center;font-size:12px;color:#5F6368;margin-bottom:16px}'
      + '.report-decl-box{border:1px solid #F0C9C5;border-left:4px solid #D93025;background:#FEF7F6;padding:10px 14px;margin:0 0 18px;font-size:12px;line-height:1.9;color:#8A2A22;white-space:pre-wrap}'
      + 'h2{margin:22px 0 9px;padding-bottom:5px;border-bottom:1px solid #E3E8EF;font-size:15px;color:#123A6B}'
      + 'table{width:100%;border-collapse:collapse;font-size:12px;margin:8px 0 12px}'
      + 'th,td{border:1px solid #E3E8EF;padding:5px 8px;text-align:left;vertical-align:top}'
      + 'th{background:#EDF1F7;font-weight:700;color:#123A6B}'
      + '.report-clue{border:1px solid #E3E8EF;border-left:3px solid #2F80ED;padding:9px 12px;margin-bottom:9px;background:#FAFBFD}'
      + '.report-clue-head{font-weight:700;color:#123A6B;margin-bottom:5px}'
      + '.report-clue dl{display:grid;grid-template-columns:max-content 1fr;gap:2px 10px;margin:0;font-size:12px}'
      + '.report-clue dt{color:#5F6368}.report-clue dd{margin:0}'
      + '.report-footer-box{margin-top:24px;padding-top:14px;border-top:2px solid #E3E8EF;font-size:12px;line-height:2;white-space:pre-wrap}'
      + '.grade{padding:1px 8px;border-radius:3px;font-size:12px;font-weight:600}'
      + '.grade-high{color:#D93025;background:#FDECEA}.grade-medium{color:#B26A00;background:#FEF3E0}'
      + '.grade-low{color:#1E8E3E;background:#E9F6EE}.grade-unknown{color:#5F6368;background:#F1F3F6}'
      + '.tag{display:inline-block;padding:1px 7px;border:1px solid #E3E8EF;border-radius:3px;background:#F7F9FC;color:#5F6368;font-size:11.5px}'
      + '@media print{body{padding:0}}';
  }

  /* ============================================================
   * 模块 7：问答与提醒
   * ============================================================ */
  var M7 = {
    title: '问答与提醒',
    desc: '【助理辅助：解释与提醒】【人工决策：全部合规与处置判断】回答分析方法、数据口径、规则阈值与报告章节说明；提醒未完成核查项与数据缺口。超出范围的问题一律拒答并引导至专业判断。',
    render: function () {
      var h = '';
      /* 对话区 */
      h += '<div class="card"><div class="card-head"><h3 class="card-title"><span class="num">1</span>合规问答</h3>'
        + '<span class="card-sub">关键词/规则匹配 + 口径字典（非开放式对话）</span></div>';
      h += notice('📌 <b>问答范围（仅限）</b>：本助理使用的分析方法说明 · 数据表与字段口径说明 · 规则阈值含义 · 报告章节说明 · 下一步建议核查动作。'
        + '涉及是否构成舞弊、是否立案、责任认定等判断，超出范围将拒答并说明需由调查人员或合规部门专业判断。', 'info');
      h += '<div class="chat-box"><div class="chat-log" id="q_log"></div>'
        + '<div class="chat-input">'
        + '<textarea id="q_input" placeholder="例如：可疑度评分卡的分级阈值是怎么定的？（Enter 发送，Shift+Enter 换行）"></textarea>'
        + '<button class="mic-btn" id="q_mic" title="语音输入（浏览器不支持时自动降级为文本输入）">🎤</button>'
        + '<button class="btn btn-primary" id="q_send">提问</button>'
        + '</div></div>';
      h += '<div class="suggest-chips" id="q_suggest"></div>';
      h += '<div id="q_refs"></div></div>';

      /* 待办提醒 */
      h += '<div class="card">' + Wy.aiBadge() + '<div class="card-head">'
        + '<h3 class="card-title"><span class="num">2</span>待办提醒</h3>'
        + '<div class="page-actions"><button class="btn btn-sm" id="q_refresh">↻ 刷新提醒</button></div></div>'
        + '<div id="m7_reminder"></div></div>';

      return h;
    },
    bind: function (host) {
      var input = host.querySelector('#q_input');
      var send = host.querySelector('#q_send');
      var mic = host.querySelector('#q_mic');

      function doAsk(q) {
        q = (q || '').trim();
        if (!q) return;
        addChat('user', q);
        if (input) input.value = '';
        Wy.api.call('qa', { question: q }).then(function (r) {
          STATE.chat.push({ role: 'ai', text: r.answer, refs: r });
          addChat('ai', r.answer, r);
          renderQaRefs(r);
        }).catch(function (e) {
          addChat('ai', '提问失败：' + e.message);
        });
      }

      send.addEventListener('click', function () { doAsk(input.value); });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doAsk(input.value); }
      });

      /* 语音输入：Web Speech API，不可用时优雅降级 */
      var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) {
        mic.disabled = true;
        mic.title = '当前浏览器不支持语音输入，已降级为文本输入';
        mic.style.opacity = '.45';
      } else {
        var rec = null, recording = false;
        mic.addEventListener('click', function () {
          if (recording) { try { rec.stop(); } catch (e) {} return; }
          try {
            rec = new SR();
            rec.lang = 'zh-CN';
            rec.interimResults = false;
            rec.maxAlternatives = 1;
            rec.onstart = function () { recording = true; mic.classList.add('recording'); mic.title = '正在录音，点击停止'; };
            rec.onend = function () { recording = false; mic.classList.remove('recording'); mic.title = '语音输入'; };
            rec.onerror = function (ev) {
              recording = false; mic.classList.remove('recording');
              Wy.toast('语音识别不可用（' + (ev.error || '未知') + '），请改用文本输入', 'warn');
            };
            rec.onresult = function (ev) {
              var txt = ev.results[0][0].transcript;
              if (input) { input.value = txt; input.focus(); }
              Wy.toast('已识别：' + txt, 'ok');
            };
            rec.start();
          } catch (e) {
            mic.disabled = true;
            Wy.toast('语音输入启动失败，已降级为文本输入', 'warn');
          }
        });
      }

      /* 建议问题 */
      var sg = host.querySelector('#q_suggest');
      sg.innerHTML = '<span class="dim" style="font-size:11.5px;line-height:2">推荐问题：</span>'
        + C.QA_TOPICS.filter(function (t) { return t.scope === '在范围内'; }).map(function (t) {
          return '<button class="suggest-chip" data-q="' + U.esc(t.title) + '">' + U.esc(t.title) + '</button>';
        }).join('');
      sg.querySelectorAll('.suggest-chip').forEach(function (b) {
        b.addEventListener('click', function () {
          var q = b.getAttribute('data-q');
          if (input) input.value = q;
          doAsk(q);
        });
      });

      /* 刷新提醒 */
      var rf = host.querySelector('#q_refresh');
      if (rf) rf.addEventListener('click', function () { M7.loadReminder(); });

      /* 恢复历史对话 */
      STATE.chat.forEach(function (m) {
        addChat(m.role, m.text, m.refs);
      });
      if (!STATE.chat.length) {
        addChat('ai', '您好，我是「无言以队」。我可以解答以下范围内的说明性问题：分析方法、数据口径、规则阈值、报告章节、建议核查动作。'
          + '涉及定性判断的问题我会拒答并说明需由调查人员专业判断。');
      }

      M7.loadReminder();
    },
    loadReminder: function () {
      var host = document.getElementById('m7_reminder');
      if (!host) return;
      host.innerHTML = '<div class="dim">正在生成提醒…</div>';
      Wy.api.call('reminder', payload()).then(function (r) {
        STATE.results.reminder = r;
        paintReminder(r, host);
      }).catch(function (e) {
        host.innerHTML = notice('提醒生成失败：' + U.esc(e.message), 'danger');
      });
    }
  };

  function addChat(role, text, refs) {
    var log = document.getElementById('q_log');
    if (!log) return;
    var el = document.createElement('div');
    el.className = 'msg ' + role;
    var meta = '';
    if (role === 'ai' && refs) {
      var bits = [];
      if (refs.refs && refs.refs.rules && refs.refs.rules.length) bits.push('规则：' + refs.refs.rules.join('、'));
      if (refs.refs && refs.refs.tables && refs.refs.tables.length) bits.push('来源表 ' + refs.refs.tables.length + ' 张');
      if (refs.scope) bits.push('范围：' + refs.scope);
      if (bits.length) meta = '<div class="meta">' + U.esc(bits.join(' · ')) + '</div>';
    }
    el.innerHTML = '<div class="msg-avatar">' + (role === 'ai' ? 'AI' : '我') + '</div>'
      + '<div class="msg-bubble">' + U.esc(text).replace(/\n/g, '<br>') + meta + '</div>';
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
  }

  function renderQaRefs(r) {
    var host = document.getElementById('q_refs');
    if (!host) return;
    if (!r.matched) { host.innerHTML = ''; return; }
    var h = '<div class="mt14">';
    h += '<div class="card"><div class="card-head"><h3 class="card-title">📎 回答依据</h3>'
      + '<span class="card-sub">口径字典 · 规则定义 · 来源表</span></div>';
    if ((r.ruleDetail || []).length) {
      h += '<div style="font-size:12px;font-weight:700;color:#5F6368;margin-bottom:6px">涉及规则</div><div id="q_rules"></div>';
    }
    if ((r.tableDetail || []).length) {
      h += '<div style="font-size:12px;font-weight:700;color:#5F6368;margin:10px 0 6px">涉及数据表</div><div id="q_tables"></div>';
    }
    h += Wy.renderTrace(r.trace) + '</div></div>';
    host.innerHTML = h;
    Wy.bindTrace(host);
    if ((r.ruleDetail || []).length) {
      document.getElementById('q_rules').appendChild(Wy.renderTable({
        columns: [
          { key: 'id', label: '编号', mono: true },
          { key: 'name', label: '规则名称' },
          { key: 'step', label: '步骤', render: function (v) {
            return v === 'rule' ? '规则初筛' : v === 'metric' ? '指标分析' : '图谱复核';
          } },
          { key: 'falsePositive', label: '可能误报' }
        ], rows: r.ruleDetail, pageSize: 0
      }));
    }
    if ((r.tableDetail || []).length) {
      document.getElementById('q_tables').appendChild(Wy.renderTable({
        columns: [
          { key: 'name', label: '表名', mono: true },
          { key: 'label', label: '中文名' },
          { key: 'system', label: '所属系统' },
          { key: 'fields', label: '字段数', type: 'int', align: 'right' }
        ], rows: r.tableDetail, pageSize: 0
      }));
    }
  }

  function paintReminder(r, host) {
    var items = r.items || [];
    var groups = {};
    items.forEach(function (x) {
      (groups[x.type] = groups[x.type] || []).push(x);
    });
    var h = notice('ℹ️ ' + U.esc(r.notice || '标记已办仅记录本地状态，不触发任何对外发送、报送或移交动作。'), 'info');
    h += '<div class="stat-grid">';
    h += statCard('待办总数', U.esc(String(r.counts.total)), '', '全部类型');
    h += statCard('高优先级', U.esc(String(r.counts.high)), 'high', '优先处理');
    h += statCard('中优先级', U.esc(String(r.counts.medium)), 'medium', '计划处理');
    Object.keys(r.counts.byType || {}).forEach(function (k) {
      h += statCard(k, U.esc(String(r.counts.byType[k])), '', '待办');
    });
    h += '</div>';

    Object.keys(groups).forEach(function (type) {
      h += '<div class="todo-group"><div class="todo-group-head"><span>' + U.esc(type) + '</span>'
        + '<span class="dim" style="font-size:12px;font-weight:400">' + groups[type].length + ' 项</span></div>';
      groups[type].forEach(function (x) {
        var done = !!STATE.todoDone[x.id];
        h += '<div class="todo ' + x.level + (done ? ' done' : '') + '">'
          + '<div class="todo-main">'
          + '<div class="todo-text">' + U.esc(x.content) + '</div>'
          + '<div class="todo-sub"><span>主体：' + U.esc(x.subject) + '</span>'
          + '<span>动作：' + U.esc(x.action) + '</span>'
          + '<span class="mono">' + U.esc(x.id) + '</span></div></div>'
          + '<button class="btn btn-sm" data-todo="' + U.esc(x.id) + '">' + (done ? '✓ 已办' : '标记已办') + '</button>'
          + '</div>';
      });
      h += '</div>';
    });

    host.innerHTML = h;
    host.querySelectorAll('[data-todo]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-todo');
        STATE.todoDone[id] = !STATE.todoDone[id];
        Wy.store.set('todoDone', STATE.todoDone);
        if (STATE.results.reminder) paintReminder(STATE.results.reminder, host);
        Wy.toast(STATE.todoDone[id] ? '已标记为已办（仅本地记录）' : '已取消已办', 'ok');
      });
    });
  }

  /* ============================================================
   * 模块 8：测试示例
   * ============================================================ */
  var M8 = {
    title: '测试示例',
    desc: '预置 8 个演示场景，一键载入筛选条件并运行对应模块。演示数据内联于页面（PRELOAD_DEMO），与真实表结构字段一致，覆盖 1 个可疑供应商、1 个可疑员工、拆分付款与资金回流、三单不匹配、银企未达账项样例。',
    render: function () {
      var h = notice('🧪 <b>测试示例说明：</b>点击「▶ 载入并运行」将自动切换到对应模块并执行。演示数据集固定种子生成，结果可复现；'
        + '也可在顶部切换到「连接数据库」模式对真实数据运行相同规则。', 'info');
      h += '<div class="card"><div class="card-head"><h3 class="card-title"><span class="num">1</span>示例场景</h3>'
        + '<span class="card-sub">' + C.DEMO_EXAMPLES.length + ' 个</span></div>'
        + '<div class="example-grid">';
      C.DEMO_EXAMPLES.forEach(function (ex) {
        h += '<div class="example-card"><span class="example-group">' + U.esc(ex.group) + '</span>'
          + '<div class="example-title">' + U.esc(ex.title) + '</div>'
          + '<div class="example-desc">' + U.esc(ex.desc) + '</div>'
          + '<div class="example-actions">'
          + '<button class="btn btn-primary btn-sm" data-ex="' + U.esc(ex.id) + '">▶ 载入并运行</button>'
          + '<button class="btn btn-sm" data-exjump="' + U.esc(ex.module) + '">前往模块</button>'
          + '</div></div>';
      });
      h += '</div></div>';

      /* 演示数据概览 */
      h += '<div class="card"><div class="card-head"><h3 class="card-title"><span class="num">2</span>演示数据集概览</h3>'
        + '<span class="card-sub">PRELOAD_DEMO · 与真实表结构一致</span></div><div id="m8_tables"></div></div>';

      /* 能力覆盖自检 */
      h += '<div class="card"><div class="card-head"><h3 class="card-title"><span class="num">3</span>能力覆盖清单</h3>'
        + '<span class="card-sub">按 Prompt 文档逐项核对</span></div>';
      var caps = [
        ['交互方式', 'chat 对话 · upload 文件上传（Excel/CSV） · form 表单 · voice 语音输入 · api 接口'],
        ['输出形式', 'text 文本 · table 表格 · chart 图表（内联 SVG） · report_file 报告文件（HTML/Markdown/CSV） · trace 溯源轨迹'],
        ['功能模块', '1 数据聚合 · 2 风险信号 · 3 线索梳理 · 4 可疑度评估 · 5 证据核对 · 6 报告初稿 · 7 问答与提醒'],
        ['风险识别', 'hybrid_three_step 三步法 + 资金流向 5 视角 + equity_person_substance 关联交易口径'],
        ['证据核对', 'three_way_match · voucher_sampling · cross_system_compare · bank_book_reconcile · external_confirmation'],
        ['评估方法', 'scorecard_plus_triangle（评分卡 + 舞弊三角）'],
        ['表述口径', 'graded_with_disclaimer（分级表述 + 免责声明 + 人工复核签字位）'],
        ['接口', '/api/health · /api/query · /api/aggregate · /api/risk-signal · /api/clues · /api/score · /api/evidence-check · /api/report · /api/qa']
      ];
      h += '<table class="data"><thead><tr><th>能力维度</th><th>覆盖内容</th></tr></thead><tbody>';
      caps.forEach(function (c) {
        h += '<tr><td><b>' + U.esc(c[0]) + '</b></td><td>' + U.esc(c[1]) + '</td></tr>';
      });
      h += '</tbody></table></div>';
      return h;
    },
    bind: function (host) {
      host.querySelectorAll('[data-ex]').forEach(function (b) {
        b.addEventListener('click', function () {
          var id = b.getAttribute('data-ex');
          var ex = null;
          C.DEMO_EXAMPLES.forEach(function (x) { if (x.id === id) ex = x; });
          if (!ex) return;
          if (ex.module === 'qa') {
            go('qa');
            setTimeout(function () {
              var inp = document.getElementById('q_input');
              if (inp) {
                inp.value = ex.payload.question || '';
                var s = document.getElementById('q_send');
                if (s) s.click();
              }
            }, 220);
            return;
          }
          /* 载入筛选条件 */
          var p = ex.payload || {};
          if (p.entityType) STATE.filters.entityType = p.entityType;
          if (p.entityCode) STATE.filters.entityCode = p.entityCode;
          if (p.entityName) STATE.filters.entityName = p.entityName;
          if (p.periodFrom) STATE.filters.periodFrom = p.periodFrom;
          if (p.periodTo) STATE.filters.periodTo = p.periodTo;
          if (p.minAmount !== undefined) STATE.filters.minAmount = p.minAmount;
          if (p.chains) STATE.filters.chains = p.chains;
          if (p.viewsOnly) STATE.filters.viewsOnly = p.viewsOnly;
          if (p.methods) STATE.filters.methods = p.methods;
          saveFilters();
          go(ex.module);
          Wy.toast('已载入示例：' + ex.title, 'ok');
          setTimeout(function () {
            var mod = { aggregate: M1, risk: M2, clue: M3, score: M4, evidence: M5, report: M6 };
            if (mod[ex.module] && mod[ex.module].run) mod[ex.module].run();
          }, 180);
        });
      });
      host.querySelectorAll('[data-exjump]').forEach(function (b) {
        b.addEventListener('click', function () { go(b.getAttribute('data-exjump')); });
      });

      /* 数据集概览 */
      Wy.api.call('tables', {}).then(function (r) {
        var hh = document.getElementById('m8_tables');
        if (!hh) return;
        var D = window.WyDemo.build();
        var rows = (r.tables || []).map(function (t) {
          var cnt = (D[t.name] || []).length;
          return {
            system: t.system, name: t.name, label: t.label,
            fields: Object.keys(t.fields || {}).length, rows: cnt,
            key: t.key
          };
        });
        hh.appendChild(Wy.renderTable({
          columns: [
            { key: 'system', label: '所属系统' },
            { key: 'name', label: '表名', mono: true },
            { key: 'label', label: '中文名' },
            { key: 'key', label: '关键字段', mono: true },
            { key: 'fields', label: '字段数', type: 'int', align: 'right' },
            { key: 'rows', label: '演示行数', type: 'int', align: 'right' }
          ], rows: rows, pageSize: 0, sortKey: 'system', sortDir: 'asc'
        }));
        var totalRows = rows.reduce(function (a, x) { return a + x.rows; }, 0);
        var wrap = document.createElement('div');
        wrap.innerHTML = '<div class="dim" style="font-size:12px;margin-bottom:8px">'
          + '共 ' + rows.length + ' 张表，合计 ' + totalRows.toLocaleString('zh-CN') + ' 行记录</div>';
        hh.insertBefore(wrap, hh.firstChild);
      });
    }
  };

  /* ============================================================
   * 运行与错误处理
   * ============================================================ */
  function runAndPaint(hostId, apiName, p, painter, label) {
    var host = document.getElementById(hostId);
    if (!host) return;
    host.innerHTML = '<div class="loading-bar on"></div>'
      + '<div class="dim" style="padding:10px 0;font-size:12.5px">正在执行' + U.esc(label) + '…</div>';
    Wy.api.call(apiName, p).then(function (r) {
      STATE.results[apiName] = r;
      painter(r);
      var via = r.__via === 'server'
        ? (r.dataSource && r.dataSource.mode === 'live' ? '实时数据' : '演示数据')
        : '本地离线引擎';
      Wy.toast(label + '完成（' + via + '，' + ((r.elapsedMs || 0) / 1000).toFixed(2) + 's）', 'ok');
    }).catch(function (e) {
      host.innerHTML = notice('❌ ' + U.esc(label) + '失败：' + U.esc(e.message)
        + '<div class="dim" style="margin-top:6px">若使用「连接数据库」模式，请确认后端服务已启动（双击 start.bat）。'
        + '也可切换到「演示数据」模式离线体验全部功能。</div>', 'danger');
      Wy.toast(label + '失败：' + e.message, 'err');
    });
  }

  /* ============================================================
   * 导航与渲染
   * ============================================================ */
  /* ============================================================
   * M9 · 大模型智能体对话（SSE 流式 + function calling 调度规则引擎）
   * 不改动任何既有模块；仅在导航中新增一个入口。
   * ============================================================ */
  var AGENT_TOOL_LABELS = {
    aggregate_data: '数据聚合', risk_signal: '风险信号识别', clue_sort: '线索梳理',
    suspicion_score: '可疑度评估', evidence_check: '证据核对', compliance_qa: '合规问答',
    knowledge_lookup: '知识检索', intent_parse: '意图解析'
  };

  var M9 = {
    title: '智能体对话',
    desc: '大模型智能体：理解自然语言问题，自主调用风险识别、线索梳理、可疑度评估、证据核对、数据聚合、知识检索等分析工具，并结合舞弊审计知识库生成可溯源的辅助回答。',
    render: function () {
      var h = '<div class="card agent-card">' + Wy.aiBadge()
        + '<div class="card-head"><h3 class="card-title"><span class="num">AI</span>大模型智能体</h3>'
        + '<span class="card-sub" id="a_llm_status">检测中…</span></div>';
      h += '<div class="agent-note">本智能体仅作辅助材料，不直接下调查结论；回答由规则引擎 / 知识库的真实结果支撑，关键判断仍由调查人员作出。</div>';
      h += '<div class="chat-box" style="height:460px"><div class="chat-log" id="a_log"></div>'
        + '<div class="chat-input">'
        + '<textarea id="a_input" placeholder="例如：帮我看看供应商 S028 有哪些可疑点，并建议下一步怎么查（Enter 发送，Shift+Enter 换行）"></textarea>'
        + '<button class="mic-btn" id="a_mic" title="语音输入（不支持时自动降级）">🎤</button>'
        + '<button class="btn btn-primary" id="a_send">发送</button>'
        + '</div></div>';
      h += '<div class="suggest-chips" id="a_suggest"></div>';
      h += '<div id="a_trace"></div>';
      h += '</div>';
      return h;
    },
    bind: function (host) {
      var input = host.querySelector('#a_input');
      var send = host.querySelector('#a_send');
      var mic = host.querySelector('#a_mic');
      var log = host.querySelector('#a_log');
      var statusEl = host.querySelector('#a_llm_status');
      var suggest = host.querySelector('#a_suggest');
      var traceHost = host.querySelector('#a_trace');
      if (!STATE.agentChat) STATE.agentChat = [];
      var current = null;

      function appendMsg(role) {
        var el = document.createElement('div');
        el.className = 'msg ' + role;
        var av = document.createElement('div');
        av.className = 'msg-avatar';
        av.textContent = (role === 'ai' ? 'AI' : '我');
        var b = document.createElement('div');
        b.className = 'msg-bubble';
        el.appendChild(av);
        el.appendChild(b);
        log.appendChild(el);
        log.scrollTop = log.scrollHeight;
        return { el: el, bubble: b };
      }

      function addUser(text) {
        var m = appendMsg('user');
        m.bubble.innerHTML = U.esc(text).replace(/\n/g, '<br>');
        STATE.agentChat.push({ role: 'user', text: text });
      }

      function addAiStart() {
        var m = appendMsg('ai');
        var tools = document.createElement('div');
        tools.className = 'agent-tools';
        var trace = document.createElement('div');
        trace.className = 'agent-trace-inline';
        m.el.appendChild(tools);
        m.el.appendChild(trace);
        return { bubble: m.bubble, tools: tools, trace: trace, el: m.el };
      }

      function addTool(info) {
        var name = info && info.name;
        var b = document.createElement('span');
        b.className = 'tool-badge';
        b.innerHTML = '🔧 ' + U.esc(AGENT_TOOL_LABELS[name] || name || '工具');
        if (current) current.tools.appendChild(b);
      }

      function renderAgentTrace(data) {
        if (!data) return;
        var h = '<div class="card" style="margin-top:14px"><div class="card-head"><h3 class="card-title">🔎 调用过程与溯源</h3></div>'
          + '<div class="agent-trace-body">'
          + '<div class="dim" style="margin-bottom:6px">本回答由以下工具的真实计算结果支撑：</div>';
        var tools = (data.usedTools || []);
        if (tools.length) {
          h += tools.map(function (t) { return '<span class="tool-badge">' + U.esc(AGENT_TOOL_LABELS[t] || t) + '</span>'; }).join(' ');
        } else {
          h += '<span class="dim">未调用工具（直接回答）</span>';
        }
        var rag = (data.ragHits || []);
        if (rag.length) {
          h += '<div style="margin-top:8px"><span class="dim">参考知识：</span>'
            + rag.map(function (x) { return '<span class="kb-badge">' + U.esc(x.title || x.id) + '</span>'; }).join(' ') + '</div>';
        }
        var ds = data.dataSource || {};
        if (ds.mode) {
          h += '<div style="margin-top:8px" class="dim">数据来源：' + U.esc(ds.label || ds.mode)
            + (ds.gaps && ds.gaps.length ? ('；提示：' + U.esc(ds.gaps.join('；'))) : '') + '</div>';
        }
        h += '</div></div>';
        traceHost.innerHTML = h;
      }

      function streamAgent(messages, onEvent) {
        var base = (window.Wy && Wy.api && Wy.api.API_BASE) || 'http://127.0.0.1:3001';
        var mode = (window.Wy && Wy.api && Wy.api.getMode && Wy.api.getMode()) || 'auto';
        var url = base + '/api/llm?mode=' + encodeURIComponent(mode);
        var cur = 'message';
        return fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: messages })
        }).then(function (resp) {
          if (!resp.ok) return resp.text().then(function (t) { throw new Error('HTTP ' + resp.status + ' ' + t.slice(0, 200)); });
          var reader = resp.body.getReader();
          var dec = new TextDecoder('utf-8');
          var buf = '';
          function pump() {
            return reader.read().then(function (r) {
              if (r.done) return;
              buf += dec.decode(r.value, { stream: true });
              var parts = buf.split('\n');
              buf = parts.pop() || '';
              for (var i = 0; i < parts.length; i++) {
                var s = parts[i].trim();
                if (s.indexOf('event:') === 0) { cur = s.slice(6).trim(); }
                else if (s.indexOf('data:') === 0) {
                  var d = s.slice(5).trim();
                  if (!d) continue;
                  try { onEvent(cur, JSON.parse(d)); } catch (e) {}
                }
              }
              return pump();
            });
          }
          return pump();
        });
      }

      function doSend(q) {
        q = (q || '').trim();
        if (!q) return;
        if (current) return; /* 防止并发 */
        addUser(q);
        if (input) input.value = '';
        current = addAiStart();
        current.bubble.innerHTML = '<span class="dim">正在思考…</span>';
        traceHost.innerHTML = '';
        var messages = STATE.agentChat.slice(0, -1).map(function (m) {
          return { role: m.role === 'user' ? 'user' : 'assistant', content: m.text };
        });
        messages.push({ role: 'user', content: q });
        streamAgent(messages, function (ev, data) {
          if (ev === 'meta') {
            if (statusEl) statusEl.textContent = data.llmEnabled
              ? ('大模型：' + data.provider + ' / ' + data.model) : '大模型未启用（确定性规则问答）';
          } else if (ev === 'answer_start') {
            current.bubble.innerHTML = '';
          } else if (ev === 'token') {
            current.bubble.innerHTML += U.esc(data.text).replace(/\n/g, '<br>');
            log.scrollTop = log.scrollHeight;
          } else if (ev === 'tool') {
            addTool(data);
          } else if (ev === 'trace') {
            renderAgentTrace(data);
          } else if (ev === 'error') {
            current.bubble.innerHTML += '<div class="agent-err">⚠️ ' + U.esc(data.message || '生成失败') + '</div>';
          }
        }).then(function () {
          var text = (current.bubble.textContent || '').replace(/正在思考…/, '').trim();
          STATE.agentChat.push({ role: 'ai', text: text });
          current = null;
        }).catch(function (e) {
          if (current) current.bubble.innerHTML += '<div class="agent-err">⚠️ ' + U.esc(e.message) + '</div>';
          current = null;
        });
      }

      send.addEventListener('click', function () { doSend(input.value); });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(input.value); }
      });

      /* 语音输入：Web Speech API，不可用时优雅降级 */
      var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) { mic.disabled = true; mic.style.opacity = '.45'; mic.title = '当前浏览器不支持语音输入'; }
      else {
        var rec = null, recording = false;
        mic.addEventListener('click', function () {
          if (recording) { try { rec.stop(); } catch (e) {} return; }
          try {
            rec = new SR(); rec.lang = 'zh-CN'; rec.interimResults = false; rec.maxAlternatives = 1;
            rec.onstart = function () { recording = true; mic.classList.add('recording'); };
            rec.onend = function () { recording = false; mic.classList.remove('recording'); };
            rec.onerror = function (ev) { recording = false; mic.classList.remove('recording'); Wy.toast('语音识别不可用，请改用文本', 'warn'); };
            rec.onresult = function (ev) { var t = ev.results[0][0].transcript; if (input) { input.value = t; input.focus(); } };
            rec.start();
          } catch (e) { mic.disabled = true; Wy.toast('语音启动失败', 'warn'); }
        });
      }

      /* 建议问题 */
      var prompts = [
        '帮我分析供应商 S028 的可疑点并建议下一步核查',
        '什么是三步法风险识别',
        '生成一份针对高度可疑主体的核查要点',
        '采购付款循环常见的舞弊手法有哪些'
      ];
      suggest.innerHTML = '<span class="dim" style="font-size:11.5px;line-height:2">试试：</span>'
        + prompts.map(function (p) { return '<button class="suggest-chip" data-q="' + U.esc(p) + '">' + U.esc(p) + '</button>'; }).join('');
      suggest.querySelectorAll('.suggest-chip').forEach(function (b) {
        b.addEventListener('click', function () { var p = b.getAttribute('data-q'); if (input) input.value = p; doSend(p); });
      });

      /* 恢复历史对话 */
      STATE.agentChat.forEach(function (m) {
        var el = appendMsg(m.role === 'user' ? 'user' : 'ai');
        el.bubble.innerHTML = U.esc(m.text).replace(/\n/g, '<br>');
      });
      if (!STATE.agentChat.length) {
        var w = appendMsg('ai');
        w.bubble.innerHTML = '您好，我是接入了大模型与规则引擎的舞弊审计智能体。您可以让我：分析某主体的可疑点、解读规则信号、'
          + '梳理核查思路、检索舞弊审计方法论知识。若未配置大模型，我会自动切换到本地规则问答。';
      }

      /* LLM 状态 */
      if (statusEl) {
        var cfgUrl = (window.Wy && Wy.api && Wy.api.API_BASE || 'http://127.0.0.1:3001') + '/api/llm/config';
        fetch(cfgUrl).then(function (r) { return r.json(); }).then(function (c) {
          statusEl.textContent = c.enabled ? ('大模型：' + c.provider + ' / ' + c.model) : '大模型未启用（确定性规则问答）';
        }).catch(function () { statusEl.textContent = '大模型状态未知'; });
      }
    }
  };

  var MODULES = {
    aggregate: M1, risk: M2, clue: M3, score: M4, evidence: M5, report: M6, qa: M7, examples: M8, agent: M9
  };

  var NAV = [
    { key: 'aggregate', ico: '🗂', label: '数据聚合台' },
    { key: 'risk', ico: '🚨', label: '风险信号识别' },
    { key: 'clue', ico: '🧩', label: '线索梳理' },
    { key: 'score', ico: '📊', label: '可疑度评估' },
    { key: 'evidence', ico: '🔍', label: '证据核对' },
    { key: 'report', ico: '📄', label: '报告初稿' },
    { key: 'agent', ico: '🤖', label: '智能体对话' },
    { key: 'qa', ico: '💬', label: '问答与提醒' }
  ];

  function go(key) {
    if (!MODULES[key]) return;
    STATE.view = key;
    render();
    var main = document.getElementById('main');
    if (main) main.scrollTop = 0;
    window.scrollTo(0, 0);
  }

  function render() {
    /* 导航 */
    var nav = document.getElementById('nav');
    if (nav) {
      var h = '';
      NAV.forEach(function (n) {
        h += '<button class="nav-item' + (STATE.view === n.key ? ' active' : '') + '" data-nav="' + n.key + '">'
          + '<span class="nav-ico">' + n.ico + '</span>' + U.esc(n.label) + '</button>';
      });
      h += '<div class="nav-sep"></div>';
      h += '<button class="nav-item nav-example' + (STATE.view === 'examples' ? ' active' : '') + '" data-nav="examples">'
        + '<span class="nav-ico">🧪</span>测试示例</button>';
      nav.innerHTML = h;
      nav.querySelectorAll('[data-nav]').forEach(function (b) {
        b.addEventListener('click', function () { go(b.getAttribute('data-nav')); });
      });
    }

    /* 主区 */
    var mod = MODULES[STATE.view];
    var main = document.getElementById('main');
    if (!main || !mod) return;
    var isEx = STATE.view === 'examples';
    main.innerHTML = '<div class="page-head"><div>'
      + '<h1 class="page-title">' + (isEx ? '🧪 ' : '') + U.esc(mod.title) + '</h1>'
      + '<p class="page-desc">' + U.esc(mod.desc) + '</p>'
      + '</div></div>'
      + '<div id="page-body"></div>';
    var body = document.getElementById('page-body');
    body.innerHTML = mod.render();
    try { mod.bind(body); } catch (e) { console.error(e); }
  }

  /* ============================================================
   * 顶部栏：模式切换 + 健康状态
   * ============================================================ */
  function paintModeStatus() {
    var el = document.getElementById('modeStatus');
    if (!el) return;
    var st = Wy.api.state;
    var cls = 'mode-status', txt = '';
    if (!st.online) {
      cls += ' off';
      txt = '后端未连接 · 本地离线引擎';
    } else if (Wy.api.getMode() === 'live') {
      var h = st.health || {};
      if (h.mode === 'live' && h.connected) { cls += ' live'; txt = '已连接数据库（live）'; }
      else { cls += ' demo'; txt = '数据库不可达 · 已降级演示'; }
    } else {
      cls += ' demo';
      txt = '演示数据（demo）';
    }
    el.className = cls;
    el.innerHTML = '<span class="dot"></span>' + U.esc(txt);
  }

  function bindTopbar() {
    var radios = document.querySelectorAll('input[name="mode"]');
    radios.forEach(function (r) {
      if (r.value === Wy.api.getMode()) r.checked = true;
      r.addEventListener('change', function () {
        if (!r.checked) return;
        Wy.api.setMode(r.value);
        paintModeStatus();
        Wy.toast('已切换为「' + (r.value === 'live' ? '连接数据库' : '演示数据') + '」模式', 'ok');
        /* 切换模式后清空结果，避免混淆 */
        STATE.results = {};
        render();
      });
    });
    Wy.api.checkHealth(true).then(function () {
      paintModeStatus();
      var st = Wy.api.state;
      /* 用户在"连接数据库"模式下但数据库不可用时提示 */
      if (st.online && Wy.api.getMode() === 'live' && st.health && st.health.mode !== 'live') {
        Wy.toast('数据库当前不可达，已自动降级为演示数据', 'warn', 4200);
      }
    });
    /* 定时刷新状态 */
    setInterval(function () {
      Wy.api.checkHealth(false).then(paintModeStatus);
    }, 30000);
  }

  /* ============================================================
   * 启动
   * ============================================================ */
  function boot() {
    Wy.installBadgeMarker();
    bindTopbar();
    render();
    /* 首次进入：若为演示模式，自动跑一次聚合，避免空白页 */
    setTimeout(function () {
      if (STATE.view === 'aggregate' && !STATE.results.aggregate) {
        /* 不自动运行，保留用户的主动操作；仅在测试示例页提供一键运行 */
      }
    }, 100);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  root.WyApp = { go: go, render: render, STATE: STATE, modules: MODULES };
})(window);
