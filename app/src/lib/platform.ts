/**
 * 平台判断：快捷键提示里到底该显示 ⌘ 还是 Ctrl。
 *
 * 之前顶栏写死 ⌘K、代码区写死 ⌘ Enter，Windows 用户按 ⌘ 什么都不会发生 ——
 * 属于「一看就不对」的一致性 bug，顺手统一到这里。
 */

export const IS_MAC: boolean = (() => {
  if (typeof navigator === 'undefined') return false
  const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData
  const platform = uaData?.platform || navigator.platform || ''
  return /mac|iphone|ipad|ipod/i.test(platform)
})()

/** 修饰键显示文本：mac 上是 ⌘，其它平台是 Ctrl */
export const MOD_KEY = IS_MAC ? '⌘' : 'Ctrl'

/** 组合键显示，如 modKey('K') → '⌘K' / 'Ctrl K' */
export function modKey(key: string, separator = ''): string {
  return `${MOD_KEY}${separator}${key}`
}
