import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  ExternalLink,
  Flame,
  Play,
  RotateCcw,
  X,
} from 'lucide-react'
import { useData, useStatement } from '../lib/data'
import { RUN_LIMIT, useProgress } from '../lib/progress'
import { useToast } from '../lib/toast'
import { Markdown, StatementHtml } from '../lib/markdown'
import { Tabs, Tip } from '../lib/motion'
import { loadUiFlag, loadUiNumber, saveUiFlag, saveUiNumber } from '../lib/ui'
import { MOD_KEY } from '../lib/platform'
import { Splitter } from '../components/Splitter'
import { Select } from '../components/Select'
import type { SelectOption } from '../components/Select'
import type { TabItem } from '../lib/motion'
import { CodeLab } from '../components/CodeLab'
import type { CodeLabHandle } from '../components/CodeLab'
import { Analysis } from '../components/Analysis'
import { buildAutoAnalysis, buildProblemAnalysis } from '../lib/analysis'
import { caseCall } from '../lib/cases'
import { resolveSignature } from '../lib/starter'
import { LevelBadge, TierBadge } from '../components/ui'
import type { Problem, Status } from '../lib/types'
import {
  RATING_LABEL,
  cn,
  formatClock,
  formatDuration,
  relativeDay,
  tutorialMarkdowns,
} from '../lib/utils'
import '../styles/analysis.css'

type DetailTab = 'statement' | 'analysis' | 'tutorial' | 'notes'

/** 学习状态下拉：值域和文案照旧（未开始 / 学习中 / 已掌握） */
const STATUS_OPTIONS: Array<SelectOption<Status>> = [
  { value: 'todo', label: '未开始' },
  { value: 'learning', label: '学习中' },
  { value: 'done', label: '已掌握' },
]

/** 分栏下限：左栏题面至少 360px，右栏代码台至少 340px
 *  （1024 宽的笔记本上侧栏 + 内边距吃掉 284px，右栏定 380 会把「+ 用例」按钮裁掉） */
const SPLIT_LEFT_MIN = 360
const SPLIT_RIGHT_MIN = 340

/**
 * 把左栏百分比夹进当前容器的可行区间：左栏 ≥ 360px、右栏 ≥ 340px。
 * 百分比取到 0.1，下限向上取整、上限向下取整，保证夹完真的不低于下限。
 * 容器窄到两栏下限加起来都放不下时（< 746px），优先保左栏 —— 题面读不了比代码台窄更难受。
 */
function clampSplitPct(pct: number, width: number): number {
  if (!Number.isFinite(pct) || width < 1) return pct
  const min = Math.min(100, Math.ceil((SPLIT_LEFT_MIN / width) * 1000) / 10)
  const max = Math.max(min, Math.floor(((width - SPLIT_RIGHT_MIN) / width) * 1000) / 10)
  return Math.min(Math.max(pct, min), max)
}

