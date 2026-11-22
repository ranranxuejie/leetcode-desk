import type { Level, Status } from './types'

/**
 * 题库页的筛选条件持久化。
 *
 * 为什么要存：从题库点进一道题、做完再返回，页面会重新挂载，
 * useState 的初始值全是「全部」——刚筛好的条件白选了。
 * 这里把条件写进 localStorage，返回时原样恢复（连同滚动位置）。
 */

export type SortKey = 'path' | 'freq' | 'no' | 'rate' | 'level'

/** 题库范围：全量 / 精选（有精讲的 365 道）/ 热题 100 / 面试经典 150 */
export type ProblemScope = 'all' | 'curated' | 'hot100' | 'top150'

export interface ProblemsFilter {
  query: string
  tier: string
  level: '全部' | Level
  status: '全部' | Status
  category: string
  sort: SortKey
  scope: ProblemScope
}

export const DEFAULT_PROBLEMS_FILTER: ProblemsFilter = {
  query: '',
  tier: '全部',
  level: '全部',
  status: '全部',
  category: '全部',
  sort: 'path',
  scope: 'all',
}

const FILTER_KEY = 'lc.filters.problems.v1'
const SCROLL_KEY = 'lc.filters.problems.scroll.v1'

const LEVELS = new Set<'全部' | Level>(['全部', 'Easy', 'Medium', 'Hard'])
const STATUSES = new Set<'全部' | Status>(['全部', 'todo', 'learning', 'done'])
const SORTS = new Set<SortKey>(['path', 'freq', 'no', 'rate', 'level'])
const SCOPES = new Set<ProblemScope>(['all', 'curated', 'hot100', 'top150'])

function pick<T extends string>(value: unknown, allowed: Set<T>, fallback: T): T {
  return typeof value === 'string' && allowed.has(value as T) ? (value as T) : fallback
}

/** 读取上次的筛选条件；数据脏了就退回默认值，绝不让页面因为坏 JSON 崩掉 */
export function loadProblemsFilter(): ProblemsFilter {
  try {
    const raw = localStorage.getItem(FILTER_KEY)
    if (!raw) return { ...DEFAULT_PROBLEMS_FILTER }
    const parsed = JSON.parse(raw) as Partial<ProblemsFilter> & { onlyTutorial?: boolean }
    // 旧版本用 onlyTutorial 表示「只看有精讲的题」，等价于现在的 scope=curated
    const legacyScope: ProblemScope = parsed.onlyTutorial === true ? 'curated' : 'all'
    return {
      query: typeof parsed.query === 'string' ? parsed.query.slice(0, 80) : '',
      tier: typeof parsed.tier === 'string' ? parsed.tier : '全部',
      level: pick(parsed.level, LEVELS, '全部'),
      status: pick(parsed.status, STATUSES, '全部'),
      category: typeof parsed.category === 'string' ? parsed.category : '全部',
      sort: pick(parsed.sort, SORTS, 'path'),
      scope: parsed.scope ? pick(parsed.scope, SCOPES, legacyScope) : legacyScope,
    }
  } catch {
    return { ...DEFAULT_PROBLEMS_FILTER }
  }
}

export function saveProblemsFilter(filter: ProblemsFilter): void {
  try {
    localStorage.setItem(FILTER_KEY, JSON.stringify(filter))
  } catch {
    // 隐私模式 / 配额满：记不住就记不住，不影响使用
  }
}

/** 当前条件是否等于默认值（用来决定要不要显示「清除筛选」） */export function isDefaultProblemsFilter(filter: ProblemsFilter): boolean {
  const base = DEFAULT_PROBLEMS_FILTER
  return (
    filter.query.trim() === base.query &&
    filter.tier === base.tier &&
    filter.level === base.level &&
    filter.status === base.status &&
    filter.category === base.category &&
    filter.sort === base.sort &&
    filter.scope === base.scope
  )
}

/** 非默认条件有几项，用于「已筛选 2 项」这种提示 */
export function countActiveFilters(filter: ProblemsFilter): number {
  const base = DEFAULT_PROBLEMS_FILTER
  let count = 0
  if (filter.query.trim()) count += 1
  if (filter.tier !== base.tier) count += 1
  if (filter.level !== base.level) count += 1
  if (filter.status !== base.status) count += 1
  if (filter.category !== base.category) count += 1
  if (filter.sort !== base.sort) count += 1
  if (filter.scope !== base.scope) count += 1
  return count
}

export function loadProblemsScroll(key: string): number {
  try {
    const raw = localStorage.getItem(`${SCROLL_KEY}:${hashKey(key)}`)
    const value = raw ? Number(raw) : 0
    return Number.isFinite(value) && value > 0 ? value : 0
  } catch {
    return 0
  }
}

export function saveProblemsScroll(key: string, top: number): void {
  try {
    localStorage.setItem(`${SCROLL_KEY}:${hashKey(key)}`, String(Math.max(0, Math.round(top))))
  } catch {
    // 忽略
  }
}

/**
 * 滚动位置按「筛选组合」分开存：不然「全部」滚到 30000 后切到「Hot 100」，
 * 两个视图共用一个位置，回退时就会落在别人的位置。
 * 故意**不含搜索词** —— 否则每敲一个字就多一个 key，而且搜索完清空应该回到原位。
 */
export function scrollKeyOf(filter: ProblemsFilter): string {
  return [filter.tier, filter.level, filter.status, filter.category, filter.sort, filter.scope].join(
    '|',
  )
}

/** 稳定短哈希（djb2），只用来做 localStorage 后缀 */
function hashKey(text: string): string {
  let hash = 5381
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0
  }
  return (hash >>> 0).toString(36)
}
