import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  CasesOutcome,
  ExecOutcome,
  RunnerStatus,
  SessionVar,
  TraceOutcome,
} from './types'

/**
 * Pyodide Worker 的调用层。
 *
 * 和旧版最大的区别：请求改成「一次会话操作」而不是「一次用例调用」——
 * 跑全部用例只走一个来回，会话命名空间留在 Worker 里，
 * 所以跑完之后还能接着在终端里用 `Solution()`、看变量。
 */

interface WorkerResult {
  type: 'result'
  id: number
  ok: boolean
  payload?: unknown
  error?: string
}

interface Waiter {
  settle: (result: WorkerResult) => void
  timer: number
  /**
   * 这个请求属于哪一代 worker。
   * 超时 / 致命错误时只清「这一代」的 waiter：用户点「重试」之后建的新 worker
   * 不该被上一代的 timer 牵连（P2-1）。
   */
  worker: Worker
}

export interface ExecOptions {
  /** 会话还没有命名空间时，先把编辑器里的代码载进去 */
  preload?: string
  /** 强制重建命名空间并重新载入代码（用户点了「载入代码」） */
  reload?: boolean
  /** 自测辅助源码（链表 / 树的构造与还原），注入到命名空间最前面 */
  prelude?: string
}

const LOAD_TIMEOUT = 45000
const CASE_TIMEOUT = 15000
const EXEC_TIMEOUT = 10000
const TRACE_TIMEOUT = 12000

