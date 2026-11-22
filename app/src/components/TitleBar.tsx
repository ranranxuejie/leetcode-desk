import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Minus, Square, Copy, X } from 'lucide-react'
import { cn } from '../lib/utils'
import { installShellHotkeys, onShellState, shellAction } from '../lib/shell'

/** 路由 → 标题栏里显示的页面名（和侧边栏一致） */
const PAGE_NAMES: Array<[RegExp, string]> = [
  [/^\/problems\/[^/]+/, '题目工作台'],
  [/^\/problems/, '题库'],
  [/^\/tutorials\/[^/]+/, '教程'],
  [/^\/tutorials/, '教程'],
  [/^\/review/, '错题本'],
  [/^\/stats/, '统计'],
  [/^\/$/, '今日'],
]

function pageName(pathname: string): string {
  for (const [pattern, name] of PAGE_NAMES) {
    if (pattern.test(pathname)) return name
  }
  return '训练台'
}

/**
 * 自绘标题栏：只在 WebView2 壳里渲染。
 *
 * - 按住空白处拖动窗口（交给宿主的 WM_NCLBUTTONDOWN，所以 Aero Snap / 双击最大化都还work）
 * - 右侧三个按钮：最小化 / 最大化-还原 / 关闭
 * - 整条 44px，颜色取外壳材质的令牌，和页面内容无缝衔接
 */
export function TitleBar() {
  const location = useLocation()
  const [maximized, setMaximized] = useState(false)

  useEffect(() => onShellState(setMaximized), [])
  // F11 = 真全屏（含任务栏区域）；Esc 不接管，留给弹窗
  useEffect(() => installShellHotkeys(), [])

  return (
    <div
      className="titlebar"
      onPointerDown={(event) => {
        // 只处理左键、且不是点在按钮上
        if (event.button !== 0) return
        if ((event.target as HTMLElement).closest('.titlebar__btn')) return
        shellAction('drag')
      }}
    >
      <div className="titlebar__brand">
        <span className="titlebar__seal">题</span>
        <span className="titlebar__name">LeetCode 训练台</span>
      </div>
      <span className="titlebar__page">{pageName(location.pathname)}</span>

      <div className="titlebar__spacer" />

      <div className="titlebar__actions">
        <button
          className="titlebar__btn"
          onClick={() => shellAction('minimize')}
          aria-label="最小化"
          title="最小化"
        >
          <Minus />
        </button>
        <button
          className="titlebar__btn"
          onClick={() => shellAction('maximize')}
          aria-label={maximized ? '还原' : '最大化'}
          title={maximized ? '还原' : '最大化'}
        >
          {maximized ? <Copy /> : <Square />}
        </button>
        <button
          className={cn('titlebar__btn', 'titlebar__btn--close')}
          onClick={() => shellAction('close')}
          aria-label="关闭"
          title="关闭"
        >
          <X />
        </button>
      </div>
    </div>
  )
}
