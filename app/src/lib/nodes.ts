import type { Problem, Signature } from './types'

/**
 * 链表 / 树题目的「输入构造 + 输出还原」。
 *
 * 为什么需要这一层：题库里的示例输入是 LeetCode 的 JSON 数组（`[2,4,3]`、
 * `[3,9,20,null,null,15,7]`），而签名要的是 `ListNode` / `TreeNode`。
 * 直接把数组塞进 `Solution().addTwoNumbers([2,4,3], [5,6,4])` 必然
 * `AttributeError: 'list' object has no attribute 'next'`；返回的节点也没法
 * 跟期望的 `[7,0,8]` 比。所以这里做两件事：
 *
 * 1. `wrapNodeCall` 把调用改写成 `_dump_list(Solution().f(_build_list([2,4,3]), ...))`；
 * 2. `nodePrelude` 生成 `ListNode` / `TreeNode` 和 `_build_*` / `_dump_*` 的 Python 前导代码。
 *
 * 全部是纯函数：不依赖 React / DOM，不读数据文件，绝不抛异常。
 * 唯一硬约束：**输出必须是语法合法的 Python** —— 拿不准就原样返回，宁可少改造也不能写出
 * 语法错误（那会让整个用例连编译都过不去，用户看到的是一屏看不懂的 SyntaxError）。
 */

/** 这道题要不要构造链表 / 树。两者可以同时为 true（比如「二叉树展开为链表」）。 */
export interface NodeKinds {
  list: boolean
  tree: boolean
  /** N 叉树（559/589/590/429）：`paramTypes` 里写的是 integer，只能按题号钉 */
  nary?: boolean
  /** 四叉树（427/558）：返回 Node，`paramTypes` 也不可信 */
  quad?: boolean
}

/**
 * 特殊节点类型只能按题号钉死：题库数据里这几题的 `paramTypes` 是 `integer` / `integer[][]`，
 * 按类型名推不出来（559 的 root 是 N 叉树，558 的 quadTree1 是四叉树，427 的 grid 是真网格）。
 * 名单与 `tools/gen_ref_solutions.py` 的 `NODE_TYPE_OVERRIDES`、`tools/gen_edge_cases.py` 的
 * `PARAM_TYPE_OVERRIDES` 必须保持一致。
 */
const NARY_NOS = new Set(['559', '589', '590', '429'])
// 四叉树（427/558）暂不启用：官方示例对「非叶子节点的 val」允许 True / False 两种写法，
// 前端只做字符串比对，没法两边同时规范化（会把自己写对的解判红）。
// 前导和 _build_quad / _dump_quad 已经写好，等比对支持「结构规范化」再打开。
const QUAD_NOS = new Set<string>([])
const QUAD_PARAMS = new Set(['quadTree1', 'quadTree2'])

// ---------------------------------------------------------------- 文本小工具

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/

/** 括号配对表：读平衡括号时用。 */
const CLOSER: Record<string, string> = { '(': ')', '[': ']', '{': '}' }

/** 把连续空白压成一个空格（只用于类型标注这种不该有换行的地方）。 */
function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** 顶层按逗号切分：括号 / 引号里的逗号不算。 */
function splitTopLevel(text: string): string[] {
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
    if (ch === '(' || ch === '[' || ch === '{') depth += 1
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1
    if (ch === ',' && depth <= 0) {
      parts.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  parts.push(cur)
  return parts
}

/** 从 `text[start]`（必须是开括号）读到配对的收括号；不配对返回 null。 */
function readBalanced(text: string, start: number): { inner: string; end: number; open: string } | null {
  const open = text[start]
  if (!open || !(open in CLOSER)) return null
  const stack: string[] = []
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
    if (ch in CLOSER) {
      stack.push(CLOSER[ch])
      continue
    }
    if (ch === ')' || ch === ']' || ch === '}') {
      if (stack.pop() !== ch) return null
      if (!stack.length) return { inner: text.slice(start + 1, i), end: i + 1, open }
    }
  }
  return null
}

