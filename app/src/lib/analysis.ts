import type { Problem } from './types'

/** markdown 里切出来的一个小节（标题 + 标题下的正文，含更低级的子标题）。 */
export interface AnalysisBlock {
  id: string
  title: string
  markdown: string
  level: number
}

/** 「解析」Tab 需要的全部信息，全部由教程 markdown 派生，抽不到就给 null / 空串。 */
export interface ProblemAnalysisView {
  oneLiner: string
  referenceCode: string | null
  examPoints: AnalysisBlock | null
  pitfalls: AnalysisBlock | null
  idea: AnalysisBlock | null
  walkthrough: AnalysisBlock | null
  interview: AnalysisBlock | null
  outline: AnalysisBlock[]
  complexity: Problem['complexity']
  /** true = 没有精讲，内容是按标签规则库自动生成的 */
  auto?: boolean
  /** LeetCode 官方提示（题面里给的 hints），有就展示 */
  hints?: string[]
  /** 同专题的相关题，给「下一道练什么」一个入口 */
  related?: Problem[]
}

// ---------------------------------------------------------------- 基础解析

/** 只认 2~4 级标题：再深就不是「小节」了，而是正文里的强调。 */
const HEADING_RE = /^(#{2,4})[ \t]+(.+?)[ \t]*$/
/** 围栏：``` 或 ```python。用行首匹配，正文里出现的反引号不影响。 */
const FENCE_RE = /^[ \t]*```/

/** 标题里常见的括号补充说明（`常见误区（★ 最容易丢分的地方）`）不参与匹配。 */
function normalizeTitle(title: string): string {
  return title
    .replace(/[（(][^（()）]*[）)]/g, '')
    .replace(/\s+/g, '')
    .trim()
}

interface Heading {
  level: number
  title: string
  line: number
}

/** 扫出所有标题行；围栏里的 `# 注释` 不算标题（Python 代码里全是 `#`）。 */
function scanHeadings(lines: string[]): Heading[] {
  const heads: Heading[] = []
  let inFence = false
  for (const [i, line] of lines.entries()) {
    if (FENCE_RE.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const m = HEADING_RE.exec(line)
    if (!m || m[1] === undefined || m[2] === undefined) continue
    const title = m[2].replace(/[ \t]+#+[ \t]*$/, '').trim()
    if (!title) continue
    heads.push({ level: m[1].length, title, line: i })
  }
  return heads
}

/**
 * 把一篇 markdown 按 2~4 级标题切成块。
 * 每个块的内容一直延续到「下一个同级或更高级标题」，所以 `### 精讲` 会包含它下面的 `#### ①…`。
 * id 用 `sec-<序号>`：序号由标题出现顺序决定，同一份输入永远得到同一批 id（可当锚点 / React key）。
 */
export function splitAnalysisBlocks(markdown: string, startIndex = 0): AnalysisBlock[] {
  if (typeof markdown !== 'string' || !markdown) return []
  const lines = markdown.split('\n')
  const heads = scanHeadings(lines)
  const blocks: AnalysisBlock[] = []
  for (let i = 0; i < heads.length; i += 1) {
    const head = heads[i]
    if (!head) continue
    let end = lines.length
    for (let j = i + 1; j < heads.length; j += 1) {
      const next = heads[j]
      if (next && next.level <= head.level) {
        end = next.line
        break
      }
    }
    blocks.push({
      id: `sec-${startIndex + i}`,
      title: head.title,
      markdown: lines.slice(head.line + 1, end).join('\n').trim(),
      level: head.level,
    })
  }
  return blocks
}

interface Fence {
  lang: string
  code: string
}

/** 抽出所有代码围栏（含语言标记）。未闭合的围栏按「到文末」处理，绝不抛错。 */
function extractFences(markdown: string): Fence[] {
  const fences: Fence[] = []
  let open: { lang: string; body: string[] } | null = null
  for (const line of markdown.split('\n')) {
    if (FENCE_RE.test(line)) {
      if (open) {
        fences.push({ lang: open.lang, code: open.body.join('\n') })
        open = null
      } else {
        const info = line.trim().slice(3).trim().toLowerCase()
        open = { lang: info.split(/[ \t{]/)[0] ?? '', body: [] }
      }
      continue
    }
    if (open) open.body.push(line)
  }
  if (open) fences.push({ lang: open.lang, code: open.body.join('\n') })
  return fences
}

const PY_LANGS = new Set(['python', 'py', 'python3'])

/** 这段围栏是不是 Python 代码。没标语言的围栏只在内容明显像 Python 时才算，免得把示意图当代码。 */
function isPythonFence(fence: Fence): boolean {
  if (PY_LANGS.has(fence.lang)) return true
  if (fence.lang === '' || fence.lang === 'text' || fence.lang === 'plaintext') {
    return /^[ \t]*(?:class|def|from|import)[ \t]+[A-Za-z_]/m.test(fence.code)
  }
  return false
}

/** 去掉围栏之外的杂讯：首尾空行、行尾空白。缩进必须保留，Python 靠它吃饭。 */
function tidyCode(code: string): string {
  return code.replace(/^(?:[ \t]*\n)+/, '').replace(/[ \t]+$/gm, '').replace(/\s+$/, '')
}

// ---------------------------------------------------------------- 小节匹配

function isReferenceCodeBlock(block: AnalysisBlock): boolean {
  const t = normalizeTitle(block.title)
  if (/逐行/.test(t)) return false
  return /^(完整代码|代码)/.test(t)
}

function isExamPointsBlock(block: AnalysisBlock): boolean {
  return /^(考什么|考点|考察点|考查点|核心考点)/.test(normalizeTitle(block.title))
}

function isPitfallsBlock(block: AnalysisBlock): boolean {
  return /^(常见误区|易错点|常见错误|常见坑|容易丢分|踩坑)/.test(normalizeTitle(block.title))
}

function isIdeaBlock(block: AnalysisBlock): boolean {
  return /^(思路|解题思路|怎么想到|怎么想出来)/.test(normalizeTitle(block.title))
}

function isPlainTalkBlock(block: AnalysisBlock): boolean {
  const t = normalizeTitle(block.title)
  return /^②/.test(block.title.trim()) || /大白话/.test(t)
}

/** 走一遍：`#### ③ 拿 xxx 走一遍`（变体极多）或 `### 走一遍`。 */
function isWalkthroughBlock(block: AnalysisBlock): boolean {
  const title = block.title.trim()
  if (/^③/.test(title)) return true
  return /走一遍|走两遍|走一次|走一遍看/.test(normalizeTitle(title))
}

function isInterviewBlock(block: AnalysisBlock): boolean {
  return /^面试/.test(normalizeTitle(block.title))
}

function firstBlock(
  blocks: AnalysisBlock[],
  match: (block: AnalysisBlock) => boolean,
): AnalysisBlock | null {
  for (const block of blocks) {
    if (match(block)) return block
  }
  return null
}

// ---------------------------------------------------------------- 各字段抽取

const ONE_LINER_PATTERNS = [
  // 标准写法：`**一句话**：…`（可能带 `>` 引用前缀、全角或半角冒号）
  /^[ \t>]*\*\*[ \t]*一句话[ \t]*\*\*[ \t]*[：:][ \t]*(.+?)[ \t]*$/,
  // 会员专享题的写法：`**题意**：…`
  /^[ \t>]*\*\*[ \t]*题意[ \t]*\*\*[ \t]*[：:][ \t]*(.+?)[ \t]*$/,
  // 少量老写法：没有加粗的 `一句话：…`（排除「一句话总结 / 一句话收尾」这类正文）
  /^[ \t>]*一句话[ \t]*[：:][ \t]*(.+?)[ \t]*$/,
]

/** 正文行（代码围栏之外），供一句话/首段这类「按行找」的抽取用。 */
function proseLines(markdown: string): string[] {
  const out: string[] = []
  let inFence = false
  for (const line of markdown.split('\n')) {
    if (FENCE_RE.test(line)) {
      inFence = !inFence
      continue
    }
    if (!inFence) out.push(line)
  }
  return out
}

/** 第一个「非标题、非引用、非代码、非表格」的段落，压成一行后取前 80 字。 */
function firstParagraph(text: string): string {
  for (const raw of proseLines(text)) {
    const line = raw.trim()
    if (!line) continue
    if (HEADING_RE.test(line)) continue
    if (line.startsWith('>')) continue
    if (line.startsWith('|') || /^[-*_]{3,}$/.test(line)) continue
    const cleaned = line
      .replace(/^[-*+][ \t]+/, '')
      .replace(/\*\*/g, '')
      .replace(/`/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\s+/g, ' ')
      .trim()
    if (!cleaned) continue
    return cleaned.slice(0, 80)
  }
  return ''
}

function extractOneLiner(fullText: string, problem: Problem): string {
  const lines = proseLines(fullText)
  // 按优先级找：标准 `**一句话**` → 会员题的 `**题意**` → 老写法 `一句话：`。同一优先级取最先出现的。
  for (const re of ONE_LINER_PATTERNS) {
    for (const line of lines) {
      const m = re.exec(line)
      if (m && m[1] !== undefined) {
        const value = m[1].trim()
        if (value) return value
      }
    }
  }
  const paragraph = firstParagraph(fullText)
  if (paragraph) return paragraph
  const title = typeof problem.title === 'string' ? problem.title.trim() : ''
  return title
}

/**
 * 参考实现：优先「完整代码（Python）/ 代码（Python）」小节里的第一段 python 围栏；
 * 否则退到全文最后一段带 `class Solution` 的 python 围栏；再否则退到全文最后一段带 `def ` 的围栏。
 * `#### ④ 代码逐行对译` 是表格不是代码，由 isReferenceCodeBlock 挡掉。
 */
function extractReferenceCode(blocks: AnalysisBlock[], fullText: string): string | null {
  for (const block of blocks) {
    if (!isReferenceCodeBlock(block)) continue
    const fence = extractFences(block.markdown).find(isPythonFence)
    if (fence) {
      const code = tidyCode(fence.code)
      if (code) return code
    }
  }
  const pythonFences = extractFences(fullText).filter(isPythonFence)
  const withSolution = pythonFences.filter((fence) => /\bclass[ \t]+Solution\b/.test(fence.code))
  const solutionCode = withSolution.length ? withSolution[withSolution.length - 1] : undefined
  if (solutionCode) {
    const code = tidyCode(solutionCode.code)
    if (code) return code
  }
  const withDef = pythonFences.filter((fence) => /^[ \t]*def[ \t]+/m.test(fence.code))
  const defCode = withDef.length ? withDef[withDef.length - 1] : undefined
  if (defCode) {
    const code = tidyCode(defCode.code)
    if (code) return code
  }
  return null
}

// ---------------------------------------------------------------- 入口

/**
 * 从教程章节 markdown（按 problem.tutorial 顺序）抽「解析」视图。
 * 纯函数、无副作用、不抛异常：任何异常都退化成「只含标题」的安全值。
 */
export function buildProblemAnalysis(
  problem: Problem,
  markdowns: string[],
): ProblemAnalysisView {
  const title = problem && typeof problem.title === 'string' ? problem.title.trim() : ''
  const complexity: Problem['complexity'] =
    problem && problem.complexity ? problem.complexity : null
  const safe: ProblemAnalysisView = {
    oneLiner: title,
    referenceCode: null,
    examPoints: null,
    pitfalls: null,
    idea: null,
    walkthrough: null,
    interview: null,
    outline: [],
    complexity,
  }

  try {
    const docs = (Array.isArray(markdowns) ? markdowns : []).filter(
      (doc): doc is string => typeof doc === 'string' && doc.trim().length > 0,
    )
    if (!docs.length) return safe

    // 多篇（精讲 + 回顾）拼成一份全文：块顺序、id 都按这个顺序稳定生成。
    const fullText = docs.join('\n\n')
    const blocks = splitAnalysisBlocks(fullText)

    const idea = firstBlock(blocks, isIdeaBlock) ?? firstBlock(blocks, isPlainTalkBlock)
    const walkthrough = firstBlock(blocks, isWalkthroughBlock)

    return {
      oneLiner: extractOneLiner(fullText, problem) || title,
      referenceCode: extractReferenceCode(blocks, fullText),
      examPoints: firstBlock(blocks, isExamPointsBlock),
      pitfalls: firstBlock(blocks, isPitfallsBlock),
      idea,
      walkthrough,
      interview: firstBlock(blocks, isInterviewBlock),
      outline: blocks.filter((block) => block.level >= 3),
      complexity,
    }
  } catch {
    return safe
  }
}

// ---------------------------------------------------------------- 自动解析（全量题库）

/**
 * 全量题库里的题没有精讲，但每道题都有标签、难度、通过率，官方还给了 hints。
 * 这里用一套「标签 → 考点 / 坑 / 思路」的规则库拼出一份可读的解析，
 * 让 4500 道题都有讲解入口，而不是一片空白。
 *
 * 注意：这是「有依据的模板」，不是瞎编 —— 每条文案都绑定具体标签，
 * 遇到没有收录的标签就不输出，宁可少说也不胡说。
 */
const TAG_EXAM: Record<string, string> = {
  数组: '下标与遍历：绝大多数题的第一步都是「怎么扫一遍」',
  矩阵: '二维下标的行列关系，注意转置与边界',
  哈希表: '空间换时间：把「回头找」变成「直接点名」',
  字符串: '本质是字符数组，注意空串与编码',
  双指针: '两个下标代替两层循环，关键是「什么时候动哪个」',
  滑动窗口: '一段连续区间，右端扩张、左端只前进',
  前缀和: '区间和 = 两个前缀和相减；配哈希表能查「和为 k 的子数组」',
  差分: '区间加 = 两个端点的差分，最后做一遍前缀和',
  链表: 'dummy 节点统一头结点处理，快慢指针找中点与环',
  栈: '配对、撤销、单调性；括号与表达式都靠它',
  队列: 'BFS 的容器；单调队列用于滑动窗口最值',
  单调栈: '栈内保持有序，「下一个更大」一次结算一批',
  '堆（优先队列）': 'Top-K 的标准解法，关键是堆里存什么',
  二叉树: '递归的主场：先想清楚「函数返回什么」再写',
  二叉搜索树: '中序遍历有序，这是所有性质题的入口',
  树: '递归 + 层序，注意空节点',
  图: '建图（邻接表 / 矩阵）+ 遍历；连通性用并查集',
  深度优先搜索: '递归到底再回溯，注意 visited',
  广度优先搜索: '按层推进，天然求最短路（边权为 1）',
  并查集: '连通性与合并；路径压缩别忘了',
  拓扑排序: '有向无环图的线性序，入度法最好写',
  回溯: '递归 + 撤销选择，剪枝决定复杂度',
  动态规划: '状态定义 + 转移方程 + 遍历顺序，三者缺一不可',
  记忆化搜索: '自顶向下写递归，用缓存砍掉重复子问题',
  贪心: '每步取局部最优，难点是证明它真的最优',
  二分查找: '有序就砍一半；边界（左闭右开）是唯一难点',
  排序: '先排序再处理，很多题排序后性质就出来了',
  位运算: '与或异或、移位；异或能消掉成对的数',
  数学: '找规律、进制、快速幂；注意溢出与除零',
  模拟: '照着题目描述一步步写，先写对再优化',
  设计: '维护数据结构：想清楚每个操作的代价',
  计数: '值域不大就开桶计数，用 O(n) 空间换时间',
  枚举: '数据范围小就直接枚举，别过度设计',
  递归: '把问题缩小成同类子问题，注意终止条件',
  数据库: '这是 SQL 题，本工具的代码台只跑 Python，建议去力扣练',
  Shell: '这是 Shell 题，建议去力扣练',
  并发: '这是并发题，建议去力扣练',
}

const TAG_PITFALL: Record<string, string> = {
  数组: '下标越界（尤其是 `i + 1` 和空数组）',
  双指针: '收缩条件写反，导致死循环或漏解',
  滑动窗口: '窗口收缩的时机：先移左再判断，还是先判断再移',
  哈希表: '重复元素：要不要计数、要不要覆盖旧下标',
  链表: '断链前先存 `next`，否则后面的节点就找不到了',
  二叉树: '递归返回值含义没想清楚，写出来就会互相打架',
  动态规划: '初始化与遍历顺序错，结果对一半',
  二分查找: '`mid` 取整方向与 `left = mid` 会死循环',
  回溯: '撤销选择的位置与时机；忘记恢复现场',
  贪心: '没有验证反例就下结论',
  字符串: '空串、单字符、大小写、Unicode',
  位运算: 'Python 里负数是无限位补码，`>>` 与 `&` 要小心',
  数学: '整数溢出、除零、负数取模',
  '堆（优先队列）': '堆里存索引还是值；惰性删除要校验堆顶是否过期',
  图: '重复访问导致死循环；孤立点',
  模拟: '边界条件（首尾、空输入）没覆盖',
  栈: '弹出前没判空',
  队列: '空队列时继续 pop',
}

const TAG_APPROACH: Record<string, string> = {
  动态规划: '先写暴力递归 → 找重复子问题 → 加缓存 → 改成自底向上',
  回溯: '把「选择」列出来，画出决策树，再决定怎么剪枝',
  二分查找: '先确认「答案空间」是否单调，再决定用哪种二分模板',
  贪心: '先猜一个贪心策略，再用小数据找反例',
  图: '先把输入转成邻接表，再决定 DFS 还是 BFS',
  滑动窗口: '先想清楚「窗口内维护什么」，再写扩张与收缩',
  双指针: '先排序或先确定单调性，再决定指针怎么动',
  链表: '先画三个节点的示意图，再动指针',
  位运算: '先把数写成二进制看规律',
}

const LEVEL_TEXT: Record<string, string> = { Easy: '简单', Medium: '中等', Hard: '困难' }

function bulletBlock(
  id: string,
  title: string,
  items: string[],
): AnalysisBlock | null {
  if (!items.length) return null
  return { id, title, markdown: items.join('\n'), level: 3 }
}

export function buildAutoAnalysis(problem: Problem): ProblemAnalysisView {
  const tags = (problem.tags ?? []).filter(Boolean)
  const level = LEVEL_TEXT[problem.level] ?? '中等'
  const rate = problem.acRate
  const category = problem.category || '其他'

  const examItems = tags
    .filter((tag) => TAG_EXAM[tag])
    .slice(0, 5)
    .map((tag) => `- **${tag}**：${TAG_EXAM[tag]}`)
  const pitfallItems = tags
    .filter((tag) => TAG_PITFALL[tag])
    .slice(0, 5)
    .map((tag) => `- **${tag}**：${TAG_PITFALL[tag]}`)
  const approachItems = tags
    .filter((tag) => TAG_APPROACH[tag])
    .slice(0, 4)
    .map((tag) => `- **${tag}**：${TAG_APPROACH[tag]}`)

  const rateText =
    rate == null
      ? ''
      : rate < 35
        ? '通过率偏低，说明有容易被忽略的边界或证明'
        : rate > 65
          ? '通过率较高，先把最直接的写法写对'
          : '通过率中等，通常卡在细节而不是思路'

  const oneLiner = `${level}${rate == null ? '' : ` · 通过率 ${rate.toFixed(1)}%`} · ${
    tags.slice(0, 3).join(' / ') || category
  }`

  const ideaMarkdown = [
    `这道题归在「${category}」。先按下面的顺序过一遍，再动手：`,
    '',
    '1. **先读懂输入输出**：拿第一个示例，把变量值写在纸上走一遍。',
    '2. **先写能过的暴力解**：想清楚复杂度，再决定优化方向。',
    '3. **再想优化**：常见方向是「用空间换时间」或「用单调性砍掉重复计算」。',
    '',
    ...(approachItems.length ? ['**这个标签下的常用套路：**', '', ...approachItems, ''] : []),
    ...(rateText ? [`> ${rateText}。`] : []),
  ].join('\n')

  return {
    auto: true,
    oneLiner,
    referenceCode: null,
    examPoints: bulletBlock(
      'auto-exam',
      '考什么',
      examItems.length ? examItems : ['- 标签信息不足，先看题面里的输入输出约束'],
    ),
    pitfalls: bulletBlock('auto-pitfall', '常见坑', pitfallItems),
    idea: { id: 'auto-idea', title: '思路怎么走', markdown: ideaMarkdown, level: 3 },
    walkthrough: null,
    interview: {
      id: 'auto-interview',
      title: '面试会怎么追问',
      markdown: [
        '- 能不能做到 O(n)？空间能不能再省一层？',
        '- 输入为空、只有一个元素、全是重复元素时，你的代码还对吗？',
        '- 换一种数据结构，复杂度和代码量各会怎么变？',
      ].join('\n'),
      level: 3,
    },
    outline: [],
    complexity: problem.complexity,
  }
}
