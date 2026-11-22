import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import CodeMirror from '@uiw/react-codemirror'
import type { ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { python } from '@codemirror/lang-python'
import { EditorView } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import {
  AlertCircle,
  Bug,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardCopy,
  Info,
  Play,
  Plus,
  RotateCcw,
  SquareTerminal,
  Trash2,
  Wand2,
  X,
} from 'lucide-react'
import { useProgress } from '../lib/progress'
import { useToast } from '../lib/toast'
import { usePythonRunner } from '../lib/runner'
import { useData } from '../lib/data'
import type {
  CaseResult,
  Problem,
  SessionVar,
  TerminalEntry,
  TestCase,
  TraceOutcome,
} from '../lib/types'
import {
  buildDefaultCases,
  ensureImports,
  tutorialMarkdowns,
} from '../lib/utils'
import { buildStarter, resolveSignature } from '../lib/starter'
import {
  buildEdgeCases,
  caseCall,
  failReasonText,
  isDataEdgeCase,
  isUntouchedStarter,
  judgeCase,
  mergeEdgeCases,
  outputDiff,
  persistableCases,
  suggestEdgeCases,
} from '../lib/cases'
import { nodeKinds, nodePrelude, wrapNodeCall } from '../lib/nodes'
import { AiReview } from './AiReview'
import { Splitter } from './Splitter'
import { loadUiNumber, saveUiNumber } from '../lib/ui'
import { useThemeState } from '../lib/theme'
import { MOD_KEY } from '../lib/platform'
import type { CSSProperties } from 'react'
import { Terminal, TracePanel } from './Terminal'
import type { TerminalHandle } from './Terminal'
import { useAiSession } from '../lib/ai'

export interface CodeLabHandle {
  loadCase: (call: string, expected: string) => void
  loadCode: (code: string) => void
}

/* ==========================================================================
   编辑器主题 · code 材质（替代 @codemirror/theme-one-dark）
   --------------------------------------------------------------------------
   为什么不用 One Dark：它自带一套紫色关键字 / 绿色字符串和偏蓝灰的底色，
   和本项目的「石墨 + 琥珀」是两套色系，编辑器看起来像外挂进来的第三方控件。
   这里所有颜色都指向 tokens.css 的 --syn-* / --bg-code* / --border-code，
   语法色与页面共用同一个色源，改令牌即可整体换肤。

   关于 CSS 变量：EditorView.theme 与 HighlightStyle 生成的都是普通 CSS 规则
   （StyleModule 注入 <style>），不经过 canvas 测量，浏览器会正常解析 var(--…)，
   所以这里不需要退化成具体色值。

   字号：等宽字体的视觉重量比比例字体轻，同一档在代码区会显小，
   所以令牌里单独给了 --fs-code（13px），不占用正文字号阶梯。
   ========================================================================== */

/**
 * CodeMirror 的 { dark } 标记决定它用哪套**基线主题**：
 * dark 时注入 .ͼ3 .cm-selectionBackground { background: #222 }，
 * 浅色界面下选区就会被涂成深灰（字都看不见）。
 * 所以这里做成函数，主题切换时用 Compartment 重新配置。
 */
const labTheme = (dark: boolean) =>
  EditorView.theme(
  {
    '&': {
      color: 'var(--text-1)',
      backgroundColor: 'var(--bg-code)',
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--fs-code)',
    },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': {
      fontFamily: 'var(--font-mono)',
      lineHeight: '1.65',
    },
    '.cm-content': {
      padding: 'var(--sp-2) 0',
      caretColor: 'var(--accent)',
    },
    '.cm-line': { padding: '0 var(--sp-2) 0 var(--sp-1)' },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: 'var(--accent)',
      borderLeftWidth: '2px',
    },
    '.cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: 'var(--syn-selection)',
    },
    '&.cm-focused .cm-selectionBackground': {
      backgroundColor: 'var(--syn-selection)',
    },
    '.cm-activeLine': { backgroundColor: 'var(--syn-active-line)' },
    '.cm-gutters': {
      backgroundColor: 'var(--bg-code)',
      color: 'var(--syn-gutter)',
      borderRight: '1px solid var(--border-code)',
      fontFamily: 'var(--font-mono)',
    },
    '.cm-lineNumbers .cm-gutterElement': {
      minWidth: 'var(--sp-6)',
      padding: '0 var(--sp-2)',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'transparent',
      color: 'var(--text-3)',
    },
    '.cm-foldPlaceholder': {
      backgroundColor: 'var(--bg-code-2)',
      border: '1px solid var(--border-code)',
      borderRadius: 'var(--r-xs)',
      color: 'var(--text-3)',
      padding: '0 var(--sp-1)',
    },
    '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
      backgroundColor: 'var(--info-wash)',
      color: 'var(--info-text)',
      outline: '1px solid var(--info-line)',
    },
    '.cm-nonmatchingBracket, &.cm-focused .cm-nonmatchingBracket': {
      backgroundColor: 'var(--danger-wash)',
      color: 'var(--danger-text)',
    },
    '.cm-searchMatch': {
      backgroundColor: 'var(--accent-wash)',
      outline: '1px solid var(--accent-line)',
    },
    '.cm-searchMatch.cm-searchMatch-selected': {
      backgroundColor: 'var(--accent-wash-strong)',
    },
    '.cm-selectionMatch': { backgroundColor: 'var(--info-wash)' },
    '.cm-panels': {
      backgroundColor: 'var(--bg-code-2)',
      color: 'var(--text-2)',
      borderColor: 'var(--border-code)',
    },
    '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--border-code)' },
    '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--border-code)' },
    '.cm-textfield': {
      backgroundColor: 'var(--bg-code)',
      border: '1px solid var(--border-default)',
      borderRadius: 'var(--r-xs)',
      color: 'var(--text-1)',
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--fs-xs)',
    },
    '.cm-button': {
      backgroundImage: 'none',
      backgroundColor: 'var(--bg-code-3)',
      border: '1px solid var(--border-code)',
      borderRadius: 'var(--r-xs)',
      color: 'var(--text-2)',
      fontSize: 'var(--fs-xs)',
    },
    '.cm-tooltip': {
      backgroundColor: 'var(--bg-surface-2)',
      border: '1px solid var(--border-default)',
      borderRadius: 'var(--r-sm)',
      color: 'var(--text-1)',
    },
    '.cm-tooltip.cm-tooltip-autocomplete > ul': {
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--fs-sm)',
    },
    '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': {
      backgroundColor: 'var(--accent-wash)',
      color: 'var(--text-1)',
    },
    '.cm-placeholder': { color: 'var(--text-3)' },
  },
  { dark },
)

