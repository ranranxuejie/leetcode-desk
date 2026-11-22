/**
 * 动效基础设施 · "Mechanical Keyboard Feel"
 * ---------------------------------------------------------------------------
 * 这里只放「跨页面复用」的动效原语，具体页面只负责组合。
 *
 *   <MotionProvider>   读取设置 + 系统偏好，决定 full / calm / off 三档
 *   <Reveal>           滚动触发（IntersectionObserver），配 data-stagger 做交错
 *   <Odometer>         数字滚动（一位一位滚过去）
 *   <Tip>              提示气泡（带小三角，portal 定位，不会被滚动容器裁掉）
 *   <Tabs>             标签切换 + 滑动指示条
 *   <Collapse> <PlusMinus>  折叠展开（手风琴）
 *   <PointerFx>        指针效果总成：自定义光标 / 拖尾 / 点阵背景 / 聚光灯 / 倾斜 / 磁吸
 *   useRipple()        点击涟漪
 *   useScrollProgress()  滚动进度 + 视差变量
 *   withViewTransition() 共享元素转场 / 布局过渡（View Transitions API）
 *
 * 术语索引见 docs/动效规范.md。
 */
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { createPortal } from 'react-dom'
import { useProgress } from './progress'
import { cn } from './utils'
import type { MotionLevel } from './types'

/* ========================================================================== *
 * 1. 动效档位
 * ========================================================================== */

const MotionContext = createContext<MotionLevel>('full')

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  })

  useEffect(() => {
    if (!window.matchMedia) return
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReduced(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  return reduced
}

/** 挂一次：把 full / calm / off 写到 <html data-motion>，CSS 和 JS 都读它 */
export function MotionProvider({ children }: { children: ReactNode }) {
  const { data } = useProgress()
  const reduced = usePrefersReducedMotion()
  const level: MotionLevel = reduced ? 'off' : data.settings.motion

  useEffect(() => {
    const root = document.documentElement
    root.dataset.motion = level
    return () => {
      delete root.dataset.motion
    }
  }, [level])

  return <MotionContext.Provider value={level}>{children}</MotionContext.Provider>
}

export function useMotionLevel(): MotionLevel {
  return useContext(MotionContext)
}

/* ========================================================================== *
 * 2. 滚动触发 + 交错
 * ========================================================================== */

type RevealTag = 'div' | 'section' | 'li' | 'article' | 'span' | 'header' | 'aside'

export function Reveal({
  as = 'div',
  delay = 0,
  index,
  className,
  style,
  children,
}: {
  as?: RevealTag
  /** 交错用的序号；给了就自动换算成延迟 */
  index?: number
  delay?: number
  className?: string
  style?: CSSProperties
  children?: ReactNode
}) {
  const ref = useRef<HTMLElement | null>(null)
  const [inView, setInView] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          setInView(true)
          observer.disconnect()
          return
        }
      },
      { rootMargin: '0px 0px -5% 0px', threshold: 0.01 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const mergedStyle = {
    '--reveal-delay': `${index === undefined ? delay : index * 55}ms`,
    ...style,
  } as CSSProperties

  return createElement(
    as,
    {
      ref,
      className,
      style: mergedStyle,
      'data-reveal': '',
      'data-in': inView ? 'true' : 'false',
    },
    children,
  )
}

/* ========================================================================== *
 * 3. 数字滚动（odometer）
 * ========================================================================== */

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']

/**
 * 一位一位滚过去的数字。首次挂载从 0 滚到目标值；
 * 之后数值变化时只有变化的那几位会动。
 */
export function Odometer({
  value,
  className,
  label,
}: {
  value: number | string
  className?: string
  /** 读屏用的完整文本，默认同 value */
  label?: string
}) {
  const text = String(value)
  const [armed, setArmed] = useState(false)

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setArmed(true))
    return () => window.cancelAnimationFrame(frame)
  }, [])

  return (
    <span className={cn('odo', className)} role="img" aria-label={label ?? text}>
      {Array.from(text).map((char, index) => {
        if (!/\d/.test(char)) {
          return (
            <span className="odo__static" aria-hidden="true" key={`s-${index}`}>
              {char}
            </span>
          )
        }
        return (
          <span className="odo__col" aria-hidden="true" key={`d-${index}`}>
            <span
              className="odo__strip"
              style={{ transform: `translateY(-${armed ? Number(char) : 0}em)` }}
            >
              {DIGITS.map((digit) => (
                <span key={digit}>{digit}</span>
              ))}
            </span>
          </span>
        )
      })}
    </span>
  )
}

