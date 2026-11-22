/**
 * 题目「解析」Tab：把教程里的零散小节重新排成一张「纸上算法实验室」的速览页。
 * 只负责展示与交互，取数据（buildProblemAnalysis）和 AI 请求（useAiAnalysis）都在 lib 里。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Check, Copy, Eraser, Loader2, Sparkles } from 'lucide-react'
import { Markdown } from '../lib/markdown'
import { useToast } from '../lib/toast'
import { useTeaching } from '../lib/data'
import { useAiAnalysis } from '../lib/ai-analysis'
import { Collapse, PlusMinus } from '../lib/motion'
import { LEVEL_LABEL } from '../lib/utils'
import type { AnalysisBlock, ProblemAnalysisView } from '../lib/analysis'
import type { Problem } from '../lib/types'
import '../styles/analysis.css'

async function copyText(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard) return false
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/** 深色代码块 + 行号；行号 sticky 在左边，横向滚动时不会跟着跑掉 */
function CodeBlock({ code }: { code: string }) {
  const lines = useMemo(() => code.replace(/\n+$/, '').split('\n'), [code])
  return (
    <div className="an__code-scroll">
      <div className="an__code-grid">
        {lines.map((line, index) => (
          <div className="an__code-line" key={index}>
            <span className="an__code-no">{index + 1}</span>
            <span className="an__code-txt">{line || ' '}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function MarkdownBlock({
  block,
  empty,
}: {
  block: AnalysisBlock | null
  empty: string
}) {
  if (!block || !block.markdown.trim()) {
    return <p className="an__empty">{empty}</p>
  }
  return <Markdown markdown={block.markdown} className="an__prose" />
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="an__fact">
      <span className="an__fact-label">{label}</span>
      <span className="an__fact-value">{value}</span>
    </div>
  )
}

// N 叉树（559/589/590/429）前端已支持；四叉树（427/558）与 NestedInteger（385）还没有
const UNSUPPORTED_NODE_NOS = new Set(['427', '558', '385'])

export function Analysis({
  problem,
  view,
  onLoadCode,
  onReveal,
  onOpenTutorial,
}: {
  problem: Problem
  view: ProblemAnalysisView
  onLoadCode: (code: string) => void
  /** 展开参考答案时回调一次：用于记「看答案」的学习信号 */
  onReveal?: () => void
  onOpenTutorial: (blockTitle?: string) => void
}) {
  const { toast } = useToast()
  const ai = useAiAnalysis(problem)
  const { teaching } = useTeaching(problem)
  const hasTeach = Boolean(teaching)
  const [copied, setCopied] = useState(false)
  // 折叠展开（手风琴）：默认全开；「参考答案」例外 —— 默认收起，先自己想再看
  const [folded, setFolded] = useState<Record<string, boolean>>({ reference: true })
  const toggleFold = (key: string) => {
    // 展开参考答案时记一笔（只在「从关到开」时记，收起不算）
    if (key === 'reference' && !isOpen('reference')) onReveal?.()
    setFolded((prev) => ({ ...prev, [key]: !prev[key] }))
  }
  const isOpen = (key: string) => !folded[key]
  const cx = view.complexity ?? problem.complexity

  /**
   * 没有精讲、也没有预生成讲解的题：打开「解析」就让 AI 自己读题面去写。
   * 每个题号每个会话只自动触发一次，失败（没配 Key / 断网）就停在错误态，
   * 不反复重试 —— 想再试可以点「重新生成」。
   */
  const autoTried = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!view.auto || hasTeach) return
    // 没有题面（会员题）就不自动生成：让模型凭空猜题意比不生成更糟
    if (!problem.statementHtml) return
    if (ai.text || ai.busy || ai.error) return
    if (autoTried.current.has(problem.no)) return
    autoTried.current.add(problem.no)
    ai.generate()
  }, [view.auto, hasTeach, ai, problem.no, problem.statementHtml])
  // 只有 Key / 代理类错误才提示去改 .env.local；429、断网这些提示那句话只会误导人
  const keyIssue = ai.error ? /401|404|Key|DEEPSEEK|代理/.test(ai.error) : false

  // 参考解：AI 生成、只保证通过全部官方示例。没有参考解的题（约 1000 道）不显示这块
  // 参考答案优先用 AI 参考解；没有 AI 参考解、但精讲里有配套代码的题（34 道）
  // 退回精讲代码，并明确标出来源 —— 不能把「精讲里的示例代码」冒充成「过过示例校验的参考解」。
  const refCode = problem.refCode?.trim() ? problem.refCode : null
  const tutorialCode = refCode ? null : view.referenceCode?.trim() || null
  const shownCode = refCode ?? tutorialCode
  // 这几道题的参数/返回值是 N 叉树 / 四叉树 / NestedInteger，本地运行器的前导还没支持，
  // 载入到编辑器会直接报 NameError —— 只给看代码，不给「载入」按钮。
  const nodeUnsupported = UNSUPPORTED_NODE_NOS.has(String(problem.no).trim())
  const codeFromTutorial = !refCode && Boolean(tutorialCode)

  const copyReference = async () => {
    if (!shownCode) return
    const ok = await copyText(shownCode)
    if (ok) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
      toast('已复制参考解代码', 'success')
    } else {
      toast('复制失败，请手动选中代码', 'error')
    }
  }

  return (
    <div className="an">
      {/* ① 速览 */}
      <section className="an__brief">
        <div className="an__brief-head">
          <span className="an__eyebrow">速览</span>
          <span className="an__brief-meta">
            {view.auto ? (
              <span className="an__auto" title="这道题没有配套精讲，下面的解析是按标签自动生成的">
                自动解析
              </span>
            ) : null}
            <span className="an__level">{LEVEL_LABEL[problem.level]}</span>
          </span>
        </div>
        <p className="an__oneliner">
          {view.oneLiner || '教程里没有写一句话概括，直接看下面的考点和参考实现。'}
        </p>
        <div className="an__facts">
          {/* 没有数据的格子直接不显示，别排一排「—」 */}
          {cx?.time ? <Fact label="最优时间" value={cx.time} /> : null}
          {cx?.space ? <Fact label="空间" value={cx.space} /> : null}
          {problem.estMin ? <Fact label="建议时长" value={`${problem.estMin} 分钟`} /> : null}
          {problem.huaweiFreq == null ? null : (
            <Fact label="华为频度" value={`${problem.huaweiFreq}`} />
          )}
          <Fact
            label="通过率"
            value={problem.acRate == null ? '—' : `${problem.acRate.toFixed(1)}%`}
          />
        </div>
        {problem.tags.length ? (
          <div className="an__tags">
            {problem.tags.map((tag) => (
              <span className="tag" key={tag}>
                {tag}
              </span>
            ))}
          </div>
        ) : null}
        {cx?.loops ? <p className="an__loops">{cx.loops}</p> : null}
      </section>

      {/* ①.5 官方提示（LeetCode 题面里的 hints，有就展示） */}
      {view.hints?.length ? (
        <section className="an__card an__card--hints">
          <div className="an__head">
            <div>
              <span className="an__eyebrow">Hints</span>
              <h3 className="an__title">官方提示</h3>
            </div>
            <span className="an__note">来自力扣题面，点开前先自己想</span>
          </div>
          <ol className="an__hints">
            {view.hints.map((hint, index) => (
              <li key={index}>
                <span className="an__hints-no">{String(index + 1).padStart(2, '0')}</span>
                <Markdown markdown={hint} className="an__prose" />
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {/* ①.6 参考答案：默认收起。数据是 AI 写的参考解，只过了官方示例这一道关，
          不能标成「已通过校验 / 可以放心用」—— 边界期望值本来就是从它推出来的，
          拿它验证自己是循环论证。放在「官方提示」后面：都是「先自己想」的剧透材料。 */}
      {shownCode ? (
        <section className="an__card an__card--code">
          <div className="an__head">
            <div>
              <span className="an__eyebrow">{codeFromTutorial ? '摘自配套精讲 · Python' : 'AI 生成 · Python'}</span>
              <h3 className="an__title">{codeFromTutorial ? '参考代码 · 摘自精讲' : '参考答案 · AI 生成'}</h3>
              <p className="an__ref-sub">{codeFromTutorial ? '来自配套精讲，未单独跑过校验' : '仅通过官方示例校验，不保证边界情况正确'}</p>
            </div>
            <div className="an__head-actions">
              <span className="an__ref-hint">先自己想 20 分钟再看</span>
              <button
                className="an__btn"
                onClick={() => void copyReference()}
                title="复制完整代码"
              >
                {copied ? <Check /> : <Copy />}
                {copied ? '已复制' : '复制'}
              </button>
              <button
                className="an__btn an__btn--accent"
                onClick={() => onLoadCode(shownCode)}
                disabled={nodeUnsupported}
                title={
                  nodeUnsupported
                    ? '这道题的参数是 N 叉树 / 四叉树 / 嵌套列表，本地运行器还没支持，只能看代码'
                    : '把这份代码放进右侧编辑器（会覆盖当前内容），载入后可以直接运行'
                }
              >
                <ArrowRight /> {nodeUnsupported ? '本地跑不了' : '载入到编辑器'}
              </button>
              <button
                className="an__fold"
                onClick={() => toggleFold('reference')}
                aria-expanded={isOpen('reference')}
                aria-label={isOpen('reference') ? '收起参考答案' : '展开参考答案'}
                title={isOpen('reference') ? '收起' : '展开'}
              >
                <PlusMinus open={isOpen('reference')} />
              </button>
            </div>
          </div>
          <Collapse open={isOpen('reference')}>
            <CodeBlock code={shownCode} />
            <p className="an__ref-foot">
              这份代码由 AI 生成，只保证通过官方示例；边界情况、特殊输入没经过验证，别当成标准答案背。
            </p>
          </Collapse>
        </section>
      ) : null}

      {/* ①.7 预生成的深度讲解（Hot 100）：读完题面再写的一整篇文章 */}
      {hasTeach ? (
        <section className="an__teach">
          <div className="an__teach-head">
            <div>
              <span className="an__eyebrow">AI 精讲 · 读过题面</span>
              <h3 className="an__teach-title">{problem.title}</h3>
            </div>
            <span className="an__teach-meta">
              {teaching ? teaching.length.toLocaleString('zh-CN') : 0} 字 · DeepSeek 读题后生成
            </span>
          </div>
          <Markdown markdown={teaching ?? ''} className="an__teach-body" />
        </section>
      ) : null}

      {!hasTeach ? (
        <>
      {/* ② 考什么 / 常见误区 */}
      <div className="an__pair">
        <section className="an__card">
          <div className="an__head">
            <div>
              <span className="an__eyebrow">考点</span>
              <h3 className="an__title">考什么</h3>
            </div>
          </div>
          <MarkdownBlock
            block={view.examPoints}
            empty="教程里没有单独写「考什么」，从标签和参考实现里自己归纳一下。"
          />
        </section>
        <section className="an__card an__card--warn">
          <div className="an__head">
            <div>
              <span className="an__eyebrow">易错</span>
              <h3 className="an__title">常见误区</h3>
            </div>
          </div>
          <MarkdownBlock
            block={view.pitfalls}
            empty="这道题没有整理误区。自己写完后回头补一条：我卡在哪。"
          />
        </section>
      </div>

      {/* 思路 */}
      {view.idea ? (
        <section className="an__card">
          <div className="an__head">
            <div>
              <span className="an__eyebrow">思路</span>
              <h3 className="an__title">{view.idea.title.replace(/^#+\s*/, '')}</h3>
            </div>
          </div>
          <Markdown markdown={view.idea.markdown} className="an__prose" />
        </section>
      ) : null}

      {/* ④ 走一遍 */}
      <section className="an__card">
        <div className="an__head">
          <div>
            <span className="an__eyebrow">推演</span>
            <h3 className="an__title">
              {view.walkthrough ? view.walkthrough.title.replace(/^#+\s*/, '') : '拿示例走一遍'}
            </h3>
          </div>
          <div className="an__head-actions">
            <button
              className="an__fold"
              onClick={() => toggleFold('walkthrough')}
              aria-expanded={isOpen('walkthrough')}
              aria-label={isOpen('walkthrough') ? '收起推演' : '展开推演'}
              title={isOpen('walkthrough') ? '收起' : '展开'}
            >
              <PlusMinus open={isOpen('walkthrough')} />
            </button>
          </div>
        </div>
        <Collapse open={isOpen('walkthrough')}>
          <MarkdownBlock
            block={view.walkthrough}
            empty="教程里没有逐步推演，建议自己拿第一个示例在纸上走一遍。"
          />
        </Collapse>
      </section>

      {/* 面试追问 */}
      {view.interview ? (
        <section className="an__card">
          <div className="an__head">
            <div>
              <span className="an__eyebrow">追问</span>
              <h3 className="an__title">{view.interview.title.replace(/^#+\s*/, '')}</h3>
            </div>
            <div className="an__head-actions">
              <button
                className="an__fold"
                onClick={() => toggleFold('interview')}
                aria-expanded={isOpen('interview')}
                aria-label={isOpen('interview') ? '收起追问' : '展开追问'}
                title={isOpen('interview') ? '收起' : '展开'}
              >
                <PlusMinus open={isOpen('interview')} />
              </button>
            </div>
          </div>
          <Collapse open={isOpen('interview')}>
            <Markdown markdown={view.interview.markdown} className="an__prose" />
          </Collapse>
        </section>
      ) : null}
        </>
      ) : null}

      {/* ④.5 相关题：同专题同难度，练完这道接着练 */}
      {view.related?.length ? (
        <section className="an__card">
          <div className="an__head">
            <div>
              <span className="an__eyebrow">Related</span>
              <h3 className="an__title">同专题的相关题</h3>
            </div>
            <span className="an__note">同一专题、同一难度</span>
          </div>
          <div className="an__related">
            {view.related.map((item) => (
              <Link className="an__related-item" key={item.no} to={`/problems/${item.no}`}>
                <span className="an__related-no mono">No.{item.no}</span>
                <span className="an__related-title">{item.title}</span>
                {item.hot100 ? <span className="hot-badge">HOT</span> : null}
                <ArrowRight className="an__related-arrow" />
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {/* ⑤ AI 深度解析 */}
      <section className="an__card an__card--ai">
        <div className="an__head">
          <div>
            <span className="an__eyebrow">AI 解析</span>
            <h3 className="an__title">AI 深度解析</h3>
          </div>
          <div className="an__head-actions">
            {ai.busy ? (
              // busy 时「生成」按钮被「停止」顶掉，等价于禁用，不会重复触发两次生成。
              // 注意这里必须调 stop 而不是 clear：clear 会连已收到的文本和缓存一起删掉，
              // 用户点「停止」的本意只是不想再等了。
              <button className="an__btn" onClick={ai.stop} title="停止生成；已经写出来的部分会存下来">
                <Eraser /> 停止
              </button>
            ) : (
              <>
                {ai.text ? (
                  <button className="an__btn" onClick={ai.clear} title="清空并删除这题的缓存">
                    <Eraser /> 清空
                  </button>
                ) : null}
                <button className="an__btn an__btn--accent" onClick={ai.generate}>
                  <Sparkles /> {ai.text ? '重新生成' : '生成解析'}
                </button>
              </>
            )}
          </div>
        </div>

        {ai.error ? (
          <div className="an__error">
            {ai.error}
            {keyIssue ? (
              <span className="an__error-hint">
                提示：Key 放在 app/.env.local 的 DEEPSEEK_API_KEY，改完要重启 npm run dev。
              </span>
            ) : null}
          </div>
        ) : null}

        {!ai.text && !ai.busy && !ai.error ? (
          <div className="an__ai-empty">
            <p>
              让 DeepSeek 按固定六段（一句话 / 思路 / 关键步骤 / 复杂度 / 边界用例 / 常见坑）
              再讲一遍，适合精讲看不下去的时候。
            </p>
            <p className="an__note">
              生成一次约 10 秒，结果按题号缓存在本机，不会重复花钱。中途切到别的 Tab 也不会中断。
            </p>
          </div>
        ) : null}

        {ai.busy ? (
          <div className="an__thinking">
            <Loader2 className="spin" />{' '}
            {ai.text ? '还在写…切到别的 Tab 不会中断，回来能接着看' : '正在写解析…'}
          </div>
        ) : null}

        {ai.text ? (
          <div className="an__ai-body">
            <Markdown markdown={ai.text} className="an__prose" />
          </div>
        ) : null}

        {ai.interrupted && !ai.busy ? (
          <p className="an__note">
            上次生成中途停了，上面是已经写出来的部分（已存在本机，切回来还在）。点「重新生成」会从头写一份完整的。
          </p>
        ) : null}
      </section>

      {/* ⑥ 目录 */}
      {view.outline.length ? (
        <section className="an__toc">
          <div className="an__head">
            <div>
              <span className="an__eyebrow">目录</span>
              <h3 className="an__title">精讲目录</h3>
            </div>
            <span className="an__note">点一条跳到「精讲」Tab 对应小节</span>
          </div>
          <ol className="an__toc-list">
            {view.outline.map((block) => (
              <li className="an__toc-item" data-level={block.level} key={block.id}>
                <button className="an__toc-link" onClick={() => onOpenTutorial(block.title)}>
                  <span className="an__toc-text">{block.title.replace(/^#+\s*/, '')}</span>
                  <ArrowRight className="an__toc-arrow" />
                </button>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  )
}