/** 顶层第一个 `ch` 的下标（忽略括号 / 引号里的）；找不到返回 -1。 */
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
    if (cur === '(' || cur === '[' || cur === '{') depth += 1
    else if (cur === ')' || cur === ']' || cur === '}') depth -= 1
    else if (cur === ch && depth <= 0) return i
  }
  return -1
}

// ---------------------------------------------------------------- 标签 / 类型判定

/**
 * 名字里有「树」但结构上不是 TreeNode 的东西：字典树、线段树、树状数组、四叉树…
 * 给它们塞 TreeNode 只会误导用户，所以先排掉。
 */
const TREE_FALSE_FRIENDS = [
  '字典树',
  '前缀树',
  '线段树',
  '树状数组',
  '四叉树',
  '多叉树',
  'trie',
  'segment tree',
  'binary indexed tree',
]

function isTreeWord(text: string): boolean {
  const raw = text.trim()
  if (!raw) return false
  const lower = raw.toLowerCase()
  if (TREE_FALSE_FRIENDS.some((word) => lower.includes(word))) return false
  return raw.includes('二叉树') || raw.includes('二叉搜索树') || raw.includes('树') || lower.includes('tree')
}

function isListWord(text: string): boolean {
  const raw = text.trim()
  if (!raw) return false
  const lower = raw.toLowerCase()
  return raw.includes('链表') || lower.includes('linked list') || lower.includes('linkedlist')
}

function hasType(text: string, name: string): boolean {
  return new RegExp(`\\b${name}\\b`).test(text)
}

/** 这道题要不要构造链表 / 树：签名里的类型是硬证据，标签 / 标题是软证据。 */
export function nodeKinds(problem: Problem, signature: Signature | null): NodeKinds {
  let list = false
  let tree = false

  if (signature) {
    if (signature.needsListNode) list = true
    if (signature.needsTreeNode) tree = true
    const types = [signature.returns ?? '', ...(signature.params ?? []).map((param) => param.type ?? '')]
    if (types.some((type) => hasType(type, 'ListNode'))) list = true
    if (types.some((type) => hasType(type, 'TreeNode'))) tree = true
  }

  const tags = Array.isArray(problem?.tags) ? problem.tags : []
  const words = [...tags, problem?.title ?? '']
  for (const word of words) {
    if (typeof word !== 'string') continue
    if (isListWord(word)) list = true
    if (isTreeWord(word)) tree = true
  }
  const no = String(problem?.no ?? '').trim()
  return { list, tree, nary: NARY_NOS.has(no), quad: QUAD_NOS.has(no) }
}

/** 一个类型标注里节点出现在哪一层。 */
type NodeShape = 'list' | 'tree' | 'list-of-list' | 'list-of-tree'

const SEQUENCE_PREFIX = /^(?:List|list|Sequence|Iterable)\s*\[/

function nodeShapeOfType(type: string): NodeShape | null {
  let text = collapse(type)
  if (!text) return null
  // Optional[...] 只表示「可能为 None」，剥掉不影响判断
  const optional = /^Optional\s*\[([\s\S]*)\]$/.exec(text)
  if (optional) text = collapse(optional[1])
  const listNode = hasType(text, 'ListNode')
  const treeNode = hasType(text, 'TreeNode')
  if (!listNode && !treeNode) return null
  const base: NodeShape = listNode ? 'list' : 'tree'
  // List[ListNode] / List[Optional[ListNode]]：外层是数组，每个元素才是节点
  if (SEQUENCE_PREFIX.test(text)) return base === 'list' ? 'list-of-list' : 'list-of-tree'
  return base
}

// ---------------------------------------------------------------- JSON 数组字面量

/** 归一化后的数组字面量：`literal` 可直接放进 Python，`tokens` 是每个元素的字面量。 */
interface ArrayValue {
  literal: string
  tokens: string[]
}

const NUMBER_LITERAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/
const STRING_LITERAL = /^(?:'(?:[^'\\]|\\[\s\S])*'|"(?:[^"\\]|\\[\s\S])*")$/

