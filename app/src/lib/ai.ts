/**
 * AI 判题：把用户写的代码发给 DeepSeek，让它判断对错并解释。
 *
 * 设计要点（按需求）：
 * 1. 短对话：每次请求只带 system + 一条「当前代码」消息 + 最近几条追问。
 * 2. 每个题目一个独立会话：切到别的题不会带上上一题的历史。
 * 3. 上下文齐全：题面、示例、方法名、本地跑用例的结果都塞进 system。
 * 4. Key 不进前端：请求打到 /api/deepseek/*，由 vite 代理注入 Authorization。
 */
import { useSyncExternalStore } from 'react'
import type { Problem } from './types'

export type Verdict = 'pass' | 'fail' | 'unknown' | null

export interface AiTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface AiSession {
  problemNo: string
  /** 最近一次送审的代码（永远是第一条 user 消息，代码改了会被替换） */
  codeMessage: string | null
  /** 追问对话，只保留最近几条，保证"短对话" */
  chat: AiTurn[]
  verdict: Verdict
  busy: boolean
  streaming: string
  error: string | null
  updatedAt: number
}

const EMPTY: AiSession = {
  problemNo: '',
  codeMessage: null,
  chat: [],
  verdict: null,
  busy: false,
  streaming: '',
  error: null,
  updatedAt: 0,
}

const MAX_CHAT_TURNS = 6 // 追问最多保留 3 轮问答

let sessions: Record<string, AiSession> = {}
// useSyncExternalStore 要求快照引用稳定，否则会无限重渲染，所以空会话要缓存
const emptyCache = new Map<string, AiSession>()
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((fn) => fn())
}

function snapshot(no: string): AiSession {
  const existing = sessions[no]
  if (existing) return existing
  let empty = emptyCache.get(no)
  if (!empty) {
    empty = { ...EMPTY, problemNo: no }
    emptyCache.set(no, empty)
  }
  return empty
}

function patch(no: string, next: Partial<AiSession>) {
  sessions = {
    ...sessions,
    [no]: { ...snapshot(no), ...next, problemNo: no, updatedAt: Date.now() },
  }
  emit()
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function useAiSession(no: string): AiSession {
  return useSyncExternalStore(
    subscribe,
    () => snapshot(no),
    () => snapshot(no),
  )
}

export function clearSession(no: string) {
  const fresh = { ...EMPTY, problemNo: no, updatedAt: Date.now() }
  emptyCache.set(no, fresh)
  sessions = { ...sessions, [no]: fresh }
  emit()
}

// ---------------------------------------------------------------- 上下文构造

function htmlToText(html: string): string {
  if (!html) return ''
  const el = document.createElement('div')
  el.innerHTML = html
  return (el.textContent || '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text
  return text.slice(0, max) + '\n…（题面过长，后面省略）'
}

function exampleBlock(problem: Problem): string {
  if (!problem.examples.length) return '（题面未提供示例）'
  return problem.examples
    .slice(0, 3)
    .map((ex, i) => {
      const parts = [`示例 ${i + 1}：`, `输入：${ex.input}`, `输出：${ex.output}`]
      if (ex.explain) parts.push(`解释：${ex.explain}`)
      return parts.join('\n')
    })
    .join('\n\n')
}

export interface RunSummary {
  total: number
  passed: number
  failed: number
  detail: string
}

function buildSystemPrompt(problem: Problem, run: RunSummary | null): string {
  const statement = clip(htmlToText(problem.statementHtml), 1800)
  const lines = [
    '你是一位算法面试教练，负责批改用户手写的 Python 解法。用户是"多年前学过 Python、算法零基础"的人，讲错的时候要说人话、给具体行号。',
    '',
    '## 题目',
    `题号：${problem.no}`,
    `标题：${problem.title}（${problem.level}）`,
    `标签：${problem.tags.join(' / ') || '无'}`,
    `需要实现的方法：Solution.${problem.method}(${problem.params.join(', ') || '...'})`,
    '',
    '## 题面',
    statement || '（题面未收录，请按题目名称和你已知的标准题意判断）',
    '',
    '## 示例',
    exampleBlock(problem),
    '',
  ]
  if (problem.complexity) {
    lines.push(
      '## 本题最优复杂度',
      `时间 ${problem.complexity.time}，空间 ${problem.complexity.space || '—'}。${problem.complexity.loops}`,
      '如果用户的解法明显比这个差（例如最优 O(n) 而他写了 O(n²)），要在【复杂度】里点出来。',
      '',
    )
  }
  if (run) {
    lines.push(
      '## 用户本地跑用例的结果',
      `共 ${run.total} 个用例：通过 ${run.passed}，未通过 ${run.failed}`,
      run.detail,
      '注意：用例通过只代表样例对，不代表解法正确，你必须自己找反例。',
      '',
    )
  }
  lines.push(
    '## 判题要求',
    '1. 先在脑子里把代码跑一遍，再下结论。不要只看写法像不像。',
    '2. 判定必须落在三档之一：✅ 通过 / ❌ 有错误 / ⚠️ 无法确定。',
    '3. 判"通过"要同时满足：逻辑正确、边界正确（空输入、单元素、重复元素、极值）、时间复杂度可接受。',
    '4. 判"有错误"必须给出一个能让它出错的具体输入，并写出这段代码实际输出什么、正确答案是什么。',
    '5. 有语法错误就指出哪一行、错在哪。',
    '6. 不要重写整份代码交差；只讲错在哪、为什么错、怎么改。',
    '',
    '## 输出格式（严格照抄这五段标题，不要加别的内容）',
    '【判定】✅ 通过 或 ❌ 有错误 或 ⚠️ 无法确定（后面跟一句话理由）',
    '【问题定位】第 N 行：……（判定通过就写"无"）',
    '【实际会发生什么】拿一个具体输入走一遍，说清它输出什么、为什么错',
    '【正确写法】给关键代码片段（5-20 行），并一句话说明思路',
    '【复杂度】时间 O(?) 空间 O(?)',
  )
  return lines.join('\n')
}

function buildMessages(problem: Problem, session: AiSession, run: RunSummary | null) {
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: buildSystemPrompt(problem, run) },
  ]
  if (session.codeMessage) messages.push({ role: 'user', content: session.codeMessage })
  // 只带最近几条追问，保持"短对话"
  session.chat.slice(-MAX_CHAT_TURNS).forEach((turn) => messages.push(turn))
  return messages
}

