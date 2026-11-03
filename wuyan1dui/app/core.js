/**
 * 无言以队 · 核心配置库
 *
 * 本文件包含：
 *  1) 数据表/字段口径字典（26 张业务表）
 *  2) 风险规则库（含三步法归属、资金流向 5 视角、关联交易口径）
 *  3) 评分卡与舞弊三角指标（压力/机会/借口）
 *  4) 证据核对方法定义
 *  5) 同义词/关键词问答词典
 *  6) 报告模板文案与固定免责声明
 *  7) 数据关联关系（采购/销售/资金/报销链条）
 *  8) 字段显示名、可疑等级、系统来源、状态色
 *
 * 规则库、口径字典、报告模板均为本地 JSON 形式随前端分发，不依赖任何模型服务。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WyCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ============================================================
   * 0. 固定文案
   * ============================================================ */
  const DISCLAIMER_LONG = 'AI辅助生成，不构成调查结论；关键判断由调查人员作出。';
  const DISCLAIMER_TOP = 'AI辅助生成 · 不构成调查结论 · 关键判断由调查人员作出';
  const CORNER_BADGE = 'AI辅助 · 供参考';
  const SCORE_DECLARATION = '本分值为规则化参考值，不构成对舞弊事实的认定，最终可疑等级由调查人员确定。';
  const REPORT_COVER_DECLARATION = [
    '【声明】本报告由AI助理辅助生成，仅作为舞弊审计调查的辅助分析材料，',
    '不构成调查结论，不构成对任何主体或个人的定性意见。',
    '最终调查结论由调查人员依据职权和专业判断作出。',
    '',
    '复核人（签字）：__________   复核日期：____年__月__日',
    '调查负责人（签字）：__________   日期：____年__月__日'
  ].join('\n');

  /* 禁用定性词（输出定稿前统一过滤） */
  const FORBIDDEN_PHRASES = [
    '确认存在舞弊', '构成舞弊', '存在舞弊事实', '系某某所为',
    '应当认定为', '应认定为', '认定为舞弊', '责任人', '定性为',
    '确系', '实为', '证实舞弊', '舞弊成立'
  ];

  /* 允许的分级表述 */
  const GRADES = {
    high: { key: 'high', label: '高度可疑', color: '#D93025', order: 1 },
    medium: { key: 'medium', label: '中度可疑', color: '#F29900', order: 2 },
    low: { key: 'low', label: '低度可疑', color: '#1E8E3E', order: 3 },
    unknown: { key: 'unknown', label: '信息不足待补充', color: '#5F6368', order: 4 }
  };
  const GRADE_ORDER = ['high', 'medium', 'low', 'unknown'];

  /* ============================================================
   * 1. 26 张业务表与字段口径
   * ============================================================ */
  const TABLE_META = {
    subjects: { sys: '主数据', name: '会计科目', key: 'subject_code', date: 'created_at',
      fields: { id: 'ID', subject_code: '科目编码', subject_name: '科目名称', subject_type: '科目类型', parent_code: '上级科目', dc_direction: '余额方向', is_enabled: '是否启用', created_at: '创建时间' } },
    cost_centers: { sys: '主数据', name: '成本中心', key: 'cc_code', date: 'created_at',
      fields: { id: 'ID', cc_code: '成本中心编码', cc_name: '成本中心名称', dept_code: '所属部门', cc_type: '类型', created_at: '创建时间' } },
    departments: { sys: '主数据', name: '部门', key: 'dept_code', date: 'created_at',
      fields: { id: 'ID', dept_code: '部门编码', dept_name: '部门名称', parent_dept_code: '上级部门', manager_emp_code: '负责人工号', created_at: '创建时间' } },
    employees: { sys: '主数据', name: '员工', key: 'emp_code', date: 'hire_date',
      fields: { id: 'ID', emp_code: '工号', emp_name: '姓名', dept_code: '所属部门', position: '岗位', id_card: '身份证号', bank_account: '工资卡号', hire_date: '入职日期', created_at: '创建时间' } },
    products: { sys: '主数据', name: '产品/物料', key: 'product_code', date: 'created_at',
      fields: { id: 'ID', product_code: '物料编码', product_name: '物料名称', category: '类别', unit: '单位', unit_price: '基准单价', tax_rate_code: '税率编码', spec: '规格型号', created_at: '创建时间' } },
    customers: { sys: '主数据', name: '客户', key: 'customer_code', date: 'created_at',
      fields: { id: 'ID', customer_code: '客户编码', customer_name: '客户名称', tax_no: '纳税人识别号', contact: '联系人', phone: '联系电话', address: '地址', credit_rating: '信用等级', created_at: '创建时间' } },
    suppliers: { sys: '主数据', name: '供应商', key: 'supplier_code', date: 'created_at',
      fields: { id: 'ID', supplier_code: '供应商编码', supplier_name: '供应商名称', tax_no: '纳税人识别号', contact: '联系人', phone: '联系电话', address: '地址', payment_terms: '付款条件', created_at: '创建时间' } },
    tax_rates: { sys: '税务系统', name: '税率', key: 'tax_rate_code', date: 'created_at',
      fields: { id: 'ID', tax_rate_code: '税率编码', tax_rate: '税率值', description: '说明', created_at: '创建时间' } },
    projects: { sys: '主数据', name: '项目', key: 'project_code', date: 'start_date',
      fields: { id: 'ID', project_code: '项目编码', project_name: '项目名称', dept_code: '负责部门', project_type: '类型', budget: '预算金额', start_date: '开始日期', end_date: '预计结束日期', status: '状态', created_at: '创建时间' } },
    bank_accounts: { sys: '银行系统', name: '银行账户', key: 'account_no', date: 'created_at',
      fields: { id: 'ID', account_no: '银行账号', bank_name: '开户行', account_type: '账户类型', currency: '币种', created_at: '创建时间' } },
    gl_vouchers: { sys: 'AIS会计', name: '记账凭证', key: 'voucher_no', date: 'voucher_date',
      fields: { id: 'ID', voucher_no: '凭证号', voucher_date: '凭证日期', voucher_type: '凭证类型', summary: '摘要', source_system: '来源系统', source_ref: '来源单据号', total_debit: '借方合计', total_credit: '贷方合计', maker: '制单人', reviewer: '审核人', status: '状态', created_at: '创建时间' } },
    gl_ledger: { sys: 'AIS会计', name: '总账明细', key: 'id', date: 'entry_date',
      fields: { id: 'ID', subject_code: '科目编码', period: '会计期间', entry_date: '记账日期', voucher_id: '凭证ID', summary: '摘要', debit_amount: '借方发生额', credit_amount: '贷方发生额', balance: '期末余额', created_at: '创建时间' } },
    gl_voucher_entries: { sys: 'AIS会计', name: '凭证分录', key: 'id', date: 'created_at',
      fields: { id: 'ID', voucher_id: '凭证ID', entry_line: '分录行号', subject_code: '科目编码', summary: '分录摘要', debit_amount: '借方金额', credit_amount: '贷方金额', cost_center: '成本中心', project_code: '关联项目', created_at: '创建时间' } },
    oa_expense_reports: { sys: 'OA系统', name: '报销单', key: 'report_no', date: 'submit_date',
      fields: { id: 'ID', report_no: '报销单号', emp_code: '报销人工号', dept_code: '报销部门', expense_type: '费用类型', amount: '报销金额', submit_date: '提交日期', status: '状态', voucher_id: '关联凭证', description: '事由说明', created_at: '创建时间' } },
    oa_approval_records: { sys: 'OA系统', name: '审批记录', key: 'id', date: 'action_time',
      fields: { id: 'ID', report_id: '报销单ID', approver_code: '审批人工号', approver_name: '审批人', step: '审批步骤', action: '动作', comment: '审批意见', action_time: '处理时间', created_at: '创建时间' } },
    pur_orders: { sys: '采购系统', name: '采购订单', key: 'po_no', date: 'order_date',
      fields: { id: 'ID', po_no: '订单号', supplier_code: '供应商编码', contract_no: '合同号', order_date: '订单日期', total_amount: '订单总额(不含税)', tax_amount: '税额', grand_total: '价税合计', status: '状态', maker: '制单人', created_at: '创建时间' } },
    pur_contracts: { sys: '采购系统', name: '采购合同', key: 'contract_no', date: 'sign_date',
      fields: { id: 'ID', contract_no: '合同号', supplier_code: '供应商编码', contract_name: '合同名称', total_amount: '合同总金额', sign_date: '签订日期', start_date: '生效日期', end_date: '到期日期', status: '状态', created_at: '创建时间' } },
    pur_order_items: { sys: '采购系统', name: '采购订单行', key: 'id', date: 'created_at',
      fields: { id: 'ID', po_id: '订单ID', line_no: '行号', product_code: '物料编码', product_name: '物料名称', quantity: '数量', unit: '单位', unit_price: '不含税单价', tax_rate: '税率', amount: '不含税金额', tax_amount: '税额', created_at: '创建时间' } },
    pur_receipts: { sys: '采购系统', name: '采购入库', key: 'receipt_no', date: 'receipt_date',
      fields: { id: 'ID', receipt_no: '入库单号', po_id: '订单ID', receipt_date: '入库日期', total_amount: '入库金额', voucher_id: '关联凭证', status: '状态', created_at: '创建时间' } },
    sal_orders: { sys: '销售系统', name: '销售订单', key: 'so_no', date: 'order_date',
      fields: { id: 'ID', so_no: '订单号', customer_code: '客户编码', order_date: '订单日期', total_amount: '订单总额(不含税)', tax_amount: '税额', grand_total: '价税合计', status: '状态', sales_emp: '销售员', created_at: '创建时间' } },
    sal_deliveries: { sys: '销售系统', name: '销售发货', key: 'delivery_no', date: 'delivery_date',
      fields: { id: 'ID', delivery_no: '发货单号', so_id: '订单ID', delivery_date: '发货日期', total_amount: '发货金额', voucher_id: '关联凭证', status: '状态', created_at: '创建时间' } },
    bank_transactions: { sys: '银行系统', name: '银行流水', key: 'bank_tx_id', date: 'tx_date',
      fields: { id: 'ID', bank_tx_id: '银行流水号', account_no: '银行账号', tx_date: '交易日期', tx_time: '交易时间', tx_type: '收付类型', amount: '交易金额', counterparty: '对方户名', counterparty_account: '对方账号', channel: '交易渠道', summary: '摘要', voucher_id: '关联凭证', matched: '是否对账', created_at: '创建时间' } },
    sal_order_items: { sys: '销售系统', name: '销售订单行', key: 'id', date: 'created_at',
      fields: { id: 'ID', so_id: '订单ID', line_no: '行号', product_code: '产品编码', product_name: '产品名称', quantity: '数量', unit: '单位', unit_price: '不含税单价', tax_rate: '税率', amount: '不含税金额', tax_amount: '税额', created_at: '创建时间' } },
    tax_invoice_pool: { sys: '税务系统', name: '发票池', key: 'invoice_no', date: 'invoice_date',
      fields: { id: 'ID', invoice_no: '发票号码', invoice_type: '进项/销项', invoice_date: '开票日期', party_code: '对方编码', party_name: '对方名称', amount: '不含税金额', tax_rate: '税率', tax_amount: '税额', total_amount: '价税合计', source_ref: '来源单据号', voucher_id: '关联凭证', status: '状态', created_at: '创建时间' } },
    rd_timesheets: { sys: '研发系统', name: '研发工时', key: 'id', date: 'work_date',
      fields: { id: 'ID', emp_code: '工号', project_code: '项目编码', cost_center: '成本中心', work_date: '工作日期', hours: '工时', hourly_rate: '工时费率', labor_cost: '人工成本', description: '工作内容', created_at: '创建时间' } },
    tax_vat_declarations: { sys: '税务系统', name: '增值税申报', key: 'id', date: 'declaration_period',
      fields: { id: 'ID', declaration_period: '申报期间', output_amount: '销项金额', output_tax: '销项税额', input_amount: '进项金额', input_tax: '进项税额', payable_tax: '应纳税额', actual_paid: '实际已缴', status: '状态', voucher_id: '关联凭证', created_at: '创建时间' } }
  };

  const ALL_TABLES = Object.keys(TABLE_META);

  /* 系统分组（用于数据聚合台展示） */
  const SYSTEM_GROUPS = [
    { key: 'master', name: '主数据', tables: ['subjects', 'cost_centers', 'departments', 'employees', 'products', 'customers', 'suppliers', 'tax_rates', 'projects'] },
    { key: 'ais', name: 'AIS会计系统', tables: ['gl_vouchers', 'gl_ledger', 'gl_voucher_entries'] },
    { key: 'oa', name: 'OA系统', tables: ['oa_expense_reports', 'oa_approval_records'] },
    { key: 'pur', name: '采购系统', tables: ['pur_orders', 'pur_contracts', 'pur_order_items', 'pur_receipts'] },
    { key: 'sal', name: '销售系统', tables: ['sal_orders', 'sal_deliveries', 'sal_order_items'] },
    { key: 'bank', name: '银行系统', tables: ['bank_accounts', 'bank_transactions'] },
    { key: 'tax', name: '税务系统', tables: ['tax_invoice_pool', 'tax_vat_declarations', 'tax_rates'] },
    { key: 'rd', name: '研发系统', tables: ['rd_timesheets'] }
  ];

  /* ============================================================
   * 2. 风险规则库
   * step: rule(第一步规则阈值初筛) | metric(第二步指标比率) | graph(第三步关联图谱)
   * ============================================================ */
  const RULES = [
    /* ---------- 第一步：规则阈值初筛 ---------- */
    {
      id: 'R01', name: '大额付款超阈值', step: 'rule', category: '异常交易',
      view: null, weight: 12, defaultGrade: 'medium',
      param: { amount: 5000000 },
      logic: (p) => `bank_transactions.tx_type='支出' AND amount >= ${(p.amount / 10000).toFixed(0)}万元`,
      reason: (p) => `单笔付款金额达到 ${(p.amount / 10000).toFixed(0)} 万元及以上，超出常规审批权限参考阈值`,
      falsePositive: '大额设备采购、集中结算等业务本身金额较大，属正常商业行为',
      action: '调阅该笔付款对应的采购订单、入库单、发票及审批单，核对金额构成与合同约定'
    },
    {
      id: 'R02', name: '单体供应商付款占比过高', step: 'rule', category: '关联方集中',
      view: 'related_party_concentration', weight: 10, defaultGrade: 'medium',
      param: { ratio: 0.12, minCount: 3 },
      logic: (p) => `按 counterparty 汇总支出金额，单一对手方占比 > ${(p.ratio * 100).toFixed(0)}%`,
      reason: (p) => `单一供应商付款金额占全部付款金额的 ${(p.ratio * 100).toFixed(0)}% 以上，付款集中度偏高`,
      falsePositive: '战略供应商、单一来源采购可能导致合理的高集中度',
      action: '核对供应商准入审批、比价记录与合同条款，确认是否存在可替代供应商'
    },
    {
      id: 'R03', name: '非工作日交易', step: 'rule', category: '资金流向异常',
      view: 'abnormal_time_channel', weight: 8, defaultGrade: 'medium',
      param: { holidayList: [] },
      logic: () => "交易日期为周六/周日（或列表内法定节假日）且金额 >= 200 万元",
      reason: () => '交易发生在非工作日，正常资金结算一般在工作日完成',
      falsePositive: '月末/季末集中走款、银行代扣代发可能在周末批量处理',
      action: '调取银行电子回单与内部付款审批时间戳，比对该笔业务的实际办理人'
    },
    {
      id: 'R04', name: '临近期末集中付款', step: 'rule', category: '异常交易',
      view: null, weight: 6, defaultGrade: 'low',
      param: { lastDays: 3, amount: 1000000 },
      logic: (p) => `交易日期落在每月最后 ${p.lastDays} 天且金额 >= ${(p.amount / 10000).toFixed(0)} 万元`,
      reason: (p) => `付款发生在会计期间最后 ${p.lastDays} 天，存在跨期调节或突击付款可能`,
      falsePositive: '月度结算周期统一安排在月末，属正常财务安排',
      action: '核对期末前后付款的原始单据日期，确认业务发生时点与入账期间一致'
    },
    {
      id: 'R05', name: '小额高频付款（规避审批）', step: 'rule', category: '资金流向异常',
      view: 'split_payment', weight: 8, defaultGrade: 'medium',
      param: { minCount: 3, band: [40000, 50000] },
      logic: (p) => `同一对手方 30 天内 ${p.minCount} 笔及以上、单笔落在 ${(p.band[0] / 10000)}~${(p.band[1] / 10000)} 万元区间`,
      reason: (p) => `同一对手方多笔付款金额集中在 ${(p.band[0] / 10000)}~${(p.band[1] / 10000)} 万元区间，可能存在按审批权限上限拆分`,
      falsePositive: '按合同分期付款、按月结算报销属正常拆分',
      action: '调阅这批付款对应的合同/协议与审批记录，核对是否存在同一事项被拆分'
    },
    {
      id: 'R06', name: '大额现金/个人账户收付', step: 'rule', category: '资金流向异常',
      view: 'abnormal_time_channel', weight: 15, defaultGrade: 'high',
      param: { amount: 300000 },
      logic: (p) => `交易渠道为现金/个人卡，或对方户名含"个人"字样，且金额 >= ${(p.amount / 10000).toFixed(0)} 万元`,
      reason: (p) => `大额资金通过现金或个人账户渠道流转，异常渠道特征明显`,
      falsePositive: '零星采购备用金、员工借款还款等确有个人收付的合规场景',
      action: '调取收付款凭证、现金日记账及个人账户归属证明，核实收款人身份'
    },
    {
      id: 'R07', name: '银行流水无账面凭证', step: 'rule', category: '账实不符',
      view: 'cash_mismatch', weight: 15, defaultGrade: 'high',
      param: { amount: 300000 },
      logic: (p) => `bank_transactions.voucher_id IS NULL 或对应凭证不存在，且金额 >= ${(p.amount / 10000).toFixed(0)} 万元`,
      reason: () => '银行流水金额较大但未挂接会计凭证，账实可能不一致',
      falsePositive: '跨月未达账项、银行手续费自动扣划等暂未入账情形',
      action: '核对银行对账单与银行存款日记账，确认未达账项的入账时点与原因'
    },
    {
      id: 'R08', name: '账面无银行流水支撑', step: 'rule', category: '账实不符',
      view: 'cash_mismatch', weight: 15, defaultGrade: 'high',
      param: { amount: 1000000 },
      logic: (p) => `bank_transactions.matched=0（账面已记、银行未达）且金额 >= ${(p.amount / 10000).toFixed(0)} 万元`,
      reason: () => '账面记录的资金收付未取得银行流水印证，存在账实不符迹象',
      falsePositive: '期末在途资金、银行系统延迟反馈',
      action: '取得银行对账单与余额调节表，逐笔核对未达账项'
    },
    {
      id: 'R09', name: '采购订单无入库记录', step: 'rule', category: '单据链断裂',
      view: 'cash_mismatch', weight: 12, defaultGrade: 'high',
      param: { amount: 1000000 },
      logic: (p) => `pur_orders 无对应 pur_receipts、且状态非"已下单"，金额 >= ${(p.amount / 10000).toFixed(0)} 万元`,
      reason: () => '采购订单已标记完成/已入库，但库房无对应入库单据，存在"有票无货"或虚假入库可能',
      falsePositive: '直发客户（越库）业务、系统间单据延迟同步',
      action: '调阅入库单、验收单与仓储物流单据，确认货物是否实际入库'
    },
    {
      id: 'R10', name: '进项发票无入库支撑', step: 'rule', category: '单据链断裂',
      view: 'cash_mismatch', weight: 15, defaultGrade: 'high',
      param: {},
      logic: () => 'tax_invoice_pool(进项) 的 source_ref 无法匹配 pur_receipts.receipt_no',
      reason: () => '取得进项发票但无对应验收入库记录，存在无真实交易的虚开风险',
      falsePositive: '服务类采购、无形资产采购本无实物入库单',
      action: '核对该发票对应合同与服务成果交付证明，联系供应商函证交易真实性'
    },
    {
      id: 'R11', name: '发票金额与订单金额不符', step: 'rule', category: '单据链断裂',
      view: 'cash_mismatch', weight: 12, defaultGrade: 'high',
      param: { tolerance: 1 },
      logic: (p) => `|发票价税合计 - 采购订单价税合计| > ${p.tolerance}`,
      reason: () => '发票价税合计与采购订单价税合计存在差异，票款不符',
      falsePositive: '部分开票、价格调整、运费单独结算',
      action: '索取开票明细与调价协议，核对差额的业务依据'
    },
    {
      id: 'R12', name: '单据日期倒挂', step: 'rule', category: '单据链断裂',
      view: 'cash_mismatch', weight: 10, defaultGrade: 'medium',
      param: {},
      logic: () => '入库日期早于订单日期，或开票日期早于入库日期',
      reason: () => '单据日期先后顺序倒挂（订单≤入库≤发票），流程控制失效',
      falsePositive: '系统补录、紧急放行后补单',
      action: '核对原始纸质单据的签批时间，确认倒挂原因与补录审批'
    },
    {
      id: 'R13', name: '报销金额与凭证不符', step: 'rule', category: '账实不符',
      view: null, weight: 10, defaultGrade: 'medium',
      param: { tolerance: 1 },
      logic: (p) => `|oa_expense_reports.amount - gl_vouchers.total_debit| > ${p.tolerance}`,
      reason: () => 'OA 报销金额与对应记账凭证金额不一致',
      falsePositive: '报销单与凭证按净额入账、含税价与不含税价差异',
      action: '调阅报销单附件、发票与凭证分录，核对差异金额构成'
    },
    {
      id: 'R14', name: '凭证金额与银行流水不符', step: 'rule', category: '账实不符',
      view: 'cash_mismatch', weight: 12, defaultGrade: 'medium',
      param: { tolerance: 1 },
      logic: (p) => `|bank_transactions.amount - gl_vouchers.total_debit| > ${p.tolerance}`,
      reason: () => '银行流水金额与挂接的记账凭证金额不一致',
      falsePositive: '一笔凭证汇总多笔流水、手续费单独入账',
      action: '逐笔核对银行流水与凭证分录，确认差异是否为汇总记账'
    },
    {
      id: 'R15', name: '大额采购单价偏离基准价', step: 'rule', category: '采购异常',
      view: 'related_party_concentration', weight: 12, defaultGrade: 'medium',
      param: { ratio: 1.5, minAmount: 500000 },
      logic: (p) => `pur_order_items.unit_price > products.unit_price × ${p.ratio} 且订单金额 >= ${(p.minAmount / 10000).toFixed(0)} 万元`,
      reason: (p) => `采购单价高于物料基准价 ${p.ratio} 倍以上，存在价格不公允可能`,
      falsePositive: '紧急采购、特殊规格、小批量加价',
      action: '取得同期同类物料采购比价单与市场报价，核价差合理性'
    },
    {
      id: 'R16', name: '供应商主数据不完整', step: 'rule', category: '采购异常',
      view: null, weight: 6, defaultGrade: 'medium',
      param: {},
      logic: () => '供应商纳税人识别号/联系电话/地址为空或不符合法定格式（税号非 18 位或 15 位）',
      reason: () => '供应商准入资料不完整或税号异常，存在空壳供应商风险',
      falsePositive: '境外供应商、个体工商户等证照编码规则不同',
      action: '通过企业信用信息公示系统核验供应商工商登记与经营状态'
    },
    {
      id: 'R17', name: '同一供应商长期单一对接人', step: 'rule', category: '不相容职务',
      view: null, weight: 8, defaultGrade: 'medium',
      param: { minOrders: 8 },
      logic: (p) => `同一 maker（制单人）对同一供应商下单 >= ${p.minOrders} 笔`,
      reason: () => '同一采购经办人长期专属对接同一供应商，缺少岗位轮换与交叉复核',
      falsePositive: '专属品类采购、集中采购岗位设置',
      action: '核对采购岗位职责分工、轮岗记录与二次复核签字'
    },
    {
      id: 'R18', name: '研发工时异常', step: 'rule', category: '费用异常',
      view: null, weight: 5, defaultGrade: 'low',
      param: { hours: 24 },
      logic: (p) => `rd_timesheets.hours > ${p.hours}（单日）`,
      reason: (p) => `单日填报研发工时超过 ${p.hours} 小时，工时分摊真实性存疑`,
      falsePositive: '跨日连续作业、集中补录工时',
      action: '核对考勤记录与研发项目周报，确认工时填报依据'
    },
    {
      id: 'R19', name: '月末报销集中提交', step: 'rule', category: '费用异常',
      view: null, weight: 5, defaultGrade: 'low',
      param: { lastDays: 2, amount: 50000 },
      logic: (p) => `oa_expense_reports.submit_date 落在每月最后 ${p.lastDays} 天且金额 >= ${(p.amount / 10000).toFixed(0)} 万元`,
      reason: (p) => `付款或报销发生在会计期间最后 ${p.lastDays} 天，且单笔金额较大，存在跨期调节或突击报销可能`,
      falsePositive: '差旅返回后集中报销、月度统一提交',
      action: '抽查期末报销单的消费凭证日期与审批链完整性'
    },
    {
      id: 'R20', name: '关联方收款占比异常', step: 'rule', category: '关联方集中',
      view: 'round_trip', weight: 10, defaultGrade: 'medium',
      param: { ratio: 0.1 },
      logic: (p) => `同一对手方收款占比 > ${(p.ratio * 100).toFixed(0)}%，且该对手方在付款侧同样存在`,
      reason: () => '同一对手方同时存在大额收付，存在资金回流或过桥交易可能',
      falsePositive: '正常购销双向业务、委托加工',
      action: '梳理该对手方全部收付流水，绘制资金路径图，核对双向业务合同'
    },

    /* ---------- 第二步：指标/比率分析 ---------- */
    {
      id: 'M01', name: '毛利率异常', step: 'metric', category: '指标比率',
      view: null, weight: 12, defaultGrade: 'medium',
      param: { threshold: 0.05, deviation: 2 },
      logic: (p) => `月度毛利率与期间均值偏离超过 ${p.deviation} 个标准差`,
      reason: () => '毛利率出现异常波动，与同期间平均水平显著偏离',
      falsePositive: '产品结构调整、原材料价格大幅波动',
      action: '拆解毛利率变动的量价因素，核对成本结转口径'
    },
    {
      id: 'M02', name: '费用率异常', step: 'metric', category: '指标比率',
      view: null, weight: 8, defaultGrade: 'low',
      param: { deviation: 2 },
      logic: (p) => `期间费用率与均值偏离超过 ${p.deviation} 个标准差`,
      reason: () => '费用率异常波动，存在费用跨期或虚列费用可能',
      falsePositive: '经营季节性、一次性专项支出',
      action: '按费用类型拆解变动，核对大额费用原始凭证'
    },
    {
      id: 'M03', name: '应收周转异常', step: 'metric', category: '指标比率',
      view: null, weight: 8, defaultGrade: 'low',
      param: { deviation: 2 },
      logic: () => '应收账款周转天数显著延长',
      reason: () => '应收账款周转明显放缓，存在收入虚增或回款异常可能',
      falsePositive: '信用政策调整、下游行业景气下行',
      action: '核对账龄分析与回款流水，对重点客户执行余额函证'
    },
    {
      id: 'M04', name: '票款不一致率', step: 'metric', category: '指标比率',
      view: 'cash_mismatch', weight: 10, defaultGrade: 'medium',
      param: { rate: 0.02 },
      logic: (p) => `发票与订单金额不一致笔数占比 > ${(p.rate * 100).toFixed(0)}%`,
      reason: () => '票款不一致率超过参考阈值，单据勾稽质量偏低',
      falsePositive: '分期开票、运费价外费用',
      action: '按供应商汇总不一致笔数，优先核查高占比供应商'
    },
    {
      id: 'M05', name: '现金/个人渠道交易占比', step: 'metric', category: '指标比率',
      view: 'abnormal_time_channel', weight: 12, defaultGrade: 'high',
      param: { rate: 0.01 },
      logic: (p) => `现金或个人账户收付笔数占比 > ${(p.rate * 100).toFixed(0)}%`,
      reason: () => '非对公渠道资金占比偏高，存在账外收付可能',
      falsePositive: '零售、零星支出等小额现金业务',
      action: '统计非对公渠道明细，核对现金日记账与备用金台账'
    },
    {
      id: 'M06', name: '银企差异率', step: 'metric', category: '指标比率',
      view: 'cash_mismatch', weight: 10, defaultGrade: 'medium',
      param: { rate: 0.01 },
      logic: (p) => `银行流水与账面金额不一致笔数占比 > ${(p.rate * 100).toFixed(0)}%`,
      reason: () => '银行流水与账面凭证差异率偏高，账实一致性不足',
      falsePositive: '汇总记账、手续费单列',
      action: '编制银行存款余额调节表，逐笔核实未达账项'
    },
    {
      id: 'M07', name: '非工作日交易占比', step: 'metric', category: '指标比率',
      view: 'abnormal_time_channel', weight: 6, defaultGrade: 'low',
      param: { rate: 0.15 },
      logic: (p) => `非工作日交易笔数占比 > ${(p.rate * 100).toFixed(0)}%`,
      reason: () => '非工作日交易占比高于参考水平',
      falsePositive: '银行批量代扣、系统自动处理',
      action: '抽取非工作日大额交易核对审批时间'
    },

    /* ---------- 第三步：关联图谱与模型复核 ---------- */
    {
      id: 'G01', name: '资金回流闭环', step: 'graph', category: '资金流向异常',
      view: 'round_trip', weight: 20, defaultGrade: 'high',
      param: { windowDays: 90, tolerance: 0.7 },
      logic: (p) => `付款后 ${p.windowDays} 天内同一对手方向本公司回款，金额在付款额的 ±${((1 - p.tolerance) * 100).toFixed(0)}% 区间`,
      reason: (p) => `资金付给对方后在 ${p.windowDays} 天内又流回，形成资金环流路径`,
      falsePositive: '正常购销双向业务、保证金退回、代垫款归还',
      action: '调取双方全部收付流水，确认资金路径与实际业务背景，访谈经办人'
    },
    {
      id: 'G02', name: '共用联系方式/地址', step: 'graph', category: '疑似关联交易',
      view: 'related_party_concentration', weight: 15, defaultGrade: 'high',
      param: {},
      logic: () => '多个供应商之间，或供应商与客户之间，共用联系电话/地址',
      reason: () => '不同交易对手共用联系方式或地址，提示存在同一控制下的关联关系',
      falsePositive: '同一园区的关联企业、代理记账机构统一登记地址',
      action: '调取工商登记信息与股权穿透图，核实实际控制人与注册地址'
    },
    {
      id: 'G03', name: '内部人员与交易对手重名', step: 'graph', category: '疑似关联交易',
      view: 'related_party_concentration', weight: 15, defaultGrade: 'high',
      param: { sensitivePositions: ['采购', '财务', '资金', '出纳', '总裁', '总经理', '总监', '董事', '审批', '库管', '仓储'] },
      reason: () => '供应商/客户的联系人与本公司员工姓名一致，存在人员关联可能',
      logic: (p) => `交易对手 contact 与 employees.emp_name 相同（敏感岗位优先）`,
      falsePositive: '常见姓名重名',
      action: '核验交易对手联系人的身份证件与任职关系，通过访谈确认'
    },
    {
      id: 'G04', name: '同一实际控制人密集往来', step: 'graph', category: '疑似关联交易',
      view: 'related_party_concentration', weight: 12, defaultGrade: 'medium',
      param: { ratio: 0.15 },
      logic: (p) => `疑似关联对手方（共用信息/人员关联）合计收付占比 > ${(p.ratio * 100).toFixed(0)}%`,
      reason: () => '疑似关联对手方之间的资金往来高度集中',
      falsePositive: '集团内部交易、长期战略合作',
      action: '编制关联方清单，与关联交易披露口径核对'
    },
    {
      id: 'G05', name: '付款由同一账户集中完成', step: 'graph', category: '不相容职务',
      view: null, weight: 8, defaultGrade: 'low',
      param: {},
      logic: () => '大额付款集中通过单一银行账户办理',
      reason: () => '资金集中通过单一账户收付，账户权限集中',
      falsePositive: '公司仅开立基本户集中管理',
      action: '核对网银 U 盾、复核权限与资金审批制度的执行情况'
    },
    {
      id: 'G06', name: '制单审核同一人', step: 'graph', category: '不相容职务',
      view: null, weight: 12, defaultGrade: 'high',
      param: {},
      logic: () => 'gl_vouchers.maker = reviewer（制单人与审核人为同一人）',
      reason: () => '凭证制单与审核未分离，不相容职务混岗',
      falsePositive: '小规模单位人员少、系统对同一人的特殊授权',
      action: '核对岗位说明书与系统权限配置，检查是否存在授权替代审批'
    },
    {
      id: 'G07', name: '审批链不完整', step: 'graph', category: '内控缺陷',
      view: null, weight: 10, defaultGrade: 'medium',
      param: { minSteps: 2 },
      logic: (p) => `oa_expense_reports 的审批记录数 < ${p.minSteps} 或有驳回后仍通过`,
      reason: () => '报销单据审批链不完整或存在补签',
      falsePositive: '小额费用简化审批流程',
      action: '调阅 OA 审批日志与纸质审批单，核对审批人授权范围'
    }
  ];

  const RULE_MAP = RULES.reduce((m, r) => { m[r.id] = r; return m; }, {});

  /* 资金流向异常分析 5 视角 */
  const FUND_VIEWS = {
    round_trip: { name: '资金回流', desc: '付款方与回款方存在路径闭环或时间邻近的资金回流' },
    split_payment: { name: '拆分付款', desc: '同一收款方/同一事项在短周期内被拆分为多笔，单笔低于审批阈值' },
    abnormal_time_channel: { name: '异常时间与渠道', desc: '非工作日/非营业时间交易、异常渠道（大额个人卡/现金）、渠道分布偏离' },
    related_party_concentration: { name: '关联方集中', desc: '资金在疑似关联方之间高度集中' },
    cash_mismatch: { name: '票款/账实不符', desc: '发票、合同、订单、入库、付款、银行流水之间金额或时间不匹配' }
  };

  /* 关联交易识别口径 */
  const RELATED_PARTY_BASIS = {
    equity: { name: '股权关联', desc: '共同股东、投资关系、同一法人代表' },
    person: { name: '人员关联', desc: '同一法人、董监高、财务负责人、经办人重合' },
    substance: { name: '实质控制', desc: '同一地址/联系方式/银行账户/开票信息、价格显著偏离公允、无商业实质的资金往来' }
  };

  /* ============================================================
   * 3. 评分卡 + 舞弊三角
   * ============================================================ */
  const SCORECARD = {
    pressure: {
      name: '压力', desc: '业绩对赌/考核压力、异常资金需求、个人负债或消费异常（仅基于可得数据提示）', weight: 30,
      items: [
        { id: 'P1', name: '业绩/考核压力迹象', weight: 10, basis: '期间业绩目标与实际完成率差异，或临近期末集中确认收入',
          ruleRefs: ['R04', 'R19', 'M01'] },
        { id: 'P2', name: '异常资金需求迹象', weight: 10, basis: '大额资金短期内反复进出、非经营性往来频繁',
          ruleRefs: ['R07', 'R08', 'G01'] },
        { id: 'P3', name: '关联方重大往来', weight: 10, basis: '疑似关联对手方之间存在大额资金往来',
          ruleRefs: ['G02', 'G03', 'G04'] }
      ]
    },
    opportunity: {
      name: '机会', desc: '不相容职务未分离、审批越权或补签、单一人员长期对接同一供应商/客户、供应商准入资料不全、系统权限集中', weight: 45,
      items: [
        { id: 'O1', name: '不相容职务未分离', weight: 15, basis: '制单人与审核人重合、付款申请与执行同人',
          ruleRefs: ['G06', 'G05'] },
        { id: 'O2', name: '单一人员长期对接同一对手方', weight: 10, basis: '同一经办人对同一供应商长期下单/经办',
          ruleRefs: ['R17'] },
        { id: 'O3', name: '供应商准入资料不全', weight: 8, basis: '供应商税号/电话/地址缺失或格式异常',
          ruleRefs: ['R16'] },
        { id: 'O4', name: '审批链不完整或补签', weight: 7, basis: '审批记录缺失、次数不足、驳回后仍通过',
          ruleRefs: ['G07'] },
        { id: 'O5', name: '单据勾稽缺失', weight: 5, basis: '订单-入库-发票-付款链条任一环节缺失',
          ruleRefs: ['R09', 'R10', 'R12'] }
      ]
    },
    rationalization: {
      name: '借口/合理化', desc: '仅作为提示项，无数据支撑时必须写明"无数据支撑，需调查人员访谈判断"', weight: 25,
      items: [
        { id: 'X1', name: '价格偏离解释合理性待核', weight: 10, basis: '采购单价显著偏离基准价但缺乏调价审批',
          ruleRefs: ['R15'] },
        { id: 'X2', name: '资金用途说明不充分', weight: 10, basis: '摘要简短、无合同/事由支撑的资金往来',
          ruleRefs: ['R07', 'R08'] },
        { id: 'X3', name: '管理层干预迹象', weight: 5, basis: '无数据支撑，需调查人员访谈判断',
          ruleRefs: [] }
      ]
    }
  };

  /* 评分分级阈值 */
  const SCORE_BANDS = [
    { min: 70, key: 'high', label: '高度可疑', advice: '高度可疑，建议优先核查' },
    { min: 40, key: 'medium', label: '中度可疑', advice: '中度可疑，建议纳入核查计划' },
    { min: 0, key: 'low', label: '低度可疑', advice: '低度可疑，建议常规抽查' }
  ];

  /* ============================================================
   * 4. 证据核对方法
   * ============================================================ */
  const EVIDENCE_METHODS = {
    three_way_match: {
      name: '三单匹配', desc: '采购订单/订单行 ↔ 入库单 ↔ 进项发票，比对数量、单价、金额、税额、日期顺序',
      tables: ['pur_orders', 'pur_order_items', 'pur_receipts', 'tax_invoice_pool'],
      human: '差异是差错还是舞弊迹象'
    },
    voucher_sampling: {
      name: '凭证抽凭', desc: '按金额分层、随机、异常特征三种策略抽样，核对 source_system / source_ref 能否追溯业务单据',
      tables: ['gl_vouchers', 'gl_voucher_entries'],
      human: '无法追溯的原因与原凭证的完整性'
    },
    cross_system_compare: {
      name: '跨系统比对', desc: 'OA报销 ↔ 总账凭证 ↔ 银行付款，校验审批链完整性、金额一致性、审批人与收款人重合',
      tables: ['oa_expense_reports', 'oa_approval_records', 'gl_vouchers', 'bank_transactions', 'employees'],
      human: '差异性质判断、是否需外部取证'
    },
    bank_book_reconcile: {
      name: '银企对账', desc: '银行流水 ↔ 记账凭证，校验凭证挂接与 matched 状态，输出未达账项与长期未匹配项',
      tables: ['bank_transactions', 'gl_vouchers', 'gl_voucher_entries', 'bank_accounts'],
      human: '未达账项是否合理、是否需函证'
    },
    external_confirmation: {
      name: '外部函证', desc: '生成函证资料清单与要素初稿（往来余额、交易额、期间、回函地址）',
      tables: ['suppliers', 'customers', 'bank_transactions', 'pur_orders', 'sal_orders', 'bank_accounts'],
      human: '是否对外发函、函证结果采纳'
    }
  };

  /* ============================================================
   * 5. 关联链条（数据聚合用）
   * ============================================================ */
  const CHAINS = {
    purchase: {
      name: '采购付款链', tables: ['pur_orders', 'pur_order_items', 'pur_receipts', 'tax_invoice_pool', 'gl_vouchers', 'gl_voucher_entries', 'bank_transactions'],
      desc: 'pur_orders → pur_order_items → pur_receipts → tax_invoice_pool → gl_vouchers → gl_voucher_entries → bank_transactions'
    },
    sales: {
      name: '销售收款链', tables: ['sal_orders', 'sal_order_items', 'sal_deliveries', 'tax_invoice_pool', 'gl_vouchers', 'bank_transactions'],
      desc: 'sal_orders → sal_order_items → sal_deliveries → tax_invoice_pool → gl_vouchers → bank_transactions'
    },
    expense: {
      name: '费用报销链', tables: ['oa_expense_reports', 'oa_approval_records', 'gl_vouchers', 'bank_transactions'],
      desc: 'oa_expense_reports → oa_approval_records → gl_vouchers → bank_transactions'
    },
    fund: {
      name: '资金流链', tables: ['bank_accounts', 'bank_transactions', 'gl_vouchers'],
      desc: 'bank_accounts → bank_transactions → gl_vouchers'
    },
    rd: {
      name: '研发投入链', tables: ['projects', 'rd_timesheets', 'cost_centers', 'gl_voucher_entries'],
      desc: 'projects → rd_timesheets → cost_centers → gl_voucher_entries'
    },
    tax: {
      name: '税务申报链', tables: ['tax_invoice_pool', 'tax_vat_declarations', 'gl_vouchers'],
      desc: 'tax_invoice_pool → tax_vat_declarations → gl_vouchers'
    }
  };

  /* ============================================================
   * 6. 问答词典（关键词/规则匹配 + 口径字典）
   * ============================================================ */
  const QA_TOPICS = [
    {
      id: 'qa_disclaimer', title: 'AI 辅助边界与免责', scope: '在范围内',
      keywords: ['免责', '声明', '不构成', '边界', '辅助范围', '能不能下结论', '定性', '结论'],
      answer: '本助理仅提供线索与提示，不做调查结论、不做责任认定、不做定性判断。所有输出均为"辅助材料"，报告初稿固定标注"AI辅助生成、不构成调查结论"，并预留复核签字位。',
      refs: { tables: [], rules: [] }
    },
    {
      id: 'qa_methods', title: '风险信号识别三步法', scope: '在范围内',
      keywords: ['三步', '方法', '识别', '规则初筛', '指标', '图谱', 'hybrid'],
      answer: '风险信号识别采用 hybrid_three_step 三步法，按序执行并分别标注：①第一步规则阈值初筛（R01–R20），输出命中项与命中理由；②第二步指标/比率分析（M01–M07），计算毛利率、费用率、应收周转、票款不一致率、现金交易占比、银企差异率等偏离度；③第三步关联图谱与模型复核（G01–G07），基于主体-账户-单据关联图识别环状资金流、共用联系方式、实控人密集往来等辅助复核信号。',
      refs: { tables: ['bank_transactions', 'gl_vouchers', 'pur_orders', 'tax_invoice_pool'], rules: ['R01', 'M01', 'G01'] }
    },
    {
      id: 'qa_fund_views', title: '资金流向异常 5 视角', scope: '在范围内',
      keywords: ['资金流向', '资金回流', 'round_trip', '拆分付款', 'split', '异常渠道', '关联方集中', '票款'],
      answer: '资金流向异常分析启用 5 个视角，全部启用：round_trip 资金回流、split_payment 拆分付款、abnormal_time_channel 异常时间与渠道、related_party_concentration 关联方集中、cash_mismatch 票款/账实不符。每个视角均给出命中依据与可能误报说明。',
      refs: { tables: ['bank_transactions'], rules: ['G01', 'R05', 'R03', 'R02', 'R14'] }
    },
    {
      id: 'qa_related', title: '关联交易认定口径', scope: '在范围内',
      keywords: ['关联方', '关联交易', '股权', '实质控制', '口径', 'equity', 'person'],
      answer: '采用 equity_person_substance 口径，分三层：股权关联（共同股东/投资关系）、人员关联（同一法人、董监高、财务负责人、经办人重合）、实质控制（同一地址/联系方式/银行账户/开票信息、价格显著偏离公允、无商业实质的资金往来）。命中前两层标记为"关联交易"线索，仅命中第三层标记为"疑似关联交易（待人工确认）"，并附命中依据类型与可能误报原因。',
      refs: { tables: ['suppliers', 'customers', 'employees'], rules: ['G02', 'G03', 'G04'] }
    },
    {
      id: 'qa_score', title: '可疑度评分口径', scope: '在范围内',
      keywords: ['评分', '分值', '打分', '评分卡', '三角', 'score', '70', '40', '分级', '等级', '阈值', '怎么定', '如何确定', '怎么算'],
      answer: '采用 scorecard_plus_triangle：评分卡负责量化（压力30分、机会45分、借口25分，各维度含若干指标与权重），舞弊三角负责解释。总分 ≥70 提示"高度可疑，建议优先核查"；40–69"中度可疑"；<40"低度可疑"；数据不足时输出"信息不足待补充"。权重与阈值可在「规则参数」表单中调整。',
      refs: { tables: ['employees', 'gl_vouchers', 'oa_expense_reports'], rules: ['G06', 'R17'] }
    },
    {
      id: 'qa_evidence', title: '证据核对 5 方法', scope: '在范围内',
      keywords: ['证据', '核对', '三单', '抽凭', '银企', '对账', '函证', '跨系统'],
      answer: '证据核对具备 5 种方法：three_way_match 三单匹配、voucher_sampling 凭证抽凭、cross_system_compare 跨系统比对、bank_book_reconcile 银企对账、external_confirmation 外部函证。全部输出差异明细与待取证清单，外部函证仅生成清单与会要素初稿，需调查人员或审计人员对外发函确认。',
      refs: { tables: ['pur_orders', 'pur_receipts', 'tax_invoice_pool', 'bank_transactions', 'gl_vouchers'], rules: [] }
    },
    {
      id: 'qa_tables', title: '数据表与字段口径', scope: '在范围内',
      keywords: ['数据表', '口径', '字段', '表结构', '26', '几张表', '数据来源'],
      answer: '主数据源为 MySQL 企业后端数据库 datatest，共 26 张表，覆盖主数据（9张）、AIS会计（3张）、OA（2张）、采购（4张）、销售（3张）、银行（2张）、税务（3张）、研发（1张）。演示数据内联于 index.html 的 PRELOAD_DEMO，字段结构与真实表一致。上传的 Excel/CSV 仅在本次会话内使用，不写库。',
      refs: { tables: ALL_TABLES, rules: [] }
    },
    {
      id: 'qa_report', title: '报告章节说明', scope: '在范围内',
      keywords: ['报告', '章节', '结构', '初稿', '多少节'],
      answer: '报告初稿固定 7 节：①报告说明与免责声明（置顶）、②调查背景与范围、③数据来源与分析方法、④风险信号识别结果、⑤可疑线索梳理（含待核查线索清单 6 要素）、⑥证据核对结果与差异说明、⑦待核查事项与建议核查动作（不含结论性建议）。',
      refs: { tables: [], rules: [] }
    },
    {
      id: 'qa_next', title: '下一步建议核查动作', scope: '在范围内',
      keywords: ['下一步', '建议', '怎么做', '核查动作', '待办'],
      answer: '建议按以下顺序推进：①对"高度可疑"线索优先调阅原始单据与审批记录；②对票款不符、单据链断裂事项执行三单匹配复核；③对未达账项编制银行存款余额调节表；④对疑似关联对手方调取工商登记与股权穿透信息；⑤对重点往来余额发起外部函证（需调查人员或审计人员执行）；⑥在「问答与提醒」页跟踪未完成事项。',
      refs: { tables: ['bank_transactions', 'pur_orders', 'tax_invoice_pool'], rules: ['R09', 'R10', 'R14'] }
    },
    {
      id: 'qa_threshold', title: '规则阈值含义', scope: '在范围内',
      keywords: ['阈值', '参数', '多少万', '限额', '权重调整'],
      answer: '规则阈值均可在「规则参数」表单中调整，例如：大额付款阈值（R01，默认 500 万元）、单一供应商付款占比（R02，默认 12%）、非工作日交易（R03，默认 ≥100 万元）、拆分付款金额带（R05，默认 8~10 万元且 30 天内 ≥3 笔）、大额现金/个人账户（R06，默认 ≥20 万元）。调整后需重新运行识别，历史结果不自动重算。',
      refs: { tables: ['bank_transactions'], rules: ['R01', 'R02', 'R03', 'R05', 'R06'] }
    },
    {
      id: 'qa_scope_out', title: '超出范围（需专业判断）', scope: '超出范围',
      keywords: ['是否构成舞弊', '立案', '移交', '责任人', '处分', '处罚', '法律责任', '报警', '追究', '认定', '判定', '要不要报案', '金额损失'],
      answer: '该问题需由调查人员或合规部门专业判断。本助理不提供是否立案、是否扩大调查范围、是否移交、是否构成舞弊、责任人认定、损失金额认定、法律与监管报送、纪律处分等任何判断性意见。',
      refs: { tables: [], rules: [] }
    },
    {
      id: 'qa_compliance', title: '合规性判断（超出范围）', scope: '超出范围',
      keywords: ['合规', '违法', '违规吗', '是否合法', '条款', '处罚依据'],
      answer: '关于是否违规、是否违法、适用哪条法规条款的结论，需由调查人员或合规部门专业判断。本助理只能说明分析规则与数据口径，不作出合规结论。',
      refs: { tables: [], rules: [] }
    }
  ];

  /* ============================================================
   * 7. 同义词词典（实体解析用）
   * ============================================================ */
  const ENTITY_SYNONYMS = {
    供应商: ['供应商', '供货商', '供货方', 'vendor', 'supplier'],
    客户: ['客户', '购买方', 'customer'],
    员工: ['员工', '职工', '经办人', 'employee'],
    采购: ['采购', '订货', '买', 'pur'],
    付款: ['付款', '支付', '付', 'payment'],
    收款: ['收款', '回款', '收到', 'receipt'],
    发票: ['发票', '票', 'invoice'],
    入库: ['入库', '收货', '验收', 'receipt'],
    报销: ['报销', '费用', 'expense'],
    凭证: ['凭证', '记账', 'voucher'],
    银行: ['银行流水', '流水', '账号', '账户', 'bank'],
    金额: ['金额', '金额区间', '元以上', '万元']
  };

  /* ============================================================
   * 7.1 自然语言调查意图解析（chat 触发方式）
   *
   * 纯规则/词典匹配，不使用任何模型服务：从一句话中抽取
   *   主体（供应商/客户/员工）+ 期间 + 金额区间 + 聚合链条，
   * 供「数据聚合台」等模块回填表单条件。
   * ============================================================ */

  /** 复合链条关键词：按"业务链 → 应启用的链条集合"映射 */
  const CHAIN_KEYWORDS = [
    { re: /采购|付款|进货|供货|供应商|采购付款|采购与付款/i, chains: ['purchase'] },
    { re: /销售|收款|回款|客户|销售收款|销货/i, chains: ['sales'] },
    { re: /报销|费用|差旅|招待|expense/i, chains: ['expense'] },
    { re: /资金流|流水|银行|转账|划款|资金往来/i, chains: ['fund'] },
    { re: /研发|工时|项目投入|rd/i, chains: ['rd'] },
    { re: /税务|申报|增值税|进项|销项|发票|税/i, chains: ['tax'] }
  ];

  /** 中文数字月份/期间识别：2024年、2024年度、2024年1季度、2024-01 ~ 2024-06 等 */
  function parsePeriod(text) {
    const s = String(text || '');
    let from = '', to = '';
    /* 明确区间：2024-01-01 至 2024-06-30 / 2024年1月至6月 */
    const iso = s.match(/(\d{4})[-/年](\d{1,2})[-/月]?(\d{1,2})?日?\s*(?:至|到|~|-|—|—)\s*(\d{4})?[-/年]?(\d{1,2})[-/月]?(\d{1,2})?/);
    if (iso) {
      const y1 = iso[1], m1 = iso[2].padStart(2, '0'), d1 = (iso[3] || '01').padStart(2, '0');
      const y2 = iso[4] || y1, m2 = iso[5].padStart(2, '0');
      const d2 = iso[6] ? iso[6].padStart(2, '0') : String(new Date(Number(y2), Number(m2), 0).getDate()).padStart(2, '0');
      from = `${y1}-${m1}-${d1}`; to = `${y2}-${m2}-${d2}`;
      return { from, to };
    }
    /* 季度：2024年第2季度 / 2024年二季度 */
    const q = s.match(/(\d{4})\s*年?\s*第?\s*([1-4一二三四])\s*季度/);
    if (q) {
      const y = q[1];
      const qi = '一二三四'.indexOf(q[2]) >= 0 ? '一二三四'.indexOf(q[2]) + 1 : Number(q[2]);
      const sm = (qi - 1) * 3 + 1, em = qi * 3;
      return {
        from: `${y}-${String(sm).padStart(2, '0')}-01`,
        to: `${y}-${String(em).padStart(2, '0')}-${new Date(Number(y), em, 0).getDate()}`
      };
    }
    /* 单月：2024年3月 */
    const m = s.match(/(\d{4})\s*年\s*(\d{1,2})\s*月/);
    if (m) {
      const y = m[1], mm = m[2].padStart(2, '0');
      return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${new Date(Number(y), Number(mm), 0).getDate()}` };
    }
    /* 整年：2024年 / 2024年度 / 全文 2024 */
    const y = s.match(/(20\d{2})\s*年?(?:度|全年|整年)?/);
    if (y) return { from: `${y[1]}-01-01`, to: `${y[1]}-12-31` };
    return null;
  }

  /** 金额解析：支持「500万」「300万元以上」「10万到50万之间」「不超过200万」 */
  function parseAmount(text) {
    const s = String(text || '');
    const out = { min: null, max: null };
    const num = (raw, unit) => {
      const v = Number(raw);
      if (!Number.isFinite(v)) return null;
      return /亿/.test(unit || '') ? v * 100000000 : (/万/.test(unit || '') ? v * 10000 : v);
    };
    /* 区间：10万到50万 / 10万-50万 / 10万~50万 */
    const range = s.match(/(\d+(?:\.\d+)?)\s*(亿|万)?\s*(?:元)?\s*(?:到|至|~|-|—)\s*(\d+(?:\.\d+)?)\s*(亿|万)?\s*元?/);
    if (range) {
      out.min = num(range[1], range[2] || range[4]);
      out.max = num(range[3], range[4] || range[2]);
      return out;
    }
    /* 以下 / 不超过 / 小于（先判定「上限」，否则「不超过200万」会被「以上」分支误判） */
    const le = s.match(/(?:不超过|不高于|少于|低于|小于|最多)\s*(\d+(?:\.\d+)?)\s*(亿|万)?\s*元?|(\d+(?:\.\d+)?)\s*(亿|万)\s*元?\s*(?:以下|及以下|以内|之内)/);
    if (le) { out.max = num(le[1] || le[3], le[2] || le[4]); return out; }
    /* 以上 / 不低于 / 超过 */
    const ge = s.match(/(?:不低于|不少于|超过|大于|至少)\s*(\d+(?:\.\d+)?)\s*(亿|万)?\s*元?|(\d+(?:\.\d+)?)\s*(亿|万)\s*元?\s*(?:以上|及以上)/);
    if (ge) out.min = num(ge[1] || ge[3], ge[2] || ge[4]);
    return out;

  }

  /**
   * 解析自然语言调查意图
   * @param {string} text 用户输入，如「聚合A供应商2024年全年的采购与付款数据」
   * @param {object} opts { entities: { supplier:[{code,name}], customer:[], employee:[] } }
   * @returns {{matched:boolean, entityType, entityCode, entityName, period, amount, chains, keywords, note}}
   */
  function parseNaturalQuery(text, opts) {
    const s = String(text || '');
    const o = opts || {};
    const entities = o.entities || {};
    const res = {
      matched: false, entityType: 'all', entityCode: '', entityName: '',
      period: null, amount: null, chains: [], raw: s, note: ''
    };
    if (!s.trim()) return res;

    /* —— 1. 匹配主体：优先按编码精确命中，其次按名称包含 —— */
    const tryKinds = [['supplier', entities.supplier], ['customer', entities.customer], ['employee', entities.employee]];
    for (let i = 0; i < tryKinds.length; i++) {
      const kind = tryKinds[i][0], list = tryKinds[i][1] || [];
      const hit = list.find((x) => x.code && s.toUpperCase().indexOf(String(x.code).toUpperCase()) >= 0) ||
        list.find((x) => x.name && s.indexOf(x.name) >= 0);
      if (hit) {
        res.entityType = kind;
        res.entityCode = hit.code || '';
        res.entityName = hit.name || '';
        break;
      }
    }
    /* 未命中清单时，尝试抽取"XX公司/XX有限公司"这类中文机构名 */
    if (res.entityType === 'all') {
      const m = s.match(/([\u4e00-\u9fa5A-Za-z0-9（）()]{2,30}?(?:有限公司|股份有限公司|公司|集团|事务所|中心))/);
      if (m) {
        res.entityName = m[1];
        res.entityType = /客户/.test(s) ? 'customer' : 'supplier';
      }
    }

    /* —— 2. 期间 —— */
    res.period = parsePeriod(s);
    /* —— 3. 金额 —— */
    const amt = parseAmount(s);
    if (amt.min != null || amt.max != null) res.amount = amt;
    /* —— 4. 链条 —— */
    const chains = [];
    CHAIN_KEYWORDS.forEach((k) => { if (k.re.test(s)) k.chains.forEach((c) => { if (chains.indexOf(c) < 0) chains.push(c); }); });
    /* 「采购与付款」同时命中 purchase/fund 时，以采购付款链为准，避免重复聚合 */
    if (chains.indexOf('purchase') >= 0 && chains.indexOf('fund') >= 0) {
      res.note = '识别到「采购与付款」表述，资金流水已包含在采购付款链中，未重复启用资金流链';
      res.chains = chains.filter((c) => c !== 'fund');
    } else {
      res.chains = chains;
    }

    res.matched = !!(res.entityName || res.period || res.chains.length || res.amount);
    return res;
  }

  /* ============================================================
   * 7.2 上传辅助数据（upload 交互方式）
   *
   * 用户上传的 Excel/CSV 仅在本次会话内使用，不写库、不上传外部。
   * 支持列名映射到内置口径，用于补充「举报材料整理表」「外部对账单」等。
   * ============================================================ */
  const UPLOAD_COLUMN_MAP = {
    主体: ['主体', '主体名称', '供应商', '客户', '员工', '对方户名', '单位', '名称', 'entity'],
    编码: ['编码', '主体编码', '供应商编码', '客户编码', '工号', 'code'],
    日期: ['日期', '交易日期', '业务日期', '时间', 'date'],
    金额: ['金额', '交易金额', '发生额', 'amount'],
    单据号: ['单据号', '凭证号', '发票号', '单号', 'no'],
    摘要: ['摘要', '事由', '说明', '备注', 'summary'],
    类型: ['类型', '收付类型', '方向', 'type']
  };

  /** 规范化一行上传数据（列名 → 内置口径） */
  function normalizeUploadRow(row) {
    const out = {};
    Object.keys(UPLOAD_COLUMN_MAP).forEach((canon) => {
      const aliases = UPLOAD_COLUMN_MAP[canon];
      const key = Object.keys(row).find((k) => aliases.some((a) => String(k).trim().toLowerCase() === a.toLowerCase()));
      if (key != null && row[key] != null && String(row[key]).trim() !== '') out[canon] = row[key];
    });
    if (out.金额 != null) {
      const n = Number(String(out.金额).replace(/[,\s￥¥元]/g, ''));
      out.金额 = Number.isFinite(n) ? n : out.金额;
    }
    if (out.日期 != null) out.日期 = String(out.日期).slice(0, 10);
    return out;
  }

  /* ============================================================
   * 8. 演示示例（测试示例页）
   * ============================================================ */
  const DEMO_EXAMPLES = [
    {
      id: 'EX01', group: '数据聚合', title: '聚合可疑供应商S028 2026年度采购与付款数据',
      desc: '从采购订单、入库、发票、凭证、银行流水按链条聚合，输出统一口径底稿与数据完整度校验。',
      module: 'aggregate',
      payload: { entityType: 'supplier', entityCode: 'S028', entityName: '安徽宏远机电设备有限公司', periodFrom: '2026-01-01', periodTo: '2026-12-31', minAmount: 0, chains: ['purchase'] }
    },
    {
      id: 'EX02', group: '风险信号识别', title: '全量运行三步法风险信号识别',
      desc: '规则阈值初筛 → 指标比率分析 → 关联图谱复核，输出信号清单与命中理由。',
      module: 'risk',
      payload: { entityType: 'all', periodFrom: '2026-01-01', periodTo: '2026-12-31' }
    },
    {
      id: 'EX03', group: '风险信号识别', title: '资金流向 5 视角专项分析',
      desc: '资金回流、拆分付款、异常时间渠道、关联方集中、票款不符逐项跑一遍。',
      module: 'risk',
      payload: { entityType: 'all', periodFrom: '2026-01-01', periodTo: '2026-12-31', viewsOnly: ['round_trip', 'split_payment', 'abnormal_time_channel', 'related_party_concentration', 'cash_mismatch'] }
    },
    {
      id: 'EX04', group: '线索梳理', title: '以主体为主线组织待核查线索清单',
      desc: '按涉及主体归集，输出资金/单据/关联方/时间四视图与 6 要素清单。',
      module: 'clue',
      payload: { entityType: 'all', periodFrom: '2026-01-01', periodTo: '2026-12-31' }
    },
    {
      id: 'EX05', group: '可疑度评估', title: '对高度可疑主体计算参考分值',
      desc: '评分卡（压力/机会/借口）+ 舞弊三角解释，输出维度得分与分级建议。',
      module: 'score',
      payload: { entityType: 'supplier', entityCode: 'S028', entityName: '安徽宏远机电设备有限公司', periodFrom: '2026-01-01', periodTo: '2026-12-31' }
    },
    {
      id: 'EX06', group: '证据核对', title: '三单匹配 + 银企对账 + 外部函证清单',
      desc: '一次跑全 5 种核对方法，输出差异明细、覆盖率与待取证清单。',
      module: 'evidence',
      payload: { entityType: 'all', periodFrom: '2026-01-01', periodTo: '2026-12-31', methods: ['three_way_match', 'voucher_sampling', 'cross_system_compare', 'bank_book_reconcile', 'external_confirmation'] }
    },
    {
      id: 'EX07', group: '报告初稿', title: '生成舞弊调查分析报告初稿',
      desc: '固定 7 节结构 + 免责声明 + 人工复核签字位，可导出 HTML/Markdown。',
      module: 'report',
      payload: { entityType: 'all', periodFrom: '2026-01-01', periodTo: '2026-12-31' }
    },
    {
      id: 'EX08', group: '问答与提醒', title: '询问评分卡口径并查看未完成核查事项',
      desc: '问答基于关键词/规则匹配 + 口径字典，提醒列出未完成线索与数据缺口。',
      module: 'qa',
      payload: { question: '可疑度评分卡的分级阈值是怎么定的？' }
    }
  ];

  /* ============================================================
   * 9. 工具
   * ============================================================ */
  function gradeMeta(key) {
    return GRADES[key] || GRADES.unknown;
  }

  /** 过滤禁用定性词，替换为合规表述 */
  function sanitizeText(text) {
    if (text == null) return text;
    let s = String(text);
    const replacements = [
      [/确认存在舞弊/g, '存在风险信号'],
      [/存在舞弊事实/g, '存在需核查的事项'],
      [/构成舞弊/g, '提示需进一步核查'],
      [/系(.*?)所为/g, '该事项涉及主体为$1，需人工核实'],
      [/应当认定为/g, '建议核查是否'],
      [/应认定为/g, '建议核查是否'],
      [/认定为舞弊/g, '提示需核查'],
      [/舞弊成立/g, '产生风险信号'],
      [/证实舞弊/g, '形成风险提示'],
      [/定性为/g, '可初步提示为'],
      [/责任人/g, '相关经办人'],
      [/确系/g, '可能为'],
      [/实为/g, '显示为']
    ];
    replacements.forEach(([re, to]) => { s = s.replace(re, to); });
    return s;
  }

  /** 检测文本是否含禁用定性词 */
  function detectForbidden(text) {
    if (!text) return [];
    const hits = [];
    FORBIDDEN_PHRASES.forEach((p) => { if (String(text).indexOf(p) >= 0) hits.push(p); });
    return hits;
  }

  function fieldLabel(table, field) {
    const meta = TABLE_META[table];
    if (meta && meta.fields && meta.fields[field]) return meta.fields[field];
    return field;
  }

  function money(n) {
    const v = Number(n || 0);
    return v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function wan(n) {
    const v = Number(n || 0) / 10000;
    return v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' 万元';
  }

  return {
    DISCLAIMER_LONG, DISCLAIMER_TOP, CORNER_BADGE, SCORE_DECLARATION, REPORT_COVER_DECLARATION,
    FORBIDDEN_PHRASES, GRADES, GRADE_ORDER,
    TABLE_META, ALL_TABLES, SYSTEM_GROUPS,
    RULES, RULE_MAP, FUND_VIEWS, RELATED_PARTY_BASIS,
    SCORECARD, SCORE_BANDS,
    EVIDENCE_METHODS, CHAINS, QA_TOPICS, ENTITY_SYNONYMS, DEMO_EXAMPLES,
    CHAIN_KEYWORDS, UPLOAD_COLUMN_MAP, parsePeriod, parseAmount, parseNaturalQuery, normalizeUploadRow,
    gradeMeta, sanitizeText, detectForbidden, fieldLabel, money, wan
  };
});
