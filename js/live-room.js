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

  function playUrl(url) {
    if (!url || isMuted()) return;
    try {
      const audio = new Audio(url);
      audio.volume = 1.0;
      audio.play().catch(() => {
        /* autoplay blocked until a user gesture — funnel/mute clicks satisfy this */
      });
    } catch {
      /* audio element unsupported */
    }
  }

  let welcomePlayed = false;
  function maybePlayWelcome() {
    if (welcomePlayed || isMuted()) return;
    welcomePlayed = true;
    playUrl(WELCOME_AUDIO_URLS[Math.floor(Math.random() * WELCOME_AUDIO_URLS.length)]);
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
      (data.active_signals_3h || []).filter(relevant).forEach(maybePlaySignalAudio);
      (data.closed_signals_3h || []).filter(relevant).forEach(maybePlaySignalAudio);
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
    if (!feed || typeof feed.fetchKlines !== "function") {
      const off = window.QAOffline && window.QAOffline.forInterval(interval);
      return off && off.length ? off.slice(-500) : [];
    }
    const bars = await feed.fetchKlines(symbol, interval, 500);
    barsCache.set(key, { bars, ts: Date.now() });
    return bars;
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
        paintStatus();
        clearCountdown();
        refreshActive();
      } else {
        watchCoins = watchCoins.filter((c) => c !== sym);
      }
      saveJsonArray(WATCH_COINS_KEY, watchCoins);
      const row = input.closest(".coin-pill");
      if (row) row.classList.toggle("is-checked", input.checked);
      refreshWatchTape();
      scheduleFunnelVoice();
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
        if (activeStrategy && activeStrategy.id === id) {
          const fallback = watchStrategyIds[watchStrategyIds.length - 1] || (strategies[0] && strategies[0].id);
          if (fallback) selectStrategy(fallback, strategies);
        }
      }
      saveJsonArray(WATCH_STRATS_KEY, watchStrategyIds);
      refreshWatchTape();
      scheduleFunnelVoice();
    });
  }

  /* ---------------------------------------------------------------------
   * War Room Terminal: chart + real trade signals + 3h tape + 60s voice
   * countdown for whichever strategy is currently focused.
   * ------------------------------------------------------------------- */
  const statusTextEl = document.getElementById("warStatusText");
  const tapeListEl = document.getElementById("warTapeList");
  const watchTapeListEl = document.getElementById("watchTapeList");
  const countdownEl = document.getElementById("warCountdown");
  const countdownFillEl = document.getElementById("warCountdownFill");
  const countdownLabelEl = document.getElementById("warCountdownLabel");

  let warChart = null;
  let warSeries = null;
  let pollTimer = null;
  let watchPollTimer = null;
  let countdownTimer = null;
  let lastSeenTs = new Map(); // strategy id -> last known signal ts (seconds)
  let baselineSet = new Set(); // strategy ids whose first poll has been consumed as baseline

  // "Last activated" coin: whichever coin pill was most recently CHECKED wins
  // and overrides the focused strategy's default symbol on the main chart.
  let activeSymbolOverride = null;
  function effectiveSymbol(s) {
    return activeSymbolOverride || (s && s.symbol) || "BTCUSDT";
  }

  function addCandleSeries(chart) {
    const LC = window.LightweightCharts;
    const opts = {
      upColor: "#00873c",
      downColor: "#d0021b",
      borderVisible: false,
      wickUpColor: "#00873c",
      wickDownColor: "#d0021b",
    };
    return typeof chart.addCandlestickSeries === "function" ? chart.addCandlestickSeries(opts) : chart.addSeries(LC.CandlestickSeries, opts);
  }

  function mountChart() {
    const el = document.getElementById("warChart");
    const Charts = window.LightweightCharts;
    if (!el || !Charts || warChart) return;
    warChart = Charts.createChart(el, feed.chartOptions(el, el.clientHeight || 420, "1h"));
    warSeries = addCandleSeries(warChart);
    if (typeof ResizeObserver !== "undefined") {
      new ResizeObserver(() => {
        if (!warChart) return;
        warChart.applyOptions({ width: el.clientWidth || 280 });
      }).observe(el);
    }
  }

  const SIX_HOURS_S = 6 * 3600;

  // Lock the War Room chart's visible time range to the last 6 hours of the
  // just-loaded bars (fetch/compute can still use more bars for indicator
  // warmup — only the VISIBLE window is constrained).
  function lockChartToLast6h(bars) {
    if (!warChart || !bars || !bars.length) return;
    const lastTime = bars[bars.length - 1].time;
    const from = lastTime - SIX_HOURS_S;
    try {
      warChart.timeScale().setVisibleRange({ from, to: lastTime });
    } catch {
      warChart.timeScale().fitContent();
    }
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

  function renderTape(trades) {
    if (!tapeListEl || !activeStrategy) return;
    const nowS = Date.now() / 1000;
    const recent = trades.filter((tr) => Math.max(tr.t0 || 0, tr.t1 || 0) >= nowS - THREE_HOURS_S).sort((a, b) => (b.t1 || b.t0) - (a.t1 || a.t0));
    if (!recent.length) {
      tapeListEl.innerHTML = `<li class="muted">${escapeHtml(t("warTapeEmpty"))}</li>`;
      return;
    }
    const sym = effectiveSymbol(activeStrategy);
    const sid = activeStrategy.id;
    tapeListEl.innerHTML = recent.map((tr) => tapeRowHtml(tr, null, sym, sid)).join("");
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

  /* ---- Poll the focused strategy for fresh bars + trade signals ---- */
  async function refreshActive() {
    if (!activeStrategy) return;
    const s = activeStrategy;
    const sym = effectiveSymbol(s);
    let bars;
    try {
      bars = await barsOf(sym, s.interval);
    } catch {
      return;
    }
    if (!bars || !bars.length || activeStrategy !== s) return;

    if (warSeries) {
      warSeries.setData(bars.map((b) => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close })));
      lockChartToLast6h(bars);
    }

    const spec = catalog.get(s.id);
    if (!spec || typeof spec.run !== "function") return;
    let trades = [];
    try {
      trades = spec.run(bars) || [];
    } catch {
      trades = [];
    }
    if (activeStrategy !== s) return;

    if (warSeries) {
      const lastBarTime = bars[bars.length - 1].time;
      const windowFrom = lastBarTime - SIX_HOURS_S;
      const inWindow = (ts) => ts >= windowFrom && ts <= lastBarTime;
      warSeries.setMarkers(
        trades.flatMap((tr) => {
          const marks = [];
          if (inWindow(tr.t0)) marks.push({ time: tr.t0, position: "belowBar", color: "#00873c", shape: "arrowUp", text: "BUY" });
          if (!tr.open && inWindow(tr.t1)) marks.push({ time: tr.t1, position: "aboveBar", color: "#d0021b", shape: "arrowDown", text: "SELL" });
          return marks;
        })
      );
    }

    renderTape(trades);

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
    bindTapeRowClicks(tapeListEl);
    bindTapeRowClicks(watchTapeListEl);
    bindMuteBtn();
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
      refreshWatchTape();
    });
  }

  boot().catch((err) => {
    toast(String((err && err.message) || err), "err");
  });
})();
