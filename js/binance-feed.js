(function (root) {
  const INTERVALS = ["1s", "1m", "5m", "15m", "1h", "4h", "1d", "1w"];

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

  let lastMeta = { source: "live", updatedAt: "" };

  function packI18n() {
    const lang = (typeof localStorage !== "undefined" && localStorage.getItem("quant_lang")) || "zh-Hant";
    return (root.I18N && (root.I18N[lang] || root.I18N["zh-Hant"])) || {};
  }

  async function fetchUrl(url, ms) {
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), ms || 8000) : null;
    try {
      const res = await fetch(url, ctrl ? { signal: ctrl.signal } : {});
      return res;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function snapshotBars(interval) {
    const off = root.QAOffline;
    if (!off) return [];
    lastMeta.source = "offline";
    lastMeta.updatedAt = off.updatedAt || "";
    return off.forInterval(interval);
  }

  async function fetchKlines(symbol, interval, limit) {
    const sym = String(symbol || "BTCUSDT").toUpperCase();
    const iv = INTERVALS.includes(interval) ? interval : "1m";
    const lim = Math.min(1000, Math.max(1, Number(limit) || 1000));
    const qs = `symbol=${encodeURIComponent(sym)}&interval=${encodeURIComponent(iv)}&limit=${lim}`;
    const urls = [
      `https://api.binance.com/api/v3/klines?${qs}`,
      (root.QUANT_CONFIG && root.QUANT_CONFIG.apiBase ? root.QUANT_CONFIG.apiBase : "") + `/api/klines?${qs}`,
    ];
    for (const url of urls) {
      if (!url.startsWith("http")) continue;
      try {
        const res = await fetchUrl(url, 8000);
        if (!res.ok) continue;
        const data = await res.json();
        const rows = Array.isArray(data) ? data : data.data;
        if (!Array.isArray(rows) || !rows.length) continue;
        lastMeta.source = "live";
        lastMeta.updatedAt = "";
        return rows.map(parseKlineRow);
      } catch {
        /* try next */
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
      reconnect: "warn",
      fail: "err",
      offline: "warn",
    };
    el.className = "feed-status " + (cls[state] || "warn");
    let text = p.feedReconnect || "↻ 正在重連";
    if (state === "connecting") text = p.feedConnecting || "◌ 連線中";
    if (state === "live") text = p.feedLive || "● 實時推流中";
    if (state === "rest") text = p.feedRest || "● REST 輪詢中";
    if (state === "retry") {
      const n = x.countdown != null ? x.countdown : "";
      text = (p.feedRetry || "↻ 重試中 {n}s").replace("{n}", String(n));
    }
    if (state === "fail") text = p.feedFail || "● 連線失敗";
    if (state === "offline") {
      const hm = x.updatedAt || lastMeta.updatedAt || "";
      text = (p.feedOffline || "⚠️ 離線演示數據（更新於 {t}）").replace("{t}", hm || "--:--");
    }
    el.textContent = text;
    const actions = document.getElementById("feedActions");
    if (actions) actions.hidden = !(state === "fail" || state === "offline");
  }

  function createSocket({ symbol, interval, onKline, onStatus, onGiveUp }) {
    const sym = String(symbol || "BTCUSDT").toLowerCase();
    const iv = INTERVALS.includes(interval) ? interval : "1m";
    const url = `wss://stream.binance.com:9443/ws/${sym}@kline_${iv}`;
    let ws = null;
    let closed = false;
    let handshake = null;
    let staleTimer = null;
    const fast = iv === "1s" || iv === "1m" || iv === "5m";

    function setStatus(s, extra) {
      if (onStatus) onStatus(s, extra);
    }

    function armStale() {
      if (staleTimer) clearTimeout(staleTimer);
      if (!fast) return;
      staleTimer = setTimeout(() => {
        if (!closed) reconnect();
      }, 90000);
    }

    function connect() {
      if (closed) return;
      setStatus("connecting");
      try {
        ws = new WebSocket(url);
      } catch {
        giveUp();
        return;
      }
      handshake = setTimeout(() => {
        if (closed) return;
        try {
          if (ws && ws.readyState !== 1) ws.close();
        } catch {
          /* */
        }
        giveUp();
      }, 3000);
      ws.onopen = () => {
        if (handshake) clearTimeout(handshake);
        handshake = null;
        setStatus("live");
        armStale();
      };
      ws.onmessage = (ev) => {
        armStale();
        try {
          const msg = JSON.parse(ev.data);
          const k = msg.k;
          if (!k) return;
          onKline({
            time: Math.floor(k.t / 1000),
            open: Number(k.o),
            high: Number(k.h),
            low: Number(k.l),
            close: Number(k.c),
            volume: Number(k.v),
            closed: Boolean(k.x),
          });
        } catch {
          /* ignore malformed tick */
        }
      };
      ws.onerror = () => {};
      ws.onclose = () => {
        if (handshake) clearTimeout(handshake);
        handshake = null;
        if (!closed) giveUp();
      };
    }

    function giveUp() {
      if (closed) return;
      closed = true;
      if (handshake) clearTimeout(handshake);
      if (staleTimer) clearTimeout(staleTimer);
      try {
        if (ws) ws.close();
      } catch {
        /* */
      }
      if (onGiveUp) onGiveUp();
    }

    function reconnect() {
      try {
        if (ws) ws.close();
      } catch {
        /* */
      }
    }

    connect();
    return {
      url,
      close() {
        closed = true;
        if (handshake) clearTimeout(handshake);
        if (staleTimer) clearTimeout(staleTimer);
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
    let restFails = 0;
    let tickSec = 3;

    function stopPoll() {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    }

    function goOffline() {
      if (onStatus) onStatus("offline", { updatedAt: lastMeta.updatedAt });
    }

    function startPoll() {
      if (closed || pollTimer) return;
      if (onStatus) onStatus("rest");
      const tick = async () => {
        if (closed) return;
        try {
          const rows = await fetchKlines(symbol, interval, 2);
          if (lastMeta.source === "offline") {
            restFails += 1;
            if (restFails >= 2) {
              goOffline();
              return;
            }
          } else {
            restFails = 0;
            const last = rows[rows.length - 1];
            if (last) onKline({ ...last, closed: false });
            if (onStatus) onStatus("rest");
          }
        } catch {
          restFails += 1;
          if (onStatus) onStatus("retry", { countdown: tickSec });
          if (restFails >= 3) {
            goOffline();
            stopPoll();
          }
        }
      };
      tick();
      pollTimer = setInterval(tick, tickSec * 1000);
    }

    if (preferRest || root.QAFeed.preferRest) {
      startPoll();
    } else {
      sock = createSocket({
        symbol,
        interval,
        onKline,
        onStatus,
        onGiveUp() {
          if (sock) {
            sock.close();
            sock = null;
          }
          startPoll();
        },
      });
    }

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
          return intra ? hmLocal(ts) : mdLocal(ts);
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
          return intra ? hmLocal(ts) : mdLocal(ts);
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
    fetchKlines,
    createSocket,
    createLiveStream,
    setFeedStatus,
    lastMeta,
    preferRest: false,
    chartOptions,
  };
})(typeof window !== "undefined" ? window : globalThis);