/** 语法色映射：只认 tokens.css 第 3.6 节那套 --syn-*，不用第三方主题原色 */
const labHighlight = HighlightStyle.define([
  { tag: t.keyword, color: 'var(--syn-keyword)' },
  {
    tag: [t.controlKeyword, t.moduleKeyword, t.operatorKeyword, t.definitionKeyword],
    color: 'var(--syn-keyword)',
  },
  { tag: t.self, color: 'var(--syn-keyword)' },
  { tag: [t.string, t.special(t.string), t.docString], color: 'var(--syn-string)' },
  { tag: [t.regexp, t.escape], color: 'var(--syn-string)' },
  { tag: [t.number, t.bool, t.null, t.atom, t.unit], color: 'var(--syn-number)' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: 'var(--syn-comment)' },
  {
    tag: [t.function(t.variableName), t.function(t.propertyName)],
    color: 'var(--syn-function)',
  },
  {
    tag: [t.definition(t.variableName), t.definition(t.propertyName)],
    color: 'var(--syn-function)',
  },
  { tag: [t.typeName, t.className, t.namespace, t.tagName], color: 'var(--syn-type)' },
  { tag: [t.variableName, t.propertyName], color: 'var(--syn-variable)' },
  { tag: [t.operator, t.derefOperator], color: 'var(--syn-operator)' },
  {
    tag: [
      t.punctuation,
      t.separator,
      t.bracket,
      t.angleBracket,
      t.squareBracket,
      t.paren,
      t.brace,
    ],
    color: 'var(--syn-punct)',
  },
  { tag: [t.meta, t.processingInstruction], color: 'var(--syn-comment)' },
  { tag: t.invalid, color: 'var(--syn-invalid)' },
  { tag: t.strong, fontWeight: '600' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.link, color: 'var(--syn-keyword)', textDecoration: 'underline' },
])

/** 静态部分（语法高亮不随主题变，颜色都走 var(--syn-*)） */
const labStaticTheme = [syntaxHighlighting(labHighlight)]

type LabTab = 'cases' | 'console' | 'terminal' | 'ai'

let entrySeq = 0
function makeEntry(kind: TerminalEntry['kind'], text: string, ms?: number): TerminalEntry {
  entrySeq += 1
  return { id: `e${entrySeq}`, kind, text, ms }
}

/**
 * 边界用例折叠条是否展开：只记在模块作用域里，本次会话内换题 / 重挂载都保留，
 * 但刷新页面就回到默认折叠（不需要写进 progress）。
 */
let edgeOpenMemory = false

export const CodeLab = forwardRef<
  CodeLabHandle,
  { problem: Problem; onRun?: (passed: boolean) => void }
