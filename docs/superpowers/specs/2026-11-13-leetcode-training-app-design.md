# LeetCode 训练台 · 设计文档

日期：2026-11-13
状态：已确认，进入实现
位置：`D:\2026\leetcode\app`

## 1. 目标

把工作区里已有的 LeetCode 学习资产（352 题清单、104 道题面、21 篇教程）串成一个本地运行的个人训练台，形成「选题 → 读题 → 看讲解 → 写代码 → 跑用例 → 记录 → 复习」的闭环。

## 2. 技术方案

- Vite + React + TypeScript
- CodeMirror 6（Python 语法高亮、快捷键）
- Pyodide 本地运行时，在 Web Worker 中执行，超时可终止
- 数据由 `tools/build_web_data.py` 在构建前编译为 JSON
- 进度、笔记、代码、自定义用例存 `localStorage`，支持导出/导入
- 无后端、无账号；`npm run dev` 本地使用，`npm run build` 可静态托管

被否方案：零构建单页（扩展性差）、Node + SQLite 后端（个人本地使用过度设计）。

## 3. 信息架构

1. **今日** `/`：今日计划、继续上次、待复习、分级进度、打卡热力图
2. **题库** `/problems`：352 题筛选/搜索/排序，批量加入今日
3. **题目工作台** `/problems/:no`：题面 / 精讲 / 笔记三 Tab + 代码实验室
4. **教程** `/tutorials`、`/tutorials/:id`：书架 + 阅读器 + 目录 + 题目互链
5. **错题本** `/review`：错题列表 + 遗忘曲线复习队列
6. **统计** `/stats`：分级完成度、专题分布、正确率、热力图

## 4. 数据管线

`tools/build_web_data.py` 输出 `app/src/data/`：

- `problems.json`：`master.json` 全量 352 题，合并题面 HTML、示例（输入/输出/解释）、教程章节引用、方法名
- `tutorials.json`：21 篇正文的章节树与 Markdown 原文，章节 → 题号映射
- `meta.json`：生成时间、计数、数据缺口

规则：

- 难度统一为 `Easy | Medium | Hard`
- 示例从 `<pre>` 中解析「输入：/输出：」；解析失败则保留原文，不阻塞
- 方法名从教程代码 `class Solution` 中抽取；没有教程的题用 `solve` 占位
- 题面缺失的题仍可浏览元数据，并提供 LeetCode 外链

## 5. 状态模型

```ts
type Status = 'todo' | 'learning' | 'done'

interface ProblemState {
  status: Status
  wrong: boolean
  note: string
  code: string
  cases: { id: string; call: string; expected: string }[]
  attempts: number
  passes: number
  timeSpentSec: number
  selfRating?: 'read' | 'recall' | 'variant'
  lastOpenedAt?: number
  reviews: { at: number; result: 'pass' | 'fail' }[]
}
```

存储键：`lc.progress.v1`、`lc.settings.v1`、`lc.daily.v1`。导出为单个 JSON 文件。

## 6. 代码执行

- 主线程把 `{code, call, expected}` 发给 Worker
- Worker 用 Pyodide 执行用户代码，再执行调用表达式，捕获 stdout/stderr
- 结果与期望输出做归一化比较（去空白、引号、大小写）
- 8 秒超时：终止并重建 Worker
- 首次加载 Pyodide 显示进度提示；失败时给出可读错误，不影响阅读功能

## 7. 视觉方向

「纸上算法实验室」：暖纸底 `#F6F1E7`、墨黑正文、朱砂红强调、衬线中文标题、深墨色代码区、章节编号与细网格。桌面优先，窄屏可用。

## 8. 范围外

账号与云同步、真实 LeetCode 提交、树/链表输入的自动构造、完整移动端适配。

## 9. 验收

- 352 题可筛选；95 道题面可读；39 道有精讲
- 编辑器可运行 Python，示例可载入并比对，超时可终止
- 21 篇教程可读、可跳转
- 刷新后进度/笔记/代码不丢
- `npm run build` 通过，本地 URL 可访问
