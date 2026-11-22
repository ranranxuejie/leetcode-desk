// 链表 / 树题的端到端验证：nodes.ts 的构造 + lc_session.py 的 prelude 注入 + 运行 + 结果还原。
// 用法：node tools/test_nodes_flow.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { loadPyodide } from '../app/node_modules/pyodide/pyodide.mjs'
import { nodeKinds, nodePrelude, wrapNodeCall } from '../app/src/lib/nodes.ts'
import { resolveSignature } from '../app/src/lib/starter.ts'
import { tutorialMarkdowns } from '../app/src/lib/utils.ts'

const indexURL = fileURLToPath(new URL('../app/public/pyodide/', import.meta.url))
const enginePath = fileURLToPath(new URL('../app/public/pyodide/lc_session.py', import.meta.url))

const problems = JSON.parse(
  readFileSync(new URL('../app/public/data/problems.json', import.meta.url), 'utf8'),
)
const tutorials = JSON.parse(
  readFileSync(new URL('../app/public/data/tutorials.json', import.meta.url), 'utf8'),
)
const byDoc = new Map(tutorials.map((doc) => [doc.id, doc]))
const byNo = new Map(problems.map((item) => [item.no, item]))

const results = []
function check(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  -> ${JSON.stringify(detail)}`}`)
}

const py = await loadPyodide({ indexURL })
py.runPython(readFileSync(enginePath, 'utf8'))

function call(kind, body) {
  py.globals.set('__lc_input__', JSON.stringify({ kind, ...body }))
  const parsed = JSON.parse(String(py.runPython('__lc_dispatch__(__lc_input__)')))
  if (!parsed.ok) throw new Error(parsed.error)
  return parsed
}

function setup(no) {
  const problem = byNo.get(no)
  const markdowns = tutorialMarkdowns(problem, byDoc)
  const signature = resolveSignature(problem, markdowns)
  const kinds = nodeKinds(problem, signature)
  return { problem, signature, kinds, prelude: nodePrelude(kinds) }
}

// ---------------------------------------------------------------- 2. 两数相加（链表）
const p2 = setup('2')
check('2 两数相加判定为链表题', p2.kinds.list === true, p2.kinds)
check('2 的 prelude 含 _build_list', /_build_list/.test(p2.prelude), p2.prelude.slice(0, 80))

