/**
 * 自检脚本：验证项目完整性与合规约束
 * 用法：node tools/selftest.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
const failures = [];

function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; failures.push(name + (detail ? ' — ' + detail : '')); console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}
function section(t) { console.log('\n' + t); }

console.log('============================================================');
console.log('  无言以队 · 自检');
console.log('============================================================');

/* ---------- 1. 交付文件 ---------- */
section('[1] 交付文件完整性');
const REQUIRED = ['index.html', 'server.js', 'start.bat', 'package.json', 'README.md',
  'app/core.js', 'app/demo.js', 'app/engine.js', 'web/style.css', 'web/runtime.js', 'web/app.js'];
REQUIRED.forEach(function (f) {
  ok(f, fs.existsSync(path.join(ROOT, f)));
});

/* ---------- 2. 26 张表与规则库 ---------- */
section('[2] 数据表与规则库');
const core = require(path.join(ROOT, 'app/core.js'));
ok('26 张业务表已登记', Object.keys(core.TABLE_META).length === 26,
  '实际 ' + Object.keys(core.TABLE_META).length + ' 张');
ok('每张表均有字段口径字典', Object.keys(core.TABLE_META).every(function (t) {
  return Object.keys(core.TABLE_META[t].fields || {}).length > 0;
}));
ok('规则总数 ≥ 30', core.RULES.length >= 30, '实际 ' + core.RULES.length + ' 条');
ok('三步法规则齐备（rule/metric/graph）',
  ['rule', 'metric', 'graph'].every(function (s) {
    return core.RULES.some(function (r) { return r.step === s; });
  }));
ok('资金流向 5 视角齐备', Object.keys(core.FUND_VIEWS).length === 5);
ok('关联交易 3 层口径齐备', Object.keys(core.RELATED_PARTY_BASIS).length === 3);
ok('证据核对 5 方法齐备', Object.keys(core.EVIDENCE_METHODS).length === 5);
ok('舞弊三角 3 维度齐备', Object.keys(core.SCORECARD).length === 3);
ok('评分卡总分 = 100', Object.keys(core.SCORECARD).reduce(function (a, k) {
  return a + core.SCORECARD[k].weight;
}, 0) === 100);

/* ---------- 3. 演示数据集 ---------- */
section('[3] 演示数据集（PRELOAD_DEMO）');
const demo = require(path.join(ROOT, 'app/demo.js'));
const D = demo.build();
ok('覆盖全部 26 张表', Object.keys(core.TABLE_META).every(function (t) {
  return Array.isArray(D[t]);
}), Object.keys(core.TABLE_META).filter(function (t) { return !Array.isArray(D[t]); }).join(',') || '');
ok('行数非空', Object.keys(D).every(function (t) { return D[t].length > 0; }));

/* 外键完整性 */
function fkOk(child, cf, parent) {
  const ids = new Set(D[parent].map(function (r) { return r.id; }));
  return D[child].every(function (r) {
    return r[cf] == null || r[cf] === 0 || ids.has(r[cf]);
  });
}
ok('外键 pur_receipts.po_id', fkOk('pur_receipts', 'po_id', 'pur_orders'));
ok('外键 bank_transactions.voucher_id', fkOk('bank_transactions', 'voucher_id', 'gl_vouchers'));
ok('外键 oa_approval_records.report_id', fkOk('oa_approval_records', 'report_id', 'oa_expense_reports'));
ok('外键 gl_voucher_entries.voucher_id', fkOk('gl_voucher_entries', 'voucher_id', 'gl_vouchers'));

/* 主键唯一 */
ok('各表主键唯一', Object.keys(D).every(function (t) {
  const ids = D[t].map(function (r) { return r.id; });
  return new Set(ids).size === ids.length;
}));

/* 植入样本 */
section('[4] 植入的可疑样本');
const S028 = D.suppliers.filter(function (s) { return s.supplier_code === 'S028'; })[0];
ok('1 个可疑供应商（S028）', !!S028, S028 ? S028.supplier_name : '未找到');
ok('1 个可疑员工被长期单一对接',
  D.pur_orders.filter(function (p) { return p.supplier_code === 'S028' && p.maker === 'EMP031'; }).length >= 8);
const split = {};
D.bank_transactions.forEach(function (t) {
  if (t.tx_type !== '支出') return;
  const k = t.counterparty + '|' + t.tx_date.slice(0, 10);
  split[k] = (split[k] || 0) + 1;
});
ok('拆分付款样例存在', Object.keys(split).some(function (k) { return split[k] >= 3; }),
  '最多同日同对手方 ' + Math.max.apply(null, Object.values(split)) + ' 笔');
ok('资金回流样例存在',
  D.bank_transactions.some(function (t) { return t.counterparty === '沈立国' && t.tx_type === '收入'; }));
