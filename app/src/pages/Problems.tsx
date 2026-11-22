import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Check, Flame, Plus, Search, X } from 'lucide-react'
import { useData } from '../lib/data'
import { useProgress } from '../lib/progress'
import { useToast } from '../lib/toast'
import { Odometer, Tip, withViewTransition } from '../lib/motion'
import { LevelBadge, StatusDot, TierBadge } from '../components/ui'
import { Select } from '../components/Select'
import type { SelectOption } from '../components/Select'
import { LEVEL_LABEL, TIER_ORDER, cn, noRank } from '../lib/utils'
import { compareByPath, compareByLevel, topicMeta } from '../lib/path'
import {
  loadProblemsFilter,
  loadProblemsScroll,
  saveProblemsFilter,
  saveProblemsScroll,
  scrollKeyOf,
  type ProblemScope,
  type ProblemsFilter,
  type SortKey,
} from '../lib/filters'
import type { Level, Problem, Status } from '../lib/types'

const TIERS = ['全部', ...TIER_ORDER]
const LEVELS: Array<'全部' | Level> = ['全部', 'Easy', 'Medium', 'Hard']

/** 状态下拉：值域和原来的原生 select 完全一致 */
const STATUS_OPTIONS: Array<SelectOption<'全部' | Status>> = [
  { value: '全部', label: '全部' },
  { value: 'todo', label: '未开始' },
  { value: 'learning', label: '学习中' },
  { value: 'done', label: '已掌握' },
]

/** 排序下拉：文案照抄原来的 <option>，不合并也不缩写 */
const SORT_OPTIONS: Array<SelectOption<SortKey>> = [
  { value: 'path', label: '学习路线（专题 → 难度）' },
  { value: 'level', label: '难度（简单 → 困难）' },
  { value: 'freq', label: '华为频度' },
  { value: 'no', label: '题号' },
  { value: 'rate', label: '通过率（低 → 高）' },
]

/** URL 里只同步这四项：搜索词、难度、状态、范围。其余（分级/专题/排序）留在本地。 */
const URL_KEYS = ['q', 'level', 'status', 'scope'] as const

function readFilterFromParams(
  params: URLSearchParams,
): Pick<ProblemsFilter, 'query' | 'level' | 'status' | 'scope'> | null {
  if (!URL_KEYS.some((key) => params.has(key))) return null
  const level = params.get('level')
  const status = params.get('status')
  const scope = params.get('scope')
  return {
    query: (params.get('q') ?? '').slice(0, 80),
    level: LEVELS.includes(level as '全部' | Level) ? (level as '全部' | Level) : '全部',
    status:
      status === 'todo' || status === 'learning' || status === 'done'
        ? status
        : ('全部' as const),
    scope:
      scope === 'curated' || scope === 'hot100' || scope === 'top150'
        ? scope
        : ('all' as const),
  }
}

function nextStatus(status: Status): Status {
  if (status === 'todo') return 'learning'
  if (status === 'learning') return 'done'
  return 'todo'
}

