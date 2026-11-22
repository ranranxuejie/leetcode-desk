import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { Meta, Problem, StatementDetail, TutorialDoc } from './types'

interface DataBundle {
  problems: Problem[]
  tutorials: TutorialDoc[]
  meta: Meta
  byNo: Map<string, Problem>
  byDoc: Map<string, TutorialDoc>
}

const DataContext = createContext<DataBundle | null>(null)

/**
 * 模块级 Promise 缓存：StrictMode 下 effect 会跑两遍，没有这层缓存的话
 * problems.json（3.4MB）会被请求两次 —— 实测资源列表里同一个文件出现两遍。
 */
const jsonCache = new Map<string, Promise<unknown>>()

async function loadJson<T>(name: string): Promise<T> {
  const cached = jsonCache.get(name) as Promise<T> | undefined
  if (cached) return cached
  const base = import.meta.env.BASE_URL || '/'
  // no-store：题库/教程这些 JSON 会随重建变化，桌面版的静态服务器曾经给它们发过
  // 「一年不可变」的缓存头，导致打开后还是旧题库。这里直接从缓存之外取。
  const task = fetch(`${base}data/${name}.json`, { cache: 'no-store' }).then(async (res) => {
    if (!res.ok) throw new Error(`加载 ${name}.json 失败（${res.status}）`)
    return (await res.json()) as T
  })
  jsonCache.set(name, task)
  // 失败要清掉缓存，否则一次网络抖动就永久失败
  task.catch(() => jsonCache.delete(name))
  return task
}

/**
 * 题面分片：全量题库 4500 道题面按每 50 道切一片，打开题目页时才取。
 * 同一个分片只请求一次（Promise 缓存），换题不重复下载。
 */
const shardCache = new Map<number, Promise<Record<string, StatementDetail>>>()

function loadShard(shard: number): Promise<Record<string, StatementDetail>> {
  const cached = shardCache.get(shard)
  if (cached) return cached
  const base = import.meta.env.BASE_URL || '/'
  const task = fetch(`${base}data/statements/${shard}.json`, { cache: 'no-store' })
    .then((res) => (res.ok ? (res.json() as Promise<Record<string, StatementDetail>>) : {}))
    .catch(() => ({}))
  shardCache.set(shard, task)
  return task
}

/** 题目页用：拿到这道题的题面 / 示例 / 代码模板 */
export function useStatement(problem: Problem): {
  detail: StatementDetail | null
  loading: boolean
} {  const [detail, setDetail] = useState<StatementDetail | null>(null)
  const [loading, setLoading] = useState(problem.hasStatement)

  useEffect(() => {
    if (!problem.hasStatement) {
      setDetail(null)
      setLoading(false)
      return
    }
    let alive = true
    setLoading(true)
    setDetail(null)
    void loadShard(problem.shard).then((map) => {
      if (!alive) return
      setDetail(map[problem.no] ?? null)
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [problem.no, problem.shard, problem.hasStatement])

  return { detail, loading }
}

/**
 * Hot 100 的预生成深度讲解：整份 teachings.json 只取一次（约 600KB），
 * 之后按题号在内存里查。没标记 hasTeaching 的题不会触发请求。
 */
let teachingsTask: Promise<Record<string, string>> | null = null

function loadTeachings(): Promise<Record<string, string>> {
  if (!teachingsTask) {
    const base = import.meta.env.BASE_URL || '/'
    teachingsTask = fetch(`${base}data/teachings.json`, { cache: 'no-store' })
      .then((res) => (res.ok ? (res.json() as Promise<Record<string, string>>) : {}))
      .catch(() => ({}))
  }
  return teachingsTask
}

export function useTeaching(problem: Problem): { teaching: string | null; loading: boolean } {
  const [teaching, setTeaching] = useState<string | null>(null)
  const [loading, setLoading] = useState(Boolean(problem.hasTeaching))

  useEffect(() => {
    if (!problem.hasTeaching) {
      setTeaching(null)
      setLoading(false)
      return
    }
    let alive = true
    setLoading(true)
    void loadTeachings().then((map) => {
      if (!alive) return
      setTeaching(map[problem.no] ?? null)
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [problem.no, problem.hasTeaching])

  return { teaching, loading }
}

export function DataProvider({ children }: { children: ReactNode }) {
  const [bundle, setBundle] = useState<DataBundle | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    Promise.all([
      loadJson<Problem[]>('problems'),
      loadJson<TutorialDoc[]>('tutorials'),
      loadJson<Meta>('meta'),
    ])
      .then(([problems, tutorials, meta]) => {
        if (!alive) return
        setBundle({
          problems,
          tutorials,
          meta,
          byNo: new Map(problems.map((p) => [p.no, p])),
          byDoc: new Map(tutorials.map((d) => [d.id, d])),
        })
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      alive = false
    }
  }, [])

  if (error) {
    return (
      <div className="boot">
        <div className="boot__mark">题</div>
        <h1>讲义没有装订成功</h1>
        <p>{error}</p>
        <p className="boot__hint">请先在项目根目录运行：python tools/build_web_data.py</p>
      </div>
    )
  }

  if (!bundle) {
    // 骨架屏：先按真实版式铺出灰块，让用户知道「正在来」而不是「卡死了」
    return (
      <div className="boot-skeleton" aria-busy="true" aria-label="正在加载题库">
        <div className="boot-skeleton__side">
          <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
            <div className="sk" style={{ width: 36, height: 36, borderRadius: 10 }} />
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 7 }}>
              <div className="sk sk--text" style={{ width: '72%' }} />
              <div className="sk sk--text" style={{ width: '48%', height: 8 }} />
            </div>
          </div>
          <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {Array.from({ length: 5 }).map((_, index) => (
              <div
                key={index}
                className="sk"
                style={{ height: 32, borderRadius: 8, opacity: 1 - index * 0.12 }}
              />
            ))}
          </div>
          <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="sk sk--text" style={{ width: '52%' }} />
            <div className="sk" style={{ height: 4, borderRadius: 999 }} />
          </div>
        </div>

        <div className="boot-skeleton__main">
          <div className="sk sk--title" style={{ width: '38%' }} />
          <div className="sk sk--title" style={{ width: '52%', height: 34 }} />
          <div className="sk sk--text" style={{ width: '46%' }} />
          <div className="boot-skeleton__row">
            {Array.from({ length: 4 }).map((_, index) => (
              <div className="sk sk--tile" key={index} />
            ))}
          </div>
          <div className="boot-skeleton__grid">
            <div className="boot-skeleton__col">
              <div className="sk sk--card" />
              <div className="sk sk--card" style={{ height: 168 }} />
              <div className="sk sk--card" style={{ height: 110 }} />
            </div>
            <div className="boot-skeleton__col">
              <div className="sk sk--card" style={{ height: 148 }} />
              <div className="sk sk--card" style={{ height: 120 }} />
              <div className="sk sk--card" style={{ height: 176 }} />
            </div>
          </div>
        </div>

        <div className="boot-skeleton__label">正在装订讲义</div>
      </div>
    )
  }

  return <DataContext.Provider value={bundle}>{children}</DataContext.Provider>
}

export function useData(): DataBundle {
  const value = useContext(DataContext)
  if (!value) throw new Error('useData must be used inside DataProvider')
  return value
}

export function useProblem(no?: string): Problem | null {
  const { byNo } = useData()
  return useMemo(() => (no ? byNo.get(no) ?? null : null), [byNo, no])
}
