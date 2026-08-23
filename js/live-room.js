(function () {
  const catalog = window.QACatalog;
  const feed = window.QAFeed;
  const ENGINES = window.QA_ENGINE_LIST || [];
  const MUTE_KEY = "qa_live_mute";
  const ACTIVE_KEY = "qa_live_active_id";
  const WATCH_COINS_KEY = "qa_live_watch_coins";
  const WATCH_STRATS_KEY = "qa_live_watch_strategies";
  const SYMS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT"];
  const COIN_LIST = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "DOGEUSDT", "XRPUSDT", "SUIUSDT", "PEPEUSDT"];
  const THREE_HOURS_S = 3 * 3600;
  const MAX_WATCH_PAIRS = 24;
  const TAPE_MAX = 50;
  const CHART_INTERVAL = "1m";
  const OVERLAY_COLORS = ["#38bdf8", "#a855f7", "#f59e0b", "#ec4899", "#14b8a6", "#f97316"];
  const WATCH_EXCLUDED_KEY = "qa_live_watch_excluded";

  function t(key) {
    if (window.QALang && typeof window.QALang.t === "function") {
      const live = window.QALang.t(key);
      if (live && live !== key) return live;
    }
    const lang = localStorage.getItem("user_lang") || localStorage.getItem("quant_lang") || "en";
    const mapped = lang === "zh-Hans" ? "zh-CN" : lang;
    const pack = (window.I18N && (window.I18N[mapped] || window.I18N.en || window.I18N["zh-Hant"])) || {};
    const fallback = (window.I18N && window.I18N.en) || {};
    return pack[key] || fallback[key] || key;
  }

  function langKey() {
    const cur = window.QALang && window.QALang.current ? window.QALang.current() : "en";
    if (cur === "zh-CN" || cur === "zh-Hans") return "zh-CN";
    if (cur === "zh-Hant" || cur === "zh-TW") return "zh-Hant";
    return "en";
  }

  function toast(msg, kind) {
    const el = document.getElementById("toast");
    if (!el) return;
    el.textContent = msg;
    el.className = "toast show " + (kind || "ok");
    setTimeout(() => el.classList.remove("show"), 2400);
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function loadExcludedPairs() {
    try {
      const raw = JSON.parse(localStorage.getItem(WATCH_EXCLUDED_KEY) || "[]");
      return new Set(Array.isArray(raw) ? raw : []);
    } catch {
      return new Set();
    }
  }
  function saveExcludedPairs(set) {
    try {
      localStorage.setItem(WATCH_EXCLUDED_KEY, JSON.stringify([...set]));
    } catch {
      /* private mode */
    }
  }
  let watchExcludedPairs = loadExcludedPairs();

  function pairKey(coin, sid) {
    return coin + "|" + sid;
  }

  function activePairs() {
    const pairs = [];
    watchCoins.forEach((coin) => {
      watchStrategyIds.forEach((sid) => {
        const key = pairKey(coin, sid);
        if (!watchExcludedPairs.has(key)) pairs.push({ coin, sid });
      });
    });
    return pairs;
  }

  function loadJsonArray(key, fallback) {
    try {
      const raw = JSON.parse(localStorage.getItem(key) || "null");
      return Array.isArray(raw) ? raw : fallback;
    } catch {
      return fallback;
    }
  }
  function saveJsonArray(key, arr) {
    try {
      localStorage.setItem(key, JSON.stringify(arr));
    } catch {
      /* private mode */
    }
  }

  /* ---------------------------------------------------------------------
   * Sound + voice engine — native <audio> playback of backend-generated
   * MP3s only (edge-tts, see deploy/quantsite/tg_engine.py). No Web Speech
   * API, no synthesized Web Audio ambience/SFX: the page is silent unless a
   * real backend voice line or the welcome clip is playing. A single mute
   * toggle gates all of it.
   * ------------------------------------------------------------------- */
  const WELCOME_AUDIO_URLS = ["./audio/welcome_1.mp3", "./audio/welcome_2.mp3", "./audio/welcome_3.mp3"];
  function isMuted() {
    try {
      return localStorage.getItem(MUTE_KEY) === "1";
    } catch {
      return false;
    }
  }
  function setMuted(v) {
    try {
      localStorage.setItem(MUTE_KEY, v ? "1" : "0");
    } catch {
      /* private mode */
    }
  }

  let activeAudio = null;

  function playUrl(url, onFail) {
    if (!url || isMuted()) return;
    try {
      if (activeAudio) {
        activeAudio.pause();
        activeAudio.currentTime = 0;
        activeAudio = null;
      }
      window.speechSynthesis && window.speechSynthesis.cancel();
      const audio = new Audio(url);
      activeAudio = audio;
      audio.volume = 1.0;
      audio.addEventListener("ended", () => {
        if (activeAudio === audio) activeAudio = null;
      });
      audio.addEventListener("error", () => {
        if (activeAudio === audio) activeAudio = null;
        if (typeof onFail === "function") onFail();
      });
      audio.play().catch(() => {
        if (activeAudio === audio) activeAudio = null;
        if (typeof onFail === "function") onFail();
      });
    } catch {
      if (typeof onFail === "function") onFail();
    }
  }

  function speakTextLine(text) {
    if (isMuted() || !text) return;
    try {
      if (activeAudio) {
        activeAudio.pause();
        activeAudio = null;
      }
      const u = new SpeechSynthesisUtterance(text);
      const lk = langKey();
      u.lang = lk === "zh-CN" ? "zh-CN" : lk === "en" ? "en-US" : "zh-TW";
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch {
      /* speech optional fallback */
    }
  }

  function isMultiSelection() {
    return activePairs().length > 1 || watchCoins.length > 1 || watchStrategyIds.length > 1;
  }

  const FUNNEL_MULTI_URL = "./audio/funnel_multi.mp3";

  let welcomePlayed = false;
  function maybePlayWelcome() {
    if (welcomePlayed || isMuted()) return;
    welcomePlayed = true;
    playUrl(WELCOME_AUDIO_URLS[Math.floor(Math.random() * WELCOME_AUDIO_URLS.length)]);
  }

  function bindWelcomeOnInteraction() {
    const unlock = () => maybePlayWelcome();
    ["mousemove", "click", "touchstart", "scroll"].forEach((ev) => {
      document.addEventListener(ev, unlock, { once: true, capture: true, passive: true });
    });
  }

  // Dedupe so the same backend-generated signal clip never plays twice.
  const playedAudioUrls = new Set();
  function maybePlaySignalAudio(sig) {
    if (!sig || !sig.audio_url || playedAudioUrls.has(sig.audio_url)) return;
    playedAudioUrls.add(sig.audio_url);
    playUrl(sig.audio_url);
  }

  function bindMuteBtn() {
    const btn = document.getElementById("liveMuteBtn");
    if (!btn) return;
    const paint = () => {
      const muted = isMuted();
      btn.setAttribute("data-i18n", muted ? "liveMuteOff" : "liveMuteOn");
      btn.textContent = muted ? t("liveMuteOff") : t("liveMuteOn");
    };
    btn.addEventListener("click", () => {
      const nowMuted = !isMuted();
      setMuted(nowMuted);
      paint();
      if (!nowMuted) maybePlayWelcome();
    });
    paint();
    window.addEventListener("quant-lang", paint);
  }

  // 500ms debounce after any coin/strategy checkbox change: play a backend
  // pre-generated "monitoring created" confirmation clip for the currently
  // focused strategy (see tg_engine.py's ensure_funnel_audio(), one MP3 per
  // canonical strategy id — no on-demand TTS endpoint needed).
  let funnelVoiceTimer = null;
  function scheduleFunnelVoice() {
    if (funnelVoiceTimer) clearTimeout(funnelVoiceTimer);
    funnelVoiceTimer = setTimeout(() => {
      if (isMultiSelection()) {
        playUrl(FUNNEL_MULTI_URL, () => speakTextLine(t("funnelMultiVoice")));
        return;
      }
      if (activeStrategy) playUrl("./audio/funnel_" + activeStrategy.id + ".mp3");
    }, 500);
  }

  // Best-effort poll of the backend's live_feed.json for open/close signal
  // audio relevant to the user's current watch-scope (checked coins +
  // checked strategies). Never blocks chart/tape rendering.
  async function pollLiveFeedAudio() {
    try {
      const res = await fetch("./live_feed.json", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      const coinBases = new Set(watchCoins.map((c) => String(c).replace("USDT", "")));
      const relevant = (sig) =>
        sig && watchStrategyIds.includes(sig.strategy_id) && coinBases.has(String(sig.symbol || "").replace("USDT", ""));
      const hits = (data.active_signals_3h || [])
        .filter(relevant)
        .concat((data.closed_signals_3h || []).filter(relevant));
      if (!hits.length) return;
      if (isMultiSelection()) return;
      maybePlaySignalAudio(hits[hits.length - 1]);
    } catch {
      /* live_feed.json optional for this decorative layer */
    }
  }

  /* ---------------------------------------------------------------------
   * Strategy list (45 canonical IDs) + bar-fetch cache.
   * ------------------------------------------------------------------- */
  function buildStrategies() {
    const out = [];
    ENGINES.forEach(([id, tier]) => {
      const spec = catalog && catalog.get(id);
      if (!spec) return;
      out.push({
        id,
        tier,
        name: spec.name || id,
        symbol: (spec.symbols && spec.symbols[0]) || "BTCUSDT",
        interval: spec.interval || "1h",
      });
    });
    return out;
  }

  const barsCache = new Map();
  async function barsOf(symbol, interval) {
    const key = symbol + ":" + interval;
    if (barsCache.has(key)) {
      const cached = barsCache.get(key);
      if (Date.now() - cached.ts < 20000) return cached.bars;
    }
    const offline = () => {
      const off = window.QAOffline && window.QAOffline.forInterval(interval);
      return off && off.length ? off.slice(-500) : [];
    };
    if (!feed || typeof feed.fetchKlines !== "function") return offline();
    try {
      if (typeof feed.readyGeo === "function") {
        try {
          await feed.readyGeo();
        } catch {
          /* keep current region */
        }
      }
      const bars = await feed.fetchKlines(symbol, interval, 500);
      if (bars && bars.length) {
        barsCache.set(key, { bars, ts: Date.now() });
        return bars;
      }
    } catch {
      /* live fetch failed */
    }
    const off = offline();
    if (off.length) barsCache.set(key, { bars: off, ts: Date.now() });
    return off;
  }

  function hashStr(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  /* ---------------------------------------------------------------------
   * Crowd activity toast capsules (Copart-style social proof). Identity is
   * shown as a masked, synthetic TG ID (decorative — not real user data),
   * never a city/node name: "TG ID: 62***891".
   * ------------------------------------------------------------------- */
  const DIR_TXT = {
    "zh-Hant": { LONG: "做多", SHORT: "做空" },
    "zh-CN": { LONG: "做多", SHORT: "做空" },
    en: { LONG: "LONG", SHORT: "SHORT" },
  };
  const TOAST_TPL = {
    "zh-Hant": {
      follow: (id, sym) => `⚡ [TG ID: ${id}] 正在跟隨 #${sym} 突破策略`,
      sync: (id, sym, tf, dir) => `⚡ [TG ID: ${id}] 已同步執行 #${sym} ${tf} ${dir} 訊號`,
      lock: (id, sym, pct) => `⚡ [TG ID: ${id}] 成功鎖定 #${sym} 止盈點位 +${pct}%`,
    },
    "zh-CN": {
      follow: (id, sym) => `⚡ [TG ID: ${id}] 正在跟随 #${sym} 突破策略`,
      sync: (id, sym, tf, dir) => `⚡ [TG ID: ${id}] 已同步执行 #${sym} ${tf} ${dir} 信号`,
      lock: (id, sym, pct) => `⚡ [TG ID: ${id}] 成功锁定 #${sym} 止盈点位 +${pct}%`,
    },
    en: {
      follow: (id, sym) => `⚡ [TG ID: ${id}] is following the #${sym} breakout strategy`,
      sync: (id, sym, tf, dir) => `⚡ [TG ID: ${id}] synced a #${sym} ${tf} ${dir} signal`,
      lock: (id, sym, pct) => `⚡ [TG ID: ${id}] locked in +${pct}% on #${sym}`,
    },
  };

  function randomMaskedTgId() {
    const prefix = String(Math.floor(10 + Math.random() * 90));
    const suffix = String(Math.floor(100 + Math.random() * 900));
    return prefix + "***" + suffix;
  }

  const crowdStack = document.createElement("div");
  crowdStack.className = "crowd-toast-stack";
  crowdStack.id = "crowdToastStack";
  crowdStack.setAttribute("aria-live", "polite");
  document.body.appendChild(crowdStack);

  function isMobile() {
    return window.matchMedia("(max-width: 768px)").matches;
  }

  function pushCrowdToast(text) {
    const cap = isMobile() ? 1 : 3;
    while (crowdStack.children.length >= cap) {
      crowdStack.removeChild(crowdStack.firstChild);
    }
    const el = document.createElement("div");
    el.className = "crowd-toast";
    el.textContent = text;
    crowdStack.appendChild(el);
    requestAnimationFrame(() => el.classList.add("is-in"));
    setTimeout(() => {
      el.classList.add("is-out");
      setTimeout(() => el.remove(), 320);
    }, 4000);
  }

  function randomFrom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function spawnRandomCrowdEvent() {
    const key = langKey();
    const dirs = DIR_TXT[key] || DIR_TXT.en;
    const tpl = TOAST_TPL[key] || TOAST_TPL.en;
    const kind = randomFrom(["follow", "sync", "sync", "lock"]);
    const id = randomMaskedTgId();
    const sym = randomFrom(SYMS).replace("USDT", "");
    let text;
    if (kind === "follow") {
      text = tpl.follow(id, sym);
    } else if (kind === "sync") {
      const tf = randomFrom(["15M", "1H", "4H"]);
      const dir = Math.random() < 0.5 ? dirs.LONG : dirs.SHORT;
      text = tpl.sync(id, sym, tf, dir);
    } else {
      const pct = (0.6 + Math.random() * 4.4).toFixed(1);
      text = tpl.lock(id, sym, pct);
    }
    pushCrowdToast(text);
  }

  function scheduleCrowdLoop() {
    const delay = 3200 + Math.random() * 3600;
    setTimeout(() => {
      spawnRandomCrowdEvent();
      scheduleCrowdLoop();
    }, delay);
  }

  function crowdLockEventText(sym) {
    const key = langKey();
    const tpl = TOAST_TPL[key] || TOAST_TPL.en;
    const pct = (0.8 + Math.random() * 4.6).toFixed(1);
    return tpl.lock(randomMaskedTgId(), sym.replace("USDT", ""), pct);
  }

  /* ---------------------------------------------------------------------
   * Live watchers + today's signal counters.
   * ------------------------------------------------------------------- */
  const watchersEl = document.getElementById("liveWatchersCount");
  const signalsEl = document.getElementById("liveSignalsCount");
  let watchers = 180;
  let signalsToday = 1200;

  async function seedCountersFromLeaderboard() {
    try {
      const cfg = window.QUANT_CONFIG;
      const url = (cfg && cfg.leaderboardUrl) || "./leaderboard.json";
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) return;
      const lb = await res.json();
      window.QALeaderboard = lb;
      const rows = Object.values(lb.by_engine || {});
      const totalTrades = rows.reduce((sum, r) => sum + (Number(r.total_trades || r.trades) || 0), 0);
      if (totalTrades > 0) signalsToday = 300 + (totalTrades % 900);
      watchers = 140 + (rows.length ? Math.round((totalTrades / Math.max(1, rows.length)) % 90) : 0);
      paintCounters();
      window.dispatchEvent(new CustomEvent("qa-leaderboard-ready"));
    } catch {
      /* atmosphere layer only — keep defaults on failure */
    }
  }

  function paintCounters() {
    if (watchersEl) watchersEl.textContent = watchers.toLocaleString("en-US");
    if (signalsEl) signalsEl.textContent = signalsToday.toLocaleString("en-US");
  }

  function tickCounters() {
    const hourUtc = new Date().getUTCHours();
    const wave = 26 * Math.sin(((hourUtc + 2) / 24) * Math.PI * 2);
    const target = 180 + wave;
    watchers += Math.round((target - watchers) * 0.08 + (Math.random() * 6 - 3));
    watchers = Math.max(58, Math.min(420, watchers));
    if (Math.random() < 0.7) signalsToday += Math.floor(Math.random() * 3);
    paintCounters();
  }

  /* ---------------------------------------------------------------------
   * Step 1 + Step 2 selection funnel (both multi-select, persisted).
   * ------------------------------------------------------------------- */
  const matrixListEl = document.getElementById("matrixList");
  const coinPillsEl = document.getElementById("coinPills");
  let allStrategies = [];
  let watchCoins = loadJsonArray(WATCH_COINS_KEY, []);
  let watchStrategyIds = loadJsonArray(WATCH_STRATS_KEY, []);
  let activeStrategy = null;

  function hotBucket() {
    return Math.floor(Date.now() / 300000); // rotates every 5 minutes
  }
  function isHot(id) {
    return (hashStr(id) + hotBucket()) % 3 === 0;
  }

  function coinPillHtml(sym) {
    const checked = watchCoins.includes(sym);
    return `<label class="coin-pill${checked ? " is-checked" : ""}" data-coin-row="${sym}">
        <input type="checkbox" data-coin="${sym}" ${checked ? "checked" : ""} />
        ${escapeHtml(sym.replace("USDT", ""))}
      </label>`;
  }
  function renderCoinPills() {
    if (!coinPillsEl) return;
    coinPillsEl.innerHTML = COIN_LIST.map(coinPillHtml).join("");
  }
  function bindCoinPills() {
    if (!coinPillsEl) return;
    coinPillsEl.addEventListener("change", (ev) => {
      const input = ev.target.closest("[data-coin]");
      if (!input) return;
      const sym = input.getAttribute("data-coin");
      if (input.checked) {
        if (!watchCoins.includes(sym)) watchCoins.push(sym);
        // "Last activated" rule: the coin the user just checked immediately
        // takes over the main War Room chart, regardless of how many other
        // coins are already checked for the watchlist aggregation below.
        activeSymbolOverride = sym;
        [...watchExcludedPairs].forEach((k) => {
          if (k.startsWith(sym + "|")) watchExcludedPairs.delete(k);
        });
        saveExcludedPairs(watchExcludedPairs);
        paintStatus();
        clearCountdown();
      } else {
        watchCoins = watchCoins.filter((c) => c !== sym);
      }
      saveJsonArray(WATCH_COINS_KEY, watchCoins);
      const row = input.closest(".coin-pill");
      if (row) row.classList.toggle("is-checked", input.checked);
      renderSelectedMatrix();
      refreshWatchTape();
      scheduleFunnelVoice();
      refreshActive();
    });
  }

  function matrixRowHtml(s) {
    const checked = watchStrategyIds.includes(s.id);
    return `<label class="matrix-row${checked ? " is-checked" : ""}" data-row="${s.id}">
        <input type="checkbox" class="matrix-check" data-select="${s.id}" ${checked ? "checked" : ""} />
        <span class="matrix-dot${isHot(s.id) ? " is-hot" : ""}" data-dot="${s.id}" aria-hidden="true"></span>
        <span class="matrix-name">${escapeHtml(s.name)}</span>
      </label>`;
  }
  function renderMatrix(strategies) {
    if (!matrixListEl) return;
    matrixListEl.innerHTML = strategies.map(matrixRowHtml).join("");
  }
  function refreshMatrixDots() {
    document.querySelectorAll("[data-dot]").forEach((dot) => {
      dot.classList.toggle("is-hot", isHot(dot.getAttribute("data-dot")));
    });
  }
  function paintFocusHighlight(id) {
    document.querySelectorAll(".matrix-row").forEach((row) => {
      row.classList.toggle("is-focused", row.getAttribute("data-row") === id);
    });
  }
  function bindMatrixClicks(strategies) {
    if (!matrixListEl) return;
    matrixListEl.addEventListener("change", (ev) => {
      const input = ev.target.closest("[data-select]");
      if (!input) return;
      const id = input.getAttribute("data-select");
      const row = input.closest(".matrix-row");
      if (input.checked) {
        if (!watchStrategyIds.includes(id)) watchStrategyIds.push(id);
        if (row) row.classList.add("is-checked");
        selectStrategy(id, strategies);
      } else {
        watchStrategyIds = watchStrategyIds.filter((x) => x !== id);
        if (row) row.classList.remove("is-checked");
        [...watchExcludedPairs].forEach((k) => {
          if (k.endsWith("|" + id)) watchExcludedPairs.delete(k);
        });
        saveExcludedPairs(watchExcludedPairs);
        if (activeStrategy && activeStrategy.id === id) {
          const fallback = watchStrategyIds[watchStrategyIds.length - 1] || (strategies[0] && strategies[0].id);
          if (fallback) selectStrategy(fallback, strategies);
        }
      }
      saveJsonArray(WATCH_STRATS_KEY, watchStrategyIds);
      renderSelectedMatrix();
      refreshWatchTape();
      scheduleFunnelVoice();
    });
  }

  /* ---------------------------------------------------------------------
   * War Room Terminal: chart + real trade signals + 3h tape + 60s voice
   * countdown for whichever strategy is currently focused.
   * ------------------------------------------------------------------- */
  const statusTextEl = document.getElementById("warStatusText");
  const matrixRowsEl = document.getElementById("selectedMatrixRows");
  const watchTapeListEl = document.getElementById("watchTapeList");
  const countdownEl = document.getElementById("warCountdown");
  const countdownFillEl = document.getElementById("warCountdownFill");
  const countdownLabelEl = document.getElementById("warCountdownLabel");

  let warChart = null;
  let warSeries = null;
  let overlaySeriesMap = new Map();
  let chartMetaByCoin = new Map();
  let zeroPriceLine = null;
  let chartLockRange = null;
  let chartRangeGuard = false;
  let pollTimer = null;
  let watchPollTimer = null;
  let countdownTimer = null;
  let lastSeenTs = new Map();
  let baselineSet = new Set();
  const legendEl = document.getElementById("warChartLegend");
  const tooltipEl = document.getElementById("warChartTooltip");

  let activeSymbolOverride = null;
  function focusCoin() {
    return activeSymbolOverride || watchCoins[watchCoins.length - 1] || "BTCUSDT";
  }
  function effectiveSymbol(s) {
    return focusCoin() || (s && s.symbol) || "BTCUSDT";
  }

  function fmtPctAxis(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return "—";
    const sign = n > 0 ? "+" : "";
    return sign + n.toFixed(1) + "%";
  }

  function fmtUsdPx(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return "—";
    return "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function pctOf(price, p0) {
    if (!p0) return 0;
    return ((Number(price) - p0) / p0) * 100;
  }

  function normalizeWindow(bars, windowFrom) {
    const slice = bars.filter((b) => b.time >= windowFrom);
    if (!slice.length) return null;
    const p0 = slice[0].close;
    const byTime = new Map();
    slice.forEach((b) => byTime.set(b.time, b));
    const normalized = slice.map((b) => ({
      time: b.time,
      open: pctOf(b.open, p0),
      high: pctOf(b.high, p0),
      low: pctOf(b.low, p0),
      close: pctOf(b.close, p0),
    }));
    const line = slice.map((b) => ({ time: b.time, value: pctOf(b.close, p0) }));
    return { p0, normalized, line, byTime, slice };
  }

  function addCandleSeries(chart, optsExtra) {
    const LC = window.LightweightCharts;
    const extra = Object.assign({}, optsExtra || {});
    delete extra.lineWidth;
    const opts = {
      upColor: "#00873c",
      downColor: "#d0021b",
      borderVisible: false,
      wickUpColor: "#00873c",
      wickDownColor: "#d0021b",
      ...extra,
    };
    return typeof chart.addCandlestickSeries === "function" ? chart.addCandlestickSeries(opts) : chart.addSeries(LC.CandlestickSeries, opts);
  }

  function addLineSeries(chart, color, lineWidth, opacity) {
    const LC = window.LightweightCharts;
    const opts = {
      color,
      lineWidth,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: true,
      priceFormat: {
        type: "custom",
        formatter: fmtPctAxis,
      },
    };
    const s =
      typeof chart.addLineSeries === "function" ? chart.addLineSeries(opts) : chart.addSeries(LC.LineSeries, opts);
    if (opacity != null && s.applyOptions) s.applyOptions({ color: colorWithAlpha(color, opacity) });
    return s;
  }

  function colorWithAlpha(hex, alpha) {
    const h = String(hex || "#38bdf8").replace("#", "");
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return "rgba(" + r + "," + g + "," + b + "," + alpha + ")";
  }

  function clearChartSeries() {
    if (!warChart) return;
    overlaySeriesMap.forEach((s) => {
      try {
        warChart.removeSeries(s);
      } catch {
        /* already removed */
      }
    });
    overlaySeriesMap.clear();
    if (warSeries) {
      try {
        warChart.removeSeries(warSeries);
      } catch {
        /* */
      }
      warSeries = null;
    }
    zeroPriceLine = null;
    chartLockRange = null;
  }

  function ensureZeroLine(series) {
    if (!series || zeroPriceLine) return;
    if (typeof series.createPriceLine === "function") {
      zeroPriceLine = series.createPriceLine({
        price: 0,
        color: "#334155",
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: "0%",
      });
    }
  }

  function bindCrosshairTooltip() {
    if (!warChart || !tooltipEl || warChart.__tipBound) return;
    warChart.__tipBound = true;
    warChart.subscribeCrosshairMove((param) => {
      if (!param || !param.time || param.point.x < 0 || param.point.y < 0) {
        tooltipEl.hidden = true;
        return;
      }
      const ts = param.time;
      const rows = [];
      chartMetaByCoin.forEach((meta, coin) => {
        const bar = meta.byTime.get(ts);
        if (!bar) return;
        const pct = pctOf(bar.close, meta.p0);
        rows.push(
          `<div class="tip-row"><span class="tip-sym">${escapeHtml(coin.replace("USDT", ""))}</span>` +
            `<span class="tip-pct">${escapeHtml(fmtPctAxis(pct))}</span>` +
            `<span class="tip-px">${escapeHtml(fmtUsdPx(bar.close))}</span></div>`
        );
      });
      if (!rows.length) {
        tooltipEl.hidden = true;
        return;
      }
      tooltipEl.innerHTML = rows.join("");
      tooltipEl.hidden = false;
      const frame = document.querySelector(".war-chart-frame");
      const rect = frame ? frame.getBoundingClientRect() : { left: 0, top: 0 };
      const x = Math.min(Math.max(8, param.point.x + 12), (frame ? frame.clientWidth : 300) - 190);
      const y = Math.max(8, param.point.y - 8);
      tooltipEl.style.left = x + "px";
      tooltipEl.style.top = y + "px";
    });
  }

  function mountChart() {
    const el = document.getElementById("warChart");
    const Charts = window.LightweightCharts;
    if (!el || !Charts) return;
    const applySize = () => {
      if (!warChart || !el) return;
      warChart.applyOptions({
        width: Math.max(el.clientWidth || 280, 280),
        height: Math.max(el.clientHeight || 420, 280),
      });
    };
    if (warChart) {
      applySize();
      return;
    }
    const baseOpts = feed.chartOptions(el, Math.max(el.clientHeight || 420, 280), CHART_INTERVAL);
    baseOpts.localization = Object.assign({}, baseOpts.localization, {
      priceFormatter: fmtPctAxis,
    });
    baseOpts.rightPriceScale = Object.assign({}, baseOpts.rightPriceScale, {
      autoScale: true,
    });
    baseOpts.handleScroll = {
      mouseWheel: false,
      pressedMouseMove: false,
      horzTouchDrag: false,
      vertTouchDrag: false,
    };
    baseOpts.handleScale = {
      axisPressedMouseMove: false,
      mouseWheel: false,
      pinch: false,
    };
    baseOpts.timeScale = Object.assign({}, baseOpts.timeScale, {
      fixLeftEdge: true,
      fixRightEdge: true,
      lockVisibleTimeRangeOnResize: true,
      rightBarStaysOnScroll: true,
    });
    warChart = Charts.createChart(el, baseOpts);
    applySize();
    if (typeof ResizeObserver !== "undefined") {
      new ResizeObserver(() => {
        applySize();
        if (chartLockRange) lockChartRange(chartLockRange.from, chartLockRange.to);
      }).observe(el);
    }
    try {
      const ts = warChart.timeScale();
      if (ts && typeof ts.subscribeVisibleTimeRangeChange === "function") {
        ts.subscribeVisibleTimeRangeChange((range) => {
          if (chartRangeGuard || !chartLockRange || !range) return;
          const fromDiff = Math.abs(Number(range.from) - chartLockRange.from);
          const toDiff = Math.abs(Number(range.to) - chartLockRange.to);
          if (fromDiff > 2 || toDiff > 2) lockChartRange(chartLockRange.from, chartLockRange.to);
        });
      }
    } catch {
      /* range lock optional */
    }
    bindCrosshairTooltip();
  }

  const SIX_HOURS_S = 6 * 3600;

  function lockChartRange(from, to) {
    if (!warChart) return;
    chartRangeGuard = true;
    try {
      warChart.timeScale().setVisibleRange({ from, to });
    } catch {
      try {
        warChart.timeScale().fitContent();
      } catch {
        /* ignore */
      }
    }
    chartRangeGuard = false;
  }

  function lockChartToWindow(windowBars) {
    if (!warChart || !windowBars || !windowBars.length) return;
    const from = windowBars[0].time;
    const to = windowBars[windowBars.length - 1].time;
    chartLockRange = { from, to };
    lockChartRange(from, to);
  }

  function coinColor(coin, isFocus) {
    if (isFocus) return "#16a34a";
    const idx = watchCoins.indexOf(coin);
    return OVERLAY_COLORS[(idx >= 0 ? idx : hashStr(coin)) % OVERLAY_COLORS.length];
  }

  function renderLegend() {
    if (!legendEl) return;
    const focus = focusCoin();
    if (!watchCoins.length) {
      legendEl.innerHTML = "";
      return;
    }
    legendEl.innerHTML = watchCoins
      .map((coin) => {
        const isFocus = coin === focus;
        const color = coinColor(coin, isFocus);
        return (
          `<button type="button" class="war-legend-pill${isFocus ? " is-focus" : ""}" data-legend-coin="${escapeHtml(coin)}">` +
          `<span class="war-legend-swatch" style="background:${color}"></span>` +
          escapeHtml(coin.replace("USDT", "")) +
          `</button>`
        );
      })
      .join("");
  }

  function bindLegendClicks() {
    if (!legendEl || legendEl.getAttribute("data-bound") === "1") return;
    legendEl.setAttribute("data-bound", "1");
    legendEl.addEventListener("click", (ev) => {
      const btn = ev.target.closest("[data-legend-coin]");
      if (!btn) return;
      activeSymbolOverride = btn.getAttribute("data-legend-coin");
      paintStatus();
      refreshActive();
    });
  }

  function strategyLabel(id) {
    const s = allStrategies.find((x) => x.id === id);
    return (s && s.name) || id;
  }

  function pairPillHtml(coin, sid) {
    const label = coin.replace("USDT", "") + " · " + strategyLabel(sid);
    return (
      `<span class="selected-matrix-pill" data-pair-coin="${escapeHtml(coin)}" data-pair-sid="${escapeHtml(sid)}">` +
      escapeHtml(label) +
      `<button type="button" data-remove-pair="${escapeHtml(pairKey(coin, sid))}" aria-label="Remove">✕</button></span>`
    );
  }

  function renderSelectedMatrix() {
    refreshWarTape();
  }

  let warTapeRefreshSeq = 0;
  const TAPE_ROW_MAX = 6;

  async function refreshWarTape() {
    if (!matrixRowsEl) return;
    const pairs = activePairs();
    if (!pairs.length) {
      matrixRowsEl.innerHTML = `<p class="muted selected-matrix-empty">${escapeHtml(t("watchTapeEmpty"))}</p>`;
      return;
    }

    const seq = ++warTapeRefreshSeq;
    const nowS = Date.now() / 1000;
    const focus = focusCoin();
    const focusSid = activeStrategy ? activeStrategy.id : null;

    const rows = await Promise.all(
      pairs.map(async ({ coin, sid }) => {
        let recent = [];
        try {
          const strat = allStrategies.find((x) => x.id === sid);
          if (strat) {
            const bars = await barsOf(coin, strat.interval);
            const spec = catalog.get(sid);
            if (spec && typeof spec.run === "function" && bars && bars.length) {
              const trades = spec.run(bars) || [];
              recent = trades
                .filter((tr) => Math.max(tr.t0 || 0, tr.t1 || 0) >= nowS - THREE_HOURS_S)
                .sort((a, b) => (b.t1 || b.t0) - (a.t1 || a.t0))
                .slice(0, TAPE_ROW_MAX);
            }
          }
        } catch {
          recent = [];
        }
        return { coin, sid, recent };
      })
    );
    if (seq !== warTapeRefreshSeq) return;

    matrixRowsEl.innerHTML = rows
      .map(({ coin, sid, recent }) => {
        const focused = coin === focus && sid === focusSid;
        const signals =
          recent.length > 0
            ? `<ul class="war-tape-list war-tape-inline">${recent.map((tr) => tapeRowHtml(tr, null, coin, sid)).join("")}</ul>`
            : `<ul class="war-tape-list war-tape-inline"><li class="war-tape-row-empty muted">${escapeHtml(t("warTapeRowEmpty"))}</li></ul>`;
        return (
          `<div class="selected-matrix-row${focused ? " is-focused" : ""}" data-pair-coin="${escapeHtml(coin)}" data-pair-sid="${escapeHtml(sid)}">` +
          `<div class="selected-matrix-row-pill">${pairPillHtml(coin, sid)}</div>` +
          signals +
          `</div>`
        );
      })
      .join("");
  }

  function bindMatrixPillClicks() {
    if (!matrixRowsEl || matrixRowsEl.getAttribute("data-bound") === "1") return;
    matrixRowsEl.setAttribute("data-bound", "1");
    matrixRowsEl.addEventListener("click", (ev) => {
      const rm = ev.target.closest("[data-remove-pair]");
      if (rm) {
        watchExcludedPairs.add(rm.getAttribute("data-remove-pair"));
        saveExcludedPairs(watchExcludedPairs);
        renderSelectedMatrix();
        refreshWatchTape();
        refreshActive();
        return;
      }
      const row = ev.target.closest(".selected-matrix-row[data-pair-coin]");
      const pill = ev.target.closest("[data-pair-coin]");
      const target = row || pill;
      if (!target) return;
      activeSymbolOverride = target.getAttribute("data-pair-coin");
      selectStrategy(target.getAttribute("data-pair-sid"), allStrategies);
    });
  }

  function paintWatchTapeAuth() {
    const block = document.getElementById("watchTapeBlock");
    if (!block) return;
    const ok = window.QAIdentity && typeof window.QAIdentity.loggedIn === "function" && window.QAIdentity.loggedIn();
    block.style.display = ok ? "" : "none";
  }

  function fmtHm(ts) {
    const d = new Date(ts * 1000);
    return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  }

  function tapeRowHtml(tr, tag, symbol, strategyId) {
    const pnl = Number(tr.pnlPct);
    const pnlTxt = tr.open ? "—" : (pnl >= 0 ? "+" : "") + pnl.toFixed(2) + "%";
    const pnlCls = pnl >= 0 ? "up" : "down";
    const side = tr.side === "SHORT" ? "sell" : "buy";
    const label = tr.open ? (tr.side === "SHORT" ? t("warSell") : t("warBuy")) : (tr.side === "SHORT" ? t("warBuy") : t("warSell"));
    const tagHtml = tag ? `<span class="watch-tape-tag">${escapeHtml(tag)}</span>` : "";
    const clickable = symbol && strategyId;
    const attrs = clickable ? ` data-symbol="${escapeHtml(symbol)}" data-strategy="${escapeHtml(strategyId)}" tabindex="0"` : "";
    return `<li${attrs}>
        ${tagHtml}
        <span class="war-tape-time">${fmtHm(tr.open ? tr.t0 : tr.t1)}</span>
        <span class="war-tape-side ${side}">${escapeHtml(label)}</span>
        <span class="war-tape-px">${Number(tr.open ? tr.entry : tr.exit).toLocaleString("en-US", { maximumFractionDigits: 6 })}</span>
        <span class="war-tape-pnl ${pnlCls}">${pnlTxt}</span>
      </li>`;
  }


  // Clicking any tape row (single-focus or aggregated watchlist) smoothly
  // switches the main chart to that row's symbol + strategy.
  function bindTapeRowClicks(el) {
    if (!el) return;
    const activate = (li) => {
      const symbol = li.getAttribute("data-symbol");
      const strategyId = li.getAttribute("data-strategy");
      if (!symbol || !strategyId) return;
      activeSymbolOverride = symbol;
      selectStrategy(strategyId, allStrategies);
    };
    el.addEventListener("click", (ev) => {
      const li = ev.target.closest("li[data-symbol]");
      if (li) activate(li);
    });
    el.addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter" && ev.key !== " ") return;
      const li = ev.target.closest("li[data-symbol]");
      if (li) {
        ev.preventDefault();
        activate(li);
      }
    });
  }

  /* ---- My Watchlist Tape: aggregate selected coins x selected strategies ---- */
  let watchRefreshSeq = 0;
  async function refreshWatchTape() {
    if (!watchTapeListEl) return;
    if (!window.QAIdentity || typeof window.QAIdentity.loggedIn !== "function" || !window.QAIdentity.loggedIn()) return;
    const seq = ++watchRefreshSeq;
    if (!watchCoins.length || !watchStrategyIds.length) {
      watchTapeListEl.innerHTML = `<li class="muted">${escapeHtml(t("watchTapeEmpty"))}</li>`;
      return;
    }
    const chosen = allStrategies.filter((s) => watchStrategyIds.includes(s.id));
    const pairs = [];
    chosen.forEach((s) => {
      watchCoins.forEach((coin) => pairs.push({ s, coin }));
    });
    const capped = pairs.slice(0, MAX_WATCH_PAIRS);
    const nowS = Date.now() / 1000;
    const results = await Promise.all(
      capped.map(async (p) => {
        try {
          const bars = await barsOf(p.coin, p.s.interval);
          const spec = catalog.get(p.s.id);
          if (!spec || typeof spec.run !== "function" || !bars || !bars.length) return [];
          const trades = spec.run(bars) || [];
          return trades
            .filter((tr) => Math.max(tr.t0 || 0, tr.t1 || 0) >= nowS - THREE_HOURS_S)
            .map((tr) => ({ tr, tag: p.coin.replace("USDT", "") + " · " + p.s.name, coin: p.coin, sid: p.s.id }));
        } catch {
          return [];
        }
      })
    );
    if (seq !== watchRefreshSeq) return; // a newer selection change superseded this run
    const merged = results
      .flat()
      .sort((a, b) => (b.tr.t1 || b.tr.t0) - (a.tr.t1 || a.tr.t0))
      .slice(0, TAPE_MAX);
    if (!merged.length) {
      watchTapeListEl.innerHTML = `<li class="muted">${escapeHtml(t("warTapeEmpty"))}</li>`;
      return;
    }
    watchTapeListEl.innerHTML = merged.map(({ tr, tag, coin, sid }) => tapeRowHtml(tr, tag, coin, sid)).join("");
  }

  /* ---- 60s open-window countdown (visual only, see runOpenWindowCountdown) ---- */
  function clearCountdown() {
    if (countdownTimer) clearInterval(countdownTimer);
    countdownTimer = null;
    if (countdownEl) {
      countdownEl.hidden = true;
      countdownEl.classList.remove("is-warn", "is-danger", "is-locked");
    }
  }

  function updateCountdownUi(remainMs, totalMs, phase) {
    if (!countdownEl || !countdownFillEl || !countdownLabelEl) return;
    countdownEl.hidden = false;
    const pct = Math.max(0, Math.min(100, (remainMs / totalMs) * 100));
    countdownFillEl.style.width = pct + "%";
    countdownEl.classList.toggle("is-warn", phase === "warn");
    countdownEl.classList.toggle("is-danger", phase === "danger");
    countdownEl.classList.toggle("is-locked", phase === "locked");
    if (phase === "locked") {
      countdownLabelEl.textContent = t("warLocked");
    } else {
      const secs = Math.max(0, Math.ceil(remainMs / 1000));
      countdownLabelEl.textContent = secs + "s " + t("warCountdownLabel");
    }
  }

  // Visual-only countdown: spoken narration used to rely on the removed Web
  // Speech API. The open-signal voice line for this strategy/symbol (if any)
  // is now sourced from the backend live_feed.json feed via
  // pollLiveFeedAudio() instead, so there is no duplicate/competing speech.
  function runOpenWindowCountdown(strategyName) {
    clearCountdown();
    pushCrowdToast(crowdLockEventText(activeStrategy ? activeStrategy.symbol : "BTCUSDT"));
    signalsToday += 1;
    paintCounters();

    const total = 60000;
    const startTs = Date.now();
    updateCountdownUi(total, total, "normal");
    countdownTimer = setInterval(() => {
      const elapsed = Date.now() - startTs;
      const remain = total - elapsed;
      if (remain <= 0) {
        clearInterval(countdownTimer);
        countdownTimer = null;
        updateCountdownUi(0, total, "locked");
        setTimeout(() => {
          if (countdownEl) countdownEl.hidden = true;
        }, 3500);
        return;
      }
      const phase = remain <= 10000 ? "danger" : remain <= 30000 ? "warn" : "normal";
      updateCountdownUi(remain, total, phase);
    }, 200);
  }

  /* ---- Poll focused strategy + multi-coin normalized 6H overlay chart ---- */
  let activeRefreshSeq = 0;
  async function refreshActive() {
    if (!activeStrategy) return;
    const seq = ++activeRefreshSeq;
    const s = activeStrategy;
    const sym = effectiveSymbol(s);
    const coins = watchCoins.length ? watchCoins.slice() : [sym];
    const focus = focusCoin();
    mountChart();
    if (!warChart) return;

    const barSets = await Promise.all(
      coins.map(async (coin) => {
        try {
          const bars = await barsOf(coin, CHART_INTERVAL);
          return { coin, bars };
        } catch {
          return { coin, bars: [] };
        }
      })
    );
    if (seq !== activeRefreshSeq || activeStrategy !== s) return;

    let anchorBars = [];
    barSets.forEach(({ coin, bars }) => {
      if (coin === focus && bars && bars.length) anchorBars = bars;
    });
    if (!anchorBars.length) {
      const first = barSets.find((x) => x.bars && x.bars.length);
      anchorBars = first ? first.bars : [];
    }
    if (!anchorBars.length) return;

    const lastBarTime = anchorBars[anchorBars.length - 1].time;
    const windowFrom = lastBarTime - SIX_HOURS_S;

    clearChartSeries();
    chartMetaByCoin.clear();

    const overlays = [];
    const focusPack = barSets.find((x) => x.coin === focus) || barSets[0];
    barSets.forEach(({ coin, bars }) => {
      if (!bars || !bars.length || coin === focusPack.coin) return;
      const pack = normalizeWindow(bars, windowFrom);
      if (!pack) return;
      chartMetaByCoin.set(coin, pack);
      overlays.push({ coin, pack });
    });

    overlays.forEach(({ coin, pack }) => {
      const series = addLineSeries(warChart, coinColor(coin, false), 1.5, 0.6);
      series.setData(pack.line);
      overlaySeriesMap.set(coin, series);
    });

    const focusBars = focusPack.bars;
    const focusNorm = normalizeWindow(focusBars, windowFrom);
    let markerNorm = null;
    if (focusNorm) {
      markerNorm = focusNorm;
      chartMetaByCoin.set(focusPack.coin, focusNorm);
      warSeries = addCandleSeries(warChart);
      warSeries.setData(focusNorm.normalized);
      ensureZeroLine(warSeries);
      requestAnimationFrame(() => lockChartToWindow(focusNorm.slice));
    }

    renderLegend();

    const signalBars = focusBars;
    if (!signalBars || !signalBars.length || activeStrategy !== s) return;

    const spec = catalog.get(s.id);
    if (!spec || typeof spec.run !== "function") return;
    let trades = [];
    try {
      trades = spec.run(signalBars) || [];
    } catch {
      trades = [];
    }
    if (seq !== activeRefreshSeq || activeStrategy !== s) return;

    if (warSeries && markerNorm) {
      const inWindow = (ts) => ts >= windowFrom && ts <= lastBarTime;
      const barTimes = new Set(markerNorm.slice.map((b) => b.time));
      const snapTime = (ts) => {
        if (barTimes.has(ts)) return ts;
        let best = null;
        let bestDiff = Infinity;
        markerNorm.slice.forEach((b) => {
          const diff = Math.abs(b.time - ts);
          if (diff < bestDiff) {
            bestDiff = diff;
            best = b.time;
          }
        });
        return bestDiff <= 120 ? best : null;
      };
      warSeries.setMarkers(
        trades.flatMap((tr) => {
          const marks = [];
          const tBuy = snapTime(tr.t0);
          const tSell = !tr.open ? snapTime(tr.t1) : null;
          if (tBuy && inWindow(tBuy)) marks.push({ time: tBuy, position: "belowBar", color: "#00873c", shape: "arrowUp", text: "BUY" });
          if (tSell && inWindow(tSell)) marks.push({ time: tSell, position: "aboveBar", color: "#d0021b", shape: "arrowDown", text: "SELL" });
          return marks;
        })
      );
    }

    renderSelectedMatrix();

    const last = trades.length ? trades[trades.length - 1] : null;
    const lastTs = last ? (last.open ? last.t0 : last.t1) : 0;
    const nowS = Date.now() / 1000;
    if (!baselineSet.has(s.id)) {
      baselineSet.add(s.id);
      lastSeenTs.set(s.id, lastTs);
    } else if (lastTs && lastTs !== lastSeenTs.get(s.id) && nowS - lastTs < 300) {
      lastSeenTs.set(s.id, lastTs);
      runOpenWindowCountdown(s.name);
    }
  }

  function paintStatus() {
    if (!statusTextEl || !activeStrategy) return;
    statusTextEl.removeAttribute("data-i18n");
    statusTextEl.textContent = t("warStatusTpl")
      .replace("{name}", activeStrategy.name)
      .replace("{symbol}", effectiveSymbol(activeStrategy).replace("USDT", ""))
      .replace("{tf}", String(activeStrategy.interval).toUpperCase());
  }

  function selectStrategy(id, strategies) {
    const s = strategies.find((x) => x.id === id);
    if (!s) return;
    activeStrategy = s;
    paintFocusHighlight(id);
    paintStatus();
    clearCountdown();
    try {
      localStorage.setItem(ACTIVE_KEY, id);
    } catch {
      /* private mode */
    }
    mountChart();
    refreshActive();
  }

  /* ---------------------------------------------------------------------
   * Boot.
   * ------------------------------------------------------------------- */
  async function boot() {
    if (window.QAPackReady) {
      try {
        await window.QAPackReady;
      } catch {
        /* pack optional */
      }
    }
    if (!catalog || !ENGINES.length || !feed) {
      if (matrixListEl) matrixListEl.innerHTML = `<p class="muted">${t("mktEmpty")}</p>`;
      return;
    }
    const strategies = buildStrategies();
    allStrategies = strategies;
    if (!strategies.length) {
      if (matrixListEl) matrixListEl.innerHTML = `<p class="muted">${t("mktEmpty")}</p>`;
      return;
    }

    watchStrategyIds = watchStrategyIds.filter((id) => strategies.some((s) => s.id === id));
    if (!watchStrategyIds.length) watchStrategyIds = [strategies[0].id];
    if (!watchCoins.length) watchCoins = ["BTCUSDT"];
    saveJsonArray(WATCH_STRATS_KEY, watchStrategyIds);
    saveJsonArray(WATCH_COINS_KEY, watchCoins);

    renderCoinPills();
    renderMatrix(strategies);
    bindCoinPills();
    bindMatrixClicks(strategies);
    bindTapeRowClicks(matrixRowsEl);
    bindTapeRowClicks(watchTapeListEl);
    bindMuteBtn();
    bindLegendClicks();
    bindMatrixPillClicks();
    bindWelcomeOnInteraction();
    paintWatchTapeAuth();
    window.addEventListener("quant-auth", paintWatchTapeAuth);
    paintCounters();
    setInterval(tickCounters, 4000);
    setInterval(refreshMatrixDots, 15000);
    scheduleCrowdLoop();
    setTimeout(spawnRandomCrowdEvent, 900);
    seedCountersFromLeaderboard();
    pollLiveFeedAudio();
    setInterval(pollLiveFeedAudio, 20000);

    let savedId = null;
    try {
      savedId = localStorage.getItem(ACTIVE_KEY);
    } catch {
      savedId = null;
    }
    const startId =
      (savedId && watchStrategyIds.includes(savedId) && savedId) ||
      watchStrategyIds[watchStrategyIds.length - 1] ||
      strategies[0].id;
    selectStrategy(startId, strategies);
    renderSelectedMatrix();
    renderLegend();

    clearInterval(pollTimer);
    pollTimer = setInterval(refreshActive, 20000);

    refreshWatchTape();
    clearInterval(watchPollTimer);
    watchPollTimer = setInterval(refreshWatchTape, 25000);

    window.addEventListener("quant-lang", () => {
      renderCoinPills();
      renderMatrix(strategies);
      paintFocusHighlight(activeStrategy ? activeStrategy.id : null);
      paintStatus();
      renderSelectedMatrix();
      renderLegend();
      refreshWatchTape();
    });
  }

  boot().catch((err) => {
    toast(String((err && err.message) || err), "err");
  });
})();
