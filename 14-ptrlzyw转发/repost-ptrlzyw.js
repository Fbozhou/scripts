// repost-ptrlzyw-fixed.js
//
// 网络拓扑：
//   浏览器
//     -> http://172.20.79.225:19105        （Nginx 对内入口）
//     -> http://10.161.133.190:8080        （本 Node 服务）
//     -> https://ptrlzyw.putian.gov.cn     （公网目标站）
//
// 设计原则：
// 1. 普通页面 / API / 图片 / 字体等全部让 http-proxy-middleware 原生流式转发；
// 2. 不再使用 selfHandleResponse 接管所有响应，避免页面一直 Pending；
// 3. 只单独抓取 JS/MJS 文件并替换其中写死的公网域名；
// 4. 302 Location、Origin/Referer、Cookie 做必要重写。

const express = require('express')
const axios = require('axios')
const { createProxyMiddleware } = require('http-proxy-middleware')

let HPM_VERSION = 'unknown'
try {
  HPM_VERSION = require('http-proxy-middleware/package.json').version || 'unknown'
} catch (_) {}
const HPM_MAJOR = Number.parseInt(String(HPM_VERSION).split('.')[0], 10) || 2
const https = require('https')

// Node 实际监听：10.161.133.190:8080
const PORT = Number(process.env.PORT || 8080)

// Node 出口访问的公网目标站
const TARGET_ORIGIN = 'https://ptrlzyw.putian.gov.cn'
const TARGET_HOST = new URL(TARGET_ORIGIN).host

// 浏览器真正看到、真正访问的地址（Nginx 对外暴露地址）
const PUBLIC_PROXY_ORIGIN = (
  process.env.PROXY_BASE_URL || 'http://172.20.79.225:19105'
).replace(/\/$/, '')

const TIMEOUT = 1000 * 60 * 30

const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 50,
  maxFreeSockets: 20,
  rejectUnauthorized: false,
})

