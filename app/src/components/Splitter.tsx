import { useState } from 'react'
import { cn } from '../lib/utils'

/**
 * 分栏拖拽手柄。
 *
 * 用 pointer capture 实现：按下时把后续 pointermove 都收给手柄自己，
 * 这样鼠标拖出手柄范围（甚至拖到 iframe / 编辑器上）也不会中断。
 *
 * - `vertical`：一条竖线，左右分栏（拖的是 x）
 * - `horizontal`：一条横线，上下分栏（拖的是 y）
 */
export function Splitter({
  orientation,
  onResize,
  label,
  className,
}: {
  orientation: 'vertical' | 'horizontal'
  /** 拖动时回调指针坐标（vertical 给 clientX，horizontal 给 clientY） */
  onResize: (position: number) => void
  label: string
  className?: string
}) {
  const [active, setActive] = useState(false)

  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation={orientation === 'vertical' ? 'vertical' : 'horizontal'}
      title={label}
      className={cn('splitter', `splitter--${orientation}`, active && 'is-active', className)}
      onPointerDown={(event) => {
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        setActive(true)
      }}
      onPointerMove={(event) => {
        if (!active) return
        onResize(orientation === 'vertical' ? event.clientX : event.clientY)
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId)
        }
        setActive(false)
      }}
      onPointerCancel={() => setActive(false)}
      onDoubleClick={() => onResize(-1)}
    >
      <span className="splitter__grip" aria-hidden="true" />
    </div>
  )
}
