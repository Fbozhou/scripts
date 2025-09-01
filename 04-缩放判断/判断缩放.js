function(e, i, t, n, o, a) {
  var s = {
      storageName: "zoomtip",
      storageVal: "1",
      storageTime: 604800,
      isPop: !1,
      init: function() {
        this.handleCookie(), this.pop(), i.on("mod.layout.screen.change", function(e) {
          s.detect() && s.pop()
        })
      },
      handleCookie: function() {
        t.get(this.storageName) && (t.remove(this.storageName), n.set(this.storageName, this.storageVal, this
          .storageTime))
      },
      detect: function() {
        return this.ua = navigator.userAgent.toLowerCase(), -1 == this.ua.indexOf("windows") ? !1 : !n.get(this
          .storageName)
      },
      cal: function() {
        // 最主要的应该就是这一段了 判断设备比 比例等
        // devicePixelRatio 我测试了下火狐和谷歌目前都支持了 100% 就是1 
        var e = 0,
          i = window.screen;
        return void 0 !== window.devicePixelRatio ? e = window.devicePixelRatio : ~this.ua.indexOf("msie") ? i
          .deviceXDPI && i.logicalXDPI && (e = i.deviceXDPI / i.logicalXDPI) : void 0 !== window.outerWidth &&
          void 0 !== window.innerWidth && (e = window.outerWidth / window.innerWidth), e && (e = Math.round(100 * e)),
          99 !== e && 101 !== e || (e = 100), e
      },
      resize: function() {
        var i = this.cal();
        if (this.isPop && i && 100 == i) return void this.close();
        var t = 540,
          n = 432,
          o = 100 * t / i,
          a = 100 * n / i;
        e(".pop-zoom-container").css({
          width: o + "px",
          height: a + "px",
          marginLeft: -o / 2 + "px",
          marginTop: -a / 2 + "px"
        })
      },
      pop: function() {
        var t = this.cal();
        if (!n.get(this.storageName) && !this.isPop && 100 !== t) {
          var a = o.get("sys.web_url") + "app/douyu/res/com/sg-zoom-error.png?20160823",
            s = ['<div class="pop-zoom-container">', '<div class="pop-zoom">', '<img class="pop-zoom-bg" src="', a,
              '">', '<div class="pop-zoom-close">close</div>', '<div class="pop-zoom-hide"></div>', "</div>", "</div>"
            ].join("");
          e("body").append(s), this.bindEvt(), this.isPop = !this.isPop, i.trigger("dys.com.zoom.pop.show")
        }
        this.resize()
      },
      close: function() {
        e(".pop-zoom-container").remove(), this.isPop = !this.isPop, i.trigger("dys.com.zoom.pop.close")
      },
      bindEvt: function() {
        var t = this;
        e(".pop-zoom-close").on("click", function() {
          t.close()
        }), e(".pop-zoom-hide").on("click", function() {
          n.set(t.storageName, t.storageVal, t.storageTime), i.trigger("dys.com.zoom.pop.zoomtip"), t.close()
        })
      }
    },
    r = function() {
      s.detect() && s.init()
    };
  e(r)
}
