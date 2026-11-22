#!/usr/bin/env node
/**
 * 批量页面截图（零依赖 CDP）。
 *
 * 用法：
 *   node tools/shots.mjs                 # 默认截 6 个页面到 .tmp/shots/
 *   node tools/shots.mjs /problems/1 /stats
 *   E2E_URL=http://127.0.0.1:5173 E2E_PORT=9228 node tools/shots.mjs
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, '.tmp', 'shots')
const BASE = (process.env.E2E_URL || 'http://127.0.0.1:5173').replace(/\/+$/, '')
const PORT = Number(process.env.E2E_PORT || 9228)
const CHROME =
  process.env.E2E_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const ROUTES = process.argv.slice(2)
const DEFAULT_ROUTES = ['/', '/problems', '/problems/1', '/tutorials', '/review', '/stats']
const routes = ROUTES.length ? ROUTES : DEFAULT_ROUTES

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (msg) => process.stderr.write(`${msg}\n`)

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

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-shots-'))
let chrome = null
let cdp = null

async function main() {
  try {
    const res = await fetch(`${BASE}/`)
    log(`server ${BASE} -> ${res.status}`)
  } catch (error) {
    log(`dev server 没起来：${error}`)
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
  const ws = await connect(target.webSocketDebuggerUrl)
  cdp = new Cdp(ws)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1500,
    height: 950,
    deviceScaleFactor: 1,
    mobile: false,
  })

  fs.mkdirSync(OUT, { recursive: true })
  const saved = []
  for (const route of routes) {
    await cdp.send('Page.navigate', { url: `${BASE}${route}` })
    await sleep(route.startsWith('/problems/') ? 3200 : 2200)
    // 题目页等代码编辑器挂载完
    if (route.startsWith('/problems/')) await sleep(800)
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
    const name = route === '/' ? 'today' : route.replace(/^\//, '').replace(/[/?]+/g, '-')
    const file = path.join(OUT, `${name}.png`)
    fs.writeFileSync(file, Buffer.from(shot.data, 'base64'))
    saved.push(file)
    log(`✔ ${route} -> ${file}`)
  }
  process.stdout.write(JSON.stringify({ ok: true, screenshots: saved }, null, 2) + '\n')
  return 0
}

let code = 1
try {
  code = await main()
} catch (error) {
  log(`失败：${error?.stack || error}`)
} finally {
  try {
    await cdp?.send('Browser.close')
  } catch {
    // ignore
  }
  try {
    chrome?.kill()
  } catch {
    // ignore
  }
  await sleep(200)
  try {
    fs.rmSync(userDataDir, { recursive: true, force: true })
  } catch {
    // ignore
  }
  process.exit(code)
}
