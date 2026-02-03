// proxy-server.js — 把它直接替换你的现有文件（注意变量）
const express = require('express')
const { createProxyMiddleware } = require('http-proxy-middleware')
const http = require('http')
const https = require('https')
const axios = require('axios')

const PORT = 8081
const targetHost = 'https://sj.fjzyrc.com' // 目标公网 https 地址
// const serverurl = `http://10.161.133.190:${PORT}`
// const serverurl = 'http://172.20.79.225:18081'
const serverurl = 'https://172.20.79.226:10443'

// agents
const keepAliveHttpAgent = new http.Agent({ keepAlive: true, maxSockets: 50, maxFreeSockets: 20 })
const keepAliveHttpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 50,
  maxFreeSockets: 20,
  rejectUnauthorized: false, // 视情况而定（测试环境可用）
})

const app = express()

// --- 你已有的 assets js rewrite 路由 （保留） ---
const jsCache = new Map()
const CACHE_TTL = 1000 * 60 * 5

app.get(/^\/putian-dp\/assets\/.*\.js$/, async (req, res) => {
  try {
    const reqPath = req.originalUrl
    const cached = jsCache.get(reqPath)
    if (cached && (Date.now() - cached.ts) < CACHE_TTL) {
      res.set(cached.headers)
      return res.send(cached.content)
    }

    const targetUrl = `${targetHost}${reqPath}`
    const upstreamRes = await axios.get(targetUrl, {
      httpsAgent: keepAliveHttpsAgent,
      headers: {
        'Accept-Encoding': 'identity',
        'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0',
      },
      responseType: 'arraybuffer',
      timeout: 30000,
      validateStatus: s => s >= 200 && s < 400
    })

    const text = Buffer.from(upstreamRes.data).toString('utf8')
    const escapeForRegex = (s) => s.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')
    const fromRe = new RegExp(escapeForRegex(targetHost), 'g')
    const replaced = text.replace(fromRe, serverurl)
    console.log(`🚀 替换 ${targetUrl} 中的域名 -> ${serverurl}`)

    const headers = {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=60',
    }
    if (upstreamRes.headers['etag']) headers['ETag'] = upstreamRes.headers['etag']
    if (upstreamRes.headers['last-modified']) headers['Last-Modified'] = upstreamRes.headers['last-modified']

    jsCache.set(reqPath, { ts: Date.now(), content: replaced, headers })

    res.set(headers)
    res.send(replaced)
  } catch (err) {
    console.error('proxy js rewrite error', err && (err.message || err.toString()))
    if (err.response && err.response.status === 404) return res.status(404).send('Not found')
    return res.status(502).send('Bad gateway (js fetch/rewrite error)')
  }
})

// --- 专门拦截 /putian-ht 的路由（必须放在 proxy 前） ---
app.get(['/putian-ht', '/putian-ht/'], async (req, res) => {
  try {
    const upstreamUrl = `${targetHost}/putian-ht`;
    console.log('↗ fetch upstream (follow redirects):', upstreamUrl);

    // 在服务端直接跟随重定向（maxRedirects>0），拿到最终资源
    const upstream = await axios.get(upstreamUrl, {
      httpsAgent: keepAliveHttpsAgent,
      responseType: 'arraybuffer',   // 原始 buffer，避免编码问题
      maxRedirects: 5,               // 跟随上游重定向，避免把 3xx 返给浏览器
      headers: {
        'Accept-Encoding': 'identity', // 请求原文，避免 br/gzip 等压缩
        'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0',
        'Host': new URL(targetHost).host,
        'X-Forwarded-Proto': 'https',
        'Referer': req.headers.referer || ''
      },
      timeout: 20000,
      validateStatus: s => s >= 200 && s < 400
    });

    // upstream now should be final response (likely 200)
    const contentType = (upstream.headers['content-type'] || '').toLowerCase();

    // 解码为文本（假设文本为 utf-8；若是 binary（图片等），直接转发即可）
    if (contentType.includes('text/html') || contentType.includes('javascript') || contentType.includes('json') || contentType.includes('text/')) {
      let body = Buffer.from(upstream.data || []).toString('utf8');
      // 全文替换目标 host -> proxy url（慎用全局替换，但对 SPA 常用）
      body = body.replace(/https?:\/\/sj\.fjzyrc\.com/gi, serverurl);

      // 返回给浏览器最终的页面（200）
      res.status(200);
      res.setHeader('Content-Type', upstream.headers['content-type'] || 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      return res.send(body);
    } else {
      // 非文本（比如图片/二进制），直接透传内容与 headers
      res.status(upstream.status || 200);
      // 复制安全的 headers 回去
      if (upstream.headers['content-type']) res.setHeader('Content-Type', upstream.headers['content-type']);
      if (upstream.headers['content-length']) res.setHeader('Content-Length', upstream.headers['content-length']);
      return res.send(Buffer.from(upstream.data || []));
    }
  } catch (err) {
    console.error('Error fetching upstream /putian-ht (follow):', err && (err.message || err.toString()));

    // 如果上游返回 4xx/5xx 或其他问题，作为回退，可尝试把上游的 3xx 改写后返回（不推荐）
    // 这里直接返回 502
    return res.status(502).send('Bad gateway');
  }
});

// --- 通用 proxy（放在专门路由之后） ---
app.use('/', createProxyMiddleware({
  target: targetHost,
  agent: keepAliveHttpsAgent,
  changeOrigin: true,
  secure: false,
  timeout: 1000 * 60 * 30,
  proxyTimeout: 1000 * 60 * 30,
  onProxyReq: (proxyReq, req, res) => {
    console.log('🚀 onProxyReq ->', req.originalUrl)
    proxyReq.setHeader('Connection', 'keep-alive')
    proxyReq.setHeader('User-Agent', req.headers['user-agent'] || 'Mozilla/5.0')
    proxyReq.setHeader('Accept', '*/*')
    proxyReq.setHeader('Referer', req.headers.referer || serverurl)
    proxyReq.setHeader('Accept-Encoding', 'identity')
    proxyReq.setHeader('Host', new URL(targetHost).host)
    proxyReq.setHeader('X-Forwarded-Proto', 'https')
    if (req.headers.cookie) proxyReq.setHeader('Cookie', req.headers.cookie)
  },
  onProxyRes: (proxyRes, req, res) => {
    console.log('🛰 onProxyRes status:', proxyRes.statusCode, 'location:', proxyRes.headers && proxyRes.headers.location)
    // 重写 Location，避免浏览器直接跳公网
    if (proxyRes.headers && proxyRes.headers.location) {
      const newLoc = proxyRes.headers.location.replace(/https?:\/\/sj\.fjzyrc\.com/gi, serverurl)
      proxyRes.headers.location = newLoc
      res.setHeader('Location', newLoc)
      console.log('🛠 rewrite Location ->', newLoc)
    }
    // 删除可能导致强制 https 的 header
    delete proxyRes.headers['strict-transport-security']
    // 透传其它 header
    Object.keys(proxyRes.headers || {}).forEach((key) => {
      if (key.toLowerCase() === 'content-length') return
      try { res.setHeader(key, proxyRes.headers[key]) } catch (e) {}
    })
  },
  onError: (err, req, res) => {
    console.error('Proxy error:', err && err.message)
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' })
    res.end('Bad gateway (proxy error).')
  },
  logLevel: 'info',
  selfHandleResponse: false,
}))

// 启动
app.listen(PORT, () => {
  console.log(`Proxy listening: http://localhost:${PORT} -> ${targetHost}`)
})
