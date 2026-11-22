#!/usr/bin/env node
/**
 * 验证「题库筛选条件 + 滚动位置」在往返题目页后是否保留。
 *
 *   node tools/e2e_filters.mjs
 *   E2E_URL=http://127.0.0.1:5173 node tools/e2e_filters.mjs
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASE = (process.env.E2E_URL || 'http://127.0.0.1:5173').replace(/\/+$/, '')
const PORT = Number(process.env.E2E_PORT || 9229)
const CHROME =
  process.env.E2E_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (m) => process.stderr.write(`${m}\n`)
const steps = []
function record(name, ok, detail) {
  steps.push({ name, ok, detail })
  log(`${ok ? '✔' : '✘'} ${name} — ${JSON.stringify(detail)}`)
}

async function fetchJson(url, tries = 60) {
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await fetch(url)
      if (res.ok) return await res.json()
    } catch {
      /* 还没起来 */
    }
    await sleep(250)
  }
  throw new Error(`连不上 ${url}`)
}

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
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.text || '页面脚本异常')
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

const readState = `(() => {
  const activeChips = [...document.querySelectorAll('.filter-bar .chip.active')].map(b => b.textContent.trim())
  const selects = [...document.querySelectorAll('.filter-bar select')].map(s => s.value)
  const meta = document.querySelector('.results-meta')?.innerText || ''
  const main = document.querySelector('.main')
  return { activeChips, selects, meta: meta.replace(/\\s+/g, ' ').trim().slice(0, 80), scrollTop: Math.round(main?.scrollTop || 0), maxScroll: main ? Math.round(main.scrollHeight - main.clientHeight) : -1, saved: localStorage.getItem('lc.filters.problems.scroll.v1') }
})()`

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-filters-'))
let chrome = null
let cdp = null

async function main() {
  try {
    const res = await fetch(`${BASE}/`)
    record('server', res.ok, { base: BASE, status: res.status })
  } catch (error) {
    record('server', false, { error: String(error) })
    return 1
  }

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
    { stdio: 'ignore' },
  )
  await fetchJson(`http://127.0.0.1:${PORT}/json/version`)
  const target = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })
    .then((r) => r.json())
    .catch(async () => {
      const list = await fetchJson(`http://127.0.0.1:${PORT}/json/list`)
      return list.find((item) => item.type === 'page')
    })
  cdp = new Cdp(await connect(target.webSocketDebuggerUrl))
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1500,
    height: 950,
    deviceScaleFactor: 1,
    mobile: false,
  })

  // 1. 打开题库
  await cdp.send('Page.navigate', { url: `${BASE}/problems` })
  await sleep(3000)
  const initial = await cdp.evaluate(readState)
  record('open-problems', Boolean(initial), initial)

  // 2. 选条件：难度=中等、排序=华为频度（选一个结果足够多的组合，才测得出滚动恢复）
  await cdp.evaluate(`(() => {
    const chip = [...document.querySelectorAll('.filter-bar .chip')].find(b => b.textContent.trim() === '中等')
    if (chip) chip.click()
    
    const sort = [...document.querySelectorAll('.filter-bar select')].at(-1)
    if (sort) {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set
      setter.call(sort, 'freq')
      sort.dispatchEvent(new Event('change', { bubbles: true }))
    }
    return true
  })()`)
  await sleep(600)
  const chosen = await cdp.evaluate(readState)
  record(
    'choose-filters',
    chosen.activeChips.includes('中等') && chosen.selects.includes('freq'),
    chosen,
  )

  // 3. 往下滚一段，记录位置
  await cdp.evaluate(`(() => { const m = document.querySelector('.main'); if (m) m.scrollTop = 900; return true })()`)
  await sleep(500)
  const scrolled = await cdp.evaluate(readState)
  record('scroll-down', scrolled.scrollTop > 500, scrolled)

  // 4. 点开一道题
  const opened = await cdp.evaluate(`(() => {
    const row = document.querySelector('.problem-table tbody tr')
    if (!row) return null
    row.click()
    return location.pathname
  })()`)
  await sleep(2500)
  const onDetail = await cdp.evaluate(`location.pathname`)
  record('open-problem', onDetail && onDetail.startsWith('/problems/'), { path: onDetail })

  // 5. 浏览器后退
  await cdp.evaluate('history.back()')
  await sleep(2500)
  const restored = await cdp.evaluate(readState)
  const backPath = await cdp.evaluate('location.pathname')
  record(
    'filters-restored',
    backPath === '/problems' &&
      restored.activeChips.includes('中等') &&
      restored.selects.includes('freq'),
    { path: backPath, ...restored },
  )
  record(
    'scroll-restored',
    restored.scrollTop > 500,
    { before: scrolled.scrollTop, after: restored.scrollTop },
  )

  // 6. 整页刷新后条件仍在
  await cdp.send('Page.navigate', { url: `${BASE}/problems` })
  await sleep(2800)
  const reloaded = await cdp.evaluate(readState)
  record(
    'filters-after-reload',
    reloaded.activeChips.includes('中等'),
    reloaded,
  )

  const failed = steps.filter((s) => !s.ok)
  log(`\n${failed.length ? '❌' : '✅'} ${steps.length - failed.length}/${steps.length} 步通过`)
  process.stdout.write(JSON.stringify({ ok: failed.length === 0, steps }, null, 2) + '\n')
  return failed.length === 0 ? 0 : 1
}

let code = 1
try {
  code = await main()
} catch (error) {
  log(`失败：${error?.stack || error}`)
  process.stdout.write(JSON.stringify({ ok: false, error: String(error), steps }, null, 2) + '\n')
} finally {
  try {
    await cdp?.send('Browser.close')
  } catch {
    /* ignore */
  }
  try {
    chrome?.kill()
  } catch {
    /* ignore */
  }
  await sleep(200)
  try {
    fs.rmSync(userDataDir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
  process.exit(code)
}
