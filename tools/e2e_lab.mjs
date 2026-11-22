#!/usr/bin/env node
/**
 * 代码实验室 E2E（零依赖）：用系统 Chrome 的 DevTools 协议驱动本地训练台。
 *
 * 为什么不用 Playwright：这个仓库不允许新增 npm 依赖，而 Node 22+ 自带 WebSocket，
 * 所以直接用 CDP 的 Page / Runtime / Input 域就够了。
 *
 * 用法：
 *   node tools/e2e_lab.mjs
 *   node tools/e2e_lab.mjs > .tmp/e2e-result.json      # 进度打 stderr，JSON 打 stdout
 *
 * 前置：dev server 已启动（端口 5173，由 lead 起）：
 *   cd app && npm.cmd run dev -- --port 5173 --strictPort
 *
 * 环境变量：
 *   E2E_URL          默认 http://127.0.0.1:5173（Vite 只监听 ::1 时自动退回 http://localhost:5173；
 *                    显式传了 E2E_URL 就只试这一个地址）
 *   E2E_PROBLEM      默认 1（题号）
 *   E2E_NO_CHROME=1  不启动 Chrome，直接复用 9222 上已有的实例
 *   E2E_CDP_PORT     默认 9222
 *   E2E_CHROME       默认 C:\Program Files\Google\Chrome\Application\chrome.exe
 *   E2E_CMD          终端里要敲的命令，默认 print("e2e" + "-ok")（刻意让命令文本里不含期望串，
 *                    避免「命令回显」被误判成「有输出」）
 *   E2E_EXPECT       期望出现在终端输出里的文本，默认 e2e-ok
 *   E2E_RENDER_WAIT  等 React 渲染的额外上限（ms），默认 12000
 *   E2E_INPUT_WAIT   点开终端后等输入框出现的上限（ms），默认 20000
 *   E2E_TERM_EXTRA   敲命令后等输出的额外上限（ms），默认 30000（首次 Pyodide 加载可能更久）
 *   E2E_VIEWPORT     默认 1440x900
 *
 * 退出码：全部步骤通过 0，否则 1。
 */

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ---------------------------------------------------------------- 配置

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TMP_DIR = path.join(ROOT, '.tmp')

const DEFAULT_BASE = 'http://127.0.0.1:5173'
const EXPLICIT_BASE = process.env.E2E_URL ? process.env.E2E_URL.replace(/\/+$/, '') : null
let BASE = EXPLICIT_BASE || DEFAULT_BASE
const PROBLEM = process.env.E2E_PROBLEM || '1'
let PAGE_URL = `${BASE}/problems/${PROBLEM}`
const CDP_PORT = Number(process.env.E2E_CDP_PORT || 9222)
const NO_CHROME = process.env.E2E_NO_CHROME === '1'
const CHROME_PATH =
  process.env.E2E_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const CMD = process.env.E2E_CMD || 'print("e2e" + "-ok")'
const EXPECT = process.env.E2E_EXPECT || 'e2e-ok'
const RENDER_WAIT_MS = Number(process.env.E2E_RENDER_WAIT || 12000)
const INPUT_WAIT_MS = Number(process.env.E2E_INPUT_WAIT || 20000)
const TERM_EXTRA_MS = Number(process.env.E2E_TERM_EXTRA || 30000)
const VIEWPORT = (process.env.E2E_VIEWPORT || '1440x900').split('x').map(Number)
const VIEW_W = Number.isFinite(VIEWPORT[0]) ? VIEWPORT[0] : 1440
const VIEW_H = Number.isFinite(VIEWPORT[1]) ? VIEWPORT[1] : 900
const TOTAL_TIMEOUT_MS = Number(process.env.E2E_TOTAL_TIMEOUT || 180000)
const START_AT = Date.now()

// ---------------------------------------------------------------- 小工具

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (msg) => process.stderr.write(`${msg}\n`)

