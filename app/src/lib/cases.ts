import type { Example, Problem, Signature, SignatureParam, TestCase } from './types'
import { normalizeOutput } from './utils'
import { isDeepOrderFree, isOrderFree, sameAnswerIgnoringOrder } from './answer-order'

/**
 * 用例工具库：把「题面示例 / 边界用例 / 输出对比」这些纯数据的活儿集中在这里，
 * 让 CodeLab 只管渲染。所有函数都是纯函数，不碰 DOM、不读数据文件、绝不抛异常。
 */

/** 方法名 / 参数名只认 ASCII 标识符：题库里的中文只会出现在标题和说明里，认 Unicode 反而会放过脏数据。 */
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/

/** 关键字实参名撞上 Python 关键字（`from=1`）会直接语法错误，这种时候只能退回位置实参。 */
const PY_KEYWORDS = new Set(
  'False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield'.split(
    ' '
  ),
)

function isSafeKeywordName(name: string): boolean {
  return IDENT.test(name) && !PY_KEYWORDS.has(name)
}

/** diff 展示上限：失败用例可能是一整棵序列化出来的树，全量塞进 DOM 会卡。 */
const DIFF_LIMIT = 400

/** diff 切分用的 token 分隔符（空白、逗号、括号、引号），保留分隔符才能还原原文。 */
const DIFF_SPLIT = /([\s,()[\]{}'"]+)/

export interface DiffPart {
  text: string
  diff: boolean
}

export interface OutputDiff {
  equal: boolean
  expectedParts: DiffPart[]
  actualParts: DiffPart[]
}

export interface EdgeCase {
  label: string
  call: string
  expected: string
}

// ---------------------------------------------------------------- 小工具

function rawMethod(problem: Problem, signature: Signature | null): string {
  const fromSignature = (signature?.method ?? '').trim()
  if (fromSignature) return fromSignature
  return (problem?.method ?? '').trim()
}

/**
 * 「类形态」的题：设计题（LRUCache/MinStack…）没有可解的单个方法，
 * 或者签名退化成了 solve —— 这类题的调用表达式不能写成 Solution().xxx()。
 */
function isClassLikeName(name: string): boolean {
  if (!name || !IDENT.test(name)) return true
  if (name === '__init__') return true
  return /^[A-Z]/.test(name)
}

/** 括号 / 引号是否配平，且没有分号、换行这种会把一行调用拆坏的东西。 */
function isBalanced(text: string): boolean {
  let depth = 0
  let quote = ''
  for (let i = 0; i < text.length; i += 1) {
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
    if (ch === '[' || ch === '(' || ch === '{') depth += 1
    else if (ch === ']' || ch === ')' || ch === '}') {
      depth -= 1
      if (depth < 0) return false
    } else if (ch === ';' || ch === '\n' || ch === '\r') return false
  }
  return depth === 0 && !quote
}

/** 题面数据里偶尔混着 JSON 字面量（null/true/false），换成 Python 的写法，引号内的不动。 */
function normalizeLiterals(text: string): string {
  let out = ''
  let quote = ''
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (quote) {
      out += ch
      if (ch === '\\') {
        const next = text[i + 1]
        if (next !== undefined) {
          out += next
          i += 1
        }
      } else if (ch === quote) {
        quote = ''
      }
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      out += ch
      continue
    }
    const tail = text.slice(i)
    const word = /^(null|true|false)(?![A-Za-z0-9_])/.exec(tail)
    if (word && !/[A-Za-z0-9_]/.test(text[i - 1] ?? '')) {
      out += word[1] === 'null' ? 'None' : word[1] === 'true' ? 'True' : 'False'
      i += word[1].length - 1
      continue
    }
    out += ch
  }
  return out
}

/**
 * 按顶层逗号切分实参。题库里的 callArgs 有两种写法：
 *   `nums=[2,7,11,15], target=9`（逗号分隔，最常见）
 *   `first="pale" second = "ple"`（空格分隔，没有逗号）
 * 后者如果原样拼进调用就是语法错误，所以在顶层遇到新的 `name =` 时补切一刀。
 * 嵌套括号和引号里的逗号一律不切。
 */
function splitTopLevelArgs(raw: string): string[] {
  const text = raw.trim()
  if (!text) return []
  const parts: string[] = []
  let cur = ''
  let depth = 0
  let quote = ''
  const push = () => {
    const piece = cur.trim()
    if (piece) parts.push(piece)
    cur = ''
  }
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
      push()
      continue
    }
    if (depth === 0 && (ch === ' ' || ch === '\t') && cur.trim()) {
      if (/^[A-Za-z_][A-Za-z0-9_]*\s*=/.test(text.slice(i + 1))) {
        push()
        continue
      }
    }
    cur += ch
  }
  push()
  return parts
}

/** 单个实参长得像不像一个合法表达式：`name=value` 或裸值，且括号配平。 */
function isPlausibleArg(arg: string): boolean {
  if (!arg || !isBalanced(arg)) return false
  const eq = arg.indexOf('=')
  if (eq > 0) {
    const name = arg.slice(0, eq).trim()
    if (IDENT.test(name) && arg[eq - 1] !== '=' && arg[eq + 1] !== '=') {
      return arg.slice(eq + 1).trim().length > 0
    }
  }
  return true
}

/** 把 `second = "ple"` 收拾成 `second="ple"`，拼接出来的调用更好读。 */
function tidyArg(arg: string): string {
  const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([\s\S]+)$/.exec(arg)
  if (!match) return arg
  const value = match[2].trim()
  if (!value || value.startsWith('=')) return arg
  return `${match[1]}=${value}`
}

/** 去掉 `name=` 前缀，只留值（用于退回位置实参）。 */
function stripArgName(arg: string): string {
  const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([\s\S]+)$/.exec(arg)
  if (!match) return arg
  const value = match[2].trim()
  if (!value || value.startsWith('=')) return arg
  return value
}

