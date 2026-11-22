# 代码实验室升级 · 契约文档（Terminal / 初始代码 / 解析）

日期：2026-11-17
状态：实现中（多智能体并行）
适用：`D:\2026\leetcode\app`

> **这是并行开发的唯一契约。** 所有 agent 必须严格按本文档的函数签名、文件归属、协议字段名工作。
> 不属于你的文件一律不要改（除了你自己新增的文件）。

## 0. 目标

把题目工作台的代码实验室从「跑用例」升级成「能看、能调、能懂」：

1. **终端**：题目内持久的 Python 会话（REPL），可以敲任意命令、查看运行后的变量、重置会话。
2. **初始代码**：每道题给真实签名（方法名 + 形参 + 类型标注），链表/树题附节点定义，设计题附类骨架。
3. **解析**：题目页新增「解析」Tab —— 一句话题意、考点、常见误区、参考答案（可一键载入编辑器）、精讲目录。
4. **细节**：题面示例卡片（载入用例/复制）、失败用例输出 diff、单步追踪（看每一行的局部变量）、快捷键。

## 1. 文件归属（禁止跨界写）

| 归属 | 文件 |
|---|---|
| lead | `app/src/lib/types.ts`、`app/src/lib/utils.ts`、`app/src/lib/runner.ts`、`app/public/pyodide-worker.js`、`app/public/pyodide/lc_session.py`、`app/src/components/CodeLab.tsx`、`app/src/styles/lab.css`、`app/src/main.tsx` |
| starter-gen | `app/src/lib/starter.ts`（新建） |
| analysis-lib | `app/src/lib/analysis.ts`（新建） |
| analysis-ui | `app/src/components/Analysis.tsx`（新建）、`app/src/lib/ai-analysis.ts`（新建）、`app/src/styles/analysis.css`（新建）、`app/src/pages/ProblemDetail.tsx` |
| terminal-ui | `app/src/components/Terminal.tsx`（新建）、`app/src/styles/terminal.css`（新建） |
| case-gen | `app/src/lib/cases.ts`（新建） |
| docs | `app/README.md`、`docs/superpowers/specs/2026-11-17-lab-console-terminal-design.md`（新建） |

只允许「新建自己的文件 + 改自己归属的已有文件」。需要别人的接口改动时，**不要改别人的文件**，在最终报告里写清楚需要什么。

## 2. 通用约束

- 技术栈固定：React 19 + TypeScript（严格）+ 现有 CSS 变量体系。**不要新增 npm 依赖。**
- `tsconfig.app.json` 开了 `noUnusedLocals` / `noUnusedParameters` / `verbatimModuleSyntax`：
  - 类型导入必须写 `import type { X } from '...'`；
  - 不要留未使用的变量/参数。
- 自检命令（在 `app/` 目录下，只跑这一条，**不要跑 `npm run build`**，避免和别的 agent 抢 dist）：
  ```
  .\node_modules\.bin\tsc.cmd -p tsconfig.app.json --noEmit
  ```
  必须 0 错误才算完成（别人文件报错时忽略并在报告里说明）。
- 界面文案用中文；代码注释用中文，解释「为什么」而不是「是什么」。
- 视觉：暖纸底 + 墨黑 + 朱砂，深色代码区。颜色一律用 `app/src/styles/tokens.css` 里的变量：
  `--paper --paper-soft --paper-deep --paper-warm --ink --ink-soft --muted --muted-2 --line --line-strong --cinnabar --cinnabar-deep --cinnabar-soft --gold --jade --indigo --code --code-soft --code-line --font-display --font-body --font-mono --radius --ease`。
  实验室（深色区）内的次级文字用 `#8d877b` / `#b9b2a4`，正文 `#e6dfd2`，和现有 `lab.css` 保持一致。
- 不要引入全局样式冲突：自己的样式一律加自己的前缀（`.term__*`、`.an__*`、`.trace__*` 等），不要改 `.lab__*`、`.case__*` 的既有规则。
- 图标统一用 `lucide-react`（已安装）。
- 不要用 `any`；必须逃逸时用 `unknown` + 收窄。

## 3. 已确定的数据形状（`app/src/lib/types.ts`，lead 负责写，其他 agent 直接 import）

