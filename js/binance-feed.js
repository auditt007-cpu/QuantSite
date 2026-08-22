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

  async function fetchKlines(symbol, interval, limit) {
    const sym = String(symbol || "BTCUSDT").toUpperCase();
    const iv = INTERVALS.includes(interval) ? interval : "1m";
    const lim = Math.min(1000, Math.max(1, Number(limit) || 1000));
    const qs = `symbol=${encodeURIComponent(sym)}&interval=${encodeURIComponent(iv)}&limit=${lim}`;
    const urls = [
      `https://api.binance.com/api/v3/klines?${qs}`,
      (root.QUANT_CONFIG && root.QUANT_CONFIG.apiBase ? root.QUANT_CONFIG.apiBase : "") + `/api/klines?${qs}`,
    ];
    let lastErr = "klines failed";
    for (const url of urls) {
      if (!url.startsWith("http")) continue;
      try {
        const res = await fetch(url);
        if (!res.ok) {
          lastErr = "HTTP " + res.status;
          continue;
        }
        const data = await res.json();
        const rows = Array.isArray(data) ? data : data.data;
        if (!Array.isArray(rows) || !rows.length) {
          lastErr = "empty klines";
          continue;
        }
        return rows.map(parseKlineRow);
      } catch (e) {
        lastErr = e.message || String(e);
      }
    }
    throw new Error(lastErr);
  }

  function setFeedStatus(el, state) {
    if (!el) return;
    const live = state === "live";
    el.className = "feed-status " + (live ? "live" : "warn");
    el.textContent = live ? "● 實時推流中" : "↻ 正在重連";
  }

  function createSocket({ symbol, interval, onKline, onStatus, onGiveUp }) {
    const sym = String(symbol || "BTCUSDT").toLowerCase();
    const iv = INTERVALS.includes(interval) ? interval : "1m";
    const url = `wss://stream.binance.com:9443/ws/${sym}@kline_${iv}`;
    let ws = null;
    let closed = false;
    let delay = 800;
    let timer = null;
    let staleTimer = null;
    let fails = 0;
    const fast = iv === "1s" || iv === "1m" || iv === "5m";

    function setStatus(s) {
      if (onStatus) onStatus(s);
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
      setStatus("reconnect");
      try {
        ws = new WebSocket(url);
      } catch {
        fail();
        return;
      }
      ws.onopen = () => {
        fails = 0;
        delay = 800;
        setStatus("live");
        armStale();
      };
      ws.onmessage = (ev) => {
        armStale();
        fails = 0;
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
        if (!closed) fail();
      };
    }

    function fail() {
      if (closed) return;
      fails += 1;
      setStatus("reconnect");
      if (fails >= 3) {
        if (onGiveUp) onGiveUp();
        return;
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(connect, delay);
      delay = Math.min(8000, delay * 1.7);
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
        if (timer) clearTimeout(timer);
        if (staleTimer) clearTimeout(staleTimer);
        try {
          if (ws) ws.close();
        } catch {
          /* */
        }
      },
    };
  }

  function createLiveStream({ symbol, interval, onKline, onStatus }) {
    let sock = null;
    let pollTimer = null;
    let closed = false;

    function stopPoll() {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    }

    function startPoll() {
      if (closed || pollTimer) return;
      if (onStatus) onStatus("reconnect");
      const tick = async () => {
        if (closed) return;
        try {
          const rows = await fetchKlines(symbol, interval, 2);
          const last = rows[rows.length - 1];
          if (last) onKline({ ...last, closed: false });
        } catch {
          /* keep polling silently */
        }
      };
      tick();
      pollTimer = setInterval(tick, 3000);
    }

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

    return {
      close() {
        closed = true;
        stopPoll();
        if (sock) sock.close();
      },
    };
  }

  function chartOptions(el, height) {
    return {
      width: el.clientWidth,
      height,
      layout: {
        background: { color: "#080b10" },
        backgroundColor: "#080b10",
        textColor: "#7d8b9a",
      },
      grid: { vertLines: { color: "#141c28" }, horzLines: { color: "#141c28" } },
      rightPriceScale: { borderColor: "#1a2330", autoScale: true },
      timeScale: {
        borderColor: "#1a2330",
        timeVisible: true,
        secondsVisible: false,
        fixLeftEdge: true,
        fixRightEdge: true,
        rightBarStaysOnScroll: true,
        lockVisibleTimeRangeOnResize: true,
      },
      handleScroll: { vertTouchDrag: false },
      attributionLogo: true,
    };
  }

  root.QAFeed = {
    INTERVALS,
    fetchKlines,
    createSocket,
    createLiveStream,
    setFeedStatus,
    chartOptions,
  };
})(typeof window !== "undefined" ? window : globalThis);