function short(value, max = 300) {
  if (value == null) return ''
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/** 数一个子串出现几次：用来区分「命令回显」和「命令输出」。 */
function countOccurrences(haystack, needle) {
  if (!needle) return 0
  let count = 0
  let index = 0
  for (;;) {
    const found = haystack.indexOf(needle, index)
    if (found === -1) return count
    count += 1
    index = found + needle.length
  }
}

/** 终端里出现期望串的次数必须超过命令本身自带的次数，才算真的有输出。 */
function hasOutput(text) {
  return countOccurrences(text, EXPECT) > countOccurrences(CMD, EXPECT)
}

/** 127.0.0.1 的 localhost 变体：Vite 只监听 ::1 时用它兜底。 */
function localhostVariant(base) {
  try {
    const url = new URL(base)
    if (url.hostname === '127.0.0.1') {
      url.hostname = 'localhost'
      return url.origin
    }
  } catch {
    // 不是合法 URL 就放弃兜底
  }
  return null
}

/** 轮询直到 fn 返回真值，超时返回 null（不抛异常，方便「继续跑后面的步骤」）。 */
async function pollUntil(fn, timeoutMs, intervalMs = 400) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await fn()
    if (value) return value
    if (Date.now() >= deadline) return null
    await sleep(intervalMs)
  }
}

// ---------------------------------------------------------------- 结果收集

const steps = []
const screenshots = []
const consoleErrors = []

/** 跑一步：失败只记录，不中断后面的步骤。 */
async function step(name, fn) {
  const started = Date.now()
  try {
    const detail = await fn()
    const entry = { name, ok: true, ms: Date.now() - started }
    if (detail !== undefined && detail !== null) entry.detail = detail
    steps.push(entry)
    log(`  ✔ ${name} (${entry.ms}ms)${detail ? ` — ${short(detail)}` : ''}`)
    return { ok: true, detail }
  } catch (err) {
    const message = err && err.message ? err.message : String(err)
    steps.push({ name, ok: false, ms: Date.now() - started, error: message })
    log(`  ✘ ${name} (${Date.now() - started}ms) — ${message}`)
    return { ok: false, error: message }
  }
}

// ---------------------------------------------------------------- CDP 客户端

let api = null // { send, on, close }
let sessionId = null
let targetId = null

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    const pending = new Map()
    const listeners = new Set()
    let nextId = 0
    let opened = false

    const timer = setTimeout(() => {
      try {
        ws.close()
      } catch {}
      reject(new Error(`连接 DevTools WebSocket 超时：${wsUrl}`))
    }, 10000)

    ws.addEventListener('open', () => {
      opened = true
      clearTimeout(timer)
      resolve({
        send(method, params = {}, sid, timeoutMs = 20000) {
          const id = ++nextId
          return new Promise((res, rej) => {
            const t = setTimeout(() => {
              pending.delete(id)
              rej(new Error(`CDP 调用超时 ${timeoutMs}ms：${method}`))
            }, timeoutMs)
            pending.set(id, {
              res: (v) => {
                clearTimeout(t)
                res(v)
              },
              rej: (e) => {
                clearTimeout(t)
                rej(e)
              },
            })
            const payload = { id, method, params }
            if (sid) payload.sessionId = sid
            ws.send(JSON.stringify(payload))
          })
        },
        on(fn) {
          listeners.add(fn)
          return () => listeners.delete(fn)
        },
        close() {
          try {
            ws.close()
          } catch {}
        },
      })
    })

    ws.addEventListener('error', () => {
      if (!opened) {
        clearTimeout(timer)
        reject(new Error(`WebSocket 连接失败：${wsUrl}`))
      }
    })

    ws.addEventListener('message', (event) => {
      let msg
      try {
        msg = JSON.parse(typeof event.data === 'string' ? event.data : '')
      } catch {
        return
      }
      if (msg.id && pending.has(msg.id)) {
        const waiter = pending.get(msg.id)
        pending.delete(msg.id)
        if (msg.error) waiter.rej(new Error(`${msg.error.message || 'CDP 错误'} (${msg.error.code})`))
        else waiter.res(msg.result || {})
        return
      }
      if (msg.method) {
        for (const fn of listeners) {
          try {
            fn(msg)
          } catch {}
        }
      }
    })
  })
}

function waitEvent(method, timeoutMs = 20000, predicate = () => true) {
  return new Promise((resolve, reject) => {
    let off = () => {}
    const timer = setTimeout(() => {
      off()
      reject(new Error(`等待事件超时 ${timeoutMs}ms：${method}`))
    }, timeoutMs)
    off = api.on((msg) => {
      if (msg.method !== method) return
      if (sessionId && msg.sessionId && msg.sessionId !== sessionId) return
      if (!predicate(msg)) return
      clearTimeout(timer)
      off()
      resolve(msg.params || {})
    })
  })
}

// ---------------------------------------------------------------- Chrome

let chromeProc = null
let userDataDir = null
let chromeReused = false