const addTwo = `class ListNode:
    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next

class Solution:
    def addTwoNumbers(self, l1, l2):
        dummy = ListNode()
        cur = dummy
        carry = 0
        while l1 or l2 or carry:
            a = l1.val if l1 else 0
            b = l2.val if l2 else 0
            total = a + b + carry
            carry = total // 10
            cur.next = ListNode(total % 10)
            cur = cur.next
            l1 = l1.next if l1 else None
            l2 = l2.next if l2 else None
        return dummy.next
`
const rawCall2 = 'Solution().addTwoNumbers([2,4,3], [5,6,4])'
const wrapped2 = wrapNodeCall(p2.problem, p2.signature, rawCall2)
check('2 的调用被包装', /_dump_list\(/.test(wrapped2) && /_build_list\(/.test(wrapped2), wrapped2)

const run2 = call('runCases', {
  session: 'n2',
  code: addTwo,
  prelude: p2.prelude,
  cases: [{ id: 'c1', call: wrapped2 }],
})
check('2 两数相加跑通 [7,0,8]', run2.cases[0].repr === '[7, 0, 8]', run2.cases[0])

// 用户代码里没有 ListNode 时，prelude 里自带的也能用
const addTwoNoClass = `class Solution:
    def addTwoNumbers(self, l1, l2):
        dummy = ListNode(0)
        cur = dummy
        carry = 0
        while l1 or l2 or carry:
            total = (l1.val if l1 else 0) + (l2.val if l2 else 0) + carry
            carry = total // 10
            cur.next = ListNode(total % 10)
            cur = cur.next
            l1 = l1.next if l1 else None
            l2 = l2.next if l2 else None
        return dummy.next
`
const run2b = call('runCases', {
  session: 'n2b',
  code: addTwoNoClass,
  prelude: p2.prelude,
  cases: [{ id: 'c1', call: wrapped2 }],
})
check('2 不给 ListNode 定义也能跑（prelude 兜底）', run2b.cases[0].repr === '[7, 0, 8]', run2b.cases[0])

// ---------------------------------------------------------------- 94. 二叉树中序遍历
const p94 = setup('94')
check('94 中序遍历判定为树题', p94.kinds.tree === true, p94.kinds)
const inorder = `class Solution:
    def inorderTraversal(self, root):
        out = []
        def dfs(node):
            if not node:
                return
            dfs(node.left)
            out.append(node.val)
            dfs(node.right)
        dfs(root)
        return out
`
const wrapped94 = wrapNodeCall(
  p94.problem,
  p94.signature,
  'Solution().inorderTraversal([1,null,2,3])',
)
check('94 的实参被包装成 _build_tree', /_build_tree\(/.test(wrapped94), wrapped94)
check(
  '94 返回值是数组，不该包 _dump_tree',
  !/_dump_tree\(/.test(wrapped94),
  wrapped94,
)
const run94 = call('runCases', {
  session: 'n94',
  code: inorder,
  prelude: p94.prelude,
  cases: [{ id: 'c1', call: wrapped94 }],
})
check('94 中序遍历 [1,3,2]', run94.cases[0].repr === '[1, 3, 2]', run94.cases[0])

// ---------------------------------------------------------------- 206. 反转链表
const p206 = setup('206')
const wrapped206 = wrapNodeCall(p206.problem, p206.signature, 'Solution().reverseList([1,2,3,4,5])')
const reverse = `class Solution:
    def reverseList(self, head):
        prev = None
        while head:
            head.next, prev, head = prev, head, head.next
        return prev
`
const run206 = call('runCases', {
  session: 'n206',
  code: reverse,
  prelude: p206.prelude,
  cases: [{ id: 'c1', call: wrapped206 }],
})
check('206 反转链表 [5,4,3,2,1]', run206.cases[0].repr === '[5, 4, 3, 2, 1]', run206.cases[0])

// ---------------------------------------------------------------- 104. 最大深度
const p104 = setup('104')
const wrapped104 = wrapNodeCall(p104.problem, p104.signature, 'Solution().maxDepth([3,9,20,null,null,15,7])')
const depth = `class Solution:
    def maxDepth(self, root):
        if not root:
            return 0
        return 1 + max(self.maxDepth(root.left), self.maxDepth(root.right))
`
const run104 = call('runCases', {
  session: 'n104',
  code: depth,
  prelude: p104.prelude,
  cases: [{ id: 'c1', call: wrapped104 }],
})
check('104 最大深度 3', run104.cases[0].repr === '3', run104.cases[0])

// ---------------------------------------------------------------- 终端里手动构造节点
const term = call('exec', {
  session: 'n2',
  code: '_build_list([1, 2, 3])',
  prelude: p2.prelude,
})
check('终端里能直接 _build_list', /ListNode/.test(term.repr), term.repr)
const dumped = call('exec', {
  session: 'n2',
  code: '_dump_list(_build_list([1, 2, 3]))',
  prelude: p2.prelude,
})
check('终端里 _dump_list 还原成数组', dumped.repr === '[1, 2, 3]', dumped.repr)

// ---------------------------------------------------------------- 辅助函数不进变量表
check(
  '变量表不显示 _build_list 这类辅助',
  !term.vars.some((v) => v.name === '_build_list'),
  term.vars.map((v) => v.name),
)

// ---------------------------------------------------------------- 环链表不卡死
const cycle = call('exec', {
  session: 'n2',
  code: 'a = _build_list([1,2,3])\na.next.next.next = a\n_dump_list(a)',
  prelude: p2.prelude,
})
check('环链表 _dump_list 不卡死', cycle.error === '' && cycle.repr.length > 0, cycle)

// ---------------------------------------------------------------- 非节点题不受影响
const p1 = setup('1')
check('1 两数之和不判定为节点题', p1.kinds.list === false && p1.kinds.tree === false, p1.kinds)
check('1 的 prelude 为空', p1.prelude === '', p1.prelude)
const rawCall1 = 'Solution().twoSum([2,7,11,15], 9)'
check('1 的调用不被包装', wrapNodeCall(p1.problem, p1.signature, rawCall1) === rawCall1, wrapNodeCall(p1.problem, p1.signature, rawCall1))

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} 通过`)
if (failed.length) {
  console.log(JSON.stringify(failed, null, 2))
  process.exit(1)
}
