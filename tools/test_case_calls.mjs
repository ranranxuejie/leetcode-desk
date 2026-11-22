// 预填用例（caseCall + wrapNodeCall）全量验证：语法合法 + 关键字名对得上真实形参。
// 用法：node tools/test_case_calls.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { registerHooks } from 'node:module'

// 浏览器/打包器能解析无扩展名的相对导入，Node 不能；这里补一条解析钩子，
// 让测试可以直接 import 仓库里的 .ts 源文件（不引入任何依赖）。
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('.') && !/\.[a-z]+$/.test(specifier)) {
      try {
        return next(`${specifier}.ts`, context)
      } catch {
        // 落回原样
      }
    }
    return next(specifier, context)
  },
})

const { resolveSignature } = await import('../app/src/lib/starter.ts')
const { tutorialMarkdowns, buildDefaultCases } = await import('../app/src/lib/utils.ts')
const { caseCall } = await import('../app/src/lib/cases.ts')
const { nodeKinds, nodePrelude, wrapNodeCall } = await import('../app/src/lib/nodes.ts')

const problems = JSON.parse(
  readFileSync(new URL('../app/public/data/problems.json', import.meta.url), 'utf8'),
)
const tutorials = JSON.parse(
  readFileSync(new URL('../app/public/data/tutorials.json', import.meta.url), 'utf8'),
)
const byDoc = new Map(tutorials.map((doc) => [doc.id, doc]))

const rows = []
const evalCases = {}
let index = 0
for (const problem of problems) {
  const markdowns = tutorialMarkdowns(problem, byDoc)
  const signature = resolveSignature(problem, markdowns)
  const kinds = nodeKinds(problem, signature)
  const prelude = nodePrelude(kinds)
  const isDesign = /^[A-Z]/.test(signature.method) || signature.method === '__init__'
  const cases = isDesign
    ? [{ id: 'case-1', call: `Solution().${signature.method}()`, expected: '' }]
    : buildDefaultCases(problem).map((item, i) => {
        const example = problem.examples[i]
        const call = example ? caseCall(problem, example, signature) : ''
        return { ...item, call, expected: call ? item.expected : '' }
      })
  for (const item of cases) {
    index += 1
    const wrapped = item.call ? wrapNodeCall(problem, signature, item.call) : ''
    rows.push({
      no: problem.no,
      title: problem.title,
      design: isDesign,
      raw: item.call,
      wrapped,
      empty: !item.call,
      params: signature.params.map((p) => p.name),
      expected: item.expected,
    })
    if (wrapped) evalCases[`c${index}`] = wrapped
  }
}

// Python 侧：语法检查 + 关键字名检查（用同名形参的假函数验证 kwargs 名字是否存在）
const script = `
import json, sys, ast
data = json.load(sys.stdin)
syntax_bad = []
kw_bad = []
for key, item in data['cases'].items():
    try:
        tree = ast.parse(item['code'], '<case>', 'eval')
    except SyntaxError as exc:
        syntax_bad.append({'no': item['no'], 'code': item['code'], 'error': str(exc)})
        continue
    params = set(item['params'])
    # 找到最外层的 Solution().method(...) / ClassName(...) 调用，只看它的关键字实参
    node = tree.body
    call = None
    while node is not None:
        if isinstance(node, ast.Call):
            call = node
            func = node.func
            # 继续往里找真正的目标调用（_dump_list(...) 这种包装要先剥掉）
            if isinstance(func, ast.Attribute):
                break
            if isinstance(func, ast.Name) and func.id.startswith('_dump_'):
                node = node.args[0] if node.args else None
                continue
            break
        if isinstance(node, ast.Attribute):
            node = node.value
            continue
        break
    if call is None:
        continue
    for keyword in call.keywords:
        if keyword.arg is None:
            continue
        if keyword.arg in params:
            continue
        kw_bad.append({'no': item['no'], 'code': item['code'], 'kw': keyword.arg, 'params': sorted(params)})
        break
print(json.dumps({'syntax': syntax_bad, 'kw': kw_bad}, ensure_ascii=False))
`
const payload = JSON.stringify({
  cases: Object.fromEntries(
    Object.entries(evalCases).map(([key, code]) => {
      const row = rows[Number(key.slice(1)) - 1]
      return [key, { code, no: row.no, params: row.params }]
    }),
  ),
})
const check = JSON.parse(
  execFileSync('python', ['-c', script], {
    input: payload,
    encoding: 'utf8',
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 32 * 1024 * 1024,
  }),
)

const summary = {
  totalCases: rows.length,
  emptyCases: rows.filter((r) => r.empty).length,
  emptyProblems: [...new Set(rows.filter((r) => r.empty).map((r) => r.no))],
  designProblems: [...new Set(rows.filter((r) => r.design).map((r) => r.no))],
  syntaxErrors: check.syntax.length,
  keywordMismatch: check.kw.length,
  wrappedCases: rows.filter((r) => r.wrapped !== r.raw).length,
  samples: Object.fromEntries(
    ['1', '2', '206', '94', '155', '146', '1004', '68', '567'].map((no) => [
      no,
      rows.filter((r) => r.no === no).map((r) => ({ raw: r.raw, wrapped: r.wrapped })),
    ]),
  ),
}

writeFileSync(
  fileURLToPath(new URL('../.tmp/case-report.json', import.meta.url)),
  JSON.stringify({ summary, syntax: check.syntax, kw: check.kw, rows }, null, 2),
  'utf8',
)

console.log(JSON.stringify({ ...summary, syntax: check.syntax.slice(0, 10), kw: check.kw.slice(0, 10) }, null, 2))
if (check.syntax.length || check.kw.length) process.exit(1)
