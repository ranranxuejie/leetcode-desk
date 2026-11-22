// 365 道题的「初始代码」全量验证：语法合法 + 覆盖统计 + 关键题人工抽样。
// 用法：node tools/test_starters.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { buildStarter, resolveSignature } from '../app/src/lib/starter.ts'
import { tutorialMarkdowns } from '../app/src/lib/utils.ts'
import { nodeKinds } from '../app/src/lib/nodes.ts'

const problems = JSON.parse(
  readFileSync(new URL('../app/public/data/problems.json', import.meta.url), 'utf8'),
)
const tutorials = JSON.parse(
  readFileSync(new URL('../app/public/data/tutorials.json', import.meta.url), 'utf8'),
)
const byDoc = new Map(tutorials.map((doc) => [doc.id, doc]))

const rows = []
const sources = {}
for (const problem of problems) {
  const markdowns = tutorialMarkdowns(problem, byDoc)
  let starter = ''
  let signature = null
  let error = ''
  try {
    signature = resolveSignature(problem, markdowns)
    starter = buildStarter(problem, markdowns)
  } catch (err) {
    error = String(err?.stack || err)
  }
  const kinds = nodeKinds(problem, signature)
  rows.push({
    no: problem.no,
    title: problem.title,
    method: signature?.method ?? '',
    source: signature?.source ?? 'error',
    params: signature?.params?.length ?? 0,
    needsListNode: kinds.list,
    needsTreeNode: kinds.tree,
    length: starter.length,
    error,
    hasClassSolution: /class Solution\b/.test(starter),
    hasListDef: /class ListNode\b/.test(starter),
    hasTreeDef: /class TreeNode\b/.test(starter),
    hasTodo: /TODO/.test(starter),
    hasPass: /^\s+pass\s*$/m.test(starter),
  })
  sources[problem.no] = starter
}

// 1. 用 Python 编译全部初始代码，确认没有语法错误
const outDir = fileURLToPath(new URL('../.tmp/starters/', import.meta.url))
mkdirSync(outDir, { recursive: true })
const payload = JSON.stringify(sources)
const script = `
import json, sys
data = json.loads(sys.stdin.read())
bad = []
for no, code in data.items():
    try:
        compile(code, '<starter-%s>' % no, 'exec')
    except SyntaxError as exc:
        bad.append({'no': no, 'error': str(exc), 'line': exc.lineno})
print(json.dumps({'total': len(data), 'bad': bad}, ensure_ascii=False))
`
const compileResult = JSON.parse(
  execFileSync('python', ['-c', script], {
    input: payload,
    encoding: 'utf8',
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 32 * 1024 * 1024,
  }),
)

const sourceCount = {}
for (const row of rows) sourceCount[row.source] = (sourceCount[row.source] || 0) + 1
const stats = {
  total: rows.length,
  syntaxErrors: compileResult.bad.length,
  bad: compileResult.bad,
  sourceCount,
  withClassSolution: rows.filter((r) => r.hasClassSolution).length,
  withTodo: rows.filter((r) => r.hasTodo).length,
  listProblems: rows.filter((r) => r.needsListNode).length,
  treeProblems: rows.filter((r) => r.needsTreeNode).length,
  listHasDef: rows.filter((r) => r.needsListNode && r.hasListDef).length,
  treeHasDef: rows.filter((r) => r.needsTreeNode && r.hasTreeDef).length,
  emptyStarter: rows.filter((r) => r.length < 40).map((r) => r.no),
  errors: rows.filter((r) => r.error).map((r) => ({ no: r.no, error: r.error.slice(0, 200) })),
  avgLength: Math.round(rows.reduce((sum, r) => sum + r.length, 0) / rows.length),
  samples: {},
}

for (const no of ['1', '206', '146', '208', '102', '面试题 16.02']) {
  if (sources[no]) stats.samples[no] = sources[no]
}

writeFileSync(
  fileURLToPath(new URL('../.tmp/starter-report.json', import.meta.url)),
  JSON.stringify({ stats, rows }, null, 2),
  'utf8',
)

const { samples, ...brief } = stats
console.log(JSON.stringify(brief, null, 2))
for (const [no, code] of Object.entries(samples)) {
  console.log(`\n===== 题 ${no} =====\n${code}`)
}
if (stats.syntaxErrors || stats.errors.length) process.exit(1)
