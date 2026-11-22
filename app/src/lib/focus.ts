/**
 * 弹层焦点管理：焦点陷阱 + 焦点还原 + Esc 关闭 + 「同一时间只有一个弹层」的栈。
 *
 * 为什么自己写：项目里设置弹窗、命令面板、快捷键总览都是 portal 到 body 的浮层，
 * 浏览器不会替我们做「焦点不要跑出去」这件事。没有它，打开弹窗后按 Tab 会跑到
 * 弹窗背后的侧栏导航上（焦点环看不见，键盘用户直接迷路）。
 *
 * 约定：
 * - 一个弹层 = 一个 `useFocusTrap` 调用，返回的 ref 必须挂在弹层**根节点**上。
 * - 模块级栈记录当前打开顺序；只有**栈顶**弹层响应 Tab / Esc，避免两个弹层同时抢键。
 * - 纯 hook，无第三方依赖。
 */

import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

/** 可以按 Tab 停下来的元素。`:not([disabled])` 交给选择器，tabindex="-1" 排除在外。 */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  'audio[controls]',
  'video[controls]',
  'summary',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/** 栈里的一个弹层。`container` 用 ref 而不是节点，因为 portal 里的节点会随重渲染更换。 */
interface TrapEntry {
  id: symbol
  container: RefObject<HTMLDivElement | null>
}

/** 当前打开的弹层，后 push 的在上层。同一时间只有栈顶响应 Tab / Esc。 */
const trapStack: TrapEntry[] = []

/**
 * 清掉已经离开文档的弹层记录。
 * 正常关闭走 cleanup 里的 pop；这里兜底，防止某个弹层异常卸载后把栈顶占死，
 * 导致后面的弹层全都收不到 Tab / Esc（「栈卡死」）。
 */
function pruneTrapStack(): void {
  for (let index = trapStack.length - 1; index >= 0; index -= 1) {
    const node = trapStack[index].container.current
    if (node && !node.isConnected) trapStack.splice(index, 1)
  }
}

function isTopOfStack(id: symbol): boolean {
  pruneTrapStack()
  return trapStack.length > 0 && trapStack[trapStack.length - 1].id === id
}

function focusElement(element: HTMLElement | null | undefined): void {
  if (!element) return
  try {
    element.focus({ preventScroll: true })
  } catch {
    element.focus()
  }
}

/**
 * 可聚焦元素还要「看得见」才算：display:none 的祖先、hidden、aria-hidden、disabled 都排除。
 * 注意 `offsetParent === null` 不能单独用 —— `position: fixed` 的元素 offsetParent 也是 null，
 * 直接用会把弹层里的 fixed 控件误杀，所以再用 getClientRects 兜一层。
 */
function isVisible(element: HTMLElement): boolean {
  if (element.hidden) return false
  if (element.getAttribute('aria-hidden') === 'true') return false
  if (element.closest('[inert]')) return false
  const style = window.getComputedStyle(element)
  if (style.display === 'none' || style.visibility === 'hidden') return false
  if (element.offsetParent === null && element.getClientRects().length === 0) return false
  return true
}

/** 弹层内当前可 Tab 的元素，按文档顺序。 */
export function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) =>
      !element.hasAttribute('disabled') &&
      element.tabIndex !== -1 &&
      isVisible(element),
  )
}

/**
 * 把焦点困在弹层里。
 *
 * @param open     弹层是否打开（打开时接管焦点，关闭时还原）
 * @param onClose  按 Esc 时调用；弹窗里**不要**再自己监听 window 的 Esc，否则会触发两次
 * @param options.initialFocus 打开后想先聚焦的元素（比如命令面板的输入框）。
 *        不传时：弹层根节点带 `tabindex`（通常 `-1`）就聚焦根节点，否则聚焦第一个可聚焦元素。
 * @returns 挂在弹层根节点上的 ref
 */