async function probeVersion(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(1200),
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

async function waitForCdp(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let lastError = null
  for (;;) {
    const info = await probeVersion(port)
    if (info) return info
    if (Date.now() >= deadline) {
      throw new Error(
        `Chrome 的 DevTools 端口 ${port} 在 ${timeoutMs}ms 内没起来${lastError ? `（${lastError}）` : ''}`,
      )
    }
    await sleep(250)
  }
}

async function killChrome() {
  const proc = chromeProc
  chromeProc = null
  if (!proc || proc.exitCode !== null) return
  if (process.platform === 'win32') {
    await new Promise((resolve) => {
      try {
        const killer = spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], {
          stdio: 'ignore',
          windowsHide: true,
        })
        killer.on('close', resolve)
        killer.on('error', resolve)
      } catch {
        resolve()
      }
    })
  } else {
    try {
      proc.kill('SIGKILL')
    } catch {}
  }
}

function removeUserDataDir() {
  if (!userDataDir) return
  const dir = userDataDir
  userDataDir = null
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 })
      return
    } catch {
      // Chrome 刚被 kill，句柄可能还没释放，等一下再删
    }
  }
  log(`  ! 临时用户目录没删干净，可以手动删：${dir}`)
}

// ---------------------------------------------------------------- 页面内辅助函数
// 用文本定位（Tab 文案 / 输入框 placeholder），不依赖 class 链：这些文件正被并行改。
const PAGE_HELPERS = String.raw`
(() => {
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const isVisible = (el) => {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  };
  const visibleButtons = () => [...document.querySelectorAll('button')].filter(isVisible);
  const allButtonLabels = () => visibleButtons().map((b) => norm(b.textContent)).filter(Boolean).slice(0, 60);
  const findTab = (label) => {
    const target = norm(label).replace(/\s+/g, '');
    const hits = visibleButtons().filter((b) => norm(b.textContent).replace(/\s+/g, '').startsWith(target));
    if (!hits.length) return null;
    // Tab 按钮的 class 通常带 tab，优先它，避免命中正文里的同名按钮
    return hits.find((b) => /tab/i.test(String(b.className || ''))) || hits[0];
  };
  const inputCandidates = () => {
    const nodes = [...document.querySelectorAll('input, textarea, [contenteditable="true"]')];
    return nodes.filter((el) => {
      if (!isVisible(el) || el.disabled || el.readOnly) return false;
      if (el.closest('.cm-editor') || el.closest('.cm-content')) return false;
      if (el.closest('.detail__bar')) return false;
      if (el.tagName === 'INPUT') {
        const type = (el.getAttribute('type') || 'text').toLowerCase();
        if (type !== 'text' && type !== 'search') return false;
      }
      return true;
    });
  };
  const scoreInput = (el) => {
    let score = 0;
    const hint = [el.getAttribute('placeholder'), el.getAttribute('aria-label'), String(el.className || '')].join(' ');
    if (/term|终端|命令|>>>/i.test(hint)) score += 4;
    if (el.closest('[class*="term"]')) score += 3;
    if (el.closest('[class*="lab"]')) score += 1;
    if (el.isContentEditable) score -= 1;
    return score;
  };
  const terminalInput = () => {
    const ranked = inputCandidates().map((el) => ({ el, score: scoreInput(el) }));
    ranked.sort((a, b) => b.score - a.score);
    return ranked.length ? ranked[0] : null;
  };
  // 取终端区域的文本：从输入框往上找第一个有实际内容的容器（终端面板）
  const terminalText = () => {
    const pick = terminalInput();
    if (!pick) return document.body ? document.body.innerText : '';
    let node = pick.el;
    while (node && node !== document.body) {
      const text = node.innerText || '';
      if (text.trim().length > 80) return text;
      node = node.parentElement;
    }
    return document.body ? document.body.innerText : '';
  };
  // 取某个 Tab 对应面板的文本：从 Tab 按钮往上找第一个有实际内容的容器
  const panelText = (label) => {
    const btn = findTab(label);
    if (!btn) return '';
    let node = btn;
    while (node && node !== document.body) {
      const text = node.innerText || '';
      if (text.trim().length > 80) return text;
      node = node.parentElement;
    }
    return document.body ? document.body.innerText : '';
  };
  const clickTab = (label) => {
    const btn = findTab(label);
    if (!btn) return { ok: false, reason: '没有找到文本以「' + label + '」开头的按钮', buttons: allButtonLabels() };
    btn.click();
    return { ok: true, label: norm(btn.textContent) };
  };
  const submitCommand = (cmd) => {
    const pick = terminalInput();
    if (!pick) return { ok: false, reason: '终端里没有找到可编辑的 input/textarea', buttons: allButtonLabels() };
    const el = pick.el;
    el.focus();
    if (el.isContentEditable) {
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, cmd);
    } else {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc && desc.set) desc.set.call(el, cmd);
      else el.value = cmd;
      // React 受控组件：必须走原生 setter + input 事件，否则 onChange 不触发
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const key = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
    el.dispatchEvent(new KeyboardEvent('keydown', key));
    el.dispatchEvent(new KeyboardEvent('keyup', key));
    return {
      ok: true,
      tag: el.tagName,
      className: String(el.className || ''),
      score: pick.score,
      candidates: inputCandidates().length,
      value: el.isContentEditable ? el.innerText : el.value,
    };
  };
  window.__e2e = { norm, findTab, allButtonLabels, terminalInput, terminalText, panelText, clickTab, submitCommand };
  return true;
})()
`

