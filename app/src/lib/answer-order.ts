/**
 * 「答案顺序不唯一」的软判定。
 *
 * 背景：46 全排列、49 字母异位词分组、51 N 皇后这类题，标准答案是「列表的列表」，
 * 但列表之间的顺序是任意的。写对了、只是顺序不同，字面比对会判红 ——
 * 而回溯/排列组合恰恰是基础薄弱的人最需要练的专题。
 *
 * 做法（安全子集，reviewer 定的口径）：
 * 1. 只在白名单题上启用（按题号精确匹配，不做模糊包含 ——
 *    「排列」会命中「排列硬币」、「组合」会命中「组合总和 IV 计数题」）；
 * 2. 先按原口径字面比对，失败后再做一次「外层列表无序」的深比较；
 * 3. 命中则判「顺序不同，视为另一种合法答案」并计入通过；
 * 4. 白名单外的题行为完全不变；48 旋转图像、59 螺旋矩阵这类顺序敏感题不在名单里。
 */

/**
 * 顺序无关的白名单：题号精确匹配。
 *
 * 只放「外层列表的顺序确实自由」的题：
 * - 46/47 全排列：每个排列内部的顺序有意义 → 只放开外层
 * - 51 N 皇后：每个解内部是列号序列 → 只放开外层
 * - 17/22/93/131/1079：内层是序列（字母组合 / 括号串 / IP 段 / 回文段 / 字符排列）→ 只放开外层
 *
 * 故意**不放**的：
 * - 89 格雷编码：期望 `[0,1,3,2]`，而 `[0,1,2,3]` 是同一集合、顺序不同但不是格雷码
 *   （1→2 差两位）—— 放进白名单会放行最典型的错误答案；
 * - 37 解数独：答案是唯一棋盘，行列不是自由变量；
 * - 48 旋转图像 / 59 螺旋矩阵：顺序敏感。
 */
export const ORDER_FREE_NOS = new Set([
  '17', // 电话号码的字母组合
  '22', // 括号生成
  '46', // 全排列
  '47', // 全排列 II
  '51', // N 皇后
  '93', // 复原 IP 地址
  '131', // 分割回文串
  '1079', // 活字印刷
])

export function isOrderFree(no: string | undefined | null): boolean {
  // 外层无序是「深比较」的前提：deep 集合也算在白名单里
  return isDeepOrderFree(no) || (no != null && ORDER_FREE_NOS.has(String(no).trim()))
}

/**
 * 内外两层都无序的题：外层是「答案的集合」，内层是「集合里的一个组合」，
 * 组合内部的顺序也自由（LeetCode 判题器同样按集合比）。
 * - 49 字母异位词分组、15/18 三数/四数之和、39/40/216 组合总和、77 组合、78/90 子集、254 因式分解组合
 */
const DEEP_ORDER_FREE_NOS = new Set([
  '15',
  '18',
  '39',
  '40',
  '49',
  '77',
  '78',
  '90',
  '216',
  '254',
])

export function isDeepOrderFree(no: string | undefined | null): boolean {
  return no != null && DEEP_ORDER_FREE_NOS.has(String(no).trim())
}

/** 白名单总表（供文档/回归脚本引用） */
export function orderFreeNos(): { outer: string[]; deep: string[] } {
  return { outer: [...ORDER_FREE_NOS], deep: [...DEEP_ORDER_FREE_NOS] }
}

/**
 * 把 Python repr 解析成 JS 值。只支持判题输出里会出现的子集：
 * 列表 / 元组 / 数字 / 字符串 / True / False / None。
 * 解析失败返回 undefined（调用方按「不可比」处理，退回字面比对）。
 */
export function parseLiteral(text: string): unknown {
  const source = text.trim()
  if (!source) return undefined
  // Python 字面量 → JSON：单引号、True/False/None、元组括号
  const jsonish = source
    .replace(/\bTrue\b/g, 'true')
    .replace(/\bFalse\b/g, 'false')
    .replace(/\bNone\b/g, 'null')
    .replace(/\(/g, '[')
    .replace(/\)/g, ']')
    .replace(/'/g, '"')
  try {
    return JSON.parse(jsonish)
  } catch {
    return undefined
  }
}

/** 递归比较：数组按「多重集合」比（顺序无关），其它按值比 */
export function unorderedEqual(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) return false
    const a = left.map((item) => stableKey(item)).sort()
    const b = right.map((item) => stableKey(item)).sort()
    return a.every((item, index) => item === b[index])
  }
  return stableKey(left) === stableKey(right)
}

/**
 * 稳定序列化：只把**最外层**数组排序，内层保持原样。
 * 全排列的每个排列内部顺序是有意义的，不能把内层也排掉。
 */
function stableKey(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableKey(item)).join(',')}]`
  if (value === null) return 'null'
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${key}:${stableKey(record[key])}`)
      .join(',')}}`
  }
  return `${typeof value}:${String(value)}`
}

/**
 * 顺序无关比较：两边都解析成功、且「外层列表无序相等」才算命中。
 * 任何一边解析失败都返回 false，让调用方保持原来的字面比对结论。
 */
export function sameAnswerIgnoringOrder(expected: string, actual: string, deep = false): boolean {
  const left = parseLiteral(expected)
  const right = parseLiteral(actual)
  if (left === undefined || right === undefined) return false
  if (!Array.isArray(left) || !Array.isArray(right)) return false
  if (left.length !== right.length) return false
  const key = deep ? deepKey : stableKey
  const a = left.map((item) => key(item)).sort()
  const b = right.map((item) => key(item)).sort()
  return a.every((item, index) => item === b[index])
}

/** 逐层无序：内层数组也排序（只给 49 这类「分组」题用） */
function deepKey(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => deepKey(item)).sort().join(',')}]`
  }
  return stableKey(value)
}
