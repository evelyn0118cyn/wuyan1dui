/**
 * 无言以队 · RAG 知识库检索（本地、可复现、无外部依赖）
 *
 * 检索源：data/fraud-kb.json（公开方法论知识，不含受保护数据）。
 * 算法：轻量 BM25 风格打分（词频 + 逆文档频率近似 + 标题/标签加权），
 *       不依赖任何 embedding 服务，保证评委机器离线可复现。
 * 降级：知识库文件缺失时返回空结果，调用方自动跳过检索增强。
 */
'use strict';

const fs = require('fs');
const path = require('path');

let KB = null;
let LOADED = false;
let LOAD_ERR = null;

function loadKb() {
  if (LOADED) return;
  LOADED = true;
  try {
    const p = path.join(__dirname, '..', 'data', 'fraud-kb.json');
    const raw = fs.readFileSync(p, 'utf8');
    const json = JSON.parse(raw);
    KB = (json && json.entries) || [];
    console.log(`[rag] 知识库已加载，条目数 ${KB.length}`);
  } catch (e) {
    LOAD_ERR = e.message;
    KB = [];
    console.warn('[rag] 知识库加载失败，已降级为空检索：', e.message);
  }
}

function tokenize(text) {
  if (!text) return [];
  const s = String(text).toLowerCase();
  /* 英文/数字按词；中文按 2-gram（相邻字重叠切分），与文档描述一致 */
  const en = (s.match(/[a-z0-9]+/g) || []);
  const cnRuns = (s.match(/[一-龥]+/g) || []);
  const cn = [];
  cnRuns.forEach((run) => {
    if (run.length === 1) { cn.push(run); return; }
    for (let i = 0; i < run.length - 1; i++) cn.push(run.slice(i, i + 2));
  });
  return en.concat(cn);
}

function docText(e) {
  return [e.title || '', e.category || '', (e.tags || []).join(' '), e.content || ''].join(' ');
}

function bm25Score(queryTokens, docTokens, idf, avgdl, dl) {
  if (!docTokens.length) return 0;
  const tf = {};
  docTokens.forEach((t) => { tf[t] = (tf[t] || 0) + 1; });
  const k1 = 1.5, b = 0.75;
  let score = 0;
  queryTokens.forEach((q) => {
    if (!(q in tf)) return;
    const idfVal = idf[q] || Math.log((KB.length - 1 + 0.5) / (0.5) + 1);
    score += idfVal * (tf[q] * (k1 + 1)) / (tf[q] + k1 * (1 - b + b * (dl / avgdl)));
  });
  return score;
}

/**
 * 检索知识库
 * @param {string} query 用户问题或主题
 * @param {number} topK 返回条数
 * @returns {Array<{id,title,category,tags,content,score}>}
 */
function retrieve(query, topK) {
  loadKb();
  const q = String(query || '').trim();
  if (!q || !KB.length) return [];
  const qTokens = tokenize(q);
  if (!qTokens.length) return [];

  /* 文档频率，用于 idf（近似） */
  const df = {};
  KB.forEach((e) => {
    const toks = new Set(tokenize(docText(e)));
    toks.forEach((t) => { df[t] = (df[t] || 0) + 1; });
  });
  const idf = {};
  Object.keys(df).forEach((t) => {
    const n = df[t];
    idf[t] = Math.log(1 + (KB.length - n + 0.5) / (n + 0.5));
  });

  const lens = KB.map((e) => tokenize(docText(e)).length);
  const avgdl = lens.reduce((a, b) => a + b, 0) / (lens.length || 1);

  const scored = KB.map((e, i) => {
    let s = bm25Score(qTokens, tokenize(docText(e)), idf, avgdl, lens[i]);
    /* 标题/标签命中加权（检索增强更精准） */
    const title = String(e.title || '').toLowerCase();
    const tags = (e.tags || []).map((t) => String(t).toLowerCase());
    qTokens.forEach((qt) => {
      if (title.indexOf(qt) >= 0) s += 1.2;
      if (tags.some((t) => t.indexOf(qt) >= 0)) s += 0.8;
      /* 原串子串匹配（英文术语/中文短语） */
      if (String(e.content || '').toLowerCase().indexOf(q.toLowerCase()) >= 0) s += 0.15;
    });
    return { entry: e, score: s };
  }).filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, topK || 4).map((x) => ({
    id: x.entry.id, title: x.entry.title, category: x.entry.category,
    tags: x.entry.tags || [], content: x.entry.content || '', score: Number(x.score.toFixed(3))
  }));
}

/** 将检索结果拼为可注入 prompt 的上下文字符串 */
function formatContext(items) {
  if (!items || !items.length) return '';
  return items.map((it, i) =>
    `【参考${i + 1}】(${it.id} ${it.category}) ${it.title}\n${it.content}`
  ).join('\n\n');
}

module.exports = { retrieve, formatContext, loadKb, _state: () => ({ count: KB ? KB.length : 0, err: LOAD_ERR }) };