// ---------------------------------------------------------------- 主流程

async function main() {
  fs.mkdirSync(TMP_DIR, { recursive: true })

  log(`\n▶ E2E 目标：${PAGE_URL}`)
  log(`  命令：${CMD}（期望输出包含「${EXPECT}」）\n`)

  // 1) dev server 预检：连不上就别启动 Chrome，直接给出可执行的提示。
  //    Vite 默认 host 是 localhost，在 Windows 上可能只监听 ::1，此时 127.0.0.1 会 ECONNREFUSED，
  //    所以默认配置下再试一次 localhost（显式传 E2E_URL 时不猜，严格按传入的地址）。
  const server = await step('server', async () => {
    const candidates = EXPLICIT_BASE
      ? [EXPLICIT_BASE]
      : [DEFAULT_BASE, localhostVariant(DEFAULT_BASE)].filter(Boolean)
    const tried = []
    for (const candidate of candidates) {
      try {
        const res = await fetch(candidate, { signal: AbortSignal.timeout(4000) })
        tried.push(`${candidate} → HTTP ${res.status}`)
        if (!res.ok) continue
        BASE = candidate
        PAGE_URL = `${candidate}/problems/${PROBLEM}`
        return {
          status: res.status,
          base: candidate,
          tried,
          ...(candidate !== candidates[0]
            ? { note: `${candidates[0]} 连不上（Vite 可能只监听 ::1），自动改用 ${candidate}` }
            : {}),
        }
      } catch (err) {
        const code = err?.cause?.code || err?.code || err?.name || 'UNKNOWN'
        tried.push(`${candidate} → ${code}`)
      }
    }
    const refused = tried.some((item) => item.includes('ECONNREFUSED'))
    throw new Error(
      `dev server 连不上（${tried.join('；')}）${refused ? '，ECONNREFUSED' : ''}。` +
        '先启动 dev server：cd app && npm.cmd run dev -- --port 5173 --strictPort',
    )
  })
  if (!server.ok) return

  // 2) Chrome
  const chrome = await step('chrome', async () => {
    const existing = await probeVersion(CDP_PORT)
    if (existing) {
      chromeReused = true
      return { reused: true, browser: existing.Browser }
    }
    if (NO_CHROME) {
      throw new Error(
        `E2E_NO_CHROME=1，但 127.0.0.1:${CDP_PORT} 上没有可连的 Chrome。先用 --remote-debugging-port=${CDP_PORT} 起一个。`,
      )
    }
    if (!fs.existsSync(CHROME_PATH)) {
      throw new Error(`找不到 Chrome：${CHROME_PATH}（可用 E2E_CHROME 指定路径）`)
    }
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-e2e-'))
    const args = [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      `--remote-debugging-port=${CDP_PORT}`,
      '--remote-allow-origins=*',
      `--user-data-dir=${userDataDir}`,
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-sync',
      '--mute-audio',
      '--hide-scrollbars',
      `--window-size=${VIEW_W},${VIEW_H}`,
      'about:blank',
    ]
    let spawnError = null
    chromeProc = spawn(CHROME_PATH, args, { stdio: 'ignore', windowsHide: true })
    chromeProc.on('error', (err) => {
      spawnError = err
    })
    const info = await waitForCdp(CDP_PORT, 15000)
    if (spawnError) throw new Error(`启动 Chrome 失败：${spawnError.message}`)
    return { reused: false, browser: info.Browser, userDataDir }
  })
  if (!chrome.ok) return

  // 3) 连 DevTools + 建 target
  const ws = await step('cdp-connect', async () => {
    const info = await probeVersion(CDP_PORT)
    if (!info || !info.webSocketDebuggerUrl) throw new Error('拿不到 webSocketDebuggerUrl')
    api = await connect(info.webSocketDebuggerUrl)
    api.on((msg) => {
      if (msg.method === 'Runtime.exceptionThrown') {
        const desc =
          msg.params?.exceptionDetails?.exception?.description ||
          msg.params?.exceptionDetails?.text ||
          '页面异常'
        if (consoleErrors.length < 20) consoleErrors.push(`[exception] ${short(desc, 240)}`)
      } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
        const text = (msg.params.args || [])
          .map((a) => (a.value !== undefined ? String(a.value) : a.description || ''))
          .join(' ')
        if (consoleErrors.length < 20) consoleErrors.push(`[console.error] ${short(text, 240)}`)
      }
    })
    return { ws: info.webSocketDebuggerUrl.replace(/^ws:\/\/[^/]+/, 'ws://…') }
  })
  if (!ws.ok) return

  const target = await step('target', async () => {
    const created = await api.send('Target.createTarget', { url: 'about:blank' })
    targetId = created.targetId
    const attached = await api.send('Target.attachToTarget', { targetId, flatten: true })
    sessionId = attached.sessionId
    if (!sessionId) throw new Error('attachToTarget 没返回 sessionId')
    const send = (method, params) => api.send(method, params, sessionId)
    await send('Page.enable')
    await send('Runtime.enable')
    await send('Emulation.setDeviceMetricsOverride', {
      width: VIEW_W,
      height: VIEW_H,
      deviceScaleFactor: 1,
      mobile: false,
    })
    return { targetId, sessionId }
  })
  if (!target.ok) return

  const send = (method, params = {}, timeoutMs = 20000) => api.send(method, params, sessionId, timeoutMs)

  async function evaluate(expression) {
    const res = await send(
      'Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true, timeout: 30000 },
      30000,
    )
    if (res.exceptionDetails) {
      const desc =
        res.exceptionDetails.exception?.description || res.exceptionDetails.text || '页面脚本抛异常'
      throw new Error(`页面脚本异常：${short(desc, 400)}`)
    }
    return res.result ? res.result.value : undefined
  }

  async function capture(name) {
    const res = await send('Page.captureScreenshot', { format: 'png' }, 20000)
    const file = path.join(TMP_DIR, name)
    fs.writeFileSync(file, Buffer.from(res.data, 'base64'))
    screenshots.push(file)
    return file
  }

  // 页面辅助函数会被 HMR 整页刷新清掉（并行开发时很常见），所以每次交互前确认一次。
  async function ensureHelpers() {
    const present = await evaluate('typeof window.__e2e === "object" && window.__e2e !== null')
    if (present === true) return false
    const injected = await evaluate(PAGE_HELPERS)
    if (injected !== true) throw new Error('页面辅助函数注入失败')
    return true
  }

  // 页面里求值：自动补注入辅助函数；执行上下文被刷新时重试一次
  async function pageEval(expression, retries = 2) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await ensureHelpers()
        return await evaluate(expression)
      } catch (err) {
        const message = err && err.message ? err.message : String(err)
        const recoverable = /context|Cannot find context|Execution context|detached/i.test(message)
        if (attempt >= retries || !recoverable) throw err
        await sleep(500)
      }
    }
  }

  // 4) 导航
  const nav = await step('navigate', async () => {
    const loaded = waitEvent('Page.loadEventFired', 25000)
    const result = await send('Page.navigate', { url: PAGE_URL }, 25000)
    if (result.errorText) {
      const hint = /CONNECTION_REFUSED/.test(result.errorText)
        ? '（先启动 dev server：cd app && npm.cmd run dev -- --port 5173 --strictPort）'
        : ''
      throw new Error(`导航失败：${result.errorText}${hint}`)
    }
    let loadWarning = null
    try {
      await loaded
    } catch (err) {
      loadWarning = err.message
    }
    await sleep(2500) // problems.json 约 1MB，给 React 渲染 + 数据加载留时间
    const state = await evaluate('({ readyState: document.readyState, href: location.href, title: document.title })')
    if (loadWarning && state.readyState === 'loading') throw new Error(loadWarning)
    return { ...state, ...(loadWarning ? { loadWarning } : {}) }
  })
  if (!nav.ok) return

  // 5) 注入页面辅助函数 + 检查渲染
  const helpers = await step('inject-helpers', async () => {
    await ensureHelpers()
    return { ok: true }
  })

  let renderState = null
  const render = await step('render', async () => {
    if (!helpers.ok) throw new Error('页面辅助函数未注入')
    const probe = () =>
      pageEval(`(() => {
        const body = document.body ? document.body.innerText : '';
        // Vite 的报错浮层在 shadow DOM 里，body.innerText 读不到，单独取一次
        const overlay = document.querySelector('vite-error-overlay');
        const overlayText = overlay && overlay.shadowRoot ? (overlay.shadowRoot.textContent || '') : '';
        return {
          hasLab: body.includes('代码实验室'),
          hasStatement: body.includes('题面'),
          hasTerminalTab: Boolean(window.__e2e.findTab('终端')),
          hasAnalysisTab: Boolean(window.__e2e.findTab('解析')),
          errorPage: /ERR_CONNECTION_REFUSED|ERR_EMPTY_RESPONSE|This site can.t be reached/i.test(body),
          overlayPresent: Boolean(overlay),
          overlay: overlayText.replace(/\\s+/g, ' ').trim().slice(0, 400),
          textLength: body.length,
          head: body.slice(0, 300),
        };
      })()`)
    const first = await probe()
    renderState = first
    if (first.errorPage) {
      throw new Error('Chrome 打开的是错误页：dev server 不可达（先启动 npm.cmd run dev）')
    }
    if (first.overlayPresent) {
      throw new Error(`页面没渲染：Vite 报错浮层 — ${first.overlay || '（读不到浮层文本）'}`)
    }
    if (first.hasLab && first.hasStatement) return first
    // 首屏可能还在加载题库，再等一会儿
    const waited = await pollUntil(
      async () => {
        const state = await probe()
        renderState = state
        return state.hasLab && state.hasStatement ? state : null
      },
      RENDER_WAIT_MS,
      500,
    )
    if (!waited) {
      throw new Error(
        `页面里没同时出现「代码实验室」和「题面」（已多等 ${RENDER_WAIT_MS}ms）；当前可见文本：${short(renderState?.head, 200)}`,
      )
    }
    return waited
  })

  // 6) 终端 Tab
  const termTab = await step('terminal-tab', async () => {
    if (!render.ok) throw new Error('页面渲染未通过，跳过点击')
    const result = await pageEval(`window.__e2e.clickTab('终端')`)
    if (!result || !result.ok) {
      throw new Error(`${result?.reason || '点击终端 Tab 失败'}；当前可见按钮：${short(result?.buttons, 240)}`)
    }
    return { tab: result.label }
  })

  const termInput = await step('terminal-input', async () => {
    if (!termTab.ok) throw new Error('终端 Tab 没点开')
    const waitInput = () =>
      pollUntil(() => pageEval(`Boolean(window.__e2e.terminalInput())`), INPUT_WAIT_MS, 400)
    // 等输入框出现（Terminal 可能在等 Python 就绪）
    let found = await waitInput()
    if (!found) {
      // 并行开发时 HMR 可能刚整页刷新，Tab 状态被重置，再点一次
      await pageEval(`window.__e2e.clickTab('终端')`)
      found = await waitInput()
    }
    if (!found) {
      const labels = await pageEval('window.__e2e.allButtonLabels()')
      throw new Error(`终端面板里没找到输入框；当前可见按钮：${short(labels, 240)}`)
    }
    const submitted = await pageEval(`window.__e2e.submitCommand(${JSON.stringify(CMD)})`)
    if (!submitted || !submitted.ok) throw new Error(submitted?.reason || '输入命令失败')
    return submitted
  })

  // 7) 等回显 / 输出
  let terminalText = ''
  await step('terminal-output', async () => {
    if (!termInput.ok) throw new Error('命令没提交成功')
    await sleep(3000) // 先给 3s；首次 Pyodide 加载更慢，再按 E2E_TERM_EXTRA 追加轮询
    const read = () => pageEval(`window.__e2e.terminalText()`)
    terminalText = (await read()) || ''
    if (hasOutput(terminalText)) {
      return { matched: true, waitedMs: 3000, text: short(terminalText, 600) }
    }
    const matched = await pollUntil(
      async () => {
        const text = (await read()) || ''
        terminalText = text
        return hasOutput(text) ? text : null
      },
      TERM_EXTRA_MS,
      1000,
    )
    if (!matched) {
      throw new Error(
        `终端里没出现「${EXPECT}」（又等了 ${TERM_EXTRA_MS}ms）；终端文本：${short(terminalText, 400)}`,
      )
    }
    return { matched: true, text: short(matched, 600) }
  })

  // 8) 终端截图（无论上一步成败都截，方便定位）
  await step('screenshot-terminal', async () => {
    const file = await capture('shot-terminal.png')
    return { file }
  })

  // 9) 解析 Tab
  let analysisTabOk = false
  await step('analysis-tab', async () => {
    if (!render.ok) throw new Error('页面渲染未通过，跳过点击')
    const result = await pageEval(`window.__e2e.clickTab('解析')`)
    if (!result || !result.ok) {
      throw new Error(`${result?.reason || '点击解析 Tab 失败'}；当前可见按钮：${short(result?.buttons, 240)}`)
    }
    analysisTabOk = true
    await sleep(1000)
    return { tab: result.label }
  })

  let analysisText = ''
  await step('analysis-content', async () => {
    if (!analysisTabOk) throw new Error('解析 Tab 没点开')
    const read = () => pageEval(`window.__e2e.panelText('解析')`)
    const needles = ['考点', '参考答案', '一句话', '常见误区', '载入编辑器']
    const hit = (text) => needles.filter((n) => text.includes(n))
    analysisText = (await read()) || ''
    if (!hit(analysisText).length) {
      // HMR 整页刷新会重置 Tab，再点一次
      await pageEval(`window.__e2e.clickTab('解析')`)
      await sleep(600)
      analysisText = (await read()) || ''
    }
    if (hit(analysisText).length) return { matched: hit(analysisText), text: short(analysisText, 600) }
    const waited = await pollUntil(
      async () => {
        analysisText = (await read()) || ''
        return hit(analysisText).length ? hit(analysisText) : null
      },
      6000,
      500,
    )
    if (!waited) {
      throw new Error(`解析面板里没出现「考点 / 参考答案」；可见文本：${short(analysisText, 400)}`)
    }
    return { matched: waited, text: short(analysisText, 600) }
  })

  await step('screenshot-analysis', async () => {
    const file = await capture('shot-analysis.png')
    return { file }
  })

  // 收尾：把终端/解析文本留在汇总里（截断，避免刷屏）
  summaryTexts.terminalText = short(terminalText, 3000)
  summaryTexts.analysisText = short(analysisText, 3000)
  summaryTexts.render = renderState
}

