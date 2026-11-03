/**
 * 浏览器端验收测试（file:// 双击模式）
 * 验证：页面加载、无 JS 错误、7 模块 + 示例页渲染、各模块运行产出结果
 */
'use strict';

const puppeteer = require('puppeteer-core');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL_FILE = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const OUT = path.resolve(__dirname, '..', '_shots');

(async () => {
  const fs = require('fs');
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--allow-file-access-from-files', '--window-size=1440,900']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  const errors = [];
  const consoleMsgs = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => {
    consoleMsgs.push(m.type() + ': ' + m.text());
    if (m.type() === 'error') errors.push('CONSOLE: ' + m.text());
  });
  page.on('requestfailed', (r) => {
    // 忽略对 127.0.0.1:3001 的探测失败（离线模式预期）
    if (r.url().indexOf('127.0.0.1:3001') < 0) errors.push('REQFAIL: ' + r.url());
  });

  console.log('打开:', URL_FILE);
  await page.goto(URL_FILE, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 2500));

  // 1. 基础结构
  const struct = await page.evaluate(() => {
    const navs = Array.from(document.querySelectorAll('.nav-item')).map((b) => b.textContent.trim());
    return {
      title: document.title,
      brand: (document.querySelector('.brand-title') || {}).textContent,
      notice: (document.querySelector('.global-notice') || {}).textContent,
      navCount: navs.length,
      navs: navs,
      pageTitle: (document.querySelector('.page-title') || {}).textContent,
      hasModeSwitch: !!document.querySelector('input[name="mode"]'),
      modeStatus: (document.querySelector('#modeStatus') || {}).textContent
    };
  });
  console.log('\n=== 结构 ===');
  console.log('title:', struct.title);
  console.log('brand:', struct.brand);
  console.log('notice:', (struct.notice || '').replace(/\s+/g, ' ').trim());
  console.log('nav count:', struct.navCount);
  console.log('navs:', struct.navs.join(' | '));
  console.log('page title:', struct.pageTitle);
  console.log('mode switch:', struct.hasModeSwitch, '| status:', struct.modeStatus);

  await page.screenshot({ path: path.join(OUT, '01-home.png'), fullPage: true });

  // 2. 逐个模块：点击载入示例并运行
  const modules = [
    { key: 'aggregate', name: '数据聚合台', wait: 3000 },
    { key: 'risk', name: '风险信号识别', wait: 3000 },
    { key: 'clue', name: '线索梳理', wait: 3000 },
    { key: 'score', name: '可疑度评估', wait: 3000 },
    { key: 'evidence', name: '证据核对', wait: 3000 },
    { key: 'report', name: '报告初稿', wait: 3500 }
  ];

  for (const m of modules) {
    // 导航到模块
    await page.evaluate((k) => window.WyApp.go(k), m.key);
    await new Promise((r) => setTimeout(r, 500));
    // 点击"开始分析"按钮
    const clicked = await page.evaluate(() => {
      const btn = document.getElementById('f_run') || document.getElementById('r_run');
      if (btn) { btn.click(); return true; }
      return false;
    });
    await new Promise((r) => setTimeout(r, m.wait));

    const info = await page.evaluate(() => {
      const body = document.getElementById('page-body');
      const txt = body ? body.innerText : '';
      return {
        len: txt.length,
        hasError: /失败|Error|undefined is not/.test(txt.slice(0, 4000)),
        cards: document.querySelectorAll('.card').length,
        tables: document.querySelectorAll('table.data').length,
        traces: document.querySelectorAll('.trace').length,
        badges: document.querySelectorAll('.ai-badge').length,
        loading: !!document.querySelector('.loading-bar.on'),
        errorText: (txt.match(/失败：[^\n]{0,120}/) || [])[0] || ''
      };
    });
    console.log(`\n[${m.name}] clicked=${clicked} cards=${info.cards} tables=${info.tables} trace=${info.traces} badge=${info.badges} len=${info.len} loading=${info.loading}`);
    if (info.errorText) console.log('  !! ERROR:', info.errorText);
    await page.screenshot({ path: path.join(OUT, '02-' + m.key + '.png'), fullPage: false });
  }

  // 3. 问答模块
  await page.evaluate(() => window.WyApp.go('qa'));
  await new Promise((r) => setTimeout(r, 800));
  await page.evaluate(() => {
    const inp = document.getElementById('q_input');
    inp.value = '可疑度评分卡的分级阈值是怎么定的？';
    document.getElementById('q_send').click();
  });
  await new Promise((r) => setTimeout(r, 2500));
  const qa = await page.evaluate(() => ({
    msgs: document.querySelectorAll('.msg').length,
    hasRefs: !!document.querySelector('#q_refs .card'),
    todoCount: document.querySelectorAll('.todo').length,
    remCards: document.querySelectorAll('#m7_reminder .stat-card').length
  }));
  console.log('\n[问答与提醒] msgs=', qa.msgs, 'refs=', qa.hasRefs, 'todos=', qa.todoCount, 'statCards=', qa.remCards);
  await page.screenshot({ path: path.join(OUT, '03-qa.png'), fullPage: true });

  // 4. 超范围问答
  await page.evaluate(() => {
    const inp = document.getElementById('q_input');
    inp.value = '这家公司是否构成舞弊？请直接给结论';
    document.getElementById('q_send').click();
  });
  await new Promise((r) => setTimeout(r, 1800));
  const refusal = await page.evaluate(() => {
    const msgs = document.querySelectorAll('.msg.ai .msg-bubble');
    const last = msgs[msgs.length - 1];
    return last ? last.innerText.slice(0, 160) : '';
  });
  console.log('\n[超范围拒答] ' + refusal.replace(/\n/g, ' '));

  // 5. 测试示例页
  await page.evaluate(() => window.WyApp.go('examples'));
  await new Promise((r) => setTimeout(r, 2500));
  const ex = await page.evaluate(() => ({
    cards: document.querySelectorAll('.example-card').length,
    tables: document.querySelectorAll('table.data').length,
    rows: document.querySelectorAll('table.data tbody tr').length
  }));
  console.log('\n[测试示例] exampleCards=', ex.cards, 'tables=', ex.tables, 'rows=', ex.rows);
  await page.screenshot({ path: path.join(OUT, '04-examples.png'), fullPage: true });

  // 6. 检查关键合规要素
  const compliance = await page.evaluate(() => {
    const all = document.body.innerText;
    return {
      hasDisclaimer: all.indexOf('AI辅助生成') >= 0,
      hasNoConclusion: all.indexOf('不构成调查结论') >= 0,
      forbidden: ['确认存在舞弊', '构成舞弊', '系某某所为', '应当认定为'].filter((w) => all.indexOf(w) >= 0),
      aiBadges: document.querySelectorAll('.ai-badge').length
    };
  });
  console.log('\n=== 合规要素 ===');
  console.log('含"AI辅助生成":', compliance.hasDisclaimer);
  console.log('含"不构成调查结论":', compliance.hasNoConclusion);
  console.log('页面残留禁用词:', compliance.forbidden.length ? compliance.forbidden.join(',') : '无');
  console.log('AI角标数量:', compliance.aiBadges);

  console.log('\n=== JS 错误 ===');
  const realErrors = errors.filter((e) => e.indexOf('favicon') < 0);
  if (realErrors.length) {
    realErrors.slice(0, 15).forEach((e) => console.log('  ' + e));
    console.log('  共', realErrors.length, '条');
  } else {
    console.log('  无');
  }

  await browser.close();
  console.log('\n截图目录:', OUT);
})().catch((e) => { console.error('测试异常:', e); process.exit(1); });
