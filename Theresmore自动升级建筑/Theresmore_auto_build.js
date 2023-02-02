// ==UserScript==
// @name        Theresmore自动升级建筑
// @namespace   Theresmore自动升级建筑
// @match       https://theresmoregame.g8hh.com/
// @grant       none
// @version     1.6
// @author      fbz
// @description 自动升级建筑，需要开在建造的tab页
// @license     MIT
// ==/UserScript==
;(function () {
  const timeout = 1000 * 10 //10秒点一次

  let blackList = initBlackList() // 部分只能建造一个的建筑需要跳过
  const houseList = ['房屋', '市政厅', '宅邸'] // 会减少食物的建筑
  function initBlackList() {
    return ['雕像', '神殿']
  }
  var css = `
    #auto_update_btn {
      position: fixed;
      right: 0;
      bottom: 64px;
      background: #1d1e20;
      border-radius: 50%;
      height: 32px;
      width: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
      font-size: 14px;
      border: 2px solid white;
      z-index: 100;
      color: white;
      cursor: pointer;
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

  /*生成自动升级建筑的按钮*/
  function createBtn() {
    var btn = document.createElement('div')
    btn.title = '开'
    var span = document.createElement('span')
    span.innerText = '开'
    btn.appendChild(span)
    btn.id = 'auto_update_btn'
    document.body.appendChild(btn)

    /*初始化事件*/
    // 点击按钮启动定时器
    btn.addEventListener('click', function () {
      toggleBtnStatus()
      toggleBtnText()
    })
  }

  // 切换文字
  function toggleBtnText() {
    const node = document.querySelector('#auto_update_btn')
    const text = node.innerText
    node.innerText = text === '开' ? '关' : '开'
  }

  // 自动升级建筑
  function autoClickBuilding() {
    closeDialog()
    const tabListNode = document.querySelector(`div[role=tablist]`)
    const tabNode = tabListNode.childNodes[0]
    const flag = tabNode && tabNode.getAttribute('aria-selected') === 'true'
    if (!flag) {
      console.log('没找到容器，即将切换到“建筑”页')
      // 自动切换到建造tab页
      tabNode && tabNode.click()
    } else {
      const id = tabNode.getAttribute('aria-controls')
      const list = document.getElementById(id).querySelectorAll(`button.btn`)
      judgeFood() // 食物小于3时不建造房屋
      console.log('寻找可建造物')
      for (const node of list) {
        if (
          !node.classList.value.includes('btn-off') &&
          !blackList.some((word) => node.textContent.includes(word))
        ) {
          console.log(`${new Date().toLocaleString()}升级：`, node.textContent)
          node.click()
          break
        }
      }
    }
  }
  let buildingInterval = null

  // 开启自动升级建筑定时器
  function handleAutoUpdateStart() {
    buildingInterval = setInterval(autoClickBuilding, timeout)
  }
  // 清除自动升级建筑定时器
  function handleAutoUpdateClear() {
    buildingInterval = clearInterval(buildingInterval)
  }
  // 切换自动升级建筑定时器状态
  function toggleBtnStatus() {
    if (buildingInterval) {
      console.log('~~~~关闭定时器~~~~')
      handleAutoUpdateClear()
    } else {
      console.log('~~~~开启定时器~~~~')
      handleAutoUpdateStart()
    }
  }
  // 判断食物数量
  function judgeFood() {
    var list = document.querySelector('table').querySelectorAll('tr')
    for (var node of list) {
      if (!node.innerText.includes('食物')) continue
      // 获取食物数量
      var val = Number(node.childNodes[2].innerText.split('/')[0])
      if (val < 3) {
        blackList.push(...houseList)
      } else {
        blackList = initBlackList()
      }
    }
  }
  // 关闭dialog
  function closeDialog() {
    const dialogNode = document.querySelector('#headlessui-portal-root')
    dialogNode && dialogNode.querySelector('.sr-only').parentNode.click()
  }

  createBtn()
  addStyle(css)
})()
