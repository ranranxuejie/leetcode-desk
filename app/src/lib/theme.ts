/**
 * 颜色模式：深色 / 浅色 / 跟随系统。
 *
 * 三件事，只做这三件：
 *   1. 把模式写进 <html data-theme="dark|light">，CSS 侧只看这一个属性
 *      （令牌覆盖层在 styles/tokens.css 末尾，组件 CSS 一行都不用改）；
 *   2. 记住用户的选择（localStorage: lc.ui.theme，和界面偏好放一起，导出进度时不带走）；
 *   3. auto 模式跟着系统走 —— 系统换了深浅色，立刻重新解析，不需要用户刷新。
 *
 * 首屏防闪在 index.html 的内联脚本里做（那段脚本在样式表之前同步执行），
 * 这里的 applyTheme 只负责挂载后「按偏好再确认一次」和后续切换，两边逻辑必须保持一致。
 */

import { useSyncExternalStore } from 'react'
import { inShell, notifyShellTheme } from './shell'

export type ThemeMode = 'dark' | 'light' | 'auto'
/** 真正落到 DOM 上的只有两档：auto 会被解析成其中之一 */
export type ResolvedTheme = 'dark' | 'light'

/** 和 lib/ui.ts 同一个前缀：界面偏好都住在这里 */
const STORAGE_KEY = 'lc.ui.theme'
const DARK_QUERY = '(prefers-color-scheme: dark)'
/** 浏览器 / 桌面壳的顶栏颜色（meta[name=theme-color]），和 tokens.css 的 --bg-canvas 一致 */
const THEME_COLOR: Record<ResolvedTheme, string> = {
  dark: '#0a0c0f',
  light: '#f7f6f3',
}

export interface ThemeState {
  mode: ThemeMode
  resolved: ResolvedTheme
}

function isThemeMode(value: string | null): value is ThemeMode {
  return value === 'dark' || value === 'light' || value === 'auto'
}

/** 读用户偏好。没存过 → 深色（深色仍是默认，浅色是显式选择）。 */
export function loadThemeMode(): ThemeMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return isThemeMode(raw) ? raw : 'dark'
  } catch {
    // 隐私模式 / 配额满：读不到就按默认来
    return 'dark'
  }
}

export function saveThemeMode(mode: ThemeMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode)
  } catch {
    // 同上：记不住就记不住，本次会话内仍然生效
  }
}

/** 把 auto 解析成真实的一档（其余原样返回） */
export function resolveThemeMode(mode: ThemeMode): ResolvedTheme {
  if (mode !== 'auto') return mode
  try {
    return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light'
  } catch {
    return 'dark'
  }
}

/* ------------------------------------------------------------------ 订阅 */

const listeners = new Set<() => void>()
let state: ThemeState | null = null

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * 当前状态的快照。必须是稳定引用 —— useSyncExternalStore 靠它判断要不要重渲染，
 * 每次返回新对象会直接死循环。
 */
function getSnapshot(): ThemeState {
  if (!state) {
    const mode = loadThemeMode()
    // 首屏的内联脚本已经把属性写好了：优先信 DOM，避免图标闪一下再翻过来
    const domTheme = document.documentElement.dataset.theme
    const resolved: ResolvedTheme =
      domTheme === 'light' || domTheme === 'dark' ? domTheme : resolveThemeMode(mode)
    state = { mode, resolved }
  }
  return state
}

/* ---------------------------------------------------------------- 系统监听 */

let watchingSystem = false

/** auto 模式下系统换色要跟着变。只挂一次。 */
function watchSystem(): void {
  if (watchingSystem) return
  watchingSystem = true
  try {
    const query = window.matchMedia(DARK_QUERY)
    query.addEventListener('change', () => {
      // 只有 auto 才跟系统；用户明确选了深/浅就不要再被系统改回去
      if (getSnapshot().mode === 'auto') applyTheme('auto')
    })
  } catch {
    // 老浏览器没有 matchMedia：auto 就退化成「挂载那一刻的系统色」
  }
}

/* ------------------------------------------------------------------ 应用 */

/**
 * 把模式落到 DOM 上，返回解析后的真实主题。
 * 幂等：同一个模式重复调用不会触发多余的重渲染。
 */
export function applyTheme(mode: ThemeMode): ResolvedTheme {
  const resolved = resolveThemeMode(mode)
  const root = document.documentElement
  root.dataset.theme = resolved
  // 记下用户「选的是哪一档」（auto 也留着），调试 / 截图脚本会用到
  root.dataset.themeMode = mode
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', THEME_COLOR[resolved])
  // 桌面壳：窗口描边/底色也要跟着换，否则浅色下四周会留一圈深色边
  if (inShell()) notifyShellTheme(resolved)
  watchSystem()

  if (!state || state.mode !== mode || state.resolved !== resolved) {
    state = { mode, resolved }
    listeners.forEach((listener) => listener())
  }
  return resolved
}

/** 用户主动切换（设置弹窗、顶栏按钮）：写偏好 + 应用 + 通知订阅者 */
export function setThemeMode(mode: ThemeMode): ResolvedTheme {
  saveThemeMode(mode)
  return applyTheme(mode)
}

/** 深色 ↔ 浅色一键对调。auto 视作「当前显示的那一档」的对立面。 */
export function toggleThemeMode(): ThemeMode {
  const next: ThemeMode = getSnapshot().resolved === 'dark' ? 'light' : 'dark'
  setThemeMode(next)
  return next
}

/** React 侧读当前模式（弹窗要显示选中的是哪一档，顶栏要决定画太阳还是月亮） */
export function useThemeState(): ThemeState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