/** 单个元素 → Python 字面量；认不出（表达式、嵌套数组…）返回 null。 */
function normalizeToken(raw: string): string | null {
  const text = raw.trim()
  if (!text) return null
  const lower = text.toLowerCase()
  if (lower === 'null' || text === 'None') return 'None'
  if (lower === 'true' || text === 'True') return 'True'
  if (lower === 'false' || text === 'False') return 'False'
  if (NUMBER_LITERAL.test(text)) return text
  if (STRING_LITERAL.test(text)) return text
  return null
}

/** 严格解析一维 JSON 数组：任何元素不是字面量（嵌套数组 / 表达式 / 变量名）都算失败。 */
function normalizeArray(raw: string): ArrayValue | null {
  const text = raw.trim()
  if (!text.startsWith('[')) return null
  const balanced = readBalanced(text, 0)
  if (!balanced || balanced.open !== '[') return null
  if (text.slice(balanced.end).trim() !== '') return null
  const inner = balanced.inner.trim()
  if (!inner) return { literal: '[]', tokens: [] }
  const tokens: string[] = []
  for (const piece of splitTopLevel(inner)) {
    const token = normalizeToken(piece)
    if (token === null) return null
    tokens.push(token)
  }
  return { literal: `[${tokens.join(', ')}]`, tokens }
}

/** `[2,4,3]` -> `_build_list([2, 4, 3])`；不是数组 / 解析失败返回 null。 */
export function listLiteral(raw: string): string | null {
  const value = normalizeArray(raw)
  if (!value) return null
  // 链表的值不可能是 null，出现 None 说明这多半是树（层序数组），别硬当链表
  if (value.tokens.includes('None')) return null
  return `_build_list(${value.literal})`
}

/** `[3,9,20,null,null,15,7]` -> `_build_tree([3, 9, 20, None, None, 15, 7])`；失败返回 null。 */
export function treeLiteral(raw: string): string | null {
  const value = normalizeArray(raw)
  if (!value) return null
  return `_build_tree(${value.literal})`
}

/** N 叉树层序数组 -> `_build_nary_tree([...])`；解析失败返回 null。 */
export function naryLiteral(raw: string): string | null {
  const value = normalizeArray(raw)
  if (!value) return null
  return `_build_nary_tree(${value.literal})`
}

/** 四叉树层序数组（元素是 `[isLeaf, val]`）-> `_build_quad([...])`；这里只做最外层透传。 */
export function quadLiteral(raw: string): string | null {
  const text = raw.trim()
  if (!text.startsWith('[')) return null
  const balanced = readBalanced(text, 0)
  if (!balanced || balanced.open !== '[') return null
  if (text.slice(balanced.end).trim() !== '') return null
  // 四叉树输入是 [[0,1],[1,0],null,...] 这种嵌套数组，normalizeArray 认不出，原样交给 Python
  return `_build_quad(${text})`
}

/** `[[1,4,5],[1,3,4],[2,6]]` -> `[_build_list([1, 4, 5]), _build_list([1, 3, 4]), _build_list([2, 6])]`。 */
function listOfNodesLiteral(raw: string, kind: 'list' | 'tree'): string | null {
  const text = raw.trim()
  if (!text.startsWith('[')) return null
  const balanced = readBalanced(text, 0)
  if (!balanced || balanced.open !== '[') return null
  if (text.slice(balanced.end).trim() !== '') return null
  const inner = balanced.inner.trim()
  if (!inner) return '[]'
  const items: string[] = []
  for (const piece of splitTopLevel(inner)) {
    const item = piece.trim()
    if (!item) return null
    if (item === 'None' || item.toLowerCase() === 'null') {
      items.push('None')
      continue
    }
    const built = kind === 'list' ? listLiteral(item) : treeLiteral(item)
    if (!built) return null
    items.push(built)
  }
  return `[${items.join(', ')}]`
}

// ---------------------------------------------------------------- 调用改造

/** 顶层 `=` 当关键字实参切分；`==` / `>=` / `:=` 这些不算。 */
function keywordSplit(piece: string): { name: string; value: string } | null {
  const eq = indexOfTopLevel(piece, '=')
  if (eq <= 0) return null
  const before = piece[eq - 1]
  if (before === '=' || before === '!' || before === '<' || before === '>') return null
  if (piece[eq + 1] === '=') return null
  const name = piece.slice(0, eq).trim()
  if (!IDENT.test(name)) return null
  const value = piece.slice(eq + 1).trim()
  if (!value) return null
  return { name, value }
}