ok('三单不匹配样例存在（无入库）',
  D.pur_orders.some(function (p) {
    return !D.pur_receipts.some(function (r) { return r.po_id === p.id; });
  }));
ok('银企未达账项样例存在', D.bank_transactions.some(function (t) { return t.matched === 0; }));
ok('银行流水无凭证样例存在', D.bank_transactions.some(function (t) { return !t.voucher_id; }));
ok('共用联系方式样例存在', (function () {
  const m = {};
  D.suppliers.forEach(function (s) { m[s.phone] = (m[s.phone] || 0) + 1; });
  return Object.keys(m).some(function (k) { return m[k] >= 2; });
})());
ok('供应商准入资料不全样例存在',
  D.suppliers.some(function (s) { return [15, 18, 20].indexOf(String(s.tax_no || '').length) < 0; }));

/* ---------- 5. 引擎输出 ---------- */
section('[5] 引擎输出与合规');
const engine = require(path.join(ROOT, 'app/engine.js'));
const P = { entityType: 'all', periodFrom: '2026-01-01', periodTo: '2026-12-31' };

const risk = engine.riskSignal(D, P);
ok('风险信号识别有输出', risk.total > 0, risk.total + ' 条');
ok('三步法均有命中', ['rule', 'metric', 'graph'].every(function (s) {
  return risk.signals.some(function (x) { return x.step === s; });
}));
ok('资金回流视角命中', risk.signals.some(function (s) { return s.ruleId === 'G01'; }));
ok('拆分付款视角命中', risk.signals.some(function (s) { return s.ruleId === 'R05'; }));
ok('关联交易口径命中', risk.signals.some(function (s) { return (s.ruleId || '').indexOf('G') === 0 && s.basis.length; }));
ok('每条信号含命中理由', risk.signals.every(function (s) { return !!s.reason; }));
ok('每条信号含可能误报说明', risk.signals.every(function (s) { return !!s.falsePositive; }));
ok('每条信号含建议核查动作', risk.signals.every(function (s) { return !!s.action; }));

const cl = engine.clues(D, P, risk);
ok('线索有输出', cl.total > 0, cl.total + ' 条');
ok('线索含 6 要素', cl.clues.every(function (c) {
  return c.触发信号 && c.subject && c.时间范围 && c.证据位置.length && c.建议核查动作.length && c.可疑等级;
}));
ok('线索含四视图', cl.clues.every(function (c) {
  return c.views['资金视图'] && c.views['单据视图'] && c.views['关联方视图'] && c.views['时间视图'];
}));
ok('可疑等级标注为 AI 建议', cl.clues.every(function (c) { return c.可疑等级说明 === 'AI建议，待人工确认'; }));

const sc = engine.score(D, P, risk);
ok('评分有输出', sc.totalScore >= 0 && sc.totalScore <= 100, '分值 ' + sc.totalScore);
ok('评分含强制声明', !!sc.declaration && sc.declaration.indexOf('不构成对舞弊事实的认定') >= 0);
ok('舞弊三角三维度均有解释', sc.triangle.length === 3 && sc.triangle.every(function (t) { return t.desc; }));
ok('借口维度标注需访谈判断',
  sc.triangle.some(function (t) {
    return t.key === 'rationalization' && t.desc.indexOf('访谈判断') >= 0;
  }));

const ev = engine.evidence(D, P);
ok('5 种核对方法均返回', ev.methods.length === 5, '实际 ' + ev.methods.length + ' 种');
ok('核对含覆盖率统计', ev.coverage.length === 5);
ok('三单匹配发现差异', (ev.methods.filter(function (m) { return m.key === 'three_way_match'; })[0] || { coverage: {} }).coverage.hit > 0);
ok('银企对账发现差异', (ev.methods.filter(function (m) { return m.key === 'bank_book_reconcile'; })[0] || { coverage: {} }).coverage.hit > 0);
ok('凭证抽凭发现无法追溯', (ev.methods.filter(function (m) { return m.key === 'voucher_sampling'; })[0] || { coverage: {} }).coverage.hit > 0);
ok('外部函证不触发发送（仅清单）',
  (ev.methods.filter(function (m) { return m.key === 'external_confirmation'; })[0] || {}).notice !== undefined);
ok('待取证清单非空', ev.pending.length > 0, ev.pending.length + ' 项');

const rep = engine.report(D, P, { risk: risk, clues: cl, score: sc, evidence: ev });
ok('报告固定 7 节', rep.sections.length === 7);
ok('报告含固定免责声明', rep.coverDeclaration.indexOf('不构成调查结论') >= 0);
ok('报告含人工复核签字位',
  rep.coverDeclaration.indexOf('复核人（签字）') >= 0 && rep.coverDeclaration.indexOf('调查负责人（签字）') >= 0);
