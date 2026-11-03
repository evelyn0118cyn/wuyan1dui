/**
 * 无言以队 · 后端安全代理（server.js）
 *
 * 架构：前端只向 http://127.0.0.1:3001/api/* 发送【无凭据】请求；
 *      代理从 process.env 读取数据库凭据并执行查询，凭据不出服务端。
 *
 * 安全要求（按 Prompt 文档 §Backend Database Connection）：
 *   1) 只读强制：SQL 白名单校验，仅允许 SELECT；命中 DML/DDL 一律拒绝并记录日志
 *   2) 表白名单：仅允许 26 张业务表
 *   3) 强制 LIMIT：所有查询必须带 LIMIT，单次上限 5000 行
 *   4) 连接池：connectionLimit=10，connectTimeout=10000，查询超时 30s
 *   5) 写操作端点全部为【只读分析】，不触发任何写库动作
 *
 * 模式：
 *   live —— 连接 MySQL，取真实数据后交给本地规则引擎计算
 *   demo —— 使用内联演示数据集 PRELOAD_DEMO（离线可用）
 *
 * 启动：node server.js（或双击 start.bat）
 */
'use strict';

const http = require('http');
const path = require('path');
const fs = require('fs');
const url = require('url');

const core = require('./app/core.js');
const engine = require('./app/engine.js');
const demo = require('./app/demo.js');
const llm = require('./app/llm.js');
const rag = require('./app/rag.js');
const agents = require('./app/agents.js');

/* ============================================================
 * 0. 配置（凭据仅存于服务端，禁止下发前端）
 * ============================================================ */
const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || '127.0.0.1';

/* 数据库凭据仅通过环境变量注入（见 .env.example），源码不再硬编码任何口令/地址。
   未配置时连接池不初始化，系统自动降级为演示模式，保证评委机器可复现、不暴露凭据。 */
const DB_CONFIG = {
  host: process.env.DB_HOST || '',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || '',
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME || 'datatest',
  charset: 'utf8mb4',
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_POOL || 10),
  connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT || 10000)
};

/* 大模型开关：显式 ENABLE_LLM=false 可强制关闭；否则"已配置 LLM_API_KEY"即视为启用。
   启用后，大模型仅负责意图理解、自然语言综合与报告叙述生成，并通过 function calling
   调度既有规则引擎；判断性结论仍由规则引擎与调查人员负责。 */
const ENABLE_LLM = String(process.env.ENABLE_LLM != null ? process.env.ENABLE_LLM : (process.env.LLM_API_KEY ? 'true' : 'false')).toLowerCase() === 'true';
const LLM_CONFIGURED = llm.isConfigured();

const MAX_ROWS = 5000;
const QUERY_TIMEOUT_MS = Number(process.env.DB_QUERY_TIMEOUT || 30000);

/* ============================================================
 * 1. SQL 安全闸门
 * ============================================================ */
const ALLOWED_TABLES = new Set([
  'subjects', 'cost_centers', 'departments', 'employees', 'products', 'customers', 'suppliers',
  'tax_rates', 'projects', 'bank_accounts', 'gl_vouchers', 'gl_ledger', 'gl_voucher_entries',
  'oa_expense_reports', 'oa_approval_records', 'pur_orders', 'pur_contracts', 'pur_order_items',
  'pur_receipts', 'sal_orders', 'sal_deliveries', 'bank_transactions', 'sal_order_items',
  'tax_invoice_pool', 'rd_timesheets', 'tax_vat_declarations'
]);

const FORBIDDEN_SQL = /\b(insert|update|delete|drop|alter|truncate|grant|create|replace|merge|call|exec|execute|lock|unlock|rename|revoke|set\s+global|load_file|outfile|dumpfile|information_schema|sleep|benchmark)\b/i;

/** 日志（拒绝记录） */
const LOG_FILE = path.join(__dirname, 'security.log');
function logSecurity(entry) {
  const line = `[${new Date().toISOString()}] ${JSON.stringify(entry)}`;
  try { fs.appendFileSync(LOG_FILE, line + '\n', 'utf8'); } catch (e) { /* 静默 */ }
  console.warn('[SECURITY]', line);
}

/**
 * SQL 安全闸门：只读 + 表白名单 + 强制 LIMIT
 * @returns {{ok:boolean, sql?:string, reason?:string}}
 */
