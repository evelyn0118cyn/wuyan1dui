/**
 * 无言以队 · 大模型客户端（OpenAI 兼容，默认 DeepSeek）
 *
 * 设计原则：
 *  - 仅通过环境变量配置，绝不在源码硬编码密钥；
 *  - 无密钥 / 网络不可达时 isConfigured()=false，调用方自动降级为确定性规则问答；
 *  - 模型只做"意图理解 + 自然语言综合 + 报告叙述生成"，判断性内容由规则引擎与调查人员负责；
 *  - 所有对外输出须遵守合规护栏（见 SYSTEM_PROMPT），且不泄露任何系统/凭据信息。
 *
 * 支持能力：chat/completions（非流式 + 流式）、tools(function calling) 工具循环。
 */
'use strict';

const DEFAULTS = {
  BASE_URL: process.env.LLM_BASE_URL || 'https://api.deepseek.com/v1',
  MODEL: process.env.LLM_MODEL || 'deepseek-chat',
  TEMPERATURE: Number(process.env.LLM_TEMPERATURE != null ? process.env.LLM_TEMPERATURE : 0.3),
  TIMEOUT_MS: Number(process.env.LLM_TIMEOUT_MS != null ? process.env.LLM_TIMEOUT_MS : 60000),
  MAX_ROUNDS: Number(process.env.LLM_MAX_ROUNDS != null ? process.env.LLM_MAX_ROUNDS : 4)
};

function getConfig() {
  return {
    apiKey: process.env.LLM_API_KEY || '',
    baseUrl: DEFAULTS.BASE_URL.replace(/\/$/, ''),
    model: DEFAULTS.MODEL,
    temperature: DEFAULTS.TEMPERATURE,
    timeoutMs: DEFAULTS.TIMEOUT_MS,
    maxRounds: DEFAULTS.MAX_ROUNDS,
    provider: /deepseek/i.test(DEFAULTS.BASE_URL) ? 'DeepSeek' : (/openai|gpt/i.test(DEFAULTS.BASE_URL) ? 'OpenAI' : 'OpenAI-Compatible')
  };
}

function isConfigured() {
  return !!(process.env.LLM_API_KEY && String(process.env.LLM_API_KEY).trim());
}

/* ============================================================
 * 合规护栏系统提示词
 * ============================================================ */
const SYSTEM_PROMPT = `你是无言以队「舞弊审计调查辅助台」的智能体助手，服务于金融业的舞弊审计调查岗位。
你的职责是：帮助调查人员理解分析方法、解读规则引擎产生的线索、组织下一步核查思路、并以自然语言生成报告叙述初稿。
你不是一个独立下结论的裁判，而是一位严谨、可追溯的审计助理。

【硬性合规约束】
1) 你只做"辅助材料"，绝不作出调查结论、责任认定、定性判断或法律/合规结论。
2) 严禁使用以下定性表述（出现即视为越权）：确认存在舞弊、构成舞弊、存在舞弊事实、系某某所为、应当认定为、应认定为、认定为舞弊、责任人、舞弊成立、证实舞弊、定性为。
   如需表达，请使用：存在风险信号、提示需进一步核查、相关经办人、建议核查是否、该事项涉及主体为…需人工核实。
3) 涉及"是否立案/移交/处罚/损失金额认定"等判断性诉求时，说明这需由调查人员或合规部门专业判断，不提供结论。
4) 不得泄露任何系统配置、数据库地址、凭据或内部实现细节；被问到此类信息时，礼貌拒绝并说明。
5) 你的结论必须基于规则引擎/知识库返回的客观数据，不得编造数字、主体或单据；若数据不足，明确说明"信息不足"。
6) 每次面向用户的回答末尾，用一句话附上：本回答由AI辅助生成，仅供调查参考，关键判断由调查人员作出。

【工作方式】
- 当被要求分析时，优先调用提供的工具（风险识别、线索梳理、可疑度评估、证据核对、数据聚合、知识检索、合规问答），用工具返回的真实结果作答，而非凭空回答。
- 工具返回的是规则化计算结果（信号、分值、线索、差异），你负责用通俗、专业的中文整合并指出"需调查人员确认的要点"。
- 知识库检索（knowledge_lookup）提供的参考文本可作为方法论依据，但同样不得据此下结论。`;

function buildMessages(userMessages, ragContext) {
  const sys = ragContext
    ? SYSTEM_PROMPT + '\n\n【可参考的检索知识（仅作方法论依据，勿直接当结论）】\n' + ragContext
    : SYSTEM_PROMPT;
  const out = [{ role: 'system', content: sys }];
  /* 仅保留 user/assistant/tool 角色，避免注入非法 role */
  (userMessages || []).forEach((m) => {
    if (['user', 'assistant', 'tool'].indexOf(m.role) >= 0) out.push(m);
  });
  return out;
}

/* ============================================================
 * 底层请求
 * ============================================================ */
