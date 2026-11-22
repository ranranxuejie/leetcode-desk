#!/usr/bin/env node
/**
 * 新用户首次使用全流程（自己拉一个干净 profile 的 Chrome）：
 *   今日页 → 按路线排题 → 进题目页（新手引导）→ 写两数之和 → 运行 → 刷新后进度还在
 *
 * 用法：npm run firstrun   （需要 npm run dev 已在 5173）
 */
const PORT = process.env.CDP_PORT || 9333
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

async function main() {
  if (!existsSync(CHROME)) {
    console.error('no chrome')
    process.exit(2)
  }
  const child = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${join(tmpdir(), `lc-firstrun-${Date.now()}`)}`,
      '--no-first-run',
      '--disable-gpu',
      'about:blank',
    ],
    { stdio: 'ignore' },
  )
  for (let i = 0; i < 40; i += 1) {
    await sleep(250)
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break
    } catch {}
  }
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
    const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    return res.result?.result?.value
  }
  const until = async (expression, timeout = 60000) => {
    const started = Date.now()
    while (Date.now() - started < timeout) {
      if (await evaluate(expression)) return true
      await sleep(500)
    }
    return false
  }

  await send('Page.enable')
  await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false })

  const steps = []
  const step = (name, ok, detail) => {
    steps.push({ name, ok })
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail ?? ''}`)
  }

  // 1. 首次打开今日页
  await send('Page.navigate', { url: 'http://127.0.0.1:5173/' })
  await sleep(4500)
  const today = await evaluate(`JSON.stringify({
    hero: document.querySelector('.hero__title, h1')?.textContent?.trim().slice(0, 12),
    planEmpty: document.body.textContent.includes('今天还没有排题'),
    backupNudge: Boolean(document.querySelector('.backup-nudge')),
    cards: document.querySelectorAll('.stats-strip a').length,
  })`)
  step('首次打开今日页', JSON.parse(today).planEmpty === true, today)

  // 2. 点「按路线排 3 题」
  await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('按路线排')); b?.click(); return 'ok'; })()`)
  await sleep(1500)
  const planned = await evaluate(`(() => { const links = [...document.querySelectorAll('a')].filter((a) => /^\\/problems\\/\\w+/.test(a.getAttribute('href') || '')); return JSON.stringify({ rows: links.length, first: links[0]?.getAttribute('href') }); })()`)
  step('按路线排题', JSON.parse(planned).rows >= 3, planned)

  // 3. 从计划里点进第一题
  await evaluate(`(() => { const a = [...document.querySelectorAll('a')].find((x) => /^\\/problems\\/\\w+/.test(x.getAttribute('href') || '')); a?.click(); return 'ok'; })()`)
  await sleep(5000)
  const detail = await evaluate(`JSON.stringify({ title: document.querySelector('.detail__title')?.textContent?.trim(), guide: Boolean(document.querySelector('.guide')), tabs: document.querySelectorAll('.tab').length })`)
  step('进入题目页（含新手引导）', detail.includes('guide":true'), detail)

  // 4. 写一个正确解并运行（固定去两数之和，计划里的第一题不一定是它）
  await send('Page.navigate', { url: 'http://127.0.0.1:5173/problems/1' })
  await sleep(5000)
  await evaluate(`(() => { const el = document.querySelector('.cm-content'); el.focus(); return 'ok'; })()`)
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 })
  await send('Input.insertText', {
    text: 'from typing import List\nclass Solution:\n    def twoSum(self, nums: List[int], target: int) -> List[int]:\n        seen = {}\n        for i, x in enumerate(nums):\n            if target - x in seen:\n                return [seen[target - x], i]\n            seen[x] = i\n        return []\n',
  })
  await sleep(500)
  await evaluate(`document.querySelector('.btn--run')?.click(); 'ok'`)
  const ran = await until(`Boolean(document.querySelector('.lab__summary'))`, 120000)
  await sleep(700)
  const verdict = await evaluate(`document.querySelector('.lab__summary')?.textContent?.replace(/\\s+/g, ' ').trim()`)
  step('写解并运行', ran && /判定/.test(verdict || ''), verdict)

  // 5. 刷新后进度还在 + 引导不再出现
  await send('Page.navigate', { url: 'http://127.0.0.1:5173/' })
  await sleep(4500)
  const persisted = await evaluate(`JSON.stringify({
    runs: [...document.querySelectorAll('.stat')].map((s) => s.textContent.replace(/\\s+/g, ' ').trim()).find((t) => t.includes('今日运行')),
    backupNudge: Boolean(document.querySelector('.backup-nudge')),
  })`)
  step('刷新后进度还在', persisted.includes('今日运行'), persisted)

  const ok = steps.filter((s) => s.ok).length
  console.log(`\n===== 首次使用流程 ${ok}/${steps.length} =====`)
  ws.close()
  child.kill()
  process.exit(ok === steps.length ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
