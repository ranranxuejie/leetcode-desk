import type { Problem, Signature, SignatureParam } from './types'

/**
 * 初始代码生成器：给每道题一份「能直接跑」的 Python 模板。
 *
 * 设计取舍（为什么这么排优先级）：
 *
 * 1. 教程章节里的 `class Solution` 就是这题在 LeetCode 上的真实签名，形参名、类型标注都对得上，
 *    所以它最可信 —— 但它只存在于「正文」章节，设计题（LRU / Trie / 最小栈…）根本没有 Solution；
 * 2. 抽不到就退到内置 OVERRIDES：这里硬编码了 19 道题的骨架（5 道付费题 + 14 道设计题）；
 * 3. 再退到题库元数据 `problem.method` + `problem.params`（只有名字，没有类型）；
 * 4. 最后退成 `solve(*args, **kwargs)`，保证任何一道题都不会生成语法错误的代码。
 *
 * 纯函数：只吃 `Problem` 和章节 markdown 字符串，不读数据文件、不碰 React / DOM，也绝不抛异常
 * —— 模板生成失败最多是「模板丑」，不能让题目页白屏。
 */

// ---------------------------------------------------------------- 基础工具

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/

/** 类型标注里可能出现的 typing 名字：只 import 真用到的，避免每份模板顶上堆一行没用的 import。 */
const TYPING_NAMES = [
  'Any',
  'Callable',
  'DefaultDict',
  'Deque',
  'Dict',
  'Iterable',
  'Iterator',
  'List',
  'Optional',
  'Sequence',
  'Set',
  'Tuple',
  'Union',
]

const LEVEL_TEXT: Record<string, string> = { Easy: '简单', Medium: '中等', Hard: '困难' }

/** 一句话太长会把模板头撑成一坨，超了就截断。 */
const ONELINER_LIMIT = 110

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 行首缩进宽度：tab 按 4 个空格算（教程里两种缩进都出现过）。 */
function indentWidth(line: string): number {
  let width = 0
  for (const ch of line) {
    if (ch === ' ') width += 1
    else if (ch === '\t') width += 4
    else break
  }
  return width
}

/** 按顶层分隔符切开：括号 / 引号里的逗号不算（`List[Tuple[int, int]]` 这类）。 */
function splitTopLevel(text: string, sep = ','): string[] {
  const parts: string[] = []
  let cur = ''
  let depth = 0
  let quote = ''
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (quote) {
      cur += ch
      if (ch === '\\') {
        const next = text[i + 1]
        if (next !== undefined) {
          cur += next
          i += 1
        }
      } else if (ch === quote) {
        quote = ''
      }
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      cur += ch
      continue
    }
    if (ch === '[' || ch === '(' || ch === '{') depth += 1
    else if (ch === ']' || ch === ')' || ch === '}') depth -= 1
    if (ch === sep && depth <= 0) {
      parts.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  parts.push(cur)
  return parts
}

/** 顶层第一个 `ch` 的下标（忽略括号 / 引号里的）。找不到返回 -1。 */
function indexOfTopLevel(text: string, ch: string): number {
  let depth = 0
  let quote = ''
  for (let i = 0; i < text.length; i += 1) {
    const cur = text[i]
    if (quote) {
      if (cur === '\\') i += 1
      else if (cur === quote) quote = ''
      continue
    }
    if (cur === '"' || cur === "'") {
      quote = cur
      continue
    }
    if (cur === '[' || cur === '(' || cur === '{') depth += 1
    else if (cur === ']' || cur === ')' || cur === '}') depth -= 1
    else if (cur === ch && depth <= 0) return i
  }
  return -1
}

/** 从 `text[start]`（必须是 `(` 或 `[`）起读到配对的收括号，返回内部文本和收括号之后的下标。 */
function readBalanced(text: string, start: number, open = '(', close = ')'): { text: string; end: number } | null {
  if (text[start] !== open) return null
  let depth = 0
  let quote = ''
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i]
    if (quote) {
      if (ch === '\\') i += 1
      else if (ch === quote) quote = ''
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (ch === open) depth += 1
    else if (ch === close) {
      depth -= 1
      if (depth === 0) return { text: text.slice(start + 1, i), end: i + 1 }
    }
  }
  return null
}

// ---------------------------------------------------------------- markdown 里的 python 围栏

const PY_LANGS = ['python', 'py', 'python3']

/** 取出 markdown 里所有 ```python 围栏的内容（别的语言一律不要，免得把 Java/C++ 当签名）。 */
function pythonBlocks(markdown: string): string[] {
  const fence = /```[ \t]*([A-Za-z0-9_+#-]*)[^\n]*\n([\s\S]*?)```/g
  const blocks: string[] = []
  let match = fence.exec(markdown)
  while (match !== null) {
    if (PY_LANGS.includes(match[1].toLowerCase())) blocks.push(match[2])
    match = fence.exec(markdown)
  }
  return blocks
}

// ---------------------------------------------------------------- 签名解析

interface MethodSig {
  name: string
  params: SignatureParam[]
  returns: string
}