```ts
export interface SessionVar { name: string; type: string; repr: string }

export interface TraceStep {
  line: number                                  // 用户代码里的 1-based 行号
  code: string                                  // 那一行的源码（已 trim）
  depth: number                                 // 调用深度，0 = 最外层
  locals: { name: string; repr: string }[]      // 该行执行前的局部变量
}

export interface CaseRun { id: string; repr: string; stdout: string; stderr: string; error: string; ms: number }

export interface CasesOutcome { cases: CaseRun[]; vars: SessionVar[]; stdout: string; stderr: string }

export interface ExecOutcome {
  repr: string; stdout: string; stderr: string; error: string; ms: number
  vars: SessionVar[]; preloadError?: string
}

export interface TraceOutcome {
  steps: TraceStep[]; repr: string; stdout: string; stderr: string; error: string; truncated: boolean
}

export type TerminalEntryKind = 'input' | 'stdout' | 'stderr' | 'result' | 'error' | 'info' | 'meta'
export interface TerminalEntry { id: string; kind: TerminalEntryKind; text: string; ms?: number }

export interface SignatureParam { name: string; type: string; default?: string }
export interface Signature {
  method: string
  params: SignatureParam[]
  returns: string
  needsListNode: boolean
  needsTreeNode: boolean
  source: 'tutorial' | 'example' | 'override' | 'fallback'
}
```

`Problem` / `CaseResult` / `RunnerStatus` 保持原样，不改字段。

## 4. Worker ↔ 主线程协议（lead 实现两端，其他人只读）

主线程发：

```ts
{ type: 'runCases', id: number, session: string, code: string, cases: { id: string; call: string }[] }
{ type: 'exec',     id: number, session: string, code: string, preload?: string }
{ type: 'inspect',  id: number, session: string }
{ type: 'reset',    id: number, session: string }
{ type: 'trace',    id: number, session: string, code: string, call: string }
```

Worker 回：

```ts
{ type: 'ready' }
{ type: 'fatal', error: string }
{ type: 'result', id: number, ok: boolean, payload?: object, error?: string }
```

`payload` 形状 = 上面第 3 节对应的 `CasesOutcome` / `ExecOutcome` / `{ vars: SessionVar[] }` / `{}` / `TraceOutcome`。

## 5. `app/src/lib/runner.ts`（lead 实现）

```ts
export function usePythonRunner(): {
  runCases: (code: string, cases: { id: string; call: string }[], session: string) => Promise<CasesOutcome>
  exec: (code: string, session: string, preload?: string) => Promise<ExecOutcome>
  inspect: (session: string) => Promise<SessionVar[]>
  resetSession: (session: string) => Promise<void>
  trace: (code: string, call: string, session: string) => Promise<TraceOutcome>
  status: RunnerStatus
  error: string
  reset: () => void          // 终止 worker，下次自动重建
}
```

超时策略：`runCases`/`trace` 12s，`exec` 8s，超时即终止 worker（会话状态丢失，UI 会提示）。

## 6. `app/src/lib/starter.ts`（starter-gen 负责）

```ts
/** 从教程章节 markdown 里抽 class Solution 的完整签名；抽不到就退化到 problem.method/params */
export function resolveSignature(problem: Problem, markdowns: string[]): Signature

/** 生成「初始代码」。必须可直接运行（无语法错误、无 NameError） */
export function buildStarter(problem: Problem, markdowns: string[]): string
```

要求：

1. 优先级：`class Solution` 代码块签名 > 内置 OVERRIDES（见下）> `problem.method` + `problem.params` > `solve(*args)`。
2. 头注释：题号 + 标题 + 一句话（从 markdown 的 `**一句话**：` 抽，抽不到就用 `problem.title`）+ 最优复杂度（`problem.complexity`）。
3. 需要 `ListNode` / `TreeNode` 时，在 `Solution` 之前给出 LeetCode 标准节点定义；参数类型是 `ListNode`/`TreeNode` 或标签/标题含链表、树时判定。
4. 设计题（LRU/LFU/MinStack/Trie/栈队列/随机集/序列化…）没有 `class Solution`：从章节代码块抽 `class XXX:` 与它的 `def` 列表，生成类骨架（`__init__` 保留形参、其余方法 `pass` + `# TODO`）。
5. 结尾附注释掉的自测行，最多 2 条，例如：
   ```python
   # 本地自测（取消注释，或在右侧终端里直接敲）：
   # print(Solution().twoSum([2, 7, 11, 15], 9))
   ```
