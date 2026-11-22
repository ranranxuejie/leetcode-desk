#!/usr/bin/env node
/**
 * 代码实验室「运行 + 单步追踪」E2E（零依赖，CDP）。
 *
 * 用法（先起 dev server）：
 *   node tools/e2e_run.mjs
 *   E2E_URL=http://localhost:5173 E2E_PROBLEM=1 node tools/e2e_run.mjs
 *
 * 检查：点「运行」→ 控制台出现 PASS、点用例上的虫子按钮 → 出现「单步追踪」表格、
 * 终端里能读到运行后留下的会话变量。
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TMP = path.join(ROOT, '.tmp')
const BASE = (process.env.E2E_URL || 'http://localhost:5173').replace(/\/+$/, '')
const PROBLEM = process.env.E2E_PROBLEM || '1'
const PORT = Number(process.env.E2E_CDP_PORT || 9223)
const CHROME =
  process.env.E2E_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

const steps = []
const log = (msg) => process.stderr.write(`${msg}\n`)
function record(name, ok, detail) {
  steps.push({ name, ok, detail })
  log(`${ok ? '✔' : '✘'} ${name} — ${JSON.stringify(detail)}`)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function fetchJson(url, tries = 60) {
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await fetch(url)
      if (res.ok) return await res.json()
    } catch {
      // 还没起来
    }
    await sleep(250)
  }
  throw new Error(`连不上 ${url}`)
}

// ---------------------------------------------------------------- CDP

class Cdp {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data)
      if (typeof msg.id === 'number' && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        if (msg.error) reject(new Error(msg.error.message))
        else resolve(msg.result)
      }
    })
  }

  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error(`${method} 超时`))
        }
      }, 30000)
    })
  }

  async evaluate(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    if (res.exceptionDetails) {
      throw new Error(res.exceptionDetails.text || '页面脚本抛异常')
    }
    return res.result?.value
  }
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    ws.addEventListener('open', () => resolve(ws))
    ws.addEventListener('error', () => reject(new Error('WebSocket 连接失败')))
  })
}

// ---------------------------------------------------------------- 主流程

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-e2e-run-'))
let chrome = null
let cdp = null

async function main() {
  // 1. dev server
  try {
    const res = await fetch(`${BASE}/`)
    record('server', res.ok, { base: BASE, status: res.status })
  } catch (error) {
    record('server', false, { base: BASE, error: String(error) })
    log('\n先启动 dev server：cd app && npm.cmd run dev -- --port 5173 --strictPort')
    return 1
  }

  // 2. Chrome
  chrome = spawn(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${userDataDir}`,
      'about:blank',
    ],
    { stdio: 'ignore', detached: false },
  )
  const version = await fetchJson(`http://127.0.0.1:${PORT}/json/version`)
  record('chrome', true, { browser: version.Browser })

  // 3. 新建页面
  const target = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })
    .then((r) => r.json())
    .catch(async () => {
      const list = await fetchJson(`http://127.0.0.1:${PORT}/json/list`)
      return list.find((item) => item.type === 'page')
    })
  const ws = await connect(target.webSocketDebuggerUrl)
  cdp = new Cdp(ws)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  })
  record('target', true, { url: target.url })

  // 4. 打开题目
  await cdp.send('Page.navigate', { url: `${BASE}/problems/${PROBLEM}` })
  await sleep(3500)
  const rendered = await cdp.evaluate(
    `(() => ({ lab: document.body.innerText.includes('代码实验室'), run: !!document.querySelector('.btn--run') }))()`,
  )
  record('navigate', rendered.lab && rendered.run, rendered)

  // 5. 从「解析」Tab 载入参考答案（同时验证 ensureImports 补齐 import）
  const loaded = await cdp.evaluate(`(() => {
    const analysis = [...document.querySelectorAll('.tab')].find(b => b.textContent.trim().startsWith('解析'))
    if (!analysis) return { ok: false, why: 'no-analysis-tab' }
    analysis.click()
    return { ok: true }
  })()`)
  await sleep(800)
  const loadClicked = await cdp.evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('载入编辑器'))
    if (!btn) return { ok: false, why: 'no-load-button' }
    btn.click()
    return { ok: true }
  })()`)
  await sleep(800)
  const editorText = await cdp.evaluate(`(() => {
    const lines = [...document.querySelectorAll('.cm-line')].map(el => el.textContent).join('\\n')
    return lines
  })()`)
  record('load-reference', Boolean(loadClicked.ok), {
    analysisTab: loaded.ok,
    loaded: loadClicked,
    hasImport: /from typing import/.test(editorText || ''),
    hasMethod: /def twoSum/.test(editorText || ''),
    head: (editorText || '').slice(0, 200),
  })

  // 6. 点「运行」
  const clicked = await cdp.evaluate(`(() => {
    const btn = document.querySelector('.lab__head .btn--run') || [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '运行')
    if (!btn) return false
    btn.click()
    return true
  })()`)
  record('click-run', Boolean(clicked), { clicked })

  // 7. 等控制台出结果（Pyodide 首次加载可能十几秒）
  let consoleText = ''
  let passed = false
  for (let i = 0; i < 60; i += 1) {
    await sleep(1000)
    consoleText = await cdp.evaluate(
      `document.querySelector('.lab__console')?.innerText || ''`,
    )
    if (/PASS|FAIL|报错|超时/.test(consoleText || '')) {
      passed = /PASS/.test(consoleText) && !/FAIL/.test(consoleText)
      break
    }
  }
  record('run-result', passed, { text: (consoleText || '').slice(0, 500) })

  // 8. 单步追踪（控制台每条结果右侧的「追踪」按钮）
  const traceClicked = await cdp.evaluate(`(() => {
    const btn = document.querySelector('.console__trace')
    if (!btn) return false
    btn.click()
    return true
  })()`)
  let traceText = ''
  for (let i = 0; i < 30; i += 1) {
    await sleep(1000)
    traceText = await cdp.evaluate(
      `document.querySelector('.trace')?.innerText || ''`,
    )
    if (/单步追踪/.test(traceText || '')) break
  }
  record('trace-panel', /单步追踪/.test(traceText || ''), {
    clicked: Boolean(traceClicked),
    head: (traceText || '').slice(0, 400),
  })

  // 9. 终端里读运行后的会话变量
  const terminalVars = await cdp.evaluate(`(() => {
    const tab = [...document.querySelectorAll('.lab__tab')].find(b => b.textContent.includes('终端'))
    if (tab) tab.click()
    return true
  })()`)
  await sleep(1200)
  const termText = await cdp.evaluate(
    `document.querySelector('.term')?.innerText || document.body.innerText`,
  )
  record('terminal-vars', /变量/.test(termText || ''), {
    clicked: Boolean(terminalVars),
    head: (termText || '').slice(0, 300),
  })

  // 10. 截图
  fs.mkdirSync(TMP, { recursive: true })
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  const file = path.join(TMP, `shot-run-${PROBLEM}.png`)
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'))
  record('screenshot', true, { file })

  const failed = steps.filter((s) => !s.ok)
  log(`\n${failed.length ? '❌' : '✅'} ${steps.length - failed.length}/${steps.length} 步通过`)
  process.stdout.write(JSON.stringify({ ok: failed.length === 0, steps }, null, 2) + '\n')
  return failed.length === 0 ? 0 : 1
}

let code = 1
try {
  code = await main()
} catch (error) {
  log(`\n致命错误：${error?.stack || error}`)
  process.stdout.write(JSON.stringify({ ok: false, error: String(error), steps }, null, 2) + '\n')
  code = 1
} finally {
  try {
    await cdp?.send('Browser.close')
  } catch {
    // 忽略
  }
  try {
    chrome?.kill()
  } catch {
    // 忽略
  }
  await sleep(300)
  try {
    fs.rmSync(userDataDir, { recursive: true, force: true })
  } catch {
    // 忽略
  }
  process.exit(code)
}