/** 解析一个形参：`nums: List[int]`、`n: int = 0`、`*args`、裸名字都认，认不出就丢掉。 */
function parseParam(raw: string): SignatureParam | null {
  const text = collapse(raw)
  if (!text) return null
  // self / cls 由模板自己补，不能再出现在形参里
  if (text === 'self' || text === 'cls') return null
  // *args / **kwargs：星号本身就是声明，类型标注没意义，原样保留
  if (text.startsWith('*')) {
    const star = /^(\*{1,2}[A-Za-z_]\w*)/.exec(text)
    return star ? { name: star[1], type: '' } : null
  }
  const eq = indexOfTopLevel(text, '=')
  const head = eq >= 0 ? text.slice(0, eq) : text
  const fallback = eq >= 0 ? text.slice(eq + 1) : ''
  const colon = indexOfTopLevel(head, ':')
  const name = collapse(colon >= 0 ? head.slice(0, colon) : head)
  if (!IDENT.test(name)) return null
  const type = colon >= 0 ? collapse(head.slice(colon + 1)) : ''
  const def = collapse(fallback)
  return def ? { name, type, default: def } : { name, type }
}

function parseParams(raw: string): SignatureParam[] {
  const params: SignatureParam[] = []
  for (const piece of splitTopLevel(raw)) {
    const param = parseParam(piece)
    if (param) params.push(param)
  }
  return params
}

interface ParsedDef extends MethodSig {
  indent: number
}