6. 必须覆盖这 19 道抽不到签名的题（`OVERRIDES` 里硬编码正确骨架）：
   `146 LRU缓存`、`155 最小栈`、`173 BST迭代器`、`208 Trie`、`211 添加与搜索单词`、`225 队列实现栈`、`232 栈实现队列`、`295 数据流中位数`、`297 二叉树序列化`、`361 轰炸敌人`、`380 O(1)随机集`、`460 LFU缓存`、`531 孤独像素 I`、`533 孤独像素 II`、`622 循环队列`、`694 不同岛屿数量`、`895 最大频率栈`、`1102 得分最高的路径`、`面试题 16.02 单词频率`。
7. 纯函数，不依赖 React/DOM；不要 import `useData`。

## 7. `app/src/lib/analysis.ts`（analysis-lib 负责）

```ts
export interface AnalysisBlock { id: string; title: string; markdown: string; level: number }

export interface ProblemAnalysisView {
  oneLiner: string
  referenceCode: string | null       // 参考实现（python 源码，不含 ``` 围栏）
  examPoints: AnalysisBlock | null   // 「考什么」
  pitfalls: AnalysisBlock | null     // 「常见误区」
  idea: AnalysisBlock | null         // 「思路是怎么想出来的」
  walkthrough: AnalysisBlock | null  // 「③ 拿…走一遍」
  interview: AnalysisBlock | null    // 「面试追问 / 变体」
  outline: AnalysisBlock[]           // 所有 ### / #### 小节的标题（用于目录跳转）
  complexity: Problem['complexity']
}

export function buildProblemAnalysis(problem: Problem, markdowns: string[]): ProblemAnalysisView
```

要求：

- 标题匹配要容错：`### 考什么`、`### 常见误区（★ 最容易丢分的地方）`、`### 完整代码（Python）` / `### 代码（Python）`、`#### ③ 拿 xxx 走一遍`、`### 面试追问 / 变体`。
- `referenceCode`：优先「完整代码/代码（Python）」小节里的 python 围栏；否则取最后一段包含 `class Solution` 或 `def ` 的 python 围栏。
- `oneLiner`：`**一句话**：` 后面那行；没有就取第一个非标题段落的前 80 字。
- 全部容错：没抽到就 `null` / 空数组，**绝不抛异常**。
- 纯函数，不依赖 React/DOM。

## 8. `app/src/components/Analysis.tsx`（analysis-ui 负责）

```tsx
export function Analysis({
  problem,
  view,                 // ProblemAnalysisView
  onLoadCode,           // (code: string) => void   一键载入编辑器
  onOpenTutorial,       // () => void               跳到「精讲」Tab
}: { problem: Problem; view: ProblemAnalysisView; onLoadCode: (code: string) => void; onOpenTutorial: () => void })
```

布局（左侧栏，宽 380–560px 内自适应）：

1. **速览卡**：一句话题意、`最优 O(?)`/空间、建议时长、华为频度、通过率、标签。
2. **考点**（`examPoints` markdown）与 **常见误区**（`pitfalls`）并排或上下，用 `Markdown` 组件渲染（`app/src/lib/markdown.tsx`）。
3. **参考答案**：代码块 + 「复制」「载入编辑器」按钮；`referenceCode` 为空时显示「这道题暂无参考实现，先自己写一版」。
4. **走一遍**（`walkthrough`，含表格）。
5. **AI 深度解析**（可选增强，见第 9 节）：按钮触发生成，结果缓存在 localStorage（key `lc.aianalysis.v1.<题号>`），渲染 markdown，可清空。
6. **目录**：`outline` 生成锚点列表，点击 `onOpenTutorial()` 后滚动到对应小节（由 ProblemDetail 负责跳转+滚动）。

同时负责 `ProblemDetail.tsx` 的改造：

- Tab 从 `题面 / 精讲 / 我的笔记` 变成 `题面 / 解析 / 精讲 / 我的笔记`；`解析` 用上面的 `Analysis`。
- **题面 Tab 的示例卡片**：把 `problem.examples` 渲染成卡片，每条含输入/输出/解释 + 「载入用例」按钮（调用 `labRef.current?.loadCase(call, expected)`）+「复制」；解析规则：`call` = `Solution().<method>(<callArgs>)`，`expected` = `example.output`。没有 `callArgs` 时退化用 `problem.params` 顺序拼。这解决「示例已预填到右侧」但无法单独载入的细节。
- `CodeLabHandle` 新增 `loadCode(code: string): void`（lead 在 CodeLab 实现），用于「载入参考答案」。
- 保持所有既有功能（计时、状态、错题、上一题/下一题、笔记自评）不回归。

## 9. `app/src/lib/ai-analysis.ts`（analysis-ui 负责，可选但建议做）

复用 `app/src/lib/ai.ts` 的 `/api/deepseek` 代理与流式实现（可以 import 但**不要改 ai.ts**）。要求：

