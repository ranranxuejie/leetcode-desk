import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Check, RotateCcw, X } from 'lucide-react'
import { useData } from '../lib/data'
import { useProgress } from '../lib/progress'
import { useToast } from '../lib/toast'
import { Odometer, Reveal, Tabs } from '../lib/motion'
import { LevelBadge, TierBadge } from '../components/ui'
import {
  isDue,
  nextReviewAt,
  relativeDay,
} from '../lib/utils'

export function Review() {
  const { problems } = useData()
  const { data, recordReview } = useProgress()
  const { toast } = useToast()
  const navigate = useNavigate()
  const [tab, setTab] = useState<'due' | 'all'>('due')

  const wrong = useMemo(
    () => problems.filter((p) => data.problems[p.no]?.wrong),
    [problems, data.problems],
  )
  const due = useMemo(
    () =>
      wrong
        .filter((p) => isDue(data.problems[p.no]))
        .sort(
          (a, b) =>
            (nextReviewAt(data.problems[a.no]) ?? 0) -
            (nextReviewAt(data.problems[b.no]) ?? 0),
        ),
    [wrong, data.problems],
  )
  const list = tab === 'due' ? due : wrong

  const handleReview = (no: string, result: 'pass' | 'fail') => {
    recordReview(no, result)
    toast(result === 'pass' ? '已通过，移出错题本' : '继续留在错题本，明天再见', result === 'pass' ? 'success' : 'default')
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Mistakes · 遗忘曲线复习</div>
          <h1>错题本</h1>
          <p>
            {wrong.length} 道错题 · {due.length} 道到期。做错后隔天再重做，能独立写对就移出错题本。
          </p>
        </div>
        <div className="page-head__side">
          <button
            className="btn btn--primary"
            disabled={due.length === 0}
            onClick={() => {
              const first = due[0]
              if (first) navigate(`/problems/${first.no}`)
            }}
          >
            <RotateCcw /> 开始复习
          </button>
        </div>
      </div>

      <div className="review-tabs">
        <Tabs
          items={[
            { key: 'due', label: '待复习', count: due.length },
            { key: 'all', label: '全部错题', count: wrong.length },
          ]}
          value={tab}
          onChange={(key) => setTab(key as 'due' | 'all')}
        />
      </div>

      <div className="review-grid">
        <section className="card">
          <div className="card__head">
            <div className="card__title">{tab === 'due' ? '今天到期' : '所有错题'}</div>
            <span className="card__note">
              <Odometer value={list.length} /> 道
            </span>
          </div>
          {list.length === 0 ? (
            <div className="empty empty--compact">
              <div className="empty__mark">净</div>
              <h2>{tab === 'due' ? '今天没有到期的错题' : '错题本是空的'}</h2>
              <p>
                {tab === 'due'
                  ? '可以去做新题，或者提前复习下面的全部错题。'
                  : '在题目页点「记为错题」，它就会出现在这里。'}
              </p>
              <Link className="btn btn--sm empty__cta" to="/problems">
                去题库
              </Link>
            </div>
          ) : (
            list.map((problem, index) => {
              const state = data.problems[problem.no]
              const nextAt = nextReviewAt(state)
              return (
                <Reveal className="review-card" key={problem.no} index={Math.min(index, 8)}>
                  <div className="review-card__main">
                    <Link to={`/problems/${problem.no}`} className="review-card__title">
                      {problem.title}
                    </Link>
                    <div className="review-card__meta">
                      <span className="mono">No.{problem.no}</span>
                      <LevelBadge level={problem.level} />
                      <TierBadge tier={problem.tier} />
                      <span>·</span>
                      <span>复习 {state.reviews.length} 次</span>
                      {state.reviews.length ? (
                        <>
                          <span>·</span>
                          <span>上次 {relativeDay(state.reviews[state.reviews.length - 1].at)}</span>
                        </>
                      ) : (
                        <span className="due-badge">首次复习</span>
                      )}
                      {nextAt && nextAt > Date.now() ? (
                        <span className="dim">
                          下次 {new Date(nextAt).toLocaleDateString('zh-CN')}
                        </span>
                      ) : null}
                    </div>
                    {state.note ? <div className="review-card__note">{state.note}</div> : null}
                  </div>
                  <div className="review-card__actions">
                    <button
                      className="btn btn--sm"
                      onClick={() => navigate(`/problems/${problem.no}`)}
                      title="打开题目重做"
                    >
                      重做 <ArrowRight />
                    </button>
                    <button
                      className="btn btn--sm review-card__pass"
                      onClick={() => handleReview(problem.no, 'pass')}
                      title="这次独立做出来了"
                    >
                      <Check /> 通过
                    </button>
                    <button
                      className="btn btn--sm"
                      onClick={() => handleReview(problem.no, 'fail')}
                      title="还是没做出来"
                    >
                      <X /> 没过
                    </button>
                  </div>
                </Reveal>
              )
            })
          )}
        </section>

        <div className="stack">
          <section className="card">
            <div className="card__head">
              <div className="card__title">复习节奏</div>
            </div>
            <div className="card__body">
              <p className="card__hint card__hint--body">
                做错的题不是看一遍答案就算完。隔天重做，独立写完再点「通过」。
              </p>
              <div className="stat-list">
                <div className="stat-line">
                  <span className="stat-line__label">
                    <span className="status-dot" data-status="learning" />
                    当天
                  </span>
                  <span className="stat-line__value">重做一遍</span>
                </div>
                <div className="stat-line">
                  <span className="stat-line__label">
                    <span className="status-dot" data-status="todo" />
                    次日
                  </span>
                  <span className="stat-line__value">不看答案默写</span>
                </div>
                <div className="stat-line">
                  <span className="stat-line__label">
                    <span className="status-dot" data-status="todo" />
                    一周后
                  </span>
                  <span className="stat-line__value">换个用例变形</span>
                </div>
              </div>
            </div>
          </section>

          <section className="card">
            <div className="card__head">
              <div className="card__title">错题分布</div>
            </div>
            <div className="card__body">
              {wrong.length ? (
                Object.entries(
                  wrong.reduce<Record<string, number>>((acc, p) => {
                    acc[p.category] = (acc[p.category] ?? 0) + 1
                    return acc
                  }, {}),
                )
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 6)
                  .map(([category, count]) => (
                    <div className="stat-line" key={category}>
                      <span className="stat-line__label">{category}</span>
                      <span className="stat-line__value">{count} 道</span>
                    </div>
                  ))
              ) : (
                <p className="card__hint">还没有错题记录。</p>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
