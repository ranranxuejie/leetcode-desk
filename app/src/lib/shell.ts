/**
 * 桌面壳（WebView2 自绘边框）的桥接层。
 *
 * 页面在 WebView2 里打开时，宿主会注入 `window.__LC_SHELL__`；
 * 标题栏的拖拽 / 窗口按钮都通过 `chrome.webview.postMessage` 交给 C# 宿主执行。
 * 在普通浏览器里打开时这些函数全是空操作，页面行为不受影响。
 */

interface WebViewBridge {
  postMessage: (message: unknown) => void
  addEventListener: (type: 'message', listener: (event: { data: unknown }) => void) => void
}

interface ChromeLike {
  webview?: WebViewBridge
}

declare global {
  interface Window {
    __LC_SHELL__?: { platform?: string }
    chrome?: ChromeLike
  }
}

export function inShell(): boolean {
  return typeof window !== 'undefined' && Boolean(window.__LC_SHELL__)
}

function bridge(): WebViewBridge | undefined {
  return window.chrome?.webview
}

/** 通知宿主：开始拖窗口 / 最小化 / 最大化 / 关闭 */
export function shellAction(action: 'drag' | 'minimize' | 'maximize' | 'close'): void {
  bridge()?.postMessage(action)
}

/**
 * 告诉宿主当前主题，让窗口边框/底色跟着变。
 * 不通知的话，浅色模式下窗口四周会留一圈深色描边（DWM 边框 + 窗体底色还是深色）。
 */
export function notifyShellTheme(theme: 'dark' | 'light'): void {
  bridge()?.postMessage(theme === 'light' ? 'theme:light' : 'theme:dark')
}

/** 监听宿主发来的状态（目前只有「是否已最大化」，用来换按钮图标） */
export function onShellState(listener: (maximized: boolean) => void): () => void {
  const channel = bridge()
  if (!channel) return () => {}
  const handler = (event: { data: unknown }) => {
    const data = event.data
    if (data && typeof data === 'object' && 'maximized' in data) {
      listener(Boolean((data as { maximized: unknown }).maximized))
    }
  }
  channel.addEventListener('message', handler)
  return () => {}
}