ok('报告通过禁用词自检', rep.forbiddenCheck.passed);
const md = engine.reportToMarkdown(rep);
ok('Markdown 导出可用', md.length > 1000);

const qaIn = engine.qa(D, { question: '可疑度评分卡的分级阈值是怎么定的？' });
ok('问答：范围内问题可答', qaIn.matched && qaIn.scope === '在范围内');
const qaOut = engine.qa(D, { question: '这家公司是否构成舞弊？' });
ok('问答：超范围问题拒答', qaOut.scope === '超出范围' && qaOut.answer.indexOf('专业判断') >= 0);
const qaUnknown = engine.qa(D, { question: '今天天气怎么样' });
ok('问答：未匹配问题给固定提示', !qaUnknown.matched && qaUnknown.answer.indexOf('规则匹配') >= 0);

/* ---------- 5.1 交互方式：chat 自然语言 / upload 文件上传 ---------- */
section('[5.1] 交互方式（chat 自然语言 · upload 文件上传）');
const pi1 = engine.parseIntent(D, { text: '聚合安徽宏远机电设备有限公司2026年全年的采购与付款数据' });
ok('chat：可解析自然语言调查描述', pi1.matched, JSON.stringify(pi1.params));
ok('chat：主体解析为可疑供应商 S028',
  pi1.params.entityType === 'supplier' && pi1.params.entityCode === 'S028',
  JSON.stringify(pi1.params));
ok('chat：期间解析为 2026 全年',
  pi1.params.periodFrom === '2026-01-01' && pi1.params.periodTo === '2026-12-31');
ok('chat：链条解析为采购付款链', (pi1.params.chains || []).indexOf('purchase') >= 0);
ok('chat：无法识别时给出引导而非编造', engine.parseIntent(D, { text: '今天天气怎么样' }).matched === false);
const piQ = engine.parseIntent(D, { text: '2026年第2季度金额50万元以上的银行流水' });
ok('chat：季度与金额区间解析正确',
  piQ.params.periodFrom === '2026-04-01' && piQ.params.periodTo === '2026-06-30' && piQ.params.minAmount === 500000,
  JSON.stringify(piQ.params));
const piLe = engine.parseIntent(D, { text: '2026年不超过200万元的付款' });
ok('chat：金额上限解析正确（不被“以上”误判）', piLe.params.maxAmount === 2000000 && piLe.params.minAmount === undefined);
ok('chat：解析结果含 trace 与 disclaimer', !!pi1.trace && !!pi1.disclaimer);

const up = engine.uploadSummary(D, {
  files: [{ name: '举报材料整理表.csv', type: 'csv',
    rows: [{ '主体': '安徽宏远机电设备有限公司', '日期': '2026-03-05', '金额': '1,234.56', '摘要': '疑似回流' }] }]
});
ok('upload：解析上传文件行数', up.totalRows === 1);
ok('upload：列名映射到内置口径', up.files[0].mappedColumns.indexOf('主体') >= 0 && up.files[0].mappedColumns.indexOf('金额') >= 0);
ok('upload：金额字符串转数值', up.files[0].amountSum === 1234.56, String(up.files[0].amountSum));
ok('upload：标注未识别列', up.files[0].unmappedColumns.length === 0);
ok('upload：输出含溯源轨迹', !!up.trace && Array.isArray(up.trace.uploaded));
ok('upload：空上传给出使用说明', engine.uploadSummary(D, { files: [] }).notes[0].indexOf('不写库') >= 0);

const rm = engine.reminders(D, P, cl, ev);
ok('提醒有输出', rm.items.length > 0, rm.items.length + ' 项');
ok('提醒声明仅本地记录', rm.notice.indexOf('不触发任何对外') >= 0);

/* ---------- 6. 边界铁律 ---------- */
section('[6] 边界铁律（禁用定性词）');
const allOut = JSON.stringify({ risk: risk, cl: cl, sc: sc, ev: ev, rep: rep, md: md, qa: qaIn, pi: pi1, up: up });
const FORBIDDEN = ['确认存在舞弊', '构成舞弊', '系某某所为', '应当认定为', '责任人'];
FORBIDDEN.forEach(function (w) {
  ok('未出现「' + w + '」', allOut.indexOf(w) < 0);
});
ok('分级表述使用高度/中度/低度可疑',
  allOut.indexOf('高度可疑') >= 0 && allOut.indexOf('中度可疑') >= 0);
ok('所有输出含 disclaimer 字段',
  [risk, cl, sc, ev, rep].every(function (x) { return !!x.disclaimer; }));
ok('所有输出含 trace 字段',
  [risk, cl, sc, ev, rep].every(function (x) { return x.trace && Array.isArray(x.trace.tables); }));