/* ========================================================================== *
 * 4. 提示气泡（tooltip）
 * ========================================================================== */

export function Tip({
  content,
  children,
  className,
}: {
  content: ReactNode
  children: ReactNode
  className?: string
}) {
  const anchorRef = useRef<HTMLSpanElement | null>(null)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ x: number; y: number; placement: 'top' | 'bottom' } | null>(
    null,
  )

  const show = useCallback(() => {
    const el = anchorRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const placement: 'top' | 'bottom' = rect.top < 72 ? 'bottom' : 'top'
    setPos({
      x: rect.left + rect.width / 2,
      y: placement === 'top' ? rect.top - 8 : rect.bottom + 8,
      placement,
    })
    setOpen(true)
  }, [])

  const hide = useCallback(() => setOpen(false), [])

  return (
    <span
      ref={anchorRef}
      className={cn('tip-anchor', className)}
      tabIndex={0}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {open && pos
        ? createPortal(
            <div
              className="tip"
              role="tooltip"
              data-open="true"
              data-placement={pos.placement}
              style={{ left: pos.x, top: pos.y }}
            >
              {content}
            </div>,
            document.body,
          )
        : null}
    </span>
  )
}

/* ========================================================================== *
 * 5. 标签切换 + 滑动指示条
 * ========================================================================== */

export interface TabItem {
  key: string
  label: ReactNode
  count?: ReactNode
}

export function Tabs({
  items,
  value,
  onChange,
  className,
}: {
  items: TabItem[]
  value: string
  onChange: (key: string) => void
  className?: string
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [ink, setInk] = useState<{ x: number; width: number } | null>(null)

  useLayoutEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const measure = () => {
      const el = wrap.querySelector<HTMLElement>(`[data-tab-key="${value}"]`)
      if (!el) {
        setInk(null)
        return
      }
      setInk({ x: el.offsetLeft, width: el.offsetWidth })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(wrap)
    return () => observer.disconnect()
  }, [value, items.length])

  return (
    <div className={cn('tabs', className)} ref={wrapRef} role="tablist">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="tab"
          aria-selected={item.key === value}
          data-tab-key={item.key}
          className={cn('tab', item.key === value && 'active')}
          onClick={() => onChange(item.key)}
        >
          {item.label}
          {item.count === undefined || item.count === null ? null : (
            <span className="tab__count">{item.count}</span>
          )}
        </button>
      ))}
      <span
        className="tabs__ink"
        aria-hidden="true"
        style={{
          transform: `translateX(${ink?.x ?? 0}px)`,
          width: ink?.width ?? 0,
          opacity: ink ? 1 : 0,
        }}
      />
    </div>
  )
}

/* ========================================================================== *
 * 6. 折叠展开
 * ========================================================================== */

export function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div className="collapse" data-open={open ? 'true' : 'false'}>
      <div className="collapse__inner">{children}</div>
    </div>
  )
}

/** 加号 → 减号（两条横杠转 90°） */
export function PlusMinus({ open }: { open: boolean }) {
  return (
    <span className="pm" data-open={open ? 'true' : 'false'} aria-hidden="true">
      <i />
      <i />
    </span>
  )
}

/* ========================================================================== *
 * 7. 指针效果总成
 * ========================================================================== */

const SPOT_SELECTOR = [
  '.card:not(.continue-card)',
  '.stat',
  '.doc-card',
  '.review-card',
  '.an__card',
  '.example',
].join(',')

const TEXT_SELECTOR = [
  'input',
  'textarea',
  '[contenteditable="true"]',
  '.cm-editor',
  '.cm-content',
  '.note-area',
  '.term__input',
  '.palette__input',
].join(',')

