import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import type {
  DayLog,
  MotionLevel,
  ProblemState,
  ProgressData,
  Rating,
  RunEntry,
  Status,
  TestCase,
} from './types'
import { todayKey } from './utils'

const KEY = 'lc.progress.v1'

/** 运行记录只留最近这么多条，超出丢最旧的（存档不会无限长大） */
export const RUN_LIMIT = 30

/** 存档版本：改结构时 +1，并在 migrate 里补上新字段 */
const VERSION = 3

export function emptyProblem(): ProblemState {
  return {
    status: 'todo',
    wrong: false,
    note: '',
    code: '',
    cases: [],
    attempts: 0,
    passes: 0,
    timeSpentSec: 0,
    reviews: [],
    runs: [],
    revealed: { count: 0, lastAt: 0 },
  }
}

function emptyDay(): DayLog {
  return { runs: 0, passes: 0, minutes: 0, solved: 0, opened: 0 }
}

/**
 * 运行记录兜底：数组、元素形状、条数上限。
 * at 不是有限数字的条目直接丢掉（渲染「相对时间」会算出 1970 年那种脏数据）。
 */
function normalizeRuns(raw: unknown): RunEntry[] {
  if (!Array.isArray(raw)) return []
  const runs = raw
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .filter((item) => typeof item.at === 'number' && Number.isFinite(item.at))
    .map<RunEntry>((item) => ({
      at: item.at as number,
      passed: item.passed === true ? true : item.passed === false ? false : null,
      ms: typeof item.ms === 'number' && Number.isFinite(item.ms) ? item.ms : 0,
    }))
  // 存档里可能被手改出超过 30 条，只保留最新的
  return runs.slice(-RUN_LIMIT)
}

/**
 * 存档自愈：localStorage 里的数据可能是旧版本、手工导入的、或者被别的东西写坏的。
 * 之前只做了浅合并，缺一个字段（比如 cases）就会让题目页在渲染期抛错、整页白屏。
 * 这里按类型逐字段兜底，坏字段一律退回默认值，宁可丢一点数据也不能让页面打不开。
 */
function normalizeProblem(raw: unknown): ProblemState {
  const base = emptyProblem()
  if (!raw || typeof raw !== 'object') return base
  const value = raw as Partial<ProblemState> & Record<string, unknown>
  const num = (input: unknown, fallback: number) =>
    typeof input === 'number' && Number.isFinite(input) ? input : fallback
  return {
    status: value.status === 'learning' || value.status === 'done' ? value.status : 'todo',
    wrong: value.wrong === true,
    note: typeof value.note === 'string' ? value.note : '',
    code: typeof value.code === 'string' ? value.code : '',
    cases: Array.isArray(value.cases)
      ? value.cases
          .filter((item): item is TestCase => Boolean(item) && typeof item === 'object')
          .map((item) => ({
            id: typeof item.id === 'string' ? item.id : `case-${Math.random().toString(36).slice(2, 8)}`,
            call: typeof item.call === 'string' ? item.call : '',
            expected: typeof item.expected === 'string' ? item.expected : '',
          }))
      : [],
    attempts: num(value.attempts, 0),
    passes: num(value.passes, 0),
    timeSpentSec: num(value.timeSpentSec, 0),
    selfRating:
      value.selfRating === 'read' || value.selfRating === 'recall' || value.selfRating === 'variant'
        ? value.selfRating
        : undefined,
    lastOpenedAt: typeof value.lastOpenedAt === 'number' ? value.lastOpenedAt : undefined,
    revealed: {
      count: typeof (value.revealed as { count?: unknown })?.count === 'number' ? Number((value.revealed as { count: number }).count) : 0,
      lastAt: typeof (value.revealed as { lastAt?: unknown })?.lastAt === 'number' ? Number((value.revealed as { lastAt: number }).lastAt) : 0,
    },
    reviews: Array.isArray(value.reviews)
      ? value.reviews.filter((item) => Boolean(item) && typeof item === 'object')
      : [],
    runs: normalizeRuns(value.runs),
  }
}

function normalizeDay(raw: unknown): DayLog {
  const base = emptyDay()
  if (!raw || typeof raw !== 'object') return base
  const value = raw as Partial<DayLog>
  const num = (input: unknown) => (typeof input === 'number' && Number.isFinite(input) ? input : 0)
  return {
    runs: num(value.runs),
    passes: num(value.passes),
    minutes: num(value.minutes),
    solved: num(value.solved),
    opened: num(value.opened),
  }
}

