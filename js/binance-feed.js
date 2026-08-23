(function (root) {
  const INTERVALS = ["1s", "1m", "5m", "15m", "1h", "4h", "1d", "1w"];
  const STALE_MS = 4000;
  const ALL_VENUES = ["Binance", "Binance-Vision", "OKX", "Bybit", "Worker"];

  /** Mainland CN: OKX/Bybit first; Binance often blocked. TW: Binance first. */
  const VENUE_ORDER = {
    cn: ["OKX", "Bybit", "Worker", "Binance-Vision", "Binance"],
    tw: ["Binance", "Binance-Vision", "OKX", "Bybit", "Worker"],
    intl: ["Binance-Vision", "Binance", "OKX", "Bybit", "Worker"],
  };

  let lastMeta = { source: "live", updatedAt: "", venue: "" };
  let startNode = 0;

  function currentFeedPack() {
    if (root.QALang && typeof root.QALang.current === "function") return root.QALang.current();
    const lang =
      (typeof localStorage !== "undefined" && (localStorage.getItem("quant_lang") || localStorage.getItem("user_lang"))) ||
      "en";
    if (lang === "zh-Hans" || lang === "zh-CN" || lang === "zh-SG") return "zh-CN";
    if (lang === "zh-Hant" || lang === "zh-TW" || lang === "zh-HK" || lang === "zh-MO") return "zh-Hant";
    return "en";
  }

  function feedRegion() {
    const pack = currentFeedPack();
    if (pack === "zh-CN") return "cn";
    if (pack === "zh-Hant") return "tw";
    return "intl";
  }

  function orderedVenues() {
    const list = VENUE_ORDER[feedRegion()] || VENUE_ORDER.intl;
    return list.filter((v) => ALL_VENUES.includes(v));
  }

  function resetRegion() {
    startNode = 0;
  }

  const OKX_BAR = { "1s": "1s", "1m": "1m", "5m": "5m", "15m": "15m", "1h": "1H", "4h": "4H", "1d": "1D", "1w": "1W" };
  const BYBIT_IV = { "1s": "1", "1m": "1", "5m": "5", "15m": "15", "1h": "60", "4h": "240", "1d": "D", "1w": "W" };

  function restTryDefs(sym, iv, lim, endTime, apiBase) {
    return {
      OKX: { venue: "OKX", run: () => restOkx(sym, iv, lim) },
      Bybit: { venue: "Bybit", run: () => restBybit(sym, iv, lim) },
      Worker: { venue: "Worker", run: () => restWorker(apiBase, sym, iv, lim) },
      "Binance-Vision": {
        venue: "Binance-Vision",
        run: () => restBinance("https://data-api.binance.vision", sym, iv, lim, endTime),
      },
      Binance: { venue: "Binance", run: () => restBinance("https://api.binance.com", sym, iv, lim, endTime) },
    };
  }

  function buildRestTries(sym, iv, lim, endTime, apiBase) {
    const defs = restTryDefs(sym, iv, lim, endTime, apiBase);
    return orderedVenues()
      .map((venue) => defs[venue])
      .filter(Boolean);
  }

  function okxInstToSym(inst) {
    return String(inst || "").replace("-", "");
  }

  async function restTickerBinance(host, symbols) {
    const qs = encodeURIComponent(JSON.stringify(symbols));
    const res = await fetchUrl(`${host}/api/v3/ticker/24hr?symbols=${qs}`, 5000);
    if (!res.ok) throw new Error("http");
    const rows = await res.json();
    if (!Array.isArray(rows) || !rows.length) throw new Error("empty");
    return rows.map((r) => ({
      symbol: r.symbol,
      lastPrice: r.lastPrice,
      priceChangePercent: r.priceChangePercent,
    }));
  }

  async function restTickerOkx(symbols) {
    const want = new Set(symbols.map((s) => okxInst(s)));
    const res = await fetchUrl("https://www.okx.com/api/v5/market/tickers?instType=SPOT", 5000);
    if (!res.ok) throw new Error("http");
    const data = await res.json();
    const rows = (data && data.data) || [];
    const out = rows
      .filter((r) => want.has(r.instId))
      .map((r) => {
        const last = Number(r.last);
        const open = Number(r.open24h);
        const pct = open ? ((last - open) / open) * 100 : 0;
        return { symbol: okxInstToSym(r.instId), lastPrice: String(last), priceChangePercent: String(pct) };
      });
    if (!out.length) throw new Error("empty");
    return out;
  }

  async function restTickerBybit(symbols) {
    const want = new Set(symbols.map((s) => String(s).toUpperCase()));
    const res = await fetchUrl("https://api.bybit.com/v5/market/tickers?category=linear", 5000);
    if (!res.ok) throw new Error("http");
    const data = await res.json();
    const rows = (data && data.result && data.result.list) || [];
    const out = rows
      .filter((r) => want.has(r.symbol))
      .map((r) => ({
        symbol: r.symbol,
        lastPrice: r.lastPrice,
        priceChangePercent: String(Number(r.price24hPcnt) * 100),
      }));
    if (!out.length) throw new Error("empty");
    return out;
  }

  async function fetchTicker24h(symbols) {
    const syms = (Array.isArray(symbols) ? symbols : [symbols])
      .map((s) => String(s || "").toUpperCase())
      .filter(Boolean);
    if (!syms.length) return [];
    const apiBase = (root.QUANT_CONFIG && root.QUANT_CONFIG.apiBase) || "";
    const tries = {
      OKX: () => restTickerOkx(syms),
      Bybit: () => restTickerBybit(syms),
      Worker: async () => {
        const base = String(apiBase || "").replace(/\/$/, "");
        if (!base.startsWith("http")) throw new Error("skip");
        const qs = encodeURIComponent(JSON.stringify(syms));
        const res = await fetchUrl(`${base}/api/ticker/24hr?symbols=${qs}`, 5000);
        if (!res.ok) throw new Error("http");
        const rows = await res.json();
        if (!Array.isArray(rows) || !rows.length) throw new Error("empty");
        return rows;
      },
      "Binance-Vision": () => restTickerBinance("https://data-api.binance.vision", syms),
      Binance: () => restTickerBinance("https://api.binance.com", syms),
    };
    for (const venue of orderedVenues()) {
      const run = tries[venue];
      if (!run) continue;
      try {
        const rows = await run();
        if (rows && rows.length) {
          lastMeta.venue = venue;
          return rows;
        }
      } catch {
        /* next venue */
      }
    }
    return [];
  }

  function packI18n() {
    if (root.QALang && typeof root.QALang.current === "function") {
      const lang = root.QALang.current();
      return (root.I18N && (root.I18N[lang] || root.I18N.en || root.I18N["zh-Hant"])) || {};
    }
    const lang = (typeof localStorage !== "undefined" && (localStorage.getItem("quant_lang") || localStorage.getItem("user_lang"))) || "en";
    const mapped = lang === "zh-Hans" ? "zh-CN" : lang;
    return (root.I18N && (root.I18N[mapped] || root.I18N.en || root.I18N["zh-Hant"])) || {};
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
    const timer = ctrl ? setTimeout(() => ctrl.abort(), ms || 5000) : null;
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

  async function restBinance(host, symbol, interval, limit, endTime) {
    let qs = `symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${limit}`;
    if (endTime) qs += "&endTime=" + encodeURIComponent(String(endTime));
    const res = await fetchUrl(`${host}/api/v3/klines?${qs}`, 5000);
    if (!res.ok) throw new Error("http");
    const data = await res.json();
    if (!Array.isArray(data) || !data.length) throw new Error("empty");
    return data.map(parseKlineRow);
  }

  async function restOkx(symbol, interval, limit) {
    const bar = OKX_BAR[interval] || "1m";
    const url = `https://www.okx.com/api/v5/market/candles?instId=${encodeURIComponent(okxInst(symbol))}&bar=${bar}&limit=${Math.min(300, limit)}`;
    const res = await fetchUrl(url, 5000);
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
    const res = await fetchUrl(url, 5000);
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

  async function restWorker(apiBase, symbol, interval, limit) {
    const base = String(apiBase || "").replace(/\/$/, "");
    const url =
      `${base}/api/klines?symbol=${encodeURIComponent(symbol)}` +
      `&interval=${encodeURIComponent(interval)}&limit=${Math.min(1000, limit)}`;
    const res = await fetchUrl(url, 5000);
    if (!res.ok) throw new Error("http");
    const data = await res.json();
    if (!Array.isArray(data) || !data.length) throw new Error("empty");
    return data.map(parseKlineRow);
  }

  async function fetchKlines(symbol, interval, limit) {
    const sym = String(symbol || "BTCUSDT").toUpperCase();
    const iv = INTERVALS.includes(interval) ? interval : "1m";
    const need = Math.min(2000, Math.max(1, Number(limit) || 1000));
    const apiBase = (root.QUANT_CONFIG && root.QUANT_CONFIG.apiBase) || "";
    async function once(lim, endTime) {
      const tries = buildRestTries(sym, iv, lim, endTime, apiBase);
      for (const item of tries) {
        if (item.venue === "Worker" && !String(apiBase).startsWith("http")) continue;
        if ((item.venue === "OKX" || item.venue === "Bybit") && endTime) continue;
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
      return [];
    }
    let rows = await once(Math.min(1000, need), null);
    while (rows.length && rows.length < need) {
      const oldest = rows[0];
      const more = await once(Math.min(1000, need - rows.length), oldest.time * 1000 - 1);
      if (!more.length) break;
      const seen = new Set(rows.map((b) => b.time));
      const older = more.filter((b) => !seen.has(b.time));
      if (!older.length) break;
      rows = older.concat(rows);
    }
    if (rows.length) return rows;
    const snap = snapshotBars(iv);
    if (snap.length) return snap;
    throw new Error("klines failed");
  }

  function setFeedStatus(el, state, extra) {
    if (!el) return;
    const p = packI18n();
    const cls = {
      connecting: "wait",
      live: "live",
      rest: "live",
      retry: "err",
      switch: "err",
      reconnect: "err",
      fail: "err",
      offline: "err",
    };
    el.className = "feed-status " + (cls[state] || "warn");
    let text = p.feedRecon || "● 數據重連中";
    if (state === "live" || state === "rest") text = p.feedOk || "● 實時信號暢通";
    else if (state === "connecting") text = p.feedWait || "● 數據重連中";
    else text = p.feedRecon || "● 數據重連中";
    el.textContent = text;
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
    const venues = orderedVenues();
    let idx = Math.min(startNode, Math.max(venues.length - 1, 0));
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
      if (idx >= venues.length) {
        startPoll();
        return;
      }
      const venue = venues[idx];
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
        background: { color: "#ffffff" },
        backgroundColor: "#ffffff",
        textColor: "#000000",
        fontSize: mobile ? 10 : 12,
      },
      grid: {
        vertLines: { visible: !mobile, color: "#e2e8f0" },
        horzLines: { visible: true, color: "#e2e8f0" },
      },
      rightPriceScale: { borderColor: "#000000", autoScale: true },
      localization: {
        dateFormat: "yyyy-MM-dd",
        timeFormatter: (time) => {
          const ts = unixOf(time);
          return intra ? mdHmLocal(ts) : mdLocal(ts);
        },
      },
      timeScale: {
        borderColor: "#000000",
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

  if (typeof root.addEventListener === "function") {
    root.addEventListener("quant-lang", resetRegion);
  }

  root.QAFeed = {
    INTERVALS,
    ALL_VENUES,
    VENUE_ORDER,
    orderedVenues,
    feedRegion,
    resetRegion,
    fetchKlines,
    fetchTicker24h,
    createLiveStream,
    setFeedStatus,
    lastMeta,
    preferRest: false,
    chartOptions,
    nextNode() {
      const venues = orderedVenues();
      startNode = (startNode + 1) % Math.max(venues.length, 1);
    },
  };
  root.UniversalFeedManager = root.QAFeed;
})(typeof window !== "undefined" ? window : globalThis);
