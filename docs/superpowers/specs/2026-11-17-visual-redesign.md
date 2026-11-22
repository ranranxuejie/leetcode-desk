# 视觉改版契约 · Graphite & Amber

日期：2026-11-17
状态：进行中（多智能体并行改样式）
适用：`D:\2026\leetcode\app`

> 目标：把「暖纸 + 衬线 + 米黄」的老界面换成**深色石墨工作台 + 单一琥珀强调色**，
> 看起来像 2025 年的开发工具，而不是模板生成的博客。

## 1. 已经由 lead 重写好的文件（**不要动**）

- `src/styles/tokens.css` —— 全部设计令牌（含旧变量名别名）
- `src/styles/base.css` —— 重置 / 排版 / 滚动条 / 焦点 / 动效 / 工具类
- `src/styles/layout.css` —— 侧栏 / 顶栏 / 内容区 / 启动屏 / Toast
- `src/styles/components.css` —— 按钮 / 表单 / 标签页 / 徽章 / 卡片 / 弹层 / 热力图

## 2. 令牌清单（只能用这些，禁止硬编码颜色）

| 用途 | 变量 |
|---|---|
| 页面底 | `--bg` `--bg-soft` |
| 卡片/面板 | `--surface` `--surface-2` `--surface-3` `--surface-hover` |
| 遮罩 | `--overlay` |
| 描边 | `--line`（常规）`--line-strong`（强调/输入框） |
| 文字 | `--text`（主）`--text-2`（次）`--text-3`（弱/说明） |
| 强调色 | `--accent` `--accent-deep` `--accent-soft` `--accent-wash` `--accent-line` |
| 语义 | `--success` `--success-wash` `--danger` `--danger-wash` `--info` `--info-wash` |
| 代码区 | `--code` `--code-soft` `--code-line` |
| 阴影 | `--shadow-sm` `--shadow-md` `--shadow-lg` |
| 圆角 | `--radius-sm`(6) `--radius`(10) `--radius-lg`(14) `--radius-pill` |
| 字体 | `--font-display`（Fraunces，只用于大标题/大数字）`--font-body` `--font-mono` |
| 缓动 | `--ease` |

允许直接写的只有：`rgba(255,255,255,0.0x)`（高光/分隔）、`rgba(0,0,0,0.x)`（阴影）、`transparent`、`currentColor`。
旧变量名（`--paper` `--ink` `--cinnabar` `--muted`…）是别名，能不用就不用；看到就顺手换成语义名。

## 3. 排版尺度（不许再出现 9.5px 这种小字）

- 正文 13.5–14px / 行高 1.7；次级 12.5px；说明 11.5–12px；**最小 11px**
- 页面大标题 24–28px / 600 / `--font-display`（中文标题用 body 字体，英文数字可用 display）
- 区块标题 15–16px / 600；小标题 13px / 600
- 数据数字用 `--font-mono` + `font-variant-numeric: tabular-nums`
- 大数字/百分比可以用 `--font-display`（Fraunces）做出编辑感
- 不要再用 `letter-spacing: 0.18em` + 全大写的 10px 小标签，改成 11px / 0.12em 或直接省掉

## 4. 间距与形状

- 间距只用 4 / 6 / 8 / 10 / 12 / 14 / 16 / 20 / 24 / 32 / 40
- 卡片：`background: var(--surface)` + `1px solid var(--line)` + `--radius-lg` + `--shadow-sm`；hover 变 `--surface-2` + `--line-strong`
- 输入框/次级按钮：`--surface-3` 底 + `--line` 描边 + `--radius`
- 不要在每一格都画 1px 边框；优先用留白 + `rgba(255,255,255,0.06)` 细分割线
- 圆角统一：小块 6–8、卡片 12–14、药丸 999

## 5. 硬性约束

- **不要改 TSX/TS 文件**（除自己任务里明确允许的），只改 CSS
- **不要改类名、不要删类名**：页面结构、`className` 全靠现有名字，你只负责让它们好看
- 可以新增修饰类（如 `.page--xxx`），但调用方不改，所以新增类必须能挂在已有元素上
- 不要引入图片/字体/新依赖
- 保留响应式断点行为（1080 / 900 / 860 / 720 等），窄屏不能塌
- 每个交互元素都要有 hover + focus-visible + disabled 状态
- 中文正文对比度：`--text` 或 `--text-2`；说明性文字最弱用 `--text-3`

## 6. 文件归属

| 归属 | 文件 |
|---|---|
| lead | `tokens.css` `base.css` `layout.css` `components.css`（已完成） |
| pages-agent | `pages.css` |
| lab-agent | `lab.css` `terminal.css` |
| reading-agent | `prose.css` `analysis.css` |
| desktop-agent | `launcher/*`（Windows 桌面应用，见另一份任务说明） |

## 7. 验收

- `cd app; .\node_modules\.bin\tsc.cmd -p tsconfig.app.json --noEmit` 保持 0 错误（CSS 不影响，但要确认没误改 TS）
- 用 headless Chrome 截图自查：`node tools\e2e_lab.mjs` 会把 `http://127.0.0.1:5173/problems/1` 的截图存到 `.tmp/shot-terminal.png`、`.tmp/shot-analysis.png`
- 页面不能出现「浅色卡片 + 浅色文字」「白底黑字块」这种深色主题下的漏网之鱼
