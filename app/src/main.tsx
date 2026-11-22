import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// 字体：拉丁字母用 Instrument Sans（中文自动回落到系统黑体），标题用 Fraunces，代码用 JetBrains Mono
import '@fontsource-variable/instrument-sans'
import '@fontsource-variable/fraunces'
import '@fontsource-variable/jetbrains-mono'
// 样式层：顺序即优先级，越靠后越优先。令牌 → 基础 → 骨架 → 组件 → 页面 → 阅读 → 代码 → 动效
import './styles/tokens.css'
import './styles/base.css'
import './styles/layout.css'
import './styles/components.css'
import './styles/pages.css'
import './styles/prose.css'
import './styles/lab.css'
import './styles/terminal.css'
import './styles/motion.css'
import App from './App'

const root = document.getElementById('root')!

/**
 * 进度迁移页（只在桌面版换壳的第一次启动时出现）。
 *
 * 启动器会用 Chrome 打开 `/?migrate=1`：这个页面把旧版存在 Chrome localStorage 里的
 * 进度 POST 到本地服务的 /__migrate，然后自己关掉。宿主随后把数据写进 WebView2。
 * 这里刻意不渲染整个应用 —— 迁移只需要 localStorage，加载 3.4MB 题库纯属浪费。
 */
async function runMigration() {
  const payload: Record<string, string> = {}
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i)
    if (!key) continue
    // 只搬学习进度和界面偏好，其它（比如临时缓存）不带
    if (key === 'lc.progress.v1' || key.startsWith('lc.ui.')) {
      const value = localStorage.getItem(key)
      if (value != null) payload[key] = value
    }
  }

  const count = Object.keys(payload).length
  root.innerHTML = `
    <div style="min-height:100dvh;display:grid;place-items:center;background:#0a0c0f;color:#e9edf2;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;text-align:center;padding:32px">
      <div>
        <div style="font-size:40px;line-height:1;margin-bottom:16px">题</div>
        <h1 style="font-size:18px;font-weight:600;margin:0 0 8px">正在把进度搬到新界面</h1>
        <p id="lc-migrate-status" style="font-size:13px;color:#8b95a3;margin:0">已读取 ${count} 项本地数据…</p>
      </div>
    </div>`

  const status = document.getElementById('lc-migrate-status')
  try {
    const response = await fetch('/__migrate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!response.ok) throw new Error(String(response.status))
    if (status) status.textContent = count ? '迁移完成，这个窗口会自动关闭。' : '没有找到旧进度，可以关掉这个窗口了。'
  } catch {
    if (status) status.textContent = '迁移失败，可以关掉这个窗口，在新界面里手动导入。'
  }

  // 让用户看一眼结果再关（Chrome 只允许脚本关闭它自己打开的窗口，失败就留着）
  window.setTimeout(() => {
    try {
      window.close()
    } catch {
      // 关不掉就留着，用户自己关
    }
  }, 1600)
}

if (new URLSearchParams(window.location.search).get('migrate') === '1') {
  void runMigration()
} else {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
