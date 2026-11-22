#!/usr/bin/env node
/**
 * LeetCode 训练台的本地服务（零依赖）。
 *
 * 为什么不用 `vite preview`：
 * - preview 是开发工具，行为会随 Vite 版本变；
 * - 桌面应用只需要「把 app/dist 端出来 + 转发一个 DeepSeek 代理」，自己写 200 行更可控，
 *   也不用在用户机器上装 node_modules。
 *
 * 端口固定 5173：学习进度存在浏览器 localStorage，而 localStorage 按 origin 隔离，
 * 换端口 = 换 origin = 用户看到「进度没了」。所以这里宁可复用已有服务，也不换端口。
 */
import { createServer } from 'node:http'
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { request as httpsRequest } from 'node:https'
import { gzipSync } from 'node:zlib'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const ROOT = resolve(HERE, '..')
const DIST = resolve(ROOT, 'app', 'dist')
const ENV_FILE = resolve(ROOT, 'app', '.env.local')
// 设置里填的 Key 存在用户目录（不是仓库里），换版本/重装都不会丢，也不会被 git 提交
const USER_DATA = resolve(
  process.env.LOCALAPPDATA || resolve(process.env.USERPROFILE || '.', 'AppData', 'Local'),
  'LeetCode训练台',
)
const KEY_FILE = resolve(USER_DATA, 'deepseek.key')
const PORT = Number(process.env.PORT || 5173)
const HOST = '127.0.0.1'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.zip': 'application/zip',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
}

/** Key 的来源优先级：设置里填的 > 环境变量 > app/.env.local（开发用） */
function readStoredKey() {
  try {
    return readFileSync(KEY_FILE, 'utf8').trim()
  } catch {
    return ''
  }
}

