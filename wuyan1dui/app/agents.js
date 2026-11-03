/**
 * 无言以队 · 智能体工具集（function calling）
 *
 * 本文件把既有的确定性规则引擎包装成大模型可调度的"工具"，
 * 让 LLM 负责意图理解与自然语言综合，引擎负责可解释、可溯源的计算。
 * 不改变任何引擎内部逻辑，仅做结果压缩与格式化，便于大模型消费。
 *
 * 工具一览：
 *   aggregate_data   多源数据聚合（按业务链）
 *   risk_signal      风险信号识别（三步法）
 *   clue_sort        可疑线索梳理
 *   suspicion_score  可疑度评估（评分卡 + 舞弊三角）
 *   evidence_check   证据核对（5 方法）
 *   compliance_qa    确定性合规问答（关键词/口径字典，无模型）
 *   knowledge_lookup 知识库检索（RAG）
 *   intent_parse     自然语言调查意图解析
 */
'use strict';

const engine = require('./engine.js');
const core = require('./core.js');
const rag = require('./rag.js');

function num(v, d) { const n = Number(v); return Number.isFinite(n) ? n : (d == null ? 0 : d); }

/* ---------- 结果压缩器 ---------- */
function compactRisk(D, p) {
  const r = engine.riskSignal(D, p);
  const top = (r.signals || []).slice(0, 12).map((s) =>
    `- ${s.ruleId}/${s.ruleName}｜主体:${s.subject || '—'}｜${core.wan(s.amount)}｜${s.gradeLabel}｜${s.date || '—'}`
  ).join('\n');
  return `风险信号总数 ${r.total}（高度${r.summary.byGrade.high || 0}/中度${r.summary.byGrade.medium || 0}/低度${r.summary.byGrade.low || 0}/不足${r.summary.byGrade.unknown || 0}）。\n步骤分布: ${r.steps.map((s) => s.label + ':' + s.count).join('; ')}。\nTop信号:\n${top || '（无）'}`;
}

function compactClues(D, p) {
  const r = engine.clues(D, p);
  const top = (r.clues || []).slice(0, 10).map((c) =>
    `- ${c.clueId}｜${c.subject}（${c.entityType}）｜${c.gradeLabel}｜触发:${c.触发信号.slice(0, 3).join('、')}｜${c.时间范围 || '—'}`
  ).join('\n');
  return `待核查线索总数 ${r.total}。\n${top || '（无）'}`;
}

function compactScore(D, p) {
  const r = engine.score(D, p);
  return `参考分值 ${r.totalScore} 分（${r.gradeLabel}）。各维度: 压力${r.dimensions.pressure.score}（权重${r.dimensions.pressure.weight}）、机会${r.dimensions.opportunity.score}（权重${r.dimensions.opportunity.weight}）、借口${r.dimensions.rationalization.score}（权重${r.dimensions.rationalization.weight}）。\n说明: ${r.declaration || ''}`;
}

function compactEvidence(D, p) {
  const r = engine.evidence(D, p);
  const cov = (r.coverage || []).map((c) => `${c.方法}: 核对${c.核对数}/差异${c.差异数} — ${c.说明}`).join('\n');
  const pend = (r.pending || []).slice(0, 8).map((x) => `- ${x.来源方法}: ${x.涉及单据} 需${x.待取证材料}（${x.涉及主体}）`).join('\n');
  return `证据核对方法数 ${r.methods.length}。\n覆盖率:\n${cov || '—'}\n待取证事项:\n${pend || '（无）'}`;
}

function compactAggregate(D, p) {
  const r = engine.aggregate(D, p);
  const rows = r.rowTotal != null ? r.rowTotal : (Array.isArray(r.rows) ? r.rows.length : 0);
  const chains = Array.isArray(r.chains) ? r.chains.join('、') : (r.chains ? JSON.stringify(r.chains) : '—');
  const st = r.stats || {};
  const span = st.时间跨度 ? (st.时间跨度.from + '~' + st.时间跨度.to) : '—';
  const tablesCount = st.纳入分析的表 != null ? st.纳入分析的表 : '—';
  const integrity = Array.isArray(r.integrity)
    ? r.integrity.map((i) => `${i.校验项}:${i.结果}`).join('；')
    : '';
  return `聚合完成。业务链: ${chains}。明细行数 ${rows}。纳入分析表 ${tablesCount} 张。时间跨度 ${span}。金额合计 ${core.wan(st.金额合计 || 0)}。涉及主体 ${st.涉及主体数 != null ? st.涉及主体数 : '—'} 个。数据完整度校验: ${integrity || '—'}。`;
}

