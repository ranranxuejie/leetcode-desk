export type Level = 'Easy' | 'Medium' | 'Hard'
export type Status = 'todo' | 'learning' | 'done'
export type Rating = 'read' | 'recall' | 'variant'

export interface Example {
  input: string
  output: string
  explain: string
  callArgs: string
  params: string[]
}

export interface TutorialRef {
  docId: string
  docTitle: string
  sectionId: string
  sectionTitle: string
  kind: 'lesson' | 'review'
  level: Level | null
}

export interface ProblemComplexity {
  time: string
  space: string
  loops: string
  why: string
}

export interface Problem {
  no: string
  title: string
  slug: string
  level: Level
  acRate: number | null
  tags: string[]
  paid: boolean
  huaweiFreq: number | null
  inHuaweiList: boolean
  hot100Group: string | null
  inTop150: boolean
  mjSources: number | null
  mjConfidence: string | null
  mjScene: string | null
  mjNote: string | null
  sources: string[]
  tier: string
  category: string
  estMin: number | null
  complexity: ProblemComplexity | null
  statementHtml: string
  examples: Example[]
  method: string
  params: string[]
  tutorial: TutorialRef[]
  leetcodeUrl: string
  /** 精选题：有精讲、构成学习路线（365 道）；其余是全量题库的元数据 */
  curated: boolean
  /** LeetCode 热题 100 */
  hot100: boolean
  /** 有没有题面数据（有的话按 shard 懒加载） */
  hasStatement: boolean
  /** 题面分片号：data/statements/<shard>.json */
  shard: number
  /** 题面分片里带的代码模板（LeetCode 官方 python3 骨架），运行时才有 */
  starterCode?: string
  /** 参数名 + LeetCode 类型（integer / integer[] / string …），用于生成用例 */
  paramTypes?: Array<{ name: string; type: string }>
  returnType?: string
  /** LeetCode 官方提示（题面里的 hints），运行时从题面分片带进来 */
  hints?: string[]
  /** 有没有预生成的深度讲解（Hot 100 才有） */
  hasTeaching?: boolean
  /** 构建期生成的边界用例（运行时从题面分片带进来） */
  edgeCases?: EdgeCaseSeed[]
  /** 原地修改题（答案在被改写的实参里），判题只运行不比对 */
  inPlace?: boolean
  /**
   * 参考解源码（data/ref_solutions/<题号>.json）：跟着题面分片一起懒加载。
   * AI 生成、只保证「通过全部官方示例」，边界情况不保证 —— 展示时必须标清楚。
   */
  refCode?: string
}

/** 题面分片里的一条：打开题目页时按需加载 */
export interface StatementDetail {
  html: string
  examples: Example[]
  method: string
  params: string[]
  starterCode: string
  metaData: {
    name?: string
    params?: Array<{ name: string; type: string }>
    return?: { type: string }
    /** 原地修改题：答案在 paramindex 指定的实参里 */
    output?: { paramindex?: number; size?: string }
  }
  hints: string[]
  sampleTestCase: string
  /** 构建期生成的边界用例；expected 为空表示「只运行不判定」 */
  edgeCases?: EdgeCaseSeed[]
  /** 参考解源码（AI 生成，只通过全部官方示例）；没有参考解的题不带这个字段 */
  refCode?: string
}

/** 构建期生成的边界用例：call 是可直接执行的调用表达式 */
export interface EdgeCaseSeed {
  call: string
  expected: string
  /** 输入里含 ±2^31 这类极端哨兵值：期望不可信，报错也只算软提示 */
  extreme?: boolean
}

export interface TutorialSection {
  id: string
  title: string
  markdown: string
  problemNo: string | null
  level: Level | null
  method: string | null
  kind: 'lesson' | 'review'
  index: number
}

export interface TutorialDoc {
  id: string
  title: string
  group: string
  order: number
  summary: string
  intro: string
  sections: TutorialSection[]
  problemCount: number
}

export interface Meta {
  generatedAt: string
  problemCount: number
  curatedCount?: number
  hot100Count?: number
  statementCount: number
  exampleCount: number
  hintCount?: number
  shardCount?: number
  teachingCount?: number
  teachingChars?: number
  tutorialCount: number
  tutorialSectionCount: number
  tiers: Record<string, number>
  levels: Record<string, number>
  categories?: Record<string, number>
}

