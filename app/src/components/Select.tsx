/**
 * 自绘下拉 · Select
 * ---------------------------------------------------------------------------
 * 原生 <select> 收起时还能用 CSS 化妆，但**展开后的选项列表是操作系统画的**：
 * Windows 上是一块浅灰白底、方角、系统字体的浮层，和「石墨 + 琥珀」这套深色
 * 精装界面差得最远 —— 用户说的「格格不入」主要就指这个。
 *
 * 所以这里把两半都自己做掉：
 *
 *   触发器  按钮，尺寸/描边/底色/字号和原来的 .select 逐项对齐
 *           （高 --h-md / sm --h-sm、--r-md、--bg-surface-3、1px --border-subtle），
 *           系统箭头换成会旋转的 chevron 图标。
 *   弹层    createPortal 到 body 的 position: fixed 浮层，按触发器矩形定位，
 *           父容器的 overflow: hidden / transform 裁不到它；滚动、缩放时跟着触发器走；
 *           空间不够时向上翻、横向夹进视口；超过 320px 内部滚动。
 *
 * 键盘模型：**焦点始终留在触发器上**，用 aria-activedescendant 指认当前项。
 * 这样不用做焦点陷阱、不用管「弹层里的 Tab 顺序」，Esc 后焦点天然就在触发器上
 * （见下面 onTriggerKeyDown 的注释）。
 *
 * 取色只用 tokens.css 的语义令牌，浅色主题上线时自动跟随，不写任何色值。
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'
import { cn } from '../lib/utils'
import '../styles/select.css'

export interface SelectOption<T extends string> {
  value: T
  label: string
  /** 右侧的次要说明（可省略） */
  hint?: string
  /** 右侧的计数（专题下拉用），等宽数字右对齐 */
  count?: number
}

export interface SelectProps<T extends string> {
  value: T
  options: SelectOption<T>[]
  onChange: (value: T) => void
  /** 触发器与 listbox 的无障碍名（对应原生 select 的 aria-label） */
  ariaLabel: string
  size?: 'sm' | 'md'
  /** 弹层靠触发器左缘还是右缘对齐（靠页面右边的控件用 end，免得弹出屏幕） */
  align?: 'start' | 'end'
  className?: string
}

/** 弹层与触发器之间的缝隙 */
const GAP = 6
/** 弹层与视口边缘的最小留白 */
const EDGE = 8
/** 弹层最大高度：和 select.css 的 max-height 一致（专题有 30+ 项，必须内部滚动） */
const MENU_MAX_HEIGHT = 320
/** 下方空间不足这个高度时，优先向上弹 */
const MENU_MIN_HEIGHT = 160

interface MenuPos {
  style: CSSProperties
  placement: 'top' | 'bottom'
}

