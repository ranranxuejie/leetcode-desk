import type { Level, Problem } from './types'
import { LEVEL_RANK, noRank } from './utils'

/**
 * 学习路线：19 个专题的先后顺序。
 *
 * 排法不是随便定的，三条原则：
 * 1. 先「会用的容器」：数组 → 哈希 → 链表 → 栈/队列 → 堆 → 树 → 图。
 * 2. 再「常用的技巧」：双指针 → 滑动窗口 → 前缀和 → 单调栈 → 二分。
 *    这些技巧都要挂在上面某个容器上，容器没感觉时学了也记不住。
 * 3. 最后「四大范式」：回溯 → 贪心 → 动态规划。它们最难，也最吃前面的底子。
 *
 * 每个专题内部固定按 简单 → 中等 → 困难 排，同难度按题号。
 */
export interface PathTopic {
  name: string
  stage: '基础' | '技巧' | '范式' | '杂项'
  note: string
}

export const PATH_TOPICS: PathTopic[] = [
  { name: '数组/矩阵', stage: '基础', note: '下标、遍历、二维网格，所有技巧的地基' },
  { name: '哈希表', stage: '基础', note: '用空间换时间：把"回头找"变成"直接点名"' },
  { name: '双指针', stage: '技巧', note: '两个下标代替两层循环' },
  { name: '滑动窗口', stage: '技巧', note: '双指针的特例：一段连续区间，左端只前进' },
  { name: '前缀和', stage: '技巧', note: '区间和 = 两个前缀和相减' },
  { name: '字符串', stage: '基础', note: '字符、切片、编码，本质还是数组' },
  { name: '链表', stage: '基础', note: '第一个"靠引用串起来"的结构，dummy 与快慢指针' },
  { name: '栈/队列', stage: '基础', note: '只能从一头进出的容器，配对与撤销全靠它' },
  { name: '单调栈/单调队列', stage: '技巧', note: '栈里保持有序，"下一个更大"一次结算一批' },
  { name: '堆/优先队列', stage: '基础', note: '随时取最值，Top-K 的标准解法' },
  { name: '二叉树/树', stage: '基础', note: '递归的主场：前中后序 + 层序' },
  { name: '图/DFS/BFS', stage: '基础', note: '网格、邻接表、拓扑排序、并查集' },
  { name: '回溯', stage: '范式', note: '递归 + 撤销选择，穷举所有可能' },
  { name: '二分查找', stage: '技巧', note: '有序就砍一半，边界是唯一的难点' },
  { name: '贪心', stage: '范式', note: '每步取局部最优，难在证明它真的最优' },
  { name: '动态规划', stage: '范式', note: '状态 + 转移 + 遍历顺序，三句话说清一道题' },
  { name: '数学', stage: '杂项', note: '找规律、进制、快速幂' },
  { name: '位运算', stage: '杂项', note: '与或异或、移位，偶尔能救场' },
  { name: '其他', stage: '杂项', note: '暂时没归类的题' },
]

const TOPIC_INDEX = new Map(PATH_TOPICS.map((t, i) => [t.name, i]))

export function pathRank(category: string): number {
  const index = TOPIC_INDEX.get(category)
  return index === undefined ? PATH_TOPICS.length : index
}

export function topicMeta(category: string): PathTopic {
  return (
    PATH_TOPICS.find((t) => t.name === category) ?? {
      name: category,
      stage: '杂项',
      note: '暂时没归类的题',
    }
  )
}

/** 路线排序：专题 → 难度 → 题号。全函数无随机，同样的输入永远同样的顺序。 */
export function compareByPath(a: Problem, b: Problem): number {
  return (
    pathRank(a.category) - pathRank(b.category) ||
    LEVEL_RANK[a.level] - LEVEL_RANK[b.level] ||
    noRank(a.no) - noRank(b.no)
  )
}

/** 难度排序：简单 → 中等 → 困难，同难度按题号。 */
export function compareByLevel(a: Problem, b: Problem): number {
  return LEVEL_RANK[a.level] - LEVEL_RANK[b.level] || noRank(a.no) - noRank(b.no)
}

export function sortByPath(problems: Problem[]): Problem[] {
  return [...problems].sort(compareByPath)
}

/** 学习路线只认精选题（有精讲、按 19 个专题排过序的 365 道） */
export function onlyCurated(problems: Problem[]): Problem[] {
  return problems.filter((p) => p.curated)
}

/** 按路线取「下一批还没做的题」，用于今日计划与「再来一题」。 */
export function nextInPath(
  problems: Problem[],
  isDone: (no: string) => boolean,
  count = 1,
): Problem[] {
  return sortByPath(problems)
    .filter((p) => !isDone(p.no))
    .slice(0, count)
}

export const LEVEL_ORDER_LABEL: Record<Level, string> = {
  Easy: '简单',
  Medium: '中等',
  Hard: '困难',
}