export function codeMessageOf(code: string): string {
  return [
    `下面是我写的代码，请批改：`,
    '```python',
    code.trim() || '# （还没写代码）',
    '```',
    '请按约定的五段格式回答。',
  ].join('\n')
}

// ---------------------------------------------------------------- 网络请求

async function describeError(res: Response): Promise<string> {
  let body = ''
  try {
    body = await res.text()
  } catch {
    body = ''
  }
  if (res.status === 401) return 'API Key 无效（401）。去「设置 → AI 解析」检查一下 Key。'
  if (res.status === 402) return 'DeepSeek 账户余额不足（402）。'
  if (res.status === 429) return '请求太频繁（429），等几秒再试。'
  if (res.status === 404) return '代理没生效（404）。确认 npm run dev 是用最新的 vite.config.ts 启动的。'
  return `请求失败（${res.status}）：${body.slice(0, 300) || '无响应体'}`
}

async function streamChat(
  messages: Array<{ role: string; content: string }>,
  onDelta: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch('/api/deepseek/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages,
      stream: true,
      temperature: 0.3,
      max_tokens: 1800,
    }),
    signal,
  })
  if (!res.ok || !res.body) throw new Error(await describeError(res))

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const raw of lines) {
      const line = raw.trim()
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      try {
        const json = JSON.parse(payload)
        const delta: string = json.choices?.[0]?.delta?.content ?? ''
        if (delta) {
          text += delta
          onDelta(delta)
        }
      } catch {
        // 忽略不完整的行
      }
    }
  }
  return text
}

function parseVerdict(text: string): Verdict {
  const head = text.slice(0, 400)
  if (/【判定】[^\n]*✅/.test(head)) return 'pass'
  if (/【判定】[^\n]*❌/.test(head)) return 'fail'
  if (/【判定】[^\n]*⚠/.test(head)) return 'unknown'
  if (text.includes('✅')) return 'pass'
  if (text.includes('❌')) return 'fail'
  return null
}

// ---------------------------------------------------------------- 对外动作

let abort: AbortController | null = null

export async function reviewCode(
  problem: Problem,
  code: string,
  run: RunSummary | null,
): Promise<void> {
  const no = problem.no
  abort?.abort()
  abort = new AbortController()

  const next: AiSession = {
    ...snapshot(no),
    problemNo: no,
    codeMessage: codeMessageOf(code),
    chat: [],
    verdict: null,
    busy: true,
    streaming: '',
    error: null,
    updatedAt: Date.now(),
  }
  sessions = { ...sessions, [no]: next }
  emit()

  try {
    const messages = buildMessages(problem, next, run)
    const text = await streamChat(messages, (delta) => {
      patch(no, { streaming: snapshot(no).streaming + delta })
    }, abort.signal)
    patch(no, {
      busy: false,
      streaming: '',
      verdict: parseVerdict(text),
      chat: [{ role: 'assistant', content: text }],
    })
  } catch (err) {
    if ((err as Error).name === 'AbortError') return
    patch(no, { busy: false, streaming: '', error: (err as Error).message })
  }
}

export async function askFollowUp(problem: Problem, question: string): Promise<void> {
  const no = problem.no
  const current = snapshot(no)
  if (!current.codeMessage || !question.trim()) return
  abort?.abort()
  abort = new AbortController()

  const chat = [...current.chat, { role: 'user' as const, content: question.trim() }]
  patch(no, { chat, busy: true, streaming: '', error: null })

  try {
    const messages = buildMessages(problem, { ...current, chat }, null)
    const text = await streamChat(messages, (delta) => {
      patch(no, { streaming: snapshot(no).streaming + delta })
    }, abort.signal)
    const nextChat = [...chat.slice(-MAX_CHAT_TURNS), { role: 'assistant' as const, content: text }]
    patch(no, {
      busy: false,
      streaming: '',
      chat: nextChat,
      verdict: parseVerdict(chat.filter((t) => t.role === 'assistant').map((t) => t.content).join('\n') + text) ?? snapshot(no).verdict,
    })
  } catch (err) {
    if ((err as Error).name === 'AbortError') return
    patch(no, { busy: false, streaming: '', error: (err as Error).message })
  }
}

export function stopStreaming() {
  abort?.abort()
  abort = null
}
