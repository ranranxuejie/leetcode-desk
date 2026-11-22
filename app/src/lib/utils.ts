import type {
  Level,
  Problem,
  ProblemState,
  Rating,
  Status,
  TutorialDoc,
} from './types'

export const LEVEL_LABEL: Record<Level, string> = {
  Easy: '简单',
  Medium: '中等',
  Hard: '困难',
}

export const LEVEL_RANK: Record<Level, number> = { Easy: 0, Medium: 1, Hard: 2 }

/**
 * 题号排序键。数字题号按数值；LCP / LCR / LCS / 面试题 这些带前缀的排到后面，
 * 否则 Number('LCP 01') 是 NaN，排序会变成随机顺序。
 */
export function noRank(no: string): number {
  const raw = String(no ?? '').trim()
  if (/^\d+$/.test(raw)) return Number(raw)
  const prefixes: Array<[string, number]> = [
    ['LCP', 900_000],
    ['LCR', 910_000],
    ['LCS', 920_000],
    ['面试题', 930_000],
  ]
  for (const [prefix, base] of prefixes) {
    if (raw.startsWith(prefix)) {
      const digits = raw.replace(/\D/g, '')
      return base + (digits ? Number(digits) : 0)
    }
  }
  const digits = raw.replace(/\D/g, '')
  return 990_000 + (digits ? Number(digits) : 0)
}

export const STATUS_LABEL: Record<Status, string> = {
  todo: '未开始',
  learning: '学习中',
  done: '已掌握',
}

export const TIER_LABEL: Record<string, string> = {
  P0: 'P0 · 必考',
  P1: 'P1 · 高频',
  P2: 'P2 · 常考',
  P3: 'P3 · 补充',
  基础: '基础',
  进阶: '进阶',
  补充: '清单外补充',
  其他: '其他',
}

export const TIER_ORDER = ['P0', 'P1', 'P2', 'P3', '基础', '进阶', '补充']

export const RATING_LABEL: Record<Rating, string> = {
  read: '看懂了',
  recall: '能默写',
  variant: '会变形',
}

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

