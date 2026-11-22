import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Moon, PanelLeftClose, PanelLeftOpen, Settings, Sun } from 'lucide-react'
import { useData } from '../lib/data'
import { modKey } from '../lib/platform'
import { useProgress } from '../lib/progress'
import { toggleThemeMode, useThemeState } from '../lib/theme'
import { streakOf } from './Heatmap'
import { SettingsModal } from './SettingsModal'

export function Topbar({
  onOpenPalette,
  sidebarIcon,
  onToggleSidebar,
}: {
  onOpenPalette: () => void
  sidebarIcon: boolean
  onToggleSidebar: () => void
}) {
  const { pathname } = useLocation()
  const { data } = useProgress()
  const { meta } = useData()
  const theme = useThemeState()
  const [settingsOpen, setSettingsOpen] = useState(false)
  // 今日页的「去备份」按钮通过自定义事件打开设置（不把状态提升到 App）
  useEffect(() => {
    const open = () => setSettingsOpen(true)
    window.addEventListener('lc:open-settings', open)
    return () => window.removeEventListener('lc:open-settings', open)
  }, [])
  const streak = streakOf(data.daily)

  const crumb = useMemo(() => {
    if (pathname === '/') return ['训练台', '今日']
    if (pathname.startsWith('/problems/')) return ['题库', '题目工作台']
    if (pathname.startsWith('/problems')) return ['训练台', '题库']
    if (pathname.startsWith('/tutorials/')) return ['教程', '阅读器']
    if (pathname.startsWith('/tutorials')) return ['训练台', '教程']
    if (pathname.startsWith('/review')) return ['训练台', '错题本']
    if (pathname.startsWith('/stats')) return ['训练台', '统计']
    return ['训练台', '']
  }, [pathname])

  return (
    <header className="topbar">
      <button
        className="icon-btn topbar__toggle"
        onClick={onToggleSidebar}
        aria-label={sidebarIcon ? '展开侧边栏' : '收起侧边栏'}
        title={sidebarIcon ? '展开侧边栏（Ctrl+B）' : '收起侧边栏（Ctrl+B）'}
      >
        {sidebarIcon ? <PanelLeftOpen /> : <PanelLeftClose />}
      </button>

      <div className="topbar__crumb">
        <span>{crumb[0]}</span>
        <span>/</span>
        <strong key={crumb[1]} className="fade">
          {crumb[1]}
        </strong>
      </div>

      <div className="topbar__spacer" />

      <button className="search-trigger" onClick={onOpenPalette}>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <span>搜索题目、教程章节…</span>
        <kbd>{modKey('K')}</kbd>
      </button>

      {streak > 0 ? (
        <div className="streak-pill" title="连续学习天数">
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            aria-hidden="true"
          >
            <path d="M12 2c1 4-3 5-3 9a3 3 0 0 0 6 0c0-1.5-.5-2.5-1-3 3 1.5 5 4 5 7a7 7 0 1 1-14 0c0-5 4-8 7-13Z" />
          </svg>
          <span>连续 {streak} 天</span>
        </div>
      ) : null}

      <span
        className="mono topbar__meta"
        title={`数据生成于 ${new Date(meta.generatedAt).toLocaleString('zh-CN')}`}
      >
        {meta.problemCount} 题
      </span>

      {/* 颜色模式：一键在深色 ↔ 浅色之间对调（三档选择在设置弹窗里） */}
      <button
        className="icon-btn"
        onClick={() => toggleThemeMode()}
        aria-label={theme.resolved === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
        title={
          theme.resolved === 'dark'
            ? `切换到浅色模式（当前：深色${theme.mode === 'auto' ? '，跟随系统' : ''}）`
            : `切换到深色模式（当前：浅色${theme.mode === 'auto' ? '，跟随系统' : ''}）`
        }
      >
        {theme.resolved === 'dark' ? <Sun /> : <Moon />}
      </button>

      <button
        className="icon-btn"
        onClick={() => setSettingsOpen(true)}
        aria-label="设置与数据"
        title="设置与数据"
      >
        <Settings />
      </button>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {/* 滚动进度：内容区滚到哪，这根线就走到哪 */}
      <div className="scroll-progress" aria-hidden="true">
        <span />
      </div>
    </header>
  )
}