export function useFocusTrap(
  open: boolean,
  onClose: () => void,
  options: { initialFocus?: RefObject<HTMLElement | null> } = {},
): RefObject<HTMLDivElement | null> {
  const containerRef = useRef<HTMLDivElement>(null)
  // onClose 每次渲染都可能是新的箭头函数，用 ref 拿最新的，避免把它写进 effect 依赖后
  // 每渲染一次就重新捕获焦点、重新聚焦弹层。
  const onCloseRef = useRef(onClose)
  const initialFocusRef = useRef(options.initialFocus)

  // 这个 effect 每次都跑，且声明在主 effect 之前：主 effect 读到的一定是本次渲染的最新值
  useEffect(() => {
    onCloseRef.current = onClose
    initialFocusRef.current = options.initialFocus
  })

  useEffect(() => {
    if (!open) return

    const id = Symbol('focus-trap')
    // 打开前焦点在哪：关闭时还给它（触发按钮 / 搜索框）
    const previous =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    trapStack.push({ id, container: containerRef })

    const container = containerRef.current
    if (container) {
      // 优先 initialFocus；根节点自己可聚焦时先聚焦根节点（配合 aria-labelledby 让读屏先报弹层标题），
      // 最后才退到「第一个可聚焦元素」
      const target =
        initialFocusRef.current?.current ??
        (container.hasAttribute('tabindex') ? container : null) ??
        getFocusable(container)[0] ??
        container
      focusElement(target)
    }

    const onKeyDown = (event: KeyboardEvent) => {
      // 只有栈顶弹层处理键，嵌套/重叠时不会两个弹层一起动
      if (!isTopOfStack(id)) return

      if (event.key === 'Escape') {
        event.preventDefault()
        // 拦在 document 捕获阶段：别让背景里的全局快捷键（比如 Lead 在 window 上的监听）再响应一次
        event.stopPropagation()
        onCloseRef.current()
        return
      }

      if (event.key !== 'Tab') return

      const node = containerRef.current
      if (!node) return
      const focusables = getFocusable(node)
      if (focusables.length === 0) {
        // 弹层里没有可聚焦元素：焦点钉在容器上，别让 Tab 跑出去
        event.preventDefault()
        focusElement(node)
        return
      }

      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null
      const inside = active !== null && node.contains(active)

      if (event.shiftKey) {
        // 在第一个元素 / 容器自己 / 弹层外时，Shift+Tab 绕到最后一个
        if (!inside || active === first || active === node) {
          event.preventDefault()
          focusElement(last)
        }
        return
      }

      // 在最后一个元素 / 弹层外时，Tab 绕回第一个
      if (!inside || active === last) {
        event.preventDefault()
        focusElement(first)
      }
    }

    // 捕获阶段：抢在 window 上的全局快捷键之前处理 Esc / Tab
    document.addEventListener('keydown', onKeyDown, true)

    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      const index = trapStack.findIndex((entry) => entry.id === id)
      if (index >= 0) trapStack.splice(index, 1)
      // 焦点还原：触发元素还在文档里才还，不然就把焦点丢在 body 上（页面已经变了）
      const restore = () => {
        if (previous && previous.isConnected) focusElement(previous)
      }
      restore()
      // 点遮罩关闭时，浏览器处理 mousedown 的默认动作会把焦点挪到 body，
      // 覆盖掉上面那次还原。补一次，但只在焦点确实落在 body 上时才补 ——
      // 如果这期间又开了别的弹层（焦点已经在新弹层里），就别把焦点抢回去。
      window.setTimeout(() => {
        const active = document.activeElement
        if (active === null || active === document.body) restore()
      }, 0)
    }
  }, [open])

  return containerRef
}

/**
 * 当前有没有弹层打开。
 * App 层要屏蔽全局快捷键时可以先用它，拿不到 hook 的栈时再退回 `document.querySelector`。
 */
export function hasOpenOverlay(): boolean {
  pruneTrapStack()
  return trapStack.length > 0
}
