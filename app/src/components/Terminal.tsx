import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { ForwardRefExoticComponent, KeyboardEvent, RefAttributes } from 'react'
import { Braces, Eraser, FileCode2, Loader2, RotateCcw, X } from 'lucide-react'
import type { SessionVar, TerminalEntry, TraceOutcome } from '../lib/types'

/** 历史条数上限：够翻又不至于把内存里的会话撑大 */
const HISTORY_LIMIT = 100

/** 单步追踪最多渲染的行数，超出的部分不再塞进 DOM */
const TRACE_ROW_LIMIT = 300

/**
 * 内置兜底示例：上层没传 `exampleCommands` 时才用。
 * 只覆盖「调用解法 / 打印变量 / 列变量」三种最常用的开场，具体形参名由上层生成。
 */
const EXAMPLES = [
  { code: 'Solution().twoSum([2, 7, 11, 15], 9)', hint: '调用当前题的解法' },
  { code: 'print(nums)', hint: '打印会话里的变量' },
  { code: 'vars()', hint: '列出所有变量' },
]

/** 只有 input / result 带前缀，其余靠颜色区分，免得满屏符号 */
const ENTRY_PREFIX: Partial<Record<TerminalEntry['kind'], string>> = {
  input: '>>> ',
  result: '→ ',
}

export interface TerminalHandle {
  focus: () => void
  scrollToEnd: () => void
}

export interface TerminalProps {
  entries: TerminalEntry[]
  vars: SessionVar[]
  busy: boolean
  /** Python 是否就绪；没就绪只提示，不拦着用户打字 */
  ready: boolean
  onSubmit: (code: string) => void
  onInspect: () => void
  onReset: () => void
  onLoadCode: () => void
  onClear: () => void
  /**
   * 中断当前执行（P2-9）。Pyodide 跑在 worker 里，主线程打断不了，
   * 只能由上层 terminate worker 来「打断」；不传就保持「Ctrl+C 只清输入框」的老行为。
   */
  onInterrupt?: () => void
  /**
   * 空状态里的示例命令（P3-8）。不传用内置三条兜底。
   * 内置的 `print(nums)` / `vars()` 只对少数题成立，上层按当前题形参生成更准。
   */
  exampleCommands?: { code: string; hint: string }[]
}

/**
 * 去掉整个输入末尾那一个续行反斜杠。
 *
 * P3-9：以前按行删掉每行行尾的 `\`，但 Python 里行尾 `\` 本来就是合法续行，
 * 多行字符串（`"""a\` + 换行 + `b"""`）里更是实打实的内容，删了会改变语义。
 * 输入框里真正的「我还想接着写」标记只会在整段输入的最末尾，所以只清那一个。
 */
function cleanCode(text: string): string {
  return text
    .replace(/\s+$/, '')
    .replace(/\\$/, '')
    .replace(/\s+$/, '')
}

function renderEntry(entry: TerminalEntry) {
  const prefix = ENTRY_PREFIX[entry.kind] ?? ''
  return (
    <div className={`term__line term__line--${entry.kind}`} key={entry.id}>
      {prefix ? <span className="term__pfx">{prefix}</span> : null}
      <span className="term__text">{entry.text}</span>
      {typeof entry.ms === 'number' ? <span className="term__ms">{entry.ms}ms</span> : null}
    </div>
  )
}

export const Terminal: ForwardRefExoticComponent<
  TerminalProps & RefAttributes<TerminalHandle>