function treeReturned(signature: Signature | null): boolean {
  const shape = nodeShapeOfType(signature?.returns ?? '')
  return shape === 'tree' || shape === 'list-of-tree'
}

/** 类型未知时的兜底：只认「一眼就是 JSON 数组」的实参。 */
function fallbackLiteral(value: string, kinds: NodeKinds, signature: Signature | null): string | null {
  const array = normalizeArray(value)
  // 嵌套数组（List[List[int]] / 岛屿网格 / 四叉树输入）一律不动，免得越俎代庖
  if (!array) return null
  const hasNone = array.tokens.includes('None')
  const wantTree = kinds.tree && (!kinds.list || hasNone || treeReturned(signature))
  if (wantTree) return `_build_tree(${array.literal})`
  if (!kinds.list) return null
  if (hasNone) return null
  return `_build_list(${array.literal})`
}

/** 单个实参：按类型包成节点；不需要改造返回 null。 */
function wrapArgument(
  value: string,
  type: string,
  kinds: NodeKinds,
  signature: Signature | null,
): string | null {
  const text = value.trim()
  if (!text) return null
  const shape = nodeShapeOfType(type)
  if (shape === 'list') return listLiteral(text)
  if (shape === 'tree') return treeLiteral(text)
  if (shape === 'list-of-list') return listOfNodesLiteral(text, 'list')
  if (shape === 'list-of-tree') return listOfNodesLiteral(text, 'tree')
  // 类型已知但不是节点（List[int] / int / str / Node…）：绝不能乱包
  if (type.trim()) return null
  return fallbackLiteral(text, kinds, signature)
}

/** 结果要不要包 `_dump_*`：返回类型是节点就包；返回类型未知时按标签兜底。 */
function dumpWrapper(kinds: NodeKinds, signature: Signature | null): string | null {
  // 四叉树题（427/558）的返回类型在题库数据里是错的（写成 list<list<integer>>），只能按题号判
  if (kinds.quad) return '_dump_quad'
  const returns = collapse(signature?.returns ?? '')
  const shape = nodeShapeOfType(returns)
  if (shape === 'list') return '_dump_list'
  if (shape === 'tree') return '_dump_tree'
  // 返回 List[ListNode] 这种我们还原不了，别硬包；已知的非节点返回也不包
  if (shape !== null || returns) return null
  // 返回类型未知：`_dump_*` 对非节点值会原样交回，包错也不会炸
  if (kinds.tree) return '_dump_tree'
  if (kinds.list) return '_dump_list'
  return null
}

/**
 * 把一条调用表达式改造成「节点题能跑」的形式。
 *
 * `Solution().addTwoNumbers([2,4,3], [5,6,4])`
 *   -> `_dump_list(Solution().addTwoNumbers(_build_list([2, 4, 3]), _build_list([5, 6, 4])))`
 *
 * 只认 `Solution().方法名(...)` 这一种形状（`print(...)`、`obj.foo()`、末尾还有 `.bar()`
 * 的一律原样返回）；切分或解析失败也原样返回 —— 语法正确比多改造一条重要得多。
 */
