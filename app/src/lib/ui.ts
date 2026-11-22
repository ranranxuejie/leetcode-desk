/**
 * 界面尺寸/状态的小工具：侧边栏收起、分栏宽度这些「个人偏好」存在 localStorage，
 * 和 lc.progress.v1 里的学习进度分开，导出进度时不会带上界面设置。
 */

const PREFIX = 'lc.ui.'

export function loadUiNumber(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    const value = raw == null ? NaN : Number(raw)
    return Number.isFinite(value) ? value : fallback
  } catch {
    return fallback
  }
}

export function saveUiNumber(key: string, value: number): void {
  try {
    localStorage.setItem(PREFIX + key, String(Math.round(value)))
  } catch {
    // 隐私模式 / 配额满：记不住就记不住
  }
}

export function loadUiFlag(key: string, fallback = false): boolean {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    return raw == null ? fallback : raw === '1'
  } catch {
    return fallback
  }
}

export function saveUiFlag(key: string, value: boolean): void {
  try {
    localStorage.setItem(PREFIX + key, value ? '1' : '0')
  } catch {
    // 同上
  }
}