function readEnvFileKey() {
  try {
    const raw = readFileSync(ENV_FILE, 'utf8')
    const match = /^\s*DEEPSEEK_API_KEY\s*=\s*(.+?)\s*$/m.exec(raw)
    if (!match) return ''
    return match[1].trim().replace(/^['"]|['"]$/g, '')
  } catch {
    return ''
  }
}

function readApiKey() {
  return readStoredKey() || (process.env.DEEPSEEK_API_KEY || '').trim() || readEnvFileKey()
}

/** 只回「有没有配」和尾号，永远不回完整 Key */
function keyStatus() {
  const stored = readStoredKey()
  const key = stored || (process.env.DEEPSEEK_API_KEY || '').trim() || readEnvFileKey()
  if (!key) return { configured: false, source: 'none', hint: '' }
  const source = stored ? 'settings' : process.env.DEEPSEEK_API_KEY ? 'env' : 'file'
  const tail = key.length >= 4 ? key.slice(-4) : ''
  return { configured: true, source, hint: 'sk-…' + tail }
}

const KEY_PATTERN = /^sk-[A-Za-z0-9_-]{16,}$/

function writeStoredKey(key) {
  mkdirSync(USER_DATA, { recursive: true })
  writeFileSync(KEY_FILE, key.trim(), { encoding: 'utf8', mode: 0o600 })
}

function clearStoredKey() {
  try {
    if (existsSync(KEY_FILE)) rmSync(KEY_FILE, { force: true })
  } catch {
    // 删不掉就算了
  }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  res.end(body)
}

function proxyDeepSeek(req, res) {
  const key = readApiKey()
  if (!key) {
    sendJson(res, 401, {
      error: {
        message:
          '缺少 DEEPSEEK_API_KEY：请把 Key 写进 app\\.env.local（DEEPSEEK_API_KEY=sk-xxx），然后重启训练台。',
      },
    })
    return
  }
  const targetPath = req.url.replace(/^\/api\/deepseek/, '') || '/'
  const headers = { ...req.headers }
  delete headers.host
  delete headers.connection
  headers.host = 'api.deepseek.com'
  headers.authorization = `Bearer ${key}`

  const upstream = httpsRequest(
    {
      hostname: 'api.deepseek.com',
      port: 443,
      path: targetPath,
      method: req.method,
      headers,
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers)
      // 边收边发：AI 判题/解析用的是 SSE 流式响应，不能整体缓冲
      upstreamRes.pipe(res)
    },
  )
  upstream.on('error', (error) => {
    if (!res.headersSent) sendJson(res, 502, { error: { message: `上游请求失败：${error.message}` } })
    else res.end()
  })
  req.pipe(upstream)
}

// 桌面版首屏要拉 problems.json(3.4MB) + tutorials.json(2.9MB)，不压缩的话每个页面 6.3MB。
// 这里对文本类资源做 gzip（结果按「路径+大小+修改时间」缓存，不会每次请求现压）。
const GZIP_TYPES = new Set(['.json', '.js', '.mjs', '.css', '.html', '.svg', '.txt', '.md', '.map'])
const GZIP_MIN_BYTES = 1024
const gzipCache = new Map()

function acceptsGzip(req) {
  const header = String(req.headers['accept-encoding'] || '')
  return /\bgzip\b/i.test(header)
}

function gzipFor(filePath, stats) {
  const key = `${filePath}|${stats.size}|${stats.mtimeMs}`
  const cached = gzipCache.get(key)
  if (cached) return cached
  const buffer = gzipSync(readFileSync(filePath), { level: 6 })
  if (gzipCache.size > 32) gzipCache.clear()
  gzipCache.set(key, buffer)
  return buffer
}

function serveFile(req, res, filePath) {
  const stats = statSync(filePath)
  const ext = extname(filePath).toLowerCase()
  const type = MIME[ext] || 'application/octet-stream'
  // 只有 Vite 带内容哈希的产物（dist/assets/*）才能标「一年不可变」。
  // data/*.json 会随题库重建而变化，必须走协商缓存 —— 否则桌面版会一直吃旧题库，
  // 表现就是「题库明明重建了，打开还是老数据」。
  const immutable = /[\\/]assets[\\/]/.test(filePath)
  // gzip 和原文用不同的 ETag 后缀：协商缓存要按「变体」分别命中，不能混
  const useGzip =
    acceptsGzip(req) && GZIP_TYPES.has(ext) && stats.size >= GZIP_MIN_BYTES
  const etag = `W/"${stats.size}-${Math.round(stats.mtimeMs)}${useGzip ? '-gz' : ''}"`
  const headers = {
    'content-type': type,
    'accept-ranges': 'bytes',
    etag,
    vary: 'Accept-Encoding',
    'last-modified': stats.mtime.toUTCString(),
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  }

  const inm = req.headers['if-none-match']
  if (!immutable && inm && inm === etag) {
    res.writeHead(304, headers)
    res.end()
    return
  }

  if (useGzip) {
    let buffer
    try {
      buffer = gzipFor(filePath, stats)
    } catch {
      // 压缩失败就退回原文，别让整个页面打不开
      res.writeHead(200, { ...headers, 'content-length': stats.size })
      if (req.method === 'HEAD') {
        res.end()
        return
      }
      createReadStream(filePath).pipe(res)
      return
    }
    res.writeHead(200, {
      ...headers,
      'content-encoding': 'gzip',
      'content-length': buffer.length,
    })
    if (req.method === 'HEAD') {
      res.end()
      return
    }
    res.end(buffer)
    return
  }

  res.writeHead(200, { ...headers, 'content-length': stats.size })
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  createReadStream(filePath).pipe(res)
}

// ---------------------------------------------------------------------------
// 进度迁移（只在桌面版第一次启动时用一次）
//
// 旧版把进度存在 Chrome 的 localStorage 里，新版用 WebView2（独立 profile）看不到它。
// 启动器会临时开一个 Chrome 窗口打开 /?migrate=1，页面把 localStorage 里关心的键
// POST 到这里，启动器再取走写进 WebView2。数据只在本机内存里过一遍，不落盘。
// ---------------------------------------------------------------------------
let migratePayload = null

function handleMigrate(req, res, pathname) {
  if (pathname === '/__migrate/reset') {
    migratePayload = null
    res.writeHead(204).end()
    return true
  }
  if (pathname !== '/__migrate') return false

  if (req.method === 'POST') {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
      if (body.length > 8 * 1024 * 1024) req.destroy() // 进度 JSON 不会超过几 MB
    })
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          migratePayload = parsed
        }
      } catch {
        // 格式不对就当没收到
      }
      res.writeHead(204, { 'access-control-allow-origin': '*' }).end()
    })
    return true
  }

  res.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
  })
  res.end(JSON.stringify(migratePayload || {}))
  return true
}

// ---------------------------------------------------------------------------
// 设置里的 DeepSeek Key（只在本机保存，不经过任何第三方；前端永远拿不到完整 Key）
// ---------------------------------------------------------------------------
function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
      if (body.length > limit) req.destroy()
    })
    req.on('end', () => resolve(body))
    req.on('error', () => resolve(''))
  })
}

