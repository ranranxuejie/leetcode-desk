import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

/**
 * 错误边界：任何页面在渲染期抛错，都只让「内容区」变成一张错误卡片，
 * 外壳（侧栏 / 顶栏 / 设置入口）必须留着 —— 否则用户只能开 devtools 删 localStorage 自救。
 *
 * 用法：
 *   <ErrorBoundary fallback={(error, reset) => <CrashCard error={error} onRetry={reset} />}>
 *     <Routes />
 *   </ErrorBoundary>
 */
export class ErrorBoundary extends Component<
  {
    children: ReactNode
    fallback: (error: Error, reset: () => void) => ReactNode
    /**
     * 这些值变化时自动清掉错误态（传路由 key 即可）。
     * 没有它的话，崩溃后从侧栏换一页，错误卡片会一直卡在那里 —— 用户会以为「换页也没用」。
     */
    resetKeys?: unknown[]
  },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 控制台留一份完整堆栈，方便排查；生产环境也不会刷屏
    console.error('[训练台] 页面渲染出错：', error, info.componentStack)
  }

  componentDidUpdate(prev: Readonly<{ resetKeys?: unknown[] }>) {
    if (!this.state.error) return
    const before = prev.resetKeys ?? []
    const now = this.props.resetKeys ?? []
    const changed = before.length !== now.length || before.some((item, index) => item !== now[index])
    if (changed) this.setState({ error: null })
  }

  /** 重试：清掉错误状态，让子树重新挂载（StrictMode 下也只会重挂一次） */
  reset = () => this.setState({ error: null })

  render() {
    if (this.state.error) {
      return this.props.fallback(this.state.error, this.reset)
    }
    return this.props.children
  }
}