/* ---------- 工具定义（OpenAI 格式） ---------- */
const TOOL_DEFS = [
  {
    type: 'function',
    function: {
      name: 'aggregate_data',
      description: '按业务链（采购付款/销售收款/费用报销/资金流/研发/税务）聚合多源数据，输出统一口径底稿与数据完整度。用于"把某个主体某期间的数据拉出来看看"。',
      parameters: {
        type: 'object',
        properties: {
          entityType: { type: 'string', enum: ['all', 'supplier', 'customer', 'employee'], description: '主体类型' },
          entityCode: { type: 'string', description: '主体编码（如 S028 / C001 / EMP031），可空' },
          entityName: { type: 'string', description: '主体名称，可空' },
          periodFrom: { type: 'string', description: '起始日期 YYYY-MM-DD' },
          periodTo: { type: 'string', description: '结束日期 YYYY-MM-DD' },
          minAmount: { type: 'number', description: '最小金额（元），可空' },
          maxAmount: { type: 'number', description: '最大金额（元），可空' },
          chains: { type: 'array', items: { type: 'string', enum: ['purchase', 'sales', 'expense', 'fund', 'rd', 'tax'] }, description: '业务链' }
        },
        required: ['periodFrom', 'periodTo']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'risk_signal',
      description: '运行三步法风险信号识别（规则初筛→指标比率→关联图谱），返回信号总数、分级与 Top 信号清单。用于"有没有风险信号/可疑点"。',
      parameters: {
        type: 'object',
        properties: {
          entityType: { type: 'string', enum: ['all', 'supplier', 'customer', 'employee'] },
          entityCode: { type: 'string' },
          periodFrom: { type: 'string' },
          periodTo: { type: 'string' }
        },
        required: ['periodFrom', 'periodTo']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'clue_sort',
      description: '以主体为主线归集待核查线索，返回线索数及 Top 线索（含触发信号、时间金额、建议动作、可疑等级）。',
      parameters: {
        type: 'object',
        properties: {
          entityType: { type: 'string', enum: ['all', 'supplier', 'customer', 'employee'] },
          entityCode: { type: 'string' },
          periodFrom: { type: 'string' },
          periodTo: { type: 'string' }
        },
        required: ['periodFrom', 'periodTo']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'suspicion_score',
      description: '对指定主体计算可疑度参考分值（评分卡+舞弊三角），返回分值、分级与维度得分。注意：仅为规则化参考值，不构成事实认定。',
      parameters: {
        type: 'object',
        properties: {
          entityType: { type: 'string', enum: ['all', 'supplier', 'customer', 'employee'] },
          entityCode: { type: 'string' },
          entityName: { type: 'string' },
          periodFrom: { type: 'string' },
          periodTo: { type: 'string' }
        },
        required: ['periodFrom', 'periodTo']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'evidence_check',
      description: '运行 5 种证据核对方法（三单匹配/凭证抽凭/跨系统比对/银企对账/外部函证清单），返回覆盖率、差异与待取证事项。',
      parameters: {
        type: 'object',
        properties: {
          entityType: { type: 'string', enum: ['all', 'supplier', 'customer', 'employee'] },
          periodFrom: { type: 'string' },
          periodTo: { type: 'string' },
          methods: { type: 'array', items: { type: 'string', enum: ['three_way_match', 'voucher_sampling', 'cross_system_compare', 'bank_book_reconcile', 'external_confirmation'] } }
        },
        required: ['periodFrom', 'periodTo']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'compliance_qa',
      description: '确定性合规问答：基于本地口径字典回答分析方法说明、数据表与字段口径、规则阈值含义、报告章节、下一步建议等；对越权/判断性诉求返回边界说明。无需调用大模型。',
      parameters: {
        type: 'object',
        properties: { question: { type: 'string', description: '用户问题' } },
        required: ['question']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'knowledge_lookup',
      description: '检索本地舞弊审计知识库（RAG），返回与问题相关的公开方法论知识（舞弊三角、内控框架、常见舞弊类型、审计证据、法规、红旗标志等），作为回答的方法论依据。',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: '检索关键词或问题' } },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'intent_parse',
      description: '将一句自然语言调查意图解析为结构化查询条件（主体+期间+金额+业务链），用于回填表单。',
      parameters: {
        type: 'object',
        properties: { text: { type: 'string', description: '用户自然语言描述' } },
        required: ['text']
      }
    }
  }
];

/**
 * 执行工具
 * @param {string} name 工具名
 * @param {object} args 参数
 * @param {object} ctx { D: 数据集, baseParams: 默认筛选 }
 */
async function executeTool(name, args, ctx) {
  const D = ctx.D;
  const a = args || {};
  const base = ctx.baseParams || {};
  const p = Object.assign({}, base, {
    entityType: a.entityType || base.entityType || 'all',
    entityCode: a.entityCode || base.entityCode || '',
    entityName: a.entityName || base.entityName || '',
    periodFrom: a.periodFrom || base.periodFrom,
    periodTo: a.periodTo || base.periodTo,
    minAmount: a.minAmount != null ? num(a.minAmount) : (base.minAmount || 0),
    maxAmount: a.maxAmount != null ? num(a.maxAmount) : (base.maxAmount || '')
  });
  if (a.chains && Array.isArray(a.chains)) p.chains = a.chains;
  if (a.methods && Array.isArray(a.methods)) p.methods = a.methods;

  switch (name) {
    case 'aggregate_data': return compactAggregate(D, p);
    case 'risk_signal': return compactRisk(D, p);
    case 'clue_sort': return compactClues(D, p);
    case 'suspicion_score': return compactScore(D, p);
    case 'evidence_check': return compactEvidence(D, p);
    case 'compliance_qa': {
      const r = engine.qa(D, { question: a.question || '' });
      return `（确定性问答）${r.answer}\n范围: ${r.scope}；相关规则/表: ${JSON.stringify(r.refs || {})}。`;
    }
    case 'knowledge_lookup': {
      const items = rag.retrieve(a.query || '', 3);
      if (!items.length) return '（知识库无相关条目）';
      return rag.formatContext(items);
    }
    case 'intent_parse': {
      const r = engine.parseIntent(D, { text: a.text || '' });
      return `匹配: ${r.matched}；解析条件: ${JSON.stringify(r.params)}；说明: ${r.note}`;
    }
    default:
      return '未知工具: ' + name;
  }
}

module.exports = { TOOL_DEFS, executeTool, compact: { compactRisk, compactClues, compactScore, compactEvidence, compactAggregate } };