function guardSQL(rawSql) {
  if (typeof rawSql !== 'string' || !rawSql.trim()) {
    return { ok: false, reason: 'SQL 为空' };
  }
  let s = rawSql.trim();
  /* 去掉尾部分号，仅允许单条语句 */
  s = s.replace(/;+\s*$/, '');
  if (s.indexOf(';') >= 0) {
    return { ok: false, reason: '禁止多语句执行' };
  }
  /* 去注释，防止注释绕过 */
  const noComment = s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ').replace(/#[^\n]*/g, ' ');
  if (FORBIDDEN_SQL.test(noComment)) {
    return { ok: false, reason: 'SQL 包含非只读关键字，已拒绝' };
  }
  if (!/^\s*select\b/i.test(noComment)) {
    return { ok: false, reason: '仅允许 SELECT 查询' };
  }
  /* 表名白名单校验：提取 FROM / JOIN 后的标识符 */
  const tableRefs = [];
  const re = /\b(?:from|join)\s+`?([a-zA-Z_][a-zA-Z0-9_]*)`?/gi;
  let m;
  while ((m = re.exec(noComment)) !== null) tableRefs.push(m[1]);
  for (const t of tableRefs) {
    if (!ALLOWED_TABLES.has(t)) {
      return { ok: false, reason: `表「${t}」不在白名单内` };
    }
  }
  /* 强制 LIMIT */
  let out = s;
  if (!/\blimit\s+\d+/i.test(out)) {
    out = out + ` LIMIT ${MAX_ROWS}`;
  } else {
    /* 覆盖超过上限的 LIMIT */
    out = out.replace(/\blimit\s+(\d+)(\s*,\s*(\d+))?/i, (all, a, b, c) => {
      const n = c ? Number(c) : Number(a);
      if (Number.isFinite(n) && n > MAX_ROWS) {
        return c ? `LIMIT ${a}, ${MAX_ROWS}` : `LIMIT ${MAX_ROWS}`;
      }
      return all;
    });
  }
  return { ok: true, sql: out, tables: tableRefs };
}

/* ============================================================
 * 2. 数据库连接池（惰性初始化）
 * ============================================================ */
let pool = null;
let poolError = null;
let dbState = { mode: 'demo', connected: false, checkedAt: null, message: '尚未初始化' };
let lastConnCheck = 0;   /* 连通性探测结果缓存时间戳，避免每次请求都新建连接 */
const CONN_CHECK_TTL_MS = 30000;

function initPool() {
  if (pool || poolError) return;
  /* 未配置数据库连接信息时，不尝试建连，直接保持演示模式 */
  if (!DB_CONFIG.host || !DB_CONFIG.user || !DB_CONFIG.password) {
    poolError = '未配置数据库连接（DB_HOST/DB_USER/DB_PASS），当前为演示模式';
    dbState.message = poolError;
    return;
  }
  let mysql;
  try {
    mysql = require('mysql2/promise');
  } catch (e) {
    poolError = '未安装 mysql2 依赖（可执行 npm install），当前降级为演示模式';
    dbState.message = poolError;
    return;
  }
  try {
    pool = mysql.createPool(DB_CONFIG);
  } catch (e) {
    poolError = 'db pool init failed: ' + e.message;
    dbState.message = poolError;
  }
}

/**
 * 检测数据库连通性。
 * @param {boolean} force 为 true 时忽略缓存强制重连（健康检查用）
 */
async function checkDb(force) {
  initPool();
  const now = Date.now();
  if (!force && dbState.checkedAt && (now - lastConnCheck) < CONN_CHECK_TTL_MS) {
    return dbState;
  }
  lastConnCheck = now;
  dbState.checkedAt = new Date().toISOString();
  if (!pool) {
    dbState = Object.assign(dbState, { mode: 'demo', connected: false, message: poolError || '连接池不可用' });
    return dbState;
  }
  let conn = null;
  try {
    conn = await pool.getConnection();
    const [rows] = await conn.query('SELECT 1 AS ok');
    dbState = {
      mode: 'live', connected: rows && rows[0] && rows[0].ok === 1,
      checkedAt: new Date().toISOString(),
      message: `已连接 ${DB_CONFIG.host}:${DB_CONFIG.port}/${DB_CONFIG.database}（只读账号 ${DB_CONFIG.user}）`
    };
  } catch (e) {
    dbState = {
      mode: 'demo', connected: false, checkedAt: new Date().toISOString(),
      message: '数据库连接失败，已降级为演示模式：' + e.message
    };
  } finally {
    if (conn) { try { conn.release(); } catch (e) { /* ignore */ } }
  }
  return dbState;
}

