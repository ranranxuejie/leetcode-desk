/**
 * AI 深度解析：把题面 / 示例 / 最优复杂度交给 DeepSeek，流式生成一份中文解析。
 *
 * 复用 ai.ts 用过的 /api/deepseek/chat/completions 代理（Key 不进前端）。
 * 结果按题号缓存在 localStorage，刷新、切题再回来都还在，避免重复花钱。
 *
 * 为什么状态要提到模块级（而不是组件 state）：
 * 「解析」Tab 一切走，Analysis 组件就被卸载。以前状态和 AbortController 都放在组件里，
 * 卸载 cleanup 会 abort 正在跑的流，而 catch 里遇到 AbortError 直接 return、不写缓存，
 * 已经花掉的 token 就白跑了。现在按题号把会话存在模块级 Map 里（照抄 ai.ts 的 useAiSession
 * 那套 useSyncExternalStore + sessions 的做法）：
 *   - 组件卸载只是「暂时不看了」，流继续跑，切回来还能看到流式进度；
 *   - 只有用户点「停止」、换题、清空才 abort；
 *   - 中断时把已收到的半截文本落盘，至少不白花钱。
 */
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import type { Problem } from './types'

const STORAGE_KEY = 'lc.aianalysis.v1'

type Cache = Record<string, string>

function readCache(): Cache {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Cache = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string' && value.trim()) out[key] = value
    }
    return out
  } catch {
    // 隐私模式 / 配额满 / 脏数据：缓存读不出来也不能影响页面
    return {}
  }
}

function writeCache(cache: Cache): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cache))
  } catch {
    // 写不进去就只当这次没缓存
  }
}

export function readCachedAnalysis(no: string): string {
  if (!no) return ''
  return readCache()[no] ?? ''
}

export function clearCachedAnalysis(no: string): void {
  if (!no) return
  const cache = readCache()
  if (!(no in cache)) return
  delete cache[no]
  writeCache(cache)
}

/**
 * 落盘：一次流只写一次，不在每个 token 上写 localStorage。
 * 调用时机只有两个——流正常结束、流被中断（含半路报错），见 generateAnalysis。
 */
function persist(no: string, text: string): void {
  if (!no || !text.trim()) return
  writeCache({ ...readCache(), [no]: text })
}

// ---------------------------------------------------------------- 模块级会话

/**
 * 一道题一份解析会话。text 同时承担「已生成的内容」和「正在流式接收的内容」两个角色：
 * 组件卸载重挂载时直接读 text 就能拿到当前进度，不用再区分「最终结果」和「临时缓冲」。
 */
export interface AnalysisState {
  problemNo: string
  text: string
  busy: boolean
  error: string | null
  /** 上次生成被中断（点停止 / 换题 / 半路断网），此时 text 是半截内容且已落盘 */
  interrupted: boolean
  updatedAt: number
}

const EMPTY: AnalysisState = {
  problemNo: '',
  text: '',
  busy: false,
  error: null,
  interrupted: false,
  updatedAt: 0,
}

let states: Record<string, AnalysisState> = {}
// useSyncExternalStore 要求快照引用稳定（同一个题号连续取两次必须 ===），
// 所以「还没有会话」的题目必须把空快照缓存住，不能每次现造对象，否则会无限重渲染
const emptyCache = new Map<string, AnalysisState>()
const listeners = new Set<() => void>()
/** 每道题最多一个在跑的请求：同题再点「生成」时先 abort 上一次 */
const aborts = new Map<string, AbortController>()
/**
 * 每道题的「当前轮次」编号。异步任务收尾时先对编号：
 * 编号变了说明这一轮已被新的生成 / 清空接管，状态和缓存都归新的一轮管，
 * 这一轮只能悄悄退出——不能把旧的半截文本盖回去，也不能把刚清掉的缓存写活。
 */
const runs = new Map<string, number>()
let runSeq = 0