```ts
export function useAiAnalysis(problem: Problem): {
  text: string; busy: boolean; error: string | null
  generate: () => void; clear: () => void
}
```

- 缓存到 `localStorage['lc.aianalysis.v1']`（`Record<题号, string>`）。
- system prompt 要求：一句话题意、思路、关键步骤、复杂度、3 个边界用例、2 个常见坑；中文，Markdown，600 字内。
- 请求失败（无 Key/断网）时给可读错误，不影响其它功能。

## 10. `app/src/components/Terminal.tsx`（terminal-ui 负责）

```tsx
export interface TerminalHandle { focus: () => void; scrollToEnd: () => void }

export const Terminal: React.ForwardRefExoticComponent<
  {
    entries: TerminalEntry[]
    vars: SessionVar[]
    busy: boolean
    ready: boolean                 // Python 是否就绪
    onSubmit: (code: string) => void
    onInspect: () => void
    onReset: () => void
    onLoadCode: () => void         // 把编辑器里的代码载入会话
    onClear: () => void
  } & React.RefAttributes<TerminalHandle>
>

export function TracePanel({
  trace, onClose,
}: { trace: TraceOutcome; onClose: () => void })
```

终端要求：

- 深色终端外观：`>>> ` 提示符、等宽字体、输入行内联在输出流末尾（像真终端），Enter 提交，`↑/↓` 翻历史，`Ctrl+C` 清空当前输入，`Shift+Enter` 或行尾 `\` 换行（多行命令），自动滚到底。
- 输出按 `kind` 着色：`input` 灰白 + `>>>`，`stdout` 正常色，`stderr`/`error` 朱砂色，`result` 用 `→` 前缀 + 青色，`info`/`meta` 暗色小字。
- 顶部工具条：`查看变量`（onInspect）、`载入代码`（onLoadCode）、`重置会话`（onReset）、`清空`（onClear）；右侧显示会话变量个数。
- 右侧（或折叠面板）变量表：名字 / 类型 / repr，点击变量把 `print(名字)` 追加到输入框（自己内部 state 即可）。
- 空状态给 3 条示例命令（`Solution().twoSum([2,7,11,15], 9)`、`print(nums)`、`vars()`）。
- `TracePanel`：单步追踪表格，列出 `行号 / 代码 / 深度 / 局部变量`，最多 300 行，超了提示「已截断」；变量 repr 过长时截断 + `title` 显示全文；关闭按钮。

## 11. `app/src/lib/cases.ts`（case-gen 负责）

```ts
/** 从题面示例构造调用表达式（示例缺 callArgs 时按形参顺序兜底） */
export function exampleCall(problem: Problem, example: Example, signature: Signature | null): string

/** 建议补充的边界用例（空数组/单元素/重复/负数等），只产出「调用 + 期望留空」 */
export function suggestEdgeCases(problem: Problem, signature: Signature | null): { label: string; call: string; expected: string }[]

/** 期望 vs 实际 的逐段 diff，用于失败用例高亮 */
export function outputDiff(expected: string, actual: string): {
  equal: boolean
  expectedParts: { text: string; diff: boolean }[]
  actualParts: { text: string; diff: boolean }[]
}
```

- 纯函数，容错，不要抛异常。
- `outputDiff` 的相等判断复用 `normalizeOutput`（`app/src/lib/utils.ts`），但**不要改 utils.ts**。
- 边界用例生成要克制：最多 4 条，且只在能安全构造时产出（例如 `List[int]` 参数给 `[]`、`[1]`；`int` 参数给 `0`、`1`；`str` 给 `""`、`"a"`；多个参数时只变第一个参数）。产出必须语法合法。

## 12. 集成点（lead 负责，其他人不用管）

`CodeLab.tsx` 会：

- 用 `buildStarter` 生成初始代码（「恢复初始模板」也用它）。
- Tab 变成 `用例 / 控制台 / 终端 / AI 判题`，终端里嵌 `Terminal`，控制台里嵌 `TracePanel`。
- `runCases` 一次性跑完全部用例；失败用例显示 `outputDiff`。
- 新增 `loadCode(code)` 到 `CodeLabHandle`。
- `Ctrl+\`` 聚焦终端，`Ctrl+Enter` 运行。

## 13. 验收

- `tsc -p tsconfig.app.json --noEmit` 0 错误。
- 每个 agent 在报告里写：改了哪些文件、新增的公开 API、自己验证了什么、有哪些已知限制。