/** 执行受控只读查询 */
async function runQuery(sql) {
  const g = guardSQL(sql);
  if (!g.ok) {
    logSecurity({ action: 'REJECT_SQL', sql: String(sql).slice(0, 300), reason: g.reason });
    const err = new Error(g.reason);
    err.status = 403;
    throw err;
  }
  initPool();
  if (!pool) {
    const err = new Error('数据库不可用：' + (poolError || '连接池未初始化'));
    err.status = 503;
    throw err;
  }
  const conn = await pool.getConnection();
  const started = Date.now();
  try {
    await conn.query(`SET SESSION MAX_EXECUTION_TIME=${QUERY_TIMEOUT_MS}`);
  } catch (e) { /* 部分版本不支持，忽略 */ }
  try {
    const [rows] = await conn.query({ sql: g.sql, timeout: QUERY_TIMEOUT_MS });
    return {
      rows: Array.isArray(rows) ? rows.slice(0, MAX_ROWS) : rows,
      rowCount: Array.isArray(rows) ? rows.length : 0,
      truncated: Array.isArray(rows) && rows.length >= MAX_ROWS,
      sql: g.sql,
      ms: Date.now() - started,
      tables: g.tables
    };
  } finally {
    try { conn.release(); } catch (e) { /* ignore */ }
  }
}

/* ============================================================
 * 3. 数据集加载：live / demo
 * ============================================================ */
let DEMO_CACHE = null;
function getDemo() {
  if (!DEMO_CACHE) {
    const t0 = Date.now();
    DEMO_CACHE = demo.build();
    console.log(`[demo] 演示数据集构建完成，用时 ${Date.now() - t0}ms，表数 ${Object.keys(DEMO_CACHE).length}`);
  }
  return DEMO_CACHE;
}

/**
 * 从数据库加载 26 张业务表数据。
 *
 * 说明：前端展示层单次仍强制上限 5000 行（安全闸门不变）；
 * 但分析引擎需要完整的关联数据，因此这里按主键分页拉取到内存。
 * 每表最大拉取 MAX_TABLE_ROWS 行（默认 50000），超出则截断并记录数据缺口。
 */
const MAX_TABLE_ROWS = Number(process.env.MAX_TABLE_ROWS || 50000);

async function loadLiveDataset(scope) {
  const tables = (scope && scope.length) ? scope.filter((t) => ALLOWED_TABLES.has(t)) : Array.from(ALLOWED_TABLES);
  const D = {};
  const gaps = [];
  for (const t of tables) {
    const pk = (core.TABLE_META[t] && core.TABLE_META[t].key) || 'id';
    const pkCol = /^\w+$/.test(pk) ? pk : 'id';
    try {
      const rows = [];
      let offset = 0;
      let truncated = false;
      /* 逐页拉取，直到取满或达到该表上限 */
      for (;;) {
        const pageSize = Math.min(MAX_ROWS, MAX_TABLE_ROWS - rows.length);
        if (pageSize <= 0) { truncated = true; break; }
        const sql = `SELECT * FROM \`${t}\` ORDER BY \`${pkCol}\` LIMIT ${pageSize} OFFSET ${offset}`;
        const r = await runQuery(sql);
        rows.push(...(r.rows || []));
        if ((r.rows || []).length < pageSize) break;
        offset += pageSize;
      }
      D[t] = rows;
      if (truncated) gaps.push(`${t} 超过 ${MAX_TABLE_ROWS} 行上限，已截断，分析结论可能不完整`);
    } catch (e) {
      D[t] = [];
      gaps.push(`${t} 读取失败：${e.message}`);
    }
  }
  /* 日期字段归一化：mysql2 返回 Date 对象，统一转为 ISO 字符串 */
  Object.keys(D).forEach((t) => {
    if (!Array.isArray(D[t])) return;
    D[t].forEach((row) => {
      Object.keys(row).forEach((k) => {
        const v = row[k];
        if (v instanceof Date) row[k] = v.toISOString();
        else if (v && typeof v === 'object' && typeof v.toISOString === 'function') row[k] = v.toISOString();
        else if (typeof v === 'bigint') row[k] = Number(v);
        else if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) === false && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(v)) {
          row[k] = v.replace(' ', 'T') + 'Z';
        }
      });
    });
  });
  return { data: D, gaps };
}

