/**
 * 构建脚本：生成单文件 index.html
 *
 * 为什么单文件：架构 II 要求「双击 index.html 即可运行、无需服务器」。
 * 浏览器在 file:// 协议下禁止 fetch 本地文件，且通过 <script src> 引用同目录
 * 脚本虽可行，但迁移/发送单个文件时容易丢失依赖。因此把 CSS 与全部 JS
 * 内联进 index.html，保证单文件可移植。
 *
 * 源文件仍保留在 web/ 与 app/ 下可独立维护；修改后执行：
 *      node tools/build.js
 * 重新生成 index.html。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function read(p) {
  return fs.readFileSync(path.join(ROOT, p), 'utf8');
}

const css = read('web/style.css');
const jsFiles = [
  'app/core.js',
  'app/demo.js',
  'app/engine.js',
  'web/runtime.js',
  'web/app.js'
];

const jsBlocks = jsFiles.map((f) => {
  const code = read(f);
  return `<!-- ==================== ${f} ==================== -->\n<script>\n${code}\n</script>`;
}).join('\n\n');

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>无言以队 · 舞弊审计调查辅助台</title>
<meta name="description" content="金融业舞弊审计调查岗位 AI 工作助理 —— 多源数据聚合、风险信号识别、线索梳理、可疑度评估、证据核对、报告初稿、问答与提醒。AI辅助生成，不构成调查结论。">
<style>
${css}
</style>
</head>
<body>

<!-- ==================== 顶部栏 ==================== -->
<header class="topbar">
  <div class="topbar-left">
    <div class="brand-mark">无</div>
    <div>
      <div class="brand-title">无言以队 · 舞弊审计调查辅助台</div>
      <div class="brand-sub">金融业 · 舞弊审计调查岗位 AI 工作助理 · 辅助而非替代</div>
    </div>
  </div>
  <div class="topbar-right">
    <!-- 全局提示条：固定显示 -->
    <div class="global-notice" title="本系统所有输出均为辅助材料">
      <span class="dot"></span>
      AI辅助生成 · 不构成调查结论 · 关键判断由调查人员作出
    </div>
    <!-- 全局演示数据 / 连接数据库 切换开关（状态常驻可见） -->
    <div class="mode-switch" role="radiogroup" aria-label="数据源模式">
      <label><input type="radio" name="mode" value="demo" checked>演示数据</label>
      <label><input type="radio" name="mode" value="live">连接数据库</label>
    </div>
    <div class="mode-status off" id="modeStatus"><span class="dot"></span>检测后端…</div>
  </div>
</header>

<div class="layout">
  <!-- ==================== 左侧导航（固定 7 项 + 第 8 项测试示例） ==================== -->
  <nav class="sidebar" id="nav" aria-label="功能导航"></nav>

  <!-- ==================== 主区 ==================== -->
  <main class="main" id="main"></main>
</div>

<div class="toast-wrap" id="toastWrap"></div>

<!-- ==================== 应用脚本（内联，保证 file:// 双击可用） ==================== -->
${jsBlocks}

</body>
</html>
`;

const out = path.join(ROOT, 'index.html');
fs.writeFileSync(out, html, 'utf8');
const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);
console.log(`✓ 已生成 index.html（${kb} KB，内联 ${jsFiles.length} 个脚本）`);
console.log(`  路径：${out}`);
