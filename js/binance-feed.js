(function (root) {
  const INTERVALS = ["1s", "1m", "5m", "15m", "1h", "4h", "1d", "1w"];
  const STALE_MS = 4000;
  const VENUES = ["Binance", "Binance-Vision", "OKX", "Bybit"];

  const OKX_BAR = { "1s": "1s", "1m": "1m", "5m": "5m", "15m": "15m", "1h": "1H", "4h": "4H", "1d": "1D", "1w": "1W" };
  const BYBIT_IV = { "1s": "1", "1m": "1", "5m": "5", "15m": "15", "1h": "60", "4h": "240", "1d": "D", "1w": "W" };

  let lastMeta = { source: "live", updatedAt: "", venue: "" };
  let startNode = 0;

  function packI18n() {
    const lang = (typeof localStorage !== "undefined" && localStorage.getItem("quant_lang")) || "zh-Hant";
    return (root.I18N && (root.I18N[lang] || root.I18N["zh-Hant"])) || {};
  }

  function parseKlineRow(row) {
    return {
      time: Math.floor(Number(row[0]) / 1000),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5]),
    };
  }

  function okxInst(sym) {
    const s = String(sym || "BTCUSDT").toUpperCase();
    if (s.includes("-")) return s;
    return s.replace(/USDT$/, "-USDT").replace(/USDC$/, "-USDC");
  }

  async function fetchUrl(url, ms) {
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), ms || 8000) : null;
    try {
      return await fetch(url, ctrl ? { signal: ctrl.signal } : {});
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function snapshotBars(interval) {
    const off = root.QAOffline;
    if (!off) return [];
    lastMeta.source = "offline";
    lastMeta.venue = "";
    lastMeta.updatedAt = off.updatedAt || "";
    return off.forInterval(interval);
  }

  async function restBinance(host, symbol, interval, limit) {
    const qs = `symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${limit}`;
    const res = await fetchUrl(`${host}/api/v3/klines?${qs}`, 8000);
    if (!res.ok) throw new Error("http");
    const data = await res.json();
    if (!Array.isArray(data) || !data.length) throw new Error("empty");
    return data.map(parseKlineRow);
  }

  async function restOkx(symbol, interval, limit) {
    const bar = OKX_BAR[interval] || "1m";
    const url = `https://www.okx.com/api/v5/market/candles?instId=${encodeURIComponent(okxInst(symbol))}&bar=${bar}&limit=${Math.min(300, limit)}`;
    const res = await fetchUrl(url, 8000);
    if (!res.ok) throw new Error("http");
    const data = await res.json();
    const rows = (data && data.data) || [];
    if (!rows.length) throw new Error("empty");
    return rows
      .slice()
      .reverse()
      .map((r) => ({
        time: Math.floor(Number(r[0]) / 1000),
        open: Number(r[1]),
        high: Number(r[2]),
        low: Number(r[3]),
        close: Number(r[4]),
        volume: Number(r[5]),
      }));
  }

  async function restBybit(symbol, interval, limit) {
    const iv = BYBIT_IV[interval] || "1";
    const url = `https://api.bybit.com/v5/market/kline?category=linear&symbol=${encodeURIComponent(symbol)}&interval=${iv}&limit=${Math.min(1000, limit)}`;
    const res = await fetchUrl(url, 8000);
    if (!res.ok) throw new Error("http");
    const data = await res.json();
    const rows = (data && data.result && data.result.list) || [];
    if (!rows.length) throw new Error("empty");
    return rows
      .slice()
      .reverse()
      .map((r) => ({
        time: Math.floor(Number(r[0]) / 1000),
        open: Number(r[1]),
        high: Number(r[2]),
        low: Number(r[3]),
        close: Number(r[4]),
        volume: Number(r[5]),
      }));
  }

  async function fetchKlines(symbol, interval, limit) {
    const sym = String(symbol || "BTCUSDT").toUpperCase();
    const iv = INTERVALS.includes(interval) ? interval : "1m";
    const lim = Math.min(1000, Math.max(1, Number(limit) || 1000));
    const apiBase = (root.QUANT_CONFIG && root.QUANT_CONFIG.apiBase) || "";
    const tries = [
      { venue: "Binance", run: () => restBinance("https://api.binance.com", sym, iv, lim) },
      { venue: "Binance-Vision", run: () => restBinance("https://data-api.binance.vision", sym, iv, lim) },
      { venue: "Worker", run: () => restBinance(apiBase, sym, iv, lim) },
      { venue: "OKX", run: () => restOkx(sym, iv, lim) },
      { venue: "Bybit", run: () => restBybit(sym, iv, lim) },
    ];
    for (const item of tries) {
      if (item.venue === "Worker" && !String(apiBase).startsWith("http")) continue;
      try {
        const rows = await item.run();
        if (rows && rows.length) {
          lastMeta.source = "live";
          lastMeta.venue = item.venue;
          lastMeta.updatedAt = "";
          return rows;
        }
      } catch {
        /* next venue */
      }
    }
    const snap = snapshotBars(iv);
    if (snap.length) return snap;
    throw new Error("klines failed");
  }

  function setFeedStatus(el, state, extra) {
    if (!el) return;
    const p = packI18n();
    const x = extra || {};
    const cls = {
      connecting: "wait",
      live: "live",
      rest: "live",
      retry: "warn",
      switch: "warn",
      reconnect: "warn",
      fail: "err",
      offline: "warn",
    };
    el.className = "feed-status " + (cls[state] || "warn");
    const v = x.venue || lastMeta.venue || "";
    let text = p.feedReconnect || "↻ 正在重連";
    if (state === "connecting") text = (p.feedConnectingSrc || "◌ 連線中 [{v}]").replace("{v}", v);
    if (state === "live") text = (p.feedLiveSrc || "● 實時推流中 [{v}]").replace("{v}", v);
    if (state === "rest") text = (p.feedRestSrc || "● REST 輪詢中 [{v}]").replace("{v}", v);
    if (state === "switch") text = (p.feedSwitch || "↻ 切換節點至 [{v}]...").replace("{v}", v);
    if (state === "retry") text = (p.feedRetry || "↻ 重試中 {n}s").replace("{n}", String(x.countdown != null ? x.countdown : ""));
    if (state === "fail") text = p.feedFail || "● 連線失敗";
    if (state === "offline") {
      text = (p.feedOffline || "⚠️ 離線演示數據（更新於 {t}）").replace("{t}", x.updatedAt || lastMeta.updatedAt || "--:--");
    }
    el.textContent = text;
    const actions = document.getElementById("feedActions");
    if (actions) actions.hidden = !(state === "fail" || state === "offline");
  }

  function barFromBinanceK(k) {
    return {
      time: Math.floor(k.t / 1000),
      open: Number(k.o),
      high: Number(k.h),
      low: Number(k.l),
      close: Number(k.c),
      volume: Number(k.v),
      closed: Boolean(k.x),
    };
  }

  function connectVenue({ venue, symbol, interval, onKline, onStatus, onGiveUp }) {
    const iv = INTERVALS.includes(interval) ? interval : "1m";
    const sym = String(symbol || "BTCUSDT");
    let ws = null;
    let closed = false;
    let stale = null;
    let ping = null;

    function die() {
      if (closed) return;
      closed = true;
      if (stale) clearTimeout(stale);
      if (ping) clearInterval(ping);
      try {
        if (ws) ws.close();
      } catch {
        /* */
      }
      if (onGiveUp) onGiveUp();
    }

    function touch() {
      if (stale) clearTimeout(stale);
      stale = setTimeout(die, STALE_MS);
    }

    function emit(bar) {
      lastMeta.venue = venue;
      lastMeta.source = "live";
      if (onStatus) onStatus("live", { venue });
      onKline(bar);
      touch();
    }

    if (onStatus) onStatus("connecting", { venue });

    try {
      if (venue === "Binance") {
        ws = new WebSocket(`wss://stream.binance.com:9443/ws/${sym.toLowerCase()}@kline_${iv}`);
      } else if (venue === "Binance-Vision") {
        ws = new WebSocket(`wss://data-stream.binance.vision/ws/${sym.toLowerCase()}@kline_${iv}`);
      } else if (venue === "OKX") {
        ws = new WebSocket("wss://ws.okx.com:8443/ws/v5/business");
      } else {
        ws = new WebSocket("wss://stream.bybit.com/v5/public/linear");
      }
    } catch {
      die();
      return { close: die };
    }

    ws.onopen = () => {
      touch();
      if (venue === "OKX") {
        ws.send(JSON.stringify({ op: "subscribe", args: [{ channel: "candle" + (OKX_BAR[iv] || "1m"), instId: okxInst(sym) }] }));
        ping = setInterval(() => {
          try {
            ws.send("ping");
          } catch {
            /* */
          }
        }, 15000);
      }
      if (venue === "Bybit") {
        ws.send(JSON.stringify({ op: "subscribe", args: [`kline.${BYBIT_IV[iv] || "1"}.${sym.toUpperCase()}`] }));
        ping = setInterval(() => {
          try {
            ws.send(JSON.stringify({ op: "ping" }));
          } catch {
            /* */
          }
        }, 15000);
      }
    };

    ws.onmessage = (ev) => {
      try {
        if (typeof ev.data === "string" && ev.data === "pong") {
          touch();
          return;
        }
        const msg = JSON.parse(ev.data);
        if (venue === "Binance" || venue === "Binance-Vision") {
          if (msg.k) emit(barFromBinanceK(msg.k));
          return;
        }
        if (venue === "OKX") {
          const row = msg.data && msg.data[0];
          if (!row) {
            touch();
            return;
          }
          emit({
            time: Math.floor(Number(row[0]) / 1000),
            open: Number(row[1]),
            high: Number(row[2]),
            low: Number(row[3]),
            close: Number(row[4]),
            volume: Number(row[5]),
            closed: String(row[8]) === "1",
          });
          return;
        }
        const k = msg.data && msg.data[0];
        if (k) {
          emit({
            time: Math.floor(Number(k.start) / 1000),
            open: Number(k.open),
            high: Number(k.high),
            low: Number(k.low),
            close: Number(k.close),
            volume: Number(k.volume),
            closed: Boolean(k.confirm),
          });
        } else touch();
      } catch {
        touch();
      }
    };
    ws.onerror = () => {};
    ws.onclose = () => {
      if (!closed) die();
    };
    stale = setTimeout(die, STALE_MS);

    return {
      close() {
        closed = true;
        if (stale) clearTimeout(stale);
        if (ping) clearInterval(ping);
        try {
          if (ws) ws.close();
        } catch {
          /* */
        }
      },
    };
  }

  function createLiveStream({ symbol, interval, onKline, onStatus, preferRest }) {
    let sock = null;
    let pollTimer = null;
    let closed = false;
    let idx = startNode;
    let restFails = 0;

    function stopPoll() {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    }

    function startPoll() {
      if (closed || pollTimer) return;
      const tick = async () => {
        if (closed) return;
        try {
          const rows = await fetchKlines(symbol, interval, 2);
          if (lastMeta.source === "offline") {
            restFails += 1;
            if (onStatus) onStatus("offline", { updatedAt: lastMeta.updatedAt });
            if (restFails >= 2) stopPoll();
            return;
          }
          restFails = 0;
          const last = rows[rows.length - 1];
          if (last) onKline({ ...last, closed: false });
          if (onStatus) onStatus("rest", { venue: lastMeta.venue });
        } catch {
          restFails += 1;
          if (onStatus) onStatus("retry", { countdown: 3 });
          if (restFails >= 4 && onStatus) onStatus("offline", { updatedAt: lastMeta.updatedAt });
        }
      };
      tick();
      pollTimer = setInterval(tick, 3000);
    }

    function nextWs() {
      if (closed) return;
      if (sock) {
        sock.close();
        sock = null;
      }
      if (idx >= VENUES.length) {
        startPoll();
        return;
      }
      const venue = VENUES[idx];
      idx += 1;
      if (onStatus) onStatus("switch", { venue });
      sock = connectVenue({
        venue,
        symbol,
        interval,
        onKline,
        onStatus,
        onGiveUp: nextWs,
      });
    }

    if (preferRest || root.QAFeed.preferRest) startPoll();
    else nextWs();

    return {
      close() {
        closed = true;
        stopPoll();
        if (sock) sock.close();
      },
    };
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function unixOf(time) {
    if (typeof time === "number") return time;
    if (time && time.year) return Math.floor(Date.UTC(time.year, time.month - 1, time.day) / 1000);
    return 0;
  }

  function hmLocal(ts) {
    const d = new Date(ts * 1000);
    return pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  }

  function mdLocal(ts) {
    const d = new Date(ts * 1000);
    return pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  function mdHmLocal(ts) {
    const date = new Date(ts * 1000);
    const m = (date.getMonth() + 1).toString().padStart(2, "0");
    const d = date.getDate().toString().padStart(2, "0");
    const h = date.getHours().toString().padStart(2, "0");
    const min = date.getMinutes().toString().padStart(2, "0");
    return m + "-" + d + " " + h + ":" + min;
  }

  function isIntraday(interval) {
    return ["1s", "1m", "5m", "15m", "1h", "4h"].includes(interval);
  }

  function chartOptions(el, height, interval) {
    const mobile = typeof window !== "undefined" && window.matchMedia("(max-width: 768px)").matches;
    const intra = isIntraday(interval || "1m");
    return {
      width: Math.max(el.clientWidth || 0, 280),
      height,
      layout: {
        background: { color: "#080b10" },
        backgroundColor: "#080b10",
        textColor: "#7d8b9a",
        fontSize: mobile ? 10 : 12,
      },
      grid: {
        vertLines: { visible: !mobile, color: "#141c28" },
        horzLines: { visible: true, color: mobile ? "#10151c" : "#141c28" },
      },
      rightPriceScale: { borderColor: "#1a2330", autoScale: true },
      localization: {
        dateFormat: "yyyy-MM-dd",
        timeFormatter: (time) => {
          const ts = unixOf(time);
          return intra ? mdHmLocal(ts) : mdLocal(ts);
        },
      },
      timeScale: {
        borderColor: "#1a2330",
        timeVisible: intra,
        secondsVisible: false,
        fixLeftEdge: true,
        fixRightEdge: true,
        rightBarStaysOnScroll: true,
        lockVisibleTimeRangeOnResize: true,
        tickMarkFormatter: (time) => {
          const ts = unixOf(time);
          return intra ? mdHmLocal(ts) : mdLocal(ts);
        },
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
      handleScale: {
        axisPressedMouseMove: true,
        pinch: true,
      },
      kineticScroll: { touch: true, mouse: false },
      attributionLogo: !mobile,
    };
  }

  root.QAFeed = {
    INTERVALS,
    VENUES,
    fetchKlines,
    createLiveStream,
    setFeedStatus,
    lastMeta,
    preferRest: false,
    chartOptions,
    nextNode() {
      startNode = (startNode + 1) % VENUES.length;
    },
  };
  root.UniversalFeedManager = root.QAFeed;
})(typeof window !== "undefined" ? window : globalThis);
