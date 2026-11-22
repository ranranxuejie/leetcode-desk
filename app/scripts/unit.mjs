#!/usr/bin/env node
/**
 * 纯函数单测：在浏览器里 import 真实的 TS 模块跑断言（不装测试框架、不引依赖）。
 *
 * 覆盖判题与筛选的「容易悄悄改坏」的纯逻辑：
 *   - judgeCase 四条规则（有期望 / 无期望抛异常 / 类型不符 / 只运行）
 *   - 顺序不唯一的白名单口径
 *   - normalizeOutput / 存档归一化 / 筛选 key
 *
 * 用法：npm run unit   （需要 npm run dev 已在 5173）
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

async function cdpReady() {
  try {
    return (await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok
  } catch {
    return false
  }
}

async function ensureChrome() {
  if (await cdpReady()) return null
  const chrome = CHROME_CANDIDATES.find((path) => existsSync(path))
  if (!chrome) {
    console.error('找不到 Chrome。')
    process.exit(2)
  }
  const child = spawn(
    chrome,
    [
      '--headless=new',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${join(tmpdir(), `lc-unit-${Date.now()}`)}`,
      '--no-first-run',
      '--disable-gpu',
      'about:blank',
    ],
    { stdio: 'ignore' },
  )
  for (let i = 0; i < 40; i += 1) {
    await sleep(250)
    if (await cdpReady()) return child
  }
  child.kill()
  process.exit(2)
}

/** 在页面里跑的断言集：返回 [{name, pass, detail}] */
const SUITE = String.raw`
(async () => {
  const cases = await import('/src/lib/cases.ts')
  const order = await import('/src/lib/answer-order.ts')
  const utils = await import('/src/lib/utils.ts')
  const filters = await import('/src/lib/filters.ts')

  const out = []
  const t = (name, fn) => {
    try {
      const value = fn()
      out.push({ name, pass: value === true, detail: value === true ? '' : String(value) })
    } catch (error) {
      out.push({ name, pass: false, detail: 'throw: ' + error.message })
    }
  }

  // ---- judgeCase 四条规则 ----
  t('有期望且相符 → 通过', () => cases.judgeCase({ call: 'f(1)', expected: '[1,2]', repr: '[1, 2]', error: '' }).ok === true)
  t('有期望但不符 → 失败', () => {
    const v = cases.judgeCase({ call: 'f(1)', expected: '[1,2]', repr: '[1,3]', error: '' })
    return v.ok === false && v.reason === 'expected'
  })
  t('无期望 + 抛异常 → 失败', () => {
    const v = cases.judgeCase({ call: 'f(1)', expected: '', repr: '', error: 'IndexError' })
    return v.ok === false && v.reason === 'error'
  })
  t('无期望 + 类型不符 → 失败', () => {
    const v = cases.judgeCase({ call: 'f(1)', expected: '', repr: 'None', error: '', returnType: 'integer[]' })
    return v.ok === false && v.reason === 'type'
  })
  t('无期望 + 没报错 + 类型对 → 只运行', () => {
    const v = cases.judgeCase({ call: 'f(1)', expected: '', repr: '[1]', error: '', returnType: 'integer[]' })
    return v.ok === null
  })
  t('调用为空 → 不判定', () => cases.judgeCase({ call: '', expected: '[1]', repr: '[1]', error: '' }).ok === null)
  t('原地修改题 → 不判定', () => {
    const v = cases.judgeCase({ call: 'f([1])', expected: '[1]', repr: 'None', error: '', inPlace: true })
    return v.ok === null && v.reason === 'inplace'
  })

  // ---- 软失败 ----
  t('边界用例不符 → 软失败', () => {
    const v = cases.judgeCase({ call: 'f(1)', expected: '[1]', repr: '[2]', error: '', kind: 'edge' })
    return v.ok === false && v.soft === true
  })
  t('官方示例不符 → 硬失败', () => {
    const v = cases.judgeCase({ call: 'f(1)', expected: '[1]', repr: '[2]', error: '', kind: 'example' })
    return v.ok === false && v.soft !== true
  })
  t('极端输入报错 → 软失败', () => {
    const v = cases.judgeCase({ call: 'f(2**31)', expected: '', repr: '', error: 'RecursionError', extreme: true })
    return v.ok === false && v.soft === true
  })

  // ---- 顺序不唯一 ----
  t('46 全排列顺序不同 → 通过', () => {
    const v = cases.judgeCase({ call: 'f([1,2])', expected: '[[1,2],[2,1]]', repr: '[[2,1],[1,2]]', error: '', problemNo: '46' })
    return v.ok === true && v.orderFree === true
  })
  t('49 组内顺序不同 → 通过', () => {
    const v = cases.judgeCase({ call: 'f(["a"])', expected: '[["ab","ba"]]', repr: '[["ba","ab"]]', error: '', problemNo: '49' })
    return v.ok === true
  })
  t('89 同集合不同序列 → 失败', () => {
    const v = cases.judgeCase({ call: 'f(2)', expected: '[0,1,3,2]', repr: '[0,1,2,3]', error: '', problemNo: '89' })
    return v.ok === false
  })
  t('48 顺序敏感题顺序不同 → 失败', () => {
    const v = cases.judgeCase({ call: 'f([[1,2],[3,4]])', expected: '[[1,2],[3,4]]', repr: '[[3,4],[1,2]]', error: '', problemNo: '48' })
    return v.ok === false
  })
  t('白名单内不同答案集 → 失败', () => {
    const v = cases.judgeCase({ call: 'f([1])', expected: '[[1,2]]', repr: '[[1,3]]', error: '', problemNo: '46' })
    return v.ok === false
  })

  // ---- 输出归一化 ----
  t('normalizeOutput 忽略引号/空白/True-None', () => utils.normalizeOutput("['a', True, None]") === utils.normalizeOutput('["a", true, null]'))
  t('normalizeOutput 区分不同值', () => utils.normalizeOutput('[1]') !== utils.normalizeOutput('[2]'))

  // ---- 筛选 ----
  const base = filters.defaultProblemsFilter ? filters.defaultProblemsFilter() : { query: '', tier: '全部', level: '全部', status: '全部', category: '全部', sort: 'path', scope: 'all' }
  t('scrollKeyOf 不含搜索词', () => {
    const a = filters.scrollKeyOf({ ...base, query: 'a' })
    const b = filters.scrollKeyOf({ ...base, query: 'bb' })
    return a === b
  })
  t('scrollKeyOf 区分范围', () => filters.scrollKeyOf(base) !== filters.scrollKeyOf({ ...base, scope: 'hot100' }))

  // ---- 用例构建 ----
  t('buildEdgeCases 过滤空 call', () => {
    const built = cases.buildEdgeCases({ no: '1', edgeCases: [{ call: '', expected: '[]' }, { call: 'f(1)', expected: '' }] })
    return built.length === 1 && built[0].call === 'f(1)'
  })
  t('mergeEdgeCases 按 call 去重', () => {
    const merged = cases.mergeEdgeCases(
      [{ id: 'case-1', call: 'f(1)', expected: '[1]', kind: 'example' }],
      [{ id: 'edge-data-0', call: 'f(1)', expected: '[1]', kind: 'edge' }],
    )
    return merged.length === 1
  })
  t('persistableCases 不含数据边界用例', () => {
    const kept = cases.persistableCases([
      { id: 'case-1', call: 'f(1)', expected: '[1]', kind: 'example' },
      { id: 'edge-data-0', call: 'f(2)', expected: '', kind: 'edge' },
    ])
    return kept.length === 1 && kept[0].id === 'case-1'
  })
  t('模板代码识别（等于 starter）', () => cases.isUntouchedStarter('class Solution:\n    def f(self):\n        pass\n', 'class Solution:\n    def f(self):\n        pass\n') === true)
  t('模板代码识别（写过实现不算）', () => cases.isUntouchedStarter('class Solution:\n    def f(self):\n        return 1\n', 'class Solution:\n    def f(self):\n        pass\n') === false)

  // ---- 排序与复习节奏 ----
  t('noRank 普通题号按数字排', () => utils.noRank('2') < utils.noRank('10'))
  t('noRank 非数字题号排在后面', () => utils.noRank('1') < utils.noRank('LCP 01'))
  t('noRank 面试题排最后', () => utils.noRank('LCS 01') < utils.noRank('面试题 08.06'))
  t('isDue 非错题不到期', () => utils.isDue({ wrong: false, reviews: [] }) === false)
  t('isDue 错题且没复习过 → 到期', () => utils.isDue({ wrong: true, reviews: [] }) === true)
  t('isDue 刚复习完不到期', () =>
    utils.isDue({ wrong: true, reviews: [{ at: Date.now(), result: 'pass' }] }) === false)
  t('isDue 隔很久的复习 → 到期', () =>
    utils.isDue({ wrong: true, reviews: [{ at: Date.now() - 30 * 86400000, result: 'pass' }] }) === true)
  t('relativeDay 刚刚', () => utils.relativeDay(Date.now()) === '刚刚')
  t('relativeDay 空值 → 还没开始', () => utils.relativeDay(undefined) === '还没开始')
  t('relativeDay 昨天', () => utils.relativeDay(Date.now() - 86400000) === '昨天')

  return JSON.stringify(out)
})()
`

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
  const target = list.find((item) => item.type === 'page')
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

  await send('Page.enable')
  await send('Runtime.enable')
  await send('Page.navigate', { url: `${BASE}/problems` })
  await sleep(4500)

  const res = await send('Runtime.evaluate', {
    expression: SUITE,
    returnByValue: true,
    awaitPromise: true,
  })
  const raw = res.result?.result?.value
  if (!raw) {
    console.error('断言集没有返回结果：', JSON.stringify(res.result?.exceptionDetails ?? {}).slice(0, 400))
    process.exit(1)
  }
  const items = JSON.parse(raw)
  let failed = 0
  for (const item of items) {
    if (!item.pass) failed += 1
    console.log(`${item.pass ? 'PASS' : 'FAIL'}  ${item.name}${item.detail ? '  ' + item.detail : ''}`)
  }
  console.log(`\n===== ${items.length - failed}/${items.length} 通过 =====`)
  ws.close()
  if (chrome) chrome.kill()
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
