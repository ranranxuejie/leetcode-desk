import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiKey = env.DEEPSEEK_API_KEY || ''

  // 浏览器只请求 /api/deepseek/*，真正的 Key 由这个代理注入，
  // 所以前端打包产物里看不到 Key，也不会有跨域问题。
  const proxy = {
    '/api/deepseek': {
      target: 'https://api.deepseek.com',
      changeOrigin: true,
      secure: true,
      rewrite: (path: string) => path.replace(/^\/api\/deepseek/, ''),
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    },
  }

  return {
    plugins: [react()],
    // 固定 host / port / strictPort：学习进度存在浏览器 localStorage 里，而 localStorage 是
    // 按「协议 + 主机 + 端口」隔离的。以前 localhost:5173 和 127.0.0.1:5173 会看到两套空进度，
    // 5173 被占时 Vite 自动换端口也会「丢进度」。这里钉死成唯一地址，避免再踩。
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      proxy,
      // 编辑器/工具落盘时会先生成 .xxx.tmpdir 临时目录，
      // 让 watcher 忽略它们，免得刷 EBUSY 噪音
      watch: { ignored: ['**/.*.tmpdir/**', '**/*.tmpdir/**'] },
    },
    preview: { host: '127.0.0.1', port: 4173, strictPort: true, proxy },
  }
})
