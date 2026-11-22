import type { CSSProperties } from 'react'
import type { DayLog } from '../lib/types'
import { dateKey, todayKey } from '../lib/utils'

function level(runs: number): number {
  if (!runs) return 0
  if (runs <= 1) return 1
  if (runs <= 3) return 2
  if (runs <= 6) return 3
  return 4
}

export function Heatmap({
  daily,
  weeks = 16,
}: {
  daily: Record<string, DayLog>
  weeks?: number
}) {
  const end = new Date()
  end.setHours(0, 0, 0, 0)
  const start = new Date(end)
  start.setDate(end.getDate() - weeks * 7 + 1)
  // 对齐到周一
  const offset = (start.getDay() + 6) % 7
  start.setDate(start.getDate() - offset)

  const columns: { key: string; date: Date; runs: number }[][] = []
  const cursor = new Date(start)
  while (cursor <= end) {
    const col: { key: string; date: Date; runs: number }[] = []
    for (let i = 0; i < 7; i += 1) {
      const key = dateKey(cursor.getTime())
      const future = cursor > end
      col.push({
        key: future ? `${key}-future` : key,
        date: new Date(cursor),
        runs: future ? -1 : (daily[key]?.runs ?? 0),
      })
      cursor.setDate(cursor.getDate() + 1)
    }
    columns.push(col)
  }

  return (
    <div>
      <div className="heatmap" role="img" aria-label="最近学习热力图">
        {columns.map((col, ci) => (
          <div className="heatmap__col" key={ci}>
            {col.map((cell, ri) => {
              const future = cell.runs < 0
              return (
                <div
                  key={cell.key}
                  className="heatmap__cell"
                  data-level={future ? 0 : level(cell.runs)}
                  data-empty={future ? 'true' : 'false'}
                  style={{ '--i': ci * 7 + ri } as CSSProperties}
                  title={
                    future
                      ? ''
                      : `${cell.date.getMonth() + 1} 月 ${cell.date.getDate()} 日 · ${
                          cell.runs
                        } 次运行`
                  }
                />
              )
            })}
          </div>
        ))}
      </div>
      <div className="heatmap__legend">
        <span>少</span>
        <div className="heatmap__cell" data-level="1" />
        <div className="heatmap__cell" data-level="2" />
        <div className="heatmap__cell" data-level="3" />
        <div className="heatmap__cell" data-level="4" />
        <span>多</span>
      </div>
    </div>
  )
}

export function streakOf(daily: Record<string, DayLog>): number {
  let streak = 0
  const cursor = new Date()
  cursor.setHours(0, 0, 0, 0)
  const today = daily[todayKey()]
  if (!today || (today.runs === 0 && today.solved === 0)) {
    cursor.setDate(cursor.getDate() - 1)
  }
  for (let i = 0; i < 400; i += 1) {
    const key = dateKey(cursor.getTime())
    const log = daily[key]
    if (log && (log.runs > 0 || log.solved > 0)) {
      streak += 1
      cursor.setDate(cursor.getDate() - 1)
    } else {
      break
    }
  }
  return streak
}
