/*
 * @Description:
 * @Author: FBZ
 * @Date: 2025-01-09 11:27:36
 */
const express = require('express')
const httpProxy = require('http-proxy')

const app = express()
const proxy = httpProxy.createProxyServer()

// 使用正则匹配 URL 中的 IP 和端口部分
app.use('/dev-test/:target', (req, res) => {
  const target = req.params.target // 获取目标地址，例如 "10.96.17.104:9084"

  // 检查 target 格式并确保它是有效的 IP:port
  const targetPattern = /^(\d+\.\d+\.\d+\.\d+):(\d+)$/
  const match = target.match(targetPattern)
  if (match) {
    const ip = match[1]
    const port = match[2]
    const targetUrl = `http://${ip}:${port}`

    // 使用 http-proxy 转发请求
    proxy.web(req, res, { target: targetUrl })
  } else {
    res.status(400).send('Invalid target format')
  }
})

// 启动服务
app.listen(5000, () => {
  console.log('Proxy server running on port 5000')
})
