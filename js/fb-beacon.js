/**
 * fb-beacon.js — Facebook Pixel 异步事件日志回传（前端信标）
 *
 * 功能：静默采集 _fbp / _fbc Cookie + User-Agent，
 *       通过 navigator.sendBeacon() 投递到中转接口，
 *       不阻塞页面加载、不处理任何回调响应。
 *
 * 零外部依赖，纯原生 JavaScript。
 */
(function () {
  "use strict";

  /* ── 配置 ─────────────────────────────────────────── */
  var COLLECT_URL = "https://my-api.com/collect";

  /* ── 工具函数 ─────────────────────────────────────── */

  /**
   * 读取指定名称的 Cookie 值
   * @param {string} name  Cookie 名称
   * @returns {string}     Cookie 值，未找到返回空字符串
   */
  function getCookie(name) {
    var match = document.cookie.match(
      new RegExp("(?:^|;\\s*)" + name.replace(/([.$?*|{}()\[\]\\\/\+^])/g, "\\$1") + "=([^;]*)")
    );
    return match ? decodeURIComponent(match[1]) : "";
  }

  /* ── 主逻辑 ──────────────────────────────────────── */

  function fireBeacon() {
    // 1. 静默获取 _fbp 和 _fbc cookie
    var fbp = getCookie("_fbp");
    var fbc = getCookie("_fbc");

    // 如果两个 cookie 都不存在，无需发送
    if (!fbp && !fbc) return;

    // 2. 获取 User-Agent
    var ua = navigator.userAgent || "";

    // 3. 组装 JSON 载荷
    var payload = {
      fbp: fbp,
      fbc: fbc,
      user_agent: ua,
      value: 299,
      timestamp: Date.now(),
    };

    // 4. 强制使用 navigator.sendBeacon() 投递
    //    不需要处理回调响应，不用 fetch / XHR
    if (typeof navigator.sendBeacon === "function") {
      var blob = new Blob([JSON.stringify(payload)], {
        type: "application/json",
      });
      navigator.sendBeacon(COLLECT_URL, blob);
    }
  }

  /* ── 触发时机 ────────────────────────────────────── */
  // 页面加载完成后静默触发，不阻塞渲染
  if (document.readyState === "complete") {
    fireBeacon();
  } else {
    window.addEventListener("load", fireBeacon, { once: true, passive: true });
  }
})();
