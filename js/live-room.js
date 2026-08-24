(function () {
  const COINS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT", "SUIUSDT", "PEPEUSDT"];
  const MUTE_KEY = "qa_live_mute";
  const HINT_KEY = "qa_live_voice_hint_seen";
  const FEED_MS = 8000;
  const KLINE_MS = 15000;
  const HOUR_S = 3600;

  const state = {
    klines: {},
    tickers: {},
    lastPx: {},
    events: [],
    seenKeys: null,
    voiceOn: false,
    queue: [],
    speaking: false,
  };

  function t(key, fallback) {
    if (window.QALang && typeof window.QALang.t === "function") {
      const live = window.QALang.t(key);
      if (live && live !== key) return live;
    }
    return fallback || key;
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function pairLabel(sym) {
    return String(sym || "").replace(/USDT$/i, "") + "/USDT";
  }

  function fmtPx(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return "—";
    if (x >= 1000) return x.toLocaleString("en-US", { maximumFractionDigits: 1 });
    if (x >= 1) return x.toFixed(2);
    if (x >= 0.01) return x.toFixed(4);
    return x.toPrecision(4);
  }

  function fmtPnl(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return "—";
    const sign = x > 0 ? "+" : "";
    return sign + x.toFixed(1) + "%";
  }

  function fmtTime(ts) {
    const d = new Date((Number(ts) > 1e12 ? Number(ts) : Number(ts) * 1000));
    if (!isFinite(d.getTime())) return "—";
    const p = (n) => String(n).padStart(2, "0");
    return p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
  }

  function isBuy(ev) {
    const side = String(ev.side || ev.action || "").toUpperCase();
    if (side.indexOf("SHORT") >= 0 || side.indexOf("SELL") >= 0) return false;
    return true;
  }

  /* ---- voice: MRT-like chime then urgent zh-TW ---- */
  function loadVoicePref() {
    try {
      return localStorage.getItem(MUTE_KEY) !== "0";
    } catch {
      return true;
    }
  }

  function saveVoiceOn(on) {
    try {
      localStorage.setItem(MUTE_KEY, on ? "0" : "1");
    } catch {
      /* private */
    }
  }

  function playMrtChime() {
    return new Promise((resolve) => {
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return resolve();
        const ctx = playMrtChime._ctx || new Ctx();
        playMrtChime._ctx = ctx;
        if (ctx.state === "suspended") ctx.resume();
        const now = ctx.currentTime;
        const notes = [
          { f: 880, t: 0, d: 0.22 },
          { f: 1318.5, t: 0.2, d: 0.28 },
          { f: 1760, t: 0.46, d: 0.38 },
        ];
        notes.forEach((n) => {
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.type = "sine";
          o.frequency.value = n.f;
          g.gain.setValueAtTime(0.0001, now + n.t);
          g.gain.exponentialRampToValueAtTime(0.18, now + n.t + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, now + n.t + n.d);
          o.connect(g);
          g.connect(ctx.destination);
          o.start(now + n.t);
          o.stop(now + n.t + n.d + 0.02);
        });
        setTimeout(resolve, 1050);
      } catch {
        resolve();
      }
    });
  }

  function pickTwVoice() {
    const list = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
    const want = [/zh-TW/i, /Hant/i, /Taiwan/i, /Hanhan/i, /Hsiao/i, /Yating/i];
    for (let i = 0; i < want.length; i += 1) {
      const hit = list.find((v) => want[i].test(v.lang + " " + v.name));
      if (hit) return hit;
    }
    return list.find((v) => /zh/i.test(v.lang)) || null;
  }

  function speakLine(text) {
    return new Promise((resolve) => {
      if (!window.speechSynthesis || !text) return resolve();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "zh-TW";
      u.rate = 1.2;
      u.pitch = 1.12;
      u.volume = 1;
      const voice = pickTwVoice();
      if (voice) u.voice = voice;
      u.onend = () => resolve();
      u.onerror = () => resolve();
      window.speechSynthesis.speak(u);
    });
  }

  async function drainQueue() {
    if (state.speaking) return;
    state.speaking = true;
    while (state.queue.length && state.voiceOn) {
      const job = state.queue.shift();
      await playMrtChime();
      if (!state.voiceOn) break;
      await speakLine(job);
    }
    state.speaking = false;
  }

  function enqueueVoice(text) {
    if (!state.voiceOn || !text) return;
    state.queue.push(text);
    drainQueue();
  }

  function voiceLine(ev) {
    const coin = String(ev.symbol || "").replace(/USDT$/i, "");
    const px = fmtPx(ev.price);
    const buy = isBuy(ev);
    if (buy) {
      return "報告長官！" + coin + " 出現突破信號，多頭開倉，現價 " + px + "，拉升中！";
    }
    return "注意！" + coin + " 觸發共振波段，空單進場，現價 " + px + "！";
  }

  function paintVoiceBtn() {
    const btn = document.getElementById("liveMuteBtn");
    const label = document.getElementById("liveMuteLabel");
    if (!btn) return;
    btn.classList.toggle("is-on", state.voiceOn);
    btn.classList.toggle("is-off", !state.voiceOn);
    btn.setAttribute("aria-pressed", state.voiceOn ? "true" : "false");
    if (label) {
      label.textContent = state.voiceOn
        ? t("liveMuteOn", "🔊 實況語音播報：已啟用")
        : t("liveMuteOff", "🔊 實況語音播報：未啟用");
    }
  }

  function showHint(on) {
    const el = document.getElementById("voiceHint");
    if (!el) return;
    el.hidden = !on;
  }

  function bindVoice() {
    state.voiceOn = !loadVoicePref();
    paintVoiceBtn();
    let seen = false;
    try {
      seen = localStorage.getItem(HINT_KEY) === "1";
    } catch {
      seen = false;
    }
    showHint(!state.voiceOn && !seen);
    const btn = document.getElementById("liveMuteBtn");
    if (!btn) return;
    btn.addEventListener("click", () => {
      state.voiceOn = !state.voiceOn;
      saveVoiceOn(state.voiceOn);
      paintVoiceBtn();
      showHint(false);
      try {
        localStorage.setItem(HINT_KEY, "1");
      } catch {
        /* private */
      }
      if (state.voiceOn) {
        enqueueVoice("戰情語音已連線，開倉信號將即時播報。");
      } else if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
        state.queue = [];
      }
    });
    const hint = document.getElementById("voiceHint");
    if (hint) hint.addEventListener("click", () => btn.click());
    if (window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = function () {};
    }
  }

  /* ---- 8-coin canvas sparklines ---- */
  function cardHtml(sym) {
    return (
      '<article class="coin-card" data-sym="' +
      sym +
      '">' +
      '<div class="coin-card-head"><span class="coin-pair">' +
      pairLabel(sym) +
      '</span><span class="coin-chg" data-chg>—</span></div>' +
      '<div class="coin-px" data-px>—</div>' +
      '<canvas class="coin-spark" data-spark="' +
      sym +
      '"></canvas>' +
      "</article>"
    );
  }

  function drawSpark(sym) {
    const canvas = document.querySelector('canvas[data-spark="' + sym + '"]');
    if (!canvas) return;
    const rows = state.klines[sym] || [];
    const closes = rows.map((r) => r.c);
    const dpr = window.devicePixelRatio || 1;
    const cssW = Math.max(120, canvas.clientWidth || 160);
    const cssH = Math.max(72, canvas.clientHeight || 88);
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    if (closes.length < 2) return;
    const min = Math.min.apply(null, closes);
    const max = Math.max.apply(null, closes);
    const span = max - min || 1;
    const pad = 8;
    const w = cssW - pad * 2;
    const h = cssH - pad * 2;
    const last = closes[closes.length - 1];
    const first = closes[0];
    const up = last >= first;
    const stroke = up ? "#00f59b" : "#ff3b69";
    const fill = up ? "rgba(0,245,155,0.16)" : "rgba(255,59,105,0.14)";
    ctx.beginPath();
    closes.forEach((c, i) => {
      const x = pad + (i / (closes.length - 1)) * w;
      const y = pad + h - ((c - min) / span) * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.lineTo(pad + w, pad + h);
    ctx.lineTo(pad, pad + h);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.beginPath();
    closes.forEach((c, i) => {
      const x = pad + (i / (closes.length - 1)) * w;
      const y = pad + h - ((c - min) / span) * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.8;
    ctx.shadowColor = stroke;
    ctx.shadowBlur = 10;
    ctx.stroke();
    ctx.shadowBlur = 0;
    const marks = state.events.filter((e) => e.symbol === sym && Date.now() / 1000 - e.ts < HOUR_S);
    marks.forEach((ev) => {
      const px = Number(ev.price);
      if (!Number.isFinite(px)) return;
      let idx = closes.length - 1;
      if (rows.length) {
        const t = ev.ts * 1000;
        let best = 0;
        let dist = Infinity;
        rows.forEach((r, i) => {
          const d = Math.abs(r.t - t);
          if (d < dist) {
            dist = d;
            best = i;
          }
        });
        idx = best;
      }
      const x = pad + (idx / (closes.length - 1)) * w;
      const y = pad + h - ((px - min) / span) * h;
      const buy = isBuy(ev);
      ctx.beginPath();
      ctx.arc(x, Math.max(pad, Math.min(pad + h, y)), 4.2, 0, Math.PI * 2);
      ctx.fillStyle = buy ? "#00f59b" : "#ff3b69";
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = 12;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.font = "10px JetBrains Mono, monospace";
      ctx.fillStyle = buy ? "#00f59b" : "#ff3b69";
      ctx.fillText((buy ? "BUY @" : "SELL @") + " " + fmtPx(px), x + 6, Math.max(12, y - 6));
    });
  }

  function paintCards() {
    COINS.forEach((sym) => {
      const card = document.querySelector('.coin-card[data-sym="' + sym + '"]');
      if (!card) return;
      const tk = state.tickers[sym] || {};
      const pxEl = card.querySelector("[data-px]");
      const chgEl = card.querySelector("[data-chg]");
      const px = tk.last != null ? tk.last : state.lastPx[sym];
      if (pxEl) pxEl.textContent = fmtPx(px);
      const chg = Number(tk.chg);
      if (chgEl) {
        if (Number.isFinite(chg)) {
          const up = chg >= 0;
          chgEl.textContent = (up ? "▲ " : "▼ ") + Math.abs(chg).toFixed(2) + "%";
          chgEl.classList.toggle("is-up", up);
          chgEl.classList.toggle("is-down", !up);
        } else {
          chgEl.textContent = "—";
        }
      }
      drawSpark(sym);
    });
  }

  async function fetchJson(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    return res.json();
  }

  async function loadKlines(sym) {
    try {
      const rows = await fetchJson(
        "https://api.binance.com/api/v3/klines?symbol=" + sym + "&interval=1m&limit=60",
      );
      return rows.map((r) => ({ t: Number(r[0]), c: Number(r[4]) }));
    } catch {
      const inst = String(sym).replace("USDT", "") + "-USDT";
      const data = await fetchJson(
        "https://www.okx.com/api/v5/market/candles?instId=" + inst + "&bar=1m&limit=60",
      );
      const rows = (data.data || []).slice().reverse();
      return rows.map((r) => ({ t: Number(r[0]), c: Number(r[4]) }));
    }
  }

  async function loadTickers() {
    try {
      const q = encodeURIComponent(JSON.stringify(COINS));
      const rows = await fetchJson("https://api.binance.com/api/v3/ticker/24hr?symbols=" + q);
      const map = {};
      (rows || []).forEach((r) => {
        map[r.symbol] = { last: Number(r.lastPrice), chg: Number(r.priceChangePercent) };
      });
      state.tickers = map;
    } catch {
      /* optional */
    }
  }

  async function refreshMarket() {
    await loadTickers();
    const packs = await Promise.all(
      COINS.map(async (sym) => {
        try {
          const rows = await loadKlines(sym);
          return [sym, rows];
        } catch {
          return [sym, state.klines[sym] || []];
        }
      }),
    );
    packs.forEach(([sym, rows]) => {
      if (rows && rows.length) {
        state.klines[sym] = rows;
        state.lastPx[sym] = rows[rows.length - 1].c;
      }
    });
    paintCards();
  }

  /* ---- event-driven 1h radar (exec_log side-changes only) ---- */
  function liveFeedUrl() {
    return "https://api.quantalpha.space/live_feed.json?t=" + Date.now();
  }

  function flattenFeed(data) {
    const out = [];
    const rows = Array.isArray(data.exec_log) ? data.exec_log : [];
    rows.forEach((g) => {
      if (g && g.kind === "batch" && Array.isArray(g.symbols)) {
        g.symbols.forEach((s) => {
          out.push({
            key: [g.name_zh, g.side, g.interval, g.bar_ts, s.symbol].join("|"),
            ts: Number(g.bar_ts || g.logged_at) || 0,
            symbol: s.symbol,
            price: s.price,
            side: g.side,
            action: g.action,
            name: g.name_zh || g.name_en || "量化策略",
            interval: g.interval || "1h",
          });
        });
        return;
      }
      if (!g || !g.symbol) return;
      out.push({
        key: [g.strategy_id, g.symbol, g.event, g.bar_ts, g.side].join("|"),
        ts: Number(g.logged_at || g.bar_ts) || 0,
        symbol: g.symbol,
        price: g.price,
        side: g.side,
        action: g.action,
        name: g.name_zh || g.name_en || "量化策略",
        interval: g.interval || "1h",
      });
    });
    return out;
  }

  function pnlOf(ev) {
    const last = state.lastPx[ev.symbol];
    const entry = Number(ev.price);
    if (!Number.isFinite(last) || !Number.isFinite(entry) || !entry) return null;
    const raw = ((last - entry) / entry) * 100;
    return isBuy(ev) ? raw : -raw;
  }

  function paintRadar() {
    const list = document.getElementById("radarList");
    if (!list) return;
    const now = Date.now() / 1000;
    const rows = state.events
      .filter((e) => now - e.ts <= HOUR_S)
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 40);
    if (!rows.length) {
      list.innerHTML = '<div class="radar-idle">' + escapeHtml(t("radarIdle", "⏳ 戰情雷達全天候掃描中，各幣種策略就緒...")) + "</div>";
      return;
    }
    const html = rows
      .map((ev) => {
        const buy = isBuy(ev);
        const pnl = pnlOf(ev);
        const pnlCls = pnl == null ? "" : pnl >= 0 ? " is-up" : " is-down";
        const pnlTxt = pnl == null ? "" : " | 當前浮盈 " + fmtPnl(pnl);
        return (
          '<div class="radar-row ' +
          (buy ? "is-buy" : "is-sell") +
          '">' +
          '<span class="t">[' +
          fmtTime(ev.ts) +
          "]</span>" +
          '<span class="side">' +
          (buy ? "🟢 " : "🔴 ") +
          escapeHtml(pairLabel(ev.symbol)) +
          "</span>" +
          "<span>| " +
          escapeHtml(ev.name) +
          " (" +
          escapeHtml(String(ev.interval || "1h").toUpperCase()) +
          ")</span>" +
          "<span>| " +
          (buy ? "多頭開倉" : "空頭開倉") +
          " @ " +
          escapeHtml(fmtPx(ev.price)) +
          "</span>" +
          (pnlTxt ? '<span class="pnl' + pnlCls + '">' + escapeHtml(pnlTxt) + "</span>" : "") +
          "</div>"
        );
      })
      .join("");
    list.innerHTML = html + html;
    list.style.animation = rows.length > 6 ? "radarScroll 28s linear infinite" : "none";
  }

  async function refreshFeed() {
    try {
      const data = await fetchJson(liveFeedUrl());
      const flat = flattenFeed(data);
      const now = Date.now() / 1000;
      state.events = flat.filter((e) => e.ts && now - e.ts <= HOUR_S * 6);
      if (state.seenKeys == null) {
        state.seenKeys = new Set(flat.map((e) => e.key));
      } else {
        flat.forEach((ev) => {
          if (state.seenKeys.has(ev.key)) return;
          state.seenKeys.add(ev.key);
          if (now - ev.ts <= HOUR_S) enqueueVoice(voiceLine(ev));
        });
      }
      paintRadar();
      paintCards();
    } catch {
      /* feed optional */
    }
  }

  function boot() {
    const grid = document.getElementById("coinGrid");
    if (grid) grid.innerHTML = COINS.map(cardHtml).join("");
    bindVoice();
    refreshMarket();
    refreshFeed();
    setInterval(refreshMarket, KLINE_MS);
    setInterval(refreshFeed, FEED_MS);
    window.addEventListener("resize", () => paintCards());
    const style = document.createElement("style");
    style.textContent =
      "@keyframes radarScroll{0%{transform:translateY(0)}100%{transform:translateY(-50%)}}";
    document.head.appendChild(style);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
