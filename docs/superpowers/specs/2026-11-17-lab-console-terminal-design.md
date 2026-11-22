# 代码实验室升级 · 终端 / 初始代码 / 解析 设计文档

日期：2026-11-17
状态：实现中（多智能体并行）
位置：`D:\2026\leetcode\app`
契约：`docs/superpowers/specs/2026-11-17-lab-terminal-and-analysis.md`

> 本文记录本轮升级的设计与取舍。协议字段名、文件归属、函数签名以契约为准；本文只解释「为什么这样做」。

## 1. 目标与范围

### 1.1 背景

上一版（2026-11-13）的实验室只能「跑用例」：

- 初始代码按 `problem.method` / `problem.params` 拼出来，没有类型标注，链表 / 树 / 设计题基本不可运行；
- 跑完只看得到最终输出，看不到中间变量，出错只能靠猜；
- 解析散落在「精讲」Tab 里，做题时要来回切；
- 用例失败只显示「实际 vs 期望」两行，看不出差在哪。

### 1.2 本轮交付

1. **终端**：题目内持久的 Python 会话（REPL），可以敲任意命令、查看运行后的变量、重置会话。
2. **初始代码**：每道题给真实签名（方法名 + 形参 + 类型标注）；链表 / 树题附节点定义，设计题附类骨架。
3. **解析**：题目页新增「解析」Tab —— 一句话题意、考点、常见误区、参考答案（可一键载入编辑器）、AI 深度解析、精讲目录。
4. **细节**：题面示例卡片（载入用例 / 复制）、失败用例输出 diff、单步追踪（逐行看局部变量）、快捷键。

### 1.3 不在范围

- `input()` 等交互式 stdin；
- 安装第三方库（不启用 micropip / 不联网装包）；
- 真实 LeetCode 提交、账号与云同步；
- 移动端适配；
- 解析数据的构建期预编译。

## 2. 架构

### 2.1 分层

```
ProblemDetail / CodeLab（React）
  ├─ usePythonRunner（src/lib/runner.ts）   主线程 RPC：请求 id、超时、终止、Promise 表
  └─ Web Worker（public/pyodide-worker.js）
        └─ Pyodide + lc_session.py           会话命名空间、执行、变量快照、单步追踪
```

主线程不直接接触 Pyodide。所有执行都是「发一条消息 → 等 `result`」，按 `id` 匹配 Promise；一个 Worker 同时只处理一条请求，忙时 UI 用 `busy` 状态排队。

### 2.2 界面结构

- **题目工作台** Tab：`题面 / 解析 / 精讲 / 我的笔记`。解析 Tab 左侧栏放速览卡、考点、常见误区、参考答案、走一遍、AI 深度解析、目录。
- **代码实验室** Tab：`用例 / 控制台 / 终端 / AI 判题`。
  - 用例：编辑调用表达式与期望值，逐条显示通过 / 未通过 / 未判定，失败时显示 diff。
  - 控制台：运行输出汇总；单步追踪的 `TracePanel` 也嵌在这里。
  - 终端：持久会话 + 变量表。
