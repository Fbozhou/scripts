// ==UserScript==
// @name              去广告&关键词屏蔽
// @name:zh           去广告&关键词屏蔽
// @namespace         Violentmonkey Scripts
// @match             *://*.weibo.com/*
// @match             *://*.weibo.cn/*
// @include           *://weibo.com/*
// @include           *://weibo.cn/*
// @exclude           *://weibo.com/tv*
// @grant             none
// @version           3.4
// @author            fbz
// @description       去除“全部关注”和“最新微博”列表中的广告&屏蔽包含设置的关键词的微博/用户
// @description:zh    去除“全部关注”和“最新微博”列表中的广告&屏蔽包含设置的关键词的微博/用户
// @require           https://unpkg.com/ajax-hook@2.0.3/dist/ajaxhook.js
// ==/UserScript==
/* jshint esversion: 6 */
;(function () {
  /*添加样式*/
  var css = `
    #add_ngList_btn {
      position: fixed;
      bottom: 2rem;
      left: 1rem;
      width: 2rem;
      height: 2rem;
      border-radius: 50%;
      border: 1px solid rgba(0, 0, 0, 0.5);
      background: white;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      z-index: 100;
    }

    #add_ngList_btn::before {
      content: '';
      position: absolute;
      width: 16px;
      height: 2px;
      background: rgba(0, 0, 0, 0.5);
      top: calc(50% - 1px);
      left: calc(50% - 8px);
    }

    #add_ngList_btn::after {
      content: '';
      position: absolute;
      height: 16px;
      width: 2px;
      background: rgba(0, 0, 0, 0.5);
      top: calc(50% - 8px);
      left: calc(50% - 1px);
    }
    
    .my-dialog__wrapper {
      position: fixed;
      top: 0;
      right: 0;
      bottom: 0;
      left: 0;
      overflow: auto;
      margin: 0;
      z-index: 10000;
      background: rgba(0, 0, 0, 0.3);
      display: none;
    }

    .my-dialog {
      position: relative;
      background: #FFFFFF;
      border-radius: 2px;
      box-shadow: 0 1px 3px rgb(0 0 0 / 30%);
      box-sizing: border-box;
      width: 50%;
      transform: none;
      left: 0;
      margin: 0 auto;
    }

    .my-dialog .my-dialog__header {
      border-bottom: 1px solid #e4e4e4;
      padding: 14px 16px 10px 16px;
    }

    .my-dialog__title {
      line-height: 24px;
      font-size: 18px;
      color: #303133;
    }

    .my-dialog__headerbtn {
      position: absolute;
      top: 20px;
      right: 20px;
      padding: 0;
      background: transparent;
      border: none;
      outline: none;
      cursor: pointer;
      font-size: 16px;
      width: 12px;
      height: 12px;
      transform: rotateZ(45deg);
    }

    .my-dialog .my-dialog__header .my-dialog__headerbtn {
      right: 16px;
      top: 16px;
    }

    .my-dialog__headerbtn .my-dialog__close::before {
      content: '';
      position: absolute;
      width: 12px;
      height: 1.5px;
      background: #909399;
      top: calc(50% - 0.75px);
      left: calc(50% - 6px);
      border-radius: 2px;
    }

    .my-dialog__headerbtn:hover .my-dialog__close::before {
      background: #1890ff;
    }

    .my-dialog__headerbtn .my-dialog__close::after {
      content: '';
      position: absolute;
      height: 12px;
      width: 1.5px;
      background: #909399;
      top: calc(50% - 6px);
      left: calc(50% - 0.75px);
      border-radius: 2px;
    }

    .my-dialog__headerbtn:hover .my-dialog__close::after {
      background: #1890ff;
    }

    .my-dialog__body {
      padding: 30px 20px;
      color: #606266;
      font-size: 14px;
      word-break: break-all;
    }

    .my-dialog__footer {
      padding: 20px;
      padding-top: 10px;
      text-align: right;
      box-sizing: border-box;
    }

    .my-dialog .my-dialog__footer {
      padding: 0px 16px 24px 16px;
      margin-top: 40px;
    }

    #ngList {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-start;
      max-height: 480px;
      overflow-y: scroll;
    }

    .close-icon {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      display: inline-block;
      position: relative;
      transform: rotateZ(45deg);
      margin-left: 8px;
      cursor: pointer;
    }

    .close-icon:hover {
      background: #409eff;
    }

    .close-icon::before {
      content: '';
      position: absolute;
      width: 8px;
      height: 2px;
      background: #409eff;
      top: calc(50% - 1px);
      left: calc(50% - 4px);
      border-radius: 2px;
    }

    .close-icon:hover::before {
      background: #fff;
    }

    .close-icon::after {
      content: '';
      position: absolute;
      height: 8px;
      width: 2px;
      background: #409eff;
      top: calc(50% - 4px);
      left: calc(50% - 1px);
      border-radius: 2px;
    }

    .close-icon:hover::after {
      background: #fff;
    }

    .ng_item {
      background-color: #ecf5ff;
      display: inline-flex;
      align-items: center;
      padding: 0 10px;
      font-size: 12px;
      color: #409eff;
      border: 1px solid #d9ecff;
      border-radius: 4px;
      box-sizing: border-box;
      white-space: nowrap;
      height: 28px;
      line-height: 26px;
      margin-left: 12px;
      margin-top: 8px;
    }


    .input_container {
      display: flex;
      align-items: center;
      margin-bottom: 12px;
    }

    .el-input {
      position: relative;
      font-size: 14px;
      display: inline-block;
      width: 100%;
    }

    .el-input__inner {
      -webkit-appearance: none;
      background-color: #fff;
      background-image: none;
      border-radius: 4px;
      border: 1px solid #dcdfe6;
      box-sizing: border-box;
      color: #606266;
      display: inline-block;
      font-size: inherit;
      height: 40px;
      line-height: 40px;
      outline: none;
      padding: 0 15px;
      transition: border-color .2s cubic-bezier(.645, .045, .355, 1);
      width: 100%;
      cursor: pointer;
      font-family: inherit;
    }

    .el-button {
      display: inline-block;
      line-height: 1;
      white-space: nowrap;
      cursor: pointer;
      background: #fff;
      border: 1px solid #dcdfe6;
      color: #606266;
      -webkit-appearance: none;
      text-align: center;
      box-sizing: border-box;
      outline: none;
      margin: 0;
      transition: .1s;
      font-weight: 500;
      -moz-user-select: none;
      -webkit-user-select: none;
      -ms-user-select: none;
      padding: 12px 20px;
      font-size: 14px;
      border-radius: 4px;
    }

    .el-button:focus,
    .el-button:hover {
      color: #409eff;
      border-color: #c6e2ff;
      background-color: #ecf5ff;
    }

    .el-button:active {
      color: #3a8ee6;
      border-color: #3a8ee6;
      outline: none;
    }

    .input_container .el-input {
      margin-right: 12px;
    }
    
    .tips {
      margin-top: 24px;
      font-size: 12px;
      color: #F56C6C;
    }
  `
  /*添加样式*/
  function addStyle(css) {
    if (!css) return
    var head = document.querySelector('head')
    var style = document.createElement('style')
    style.type = 'text/css'
    style.innerHTML = css
    head.appendChild(style)
  }

  /*dialog模板*/
  var dialog_temp = `
    <div class="my-dialog" style="margin-top: 15vh; width: 40%;">
      <div class="my-dialog__header">
        <span class="my-dialog__title">屏蔽词列表</span>
        <button type="button" aria-label="Close" class="my-dialog__headerbtn">
          <i class="my-dialog__close"></i>
        </button>
      </div>
      <div class="my-dialog__body">
        <div class="input_container">
          <div class="el-input">
            <input id="ngWord_input" class="el-input__inner" type="text" />
          </div>
          <button type="button" class="el-button" id="add_btn">
            <span>添加</span>
          </button>
        </div>
        <div id="ngList"></div>
        <p class="tips">注：1. 可过滤包含屏蔽词的用户&微博。 2. 关键词保存在本地的local storage中。 3. 更改关键词后刷新页面生效（不刷新页面的情况下，只有之后加载的微博才会生效）。</p>
      </div>
      <div class="my-dialog__footer"></div>
    </div>
  `
  /*按钮模板*/
  var btn_temp = `
    <span class="Configs_alink_2Yg6L" yawf-component-tag="woo-box">
      <div class="woo-box-flex woo-box-alignCenter woo-pop-item-main" role="button" tabindex="0" data-focus-visible="true" yawf-component-tag="woo-pop-item woo-box">
        屏蔽词设置
      </div>
    </span>
  `

  /*生成添加屏蔽关键词的按钮*/
  function createngListBtn() {
    var btn = document.createElement('div')
    btn.title = '添加屏蔽关键词'
    var span = document.createElement('span')
    span.innerText = ''
    btn.appendChild(span)
    btn.id = 'add_ngList_btn'
    document.body.appendChild(btn)

    /*初始化事件*/
    // 点击按钮展示弹窗
    btn.addEventListener('click', function () {
      showDialog()
    })
  }

  var NgListKey = 'NgList'

  var apiBlackList = ['/female_version.mp3', '/intake/v2/rum/events'] // 接口黑名单

  // 获取屏蔽词列表
  function getNgList() {
    return JSON.parse(localStorage.getItem(NgListKey))
  }

  // 设置屏蔽词值
  function setNgList(list) {
    return localStorage.setItem(NgListKey, JSON.stringify(list))
  }

  // 初始化屏蔽词
  function initNgList() {
    setNgList([])
  }

  // 初始化dialog
  function initDialog() {
    var wrapper = document.createElement('div')
    wrapper.classList.add('my-dialog__wrapper')
    wrapper.innerHTML = dialog_temp
    document.body.appendChild(wrapper)

    /*初始化事件*/
    document
      .querySelector('.my-dialog__headerbtn')
      .addEventListener('click', function () {
        // 关闭按钮点击事件
        hideDialog()
      })
    document.querySelector('#add_btn').addEventListener('click', function () {
      // 添加关键词按钮点击事件
      var ngWord_input = document.querySelector('#ngWord_input')

      if (ngWord_input && ngWord_input.value) {
        data.ngList = ngList.concat([ngWord_input.value.trim()])
        ngWord_input.value = ''
      }
    })
  }
  // 显示dialog
  function showDialog() {
    data.ngList = data.ngList
    document.querySelector('.my-dialog__wrapper').style.display = 'initial'
  }
  // 隐藏dialog
  function hideDialog() {
    document.querySelector('.my-dialog__wrapper').style.display = ''
  }

  // 把屏蔽词列表添加到弹窗中
  function setNgListToDom(list) {
    var nodeStr = ''
    for (var [i, item] of list.entries()) {
      nodeStr += `<span class="ng_item">${item}<i class="close-icon" data-index=${i}></i></span>`
    }
    var ngListNode = document.querySelector('#ngList')
    if (ngListNode) {
      ngListNode.innerHTML = nodeStr

      var onDel = (i) => {
        // 删除关键词
        var arr = [...data.ngList]
        arr.splice(i, 1)
        data.ngList = arr || []
      }
      var delBtnList = ngListNode.querySelectorAll('.close-icon')
      for (var [i, node] of delBtnList.entries()) {
        node.addEventListener('click', function (el) {
          onDel(Number(el.target.dataset.index))
        })
      }
    }
  }

  addStyle(css) // 添加样式
  createngListBtn() // 生成按钮
  initDialog() // 初始化弹窗

  var data = {
    ngList: [],
  }

  Object.defineProperty(data, 'ngList', {
    // 简易双向绑定
    get: function () {
      return ngList
    },
    set: function (value) {
      ngList = value || []
      setNgList(ngList)
      setNgListToDom(ngList)
    },
  })

  window.addEventListener('load', function () {
    // 屏蔽视频播放后的弱智三连语音
    appObserverInit()
  })

  // 创建观察器
  function appObserverInit() {
    const targetNode = document.getElementById('app')
    // 观察器的配置（需要观察什么变动）
    const config = {
      childList: true,
      subtree: true,
    }
    // 当观察到变动时执行的回调函数
    const callback = function (mutationsList, observer) {
      var audioList = document.querySelectorAll('.AfterPatch_bg_34rqc')
      for (var audio of audioList) {
        audio.remove()
        console.log('移除了弱智三连')
      }
    }

    // 创建一个观察器实例并传入回调函数
    const observer = new MutationObserver(callback)

    // 以上述配置开始观察目标节点
    observer.observe(targetNode, config)
  }

  var ngList = getNgList() // 屏蔽词列表
  if (!ngList) {
    initNgList()
    ngList = getNgList()
  }
  data.ngList = ngList

  ah.proxy({
    // 请求发起前进入
    onRequest: (config, handler) => {
      if (!apiBlackList.some((item) => config.url.toString().includes(item)))
        // 不在接口黑名单里的请求才放行
        handler.next(config)
    },
    // 请求发生错误时进入，比如超时；注意，不包括http状态码错误，如404仍然会认为请求成功
    onError: (err, handler) => {
      handler.next(err)
    },
    // 请求成功后进入
    onResponse: (response, handler) => {
      var url =
        typeof response.config.url === 'string' ? response.config.url : '' // 防止报错，部分接口这个url返回的是个对象
      var res = response.response
      if (url.includes('friends') && res) {
        res = JSON.parse(res)
        ngList = getNgList()

        if (url.includes('m.weibo.cn')) {
          //移动端m.weibo.cn
          res.data.statuses = res.data.statuses.reduce((acc, cur) => {
            // 仅保留已关注用户以及快转的微博
            if (cur.user.following || cur.screen_name_suffix_new) {
              var myText = cur.text // 本人推的内容

              var ngWordInMyText = ngList.some((word) => myText.includes(word)) // 原用户推文中是否含有屏蔽词

              if (ngWordInMyText) return acc

              if (cur.retweeted_status) {
                // 如果是转推，判断原博是否包含屏蔽关键词
                var oriText = cur.retweeted_status.text
                var ngWordInOriText = ngList.some((word) =>
                  oriText.includes(word)
                )

                if (ngWordInOriText) return acc
              }

              acc.push(cur)
            }
            return acc
          }, [])
        } else {
          //电脑端
          res.statuses = res.statuses.reduce((acc, cur) => {
            // 仅保留已关注用户以及快转的微博
            if (cur.user.following || cur.screen_name_suffix_new) {
              var myText = cur.text // 本人推的内容

              var ngWordInMyText = ngList.some(
                (word) =>
                  myText.includes(word) || cur.user?.screen_name?.includes(word)
              ) // 原用户推文 || 用户名中是否含有屏蔽词

              if (ngWordInMyText) return acc

              if (cur.retweeted_status) {
                // 如果是转推，判断原博是否包含屏蔽关键词
                var oriText = cur.retweeted_status.text
                var ngWordInOriText = ngList.some(
                  (word) =>
                    oriText.includes(word) ||
                    cur.retweeted_status?.user?.screen_name?.includes(word)
                ) // 转发者微博或者原微博包含关键词

                if (ngWordInOriText) return acc
              }

              acc.push(cur)
            }
            return acc
          }, [])
        }
        response.response = JSON.stringify(res)
      }

      handler.next(response)
    },
  })
})()