/**
 * 依赖占位：实时数据集缓存。
 * 一次性拉取 26 张表代价较高（数十秒），因此在进程内缓存，默认 5 分钟过期。
 * 可通过环境变量 DATA_TTL_MS 调整；设 0 表示每次请求都重新读取。
 */
const DATA_TTL_MS = Number(process.env.DATA_TTL_MS != null ? process.env.DATA_TTL_MS : 300000);
let LIVE_CACHE = null;      /* { data, gaps, at } */
let LIVE_INFLIGHT = null;   /* 并发合并：同时多个请求只触发一次加载 */

async function loadLiveCached() {
  const now = Date.now();
  if (LIVE_CACHE && DATA_TTL_MS > 0 && (now - LIVE_CACHE.at) < DATA_TTL_MS) {
    return Object.assign({}, LIVE_CACHE, { cached: true, ageMs: now - LIVE_CACHE.at });
  }
  if (LIVE_INFLIGHT) return LIVE_INFLIGHT;
  LIVE_INFLIGHT = (async () => {
    try {
      const t0 = Date.now();
      const live = await loadLiveDataset(null);
      LIVE_CACHE = { data: live.data, gaps: live.gaps, at: Date.now(), loadMs: Date.now() - t0 };
      console.log(`[live] 实时数据集加载完成，用时 ${LIVE_CACHE.loadMs}ms`);
      return Object.assign({}, LIVE_CACHE, { cached: false, ageMs: 0 });
    } finally {
      LIVE_INFLIGHT = null;
    }
  })();
  return LIVE_INFLIGHT;
}

/**
 * 依据 mode 取得数据集
 * @param {'live'|'demo'|'auto'} mode
 */
async function getDataset(mode) {
  if (mode === 'demo') {
    return { data: getDemo(), gaps: [], source: 'demo', modeLabel: '演示数据', cached: false };
  }
  /* live 或 auto：优先真实库（带缓存），失败回退演示 */
  try {
    const st = await checkDb();
    if (st.mode !== 'live') throw new Error(st.message);
    const live = await loadLiveCached();
    return { data: live.data, gaps: live.gaps, source: 'live', modeLabel: '连接数据库',
      cached: !!live.cached, ageMs: live.ageMs, loadMs: live.loadMs };
  } catch (e) {
    if (mode === 'live') {
      const err = new Error('实时数据库不可用：' + e.message);
      err.status = 503;
      throw err;
    }
    return { data: getDemo(), gaps: ['实时数据库不可用，已自动降级为演示数据：' + e.message],
      source: 'demo', modeLabel: '演示数据（降级）', cached: false };
  }
}

/* ============================================================
 * 4. HTTP 工具
 * ============================================================ */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.csv': 'text/csv; charset=utf-8', '.md': 'text/markdown; charset=utf-8'
};

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Wuyan-Mode',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 20 * 1024 * 1024) { reject(Object.assign(new Error('请求体超过 20MB'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(Object.assign(new Error('请求体不是合法 JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

/** 统一响应包装：必须含 disclaimer 与 trace */
function wrap(result, extra) {
  return Object.assign({
    ok: true,
    disclaimer: core.DISCLAIMER_LONG,
    disclaimerTop: core.DISCLAIMER_TOP,
    generatedAt: new Date().toISOString(),
    mode: extra && extra.__source,
    engine: { llm: ENABLE_LLM, deterministic: true, version: '1.0.0' }
  }, result);
}

function fail(res, status, message, detail) {
  sendJson(res, status, {
    ok: false,
    error: message,
    detail: detail ? String(detail) : undefined,
    disclaimer: core.DISCLAIMER_LONG,
    generatedAt: new Date().toISOString()
  });
}

/* ============================================================
 * 5. 静态文件服务（便于浏览器直接访问 localhost:3001）
 * ============================================================ */