function defaultData(): ProgressData {
  return {
    version: VERSION,
    problems: {},
    daily: {},
    plans: {},
    readDocs: [],
    settings: { dailyGoal: 3, motion: 'full' },
  }
}

/**
 * 存档归一 + 版本迁移。load()（读 localStorage）和 importAll()（导入别人导出的文件）
 * 都走这一条路径，保证老存档 / 老导出文件进来以后都是当前版本。
 *
 * v1 → v2：字段兜底（normalizeProblem / normalizeDay）。
 * v2 → v3：每题补 runs: []。老数据的 attempts / passes 原样保留，不从 reviews 倒推历史，
 *          所以升级后「提交记录」是空的，从下一次运行开始记。
 */
function migrate(parsed: Partial<ProgressData>): ProgressData {
  const problems: Record<string, ProblemState> = {}
  Object.entries(parsed.problems ?? {}).forEach(([no, state]) => {
    problems[no] = normalizeProblem(state)
  })
  const daily: Record<string, DayLog> = {}
  Object.entries(parsed.daily ?? {}).forEach(([key, log]) => {
    daily[key] = normalizeDay(log)
  })
  return {
    ...defaultData(),
    ...parsed,
    version: VERSION,
    problems,
    daily,
    plans: parsed.plans ?? {},
    readDocs: Array.isArray(parsed.readDocs)
      ? parsed.readDocs.filter((id): id is string => typeof id === 'string')
      : [],
    settings: { ...defaultData().settings, ...(parsed.settings ?? {}) },
  }
}

function load(): ProgressData {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return defaultData()
    const parsed = JSON.parse(raw) as Partial<ProgressData>
    return migrate(parsed)
  } catch {
    return defaultData()
  }
}

interface ProgressApi {
  data: ProgressData
  stateOf: (no: string) => ProblemState
  today: () => DayLog
  todayPlan: string[]
  update: (no: string, patch: Partial<ProblemState>) => void
  setStatus: (no: string, status: Status) => void
  toggleWrong: (no: string) => void
  saveNote: (no: string, note: string) => void
  saveCode: (no: string, code: string) => void
  saveCases: (no: string, cases: TestCase[]) => void
  recordOpen: (no: string) => void
  recordRun: (no: string, passed: boolean | null, ms: number) => void
  recordReview: (no: string, result: 'pass' | 'fail') => void
  recordReveal: (no: string) => void
  setRating: (no: string, rating: Rating) => void
  addTime: (no: string, seconds: number) => void
  setPlan: (date: string, list: string[]) => void
  addToPlan: (no: string) => void
  removeFromPlan: (no: string) => void
  toggleReadDoc: (id: string) => void
  setDailyGoal: (goal: number) => void
  setMotion: (motion: MotionLevel) => void
  resetProblem: (no: string) => void
  exportAll: () => string
  importAll: (raw: string) => void
  resetAll: () => void
}

const ProgressContext = createContext<ProgressApi | null>(null)