- 快捷键：`⌘/Ctrl + Enter` 运行，`` Ctrl+` `` 聚焦终端。

### 2.3 会话与命名空间

- `session` 由调用方按题目分配（通常就是题号），一道题一个长生命周期命名空间；`exec` / `inspect` / `reset` 都作用于它。
- 终端里的探索状态（定义的变量、导入的模块）跨命令保留，直到「重置会话」或超时重建。
- `runCases` 的每条用例在**独立的新命名空间**里执行用户代码，判完即弃，互不影响。
- 变量快照只包含会话顶层的名字，值用 `repr` 字符串回传；大对象截断显示，不还原成对象。

### 2.4 Worker 协议

主线程 → Worker：

| 消息 | 字段 | 作用 |
|---|---|---|
| `runCases` | `id`、`session`、`code`、`cases: { id, call }[]` | 一次性跑完全部用例；判定在主线程做 |
| `exec` | `id`、`session`、`code`、`preload?` | 在会话里执行一段代码（终端命令 / 载入编辑器代码）；`preload` 是可选的前置代码，失败时单独记到 `preloadError` |
| `inspect` | `id`、`session` | 取会话变量快照 |
| `reset` | `id`、`session` | 清空会话命名空间 |
| `trace` | `id`、`session`、`code`、`call` | 单步追踪一次调用 |

Worker → 主线程：

| 消息 | 字段 | 作用 |
|---|---|---|
| `ready` | — | Pyodide 加载完成，可以发请求 |
| `fatal` | `error` | 不可恢复错误，主线程展示并提供重试 |
| `result` | `id`、`ok`、`payload?`、`error?` | 对应请求的结果；`ok: false` 时看 `error` |

`payload` 形状：

| 请求 | `payload` |
|---|---|
| `runCases` | `CasesOutcome`：`{ cases: CaseRun[]; vars: SessionVar[]; stdout: string; stderr: string }` |
| `exec` | `ExecOutcome`：`{ repr: string; stdout: string; stderr: string; error: string; ms: number; vars: SessionVar[]; preloadError?: string }` |
| `inspect` | `{ vars: SessionVar[] }` |
| `reset` | `{}` |
| `trace` | `TraceOutcome`：`{ steps: TraceStep[]; repr: string; stdout: string; stderr: string; error: string; truncated: boolean }` |

超时策略：

| 请求 | 超时 | 超时行为 |
|---|---|---|
| `runCases` | 12s | 终止 Worker，下次请求自动重建，会话状态丢失（UI 提示） |
| `trace` | 12s | 同上 |
| `exec` | 8s | 同上 |

### 2.5 数据形状

新增类型集中在 `src/lib/types.ts`；`Problem` / `CaseResult` / `RunnerStatus` 保持原样，不改字段。

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

判定在主线程完成：Worker 只回 `repr`，主线程用 `normalizeOutput` 与期望值比对，得到 `CaseResult.ok`（`true` / `false` / `null` = 期望留空不判定）。

## 3. 模块划分与文件清单

### 3.1 文件归属

| 归属 | 文件 | 职责 |
|---|---|---|
| lead | `src/lib/types.ts`、`src/lib/utils.ts`、`src/lib/runner.ts`、`public/pyodide-worker.js`、`public/pyodide/lc_session.py`、`src/components/CodeLab.tsx`、`src/styles/lab.css`、`src/main.tsx` | 数据形状、Worker 协议两端、实验室集成、快捷键 |
| starter-gen | `src/lib/starter.ts`（新建） | 签名解析 + 初始代码生成 |
| analysis-lib | `src/lib/analysis.ts`（新建） | 从教程 markdown 抽解析结构 |
| analysis-ui | `src/components/Analysis.tsx`、`src/lib/ai-analysis.ts`、`src/styles/analysis.css`（新建）、`src/pages/ProblemDetail.tsx` | 解析 Tab、AI 深度解析、题面示例卡片、Tab 改造 |
| terminal-ui | `src/components/Terminal.tsx`、`src/styles/terminal.css`（新建） | 终端 UI、变量表、`TracePanel` |
| case-gen | `src/lib/cases.ts`（新建） | 示例调用表达式、边界用例建议、输出 diff |
| docs | `README.md`、本文件 | 文档 |

### 3.2 对外 API

| 模块 | 公开 API |
|---|---|
| `src/lib/runner.ts` | `usePythonRunner()`：`runCases / exec / inspect / resetSession / trace / status / error / reset` |
| `src/lib/starter.ts` | `resolveSignature(problem, markdowns) → Signature`、`buildStarter(problem, markdowns) → string` |
| `src/lib/analysis.ts` | `buildProblemAnalysis(problem, markdowns) → ProblemAnalysisView` |
| `src/lib/ai-analysis.ts` | `useAiAnalysis(problem)`：`text / busy / error / generate / clear` |
| `src/lib/cases.ts` | `exampleCall`、`suggestEdgeCases`、`outputDiff` |
| `src/components/Terminal.tsx` | `Terminal`（ref：`focus / scrollToEnd`）、`TracePanel` |
| `src/components/CodeLab.tsx` | `CodeLabHandle`：`loadCase(call, expected)`、`loadCode(code)` |

## 4. 关键设计决策

### 4.1 为什么用例每次用新命名空间

- 用例共享 globals 会互相污染：上一条用例改了 `nums`、给 `Solution` 挂了缓存、或在模块顶层留了副作用，下一条的结果就不可信，典型症状是「单独跑通过、一起跑失败」。
- 每条用例在全新的 `dict` 里执行用户代码，判定结果可重复、与执行顺序无关，将来也能并行。
- 终端是另一个长生命周期命名空间，用来积累探索状态；它和「判题」分开，改终端变量不会影响用例结果，反之亦然。

### 4.2 为什么超时要重建 Worker

- Pyodide 的 Python 在 Worker 里同步执行，主线程没法暂停或打断一段正在跑的代码；`terminate()` 是唯一能确定停下来的手段。
- 超时通常意味着死循环或状态已被写坏，继续复用这个解释器不可靠；重建比「清理」更干净。
- 代价是重新加载运行时（约数秒），所以 UI 要明确提示「会话已重置」；这个代价只在出错路径上付。

### 4.3 为什么解析从教程 markdown 运行时抽取，而不是预编译 JSON

- 教程 markdown 是唯一事实来源。改教程后页面直接生效，不用重跑 `tools/build_web_data.py`，也不会出现「JSON 有、教程改了」的漂移。
- 抽取规则的容错要求高：标题有 `### 考什么`、`### 常见误区（★ 最容易丢分的地方）`、`#### ③ 拿 xxx 走一遍` 等多种写法，放在纯函数里好改、好测。
- 单题 markdown 只有几 KB，渲染时抽一次（配 `useMemo`）足够快，不需要构建期缓存。
- 失败降级简单：抽不到就 `null` / 空数组，解析 Tab 仍能显示其余内容，一道题的格式问题不会阻塞页面。
- 代价：每次渲染多一次字符串扫描；规则依赖教程格式，格式大改时要同步改规则。