function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  const base = __dirname;
  const full = path.normalize(path.join(base, rel));
  if (full.indexOf(base) !== 0) { res.writeHead(403); res.end('Forbidden'); return; }
  const fileName = path.basename(full);
  /* 禁止访问敏感文件 */
  if (['server.js', 'security.log', '.env', 'package.json'].indexOf(fileName) >= 0 || full.indexOf('_probe') >= 0) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.stat(full, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }
    const ext = path.extname(full).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(full).pipe(res);
  });
}

/* ============================================================
 * 6.5 大模型智能体端点（SSE 流式）
 * ============================================================ */
function softSanitize(text) {
  if (!text) return text;
  try { return core.sanitizeText(text); } catch (e) { return text; }
}

function sseSend(res, event, data) {
  res.write('event: ' + event + '\n');
  res.write('data: ' + JSON.stringify(data) + '\n\n');
}

async function streamAnswer(res, text) {
  const step = 14;
  for (let i = 0; i < text.length; i += step) {
    sseSend(res, 'token', { text: text.slice(i, i + step) });
    await new Promise((r) => setImmediate(r));
  }
}

async function handleLlm(req, res, body, mode) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'X-Accel-Buffering': 'no'
  });
  const cfg = llm.getConfig();
  const llmEnabled = ENABLE_LLM && LLM_CONFIGURED;
  sseSend(res, 'meta', {
    llmEnabled, model: cfg.model, provider: cfg.provider,
    disclaimer: core.DISCLAIMER_LONG, generatedAt: new Date().toISOString()
  });

  const messages = Array.isArray(body.messages) ? body.messages : [];
  const lastUser = [].concat(messages).reverse().find((m) => m.role === 'user');
  const question = lastUser ? String(lastUser.content || '') : '';

  const ctrl = new AbortController();
  req.on('close', () => ctrl.abort());

  const ds = await getDataset(mode);
  const params = body.params || {};
  const baseParams = {
    entityType: 'all',
    periodFrom: params.periodFrom || '2026-01-01',
    periodTo: params.periodTo || '2026-12-31',
    minAmount: 0, maxAmount: ''
  };

  /* 未启用/未配置大模型：降级为确定性规则问答，保证功能可用 */
  if (!llmEnabled) {
    try {
      const r = engine.qa(ds.data, { question });
      const answer = r.answer + '\n\n（说明：当前未配置大模型，以上为本地规则匹配式问答；配置 LLM_API_KEY 后，智能体可调用分析工具并生成综合回答。）';
      sseSend(res, 'answer_start', { tools: [], fallback: true });
      await streamAnswer(res, answer);
      sseSend(res, 'answer_end', {});
    } catch (e) {
      sseSend(res, 'error', { message: e.message || String(e) });
    }
    return res.end();
  }

  /* 检索知识库，作为系统提示的方法论依据（RAG 增强） */
  const ctxItems = rag.retrieve(question, 3);
  const ragContext = rag.formatContext(ctxItems);
  const runCtx = { D: ds.data, baseParams };
  const calledTools = [];

  try {
    const result = await llm.runAgent({
      messages: messages,
      tools: agents.TOOL_DEFS,
      executeTool: async (name, args) => {
        calledTools.push(name);
        return agents.executeTool(name, args, runCtx);
      },
      ragContext: ragContext,
      onTool: (info) => sseSend(res, 'tool', info),
      signal: ctrl.signal
    });
    const text = softSanitize(result.finalText || '（未生成回答）');
    sseSend(res, 'answer_start', { tools: calledTools, ragHits: ctxItems.map((x) => x.id) });
    await streamAnswer(res, text);
    sseSend(res, 'answer_end', {});
    sseSend(res, 'trace', {
      usedTools: calledTools,
      ragHits: ctxItems.map((x) => ({ id: x.id, title: x.title })),
      dataSource: { mode: ds.source, label: ds.modeLabel, gaps: ds.gaps }
    });
  } catch (e) {
    sseSend(res, 'error', { message: e.message || String(e) });
  }
  res.end();
}

/* ============================================================
 * 6. 路由
 * ============================================================ */
