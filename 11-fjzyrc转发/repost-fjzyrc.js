// proxy-server.js （已改造版）
const express = require('express')
const { createProxyMiddleware } = require('http-proxy-middleware')
const http = require('http')
const https = require('https')
const axios = require('axios')

const PORT = 8081
const targetHost = 'https://sj.fjzyrc.com' // 目标公网 https 地址
const serverurl = 'http://172.20.79.225:18081' // 你内网 proxy 可见地址（备用/默认）
const OUTER_PREFIX = '/srsj/ptscyrcdt' // 可选默认值（你也可以用环境变量或留空）

// agents
const keepAliveHttpAgent = new http.Agent({ keepAlive: true, maxSockets: 50, maxFreeSockets: 20 })
const keepAliveHttpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 50,
  maxFreeSockets: 20,
  rejectUnauthorized: false,
})

const app = express()

// 全局入站日志（用于调试）
app.use((req, res, next) => {
  console.log('INCOMING:', req.method, req.originalUrl, 'path:', req.path, 'host:', req.headers.host,
    'xfp:', req.headers['x-forwarded-prefix'], 'xfproto:', req.headers['x-forwarded-proto'])
  next()
})

// helper
function escapeForRegex(s) { return s.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&') }

// detectPrefix：优先读取 nginx 透传头，再 fallback 到 OUTER_PREFIX 或 env 强制前缀
function detectPrefix(req) {
  // 1. nginx 明确透传的 header（优先）
  const xfp = (req.headers['x-forwarded-prefix'] || req.headers['x-forwarded-prefix'.toLowerCase()]) || ''
  if (xfp) return xfp

  // 2. 启动时强制前缀（临时回退）
  if (process.env.OUTER_PREFIX_FORCE) return process.env.OUTER_PREFIX_FORCE

  // 3. 如果你本身在配置里有 OUTER_PREFIX，尝试通过原始 URL 判断（仅当 nginx 未剥掉路径时）
  if (OUTER_PREFIX) {
    const url = (req.originalUrl || req.url || '').trim()
    if (url === OUTER_PREFIX) return OUTER_PREFIX
    if (url.startsWith(OUTER_PREFIX + '/')) return OUTER_PREFIX
  }

  // 4. 最后尝试 referer/origin 判断（弱判定）
  const ref = (req.headers.referer || req.headers.referrer || '').trim()
  const origin = (req.headers.origin || '').trim()
  if (ref && OUTER_PREFIX && ref.includes(OUTER_PREFIX)) return OUTER_PREFIX
  if (origin && OUTER_PREFIX && origin.includes(OUTER_PREFIX)) return OUTER_PREFIX

  return ''
}

// 简易内存缓存（可按需关闭）
const jsCache = new Map()
const CACHE_TTL = 1000 * 60 * 5 // 5 分钟

// 更鲁棒的 assets 拦截：使用通配路由，内部判断是否为我们关心的资源
app.get('*', async (req, res, next) => {
  try {
    // 只处理 putian-dp 下可能返回 HTML 的请求，且浏览器期望 HTML（Accept 包含 text/html）
    const accept = (req.headers.accept || '')
    const urlPath = (req.originalUrl || req.url || '').split('?')[0]

    if (!urlPath.startsWith('/putian-dp') || !accept.includes('text/html')) {
      return next()
    }

    console.log('↗ html handler hit', urlPath)

    // matchedPrefix 优先读取 nginx 透传 header，否则用 OUTER_PREFIX env 或空
    const matchedPrefix = (req.headers['x-forwarded-prefix'] || process.env.OUTER_PREFIX_FORCE || '').replace(/\/$/, '')
    // upstreamPath: 如果 nginx 已经剥掉前缀（常见），直接用 urlPath；否则如果 upstreamPath 包含前缀可剥掉
    let upstreamPath = urlPath
    if (matchedPrefix && upstreamPath.startsWith(matchedPrefix)) {
      upstreamPath = upstreamPath.slice(matchedPrefix.length) || '/'
    }

    const upstreamUrl = `${targetHost.replace(/\/$/, '')}${upstreamPath}${req.url.includes('?') ? '?' + req.url.split('?').slice(1).join('?') : ''}`
    console.log('↗ fetch upstream HTML', upstreamUrl)

    const upstreamRes = await axios.get(upstreamUrl, {
      httpsAgent: keepAliveHttpsAgent,
      headers: {
        'Accept-Encoding': 'identity',
        'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0',
        'Host': new URL(targetHost).host,
      },
      responseType: 'arraybuffer',
      timeout: 20000,
      validateStatus: s => s >= 200 && s < 400,
    })

    const raw = Buffer.from(upstreamRes.data || []).toString('utf8')
    // 构造 clientBase（用 nginx 透传的 proto + host，fallback 到 serverurl）
    const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim()
    const clientHost = req.headers.host || (new URL(serverurl).host)
    const clientBase = `${proto}://${clientHost}${matchedPrefix || ''}`.replace(/\/$/, '')

    let body = raw
    // 1) 把上游的绝对域名替换为 clientBase（和你 JS 那样）
    body = body.replace(/https?:\/\/sj\.fjzyrc\.com/gi, clientBase)

    // 2) 把以根路径开头的资源引用注入前缀（"'/putian-dp/..." 这种）
    if (matchedPrefix) {
      const mp = matchedPrefix.replace(/\/$/, '')
      // 替换 src="/putian-dp/... 或 href="/putian-dp/...
      body = body.replace(/(["'`])\/(putian-dp\/|assets\/|static\/)/g, (m, q, p) => {
        return q + mp + '/' + p
      })
      // 注入 <base>（帮助相对路径解析；放到 head 后面）
      const baseHref = `${mp.endsWith('/') ? mp : mp + '/'}`
      body = body.replace(/<head([^>]*)>/i, (m, g1) => `${m}<base href="${baseHref}">`)
    }

    // 3) 小修正：如果页面里存在 window.__PUBLIC_PATH__ 的用法，也可以注入（可选）
    if (matchedPrefix) {
      const publicPathScript = `<script>window.__PUBLIC_PATH__='${matchedPrefix.endsWith('/')?matchedPrefix:matchedPrefix + '/'}';try{if(typeof __webpack_public_path__!=='undefined')__webpack_public_path__=window.__PUBLIC_PATH__;}catch(e){}</script>\n`
      body = body.replace(/<head([^>]*)>/i, (m) => m + publicPathScript)
    }

    // 返回给浏览器（保持 upstream content-type）
    res.status(200)
    res.setHeader('Content-Type', upstreamRes.headers['content-type'] || 'text/html; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache')
    return res.send(body)
  } catch (err) {
    console.error('html rewrite error', err && (err.message || err.toString()))
    return next() // 让后续 proxy 去处理（或返回 502）
  }
})

// 专门拦截 /putian-ht 的路由（保持你的实现）
app.get(['/putian-ht', '/putian-ht/'], async (req, res) => {
  try {
    const upstreamUrl = `${targetHost}/putian-ht`;
    console.log('↗ fetch upstream (follow redirects):', upstreamUrl);

    const upstream = await axios.get(upstreamUrl, {
      httpsAgent: keepAliveHttpsAgent,
      responseType: 'arraybuffer',
      maxRedirects: 5,
      headers: {
        'Accept-Encoding': 'identity',
        'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0',
        'Host': new URL(targetHost).host,
        'X-Forwarded-Proto': 'https',
        'Referer': req.headers.referer || ''
      },
      timeout: 20000,
      validateStatus: s => s >= 200 && s < 400
    });

    const contentType = (upstream.headers['content-type'] || '').toLowerCase();
    if (contentType.includes('text/html') || contentType.includes('javascript') || contentType.includes('json') || contentType.includes('text/')) {
      let body = Buffer.from(upstream.data || []).toString('utf8');
      // 这里也把上游 host 替换成 client 可见 base（使用 simpler serverurl 以防 header 不完整）
      const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim()
      const clientHost = req.headers.host || (new URL(serverurl).host)
      const matchedPrefix = detectPrefix(req) || ''
      const clientBase = `${proto}://${clientHost}${matchedPrefix || ''}`.replace(/\/$/, '')
      body = body.replace(/https?:\/\/sj\.fjzyrc\.com/gi, clientBase)

      res.status(200);
      res.setHeader('Content-Type', upstream.headers['content-type'] || 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      return res.send(body);
    } else {
      res.status(upstream.status || 200);
      if (upstream.headers['content-type']) res.setHeader('Content-Type', upstream.headers['content-type']);
      if (upstream.headers['content-length']) res.setHeader('Content-Length', upstream.headers['content-length']);
      return res.send(Buffer.from(upstream.data || []));
    }
  } catch (err) {
    console.error('Error fetching upstream /putian-ht (follow):', err && (err.message || err.toString()));
    return res.status(502).send('Bad gateway');
  }
});

// 通用 proxy（放在专门路由之后）
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
    if (proxyRes.headers && proxyRes.headers.location) {
      // 如果上游返回了 location（重定向），把其改为 client 可见的 base（尽量使用 header 信息）
      const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim()
      const clientHost = req.headers.host || (new URL(serverurl).host)
      const matchedPrefix = detectPrefix(req) || ''
      const clientBase = `${proto}://${clientHost}${matchedPrefix || ''}`.replace(/\/$/, '')
      const newLoc = proxyRes.headers.location.replace(/https?:\/\/sj\.fjzyrc\.com/gi, clientBase)
      proxyRes.headers.location = newLoc
      res.setHeader('Location', newLoc)
      console.log('🛠 rewrite Location ->', newLoc)
    }
    delete proxyRes.headers['strict-transport-security']
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

app.listen(PORT, () => {
  console.log(`Proxy listening: http://localhost:${PORT} -> ${targetHost}`)
})