### 4.4 为什么初始代码运行时生成

- 签名来源分三层：教程 `class Solution` 代码块 → 内置 `OVERRIDES` → `problem.method / params` → `solve(*args)` 兜底。运行时按优先级挑，数据更新后自动跟随。
- 链表 / 树题要注入 `ListNode` / `TreeNode` 定义，设计题要从章节代码抽类骨架，分支多；做成纯函数（`starter.ts`）可以单独验证，不依赖 React 和 DOM。
- 365 道题的初始代码不写进 `problems.json`：省体积，也避免「数据里的骨架和签名漂移」。
- 「恢复初始模板」和首次进入共用同一个 `buildStarter`，行为一致。

## 5. 风险与限制

- **无 `input()`**：Worker 没有接交互式 stdin，`input()` 会报错；要测输入就把数据直接写成变量或字面量。
- **无第三方库安装**：只能用 Pyodide 自带的标准库，不能 `pip install`。
- **300 步追踪上限**：`TraceOutcome.truncated` 为 true 时 UI 显示「已截断」；深层递归 / 大循环会先被截断。
- **AI 解析依赖 Key**：需要 `app/.env.local` 里的 `DEEPSEEK_API_KEY`，请求经 vite 代理 `/api/deepseek` 转发；没有 Key 时给可读错误，只影响 AI 解析和 AI 判题。
- **变量快照是 `repr` 字符串**：不还原对象，长列表 / 大对象会被截断。
- **解析质量取决于教程覆盖**：没有配套精讲的题，解析 Tab 只有速览卡和「暂无参考实现」提示。
- **单 Worker 单线程**：跑用例时终端排队（`busy`），不能真正并行；一个超时会中断当前所有请求。
- **超时后会话丢失**：终端变量清空，需要重新载入代码或重新定义。

## 6. 验收清单

