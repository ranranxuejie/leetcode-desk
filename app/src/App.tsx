import { useEffect, useMemo, useState } from 'react'
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom'
import { DataProvider } from './lib/data'
import { ProgressProvider } from './lib/progress'
import { ToastProvider } from './lib/toast'
import { loadUiFlag, saveUiFlag } from './lib/ui'
import { applyTheme, loadThemeMode } from './lib/theme'
import {
  MotionProvider,
  PointerFx,
  isViewTransitionActive,
  useRipple,
  useScrollProgress,
} from './lib/motion'
import { Sidebar } from './components/Sidebar'
import { Topbar } from './components/Topbar'
import { CommandPalette } from './components/CommandPalette'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ShortcutsModal } from './components/ShortcutsModal'
import { TitleBar } from './components/TitleBar'
import { inShell } from './lib/shell'
import { CrashCard } from './components/CrashCard'
import { Today } from './pages/Today'
import { Problems } from './pages/Problems'
import { ProblemDetail } from './pages/ProblemDetail'
import { Tutorials } from './pages/Tutorials'
import { TutorialReader } from './pages/TutorialReader'
import { Review } from './pages/Review'
import { Stats } from './pages/Stats'

function Shell() {
  const location = useLocation()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const fixed = /^\/problems\/[^/]+/.test(location.pathname)
  // 侧边栏收起成图标条：个人偏好，存在 lc.ui.*，不影响学习进度
  const [sidebarIcon, setSidebarIcon] = useState(() => loadUiFlag('sidebar.icon'))

  // 点击涟漪（全局一处监听）+ 滚动进度/视差变量
  useRipple()
  useScrollProgress()

  // 颜色模式：首屏已由 index.html 的内联脚本设好（防闪），这里只按偏好再确认一次，
  // 顺便挂上「跟随系统」的监听。切换走 lib/theme.ts，别的地方不要直接写 data-theme。
  useEffect(() => {
    applyTheme(loadThemeMode())
  }, [])

  useEffect(() => {
    saveUiFlag('sidebar.icon', sidebarIcon)
  }, [sidebarIcon])

  // 这一页是不是由共享元素转场送进来的：是的话就不再播入场动画（否则会和转场双重淡入）。
  // 按 location.key 记忆，避免无关的重渲染把属性摘掉、让动画从头再播一遍。
  const noEnter = useMemo(() => isViewTransitionActive(), [location.key])

  useEffect(() => {
    /** 有弹层打开时，全局快捷键要让位（否则设置弹窗上还能再开命令面板） */
    const overlayOpen = () =>
      Boolean(document.querySelector('.modal-backdrop, .palette-backdrop, .shortcuts-backdrop'))
    /** 正在输入框里打字时不抢按键 */
    const typing = (target: EventTarget | null) => {
      const el = target as HTMLElement | null
      if (!el) return false
      return (
        el.tagName === 'INPUT' ||
        el.tagName === 'TEXTAREA' ||
        el.tagName === 'SELECT' ||
        el.isContentEditable
      )
    }

    const onKey = (event: KeyboardEvent) => {
      // ? 打开/关闭快捷键总览：再按一次要能关，所以不能把 shortcuts 弹层算进屏蔽条件
      if (event.key === '?' && !typing(event.target)) {
        if (document.querySelector('.modal-backdrop, .palette-backdrop')) return
        event.preventDefault()
        setShortcutsOpen((value) => !value)
        return
      }
      if (overlayOpen()) return
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen((value) => !value)
        return
      }
      // Ctrl/Cmd + B：收起 / 展开侧边栏
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'b') {
        event.preventDefault()
        setSidebarIcon((value) => !value)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    const titles: Record<string, string> = {
      '/': '今日',
      '/problems': '题库',
      '/tutorials': '教程',
      '/review': '错题本',
      '/stats': '统计',
    }
    const base = Object.entries(titles).find(([path]) =>
      path === '/' ? location.pathname === '/' : location.pathname.startsWith(path),
    )?.[1]
    // 自绘标题栏里已经显示页面名，窗口标题就固定成应用名，避免两处重复
    document.title = inShell()
      ? 'LeetCode 训练台'
      : base
        ? `${base} · LeetCode 训练台`
        : 'LeetCode 训练台'
    document.querySelector('.main')?.scrollTo(0, 0)
  }, [location.pathname])

  return (
    <div
      className={inShell() ? 'app app--shell' : 'app'}
      data-sidebar={sidebarIcon ? 'icon' : 'full'}
    >
      {inShell() ? <TitleBar /> : null}
      <Sidebar />
      <div className="workspace">
        <Topbar
          onOpenPalette={() => setPaletteOpen(true)}
          sidebarIcon={sidebarIcon}
          onToggleSidebar={() => setSidebarIcon((value) => !value)}
        />
        <main
          className={`main${fixed ? ' main--fixed' : ''}`}
          data-no-enter={noEnter ? 'true' : undefined}
        >
          <ErrorBoundary
            resetKeys={[location.key]}
            fallback={(error, reset) => <CrashCard error={error} onRetry={reset} />}
          >
            <Routes>
            <Route path="/" element={<Today />} />
            <Route path="/problems" element={<Problems />} />
            <Route path="/problems/:no" element={<ProblemDetail />} />
            <Route path="/tutorials" element={<Tutorials />} />
            <Route path="/tutorials/:id" element={<TutorialReader />} />
            <Route path="/review" element={<Review />} />
            <Route path="/stats" element={<Stats />} />
            <Route
              path="*"
              element={
                <div className="page">
                  <div className="empty" style={{ paddingTop: 120 }}>
                    <div className="empty__mark">404</div>
                    <h2>这页还没写</h2>
                    <p>回到今日，继续刷题。</p>
                  </div>
                </div>
              }
            />
          </Routes>
          </ErrorBoundary>
        </main>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <ShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  )
}

