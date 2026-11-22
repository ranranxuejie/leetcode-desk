import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { BarChart3, BookOpen, Home, Library, RotateCcw } from 'lucide-react'
import { useData } from '../lib/data'
import { useProgress } from '../lib/progress'
import { isDue } from '../lib/utils'
import { loadUiNumber, saveUiNumber } from '../lib/ui'
import { Odometer } from '../lib/motion'
import { Splitter } from './Splitter'
import { streakOf } from './Heatmap'

const NAV = [
  { to: '/', label: '今日', icon: Home, end: true },
  { to: '/problems', label: '题库', icon: Library },
  { to: '/tutorials', label: '教程', icon: BookOpen },
  { to: '/review', label: '错题本', icon: RotateCcw },
  { to: '/stats', label: '统计', icon: BarChart3 },
]

export function Sidebar() {
  const { problems, tutorials } = useData()
  const { data } = useProgress()
  const { pathname } = useLocation()
  // 总进度只算精选题（学习路线 365 道）；全量题库的题数只作为导航上的总量显示
  const curated = problems.filter((p) => p.curated)
  const solved = curated.filter((p) => data.problems[p.no]?.status === 'done').length
  const wrong = problems.filter((p) => data.problems[p.no]?.wrong)
  const due = wrong.filter((p) => isDue(data.problems[p.no])).length
  const streak = streakOf(data.daily)
  const pct = curated.length ? (solved / curated.length) * 100 : 0

  // 导航指示条：跟着当前页滑过去，而不是每个 item 各自闪一下
  const navRef = useRef<HTMLElement | null>(null)
  const [ink, setInk] = useState<{ y: number; height: number } | null>(null)

  // 侧边栏宽度可拖（双击复位）
  const [width, setWidth] = useState(() => loadUiNumber('sidebar.width', 244))
  const resize = (clientX: number) => {
    if (clientX < 0) {
      setWidth(244)
      saveUiNumber('sidebar.width', 244)
      return
    }
    const next = Math.max(200, Math.min(380, Math.round(clientX)))
    setWidth(next)
    saveUiNumber('sidebar.width', next)
  }

  useLayoutEffect(() => {
    const nav = navRef.current
    if (!nav) return
    const measure = () => {
      const active = nav.querySelector<HTMLElement>('.nav-item.active')
      if (!active) {
        setInk(null)
        return
      }
      setInk({ y: active.offsetTop + (active.offsetHeight - 18) / 2, height: 18 })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(nav)
    return () => observer.disconnect()
  }, [pathname])

  // 数据量变化时重新量一次（计数徽章会把行高撑开一点点）
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const nav = navRef.current
      const active = nav?.querySelector<HTMLElement>('.nav-item.active')
      if (active) setInk({ y: active.offsetTop + (active.offsetHeight - 18) / 2, height: 18 })
    }, 60)
    return () => window.clearTimeout(timer)
  }, [problems.length, tutorials.length, due])

  return (
    <aside className="sidebar" style={{ '--sidebar-w': `${width}px` } as CSSProperties}>
      <Splitter
        orientation="vertical"
        className="splitter--sidebar"
        onResize={resize}
        label="拖动调整侧边栏宽度（双击复位）"
      />
      <div className="sidebar__brand">
        <div className="seal">题</div>
        <div>
          <div className="brand__name">LeetCode 训练台</div>
          <div className="brand__sub">Huawei · 2026</div>
        </div>
      </div>

      <nav className="sidebar__nav" aria-label="主导航" ref={navRef}>
        <div className="nav-label">工作台</div>
        <span
          className="nav-ink"
          aria-hidden="true"
          style={{
            transform: `translateY(${ink?.y ?? 0}px)`,
            height: ink?.height ?? 18,
            opacity: ink ? 1 : 0,
          }}
        />
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
          >
            <Icon />
            <span>{label}</span>
            {to === '/problems' ? (
              <span className="nav-item__count">
                <Odometer value={problems.length} />
              </span>
            ) : null}
            {to === '/tutorials' ? (
              <span className="nav-item__count">
                <Odometer value={tutorials.length} />
              </span>
            ) : null}
            {to === '/review' && due > 0 ? (
              <span className="nav-item__count">
                <Odometer value={due} />
              </span>
            ) : null}
          </NavLink>
        ))}
      </nav>

      <div className="sidebar__foot">
        <div className="mini-progress__head">
          <span>路线进度</span>
          <span className="mini-progress__value">
            <Odometer value={solved} />
            <span className="mini-progress__total">
              {' '}
              / <Odometer value={curated.length} />
            </span>
          </span>
        </div>
        <div className="mini-progress__track">
          <div className="mini-progress__fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="sidebar__note">
          {streak > 0 ? `连续学习 ${streak} 天 · ` : ''}
          错题 {wrong.length} 道
        </div>
      </div>
    </aside>
  )
}