export function wrapNodeCall(problem: Problem, signature: Signature | null, call: string): string {
  const kinds = nodeKinds(problem, signature)
  if (!kinds.list && !kinds.tree && !kinds.nary && !kinds.quad) return call
  const text = typeof call === 'string' ? call.trim() : ''
  if (!text) return call
  const head = /^Solution\s*\(\s*\)\s*\.\s*([A-Za-z_]\w*)\s*\(/.exec(text)
  if (!head) return call
  const balanced = readBalanced(text, head[0].length - 1)
  if (!balanced || balanced.open !== '(') return call
  // 收括号后面还有东西（`Solution().f(x).g()` / 注释）：不碰
  if (text.slice(balanced.end).trim() !== '') return call

  const params = signature?.params ?? []
  const argText = balanced.inner
  const pieces = argText.trim() ? splitTopLevel(argText) : []
  const args: string[] = []
  let changed = false
  for (let i = 0; i < pieces.length; i += 1) {
    const piece = pieces[i].trim()
    // 空片段说明实参列表本身可疑（`f(a,,b)`），保守放弃
    if (!piece) return call
    const keyword = keywordSplit(piece)
    const value = keyword ? keyword.value : piece
    const param = keyword
      ? (params.find((item) => item.name === keyword.name) ?? params[i])
      : params[i]
    // 特殊节点类型：按题号 + 参数名走专用包装（类型名不可信，见 NARY_NOS 注释）
    let wrapped: string | null
    if (kinds.nary && (param?.name === 'root' || params.length === 1)) {
      wrapped = naryLiteral(value)
    } else if (kinds.quad && QUAD_PARAMS.has(param?.name ?? '')) {
      wrapped = quadLiteral(value)
    } else {
      wrapped = wrapArgument(value, param?.type ?? '', kinds, signature)
    }
    if (wrapped === null) {
      args.push(piece)
      continue
    }
    args.push(keyword ? `${keyword.name}=${wrapped}` : wrapped)
    changed = true
  }

  const dumped = dumpWrapper(kinds, signature)
  if (!changed && dumped === null) return call
  const inner = changed ? args.join(', ') : argText.trim()
  const rebuilt = `Solution().${head[1]}(${inner})`
  return dumped ? `${dumped}(${rebuilt})` : rebuilt
}

// ---------------------------------------------------------------- Python 前导

const PRELUDE_HEADER = [
  '# ---------------------------------------------------------------',
  '# 以下是本地自测用的辅助函数，提交时不用带：',
  '# LeetCode 的输入是数组，本地得先搭出链表 / 树；结果也要还原成数组，',
  '# 才能和期望的 [7, 0, 8] 直接比对。',
  '# ---------------------------------------------------------------',
].join('\n')

const LIST_NODE_DEF = [
  'class ListNode:',
  '    """LeetCode 的单链表节点（平台自带，这里只是本地自测用）。"""',
  '',
  '    def __init__(self, val=0, next=None):',
  '        self.val = val',
  '        self.next = next',
  '',
  '    def __repr__(self) -> str:',
  "        return f'ListNode({self.val})'",
].join('\n')

const TREE_NODE_DEF = [
  'class TreeNode:',
  '    """LeetCode 的二叉树节点（平台自带，这里只是本地自测用）。"""',
  '',
  '    def __init__(self, val=0, left=None, right=None):',
  '        self.val = val',
  '        self.left = left',
  '        self.right = right',
  '',
  '    def __repr__(self) -> str:',
  "        return f'TreeNode({self.val})'",
].join('\n')

const BUILD_LIST_DEF = [
  'def _build_list(values):',
  '    """本地自测用：把 [2, 4, 3] 搭成 2 -> 4 -> 3 的链表；空数组给 None。"""',
  '    if not values:',
  '        return None',
  '    head = ListNode(values[0])',
  '    cur = head',
  '    for value in values[1:]:',
  '        cur.next = ListNode(value)',
  '        cur = cur.next',
  '    return head',
].join('\n')

const DUMP_LIST_DEF = [
  'def _dump_list(node):',
  '    """本地自测用：把链表还原成值数组，好和期望的 [7, 0, 8] 比。"""',
  '    if node is None:',
  '        return []',
  '    if not hasattr(node, \'next\'):',
  '        # 返回的不是链表（比如 bool / int），原样交回去，别硬转',
  '        return node',
  '    values = []',
  '    seen = set()',
  '    while node is not None:',
  '        if id(node) in seen:',
  '            values.append(\'...\')  # 有环：停下并提示，不然会转到超时',
  '            return values',
  '        if len(values) >= 10000:',
  '            values.append(\'...\')  # 太长（或有环）：截断，别卡死',
  '            return values',
  '        seen.add(id(node))',
  '        values.append(node.val)',
  '        node = node.next',
  '    return values',
].join('\n')

const BUILD_TREE_DEF = [
  'def _build_tree(values):',
  '    """本地自测用：LeetCode 层序数组 -> 二叉树，None 表示空位；空数组给 None。"""',
  '    if not values or values[0] is None:',
  '        return None',
  '    root = TreeNode(values[0])',
  '    queue = [root]',
  '    index = 1',
  '    while queue and index < len(values):',
  '        node = queue.pop(0)',
  '        if index < len(values):',
  '            value = values[index]',
  '            index += 1',
  '            if value is not None:',
  '                node.left = TreeNode(value)',
  '                queue.append(node.left)',
  '        if index < len(values):',
  '            value = values[index]',
  '            index += 1',
  '            if value is not None:',
  '                node.right = TreeNode(value)',
  '                queue.append(node.right)',
  '    return root',
].join('\n')

const DUMP_TREE_DEF = [
  'def _dump_tree(root):',
  '    """本地自测用：二叉树 -> LeetCode 层序数组（尾部多余的 None 裁掉）。"""',
  '    if root is None:',
  '        return []',
  '    if not (hasattr(root, \'left\') or hasattr(root, \'right\')):',
  '        # 返回的不是树节点（比如 bool / int），原样交回去',
  '        return root',
  '    values = []',
  '    queue = [root]',
  '    while queue:',
  '        if len(values) > 100000:',
  '            values.append(\'...\')  # 防止畸形输入卡死',
  '            break',
  '        node = queue.pop(0)',
  '        if node is None:',
  '            values.append(None)',
  '            continue',
  '        values.append(node.val)',
  '        queue.append(node.left)',
  '        queue.append(node.right)',
  '    while values and values[-1] is None:',
  '        values.pop()',
  '    return values',
].join('\n')

// ---- N 叉树（559 / 589 / 590 / 429）：语义对齐 tools/gen_ref_solutions.py 的 PRELUDE ----

const NARY_NODE_DEF = [
  'class Node:',
  '    """LeetCode 的 N 叉树节点（平台自带，这里只是本地自测用）。"""',
  '',
  '    def __init__(self, val=None, children=None):',
  '        self.val = val',
  '        self.children = children if children is not None else []',
  '',
  '    def __repr__(self) -> str:',
  "        return f'Node({self.val})'",
].join('\n')

const BUILD_NARY_DEF = [
  'def _build_nary_tree(values):',
  '    """本地自测用：LeetCode N 叉树层序数组 -> 树（每个子节点前有一个 None 作分隔）。"""',
  '    if not values or values[0] is None:',
  '        return None',
  '    root = Node(values[0])',
  '    queue = [root]',
  '    index = 1',
  '    while queue and index < len(values):',
  '        node = queue.pop(0)',
  '        if index < len(values) and values[index] is None:',
  '            index += 1  # 这一层的子节点到头了',
  '        while index < len(values) and values[index] is not None:',
  '            child = Node(values[index])',
  '            node.children.append(child)',
  '            queue.append(child)',
  '            index += 1',
  '    return root',
].join('\n')

const DUMP_NARY_DEF = [
  'def _dump_nary_tree(root):',
  '    """本地自测用：N 叉树 -> LeetCode 层序数组（尾部多余的 None 裁掉）。"""',
  '    if root is None:',
  '        return []',
  "    if not hasattr(root, 'children'):",
  '        return root',
  '    values = [root.val]',
  '    queue = [root]',
  '    while queue:',
  '        if len(values) > 100000:',
  "            values.append('...')",
  '            break',
  '        node = queue.pop(0)',
  '        values.append(None)',
  '        for child in node.children or []:',
  '            values.append(child.val)',
  '            queue.append(child)',
  '    while values and values[-1] is None:',
  '        values.pop()',
  '    return values',
].join('\n')

// ---- 四叉树（427 / 558）：非叶子节点的 val 统一按 0 处理（题面允许 True/False，两边要同口径）----

const QUAD_NODE_DEF = [
  'class Node:',
  '    """LeetCode 的四叉树节点（平台自带，这里只是本地自测用）。"""',
  '',
  '    def __init__(self, val=0, isLeaf=False, topLeft=None, topRight=None,',
  '                 bottomLeft=None, bottomRight=None):',
  '        self.val = val',
  '        self.isLeaf = isLeaf',
  '        self.topLeft = topLeft',
  '        self.topRight = topRight',
  '        self.bottomLeft = bottomLeft',
  '        self.bottomRight = bottomRight',
  '',
  '    def __repr__(self) -> str:',
  "        return f'Node({self.val}, {self.isLeaf})'",
].join('\n')

const BUILD_QUAD_DEF = [
  'def _build_quad(values):',
  '    """本地自测用：LeetCode 四叉树层序数组（元素是 [isLeaf, val]）-> 树。"""',
  '    if not values or values[0] is None:',
  '        return None',
  '',
  '    def make(item):',
  '        return Node(1 if item[1] else 0, bool(item[0]))',
  '',
  '    root = make(values[0])',
  '    queue = [root]',
  '    index = 1',
  '    while queue and index < len(values):',
  '        node = queue.pop(0)',
  '        slots = []',
  '        for _ in range(4):',
  '            item = values[index] if index < len(values) else None',
  '            index += 1',
  '            if item is None:',
  '                slots.append(None)',
  '            else:',
  '                child = make(item)',
  '                slots.append(child)',
  '                queue.append(child)',
  '        if not node.isLeaf:',
  '            node.topLeft, node.topRight, node.bottomLeft, node.bottomRight = slots',
  '    return root',
].join('\n')

const DUMP_QUAD_DEF = [
  'def _dump_quad(root):',
  '    """本地自测用：四叉树 -> 层序数组；非叶子节点的 val 一律按 0 输出（题面允许两种写法）。"""',
  '    if root is None:',
  '        return []',
  "    if not hasattr(root, 'isLeaf'):",
  '        return root',
  '    values = []',
  '    queue = [root]',
  '    while queue:',
  '        if len(values) > 100000:',
  "            values.append('...')",
  '            break',
  '        node = queue.pop(0)',
  '        if node is None:',
  '            values.append(None)',
  '            continue',
  '        if not node.isLeaf:',
  '            values.append([0, 0])',
  '        else:',
  '            values.append([1, 1 if node.val else 0])',
  '        queue.append(node.topLeft)',
  '        queue.append(node.topRight)',
  '        queue.append(node.bottomLeft)',
  '        queue.append(node.bottomRight)',
  '    while values and values[-1] is None:',
  '        values.pop()',
  '    return values',
].join('\n')

/**
 * 生成 Python 前导代码：ListNode / TreeNode 定义 + 构造与还原辅助函数（按需裁剪）。
 *
 * 拼装注意：`from __future__ import annotations` 必须是整个文件的第一条语句。
 * 初始代码里可能带这行（starter 遇到不认识的类型标注时会加），这时前导要插在它
 * **之后**；直接 `nodePrelude(...) + code` 拼会 SyntaxError（题库里 117 / 138 /
 * 427 / 690 四道会踩到）。单独作为 `preload` 执行则没有这个问题。
 */
export function nodePrelude(kinds: NodeKinds): string {
  const list = Boolean(kinds?.list)
  const tree = Boolean(kinds?.tree)
  const nary = Boolean(kinds?.nary)
  const quad = Boolean(kinds?.quad)
  if (!list && !tree && !nary && !quad) return ''
  const blocks: string[] = [PRELUDE_HEADER]
  if (list) blocks.push(LIST_NODE_DEF)
  if (tree) blocks.push(TREE_NODE_DEF)
  if (nary) blocks.push(NARY_NODE_DEF, BUILD_NARY_DEF, DUMP_NARY_DEF)
  if (quad) blocks.push(QUAD_NODE_DEF, BUILD_QUAD_DEF, DUMP_QUAD_DEF)
  if (list) blocks.push(BUILD_LIST_DEF, DUMP_LIST_DEF)
  if (tree) blocks.push(BUILD_TREE_DEF, DUMP_TREE_DEF)
  return `${blocks.join('\n\n')}\n`
}
