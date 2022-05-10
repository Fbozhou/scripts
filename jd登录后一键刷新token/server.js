/*
 * @Description:
 * @Author: FBZ
 * @Date: 2022-05-10 11:14:53
 * @LastEditors: FBZ
 * @LastEditTime: 2022-05-10 15:40:34
 */
var express = require('express') // 项目服务端使用express框架
var app = express()
var path = require('path')
var fs = require('fs')

// 青龙环境变量目录
app.use(express.static(path.resolve(__dirname, './config')))

// 可以分别设置http、https的访问端口号
var PORT = 9110

app.get('/', (req, res) => res.send('Hello World!'))

app.post('/', (req, res) => {
  // post新建请求
  console.log('收到请求体:', req.body)
  res.status(200).send() // 设置请求成功状态码 201
})

app.post('/refresh-token', (req, res) => {
  // post新建请求
  console.log('收到请求体:', req)
  console.log('res:', res)
  res.status(200).send() // 设置请求成功状态码 201
})

// 创建http服务器
app.listen(PORT, function () {
  console.log('HTTP Server is running on: http://localhost:%s', PORT)
})