export function Problems() {
  const { problems } = useData()
  const {
    data,
    setStatus: setProblemStatus,
    addToPlan,
    todayPlan,
  } = useProgress()
  const { toast } = useToast()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  // 上次的筛选条件（点进题目再返回时原样恢复）。
  // URL 里有参数时以 URL 为准 —— 这样深链、后退、刷新看到的是同一批题。
  const [saved] = useState(() => {
    const fromUrl = readFilterFromParams(new URLSearchParams(window.location.search))
    return fromUrl ? { ...loadProblemsFilter(), ...fromUrl } : loadProblemsFilter()
  })
  // 上次的滚动位置要在**组件实例级别**只读一次：
  // StrictMode 会把 effect 跑两遍（effect → cleanup → effect），
  // 如果每次都在 effect 里读 localStorage，第一遍的 cleanup 会把位置写成 0，
  // 第二遍就读到 0，于是永远恢复不了。
  // 滚动位置按「筛选组合」分开存：切到别的筛选再回来，还是原来的位置
  const [savedScroll] = useState(() => loadProblemsScroll(scrollKeyOf(saved)))
  const scrollKeyRef = useRef(scrollKeyOf(saved))
  const [query, setQueryRaw] = useState(saved.query)
  const deferredQuery = useDeferredValue(query)
  const [tier, setTier] = useState(saved.tier)
  const [level, setLevelRaw] = useState<'全部' | Level>(saved.level)
  const [status, setStatusRaw] = useState<'全部' | Status>(saved.status)
  const [category, setCategory] = useState(saved.category)
  const [sort, setSort] = useState<SortKey>(saved.sort)
  const [scope, setScopeRaw] = useState<ProblemScope>(saved.scope)
  /** roving tabindex：整张表只有一个 Tab 停靠点，j/k 在行间移动 */
  const [focusedNo, setFocusedNo] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // 条件变了就记下来（防抖交给 localStorage 写入本身，量很小）
  useEffect(() => {
    saveProblemsFilter({ query, tier, level, status, category, sort, scope })
  }, [query, tier, level, status, category, sort, scope])

  // ---- URL 同步：URL 里有参数就以 URL 为准，没有就回落到本地并补写 ----
  const typingRef = useRef(false)
  /**
   * 只有「用户真的动了筛选」才写回 URL。
   * 否则 popstate 回灌 state 会反过来再写一次 URL，back/forward 会来回 push 死循环
   * （实测一次后退能 push 56 次）。
   * 初值 true：挂载时补写一次，把 localStorage 里的筛选映射到 URL。
   */
  const userTouched = useRef(true)
  /** 用户改了筛选：允许把 state 写回 URL（400ms 内有效，防 popstate 回灌时误写） */
  const markUserIntent = (typing = false) => {
    userTouched.current = true
    if (typing) typingRef.current = true
    window.setTimeout(() => {
      userTouched.current = false
    }, 400)
  }

  // 所有「用户操作」都走这几个包装：统一打标记，键盘 / 鼠标 / 清空筛选都覆盖
  const setQuery = (value: string) => { markUserIntent(true); setQueryRaw(value) }
  const setLevel = (value: '全部' | Level) => { markUserIntent(); setLevelRaw(value) }
  const setStatus = (value: '全部' | Status) => { markUserIntent(); setStatusRaw(value) }
  const setScope = (value: ProblemScope) => { markUserIntent(); setScopeRaw(value) }
  useEffect(() => {
    if (!userTouched.current) return
    userTouched.current = false
    const params = new URLSearchParams()
    if (query.trim()) params.set('q', query.trim())
    if (level !== '全部') params.set('level', level)
    if (status !== '全部') params.set('status', status)
    if (scope !== 'all') params.set('scope', scope)
    const next = params.toString()
    const current = window.location.search.replace(/^\?/, '')
    const replace = typingRef.current
    typingRef.current = false
    if (next === current) return
    // 打字用 replaceState：一次后退只撤销一次「离散选择」，不会一个字一个字退
    setSearchParams(params, { replace })
  }, [query, level, status, scope, setSearchParams])

  // 后退 / 前进：把 URL 的状态灌回控件（不写回 URL）。
  // 无参数也要处理 —— 后退到干净的 /problems 时，界面必须回到「全部」，
  // 否则地址栏和列表对不上（这正是 B1 要消灭的现象）。
  const urlEffectFirst = useRef(true)
  useEffect(() => {
    if (urlEffectFirst.current) {
      urlEffectFirst.current = false
      return
    }
    const fromUrl = readFilterFromParams(searchParams) ?? {
      query: '',
      level: '全部' as const,
      status: '全部' as const,
      scope: 'all' as const,
    }
    if (
      fromUrl.query === query &&
      fromUrl.level === level &&
      fromUrl.status === status &&
      fromUrl.scope === scope
    ) {
      return
    }
    // 用 Raw setter：URL 回灌不算用户意图，不能再写回 URL
    if (fromUrl.query !== query) setQueryRaw(fromUrl.query)
    if (fromUrl.level !== level) setLevelRaw(fromUrl.level)
    if (fromUrl.status !== status) setStatusRaw(fromUrl.status)
    if (fromUrl.scope !== scope) setScopeRaw(fromUrl.scope)
  }, [searchParams])

  /** 把滚动位置恢复到 target（重试几次，等表格渲染出来） */
  const restoreTimer = useRef(0)
  const restoreScroll = useCallback((target: number) => {
    let attempts = 0
    const apply = () => {
      const main = document.querySelector<HTMLElement>('.main')
      if (!main) return
      const max = main.scrollHeight - main.clientHeight
      if (max <= 0 && attempts < 12) {
        attempts += 1
        restoreTimer.current = window.setTimeout(apply, 60)
        return
      }
      const want = Math.min(Math.max(target, 0), Math.max(max, 0))
      const previous = main.style.scrollBehavior
      main.style.scrollBehavior = 'auto'
      main.scrollTop = want
      main.style.scrollBehavior = previous
      if (Math.abs(main.scrollTop - want) > 2 && attempts < 12) {
        attempts += 1
        restoreTimer.current = window.setTimeout(apply, 80)
      }
    }
    apply()
  }, [])

  // 返回题库时回到原来的滚动位置：不然条件记住了、位置还是顶。
  // App 在路由切换时会把 .main 滚回顶部，谁先谁后取决于 React 的提交顺序，
  // 所以这里用「短重试」而不是只设一次：直到滚动位置真的落到位为止。
  useEffect(() => {
    const target = savedScroll
    let raf = 0
    if (target > 0) restoreScroll(target)

    const main = document.querySelector<HTMLElement>('.main')
    const onScroll = () => {
      if (!main || raf) return
      raf = window.requestAnimationFrame(() => {
        raf = 0
        saveProblemsScroll(scrollKeyRef.current, main.scrollTop)
      })
    }
    main?.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.clearTimeout(restoreTimer.current)
      main?.removeEventListener('scroll', onScroll)
      if (raf) window.cancelAnimationFrame(raf)
      // 离开时记下当前位置；如果此刻已被滚回顶部（max 为 0），就别覆盖旧值
      if (main && main.scrollHeight - main.clientHeight > 0) {
        if (main.scrollTop > 0 || target === 0) saveProblemsScroll(scrollKeyRef.current, main.scrollTop)
      }
    }
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === '/' && document.activeElement?.tagName !== 'INPUT') {
        event.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const categories = useMemo(() => {
    const counts = new Map<string, number>()
    problems.forEach((p) => counts.set(p.category, (counts.get(p.category) ?? 0) + 1))
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])
  }, [problems])

  /** 专题下拉：全部专题 + 各专题（题目数单独一列，不再拼进标签文本） */
  const topicOptions = useMemo<Array<SelectOption<string>>>(
    () => [
      { value: '全部', label: '全部专题' },
      ...categories.map(([name, count]) => ({ value: name, label: name, count })),
    ],
    [categories],
  )

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase()
    const list = problems.filter((problem) => {
      if (scope === 'curated' && !problem.curated) return false
      if (scope === 'hot100' && !problem.hot100) return false
      if (scope === 'top150' && !problem.inTop150) return false
      if (tier !== '全部' && problem.tier !== tier) return false
      if (level !== '全部' && problem.level !== level) return false
      if (category !== '全部' && problem.category !== category) return false
      if (status !== '全部') {
        const current = data.problems[problem.no]?.status ?? 'todo'
        if (current !== status) return false
      }
      if (q) {
        const haystack = `${problem.no} ${problem.title} ${problem.slug} ${problem.tags.join(
          ' ',
        )} ${problem.category}`.toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })

    list.sort((a, b) => {
      if (sort === 'path') {
        return compareByPath(a, b)
      }
      if (sort === 'no') {
        return noRank(a.no) - noRank(b.no)
      }
      if (sort === 'rate') {
        return (a.acRate ?? 999) - (b.acRate ?? 999)
      }
      if (sort === 'level') {
        return compareByLevel(a, b)
      }
      return (
        (b.huaweiFreq ?? -1) - (a.huaweiFreq ?? -1) || noRank(a.no) - noRank(b.no)
      )
    })
    return list
  }, [
    problems,
    tier,
    level,
    category,
    status,
    scope,
    deferredQuery,
    sort,
    data.problems,
  ])

  const curated = useMemo(() => problems.filter((p) => p.curated), [problems])
  const hotCount = useMemo(() => problems.filter((p) => p.hot100).length, [problems])
  const topCount = useMemo(() => problems.filter((p) => p.inTop150).length, [problems])
  const solvedCurated = curated.filter(
    (p) => data.problems[p.no]?.status === 'done',
  ).length
  const planSet = new Set(todayPlan)

  // ---- 分批渲染 ----
  // 全量 4504 行一次性挂上去要 2.5 秒、10 万个 DOM 节点，滚动也会卡。
  // 这里先渲染 300 行，滚到底部再追加 300 行（IntersectionObserver 提前 600px 触发）。
  // 初始额度会参考上次的滚动位置，保证「从题目返回」还能回到原位。
  const PAGE = 300
  const [limit, setLimit] = useState(() =>
    Math.max(PAGE, Math.min(problems.length, Math.ceil(savedScroll / 40) + 200)),
  )
  // 当前筛选组合的滚动 key：每次渲染同步，保存时用它
  scrollKeyRef.current = scrollKeyOf({ query, tier, level, status, category, sort, scope })

  // 条件变了就回到第一批（否则筛完还是停在一个巨大的额度上）。
  // 首次挂载必须跳过：否则会把「按上次滚动位置算出来的额度」又打回 300，深滚动就永远恢复不了。
  // 注意不能只用 ref 布尔标记 —— StrictMode 会把 effect 跑两遍，第二遍照样会打回 300。
  // 这里比较「筛选签名」，只有真的变了才重置。
  const prevFilterSig = useRef(scrollKeyOf(saved))
  useEffect(() => {
    const sig = scrollKeyOf({ query, tier, level, status, category, sort, scope })
    if (sig === prevFilterSig.current) return
    prevFilterSig.current = sig
    setLimit(PAGE)
    // 换筛选：恢复这个组合上次的位置；没有记录就回顶部
    restoreScroll(loadProblemsScroll(sig))
  }, [query, tier, level, status, category, scope, sort, restoreScroll])

  const sentinelRef = useRef<HTMLTableRowElement>(null)
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    if (limit >= filtered.length) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setLimit((value) => value + PAGE)
        }
      },
      { rootMargin: '600px 0px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [limit, filtered.length])

  const visible = useMemo(() => filtered.slice(0, limit), [filtered, limit])

  /** 当前「roving」行：没有显式选中时默认第一行，保证表格始终有一个 Tab 停靠点 */
  const rovingNo = focusedNo ?? visible[0]?.no ?? null
  const pendingFocus = useRef<string | null>(null)

  const focusRow = (no: string) => {
    setFocusedNo(no)
    pendingFocus.current = no
  }

  // 行渲染出来之后再把焦点挪过去（跨批次追加时行还不存在）
  useEffect(() => {
    const no = pendingFocus.current
    if (!no) return
    const row = Array.from(document.querySelectorAll<HTMLElement>('.problem-row')).find(
      (item) => item.dataset.rowNo === no,
    )
    if (!row) return
    pendingFocus.current = null
    row.focus({ preventScroll: true })
    row.scrollIntoView({ block: 'nearest' })
  }, [visible.length, focusedNo])

  // j/k（或 ↑/↓）在行间移动；滚出已渲染范围时自动补一批
  useEffect(() => {
    const isTyping = (target: EventTarget | null) => {
      const el = target as HTMLElement | null
      return Boolean(
        el &&
          (el.tagName === 'INPUT' ||
            el.tagName === 'TEXTAREA' ||
            el.tagName === 'SELECT' ||
            el.isContentEditable),
      )
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (isTyping(event.target)) return
      if (document.querySelector('.modal-backdrop, .palette-backdrop, .shortcuts-backdrop')) return
      const down = event.key === 'j' || event.key === 'ArrowDown'
      const up = event.key === 'k' || event.key === 'ArrowUp'
      if (!down && !up) return
      // 焦点在别的控件（搜索框、按钮）上时，方向键归它们
      const active = document.activeElement as HTMLElement | null
      if (active && active !== document.body && !active.closest('.problem-table')) return
      if (!visible.length) return
      event.preventDefault()
      const currentIndex = rovingNo ? visible.findIndex((item) => item.no === rovingNo) : -1
      const nextIndex = Math.max(0, Math.min(visible.length - 1, currentIndex + (down ? 1 : -1)))
      if (down && nextIndex >= visible.length - 1 && limit < filtered.length) {
        setLimit((value) => value + PAGE)
      }
      focusRow(visible[nextIndex].no)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visible, rovingNo, limit, filtered.length])

  // 分组统计用全量（数字要准），渲染只用 visible（DOM 要少）
  const groups = useMemo(() => {
    const map = new Map<string, Problem[]>()
    filtered.forEach((p) => {
      const list = map.get(p.category)
      if (list) list.push(p)
      else map.set(p.category, [p])
    })
    return Array.from(map.entries()).map(([category, items]) => {
      const meta = topicMeta(category)
      const curatedItems = items.filter((p) => p.curated)
      return {
        category,
        meta,
        items,
        done: items.filter((p) => data.problems[p.no]?.status === 'done').length,
        total: items.length,
        curatedTotal: curatedItems.length,
        curatedDone: curatedItems.filter(
          (p) => data.problems[p.no]?.status === 'done',
        ).length,
      }
    })
  }, [filtered, data.problems])

  // 渲染用的分组：按顺序从 visible 里取，预算用完就停
  const visibleGroups = useMemo(() => {
    if (sort !== 'path') return []
    const byCategory = new Map<string, Problem[]>()
    visible.forEach((p) => {
      const list = byCategory.get(p.category)
      if (list) list.push(p)
      else byCategory.set(p.category, [p])
    })
    return groups
      .filter((group) => byCategory.has(group.category))
      .map((group) => ({ ...group, items: byCategory.get(group.category) ?? [] }))
  }, [groups, visible, sort])

  const hasFilter =
    tier !== '全部' ||
    level !== '全部' ||
    status !== '全部' ||
    category !== '全部' ||
    scope !== 'all' ||
    query.trim() !== ''

  const clearFilters = () => {
    setTier('全部')
    setLevel('全部')
    setStatus('全部')
    setCategory('全部')
    setScope('all')
    setQuery('')
  }

  /**
   * 共享元素转场：点题号时，让题目名从表格行里「飞」到题目页的大标题位。
   * 靠 View Transitions API 给两边同一个 view-transition-name，浏览器自动补间。
   */
  const openProblem = (no: string, title: HTMLElement | null) => {
    if (!title) {
      navigate(`/problems/${no}`)
      return
    }
    title.style.viewTransitionName = 'problem-title'
    withViewTransition(() => navigate(`/problems/${no}`))
    window.setTimeout(() => {
      title.style.viewTransitionName = ''
    }, 900)
  }

  /** 修饰键 / 中键点击交给浏览器（新标签打开），只有普通左键才走 SPA 跳转 */
  const isPlainLeftClick = (event: ReactMouseEvent<HTMLElement>) =>
    event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey

  const renderRow = (problem: Problem) => {
    const state = data.problems[problem.no]
    const current = state?.status ?? 'todo'
    const inPlan = planSet.has(problem.no)
    const focused = rovingNo === problem.no
    return (
      <tr
        key={problem.no}
        data-row-no={problem.no}
        data-cursor="打开题目"
        // roving tabindex：整张表只有一个 Tab 停靠点，j/k 在行间移动焦点
        tabIndex={focused ? 0 : -1}
        aria-selected={focused}
        className={cn('problem-row', focused && 'is-focused')}
        onFocus={() => setFocusedNo(problem.no)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            const row = event.currentTarget
            openProblem(problem.no, row.querySelector<HTMLElement>('.problem-title'))
          }
        }}
        onClick={(event) => {
          // 点在按钮/链接上时让它们自己处理，别触发整行跳转
          if ((event.target as HTMLElement).closest('a, button')) return
          if (!isPlainLeftClick(event)) return
          const row = event.currentTarget
          openProblem(problem.no, row.querySelector<HTMLElement>('.problem-title'))
        }}
      >
        <td className="col-status">
          <StatusDot
            status={current}
            onClick={() => setProblemStatus(problem.no, nextStatus(current))}
          />
        </td>
        <td className="col-no data">{problem.no}</td>
        <td>
          {/* 真链接：支持 Ctrl/⌘+点击开新标签、右键复制链接、Tab 到标题直接回车 */}
          <a
            className="problem-title"
            href={`/problems/${problem.no}`}
            // 行本身是 Tab 停靠点，链接不再单独占一个（回车由行的 onKeyDown 处理）
            tabIndex={-1}
            onClick={(event) => {
              if (!isPlainLeftClick(event)) return
              event.preventDefault()
              openProblem(problem.no, event.currentTarget)
            }}
          >
            {problem.title}
          </a>
          {problem.hot100 ? (
            <span className="hot-badge" title={`LeetCode 热题 100${problem.hot100Group ? ` · ${problem.hot100Group}` : ''}`}>
              <Flame /> HOT
            </span>
          ) : null}
          {problem.complexity ? (
            <Tip
              className="tip-anchor--plain"
              content={
                <>
                  <span className="tip__term">
                    最优 {problem.complexity.time}
                    {problem.complexity.space ? ` · 空间 ${problem.complexity.space}` : ''}
                  </span>
                  <span className="tip__hint">
                    {problem.complexity.loops}｜{problem.complexity.why}
                  </span>
                </>
              }
            >
              <span className="problem-cx mono">{problem.complexity.time}</span>
            </Tip>
          ) : null}
          <div className="problem-sub">
            {sort === 'path' ? null : (
              <>
                <span>{problem.category}</span>
                <span className="dot" />
              </>
            )}
            {problem.tutorial.length ? (
              <>
                <span>精讲 {problem.tutorial.length}</span>
                <span className="dot" />
              </>
            ) : null}
            {problem.tags.length ? <span>{problem.tags.slice(0, 3).join(' / ')}</span> : null}
            {state?.wrong ? (
              <>
                <span className="dot" />
                <span className="problem-sub__wrong">错题</span>
              </>
            ) : null}
          </div>
        </td>
        <td className="col-level">
          <LevelBadge level={problem.level} />
        </td>
        <td className="col-tier">
          <TierBadge tier={problem.tier} />
        </td>
        <td className="col-freq data">
          {problem.huaweiFreq ? (
            <span className={problem.huaweiFreq >= 20 ? 'freq-hot' : ''}>
              {problem.huaweiFreq}
            </span>
          ) : (
            <span className="dim">—</span>
          )}
        </td>
        <td className="col-rate data">
          {problem.acRate != null ? `${problem.acRate.toFixed(1)}%` : '—'}
        </td>
        <td className="col-plan">
          <button
            className={`plan-add${inPlan ? ' in' : ''}`}
            title={inPlan ? '已在今日计划' : '加入今日计划'}
            aria-label={inPlan ? '已在今日计划' : '加入今日计划'}
            onClick={(event) => {
              event.stopPropagation()
              if (inPlan) {
                toast('已经在今日计划里了')
                return
              }
              addToPlan(problem.no)
              toast(`已加入今日：${problem.title}`, 'success')
            }}
          >
            <Plus className="ic-plus" />
            <Check className="ic-check" />
          </button>
        </td>
      </tr>
    )
  }

  return (
    <div className="page page--wide">
      <div className="page-head">
        <div>
          <div className="eyebrow">Problem set · 全量 {problems.length} 道 · Hot 100</div>
          <h1>题库</h1>
          <p>
            {problems.length} 道题（其中 <strong>{curated.length}</strong> 道配了精讲）· 已掌握{' '}
            {solvedCurated} 道 · 默认按
            <strong>学习路线</strong>
            排：专题由浅入深，每个专题内简单 → 中等 → 困难
          </p>
        </div>
        <div className="page-head__side">
          <button
            className="btn btn--sm"
            onClick={() => {
              setSort('path')
              setScope('curated')
              setTier('全部')
              setLevel('全部')
              setStatus('全部')
              setCategory('全部')
              setQuery('')
            }}
          >
            回到路线
          </button>
          <button
            className="btn btn--sm"
            onClick={() => {
              setSort('level')
              setScope('all')
              setTier('全部')
              setLevel('全部')
              setStatus('全部')
              setCategory('全部')
              setQuery('')
            }}
          >
            从易到难
          </button>
          <button
            className="btn btn--sm"
            onClick={() => {
              setSort('freq')
              setScope('all')
              setTier('P0')
              setLevel('全部')
              setStatus('全部')
              setCategory('全部')
              setQuery('')
            }}
          >
            只看 P0
          </button>
          <button
            className="btn btn--sm"
            onClick={() => {
              setScope('hot100')
              setSort('path')
              setTier('全部')
              setLevel('全部')
              setStatus('全部')
              setCategory('全部')
              setQuery('')
            }}
          >
            <Flame /> Hot 100
          </button>
        </div>
      </div>

      <div className="filter-bar">
        <div className="field filter-search">
          <Search />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => { typingRef.current = true; setQuery(e.target.value) }}
            placeholder="搜题号、标题、标签…"
            aria-label="搜索题目"
          />
          {query ? (
            <button onClick={() => setQuery('')} aria-label="清空搜索">
              <X style={{ width: 13, height: 13 }} />
            </button>
          ) : (
            <span className="kbd">/</span>
          )}
        </div>

        <div className="filter-group filter-group--scope">
          <span className="filter-label">范围</span>
          {(
            [
              { key: 'all', label: '全部', count: problems.length },
              { key: 'curated', label: '精选', count: curated.length },
              { key: 'hot100', label: 'Hot 100', count: hotCount },
              { key: 'top150', label: '经典 150', count: topCount },
            ] as Array<{ key: ProblemScope; label: string; count: number }>
          ).map((item) => (
            <button
              key={item.key}
              className={cn('chip', scope === item.key && 'active')}
              onClick={() => setScope(item.key)}
            >
              {item.label}
              <span className="chip__count">{item.count}</span>
            </button>
          ))}
        </div>

        <div className="filter-group">
          {TIERS.map((item) => (
            <button
              key={item}
              className={cn('chip', tier === item && 'active')}
              onClick={() => setTier(item)}
            >
              {item === '全部' ? '全部' : item}
            </button>
          ))}
        </div>

        <div className="filter-group">
          <span className="filter-label">难度</span>
          {LEVELS.map((item) => (
            <button
              key={item}
              className={cn('chip', level === item && 'active')}
              onClick={() => setLevel(item)}
            >
              {item === '全部' ? '全部' : LEVEL_LABEL[item]}
            </button>
          ))}
        </div>

        <div className="filter-group">
          <span className="filter-label">状态</span>
          <Select
            ariaLabel="筛选状态"
            value={status}
            options={STATUS_OPTIONS}
            onChange={setStatus}
          />
        </div>

        <div className="filter-group">
          <span className="filter-label">专题</span>
          <Select
            ariaLabel="筛选专题"
            value={category}
            options={topicOptions}
            onChange={setCategory}
            className="sel--topic"
          />
        </div>

        <div className="filter-group filter-group--end">
          <span className="filter-label">排序</span>
          <Select
            ariaLabel="排序方式"
            value={sort}
            options={SORT_OPTIONS}
            onChange={setSort}
            align="end"
          />
        </div>
      </div>

      <div className="results-meta">
        <span>
          找到 <strong><Odometer value={filtered.length} /></strong> 道
          {visible.length < filtered.length ? (
            <span className="dim">（已加载 {visible.length}，滚到底部自动加载更多）</span>
          ) : null}
          {sort === 'path' ? (
            <>
              {' · '}
              <span className="mono">
                路线进度 {solvedCurated}/{curated.length}
              </span>
            </>
          ) : null}
          {hasFilter ? ' · 已筛选' : ''}
        </span>
        {hasFilter ? (
          <button className="btn btn--ghost btn--sm" onClick={clearFilters}>
            <X /> 清空筛选
          </button>
        ) : (
          <span className="results-meta__hint">
            点击圆点切换 未开始 / 学习中 / 已掌握
          </span>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="empty empty--roomy">
          <div className="empty__mark">筛</div>
          <h2>没有符合条件的题</h2>
          <p>放宽一个筛选条件，或者清空搜索词。</p>
          <button className="btn empty__cta" onClick={clearFilters}>
            清空筛选
          </button>
        </div>
      ) : (
        <table className="problem-table">
          <thead>
            <tr>
              <th className="col-status">状态</th>
              <th className="col-no">题号</th>
              <th>题目</th>
              <th className="col-level">难度</th>
              <th className="col-tier">分级</th>
              <th className="col-freq">频度</th>
              <th className="col-rate">通过率</th>
              <th className="col-plan">今日</th>
            </tr>
          </thead>
          {sort === 'path' ? (
            visibleGroups.map((group) => (
              <tbody key={group.category}>
                <tr className="group-row">
                  <td colSpan={8}>
                    <span className="group-row__stage">{group.meta.stage}</span>
                    <span className="group-row__name">{group.category}</span>
                    <span className="group-row__note">{group.meta.note}</span>
                    <span className="group-row__count">
                      {group.curatedTotal ? (
                        <>
                          <span className="group-row__done">
                            {group.curatedDone}/{group.curatedTotal}
                          </span>
                          精选 · 共 {group.total} 道
                        </>
                      ) : (
                        <>共 {group.total} 道</>
                      )}
                    </span>
                  </td>
                </tr>
                {group.items.map(renderRow)}
              </tbody>
            ))
          ) : (
            <tbody>{visible.map(renderRow)}</tbody>
          )}
          {visible.length < filtered.length ? (
            <tbody>
              <tr className="load-more-row" ref={sentinelRef}>
                <td colSpan={8}>
                  <button
                    className="btn btn--sm"
                    onClick={() => setLimit((value) => value + PAGE)}
                  >
                    继续加载（已显示 {visible.length} / {filtered.length}）
                  </button>
                </td>
              </tr>
            </tbody>
          ) : null}
        </table>
      )}
    </div>
  )
}