> = forwardRef<TerminalHandle, TerminalProps>(function Terminal(
  {
    entries,
    vars,
    busy,
    ready,
    onSubmit,
    onInspect,
    onReset,
    onLoadCode,
    onClear,
    onInterrupt,
    exampleCommands,
  },
  ref,
) {
  const [input, setInput] = useState('')
  const [history, setHistory] = useState<string[]>([])
  /** null = 正在编辑草稿；数字 = 正在浏览第几条历史 */
  const [histIndex, setHistIndex] = useState<number | null>(null)
  /**
   * 中断回执（P2-9）：0 = 不显示，>0 = 显示一行提示。
   * 用递增的计数而不是布尔，是为了连按两次 Ctrl+C 也能重新开始「自动消失」的计时。
   */
  const [interruptTick, setInterruptTick] = useState(0)

  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const streamRef = useRef<HTMLDivElement | null>(null)
  const draftRef = useRef('')
  const stickToEndRef = useRef(true)
  const caretEndRef = useRef(false)
  const focusPendingRef = useRef(false)

  const scrollToEnd = () => {
    const el = streamRef.current
    if (el) el.scrollTop = el.scrollHeight
  }

  const focusInput = () => {
    textareaRef.current?.focus()
  }

  useImperativeHandle(
    ref,
    () => ({
      focus: () => focusInput(),
      scrollToEnd: () => scrollToEnd(),
    }),
    [],
  )

  // 有新输出就滚到底；用户手动往上翻时不打断阅读
  useEffect(() => {
    if (stickToEndRef.current) scrollToEnd()
  }, [entries.length])

  useEffect(() => {
    if (stickToEndRef.current) scrollToEnd()
  }, [input, busy])

  // 历史翻页 / 点变量后，把光标放到末尾
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    if (focusPendingRef.current) {
      focusPendingRef.current = false
      el.focus()
    }
    if (caretEndRef.current) {
      caretEndRef.current = false
      el.setSelectionRange(el.value.length, el.value.length)
    }
  }, [input])

  // 中断回执只留 4s：它只是「请求已发出」的回执，不该长期挂在输入框上方
  useEffect(() => {
    if (!interruptTick) return
    const timer = window.setTimeout(() => setInterruptTick(0), 4000)
    return () => window.clearTimeout(timer)
  }, [interruptTick])

  const remember = (code: string) => {
    setHistory((prev) =>
      prev[prev.length - 1] === code ? prev : [...prev, code].slice(-HISTORY_LIMIT),
    )
  }

  const submit = () => {
    if (busy) return
    const code = cleanCode(input)
    if (!code.trim()) return
    remember(code)
    setInput('')
    setHistIndex(null)
    draftRef.current = ''
    stickToEndRef.current = true
    onSubmit(code)
  }

  const navigateHistory = (direction: -1 | 1) => {
    if (history.length === 0) return
    const last = history.length - 1
    if (direction === -1) {
      if (histIndex === null) {
        draftRef.current = input
        setHistIndex(last)
        setInput(history[last])
      } else if (histIndex > 0) {
        setHistIndex(histIndex - 1)
        setInput(history[histIndex - 1])
      }
    } else {
      if (histIndex === null) return
      if (histIndex < last) {
        setHistIndex(histIndex + 1)
        setInput(history[histIndex + 1])
      } else {
        setHistIndex(null)
        setInput(draftRef.current)
      }
    }
    caretEndRef.current = true
  }

  /** 往输入框追加一行（不覆盖用户已经写了一半的东西），并聚焦到末尾 */
  const appendToInput = (snippet: string) => {
    setInput((prev) => (prev.trim() ? `${prev.replace(/\s+$/, '')}\n${snippet}` : snippet))
    caretEndRef.current = true
    focusPendingRef.current = true
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const mod = event.ctrlKey || event.metaKey

    if (mod && (event.key === 'l' || event.key === 'L')) {
      event.preventDefault()
      onClear()
      return
    }

    if (mod && (event.key === 'c' || event.key === 'C')) {
      const el = event.currentTarget
      // 有选区时保留系统的复制行为，没选区才当成「中断当前输入」
      if (el.selectionStart === el.selectionEnd) {
        event.preventDefault()
        // P2-9：正在跑的时候，Ctrl+C 应该是「打断执行」，不是「清空输入框」。
        // Pyodide 在 worker 里，主线程没法打断，只能请上层 terminate worker；
        // 没接 onInterrupt 的调用方保持老行为（只清输入）。
        if (busy && onInterrupt) {
          onInterrupt()
          setInterruptTick((tick) => tick + 1)
          return
        }
        setInput('')
        setHistIndex(null)
        draftRef.current = ''
      }
      return
    }

    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      // 多行输入时上下键应该是移动光标，不是翻历史
      if (!input.includes('\n')) {
        event.preventDefault()
        navigateHistory(event.key === 'ArrowUp' ? -1 : 1)
      }
      return
    }

    if (event.key !== 'Enter') return

    // Shift+Enter：交给浏览器插入换行（不 preventDefault，也不提交）。
    // 但 Ctrl/Cmd+Shift+Enter 这种组合同样不该冒到 window 触发全局「运行」。
    if (event.shiftKey) {
      if (mod) event.stopPropagation()
      return
    }

    const el = event.currentTarget
    const caret = el.selectionStart
    const lineStart = input.lastIndexOf('\n', caret - 1) + 1
    // 行尾反斜杠 = 这条命令还没写完，继续换行（反斜杠本身保留，见 cleanCode 的说明）。
    // Ctrl/Cmd+Enter 是显式的「跑」，不受续行标记影响。
    if (!mod && input.slice(lineStart, caret).endsWith('\\')) return

    // P1-2：提交时必须挡住冒泡。React 19 的合成事件挂在 root 上，只 preventDefault
    // 拦不住事件继续冒到 window —— CodeLab 在 window 上监听 Ctrl+Enter 触发全局「运行」，
    // 于是一条命令既被 exec 又被 runAll，而 runAll 会把 Tab 切到「控制台」把终端卸载，
    // 命令历史和草稿全丢。stopPropagation 会同步到 nativeEvent，window 上的监听就收不到了。
    event.preventDefault()
    event.stopPropagation()
    submit()
  }

  const lines = input.split('\n').length
  const rows = Math.min(Math.max(lines, 1), 8)
  // P3-8：上层没传就用内置示例（保持向后兼容）
  const examples = exampleCommands?.length ? exampleCommands : EXAMPLES

  return (
    <div className="term">
      <div className="term__bar">
        <button
          className="btn"
          onClick={onInspect}
          disabled={busy}
          title="重新读取会话里的变量（vars()）"
        >
          <Braces /> 查看变量
        </button>
        <button
          className="btn"
          onClick={onLoadCode}
          disabled={busy}
          title="把编辑器里的代码载入当前会话"
        >
          <FileCode2 /> 载入代码
        </button>
        <button
          className="btn"
          onClick={onReset}
          disabled={busy}
          title="重置 Python 会话，变量会全部清空"
        >
          <RotateCcw /> 重置会话
        </button>
        <button className="btn" onClick={onClear} title="清空终端显示（Ctrl+L）">
          <Eraser /> 清空
        </button>
        <div className="term__bar-right">
          {busy ? (
            <span className="term__running">
              <Loader2 className="term__spin" /> 运行中
            </span>
          ) : null}
          <span className="term__varcount">变量 {vars.length}</span>
        </div>
      </div>

      {!ready && !busy ? (
        <div className="term__banner">
          Python 运行时还没就绪（可能仍在加载）。现在敲的命令可能拿不到结果。
        </div>
      ) : null}

      <div className="term__body">
        <div
          className="term__stream"
          ref={streamRef}
          onScroll={() => {
            const el = streamRef.current
            if (!el) return
            stickToEndRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 28
          }}
          onClick={() => {
            const selection = window.getSelection()
            if (selection && selection.toString()) return
            focusInput()
          }}
        >
          {entries.length === 0 && !busy ? (
            <div className="term__empty">
              <div className="term__empty-title">题目会话终端</div>
              <p className="term__empty-note">
                这里是一个持久的 Python 会话：跑过的函数、变量都还在，可以随时接着敲。
                点下面的命令直接填进输入框：
              </p>
              <div className="term__examples">
                {examples.map((example, index) => (
                  <button
                    type="button"
                    className="term__example"
                    key={`${index}-${example.code}`}
                    onClick={() => appendToInput(example.code)}
                    title={example.hint}
                  >
                    <code>{example.code}</code>
                    <span>{example.hint}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {entries.map(renderEntry)}

          {busy ? (
            <div className="term__busy">
              <Loader2 className="term__spin" /> 正在执行…
            </div>
          ) : null}

          {interruptTick ? (
            <div className="term__notice" role="status">
              已请求中断（会话会重建）
            </div>
          ) : null}

          <div className="term__inputrow">
            <span className="term__prompt" aria-hidden="true">
              {'>>>'}
            </span>
            <textarea
              ref={textareaRef}
              className="term__input"
              value={input}
              rows={rows}
              spellCheck={false}
              autoComplete="off"
              autoCapitalize="off"
              aria-label="Python 终端输入，Enter 运行，Shift+Enter 换行"
              placeholder="Enter 运行 · Shift+Enter 换行 · 行尾 \ 续行 · ↑ 历史 · Ctrl+L 清屏"
              onChange={(event) => {
                setInput(event.target.value)
                setHistIndex(null)
              }}
              onKeyDown={handleKeyDown}
            />
          </div>
        </div>

        <aside className="term__vars" aria-label="会话变量">
          <div className="term__vars-head">
            <span>会话变量</span>
            <span className="term__vars-count">{vars.length}</span>
          </div>
          {vars.length === 0 ? (
            <p className="term__vars-empty">
              还没有变量。跑一段代码，或点「查看变量」刷新。
            </p>
          ) : (
            <table className="term__vartable">
              <thead>
                <tr>
                  <th scope="col">名字</th>
                  <th scope="col">类型</th>
                  <th scope="col">值</th>
                </tr>
              </thead>
              <tbody>
                {vars.map((item) => (
                  <tr
                    key={item.name}
                    className="term__varrow"
                    onClick={() => appendToInput(`print(${item.name})`)}
                  >
                    <td className="term__varname">
                      <button
                        type="button"
                        className="term__varbtn"
                        title={`插入 print(${item.name})`}
                        onClick={(event) => {
                          // 行本身也能点，这里挡掉冒泡避免插两次
                          event.stopPropagation()
                          appendToInput(`print(${item.name})`)
                        }}
                      >
                        {item.name}
                      </button>
                    </td>
                    <td className="term__vartype" title={item.type}>
                      {item.type}
                    </td>
                    <td className="term__varrepr" title={item.repr}>
                      {item.repr}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </aside>
      </div>
    </div>
  )
})

/** repr 太长时截断，全文放 title */
function clip(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text
}

export function TracePanel({ trace, onClose }: { trace: TraceOutcome; onClose: () => void }) {
  const steps = trace.steps.slice(0, TRACE_ROW_LIMIT)
  const truncated = trace.truncated || trace.steps.length > TRACE_ROW_LIMIT

  return (
    <div className="trace">
      <div className="trace__head">
        <span className="trace__title">单步追踪 · 共 {trace.steps.length} 步</span>
        {truncated ? <span className="trace__flag">步数过多，已截断</span> : null}
        <button
          type="button"
          className="trace__close"
          onClick={onClose}
          aria-label="关闭单步追踪"
          title="关闭"
        >
          <X />
        </button>
      </div>

      {trace.error ? (
        <div className="trace__error" role="alert">
          {trace.error}
        </div>
      ) : null}

      {trace.repr ? (
        <div className="trace__repr">
          <span className="trace__repr-arrow">→</span>
          {trace.repr}
        </div>
      ) : null}

      {trace.stdout ? <pre className="trace__io trace__io--stdout">{trace.stdout}</pre> : null}
      {trace.stderr ? <pre className="trace__io trace__io--stderr">{trace.stderr}</pre> : null}

      {steps.length === 0 ? (
        <div className="trace__empty">
          没有可展示的步骤。可能是这段代码没进入任何函数，或者追踪在中途被中断了。
        </div>
      ) : (
        <div className="trace__body">
          <table className="trace__table">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">行号</th>
                <th scope="col">代码</th>
                <th scope="col">深度</th>
                <th scope="col">局部变量</th>
              </tr>
            </thead>
            <tbody>
              {steps.map((step, index) => (
                <tr className="trace__row" key={`${step.line}-${index}`}>
                  <td className="trace__idx">{index + 1}</td>
                  <td className="trace__line">{step.line}</td>
                  <td className="trace__code">
                    <code>{step.code}</code>
                  </td>
                  <td className="trace__depth">{step.depth === 0 ? '—' : `↳${step.depth}`}</td>
                  <td className="trace__locals">
                    {step.locals.length === 0 ? (
                      <span className="trace__none">—</span>
                    ) : (
                      step.locals.map((local) => (
                        <span
                          className="trace__chip"
                          key={local.name}
                          title={`${local.name} = ${local.repr}`}
                        >
                          <span className="trace__chip-name">{local.name}</span>
                          <span className="trace__chip-eq">=</span>
                          <span className="trace__chip-repr">{clip(local.repr, 40)}</span>
                        </span>
                      ))
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