const CLICK_SELECTOR = [
  'a',
  'button',
  '[role="button"]',
  '.chip',
  '.tab',
  '.nav-item',
  '.select',
  'select',
  '.sel__trigger',
  'label',
  'summary',
  '.status-dot',
  '.plan-add',
].join(',')

const GRID_GAP = 26

/**
 * 点阵底色：从 CSS 变量读，深浅主题各一份（`--dot-grid-ink`）。
 * 读不到就退回深色那份，别让 canvas 变成黑色实心。
 */
let dotInkCache = ''
function dotInk(): string {
  if (dotInkCache) return dotInkCache
  try {
    const value = getComputedStyle(document.documentElement)
      .getPropertyValue('--dot-grid-ink')
      .trim()
    dotInkCache = value || 'rgba(255, 255, 255, 0.06)'
  } catch {
    dotInkCache = 'rgba(255, 255, 255, 0.06)'
  }
  return dotInkCache
}
const GRID_RADIUS = 120
const GRID_PUSH = 15

export function PointerFx() {
  const level = useMotionLevel()
  return level === 'full' ? <PointerLayer /> : null
}

function PointerLayer() {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const dotRef = useRef<HTMLDivElement | null>(null)
  const ringRef = useRef<HTMLDivElement | null>(null)
  const labelRef = useRef<HTMLSpanElement | null>(null)
  const trailRef = useRef<HTMLCanvasElement | null>(null)
  const gridRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const root = rootRef.current
    const dot = dotRef.current
    const ring = ringRef.current
    const label = labelRef.current
    const trail = trailRef.current
    const grid = gridRef.current
    if (!root || !dot || !ring || !label || !trail || !grid) return
    if (!window.matchMedia('(pointer: fine)').matches) return

    const rootEl = document.documentElement
    rootEl.dataset.cursorFx = 'true'

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const tctx = trail.getContext('2d')
    const gctx = grid.getContext('2d')
    if (!tctx || !gctx) return

    let width = window.innerWidth
    let height = window.innerHeight

    /* ---- 画布尺寸 ---- */
    const resize = () => {
      width = window.innerWidth
      height = window.innerHeight
      for (const canvas of [trail, grid]) {
        canvas.width = Math.floor(width * dpr)
        canvas.height = Math.floor(height * dpr)
        canvas.style.width = `${width}px`
        canvas.style.height = `${height}px`
      }
      tctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      gctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      basePath = null
    }

    /* ---- 指针响应背景：一层很淡的点阵 ---- */
    let basePath: Path2D | null = null
    const drawGrid = () => {
      gctx.clearRect(0, 0, width, height)
      if (!basePath) {
        basePath = new Path2D()
        for (let x = GRID_GAP / 2; x < width; x += GRID_GAP) {
          for (let y = GRID_GAP / 2; y < height; y += GRID_GAP) {
            basePath.rect(x - 0.75, y - 0.75, 1.5, 1.5)
          }
        }
      }
      // 点阵颜色走令牌：深色是白色 6%，浅色是黑色 6%（见 tokens.css 的 --dot-grid-ink）
      gctx.fillStyle = dotInk()
      gctx.fill(basePath)
      if (influence < 0.01) return

      // 只重算鼠标附近那一小片：点被推开、变亮
      const x0 = Math.max(0, Math.floor((pointer.x - GRID_RADIUS) / GRID_GAP))
      const x1 = Math.min(Math.ceil(width / GRID_GAP), Math.ceil((pointer.x + GRID_RADIUS) / GRID_GAP))
      const y0 = Math.max(0, Math.floor((pointer.y - GRID_RADIUS) / GRID_GAP))
      const y1 = Math.min(
        Math.ceil(height / GRID_GAP),
        Math.ceil((pointer.y + GRID_RADIUS) / GRID_GAP),
      )
      for (let gx = x0; gx <= x1; gx += 1) {
        for (let gy = y0; gy <= y1; gy += 1) {
          const cx = gx * GRID_GAP + GRID_GAP / 2
          const cy = gy * GRID_GAP + GRID_GAP / 2
          const dx = cx - pointer.x
          const dy = cy - pointer.y
          const dist = Math.hypot(dx, dy)
          if (dist > GRID_RADIUS) continue
          const falloff = (1 - dist / GRID_RADIUS) * influence
          const push = falloff * falloff * GRID_PUSH
          const ux = dist === 0 ? 0 : dx / dist
          const uy = dist === 0 ? 0 : dy / dist
          const size = 1.5 + falloff * 1.6
          gctx.fillStyle = `rgba(245, 165, 36, ${(falloff * 0.62).toFixed(3)})`
          gctx.fillRect(
            cx + ux * push - size / 2,
            cy + uy * push - size / 2,
            size,
            size,
          )
        }
      }
    }

    /* ---- 光标拖尾 ---- */
    const TRAIL_LIFE = 360
    const points: { x: number; y: number; t: number }[] = []
    const drawTrail = (now: number) => {
      tctx.clearRect(0, 0, width, height)
      while (points.length && now - points[0].t > TRAIL_LIFE) points.shift()
      if (points.length < 2) return
      tctx.globalCompositeOperation = 'lighter'
      tctx.lineCap = 'round'
      for (let i = 1; i < points.length; i += 1) {
        const a = points[i - 1]
        const b = points[i]
        const age = Math.min(1, (now - b.t) / TRAIL_LIFE)
        tctx.strokeStyle = `rgba(245, 165, 36, ${((1 - age) * 0.42).toFixed(3)})`
        tctx.lineWidth = Math.max(0.5, (1 - age) * 8)
        tctx.beginPath()
        tctx.moveTo(a.x, a.y)
        tctx.lineTo(b.x, b.y)
        tctx.stroke()
      }
      tctx.globalCompositeOperation = 'source-over'
    }

    /* ---- 状态 ---- */
    const pointer = { x: width / 2, y: height / 2 }
    let ringPos = { x: pointer.x, y: pointer.y }
    let influence = 0
    let targetInfluence = 0
    let visible = false
    let mode = 'default'
    let raf = 0
    let lastMoveAt = 0
    let spotEl: HTMLElement | null = null
    let tiltEl: HTMLElement | null = null
    let magEl: HTMLElement | null = null

    const setMode = (next: string) => {
      if (next === mode) return
      mode = next
      root.dataset.mode = next
    }

    const resetEl = (el: HTMLElement | null, vars: string[]) => {
      if (!el) return
      for (const name of vars) el.style.removeProperty(name)
    }

    const frame = (now: number) => {
      raf = 0
      // 停下 90ms 后，点阵的影响半径收回 —— 被推开的点自己弹回去
      if (now - lastMoveAt > 90) targetInfluence = 0

      // 圆圈慢半拍跟过来
      ringPos.x += (pointer.x - ringPos.x) * 0.24
      ringPos.y += (pointer.y - ringPos.y) * 0.24
      if (Math.abs(pointer.x - ringPos.x) < 0.15) ringPos.x = pointer.x
      if (Math.abs(pointer.y - ringPos.y) < 0.15) ringPos.y = pointer.y

      influence += (targetInfluence - influence) * 0.18
      if (influence < 0.005) influence = 0

      dot.style.transform = `translate3d(${pointer.x}px, ${pointer.y}px, 0)`
      ring.style.transform = `translate3d(${ringPos.x}px, ${ringPos.y}px, 0)`

      drawTrail(now)
      if (influence > 0 || targetInfluence > 0) drawGrid()

      const busy =
        points.length > 0 ||
        Math.abs(pointer.x - ringPos.x) > 0.2 ||
        Math.abs(pointer.y - ringPos.y) > 0.2 ||
        influence > 0
      if (busy) raf = window.requestAnimationFrame(frame)
    }

    const kick = () => {
      if (!raf) raf = window.requestAnimationFrame(frame)
    }

    const onMove = (event: PointerEvent) => {
      pointer.x = event.clientX
      pointer.y = event.clientY
      lastMoveAt = performance.now()
      if (!visible) {
        visible = true
        root.dataset.visible = 'true'
        ringPos = { x: pointer.x, y: pointer.y }
      }
      points.push({ x: pointer.x, y: pointer.y, t: performance.now() })
      if (points.length > 64) points.shift()
      targetInfluence = 1
      kick()

      const target = event.target instanceof Element ? event.target : null

      // 光标形态
      if (!target) setMode('default')
      else if (target.closest(TEXT_SELECTOR)) setMode('text')
      else {
        const labelled = target.closest<HTMLElement>('[data-cursor]')
        if (labelled) {
          const text = labelled.dataset.cursor ?? ''
          if (label.textContent !== text) label.textContent = text
          setMode('label')
        } else if (target.closest(CLICK_SELECTOR)) setMode('interactive')
        else setMode('default')
      }

      // 聚光灯
      const nextSpot = target?.closest<HTMLElement>(SPOT_SELECTOR) ?? null
      if (nextSpot !== spotEl) {
        resetEl(spotEl, ['--mx', '--my'])
        spotEl = nextSpot
      }
      if (spotEl) {
        const rect = spotEl.getBoundingClientRect()
        spotEl.style.setProperty('--mx', `${event.clientX - rect.left}px`)
        spotEl.style.setProperty('--my', `${event.clientY - rect.top}px`)
      }

      // 倾斜
      const nextTilt = target?.closest<HTMLElement>('[data-tilt]') ?? null
      if (nextTilt !== tiltEl) {
        resetEl(tiltEl, ['--tilt-x', '--tilt-y'])
        tiltEl = nextTilt
      }
      if (tiltEl) {
        const rect = tiltEl.getBoundingClientRect()
        const nx = (event.clientX - rect.left) / Math.max(1, rect.width) - 0.5
        const ny = (event.clientY - rect.top) / Math.max(1, rect.height) - 0.5
        tiltEl.style.setProperty('--tilt-x', `${(-ny * 5).toFixed(2)}deg`)
        tiltEl.style.setProperty('--tilt-y', `${(nx * 5).toFixed(2)}deg`)
        tiltEl.style.setProperty('--mx', `${event.clientX - rect.left}px`)
        tiltEl.style.setProperty('--my', `${event.clientY - rect.top}px`)
      }

      // 磁吸
      const nextMag = target?.closest<HTMLElement>('[data-magnetic]') ?? null
      if (nextMag !== magEl) {
        resetEl(magEl, ['--mag-x', '--mag-y'])
        magEl = nextMag
      }
      if (magEl) {
        const rect = magEl.getBoundingClientRect()
        const dx = event.clientX - (rect.left + rect.width / 2)
        const dy = event.clientY - (rect.top + rect.height / 2)
        magEl.style.setProperty('--mag-x', `${Math.max(-5, Math.min(5, dx * 0.18)).toFixed(2)}px`)
        magEl.style.setProperty('--mag-y', `${Math.max(-4, Math.min(4, dy * 0.18)).toFixed(2)}px`)
      }
    }

    const onLeave = () => {
      visible = false
      targetInfluence = 0
      root.dataset.visible = 'false'
      resetEl(spotEl, ['--mx', '--my'])
      resetEl(tiltEl, ['--tilt-x', '--tilt-y'])
      resetEl(magEl, ['--mag-x', '--mag-y'])
      spotEl = null
      tiltEl = null
      magEl = null
      kick()
    }

    const onDown = () => {
      root.dataset.press = 'true'
      window.setTimeout(() => {
        root.dataset.press = 'false'
      }, 180)
    }

    const onResize = () => {
      resize()
      drawGrid()
    }

    resize()
    drawGrid()
    window.addEventListener('resize', onResize)
    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('pointerdown', onDown, { passive: true })
    document.addEventListener('pointerleave', onLeave)
    window.addEventListener('blur', onLeave)

    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerdown', onDown)
      document.removeEventListener('pointerleave', onLeave)
      window.removeEventListener('blur', onLeave)
      if (raf) window.cancelAnimationFrame(raf)
      delete rootEl.dataset.cursorFx
      resetEl(spotEl, ['--mx', '--my'])
      resetEl(tiltEl, ['--tilt-x', '--tilt-y'])
      resetEl(magEl, ['--mag-x', '--mag-y'])
    }
  }, [])

  return (
    <>
      <canvas className="dot-grid" ref={gridRef} aria-hidden="true" />
      <div className="cursor-fx" ref={rootRef} data-visible="false" aria-hidden="true">
        <canvas className="cursor-fx__trail" ref={trailRef} />
        <div className="cursor-fx__ring" ref={ringRef}>
          <span className="cursor-fx__label" ref={labelRef} />
        </div>
        <div className="cursor-fx__dot" ref={dotRef} />
      </div>
    </>
  )
}

