import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  Check,
  Clock,
  Flame,
  Plus,
  Sparkles,
  Target,
  X,
} from 'lucide-react'
import { useData } from '../lib/data'
import { useProgress } from '../lib/progress'
import { useToast } from '../lib/toast'
import { loadUiFlag, loadUiNumber, saveUiFlag } from '../lib/ui'
import { Odometer, Reveal, withViewTransition } from '../lib/motion'
import { Heatmap, streakOf } from '../components/Heatmap'
import { LevelBadge, ProgressRing, TierBadge } from '../components/ui'
import { nextInPath, sortByPath } from '../lib/path'
import {
  cn,
  formatDuration,
  greeting,
  isDue,
  nextReviewAt,
  relativeDay,
  shortDate,
  todayKey,
} from '../lib/utils'

export function Today() {
  const { problems, byNo } = useData()
  const progress = useProgress()
  const { toast } = useToast()
  const navigate = useNavigate()
  const { data } = progress
  const today = progress.today()
  const streak = streakOf(data.daily)
  const plan = progress.todayPlan
  const planProblems = plan
    .map((no) => byNo.get(no))
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
  const planDone = planProblems.filter(
    (p) => data.problems[p.no]?.status === 'done',
  ).length

  // 学习路线只算精选题：全量题库 4500 道，用它算进度没有意义
  const curated = problems.filter((p) => p.curated)
  const solved = curated.filter((p) => data.problems[p.no]?.status === 'done').length
  const wrong = problems.filter((p) => data.problems[p.no]?.wrong)
  const due = wrong
    .filter((p) => isDue(data.problems[p.no]))
    .sort((a, b) => (nextReviewAt(data.problems[a.no]) ?? 0) - (nextReviewAt(data.problems[b.no]) ?? 0))

  // 进度条统一从 0 长出来：首帧 0，下一帧到真实值
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setMounted(true))
    return () => window.cancelAnimationFrame(frame)
  }, [])

  const lastOpened = useMemo(() => {
    let best: { no: string; at: number } | null = null
    for (const [no, state] of Object.entries(data.problems)) {
      if (state.lastOpenedAt && (!best || state.lastOpenedAt > best.at)) {
        best = { no, at: state.lastOpenedAt }
      }
    }
    return best ? byNo.get(best.no) ?? null : null
  }, [byNo, data.problems])

  const tiers = ['P0', 'P1', 'P2', 'P3'].map((tier) => {
    const list = problems.filter((p) => p.tier === tier)
    const done = list.filter((p) => data.problems[p.no]?.status === 'done').length
    return { tier, total: list.length, done }
  })

  const generatePlan = () => {
    const isDone = (no: string) => data.problems[no]?.status === 'done'
    const next = nextInPath(curated, isDone, data.settings.dailyGoal)
    if (!next.length) {
      toast('整条路线都刷完了', 'success')
      return
    }
    withViewTransition(() => {
      progress.setPlan(todayKey(), next.map((p) => p.no))
    })
    toast(`按学习路线排了 ${next.length} 道，从「${next[0].category}」开始`, 'success')
  }

  const nextProblem = nextInPath(
    curated,
    (no) => (data.problems[no]?.status ?? 'todo') === 'done',
    1,
  )[0]

  const pathHead = sortByPath(curated).find(
    (p) => (data.problems[p.no]?.status ?? 'todo') !== 'done',
  )

  const goal = data.settings.dailyGoal
  // 目标为 0 / 负数（脏数据）时不进入完成态，也不让百分比变成 NaN
  const goalDone = goal > 0 && today.solved >= goal
  const goalPct = goal > 0 ? Math.min(100, (today.solved / goal) * 100) : 0

  /**
   * 今日目标达成的庆祝只播一次。
   * 标记落 localStorage（lc.ui.celebrate.<todayKey>），刷新页面就不再播；
   * ref 只用来挡住 StrictMode 的双跑，不能替代 localStorage。
   */
  const [celebrate, setCelebrate] = useState(false)
  // 备份提醒：>7 天没导出且没被关掉过
  const [lastExport] = useState(() => loadUiNumber('lastExport', 0))
  const [backupDismissed, setBackupDismissed] = useState(() => loadUiFlag('backup.dismissed'))
  const backupDue =
    !backupDismissed && (lastExport === 0 || Date.now() - lastExport > 7 * 86400000)
  const celebratedRef = useRef(false)
  // key 带上目标值：当天把目标从 3 改成 1 后应该能再庆祝一次（reviewer 提的）
  const celebrateKey = `celebrate.${todayKey()}.${goal}`
  useEffect(() => {
    if (!goalDone || celebratedRef.current) return
    if (loadUiFlag(celebrateKey)) return
    celebratedRef.current = true
    saveUiFlag(celebrateKey, true)
    setCelebrate(true)
  }, [celebrateKey, goalDone])

  return (
    <div className="page">
      <section className="hero">
        <div>
          <div className="hero__kicker fade">
            <span className="line" />
            <span className="eyebrow">
              {shortDate()} · {greeting()}
            </span>
          </div>
          {/* 按行显现：整行从下往上顶出来，第二行晚一拍 */}
          <h1>
            <span className="hero__line" style={{ '--line-delay': '40ms' } as CSSProperties}>
              <span>今天，把一道题</span>
            </span>
            <span className="hero__line" style={{ '--line-delay': '150ms' } as CSSProperties}>
              <span>
                <span className="accent">想透</span>，而不是刷过。
              </span>
            </span>
          </h1>
          <p className="hero__sub">
            题库里有 {problems.length} 道题，其中 {curated.length} 道按「专题 → 难度」排好了学习路线，
            还配了 22 篇讲义和一个能直接跑 Python 的代码台。先挑一道，读完题面再动手。
          </p>
        </div>
        <div className="hero__side fx-clip-up">
          <div className="hero__date">
            {streak > 0 ? `已连续学习 ${streak} 天` : '从今天开始记录'}
          </div>
          <div className="hero__quote">
            「看懂 → 默写 → 变形」三遍法：一题 40 分钟，比连刷十题有用。
          </div>
        </div>
      </section>

      {/* 统计条是入口不是展板：外层 Reveal 只负责交错动画，真正可点的是里面的 <a>；
          用链接而不是按钮 —— Ctrl/⌘+点击能开新标签，右键也能复制地址 */}
      <div className="stats-strip">
        <Reveal className="stat-slot" index={0}>
          <Link className="stat stat--link" to="/problems?status=done">
            <div className="stat__value num">
              <Odometer value={solved} />
              <small>
                / <Odometer value={curated.length} /> 题
              </small>
            </div>
            <div className="stat__label">已掌握</div>
          </Link>
        </Reveal>
        <Reveal className="stat-slot" index={1}>
          <Link className="stat stat--link" to="/stats">
            <div className="stat__value num">
              <Odometer value={streak} />
              <small>天</small>
            </div>
            <div className="stat__label">连续学习</div>
          </Link>
        </Reveal>
        <Reveal className="stat-slot" index={2}>
          <Link className="stat stat--link" to="/stats">
            <div className="stat__value num">
              <Odometer value={today.runs} />
              <small>次</small>
            </div>
            <div className="stat__label">今日运行</div>
          </Link>
        </Reveal>
        <Reveal className="stat-slot" index={3}>
          <Link className="stat stat--link" to="/review">
            <div className={cn('stat__value num', wrong.length > 0 && 'stat__value--alert')}>
              <Odometer value={wrong.length} />
              <small>道</small>
            </div>
            <div className="stat__label">错题待消化</div>
          </Link>
        </Reveal>
      </div>

      {/* 进度只在本机：超过 7 天没备份给一次轻提示（可关掉，关掉后不再出现） */}
      {backupDue ? (
        <div className="backup-nudge">
          <span>
            进度只存在这台电脑的浏览器里。
            {lastExport
              ? `上次备份是 ${Math.floor((Date.now() - lastExport) / 86400000)} 天前。`
              : '还没备份过。'}
          </span>
          <button
            className="btn btn--sm"
            onClick={() => window.dispatchEvent(new CustomEvent('lc:open-settings'))}
          >
            去备份
          </button>
          <button
            className="backup-nudge__close"
            aria-label="不再提醒备份"
            onClick={() => {
              saveUiFlag('backup.dismissed', true)
              setBackupDismissed(true)
            }}
          >
            ×
          </button>
        </div>
      ) : null}

      <div className="today-grid">
        <div className="stack">
          <Reveal as="section" className="card">
            <div className="card__head">
              <div>
                <div className="eyebrow">Today&apos;s plan</div>
                <div className="card__title">今日计划</div>
              </div>
              <div className="card__head-actions">
                <span className="card__count">
                  {planProblems.length ? (
                    <>
                      <Odometer value={planDone} /> / <Odometer value={planProblems.length} /> 已完成
                    </>
                  ) : (
                    `目标 ${data.settings.dailyGoal} 题`
                  )}
                </span>
                <Link to="/problems" className="card__link">
                  去题库挑题 <ArrowRight />
                </Link>
              </div>
            </div>

            {planProblems.length === 0 ? (
              <div className="empty empty--compact">
                <div className="empty__mark">计</div>
                <h2>今天还没有排题</h2>
                <p>
                  {pathHead
                    ? `按学习路线，下一道是「${pathHead.category}」里的题。`
                    : '整条路线都刷完了。'}
                </p>
                <div className="empty__actions">
                  <button className="btn btn--primary" data-magnetic onClick={generatePlan}>
                    <Sparkles /> 按路线排 {data.settings.dailyGoal} 题
                  </button>
                  <Link className="btn" to="/problems">
                    浏览题库
                  </Link>
                </div>
              </div>
            ) : (
              <div>
                {planProblems.map((problem) => {
                  const state = data.problems[problem.no]
                  const done = state?.status === 'done'
                  return (
                    <div
                      className="plan-item"
                      key={problem.no}
                      style={{ viewTransitionName: `plan-${problem.no}` }}
                    >
                      <button
                        className={`plan-check${done ? ' done' : ''}`}
                        onClick={() =>
                          withViewTransition(() =>
                            progress.setStatus(problem.no, done ? 'todo' : 'done'),
                          )
                        }
                        aria-label={done ? '标记为未完成' : '标记为已掌握'}
                      >
                        <Check />
                      </button>
                      <div className="plan-item__main">
                        <Link to={`/problems/${problem.no}`} className="plan-item__title">
                          {problem.title}
                        </Link>
                        <div className="plan-item__meta">
                          <span className="mono">No.{problem.no}</span>
                          <LevelBadge level={problem.level} />
                          <span>{problem.category}</span>
                          {problem.estMin ? (
                            <>
                              <span>·</span>
                              <Clock style={{ width: 10, height: 10 }} />
                              <span>{problem.estMin} 分钟</span>
                            </>
                          ) : null}
                        </div>
                      </div>
                      <button
                        className="plan-item__remove"
                        onClick={() =>
                          withViewTransition(() => progress.removeFromPlan(problem.no))
                        }
                        aria-label="从今日计划移除"
                      >
                        <X />
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </Reveal>

          <Reveal as="section" className="card" delay={60}>
            <div className="card__head">
              <div>
                <div className="eyebrow">Continue</div>
                <div className="card__title">继续上次</div>
              </div>
              <span className="card__note">
                {lastOpened ? relativeDay(data.problems[lastOpened.no]?.lastOpenedAt) : '—'}
              </span>
            </div>
            <div className="card__body">
              {lastOpened ? (
                <div className="continue-card" data-tilt data-cursor="继续这道题">
                  <div className="eyebrow">
                    No.{lastOpened.no} · {lastOpened.category}
                  </div>
                  <h3>{lastOpened.title}</h3>
                  <div className="continue-card__meta">
                    <LevelBadge level={lastOpened.level} />
                    <TierBadge tier={lastOpened.tier} />
                    <span>·</span>
                    <span>
                      已累计 {formatDuration(data.problems[lastOpened.no]?.timeSpentSec ?? 0)}
                    </span>
                  </div>
                  <div className="continue-card__foot">
                    <button
                      className="btn"
                      onClick={() => navigate(`/problems/${lastOpened.no}`)}
                    >
                      继续这道题 <ArrowRight />
                    </button>
                    <span className="continue-card__hint">
                      {data.problems[lastOpened.no]?.attempts ?? 0} 次运行
                    </span>
                  </div>
                </div>
              ) : (
                <div className="review-teaser">
                  <div className="review-teaser__num">01</div>
                  <div className="review-teaser__text">
                    <strong>还没有打开过题目</strong>
                    从 P0 的「两数之和」开始，先读题面，再看精讲。
                  </div>
                  <Link className="btn btn--sm" to="/problems/1">
                    打开
                  </Link>
                </div>
              )}
            </div>
          </Reveal>

          <Reveal as="section" className="card" delay={120}>
            <div className="card__head">
              <div>
                <div className="eyebrow">Review</div>
                <div className="card__title">待复习</div>
              </div>
              <Link to="/review" className="card__link">
                错题本 <ArrowRight />
              </Link>
            </div>
            <div className="card__body">
              <div className="review-teaser">
                <div className="review-teaser__num">
                  <Odometer value={due.length} />
                </div>
                <div className="review-teaser__text">
                  <strong>{due.length ? '按遗忘曲线到期了' : '暂时没有到期的错题'}</strong>
                  {due.length
                    ? '先重做，再决定是「通过」还是继续留在错题本。'
                    : '做错的题会隔天提醒你重做，独立做对就移出错题本。'}
                </div>
                <Link className="btn btn--sm" to="/review">
                  {due.length ? '去复习' : '看看全部错题'}
                </Link>
              </div>
            </div>
          </Reveal>
        </div>

        <div className="stack">
          <Reveal as="section" className="card" delay={40}>
            <div className="card__head">
              <div className="card__title">分级进度</div>
              <span className="card__note">
                {solved} / {curated.length}
              </span>
            </div>
            <div className="card__body card__body--row">
              <ProgressRing value={solved} total={curated.length} size={88} />
              <div className="grow">
                {tiers.map(({ tier, total, done }) => (
                  <div className="tier-row" key={tier}>
                    <span className="tier-row__name">{tier}</span>
                    <div className="tier-bar">
                      <span
                        style={{
                          width: `${total && mounted ? (done / total) * 100 : 0}%`,
                        }}
                      />
                    </div>
                    <span className="tier-row__value">
                      {done}/{total}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </Reveal>

          <Reveal as="section" className="card" delay={100}>
            <div className="card__head">
              <div className="card__title">学习热力</div>
              <span className="card__note">近 16 周</span>
            </div>
            <div className="card__body">
              <Heatmap daily={data.daily} weeks={16} />
              <div className="card__foot">
                <Flame style={{ width: 13, height: 13 }} />
                {streak > 0
                  ? `连续 ${streak} 天，别断在今天。`
                  : '今天运行一次代码，就开始计时。'}
              </div>
            </div>
          </Reveal>

          <Reveal
            as="section"
            className={cn(
              'card',
              goalDone && 'card--goal-done',
              celebrate && 'card--goal-celebrate',
            )}
            delay={160}
          >
            <div className="card__head">
              <div className="card__title">今日目标</div>
              {goalDone ? (
                <span className="goal-chip">
                  <Check aria-hidden="true" /> 今日完成
                </span>
              ) : (
                <Target style={{ width: 16, height: 16 }} />
              )}
            </div>
            <div className="card__body">
              <div className="goal-row">
                <span className="num goal__value">
                  <Odometer value={today.solved} />
                </span>
                {goalDone ? (
                  <span className="goal__check" aria-hidden="true">
                    <Check />
                  </span>
                ) : null}
                <span className="goal__unit">/ {goal} 题</span>
              </div>
              <div className="goal-bar">
                <div style={{ width: `${mounted ? goalPct : 0}%` }} />
              </div>
              <div className="goal-actions">
                <button
                  className="btn btn--sm"
                  onClick={() => {
                    if (nextProblem) navigate(`/problems/${nextProblem.no}`)
                    else navigate('/problems')
                  }}
                  title={
                    nextProblem
                      ? `路线下一题：${nextProblem.category} · ${nextProblem.title}`
                      : '路线已刷完'
                  }
                >
                  <Plus /> 下一题
                </button>
                <Link className="btn btn--sm" to="/stats">
                  看统计
                </Link>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </div>
  )
}
