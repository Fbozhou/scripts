const fs = require('fs')
const path = require('path')
const express = require('express')
const { createProxyMiddleware } = require('http-proxy-middleware')
const axios = require('axios')

const http = require('http')
const keepAliveAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 50, // 默认 Infinity
  maxFreeSockets: 20,
})

const app = express()
// 通用超时时间，单位：毫秒
const TIMEOUT = 1000 * 60 * 30
// const serverurl = 'http://10.161.133.190:8080'
const serverurl = 'http://172.20.79.225:19105'

// 本地文件目录
const localScriptsPath = path.join(__dirname, 'scripts')

// 提供本地静态文件服务
app.use('/scripts', express.static(localScriptsPath))

// 拦截 Vue.js 的 CDN 请求，替换为本地文件
app.use((req, res, next) => {
  if (req.url === '/npm/vue/dist/vue.js') {
    res.sendFile(path.join(localScriptsPath, 'vue.js'))
  } else {
    next()
  }
})

// 添加拦截并修改响应逻辑的中间件
app.use('/api/dashboard/api/getmarketvideo', async (req, res, next) => {
  try {
    // 构造目标请求的完整 URL
    const targetUrl = `http://ptdashboard.linggongbang.cn${req.originalUrl.replace(
      '/api',
      ''
    )}`

    // 发起请求获取目标接口的响应
    const response = await axios.get(targetUrl, { httpAgent: keepAliveAgent })

    // 修改响应体内容
    if (response.data && response.data.data) {
      response.data.data = response.data.data.replace(
        'https://lgb-apppush.oss-cn-beijing.aliyuncs.com',
        serverurl
      )
    }

    // 返回修改后的响应内容
    res.json(response.data)
  } catch (error) {
    console.error('Error intercepting getmarketvideo:', error.message)
    res.status(500).send('Internal Server Error')
  }
})

// 转发所有非特殊路由的请求到目标地址
app.use(
  '/api',
  createProxyMiddleware({
    target: 'http://ptdashboard.linggongbang.cn',
    agent: keepAliveAgent,
    changeOrigin: true,
    timeout: TIMEOUT, // 设置请求超时时间（单位：毫秒）
    proxyTimeout: TIMEOUT, // 设置代理超时时间（单位：毫秒）
    pathRewrite: {
      '^/api': '', // 去掉 /api 前缀
    },
    onProxyReq: (proxyReq, req) => {
      proxyReq.setHeader('Connection', 'keep-alive')
      proxyReq.setHeader(
        'User-Agent',
        req.headers['user-agent'] || 'Mozilla/5.0'
      )
      proxyReq.setHeader('Accept', '*/*')
      proxyReq.setHeader('Referer', req.headers.referer || serverurl)
    },
    onProxyRes: (proxyRes) => {
      console.log('api-proxyRes: ', proxyRes)
      proxyRes.headers['Access-Control-Allow-Origin'] = '*' // 添加 CORS 支持

      // 从proxyRes里删
      delete proxyRes.headers['server']

      // 从Express res对象上也删（一定要加）
      res.removeHeader('server')

      // 再把其他header覆盖回去
      Object.keys(proxyRes.headers).forEach(function (key) {
        res.setHeader(key, proxyRes.headers[key])
      })
    },
  })
)

// 确保 images 文件夹存在
const IMAGE_DIR = path.join(__dirname, 'images')
if (!fs.existsSync(IMAGE_DIR)) {
  fs.mkdirSync(IMAGE_DIR)
}

// 处理图片请求
app.use('/lgb/Upload/recruit', async (req, res) => {
  const fileName = path.basename(req.url) // 提取文件名
  const localFilePath = path.join(IMAGE_DIR, fileName)

  // 检查本地是否已存在文件
  if (fs.existsSync(localFilePath)) {
    console.log(`Serving cached image: ${fileName}`)
    return res.sendFile(localFilePath)
  }

  // 图片不存在，发起请求获取图片
  const originalUrl = `http://ptdashboard.linggongbang.cn/lgb/Upload/recruit${req.url}`
  try {
    // 第一次请求获取重定向地址
    const response = await axios.get(originalUrl, {
      maxRedirects: 0,
      validateStatus: (status) => status >= 200 && status < 400,
      httpAgent: keepAliveAgent,
    })

    const redirectUrl = response.headers.location // 获取重定向地址
    if (!redirectUrl) {
      return res.status(500).send('Failed to retrieve redirect URL.')
    }

    console.log(`Downloading image from: ${redirectUrl}`)

    // 第二次请求下载图片内容
    const imageResponse = await axios.get(redirectUrl, {
      responseType: 'stream', // 流式下载
      httpAgent: keepAliveAgent,
    })

    // 将图片保存到本地
    const writer = fs.createWriteStream(localFilePath)
    imageResponse.data.pipe(writer)

    writer.on('finish', () => {
      console.log(`Image saved: ${fileName}`)
      res.sendFile(localFilePath) // 返回本地图片
    })

    writer.on('error', (err) => {
      console.error('Error saving image:', err.message)
      res.status(500).send('Error saving image.')
    })
  } catch (error) {
    console.error('Error fetching or redirecting:', error.message)
    res.status(500).send('Error fetching or redirecting.')
  }
})