/* ========================================================================== *
 * 8. 点击涟漪
 * ========================================================================== */

export function useRipple() {
  const level = useMotionLevel()

  useEffect(() => {
    if (level === 'off') return
    const onDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return
      const button = target.closest<HTMLElement>('.btn')
      if (!button || button.hasAttribute('disabled')) return
      const rect = button.getBoundingClientRect()
      const size = Math.max(rect.width, rect.height) * 2.4
      const ripple = document.createElement('span')
      ripple.className = 'btn__ripple'
      ripple.style.width = `${size}px`
      ripple.style.height = `${size}px`
      ripple.style.left = `${event.clientX - rect.left - size / 2}px`
      ripple.style.top = `${event.clientY - rect.top - size / 2}px`
      button.appendChild(ripple)
      window.setTimeout(() => ripple.remove(), 680)
    }
    document.addEventListener('pointerdown', onDown, { passive: true })
    return () => document.removeEventListener('pointerdown', onDown)
  }, [level])
}

/* ========================================================================== *
 * 9. 滚动进度 + 视差
 * ========================================================================== */

export function useScrollProgress() {
  useEffect(() => {
    const scroller = document.querySelector<HTMLElement>('.main')
    if (!scroller) return
    // 关键：变量只写在顶栏（它的子树里才用到 --scroll-pct）。
    // 如果写在 documentElement 上，全量题库 4500 行 / 10 万节点会在每帧重算样式，
    // 滚动时直接掉到 1fps。
    const bar = document.querySelector<HTMLElement>('.topbar')
    let raf = 0
    let lastPct = -1
    let lastY = -1
    const apply = () => {
      raf = 0
      const top = scroller.scrollTop
      const max = scroller.scrollHeight - scroller.clientHeight
      const pct = max > 0 ? Math.min(1, Math.max(0, top / max)) : 0
      if (Math.abs(pct - lastPct) > 0.0008) {
        lastPct = pct
        bar?.style.setProperty('--scroll-pct', pct.toFixed(4))
      }
      // 视差：只动今日页那张小卡，不走全局 CSS 变量
      if (Math.abs(top - lastY) > 2) {
        lastY = top
        const hero = document.querySelector<HTMLElement>('.hero__side')
        if (hero) hero.style.translate = `0 ${Math.round(top * 0.06)}px`
      }
    }
    const schedule = () => {
      if (!raf) raf = window.requestAnimationFrame(apply)
    }
    apply()
    scroller.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      scroller.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      if (raf) window.cancelAnimationFrame(raf)
    }
  }, [])
}

/* ========================================================================== *
 * 10. 共享元素转场 / 布局过渡
 * ========================================================================== */

type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void) => {
    finished: Promise<void>
    ready: Promise<void>
    updateCallbackDone: Promise<void>
  }
}

/**
 * 转场进行中的标记。Shell 会在渲染时读它一次（按 location.key 记忆），
 * 决定这一页要不要播自己的入场动画 —— 否则「新快照」会拍到 opacity:0 的第一帧。
 */
let vtActive = false

export function isViewTransitionActive(): boolean {
  return vtActive
}

/** 用 View Transitions API 包一层状态更新；不支持时直接执行 */
export function withViewTransition(run: () => void) {
  const doc = document as ViewTransitionDocument
  if (typeof doc.startViewTransition !== 'function') {
    run()
    return
  }
  if (document.documentElement.dataset.motion === 'off') {
    run()
    return
  }
  try {
    vtActive = true
    const transition = doc.startViewTransition(() => {
      flushSync(run)
    })
    // 浏览器可能因为「上一次转场还没结束」把这次取消掉，吞掉 rejection 免得控制台报错
    void transition.finished
      .catch(() => {})
      .then(() => {
        vtActive = false
      })
  } catch {
    vtActive = false
    run()
  }
}