function emit(): void {
  listeners.forEach((fn) => fn())
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** 取某题的会话快照；第一次访问时把 localStorage 里的缓存当成初始文本 */
function snapshot(no: string): AnalysisState {
  const existing = states[no]
  if (existing) return existing
  let empty = emptyCache.get(no)
  if (!empty) {
    empty = { ...EMPTY, problemNo: no, text: readCachedAnalysis(no) }
    emptyCache.set(no, empty)
  }
  return empty
}

/** 给非组件代码 / 验证脚本读快照用（组件里请用 useAiAnalysis） */
export function getAnalysisState(no: string): AnalysisState {
  return snapshot(no)
}

function patch(no: string, next: Partial<AnalysisState>): void {
  const merged: AnalysisState = {
    ...snapshot(no),
    ...next,
    problemNo: no,
    updatedAt: Date.now(),
  }
  states = { ...states, [no]: merged }
  emit()
}

// ---------------------------------------------------------------- 上下文构造

function htmlToText(html: string): string {
  if (!html) return ''
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|pre|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n…（后面省略）`
}

function exampleBlock(problem: Problem): string {
  if (!problem.examples.length) return '（题面未提供示例）'
  return problem.examples
    .slice(0, 3)
    .map((ex, index) => {
      const lines = [`示例 ${index + 1}`, `输入：${ex.input}`, `输出：${ex.output}`]
      if (ex.explain) lines.push(`解释：${ex.explain}`)
      return lines.join('\n')
    })
    .join('\n\n')
}

const SYSTEM_PROMPT = [
  '你是一位算法面试教练，带的是「多年前学过 Python、算法零基础」的学生。',
  '你会拿到这道题的完整题面与示例。请**先读懂题面**再写解析：',
  '题面里的数据范围、返回值定义、示例都是你的依据，不要用题面里没有的信息臆测题意。',
  '如果题面明确缺失，就在开头一句说明「题面未收录，以下按题名推断」。',
  '要求讲人话、给具体步骤，不要客套。',
  '',
  '## 输出格式（严格照这六段，中文 Markdown，全文 1000 字左右）',
  '**一句话**：一句话说清这道题到底在求什么',
  '**思路**：从「看到题先想什么」讲到「为什么用这个方法」，4-6 句；要写出关键观察',
  '**关键步骤**：编号列 4-6 步，每步一行，说清这一步在维护什么变量',
  '**复杂度**：时间 O(?) / 空间 O(?)，各用半句说明为什么',
  '**边界用例**：列 3 个最容易写错的输入，每个写清期望输出',
  '**常见坑**：列 2 个，说清错在哪、怎么避免',
].join('\n')

function buildMessages(problem: Problem) {
  const parts = [
    '## 题目',
    `题号：${problem.no}`,
    `标题：${problem.title}（${problem.level}）`,
    `标签：${problem.tags.join(' / ') || '无'}`,
    `需要实现：Solution.${problem.method}(${problem.params.join(', ') || '...'})`,
    '',
    '## 题面',
    clip(htmlToText(problem.statementHtml), 1500) || '（题面未收录，请按题名和你已知的标准题意写）',
    '',
    '## 示例',
    exampleBlock(problem),
    '',
  ]
  if (problem.complexity) {
    parts.push(
      '## 本题最优复杂度',
      `时间 ${problem.complexity.time}，空间 ${problem.complexity.space || '—'}。${problem.complexity.loops}`,
      '',
    )
  }
  parts.push('请按约定格式输出解析。')

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: parts.join('\n') },
  ]
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
  signal: AbortSignal,
): Promise<string> {
  const res = await fetch('/api/deepseek/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages,
      stream: true,
      temperature: 0.4,
      max_tokens: 2400,
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
        const json = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string } }> }
        const delta = json.choices?.[0]?.delta?.content ?? ''
        if (delta) {
          text += delta
          onDelta(delta)
        }
      } catch {
        // 流里偶尔出现半行，跳过就好
      }
    }
  }
  return text
}

// ---------------------------------------------------------------- 对外动作

/**
 * 开始生成。同一题重复调用会先中断上一轮（上一轮因为轮次编号过期，不会再写状态/缓存）。
 */
export function generateAnalysis(problem: Problem): void {
  const no = problem.no
  if (!no) return

  stopAnalysis(no)
  const runId = ++runSeq
  runs.set(no, runId)
  const controller = new AbortController()
  aborts.set(no, controller)
  patch(no, { text: '', busy: true, error: null, interrupted: false })

  void (async () => {
    try {
      let acc = ''
      await streamChat(
        buildMessages(problem),
        (delta) => {
          acc += delta
          // 这一轮已被接管（换题 / 重新生成 / 清空）就别再改状态了
          if (runs.get(no) !== runId) return
          patch(no, { text: acc })
        },
        controller.signal,
      )
      if (runs.get(no) !== runId) return
      if (!acc.trim()) {
        patch(no, { busy: false, error: 'AI 这次没返回内容，再点一次试试。' })
        return
      }
      patch(no, { text: acc, busy: false, error: null, interrupted: false })
      persist(no, acc) // 流正常结束：写一次缓存
    } catch (err) {
      // 轮次过期：新的一轮已经接管这道题，旧轮的半截文本不能盖回去
      if (runs.get(no) !== runId) return
      const aborted = (err as Error).name === 'AbortError'
      const partial = snapshot(no).text
      if (aborted) {
        // 中断（用户点停止 / 换题）：把已收到的半截文本落盘。
        // 这是这次修复的核心——以前这里直接 return，切回来一片空白，token 白花。
        patch(no, { busy: false, error: null, interrupted: partial.trim().length > 0 })
        persist(no, partial)
        return
      }
      // 半路报错（断网 / 5xx）：已收到的部分同样落盘，别让用户为半份内容重付一次钱
      patch(no, {
        busy: false,
        error: (err as Error).message,
        interrupted: partial.trim().length > 0,
      })
      persist(no, partial)
    } finally {
      if (runs.get(no) === runId) aborts.delete(no)
    }
  })()
}

/**
 * 中断某题的生成（用户点「停止」/ 换题时用）。只 abort，不清缓存：
 * abort 之后 generateAnalysis 的 catch 会把已收到的半截文本写进缓存。
 */
export function stopAnalysis(no: string): void {
  const controller = aborts.get(no)
  if (!controller) return
  aborts.delete(no)
  controller.abort()
}

/**
 * 清空某题：中断在跑的流 + 删掉这题的缓存。
 * 顺序很重要——先把轮次编号作废再 abort，否则 abort 的收尾逻辑会把半截文本又写回缓存，
 * 刚删掉的缓存立刻复活。
 */
export function clearAnalysis(no: string): void {
  if (!no) return
  runs.set(no, ++runSeq)
  const controller = aborts.get(no)
  aborts.delete(no)
  controller?.abort()
  clearCachedAnalysis(no)
  const fresh: AnalysisState = { ...EMPTY, problemNo: no, updatedAt: Date.now() }
  emptyCache.set(no, fresh)
  states = { ...states, [no]: fresh }
  emit()
}

// ---------------------------------------------------------------- 对外 hook

export interface AiAnalysis {
  text: string
  busy: boolean
  error: string | null
  /** 上次生成被中断，当前 text 是半截内容（已落盘） */
  interrupted: boolean
  generate: () => void
  /** 停止生成但保留已收到的内容（会落盘） */
  stop: () => void
  /** 清空内容并删除这题的缓存 */
  clear: () => void
}

export function useAiAnalysis(problem: Problem): AiAnalysis {
  const no = problem.no
  const state = useSyncExternalStore(
    subscribe,
    () => snapshot(no),
    () => snapshot(no),
  )
  const problemRef = useRef(problem)
  problemRef.current = problem

  // 换题（同一个组件实例里 no 变了）：停掉上一题在跑的流，半截文本照常落盘。
  // 这里只处理「换题」：切 Tab 导致的卸载重挂载不会走到这个分支，
  // 所以生成不会被中断——这是和旧实现最大的区别。
  const prevNoRef = useRef(no)
  useEffect(() => {
    const prev = prevNoRef.current
    prevNoRef.current = no
    if (prev && prev !== no) stopAnalysis(prev)
  }, [no])

  const generate = useCallback(() => {
    generateAnalysis(problemRef.current)
  }, [])

  const stop = useCallback(() => {
    stopAnalysis(problemRef.current.no)
  }, [])

  const clear = useCallback(() => {
    clearAnalysis(problemRef.current.no)
  }, [])

  return {
    text: state.text,
    busy: state.busy,
    error: state.error,
    interrupted: state.interrupted,
    generate,
    stop,
    clear,
  }
}
