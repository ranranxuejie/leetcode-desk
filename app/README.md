# LeetCode 训练台

一个本地运行的中文 LeetCode 学习工作台：把 365 道按华为面试频度整理的题、21 篇七段式精讲、错题复习和浏览器内的 Python 运行器串在一起。

## 快速开始

```bash
cd app
npm install
npm run dev
```

打开终端里显示的地址：**http://127.0.0.1:5173**（`vite.config.ts` 已钉死 host/port，不会再变地址）。

> ⚠️ 请始终用 `127.0.0.1:5173` 这个地址。学习进度存在浏览器 localStorage 里，而它按
> 「协议 + 主机 + 端口」隔离：换成 `localhost:5173` 或别的端口会看到一套空进度。

## 桌面应用（Windows）

想双击打开、像独立软件一样用：

```powershell
cd launcher
.\build.ps1                      # 构建前端 + 图标 + exe
# 可选：双击 创建桌面快捷方式.ps1，在桌面放一个带图标的入口
```

之后双击 `launcher\LeetCode训练台.exe`：它会静默拉起本地服务，再用 Chrome/Edge 的应用窗口打开，
没有地址栏和标签页。细节和常见问题见 [launcher/README.md](../launcher/README.md)。

生产构建：

```bash
npm run build
npm run preview
```

## 功能

- **今日**：每日计划、继续上次、到期错题、分级进度、16 周学习热力、每日目标。
- **题库（全量 4504 道）**：LeetCode 中文站全量题 + 标注 **热题 100**，按分级 / 难度 / 状态 / 专题筛选，
  按华为频度、题号、通过率排序；一键加入今日计划。
  - **范围三档**：全部 4504 / 精选 365（有精讲、构成学习路线）/ Hot 100。
  - **精选题与全量题的区别**：365 道精选题带题面、解析、精讲和真实签名；其余题只带元数据，
    点进题目页会给出「去 LeetCode 看题」的入口，右侧代码台和终端照常可用。
  - **分批渲染**：全量视图先渲染 300 行，滚到底部自动追加，4 万多行也不会卡。
  - **筛选条件会记住**：范围、分级、难度、状态、专题、排序、搜索词和滚动位置都存在本地，
    点进题目做完再返回，看到的是同一批题、同一个位置，不会被打回「全部题库」。
    想重新开始点结果行右侧的「清空筛选」。
- **题目工作台**：题面 / 解析 / 精讲 / 我的笔记切换（没有精讲的题只有题面 / 解析 / 笔记）；学习计时；状态与错题标记；上一题 / 下一题。
  - **题面**：全量题库的题面、示例、代码模板都是从力扣抓的（`data/statements_full.json`），按题号分片懒加载，
    打开哪道题才取哪一片（每片 50 题约 120KB），不会拖慢首屏。
  - **解析（三档，按题的「讲解含量」递降）**：
    1. **Hot 100 → AI 精讲**：预生成的整篇详解，平均 4800 字，固定九节
       （一句话本质 / 第一反应 / 从暴力到最优 / 正确性 / 完整代码 / 复杂度 / 边界与反例 / 面试追问 / 举一反三），
       是让模型**读完题面和示例**后写的，存在 `data/teachings/<题号>.md`，打开即看、不花运行时 token。
       解析标签上会打一个 `AI` 标记。
    2. **365 道精选题 → 教程解析**：从精讲 markdown 抽出来的完整解析（考点 / 误区 / 参考实现 / 推演 / 追问）。
    3. **其余题 → AI 现场读题**：打开「解析」就自动让 DeepSeek 读题面写一份约 1000 字的六段解析
       （一句话 / 思路 / 关键步骤 / 复杂度 / 边界用例 / 常见坑），按题号缓存在本地；
       没有题面的会员题不自动生成（凭空猜题意不如不生成），只保留标签模板 + 官方 hints。
  - **官方提示**：力扣题面里的 hints 会单独列出来（3033 道有）。
  - **代码用例**：官方示例自动转成可运行用例（形参名来自 LeetCode 的 `metaData`，所以是
    `Solution().twoSum(nums=[2,7,11,15], target=9)` 而不是 `solve(*args)`），
    后面再追加**构建期生成的边界用例**（空数组 / 单元素 / 全相同 / 极值，标着「边界」）。
    全量题库 3796 道有边界用例、共 22505 条；其中 292 道（Hot 100 + 精选题）有**期望输出**，
    其余是「只运行不判定」。边界用例不进你的存档，题库重建后会跟着更新。
  - **判题规则**（`lib/cases.ts` 的 `judgeCase`）：①有期望 → 归一化比对；②没期望但**抛异常 → 失败**；
    ③没期望但**返回类型不符 → 失败**（`integer` 排除 `bool`、`double` 收 `int`、`integer[][]` 要求嵌套）；
    ④都没有 → 只运行不判定。所以「只处理常规输入」的代码现在会被边界用例抓出来。
  - **原地修改题**（移动零、旋转图像这类，力扣 `metaData.output.paramindex` 标记）：答案在被改写的实参里，
    按返回值比对会把写对的代码判错，所以这类题**只运行不判定**，汇总里显示「N 未判定」。
  - **代码验证**：逐条比对期望与实际，通过标绿、失败标红并给出 diff；没填期望的用例只运行不判定
    （留空即「只看输出」）。全量题库 4152 道有题面、6371 条示例可判定。