/* ---------- 7. SQL 安全闸门 ---------- */
section('[7] SQL 只读闸门');
const server = require(path.join(ROOT, 'server.js'));
const g = server.guardSQL;
ok('合法 SELECT 通过', g('SELECT * FROM suppliers LIMIT 5').ok);
ok('UPDATE 拒绝', !g('UPDATE suppliers SET a=1').ok);
ok('DELETE 拒绝', !g('DELETE FROM suppliers').ok);
ok('DROP 拒绝', !g('DROP TABLE suppliers').ok);
ok('TRUNCATE 拒绝', !g('TRUNCATE TABLE suppliers').ok);
ok('INSERT 拒绝', !g('INSERT INTO suppliers VALUES(1)').ok);
ok('GRANT 拒绝', !g('GRANT ALL ON *.* TO x').ok);
ok('多语句拒绝', !g('SELECT 1; DELETE FROM suppliers').ok);
ok('注释绕过拒绝', !g('SELECT * FROM suppliers /*x*/ ; DELETE FROM suppliers').ok);
ok('非白名单表拒绝', !g('SELECT * FROM mysql.user').ok);
ok('information_schema 拒绝', !g('SELECT * FROM information_schema.tables').ok);
ok('LOAD_FILE 拒绝', !g("SELECT LOAD_FILE('/etc/passwd')").ok);
ok('无 LIMIT 自动补齐', /LIMIT 5000/i.test(g('SELECT * FROM customers').sql || ''));
ok('上限表数量与文档一致', server.ALLOWED_TABLES.size === 26);

/* ---------- 8. 前端凭据泄漏 ---------- */
section('[8] 凭据不泄漏到前端');
const SECRETS = ['StrongPass123', '115.190.168.89', 'readonly_user'];
const FRONT = ['index.html', 'web/app.js', 'web/runtime.js', 'web/style.css', 'app/core.js', 'app/demo.js', 'app/engine.js'];
FRONT.forEach(function (f) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) return;
  const c = fs.readFileSync(p, 'utf8');
  const leaked = SECRETS.filter(function (s) { return c.indexOf(s) >= 0; });
  ok(f + ' 无凭据泄漏', leaked.length === 0, leaked.join(','));
});
const srv = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
ok('凭据仅在服务端（server.js / 环境变量）', srv.indexOf('DB_PASS') >= 0);

/* ---------- 9. 前端关键要素 ---------- */
section('[9] 前端界面要素');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
ok('顶部产品名正确', html.indexOf('无言以队 · 舞弊审计调查辅助台') >= 0);
ok('全局提示条固定文案', html.indexOf('AI辅助生成 · 不构成调查结论 · 关键判断由调查人员作出') >= 0);
ok('灰色角标文案', html.indexOf('AI辅助 · 供参考') >= 0);
ok('演示数据/连接数据库 切换开关', html.indexOf('name="mode"') >= 0 && html.indexOf('连接数据库') >= 0);
ok('导航含 7 个固定功能项', ['数据聚合台', '风险信号识别', '线索梳理', '可疑度评估', '证据核对', '报告初稿', '问答与提醒']
  .every(function (n) { return html.indexOf(n) >= 0; }));
ok('导航第 8 项为测试示例', html.indexOf('测试示例') >= 0);
ok('主色 #1E5AA8', html.indexOf('#1E5AA8') >= 0);
ok('深蓝 #123A6B', html.indexOf('#123A6B') >= 0);
ok('状态色齐备', ['#D93025', '#F29900', '#1E8E3E', '#5F6368'].every(function (c) { return html.indexOf(c) >= 0; }));
ok('字体 Microsoft YaHei', html.indexOf('Microsoft YaHei') >= 0);
ok('CSS/JS 全内联（file:// 可用）', html.indexOf('<style>') >= 0 && html.indexOf('<script>') >= 0
  && html.indexOf('<link rel="stylesheet"') < 0);
ok('语音输入 Web Speech API', html.indexOf('SpeechRecognition') >= 0);
ok('溯源轨迹面板', html.indexOf('trace-head') >= 0);

/* ---------- 10. API 端点 ---------- */
section('[10] API 端点');
const ENDPOINTS = ['/api/health', '/api/query', '/api/aggregate', '/api/risk-signal',
  '/api/clues', '/api/score', '/api/evidence-check', '/api/report', '/api/qa',
  '/api/parse-intent', '/api/upload-summary'];
ENDPOINTS.forEach(function (e) {
  ok(e, srv.indexOf(e) >= 0);
});

/* ---------- 汇总 ---------- */
console.log('\n============================================================');
console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项');
if (fail > 0) {
  console.log('\n  失败项：');
  failures.forEach(function (f) { console.log('    - ' + f); });
  console.log('\n============================================================');
  process.exit(1);
}
console.log('  ✓ 全部自检通过');
console.log('============================================================');