app.use('/images/putian/:filename', async (req, res) => {
  const filename = req.params.filename // 获取文件名
  const localPath = path.join(__dirname, 'images', 'putian', filename) // 本地文件路径

  // 检查本地是否有缓存文件
  if (fs.existsSync(localPath)) {
    console.log(`Serving cached video: ${localPath}`)
    res.sendFile(localPath) // 直接返回本地文件
    return
  }

  // 本地文件不存在，尝试从远程获取
  const remoteUrl = `http://lgb-apppush.oss-cn-beijing.aliyuncs.com/images/putian/${filename}`
  console.log(`Fetching video from remote URL: ${remoteUrl}`)

  try {
    // 获取视频流
    const response = await axios({
      method: 'get',
      url: remoteUrl,
      responseType: 'stream', // 获取流数据
    })

    // 创建本地目录（如果不存在）
    const localDir = path.dirname(localPath)
    if (!fs.existsSync(localDir)) {
      fs.mkdirSync(localDir, { recursive: true })
    }

    // 保存流到本地文件
    const writer = fs.createWriteStream(localPath)
    response.data.pipe(writer)

    // 监听完成事件后返回文件
    writer.on('finish', () => {
      console.log(`Video saved to: ${localPath}`)
      res.sendFile(localPath) // 返回本地文件
    })

    writer.on('error', (err) => {
      console.error(`Error saving video: ${err.message}`)
      res.status(500).send('Error saving video.')
    })
  } catch (error) {
    console.error(`Error fetching video: ${error.message}`)
    res.status(404).send('Video not found.')
  }
})

// 修改 `index.html`
app.get('/public/Dashboard/index.html', async (req, res) => {
  try {
    const targetUrl =
      'http://ptdashboard.linggongbang.cn/public/Dashboard/index.html'
    const response = await axios.get(targetUrl, { httpAgent: keepAliveAgent })
    let htmlContent = response.data

    // 替换静态资源地址
    htmlContent = htmlContent
      .replace(
        /https:\/\/cdn.jsdelivr.net\/npm\/vue\/dist\/vue\.js/g,
        `${serverurl}/npm/vue/dist/vue.js`
      )
      .replace(
        /https:\/\/unpkg.com\/element-ui\/lib\/index\.js/g,
        `${serverurl}/element-ui/lib/index.js`
      )
      .replace(
        /https:\/\/unpkg.com\/element-ui\/lib\/theme-chalk\/index\.css/g,
        `${serverurl}/element-ui/lib/theme-chalk/index.css`
      )

    res.set('Content-Type', 'text/html')
    res.send(htmlContent)
  } catch (error) {
    console.error('Error fetching index.html:', error.message)
    res.status(500).send('Internal Server Error')
  }
})

// 修改 `chart.js`
app.get('/public/Dashboard/js/chart.js', async (req, res) => {
  try {
    const targetUrl =
      'http://ptdashboard.linggongbang.cn/public/Dashboard/js/chart.js'
    const response = await axios.get(targetUrl, { httpAgent: keepAliveAgent })
    let jsContent = response.data

    // 替换内部接口地址
    jsContent = jsContent
      .replace(/http:\/\/ptdashboard\.linggongbang\.cn/g, `${serverurl}/api`)
      .replace(
        /http:\/\/ptdashboard\.linggongbang\.cn\/lgb/g,
        `${serverurl}/lgb`
      )

    res.set('Content-Type', 'application/javascript')
    res.send(jsContent)
  } catch (error) {
    console.error('Error fetching chart.js:', error.message)
    res.status(500).send('Internal Server Error')
  }
})

// 转发静态资源请求
/* app.use(
  '/npm',
  createProxyMiddleware({
    target: 'https://cdn.jsdelivr.net/npm',
    changeOrigin: true,
    timeout: TIMEOUT, // 设置请求超时时间（单位：毫秒）
    proxyTimeout: TIMEOUT, // 设置代理超时时间（单位：毫秒）
    pathRewrite: { '^/npm': '' },
  })
) */

app.use(
  '/element-ui',
  createProxyMiddleware({
    target: 'https://unpkg.com/element-ui',
    agent: keepAliveAgent,
    changeOrigin: true,
    timeout: TIMEOUT, // 设置请求超时时间（单位：毫秒）
    proxyTimeout: TIMEOUT, // 设置代理超时时间（单位：毫秒）
    pathRewrite: { '^/element-ui': '' },
  })
)
app.use(
  '/element-ui@2.15.14',
  createProxyMiddleware({
    target: 'https://unpkg.com/element-ui@2.15.14',
    agent: keepAliveAgent,
    changeOrigin: true,
    timeout: TIMEOUT, // 设置请求超时时间（单位：毫秒）
    proxyTimeout: TIMEOUT, // 设置代理超时时间（单位：毫秒）
    pathRewrite: { '^/element-ui@2.15.14': '' },
  })
)

// 默认将根路径转发到目标地址
app.use(
  '/',
  createProxyMiddleware({
    target: 'http://ptdashboard.linggongbang.cn',
    agent: keepAliveAgent,
    changeOrigin: true,
    timeout: TIMEOUT, // 设置请求超时时间（单位：毫秒）
    proxyTimeout: TIMEOUT, // 设置代理超时时间（单位：毫秒）
    onProxyReq: (proxyReq, req) => {
      proxyReq.setHeader('Connection', 'keep-alive')
      proxyReq.setHeader(
        'User-Agent',
        req.headers['user-agent'] || 'Mozilla/5.0'
      )
      proxyReq.setHeader('Accept', '*/*')
      proxyReq.setHeader('Referer', req.headers.referer || serverurl)
    },
    onProxyRes: (proxyRes) => {
      proxyRes.headers['Access-Control-Allow-Origin'] = '*'

      // 从proxyRes里删
      delete proxyRes.headers['server']

      // 从Express res对象上也删（一定要加）
      res.removeHeader('server')

      // 再把其他header覆盖回去
      Object.keys(proxyRes.headers).forEach(function (key) {
        res.setHeader(key, proxyRes.headers[key])
      })
    },
  })
)

// 启动服务
const PORT = 8080
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`)
})