- **代码实验室**：CodeMirror 编辑器 + 本地 Pyodide 运行 Python；用例可编辑、逐条判定，失败用例给出期望与实际的 diff；`⌘/Ctrl + Enter` 运行；代码与用例自动保存。
  - **终端**：题目内持久的 Python 会话，敲任意命令、查看运行后的变量、重置会话；`` Ctrl+` `` 聚焦；`Ctrl+L` 清屏；运行中按 `Ctrl+C` 中断（会重建会话）。
  - **单步追踪**：逐行看局部变量，最多 300 步，超出会截断；用例行上的虫子按钮和控制台结果右侧的「追踪」都能触发。
  - **初始代码**：按题目真实签名生成（方法名 + 形参 + 类型标注）；链表 / 树题自带 `ListNode` / `TreeNode` 和 `build_list` / `build_tree`，设计题自带类骨架。
  - **链表 / 树题自动构造**：示例里的数组会自动包成节点、返回值自动还原成数组再比对，不用自己建节点。
  - **设计题**（LRU 缓存、最小栈、Trie…）：单次调用没法验证，用例台只给一条构造调用，用终端一步步敲 `obj.push(-2)` / `obj.get(1)` 来测。
  - **预填用例**：调用表达式按题目真实形参名对齐，实参实在拼不出来就留空让你手填，不会塞一条必然报错的调用。
  - **AI 判题**：让 DeepSeek 读代码，给判定和修改建议。
- **教程书架**：两册 21 篇，按基础 / 第一册 / 第二册分组；阅读器带目录、滚动高亮、阅读进度、章节跳题目。
- **错题本**：做错后隔天到期，独立做对即可移出；记录复习历史。
- **统计**：总进度、分级完成度、难度分布、专题掌握度、14 天运行柱状图与学习热力。
- **全局搜索**：`⌘K` / `Ctrl+K` 搜题号、题目、标签和教程章节。
- **界面**：侧边栏可收起成图标条（`Ctrl+B`，顶栏左侧按钮）；侧边栏宽度、题目页左右分栏、
  代码区与用例区的上下分栏都能拖拽调整，双击分界线复位，尺寸记在 `lc.ui.*`（不影响学习进度）。

## 视觉与设计系统

界面按**四种材质**组织，改样式前先看规范：

| 材质 | 用在哪 | 特征 |
| --- | --- | --- |
| chrome | 侧栏、顶栏 | 最暗最冷、无圆角，像仪器外壳 |
| content | 卡片、表格、表单 | 抬起来一层：1px 描边 + 顶部微高光 |
| code | 编辑器、终端、代码块 | 更暗更冷、几乎方角、内阴影（凹进去）、等宽字体 |
| reading | 题面、精讲、解析 | 不套卡片，靠行高与分割线的排版节奏 |

- 令牌：`src/styles/tokens.css`（字体 / 字号阶梯 / 颜色 / 间距 / 圆角 / 阴影）
- 排版基线：`src/styles/base.css`
- 规范文档：[docs/设计规范.md](../docs/设计规范.md)（含「老值 → 新令牌」映射表与验收清单）
- 令牌化自检：根目录 `python tools/audit_style.py`（统计写死的颜色/字号/圆角，应该接近 0）
- 动效：[docs/动效规范.md](../docs/动效规范.md)

字体：拉丁字母用捆绑的 **Instrument Sans**（约 30KB，天然不含中文），中文自动回落到系统黑体
（PingFang / 微软雅黑 / Noto），标题用 **Fraunces**，代码用 **JetBrains Mono**。

## 动效

视觉动效集中在两个文件里：

- `src/styles/motion.css`：动效令牌（时长 / 缓动 / 弹簧）、关键帧、工具类、三档降级
- `src/lib/motion.tsx`：动效原语 `Reveal` / `Odometer` / `Tip` / `Tabs` / `Collapse` / `PointerFx` 等

术语（按行显现、交错、模糊显现、揭示、流光、数字滚动、聚光灯、倾斜、共享元素转场、布局过渡…）
和「每个效果落在哪个组件、参数多少」写在 [docs/动效规范.md](../docs/动效规范.md)，
下次想改手感可以直接照那份文档描述。

设置 → **动效强度** 有三档：完整（默认，含指针聚光、倾斜卡片、磁吸按钮、自定义光标与拖尾）、
克制（只留转场、滚动触发、数字滚动、指示条这类功能性动效）、关闭。
系统开启「减少动态效果」时会自动切到关闭。

## 数据

`app/public/data/` 下的 `problems.json`、`tutorials.json`、`meta.json` 由根目录脚本生成：

```bash
python tools/build_web_data.py
```

脚本从 `data/` 与 `教程/` 读取源数据，重新生成题库、题面、示例和教程章节。前端只读取静态 JSON，不需要后端。

题库是**两份数据合并**的结果：

| 来源 | 内容 | 说明 |
| --- | --- | --- |
| `data/master.json` + `data/complexity.json` | 365 道精选题 | 带复杂度、华为频度、分级与专题；全部配了精讲 |
| `data/lc_catalog.json` | 全量 4504 道 | LeetCode 中文站目录（题号/标题/难度/通过率/标签/付费标记） |
| `data/lc_hot100.json` | 热题 100 | 只用来打 `hot100` 标记与分组（哈希 / 滑动窗口 / 动态规划 …） |
| `data/statements_full.json` | 3702 道题面 | 由 `tools/fetch_full_bank.py` 从力扣 GraphQL 抓取：题面 HTML、官方示例、python3 代码模板、参数类型、hints |
| `data/teachings/*.md` | 100 篇 AI 精讲 | 由 `tools/gen_teachings.py` 让 DeepSeek 读题面后生成，汇编成 `public/data/teachings.json`（约 0.9MB，只在打开 Hot 100 的解析时才取） |
| `data/edge_cases.json` | 3910 道题的边界输入 | 由 `tools/gen_edge_cases.py` 按 `metaData` 的参数类型生成（空 / 单元素 / 全相同 / 极值），构建时并进题面分片的 `edgeCases` |
| `data/ref_solutions/*.json` | 317 份参考解 | 由 `tools/gen_ref_solutions.py` 生成：Hot 100 让 AI 写、精选题从教程精讲里抽；先跑通官方示例才算可信，再用它算出边界用例的期望输出 |

抓题面（可断点续跑，已有缓存会跳过）：

```bash
python tools/fetch_full_bank.py            # 抓缺的
python tools/fetch_full_bank.py --limit 50 # 先试 50 道
```

生成 Hot 100 的 AI 精讲（同样断点续跑，已有 md 会跳过；需要 `app/.env.local` 里的 Key）：

```bash
python tools/gen_teachings.py --limit 2    # 先试两道
python tools/gen_teachings.py --workers 4  # 生成全部缺的（100 道约 7 分钟）
```

生成边界用例与参考解（边界用例是纯本地的，参考解里 Hot 100 需要 Key）：

```bash
python tools/gen_edge_cases.py             # 3910 道题的边界输入，几秒
python tools/gen_ref_solutions.py --scope hot100   # Hot 100 的参考解（约 10 分钟）
python tools/gen_ref_solutions.py --scope curated  # 精选题的参考解（从精讲里抽）
python tools/build_web_data.py             # 汇编进分片
```

合并规则：精选题保留全部增强字段并标 `curated: true`；目录里剩下的题只带元数据，
`tier` 记为「补充」，专题按标签自动归档（标签 → 19 个专题的映射在 `build_web_data.py` 的 `TAG_PRIORITY`）。
题面不进 `problems.json`，而是按题号每 50 道切一片写到 `public/data/statements/<shard>.json`，
`problems.json` 里只留 `hasStatement` / `shard` / `paramTypes`。

`meta.json` 会额外输出 `curatedCount` / `hot100Count` / `statementCount` / `exampleCount` / `hintCount` / `categories`。

题号排序要注意：`LCP 01`、`LCR 123`、`面试题 08.06` 这些不是数字，`Number()` 会得到 NaN，
所以统一走 `src/lib/utils.ts` 的 `noRank()`。

Pyodide 运行时已放在 `app/public/pyodide/`，代码在浏览器 Web Worker 中执行，不会上传到服务器。

## 本地存储

学习进度存在浏览器的 `localStorage`，键名 `lc.progress.v1`。包含：状态、笔记、代码、用例、运行/通过次数、用时、自评、错题复习记录、每日计划、已读教程和设置。

右上角设置里可以导出 / 导入 JSON，或清空全部数据。

## 技术栈

React 19 · TypeScript · Vite · React Router · CodeMirror 6 · marked + DOMPurify + highlight.js · Pyodide。

视觉是「石墨 + 琥珀」的深色工作台：设计令牌集中在 `src/styles/tokens.css`（`--bg` / `--surface` /
`--text` / `--accent` …），老变量名（`--paper` / `--ink` / `--cinnabar`）保留为别名，
所以历史样式不用改也能跟着换主题。改配色只需要动 tokens.css 一个文件。

## 说明

- 这是本地训练工具，不会向 LeetCode 提交代码，也不替代在线判题。
- 用例结果按字面比对（忽略空白和引号差异），顺序不同会判未通过；失败用例会标出期望与实际不一致的片段。
- 链表 / 树的输入输出由内置的 `_build_list` / `_build_tree` / `_dump_list` / `_dump_tree` 自动转换，终端里也可以直接调用它们。原地修改类题目（如 99 恢复二叉搜索树、114 二叉树展开为链表）返回值是 `None`，请用终端检查改完的结构。
- 终端不支持 `input()` 交互输入：要测的输入直接写成变量或字面量。
- 运行超时（用例 15 秒、追踪 12 秒、终端 10 秒）或点「重置会话」会重建 Worker，会话变量随之清空。
- 单步追踪最多记录 300 步，超出部分会截断；`ListNode` / `TreeNode` 的 `__init__` 不计入追踪，避免构造节点把步骤刷满。
- AI 解析和 AI 判题需要 `app/.env.local` 里的 `DEEPSEEK_API_KEY`，请求由 dev server 代理转发；没有 Key 时只影响这两项，其它功能照常。
- 首次运行 Python 需要加载本地 Pyodide 运行时（约 10MB），之后会复用同一个 Worker；超时会重建。
