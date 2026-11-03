/**
 * 后端接口验收测试（真实 HTTP 调用全部端点）
 */
'use strict';

const BASE = 'http://127.0.0.1:3001';
let pass = 0, fail = 0;

async function post(p, body, mode) {
  const r = await fetch(BASE + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Wuyan-Mode': mode || 'demo' },
    body: JSON.stringify(body || {})
  });
  const j = await r.json();
  return { status: r.status, body: j };
}
async function get(p) {
  const r = await fetch(BASE + p);
  return { status: r.status, body: await r.json() };
}

function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

(async () => {
  const P = { entityType: 'all', periodFrom: '2026-01-01', periodTo: '2026-12-31' };

  console.log('=== 健康检查 ===');
  const h = await get('/api/health');
  ok('GET /api/health 200', h.status === 200);
  ok('返回 mode 字段', ['live', 'demo'].indexOf(h.body.mode) >= 0, h.body.mode);
  ok('返回 connected 字段', typeof h.body.connected === 'boolean');
  ok('返回 disclaimer', !!h.body.disclaimer);
  console.log('    数据库:', h.body.message, '| 模式:', h.body.mode);

  console.log('\n=== 元数据端点 ===');
  const t = await get('/api/tables');
  ok('GET /api/tables', t.status === 200 && t.body.tables.length === 26, 'tables=' + (t.body.tables || []).length);
  ok('规则库返回', (t.body.rules || []).length >= 30, 'rules=' + (t.body.rules || []).length);
  const ex = await get('/api/examples');
  ok('GET /api/examples', ex.status === 200 && ex.body.examples.length === 8);

  console.log('\n=== 演示模式全端点 ===');
  for (const [name, path, check] of [
    ['aggregate', '/api/aggregate', (b) => b.rows.length > 0 && b.stats],
    ['risk-signal', '/api/risk-signal', (b) => b.total > 0 && b.steps.length === 3],
    ['clues', '/api/clues', (b) => b.total > 0 && b.clues[0].views],
    ['score', '/api/score', (b) => typeof b.totalScore === 'number' && b.triangle.length === 3],
    ['evidence-check', '/api/evidence-check', (b) => b.methods.length === 5 && b.pending.length > 0],
    ['report', '/api/report', (b) => b.sections.length === 7 && b.markdown],
    ['reminder', '/api/reminder', (b) => b.items.length > 0]
  ]) {
    const t0 = Date.now();
    const r = await post(path, P, 'demo');
    const ms = Date.now() - t0;
    ok('POST ' + path, r.status === 200 && check(r.body),
      r.status !== 200 ? (r.body.error || r.status) : 'check failed');
    ok('  └ disclaimer', !!r.body.disclaimer);
    ok('  └ trace', !!(r.body.trace && r.body.trace.tables));
    console.log('    ' + ms + 'ms');
  }

  const qa1 = await post('/api/qa', { question: '关联交易的认定口径是什么？' }, 'demo');
  ok('POST /api/qa 范围内', qa1.body.matched && qa1.body.scope === '在范围内', qa1.body.topicTitle);
  const qa2 = await post('/api/qa', { question: '是否立案？责任人是谁？' }, 'demo');
  ok('POST /api/qa 超范围拒答', qa2.body.scope === '超出范围');

  console.log('\n=== 交互方式端点 ===');
  const pi = await post('/api/parse-intent', { text: '聚合安徽宏远机电设备有限公司2026年全年采购数据' }, 'demo');
  ok('POST /api/parse-intent', pi.status === 200 && pi.body.matched && pi.body.params.entityCode === 'S028',
    JSON.stringify(pi.body.params || pi.body.error));
  ok('  └ disclaimer + trace', !!pi.body.disclaimer && !!(pi.body.trace && pi.body.trace.tables));
  const upRes = await post('/api/upload-summary', {
    files: [{ name: 'a.csv', type: 'csv', rows: [{ '主体': 'X公司', '金额': '100', '日期': '2026-01-01' }] }]
  }, 'demo');
  ok('POST /api/upload-summary', upRes.status === 200 && upRes.body.totalRows === 1);
  ok('  └ 含溯源 uploaded', !!(upRes.body.trace && upRes.body.trace.uploaded));

  console.log('\n=== SQL 安全闸门（HTTP 层）===');
  for (const [name, sql, expect] of [
    ['合法SELECT', 'SELECT supplier_code FROM suppliers LIMIT 3', 200],
    ['UPDATE', 'UPDATE suppliers SET supplier_name=1', 403],
    ['DELETE', 'DELETE FROM suppliers', 403],
    ['DROP', 'DROP TABLE suppliers', 403],
    ['多语句', 'SELECT 1; DROP TABLE suppliers', 403],
    ['非白名单', 'SELECT * FROM mysql.user', 403],
    ['LOAD_FILE', "SELECT LOAD_FILE('/etc/passwd')", 403]
  ]) {
    const r = await post('/api/query', { sql }, 'demo');
    ok(name + ' → ' + expect, r.status === expect, 'got ' + r.status);
  }

  console.log('\n=== CORS 与预检 ===');
  const rOpt = await fetch(BASE + '/api/aggregate', { method: 'OPTIONS' });
  ok('OPTIONS 返回 204', rOpt.status === 204);
  ok('允许跨域', rOpt.headers.get('access-control-allow-origin') === '*');

  console.log('\n=== 静态资源 ===');
  const idx = await fetch(BASE + '/index.html');
  const idxText = await idx.text();
  ok('GET /index.html 200', idx.status === 200);
  ok('index.html 含产品名', idxText.indexOf('无言以队 · 舞弊审计调查辅助台') >= 0);
  const leak = ['StrongPass123', '115.190.168.89', 'readonly_user'].filter((s) => idxText.indexOf(s) >= 0);
  ok('index.html 无凭据泄漏', leak.length === 0, leak.join(','));
  const srv = await fetch(BASE + '/server.js');
  ok('server.js 不可通过 HTTP 访问', srv.status === 403, 'got ' + srv.status);

  console.log('\n=== 实时数据库模式 ===');
  const t0 = Date.now();
  const live = await post('/api/risk-signal', P, 'live');
  const liveMs = Date.now() - t0;
  if (live.status === 200) {
    ok('live 模式可用', true);
    console.log('    数据源:', JSON.stringify(live.body.dataSource));
    console.log('    信号数:', live.body.total, '| 耗时:', liveMs + 'ms', '| 缓存:', live.body.dataSource.cached);
    ok('live 返回 disclaimer', !!live.body.disclaimer);
    ok('live 含数据质量预检', !!live.body.dataQuality);
  } else {
    console.log('    live 模式不可用（' + (live.body.error || live.status) + '），已自动降级');
    ok('live 失败时给出明确错误', !!live.body.error);
  }

  console.log('\n============================================================');
  console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  console.log('============================================================');
  if (fail > 0) process.exit(1);
})().catch((e) => { console.error('测试异常:', e); process.exit(1); });