function stripHeading(markdown: string): string {
  // 结尾用 (\r?\n|$) 兼容「整节只有一行标题」的片段
  return markdown.replace(/^\s*##\s+.*(?:\r?\n|$)/, '')
}

/** 标题比对用的归一化：空格、标点、markdown 记号都不参与比较 */
function squash(text: string): string {
  return text.replace(/[\s#*`_~|]+/g, '')
}

export function ProblemDetail() {
  const { no } = useParams()
  const { byNo, problems } = useData()
  const problem = no ? byNo.get(no) : undefined

  if (!problem) {
    return (
      <div className="detail">
        <div className="empty empty--roomy">
          <div className="empty__mark">?</div>
          <h2>没有这道题</h2>
          <p>题号 {no} 不在当前题库里。</p>
          <Link className="btn empty__cta" to="/problems">
            回题库
          </Link>
        </div>
      </div>
    )
  }

  return (
    <ProblemLoader
      key={problem.no}
      problem={problem}
      prev={problems[problems.findIndex((p) => p.no === problem.no) - 1]}
      next={problems[problems.findIndex((p) => p.no === problem.no) + 1]}
    />
  )
}

/**
 * 题面是懒加载的（全量 4500 道不能全塞进 problems.json），
 * 这一层负责把分片里的题面 / 示例 / 代码模板并到 problem 上，再交给工作台。
 */
function ProblemLoader({
  problem,
  prev,
  next,
}: {
  problem: Problem
  prev?: Problem
  next?: Problem
}) {
  const { detail, loading } = useStatement(problem)

  const full = useMemo<Problem>(() => {
    if (!detail) return problem
    return {
      ...problem,
      statementHtml: detail.html,
      examples: detail.examples,
      method: detail.method || problem.method,
      params: detail.params.length ? detail.params : problem.params,
      starterCode: detail.starterCode,
      hints: detail.hints,
      edgeCases: detail.edgeCases ?? [],
      inPlace: detail.metaData?.output?.paramindex != null,
      // 参考解（AI 生成，只通过官方示例）跟着题面分片一起到，解析 Tab 的「参考答案」块用它
      refCode: detail.refCode,
    }
  }, [problem, detail])

  if (loading) return <DetailSkeleton problem={problem} />
  return <ProblemWorkspace problem={full} prev={prev} next={next} />
}

/** 题面加载中的骨架：保留顶栏和左右两栏的轮廓，避免整页闪一下 */
function DetailSkeleton({ problem }: { problem: Problem }) {
  return (
    <div className="detail">
      <div className="detail__bar">
        <Link to="/problems" className="detail__back">
          <ArrowLeft /> 题库
        </Link>
        <span className="detail__bar-title">
          <span className="mono dim">No.{problem.no}</span> {problem.title}
        </span>
        <div className="detail__bar-meta">
          <LevelBadge level={problem.level} />
          <TierBadge tier={problem.tier} />
        </div>
      </div>
      <div className="detail__body">
        <div className="detail__left">
          <div className="detail__head">
            <div className="sk sk--text" style={{ width: 76 }} />
            <div className="sk sk--title" style={{ width: '54%', marginTop: 12 }} />
            <div className="sk sk--text" style={{ width: '36%', marginTop: 14 }} />
          </div>
          <div style={{ marginTop: 28, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {Array.from({ length: 9 }).map((_, index) => (
              <div
                key={index}
                className="sk sk--text"
                style={{ width: `${94 - (index % 4) * 14}%` }}
              />
            ))}
          </div>
        </div>
        <div className="detail__right">
          <div className="sk" style={{ height: '100%', borderRadius: 0, opacity: 0.35 }} />
        </div>
      </div>
    </div>
  )
}

function ProblemWorkspace({
  problem,
  prev,
  next,
}: {
  problem: Problem
  prev?: Problem
  next?: Problem
}) {
  const { byDoc, problems } = useData()
  const progress = useProgress()
  const { toast } = useToast()
  const navigate = useNavigate()
  const state = progress.stateOf(problem.no)
  const [tab, setTab] = useState<DetailTab>(
    // 全量题库里的题没有题面和精讲，默认停在题面 tab（那里有去力扣的入口），
    // 不然会落到一个空白的「我的笔记」上
    problem.statementHtml
      ? 'statement'
      : problem.tutorial.length
        ? 'tutorial'
        : 'statement',
  )
  const [tutorialIndex, setTutorialIndex] = useState(0)
  const [note, setNote] = useState(state.note)
  const [saved, setSaved] = useState(true)
  const [seconds, setSeconds] = useState(0)
  /** 目录点击后要在精讲里滚到哪个小节（标题），滚动完就清空 */
  const [pendingAnchor, setPendingAnchor] = useState<string | null>(null)
  const labRef = useRef<CodeLabHandle>(null)

  // 题面 / 代码区左右分栏：偏好按百分比存（换窗口大小也不会跳）。
  // 但 1024 宽下 41% 只剩 321px、题面读不了 —— 所以「显示值」按当前容器宽度夹下限，
  // 偏好百分比本身不动：缩到 1024 再放大回 1600，仍然是 41%。
  const bodyRef = useRef<HTMLDivElement>(null)
  /** 偏好百分比（localStorage 里那一份），只由拖拽改写；读一次就够 */
  const [prefPct] = useState(() => loadUiNumber('detail.split', 54))
  // 新手引导：只在第一次进任意题目页出现一次；显示即落盘（否则刷新会重播）
  const [guideOpen, setGuideOpen] = useState(() => !loadUiFlag('guide.problem'))
  useEffect(() => {
    if (!guideOpen) return
    saveUiFlag('guide.problem', true)
  }, [guideOpen])
  const prefPctRef = useRef(prefPct)
  const [splitPct, setSplitPct] = useState(prefPct)

  // 只夹显示值、不写回 localStorage；resize 节流到 rAF，窗口拖拽时每帧最多算一次
  useLayoutEffect(() => {
    const el = bodyRef.current
    if (!el) return
    let frame = 0
    const clamp = () => {
      const width = el.getBoundingClientRect().width
      if (width < 10) return
      setSplitPct(clampSplitPct(prefPctRef.current, width))
    }
    const schedule = () => {
      if (frame) return
      frame = window.requestAnimationFrame(() => {
        frame = 0
        clamp()
      })
    }
    clamp()
    window.addEventListener('resize', schedule)
    // 侧边栏收起 / 展开也会改容器宽度，窗口本身没 resize，靠 ResizeObserver 补上
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
    observer?.observe(el)
    return () => {
      window.removeEventListener('resize', schedule)
      observer?.disconnect()
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [])

  const resizeBody = useCallback((clientX: number) => {
    const el = bodyRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (clientX < 0) {
      // 双击复位：偏好和显示值都回默认
      prefPctRef.current = 54
      saveUiNumber('detail.split', 54)
      setSplitPct(rect.width > 10 ? clampSplitPct(54, rect.width) : 54)
      return
    }
    if (rect.width < 10) return
    const px = Math.max(
      SPLIT_LEFT_MIN,
      Math.min(rect.width - SPLIT_RIGHT_MIN, clientX - rect.left),
    )
    const pct = Math.round((px / rect.width) * 1000) / 10
    prefPctRef.current = pct
    setSplitPct(clampSplitPct(pct, rect.width))
    saveUiNumber('detail.split', pct)
  }, [])
  const tutorialBodyRef = useRef<HTMLDivElement>(null)
  const secondsRef = useRef(0)
  const noteRef = useRef(note)
  noteRef.current = note
  const addTimeRef = useRef(progress.addTime)
  addTimeRef.current = progress.addTime
  const saveNoteRef = useRef(progress.saveNote)
  saveNoteRef.current = progress.saveNote
  const recordOpenRef = useRef(progress.recordOpen)
  recordOpenRef.current = progress.recordOpen

  useEffect(() => {
    recordOpenRef.current(problem.no)
    secondsRef.current = 0
    setSeconds(0)
    const timer = window.setInterval(() => {
      secondsRef.current += 1
      setSeconds(secondsRef.current)
    }, 1000)
    return () => {
      window.clearInterval(timer)
      if (secondsRef.current > 2) {
        addTimeRef.current(problem.no, secondsRef.current)
      }
    }
  }, [problem.no])

  useEffect(() => {
    if (note === state.note) return
    setSaved(false)
    const timer = window.setTimeout(() => {
      progress.saveNote(problem.no, note)
      setSaved(true)
    }, 500)
    return () => window.clearTimeout(timer)
  }, [note, problem.no, progress, state.note])

  useEffect(() => {
    return () => {
      saveNoteRef.current(problem.no, noteRef.current)
    }
  }, [problem.no])

  // 解析 Tab 的数据源：教程章节正文按 problem.tutorial 的顺序取，和初始代码共用同一份
  const markdowns = useMemo(() => tutorialMarkdowns(problem, byDoc), [problem, byDoc])
  // 有精讲就用精讲抽出来的解析；全量题库里的题没有精讲，退回「按标签自动生成」的解析，
  // 并带上官方 hints 与同专题相关题，保证每道题都有讲解入口。
  const view = useMemo(() => {
    if (markdowns.length) return buildProblemAnalysis(problem, markdowns)
    const auto = buildAutoAnalysis(problem)
    const related = problems
      .filter(
        (item) =>
          item.no !== problem.no &&
          item.category === problem.category &&
          item.level === problem.level,
      )
      .slice(0, 6)
    return {
      ...auto,
      hints: problem.hints ?? [],
      related,
    }
  }, [problem, markdowns, problems])
  // 示例卡片拼调用表达式要用真实签名（形参名、节点类型）
  const signature = useMemo(() => resolveSignature(problem, markdowns), [problem, markdowns])

  const tutorialRef = problem.tutorial[tutorialIndex]
  const doc = tutorialRef ? byDoc.get(tutorialRef.docId) : undefined
  const section = doc?.sections.find((s) => s.id === tutorialRef?.sectionId)
  const wrongCount = state.reviews.filter((r) => r.result === 'fail').length

  // 全量题库里的题没有精讲，但「解析」tab 依然给（自动生成版），只有「精讲」需要真教程
  const hasTutorial = problem.tutorial.length > 0
  const tabItems: TabItem[] = [
    { key: 'statement', label: '题面' },
    {
      key: 'analysis',
      label: '解析',
      // 有预生成精讲的题（Hot 100）在标签上打个 AI 标记，提示这里有整篇文章
      count: view.outline.length
        ? view.outline.length
        : problem.hasTeaching
          ? 'AI'
          : undefined,
    },
    ...(hasTutorial
      ? [{ key: 'tutorial', label: '精讲', count: problem.tutorial.length } as TabItem]
      : []),
    { key: 'notes', label: '我的笔记', count: state.note ? '·' : undefined },
  ]

  const loadReferenceCode = (code: string) => {
    const lab = labRef.current
    if (!lab) {
      toast('右侧代码台还没准备好，稍后再试', 'error')
      return
    }
    lab.loadCode(code)
  }

  /** 目录跳转：切到精讲 Tab，必要时先切到含该小节的章节，再滚动过去 */
  const openTutorialAt = (title?: string) => {
    setTab('tutorial')
    if (!title) return
    const wanted = squash(title)
    if (wanted) {
      const index = problem.tutorial.findIndex((ref) => {
        const markdown = byDoc.get(ref.docId)?.sections.find((item) => item.id === ref.sectionId)?.markdown
        return markdown ? squash(markdown).includes(wanted) : false
      })
      if (index >= 0 && index !== tutorialIndex) setTutorialIndex(index)
    }
    setPendingAnchor(title)
  }

  // 精讲 Tab 渲染完再滚动：marked 不给标题加 id，只能按标题文字找元素
  useEffect(() => {
    if (tab !== 'tutorial' || !pendingAnchor) return
    const target = pendingAnchor
    const frame = window.requestAnimationFrame(() => {
      let found: HTMLElement | null = document.getElementById(target)
      const root = tutorialBodyRef.current
      if (!found && root) {
        const wanted = squash(target)
        if (wanted) {
          const headings = Array.from(root.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5'))
          found =
            headings.find((heading) => {
              const text = squash(heading.textContent ?? '')
              return text.length > 0 && (text.includes(wanted) || wanted.includes(text))
            }) ?? null
        }
      }
      if (found) found.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setPendingAnchor(null)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [tab, pendingAnchor, tutorialIndex, doc, section])

  const copyExample = async (call: string, expected: string) => {    // 复制成一行能直接粘到终端里跑的代码，比只复制表达式有用
    const snippet = expected ? `print(${call})  # 期望输出：${expected}` : `print(${call})`
    try {
      if (!navigator.clipboard) throw new Error('no clipboard')
      await navigator.clipboard.writeText(snippet)
      toast('已复制到剪贴板', 'success')
    } catch {
      toast('复制失败，请手动选中文本', 'error')
    }
  }

  return (
    <div className="detail">
      <div className="detail__bar">
        <Link to="/problems" className="detail__back">
          <ArrowLeft /> 题库
        </Link>
        <span className="detail__bar-title">
          <span className="mono dim">No.{problem.no}</span> {problem.title}
        </span>
        <div className="detail__bar-meta">
          <LevelBadge level={problem.level} />
          <TierBadge tier={problem.tier} />
          {state.wrong ? (
            <span className="badge" data-tier="P0">
              错题
            </span>
          ) : null}
        </div>
        <div className="detail__bar-actions">
          <span className="detail__timer" title="本次学习计时">
            <Clock style={{ width: 10, height: 10, verticalAlign: -1 }} />{' '}
            {formatClock(seconds)}
          </span>
          <Select
            ariaLabel="学习状态"
            value={state.status}
            options={STATUS_OPTIONS}
            onChange={(next) => progress.setStatus(problem.no, next)}
            size="sm"
            align="end"
          />
          <button
            className={cn('btn btn--sm', state.wrong && 'btn--danger')}
            onClick={() => {
              progress.toggleWrong(problem.no)
              toast(state.wrong ? '已移出错题本' : '已加入错题本')
            }}
          >
            <RotateCcw /> {state.wrong ? '移出错题' : '记为错题'}
          </button>
          {problem.leetcodeUrl ? (
            <a
              className="icon-btn"
              href={problem.leetcodeUrl}
              target="_blank"
              rel="noreferrer"
              title="在 LeetCode 打开"
            >
              <ExternalLink />
            </a>
          ) : null}
          <button
            className="icon-btn"
            disabled={!prev}
            onClick={() => prev && navigate(`/problems/${prev.no}`)}
            title={prev ? `上一题：${prev.title}` : '已经是第一题'}
          >
            <ChevronLeft />
          </button>
          <button
            className="icon-btn"
            disabled={!next}
            onClick={() => next && navigate(`/problems/${next.no}`)}
            title={next ? `下一题：${next.title}` : '已经是最后一题'}
          >
            <ChevronRight />
          </button>
        </div>
      </div>

      <div
        className="detail__body"
        ref={bodyRef}
        style={{ '--detail-split': `${splitPct}%` } as CSSProperties}
      >
        <div className="detail__left">
          <div className="detail__head">
            <div className="detail__no">LEETCODE · {problem.no}</div>
            {/* 和题库列表共享同一个转场名：点题时标题从行里飞过来 */}
            <h1 className="detail__title" style={{ viewTransitionName: 'problem-title' }}>
              {problem.title}
              {problem.hot100 ? (
                <span
                  className="hot-badge"
                  title={`LeetCode 热题 100${problem.hot100Group ? ` · ${problem.hot100Group}` : ''}`}
                >
                  <Flame /> HOT
                </span>
              ) : null}
            </h1>
            <div className="detail__meta">
              {problem.tags.map((tag) => (
                <span className="tag" key={tag}>
                  {tag}
                </span>
              ))}
              <span className="sep" />
              <span className="detail__stat">{problem.category}</span>
              {problem.huaweiFreq ? (
                <>
                  <span className="sep" />
                  <span className="detail__stat detail__stat--hot">
                    华为频度 {problem.huaweiFreq}
                  </span>
                </>
              ) : null}
              {problem.acRate != null ? (
                <>
                  <span className="sep" />
                  <span className="detail__stat">通过率 {problem.acRate.toFixed(1)}%</span>
                </>
              ) : null}
              {problem.estMin ? (
                <>
                  <span className="sep" />
                  <span className="detail__stat">建议 {problem.estMin} 分钟</span>
                </>
              ) : null}
              {problem.complexity ? (
                <>
                  <span className="sep" />
                  <Tip
                    className="tip-anchor--plain"
                    content={
                      <>
                        <span className="tip__term">
                          最优 {problem.complexity.time}
                          {problem.complexity.space ? ` · 空间 ${problem.complexity.space}` : ''}
                        </span>
                        <span className="tip__hint">
                          {problem.complexity.loops}｜{problem.complexity.why}
                        </span>
                      </>
                    }
                  >
                    <span className="detail__stat detail__cx">
                      最优 <b className="mono">{problem.complexity.time}</b>
                      {problem.complexity.space ? (
                        <>
                          {' '}
                          · 空间 <span className="mono">{problem.complexity.space}</span>
                        </>
                      ) : null}
                    </span>
                  </Tip>
                </>
              ) : null}
            </div>
          </div>

          {/* 第一次进题目页给一次三步提示：显示即落盘标记，刷新不会重播 */}
          {guideOpen ? (
            <div className="guide" role="status">
              <div className="guide__head">
                <span className="guide__badge">第一次刷题？三步走</span>
                <button
                  className="guide__close"
                  onClick={() => setGuideOpen(false)}
                  aria-label="关闭新手提示"
                >
                  <X />
                </button>
              </div>
              <ol className="guide__steps">
                <li>
                  <strong>先读题</strong>：把「输入 / 输出 / 边界」各写一句，再动键盘。
                </li>
                <li>
                  <strong>写实现</strong>：右侧把模板里的 <code>pass</code> 换掉，随时按{' '}
                  <span className="kbd">{MOD_KEY} Enter</span> 运行。
                </li>
                <li>
                  <strong>看结果</strong>：官方示例是硬标准；标着「边界」的用例来自构建期生成，
                  与参考解不一致只提示、不判红。
                </li>
              </ol>
            </div>
          ) : null}

          <div className="detail__tabs">
            <Tabs
              items={tabItems}
              value={tab}
              onChange={(key) => setTab(key as DetailTab)}
            />
          </div>

          {tab === 'statement' ? (
            <div className="detail__section">
              {problem.statementHtml ? (
                <>
                  <StatementHtml html={problem.statementHtml} />
                  {problem.examples.length ? (
                    <div className="an__examples">
                      <div className="detail__statement-head">
                        <h2>示例</h2>
                        <span className="an__note">
                          {problem.examples.length} 条 · 可单条载入右侧用例台
                        </span>
                      </div>
                      {problem.examples.map((example, index) => {
                        // 调用表达式统一交给 cases.caseCall：按真实形参名对齐、非法实参整组丢掉，
                        // 生成不出来（返回空串）时按钮置灰，提示用户自己去用例台填实参
                        const call = caseCall(problem, example, signature)
                        return (
                          <div className="example" key={`${example.callArgs}-${index}`}>
                            <div className="example__head">
                              <span>示例 {index + 1}</span>
                              <div className="an__ex-actions">
                                <button
                                  className="an__ex-btn"
                                  disabled={!call}
                                  onClick={() => call && labRef.current?.loadCase(call, example.output)}
                                  title={
                                    call
                                      ? `把 ${call} 加到右侧用例列表`
                                      : '这条示例的实参没法自动拼，去右侧用例台手填'
                                  }
                                >
                                  <Play /> 载入用例
                                </button>
                                <button
                                  className="an__ex-btn"
                                  disabled={!call}
                                  onClick={() => call && void copyExample(call, example.output)}
                                  title="复制成一行可直接粘贴运行的 print 调用"
                                >
                                  <Copy /> 复制
                                </button>
                              </div>
                            </div>
                            <div className="example__row">
                              <span className="example__label">输入</span>
                              <span className="example__value">{example.input || call}</span>
                            </div>
                            <div className="example__row">
                              <span className="example__label">输出</span>
                              <span className="example__value">{example.output || '（未收录）'}</span>
                            </div>
                            {example.explain ? (
                              <div className="example__row">
                                <span className="example__label">解释</span>
                                <span className="example__value example__explain">{example.explain}</span>
                              </div>
                            ) : null}
                          </div>
                        )
                      })}
                      <div className="mono example__foot">
                        示例已同步到右侧代码台 · 也可以点「载入用例」单独加一条
                      </div>
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="notes-empty">
                  <div className="notes-empty__title">
                    {problem.paid
                      ? '这是 Plus 会员专享题'
                      : problem.curated
                        ? '这道题的题面没有收录'
                        : '这是全量题库里的题'}
                  </div>
                  {problem.paid
                    ? '力扣把这道题的题面锁在会员区，站外抓不到。点下面的按钮登录你的账号就能看。'
                    : problem.curated
                      ? '这道题没有题号或链接，无法自动抓取。'
                      : '题面只给精选题做了本地缓存，这一道需要去力扣看原题。右侧代码台和终端照常可用。'}
                  {problem.curated ? '你仍然可以看精讲、写代码，' : ''}
                  {problem.leetcodeUrl ? '或到 LeetCode 查看原题。' : '或换一道题。'}
                  {problem.leetcodeUrl ? (
                    <div className="notes-empty__cta">
                      <a className="btn btn--sm" href={problem.leetcodeUrl} target="_blank" rel="noreferrer">
                        <ExternalLink /> 去 LeetCode 看题
                      </a>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          ) : null}

          {tab === 'analysis' ? (
            <div className="detail__section">
              <Analysis
                problem={problem}
                view={view}
                onLoadCode={loadReferenceCode}
                onReveal={() => progress.recordReveal(problem.no)}
                onOpenTutorial={openTutorialAt}
              />
            </div>
          ) : null}

          {tab === 'tutorial' ? (
            <div className="detail__section">
              {problem.tutorial.length === 0 ? (
                <div className="notes-empty">
                  <div className="notes-empty__title">这道题还没有配套精讲</div>
                  先在代码台自己写一遍，再去题库里找同专题的题看讲解。
                  <div className="notes-empty__cta">
                    <Link className="btn btn--sm" to="/tutorials">
                      <BookOpen /> 去教程书架
                    </Link>
                  </div>
                </div>
              ) : (
                <>
                  {problem.tutorial.length > 1 ? (
                    <div className="tutorial-select">
                      {problem.tutorial.map((ref, index) => (
                        <button
                          key={`${ref.docId}-${ref.sectionId}`}
                          className={`chip${index === tutorialIndex ? ' active' : ''}`}
                          onClick={() => setTutorialIndex(index)}
                        >
                          {ref.kind === 'review' ? '回顾 · ' : ''}
                          {ref.docTitle.replace(/^\d+-/, '')}
                        </button>
                      ))}
                    </div>
                  ) : null}

                  {doc && section ? (
                    <div className="tutorial-ref">
                      <div className="tutorial-ref__head">
                        <BookOpen style={{ width: 13, height: 13 }} />
                        来自 <strong>{doc.title}</strong>
                        <span className="tutorial-ref__open">
                          <Link
                            to={`/tutorials/${doc.id}#sec-${section.index}`}
                            className="card__link"
                          >
                            打开原文 <ArrowRight />
                          </Link>
                        </span>
                      </div>
                      <div className="tutorial-ref__body" ref={tutorialBodyRef}>
                        <div className="reader__section-head tutorial-ref__title">
                          <div>
                            <div className="reader__section-no">
                              {tutorialRef?.kind === 'review' ? 'REVIEW' : 'LESSON'}
                            </div>
                            <h2>{section.title.replace(/^##\s+/, '')}</h2>
                          </div>
                          {section.level ? <LevelBadge level={section.level} /> : null}
                        </div>
                        <Markdown markdown={stripHeading(section.markdown)} />
                      </div>
                    </div>
                  ) : (
                    <div className="notes-empty">精讲内容读取失败，请刷新页面。</div>
                  )}
                </>
              )}
            </div>
          ) : null}

          {tab === 'notes' ? (
            <div className="detail__section">
              <div className="notes-head">
                <div>
                  <div className="eyebrow">Self review</div>
                  <div className="card__title">这题我到底会不会？</div>
                </div>
                <span className={cn('notes-head__state', saved && 'is-saved')}>
                  {saved ? '已自动保存' : '保存中…'}
                </span>
              </div>

              <div className="rating-row">
                {(['read', 'recall', 'variant'] as const).map((rating) => (
                  <button
                    key={rating}
                    className={`rating-chip${state.selfRating === rating ? ' active' : ''}`}
                    onClick={() => progress.setRating(problem.no, rating)}
                  >
                    {RATING_LABEL[rating]}
                  </button>
                ))}
                <span className="rating-hint">三遍法：看懂 → 默写 → 变形</span>
              </div>

              <textarea
                className="note-area"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={
                  '记什么最有用：\n\n1. 这题的关键句（面试时能一句话说清）\n2. 我卡在哪一步、为什么卡\n3. 边界用例：空输入、单元素、重复元素…\n4. 下次重做时要提醒自己的事'
                }
              />

              <div className="notes-stats">
                <span>
                  累计用时 <strong>{formatDuration(state.timeSpentSec + seconds)}</strong>
                </span>
                <span>
                  运行 <strong>{state.attempts}</strong> 次
                </span>
                <span>
                  通过 <strong className="is-success">{state.passes}</strong> 次
                </span>
                <span>
                  错题记录 <strong className="is-danger">{wrongCount}</strong> 次
                </span>
              </div>

              {/* 运行记录：每次点「运行」记一条（三态：通过 / 未通过 / 未判定）。
                  下面的 Review history 是「复习记录」（间隔复习的通过 / 未通过），两块别混。 */}
              <div className="notes-history">
                <div className="eyebrow notes-history__label">Run history · 提交记录</div>
                {state.runs.length ? (
                  state.runs
                    .slice(-RUN_LIMIT)
                    .reverse()
                    .map((run, index) => (
                      <div
                        key={`${run.at}-${index}`}
                        className="stat-line stat-line--tight"
                      >
                        <span className="stat-line__label">
                          {/* 复用难度徽章的配色：Easy 绿 / Hard 红；未判定用裸 badge（中性灰） */}
                          <span
                            className={cn(
                              'badge',
                              run.passed === true && 'badge--Easy',
                              run.passed === false && 'badge--Hard',
                            )}
                          >
                            {run.passed === true
                              ? '通过'
                              : run.passed === false
                                ? '未通过'
                                : '未判定'}
                          </span>
                          {relativeDay(run.at)}
                        </span>
                        <span className="stat-line__value">{run.ms} ms</span>
                      </div>
                    ))
                ) : (
                  <div className="stat-line stat-line--tight">
                    <span className="stat-line__label dim">
                      还没有运行记录，写完点右上角运行
                    </span>
                  </div>
                )}
              </div>

              {state.reviews.length ? (
                <div className="notes-history">
                  <div className="eyebrow notes-history__label">Review history · 复习记录</div>
                  {state.reviews
                    .slice(-6)
                    .reverse()
                    .map((review, index) => (
                      <div
                        key={`${review.at}-${index}`}
                        className="stat-line stat-line--tight"
                      >
                        <span className="stat-line__label">
                          <span
                            className="status-dot"
                            data-status={review.result === 'pass' ? 'done' : 'learning'}
                          />
                          {review.result === 'pass' ? '复习通过' : '复习未通过'}
                        </span>
                        <span className="stat-line__value">{relativeDay(review.at)}</span>
                      </div>
                    ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <Splitter
          orientation="vertical"
          onResize={resizeBody}
          label="拖动调整题面与代码区的宽度（双击复位）"
        />

        <div className="detail__right">
          <CodeLab ref={labRef} problem={problem} />
        </div>
      </div>
    </div>
  )
}
