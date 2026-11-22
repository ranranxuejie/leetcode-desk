import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useData } from '../lib/data'
import { useProgress } from '../lib/progress'
import { Odometer, Reveal } from '../lib/motion'
import { Heatmap, streakOf } from '../components/Heatmap'
import { LevelBadge, ProgressRing } from '../components/ui'
import { cn, dateKey, formatDuration } from '../lib/utils'

export function Stats() {
  const { problems, tutorials } = useData()
  const { data } = useProgress()

  // 柱状图从 0 长起来
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setMounted(true))
    return () => window.cancelAnimationFrame(frame)
  }, [])

  const curated = problems.filter((p) => p.curated)
  const solved = curated.filter((p) => data.problems[p.no]?.status === 'done').length
  const solvedAll = problems.filter((p) => data.problems[p.no]?.status === 'done').length
  const learning = problems.filter((p) => data.problems[p.no]?.status === 'learning').length
  const wrong = problems.filter((p) => data.problems[p.no]?.wrong).length
  // 本周「看答案」次数：定位是「先想 20 分钟」，看答案是个值得看的学习信号
  const weekStart = Date.now() - 7 * 86400000
  const revealedThisWeek = Object.values(data.problems).filter((p) => (p.revealed?.lastAt ?? 0) >= weekStart).length
  const attempts = Object.values(data.problems).reduce((sum, p) => sum + p.attempts, 0)
  const passes = Object.values(data.problems).reduce((sum, p) => sum + p.passes, 0)
  const timeSpent = Object.values(data.problems).reduce((sum, p) => sum + p.timeSpentSec, 0)
  const streak = streakOf(data.daily)
  const readDocs = data.readDocs.length

  const tiers = ['P0', 'P1', 'P2', 'P3', '基础', '进阶'].map((tier) => {
    const list = problems.filter((p) => p.tier === tier)
    const done = list.filter((p) => data.problems[p.no]?.status === 'done').length
    return { tier, total: list.length, done }
  })

  const levels = (['Easy', 'Medium', 'Hard'] as const).map((level) => {
    const list = problems.filter((p) => p.level === level)
    const done = list.filter((p) => data.problems[p.no]?.status === 'done').length
    return { level, total: list.length, done }
  })

  const categories = useMemo(() => {
    const map = new Map<string, { total: number; done: number; wrong: number }>()
    problems.forEach((problem) => {
      const entry = map.get(problem.category) ?? { total: 0, done: 0, wrong: 0 }
      entry.total += 1
      const state = data.problems[problem.no]
      if (state?.status === 'done') entry.done += 1
      if (state?.wrong) entry.wrong += 1
      map.set(problem.category, entry)
    })
    return Array.from(map.entries())
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 12)
  }, [problems, data.problems])

  const ratings = useMemo(() => {
    const counts = { read: 0, recall: 0, variant: 0 }
    Object.values(data.problems).forEach((state) => {
      if (state.selfRating) counts[state.selfRating] += 1
    })
    return counts
  }, [data.problems])

  const last14 = useMemo(() => {
    const days: { key: string; label: string; runs: number; solved: number }[] = []
    for (let i = 13; i >= 0; i -= 1) {
      const date = new Date()
      date.setDate(date.getDate() - i)
      const key = dateKey(date.getTime())
      days.push({
        key,
        label: `${date.getMonth() + 1}/${date.getDate()}`,
        runs: data.daily[key]?.runs ?? 0,
        solved: data.daily[key]?.solved ?? 0,
      })
    }
    return days
  }, [data.daily])
  const maxRuns = Math.max(1, ...last14.map((d) => d.runs))

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Progress · 只看趋势，不焦虑</div>
          <h1>学习统计</h1>
          <p>数据只存在这台电脑的浏览器里，可随时在设置里导出。</p>
        </div>
      </div>

      <div className="stats-strip">
        <Reveal className="stat" index={0}>
          <div className="stat__value num">
            <Odometer value={solved} />
            <small>
              / <Odometer value={curated.length} />
            </small>
          </div>
          <div className="stat__label">已掌握（路线）</div>
        </Reveal>
        <Reveal className="stat" index={1}>
          <div className="stat__value num">
            <Odometer value={learning} />
          </div>
          <div className="stat__label">学习中</div>
        </Reveal>
        <Reveal className="stat" index={2}>
          <div className={cn('stat__value num', wrong > 0 && 'stat__value--alert')}>
            <Odometer value={wrong} />
          </div>
          <div className="stat__label">错题</div>
        </Reveal>
        <Reveal className="stat" index={3}>
          <div className="stat__value num">
            <Odometer value={attempts} />
            <small>次运行</small>
          </div>
          <div className="stat__label">累计运行</div>
        </Reveal>
      </div>

      <div className="stats-grid">
        <Reveal as="section" className="card" index={0}>
          <div className="card__head">
            <div className="card__title">总进度</div>
            <span className="card__note">{streak} 天连续</span>
          </div>
          <div className="card__body card__body--row">
            <ProgressRing value={solved} total={curated.length} size={104} stroke={7} />
            <div className="grow">
              <div className="stat-line">
                <span className="stat-line__label">全量题库</span>
                <span className="stat-line__value">
                  {solvedAll} / {problems.length}
                </span>
              </div>
              <div className="stat-line">
                {/* 口径：只有「有期望值的用例全过」才算一次通过；只运行不判定的运行不算通过 */}
                <span className="stat-line__label" title="只统计有期望输出的用例；「只运行不判定」的那次不计入通过">
                  全过率（有期望用例）
                </span>
                <span className="stat-line__value">
                  {attempts ? `${Math.round((passes / attempts) * 100)}%` : '—'}
                </span>
              </div>
              <div className="stat-line">
                <span className="stat-line__label">累计用时</span>
                <span className="stat-line__value">{formatDuration(timeSpent)}</span>
              </div>
              <div className="stat-line">
                <span
                  className="stat-line__label"
                  title="展开「参考答案」的题数。定位是「先自己想 20 分钟」，所以这个数字值得看"
                >
                  本周看答案
                </span>
                <span className="stat-line__value">{revealedThisWeek} 次</span>
              </div>
              <div className="stat-line">
                <span className="stat-line__label">教程已读</span>
                <span className="stat-line__value">
                  {readDocs} / {tutorials.length}
                </span>
              </div>
            </div>
          </div>
        </Reveal>

        <Reveal as="section" className="card" index={1}>
          <div className="card__head">
            <div className="card__title">分级完成度</div>
          </div>
          <div className="card__body">
            {tiers.map(({ tier, total, done }) => (
              <div className="tier-row" key={tier}>
                <span className="tier-row__name">{tier}</span>
                <div className="tier-bar">
                  <span
                    style={{ width: `${total && mounted ? (done / total) * 100 : 0}%` }}
                  />
                </div>
                <span className="tier-row__value">
                  {done}/{total}
                </span>
              </div>
            ))}
          </div>
        </Reveal>

        <Reveal as="section" className="card" index={2}>
          <div className="card__head">
            <div className="card__title">难度分布</div>
          </div>
          <div className="card__body">
            {levels.map(({ level, total, done }) => (
              <div className="stat-line" key={level}>
                <span className="stat-line__label">
                  <LevelBadge level={level} />
                  <span className="stat-line__hint">{total} 道</span>
                </span>
                <span className="stat-line__value">
                  {done} / {total}
                </span>
              </div>
            ))}
            <div className="stat-line">
              <span className="stat-line__label">三遍法自评</span>
              <span className="stat-line__value">
                看懂 {ratings.read} · 默写 {ratings.recall} · 变形 {ratings.variant}
              </span>
            </div>
          </div>
        </Reveal>

        <Reveal as="section" className="card span-2" index={3}>
          <div className="card__head">
            <div className="card__title">专题掌握度</div>
            <span className="card__note">按题量排序 · 前 12</span>
          </div>
          <div className="card__body">
            <div className="stat-list stat-list--2col">
              {categories.map(([category, entry]) => (
                <div className="stat-line" key={category}>
                  <span className="stat-line__label">{category}</span>
                  <span className="stat-line__value">
                    {entry.done} / {entry.total}
                    {entry.wrong ? (
                      <span className="stat-line__wrong">错 {entry.wrong}</span>
                    ) : null}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </Reveal>

        <Reveal as="section" className="card" index={4}>
          <div className="card__head">
            <div className="card__title">最近 14 天</div>
          </div>
          <div className="card__body">
            {last14.every((day) => day.runs === 0) ? (
              <p className="card__hint">
                还没有运行记录，
                <Link to="/problems" className="card__link">
                  去题库做一题
                </Link>
                就会点亮。
              </p>
            ) : null}
            <div className="mini-bars">
              {last14.map((day) => (
                <span
                  key={day.key}
                  data-has={day.runs > 0}
                  style={{ height: `${mounted ? Math.max(4, (day.runs / maxRuns) * 100) : 0}%` }}
                  title={`${day.label} · ${day.runs} 次运行 · 完成 ${day.solved} 题`}
                />
              ))}
            </div>
            <div className="mini-bars__axis">
              <span>{last14[0]?.label}</span>
              <span>{last14[last14.length - 1]?.label}</span>
            </div>
          </div>
        </Reveal>

        <Reveal as="section" className="card span-3" index={5}>
          <div className="card__head">
            <div className="card__title">学习热力</div>
            <span className="card__note">近 16 周 · 颜色越深运行越多</span>
          </div>
          <div className="card__body">
            <Heatmap daily={data.daily} weeks={16} />
          </div>
        </Reveal>
      </div>
    </div>
  )
}
