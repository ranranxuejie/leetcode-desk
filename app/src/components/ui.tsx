import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { Level, Status } from '../lib/types'
import { Odometer } from '../lib/motion'
import { LEVEL_LABEL, STATUS_LABEL, TIER_LABEL, cn } from '../lib/utils'

export function LevelBadge({ level, className }: { level: Level; className?: string }) {
  return (
    <span className={cn('badge', `badge--${level}`, className)}>
      {LEVEL_LABEL[level]}
    </span>
  )
}

export function TierBadge({ tier, long = false }: { tier: string; long?: boolean }) {
  return (
    <span className="badge" data-tier={tier}>
      {long ? (TIER_LABEL[tier] ?? tier) : tier}
    </span>
  )
}

export function StatusDot({
  status,
  onClick,
  size,
}: {
  status: Status
  onClick?: () => void
  size?: number
}) {
  const label = `${STATUS_LABEL[status]}，点击切换状态`
  return (
    <button
      type="button"
      className="status-dot"
      data-status={status}
      title={label}
      aria-label={label}
      style={size ? { width: size, height: size } : undefined}
      onClick={(event) => {
        event.stopPropagation()
        onClick?.()
      }}
    />
  )
}

export function ProgressRing({
  value,
  total,
  size = 92,
  stroke = 6,
  label = '完成',
}: {
  value: number
  total: number
  size?: number
  stroke?: number
  label?: string
}) {
  const pct = total > 0 ? Math.min(1, value / total) : 0
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  // 首帧先画 0%，下一帧再到目标值 —— 进度环从 0 长出来
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setReady(true))
    return () => window.cancelAnimationFrame(frame)
  }, [])
  const shown = ready ? pct : 0
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} aria-hidden="true">
        <circle
          className="ring__track"
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
        />
        <circle
          className="ring__value"
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeDasharray={c}
          strokeDashoffset={c * (1 - shown)}
        />
      </svg>
      <div className="ring__label">
        <strong>
          <Odometer value={Math.round(pct * 100)} />
          <span aria-hidden="true">%</span>
        </strong>
        <span>{label}</span>
      </div>
    </div>
  )
}

export function EmptyState({
  mark = '空',
  title,
  children,
  action,
}: {
  mark?: string
  title: string
  children?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="empty">
      <div className="empty__mark">{mark}</div>
      <h2>{title}</h2>
      {children ? <p>{children}</p> : null}
      {action ? <div style={{ marginTop: 'var(--sp-3)' }}>{action}</div> : null}
    </div>
  )
}