export function todayKey(date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function dateKey(ts: number): string {
  return todayKey(new Date(ts))
}

export function formatDuration(seconds: number): string {
  if (!seconds) return '0 分钟'
  if (seconds < 60) return `${seconds} 秒`
  const m = Math.floor(seconds / 60)
  if (m < 60) return `${m} 分钟`
  const h = Math.floor(m / 60)
  return `${h} 小时 ${m % 60} 分`
}

export function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function relativeDay(ts?: number): string {
  if (!ts) return '还没开始'
  const diff = Date.now() - ts
  const day = 86400000
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`
  if (diff < day) return `${Math.floor(diff / 3600000)} 小时前`
  if (diff < day * 2) return '昨天'
  if (diff < day * 30) return `${Math.floor(diff / day)} 天前`
  return new Date(ts).toLocaleDateString('zh-CN')
}

export function shortDate(date = new Date()): string {
  const week = ['日', '一', '二', '三', '四', '五', '六'][date.getDay()]
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日 · 周${week}`
}

export function greeting(date = new Date()): string {
  const h = date.getHours()
  if (h < 6) return '夜深了'
  if (h < 11) return '早上好'
  if (h < 14) return '中午好'
  if (h < 18) return '下午好'
  return '晚上好'
}

function reviewIntervalDays(state: ProblemState): number {
  const reviews = state.reviews
  let streak = 0
  for (let i = reviews.length - 1; i >= 0; i -= 1) {
    if (reviews[i].result !== 'pass') break
    streak += 1
  }
  const intervals = [1, 3, 7, 15, 30]
  return intervals[Math.min(Math.max(streak - 1, 0), intervals.length - 1)]
}

export function isDue(state: ProblemState, now = Date.now()): boolean {
  if (!state.wrong) return false
  if (!state.reviews.length) return true
  return nextReviewAt(state)! <= now
}

export function nextReviewAt(state: ProblemState): number | null {
  const n = state.reviews.length
  if (!n) return null
  return state.reviews[n - 1].at + reviewIntervalDays(state) * 86400000
}

export function normalizeOutput(value: string): string {
  return value
    .replace(/\s+/g, '')
    .replace(/["'`]/g, '')
    .replace(/True/g, 'true')
    .replace(/False/g, 'false')
    .replace(/None/g, 'null')
    .toLowerCase()
}

export function starterCode(problem: {
  no: string
  title: string
  method: string
  params: string[]
}): string {
  const params = problem.params.length ? problem.params.join(', ') : '*args, **kwargs'
  return `# ${problem.no}. ${problem.title}
# 先想清楚：输入是什么、输出是什么、边界在哪。
# 写完点右上角「运行」，用示例用例自测。

class Solution:
    def ${problem.method}(self, ${params}):
        # TODO: 在这里写你的解法
        pass
`
}

/**
 * 取一道题关联的教程章节正文，按 problem.tutorial 的顺序。
 * 初始代码、解析、边界用例都从这些 markdown 里抽信息，所以统一在这里取。
 */
export function tutorialMarkdowns(
  problem: Problem,
  byDoc: Map<string, TutorialDoc>,
): string[] {
  const out: string[] = []
  for (const ref of problem.tutorial) {
    const doc = byDoc.get(ref.docId)
    if (!doc) continue
    const section = doc.sections.find((item) => item.id === ref.sectionId)
    if (section?.markdown) out.push(section.markdown)
  }
  return out
}

/**
 * 教程里的参考代码经常省略 import 和节点定义（正文前面已经给过），
 * 直接塞进编辑器会 NameError。这里按实际用到的名字补齐最小依赖，
 * 让「载入参考答案」之后点运行就能过。
 */
export function ensureImports(source: string): string {
  const code = source ?? ''
  const heads: string[] = []
  const has = (pattern: RegExp) => pattern.test(code)

  const typingNames = [
    'List',
    'Dict',
    'Set',
    'Tuple',
    'Optional',
    'Any',
    'Union',
    'Callable',
    'Deque',
    'Iterable',
    'Sequence',
    'Iterator',
  ]
  if (!has(/^\s*(?:from\s+typing\s+import|import\s+typing)/m)) {
    const used = typingNames.filter((name) => new RegExp(`\\b${name}\\b`).test(code))
    if (used.length) heads.push(`from typing import ${used.join(', ')}`)
  }

  const collectionImports: [RegExp, string][] = [
    [/\bdeque\s*\(/, 'from collections import deque'],
    [/\bCounter\s*\(/, 'from collections import Counter'],
    [/\bdefaultdict\s*\(/, 'from collections import defaultdict'],
    [/\bheapq\./, 'import heapq'],
    [/\bbisect\./, 'import bisect'],
    [/\bmath\./, 'import math'],
    [/\bitertools\./, 'import itertools'],
  ]
  collectionImports.forEach(([pattern, statement]) => {
    const moduleName = statement.split(' ').pop() as string
    if (!pattern.test(code)) return
    if (has(new RegExp(`^\\s*(?:from|import)\\s+[^\\n]*\\b${moduleName}\\b`, 'm'))) return
    heads.push(statement)
  })

  const nodeBlocks: string[] = []
  if (has(/\bListNode\b/) && !has(/^\s*class\s+ListNode\b/m)) {
    nodeBlocks.push(
      'class ListNode:\n    def __init__(self, val=0, next=None):\n        self.val = val\n        self.next = next\n',
    )
  }
  if (has(/\bTreeNode\b/) && !has(/^\s*class\s+TreeNode\b/m)) {
    nodeBlocks.push(
      'class TreeNode:\n    def __init__(self, val=0, left=None, right=None):\n        self.val = val\n        self.left = left\n        self.right = right\n',
    )
  }

  const prefix = [...heads, ...nodeBlocks].join('\n')
  if (!prefix) return code
  const body = code.replace(/^\s*\n/, '')
  // `from __future__ import ...` 必须是文件第一条语句，import 要插在它后面
  const futureMatch = /^(?:[ \t]*#[^\n]*\n[ \t]*\n?)*[ \t]*from[ \t]+__future__[ \t]+import[^\n]*\n/.exec(
    body,
  )
  if (futureMatch) {
    const head = body.slice(0, futureMatch[0].length)
    return `${head}\n${prefix}\n\n${body.slice(futureMatch[0].length)}`
  }
  return `${prefix}\n\n${body}`
}

export function buildDefaultCases(problem: {
  method: string
  examples: { callArgs: string; output: string }[]
}) {
  const examples = problem.examples.slice(0, 3)
  if (!examples.length) {
    return [
      {
        id: 'case-1',
        call: `Solution().${problem.method}()`,
        expected: '',
      },
    ]
  }
  return examples.map((ex, i) => ({
    id: `case-${i + 1}`,
    call: `Solution().${problem.method}(${ex.callArgs})`,
    expected: ex.output,
  }))
}