export function ProgressProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<ProgressData>(load)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(KEY, JSON.stringify(data))
      } catch {
        // 存储空间不足时静默失败，界面仍然可用
      }
    }, 250)
    return () => window.clearTimeout(timer)
  }, [data])

  const stateOf = useCallback(
    (no: string) => normalizeProblem(data.problems[no]),
    [data.problems],
  )

  const update = useCallback((no: string, patch: Partial<ProblemState>) => {
    setData((prev) => {
      const current = prev.problems[no] ?? emptyProblem()
      return {
        ...prev,
        problems: { ...prev.problems, [no]: { ...current, ...patch } },
      }
    })
  }, [])

  const bumpDay = useCallback(
    (patch: Partial<DayLog>) => {
      setData((prev) => {
        const key = todayKey()
        const day = prev.daily[key] ?? emptyDay()
        return {
          ...prev,
          daily: {
            ...prev.daily,
            [key]: {
              runs: day.runs + (patch.runs ?? 0),
              passes: day.passes + (patch.passes ?? 0),
              minutes: day.minutes + (patch.minutes ?? 0),
              solved: day.solved + (patch.solved ?? 0),
              opened: day.opened + (patch.opened ?? 0),
            },
          },
        }
      })
    },
    [],
  )

  const setStatus = useCallback(
    (no: string, status: Status) => {
      setData((prev) => {
        const current = prev.problems[no] ?? emptyProblem()
        if (current.status === status) return prev
        const key = todayKey()
        const day = prev.daily[key] ?? emptyDay()
        const solvedDelta =
          (status === 'done' ? 1 : 0) - (current.status === 'done' ? 1 : 0)
        return {
          ...prev,
          problems: {
            ...prev.problems,
            [no]: { ...current, status, lastOpenedAt: Date.now() },
          },
          daily: {
            ...prev.daily,
            [key]: { ...day, solved: Math.max(0, day.solved + solvedDelta) },
          },
        }
      })
    },
    [],
  )

  const toggleWrong = useCallback((no: string) => {
    setData((prev) => {
      const current = prev.problems[no] ?? emptyProblem()
      const wrong = !current.wrong
      return {
        ...prev,
        problems: {
          ...prev.problems,
          [no]: {
            ...current,
            wrong,
            // 新记一次错题，就重新从 1 天间隔开始复习
            reviews: wrong ? [] : current.reviews,
          },
        },
      }
    })
  }, [])

  const saveNote = useCallback(
    (no: string, note: string) => update(no, { note }),
    [update],
  )
  const saveCode = useCallback(
    (no: string, code: string) => update(no, { code }),
    [update],
  )
  const saveCases = useCallback(
    (no: string, cases: TestCase[]) => update(no, { cases }),
    [update],
  )

  const recordOpen = useCallback(
    (no: string) => {
      update(no, { lastOpenedAt: Date.now() })
      bumpDay({ opened: 1 })
    },
    [bumpDay, update],
  )

  const recordRun = useCallback(
    /**
     * 记一次运行。passed 三态：
     * - true / false：通过 / 未通过，attempts、passes（含当日 passes）、timeSpentSec 都记；
     * - null：只跑了没有可判定的用例（未判定），算一次运行、算用时，但**不算通过**。
     */
    (no: string, passed: boolean | null, ms: number) => {
      setData((prev) => {
        const current = prev.problems[no] ?? emptyProblem()
        const key = todayKey()
        const day = prev.daily[key] ?? emptyDay()
        const passedOk = passed === true
        const at = Date.now()
        const entry: RunEntry = { at, passed, ms: Math.max(0, Math.round(ms)) }
        return {
          ...prev,
          problems: {
            ...prev.problems,
            [no]: {
              ...current,
              attempts: current.attempts + 1,
              passes: current.passes + (passedOk ? 1 : 0),
              timeSpentSec: current.timeSpentSec + Math.max(1, Math.round(ms / 1000)),
              lastOpenedAt: at,
              // 时间线只留最近 RUN_LIMIT 条，超出丢最旧的
              runs: [...current.runs, entry].slice(-RUN_LIMIT),
            },
          },
          daily: {
            ...prev.daily,
            [key]: {
              ...day,
              runs: day.runs + 1,
              passes: day.passes + (passedOk ? 1 : 0),
              minutes: day.minutes + Math.round(ms / 60000),
            },
          },
        }
      })
    },
    [],
  )

  /** 展开「参考答案」记一笔：这是「先想 20 分钟」的对照信号 */
  const recordReveal = useCallback((no: string) => {
    setData((prev) => {
      const current = prev.problems[no] ?? emptyProblem()
      const revealed = current.revealed ?? { count: 0, lastAt: 0 }
      return {
        ...prev,
        problems: {
          ...prev.problems,
          [no]: { ...current, revealed: { count: revealed.count + 1, lastAt: Date.now() } },
        },
      }
    })
  }, [])

  const recordReview = useCallback(
    (no: string, result: 'pass' | 'fail') => {
      setData((prev) => {
        const current = prev.problems[no] ?? emptyProblem()
        return {
          ...prev,
          problems: {
            ...prev.problems,
            [no]: {
              ...current,
              wrong: result === 'fail',
              reviews: [...current.reviews, { at: Date.now(), result }],
            },
          },
        }
      })
    },
    [],
  )

  const setRating = useCallback(
    (no: string, rating: Rating) => update(no, { selfRating: rating }),
    [update],
  )

  const addTime = useCallback((no: string, seconds: number) => {
    if (seconds < 1) return
    setData((prev) => {
      const current = prev.problems[no] ?? emptyProblem()
      const key = todayKey()
      const day = prev.daily[key] ?? emptyDay()
      return {
        ...prev,
        problems: {
          ...prev.problems,
          [no]: { ...current, timeSpentSec: current.timeSpentSec + seconds },
        },
        daily: {
          ...prev.daily,
          [key]: { ...day, minutes: day.minutes + Math.floor(seconds / 60) },
        },
      }
    })
  }, [])

  const setPlan = useCallback((date: string, list: string[]) => {
    setData((prev) => ({
      ...prev,
      plans: { ...prev.plans, [date]: Array.from(new Set(list)) },
    }))
  }, [])

  const addToPlan = useCallback((no: string) => {
    const key = todayKey()
    setData((prev) => {
      const list = prev.plans[key] ?? []
      if (list.includes(no)) return prev
      return { ...prev, plans: { ...prev.plans, [key]: [...list, no] } }
    })
  }, [])

  const removeFromPlan = useCallback((no: string) => {
    const key = todayKey()
    setData((prev) => ({
      ...prev,
      plans: {
        ...prev.plans,
        [key]: (prev.plans[key] ?? []).filter((x) => x !== no),
      },
    }))
  }, [])

  const toggleReadDoc = useCallback((id: string) => {
    setData((prev) => ({
      ...prev,
      readDocs: prev.readDocs.includes(id)
        ? prev.readDocs.filter((x) => x !== id)
        : [...prev.readDocs, id],
    }))
  }, [])

  const setDailyGoal = useCallback((goal: number) => {
    setData((prev) => ({
      ...prev,
      settings: { ...prev.settings, dailyGoal: Math.max(1, Math.min(20, goal)) },
    }))
  }, [])

  const setMotion = useCallback((motion: MotionLevel) => {
    setData((prev) => ({ ...prev, settings: { ...prev.settings, motion } }))
  }, [])

  const exportAll = useCallback(() => JSON.stringify(data, null, 2), [data])

  const importAll = useCallback((raw: string) => {
    const parsed = JSON.parse(raw) as Partial<ProgressData>
    if (!parsed || typeof parsed !== 'object' || !parsed.problems) {
      throw new Error('文件格式不对：缺少 problems 字段')
    }
    // 老导出文件（v1 / v2，没有 runs[]）和读存档走同一条迁移路径
    setData(migrate(parsed))
  }, [])

  /** 删掉某道题的本地记录：题目页崩溃时给用户一个自救出口 */
  const resetProblem = useCallback((no: string) => {
    setData((prev) => {
      const next = { ...prev.problems }
      delete next[no]
      return { ...prev, problems: next }
    })
  }, [])

  const resetAll = useCallback(() => setData(defaultData()), [])

  const api = useMemo<ProgressApi>(
    () => ({
      data,
      stateOf,
      today: () => data.daily[todayKey()] ?? emptyDay(),
      todayPlan: data.plans[todayKey()] ?? [],
      update,
      setStatus,
      toggleWrong,
      saveNote,
      saveCode,
      saveCases,
      recordOpen,
      recordRun,
      recordReview,
      recordReveal,
      setRating,
      addTime,
      setPlan,
      addToPlan,
      removeFromPlan,
      toggleReadDoc,
      setDailyGoal,
      setMotion,
      exportAll,
      importAll,
      resetProblem,
      resetAll,
    }),
    [
      data,
      stateOf,
      update,
      setStatus,
      toggleWrong,
      saveNote,
      saveCode,
      saveCases,
      recordOpen,
      recordRun,
      recordReview,
      recordReveal,
      setRating,
      addTime,
      setPlan,
      addToPlan,
      removeFromPlan,
      toggleReadDoc,
      setDailyGoal,
      setMotion,
      exportAll,
      importAll,
      resetProblem,
      resetAll,
    ],
  )

  return (
    <ProgressContext.Provider value={api}>{children}</ProgressContext.Provider>
  )
}

export function useProgress(): ProgressApi {
  const value = useContext(ProgressContext)
  if (!value) throw new Error('useProgress must be used inside ProgressProvider')
  return value
}