/** 扫出代码块里所有 `def`，连跨行的形参列表一起处理。 */
function parseDefs(body: string): ParsedDef[] {
  const defs: ParsedDef[] = []
  const re = /^([ \t]*)def[ \t]+([A-Za-z_]\w*)[ \t]*\(/gm
  let match = re.exec(body)
  while (match !== null) {
    const open = match.index + match[0].length - 1
    const paren = readBalanced(body, open)
    if (!paren) break
    // `) -> 类型:` 里的返回类型只取到本行冒号为止，跨行说明不是签名
    const tail = /^[ \t]*(?:->[ \t]*([^:\n]+?))?[ \t]*:/.exec(body.slice(paren.end))
    defs.push({
      name: match[2],
      params: parseParams(paren.text),
      returns: tail && tail[1] ? collapse(tail[1]) : '',
      indent: match[1].length,
    })
    re.lastIndex = paren.end
    match = re.exec(body)
  }
  return defs
}

/** 一个类里「方法层」的 def：取最小缩进那一层，顺便把方法体里的嵌套函数（dfs/build…）滤掉。 */
function classMethods(body: string): MethodSig[] {
  const defs = parseDefs(body)
  if (!defs.length) return []
  const min = Math.min(...defs.map((item) => item.indent))
  return defs
    .filter((item) => item.indent === min)
    .map((item) => ({ name: item.name, params: item.params, returns: item.returns }))
}

/** 取出 `class <className>:` 的类体（到下一个顶格代码行为止）。 */
function findClassBody(block: string, className: string): string | null {
  const re = new RegExp(`^([ \\t]*)class[ \\t]+${escapeRe(className)}[ \\t]*(?:\\([^)]*\\))?[ \\t]*:`, 'm')
  const match = re.exec(block)
  if (!match) return null
  const start = match.index + match[0].length
  const classIndent = indentWidth(match[1])
  const lines = block.slice(start).split('\n')
  const body: string[] = []
  for (const line of lines) {
    if (line.trim() && indentWidth(line) <= classIndent) break
    body.push(line)
  }
  return body.join('\n')
}

function findClassMethods(markdowns: string[], className: string): MethodSig[] | null {
  for (const markdown of markdowns) {
    for (const block of pythonBlocks(markdown)) {
      const body = findClassBody(block, className)
      if (!body) continue
      const methods = classMethods(body)
      if (methods.length) return methods
    }
  }
  return null
}

/** 真正要用户实现的那个方法：带 `__init__` 的类（如 497 随机点）优先认构造函数。 */
function primaryMethod(methods: MethodSig[]): MethodSig | null {
  if (!methods.length) return null
  if (methods[0].name === '__init__') return methods[0]
  return methods.find((item) => !item.name.startsWith('_')) ?? methods[0]
}

// ---------------------------------------------------------------- 内置骨架（OVERRIDES）

interface DesignSkeleton {
  className: string
  init: MethodSig | null
  methods: MethodSig[]
}

interface OverrideEntry {
  /** 普通题放 Solution 的方法名；设计题放类名（首字母大写，调用方据此识别「类形态」） */
  method: string
  params: SignatureParam[]
  returns: string
  design?: DesignSkeleton
}

function P(name: string, type: string): SignatureParam {
  return { name, type }
}

function M(name: string, params: SignatureParam[], returns: string): MethodSig {
  return { name, params, returns }
}

function D(className: string, init: MethodSig | null, methods: MethodSig[]): DesignSkeleton {
  return { className, init, methods }
}

/**
 * 19 道「从教程里抽不到签名」的题：5 道付费题（章节里没有代码）+ 14 道设计题（没有 Solution）。
 * 教程里能抽到的时候优先用教程（真实形参名更靠谱），这里的骨架是兜底。
 */
const OVERRIDES: Record<string, OverrideEntry> = {
  // ---- 付费题：其实都是普通 Solution 题，按题意给标准签名 ----
  '361': { method: 'maxKilledEnemies', params: [P('grid', 'List[List[str]]')], returns: 'int' },
  '531': { method: 'findLonelyPixel', params: [P('picture', 'List[List[str]]')], returns: 'int' },
  '533': {
    method: 'findBlackPixel',
    params: [P('picture', 'List[List[str]]'), P('target', 'int')],
    returns: 'int',
  },
  '694': { method: 'numDistinctIslands', params: [P('grid', 'List[List[int]]')], returns: 'int' },
  '1102': { method: 'maximumMinimumPath', params: [P('grid', 'List[List[int]]')], returns: 'int' },

  // ---- 设计题：类骨架（构造函数 + 待实现方法） ----
  '146': {
    method: 'LRUCache',
    params: [P('capacity', 'int')],
    returns: 'None',
    design: D(
      'LRUCache',
      M('__init__', [P('capacity', 'int')], ''),
      [M('get', [P('key', 'int')], 'int'), M('put', [P('key', 'int'), P('value', 'int')], 'None')],
    ),
  },
  '155': {
    method: 'MinStack',
    params: [],
    returns: 'None',
    design: D('MinStack', M('__init__', [], ''), [
      M('push', [P('val', 'int')], 'None'),
      M('pop', [], 'None'),
      M('top', [], 'int'),
      M('getMin', [], 'int'),
    ]),
  },
  '173': {
    method: 'BSTIterator',
    params: [P('root', 'Optional[TreeNode]')],
    returns: 'None',
    design: D('BSTIterator', M('__init__', [P('root', 'Optional[TreeNode]')], ''), [
      M('next', [], 'int'),
      M('hasNext', [], 'bool'),
    ]),
  },
  '208': {
    method: 'Trie',
    params: [],
    returns: 'None',
    design: D('Trie', M('__init__', [], ''), [
      M('insert', [P('word', 'str')], 'None'),
      M('search', [P('word', 'str')], 'bool'),
      M('startsWith', [P('prefix', 'str')], 'bool'),
    ]),
  },
  '211': {
    method: 'WordDictionary',
    params: [],
    returns: 'None',
    design: D('WordDictionary', M('__init__', [], ''), [
      M('addWord', [P('word', 'str')], 'None'),
      M('search', [P('word', 'str')], 'bool'),
    ]),
  },
  '225': {
    method: 'MyStack',
    params: [],
    returns: 'None',
    design: D('MyStack', M('__init__', [], ''), [
      M('push', [P('x', 'int')], 'None'),
      M('pop', [], 'int'),
      M('top', [], 'int'),
      M('empty', [], 'bool'),
    ]),
  },
  '232': {
    method: 'MyQueue',
    params: [],
    returns: 'None',
    design: D('MyQueue', M('__init__', [], ''), [
      M('push', [P('x', 'int')], 'None'),
      M('pop', [], 'int'),
      M('peek', [], 'int'),
      M('empty', [], 'bool'),
    ]),
  },
  '295': {
    method: 'MedianFinder',
    params: [],
    returns: 'None',
    design: D('MedianFinder', M('__init__', [], ''), [
      M('addNum', [P('num', 'int')], 'None'),
      M('findMedian', [], 'float'),
    ]),
  },
  '297': {
    method: 'Codec',
    params: [],
    returns: 'None',
    design: D('Codec', null, [
      M('serialize', [P('root', 'Optional[TreeNode]')], 'str'),
      M('deserialize', [P('data', 'str')], 'Optional[TreeNode]'),
    ]),
  },
  '380': {
    method: 'RandomizedSet',
    params: [],
    returns: 'None',
    design: D('RandomizedSet', M('__init__', [], ''), [
      M('insert', [P('val', 'int')], 'bool'),
      M('remove', [P('val', 'int')], 'bool'),
      M('getRandom', [], 'int'),
    ]),
  },
  '460': {
    method: 'LFUCache',
    params: [P('capacity', 'int')],
    returns: 'None',
    design: D(
      'LFUCache',
      M('__init__', [P('capacity', 'int')], ''),
      [M('get', [P('key', 'int')], 'int'), M('put', [P('key', 'int'), P('value', 'int')], 'None')],
    ),
  },
  '622': {
    method: 'MyCircularQueue',
    params: [P('k', 'int')],
    returns: 'None',
    design: D('MyCircularQueue', M('__init__', [P('k', 'int')], ''), [
      M('enQueue', [P('value', 'int')], 'bool'),
      M('deQueue', [], 'bool'),
      M('Front', [], 'int'),
      M('Rear', [], 'int'),
      M('isEmpty', [], 'bool'),
      M('isFull', [], 'bool'),
    ]),
  },
  '895': {
    method: 'FreqStack',
    params: [],
    returns: 'None',
    design: D('FreqStack', M('__init__', [], ''), [
      M('push', [P('val', 'int')], 'None'),
      M('pop', [], 'int'),
    ]),
  },
  '面试题 16.02': {
    method: 'WordsFrequency',
    params: [P('book', 'List[str]')],
    returns: 'None',
    design: D('WordsFrequency', M('__init__', [P('book', 'List[str]')], ''), [
      M('get', [P('word', 'str')], 'int'),
    ]),
  },
}

// ---------------------------------------------------------------- 链表 / 树判定

/** 「字典树 / 前缀树」只是名字里有树，结构上跟 TreeNode 没关系，别给它塞树节点定义。 */
function isTreeWord(text: string): boolean {
  if (text.includes('字典树') || text.includes('前缀树') || text.includes('Trie')) return false
  return text.includes('二叉树') || text.includes('二叉搜索树') || text === '树' || /^(Tree|tree)$/.test(text)
}

function isListWord(text: string): boolean {
  return text.includes('链表') || /^(Linked List|linked list)$/.test(text)
}

function mentionsType(types: string[], node: string): boolean {
  const joined = types.join(' ')
  return new RegExp(`\\b${node}\\b`).test(joined)
}

/**
 * 判定是否需要 ListNode / TreeNode 定义。
 * 签名里出现 `ListNode` / `TreeNode` 就是硬证据，直接采信；
 * 只有签名完全没有类型信息（退化到 problem.method 那条路）时，才用标签 / 标题猜。
 * 设计题永远不采信软证据 —— 否则「LRU 缓存」标签里有链表，就会塞一个用不到的单链表定义。
 */
function detectNodes(
  types: string[],
  problem: Problem,
  trustMeta: boolean,
): { needsListNode: boolean; needsTreeNode: boolean } {
  const needsListNode = mentionsType(types, 'ListNode')
  const needsTreeNode = mentionsType(types, 'TreeNode')
  if (needsListNode || needsTreeNode || !trustMeta) return { needsListNode, needsTreeNode }
  const words = [...(Array.isArray(problem.tags) ? problem.tags : []), problem.title ?? '']
  return { needsListNode: words.some(isListWord), needsTreeNode: words.some(isTreeWord) }
}

function typesOf(method: { params: SignatureParam[]; returns: string }): string[] {
  return [...method.params.map((param) => param.type), method.returns]
}

// ---------------------------------------------------------------- 解析出「要生成什么」

interface Skeleton {
  signature: Signature
  /** `Solution`，或设计题的类名 */
  className: string
  /** 构造函数（设计题的 `__init__`，或 497 这种带构造的 Solution） */
  init: MethodSig | null
  /** 用户要补全的方法 */
  methods: MethodSig[]
}

function normalizeMarkdowns(markdowns: string[]): string[] {
  if (!Array.isArray(markdowns)) return []
  return markdowns.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

function fromMethods(
  problem: Problem,
  methods: MethodSig[],
  className: string,
  source: Signature['source'],
  trustMeta: boolean,
): Skeleton {
  const primary = primaryMethod(methods)
  const rest = primary ? methods.filter((item) => item !== primary) : methods
  const isCtor = primary !== null && primary.name === '__init__'
  const nodes = detectNodes(primary ? typesOf(primary) : [], problem, trustMeta)
  return {
    signature: {
      method: primary ? primary.name : 'solve',
      params: primary ? primary.params : [],
      returns: primary ? primary.returns : '',
      needsListNode: nodes.needsListNode,
      needsTreeNode: nodes.needsTreeNode,
      source,
    },
    className,
    // 构造函数单独拎出来：模板里它排第一个，其余方法跟在后面
    init: isCtor ? primary : null,
    methods: isCtor ? rest.filter((item) => !item.name.startsWith('_')) : primary ? [primary] : [],
  }
}

function resolveSkeleton(problem: Problem, markdowns: string[]): Skeleton {
  const md = normalizeMarkdowns(markdowns)
  const override = OVERRIDES[problem.no]
  const design = override?.design ?? null

  // 1) 教程里的 class Solution —— 真实签名，形参名 / 类型都对得上
  const solutionMethods = findClassMethods(md, 'Solution')
  if (solutionMethods) {
    return fromMethods(problem, solutionMethods, 'Solution', 'tutorial', true)
  }

  // 2) 全量题库：没有精讲 markdown，但构建时带上了 LeetCode metaData 的参数类型
  const metaSignature = signatureFromMeta(problem)
  if (metaSignature) {
    return {
      signature: metaSignature,
      className: 'Solution',
      init: null,
      methods: [
        {
          name: metaSignature.method,
          params: metaSignature.params,
          returns: metaSignature.returns,
        },
      ],
    }
  }

  // 3) 设计题：按已知类名去章节里找真正的类骨架（教程里的方法名比硬编码更贴近本题）
  if (design) {
    const designMethods = findClassMethods(md, design.className)
    if (designMethods) {
      const init = designMethods.find((item) => item.name === '__init__') ?? null
      const methods = designMethods.filter(
        (item) => item.name !== '__init__' && !item.name.startsWith('_'),
      )
      const types = [...(init ? typesOf(init) : []), ...methods.flatMap(typesOf)]
      const nodes = detectNodes(types, problem, false)
      return {
        signature: {
          method: design.className,
          params: init ? init.params : [],
          returns: 'None',
          needsListNode: nodes.needsListNode,
          needsTreeNode: nodes.needsTreeNode,
          source: 'tutorial',
        },
        className: design.className,
        init,
        methods,
      }
    }
    // 3) 硬编码骨架兜底（教程缺失 / 付费题）
    const nodes = detectNodes(
      design.methods.flatMap(typesOf).concat(design.init ? typesOf(design.init) : []),
      problem,
      false,
    )
    return {
      signature: {
        method: design.className,
        params: design.init ? design.init.params : [],
        returns: 'None',
        needsListNode: nodes.needsListNode,
        needsTreeNode: nodes.needsTreeNode,
        source: 'override',
      },
      className: design.className,
      init: design.init,
      methods: design.methods,
    }
  }

  if (override) {
    const nodes = detectNodes(typesOf(override), problem, true)
    return {
      signature: {
        method: override.method,
        params: override.params,
        returns: override.returns,
        needsListNode: nodes.needsListNode,
        needsTreeNode: nodes.needsTreeNode,
        source: 'override',
      },
      className: 'Solution',
      init: null,
      methods: [{ name: override.method, params: override.params, returns: override.returns }],
    }
  }

  // 4) 退化到题库元数据：只有形参名，没有类型标注（标不出来就别瞎标）
  const rawMethod = collapse(problem.method ?? '')
  const names = (Array.isArray(problem.params) ? problem.params : [])
    .map((name) => collapse(name))
    .filter((name) => IDENT.test(name))
  const params: SignatureParam[] = names.map((name) => ({ name, type: '' }))
  const usable = IDENT.test(rawMethod) && rawMethod !== 'solve'
  const method = usable ? rawMethod : 'solve'
  const finalParams = params.length ? params : [{ name: '*args', type: '' }, { name: '**kwargs', type: '' }]
  const nodes = detectNodes([], problem, true)
  return {
    signature: {
      method,
      params: finalParams,
      returns: '',
      needsListNode: nodes.needsListNode,
      needsTreeNode: nodes.needsTreeNode,
      source: usable || params.length ? 'example' : 'fallback',
    },
    className: 'Solution',
    init: null,
    methods: [{ name: method, params: finalParams, returns: '' }],
  }
}

/** 兜底签名：连 problem 都读不出来时用它，保证调用方永远拿到一个合法对象。 */
const FALLBACK_SIGNATURE: Signature = {
  method: 'solve',
  params: [{ name: '*args', type: '' }, { name: '**kwargs', type: '' }],
  returns: '',
  needsListNode: false,
  needsTreeNode: false,
  source: 'fallback',
}

/** LeetCode metaData 的类型名 → Python 标注 */
const META_TYPE: Record<string, string> = {
  integer: 'int',
  'integer[]': 'List[int]',
  'integer[][]': 'List[List[int]]',
  double: 'float',
  'double[]': 'List[float]',
  string: 'str',
  'string[]': 'List[str]',
  'string[][]': 'List[List[str]]',
  character: 'str',
  'character[]': 'List[str]',
  'character[][]': 'List[List[str]]',
  boolean: 'bool',
  'boolean[]': 'List[bool]',
  ListNode: 'Optional[ListNode]',
  TreeNode: 'Optional[TreeNode]',
  Node: 'Optional[Node]',
  'ListNode[]': 'List[Optional[ListNode]]',
  'TreeNode[]': 'List[Optional[TreeNode]]',
  void: 'None',
}

/**
 * 用 LeetCode metaData 直接拼签名。
 * 全量题库里没有精讲 markdown，这是唯一能拿到「真实形参名 + 类型」的来源，
 * 用例生成（caseCall / suggestEdgeCases）和初始代码都依赖它。
 */
function signatureFromMeta(problem: Problem): Signature | null {
  const params = problem.paramTypes ?? []
  if (!params.length) return null
  const mapped = params.map((param) => ({
    name: param.name,
    type: META_TYPE[param.type] ?? '',
  }))
  const raw = mapped.map((param) => param.type).join(' ')
  return {
    method: problem.method && problem.method !== 'solve' ? problem.method : 'solve',
    params: mapped,
    returns: META_TYPE[problem.returnType ?? ''] ?? '',
    needsListNode: /\bListNode\b/.test(raw),
    needsTreeNode: /\bTreeNode\b/.test(raw),
    source: 'example',
  }
}

/** 从教程章节 markdown 里抽 class Solution 的完整签名；抽不到就退化到内置骨架 / problem.method。 */
export function resolveSignature(problem: Problem, markdowns: string[]): Signature {
  try {
    return resolveSkeleton(problem, markdowns).signature
  } catch {
    // 数据脏到解析器都炸了也不能连累题目页
    return FALLBACK_SIGNATURE
  }
}

// ---------------------------------------------------------------- 渲染

function renderParam(param: SignatureParam): string {
  if (param.name.startsWith('*')) return param.name
  const type = collapse(param.type)
  const head = type ? `${param.name}: ${type}` : param.name
  const def = param.default === undefined ? '' : collapse(param.default)
  return def ? `${head} = ${def}` : head
}

function renderDef(method: MethodSig, indent: string): string {
  const params = ['self', ...method.params.map(renderParam)].join(', ')
  const returns = collapse(method.returns)
  return `${indent}def ${method.name}(${params})${returns ? ` -> ${returns}` : ''}:`
}

function renderMethod(method: MethodSig, todo: string): string[] {
  return [renderDef(method, '    '), `        ${todo}`, '        pass']
}

function renderClass(skeleton: Skeleton): string[] {
  const blocks: string[][] = []
  if (skeleton.init) blocks.push(renderMethod(skeleton.init, '# TODO: 初始化要用的数据结构'))
  for (const method of skeleton.methods) blocks.push(renderMethod(method, `# TODO: 实现 ${method.name}`))
  if (!blocks.length) blocks.push(['    # TODO: 在这里写你的实现', '    pass'])
  const lines = [`class ${skeleton.className}:`]
  blocks.forEach((block, index) => {
    if (index > 0) lines.push('')
    lines.push(...block)
  })
  return lines
}

const LIST_NODE_DEF = [
  'class ListNode:',
  '    """LeetCode 的标准单链表节点：题目给的输入就是它。"""',
  '',
  '    def __init__(self, val=0, next=None):',
  '        self.val = val',
  '        self.next = next',
  '',
  '    def __repr__(self) -> str:',
  "        return f'ListNode({self.val})'",
]

const TREE_NODE_DEF = [
  'class TreeNode:',
  '    """LeetCode 的标准二叉树节点：题目给的输入就是它。"""',
  '',
  '    def __init__(self, val=0, left=None, right=None):',
  '        self.val = val',
  '        self.left = left',
  '        self.right = right',
  '',
  '    def __repr__(self) -> str:',
  "        return f'TreeNode({self.val})'",
]

const BUILD_LIST_DEF = [
  'def build_list(values):',
  '    """把 [1, 2, 3] 变成 1 -> 2 -> 3 的链表（只给本地自测用，不影响判题）。"""',
  '    dummy = ListNode(0)',
  '    cur = dummy',
  '    for value in values:',
  '        cur.next = ListNode(value)',
  '        cur = cur.next',
  '    return dummy.next',
]

const BUILD_TREE_DEF = [
  'def build_tree(values):',
  '    """把层序数组变成二叉树，None 表示空位（只给本地自测用，不影响判题）。"""',
  '    if not values or values[0] is None:',
  '        return None',
  '    root = TreeNode(values[0])',
  '    queue = [root]',
  '    index = 1',
  '    while queue and index < len(values):',
  '        node = queue.pop(0)',
  '        if index < len(values) and values[index] is not None:',
  '            node.left = TreeNode(values[index])',
  '            queue.append(node.left)',
  '        index += 1',
  '        if index < len(values) and values[index] is not None:',
  '            node.right = TreeNode(values[index])',
  '            queue.append(node.right)',
  '        index += 1',
  '    return root',
]

// ---------------------------------------------------------------- 头注释 / 自测行

function oneLiner(problem: Problem, markdowns: string[]): string {
  const re = /\*\*一句话\*\*[：:]\s*([^\n]+)/
  for (const markdown of markdowns) {
    const match = re.exec(markdown)
    if (!match) continue
    const text = collapse(match[1].replace(/[`*]/g, ''))
    if (text) return text.length > ONELINER_LIMIT ? `${text.slice(0, ONELINER_LIMIT)}…` : text
  }
  return collapse(problem.title ?? '')
}

function headerLines(problem: Problem, markdowns: string[]): string[] {
  const level = LEVEL_TEXT[problem.level] ?? ''
  const title = `${problem.no}. ${problem.title}${level ? `（${level}）` : ''}`
  const lines = [`# ${title}`, `# 一句话：${oneLiner(problem, markdowns)}`]
  const complexity = problem.complexity
  if (complexity && (complexity.time || complexity.space)) {
    const time = collapse(complexity.time ?? '')
    const space = collapse(complexity.space ?? '')
    const parts = [time ? `时间 ${time}` : '', space ? `空间 ${space}` : ''].filter(Boolean)
    if (parts.length) lines.push(`# 最优：${parts.join(' · ')}`)
  }
  lines.push('# 提示：先想清楚输入 / 输出 / 边界，写完点「运行」，用示例用例自测。')
  return lines
}

/** 设计题示例里的操作序列：`["LRUCache",...] [[2],[1,1],...]` → 构造参数 `2`。 */
function designCtorArgs(rawArgs: string): string | null {
  const text = (rawArgs ?? '').trim()
  if (!text.startsWith('[')) return null
  const names = readBalanced(text, 0, '[', ']')
  if (!names) return null
  const args = readBalanced(text.slice(names.end).trim(), 0, '[', ']')
  if (!args) return null
  const first = splitTopLevel(args.text).find((piece) => piece.trim().startsWith('['))
  if (!first) return null
  const inner = first.trim().slice(1, -1)
  const values = splitTopLevel(inner)
    .map((piece) => collapse(piece))
    .filter(Boolean)
    .map((piece) => piece.replace(/\bnull\b/g, 'None').replace(/\btrue\b/g, 'True').replace(/\bfalse\b/g, 'False'))
  return values.join(', ')
}

function isDesignSequence(rawArgs: string): boolean {
  const text = (rawArgs ?? '').trim()
  return text.startsWith('[') && /\]\s*\[/.test(text)
}

/** 形参类型 → 自测用的占位实参；认不出就给 `...`（语法合法，提示「换成真实参数」）。 */
function sampleArg(type: string): string {
  const text = collapse(type)
  if (/\bListNode\b/.test(text)) return 'build_list([])'
  if (/\bTreeNode\b/.test(text)) return 'build_tree([])'
  const flat = text.replace(/^Optional\[(.+)\]$/, '$1').toLowerCase()
  if (flat === 'int') return '0'
  if (flat === 'float') return '0.0'
  if (flat === 'str') return '""'
  if (flat === 'bool') return 'False'
  if (flat.startsWith('list[')) return '[]'
  return '...'
}

/** 按顶层逗号切实参；题库里还有 `s1="ab" s2 = "x"` 这种用空格分隔的关键字实参，一并切开。 */
function splitArgs(rawArgs: string): string[] {
  const text = (rawArgs ?? '').trim()
  if (!text) return []
  const parts: string[] = []
  let cur = ''
  let depth = 0
  let quote = ''
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (quote) {
      cur += ch
      if (ch === '\\') {
        const next = text[i + 1]
        if (next !== undefined) {
          cur += next
          i += 1
        }
      } else if (ch === quote) {
        quote = ''
      }
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      cur += ch
      continue
    }
    if (ch === '[' || ch === '(' || ch === '{') depth += 1
    else if (ch === ']' || ch === ')' || ch === '}') depth -= 1
    if (depth <= 0 && (ch === ',' || ch === '，')) {
      parts.push(cur)
      cur = ''
      continue
    }
    // 空格后面又冒出一个 `name =`，说明是下一个关键字实参
    if (depth === 0 && (ch === ' ' || ch === '\t') && cur.trim() && /^[A-Za-z_]\w*\s*=/.test(text.slice(i + 1))) {
      parts.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  parts.push(cur)
  return parts.map((piece) => collapse(piece)).filter(Boolean)
}

interface ParsedArg {
  name: string
  value: string
}

/** 把一条示例实参对到形参上：名字对得上就用关键字，个数对得上就按位置，都对不上就放弃。 */
function alignArgs(pieces: string[], params: SignatureParam[]): { param: SignatureParam; value: string; byName: boolean }[] | null {
  if (!pieces.length) return params.length ? null : []
  const parsed: ParsedArg[] = pieces.map((piece) => {
    const eq = indexOfTopLevel(piece, '=')
    if (eq > 0) return { name: collapse(piece.slice(0, eq)), value: collapse(piece.slice(eq + 1)) }
    return { name: '', value: piece }
  })
  if (parsed.some((item) => !item.value)) return null
  if (pieces.length !== params.length) return null
  const byName = parsed.every((item) => item.name && params.some((param) => param.name === item.name))
  const aligned: { param: SignatureParam; value: string; byName: boolean }[] = []
  for (let i = 0; i < parsed.length; i += 1) {
    const param = byName ? params.find((item) => item.name === parsed[i].name) : params[i]
    if (!param) return null
    aligned.push({ param, value: parsed[i].value, byName })
  }
  return aligned
}

/** 用题面示例拼一个「取消注释就能跑」的调用；拼不出来就返回空数组，交给占位符兜底。 */
function callFromExample(problem: Problem, signature: Signature): string[] {
  const examples = Array.isArray(problem.examples) ? problem.examples : []
  const calls: string[] = []
  for (const example of examples.slice(0, 2)) {
    const rawArgs = collapse(example?.callArgs ?? '')
    if (isDesignSequence(rawArgs)) continue
    const aligned = alignArgs(splitArgs(rawArgs), signature.params)
    if (!aligned) continue
    const args: string[] = []
    let usable = true
    for (const item of aligned) {
      const type = collapse(item.param.type)
      const wantsList = /\bListNode\b/.test(type)
      const wantsTree = /\bTreeNode\b/.test(type)
      // 链表 / 树参数必须拿到数组字面量才能造节点；`p=2` 这种「节点引用」造不出来，宁可整条放弃
      if ((wantsList || wantsTree) && !item.value.startsWith('[')) {
        usable = false
        break
      }
      let wrapped = item.value
      if (wantsList || wantsTree) {
        const build = wantsList ? 'build_list' : 'build_tree'
        // `List[Optional[ListNode]]`（合并 K 条链表）是「一堆链表」，逐个造
        wrapped = /^List\[/.test(type)
          ? `[${build}(v) for v in ${item.value}]`
          : `${build}(${item.value})`
      }
      args.push(item.byName ? `${item.param.name}=${wrapped}` : wrapped)
    }
    if (!usable) continue
    const call = `Solution().${signature.method}(${args.join(', ')})`
    const returns = collapse(signature.returns)
    calls.push(returns && returns !== 'None' ? `print(${call})` : call)
  }
  return calls
}

/** 结尾的注释版自测：最多 2 条，保证「取消注释就能跑」。 */
function selfTestLines(problem: Problem, skeleton: Skeleton): string[] {
  const signature = skeleton.signature
  const isClassForm = skeleton.className !== 'Solution' || skeleton.init !== null
  if (isClassForm) {
    const examples = Array.isArray(problem.examples) ? problem.examples : []
    let ctor: string | null = null
    for (const example of examples) {
      ctor = designCtorArgs(collapse(example?.callArgs ?? ''))
      if (ctor !== null) break
    }
    // 示例里没有操作序列（很多设计题没给示例）时，构造参数只能留个占位符
    if (ctor === null) ctor = skeleton.init && skeleton.init.params.length ? '...' : ''
    const lines = [`obj = ${skeleton.className}(${ctor})`]
    // 挑一个「有返回值」的方法做示范：`obj.next()` 比 `obj.push_left(...)` 更像在自测
    const first =
      skeleton.methods.find((item) => item.returns && item.returns !== 'None') ?? skeleton.methods[0]
    if (first) {
      const sample = first.params.map((param) => sampleArg(param.type)).join(', ')
      lines.push(`obj.${first.name}(${sample})`)
    }
    return lines
  }
  const calls = callFromExample(problem, signature)
  if (calls.length) return calls
  // 退化到 solve(*args, **kwargs) 时，占位符比 `solve(..., ...)` 更像样
  const params = signature.params
    .filter((param) => !param.name.startsWith('*'))
    .map((param) => sampleArg(param.type))
    .join(', ')
  return [`Solution().${signature.method}(${params})`]
}

// ---------------------------------------------------------------- 组装

function typingImports(skeleton: Skeleton): string[] {
  const methods = [skeleton.init, ...skeleton.methods].filter((item): item is MethodSig => item !== null)
  const text = methods.flatMap(typesOf).join(' ')
  return TYPING_NAMES.filter((name) => new RegExp(`\\b${name}\\b`).test(text))
}

/** 标注里出现了我们没定义的类名（Node / Employee / NestedInteger…）时，必须让注解延迟求值，否则低版本 Python 会 NameError。 */
const KNOWN_ANNOTATION_NAMES = new Set([
  ...TYPING_NAMES,
  'int',
  'float',
  'str',
  'bool',
  'bytes',
  'object',
  'None',
  'ListNode',
  'TreeNode',
])

function needsFutureAnnotations(skeleton: Skeleton): boolean {
  const methods = [skeleton.init, ...skeleton.methods].filter((item): item is MethodSig => item !== null)
  const names = methods.flatMap(typesOf).join(' ').match(/[A-Za-z_]\w*/g) ?? []
  return names.some((name) => !KNOWN_ANNOTATION_NAMES.has(name))
}

/** 用 LeetCode 官方模板拼初始代码：补 typing import、补节点类、补构造辅助函数。 */
function starterFromSnippet(problem: Problem): string {
  const code = (problem.starterCode ?? '').trim()
  if (!code) return buildStarter(problem, [])
  const lines: string[] = [...headerLines(problem, []), '']

  const needsList = /\bListNode\b/.test(code) && !/class ListNode\b/.test(code)
  const needsTree = /\bTreeNode\b/.test(code) && !/class TreeNode\b/.test(code)
  const typing = ['List', 'Optional', 'Dict', 'Set', 'Tuple', 'Deque'].filter((name) =>
    new RegExp(`\\b${name}\\[`).test(code),
  )
  if (typing.length && !/from typing import/.test(code)) {
    lines.push(`from typing import ${typing.join(', ')}`, '')
  }
  if (needsList) lines.push(...LIST_NODE_DEF, '')
  if (needsTree) lines.push(...TREE_NODE_DEF, '')
  if (needsList) lines.push(...BUILD_LIST_DEF, '')
  if (needsTree) lines.push(...BUILD_TREE_DEF, '')
  lines.push(code)
  return `${lines.join('\n')}\n`
}

/** 生成「初始代码」。必须可直接运行（无语法错误、无 NameError）。 */
export function buildStarter(problem: Problem, markdowns: string[]): string {
  try {
    return assembleStarter(problem, markdowns)
  } catch {
    // 极端脏数据下也要给一份能编译的模板，不能把代码编辑器卡死
    return [
      '# 这道题的模板生成失败了，先手写一个入口：',
      'class Solution:',
      '    def solve(self, *args, **kwargs):',
      '        # TODO: 在这里写你的解法',
      '        pass',
      '',
    ].join('\n')
  }
}

function assembleStarter(problem: Problem, markdowns: string[]): string {
  const md = normalizeMarkdowns(markdowns)
  // 全量题库的题没有精讲 markdown，但抓到了 LeetCode 官方的 python3 模板 —— 它是最准的签名，
  // 直接拿来当初始代码，只按需要补 ListNode / TreeNode 和构造辅助函数。
  if (problem.starterCode && !md.length) {
    return starterFromSnippet(problem)
  }
  const skeleton = resolveSkeleton(problem, md)
  const signature = skeleton.signature
  const lines: string[] = [...headerLines(problem, md), '']

  const future = needsFutureAnnotations(skeleton)
  if (future) lines.push('from __future__ import annotations')
  const imports = typingImports(skeleton)
  if (imports.length) {
    lines.push(`from typing import ${imports.join(', ')}`)
  }
  if (future || imports.length) lines.push('')

  if (signature.needsListNode) lines.push(...LIST_NODE_DEF, '')
  if (signature.needsTreeNode) lines.push(...TREE_NODE_DEF, '')
  if (signature.needsListNode) lines.push(...BUILD_LIST_DEF, '')
  if (signature.needsTreeNode) lines.push(...BUILD_TREE_DEF, '')

  lines.push(...renderClass(skeleton), '')

  const tests = selfTestLines(problem, skeleton)
  if (tests.length) {
    lines.push('# 本地自测（取消注释，或在右侧终端里直接敲）：')
    for (const test of tests) lines.push(`# ${test}`)
  }
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`
}