export function usePythonRunner() {
  const workerRef = useRef<Worker | null>(null)
  const waitersRef = useRef(new Map<number, Waiter>())
  const seqRef = useRef(0)
  const readyRef = useRef(false)
  const [status, setStatus] = useState<RunnerStatus>('idle')
  const [error, setError] = useState('')

  /**
   * 让在飞的请求一起失败。
   * 传了 `only` 就只清这一代 worker 的请求：超时终止旧 worker 时，
   * 不能顺手把新一代 worker 的请求也拒掉（P2-1）。
   */
  const failAll = useCallback((message: string, only?: Worker) => {
    // 先收集再删：边遍历边删 Map 会漏掉后面的项
    const victims: [number, Waiter][] = []
    waitersRef.current.forEach((waiter, id) => {
      if (only && waiter.worker !== only) return
      victims.push([id, waiter])
    })
    victims.forEach(([id, waiter]) => {
      waitersRef.current.delete(id)
      window.clearTimeout(waiter.timer)
      waiter.settle({ type: 'result', id: 0, ok: false, error: message })
    })
  }, [])

  const teardown = useCallback(
    (message = '') => {
      const worker = workerRef.current
      // 先摘引用再 terminate：terminate 之后迟到的消息不该再看到这个 worker
      workerRef.current = null
      readyRef.current = false
      worker?.terminate()
      setStatus('idle')
      // P2-2：无条件清 waiter。以前只在传了 message 时才清，而「重试」按钮
      // 调的是无参 reset()，在飞的请求没被清掉，timer 到期后照样弹「运行超时」，
      // 还会把刚建好的新 worker 抹成孤儿。
      failAll(message || '运行环境已重置')
    },
    [failAll],
  )

  const ensureWorker = useCallback(() => {
    if (workerRef.current) return workerRef.current
    const url = `${import.meta.env.BASE_URL || '/'}pyodide-worker.js`
    const worker = new Worker(url, { type: 'module' })
    worker.onmessage = (event: MessageEvent) => {
      // 旧 worker 的迟到消息（已 terminate / 已被新一代取代）不该再动状态：
      // 否则一次超时之后，旧 worker 的 ready 会把新 worker 的 loading 覆盖掉。
      if (workerRef.current !== worker) return
      const msg = event.data as
        | { type: 'ready' }
        | { type: 'fatal'; error?: string }
        | WorkerResult
      if (msg.type === 'ready') {
        readyRef.current = true
        setStatus(waitersRef.current.size > 0 ? 'running' : 'ready')
        return
      }
      if (msg.type === 'fatal') {
        const message = msg.error ?? 'Python 运行时加载失败'
        setError(message)
        setStatus('error')
        failAll(message)
        worker.terminate()
        workerRef.current = null
        readyRef.current = false
        return
      }
      if (msg.type === 'result' && typeof msg.id === 'number') {
        const waiter = waitersRef.current.get(msg.id)
        if (!waiter) return
        waitersRef.current.delete(msg.id)
        window.clearTimeout(waiter.timer)
        waiter.settle(msg)
        if (waitersRef.current.size === 0) setStatus('ready')
      }
    }
    worker.onerror = (event) => {
      if (workerRef.current !== worker) return
      const message = event.message || 'Worker 启动失败'
      setError(message)
      setStatus('error')
      failAll(message)
      worker.terminate()
      workerRef.current = null
      readyRef.current = false
    }
    workerRef.current = worker
    return worker
  }, [failAll])

  const request = useCallback(
    <T,>(type: string, body: Record<string, unknown>, baseTimeout: number): Promise<T> => {
      const worker = ensureWorker()
      const id = ++seqRef.current
      const timeout = readyRef.current ? baseTimeout : Math.max(baseTimeout, LOAD_TIMEOUT)
      setStatus(readyRef.current ? 'running' : 'loading')
      return new Promise<T>((resolve, reject) => {
        const timer = window.setTimeout(() => {
          // P2-1：只有「这一代」worker 还是当前 worker 时才清理引用。
          // 用户可能已经点了「重试」建了新一代 worker，此时把 workerRef 抹成 null
          // 会让新 worker 变成没人管的孤儿（吃内存，下次请求还会再建第三个）。
          const isCurrent = workerRef.current === worker
          if (isCurrent) {
            workerRef.current = null
            readyRef.current = false
            worker.terminate()
            setStatus('error')
            setError('运行超时，已强制终止。检查一下是不是死循环。')
          }
          // 超时意味着这一代 worker 已经不可用了：它名下所有在飞的请求一起失败。
          // 以前只 reject 自己，剩下的 timer 到期后会再杀一次，并连带弄丢新一代 worker。
          failAll('运行超时，已强制终止。会话已重置。', worker)
          // failAll 正常情况下已经 reject 了本次请求，这里兜底防止 waiter 已被摘掉时挂死
          reject(new Error('运行超时，已强制终止。会话已重置。'))
        }, timeout)
        waitersRef.current.set(id, {
          timer,
          worker,
          settle: (result) => {
            if (result.ok) resolve(result.payload as T)
            else reject(new Error(result.error || '执行失败'))
          },
        })
        worker.postMessage({ type, id, ...body })
      })
    },
    [ensureWorker],
  )

  const runCases = useCallback(
    (code: string, cases: { id: string; call: string }[], session: string, prelude = '') =>
      request<CasesOutcome>('runCases', { code, cases, session, prelude }, CASE_TIMEOUT),
    [request],
  )

  const exec = useCallback(
    (code: string, session: string, options: ExecOptions = {}) =>
      request<ExecOutcome>(
        'exec',
        {
          code,
          session,
          prelude: options.prelude ?? '',
          preload: options.preload,
          reload: options.reload ?? false,
        },
        EXEC_TIMEOUT,
      ),
    [request],
  )

  const inspect = useCallback(
    async (session: string) => {
      const outcome = await request<{ vars: SessionVar[] }>(
        'inspect',
        { session },
        EXEC_TIMEOUT,
      )
      return outcome.vars ?? []
    },
    [request],
  )

  const resetSession = useCallback(
    async (session: string) => {
      await request<{ vars: SessionVar[] }>('reset', { session }, EXEC_TIMEOUT)
    },
    [request],
  )

  const trace = useCallback(
    (code: string, call: string, session: string, prelude = '') =>
      request<TraceOutcome>('trace', { code, call, session, prelude }, TRACE_TIMEOUT),
    [request],
  )

  useEffect(() => {
    return () => {
      workerRef.current?.terminate()
      workerRef.current = null
      readyRef.current = false
      waitersRef.current.forEach(({ timer }) => window.clearTimeout(timer))
      waitersRef.current.clear()
    }
  }, [])

  return {
    runCases,
    exec,
    inspect,
    resetSession,
    trace,
    status,
    error,
    reset: teardown,
  }
}