const summaryTexts = {
  terminalText: '',
  analysisText: '',
  render: null,
}

// ---------------------------------------------------------------- 入口

const watchdog = setTimeout(() => {
  log('\n总超时，强制退出（E2E_TOTAL_TIMEOUT）')
  process.exit(1)
}, TOTAL_TIMEOUT_MS)

let fatal = null
try {
  await main()
} catch (err) {
  fatal = err && err.message ? err.message : String(err)
  log(`\n未捕获错误：${fatal}`)
} finally {
  try {
    if (api && targetId) await api.send('Target.closeTarget', { targetId }, undefined, 2000)
  } catch {}
  try {
    if (api) api.close()
  } catch {}
  await killChrome()
  if (!chromeReused) {
    await sleep(300)
    removeUserDataDir()
  }
  clearTimeout(watchdog)
}

const ok = !fatal && steps.length > 0 && steps.every((s) => s.ok)
const failed = steps.filter((s) => !s.ok).map((s) => s.name)

const summary = {
  ok,
  url: PAGE_URL,
  problem: PROBLEM,
  command: CMD,
  expect: EXPECT,
  chromeReused,
  steps,
  failed,
  terminalText: summaryTexts.terminalText,
  analysisText: summaryTexts.analysisText,
  screenshots,
  consoleErrors,
  render: summaryTexts.render,
  durationMs: Date.now() - START_AT,
  ...(fatal ? { fatal } : {}),
}

process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
log(`\n${ok ? '✅ 全部步骤通过' : `❌ 有 ${failed.length} 步失败：${failed.join(', ')}`}`)
process.exitCode = ok ? 0 : 1