- [ ] `.\node_modules\.bin\tsc.cmd -p tsconfig.app.json --noEmit` 0 错误。
- [ ] 终端：敲 `1+1` 出现 `→ 2`；`nums = [1, 2, 3]` 后「查看变量」能看到 `nums`；「重置会话」后变量消失。
- [ ] 终端：`↑/↓` 翻历史，`Ctrl+C` 清空当前输入，`Shift+Enter` 多行命令，输出按类型着色。
- [ ] 初始代码：19 道抽不到签名的题（LRU、最小栈、Trie、LFU 等）都有可运行的类骨架；链表 / 树题带节点定义；「恢复初始模板」与首次进入一致。
- [ ] 解析：有精讲的题显示一句话题意、考点、常见误区、参考答案；「载入编辑器」把参考实现写进编辑器；无精讲的题不报错。
- [ ] 解析：AI 深度解析能生成并缓存（`lc.aianalysis.v1`，按题号索引），无 Key 时给可读错误。
- [ ] 用例：题面示例卡片可「载入用例」；一次运行跑完全部用例；失败用例显示期望 / 实际 diff。
- [ ] 单步追踪：能逐行看到局部变量；超过 300 步显示截断。
- [ ] 快捷键：`⌘/Ctrl + Enter` 运行，`` Ctrl+` `` 聚焦终端。
- [ ] 既有功能不回归：学习计时、状态、错题、上一题 / 下一题、笔记自评。

## 7. 实现补记（收尾阶段追加，与上面契约的差异以此为准）

### 7.1 链表 / 树题：输入自动构造 + 输出自动还原

新增 `src/lib/nodes.ts`（纯函数），解决「链表题、树题在代码台里根本测不了」这个老问题：

- `nodeKinds(problem, signature)` 判定题型（看形参/返回类型里的 `ListNode`/`TreeNode`，标签只作兜底）。
- `wrapNodeCall(problem, signature, call)` 在**运行时**改写调用表达式：节点实参包 `_build_list([...])` / `_build_tree([...])`，返回值是节点时再包 `_dump_list(...)` / `_dump_tree(...)`，这样 `repr` 是数组，能直接和题面期望按字面比对。
- `nodePrelude(kinds)` 生成 Python 前导（节点类 + 四个辅助函数），由主线程随每次请求传给 Worker，`lc_session.py` 在新建命名空间时先 `exec` 它。**不是拼在用户代码前面**，所以用户代码首行是 `from __future__ import annotations` 也不会 SyntaxError。
- 辅助函数名以下划线开头，`_vars_of` 会过滤掉它们，变量表不吵；`_dump_list` 对成环链表有 10000 步上限，不会卡死。
- 原地修改类题目（99 / 114 / 143）返回 `None`，仍靠终端检查改后的结构。

### 7.2 预填用例：`cases.caseCall` 统一生成

`buildDefaultCases` 裸拼 `Solution().method(callArgs)` 的时代结束了：365 题里曾有 65 题（83 条）点运行必挂（关键字实参名和形参不一致、设计题没有 `Solution`、实参缺逗号导致语法错误）。

- `caseCall(problem, example, signature)`：按真实形参名对齐（名字对上用关键字、个数对上按位置），非法实参整组丢弃，设计题生成 `LRUCache(2)` 这类构造调用，实在拼不出来返回 `''`。
- 返回 `''` 时 UI 把「载入用例 / 复制」置灰，用例行留空让用户手填——比塞一条必然 TypeError 的调用诚实。
- 设计题只给一条构造调用且**不设期望值**（`ok = null` 显示「未判定」），避免误判 FAIL；真正的验证在终端里一步步敲。

### 7.3 单步追踪的两处修正

- 最外层函数的 `depth` 记 0（`global_tracer` 先加 1，落库时减 1），`TracePanel` 的「—」分支才走得到。
- `ListNode` / `TreeNode` 的 `__init__` 不计入追踪（按 `co_qualname` 过滤），否则构造 10 个节点就吃掉 20 步，看不到算法本身。
- `_TraceStop` 继承 `BaseException`：用户代码里的 `try/except Exception` 吞不掉停表信号。

### 7.4 终端交互的边界

- Enter / Ctrl+Enter 提交时 `stopPropagation()`，且 CodeLab 的全局快捷键对 `.term` 内的目标直接放行——两处双保险，避免「一条命令既 exec 又 runAll」。
- 运行中按 `Ctrl+C` → `onInterrupt` → 终止 Worker 重建会话（Pyodide 在主线程打断不了），提示会写明「会话会重建」。
- 行尾 `\` 是 Python 原生续行，只去掉整个输入末尾那一个；中间行保留。
- 长会话只保留最近 500 条终端记录，避免 DOM 无限增长。

### 7.5 超时值（以实现为准）

用例 15s、单步追踪 12s、终端命令 10s、首次加载 Python 45s。超时会 `terminate` Worker，并连带 reject 同一代 Worker 上所有在飞请求（只清理「自己这一代」，不会误杀重试后新建的 Worker）。

### 7.6 验证方式（可复跑）

| 脚本 | 覆盖 | 结果 |
|---|---|---|
| `tools/test_lc_session.mjs` | 会话引擎 33 条断言（跑用例 / 终端 / 变量 / 追踪 / 重置 / preload / 语法错误） | 33/33 |
| `tools/test_nodes_flow.mjs` | 链表 / 树 18 条（2、94、206、104、终端里 `_build_list`、成环、非节点题不受影响） | 18/18 |
| `tools/test_starters.mjs` | 365 道初始代码全量 `compile` | 0 语法错误 |
| `tools/test_case_calls.mjs` | 806 条预填用例：语法 + 关键字名（用 Python `ast` 精确取 kwargs） | 0 错 / 0 名不匹配 |
| `tools/e2e_lab.mjs` | headless Chrome：终端敲命令、解析 Tab 内容 | 全绿 |
| `tools/e2e_run.mjs` | headless Chrome：载入参考答案 → 运行 → 追踪 → 变量表（dev 与生产构建都跑过） | 10/10 |
