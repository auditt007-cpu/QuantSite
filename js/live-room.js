(function () {
  const ALL_COINS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT", "SUIUSDT", "PEPEUSDT"];
  const WATCH_KEY = "qa_live_watch_coins_v2";
  const MUTE_KEY = "qa_live_mute";
  const HINT_KEY = "qa_live_voice_hint_seen";
  const FEED_MS = 8000;
  const KLINE_MS = 15000;
  const TICK_MS = 1500;
  const HOUR_S = 3600;

  const state = {
    watch: loadWatch(),
    klines: {},
    tickers: {},
    lastPx: {},
    events: [],
    seenKeys: null,
    voiceOn: false,
    queue: [],
    speaking: false,
    modalSym: null,
    ws: null,
    wsLive: false,
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
    return fmt12h(ts);
  }

  function fmt12h(ts) {
    const d = new Date(Number(ts) > 1e12 ? Number(ts) : Number(ts) * 1000);
    if (!isFinite(d.getTime())) {
      return fmt12h(Date.now());
    }
    let h = d.getHours();
    const m = String(d.getMinutes()).padStart(2, "0");
    const s = String(d.getSeconds()).padStart(2, "0");
    const period = h < 12 ? "上午" : "下午";
    h = h % 12;
    if (h === 0) h = 12;
    return period + " " + String(h).padStart(2, "0") + ":" + m + ":" + s;
  }

  function fmt12hSpeech(ts) {
    return fmt12h(ts);
  }

  function isClose(ev) {
    return String(ev.event || "").toLowerCase() === "close" || /平倉/.test(String(ev.action || ""));
  }

  function isBuy(ev) {
    const side = String(ev.side || ev.action || "").toUpperCase();
    if (side.indexOf("SHORT") >= 0 || side.indexOf("SELL") >= 0) return false;
    return true;
  }

  function loadWatch() {
    try {
      const raw = JSON.parse(localStorage.getItem(WATCH_KEY) || "null");
      if (Array.isArray(raw) && raw.length) {
        return raw.filter((s) => ALL_COINS.indexOf(s) >= 0);
      }
    } catch {
      /* private */
    }
    return ALL_COINS.slice();
  }

  function saveWatch() {
    try {
      localStorage.setItem(WATCH_KEY, JSON.stringify(state.watch));
    } catch {
      /* private */
    }
  }

  function inWatch(sym) {
    return state.watch.indexOf(sym) >= 0;
  }

  /* ---- voice ---- */
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
          { f: 880, t: 0, d: 0.18 },
          { f: 1318.5, t: 0.16, d: 0.22 },
          { f: 1760, t: 0.36, d: 0.28 },
        ];
        notes.forEach((n) => {
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.type = "sine";
          o.frequency.value = n.f;
          g.gain.setValueAtTime(0.0001, now + n.t);
          g.gain.exponentialRampToValueAtTime(0.16, now + n.t + 0.015);
          g.gain.exponentialRampToValueAtTime(0.0001, now + n.t + n.d);
          o.connect(g);
          g.connect(ctx.destination);
          o.start(now + n.t);
          o.stop(now + n.t + n.d + 0.02);
        });
        setTimeout(resolve, 820);
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
      u.rate = 1.32;
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
    const when = fmt12hSpeech(ev.ts || Date.now());
    if (isClose(ev)) {
      const pnl = Number(ev.pnl_pct);
      if (!Number.isFinite(pnl) || pnl <= 0) return "";
      return "太棒了！" + when + "，" + coin + " 觸發平倉，成功獲利 " + pnl.toFixed(1) + "%！";
    }
    const buy = isBuy(ev);
    if (buy) {
      return "報告長官！" + when + "，" + coin + " 出現突破信號，多頭開倉，現價 " + px + "，衝刺中！";
    }
    return "注意！" + when + "，" + coin + " 觸發共振波段，空單進場，現價 " + px + "！";
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

  /* ---- canvas sparklines (fixed height for mobile) ---- */
  function drawSparkOn(canvas, sym, tall) {
    if (!canvas) return;
    const rows = state.klines[sym] || [];
    const closes = rows.map((r) => r.c);
    const livePx = Number((state.tickers[sym] && state.tickers[sym].last) || state.lastPx[sym]);
    if (Number.isFinite(livePx) && closes.length) {
      closes.push(livePx);
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const parentW = canvas.parentElement ? canvas.parentElement.clientWidth : 0;
    const cssW = Math.max(160, canvas.clientWidth || parentW || 280);
    const cssH = tall ? Math.max(220, canvas.clientHeight || 280) : 160;
    canvas.style.width = "100%";
    canvas.style.height = cssH + "px";
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, cssW, cssH);
    if (closes.length < 2) {
      ctx.fillStyle = "#94a3b8";
      ctx.font = "12px Inter, sans-serif";
      ctx.fillText("載入行情…", 12, cssH / 2);
      return;
    }
    const min = Math.min.apply(null, closes);
    const max = Math.max.apply(null, closes);
    const span = max - min || 1;
    const pad = 10;
    const w = cssW - pad * 2;
    const h = cssH - pad * 2;
    const last = closes[closes.length - 1];
    const first = closes[0];
    const up = last >= first;
    const stroke = up ? "#10b981" : "#ef4444";
    const fill = up ? "rgba(16,185,129,0.14)" : "rgba(239,68,68,0.12)";
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
    ctx.lineWidth = 2;
    ctx.stroke();
    const marks = state.events.filter((e) => e.symbol === sym && Date.now() / 1000 - e.ts < HOUR_S);
    marks.forEach((ev) => {
      const px = Number(ev.price);
      if (!Number.isFinite(px)) return;
      let idx = closes.length - 1;
      if (rows.length) {
        const tms = ev.ts * 1000;
        let best = 0;
        let dist = Infinity;
        rows.forEach((r, i) => {
          const d = Math.abs(r.t - tms);
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
      ctx.arc(x, Math.max(pad, Math.min(pad + h, y)), 4.5, 0, Math.PI * 2);
      ctx.fillStyle = buy ? "#10b981" : "#ef4444";
      ctx.fill();
      ctx.font = "11px Roboto Mono, monospace";
      ctx.fillStyle = buy ? "#059669" : "#dc2626";
      ctx.fillText((buy ? "BUY @" : "SELL @") + " " + fmtPx(px), x + 6, Math.max(14, y - 6));
    });
  }

  function drawSpark(sym) {
    drawSparkOn(document.querySelector('canvas[data-spark="' + sym + '"]'), sym, false);
  }

  function cardHtml(sym) {
    return (
      '<article class="coin-card" data-sym="' +
      sym +
      '" tabindex="0" role="button">' +
      '<button type="button" class="coin-remove" data-remove="' +
      sym +
      '" aria-label="移除" title="移出自選">×</button>' +
      '<div class="coin-card-head"><span class="coin-pair">' +
      pairLabel(sym) +
      '</span><span class="coin-chg" data-chg>—</span></div>' +
      '<div class="coin-px" data-px>—</div>' +
      '<div class="coin-spark-wrap"><canvas class="coin-spark" data-spark="' +
      sym +
      '" width="320" height="160"></canvas></div>' +
      '<ul class="coin-mini-tape" data-mini="' +
      sym +
      '"></ul>' +
      "</article>"
    );
  }

  function flashPx(el, next, prev) {
    if (!el) return;
    el.textContent = fmtPx(next);
    if (!Number.isFinite(prev) || !Number.isFinite(next) || prev === next) return;
    el.classList.remove("flash-up", "flash-down");
    void el.offsetWidth;
    el.classList.add(next > prev ? "flash-up" : "flash-down");
  }

  function miniLine(ev) {
    const close = isClose(ev);
    const buy = isBuy(ev);
    const pnl = Number(ev.pnl_pct);
    if (close) {
      const ok = Number.isFinite(pnl) && pnl > 0;
      return (
        fmt12h(ev.ts) +
        " " +
        (ok ? "平倉獲利 " + fmtPnl(pnl) : "平倉 " + (Number.isFinite(pnl) ? fmtPnl(pnl) : ""))
      );
    }
    return fmt12h(ev.ts) + " " + (buy ? "多頭開倉" : "空頭開倉") + " @ " + fmtPx(ev.price);
  }

  function paintMiniTapes() {
    const now = Date.now() / 1000;
    state.watch.forEach((sym) => {
      const el = document.querySelector('[data-mini="' + sym + '"]');
      if (!el) return;
      const rows = state.events
        .filter((e) => e.symbol === sym && now - e.ts <= HOUR_S)
        .sort((a, b) => b.ts - a.ts)
        .slice(0, 3);
      if (!rows.length) {
        el.innerHTML = '<li class="muted">暫無近 1 小時戰績</li>';
        return;
      }
      el.innerHTML = rows
        .map((ev) => {
          const close = isClose(ev);
          const cls = close ? (Number(ev.pnl_pct) > 0 ? "is-up" : "is-down") : isBuy(ev) ? "is-up" : "is-down";
          return '<li class="' + cls + '">' + escapeHtml(miniLine(ev)) + "</li>";
        })
        .join("");
    });
  }

  function paintCardsMeta() {
    state.watch.forEach((sym) => {
      const card = document.querySelector('.coin-card[data-sym="' + sym + '"]');
      if (!card) return;
      const tk = state.tickers[sym] || {};
      const pxEl = card.querySelector("[data-px]");
      const chgEl = card.querySelector("[data-chg]");
      const px = tk.last != null ? tk.last : state.lastPx[sym];
      const prev = Number(pxEl && pxEl.getAttribute("data-last"));
      if (pxEl) {
        flashPx(pxEl, Number(px), prev);
        if (Number.isFinite(Number(px))) pxEl.setAttribute("data-last", String(px));
      }
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
    paintMiniTapes();
  }

  function renderGrid() {
    const grid = document.getElementById("coinGrid");
    if (!grid) return;
    if (!state.watch.length) {
      grid.innerHTML =
        '<p class="radar-idle">' +
        escapeHtml(t("watchEmpty", "自選組合為空，請點「添加幣種」恢復監控")) +
        "</p>";
      return;
    }
    grid.innerHTML = state.watch.map(cardHtml).join("");
    paintCardsMeta();
    paintAddPanel();
  }

  function paintAddPanel() {
    const panel = document.getElementById("cmdAddPanel");
    if (!panel) return;
    const missing = ALL_COINS.filter((s) => !inWatch(s));
    if (!missing.length) {
      panel.innerHTML = '<span class="radar-idle">自選已滿（8/8）</span>';
      return;
    }
    panel.innerHTML = missing
      .map(
        (s) =>
          '<button type="button" class="cmd-add-chip" data-add="' +
          s +
          '">➕ ' +
          pairLabel(s) +
          "</button>",
      )
      .join("");
  }

  function removeCoin(sym) {
    state.watch = state.watch.filter((s) => s !== sym);
    saveWatch();
    if (state.modalSym === sym) closeModal();
    renderGrid();
    paintRadar();
  }

  function addCoin(sym) {
    if (!ALL_COINS.includes(sym) || inWatch(sym)) return;
    state.watch.push(sym);
    saveWatch();
    renderGrid();
    refreshMarket();
    paintRadar();
  }

  function bindGrid() {
    const grid = document.getElementById("coinGrid");
    if (!grid || grid.getAttribute("data-bound") === "1") return;
    grid.setAttribute("data-bound", "1");
    grid.addEventListener("click", (ev) => {
      const rm = ev.target.closest("[data-remove]");
      if (rm) {
        ev.preventDefault();
        ev.stopPropagation();
        removeCoin(rm.getAttribute("data-remove"));
        return;
      }
      const card = ev.target.closest(".coin-card");
      if (card) openModal(card.getAttribute("data-sym"));
    });
  }

  function bindAddUi() {
    const btn = document.getElementById("cmdAddBtn");
    const panel = document.getElementById("cmdAddPanel");
    if (btn && panel) {
      btn.addEventListener("click", () => {
        panel.classList.toggle("is-open");
        paintAddPanel();
      });
      panel.addEventListener("click", (ev) => {
        const chip = ev.target.closest("[data-add]");
        if (!chip) return;
        addCoin(chip.getAttribute("data-add"));
        if (!ALL_COINS.some((s) => !inWatch(s))) panel.classList.remove("is-open");
      });
    }
  }

  /* ---- modal zoom ---- */
  function openModal(sym) {
    if (!sym || !inWatch(sym)) return;
    state.modalSym = sym;
    const bg = document.getElementById("coinModalBg");
    const title = document.getElementById("coinModalTitle");
    const meta = document.getElementById("coinModalMeta");
    const marks = document.getElementById("coinModalMarks");
    const canvas = document.getElementById("coinModalSpark");
    if (!bg) return;
    const tk = state.tickers[sym] || {};
    const px = tk.last != null ? tk.last : state.lastPx[sym];
    const chg = Number(tk.chg);
    if (title) title.textContent = pairLabel(sym);
    if (meta) {
      meta.innerHTML =
        "<span>現價 <b>" +
        escapeHtml(fmtPx(px)) +
        "</b></span>" +
        "<span>24H " +
        (Number.isFinite(chg) ? (chg >= 0 ? "+" : "") + chg.toFixed(2) + "%" : "—") +
        "</span>" +
        "<span>監控中 · 1m 折線</span>";
    }
    const hourMarks = state.events.filter((e) => e.symbol === sym && Date.now() / 1000 - e.ts <= HOUR_S);
    if (marks) {
      marks.innerHTML = hourMarks.length
        ? hourMarks
            .slice(0, 8)
            .map((e) => {
              const buy = isBuy(e);
              return (
                "<div>" +
                fmtTime(e.ts) +
                " · " +
                (buy ? "🟢 BUY" : "🔴 SELL") +
                " @ " +
                fmtPx(e.price) +
                " · " +
                escapeHtml(e.name || "") +
                "</div>"
              );
            })
            .join("")
        : "<div>近 1 小時尚無開倉標記</div>";
    }
    bg.classList.add("is-open");
    requestAnimationFrame(() => drawSparkOn(canvas, sym, true));
  }

  function closeModal() {
    state.modalSym = null;
    const bg = document.getElementById("coinModalBg");
    if (bg) bg.classList.remove("is-open");
  }

  function bindModal() {
    const bg = document.getElementById("coinModalBg");
    const x = document.getElementById("coinModalClose");
    if (x) x.addEventListener("click", closeModal);
    if (bg) {
      bg.addEventListener("click", (ev) => {
        if (ev.target === bg) closeModal();
      });
    }
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") closeModal();
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
      const q = encodeURIComponent(JSON.stringify(ALL_COINS));
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

  function applyTick(sym, last, chg) {
    if (!sym || !Number.isFinite(last)) return;
    const prev = Number(state.lastPx[sym]);
    state.lastPx[sym] = last;
    const cur = state.tickers[sym] || {};
    cur.last = last;
    if (Number.isFinite(chg)) cur.chg = chg;
    state.tickers[sym] = cur;
    const card = document.querySelector('.coin-card[data-sym="' + sym + '"]');
    if (card) {
      const pxEl = card.querySelector("[data-px]");
      flashPx(pxEl, last, Number(pxEl && pxEl.getAttribute("data-last")));
      if (pxEl) pxEl.setAttribute("data-last", String(last));
      const chgEl = card.querySelector("[data-chg]");
      if (chgEl && Number.isFinite(chg)) {
        const up = chg >= 0;
        chgEl.textContent = (up ? "▲ " : "▼ ") + Math.abs(chg).toFixed(2) + "%";
        chgEl.classList.toggle("is-up", up);
        chgEl.classList.toggle("is-down", !up);
      }
      drawSpark(sym);
    }
    if (state.modalSym === sym) {
      drawSparkOn(document.getElementById("coinModalSpark"), sym, true);
    }
    void prev;
  }

  async function pollFastTickers() {
    if (state.wsLive) return;
    const urls = [
      "https://data-api.binance.vision/api/v3/ticker/24hr?symbols=",
      "https://api.binance.com/api/v3/ticker/24hr?symbols=",
    ];
    const q = encodeURIComponent(JSON.stringify(ALL_COINS));
    for (let i = 0; i < urls.length; i += 1) {
      try {
        const rows = await fetchJson(urls[i] + q);
        (rows || []).forEach((r) => applyTick(r.symbol, Number(r.lastPrice), Number(r.priceChangePercent)));
        return;
      } catch {
        /* try next */
      }
    }
    try {
      const data = await fetchJson("https://www.okx.com/api/v5/market/tickers?instType=SPOT");
      const want = {};
      ALL_COINS.forEach((s) => {
        want[s.replace("USDT", "") + "-USDT"] = s;
      });
      (data.data || []).forEach((r) => {
        const sym = want[r.instId];
        if (!sym) return;
        const last = Number(r.last);
        const open = Number(r.open24h);
        const chg = open > 0 ? ((last - open) / open) * 100 : NaN;
        applyTick(sym, last, chg);
      });
    } catch {
      /* keep last */
    }
  }

  function connectTickerStream() {
    if (state.ws) return;
    const streams = ALL_COINS.map((s) => s.toLowerCase() + "@miniTicker").join("/");
    const endpoints = [
      "wss://stream.binance.com:9443/stream?streams=",
      "wss://data-stream.binance.vision/stream?streams=",
    ];
    let idx = 0;
    function openWs() {
      let ws;
      try {
        ws = new WebSocket(endpoints[idx % endpoints.length] + streams);
      } catch {
        state.wsLive = false;
        state.ws = null;
        setTimeout(connectTickerStream, 2500);
        return;
      }
      state.ws = ws;
      ws.onopen = () => {
        state.wsLive = true;
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          const d = msg.data || msg;
          applyTick(d.s, Number(d.c), Number(d.P));
        } catch {
          /* ignore */
        }
      };
      ws.onclose = () => {
        state.wsLive = false;
        state.ws = null;
        idx += 1;
        setTimeout(openWs, 2500);
      };
      ws.onerror = () => {
        try {
          ws.close();
        } catch {
          /* */
        }
      };
    }
    openWs();
  }

  async function refreshMarket() {
    await loadTickers();
    const targets = state.watch.length ? state.watch : ALL_COINS;
    const packs = await Promise.all(
      targets.map(async (sym) => {
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
    paintCardsMeta();
    if (state.modalSym) {
      drawSparkOn(document.getElementById("coinModalSpark"), state.modalSym, true);
    }
  }

  function liveFeedUrl() {
    return "https://api.quantalpha.space/live_feed.json?t=" + Date.now();
  }

  function toSec(n) {
    const x = Number(n);
    if (!Number.isFinite(x) || !x) return 0;
    return x > 1e12 ? x / 1000 : x;
  }

  function flattenFeed(data) {
    const out = [];
    const rows = Array.isArray(data.exec_log) ? data.exec_log : [];
    rows.forEach((g) => {
      if (g && g.kind === "batch" && Array.isArray(g.symbols)) {
        g.symbols.forEach((s) => {
          out.push({
            key: [g.name_zh, g.side, g.interval, g.logged_at || g.bar_ts, s.symbol, s.event || "open"].join("|"),
            ts: toSec(g.logged_at) || toSec(g.bar_ts),
            symbol: s.symbol,
            price: s.price,
            side: g.side,
            action: g.action,
            event: s.event || g.event || "open",
            pnl_pct: s.pnl_pct,
            name: g.name_zh || g.name_en || "量化策略",
            interval: g.interval || "1h",
          });
        });
        return;
      }
      if (!g || !g.symbol) return;
      out.push({
        key: [g.strategy_id, g.symbol, g.event, g.logged_at || g.bar_ts, g.side].join("|"),
        ts: toSec(g.logged_at) || toSec(g.bar_ts),
        symbol: g.symbol,
        price: g.price,
        side: g.side,
        action: g.action,
        event: g.event || "open",
        pnl_pct: g.pnl_pct,
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
    const watchSet = new Set(state.watch);
    const rows = state.events
      .filter((e) => watchSet.has(e.symbol) && now - e.ts <= HOUR_S)
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 40);
    if (!rows.length) {
      list.innerHTML =
        '<div class="radar-idle">' +
        escapeHtml(t("radarIdle", "⏳ 戰情雷達全天候掃描中，各幣種策略就緒...")) +
        "</div>";
      return;
    }
    const html = rows
      .map((ev) => {
        const buy = isBuy(ev);
        const close = isClose(ev);
        const pnl = close ? Number(ev.pnl_pct) : pnlOf(ev);
        const pnlCls = pnl == null || !Number.isFinite(pnl) ? "" : pnl >= 0 ? " is-up" : " is-down";
        const act = close
          ? Number.isFinite(pnl) && pnl > 0
            ? "平倉獲利 " + fmtPnl(pnl)
            : "平倉 " + (Number.isFinite(pnl) ? fmtPnl(pnl) : "")
          : (buy ? "多頭開倉" : "空頭開倉") + " @ " + fmtPx(ev.price);
        const livePnl =
          !close && pnl != null ? " | 當前浮盈 " + fmtPnl(pnl) : "";
        return (
          '<div class="radar-row ' +
          (close ? (Number(pnl) > 0 ? "is-buy" : "is-sell") : buy ? "is-buy" : "is-sell") +
          '">' +
          '<span class="t">[' +
          fmt12h(ev.ts) +
          "]</span>" +
          '<span class="side">' +
          (buy && !close ? "🟢 " : close && Number(pnl) > 0 ? "🟢 " : "🔴 ") +
          escapeHtml(pairLabel(ev.symbol)) +
          "</span>" +
          "<span>| " +
          escapeHtml(ev.name) +
          " (" +
          escapeHtml(String(ev.interval || "1h").toUpperCase()) +
          ")</span>" +
          "<span>| " +
          escapeHtml(act) +
          "</span>" +
          (livePnl ? '<span class="pnl' + pnlCls + '">' + escapeHtml(livePnl) + "</span>" : "") +
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
          if (!inWatch(ev.symbol)) return;
          if (now - ev.ts > HOUR_S) return;
          const line = voiceLine(ev);
          if (line) enqueueVoice(line);
        });
      }
      paintRadar();
      paintCardsMeta();
    } catch {
      /* feed optional */
    }
  }

  function boot() {
    renderGrid();
    bindGrid();
    bindAddUi();
    bindModal();
    bindVoice();
    refreshMarket();
    refreshFeed();
    connectTickerStream();
    setInterval(refreshMarket, KLINE_MS);
    setInterval(refreshFeed, FEED_MS);
    setInterval(pollFastTickers, TICK_MS);
    window.addEventListener("resize", () => {
      paintCardsMeta();
      if (state.modalSym) drawSparkOn(document.getElementById("coinModalSpark"), state.modalSym, true);
    });
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
