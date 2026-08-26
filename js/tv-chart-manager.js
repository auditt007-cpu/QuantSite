/* ========================================================= */
/* [LOCKED MODULE: TRADINGVIEW CHART ENGINE]                 */
/* DO NOT MODIFY OR RE-INITIALIZE DURING OTHER FEATURE EDITS */
/* ========================================================= */
(function (root) {
  "use strict";

  var CONTAINER_ID = "tv_chart_container";
  var widget = null;
  var currentSymbol = null;
  var currentInterval = null;
  var scriptPromise = null;

  function toTvSymbol(raw) {
    var s = String(raw || "BTCUSDT").trim().toUpperCase();
    if (!s) s = "BTCUSDT";
    if (s.indexOf(":") >= 0) return s;
    if (s.indexOf("USDT") < 0) s = s + "USDT";
    return "BINANCE:" + s;
  }

  function toTvInterval(iv) {
    var map = {
      "1m": "1",
      "3m": "3",
      "5m": "5",
      "15m": "15",
      "30m": "30",
      "1h": "60",
      "2h": "120",
      "4h": "240",
      "1d": "D",
      "1w": "W",
    };
    var key = String(iv || "1m").toLowerCase();
    return map[key] || "1";
  }

  function containerEl() {
    return document.getElementById(CONTAINER_ID);
  }

  function destroyWidget() {
    var el = containerEl();
    widget = null;
    currentSymbol = null;
    currentInterval = null;
    if (el) el.innerHTML = "";
  }

  function ensureScript() {
    if (root.TradingView && typeof root.TradingView.widget === "function") {
      return Promise.resolve();
    }
    if (scriptPromise) return scriptPromise;
    scriptPromise = new Promise(function (resolve, reject) {
      var existing = document.querySelector('script[data-tv-script="1"]');
      if (existing) {
        if (root.TradingView && typeof root.TradingView.widget === "function") {
          resolve();
          return;
        }
        existing.addEventListener("load", function () {
          return root.TradingView ? resolve() : reject(new Error("TradingView unavailable"));
        });
        existing.addEventListener("error", function () {
          reject(new Error("TradingView script failed"));
        });
        return;
      }
      var s = document.createElement("script");
      s.src = "https://s3.tradingview.com/tv.js";
      s.async = true;
      s.setAttribute("data-tv-script", "1");
      s.onload = function () {
        if (root.TradingView && root.TradingView.widget) resolve();
        else reject(new Error("TradingView widget missing"));
      };
      s.onerror = function () {
        reject(new Error("TradingView script load error"));
      };
      document.head.appendChild(s);
    });
    return scriptPromise;
  }

  function localeForPage() {
    var lang = (document.documentElement && document.documentElement.lang) || "zh-Hant";
    if (lang === "zh-CN" || lang === "zh-Hans") return "zh_CN";
    return "zh_TW";
  }

  function buildWidget(symbol, interval) {
    var el = containerEl();
    if (!el) throw new Error("Missing #" + CONTAINER_ID);
    el.innerHTML = "";
    var h = Math.max(el.clientHeight || 0, 560);
    el.style.width = "100%";
    el.style.height = h + "px";
    el.style.minHeight = h + "px";
    widget = new root.TradingView.widget({
      autosize: true,
      width: "100%",
      height: h,
      symbol: symbol,
      interval: interval,
      timezone: "Asia/Shanghai",
      theme: "light",
      style: "1",
      locale: localeForPage(),
      enable_publishing: false,
      allow_symbol_change: false,
      hide_side_toolbar: true,
      hide_top_toolbar: false,
      withdateranges: false,
      save_image: false,
      container_id: CONTAINER_ID,
      studies: [],
      disabled_features: ["header_symbol_search", "symbol_search_hot_key"],
    });
    return widget;
  }

  function load(symbol, interval) {
    var tvSym = toTvSymbol(symbol);
    var tvInt = toTvInterval(interval || "1m");
    if (widget && currentSymbol === tvSym && currentInterval === tvInt) {
      return Promise.resolve(widget);
    }
    return ensureScript().then(function () {
      if (widget && currentSymbol === tvSym && currentInterval === tvInt) return widget;
      destroyWidget();
      currentSymbol = tvSym;
      currentInterval = tvInt;
      return buildWidget(tvSym, tvInt);
    });
  }

  root.TVChartManager = {
    load: load,
    destroy: destroyWidget,
    toTvSymbol: toTvSymbol,
    toTvInterval: toTvInterval,
  };
})(window);
/* ========================================================= */
/* [END LOCKED MODULE: TRADINGVIEW CHART ENGINE]             */
/* ========================================================= */