/** 调一次最小的 chat/completions，验证 Key 能不能用 */
function testKey(key) {
  return new Promise((resolve) => {
    const payload = JSON.stringify({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 1,
      stream: false,
    })
    const request = httpsRequest(
      {
        hostname: 'api.deepseek.com',
        path: '/chat/completions',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
          authorization: `Bearer ${key}`,
        },
        timeout: 15000,
      },
      (upstream) => {
        let text = ''
        upstream.on('data', (chunk) => {
          text += chunk
        })
        upstream.on('end', () => {
          if (upstream.statusCode === 200) {
            resolve({ ok: true, message: '连接正常' })
            return
          }
          let message = `HTTP ${upstream.statusCode}`
          try {
            const parsed = JSON.parse(text)
            if (parsed?.error?.message) message = parsed.error.message
          } catch {
            // 保留状态码
          }
          resolve({ ok: false, message })
        })
      },
    )
    request.on('timeout', () => {
      request.destroy()
      resolve({ ok: false, message: '连接超时（15 秒）' })
    })
    request.on('error', (error) => resolve({ ok: false, message: '网络错误：' + error.message }))
    request.write(payload)
    request.end()
  })
}

async function handleKeyApi(req, res, pathname) {
  if (!pathname.startsWith('/api/key')) return false

  if (pathname === '/api/key' && req.method === 'GET') {
    sendJson(res, 200, keyStatus())
    return true
  }

  if (pathname === '/api/key' && req.method === 'POST') {
    const body = await readBody(req)
    let key = ''
    try {
      key = String(JSON.parse(body || '{}').key || '').trim()
    } catch {
      sendJson(res, 400, { error: { message: '请求格式不对' } })
      return true
    }
    if (!KEY_PATTERN.test(key)) {
      sendJson(res, 400, { error: { message: 'Key 格式不对（应该以 sk- 开头，后面是字母数字）' } })
      return true
    }
    const tested = await testKey(key)
    if (!tested.ok) {
      sendJson(res, 400, { error: { message: '这个 Key 用不了：' + tested.message } })
      return true
    }
    writeStoredKey(key)
    sendJson(res, 200, { ok: true, ...keyStatus() })
    return true
  }

  if (pathname === '/api/key' && req.method === 'DELETE') {
    clearStoredKey()
    sendJson(res, 200, { ok: true, ...keyStatus() })
    return true
  }

  if (pathname === '/api/key/test' && req.method === 'POST') {
    const key = readApiKey()
    if (!key) {
      sendJson(res, 200, { ok: false, message: '还没有配置 Key' })
      return true
    }
    sendJson(res, 200, await testKey(key))
    return true
  }

  sendJson(res, 404, { error: { message: 'not found' } })
  return true
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${HOST}:${PORT}`)
    if (url.pathname.startsWith('/api/deepseek')) {
      proxyDeepSeek(req, res)
      return
    }
    if (handleMigrate(req, res, url.pathname)) return
    if (await handleKeyApi(req, res, url.pathname)) return

    const decoded = decodeURIComponent(url.pathname)
    const candidate = resolve(DIST, `.${decoded}`)
    // 防目录穿越：解析后的路径必须还在 dist 里
    if (!candidate.startsWith(DIST + sep) && candidate !== DIST) {
      res.writeHead(403).end('403')
      return
    }

    if (existsSync(candidate) && statSync(candidate).isFile()) {
      serveFile(req, res, candidate)
      return
    }

    // 带扩展名却没找到 → 真 404，不要回 index.html（否则 Pyodide 加载失败会变成白屏 HTML）
    if (extname(decoded)) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404 Not Found')
      return
    }

    const index = resolve(DIST, 'index.html')
    if (!existsSync(index)) {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' }).end(
        '没有找到 app/dist，请先在 app 目录执行 npm run build（或运行 launcher\\build.ps1）。',
      )
      return
    }
    serveFile(req, res, index)
  } catch (error) {
    if (!res.headersSent) {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(`500 ${error.message}`)
    }
  }
})

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    // 端口被占用通常意味着「训练台已经在跑」（或 dev server 在跑），直接复用即可
    console.log(`端口 ${PORT} 已被占用，直接复用现有服务`)
    process.exit(0)
  }
  console.error(`服务启动失败：${error.message}`)
  process.exit(1)
})

server.listen(PORT, HOST, () => {
  console.log(`LeetCode 训练台已就绪 http://${HOST}:${PORT}`)
  console.log(`静态目录：${DIST}`)
})
