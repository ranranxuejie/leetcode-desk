/* global loadPyodide */
import { loadPyodide } from './pyodide/pyodide.mjs'

/**
 * 代码实验室的 Worker。
 *
 * 职责只有两件：
 * 1. 把 Pyodide 和会话引擎（lc_session.py）加载起来；
 * 2. 把主线程的请求转成 `__lc_dispatch__(json)` 调用，再把 JSON 结果原样发回。
 *
 * 真正的会话逻辑（命名空间、变量表、单步追踪）都在 lc_session.py 里，
 * 这样 Node 侧可以脱离浏览器直接跑同一份引擎做回归测试。
 */

let pyodide = null
let loading = null

const indexURL = new URL('./pyodide/', self.location.href).href
const engineURL = new URL('./pyodide/lc_session.py', self.location.href).href

async function ensure() {
  if (pyodide) return pyodide
  if (!loading) {
    loading = (async () => {
      const instance = await loadPyodide({ indexURL })
      const response = await fetch(engineURL, { cache: 'no-cache' })
      if (!response.ok) {
        throw new Error(`会话引擎加载失败（${response.status}）`)
      }
      instance.runPython(await response.text())
      pyodide = instance
      self.postMessage({ type: 'ready' })
      return instance
    })().catch((error) => {
      loading = null
      pyodide = null
      self.postMessage({
        type: 'fatal',
        error: `Python 运行时加载失败：${error?.message || error}`,
      })
      throw error
    })
  }
  return loading
}

async function dispatch(kind, body) {
  const runtime = await ensure()
  runtime.globals.set('__lc_input__', JSON.stringify({ kind, ...body }))
  const raw = runtime.runPython('__lc_dispatch__(__lc_input__)')
  const parsed = JSON.parse(String(raw))
  if (!parsed || parsed.ok !== true) {
    throw new Error(parsed?.error || '执行失败')
  }
  delete parsed.ok
  return parsed
}

self.onmessage = async (event) => {
  const msg = event.data
  if (!msg || typeof msg.type !== 'string' || typeof msg.id !== 'number') return
  const { type, id } = msg

  try {
    let payload
    if (type === 'runCases') {
      payload = await dispatch('runCases', {
        session: msg.session,
        code: msg.code,
        prelude: msg.prelude,
        cases: msg.cases,
      })
    } else if (type === 'exec') {
      payload = await dispatch('exec', {
        session: msg.session,
        code: msg.code,
        prelude: msg.prelude,
        preload: msg.preload,
        reload: msg.reload,
      })
    } else if (type === 'inspect') {
      payload = await dispatch('inspect', { session: msg.session })
    } else if (type === 'reset') {
      payload = await dispatch('reset', { session: msg.session })
    } else if (type === 'trace') {
      payload = await dispatch('trace', {
        session: msg.session,
        code: msg.code,
        prelude: msg.prelude,
        call: msg.call,
      })
    } else {
      return
    }
    self.postMessage({ type: 'result', id, ok: true, payload })
  } catch (error) {
    self.postMessage({
      type: 'result',
      id,
      ok: false,
      error: String(error?.message || error || '未知错误'),
    })
  }
}