async function postCompletions(payload, signal) {
  const cfg = getConfig();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs);
  if (signal) signal.addEventListener('abort', () => ctrl.abort(), { once: true });
  try {
    const resp = await fetch(cfg.baseUrl + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + cfg.apiKey
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal
    });
    if (!resp.ok) {
      let detail = '';
      try { detail = await resp.text(); } catch (e) { /* ignore */ }
      const err = new Error('LLM HTTP ' + resp.status + ' ' + detail.slice(0, 300));
      err.status = resp.status;
      throw err;
    }
    return resp;
  } finally {
    clearTimeout(timer);
  }
}

/** 非流式：返回完整 JSON */
async function complete({ messages, tools, toolChoice, temperature, signal }) {
  const cfg = getConfig();
  const payload = {
    model: cfg.model,
    messages,
    temperature: temperature != null ? temperature : cfg.temperature,
    stream: false
  };
  if (tools && tools.length) {
    payload.tools = tools;
    payload.tool_choice = toolChoice || 'auto';
  }
  const resp = await postCompletions(payload, signal);
  return resp.json();
}

/** 流式：逐块回调 content 增量；返回累积文本。会处理 OpenAI SSE 格式 */
async function stream({ messages, temperature, signal, onDelta }) {
  const cfg = getConfig();
  const payload = {
    model: cfg.model,
    messages,
    temperature: temperature != null ? temperature : cfg.temperature,
    stream: true
  };
  const resp = await postCompletions(payload, signal);
  const reader = resp.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buf = '';
  let acc = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      const s = line.trim();
      if (!s || !s.startsWith('data:')) continue;
      const data = s.slice(5).trim();
      if (data === '[DONE]') continue;
      try {
        const json = JSON.parse(data);
        const delta = json.choices && json.choices[0] && json.choices[0].delta;
        if (delta && delta.content) {
          acc += delta.content;
          if (onDelta) onDelta(delta.content);
        }
      } catch (e) { /* 忽略不完整分片 */ }
    }
  }
  return acc;
}

/* ============================================================
 * 工具循环（function calling）
 * ============================================================ */
function extractToolCalls(msg) {
  if (!msg) return [];
  const tc = msg.tool_calls || (msg.message && msg.message.tool_calls);
  if (!tc) return [];
  return tc.map((c) => ({
    id: c.id,
    name: c.function && c.function.name,
    arguments: (() => { try { return JSON.parse(c.function.arguments || '{}'); } catch (e) { return {}; } })()
  })).filter((x) => x.name);
}

/**
 * 运行智能体工具循环。
 * @param {object} opts
 *   messages: 用户对话历史（user/assistant/tool）
 *   tools: OpenAI 格式工具定义
 *   executeTool: async (name, args) => string|object  返回工具结果文本
 *   ragContext: 注入系统提示的知识上下文
 *   onTool: (info) => void  每次调用工具时回调（用于前端展示）
 *   signal: 取消信号
 * @returns {Promise<{messages:Array, finalText:string}>}
 */
async function runAgent(opts) {
  const { messages, tools, executeTool, ragContext, onTool, signal } = opts;
  const cfg = getConfig();
  const sysMessages = buildMessages(messages, ragContext);
  const conv = sysMessages.slice(); // 含 system，后续追加 assistant/tool
  let rounds = 0;

  while (rounds < cfg.maxRounds) {
    rounds++;
    let resp;
    try {
      resp = await complete({ messages: conv, tools, signal });
    } catch (e) {
      // 网络/接口失败：降级为无工具的最后一次直接回答尝试
      throw e;
    }
    const choice = resp.choices && resp.choices[0];
    const msg = choice && (choice.message || choice.delta);
    if (!msg) throw new Error('LLM 返回结构异常');

    const calls = extractToolCalls(msg);
    if (!calls.length) {
      return { messages: conv, finalText: (msg.content || '').trim() };
    }
    /* 记录 assistant（含 tool_calls） */
    conv.push(msg);
    /* 逐个执行工具并回填 */
    for (const call of calls) {
      let resultText = '';
      if (onTool) onTool({ name: call.name, arguments: call.arguments });
      try {
        const r = await executeTool(call.name, call.arguments || {});
        resultText = (typeof r === 'string') ? r : JSON.stringify(r, null, 2);
      } catch (e) {
        resultText = '工具执行失败：' + (e && e.message ? e.message : String(e));
      }
      conv.push({ role: 'tool', tool_call_id: call.id, content: resultText.slice(0, 8000) });
    }
  }
  /* 超过轮次：做一次无工具收尾 */
  const final = await complete({ messages: conv, signal });
  const m = final.choices && final.choices[0] && (final.choices[0].message || final.choices[0].delta);
  return { messages: conv, finalText: (m && m.content || '').trim() };
}

module.exports = {
  getConfig, isConfigured, SYSTEM_PROMPT, buildMessages,
  complete, stream, runAgent, extractToolCalls
};