/**
 * 进度存在浏览器 localStorage 里，而 localStorage 按「协议 + 主机 + 端口」隔离。
 * 用 localhost 打开会看不到 127.0.0.1 下积累的进度，看起来就像「进度没了」。
 * 这里在「本机地址 + 当前 origin 没有任何进度」时提示一句，避免再踩坑。
 */
function OriginHint() {
  const [dismissed, setDismissed] = useState(false)
  const [show, setShow] = useState(false)
  const host = window.location.hostname

  useEffect(() => {
    const isLoopbackAlias = host === 'localhost' || host === '::1'
    if (!isLoopbackAlias) return
    const raw = window.localStorage.getItem('lc.progress.v1')
    if (raw && raw.length > 80) return
    setShow(true)
  }, [host])

  if (!show || dismissed) return null
  const target = `http://127.0.0.1:${window.location.port || 80}${window.location.pathname}${window.location.search}`

  return (
    <div
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 18,
        transform: 'translateX(-50%)',
        zIndex: 60,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '9px 12px',
        maxWidth: 'min(680px, 92vw)',
        background: 'var(--paper-soft)',
        border: '1px solid var(--line-strong)',
        borderRadius: 'var(--radius)',
        boxShadow: 'var(--shadow-md)',
        fontSize: 11.5,
        lineHeight: 1.6,
        color: 'var(--ink-soft)',
      }}
    >
      <span>
        这个地址（<span className="mono">{host}</span>）下没有学习进度。进度按地址隔离，
        你之前的记录应该在 <a href={target} className="mono" style={{ color: 'var(--cinnabar)' }}>127.0.0.1</a> 那个地址下。
      </span>
      <button className="btn btn--sm" onClick={() => setDismissed(true)}>
        知道了
      </button>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <DataProvider>
        <ProgressProvider>
          <MotionProvider>
            <ToastProvider>
              <Shell />
              <OriginHint />
              <PointerFx />
            </ToastProvider>
          </MotionProvider>
        </ProgressProvider>
      </DataProvider>
    </BrowserRouter>
  )
}