/** 把 callArgs 变成一组可以直接拼进括号的实参；任何一步不对就返回空数组（退化成无参调用）。 */
function buildArgs(rawArgs: string): string[] {
  const text = (rawArgs ?? '').trim()
  if (!text) return []
  const parts = splitTopLevelArgs(normalizeLiterals(text)).map(tidyArg)
  if (!parts.length) return []
  if (!parts.every(isPlausibleArg)) return []
  if (!isBalanced(parts.join(', '))) return []
  // 有一个实参名不能用关键字写法，就整体退回位置实参，保证语法合法。
  const hasUnsafeName = parts.some((part) => {
    const eq = part.indexOf('=')
    const name = eq > 0 ? part.slice(0, eq).trim() : ''
    return Boolean(name) && !isSafeKeywordName(name)
  })
  return hasUnsafeName ? parts.map(stripArgName) : parts
}

// ---------------------------------------------------------------- 设计题：LeetCode 操作序列

interface DesignCall {
  className: string
  ctorArgs: string[]
}

/** 从 start 处的 `[` 起，读到配对的 `]`（尊重字符串里的括号）。 */
function readBracketGroup(text: string, start: number): { text: string; end: number } | null {
  if (text[start] !== '[') return null
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
    if (ch === '[') depth += 1
    else if (ch === ']') {
      depth -= 1
      if (depth === 0) return { text: text.slice(start, i + 1), end: i + 1 }
    }
  }
  return null
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

function pyLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'None'
  if (typeof value === 'boolean') return value ? 'True' : 'False'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'None'
  if (typeof value === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(pyLiteral).join(', ')}]`
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}: ${pyLiteral(v)}`).join(', ')}}`
  }
  return 'None'
}

/**
 * 设计题的示例是 LeetCode 的「操作序列」：
 *   `["MinStack","push",...] [[],[-2],[0],...]`
 * 第一段是类名 + 方法名，第二段是每次调用的实参；构造函数实参就是第二段的第一项。
 * 解析不出来就返回 null，调用方退化成普通方法调用。
 */
function parseDesignCall(rawArgs: string): DesignCall | null {
  const text = (rawArgs ?? '').trim()
  if (!text.startsWith('[')) return null
  const namesGroup = readBracketGroup(text, 0)
  if (!namesGroup) return null
  // 两段之间可能只隔空格（LeetCode 原样），也可能被数据清洗成了逗号（如 895 题）。
  const rest = text.slice(namesGroup.end).trim().replace(/^[,，]\s*/, '')
  const argsGroup = readBracketGroup(rest, 0)
  if (!argsGroup) return null
  if (rest.slice(argsGroup.end).trim()) return null
  const names = parseJson(namesGroup.text)
  const args = parseJson(argsGroup.text)
  if (!Array.isArray(names) || !names.length || typeof names[0] !== 'string') return null
  if (!Array.isArray(args) || !args.length) return null
  const first = args[0]
  if (!Array.isArray(first)) return null
  const className = (names[0] as string).trim()
  if (!IDENT.test(className)) return null
  return { className, ctorArgs: first.map(pyLiteral) }
}

// ---------------------------------------------------------------- 示例调用

/**
 * 从题面示例构造调用表达式。
 * 退化顺序：callArgs > 无参调用；设计题优先用操作序列里的类名构造实例（`LRUCache(2)`）。
 * 所有分支产出的字符串都必须能被 Python 解析，宁可丢掉实参也不能给出语法错误。
 */
export function exampleCall(problem: Problem, example: Example, signature: Signature | null): string {
  const rawArgs = typeof example?.callArgs === 'string' ? example.callArgs : ''
  const method = rawMethod(problem, signature)
  const classLike = isClassLikeName(method)
  const design = parseDesignCall(rawArgs)
  if (design && (classLike || method === 'solve' || signature?.source === 'override')) {
    return `${design.className}(${design.ctorArgs.join(', ')})`
  }
  const args = buildArgs(rawArgs)
  if (classLike) {
    // 拿不到类名时用 Solution 兜底：语法一定合法，是否跑得通取决于用户写的类名。
    const className = IDENT.test(method) && /^[A-Z]/.test(method) ? method : 'Solution'
    return `${className}(${args.join(', ')})`
  }
  return `Solution().${method}(${args.join(', ')})`
}

// ---------------------------------------------------------------- 一定能跑的示例调用

/** 一条实参：`name` 为空表示按位置传。 */
interface ArgPiece {
  name: string
  value: string
}

/** 对齐后的实参：`param` 是它落在哪个形参上（按位置传时也记下来，供类型兜底判断用）。 */
interface AlignedArg extends ArgPiece {
  param: SignatureParam | null
}

/**
 * 顶层（括号 / 引号之外）的 `=` 下标；`==` `>=` `<=` `!=` `:=` 都不算赋值。
 * 不能用 `indexOf('=')` 硬找：题库里有 `s = "a=b"` 这种值里带等号的实参。
 */
function indexOfTopLevelAssign(text: string): number {
  let depth = 0
  let quote = ''
  for (let i = 0; i < text.length; i += 1) {
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
    if (ch === '[' || ch === '(' || ch === '{') {
      depth += 1
      continue
    }
    if (ch === ']' || ch === ')' || ch === '}') {
      depth -= 1
      continue
    }
    if (ch !== '=' || depth > 0) continue
    const before = text[i - 1] ?? ''
    const after = text[i + 1] ?? ''
    if (before === '=' || before === '!' || before === '<' || before === '>' || after === '=') continue
    return i
  }
  return -1
}

/** 单条实参文本 → ArgPiece；`name=` 后面空着算坏数据。 */
function toArgPiece(text: string): ArgPiece | null {
  const eq = indexOfTopLevelAssign(text)
  if (eq < 0) return { name: '', value: text }
  const name = text.slice(0, eq).trim()
  const value = text.slice(eq + 1).trim()
  if (!value) return null
  // 名字不能当关键字实参（Python 关键字 / 非法标识符）时只留值：语法合法优先
  return { name: isSafeKeywordName(name) ? name : '', value }
}

/** 引号外的非 ASCII 字符（中文说明、全角标点）不是合法 Python 代码，遇到就判脏。 */
function hasStrayNonAscii(text: string): boolean {
  let quote = ''
  for (let i = 0; i < text.length; i += 1) {
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
    if (ch.charCodeAt(0) > 126) return true
  }
  return false
}

/**
 * 把一段实参文本切成 ArgPiece。
 * 返回 null 表示「整组不可信」：空值、括号 / 引号不配平、带分号或换行 ——
 * 这种时候宁可让调用方显示「请手动填实参」，也不要拼出一条必炸的表达式。
 */
function parseArgPieces(raw: string): ArgPiece[] | null {
  const text = (raw ?? '').trim()
  if (!text) return []
  const parts = splitTopLevelArgs(normalizeLiterals(text))
  if (!parts.length) return []
  const pieces: ArgPiece[] = []
  for (const part of parts) {
    const tidy = tidyArg(part)
    // isBalanced 顺手挡掉分号 / 换行 / 引号不配平
    if (!isBalanced(tidy) || hasStrayNonAscii(tidy)) return null
    const piece = toArgPiece(tidy)
    if (!piece) return null
    pieces.push(piece)
  }
  return pieces
}

/**
 * `example.input` 兜底解析：`输入：s = "42"` / `42` / `nums = [1,2], k = 3`，
 * 以及多行写法 `first = "pale"\nsecond = "ple"`。
 * 换行只有在顶层才当实参分隔符 —— 括号里的换行只是排版，换成空格。
 */
function inputToArgText(rawInput: string): string {
  const text = (rawInput ?? '').replace(/^\s*输入\s*[：:]\s*/, '').trim()
  if (!text) return ''
  let out = ''
  let depth = 0
  let quote = ''
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (quote) {
      out += ch
      if (ch === '\\') {
        const next = text[i + 1]
        if (next !== undefined) {
          out += next
          i += 1
        }
      } else if (ch === quote) {
        quote = ''
      }
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      out += ch
      continue
    }
    if (ch === '[' || ch === '(' || ch === '{') {
      depth += 1
      out += ch
      continue
    }
    if (ch === ']' || ch === ')' || ch === '}') {
      depth -= 1
      out += ch
      continue
    }
    if (ch === '\n' || ch === '\r') {
      out += depth > 0 ? ' ' : ', '
      continue
    }
    out += ch
  }
  return out.trim().replace(/^,\s*/, '')
}

/** 按形参顺序把「名字对得上」的实参排好；有名字对不上（或重名）就返回 null。 */
function orderByParams(pieces: ArgPiece[], params: SignatureParam[]): AlignedArg[] | null {
  const used = new Set<number>()
  const out: AlignedArg[] = []
  for (const param of params) {
    const index = pieces.findIndex((piece, i) => !used.has(i) && piece.name === param.name)
    if (index < 0) continue
    used.add(index)
    out.push({ name: param.name, value: pieces[index].value, param })
  }
  return out.length === pieces.length ? out : null
}

/**
 * 个数一致、但只有一部分实参名对得上形参：对得上的按名字落位，
 * 剩下的按「空位」顺序顶上去，全部写成关键字实参（不会和位置实参打架）。
 */
function assignByElimination(pieces: ArgPiece[], params: SignatureParam[]): AlignedArg[] | null {
  if (!params.every((param) => isSafeKeywordName(param.name))) return null
  const used = new Set<number>()
  const assigned: { index: number; value: string }[] = []
  const pending: string[] = []
  for (const piece of pieces) {
    const index = piece.name ? params.findIndex((param, i) => !used.has(i) && param.name === piece.name) : -1
    if (index < 0) {
      pending.push(piece.value)
      continue
    }
    used.add(index)
    assigned.push({ index, value: piece.value })
  }
  const free: number[] = []
  params.forEach((_, index) => {
    if (!used.has(index)) free.push(index)
  })
  if (pending.length > free.length) return null
  pending.forEach((value, offset) => assigned.push({ index: free[offset], value }))
  assigned.sort((a, b) => a.index - b.index)
  return assigned.map((item) => ({ name: params[item.index].name, value: item.value, param: params[item.index] }))
}

/**
 * 把实参对到形参上，优先级：
 * 1. 每个实参都带名字且都能对上 → 关键字实参（按形参顺序）；
 * 2. 个数一致 → 名字能对上的按名字落位、其余顶空位；一个都对不上就按题面顺序传位置实参；
 * 3. 个数不一致 → 只保留名字能对上的那些（按形参顺序），一个都对不上就放弃。
 */
function alignPieces(pieces: ArgPiece[], params: SignatureParam[]): AlignedArg[] | null {
  if (!pieces.length) return []
  const paramNames = new Set(params.map((param) => param.name))
  const namedCount = pieces.filter((piece) => piece.name && paramNames.has(piece.name)).length
  if (namedCount === pieces.length) {
    const ordered = orderByParams(pieces, params)
    if (ordered) return ordered
  }
  if (pieces.length === params.length) {
    if (namedCount > 0) {
      const byName = assignByElimination(pieces, params)
      if (byName) return byName
    }
    // 名字对不上（或名字不能当关键字）→ 按题面顺序传位置实参
    return pieces.map((piece, index) => ({ name: '', value: piece.value, param: params[index] ?? null }))
  }
  const kept = pieces.filter((piece) => piece.name && paramNames.has(piece.name))
  if (!kept.length) return null
  return orderByParams(kept, params)
}

/** 节点形参必须拿到数组字面量：`p=2` 这种「节点引用」交给 nodes.ts 也只会 AttributeError。 */
function wantsNodeLiteral(type: string): boolean {
  return /\bListNode\b|\bTreeNode\b/.test(type ?? '')
}

/**
 * 这条调用能不能真的跑起来（只判静态能确定的部分）：
 * 少给必填形参 / 多给实参 / 关键字名不存在 / 节点形参拿到标量 —— 都会必然 TypeError。
 */
function argsSatisfy(args: AlignedArg[], params: SignatureParam[]): boolean {
  // 签名里有 *args / **kwargs 时不猜个数
  if (params.some((param) => param.name.startsWith('*'))) return true
  const required = params.filter((param) => param.default === undefined).length
  if (args.length < required || args.length > params.length) return false
  const seen = new Set<string>()
  for (const arg of args) {
    if (arg.name) {
      if (!params.some((param) => param.name === arg.name)) return false
      if (seen.has(arg.name)) return false
      seen.add(arg.name)
    }
    if (arg.param && wantsNodeLiteral(arg.param.type) && !arg.value.trim().startsWith('[')) return false
  }
  return true
}

/** 构造调用的实参个数检查（设计题用，实参已经是字面量，不涉及名字）。 */
function countSatisfies(values: string[], params: SignatureParam[]): boolean {
  if (params.some((param) => param.name.startsWith('*'))) return true
  const required = params.filter((param) => param.default === undefined).length
  return values.length >= required && values.length <= params.length
}

/** 签名缺失时退回题库元数据：只有形参名，没有类型标注（没标注就别瞎标）。 */
function effectiveParams(problem: Problem, signature: Signature | null): SignatureParam[] {
  if (signature && Array.isArray(signature.params) && signature.params.length) return signature.params
  const names = Array.isArray(problem?.params) ? problem.params : []
  return names.filter((name) => IDENT.test(name)).map((name) => ({ name, type: '' }))
}

/**
 * 是不是「设计题」：LeetCode 操作序列、`solve` / `__init__`、或签名给的是类名（大写开头）。
 * 这类题根本没有 `class Solution` 可调，写成 `Solution().xxx()` 必然 NameError。
 */
function isDesignProblem(problem: Problem, signature: Signature | null): boolean {
  const method = rawMethod(problem, signature)
  if (!method) return true
  if (method === '__init__' || method === 'solve') return true
  return IDENT.test(method) && /^[A-Z]/.test(method)
}

/** 设计题的类名：签名 / 题库元数据里的大写开头方法名（`LRUCache`、`Codec`…）。 */
function designClassName(problem: Problem, signature: Signature | null): string {
  const candidates = [rawMethod(problem, signature), (problem?.method ?? '').trim()]
  for (const name of candidates) {
    if (!name || name === 'solve' || name === '__init__') continue
    if (IDENT.test(name) && /^[A-Z]/.test(name)) return name
  }
  return ''
}

/** 长得像操作序列（两段数组）但解析不出来：整段都不是「一个实参」，别硬塞进构造调用。 */
function looksLikeDesignSequence(text: string): boolean {
  const raw = (text ?? '').trim()
  return raw.startsWith('[') && /\]\s*[,，]?\s*\[/.test(raw)
}

/** 设计题只产出构造调用（`MinStack()` / `LRUCache(2)`），绝不产出 `Solution().方法()`。 */
function designCase(
  problem: Problem,
  signature: Signature | null,
  params: SignatureParam[],
  seq: DesignCall | null,
  rawArgs: string,
  inputText: string,
): string {
  const className = seq?.className ?? designClassName(problem, signature)
  if (!className) return ''
  let values: string[] = seq ? seq.ctorArgs : []
  if (!seq) {
    const text = rawArgs || inputText
    if (looksLikeDesignSequence(text)) return ''
    // 没有操作序列时（297 这种），把示例输入当构造实参试一把；对不上就退回无参构造
    const pieces = parseArgPieces(text)
    const aligned = pieces ? alignPieces(pieces, params) : null
    if (aligned && aligned.length && argsSatisfy(aligned, params)) {
      values = aligned.map((arg) => (arg.name ? `${arg.name}=${arg.value}` : arg.value))
    }
  }
  if (!countSatisfies(values, params)) return ''
  const call = `${className}(${values.join(', ')})`
  return isBalanced(call) ? call : ''
}

/**
 * 把一条题面示例变成「一定能跑」的调用表达式。
 * 跑不通时返回 ''（空字符串），由调用方决定怎么提示，绝不返回语法错误或必然 TypeError 的表达式。
 *
 * 和 `exampleCall` 的区别：名字对不上时不再硬塞关键字实参（`longestOnes(..., K=2)` 那种
 * `TypeError: unexpected keyword argument`），而是退回位置实参或只保留能对上的；
 * callArgs 为空时还会从 `example.input` 再解析一次；设计题只给构造调用。
 *
 * 注意：链表 / 树的实参包装和返回值还原由 `nodes.ts` 的 `wrapNodeCall` 在运行时统一处理，
 * 这里只负责「表达式本身合法 + 形参名对得上」，不要在这里包 `_build_list`。
 */
export function caseCall(problem: Problem, example: Example, signature: Signature | null): string {
  try {
    const rawArgs = typeof example?.callArgs === 'string' ? example.callArgs.trim() : ''
    const inputText = inputToArgText(example?.input ?? '')
    const params = effectiveParams(problem, signature)
    // 操作序列可能只出现在 input 里（callArgs 缺失时），两处都认
    const seq = parseDesignCall(rawArgs) ?? parseDesignCall(inputText)
    if (seq || isDesignProblem(problem, signature)) {
      return designCase(problem, signature, params, seq, rawArgs, inputText)
    }
    const method = rawMethod(problem, signature)
    if (!method || !IDENT.test(method) || PY_KEYWORDS.has(method)) return ''
    const pieces = rawArgs ? parseArgPieces(rawArgs) : parseArgPieces(inputText)
    if (!pieces) return ''
    const aligned = alignPieces(pieces, params)
    if (!aligned || !argsSatisfy(aligned, params)) return ''
    const args = aligned.map((arg) => (arg.name ? `${arg.name}=${arg.value}` : arg.value))
    const call = `Solution().${method}(${args.join(', ')})`
    // 最后一道保险：括号 / 引号配平，不通过就不给
    return isBalanced(call) ? call : ''
  } catch {
    // 题面数据脏到解析器都炸了也不能连累题目页
    return ''
  }
}

// ---------------------------------------------------------------- 边界用例

interface EdgeCandidate {
  value: string
  label: string
}

/** 只剥 Optional / Union[..., None] 这类外壳，别的类型一律不猜。 */
function normalizeType(type: string): string {
  let text = (type ?? '').replace(/\s+/g, '')
  for (let guard = 0; guard < 4; guard += 1) {
    const optional = /^Optional\[(.+)\]$/i.exec(text)
    const unionLeft = /^Union\[None,(.+)\]$/i.exec(text)
    const unionRight = /^Union\[(.+),None\]$/i.exec(text)
    const inner = optional?.[1] ?? unionLeft?.[1] ?? unionRight?.[1]
    if (!inner) break
    text = inner
  }
  return text.toLowerCase()
}

/** 能安全构造的边界值。判断不了类型就返回空数组 —— 瞎猜出来的实参只会让用户困惑。 */
function edgeCandidates(type: string): EdgeCandidate[] {
  switch (normalizeType(type)) {
    case 'int':
      return [
        { value: '0', label: '取 0' },
        { value: '1', label: '取 1' },
        { value: '-1', label: '取 -1' },
      ]
    case 'float':
      return [{ value: '0.0', label: '取 0.0' }]
    case 'str':
      return [
        { value: '""', label: '空字符串' },
        { value: '"a"', label: '单字符' },
      ]
    case 'list[int]':
      return [
        { value: '[]', label: '空数组' },
        { value: '[1]', label: '单元素' },
        { value: '[1, 1]', label: '全部相同' },
      ]
    case 'list[str]':
      return [
        { value: '[]', label: '空数组' },
        { value: '["a"]', label: '单元素' },
      ]
    case 'list[float]':
      return [
        { value: '[]', label: '空数组' },
        { value: '[0.0]', label: '单元素' },
      ]
    case 'list[list[int]]':
      return [
        { value: '[[]]', label: '空内层' },
        { value: '[[1]]', label: '单元素矩阵' },
      ]
    default:
      return []
  }
}

/** 示例实参缺失时，其余参数按类型给个最朴素的默认值（仅用于能确定的类型）。 */
function defaultValue(type: string): string | null {
  switch (normalizeType(type)) {
    case 'int':
      return '0'
    case 'float':
      return '0.0'
    case 'str':
      return '""'
    case 'bool':
      return 'False'
    case 'list[int]':
    case 'list[str]':
    case 'list[float]':
    case 'list[list[int]]':
      return '[]'
    default:
      return null
  }
}

/**
 * 除被替换的那个参数以外，其余参数的实参：优先沿用第一条示例（含关键字写法），
 * 切不出来再按类型兜底；两条路都走不通就放弃生成。
 */
function baseArgValues(problem: Problem, params: SignatureParam[]): string[] | null {
  const examples = Array.isArray(problem?.examples) ? problem.examples : []
  const example = examples.find((item) => typeof item?.callArgs === 'string' && item.callArgs.trim())
  if (example && !parseDesignCall(example.callArgs)) {
    const parts = splitTopLevelArgs(normalizeLiterals(example.callArgs.trim()))
    if (parts.length === params.length && parts.every((part) => isPlausibleArg(part))) {
      const values: string[] = []
      let ok = true
      for (let i = 0; i < parts.length; i += 1) {
        const part = parts[i]
        const eq = part.indexOf('=')
        const name = eq > 0 ? part.slice(0, eq).trim() : ''
        let value = part
        if (name && IDENT.test(name)) {
          // 关键字实参：名字对不上就不敢挪用，避免把 target 的值塞给 nums。
          if (name !== params[i].name) {
            ok = false
            break
          }
          value = part.slice(eq + 1).trim()
        }
        if (!value) {
          ok = false
          break
        }
        values.push(value)
      }
      if (ok) return values
    }
  }
  const typed: string[] = []
  for (const param of params) {
    const value = defaultValue(param.type)
    if (value === null) return null
    typed.push(value)
  }
  return typed
}

/**
 * 建议补充的边界用例：只改第一个参数，其余参数沿用第一条示例的实参，
 * 期望值一律留空（让用户自己想清楚该输出什么）。最多 4 条。
 */
export function suggestEdgeCases(problem: Problem, signature: Signature | null): EdgeCase[] {
  if (!signature) return []
  const method = rawMethod(problem, signature)
  // 设计题 / 没有真实方法名的题没有「一个函数」可调，别硬编。
  if (isClassLikeName(method) || method === 'solve') return []
  const params = Array.isArray(signature.params) ? signature.params : []
  if (!params.length) return []
  const names: string[] = []
  for (const param of params) {
    const name = (param?.name ?? '').trim()
    if (!IDENT.test(name)) return []
    names.push(name)
  }
  const candidates = edgeCandidates(params[0].type)
  if (!candidates.length) return []
  const base = baseArgValues(problem, params)
  if (!base) return []
  // 参数名撞上 Python 关键字时退回位置实参（顺序就是签名顺序，所以仍然安全）。
  const useKeywords = names.every((name) => isSafeKeywordName(name))
  return candidates.slice(0, 4).map((candidate) => {
    const values = params.map((_, i) => (i === 0 ? candidate.value : base[i]))
    const args = useKeywords ? names.map((name, i) => `${name}=${values[i]}`) : values
    return { label: candidate.label, call: `Solution().${method}(${args.join(', ')})`, expected: '' }
  })
}

// ---------------------------------------------------------------- 边界用例合并（渲染层用）

/** 数据生成的边界用例 id 前缀：这批用例每次打开题目都会重建，绝不写进用户存档。 */
const DATA_EDGE_PREFIX = 'edge-data-'

/** 一条用例是不是「数据生成的边界用例」（只活在内存里，不进 progress.saveCases）。 */
export function isDataEdgeCase(item: TestCase): boolean {
  return item.kind === 'edge' && item.id.startsWith(DATA_EDGE_PREFIX)
}

/**
 * 把题面分片里的 `problem.edgeCases` 变成可渲染的用例。
 * id 用下标而不是随机数：同一次会话里反复渲染不能换 id，否则运行结果会挂错行。
 */
export function buildEdgeCases(problem: Problem): TestCase[] {
  const seeds = Array.isArray(problem?.edgeCases) ? problem.edgeCases : []
  const out: TestCase[] = []
  seeds.forEach((seed, index) => {
    const call = typeof seed?.call === 'string' ? seed.call.trim() : ''
    // 没有调用表达式的种子没法执行，直接丢掉，不占位置
    if (!call) return
    const expected = typeof seed?.expected === 'string' ? seed.expected : ''
    out.push({ id: `${DATA_EDGE_PREFIX}${index}`, call, expected, kind: 'edge', extreme: seed.extreme === true })
  })
  return out
}

/**
 * 官方示例在前、边界用例追加在后。
 * 调用表达式（去空白后）已经在 base 里的不重复加：数据侧补的边界用例偶尔会和示例撞车。
 */
export function mergeEdgeCases(base: TestCase[], edges: TestCase[]): TestCase[] {
  if (!edges.length) return base
  const seen = new Set(base.map((item) => (item.call ?? '').trim()))
  const extra = edges.filter((item) => {
    const call = (item.call ?? '').trim()
    if (!call || seen.has(call)) return false
    seen.add(call)
    return true
  })
  return extra.length ? [...base, ...extra] : base
}

/** 该写进用户存档的那部分：数据生成的边界用例要剔掉，否则下次数据更新就串了。 */
export function persistableCases(cases: TestCase[]): TestCase[] {
  return cases.filter((item) => !isDataEdgeCase(item))
}

// ---------------------------------------------------------------- 「还没开始写」识别

/**
 * 去掉整行注释、空行、行尾空白之后的代码骨架。
 * 只用来比较「有没有动过模板」，不参与执行 —— 所以不需要真的解析 Python。
 */
function codeSkeleton(code: string): string {
  return (code ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .filter((line) => line.trim() !== '' && !line.trimStart().startsWith('#'))
    .join('\n')
    .trim()
}

/** 方法体里允许出现的「空实现」：空 / pass / return / return None。 */
const EMPTY_BODY_LINE = /^(?:pass|return|return\s+None)?$/

/** `def name(...) -> type:` 这种单行签名 —— starter.ts 生成的签名都排在一行里。 */
const DEF_LINE = /^\s*def\s+[A-Za-z_]\w*\s*\(.*\)\s*(?:->[^:]*)?:\s*(?:#.*)?$/

/** 行首缩进宽度（tab 按 4 算，和 starter.ts 保持一致）。 */
function leadingSpaces(line: string): number {
  let width = 0
  for (const ch of line) {
    if (ch === ' ') width += 1
    else if (ch === '\t') width += 4
    else break
  }
  return width
}

/**
 * 所有方法体是不是都还空着（只剩 pass / return None / 空行 / 注释）。
 * 一个 `def` 都没匹配到就返回 false —— 那不是「模板」，是别的东西。
 */
function allMethodBodiesEmpty(code: string): boolean {
  const lines = (code ?? '').replace(/\r\n?/g, '\n').split('\n')
  let defs = 0
  let allEmpty = true
  lines.forEach((line, index) => {
    if (!DEF_LINE.test(line)) return
    defs += 1
    const base = leadingSpaces(line)
    let empty = true
    for (let i = index + 1; i < lines.length; i += 1) {
      const body = lines[i]
      if (!body.trim()) continue
      // 缩进退回到 def 那一层：方法体到此结束
      if (leadingSpaces(body) <= base) break
      const text = body.trim()
      if (text.startsWith('#')) continue
      if (!EMPTY_BODY_LINE.test(text)) {
        empty = false
        break
      }
    }
    if (!empty) allEmpty = false
  })
  return defs > 0 && allEmpty
}

/**
 * 编辑器里的代码是不是「一个字都还没写」。两条判据任一命中就算：
 *   ① 去掉整行注释 / 空行 / 行尾空白后，和初始模板完全一致；
 *   ② 所有方法体只剩 pass / return None / 空（用户删掉了 TODO 注释，但还没写实现）。
 *
 * CodeLab 命中后走「第三态」：用例全部 ok = null，不判失败、不出红、不记运行次数 ——
 * 零基础用户第一次点「运行」，看到的不该是满屏红。
 */
export function isUntouchedStarter(code: string, starter: string): boolean {
  try {
    const current = codeSkeleton(code)
    // 编辑器被清空：同样是「还没开始写」，别拿 NameError 吓人
    if (!current) return true
    if (starter && current === codeSkeleton(starter)) return true
    return allMethodBodiesEmpty(code)
  } catch {
    return false
  }
}

// ---------------------------------------------------------------- 判题

/** 判失败的原因，和 CaseResult.reason 对齐。 */
export type CaseFailReason = 'expected' | 'error' | 'type' | 'inplace'

export interface CaseVerdict {
  /** true 通过 / false 失败 / null 只运行不判定 */
  ok: boolean | null
  reason?: CaseFailReason
  /**
   * 软失败：边界用例与参考解不一致，但参考解本身是 AI 写的、期望值也是它推出来的，
   * 而且 12% 的边界输入越界（实测不一致率 3.61%，74% 来自越界输入）。
   * 这种不一致标成琥珀色提示，不计 passes、也不算失败。
   */
  soft?: boolean
  /** 顺序不同但内容等价（白名单题）：算通过，UI 上给一句说明 */
  orderFree?: boolean
}

export interface JudgeInput {
  /** 调用表达式；留空表示用户还没填，这种情况一律不判定 */
  call?: string
  /** 期望输出，空串表示「没设期望」 */
  expected: string
  /** 运行得到的 repr */
  repr: string
  /** 运行时的异常（空串表示没抛） */
  error: string
  /** 题目要求的返回类型（LeetCode 名或 Python 名），拿不到就不做类型检查 */
  returnType?: string | null
  /** 这条用例是官方示例还是构建期生成的边界用例（边界用例的期望不可全信） */
  kind?: 'example' | 'edge'
  /** 输入里含 ±2^31 极端哨兵值：报错也只算软提示（递归题会爆栈） */
  extreme?: boolean
  /** 题号：用于「答案顺序不唯一」的白名单判定 */
  problemNo?: string
  /**
   * 原地修改题（力扣 metaData 里带 output.paramindex，比如 283 移动零、48 旋转图像）：
   * 方法返回 None，真正的答案在被改写的实参里。这类题没法按返回值比对，
   * 直接比对会把写对的代码判错 —— 所以只运行、不判定。
   */
  inPlace?: boolean
}

/** repr 粗粒度分档：只分到「判题需要区分」的粒度，别的一律 other。 */
type ReprKind = 'int' | 'float' | 'bool' | 'str' | 'none' | 'list' | 'dict' | 'other'

const REPR_INT = /^[-+]?\d+$/
const REPR_FLOAT = /^[-+]?(?:\d+\.\d*|\.\d+|\d+(?:\.\d*)?[eE][-+]?\d+)$/

/**
 * Python repr → 粗类型。
 * 只看开头就够了：`_safe_repr` 会在 240 字符处截断，长列表末尾可能没有 `]`。
 */
function reprKind(text: string): ReprKind {
  const raw = (text ?? '').trim()
  if (!raw) return 'other'
  if (raw === 'True' || raw === 'False') return 'bool'
  if (raw === 'None') return 'none'
  const head = raw[0]
  if (head === "'" || head === '"') return 'str'
  if (head === '[') return 'list'
  if (head === '{') return 'dict'
  if (REPR_INT.test(raw)) return 'int'
  if (REPR_FLOAT.test(raw)) return 'float'
  // inf / nan 也是 double 的合法返回值，别判成类型错
  if (/^[-+]?(inf|infinity|nan)$/i.test(raw)) return 'float'
  // 十六进制 / 二进制 / 八进制字面量
  if (/^[-+]?0[xXbBoO][0-9a-fA-F_]+$/.test(raw)) return 'int'
  return 'other'
}

interface TypeRule {
  /** 允许的 repr 类型 */
  kinds: ReprKind[]
  /** 是否要求「列表的元素也是列表」（integer[][] 这种二维） */
  nested: boolean
}

/**
 * LeetCode 类型名 / Python 标注 → 宽松的检查规则。
 * 返回 null 表示「这条不检查」：拿不到类型、void、节点类型（会被 nodes.ts 还原成数组，
 * 原始类型名说明不了 repr 长什么样）都归到这一类。
 */
function returnTypeRule(raw: string): TypeRule | null {
  let text = (raw ?? '').toLowerCase().replace(/\s+/g, '')
  if (!text) return null
  // Optional[X] / Union[X,None] 只剥外壳
  for (let guard = 0; guard < 4; guard += 1) {
    const optional = /^optional\[(.+)\]$/.exec(text)
    const unionLeft = /^union\[none,(.+)\]$/.exec(text)
    const unionRight = /^union\[(.+),none\]$/.exec(text)
    const inner = optional?.[1] ?? unionLeft?.[1] ?? unionRight?.[1]
    if (!inner) break
    text = inner
  }
  text = text.replace(/^typing\./, '')
  // 节点 / 自定义对象：由 prelude 还原成数组，类型名推不出 repr 形态，跳过
  if (/listnode|treenode|\bnode\b|object|any|dict|map/.test(text)) return null
  if (text === 'void' || text === 'none' || text === 'null' || text === 'nil') return null
  if (text === 'bool' || text === 'boolean') return { kinds: ['bool'], nested: false }
  if (text === 'float' || text === 'double') return { kinds: ['float', 'int'], nested: false }
  if (text === 'int' || text === 'integer' || text === 'long') return { kinds: ['int'], nested: false }
  if (text === 'str' || text === 'string' || text === 'character' || text === 'char') {
    return { kinds: ['str'], nested: false }
  }
  // 一维 / 二维数组：`integer[]` `integer[][]` `list<integer>` `list[list<integer>>` `list[int]`
  // 只认 list / array / vector：set 的 repr 是 `{...}`，和 dict 分不开，宁可跳过检查
  if (/^(list|array|vector)[<\[]/.test(text) || text.endsWith('[]')) {
    const nested =
      /\[\]\[\]$/.test(text) ||
      /^(list|array|vector)<(list|array|vector)</.test(text) ||
      /^(list|array|vector)\[(list|array|vector)\[/.test(text)
    return { kinds: ['list'], nested }
  }
  return null
}

/** 顶层逗号切分 `[...]` 的元素；括号不配平（被截断了）返回 null。 */
function listElements(text: string): string[] | null {
  const raw = (text ?? '').trim()
  if (raw[0] !== '[') return null
  const parts: string[] = []
  let cur = ''
  let depth = 0
  let quote = ''
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i]
    if (quote) {
      cur += ch
      if (ch === '\\') {
        const next = raw[i + 1]
        if (next !== undefined) {
          cur += next
          i += 1
        }
      } else if (ch === quote) quote = ''
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      cur += ch
      continue
    }
    if (ch === '[' || ch === '(' || ch === '{') {
      depth += 1
      if (depth > 1) cur += ch
      continue
    }
    if (ch === ']' || ch === ')' || ch === '}') {
      depth -= 1
      if (depth === 0) {
        const tail = cur.trim()
        if (tail) parts.push(tail)
        return parts
      }
      cur += ch
      continue
    }
    if (ch === ',' && depth === 1) {
      const piece = cur.trim()
      if (piece) parts.push(piece)
      cur = ''
      continue
    }
    if (depth >= 1) cur += ch
  }
  return null
}

/** 二维结果：外层是 list，且每个元素也是 list（空数组算合法：二维题返回 [] 很常见）。 */
function listIsNested(text: string): boolean {
  const elements = listElements(text)
  // 截断 / 解析不了：只敢看开头，宽松放过，别把好解法判死
  if (!elements) return /^\[\s*\[/.test((text ?? '').trim())
  if (!elements.length) return true
  return elements.every((element) => element.trim().startsWith('['))
}

/**
 * 返回值和题目要求的类型是否相符（宽松版）。
 * 拿不到类型 → true（跳过检查）；空 repr 且题目有返回类型 → false。
 */
export function matchesReturnType(repr: string, returnType?: string | null): boolean {
  const rule = returnTypeRule(returnType ?? '')
  if (!rule) return true
  const text = (repr ?? '').trim()
  if (!text) return false
  const kind = reprKind(text)
  if (!rule.kinds.includes(kind)) return false
  if (rule.nested && kind === 'list') return listIsNested(text)
  return true
}

/**
 * 单条用例的判题（纯函数，UI 和测试共用）。三条规则：
 * 1. 有期望 → 归一化后比较（normalizeOutput，忽略空白 / 引号 / True-None 写法差异）；
 * 2. 没期望但运行抛了异常 → 失败（以前这里返回 null，等于「没写边界处理也能过」）；
 * 3. 没期望但返回值类型和题目要求不符 → 失败；
 * 4. 没期望、没报错、类型也对 → null（只运行不判定）。
 */
export function judgeCase(input: JudgeInput): CaseVerdict {
  const expected = toText(input.expected).trim()
  const error = toText(input.error).trim()
  // 还没填调用表达式：不算失败，也别拿引擎的「调用为空」当异常去判
  if (input.call !== undefined && !toText(input.call).trim()) return { ok: null }
  // 原地修改题：返回值恒为 None，期望值指的是被改写的实参，没法按返回值判
  if (input.inPlace) return error ? { ok: false, reason: 'error' } : { ok: null, reason: 'inplace' }
  if (expected) {
    let ok = false
    try {
      ok = normalizeOutput(toText(input.repr)) === normalizeOutput(expected)
    } catch {
      ok = toText(input.repr).trim() === expected
    }
    if (ok) return { ok: true }
    // 白名单题（全排列 / 组合 / 子集 / 分组…）：只是顺序不同，算另一种合法答案
    if (
      isOrderFree(input.problemNo) &&
      sameAnswerIgnoringOrder(expected, toText(input.repr), isDeepOrderFree(input.problemNo))
    ) {
      return { ok: true, orderFree: true }
    }
    return { ok: false, reason: 'expected', soft: input.kind === 'edge' }
  }
  if (error) return { ok: false, reason: 'error', soft: input.extreme === true }
  if (!matchesReturnType(input.repr, input.returnType)) return { ok: false, reason: 'type' }
  return { ok: null }
}

/** 失败原因的中文说明（控制台 / 用例行共用，别在两处各写一套）。 */
export function failReasonText(reason: CaseFailReason | undefined, returnType?: string | null): string {
  switch (reason) {
    case 'error':
      return '无期望值也必须不抛异常'
    case 'type':
      return returnType ? `返回类型不符（题目要求 ${returnType}）` : '返回类型不符'
    case 'expected':
      return '输出与期望不符'
    case 'inplace':
      return '原地修改题：答案在被改写的实参里，只运行不判定'
    default:
      return ''
  }
}

// ---------------------------------------------------------------- 输出 diff

function toText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return ''
  try {
    return String(value)
  } catch {
    return ''
  }
}

function clip(text: string): string {
  return text.length > DIFF_LIMIT ? `${text.slice(0, DIFF_LIMIT)}…` : text
}

function tokenize(text: string): string[] {
  if (!text) return []
  return clip(text)
    .split(DIFF_SPLIT)
    .filter((token) => token !== '')
}

function appendPart(parts: DiffPart[], text: string, diff: boolean): void {
  const last = parts[parts.length - 1]
  if (last && last.diff === diff) last.text += text
  else parts.push({ text, diff })
}

/** 只差空白的分隔符算同一个：`[0, 1]` vs `[0,2]` 不该把逗号后的空格也标红。 */
function sameToken(a: string, b: string): boolean {
  if (a === b) return true
  return a.replace(/\s+/g, '') === b.replace(/\s+/g, '')
}

/**
 * 逐 token 比较：分隔符也当 token 保留，这样拼回去还是原文；
 * 纯空白差异不算差异（否则 `[0, 1]` 和 `[0,2]` 会把逗号后面的空格也标红）。
 */
function buildDiffParts(leftText: string, rightText: string): { left: DiffPart[]; right: DiffPart[] } {
  const leftTokens = tokenize(leftText)
  const rightTokens = tokenize(rightText)
  const left: DiffPart[] = []
  const right: DiffPart[] = []
  const total = Math.max(leftTokens.length, rightTokens.length)
  for (let i = 0; i < total; i += 1) {
    const a = leftTokens[i]
    const b = rightTokens[i]
    const same = a !== undefined && b !== undefined && sameToken(a, b)
    if (a !== undefined) appendPart(left, a, !same)
    if (b !== undefined) appendPart(right, b, !same)
  }
  return { left, right }
}

/**
 * 期望 vs 实际的逐段 diff：相等判断复用 utils.normalizeOutput（忽略空白/引号/True-None 写法差异），
 * 不相等时给 UI 标出哪几个 token 不一样。非字符串输入也容错，不抛异常。
 */
export function outputDiff(expected: string, actual: string): OutputDiff {
  const exp = toText(expected)
  const act = toText(actual)
  let equal = false
  try {
    equal = normalizeOutput(exp) === normalizeOutput(act)
  } catch {
    equal = exp === act
  }
  if (equal) {
    return {
      equal: true,
      expectedParts: [{ text: clip(exp), diff: false }],
      actualParts: [{ text: clip(act), diff: false }],
    }
  }
  const { left, right } = buildDiffParts(exp, act)
  return { equal: false, expectedParts: left, actualParts: right }
}