export interface TestCase {
  id: string
  call: string
  expected: string
  /**
   * 用例来源：example 官方示例 / edge 边界用例（数据生成或「边界」按钮补的）。
   * 旧存档里没有这个字段，一律当 example 处理。
   */
  kind?: 'example' | 'edge'
  /** 输入含 ±2^31 极端哨兵值：期望不可信，报错也只算软提示 */
  extreme?: boolean
}

export interface ReviewEntry {
  at: number
  result: 'pass' | 'fail'
}

/**
 * 一次「运行」的记录（时间线用）。
 * passed 三态：true 通过 / false 未通过 / null 未判定（只运行了、没有可判定的用例）。
 * 只留最近 30 条，超出丢最旧的。
 */
export interface RunEntry {
  at: number
  passed: boolean | null
  ms: number
}

export interface ProblemState {
  status: Status
  wrong: boolean
  note: string
  code: string
  cases: TestCase[]
  attempts: number
  passes: number
  timeSpentSec: number
  selfRating?: Rating
  lastOpenedAt?: number
  reviews: ReviewEntry[]
  /** 最近的运行记录（最多 30 条，旧的在前）；老存档迁移后从空数组开始，不重算历史 */
  runs: RunEntry[]
  /** 展开「参考答案」的记录：定位是「先想 20 分钟」，所以看答案是个值得记的学习信号 */
  revealed?: { count: number; lastAt: number }
}

export interface DayLog {
  runs: number
  passes: number
  minutes: number
  solved: number
  opened: number
}

/** 动效强度：full 完整 / calm 克制（只留功能性动效）/ off 关闭 */
export type MotionLevel = 'full' | 'calm' | 'off'

export interface Settings {
  dailyGoal: number
  motion: MotionLevel
}

export interface ProgressData {
  /**
   * 1 = 旧存档（字段可能残缺），2 = 已归一化，3 = 带 runs[] 运行记录。
   * load() / importAll() 都按版本迁移，老存档读进来一律补成当前版本。
   */
  version: 1 | 2 | 3
  problems: Record<string, ProblemState>
  daily: Record<string, DayLog>
  plans: Record<string, string[]>
  readDocs: string[]
  settings: Settings
}

export interface CaseResult {
  ok: boolean | null
  /**
   * 判失败的原因：expected 输出不符 / error 没期望值却抛了异常 / type 返回类型不符。
   * ok !== false 时为空。
   */
  reason?: 'expected' | 'error' | 'type' | 'inplace'
  /** 软失败：边界用例与参考解不一致，不计 passes 也不算失败 */
  soft?: boolean
  /** 顺序不同但内容等价（白名单题）：算通过 */
  orderFree?: boolean
  repr: string
  expected: string
  stdout: string
  stderr: string
  error: string
  ms: number
}

export type RunnerStatus = 'idle' | 'loading' | 'ready' | 'running' | 'error'

// ---------------------------------------------------------------- 终端 / 会话

/** 会话命名空间里的一个变量（终端右侧的变量表） */
export interface SessionVar {
  name: string
  type: string
  repr: string
}

/** 单步追踪的一帧：执行到某一行时的局部变量 */
export interface TraceStep {
  line: number
  code: string
  depth: number
  locals: { name: string; repr: string }[]
}

/** 单个用例在 Worker 里的原始结果（判定在主线程做） */
export interface CaseRun {
  id: string
  repr: string
  stdout: string
  stderr: string
  error: string
  ms: number
}

export interface CasesOutcome {
  cases: CaseRun[]
  vars: SessionVar[]
  stdout: string
  stderr: string
}

export interface ExecOutcome {
  repr: string
  stdout: string
  stderr: string
  error: string
  ms: number
  vars: SessionVar[]
  preloadError?: string
}

export interface TraceOutcome {
  steps: TraceStep[]
  repr: string
  stdout: string
  stderr: string
  error: string
  truncated: boolean
}

export type TerminalEntryKind =
  | 'input'
  | 'stdout'
  | 'stderr'
  | 'result'
  | 'error'
  | 'info'
  | 'meta'

export interface TerminalEntry {
  id: string
  kind: TerminalEntryKind
  text: string
  ms?: number
}

// ---------------------------------------------------------------- 初始代码签名

export interface SignatureParam {
  name: string
  type: string
  default?: string
}

export interface Signature {
  method: string
  params: SignatureParam[]
  returns: string
  needsListNode: boolean
  needsTreeNode: boolean
  source: 'tutorial' | 'example' | 'override' | 'fallback'
}
