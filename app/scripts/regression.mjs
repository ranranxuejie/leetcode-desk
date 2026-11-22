#!/usr/bin/env node
/**
 * 回归清单：改任何 UI 之前先跑一遍。
 *
 * 前置：`npm run dev` 已在 5173 跑着。
 * 用法：
 *   npm run verify                     # 自己拉一个无头 Chrome（临时 profile），跑完关掉
 *   CDP_PORT=9223 npm run verify       # 复用已有的调试端点
 *   BASE_URL=http://127.0.0.1:4173 npm run verify
 *
 * 覆盖 11 项「至少坏过一次」的回归：URL 同步三个洞、判题三档口径、崩溃自救、
 * 深滚动恢复、焦点陷阱、roving tabindex + j/k/Enter、参考答案面板、1366×768 行数、存档迁移。
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PORT = process.env.CDP_PORT || 9222
const BASE = process.env.BASE_URL || 'http://127.0.0.1:5173'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
]

const results = []
const check = (name, pass, detail) => {
  results.push({ name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${detail ?? ''}`)
}

async function cdpReady() {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/json/version`)
    return res.ok
  } catch {
    return false
  }
}

async function ensureChrome() {
  if (await cdpReady()) return null
  const chrome = CHROME_CANDIDATES.find((path) => existsSync(path))
  if (!chrome) {
    console.error('找不到 Chrome，请手动开一个带 --remote-debugging-port 的浏览器。')
    process.exit(2)
  }
  const child = spawn(
    chrome,
    [
      '--headless=new',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${join(tmpdir(), `lc-regression-${Date.now()}`)}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      'about:blank',
    ],
    { stdio: 'ignore' },
  )
  for (let i = 0; i < 40; i += 1) {
    await sleep(250)
    if (await cdpReady()) return child
  }
  console.error('Chrome 启动超时。')
  child.kill()
  process.exit(2)
}

async function main() {
  const devUp = await fetch(`${BASE}/`)
    .then((res) => res.ok)
    .catch(() => false)
  if (!devUp) {
    console.error(`dev server 没起来（${BASE}）。先跑 npm run dev。`)
    process.exit(2)
  }
  const chrome = await ensureChrome()

  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
  const target = list.find((t) => t.type === 'page')
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  const pending = new Map()
  let seq = 0
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    }
  })
  await new Promise((r) => ws.addEventListener('open', r, { once: true }))
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++seq
      pending.set(id, resolve)
      ws.send(JSON.stringify({ id, method, params }))
    })
  const evaluate = async (expression) => {
    const res = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    return res.result?.result?.value
  }
  const until = async (expression, timeout = 90000) => {
    const started = Date.now()
    while (Date.now() - started < timeout) {
      if (await evaluate(expression)) return true
      await sleep(500)
    }
    return false
  }
  const nav = async (path, wait = 4600) => {
    await send('Page.navigate', { url: `${BASE}${path}` })
    await sleep(wait)
  }
  const key = async (k, code, mods = 0) => {
    const vk = k === 'Enter' ? 13 : k.toUpperCase().charCodeAt(0)
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, modifiers: mods, windowsVirtualKeyCode: vk })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, modifiers: mods, windowsVirtualKeyCode: vk })
    await sleep(280)
  }
  const clickSel = async (selector) => {
    const raw = await evaluate(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return 'null'; const r = el.getBoundingClientRect(); return JSON.stringify({x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2)}); })()`,
    )
    if (raw === 'null') return false
    const p = JSON.parse(raw)
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 })
    await sleep(650)
    return true
  }

  await send('Page.enable')
  await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false })

  // ---- 1. URL 同步三个洞 ----
  await nav('/problems')
  await evaluate(`localStorage.removeItem('lc.filters.problems.v1'); 'cleared'`)
  await nav('/problems')
  await clickSel('.filter-group--scope .chip:nth-of-type(3)')
  const hotUrl = await evaluate('location.search')
  await evaluate('history.back()')
  await sleep(1500)
  const backChip = await evaluate(
    `[...document.querySelectorAll('.filter-group--scope .chip')].find((c) => c.classList.contains('active'))?.textContent?.replace(/\\s+/g, '')`,
  )
  check('B1 后退到干净 URL', hotUrl === '?scope=hot100' && backChip?.startsWith('全部'), `hot=${hotUrl} back=${backChip}`)

  await clickSel('.filter-group--scope .chip:nth-of-type(3)')
  await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('清空筛选')); b?.click(); return 'ok'; })()`)
  await sleep(900)
  const clearedUrl = await evaluate('location.search')
  check('B1 清空筛选写回 URL', clearedUrl === '', `url="${clearedUrl}"`)

  await evaluate(`(() => { document.querySelectorAll('.filter-group--scope .chip')[2].click(); return 'ok'; })()`)
  await sleep(900)
  const kbUrl = await evaluate('location.search')
  check('B1 键盘/程序化激活 chip', kbUrl === '?scope=hot100', `url="${kbUrl}"`)

  // ---- 2. 判题三档口径 ----
  await nav('/problems/22')
  await evaluate(`(() => { const el = document.querySelector('.cm-content'); el.focus(); return 'ok'; })()`)
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 })
  await send('Input.insertText', {
    text: [
      'class Solution:',
      '    def generateParenthesis(self, n: int) -> List[str]:',
      '        if n <= 0:',
      '            return []',
      '        out = []',
      '        def dfs(cur, left, right):',
      '            if len(cur) == 2 * n:',
      '                out.append(cur)',
      '                return',
      '            if left < n:',
      "                dfs(cur + '(', left + 1, right)",
      '            if right < left:',
      "                dfs(cur + ')', left, right + 1)",
      "        dfs('', 0, 0)",
      '        return out',
      '',
    ].join('\n'),
  })
  await sleep(400)
  await evaluate(`document.querySelector('.btn--run')?.click(); 'ok'`)
  await until(`Boolean(document.querySelector('.lab__summary'))`, 120000)
  await sleep(700)
  const verdict = await evaluate(`document.querySelector('.lab__summary')?.textContent?.replace(/\\s+/g, ' ').trim()`)
  check('判题三档口径', /判定/.test(verdict || '') && /只运行/.test(verdict || ''), verdict)

  // ---- 3. 崩溃自救（坏存档不再白屏）----
  await nav('/stats')
  await evaluate(`(() => {
    const raw = JSON.parse(localStorage.getItem('lc.progress.v1') || '{"version":3,"problems":{}}');
    raw.problems = raw.problems || {};
    raw.problems['1'] = { status: 'todo', cases: 'not-an-array' };
    localStorage.setItem('lc.progress.v1', JSON.stringify(raw));
    return 'seeded';
  })()`)
  await nav('/problems/1')
  const survived = await until(
    `Boolean(document.querySelector('.detail__title')) || Boolean(document.querySelector('.crash'))`,
    20000,
  )
  check('崩溃/坏存档自愈', survived === true, `页面可渲染=${survived}`)

  // ---- 4. 深滚动恢复 ----
  await nav('/problems')
  await evaluate(`(() => { const m = document.querySelector('.main'); let n = 0; const t = () => { m.scrollBy(0, 12000); n += 1; if (n < 4) setTimeout(t, 250); }; t(); return 'go'; })()`)
  await sleep(2200)
  const deepBefore = await evaluate(`Math.round(document.querySelector('.main').scrollTop)`)
  await nav('/problems', 5000)
  const deepAfter = await evaluate(`Math.round(document.querySelector('.main').scrollTop)`)
  check('深滚动恢复', Math.abs(deepBefore - deepAfter) < 800, `${deepBefore} -> ${deepAfter}`)

  // ---- 5. 焦点陷阱 ----
  await clickSel('.icon-btn[aria-label="设置与数据"]')
  const inside = await evaluate(`(() => { const m = document.querySelector('.modal'); return Boolean(m && m.contains(document.activeElement)); })()`)
  for (let i = 0; i < 9; i += 1) await key('Tab', 'Tab')
  const stillInside = await evaluate(`(() => { const m = document.querySelector('.modal'); return Boolean(m && m.contains(document.activeElement)); })()`)
  await key('Escape', 'Escape')
  const restored = await evaluate(`document.activeElement?.getAttribute('aria-label')`)
  check('焦点陷阱', inside && stillInside && restored === '设置与数据', `inside=${inside} 9tabs=${stillInside} restored=${restored}`)

  // ---- 6. roving tabindex + j/k/Enter ----
  await nav('/problems')
  const tabbable = await evaluate(`[...document.querySelectorAll('.problem-row')].filter((r) => r.tabIndex === 0).length`)
  await evaluate(`document.activeElement?.blur(); document.body.focus(); 'ok'`)
  await key('j', 'KeyJ')
  await key('j', 'KeyJ')
  const focusedRow = await evaluate(`document.activeElement?.dataset?.rowNo`)
  await key('Enter', 'Enter')
  await sleep(1800)
  const opened = await evaluate('location.pathname')
  check('roving tabindex + j/k/Enter', tabbable === 1 && Boolean(focusedRow) && /^\/problems\/.+/.test(opened), `tabbable=${tabbable} row=${focusedRow} opened=${opened}`)

  // ---- 7. 参考答案面板 ----
  await nav('/problems/1')
  await evaluate(`(() => { const t = [...document.querySelectorAll('.tab')].find((x) => x.textContent.includes('解析')); t?.click(); return 'ok'; })()`)
  await sleep(900)
  const refCollapsed = await evaluate(`(() => { const c = document.querySelector('.an__card--code'); return c ? c.querySelector('.collapse')?.getAttribute('data-open') : 'missing'; })()`)
  await evaluate(`(() => { const b = [...document.querySelectorAll('.an__card--code button')].find((x) => x.getAttribute('aria-expanded') === 'false'); b?.click(); return 'ok'; })()`)
  await sleep(700)
  const refOpened = await until(
    `document.querySelector('.an__card--code .collapse')?.getAttribute('data-open') === 'true'`,
    5000,
  )
  await evaluate(`(() => { const b = [...document.querySelectorAll('.an__card--code button')].find((x) => x.textContent.includes('载入')); b?.click(); return 'ok'; })()`)
  await sleep(1000)
  const codeInEditor = await until(`document.querySelector('.cm-content')?.textContent?.includes('twoSum') === true`, 8000)
  check('参考答案面板', refCollapsed === 'false' && refOpened === true && codeInEditor === true, `折叠=${refCollapsed} 展开=${refOpened} 载入=${codeInEditor}`)

  // ---- 8. 1366×768 编辑器行数 ----
  await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false })
  await sleep(500)
  await nav('/problems/42', 5200)
  const layout = await evaluate(`(() => {
    const scroller = document.querySelector('.cm-scroller');
    const box = document.querySelector('.lab__editor')?.getBoundingClientRect();
    const cases = document.querySelector('.lab__cases')?.getBoundingClientRect();
    const content = document.querySelector('.cm-content');
    if (!scroller || !box || !cases || !content) return 'null';
    const lineH = document.querySelector('.cm-line')?.getBoundingClientRect().height || 21;
    const cs = getComputedStyle(content);
    const padding = parseFloat(cs.paddingTop || '0') + parseFloat(cs.paddingBottom || '0');
    // 用几何算「能放几行」，而不是数已渲染的行数 —— 代码比视口短时会少算
    const capacity = Math.floor((scroller.clientHeight - padding) / lineH);
    return JSON.stringify({ capacity, lineH: Math.round(lineH * 10) / 10, editor: Math.round(box.height), cases: Math.round(cases.height) });
  })()`)
  const layoutOk = layout !== 'null' && JSON.parse(layout).capacity >= 18
  check('1366×768 编辑器行数', layoutOk, layout)
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false })

  // ---- 9. v2 → v3 存档迁移 ----
  await evaluate(`(() => {
    localStorage.setItem('lc.progress.v1', JSON.stringify({ version: 2, problems: { '1': { status: 'done', attempts: 3, passes: 1, timeSpentSec: 900, reviews: [{ at: 1, result: 'pass' }] } }, daily: {}, plans: {}, readDocs: [], settings: { dailyGoal: 3, motion: 'full' } }));
    return 'seeded';
  })()`)
  await nav('/problems/1', 5200)
  const migrated = await until(
    `(() => { const raw = JSON.parse(localStorage.getItem('lc.progress.v1') || '{}'); return raw.version === 3 && Array.isArray(raw.problems?.['1']?.runs); })()`,
    15000,
  )
  const migratedDetail = await evaluate(`(() => {
    const raw = JSON.parse(localStorage.getItem('lc.progress.v1') || '{}');
    const st = raw.problems?.['1'];
    return JSON.stringify({ version: raw.version, runs: Array.isArray(st?.runs) ? st.runs.length : 'missing', attempts: st?.attempts, passes: st?.passes });
  })()`)
  check('v2 → v3 存档迁移', migrated === true, migratedDetail)

  // ---- 10. 答案顺序白名单口径（纯函数，不跑 Pyodide）----
  await nav('/problems')
  const whitelist = await evaluate(`(async () => {
    const m = await import('/src/lib/answer-order.ts')
    return JSON.stringify({
      order89: m.isOrderFree('89'),
      order37: m.isOrderFree('37'),
      order48: m.isOrderFree('48'),
      order15: m.isOrderFree('15'),
      deep15: m.isDeepOrderFree('15'),
      graySameSet: m.sameAnswerIgnoringOrder('[0,1,3,2]', '[0,1,2,3]'),
      diffSet: m.sameAnswerIgnoringOrder('[[1,2]]', '[[1,3]]'),
      outerOnly: m.sameAnswerIgnoringOrder('[[1,2],[3]]', '[[3],[2,1]]', false),
      deepInner: m.sameAnswerIgnoringOrder('[[1,2],[3]]', '[[3],[2,1]]', true),
    })
  })()`)
  const w = whitelist ? JSON.parse(whitelist) : {}
  check(
    '答案顺序白名单口径',
    w.order89 === false && w.order37 === false && w.order48 === false && w.order15 === true && w.deep15 === true && w.graySameSet === true && w.diffSet === false && w.outerOnly === false && w.deepInner === true,
    whitelist,
  )

  // ---- 11. 首屏传输（dev 只打印；launcher 走 gzip 才判定）----
  const measure = async (url) => {
    await send('Page.navigate', { url })
    await sleep(4000)
    return evaluate(`(() => {
      const res = performance.getEntriesByType('resource');
      const total = res.reduce((sum, r) => sum + (r.transferSize || 0), 0);
      const top = res
        .slice()
        .sort((a, b) => (b.transferSize || 0) - (a.transferSize || 0))
        .slice(0, 3)
        .map((r) => r.name.split('/').pop() + ':' + Math.round((r.transferSize || 0) / 1024) + 'KB');
      const nav = performance.getEntriesByType('navigation')[0];
      const paint = performance.getEntriesByName('first-contentful-paint')[0];
      return JSON.stringify({
        transferKB: Math.round(total / 1024),
        requests: res.length,
        fcp: paint ? Math.round(paint.startTime) : null,
        dcl: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
        top,
      });
    })()`)
  }
  const devPerf = await measure(BASE)
  console.log(`      dev（Vite 不压缩，只打印）：${devPerf}`)
  const launcherUrl = process.env.LAUNCHER_URL
  if (launcherUrl) {
    const prodPerf = await measure(launcherUrl)
    const parsedPerf = prodPerf ? JSON.parse(prodPerf) : {}
    check(
      '首屏传输（launcher · gzip）',
      (parsedPerf.transferKB ?? 99999) < 1638,
      `${prodPerf}（预算 < 1.6MB）`,
    )
  } else {
    console.log('      跳过 launcher 判定（设 LAUNCHER_URL=http://127.0.0.1:5175 启用）')
  }

  // ---- 12. 三个页面的关键入口 ----
  await nav('/')
  const todayLinks = await evaluate(
    `JSON.stringify({ links: [...document.querySelectorAll('.stats-strip a')].map((a) => a.getAttribute('href')), buttons: document.querySelectorAll('.stats-strip button').length })`,
  )
  const todayOk = (() => {
    try {
      const parsed = JSON.parse(todayLinks)
      return parsed.links.length === 4 && parsed.buttons === 0
    } catch {
      return false
    }
  })()
  check('今日页四卡是链接', todayOk, todayLinks)

  await nav('/tutorials')
  await evaluate(`(() => { const input = document.querySelector('input[type="search"], .tutorial-search input, input'); if (input) { input.focus(); } return 'ok'; })()`)
  await send('Input.insertText', { text: 'zzzz-不存在的关键词' })
  await sleep(900)
  const tutorialEmpty = await evaluate(
    `(() => { const empty = document.querySelector('.empty'); if (!empty) return 'no-empty'; const btn = [...empty.querySelectorAll('button')].find((b) => b.textContent.includes('清空')); return btn ? 'has-clear' : 'no-cta'; })()`,
  )
  check('教程搜索空态有下一步', tutorialEmpty === 'has-clear', tutorialEmpty)

  await nav('/stats')
  const statsReveal = await evaluate(
    `[...document.querySelectorAll('.stat-line')].some((l) => l.textContent.includes('本周看答案'))`,
  )
  check('统计页有看答案记录', statsReveal === true, String(statsReveal))

  // ---- 12. 错题本复习闭环 ----
  await nav('/problems')
  await evaluate(`(() => {
    const raw = JSON.parse(localStorage.getItem('lc.progress.v1') || '{"version":3,"problems":{}}');
    raw.problems = raw.problems || {};
    raw.problems['1'] = { status: 'learning', wrong: true, note: '', code: '', cases: [], attempts: 2, passes: 0, timeSpentSec: 300, reviews: [], runs: [] };
    localStorage.setItem('lc.progress.v1', JSON.stringify(raw));
    return 'seeded';
  })()`)
  await nav('/review')
  const dueBefore = await evaluate(`document.querySelector('.page-head p')?.textContent?.replace(/\\s+/g, ' ').trim()`)
  await evaluate(`(() => { const b = document.querySelector('.review-card__pass'); if (!b) return 'none'; b.click(); return 'ok'; })()`)
  await sleep(1500)
  const dueAfter = await evaluate(
    `JSON.stringify({ text: document.querySelector('.page-head p')?.textContent?.replace(/\\s+/g, ' ').trim(), empty: document.body.textContent.includes('今天没有到期的错题') })`,
  )
  const reviewOk = (() => {
    try {
      const parsed = JSON.parse(dueAfter)
      return /1 道错题/.test(dueBefore || '') && parsed.empty === true
    } catch {
      return false
    }
  })()
  check('错题本复习闭环', reviewOk, `${dueBefore} -> ${dueAfter}`)

  // ---- 13. 数据加载失败兜底 ----
  await send('Network.enable')
  await send('Network.setBlockedURLs', { urls: ['*/data/problems.json*'] })
  await send('Page.navigate', { url: `${BASE}/problems` })
  await sleep(6000)
  const offline = await evaluate(
    `JSON.stringify({ text: document.body.textContent.replace(/\\s+/g, ' ').trim().slice(0, 60), blank: document.body.textContent.trim().length === 0 })`,
  )
  await send('Network.setBlockedURLs', { urls: [] })
  const offlineOk = (() => {
    try {
      const parsed = JSON.parse(offline)
      return parsed.blank === false && parsed.text.length > 0
    } catch {
      return false
    }
  })()
  check('数据加载失败兜底（不白屏）', offlineOk, offline)

  // ---- 14. 无障碍/语义抽查（六页）----
  const a11yPages = ['/', '/problems', '/problems/1', '/tutorials', '/review', '/stats']
  const a11yIssues = []
  for (const path of a11yPages) {
    await nav(path, 4000)
    const report = await evaluate(`(() => {
      const nameOf = (el) => (el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || '').trim();
      const unnamed = [...document.querySelectorAll('button, [role="button"]')].filter((el) => !nameOf(el)).length;
      const unlabeled = [...document.querySelectorAll('input, textarea, select')].filter((el) => {
        if (el.type === 'hidden') return false;
        if (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')) return false;
        if (el.closest('label')) return false;
        if (el.id && document.querySelector('label[for="' + el.id + '"]')) return false;
        return true;
      }).length;
      const noAlt = [...document.querySelectorAll('img')].filter((el) => !el.hasAttribute('alt')).length;
      const ids = [...document.querySelectorAll('[id]')].map((el) => el.id);
      const dup = ids.length !== new Set(ids).size;
      const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((h) => Number(h.tagName[1]));
      const skipped = headings.some((n, i) => i > 0 && n - headings[i - 1] > 1);
      const h1 = headings.filter((n) => n === 1).length;
      return JSON.stringify({ unnamed, unlabeled, noAlt, dup, skipped, h1 });
    })()`)
    const r = report ? JSON.parse(report) : {}
    if (r.unnamed || r.unlabeled || r.noAlt || r.dup || r.skipped || r.h1 !== 1) {
      a11yIssues.push(`${path}: ${JSON.stringify(r)}`)
    }
  }
  check('无障碍抽查（六页）', a11yIssues.length === 0, a11yIssues.join(' | ') || '无问题')

  const passed = results.filter((r) => r.pass).length
  console.log(`\n===== ${passed}/${results.length} 通过 =====`)
  ws.close()
  if (chrome) chrome.kill()
  process.exit(passed === results.length ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