async function handleApi(req, res, pathname, query) {
  const mode = (req.headers['x-wuyan-mode'] || query.mode || 'auto').toLowerCase();

  /* ---------- GET /api/health ---------- */
  if (pathname === '/api/health' && req.method === 'GET') {
    const st = await checkDb(true);
    return sendJson(res, 200, {
      ok: true,
      mode: st.mode,
      connected: st.connected,
      checkedAt: st.checkedAt,
      message: st.message,
      database: { host: DB_CONFIG.host, port: DB_CONFIG.port, name: DB_CONFIG.database, user: DB_CONFIG.user },
      tables: ALLOWED_TABLES.size,
      limits: { maxRows: MAX_ROWS, queryTimeoutMs: QUERY_TIMEOUT_MS, pool: DB_CONFIG.connectionLimit, dataTtlMs: DATA_TTL_MS },
      llm: { enabled: ENABLE_LLM, note: '默认关闭；仅允许用于报告润色与意图分类，禁止参与判断性内容' },
      disclaimer: core.DISCLAIMER_LONG,
      generatedAt: new Date().toISOString()
    });
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, X-Wuyan-Mode',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
    });
    return res.end();
  }

  /* ---------- POST /api/query ---------- */
  if (pathname === '/api/query' && req.method === 'POST') {
    const body = await readBody(req);
    if (!body.sql) return fail(res, 400, '缺少 sql 参数');
    const g = guardSQL(body.sql);
    if (!g.ok) {
      logSecurity({ action: 'REJECT_SQL', sql: String(body.sql).slice(0, 300), reason: g.reason, ip: req.socket.remoteAddress });
      return sendJson(res, 403, {
        ok: false, error: 'SQL 被安全闸门拒绝：' + g.reason, sql: String(body.sql).slice(0, 500),
        disclaimer: core.DISCLAIMER_LONG, generatedAt: new Date().toISOString()
      });
    }
    const r = await runQuery(g.sql);
    return sendJson(res, 200, {
      ok: true, rows: r.rows, rowCount: r.rowCount, truncated: r.truncated,
      sql: r.sql, ms: r.ms,
      trace: engine.trace(r.tables, { sql: r.sql, source: 'mysql' }, []),
      disclaimer: core.DISCLAIMER_LONG, generatedAt: new Date().toISOString()
    });
  }

  /* ---------- POST /api/llm（智能体对话，SSE 流式） ---------- */
  if (pathname === '/api/llm' && req.method === 'POST') {
    const body = await readBody(req);
    return handleLlm(req, res, body, mode);
  }

  /* ---------- GET /api/llm/config（仅暴露是否启用与模型名，绝不泄露密钥） ---------- */
  if (pathname === '/api/llm/config' && req.method === 'GET') {
    const cfg = llm.getConfig();
    return sendJson(res, 200, {
      ok: true,
      enabled: ENABLE_LLM && LLM_CONFIGURED,
      provider: cfg.provider,
      model: cfg.model,
      baseUrl: cfg.baseUrl,
      note: '大模型仅用于意图理解、自然语言综合与报告叙述生成，并通过 function calling 调度规则引擎；判断性结论由规则引擎与调查人员负责。'
    });
  }

  /* ---------- 其余分析端点：POST，参数合并 body + query ---------- */
  const endpoints = {
    '/api/aggregate': 'aggregate',
    '/api/parse-intent': 'parseIntent',
    '/api/upload-summary': 'uploadSummary',
    '/api/risk-signal': 'riskSignal',
    '/api/clues': 'clues',
    '/api/score': 'score',
    '/api/evidence-check': 'evidence',
    '/api/report': 'report',
    '/api/qa': 'qa',
    '/api/reminder': 'reminders',
    '/api/examples': 'examples',
    '/api/tables': 'tables'
  };
  const key = endpoints[pathname];
  if (!key) return fail(res, 404, '未知接口：' + pathname);

  /* GET 形式也允许（便于其他系统调试），参数从 query 取 */
  let body = {};
  if (req.method === 'POST') {
    body = await readBody(req);
  } else if (req.method === 'GET') {
    body = Object.assign({}, query);
  } else {
    return fail(res, 405, '不支持的方法：' + req.method);
  }

  /* 轻量元数据端点不加载数据集 */
  if (key === 'examples') {
    return sendJson(res, 200, wrap({
      examples: core.DEMO_EXAMPLES,
      disclaimer: core.DISCLAIMER_LONG,
      trace: engine.trace([], {}, [])
    }, { __source: mode }));
  }
  if (key === 'tables') {
    const tables = Object.keys(core.TABLE_META).map((t) => ({
      name: t, label: core.TABLE_META[t].name, system: core.TABLE_META[t].sys,
      key: core.TABLE_META[t].key, fields: core.TABLE_META[t].fields
    }));
    return sendJson(res, 200, wrap({
      tables, groups: core.SYSTEM_GROUPS, count: tables.length,
      rules: core.RULES.map((r) => ({ id: r.id, name: r.name, step: r.step, category: r.category, weight: r.weight, param: r.param })),
      disclaimer: core.DISCLAIMER_LONG,
      trace: engine.trace([], {}, [])
    }, { __source: mode }));
  }

  const ds = await getDataset(mode);
  const params = Object.assign({}, body);
  /* 移除不属于分析参数的控制字段 */
  delete params.mode;
  delete params.data;

  let result;
  const t0 = Date.now();
  switch (key) {
    case 'aggregate':
      result = engine.aggregate(ds.data, params);
      break;
    case 'parseIntent':
      result = engine.parseIntent(ds.data, params);
      break;
    case 'uploadSummary':
      result = engine.uploadSummary(ds.data, params);
      break;
    case 'riskSignal':
      result = engine.riskSignal(ds.data, params);
      break;
    case 'clues':
      result = engine.clues(ds.data, params);
      break;
    case 'score':
      result = engine.score(ds.data, params);
      break;
    case 'evidence':
      result = engine.evidence(ds.data, params);
      break;
    case 'report': {
      const risk = engine.riskSignal(ds.data, params);
      const cl = engine.clues(ds.data, params, risk);
      const sc = engine.score(ds.data, params, risk);
      const ev = engine.evidence(ds.data, params);
      result = engine.report(ds.data, params, { risk, clues: cl, score: sc, evidence: ev });
      result.markdown = engine.reportToMarkdown(result);
      break;
    }
    case 'qa':
      result = engine.qa(ds.data, params);
      break;
    case 'reminders': {
      const cl = engine.clues(ds.data, params);
      const ev = engine.evidence(ds.data, params);
      result = engine.reminders(ds.data, params, cl, ev);
      break;
    }
    default:
      return fail(res, 404, '未实现的分析端点');
  }

  result.dataSource = { mode: ds.source, label: ds.modeLabel, gaps: ds.gaps };
  result.elapsedMs = Date.now() - t0;
  sendJson(res, 200, wrap(result, { __source: ds.source }));
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname || '/';
  if (pathname.startsWith('/api/')) {
    handleApi(req, res, pathname, parsed.query).catch((e) => {
      console.error('[api error]', pathname, e);
      fail(res, e.status || 500, e.message || '服务端异常');
    });
    return;
  }
  serveStatic(req, res, pathname);
});

