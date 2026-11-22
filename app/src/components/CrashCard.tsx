import { useLocation, useNavigate } from 'react-router-dom'
import { useProgress } from '../lib/progress'
import { useToast } from '../lib/toast'

/**
 * 崩溃卡片：渲染在内容区里，外壳（侧栏 / 顶栏）保持可用。
 * 三个出口：重试、回今日、清空这道题的本地记录（数据坏掉时的自救手段）。
 */
export function CrashCard({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const navigate = useNavigate()
  const location = useLocation()
  const progress = useProgress()
  const { toast } = useToast()

  const matched = /^\/problems\/([^/]+)/.exec(location.pathname)
  const no = matched ? decodeURIComponent(matched[1]) : ''
  const message = error?.message || String(error) || '未知错误'

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${message}\n\n${error?.stack ?? ''}`)
      toast('错误信息已复制', 'success')
    } catch {
      toast('复制失败，请手动选中', 'error')
    }
  }

  return (
    <div className="crash" role="alert">
      <div className="crash__mark">!</div>
      <h2>这一页出错了</h2>
      <p className="crash__lead">
        外壳还在，可以直接换一页，或者重试。如果反复出错，多半是这道题的本地记录有问题 ——
        清掉它就能继续，学习进度不会丢。
      </p>
      <pre className="crash__msg">{message}</pre>
      <div className="crash__actions">
        <button
          className="btn btn--primary"
          onClick={() => {
            onRetry()
          }}
        >
          重试
        </button>
        <button
          className="btn"
          onClick={() => {
            onRetry()
            navigate('/')
          }}
        >
          回今日
        </button>
        {no ? (
          <button
            className="btn"
            onClick={() => {
              progress.resetProblem(no)
              toast('已清空这道题的本地记录', 'success')
              onRetry()
            }}
          >
            清空 No.{no} 的记录
          </button>
        ) : null}
        <button className="btn btn--ghost" onClick={() => void copy()}>
          复制错误信息
        </button>
      </div>
    </div>
  )
}
