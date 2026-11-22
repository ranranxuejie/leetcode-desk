/**
 * DeepSeek Key 的前端接口。
 *
 * Key 只存在**本机服务端**（`%LOCALAPPDATA%\LeetCode训练台\deepseek.key`），
 * 前端只会拿到「有没有配 / 尾号四位」，永远拿不到完整 Key，也不写 localStorage。
 *
 * 开发模式（Vite dev server）没有这些接口：`/api/key` 会返回 index.html，
 * 这时按「由 app/.env.local 管理」处理，界面上给出对应说明。
 */

export interface KeyStatus {
  /** 能不能用（有没有配） */
  configured: boolean
  /** settings = 设置里填的；env = 环境变量；file = app/.env.local；none = 没配 */
  source: 'settings' | 'env' | 'file' | 'none' | 'dev'
  hint: string
  /** 开发模式下无法在界面里管理 */
  managedByDevServer?: boolean
}

const DEV_STATUS: KeyStatus = {
  configured: true,
  source: 'dev',
  hint: '',
  managedByDevServer: true,
}

async function readJson<T>(response: Response): Promise<T | null> {
  const type = response.headers.get('content-type') || ''
  if (!type.includes('application/json')) return null
  try {
    return (await response.json()) as T
  } catch {
    return null
  }
}

export async function fetchKeyStatus(): Promise<KeyStatus> {
  try {
    const response = await fetch('/api/key', { cache: 'no-store' })
    const data = await readJson<KeyStatus>(response)
    if (!data) return DEV_STATUS
    return data
  } catch {
    return DEV_STATUS
  }
}

export async function saveKey(key: string): Promise<{ ok: boolean; message?: string; status?: KeyStatus }> {
  try {
    const response = await fetch('/api/key', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: key.trim() }),
    })
    const data = await readJson<{ ok?: boolean; error?: { message?: string } } & KeyStatus>(response)
    if (!data) return { ok: false, message: '当前是开发模式，Key 请写进 app/.env.local' }
    if (!response.ok) return { ok: false, message: data.error?.message || `保存失败（HTTP ${response.status}）` }
    return { ok: true, status: data }
  } catch (error) {
    return { ok: false, message: '保存失败：' + (error instanceof Error ? error.message : String(error)) }
  }
}

export async function clearKey(): Promise<{ ok: boolean; message?: string; status?: KeyStatus }> {
  try {
    const response = await fetch('/api/key', { method: 'DELETE' })
    const data = await readJson<KeyStatus>(response)
    if (!data) return { ok: false, message: '当前是开发模式，Key 由 app/.env.local 管理' }
    return { ok: true, status: data }
  } catch (error) {
    return { ok: false, message: '清除失败：' + (error instanceof Error ? error.message : String(error)) }
  }
}

export async function testKey(): Promise<{ ok: boolean; message: string }> {
  try {
    const response = await fetch('/api/key/test', { method: 'POST' })
    const data = await readJson<{ ok?: boolean; message?: string }>(response)
    if (!data) return { ok: false, message: '当前是开发模式，无法测试' }
    return { ok: Boolean(data.ok), message: data.message || '' }
  } catch (error) {
    return { ok: false, message: '测试失败：' + (error instanceof Error ? error.message : String(error)) }
  }
}
