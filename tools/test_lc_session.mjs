// 脱离浏览器验证 lc_session.py：用 Node 里的 Pyodide 直接跑会话引擎。
// 用法：node tools/test_lc_session.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { loadPyodide } from '../app/node_modules/pyodide/pyodide.mjs'

const indexURL = fileURLToPath(new URL('../app/public/pyodide/', import.meta.url))
const enginePath = fileURLToPath(new URL('../app/public/pyodide/lc_session.py', import.meta.url))

const results = []
function check(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  -> ${detail}`}`)
}

const py = await loadPyodide({ indexURL })
py.runPython(readFileSync(enginePath, 'utf8'))

function call(kind, body) {
  py.globals.set('__lc_input__', JSON.stringify({ kind, ...body }))
  const raw = py.runPython('__lc_dispatch__(__lc_input__)')
  const parsed = JSON.parse(String(raw))
  if (!parsed.ok) throw new Error(parsed.error)
  return parsed
}

const CODE = `from typing import List

class Solution:
    def twoSum(self, nums: List[int], target: int) -> List[int]:
        seen = {}
        for i, x in enumerate(nums):
            need = target - x
            if need in seen:
                return [seen[need], i]
            seen[x] = i
        return []
`

// 1. 跑用例
const run = call('runCases', {
  session: 'p1',
  code: CODE,
  cases: [
    { id: 'c1', call: 'Solution().twoSum([2, 7, 11, 15], 9)' },
    { id: 'c2', call: 'Solution().twoSum([3, 2, 4], 6)' },
    { id: 'c3', call: 'Solution().twoSum([3, 3], 6)' },
  ],
})
check('runCases 返回 3 条结果', run.cases.length === 3, JSON.stringify(run.cases))
check('用例 1 输出 [0, 1]', run.cases[0].repr === '[0, 1]', run.cases[0].repr)
check('用例 3 输出 [0, 1]', run.cases[2].repr === '[0, 1]', run.cases[2].repr)
check('跑完有变量表（Solution）', run.vars.some((v) => v.name === 'Solution'), JSON.stringify(run.vars))
check('变量表不含 dunder', run.vars.every((v) => !v.name.startsWith('__')), JSON.stringify(run.vars))

// 2. 终端里继续用同一个会话
const exec1 = call('exec', { session: 'p1', code: 'Solution().twoSum([1, 2, 3, 4], 7)' })
check('终端里能调 Solution', exec1.repr === '[2, 3]', exec1.repr)
check('终端返回变量表', exec1.vars.some((v) => v.name === 'Solution'), JSON.stringify(exec1.vars))

// 3. 定义变量 + 多行 + 表达式回显
const exec2 = call('exec', {
  session: 'p1',
  code: 'a = [1, 2, 3]\nb = [x * 2 for x in a]\nb',
})
check('多行代码 + 末行表达式回显', exec2.repr === '[2, 4, 6]', exec2.repr)
check('新变量进表', exec2.vars.some((v) => v.name === 'b' && v.repr === '[2, 4, 6]'), JSON.stringify(exec2.vars))

// 4. print 捕获
const exec3 = call('exec', { session: 'p1', code: 'print("hello", 1 + 1)\nprint("world")' })
check('stdout 捕获', exec3.stdout === 'hello 2\nworld\n', JSON.stringify(exec3.stdout))
check('print 后无 repr', exec3.repr === '', exec3.repr)

// 5. 报错可读、且不炸引擎
const exec4 = call('exec', { session: 'p1', code: 'nums' })
check('未定义变量报错', exec4.error.includes('NameError'), exec4.error)
check('报错不含引擎栈帧', !exec4.error.includes('lc_session.py'), exec4.error)

const exec5 = call('exec', { session: 'p1', code: 'def f(:\n  pass' })
check('语法错误报错', exec5.error.includes('SyntaxError'), exec5.error)

// 6. 用例报错也带行号
const badRun = call('runCases', {
  session: 'p2',
  code: 'class Solution:\n    def f(self, x):\n        return x / 0\n',
  cases: [{ id: 'c1', call: 'Solution().f(1)' }],
})
check('用例异常带 ZeroDivisionError', badRun.cases[0].error.includes('ZeroDivisionError'), badRun.cases[0].error)
check('用例异常带行号', /line 3/.test(badRun.cases[0].error), badRun.cases[0].error)