export function Select<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  size = 'md',
  align = 'start',
  className,
}: SelectProps<T>): ReactElement {
  const baseId = useId()
  const listId = `${baseId}-listbox`
  const optionId = (index: number) => `${baseId}-opt-${index}`

  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [pos, setPos] = useState<MenuPos | null>(null)

  const selectedIndex = options.findIndex((option) => option.value === value)
  const current = selectedIndex >= 0 ? options[selectedIndex] : undefined
  // 选项列表在展开期间可能变短（外部筛选联动），把游标夹回合法区间
  const active =
    options.length === 0 ? -1 : Math.min(Math.max(activeIndex, 0), options.length - 1)

  /**
   * 按触发器的当前矩形算弹层位置。
   * 竖向：下方放不下 MENU_MIN_HEIGHT 且上方更宽裕 → 向上弹；
   * 横向：start 贴左缘、end 贴右缘，越界的部分由下面的 useLayoutEffect 夹回来。
   */
  const place = useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const vh = window.innerHeight
    const vw = window.innerWidth
    // 触发器整块滚出视口：弹层没有存在意义，收起来（不然会留一块飘着的浮层）
    if (rect.bottom < 0 || rect.top > vh) {
      setOpen(false)
      return
    }
    const spaceBelow = vh - rect.bottom - GAP - EDGE
    const spaceAbove = rect.top - GAP - EDGE
    const placement: 'top' | 'bottom' =
      spaceBelow < MENU_MIN_HEIGHT && spaceAbove > spaceBelow ? 'top' : 'bottom'
    const maxHeight = Math.max(
      MENU_MIN_HEIGHT,
      Math.min(MENU_MAX_HEIGHT, placement === 'bottom' ? spaceBelow : spaceAbove),
    )
    const style: CSSProperties = { minWidth: rect.width, maxHeight }
    if (placement === 'bottom') style.top = rect.bottom + GAP
    else style.bottom = vh - rect.top + GAP
    if (align === 'end') style.right = Math.max(EDGE, vw - rect.right)
    else style.left = Math.max(EDGE, rect.left)
    setPos({ style, placement })
  }, [align])

  /** 打开弹层；index 不传时落在当前选中项（Home/End 会显式传首/末项） */
  const openMenu = useCallback(
    (index?: number) => {
      if (!options.length) return
      place()
      setActiveIndex(index ?? (selectedIndex >= 0 ? selectedIndex : 0))
      setOpen(true)
    },
    [place, options.length, selectedIndex],
  )

  const close = useCallback((focusTrigger = false) => {
    setOpen(false)
    if (focusTrigger) triggerRef.current?.focus()
  }, [])

  const commit = useCallback(
    (index: number) => {
      const option = options[index]
      if (option && option.value !== value) onChange(option.value)
      close(true)
    },
    [close, onChange, options, value],
  )

  /* ---- 打开后：横向夹进视口（弹层常常比触发器宽，靠右的控件会被推出屏幕） ---- */
  useLayoutEffect(() => {
    if (!open) return
    const menu = menuRef.current
    if (!menu) return
    menu.style.marginLeft = '0px'
    const rect = menu.getBoundingClientRect()
    const vw = window.innerWidth
    let dx = 0
    if (rect.right > vw - EDGE) dx = vw - EDGE - rect.right
    if (rect.left + dx < EDGE) dx = EDGE - rect.left
    // 直接改 style 而不是 setState：这是「量完再夹」的一次性修正，重渲染反而会闪
    if (dx !== 0) menu.style.marginLeft = `${dx}px`
  }, [open, pos])

  /* ---- 打开后 / 键盘移动后：当前项滚进可视区（专题列表 30+ 项，选中项常在深处） ---- */
  useLayoutEffect(() => {
    if (!open) return
    const menu = menuRef.current
    if (!menu) return
    const activeEl = menu.querySelector<HTMLElement>('[data-active="true"]')
    activeEl?.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  /* ---- 点击外部关闭：pointerdown 比 click 早，点别的控件时不会先闪一下 ---- */
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (rootRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      close()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [close, open])

  /* ---- 滚动 / 缩放跟随：capture 才能收到 .main 这类内部滚动容器的 scroll ---- */
  useEffect(() => {
    if (!open) return
    const onMove = (event: Event) => {
      // 弹层自己内部的滚动不算，否则滚选项时位置会抖
      const menu = menuRef.current
      if (
        event.type === 'scroll' &&
        menu &&
        event.target instanceof Node &&
        menu.contains(event.target)
      ) {
        return
      }
      place()
    }
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    return () => {
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('resize', onMove)
    }
  }, [open, place])

  const onTriggerClick = () => {
    if (open) close()
    else openMenu()
  }

  const onTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const key = event.key

    if (!open) {
      // 收起态：↑/↓ 展开并落在当前项上，Home/End 直接落到首/末项；
      // Enter / Space 不在这里处理 —— 交给按钮原生 click（避免 keydown + click 各开一次）
      if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Home' || key === 'End') {
        event.preventDefault()
        const index =
          key === 'Home' ? 0 : key === 'End' ? options.length - 1 : selectedIndex >= 0 ? selectedIndex : 0
        openMenu(index)
      }
      return
    }

    switch (key) {
      case 'ArrowDown':
        event.preventDefault()
        setActiveIndex(Math.min(active + 1, options.length - 1))
        break
      case 'ArrowUp':
        event.preventDefault()
        setActiveIndex(Math.max(active - 1, 0))
        break
      case 'Home':
        event.preventDefault()
        setActiveIndex(0)
        break
      case 'End':
        event.preventDefault()
        setActiveIndex(options.length - 1)
        break
      case 'Enter':
      case ' ':
        // 展开态才接管 Enter/Space：此时「回车」的语义是选中当前项，不是再关一次
        event.preventDefault()
        commit(active)
        break
      case 'Escape':
        event.preventDefault()
        close(true)
        break
      case 'Tab':
        // 不 preventDefault：让焦点照常移到下一个控件，只把弹层收掉
        close()
        break
      default:
        break
    }
  }

  return (
    <div
      ref={rootRef}
      className={cn('sel', size === 'sm' && 'sel--sm', open && 'is-open', className)}
    >
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
        aria-label={ariaLabel}
        className="sel__trigger"
        onClick={onTriggerClick}
        onKeyDown={onTriggerKeyDown}
      >
        <span className="sel__value">{current?.label ?? ''}</span>
        <ChevronDown className="sel__chev" aria-hidden="true" />
      </button>

      {open && pos
        ? createPortal(
            <div
              ref={menuRef}
              id={listId}
              role="listbox"
              aria-label={ariaLabel}
              className="sel__menu"
              data-placement={pos.placement}
              style={pos.style}
            >
              {options.map((option, index) => (
                <div
                  key={option.value}
                  id={optionId(index)}
                  role="option"
                  aria-selected={option.value === value}
                  data-active={index === active ? 'true' : undefined}
                  className={cn(
                    'sel__opt',
                    index === active && 'is-active',
                    option.value === value && 'is-selected',
                  )}
                  // 用 pointerdown 而不是 click：按下即选中（和原生一致），
                  // 同时 preventDefault 阻止焦点离开触发器 —— 焦点一跑，
                  // aria-activedescendant 的键盘模型就断了。
                  onPointerDown={(event) => {
                    event.preventDefault()
                    commit(index)
                  }}
                  // 鼠标划过时把「当前项」同步过去，回车 / 键盘接着从这里走
                  onPointerEnter={() => {
                    if (index !== active) setActiveIndex(index)
                  }}
                >
                  <span className="sel__opt-label">{option.label}</span>
                  {option.hint ? <span className="sel__opt-hint">{option.hint}</span> : null}
                  {typeof option.count === 'number' ? (
                    <span className="sel__opt-count">{option.count}</span>
                  ) : null}
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