const app = express()
app.disable('x-powered-by')

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const targetAbsoluteRe = new RegExp(escapeRegExp(TARGET_ORIGIN), 'gi')
const targetProtocolRelativeRe = new RegExp(
  `//${escapeRegExp(TARGET_HOST)}`,
  'gi'
)
const targetEscapedRe = new RegExp(
  escapeRegExp(TARGET_ORIGIN.replace(/\//g, '\\/')),
  'gi'
)
const targetEncodedRe = new RegExp(
  escapeRegExp(encodeURIComponent(TARGET_ORIGIN)),
  'gi'
)

function rewritePublicUrl(text) {
  if (typeof text !== 'string' || !text) return text

  return text
    // https://ptrlzyw.putian.gov.cn/xxx
    .replace(targetAbsoluteRe, PUBLIC_PROXY_ORIGIN)
    // https:\/\/ptrlzyw.putian.gov.cn\/xxx
    .replace(
      targetEscapedRe,
      PUBLIC_PROXY_ORIGIN.replace(/\//g, '\\/')
    )
    // https%3A%2F%2Fptrlzyw.putian.gov.cn
    .replace(targetEncodedRe, encodeURIComponent(PUBLIC_PROXY_ORIGIN))
    // //ptrlzyw.putian.gov.cn/xxx
    .replace(targetProtocolRelativeRe, PUBLIC_PROXY_ORIGIN)
}

function rewriteReferer(value) {
  if (!value) return `${TARGET_ORIGIN}/`

  const text = String(value)
  const publicRe = new RegExp(`^${escapeRegExp(PUBLIC_PROXY_ORIGIN)}`, 'i')

  if (publicRe.test(text)) {
    return text.replace(publicRe, TARGET_ORIGIN)
  }

  // 如果 Nginx/浏览器带来的是别的内网 Host，也不要把内网 Referer 发给公网。
  try {
    const parsed = new URL(text)
    if (parsed.hostname === '172.20.79.225' || parsed.hostname === '10.161.133.190') {
      return `${TARGET_ORIGIN}${parsed.pathname}${parsed.search}`
    }
  } catch (_) {}

  return text
}

function rewriteSetCookie(cookie) {
  if (!cookie) return cookie

  let value = String(cookie)

  // 公网 Domain 无法用于 172.20.79.225，删掉后成为当前代理 host-only cookie。
  value = value.replace(/;\s*Domain=[^;]+/gi, '')

  // 浏览器侧入口目前是 HTTP，普通 Secure Cookie 无法回传。
  value = value.replace(/;\s*Secure(?=;|$)/gi, '')

  // SameSite=None 通常要求 Secure；代理后 API 已经同源，改成 Lax。
  value = value.replace(/;\s*SameSite=None/gi, '; SameSite=Lax')

  return value
}

function copyRewriteResponseHeaders(headers, res) {
  const skip = new Set([
    'content-length',
    'content-encoding',
    'transfer-encoding',
    'connection',
    'keep-alive',
    'strict-transport-security',
  ])

  Object.entries(headers || {}).forEach(([key, rawValue]) => {
    if (rawValue == null) return

    const lower = key.toLowerCase()
    if (skip.has(lower)) return

    if (lower === 'set-cookie') {
      const cookies = Array.isArray(rawValue) ? rawValue : [rawValue]
      res.setHeader('set-cookie', cookies.map(rewriteSetCookie))
      return
    }

    let value = rawValue

    if (
      typeof value === 'string' &&
      [
        'location',
        'content-location',
        'refresh',
        'link',
        'content-security-policy',
        'content-security-policy-report-only',
        'access-control-allow-origin',
      ].includes(lower)
    ) {
      value = rewritePublicUrl(value)
    }

    try {
      res.setHeader(key, value)
    } catch (err) {
      console.warn(`忽略响应头 ${key}: ${err.message}`)
    }
  })
}

// -----------------------------------------------------------------------------
// 只拦截前端打包 JS。
// 这是本次真正需要改正文的地方：把写死的公网 API host 改成 172.20.79.225:19105。
// 其它请求全部交给下面的通用 proxy 原生流式处理。
// -----------------------------------------------------------------------------
const jsCache = new Map()
const JS_CACHE_TTL = 1000 * 60 * 2

app.get(/\.(?:js|mjs)$/i, async (req, res) => {
  const reqPath = req.originalUrl

  try {
    const cached = jsCache.get(reqPath)
    if (cached && Date.now() - cached.ts < JS_CACHE_TTL) {
      res.status(cached.status)
      Object.entries(cached.headers).forEach(([k, v]) => res.setHeader(k, v))
      return res.end(cached.body)
    }

    const upstreamUrl = `${TARGET_ORIGIN}${reqPath}`
    console.log(`JS ↗ ${upstreamUrl}`)

    const upstream = await axios.get(upstreamUrl, {
      httpsAgent,
      responseType: 'arraybuffer',
      timeout: 30000,
      maxRedirects: 5,
      validateStatus: () => true,
      headers: {
        'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0',
        Accept: req.headers.accept || '*/*',
        'Accept-Language': req.headers['accept-language'] || 'zh-CN,zh;q=0.9',
        'Accept-Encoding': 'identity',
        Host: TARGET_HOST,
        Referer: rewriteReferer(req.headers.referer),
        ...(req.headers.cookie ? { Cookie: req.headers.cookie } : {}),
      },
    })

    const status = upstream.status || 200

    // 304 等无正文状态直接结束。
    if (status === 204 || status === 304) {
      copyRewriteResponseHeaders(upstream.headers, res)
      return res.status(status).end()
    }

    let text = Buffer.from(upstream.data || []).toString('utf8')
    const originalText = text
    text = rewritePublicUrl(text)

    if (text !== originalText) {
      console.log(
        `JS ✓ ${reqPath}：${TARGET_ORIGIN} -> ${PUBLIC_PROXY_ORIGIN}`
      )
    } else {
      console.log(`JS · ${reqPath}：未发现公网域名`)
    }

    // JS 是我们自己重新生成的正文，不能沿用上游 content-length/content-encoding。
    const headers = {}
    Object.entries(upstream.headers || {}).forEach(([key, value]) => {
      const lower = key.toLowerCase()
      if (
        value == null ||
        [
          'content-length',
          'content-encoding',
          'transfer-encoding',
          'connection',
          'keep-alive',
          'strict-transport-security',
          'set-cookie',
        ].includes(lower)
      ) {
        return
      }
      headers[key] = value
    })

    headers['content-type'] =
      upstream.headers['content-type'] || 'application/javascript; charset=utf-8'
    // 调试阶段避免浏览器一直拿旧 bundle。
    headers['cache-control'] = 'no-store'

    const body = Buffer.from(text, 'utf8')

    jsCache.set(reqPath, {
      ts: Date.now(),
      status,
      headers,
      body,
    })

    res.status(status)
    Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v))
    return res.end(body)
  } catch (err) {
    console.error(`JS rewrite error ${reqPath}:`, err.message)
    return res.status(502).send('Bad gateway (js rewrite error).')
  }
})

// -----------------------------------------------------------------------------
// 通用透明代理。
// 注意 selfHandleResponse=false：让库自己 pipe，不再手工接管响应流。
// -----------------------------------------------------------------------------
const handleProxyReq = (proxyReq, req) => {
  console.log(`→ ${req.method} ${req.originalUrl}`)

  proxyReq.setHeader('Host', TARGET_HOST)
  proxyReq.setHeader('X-Forwarded-Proto', 'https')

  if (req.headers['user-agent']) {
    proxyReq.setHeader('User-Agent', req.headers['user-agent'])
  }

  // 浏览器访问的是内网 HTTP，但公网接口如果校验 Origin，需要看到公网 origin。
  if (req.headers.origin) {
    proxyReq.setHeader('Origin', TARGET_ORIGIN)
  }

  proxyReq.setHeader('Referer', rewriteReferer(req.headers.referer))
}

const handleProxyRes = (proxyRes, req) => {
  console.log(
    `← ${proxyRes.statusCode || 0} ${req.method} ${req.originalUrl}` +
      (proxyRes.headers.location
        ? `  Location: ${proxyRes.headers.location}`
        : '')
  )

  // 只修改 proxyRes.headers，让 http-proxy-middleware 后续照常把响应流 pipe 给浏览器。
  delete proxyRes.headers['strict-transport-security']

  if (proxyRes.headers.location) {
    proxyRes.headers.location = rewritePublicUrl(proxyRes.headers.location)
  }

  if (proxyRes.headers['content-location']) {
    proxyRes.headers['content-location'] = rewritePublicUrl(
      proxyRes.headers['content-location']
    )
  }

  if (proxyRes.headers['access-control-allow-origin']) {
    proxyRes.headers['access-control-allow-origin'] = rewritePublicUrl(
      proxyRes.headers['access-control-allow-origin']
    )
  }

  if (proxyRes.headers['content-security-policy']) {
    proxyRes.headers['content-security-policy'] = rewritePublicUrl(
      proxyRes.headers['content-security-policy']
    )
  }

  if (proxyRes.headers['set-cookie']) {
    const cookies = Array.isArray(proxyRes.headers['set-cookie'])
      ? proxyRes.headers['set-cookie']
      : [proxyRes.headers['set-cookie']]
    proxyRes.headers['set-cookie'] = cookies.map(rewriteSetCookie)
  }
}

const handleProxyError = (err, req, res) => {
  console.error(`Proxy error ${req.method} ${req.originalUrl}:`, err.message)

  if (!res.headersSent) {
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' })
  }
  res.end('Bad gateway (proxy error).')
}

const proxyOptions = {
  target: TARGET_ORIGIN,
  agent: httpsAgent,
  changeOrigin: true,
  secure: false,
  ws: true,
  timeout: TIMEOUT,
  proxyTimeout: TIMEOUT,
  selfHandleResponse: false,
  logLevel: 'info',
}

// http-proxy-middleware 3.x 改用了 on: { proxyReq, proxyRes, error }；
// 2.x 仍使用 onProxyReq/onProxyRes/onError。根据当前安装版本自动选择。
if (HPM_MAJOR >= 3) {
  proxyOptions.on = {
    proxyReq: handleProxyReq,
    proxyRes: handleProxyRes,
    error: handleProxyError,
  }
} else {
  proxyOptions.onProxyReq = handleProxyReq
  proxyOptions.onProxyRes = handleProxyRes
  proxyOptions.onError = handleProxyError
}

app.use('/', createProxyMiddleware(proxyOptions))

app.listen(PORT, '0.0.0.0', () => {
  console.log('------------------------------------------------------------')
  console.log(`http-proxy-middleware: ${HPM_VERSION} (major ${HPM_MAJOR})`)
  console.log(`Node listening : http://0.0.0.0:${PORT}`)
  console.log(`Node server    : http://10.161.133.190:${PORT}`)
  console.log(`Browser entry  : ${PUBLIC_PROXY_ORIGIN}`)
  console.log(`Upstream       : ${TARGET_ORIGIN}`)
  console.log('------------------------------------------------------------')
})