// 7. 用例之间不串状态
const isoRun = call('runCases', {
  session: 'p3',
  code: `class Solution:
    total = 0
    def add(self, x):
        Solution.total += x
        return Solution.total
`,
  cases: [
    { id: 'a', call: 'Solution().add(1)' },
    { id: 'b', call: 'Solution().add(1)' },
  ],
})
check(
  '用例之间不共享状态（都是 1）',
  isoRun.cases[0].repr === '1' && isoRun.cases[1].repr === '1',
  `${isoRun.cases[0].repr} / ${isoRun.cases[1].repr}`,
)

// 8. 单步追踪
const traced = call('trace', { session: 'p1', code: CODE, call: 'Solution().twoSum([2, 7, 11, 15], 9)' })
check('追踪有步骤', traced.steps.length >= 4, `steps=${traced.steps.length}`)
check('追踪步有行号和变量', traced.steps.every((s) => s.line > 0 && Array.isArray(s.locals)), JSON.stringify(traced.steps[0]))
check('追踪能看到 seen 变量', traced.steps.some((s) => s.locals.some((v) => v.name === 'seen')), 'no seen')
check('追踪结果正确', traced.repr === '[0, 1]', traced.repr)

// 9. 重置
const reset = call('reset', { session: 'p1' })
check('reset 清空变量', reset.vars.length === 0, JSON.stringify(reset.vars))
const afterReset = call('inspect', { session: 'p1' })
check('重置后 inspect 为空', afterReset.vars.length === 0, JSON.stringify(afterReset.vars))
const afterExec = call('exec', { session: 'p1', code: 'x = 1\nx' })
check('重置后可以重新用', afterExec.repr === '1', afterExec.repr)

// 10. preload：会话没建时先载入编辑器代码
const preloaded = call('exec', { session: 'p9', code: 'Solution().twoSum([3, 3], 6)', preload: CODE })
check('preload 后能直接调 Solution', preloaded.repr === '[0, 1]', preloaded.repr)
check('preload 无错误', !preloaded.preloadError, preloaded.preloadError)

// 11. reload 重建会话
const reloaded = call('exec', { session: 'p9', code: '', preload: 'y = 42', reload: true })
check('reload 后变量是新的', reloaded.vars.some((v) => v.name === 'y' && v.repr === '42'), JSON.stringify(reloaded.vars))
check('reload 后旧的 Solution 没了', !reloaded.vars.some((v) => v.name === 'Solution'), JSON.stringify(reloaded.vars))

// 12. 调用表达式为空
const emptyCall = call('runCases', { session: 'p10', code: CODE, cases: [{ id: 'c', call: '' }] })
check('空调用给出提示', emptyCall.cases[0].error.includes('调用表达式'), emptyCall.cases[0].error)

// 13. 语法错误后，会话不该留一个空命名空间（否则终端下一条命令会 NameError）
const badCode = call('runCases', {
  session: 'p11',
  code: 'class Solution:\n    def f(self):\n        return 1\n  oops\n',
  cases: [{ id: 'c1', call: 'Solution().f()' }],
})
check(
  '语法错误所有用例都报错',
  /(Syntax|Indentation)Error/.test(badCode.cases[0].error),
  badCode.cases[0].error,
)
const afterBad = call('exec', { session: 'p11', code: 'Solution().twoSum([2, 7], 9)', preload: CODE })
check(
  '语法错误后终端能重新载入代码',
  afterBad.repr === '[0, 1]' && !afterBad.error,
  afterBad,
)

// 14. 单步追踪的深度从 0 开始（契约：0 = 最外层）
const traceDepth = call('trace', {
  session: 'p12',
  code: CODE,
  call: 'Solution().twoSum([2, 7, 11, 15], 9)',
})
check(
  '追踪最外层深度是 0',
  traceDepth.steps.length > 0 && traceDepth.steps[0].depth === 0,
  traceDepth.steps.slice(0, 2).map((s) => s.depth),
)

// 15. 用户代码里的 try/except Exception 不会吞掉追踪的停表信号
const traceStop = call('trace', {
  session: 'p13',
  code: `class Solution:
    def f(self):
        try:
            i = 0
            while True:
                i += 1
        except Exception:
            pass
        return i
`,
  call: 'Solution().f()',
})
check('死循环追踪会截断而不是卡死', traceStop.truncated === true, {
  steps: traceStop.steps.length,
  truncated: traceStop.truncated,
})

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} 通过`)
if (failed.length) {
  console.log(JSON.stringify(failed, null, 2))
  process.exit(1)
}