/* ============================================================
 * 7. 启动
 * ============================================================ */
if (require.main === module) {
  server.listen(PORT, HOST, async () => {
    console.log('');
    console.log('  ╔══════════════════════════════════════════════════════════╗');
    console.log('  ║   无言以队 · 舞弊审计调查辅助台 —— 后端安全代理            ║');
    console.log('  ╚══════════════════════════════════════════════════════════╝');
    console.log('');
    console.log(`  前端地址 : http://${HOST}:${PORT}/index.html`);
    console.log(`  API 基址 : http://${HOST}:${PORT}/api`);
    console.log(`  只读闸门 : 仅 SELECT · 表白名单 ${ALLOWED_TABLES.size} 张 · 单次上限 ${MAX_ROWS} 行`);
    console.log(`  大模型   : ${ENABLE_LLM ? '已启用（仅润色/意图分类）' : '关闭（纯本地确定性计算）'}`);
    console.log('');
    console.log('  正在检测数据库连通性…');
    const st = await checkDb();
    console.log(`  数据库   : ${st.mode === 'live' ? '✓ 已连接' : '✗ 不可用'} — ${st.message}`);
    console.log(`  当前模式 : ${st.mode === 'live' ? '连接数据库（live）' : '演示数据（demo）'}`);
    console.log('');
    console.log('  提示：前端顶部可随时切换「演示数据 / 连接数据库」。');
    console.log('  按 Ctrl+C 停止服务。');
    console.log('');
  });
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.error(`\n[错误] 端口 ${PORT} 已被占用。请关闭占用进程，或设置环境变量 PORT 使用其他端口。\n`);
    } else {
      console.error('[错误]', e);
    }
    process.exit(1);
  });
}

module.exports = { guardSQL, runQuery, checkDb, getDemo, getDataset, server, ALLOWED_TABLES, MAX_ROWS };
