(function () {
  const ALL_COINS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "ONDOUSDT", "DOGEUSDT", "SUIUSDT", "NEARUSDT", "PEPEUSDT"];
  const COIN_ALIAS = { FETUSDT: "NEARUSDT" };
  const DEAD_SYMS = { FETUSDT: true };
  const BASE_PX = {
    BTCUSDT: 78400,
    ETHUSDT: 2480,
    SOLUSDT: 178.4,
    ONDOUSDT: 0.92,
    DOGEUSDT: 0.168,
    SUIUSDT: 3.42,
    NEARUSDT: 5.85,
    PEPEUSDT: 0.00001035,
    LINKUSDT: 18.4,
  };
  const KLINE_N = 60;
  const WATCH_KEY = "qa_live_watch_coins_v3";
  const MUTE_KEY = "qa_live_mute";
  const HINT_KEY = "qa_live_voice_hint_seen";
  const FEED_MS = 8000;
  const HOUR_S = 3600;
  const TICK_MS = 200;

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
    wsBackoff: 1000,
    wsTimer: null,
    wsTickAt: 0,
    wsUrlIdx: 0,
    restTimer: null,
    restArmTimer: null,
    jitterTimer: null,
    feedTimer: null,
    paintTimer: 0,
    paintRaf: 0,
    lastPaintAt: 0,
    pendingTicks: {},
    radarRaf: 0,
    disposed: false,
    cum: loadCum(),
  };

  const handlers = {
    resize: null,
    visibility: null,
    pagehide: null,
    pageshow: null,
    keydown: null,
    tapeClick: null,
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
    const ax = Math.abs(x);
    if (ax >= 1000) return x.toLocaleString("en-US", { maximumFractionDigits: 1 });
    if (ax >= 1) return x.toFixed(2);
    if (ax >= 0.01) return x.toFixed(4);
    if (ax >= 0.0001) return x.toFixed(6);
    return x.toExponential(3);
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
    const d = new Date(Number(ts) > 1e12 ? Number(ts) : Number(ts) * 1000);
    if (!isFinite(d.getTime())) return fmt12hSpeech(Date.now());
    let h = d.getHours();
    const m = String(d.getMinutes()).padStart(2, "0");
    const period = h < 12 ? "上午" : "下午";
    h = h % 12;
    if (h === 0) h = 12;
    return period + " " + String(h).padStart(2, "0") + ":" + m;
  }

  function coinSpeech(sym) {
    const k = String(sym || "").replace(/USDT$/i, "").toUpperCase();
    const map = {
      BTC: "比特幣",
      ETH: "以太幣",
      SOL: "SOL",
      BNB: "BNB",
      XRP: "XRP",
      DOGE: "狗狗幣",
      SUI: "SUI",
      PEPE: "PEPE",
      ONDO: "ONDO",
      NEAR: "NEAR",
      LINK: "LINK",
    };
    return map[k] || k;
  }

  function stratAlias(name) {
    const s = String(name || "");
    if (/樞軸/.test(s)) return "樞軸突破";
    if (/SuperTrend|超級趨勢|ATR.*(趨勢|網格)/i.test(s)) return "超級趨勢";
    if (/布林.*(突破|擠壓)|BB Squeeze|布林帶突破/i.test(s)) return "布林突破";
    if (/肯特納/.test(s)) return "肯特納突破";
    if (/VSA|成交量價差|量價/.test(s)) return "量價共振";
    if (/唐奇安/.test(s)) return "唐奇安突破";
    if (/Dual Thrust/i.test(s)) return "區間突破";
    if (/量均/.test(s)) return "量均突破";
    if (/布林/.test(s)) return "布林回歸";
    if (/MACD/.test(s)) return "MACD";
    if (/EMA|均線/.test(s)) return "均線交叉";
    if (/RSI/.test(s)) return "RSI";
    if (/ROC/.test(s)) return "動能突破";
    const zh = s.replace(/[A-Za-z0-9_\-\s().]/g, "");
    if (zh.length >= 2) return zh.slice(0, 4);
    return s.slice(0, 4) || "量化策略";
  }

  function fmtSpeechPx(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return "";
    if (x >= 100) return Math.round(x).toLocaleString("en-US");
    if (x >= 1) return x.toFixed(2).replace(/\.?0+$/, "") || x.toFixed(2);
    if (x >= 0.01) return x.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
    return String(x);
  }

  function isClose(ev) {
    if (ev && ev.kind === "close_agg") return true;
    return String(ev.event || "").toLowerCase() === "close" || /平倉|Close/i.test(String(ev.action || ""));
  }

  function closePnlAbs(ev) {
    const pnl = Number(ev && ev.pnl_pct);
    return Number.isFinite(pnl) ? Math.abs(pnl) : 0;
  }

  /** Friction / reset closes with ~0% PnL — never render or speak. */
  function isZeroValueClose(ev) {
    if (!ev || !isClose(ev) || ev.kind === "close_agg") return false;
    if (!/平倉|Close/i.test(String(ev.action || "")) && String(ev.event || "").toLowerCase() !== "close") {
      return false;
    }
    const pnl = Number(ev.pnl_pct);
    if (!Number.isFinite(pnl)) return true; /* missing PnL on close = noise */
    return Math.abs(pnl) < 0.05;
  }

  /**
   * Consumer pipeline: drop 0.0% closes, then fold same-second mass micro-closes
   * into one radar summary row.
   */
  function pruneAndCollapseEvents(events) {
    if (!events || !events.length) return [];
    const kept = [];
    events.forEach((ev) => {
      if (isZeroValueClose(ev)) return;
      kept.push(ev);
    });

    const opens = [];
    const closes = [];
    kept.forEach((ev) => {
      if (isClose(ev) && ev.kind !== "close_agg") closes.push(ev);
      else opens.push(ev);
    });

    const buckets = {};
    const order = [];
    closes.forEach((ev) => {
      const sec = Math.floor(Number(ev.ts) || 0);
      const key = [sec, String(ev.name || ""), String(ev.interval || "1h")].join("|");
      if (!buckets[key]) {
        buckets[key] = [];
        order.push(key);
      }
      buckets[key].push(ev);
    });

    const out = opens.slice();
    order.forEach((key) => {
      const group = buckets[key];
      const allMicro = group.every((e) => closePnlAbs(e) < 0.5);
      if (group.length >= 3 && allMicro) {
        let sum = 0;
        let n = 0;
        group.forEach((e) => {
          const p = Number(e.pnl_pct);
          if (Number.isFinite(p)) {
            sum += p;
            n += 1;
          }
        });
        const avg = n ? sum / n : 0;
        const head = group[0];
        out.push({
          kind: "close_agg",
          key: "agg|" + key,
          ts: head.ts,
          symbol: "ALL",
          name: head.name || "量化策略",
          interval: head.interval || "1h",
          strategyId: head.strategyId,
          event: "close",
          action: "平倉",
          side: head.side,
          pnl_pct: avg,
          aggCount: group.length,
          avgPnl: avg,
        });
        return;
      }
      group.forEach((e) => out.push(e));
    });

    out.sort((a, b) => (b.ts || 0) - (a.ts || 0));
    return out;
  }

  function isBuy(ev) {
    const side = String(ev.side || ev.action || "").toUpperCase();
    if (side.indexOf("SHORT") >= 0 || side.indexOf("SELL") >= 0) return false;
    return true;
  }

  function normSym(s) {
    return String(s || "")
      .toUpperCase()
      .replace(/USDT$/i, "USDT")
      .replace(/[^A-Z0-9]/g, "");
  }

  function inWatch(sym) {
    const n = normSym(sym);
    if (!n) return false;
    return state.watch.some((s) => normSym(s) === n);
  }

  function loadWatch() {
    try {
      const raw = JSON.parse(localStorage.getItem(WATCH_KEY) || "null");
      if (Array.isArray(raw) && raw.length) {
        const mapped = [];
        raw.forEach((s) => {
          const aliased = COIN_ALIAS[s] || s;
          const n = normSym(aliased);
          const hit = ALL_COINS.find((c) => normSym(c) === n);
          if (hit && mapped.indexOf(hit) < 0) mapped.push(hit);
        });
        if (mapped.length) return mapped;
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

  function loadCum() {
    try {
      const raw = JSON.parse(localStorage.getItem("qa_live_cum_pnl_v1") || "{}");
      return {
        bySym: raw.bySym && typeof raw.bySym === "object" ? raw.bySym : {},
        byStrat: raw.byStrat && typeof raw.byStrat === "object" ? raw.byStrat : {},
      };
    } catch {
      return { bySym: {}, byStrat: {} };
    }
  }

  function saveCum() {
    try {
      localStorage.setItem("qa_live_cum_pnl_v1", JSON.stringify(state.cum));
    } catch {
      /* private */
    }
  }

  function bumpCum(ev) {
    if (!isClose(ev) || isZeroValueClose(ev) || (ev && ev.kind === "close_agg")) return;
    const pnl = Number(ev.pnl_pct);
    if (!Number.isFinite(pnl) || Math.abs(pnl) < 0.05) return;
    const sk = String(ev.symbol || "_");
    const nk = String(ev.name || "_");
    state.cum.bySym[sk] = (Number(state.cum.bySym[sk]) || 0) + pnl;
    state.cum.byStrat[nk] = (Number(state.cum.byStrat[nk]) || 0) + pnl;
    saveCum();
  }

  function cumFor(ev) {
    const a = Number(state.cum.byStrat[ev.name]) || 0;
    const b = Number(state.cum.bySym[ev.symbol]) || 0;
    return Math.max(a, b);
  }

  /* ---- voice: single FIFO AudioQueue (never parallel speak) ---- */
  const AUDIO_GAP_MS = 800;
  const AUDIO_STORM_N = 5;
  const STORM_LINE =
    "當前發生大面積整點異動，已觸發多套策略，請查閱戰情面板。";

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
      try {
        window.speechSynthesis.cancel();
      } catch {
        /* */
      }
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "zh-TW";
      u.rate = 1.3;
      u.pitch = 1.06;
      u.volume = 1;
      const voice = pickTwVoice();
      if (voice) u.voice = voice;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      u.onend = finish;
      u.onerror = finish;
      try {
        window.speechSynthesis.speak(u);
      } catch {
        finish();
        return;
      }
      /* some browsers stall without onend — hard cap */
      setTimeout(finish, Math.min(12000, 1800 + String(text).length * 80));
    });
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function clearAudioQueue() {
    state.queue = [];
    try {
      if (window.speechSynthesis) window.speechSynthesis.cancel();
    } catch {
      /* */
    }
  }

  async function drainQueue() {
    if (state.speaking) return;
    state.speaking = true;
    while (state.queue.length && state.voiceOn) {
      /* Storm throttle: backlog > 5 → one summary, drop the rest */
      if (state.queue.length > AUDIO_STORM_N) {
        state.queue = [
          {
            text: STORM_LINE,
            chime: true,
            pauseAfter: AUDIO_GAP_MS,
            storm: true,
          },
        ];
      }
      const raw = state.queue.shift();
      const job = typeof raw === "string" ? { text: raw, chime: true } : raw || {};
      if (!job.text) continue;
      if (job.chime) {
        await playMrtChime();
        if (!state.voiceOn) break;
      }
      await speakLine(job.text);
      if (!state.voiceOn) break;
      const gap = job.pauseAfter != null ? job.pauseAfter : AUDIO_GAP_MS;
      if (gap > 0 && state.queue.length) await sleep(gap);
    }
    state.speaking = false;
    if (state.queue.length && state.voiceOn) drainQueue();
  }

  function enqueueVoice(text, opts) {
    if (!state.voiceOn || !text) return;
    const o = opts || {};
    if (state.queue.length >= AUDIO_STORM_N && !o.force) {
      state.queue = [
        {
          text: STORM_LINE,
          chime: true,
          pauseAfter: AUDIO_GAP_MS,
          storm: true,
        },
      ];
      drainQueue();
      return;
    }
    state.queue.push({
      text: text,
      chime: o.chime !== false,
      pauseAfter: o.pauseAfter != null ? o.pauseAfter : AUDIO_GAP_MS,
    });
    drainQueue();
  }

  function enqueueBurst(lines) {
    if (!state.voiceOn || !lines || !lines.length) return;
    if (lines.length > AUDIO_STORM_N) {
      clearAudioQueue();
      state.queue.push({
        text: STORM_LINE,
        chime: true,
        pauseAfter: AUDIO_GAP_MS,
        storm: true,
      });
      drainQueue();
      return;
    }
    lines.forEach((text, i) => {
      if (!text) return;
      state.queue.push({
        text: text,
        chime: i === 0,
        pauseAfter: AUDIO_GAP_MS,
      });
    });
    drainQueue();
  }

  function voiceCloseLine(ev) {
    const when = fmt12hSpeech(ev.ts || Date.now());
    const coin = coinSpeech(ev.symbol);
    const pnl = Number(ev.pnl_pct);
    if (Number.isFinite(pnl) && pnl > 0) {
      return when + "，" + coin + "平倉，獲利 " + pnl.toFixed(1) + "%。";
    }
    const cum = cumFor(ev);
    if (cum > 0) {
      return when + "，" + coin + "平倉離場，本策略累計獲利 " + cum.toFixed(1) + "%。";
    }
    return when + "，" + coin + "平倉離場。";
  }

  function voiceOpenGroup(events) {
    if (!events || !events.length) return "";
    const head = events[0];
    const when = fmt12hSpeech(head.ts || Date.now());
    const alias = stratAlias(head.name);
    const buy = isBuy(head);
    const act = buy ? "買入" : "賣出";
    if (events.length === 1) {
      return (
        when +
        "，" +
        alias +
        "，" +
        coinSpeech(head.symbol) +
        "，" +
        act +
        "，現價 " +
        fmtSpeechPx(head.price) +
        "。"
      );
    }
    const pairs = events
      .map((e) => coinSpeech(e.symbol) + " 現價 " + fmtSpeechPx(e.price))
      .join("，");
    return when + "，" + alias + "，" + act + "：" + pairs + "。";
  }

  function announceEvents(events) {
    if (!events || !events.length || !state.voiceOn) return;
    const actionable = (events || []).filter((ev) => {
      if (!ev || ev.kind === "close_agg") return false;
      if (isZeroValueClose(ev)) return false;
      return true;
    });
    if (!actionable.length) return;
    /* Hourly storm: collapse audio to one line; tape still paints fully */
    if (actionable.length > AUDIO_STORM_N) {
      actionable.filter((e) => isClose(e) && !isZeroValueClose(e)).forEach((ev) => bumpCum(ev));
      clearAudioQueue();
      enqueueVoice(STORM_LINE, { chime: true, force: true });
      return;
    }
    const buckets = {};
    const order = [];
    actionable
      .filter((e) => !isClose(e))
      .forEach((ev) => {
        const key = [
          stratAlias(ev.name),
          isBuy(ev) ? "B" : "S",
          String(ev.interval || ""),
          String(Math.floor((Number(ev.ts) || 0) / 5) * 5),
        ].join("|");
        if (!buckets[key]) {
          buckets[key] = [];
          order.push(key);
        }
        buckets[key].push(ev);
      });
    const lines = [];
    order.forEach((key) => {
      const line = voiceOpenGroup(buckets[key]);
      if (line) lines.push(line);
    });
    actionable.filter(isClose).forEach((ev) => {
      bumpCum(ev);
      const line = voiceCloseLine(ev);
      if (line) lines.push(line);
    });
    if (lines.length > AUDIO_STORM_N) {
      clearAudioQueue();
      enqueueVoice(STORM_LINE, { chime: true, force: true });
      return;
    }
    enqueueBurst(lines);
  }

  function voiceForEvent(ev) {
    if (!ev) return "";
    if (isClose(ev)) return voiceCloseLine(ev);
    return voiceOpenGroup([ev]);
  }

  async function icebreakerVoice() {
    if (!state.events.length) {
      try {
        await refreshFeed();
      } catch {
        /* optional */
      }
    }
    const rows = state.events
      .slice()
      .filter(
        (e) =>
          e &&
          e.kind !== "close_agg" &&
          !isZeroValueClose(e) &&
          (isClose(e) || String(e.event || "open").toLowerCase() === "open" || e.side || e.action),
      )
      .sort((a, b) => (a.ts || 0) - (b.ts || 0))
      .slice(-3);
    const lines = rows.map(voiceForEvent).filter(Boolean);
    if (lines.length) enqueueBurst(lines);
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
    const btn = document.getElementById("liveMuteBtn");
    if (!btn || btn.getAttribute("data-bound") === "1") return;
    btn.setAttribute("data-bound", "1");
    state.voiceOn = !loadVoicePref();
    paintVoiceBtn();
    let seen = false;
    try {
      seen = localStorage.getItem(HINT_KEY) === "1";
    } catch {
      seen = false;
    }
    showHint(!state.voiceOn && !seen);
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
        icebreakerVoice();
      } else {
        clearAudioQueue();
        state.speaking = false;
      }
    });
    const hint = document.getElementById("voiceHint");
    if (hint) hint.addEventListener("click", () => btn.click());
    if (window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = function () {};
    }
    if (state.voiceOn) icebreakerVoice();
  }

  /* ---- canvas sparklines (fixed height for mobile) ---- */
  function hash01(s) {
    let h = 2166136261;
    const t = String(s || "");
    for (let i = 0; i < t.length; i++) {
      h ^= t.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0) / 4294967296;
  }

  function basePx(sym) {
    const b = Number(BASE_PX[sym]);
    if (Number.isFinite(b) && b > 0) return b;
    return 10 + hash01(sym) * 90;
  }

  function synthHistory(sym, last) {
    const end = Number.isFinite(last) && last > 0 ? last : basePx(sym);
    const now = Date.now();
    const rows = [];
    let px = end;
    const amp = 0.00115;
    for (let i = KLINE_N - 1; i >= 0; i--) {
      const n = Math.sin((i + hash01(sym) * 12) / 7) * amp + (hash01(sym + ":" + i) - 0.5) * amp;
      px = px / (1 + n);
    }
    for (let i = 0; i < KLINE_N; i++) {
      const n = Math.sin((i + hash01(sym) * 12) / 7) * amp + (hash01(sym + ":" + i) - 0.5) * amp;
      px = px * (1 + n);
      rows.push({ t: now - (KLINE_N - 1 - i) * 60000, c: px });
    }
    if (rows.length) rows[rows.length - 1].c = end;
    return rows;
  }

  function ensureKlines(sym) {
    const rows = state.klines[sym];
    if (rows && rows.length >= 2) return rows;
    const px = Number((state.tickers[sym] && state.tickers[sym].last) || state.lastPx[sym] || basePx(sym));
    const hist = synthHistory(sym, px);
    state.klines[sym] = hist;
    if (state.lastPx[sym] == null) state.lastPx[sym] = hist[hist.length - 1].c;
    return hist;
  }

  function seedFailSafe() {
    ALL_COINS.forEach((sym) => {
      const px = Number(state.lastPx[sym] || basePx(sym));
      ensureKlines(sym);
      const cur = state.tickers[sym] || {};
      if (cur.last == null) {
        cur.last = px;
        if (cur.chg == null) cur.chg = (hash01(sym) - 0.5) * 2.4;
        state.tickers[sym] = cur;
        state.lastPx[sym] = px;
      }
    });
  }

  function bumpKline(sym, px) {
    if (!Number.isFinite(px)) return;
    const rows = ensureKlines(sym);
    const now = Date.now();
    const last = rows[rows.length - 1];
    if (last && now - last.t < 60000) {
      last.c = px;
      last.t = now;
    } else {
      rows.push({ t: now, c: px });
      if (rows.length > KLINE_N + 4) rows.splice(0, rows.length - KLINE_N);
    }
    state.klines[sym] = rows;
  }

  function fmtAxisPx(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return "—";
    const ax = Math.abs(x);
    if (ax >= 1000) return x.toLocaleString("en-US", { maximumFractionDigits: 1 });
    if (ax >= 1) return x.toFixed(2);
    if (ax >= 0.01) return x.toFixed(4);
    if (ax >= 0.0001) return x.toFixed(6);
    /* PEPE-class micros: scientific so the axis stays readable in a narrow pad */
    return x.toExponential(2);
  }

  function uniqueYTicks(min, max, last) {
    const span = max - min || 1;
    const raw = [max, max - span / 3, last, min + span / 3, min];
    const out = [];
    raw.forEach((v) => {
      if (!Number.isFinite(v)) return;
      if (out.some((x) => Math.abs(x - v) / span < 0.08)) return;
      out.push(v);
    });
    out.sort((a, b) => b - a);
    return out.slice(0, 4);
  }

  function drawSparkOn(canvas, sym, tall) {
    if (!canvas) return;
    const rows = ensureKlines(sym);
    const closes = rows.map((r) => r.c);
    const livePx = Number((state.tickers[sym] && state.tickers[sym].last) || state.lastPx[sym]);
    if (Number.isFinite(livePx) && closes.length && Math.abs(closes[closes.length - 1] - livePx) > 0) {
      closes.push(livePx);
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const parentW = canvas.parentElement ? canvas.parentElement.clientWidth : 0;
    const cssW = Math.max(160, canvas.clientWidth || parentW || 280);
    const cssH = tall
      ? Math.max(240, canvas.clientHeight || (canvas.parentElement && canvas.parentElement.clientHeight) || 300)
      : Math.max(160, canvas.clientHeight || 160);
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
      const hist = synthHistory(sym, Number.isFinite(livePx) ? livePx : basePx(sym));
      hist.forEach((r) => closes.push(r.c));
    }
    const min = Math.min.apply(null, closes);
    const max = Math.max.apply(null, closes);
    const span = max - min || Math.abs(min) * 0.001 || 1e-12;
    const last = closes[closes.length - 1];
    const first = closes[0];
    const padL = tall ? 10 : 8;
    ctx.font = (tall ? "11px" : "10px") + " Roboto Mono, monospace";
    const labelW = Math.max(
      ctx.measureText(fmtAxisPx(last)).width,
      ...uniqueYTicks(min, max, last).map((v) => ctx.measureText(fmtAxisPx(v)).width),
      36,
    );
    const padR = Math.max(tall ? 56 : 48, Math.ceil(labelW) + 10);
    const padT = tall ? 14 : 10;
    const padB = tall ? 24 : 20;
    const w = cssW - padL - padR;
    const h = cssH - padT - padB;
    const up = last >= first;
    const stroke = up ? "#10b981" : "#ef4444";
    const fill = up ? "rgba(16,185,129,0.14)" : "rgba(239,68,68,0.12)";
    const nSeg = Math.max(closes.length - 1, 1);
    const xAt = (i) => padL + (i / nSeg) * w;
    const yAt = (px) => padT + h - ((px - min) / span) * h;

    const yTicks = uniqueYTicks(min, max, last);
    ctx.strokeStyle = "#f1f5f9";
    ctx.lineWidth = 1;
    yTicks.forEach((v) => {
      const y = yAt(v);
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + w, y);
      ctx.stroke();
    });
    [0, 0.5, 1].forEach((p) => {
      const x = padL + p * w;
      ctx.beginPath();
      ctx.moveTo(x, padT);
      ctx.lineTo(x, padT + h);
      ctx.stroke();
    });

    ctx.beginPath();
    closes.forEach((c, i) => {
      const x = xAt(i);
      const y = yAt(c);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.lineTo(padL + w, padT + h);
    ctx.lineTo(padL, padT + h);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.beginPath();
    closes.forEach((c, i) => {
      const x = xAt(i);
      const y = yAt(c);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = stroke;
    ctx.lineWidth = tall ? 2.25 : 2;
    ctx.stroke();

    ctx.fillStyle = "#94a3b8";
    ctx.font = (tall ? "11px" : "10px") + " Roboto Mono, monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    yTicks.forEach((v) => {
      const y = yAt(v);
      const label = fmtAxisPx(v);
      const isLast = Math.abs(v - last) / span < 0.08;
      ctx.fillStyle = isLast ? (up ? "#059669" : "#dc2626") : "#94a3b8";
      ctx.fillText(label, padL + w + 6, y);
    });

    const xLabels = [
      { p: 0, text: "-60m" },
      { p: 0.5, text: "-30m" },
      { p: 1, text: "Now" },
    ];
    ctx.fillStyle = "#94a3b8";
    ctx.textBaseline = "top";
    xLabels.forEach((lb) => {
      const x = padL + lb.p * w;
      ctx.textAlign = lb.p === 0 ? "left" : lb.p === 1 ? "right" : "center";
      ctx.fillText(lb.text, x, padT + h + 6);
    });

    const marks = state.events.filter(
      (e) => e && e.symbol === sym && e.kind !== "close_agg" && !isZeroValueClose(e) && Date.now() / 1000 - e.ts < HOUR_S,
    );
    marks.forEach((ev) => {
      const signalPx = Number(ev.price);
      let idx = closes.length - 1;
      if (rows.length) {
        const tms = Number(ev.ts) > 1e12 ? Number(ev.ts) : Number(ev.ts) * 1000;
        let best = 0;
        let dist = Infinity;
        rows.forEach((r, i) => {
          const d = Math.abs(Number(r.t) - tms);
          if (d < dist) {
            dist = d;
            best = i;
          }
        });
        idx = Math.min(best, closes.length - 1);
      }
      /* Snap to the polyline — never use raw signal px for Y (causes floating dots). */
      const linePx = Number(closes[idx]);
      if (!Number.isFinite(linePx)) return;
      const x = xAt(idx);
      const y = yAt(linePx);
      const buy = isBuy(ev) && !isClose(ev);
      const close = isClose(ev);
      ctx.beginPath();
      ctx.arc(x, y, tall ? 5 : 4.5, 0, Math.PI * 2);
      ctx.fillStyle = close ? (Number(ev.pnl_pct) > 0 ? "#10b981" : "#ef4444") : buy ? "#10b981" : "#ef4444";
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      const tagPx = Number.isFinite(signalPx) ? signalPx : linePx;
      const tag = close
        ? Number(ev.pnl_pct) > 0
          ? "平倉 +" + Number(ev.pnl_pct).toFixed(1) + "%"
          : "平倉"
        : (buy ? "BUY @" : "SELL @") + " " + fmtAxisPx(tagPx);
      ctx.font = "10px Roboto Mono, monospace";
      const tw = ctx.measureText(tag).width;
      let lx = x + 6;
      let ly = y - 10;
      if (ly < padT + 10) ly = y + 14;
      if (lx + tw > padL + w - 4) lx = Math.max(padL, x - tw - 6);
      if (lx + tw > padL + w) lx = padL + w - tw;
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = "rgba(248,250,252,0.92)";
      ctx.fillRect(lx - 2, ly - 10, tw + 4, 13);
      ctx.fillStyle = close
        ? Number(ev.pnl_pct) > 0
          ? "#059669"
          : "#dc2626"
        : buy
          ? "#059669"
          : "#dc2626";
      ctx.fillText(tag, lx, ly);
    });
  }

  function drawSpark(sym) {
    const card = document.querySelector('.coin-card[data-sym="' + sym + '"]');
    const canvas = card ? card.querySelector("canvas[data-spark]") : document.querySelector('canvas[data-spark="' + sym + '"]');
    drawSparkOn(canvas, sym, !!(card && card.classList.contains("is-hero")));
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

  function paintModalLive(sym) {
    if (!sym || state.modalSym !== sym) return;
    const tk = state.tickers[sym] || {};
    const px = tk.last != null ? tk.last : state.lastPx[sym];
    const pxEl = document.getElementById("coinModalPx");
    const chgEl = document.getElementById("coinModalChg");
    const prev = Number(pxEl && pxEl.getAttribute("data-last"));
    if (pxEl && Number.isFinite(Number(px))) {
      flashPx(pxEl, Number(px), prev);
      pxEl.setAttribute("data-last", String(px));
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
    drawSparkOn(document.getElementById("coinModalSpark"), sym, true);
  }

  const ENGINE_TO_PLAZA = {
    pivot: "strat_pivot_break_01",
    vol_ma: "strat_vol_ma_01",
    dual: "strat_dual_thrust_01",
    kelt: "strat_keltner_break_01",
    don_20: "strat_donchian_20_01",
    don_10: "strat_donchian_10_01",
    bb_sqz: "strat_bb_squeeze_01",
    bb_reb: "strat_bb_rebound_01",
    bb_wide: "strat_bb_wide_01",
    st_atr: "strat_supertrend_01",
    atr_grid: "strat_atr_grid_01",
    vsa: "strat_vsa_01",
    ema_12_26: "strat_ema_dual_01",
    ema_5_13: "strat_ema_fast_01",
    ema_triple: "strat_ema_triple_01",
    trend50: "strat_ema50_trend_01",
    rsi_x: "strat_rsi_cross_01",
    rsi_div: "strat_rsi_div_01",
    macd_h: "strat_macd_hist_01",
    macd_s: "strat_macd_signal_01",
    roc10: "strat_roc10_01",
    roc20: "strat_roc20_01",
    combo: "strat_combo_mom_01",
  };

  const NAME_TO_PLAZA = {
    樞軸點突破: "strat_pivot_break_01",
    樞軸點: "strat_pivot_break_01",
    樞軸快線: "strat_pivot_break_01",
    量均突破: "strat_vol_ma_01",
    "Dual Thrust": "strat_dual_thrust_01",
    Dual: "strat_dual_thrust_01",
    DualThrust快: "strat_dual_thrust_01",
    肯特納突破: "strat_keltner_break_01",
    肯特納通道: "strat_keltner_break_01",
    肯特納快: "strat_keltner_break_01",
    唐奇安突破: "strat_donchian_20_01",
    唐奇安突破20: "strat_donchian_20_01",
    唐奇安突破10: "strat_donchian_10_01",
    唐奇安10: "strat_donchian_10_01",
    唐奇安14: "strat_donchian_20_01",
    布林擠壓突破: "strat_bb_squeeze_01",
    布林擠壓: "strat_bb_squeeze_01",
    布林均值回歸: "strat_bb_rebound_01",
    布林寬帶回歸: "strat_bb_wide_01",
    布林回歸16: "strat_bb_wide_01",
    ATR超級趨勢: "strat_supertrend_01",
    ATR趨勢: "strat_supertrend_01",
    ATR波動網格: "strat_atr_grid_01",
    ATR網格10: "strat_atr_grid_01",
    成交量價差VSA: "strat_vsa_01",
    EMA雙均交叉: "strat_ema_dual_01",
    EMA快線交叉: "strat_ema_fast_01",
    EMA三均共振: "strat_ema_triple_01",
    EMA50趨勢突破: "strat_ema50_trend_01",
    EMA821: "strat_ema_fast_01",
    RSI超賣超買交叉: "strat_rsi_cross_01",
    RSI超賣修復: "strat_rsi_cross_01",
    RSI背離代理: "strat_rsi_div_01",
    RSI背離: "strat_rsi_div_01",
    MACD柱翻轉: "strat_macd_hist_01",
    MACD信號交叉: "strat_macd_signal_01",
    MACD動量: "strat_macd_signal_01",
    ROC10動能: "strat_roc10_01",
    ROC20動能: "strat_roc20_01",
    ROC8動能: "strat_roc10_01",
    複合動能確認: "strat_combo_mom_01",
    複合動能: "strat_combo_mom_01",
    複合動能B: "strat_combo_mom_01",
    量價突破: "strat_vol_ma_01",
  };

  function plazaIdFor(ev) {
    const raw = String((ev && (ev.plazaId || ev.strategyId || ev.strategy_id)) || "");
    if (/^(strat_|ai_)/.test(raw)) return raw;
    const fams = Object.keys(ENGINE_TO_PLAZA).sort((a, b) => b.length - a.length);
    for (let i = 0; i < fams.length; i += 1) {
      const fam = fams[i];
      if (raw === fam || raw.indexOf(fam + "_") === 0) return ENGINE_TO_PLAZA[fam];
    }
    const name = String((ev && ev.name) || "");
    if (NAME_TO_PLAZA[name]) return NAME_TO_PLAZA[name];
    const compact = name.replace(/[\s.\-()]/g, "");
    if (NAME_TO_PLAZA[compact]) return NAME_TO_PLAZA[compact];
    const keys = Object.keys(NAME_TO_PLAZA);
    for (let i = 0; i < keys.length; i += 1) {
      if (name.indexOf(keys[i]) >= 0 || keys[i].indexOf(name) >= 0) return NAME_TO_PLAZA[keys[i]];
    }
    return "strat_pivot_break_01";
  }

  function stratAnchor(ev) {
    const id = plazaIdFor(ev);
    const label = escapeHtml(ev.name || "量化策略");
    return (
      '<a class="tape-strat" href="./strategies.html?id=' +
      encodeURIComponent(id) +
      '">' +
      label +
      "</a>"
    );
  }

  function miniLineHtml(ev) {
    if (ev.kind === "close_agg") {
      const avg = Number(ev.avgPnl != null ? ev.avgPnl : ev.pnl_pct);
      return (
        escapeHtml(fmt12h(ev.ts)) +
        " 到期平倉×" +
        escapeHtml(String(ev.aggCount || 0)) +
        " · 均 " +
        escapeHtml(Number.isFinite(avg) ? fmtPnl(avg) : "—") +
        " · " +
        stratAnchor(ev)
      );
    }
    const close = isClose(ev);
    const buy = isBuy(ev);
    const pnl = Number(ev.pnl_pct);
    let act;
    if (close) {
      act = "平倉 " + (Number.isFinite(pnl) ? fmtPnl(pnl) : "—");
    } else {
      act = (buy ? "多頭開倉" : "空頭開倉") + " @ " + fmtPx(ev.price);
    }
    return escapeHtml(fmt12h(ev.ts)) + " " + escapeHtml(act) + " · " + stratAnchor(ev);
  }

  function paintMiniTapes() {
    const now = Date.now() / 1000;
    state.watch.forEach((sym) => {
      const el = document.querySelector('[data-mini="' + sym + '"]');
      if (!el) return;
      const rows = state.events
        .filter((e) => {
          if (!e || now - e.ts > HOUR_S) return false;
          if (e.kind === "close_agg") return false;
          if (isZeroValueClose(e)) return false;
          return e.symbol === sym;
        })
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
          return '<li class="' + cls + '">' + miniLineHtml(ev) + "</li>";
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
    if (state.modalSym) paintModalLive(state.modalSym);
  }

  function applyGridLayout(grid) {
    if (!grid) return;
    const n = state.watch.length;
    grid.setAttribute("data-n", String(n));
    const needHero = n === 3 || n === 5 || n === 7;
    const cards = Array.prototype.slice.call(grid.querySelectorAll(".coin-card:not(.is-leaving)"));
    cards.forEach((c, i) => {
      c.classList.toggle("is-hero", needHero && i === 0);
    });
  }

  function flipAnimate(firstRects) {
    firstRects.forEach(({ el, rect }) => {
      if (!el.isConnected) return;
      const last = el.getBoundingClientRect();
      const dx = rect.left - last.left;
      const dy = rect.top - last.top;
      const sx = rect.width && last.width ? rect.width / last.width : 1;
      const sy = rect.height && last.height ? rect.height / last.height : 1;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01) {
        return;
      }
      el.style.transition = "none";
      el.style.transformOrigin = "top left";
      el.style.transform = "translate(" + dx + "px," + dy + "px) scale(" + sx + "," + sy + ")";
      requestAnimationFrame(() => {
        el.style.transition = "transform 0.35s cubic-bezier(0.4, 0, 0.2, 1)";
        el.style.transform = "";
        const done = () => {
          el.style.transition = "";
          el.style.transform = "";
          el.style.transformOrigin = "";
          el.removeEventListener("transitionend", done);
        };
        el.addEventListener("transitionend", done);
        setTimeout(done, 400);
      });
    });
  }

  function renderGrid() {
    const grid = document.getElementById("coinGrid");
    if (!grid) return;
    if (!state.watch.length) {
      grid.removeAttribute("data-n");
      grid.innerHTML =
        '<p class="radar-idle">' +
        escapeHtml(t("watchEmpty", "自選組合為空，請點「添加幣種」恢復監控")) +
        "</p>";
      paintAddPanel();
      return;
    }
    grid.innerHTML = state.watch.map(cardHtml).join("");
    applyGridLayout(grid);
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
    const grid = document.getElementById("coinGrid");
    const card = grid && grid.querySelector('.coin-card[data-sym="' + sym + '"]');
    if (state.modalSym === sym) closeModal();

    if (!card || !grid) {
      state.watch = state.watch.filter((s) => s !== sym);
      saveWatch();
      renderGrid();
      paintRadar();
      return;
    }

    const others = Array.prototype.slice
      .call(grid.querySelectorAll(".coin-card"))
      .filter((c) => c !== card);
    const firstRects = others.map((el) => ({ el: el, rect: el.getBoundingClientRect() }));

    card.classList.add("is-leaving");
    setTimeout(() => {
      state.watch = state.watch.filter((s) => s !== sym);
      saveWatch();
      if (card.parentNode) card.parentNode.removeChild(card);
      applyGridLayout(grid);
      paintAddPanel();
      paintRadar();
      flipAnimate(firstRects);
      requestAnimationFrame(() => {
        paintCardsMeta();
      });
    }, 300);
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
      if (ev.target.closest(".tape-strat")) return;
      const card = ev.target.closest(".coin-card");
      if (card && !card.classList.contains("is-leaving")) openModal(card.getAttribute("data-sym"));
    });
  }

  function bindAddUi() {
    const btn = document.getElementById("cmdAddBtn");
    const panel = document.getElementById("cmdAddPanel");
    if (!btn || !panel || btn.getAttribute("data-bound") === "1") return;
    btn.setAttribute("data-bound", "1");
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

  /* ---- modal zoom ---- */
  function openModal(sym) {
    if (!sym || !inWatch(sym)) return;
    state.modalSym = sym;
    const bg = document.getElementById("coinModalBg");
    const title = document.getElementById("coinModalTitle");
    const meta = document.getElementById("coinModalMeta");
    const marks = document.getElementById("coinModalMarks");
    if (!bg) return;
    const tk = state.tickers[sym] || {};
    const chg = Number(tk.chg);
    if (title) title.textContent = pairLabel(sym);
    paintModalLive(sym);
    if (meta) {
      meta.innerHTML =
        "<span>24H " +
        (Number.isFinite(chg) ? (chg >= 0 ? "+" : "") + chg.toFixed(2) + "%" : "—") +
        "</span>" +
        "<span>監控中 · 1m 折線 · 即時跳動</span>";
    }
    const hourMarks = state.events.filter((e) => e.symbol === sym && Date.now() / 1000 - e.ts <= HOUR_S);
    if (marks) {
      marks.innerHTML = hourMarks.length
        ? hourMarks
            .slice(0, 8)
            .map((e) => {
              const buy = isBuy(e);
              const close = isClose(e);
              return (
                "<div>" +
                fmtTime(e.ts) +
                " · " +
                (close
                  ? Number.isFinite(Number(e.pnl_pct))
                    ? (Number(e.pnl_pct) > 0 ? "🟢 " : "🔴 ") + "平倉 " + fmtPnl(e.pnl_pct)
                    : "平倉"
                  : (buy ? "🟢 BUY" : "🔴 SELL") + " @ " + fmtPx(e.price)) +
                " · " +
                stratAnchor(e) +
                "</div>"
              );
            })
            .join("")
        : "<div>近 1 小時尚無開倉標記</div>";
    }
    bg.classList.add("is-open");
  }

  function closeModal() {
    state.modalSym = null;
    const bg = document.getElementById("coinModalBg");
    if (bg) bg.classList.remove("is-open");
  }

  function bindModal() {
    const bg = document.getElementById("coinModalBg");
    const x = document.getElementById("coinModalClose");
    if (bg && bg.getAttribute("data-bound") === "1") return;
    if (bg) bg.setAttribute("data-bound", "1");
    if (x) x.addEventListener("click", closeModal);
    if (bg) {
      bg.addEventListener("click", (ev) => {
        if (ev.target === bg) closeModal();
      });
    }
    if (!handlers.keydown) {
      handlers.keydown = (ev) => {
        if (ev.key === "Escape") closeModal();
      };
      document.addEventListener("keydown", handlers.keydown);
    }
  }

  function withCacheBust(url) {
    const u = String(url || "");
    if (!u) return u;
    if (/[?&]_t=/.test(u) || /[?&]t=\d/.test(u)) return u;
    return u + (u.indexOf("?") >= 0 ? "&" : "?") + "_t=" + Date.now();
  }

  async function fetchJson(url) {
    const res = await fetch(withCacheBust(url), {
      cache: "no-store",
      headers: { Accept: "application/json", "Cache-Control": "no-cache" },
    });
    if (!res.ok) throw new Error(String(res.status));
    return res.json();
  }

  async function loadKlines(sym) {
    const urls = [
      "https://data-api.binance.vision/api/v3/klines?symbol=" + encodeURIComponent(sym) + "&interval=1m&limit=60",
      "https://api.binance.com/api/v3/klines?symbol=" + encodeURIComponent(sym) + "&interval=1m&limit=60",
    ];
    for (let i = 0; i < urls.length; i++) {
      try {
        const rows = await fetchJson(urls[i]);
        if (Array.isArray(rows) && rows.length >= 2) {
          return rows.map((r) => ({ t: Number(r[0]), c: Number(r[4]) })).filter((r) => Number.isFinite(r.c));
        }
      } catch {
        /* next host */
      }
    }
    try {
      const inst = String(sym).replace("USDT", "") + "-USDT";
      const data = await fetchJson(
        "https://www.okx.com/api/v5/market/candles?instId=" + encodeURIComponent(inst) + "&bar=1m&limit=60",
      );
      const rows = (data.data || []).slice().reverse();
      if (rows.length >= 2) return rows.map((r) => ({ t: Number(r[0]), c: Number(r[4]) })).filter((r) => Number.isFinite(r.c));
    } catch {
      /* synth remains */
    }
    return ensureKlines(sym);
  }

  function applyTick(sym, last, chg) {
    if (state.disposed || !sym || !Number.isFinite(last)) return;
    state.lastPx[sym] = last;
    const cur = state.tickers[sym] || {};
    cur.last = last;
    if (Number.isFinite(chg)) cur.chg = chg;
    state.tickers[sym] = cur;
    bumpKline(sym, last);
    state.pendingTicks[sym] = true;
    schedulePaintFlush();
  }

  function schedulePaintFlush() {
    if (state.disposed || state.paintTimer) return;
    const wait = Math.max(0, TICK_MS - (Date.now() - (state.lastPaintAt || 0)));
    state.paintTimer = setTimeout(() => {
      state.paintTimer = 0;
      state.lastPaintAt = Date.now();
      const syms = Object.keys(state.pendingTicks);
      state.pendingTicks = {};
      if (!syms.length) return;
      if (state.paintRaf) cancelAnimationFrame(state.paintRaf);
      state.paintRaf = requestAnimationFrame(() => {
        state.paintRaf = 0;
        if (state.disposed) return;
        syms.forEach((sym) => paintTickDom(sym));
      });
    }, wait);
  }

  function paintTickDom(sym) {
    const last = Number(state.lastPx[sym]);
    if (!Number.isFinite(last)) return;
    const chg = Number(state.tickers[sym] && state.tickers[sym].chg);
    /* Only war-room cards/modal — header .ticker-pill is owned by nav.js */
    document.querySelectorAll('.coin-card[data-sym="' + sym + '"], #coinModalBg[data-sym="' + sym + '"]').forEach((node) => {
      try {
        const pxEl = node.querySelector("[data-px]");
        flashPx(pxEl, last, Number(pxEl && pxEl.getAttribute("data-last")));
        if (pxEl) pxEl.setAttribute("data-last", String(last));
        const chgEl = node.querySelector("[data-chg]");
        if (chgEl && Number.isFinite(chg)) {
          const up = chg >= 0;
          chgEl.textContent = (up ? "▲ " : "▼ ") + Math.abs(chg).toFixed(2) + "%";
          chgEl.classList.toggle("is-up", up);
          chgEl.classList.toggle("is-down", !up);
        }
      } catch {
        /* isolate card */
      }
    });
    drawSpark(sym);
    if (state.modalSym === sym) paintModalLive(sym);
  }

  async function refreshMarket() {
    const targets = state.watch.length ? state.watch : ALL_COINS;
    const packs = await Promise.all(
      targets.map(async (sym) => {
        try {
          const rows = await loadKlines(sym);
          return [sym, rows];
        } catch {
          return [sym, state.klines[sym] || ensureKlines(sym)];
        }
      }),
    );
    const live = state.wsLive && state.wsTickAt && Date.now() - state.wsTickAt < 4000;
    packs.forEach(([sym, rows]) => {
      if (rows && rows.length >= 2) {
        state.klines[sym] = rows;
        const last = rows[rows.length - 1].c;
        if (!live && Number.isFinite(last)) {
          const cur = state.tickers[sym] || {};
          if (cur.last == null) cur.last = last;
          state.tickers[sym] = cur;
          if (state.lastPx[sym] == null) state.lastPx[sym] = last;
        }
      }
    });
    paintCardsMeta();
    if (state.modalSym) paintModalLive(state.modalSym);
  }

  function streamSymbols() {
    return ALL_COINS.filter((s) => !DEAD_SYMS[s]);
  }

  function streamUrl(idx) {
    const streams = streamSymbols()
      .map((s) => String(s).toLowerCase().replace("/", "") + "@ticker")
      .join("/");
    const hosts = [
      "wss://stream.binance.com:9443/stream?streams=",
      "wss://data-stream.binance.vision/stream?streams=",
    ];
    return hosts[idx % hosts.length] + streams;
  }

  function killSocket() {
    if (state.wsTimer) {
      clearTimeout(state.wsTimer);
      state.wsTimer = null;
    }
    const ws = state.ws;
    state.ws = null;
    state.wsLive = false;
    if (!ws) return;
    try {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      if (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    } catch {
      /* */
    }
  }

  function connectTickerStream() {
    if (state.disposed) return;
    if (state.ws && (state.ws.readyState === WebSocket.CONNECTING || state.ws.readyState === WebSocket.OPEN)) {
      return;
    }
    if (state.wsTimer) return;
    killSocket();
    let ws;
    try {
      ws = new WebSocket(streamUrl(state.wsUrlIdx || 0));
    } catch {
      state.wsLive = false;
      state.ws = null;
      startRestPoll();
      scheduleWsReconnect();
      return;
    }
    state.ws = ws;
    ws.onopen = () => {
      if (state.ws !== ws) return;
      state.wsLive = true;
      state.wsBackoff = 1000;
    };
    ws.onmessage = (ev) => {
      if (state.ws !== ws || state.disposed) return;
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (!msg || msg.error) return;
      const packets = Array.isArray(msg) ? msg : [msg];
      packets.forEach((item) => {
        try {
          const d = (item && item.data) || item || {};
          const stream = String((item && item.stream) || "");
          const sym = String(d.s || stream.split("@")[0] || "").toUpperCase();
          if (!sym || DEAD_SYMS[sym] || ALL_COINS.indexOf(sym) < 0) return;
          const last = Number(d.c);
          const chg = Number(d.P);
          if (!Number.isFinite(last)) return;
          state.wsTickAt = Date.now();
          applyTick(sym, last, chg);
        } catch {
          /* one symbol must not kill the aggregate parser */
        }
      });
    };
    ws.onerror = () => {
      try {
        if (state.ws === ws) ws.close();
      } catch {
        /* */
      }
    };
    ws.onclose = () => {
      if (state.ws === ws) {
        state.ws = null;
        state.wsLive = false;
      }
      if (state.disposed) return;
      state.wsUrlIdx = (state.wsUrlIdx || 0) + 1;
      startRestPoll();
      scheduleWsReconnect();
    };
  }

  function scheduleWsReconnect() {
    if (state.disposed || state.wsTimer) return;
    const wait = state.wsBackoff || 1000;
    state.wsBackoff = Math.min((state.wsBackoff || 1000) * 2, 4000);
    state.wsTimer = setTimeout(() => {
      state.wsTimer = null;
      connectTickerStream();
    }, wait);
  }

  async function pollRestTickers() {
    const targets = (state.watch.length ? state.watch : ALL_COINS).filter((s) => !DEAD_SYMS[s]);
    if (!targets.length) return;
    const encoded = encodeURIComponent(JSON.stringify(targets));
    const urls = [
      "https://data-api.binance.vision/api/v3/ticker/24hr?symbols=" + encoded,
      "https://api.binance.com/api/v3/ticker/24hr?symbols=" + encoded,
    ];
    let rows = null;
    for (let i = 0; i < urls.length; i++) {
      try {
        const data = await fetchJson(urls[i]);
        if (Array.isArray(data) && data.length) {
          rows = data;
          break;
        }
      } catch {
        /* next host */
      }
    }
    if (!rows) return;
    rows.forEach((r) => {
      try {
        const sym = String(r.symbol || "").toUpperCase();
        applyTick(sym, Number(r.lastPrice), Number(r.priceChangePercent));
      } catch {
        /* isolate */
      }
    });
  }

  function startRestPoll() {
    if (state.disposed || state.restTimer) return;
    const tick = () => {
      if (state.disposed) return;
      const freshWs = state.wsLive && state.wsTickAt && Date.now() - state.wsTickAt < 3500;
      if (freshWs) {
        clearInterval(state.restTimer);
        state.restTimer = null;
        return;
      }
      pollRestTickers().catch(() => {});
    };
    tick();
    state.restTimer = setInterval(tick, 2000);
  }

  function armRestFallback() {
    if (state.restArmTimer) clearTimeout(state.restArmTimer);
    state.restArmTimer = setTimeout(() => {
      state.restArmTimer = null;
      if (state.disposed) return;
      const got = state.wsTickAt && Date.now() - state.wsTickAt < 2500;
      if (!got) startRestPoll();
    }, 2500);
  }

  function startJitter() {
    if (state.disposed || state.jitterTimer) return;
    state.jitterTimer = setInterval(() => {
      if (state.disposed) return;
      const freshWs = state.wsLive && state.wsTickAt && Date.now() - state.wsTickAt < 3500;
      if (freshWs) return;
      const targets = state.watch.length ? state.watch : ALL_COINS;
      targets.forEach((sym) => {
        try {
          const last = Number(state.lastPx[sym] || basePx(sym));
          if (!Number.isFinite(last)) return;
          const next = last * (1 + (Math.random() * 0.0006 - 0.0003));
          const chg = Number(state.tickers[sym] && state.tickers[sym].chg);
          applyTick(sym, next, Number.isFinite(chg) ? chg : undefined);
        } catch {
          /* isolate */
        }
      });
    }, 900);
  }

  function liveFeedUrls() {
    const t = Date.now();
    const urls = [
      "https://api.quantalpha.space/live_feed.json?_t=" + t,
      "https://api.quantalpha.space/data/signals.json?_t=" + t,
    ];
    try {
      urls.push(new URL("./live_feed.json?_t=" + t, document.baseURI).href);
    } catch {
      urls.push("./live_feed.json?_t=" + t);
    }
    return urls;
  }

  function liveFeedUrl() {
    return liveFeedUrls()[0];
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
            symbol: normSym(s.symbol),
            price: s.price,
            side: g.side,
            action: g.action,
            event: s.event || g.event || "open",
            pnl_pct: s.pnl_pct,
            name: g.name_zh || g.name_en || "量化策略",
            interval: g.interval || "1h",
            strategyId: g.strategy_id || s.strategy_id,
          });
        });
        return;
      }
      if (!g || !g.symbol) return;
      out.push({
        key: [g.strategy_id, g.symbol, g.event, g.logged_at || g.bar_ts, g.side].join("|"),
        ts: toSec(g.logged_at) || toSec(g.bar_ts),
        symbol: normSym(g.symbol),
        price: g.price,
        side: g.side,
        action: g.action,
        event: g.event || "open",
        pnl_pct: g.pnl_pct,
        name: g.name_zh || g.name_en || "量化策略",
        interval: g.interval || "1h",
        strategyId: g.strategy_id,
      });
    });
    return pruneAndCollapseEvents(out);
  }

  function pnlOf(ev) {
    const last = state.lastPx[ev.symbol];
    const entry = Number(ev.price);
    if (!Number.isFinite(last) || !Number.isFinite(entry) || !entry) return null;
    const raw = ((last - entry) / entry) * 100;
    return isBuy(ev) ? raw : -raw;
  }

  function paintRadar() {
    if (state.radarRaf) return;
    state.radarRaf = requestAnimationFrame(() => {
      state.radarRaf = 0;
      paintRadarNow();
    });
  }

  function paintRadarNow() {
    const list = document.getElementById("radarList");
    if (!list) return;
    const now = Date.now() / 1000;
    const watchSet = new Set(state.watch.map(normSym));
    const rows = state.events
      .filter((e) => {
        if (!e || now - e.ts > HOUR_S) return false;
        if (isZeroValueClose(e)) return false;
        if (e.kind === "close_agg") return true;
        return watchSet.has(normSym(e.symbol));
      })
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 40);
    list.textContent = "";
    if (!rows.length) {
      const idle = document.createElement("div");
      idle.className = "radar-idle";
      idle.textContent = t("radarIdle", "⏳ 戰情雷達全天候掃描中，各幣種策略就緒...");
      list.appendChild(idle);
      list.style.animation = "none";
      return;
    }
    const frag = document.createDocumentFragment();
    const buildRow = (ev) => {
      if (ev.kind === "close_agg") {
        const avg = Number(ev.avgPnl != null ? ev.avgPnl : ev.pnl_pct);
        const avgTxt = Number.isFinite(avg) ? avg.toFixed(1) + "%" : "—";
        const row = document.createElement("div");
        row.className = "radar-row is-agg";
        row.innerHTML =
          '<span class="t">[' +
          fmt12h(ev.ts) +
          "]</span>" +
          '<span class="side">⚪ 全網資產</span>' +
          "<span>| " +
          escapeHtml(String(ev.aggCount || 0)) +
          " 套" +
          stratAnchor(ev) +
          " (" +
          escapeHtml(String(ev.interval || "1h").toUpperCase()) +
          ") 策略到期平倉</span>" +
          '<span class="pnl">| 平均盈虧: ' +
          escapeHtml(avgTxt) +
          "</span>";
        return row;
      }
      const buy = isBuy(ev);
      const close = isClose(ev);
      const pnl = close ? Number(ev.pnl_pct) : pnlOf(ev);
      const pnlCls = pnl == null || !Number.isFinite(pnl) ? "" : pnl >= 0 ? " is-up" : " is-down";
      const act = close
        ? "平倉 " + (Number.isFinite(pnl) ? fmtPnl(pnl) : "—")
        : (buy ? "多頭開倉" : "空頭開倉") + " @ " + fmtPx(ev.price);
      const livePnl = !close && pnl != null ? " | 當前浮盈 " + fmtPnl(pnl) : "";
      const row = document.createElement("div");
      row.className =
        "radar-row " +
        (close ? (Number(pnl) > 0 ? "is-buy" : "is-sell") : buy ? "is-buy" : "is-sell");
      row.innerHTML =
        '<span class="t">[' +
        fmt12h(ev.ts) +
        "]</span>" +
        '<span class="side">' +
        (buy && !close ? "🟢 " : close && Number(pnl) > 0 ? "🟢 " : "🔴 ") +
        escapeHtml(pairLabel(ev.symbol)) +
        "</span>" +
        "<span>| " +
        stratAnchor(ev) +
        " (" +
        escapeHtml(String(ev.interval || "1h").toUpperCase()) +
        ")</span>" +
        "<span>| " +
        escapeHtml(act) +
        "</span>" +
        (livePnl ? '<span class="pnl' + pnlCls + '">' + escapeHtml(livePnl) + "</span>" : "");
      return row;
    };
    rows.forEach((ev) => frag.appendChild(buildRow(ev)));
    rows.forEach((ev) => frag.appendChild(buildRow(ev)));
    list.appendChild(frag);
    list.style.animation = rows.length > 6 ? "radarScroll 28s linear infinite" : "none";
  }

  async function refreshFeed() {
    if (state.disposed) return;
    const urls = liveFeedUrls();
    let data = null;
    for (let i = 0; i < urls.length; i++) {
      try {
        const row = await fetchJson(urls[i]);
        if (row && (Array.isArray(row.exec_log) || row.updated_at)) {
          data = row;
          break;
        }
      } catch {
        /* next url */
      }
    }
    if (!data || state.disposed) return;
    try {
      const flat = flattenFeed(data);
      const now = Date.now() / 1000;
      state.events = flat.filter((e) => e.ts && now - e.ts <= HOUR_S * 6);
      if (state.seenKeys == null) {
        state.seenKeys = new Set(flat.map((e) => e.key));
        let hydrated = false;
        try {
          hydrated = Boolean(localStorage.getItem("qa_live_cum_pnl_v1"));
        } catch {
          hydrated = false;
        }
        if (!hydrated) {
          flat.forEach((ev) => {
            if (isClose(ev)) bumpCum(ev);
          });
        }
      } else {
        const fresh = [];
        flat.forEach((ev) => {
          if (state.seenKeys.has(ev.key)) return;
          state.seenKeys.add(ev.key);
          if (!inWatch(ev.symbol)) return;
          if (now - ev.ts > HOUR_S) return;
          fresh.push(ev);
        });
        announceEvents(fresh);
      }
      paintRadar();
      paintCardsMeta();
    } catch {
      /* isolate feed parse */
    }
  }

  function bindTapeLinks() {
    if (handlers.tapeClick) return;
    handlers.tapeClick = (ev) => {
      const a = ev.target.closest("a.tape-strat");
      if (!a) return;
      const href = a.getAttribute("href") || "";
      let id = "";
      try {
        id = new URL(href, location.href).searchParams.get("id") || "";
      } catch {
        id = "";
      }
      if (!id) return;
      ev.preventDefault();
      openPlazaFromTape(id);
    };
    document.addEventListener("click", handlers.tapeClick);
  }

  function onVisibilityChange() {
    if (document.visibilityState !== "visible" || state.disposed) return;
    state.events = [];
    state.seenKeys = null;
    paintRadar();
    refreshFeed();
    refreshMarket();
    if (!(state.ws && (state.ws.readyState === WebSocket.OPEN || state.ws.readyState === WebSocket.CONNECTING))) {
      connectTickerStream();
    }
  }

  function disposeLiveRoom() {
    if (state.disposed) return;
    state.disposed = true;
    killSocket();
    if (state.feedTimer) clearInterval(state.feedTimer);
    state.feedTimer = null;
    if (state.restTimer) clearInterval(state.restTimer);
    state.restTimer = null;
    if (state.jitterTimer) clearInterval(state.jitterTimer);
    state.jitterTimer = null;
    if (state.restArmTimer) clearTimeout(state.restArmTimer);
    state.restArmTimer = null;
    if (state.paintTimer) clearTimeout(state.paintTimer);
    state.paintTimer = 0;
    if (state.paintRaf) cancelAnimationFrame(state.paintRaf);
    state.paintRaf = 0;
    if (state.radarRaf) cancelAnimationFrame(state.radarRaf);
    state.radarRaf = 0;
    state.pendingTicks = {};
    clearAudioQueue();
    state.speaking = false;
    if (handlers.resize) {
      window.removeEventListener("resize", handlers.resize);
      handlers.resize = null;
    }
    if (handlers.visibility) {
      document.removeEventListener("visibilitychange", handlers.visibility);
      handlers.visibility = null;
    }
    if (handlers.keydown) {
      document.removeEventListener("keydown", handlers.keydown);
      handlers.keydown = null;
    }
    if (handlers.tapeClick) {
      document.removeEventListener("click", handlers.tapeClick);
      handlers.tapeClick = null;
    }
  }

  async function openPlazaFromTape(id) {
    try {
      const coinBg = document.getElementById("coinModalBg");
      if (coinBg) coinBg.classList.remove("is-open");
      state.modalSym = null;
      if (window.QAPipeline) {
        let rows = window.QAPipelineStrategies;
        if ((!rows || !rows.length) && typeof window.QAPipeline.fetchRows === "function") {
          rows = await window.QAPipeline.fetchRows();
          window.QAPipelineStrategies = rows;
        }
        const hit = (rows || []).find((r) => r.id === id || r.engine === id);
        if (hit && typeof window.QAPipeline.openDetail === "function") {
          const card =
            typeof window.QAPipeline.toCard === "function" ? window.QAPipeline.toCard(hit) : hit;
          window.QAPipeline.openDetail(card);
          return;
        }
      }
    } catch {
      /* fall through */
    }
    location.href = "./strategies.html?id=" + encodeURIComponent(id);
  }

  function boot() {
    if (state.disposed) state.disposed = false;
    seedFailSafe();
    renderGrid();
    bindGrid();
    bindAddUi();
    bindModal();
    bindVoice();
    bindTapeLinks();
    startJitter();
    connectTickerStream();
    armRestFallback();
    refreshMarket();
    refreshFeed();
    if (state.feedTimer) clearInterval(state.feedTimer);
    state.feedTimer = setInterval(refreshFeed, FEED_MS);
    if (!handlers.resize) {
      handlers.resize = () => {
        if (state.disposed) return;
        paintCardsMeta();
        if (state.modalSym) paintModalLive(state.modalSym);
      };
      window.addEventListener("resize", handlers.resize);
    }
    if (!handlers.visibility) {
      handlers.visibility = onVisibilityChange;
      document.addEventListener("visibilitychange", handlers.visibility);
    }
    if (!handlers.pagehide) {
      handlers.pagehide = disposeLiveRoom;
      window.addEventListener("pagehide", handlers.pagehide);
    }
    if (!handlers.pageshow) {
      handlers.pageshow = (ev) => {
        if (ev.persisted || state.disposed) {
          state.disposed = false;
          boot();
        }
      };
      window.addEventListener("pageshow", handlers.pageshow);
    }
    if (!document.getElementById("qa-live-radar-style")) {
      const style = document.createElement("style");
      style.id = "qa-live-radar-style";
      style.textContent =
        "@keyframes radarScroll{0%{transform:translateY(0)}100%{transform:translateY(-50%)}}";
      document.head.appendChild(style);
    }
    window.QALiveDemoVoice = icebreakerVoice;
    window.QALiveDispose = disposeLiveRoom;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
