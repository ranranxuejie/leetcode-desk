import { useEffect, useRef, useState } from 'react'
import { Eraser, Loader2, Send, Sparkles, Square } from 'lucide-react'
import { Markdown } from '../lib/markdown'
import {
  askFollowUp,
  clearSession,
  codeMessageOf,
  reviewCode,
  stopStreaming,
  useAiSession,
  type RunSummary,
} from '../lib/ai'
import type { Problem } from '../lib/types'

const VERDICT_TEXT: Record<string, string> = {
  pass: '✅ 判定通过',
  fail: '❌ 有错误',
  unknown: '⚠️ 无法确定',
}

export function AiReview({
  problem,
  code,
  run,
}: {
  problem: Problem
  code: string
  run: RunSummary | null
}) {
  const session = useAiSession(problem.no)
  const [input, setInput] = useState('')
  const bodyRef = useRef<HTMLDivElement>(null)
  const prevBusy = useRef(session.busy)
  const hasReview = Boolean(session.codeMessage)
  const busy = session.busy
  // 代码改过但还没重新判
  const stale = hasReview && session.codeMessage !== codeMessageOf(code)

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
  }, [session.streaming, session.chat.length])

  // 判题刚结束：滚回顶部，让「判定」第一眼就能看到；追问结束则停在底部
  useEffect(() => {
    if (prevBusy.current && !busy && bodyRef.current) {
      bodyRef.current.scrollTop = session.chat.length <= 1 ? 0 : bodyRef.current.scrollHeight
    }
    prevBusy.current = busy
  }, [busy, session.chat.length])

  const start = () => {
    void reviewCode(problem, code, run)
  }

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    const text = input.trim()
    if (!text || busy) return
    setInput('')
    void askFollowUp(problem, text)
  }

  return (
    <div className="ai">
      <div className="ai__bar">
        <span className={`ai__verdict ai__verdict--${session.verdict ?? 'none'}`}>
          {busy ? 'AI 正在读代码…' : session.verdict ? VERDICT_TEXT[session.verdict] : '还没判过'}
        </span>
        {stale && !busy ? (
          <span className="ai__stale" title="代码改过了，判定结果是旧的">
            代码已修改
          </span>
        ) : null}
        <div className="ai__actions">
          {busy ? (
            <button className="btn" onClick={stopStreaming} title="停止生成">
              <Square /> 停止
            </button>
          ) : (
            <button className="btn" onClick={start} title="把当前代码重新发给 AI">
              <Sparkles /> {hasReview ? '重新判题' : 'AI 判题'}
            </button>
          )}
          {hasReview ? (
            <button
              className="btn"
              onClick={() => clearSession(problem.no)}
              title="清空这个题目的对话"
              disabled={busy}
            >
              <Eraser />
            </button>
          ) : null}
        </div>
      </div>

      <div className="ai__body" ref={bodyRef}>
        {session.error ? (
          <div className="ai__error">
            {session.error}
            <div className="ai__error-hint">
              提示：Key 放在 app/.env.local，改完要重启 npm run dev。
            </div>
          </div>
        ) : null}

        {!hasReview && !busy && !session.error ? (
          <div className="ai__empty">
            <div className="ai__empty-title">让 AI 批改这段代码</div>
            <p>
              会把<b>题面、示例、你的代码</b>一起发给 DeepSeek。判对了就过；判错了会指出
              <b>错在第几行、这段代码实际会输出什么、正确写法长什么样</b>。
            </p>
            <p className="ai__empty-note">
              每道题一个独立会话，换题不会带上上一题的历史；追问只保留最近几轮。
            </p>
            <button className="btn btn--run" onClick={start}>
              <Sparkles /> 开始判题
            </button>
          </div>
        ) : null}

        {busy && !session.streaming ? (
          <div className="ai__thinking">
            <Loader2 className="spin" /> 正在读题面和代码…
          </div>
        ) : null}

        {session.streaming ? (
          <div className="ai__md">
            <Markdown markdown={session.streaming} />
          </div>
        ) : null}

        {!busy && session.chat.length ? (
          <div className="ai__md ai__md--final">
            <Markdown markdown={session.chat.map((t) => t.content).join('\n\n---\n\n')} />
          </div>
        ) : null}
      </div>

      <form className="ai__ask" onSubmit={submit}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            hasReview ? '追问：为什么这里要用 while？/ 换个写法行不行？' : '先点「AI 判题」，再追问'
          }
          disabled={!hasReview || busy}
          spellCheck={false}
        />
        <button type="submit" className="btn" disabled={!hasReview || busy || !input.trim()}>
          <Send />
        </button>
      </form>
    </div>
  )
}