>(function CodeLab({ problem, onRun }, ref) {
  const progress = useProgress()
  const { toast } = useToast()
  // 编辑器要知道当前是深色还是浅色：CodeMirror 的基线主题（选区底色等）跟着它走
  const { resolved: resolvedTheme } = useThemeState()
  const editorTheme = useMemo(() => labTheme(resolvedTheme === 'dark'), [resolvedTheme])
  const { byDoc } = useData()
  const state = progress.stateOf(problem.no)

  const markdowns = useMemo(() => tutorialMarkdowns(problem, byDoc), [problem, byDoc])
  const signature = useMemo(
    () => resolveSignature(problem, markdowns),
    [problem, markdowns],
  )
  const starter = useMemo(() => buildStarter(problem, markdowns), [problem, markdowns])

  /**
   * 判题用的返回类型：优先题面分片带进来的 LeetCode 类型名（problem.returnType），
   * 拿不到就退回签名里的 Python 标注。两边都没有就不做类型检查。
   */
  const judgeReturnType = useMemo(
    () => problem.returnType || signature.returns || '',
    [problem.returnType, signature.returns],
  )

  // 链表 / 树题：把示例里的数组实参包成节点，返回的节点再还原成数组，才能按字面比对
  const kinds = useMemo(() => nodeKinds(problem, signature), [problem, signature])
  const prelude = useMemo(() => nodePrelude(kinds), [kinds])
  const wrapCall = useCallback(
    (call: string) => wrapNodeCall(problem, signature, call),
    [problem, signature],
  )

  const defaultCall = useCallback(() => {
    const name = signature.method
    // 设计题的「方法名」其实是类名，直接 new 出来才对
    if (/^[A-Z]/.test(name)) return `${name}()`
    if (!name || name === '__init__') return 'Solution()'
    return `Solution().${name}()`
  }, [signature.method])

  // 设计题（LRU 缓存、最小栈、Trie…）没有 `Solution.xxx` 可以单次调用，
  // 用终端一步步敲才是正解，所以这里只给一条构造调用、且不设期望值，避免误判 FAIL
  const isDesign = /^[A-Z]/.test(signature.method) || signature.method === '__init__'

  /**
   * 预填用例：调用表达式交给 cases.caseCall 生成（按真实形参名对齐、丢掉非法实参），
   * 生成不出来就留空，让占位提示引导用户自己填，而不是塞一条必然 TypeError 的调用。
   * 这里只产出「官方示例」那一部分；边界用例由 buildEdgeCases 在渲染时追加，
   * 并且不进用户存档（数据更新后自动跟着变）。
   */
  const buildCases = useCallback((): TestCase[] => {
    if (isDesign) {
      return [{ id: 'case-1', call: defaultCall(), expected: '', kind: 'example' }]
    }
    return buildDefaultCases(problem).map((item, index) => {
      const example = problem.examples[index]
      const call = example ? caseCall(problem, example, signature) : ''
      return {
        ...item,
        call,
        expected: call ? item.expected : '',
        kind: 'example' as const,
      }
    })
  }, [problem, signature, isDesign, defaultCall])

  /** 数据侧生成的边界用例：每次挂载都从题面分片重建，不写进存档 */
  const dataEdgeCases = useMemo(() => buildEdgeCases(problem), [problem])

  const [code, setCode] = useState(() => state.code || starter)
  const [cases, setCases] = useState<TestCase[]>(() => {
    // 旧版本/手工导入的进度可能没有 cases 字段，兜底成空数组，别让整页白屏
    const saved = state.cases ?? []
    const base = saved.length ? saved : buildCases()
    return mergeEdgeCases(base, dataEdgeCases)
  })
  const [results, setResults] = useState<Record<string, CaseResult>>({})
  /** 运行结果反馈：pass 成功形变 / fail 抖两下 */
  const [outcome, setOutcome] = useState<'pass' | 'fail' | null>(null)
  /**
   * 「第三态」：代码还是初始模板。命中时不判失败、不出红，用例全部 ok = null。
   * 一旦动代码就撤掉（下面有个只依赖 code 的 effect）。
   */
  const [untouched, setUntouched] = useState(false)
  /** 边界用例折叠条（默认收起，展开状态记在 edgeOpenMemory 里） */
  const [edgeOpen, setEdgeOpen] = useState(() => edgeOpenMemory)
  /** 控制台里的边界明细默认收起，每次看控制台重新折起来 */
  const [consoleEdgeOpen, setConsoleEdgeOpen] = useState(false)
  const [tab, setTab] = useState<LabTab>('cases')
  const [running, setRunning] = useState(false)

  // 编辑器 / 用例区上下分栏（拖动或双击复位）
  const rootRef = useRef<HTMLDivElement>(null)
  // 默认高度按视口给：1366×768 的笔记本上 46% 会把编辑器压到 14 行，短屏降到 40%
  const defaultCasesPct = typeof window !== 'undefined' && window.innerHeight < 820 ? 26 : 46
  const [casesPct, setCasesPct] = useState(() => loadUiNumber('lab.cases', defaultCasesPct))
  const resizeCases = (clientY: number) => {
    const el = rootRef.current
    if (!el) return
    if (clientY < 0) {
      setCasesPct(defaultCasesPct)
      saveUiNumber('lab.cases', defaultCasesPct)
      return
    }
    const rect = el.getBoundingClientRect()
    if (rect.height < 10) return
    const height = Math.max(160, Math.min(rect.height * 0.75, rect.bottom - clientY))
    const pct = Math.round((height / rect.height) * 1000) / 10
    setCasesPct(pct)
    saveUiNumber('lab.cases', pct)
  }
  const [entries, setEntries] = useState<TerminalEntry[]>([])
  const [vars, setVars] = useState<SessionVar[]>([])
  const [termBusy, setTermBusy] = useState(false)
  const [trace, setTrace] = useState<TraceOutcome | null>(null)
  const [tracing, setTracing] = useState(false)

  const ai = useAiSession(problem.no)
  const { runCases, exec, inspect, resetSession, trace: runTrace, status, error, reset } =
    usePythonRunner()

  const sessionId = problem.no
  const sessionReadyRef = useRef(false)
  const terminalRef = useRef<TerminalHandle>(null)
  /** 模板态提示后把焦点送回编辑器（CodeMirror 的实例挂在 ref.view 上） */
  const editorRef = useRef<ReactCodeMirrorRef>(null)
  const tabRef = useRef<LabTab>(tab)
  tabRef.current = tab
  const codeRef = useRef(code)
  codeRef.current = code
  const casesRef = useRef(cases)
  casesRef.current = cases
  const saveCodeRef = useRef(progress.saveCode)
  saveCodeRef.current = progress.saveCode
  const runningRef = useRef(running)
  runningRef.current = running
  const untouchedRef = useRef(untouched)
  untouchedRef.current = untouched

  const pushEntries = useCallback((...items: TerminalEntry[]) => {
    if (!items.length) return
    // 长会话只留最近 500 条，避免终端把 DOM 撑爆
    setEntries((prev) => [...prev, ...items].slice(-500))
  }, [])

  useEffect(() => {
    // 只存官方示例 + 用户自己加的用例；数据边界用例每次打开都重建
    if (!state.cases.length) progress.saveCases(problem.no, persistableCases(cases))
    // 只在首次挂载时补写默认用例
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (code === state.code) return
    const timer = window.setTimeout(() => progress.saveCode(problem.no, code), 450)
    return () => window.clearTimeout(timer)
  }, [code, problem.no, progress, state.code])

  // 一动代码就撤掉「还没开始写」的提示，连同那批占位结果（ok 全是 null，是上一次模板运行的快照）。
  // 只依赖 code：untouched 自己变 true 时不能触发，否则刚跑完就被清掉。
  useEffect(() => {
    if (!untouchedRef.current) return
    setUntouched(false)
    setResults({})
  }, [code])

  const toggleEdgeOpen = () => {
    setEdgeOpen((prev) => {
      edgeOpenMemory = !prev
      return edgeOpenMemory
    })
  }

  useEffect(() => {
    return () => {
      saveCodeRef.current(problem.no, codeRef.current)
    }
  }, [problem.no])

  const persistCases = (next: TestCase[]) => {
    setCases(next)
    // 数据边界用例不进存档：否则数据侧下次更新边界用例，用户存档里的旧版本会串味
    progress.saveCases(problem.no, persistableCases(next))
  }

  /** 用一组「存档层」的用例重置列表，边界用例再合并回末尾（「示例」按钮走这条） */
  const resetToBaseCases = (base: TestCase[]) => {
    persistCases(mergeEdgeCases(base, dataEdgeCases))
  }

  const addCase = (call = '', expected = '') => {
    const next = [
      ...casesRef.current,
      {
        id: `case-${Date.now()}-${casesRef.current.length}`,
        call: call || defaultCall(),
        expected,
        kind: 'example' as const,
      },
    ]
    persistCases(next)
    setTab('cases')
  }

  const addEdgeCases = () => {
    const suggestions = suggestEdgeCases(problem, signature)
    if (!suggestions.length) {
      toast('这道题自动推不出安全的边界用例，手动加一条吧')
      return
    }
    const existing = new Set(casesRef.current.map((item) => item.call))
    const fresh = suggestions
      .filter((item) => !existing.has(item.call))
      .map((item, index) => ({
        id: `edge-${Date.now()}-${index}`,
        call: item.call,
        expected: item.expected,
        kind: 'edge' as const,
      }))
    if (!fresh.length) {
      toast('建议的边界用例已经在列表里了')
      setTab('cases')
      return
    }
    persistCases([...casesRef.current, ...fresh])
    setTab('cases')
    toast(`加了 ${fresh.length} 条边界用例，期望值留空，先看输出`, 'success')
  }

  const loadCode = useCallback(
    (next: string) => {
      // 参考代码常省略 import / 节点定义，补齐后再进编辑器，点运行就能跑
      const prepared = ensureImports(next)
      setCode(prepared)
      progress.saveCode(problem.no, prepared)
      // 换了一份代码，之前跑出来的会话（已导入的 Solution）就过期了，下次运行重新导入
      sessionReadyRef.current = false
      // 等 React 把新内容送进 CodeMirror 再滚回顶部并聚焦，否则滚的是旧文档
      window.requestAnimationFrame(() => {
        const view = editorRef.current?.view
        if (!view) return
        view.dispatch({
          selection: { anchor: 0 },
          scrollIntoView: true,
        })
        view.scrollDOM.scrollTop = 0
        view.focus()
      })
      toast('已载入，点运行试试', 'success')
    },
    [problem.no, progress, toast],
  )

  useImperativeHandle(ref, () => ({
    loadCase(call: string, expected: string) {
      const exists = casesRef.current.some(
        (item) => item.call === call && item.expected === expected,
      )
      if (exists) {
        toast('这个用例已经在下面了')
        setTab('cases')
        return
      }
      addCase(call, expected)
      toast('已载入用例，点「运行」试试', 'success')
    },
    loadCode,
  }))

  const runAll = async () => {
    if (runningRef.current) return
    if (!cases.length) {
      toast('先添加一个测试用例', 'error')
      return
    }
    /**
     * 第三态：模板一个字没写就点运行。
     * 不跑引擎、不判失败、不出红 —— 用例全部 ok = null，只给一条中性提示并把焦点送回编辑器。
     * 也绝不调 progress.recordRun：模板运行计入「今日运行」会污染热力图和尝试数。
     */
    if (isUntouchedStarter(code, starter)) {
      setUntouched(true)
      setOutcome(null)
      setTrace(null)
      setVars([])
      setResults(
        cases.reduce<Record<string, CaseResult>>((acc, item) => {
          acc[item.id] = {
            ok: null,
            repr: '',
            expected: item.expected,
            stdout: '',
            stderr: '',
            error: '',
            ms: 0,
          }
          return acc
        }, {}),
      )
      if (tabRef.current !== 'terminal') setTab('cases')
      toast('模板还没改，先写实现再运行')
      editorRef.current?.view?.focus()
      return
    }
    setUntouched(false)
    setRunning(true)
    setOutcome(null)
    // 正在用终端就别把它踹掉：终端里的历史和多行草稿是组件内 state，切走就没了
    if (tabRef.current !== 'terminal') setTab('console')
    setResults({})
    setTrace(null)
    const started = Date.now()
    try {
      const outcome = await runCases(
        code,
        cases.map((item) => ({ id: item.id, call: wrapCall(item.call) })),
        sessionId,
        prelude,
      )
      const next: Record<string, CaseResult> = {}
      outcome.cases.forEach((item) => {
        const source = cases.find((entry) => entry.id === item.id)
        const expected = source?.expected ?? ''
        // 判题规则收在 cases.judgeCase 里：有期望比输出；没期望则「抛异常 / 类型不符」都算失败
        const verdict = judgeCase({
          call: source?.call ?? '',
          expected,
          repr: item.repr,
          error: item.error,
          // 设计题只给一条构造调用（`LRUCache(2)`），返回值是实例，类型检查没有意义
          returnType: isDesign ? '' : judgeReturnType,
          inPlace: Boolean(problem.inPlace),
          kind: source?.kind === 'edge' ? 'edge' : 'example',
          problemNo: problem.no,
          extreme: source?.extreme === true,
        })
        next[item.id] = {
          ok: verdict.ok,
          soft: verdict.soft,
          orderFree: verdict.orderFree,
          reason: verdict.reason,
          repr: item.repr,
          expected,
          stdout: item.stdout,
          stderr: item.stderr,
          error: item.error,
          ms: item.ms,
        }
      })
      setResults(next)
      setVars(outcome.vars ?? [])
      sessionReadyRef.current = true
      const judged = Object.values(next).filter((item) => item.ok !== null)
      const allPassed = judged.length > 0 && judged.every((item) => item.ok === true)
      // 边界用例的「与参考解不一致」是软失败（参考解和期望值同源，实测 3.61% 不一致，
      // 74% 来自越界输入）：只提示，不拦通过 —— 否则所有写了防御 guard 的正确解永远拿不到通过。
      // 硬失败（官方示例不符 / 边界用例真的抛异常）才算这次没过。
      const softTotal = Object.values(next).filter((item) => item.ok === false && item.soft).length
      const hardTotal = Object.values(next).filter((item) => item.ok === false && !item.soft).length
      // 一条都没判（全是「只运行不判定」）时不能算「通过」，也不能算「失败」——
      // 传 null 让记录里显示「未判定」，不污染 passes 和全过率。
      const passedOrNull: boolean | null = !judged.length ? null : hardTotal ? false : true
      const edgeRan = cases.filter((item) => item.kind === 'edge' && next[item.id]).length
      const edgeBad = cases.filter(
        (item) => item.kind === 'edge' && next[item.id]?.ok === false && !next[item.id]?.soft,
      ).length
      const edgeSoft = cases.filter(
        (item) => item.kind === 'edge' && next[item.id]?.ok === false && next[item.id]?.soft,
      ).length
      pushEntries(
        makeEntry(
          'meta',
          `运行 ${outcome.cases.length} 个用例（含 ${edgeRan} 条边界用例${
            edgeBad ? `，其中 ${edgeBad} 条失败` : ''
          }${edgeSoft ? `，${edgeSoft} 条与参考解不一致` : ''}） · ${
            Date.now() - started
          }ms · 会话里已有 ${outcome.vars?.length ?? 0} 个变量，可以在终端里继续查`,
        ),
      )
      progress.recordRun(problem.no, passedOrNull, Date.now() - started)
      if (judged.length) {
        setOutcome(hardTotal ? 'fail' : softTotal ? null : allPassed ? 'pass' : 'fail')
        window.setTimeout(() => setOutcome(null), 1500)
      }
      if (allPassed && !softTotal) toast('全部用例通过', 'success')
      else if (edgeBad) toast(`有 ${edgeBad} 条边界用例没通过，展开看看失败原因`, 'error')
      else if (edgeSoft) toast(`${edgeSoft} 条边界用例与参考解不一致（不计入判定，点开看看）`, 'default')
      else if (!judged.length) toast('已运行 · 这些用例没有期望值，只跑不判', 'default')
      // 官方示例全过 + 无硬失败 = 这题做对了（软不一致只提示）
      onRun?.(!hardTotal && judged.length > 0)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      sessionReadyRef.current = false
      setVars([])
      pushEntries(makeEntry('error', message))
      toast(message, 'error')
    } finally {
      setRunning(false)
    }
  }

  const runRef = useRef<() => void>(() => {})
  runRef.current = () => {
    void runAll()
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      // 终端自己管 Enter / Ctrl+Enter，全局快捷键不能抢（否则一条命令会执行两次）
      if (target?.closest('.term')) return
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        runRef.current()
        return
      }
      if ((event.metaKey || event.ctrlKey) && event.key === '`') {
        event.preventDefault()
        setTab('terminal')
        window.setTimeout(() => terminalRef.current?.focus(), 30)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const submitCommand = async (raw: string) => {
    const command = raw.replace(/\\\s*\n?$/, '')
    if (!command.trim() || termBusy) return
    pushEntries(makeEntry('input', command))
    setTermBusy(true)
    try {
      // preload 永远带上：Worker 被超时杀掉重建、或上次代码有语法错误时，
      // 引擎那边命名空间是空的，会用它重新载入；命名空间正常时引擎会忽略它。
      const outcome = await exec(command, sessionId, {
        preload: codeRef.current,
        prelude,
      })
      sessionReadyRef.current = true
      if (outcome.preloadError) {
        pushEntries(makeEntry('error', `当前代码载入失败：${outcome.preloadError}`))
      }
      if (outcome.stdout.trim()) pushEntries(makeEntry('stdout', outcome.stdout.trimEnd()))
      if (outcome.stderr.trim()) pushEntries(makeEntry('stderr', outcome.stderr.trimEnd()))
      if (outcome.repr) pushEntries(makeEntry('result', outcome.repr, outcome.ms))
      if (outcome.error) pushEntries(makeEntry('error', outcome.error))
      if (!outcome.stdout.trim() && !outcome.stderr.trim() && !outcome.repr && !outcome.error) {
        pushEntries(makeEntry('meta', '（没有输出）', outcome.ms))
      }
      setVars(outcome.vars ?? [])
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      sessionReadyRef.current = false
      setVars([])
      pushEntries(makeEntry('error', message))
    } finally {
      setTermBusy(false)
    }
  }

  const inspectVars = async () => {
    if (termBusy) return
    setTermBusy(true)
    try {
      let next = await inspect(sessionId)
      if (!next.length) {
        // 会话还没建：先把编辑器里的代码载进去，再查
        const outcome = await exec('', sessionId, { preload: codeRef.current, reload: true, prelude })
        sessionReadyRef.current = true
        if (outcome.preloadError) {
          pushEntries(makeEntry('error', `当前代码载入失败：${outcome.preloadError}`))
        }
        next = outcome.vars ?? []
        pushEntries(makeEntry('info', '已把编辑器里的代码载入会话'))
      }
      setVars(next)
      pushEntries(
        makeEntry(
          'info',
          next.length
            ? `会话里有 ${next.length} 个变量：${next.map((item) => item.name).join(', ')}`
            : '会话里还没有变量，先敲一行代码试试',
        ),
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      pushEntries(makeEntry('error', message))
    } finally {
      setTermBusy(false)
    }
  }

  const reloadSession = async () => {
    if (termBusy) return
    setTermBusy(true)
    try {
      const outcome = await exec('', sessionId, { preload: codeRef.current, reload: true, prelude })
      sessionReadyRef.current = true
      setVars(outcome.vars ?? [])
      if (outcome.preloadError) {
        pushEntries(makeEntry('error', `当前代码载入失败：${outcome.preloadError}`))
      } else {
        pushEntries(makeEntry('info', '已用编辑器里的最新代码重建会话'))
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      pushEntries(makeEntry('error', message))
    } finally {
      setTermBusy(false)
    }
  }

  const clearSession = async () => {
    if (termBusy) return
    setTermBusy(true)
    try {
      await resetSession(sessionId)
      sessionReadyRef.current = false
      setVars([])
      pushEntries(makeEntry('info', '会话已重置，下次命令会用编辑器里的代码重新载入'))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      pushEntries(makeEntry('error', message))
    } finally {
      setTermBusy(false)
    }
  }

  const startTrace = async (call: string) => {
    if (tracing) return
    if (!call.trim()) {
      toast('这条用例没有调用表达式，没法追踪', 'error')
      return
    }
    setTracing(true)
    setTab('console')
    try {
      const outcome = await runTrace(codeRef.current, wrapCall(call), sessionId, prelude)
      setTrace(outcome)
      if (outcome.error) toast('追踪时抛了异常，看面板里的报错', 'error')
      else if (!outcome.steps.length) toast('这次调用没有进入你自己写的方法', 'error')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      toast(message, 'error')
    } finally {
      setTracing(false)
    }
  }

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(code)
      toast('代码已复制', 'success')
    } catch {
      toast('复制失败，手动选中复制吧', 'error')
    }
  }

  // 终端正在跑命令时按 Ctrl+C：Pyodide 在主线程打断不了，只能终止 Worker 重建会话
  const interruptRun = () => {
    reset()
    sessionReadyRef.current = false
    setVars([])
    setTermBusy(false)
    pushEntries(
      makeEntry('info', '已中断。会话重建了，下一条命令会用编辑器里的最新代码重新载入。'),
    )
  }

  // 终端空状态的示例命令按当前题动态生成，比写死 nums 有用
  const exampleCommands = useMemo(() => {
    const items: { code: string; hint: string }[] = []
    const demo = buildCases()[0]?.call || defaultCall()
    items.push({ code: demo, hint: '跑一条题面示例' })
    const firstParam = signature.params[0]?.name
    if (firstParam) {
      items.push({ code: `print(${firstParam})`, hint: `打印会话里的 ${firstParam}` })
    } else {
      items.push({ code: 'print(Solution)', hint: '看看 Solution 类还在不在' })
    }
    if (kinds.list) items.push({ code: '_build_list([1, 2, 3])', hint: '把数组变成链表' })
    else if (kinds.tree) items.push({ code: '_build_tree([1, None, 2, 3])', hint: '把数组变成二叉树' })
    else items.push({ code: 'Solution', hint: '看看会话里有什么' })
    return items
  }, [problem, defaultCall, signature.params, kinds.list, kinds.tree])

  const statusText =
    status === 'loading'
      ? '正在加载 Python…'
      : status === 'running'
        ? '运行中…'
        : status === 'error'
          ? '运行时错误'
          : status === 'ready'
            ? 'Python 就绪'
            : 'Python 待命'

  const resultsList = cases
    .map((item) => ({ item, result: results[item.id] }))
    .filter((entry): entry is { item: TestCase; result: CaseResult } => Boolean(entry.result))

  const totalStdout = resultsList.map((entry) => entry.result.stdout).filter(Boolean).join('')
  const totalStderr = resultsList.map((entry) => entry.result.stderr).filter(Boolean).join('')
  const firstError = resultsList.find((entry) => entry.result.error)?.result.error

  /**
   * 失败原因文案：有期望的用例抛了异常时，说「运行报错」比说「输出不符」更接近事实
   * （判题规则仍然是「有期望按输出比」，这里只改展示）。
   */
  const reasonLabel = (result: CaseResult): string => {
    if (result.reason === 'expected' && result.error) return '运行报错 · 输出与期望不符'
    return failReasonText(result.reason, judgeReturnType)
  }

  /**
   * 用例分两段渲染：官方示例永远平铺，边界用例收进一行折叠条。
   * 10 条用例里 7 条是边界，全铺开会把 3 条官方示例直接淹掉。
   */
  const caseRows = cases.map((item, index) => ({ item, index }))
  const exampleRows = caseRows.filter((row) => row.item.kind !== 'edge')
  const edgeRows = caseRows.filter((row) => row.item.kind === 'edge')
  const judgedOf = (rows: { item: TestCase }[]) =>
    rows.filter((row) => {
      const result = results[row.item.id]
      return result !== undefined && result.ok !== null
    }).length
  const passedOf = (rows: { item: TestCase }[]) =>
    rows.filter((row) => results[row.item.id]?.ok === true).length
  const failedOf = (rows: { item: TestCase }[]) =>
    rows.filter((row) => results[row.item.id]?.ok === false).length

  /** 列表里的边界用例条数（官方示例之外的那些） */
  const edgeTotal = edgeRows.length
  const edgeJudged = judgedOf(edgeRows)
  const edgePassed = passedOf(edgeRows)
  /** 跑过之后失败的边界用例条数：用例 tab 的徽标变红 / 折叠条变红都用它 */
  const edgeFailed = edgeRows.filter((row) => results[row.item.id]?.ok === false && !results[row.item.id]?.soft).length
  const edgeSoft = edgeRows.filter((row) => results[row.item.id]?.ok === false && results[row.item.id]?.soft).length
  const exampleJudged = judgedOf(exampleRows)
  const examplePassed = passedOf(exampleRows)
  const exampleFailed = failedOf(exampleRows)
  // 硬失败才算失败；边界用例的软失败单独计数
  const failedTotal = resultsList.filter((entry) => entry.result.ok === false && !entry.result.soft).length
  const softTotal = resultsList.filter((entry) => entry.result.ok === false && entry.result.soft).length
  const unjudgedTotal = resultsList.filter((entry) => entry.result.ok === null).length

  /**
   * 汇总文案：把「判定」和「只运行」分开说。
   * 全量题库里 94% 的边界用例没有期望值，若写成「7/7 通过」就是假绿灯 ——
   * 一条都没判过时永远不出现「通过」二字。
   */
  const verdictOf = (rows: { item: TestCase }[], judged: number, passed: number, soft = 0) => {
    const total = rows.length
    const ran = rows.filter((row) => results[row.item.id] !== undefined).length
    if (!judged) return `${total} 条 · 判定 0 · 运行 ${ran}`
    const unjudged = total - judged
    const softText = soft ? ` · ${soft} 与参考解不一致` : ''
    return `判定 ${judged}（${passed} 通过${softText}）${unjudged ? ` · 只运行 ${unjudged}` : ''}`
  }
  const exampleVerdict = verdictOf(exampleRows, exampleJudged, examplePassed)
  const edgeVerdict = verdictOf(edgeRows, edgeJudged, edgePassed, edgeSoft)
  const summaryTone = failedTotal ? 'fail' : softTotal ? 'soft' : exampleJudged || edgeJudged ? 'pass' : 'na'
  /** 边界折叠条自己的语义色：硬失败红、与参考解不一致琥珀、全过绿 */
  const edgeTone = edgeFailed ? 'fail' : edgeSoft ? 'soft' : edgeJudged ? 'pass' : 'na'
  /** 边界折叠条上的一句话结论 */
  const edgeHeadline = edgeFailed
    ? `${edgeFailed} 条未通过${edgeSoft ? ` · ${edgeSoft} 条与参考解不一致` : ''}`
    : edgeSoft
      ? `${edgeSoft} 条与参考解不一致（不计入判定）`
      : edgeJudged
      ? edgeJudged < edgeTotal
        ? `${edgeJudged} 条判定通过 · ${edgeTotal - edgeJudged} 条只运行`
        : '全部通过'
      : // 跑过但一条都没判（原地修改题 / 模板态）≠ 还没跑，别说成「还没跑」
        resultsList.length
        ? '未判定'
        : '还没跑'

  const runSummary = resultsList.length
    ? {
        total: resultsList.length,
        passed: resultsList.filter((entry) => entry.result.ok === true).length,
        failed: failedTotal,
        detail: `含 ${resultsList.filter((entry) => entry.item.kind === 'edge').length} 条边界用例\n${resultsList
          .map(({ item, result }, index) => {
            const actual = result.error
              ? `报错：${result.error.split('\n').slice(-1)[0].slice(0, 120)}`
              : `输出 ${result.repr || '（空）'}`
            const tag = item.kind === 'edge' ? '[边界] ' : ''
            const why = result.ok === false ? `；判失败：${reasonLabel(result)}` : ''
            return `用例${index + 1}${tag}：${item.call} → ${actual}；期望 ${item.expected || '（未填）'}${why}`
          })
          .join('\n')
          .slice(0, 1200)}`,
      }
    : null

  const tall = tab === 'ai' || tab === 'terminal'

  /**
   * 一条用例行。官方示例和边界用例共用同一套行样式（边界靠 .case__tag 区分），
   * 折叠只是把边界那批的渲染时机挪到「展开之后」。
   */
  const renderCaseRow = (item: TestCase, index: number) => {
    const result = results[item.id]
    const tone =
      result?.ok === true ? 'pass' : result?.ok === false ? (result.soft ? 'soft' : 'fail') : 'na'
    const diff =
      result && result.ok === false && !result.error && item.expected.trim()
        ? outputDiff(item.expected, result.repr)
        : null
    return (
      <div
        className={`case${tone === 'pass' ? ' case--pass' : ''}${
          tone === 'fail' ? ' case--fail' : ''
        }${tone === 'soft' ? ' case--soft' : ''}`}
        key={item.id}
      >
        <div className="case__top">
          <span className="case__no">{String(index + 1).padStart(2, '0')}</span>
          {/* 来源标签：边界用例带一个小徽标，官方示例留空占位保持输入框对齐 */}
          {item.kind === 'edge' ? (
            <span
              className="case__tag"
              title={
                isDataEdgeCase(item)
                  ? '题面数据补的边界用例，不进存档'
                  : '边界用例（期望可留空，但抛异常 / 类型不符会判失败）'
              }
            >
              边界
            </span>
          ) : (
            <span className="case__tag case__tag--ghost" aria-hidden="true" />
          )}
          <span className="case__label">调用</span>
          <input
            className="case__field"
            aria-label={`第 ${index + 1} 条用例的调用表达式`}
            value={item.call}
            spellCheck={false}
            onChange={(e) =>
              persistCases(
                cases.map((c) => (c.id === item.id ? { ...c, call: e.target.value } : c)),
              )
            }
            placeholder={`Solution().${signature.method}(...)`}
          />
          {result ? (
            <span className={`case__result case__result--${tone}`}>
              {result.ok === true ? <Check /> : null}
              {result.ok === true
                ? '通过'
                : result.ok === false
                  ? result.soft
                    ? '与参考解不一致'
                    : '未通过'
                  : untouched
                    ? '未判定'
                    : '已运行 · 未设期望'}
            </span>
          ) : null}
          <button
            className="case__trace"
            onClick={() => void startTrace(item.call)}
            disabled={tracing}
            title="单步追踪：逐行看局部变量"
          >
            <Bug />
          </button>
          {isDataEdgeCase(item) ? (
            // 数据生成的边界用例删了也会在下次打开时回来，别给假承诺
            <button
              className="case__del"
              disabled
              title="题面数据生成的边界用例，不可删除"
              aria-label="数据生成的边界用例不可删除"
            >
              <Trash2 />
            </button>
          ) : (
            <button
              className="case__del"
              onClick={() => persistCases(cases.filter((c) => c.id !== item.id))}
              aria-label="删除用例"
            >
              <Trash2 />
            </button>
          )}
        </div>
        <div className="case__top" style={{ marginTop: 'var(--sp-1)' }}>
          <span className="case__no" />
          <span className="case__tag case__tag--ghost" aria-hidden="true" />
          <span className="case__label">期望</span>
          <input
            className="case__field"
            aria-label={`第 ${index + 1} 条用例的期望输出`}
            value={item.expected}
            spellCheck={false}
            onChange={(e) =>
              persistCases(
                cases.map((c) => (c.id === item.id ? { ...c, expected: e.target.value } : c)),
              )
            }
            placeholder="留空则只看输出，但抛异常 / 类型不符仍判失败"
          />
        </div>
        {result && result.ok === false && result.reason ? (
          <div className="case__reason" data-reason={result.reason}>
            {reasonLabel(result)}
          </div>
        ) : null}
        {diff ? (
          <div className="case__actual case__diff">
            <div>
              <span className="case__diff-label">期望</span>
              {diff.expectedParts.map((part, i) => (
                <span
                  key={`e-${i}`}
                  className={part.diff ? 'case__diff-part case__diff-part--diff' : 'case__diff-part'}
                >
                  {part.text}
                </span>
              ))}
            </div>
            <div>
              <span className="case__diff-label">实际</span>
              {diff.actualParts.map((part, i) => (
                <span
                  key={`a-${i}`}
                  className={part.diff ? 'case__diff-part case__diff-part--diff' : 'case__diff-part'}
                >
                  {part.text}
                </span>
              ))}
            </div>
          </div>
        ) : null}
        {result && !untouched && result.ok !== true && !diff ? (
          <div className="case__actual">
            {result.error ? (
              <span style={{ color: 'var(--danger-text)' }}>
                {result.error.split('\n').slice(-2).join(' ')}
              </span>
            ) : (
              <>
                实际：<strong>{result.repr || '（空）'}</strong>
              </>
            )}
          </div>
        ) : null}
      </div>
    )
  }

  /** 控制台里的一条明细：编号和「用例」tab 保持一致（用例 1、2、3…） */
  const renderConsoleRow = (item: TestCase, index: number) => {
    const result = results[item.id]
    if (!result) return null
    return (
      <div key={item.id} style={{ marginBottom: 'var(--sp-2)' }}>
        <span className={result.ok === true ? 'ok' : result.ok === false ? 'err' : 'dim'}>
          [{index + 1}] {result.ok === true ? 'PASS' : result.ok === false ? 'FAIL' : 'INFO'}
        </span>
        {item.kind === 'edge' ? <span className="console__tag">边界</span> : null}
        <span className="dim"> · {result.ms}ms · {item.call}</span>
        <button
          className="console__trace"
          onClick={() => void startTrace(item.call)}
          disabled={tracing}
          title="单步追踪这条用例，逐行看局部变量"
        >
          <Bug /> 追踪
        </button>
        {result.ok === false && result.reason ? (
          <div className="console__why">判失败：{reasonLabel(result)}</div>
        ) : null}
        {result.ok === null ? (
          <div className="dim">已运行 · 未设期望（只运行不判定）</div>
        ) : null}
        {result.repr ? <div>→ {result.repr}</div> : null}
        {result.error ? <div className="err">{result.error}</div> : null}
      </div>
    )
  }

  return (
    <div className="lab" ref={rootRef} style={{ '--lab-cases-h': `${casesPct}%` } as CSSProperties}>
      <div className="lab__head">
        <span className="lab__dot" />
        <span className="lab__title">代码实验室</span>
        <span className="lab__lang">Python 3</span>
        <span className="lab__status" data-tone={status === 'error' ? 'error' : 'ok'}>
          {status === 'loading' || running ? <span className="spinner" /> : null}
          {statusText}
        </span>
        <button className="btn" onClick={() => void copyCode()} title="复制当前代码">
          <ClipboardCopy />
        </button>
        <button
          className="btn"
          onClick={() => {
            setCode(starter)
            progress.saveCode(problem.no, starter)
            sessionReadyRef.current = false
            toast('已恢复初始模板')
          }}
          title="恢复初始模板"
        >
          <RotateCcw />
        </button>
        <button
          className="btn btn--run"
          data-outcome={outcome ?? 'none'}
          onClick={() => void runAll()}
          disabled={running}
        >
          {running ? <span className="spinner" /> : outcome === 'pass' ? <Check /> : <Play />}
          {running ? '运行中' : outcome === 'pass' ? '全部通过' : '运行'}
        </button>
      </div>

      {status === 'loading' ? (
        <div className="lab__banner">
          <span className="spinner" />
          首次运行需要加载 Python 运行时（本地约 10MB），稍等几秒。
        </div>
      ) : null}

      {status === 'error' ? (
        <div className="lab__banner lab__banner--error">
          <AlertCircle style={{ width: 'var(--sp-3)', height: 'var(--sp-3)' }} />
          {error || 'Python 运行时启动失败'}
          <button className="btn" onClick={() => reset()}>
            重试
          </button>
        </div>
      ) : null}

      <div className="lab__editor">
        <CodeMirror
          ref={editorRef}
          value={code}
          height="100%"
          theme="none"
          extensions={[python(), editorTheme, ...labStaticTheme]}
          basicSetup={{
            foldGutter: false,
            highlightActiveLine: true,
            autocompletion: true,
            bracketMatching: true,
            closeBrackets: true,
            indentOnInput: true,
          }}
          onChange={(value) => setCode(value)}
        />
      </div>

      <Splitter
        orientation="horizontal"
        onResize={resizeCases}
        label="拖动调整编辑器与用例区的高度（双击复位）"
      />

      <div className={`lab__cases${tall ? ' lab__cases--tall' : ''}`} data-outcome={outcome ?? 'none'}>
        <div className="lab__cases-head">
          <button
            className={`lab__tab${tab === 'cases' ? ' active' : ''}`}
            onClick={() => setTab('cases')}
            title={
              edgeFailed
                ? `${edgeFailed} 条边界用例未通过`
                : edgeTotal
                  ? `含 ${edgeTotal} 条边界用例`
                  : undefined
            }
          >
            用例{' '}
            <span className={`count${edgeFailed ? ' count--alert' : ''}`}>{cases.length}</span>
          </button>
          <button
            className={`lab__tab${tab === 'console' ? ' active' : ''}`}
            onClick={() => setTab('console')}
          >
            控制台
          </button>
          <button
            className={`lab__tab${tab === 'terminal' ? ' active' : ''}`}
            onClick={() => {
              setTab('terminal')
              window.setTimeout(() => terminalRef.current?.focus(), 30)
            }}
            title={`打开 Python 终端（${MOD_KEY} + \`）`}
          >
            <SquareTerminal style={{ width: 'var(--sp-3)', height: 'var(--sp-3)' }} />
            终端
            {vars.length ? <span className="count">{vars.length}</span> : null}
          </button>
          <button
            className={`lab__tab${tab === 'ai' ? ' active' : ''}`}
            onClick={() => setTab('ai')}
            title="让 DeepSeek 批改这段代码"
          >
            AI 判题
            {ai.verdict ? (
              <span className="count">
                {ai.verdict === 'pass' ? '✅' : ai.verdict === 'fail' ? '❌' : '⚠️'}
              </span>
            ) : ai.busy ? (
              <span className="count">…</span>
            ) : null}
          </button>
          {resultsList.length ? (
            <span
              className="lab__summary"
              data-tone={summaryTone}
              title={`官方示例 ${exampleVerdict}${edgeTotal ? ` · 边界用例 ${edgeVerdict}` : ''}${
                unjudgedTotal && (exampleJudged || edgeJudged) ? ` · ${unjudgedTotal} 条未判定` : ''
              }`}
            >
              <strong>示例 {exampleVerdict}</strong>
              {edgeTotal ? <span className="dim"> · 边界 {edgeVerdict}</span> : null}
            </span>
          ) : null}
          <div className="lab__cases-tools">
            {tab === 'cases' ? (
              <>
                <button
                  className="btn"
                  onClick={() => {
                    resetToBaseCases(buildCases())
                    setResults({})
                    toast('已重新载入题面示例')
                  }}
                  title="用题面示例重置用例（边界用例会重新追加在后面）"
                >
                  <RotateCcw /> 示例
                </button>
                <button className="btn" onClick={addEdgeCases} title="按签名推几条边界用例">
                  <Wand2 /> 边界
                </button>
                <button className="btn" onClick={() => addCase()}>
                  <Plus /> 用例
                </button>
              </>
            ) : tab === 'console' ? (
              <button
                className="btn"
                onClick={() => {
                  setResults({})
                  setTrace(null)
                }}
                title="清空控制台"
              >
                <Trash2 /> 清空
              </button>
            ) : null}
          </div>
        </div>

        {tab === 'cases' ? (
          <div className="lab__cases-body">
            {untouched ? (
              <div className="lab__untouched" role="status">
                <Info />
                <span>
                  还没开始写 —— 先实现 <code>{signature.method}</code>，再点运行。下面是官方示例，可以先在纸上走一遍。
                </span>
              </div>
            ) : null}
            {exampleRows.map(({ item, index }) => renderCaseRow(item, index))}
            {edgeRows.length ? (
              <div className="lab__edge">
                <button
                  className="lab__edge-toggle"
                  data-tone={edgeTone}
                  onClick={toggleEdgeOpen}
                  aria-expanded={edgeOpen}
                  title={edgeOpen ? '收起边界用例' : `展开 ${edgeTotal} 条边界用例，逐条看失败原因`}
                >
                  {edgeOpen ? <ChevronDown /> : <ChevronRight />}
                  <span className="lab__edge-title">边界用例 {edgeTotal} 条</span>
                  <span className="lab__edge-verdict">{edgeHeadline}</span>
                  <span className="lab__edge-action">{edgeOpen ? '收起' : '展开'}</span>
                </button>
                {edgeOpen ? edgeRows.map(({ item, index }) => renderCaseRow(item, index)) : null}
              </div>
            ) : null}
            {cases.length === 0 ? (
              <div className="lab__console-empty">
                还没有用例。点右上角「用例」添加，
                <br />
                或者用题面示例自动生成。
              </div>
            ) : null}
          </div>
        ) : tab === 'console' ? (
          <div className="lab__console">
            {trace ? (
              <TracePanel trace={trace} onClose={() => setTrace(null)} />
            ) : null}
            {resultsList.length === 0 && !firstError ? (
              <div className="lab__console-empty">
                {/* 包一层 <p>：grid 会把裸文本和 .kbd 拆成多个网格项，行距会被拉开 */}
                <p>
                  运行结果会显示在这里。
                  <br />
                  先写解法，再按 <span className="kbd">{MOD_KEY} Enter</span>；
                  用例右边的虫子按钮可以逐行追踪。
                </p>
              </div>
            ) : untouched ? (
              <div className="lab__console-empty">
                <p>
                  模板还没改，这次没有跑判题。
                  <br />
                  先写实现，再按 <span className="kbd">{MOD_KEY} Enter</span> 运行。
                </p>
              </div>
            ) : (
              <>
                {/* 汇总先分两段：官方示例 / 边界用例，别让 7 条边界把 3 条示例淹掉 */}
                <div className="console__summary" data-tone={summaryTone}>
                  <span
                    className="console__summary-part"
                    data-tone={exampleJudged ? (exampleFailed ? 'fail' : 'pass') : 'na'}
                  >
                    <span className="dim">官方示例 </span>
                    <strong>{exampleVerdict}</strong>
                  </span>
                  {edgeTotal ? (
                    <span className="console__summary-part" data-tone={edgeTone}>
                      <span className="dim"> · 边界 </span>
                      <strong>{edgeVerdict}</strong>
                    </span>
                  ) : null}
                </div>
                {exampleRows.map(({ item, index }) => renderConsoleRow(item, index))}
                {edgeTotal ? (
                  <div className="console__edge">
                    <button
                      className="console__edge-toggle"
                      data-tone={edgeTone}
                      onClick={() => setConsoleEdgeOpen((prev) => !prev)}
                      aria-expanded={consoleEdgeOpen}
                      title={consoleEdgeOpen ? '收起边界明细' : '展开边界明细，逐条看输出和失败原因'}
                    >
                      {consoleEdgeOpen ? <ChevronDown /> : <ChevronRight />}
                      <span>
                        边界用例明细 {edgeTotal} 条
                        {edgeFailed ? ` · ${edgeFailed} 条未通过` : ''}
                      </span>
                      <span className="dim">{consoleEdgeOpen ? '收起' : '展开'}</span>
                    </button>
                    {consoleEdgeOpen
                      ? edgeRows.map(({ item, index }) => renderConsoleRow(item, index))
                      : null}
                  </div>
                ) : null}
                {totalStdout ? (
                  <div>
                    <span className="dim">stdout</span>
                    <div>{totalStdout}</div>
                  </div>
                ) : null}
                {totalStderr ? (
                  <div>
                    <span className="dim">stderr</span>
                    <div className="err">{totalStderr}</div>
                  </div>
                ) : null}
                {firstError && resultsList.every((entry) => !entry.result.repr) ? (
                  <div className="err" style={{ marginTop: 'var(--sp-1)' }}>
                    <X
                      style={{
                        width: 'var(--sp-3)',
                        height: 'var(--sp-3)',
                        verticalAlign: 'middle',
                      }}
                    />{' '}
                    检查一下调用表达式是否和你的方法签名一致。
                  </div>
                ) : null}
              </>
            )}
          </div>
        ) : tab === 'terminal' ? (
          <Terminal
            ref={terminalRef}
            entries={entries}
            vars={vars}
            busy={termBusy}
            ready={status === 'ready' || status === 'running'}
            exampleCommands={exampleCommands}
            onSubmit={(command) => void submitCommand(command)}
            onInspect={() => void inspectVars()}
            onReset={() => void clearSession()}
            onLoadCode={() => void reloadSession()}
            onClear={() => setEntries([])}
            onInterrupt={interruptRun}
          />
        ) : (
          <AiReview problem={problem} code={code} run={runSummary} />
        )}
      </div>

      <div className="lab__hint">
        <span>
          代码自动保存 · <span className="kbd">{MOD_KEY} Enter</span> 运行 ·{' '}
          <span className="kbd">{MOD_KEY} `</span> 终端 · 结果按字面比对
        </span>
        <span className="mono">Pyodide · 本地执行</span>
      </div>
    </div>
  )
})
