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
      const res = await fetch(liveFeedUrl(), { cache: "no-store" });
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

  function fmtTapePrice(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return "—";
    if (x >= 1000) {
      return (
        "$" +
        x.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })
      );
    }
    if (x >= 1) return "$" + x.toFixed(2);
    if (x >= 0.01) return "$" + x.toFixed(4);
    return "$" + x.toPrecision(4);
  }

  function fmtTapePair(symbol) {
    const base = String(symbol || "").replace(/USDT$/i, "");
    return base ? base + "/USDT" : "—";
  }

  function vpsTapeAction(sig) {
    const isClose = sig.event === "close";
    if (isClose) {
      return String(sig.side || "").includes("LONG") ? "SELL" : "BUY";
    }
    return sig.side === "SHORT" ? "SELL" : "BUY";
  }

  function liveFeedUrl() {
    // HTTPS API subdomain — safe from GitHub Pages (no Mixed Content); CORS * on api.
    return "https://api.quantalpha.space/live_feed.json?t=" + Date.now();
  }

  function fmtVpsTime(barTs) {
    const d = new Date(Number(barTs) * 1000);
    if (!isFinite(d.getTime())) return "—";
    const p = (n) => String(n).padStart(2, "0");
    return p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
  }

  function vpsSortTs(sig) {
    return Number(sig && (sig.logged_at || sig.bar_ts)) || 0;
  }

  function vpsFeedRows(data) {
    // exec_log is the action tape. An empty array means "no fills this
    // cycle" — do not fall back to active_signals (those are holdings).
    if (Array.isArray(data.exec_log)) {
      return data.exec_log.slice().sort((a, b) => vpsSortTs(b) - vpsSortTs(a));
    }
    return (data.active_signals_3h || [])
      .concat(data.closed_signals_3h || [])
      .sort((a, b) => vpsSortTs(b) - vpsSortTs(a));
  }

  function vpsSigKey(sig) {
    return [sig.strategy_id, sig.symbol, sig.event, sig.bar_ts, sig.side].join("|");
  }

  function vpsRowHtml(sig, isNew) {
    const action = vpsTapeAction(sig);
    const actionCls = action === "BUY" ? "tape-action-buy" : "tape-action-sell";
    const px = sig.event === "close" ? sig.exit_price : sig.price;
    return (
      `<div class="exec-tape-row${isNew ? " is-new" : ""}" role="row">` +
      `<span class="tape-col tape-time" role="cell">${fmtVpsTime(sig.logged_at || sig.bar_ts)}</span>` +
      `<span class="tape-col tape-action ${actionCls}" role="cell">` +
      `<span class="tape-pill">${action}</span></span>` +
      `<span class="tape-col tape-pair" role="cell">${escapeHtml(fmtTapePair(sig.symbol))}</span>` +
      `<span class="tape-col tape-price" role="cell">${escapeHtml(fmtTapePrice(px))}</span>` +
      `</div>`
    );
  }

  let lastVpsKeys = new Set();
  let vpsBoardTimer = null;
  let vpsPollMs = 5000;
  let paintExecPillFn = null;
  let lastFeedUpdatedAt = "";

  function scheduleVpsPoll(ms) {
    // Same-origin static feed; engine publishes ~5s. Cap client poll 5–15s.
    const next = Math.max(5000, Math.min(Number(ms) || 5000, 15000));
    if (next === vpsPollMs && vpsBoardTimer) return;
    vpsPollMs = next;
    if (vpsBoardTimer) clearInterval(vpsBoardTimer);
    vpsBoardTimer = setInterval(refreshVpsExecBoard, vpsPollMs);
  }

  function feedAgeLabel(updatedAt) {
    const ts = Date.parse(String(updatedAt || ""));
    if (!isFinite(ts)) return "";
    const sec = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (sec < 90) return " · LIVE";
    if (sec < 3600) return " · " + Math.round(sec / 60) + "m ago";
    return " · " + Math.round(sec / 3600) + "h ago";
  }

  async function refreshVpsExecBoard() {
    const list = document.getElementById("vpsExecList");
    const updatedEl = document.getElementById("vpsExecUpdated");
    const viewport = document.getElementById("vpsExecViewport");
    if (!list) return;
    try {
      const res = await fetch(liveFeedUrl(), { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      scheduleVpsPoll(Number(data.poll_sec) ? Number(data.poll_sec) * 1000 : 5000);
      const merged = vpsFeedRows(data).slice(0, 20);
      if (updatedEl) {
        const meta = t("vpsExecMeta")
          .replace("{n}", String(data.strategy_count || 45))
          .replace("{sym}", String((data.symbols || []).length || 20))
          .replace("{sec}", String(data.poll_sec || 60))
          .replace("{tf}", String(data.scan_tf || "1h").toUpperCase());
        const upd = data.updated_at
          ? " · UPD " + String(data.updated_at).replace("T", " ").replace("Z", " UTC") + feedAgeLabel(data.updated_at)
          : "";
        updatedEl.textContent = meta + upd;
        updatedEl.classList.toggle("is-stale", feedAgeLabel(data.updated_at).indexOf("h ago") >= 0);
      }
      if (data.updated_at && data.updated_at !== lastFeedUpdatedAt) {
        lastFeedUpdatedAt = data.updated_at;
      }
      if (!merged.length) {
        list.innerHTML = `<div class="exec-tape-empty">${escapeHtml(t("vpsExecEmpty"))}</div>`;
        lastVpsKeys = new Set();
        if (paintExecPillFn) paintExecPillFn();
        return;
      }
      const nextKeys = new Set();
      const rows = merged.map((sig) => {
        const key = vpsSigKey(sig);
        nextKeys.add(key);
        return vpsRowHtml(sig, !lastVpsKeys.has(key));
      });
      lastVpsKeys = nextKeys;
      list.innerHTML = rows.join("");
      if (viewport && viewport.getAttribute("data-bound") !== "1") {
        viewport.setAttribute("data-bound", "1");
      }
      if (paintExecPillFn) paintExecPillFn();
    } catch {
      /* live_feed.json optional */
    }
  }

  function bindVpsExecBoard() {
    refreshVpsExecBoard();
    scheduleVpsPoll(vpsPollMs);
  }

  /* ---------------------------------------------------------------------
   * Mobile: the "SYSTEM EXECUTION" rail becomes a bottom-sheet drawer.
   * A floating pill (latest fill summary) sits above the watch tape;
   * tapping it slides the full exec feed up from the bottom.
   * ------------------------------------------------------------------- */
  function syncBackdrop() {
    const backdrop = document.getElementById("mobileSheetBackdrop");
    if (!backdrop) return;
    const open =
      document.body.classList.contains("tape-sheet-open") ||
      document.body.classList.contains("config-sheet-open");
    backdrop.hidden = !open;
  }

  function paintConfigCounts() {
    const n = watchStrategyIds.length;
    const dock = document.getElementById("configDockBtn");
    const apply = document.getElementById("configSheetApply");
    if (dock) dock.textContent = t("configDockBtn").replace("{n}", String(n));
    if (apply) apply.textContent = t("configSheetApply").replace("{n}", String(n));
  }

  function parkMobileSheet(el, slotId) {
    if (!el || el.parentElement === document.body) return;
    let slot = document.getElementById(slotId);
    if (!slot) {
      slot = document.createElement("div");
      slot.id = slotId;
      slot.style.display = "none";
      el.parentNode.insertBefore(slot, el);
    }
    document.body.appendChild(el);
  }

  function restoreMobileSheet(el, slotId) {
    const slot = document.getElementById(slotId);
    if (!el || !slot || !slot.parentNode) return;
    if (el.parentNode === slot.parentNode) return;
    slot.parentNode.insertBefore(el, slot);
  }

  function syncMobileSheetPortals() {
    const sheet = document.getElementById("watchFunnel");
    const rail = document.getElementById("vpsExecRail");
    if (isMobile()) {
      parkMobileSheet(sheet, "watchFunnelSlot");
      parkMobileSheet(rail, "vpsExecRailSlot");
    } else {
      restoreMobileSheet(sheet, "watchFunnelSlot");
      restoreMobileSheet(rail, "vpsExecRailSlot");
      closeConfigSheet();
      document.body.classList.remove("tape-sheet-open");
      syncBackdrop();
    }
  }

  function closeConfigSheet() {
    document.body.classList.remove("config-sheet-open");
    const dock = document.getElementById("configDockBtn");
    if (dock) dock.setAttribute("aria-expanded", "false");
    const sheet = document.getElementById("watchFunnel");
    if (sheet) sheet.style.transform = "";
    syncBackdrop();
  }

  function openConfigSheet() {
    document.body.classList.remove("tape-sheet-open");
    const tapePill = document.getElementById("mobileTapePill");
    if (tapePill) tapePill.setAttribute("aria-expanded", "false");
    syncMobileSheetPortals();
    document.body.classList.add("config-sheet-open");
    const dock = document.getElementById("configDockBtn");
    if (dock) dock.setAttribute("aria-expanded", "true");
    const sheet = document.getElementById("watchFunnel");
    if (sheet) sheet.style.transform = "";
    syncBackdrop();
  }

  function bindConfigSheet() {
    const dock = document.getElementById("configDockBtn");
    const apply = document.getElementById("configSheetApply");
    const handle = document.getElementById("configSheetHandle");
    const sheet = document.getElementById("watchFunnel");
    if (!dock || !sheet) return;

    dock.addEventListener("click", () => {
      if (document.body.classList.contains("config-sheet-open")) closeConfigSheet();
      else openConfigSheet();
    });
    if (apply) apply.addEventListener("click", closeConfigSheet);
    const backdrop = document.getElementById("mobileSheetBackdrop");
    if (backdrop && backdrop.getAttribute("data-sheet-bound") !== "1") {
      backdrop.setAttribute("data-sheet-bound", "1");
      backdrop.addEventListener("click", () => {
        closeConfigSheet();
        document.body.classList.remove("tape-sheet-open");
        const tapePill = document.getElementById("mobileTapePill");
        if (tapePill) tapePill.setAttribute("aria-expanded", "false");
        syncBackdrop();
      });
    }

    let startY = 0;
    let dragging = false;
    function onStart(ev) {
      const tch = ev.touches && ev.touches[0];
      if (!tch) return;
      startY = tch.clientY;
      dragging = true;
    }
    function onMove(ev) {
      if (!dragging) return;
      const tch = ev.touches && ev.touches[0];
      if (!tch) return;
      const dy = tch.clientY - startY;
      if (dy > 0) {
        sheet.style.transform = "translateY(" + dy + "px)";
      }
    }
    function onEnd(ev) {
      if (!dragging) return;
      dragging = false;
      const tch = ev.changedTouches && ev.changedTouches[0];
      const dy = tch ? tch.clientY - startY : 0;
      sheet.style.transform = "";
      if (dy > 72) closeConfigSheet();
    }
    const dragEl = handle || sheet;
    dragEl.addEventListener("touchstart", onStart, { passive: true });
    dragEl.addEventListener("touchmove", onMove, { passive: true });
    dragEl.addEventListener("touchend", onEnd, { passive: true });
    syncMobileSheetPortals();
    window.addEventListener("resize", syncMobileSheetPortals);
    paintConfigCounts();
  }

  function latestExecSummary() {
    const row = document.querySelector("#vpsExecList .exec-tape-row");
    if (!row) return t("vpsExecTitle");
    const pair = row.querySelector(".tape-pair");
    const action = row.querySelector(".tape-pill");
    const time = row.querySelector(".tape-time");
    const bits = [time, action, pair].map((el) => (el ? el.textContent.trim() : "")).filter(Boolean);
    return bits.length ? bits.join(" · ") : t("vpsExecTitle");
  }

  function bindMobileExecSheet() {
    const pill = document.getElementById("mobileTapePill");
    const pillText = document.getElementById("mobileTapePillText");
    const closeBtn = document.getElementById("mobileSheetClose");
    const rail = document.getElementById("vpsExecRail");
    if (!pill || !rail) return;

    function closeTape() {
      document.body.classList.remove("tape-sheet-open");
      pill.setAttribute("aria-expanded", "false");
      syncBackdrop();
    }
    function openTape() {
      closeConfigSheet();
      syncMobileSheetPortals();
      document.body.classList.add("tape-sheet-open");
      pill.setAttribute("aria-expanded", "true");
      syncBackdrop();
      refreshVpsExecBoard();
    }
    function toggle() {
      if (document.body.classList.contains("tape-sheet-open")) closeTape();
      else openTape();
    }

    pill.addEventListener("click", toggle);
    if (closeBtn) closeBtn.addEventListener("click", closeTape);

    function refreshPillText() {
      if (pillText) pillText.textContent = latestExecSummary();
    }
    paintExecPillFn = refreshPillText;
    refreshPillText();
  }

  /* ---------------------------------------------------------------------
   * Mobile segmented control adds a Leaderboard tab; load leaderboard.json
   * once so news.js's shared paintWeek() can render real VPS rankings here
   * (mirrors terminal.js's loader without pulling in the backtest engine).
   * ------------------------------------------------------------------- */
  async function loadLeaderboardForRail() {
    if (window.QALeaderboard) return;
    const cfg = window.QUANT_CONFIG || {};
    try {
      const res = await fetch((cfg.leaderboardUrl || "./leaderboard.json"), { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (data && data.by_engine) {
        window.QALeaderboard = data;
        window.dispatchEvent(new CustomEvent("qa-leaderboard-ready"));
      }
    } catch {
      /* leaderboard.json optional on the live page */
    }
  }

  /* ---------------------------------------------------------------------
   * Scan HUD — small "always working" status widget above the chart. The
   * progress bar is decorative (bounded oscillation), but the rotating
   * text describes the engine's real behavior (60s scan cadence across the
   * 45-strategy x 20-symbol matrix), not invented computation claims.
   * ------------------------------------------------------------------- */
  const SCAN_HUD_LINES = {
    "zh-Hant": [
      "[系統] 每 60 秒掃描一次全市場訊號矩陣…",
      "[系統] 45 組策略 × 20 個交易對持續運算中…",
      "[系統] 演算法運作正常，耐心等待下一個訊號。",
    ],
    "zh-CN": [
      "[系统] 每 60 秒扫描一次全市场信号矩阵…",
      "[系统] 45 组策略 × 20 个交易对持续运算中…",
      "[系统] 算法运行正常，耐心等待下一个信号。",
    ],
    en: [
      "[SYSTEM] Scanning the full signal matrix every 60s…",
      "[SYSTEM] 45 strategies x 20 pairs running continuously…",
      "[SYSTEM] Engine nominal, standing by for the next signal.",
    ],
  };
  let scanHudIdx = 0;
  let scanHudTypeTimer = null;
  function scanHudTypeLine(line) {
    const el = document.getElementById("scanHudText");
    if (!el) return;
    clearTimeout(scanHudTypeTimer);
    let i = 0;
    const step = () => {
      i++;
      el.textContent = line.slice(0, i);
      if (i < line.length) scanHudTypeTimer = setTimeout(step, 26);
    };
    step();
  }
  function scanHudRotate() {
    const arr = SCAN_HUD_LINES[langKey()] || SCAN_HUD_LINES.en;
    scanHudTypeLine(arr[scanHudIdx % arr.length]);
    scanHudIdx++;
  }
  function bindScanHud() {
    if (!document.getElementById("scanHud")) return;
    scanHudRotate();
    setInterval(scanHudRotate, 15000);
    const fill = document.getElementById("scanHudFill");
    if (fill) {
      const pulse = () => {
        fill.style.width = (85 + Math.random() * 14).toFixed(0) + "%";
      };
      pulse();
      setInterval(pulse, 2200);
    }
    window.addEventListener("quant-lang", () => {
      scanHudIdx = 0;
      scanHudRotate();
    });
  }

  /* ---------------------------------------------------------------------
   * Screen edge flash — a 0.5s green/red glow on the whole viewport for a
   * real BUY/SELL push from the VPS execution feed.
   * ------------------------------------------------------------------- */
  function triggerScreenFlash(action) {
    const el = document.getElementById("screenFlashOverlay");
    if (!el) return;
    el.classList.remove("flash-buy", "flash-sell");
    void el.offsetWidth; // restart the CSS animation if it's already mid-flash
    el.classList.add(action === "SELL" ? "flash-sell" : "flash-buy");
    setTimeout(() => el.classList.remove("flash-buy", "flash-sell"), 520);
  }

  /* ---------------------------------------------------------------------
   * Idle-state voice comfort: if 5 minutes pass with no fresh signal from
   * the VPS feed, play one random "still watching" clip. Reset on any new
   * signal so it only ever fires during genuinely quiet stretches.
   * ------------------------------------------------------------------- */
  const IDLE_VOICE_URLS = ["./audio/idle_1.mp3", "./audio/idle_2.mp3"];
  const IDLE_TIMEOUT_MS = 5 * 60 * 1000;
  let idleTimer = null;
  function scheduleIdleVoice() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      playUrl(randomFrom(IDLE_VOICE_URLS));
      scheduleIdleVoice();
    }, IDLE_TIMEOUT_MS);
  }

  /* ---------------------------------------------------------------------
   * High-conviction alert: real signals from "focus" strategies (Donchian
   * breakout / mean-reversion family) get a distinct urgent voice line
   * instead of the normal per-strategy clip.
   * ------------------------------------------------------------------- */
  const FOCUS_STRATEGY_IDS = new Set(["qk", "strat-001", "strat-019", "strat-007", "strat-008", "strat-011"]);
  const HIGH_CONVICTION_AUDIO_URL = "./audio/alert_high_conviction.mp3";
  function playHighConvictionAlert() {
    playUrl(HIGH_CONVICTION_AUDIO_URL, () => speakTextLine(t("highConvictionVoice")));
  }

  // De-dupe key for flash/alert triggers so a signal sitting in the 3h
  // active/closed window doesn't re-fire every 20s poll.
  const seenFeedFxKeys = new Set();
  async function pollLiveFeedFx() {
    try {
      const res = await fetch(liveFeedUrl(), { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      const all = (data.active_signals_3h || []).concat(data.closed_signals_3h || []);
      const fresh = all.filter((sig) => sig && !seenFeedFxKeys.has(vpsSigKey(sig)));
      if (!fresh.length) return;
      fresh.forEach((sig) => seenFeedFxKeys.add(vpsSigKey(sig)));
      scheduleIdleVoice();
      const last = fresh[fresh.length - 1];
      triggerScreenFlash(vpsTapeAction(last));
      if (FOCUS_STRATEGY_IDS.has(last.strategy_id)) playHighConvictionAlert();
    } catch {
      /* live_feed.json optional for this decorative layer */
    }
  }

  function bindLiveChromeOffset() {
    const apply = () => {
      const chrome = document.querySelector(".live-sticky-chrome");
      if (!chrome) return;
      const h = Math.round(chrome.getBoundingClientRect().height);
      document.documentElement.style.setProperty("--live-chrome-h", h + "px");
    };
    apply();
    window.addEventListener("resize", apply);
    if (typeof ResizeObserver !== "undefined") {
      const chrome = document.querySelector(".live-sticky-chrome");
      if (chrome) new ResizeObserver(apply).observe(chrome);
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
        loadTvChartForFocus();
      } else {
        watchCoins = watchCoins.filter((c) => c !== sym);
      }
      saveJsonArray(WATCH_COINS_KEY, watchCoins);
      const row = input.closest(".coin-pill");
      if (row) row.classList.toggle("is-checked", input.checked);
      paintConfigCounts();
      renderSelectedMatrix();
      renderLegend();
      refreshWatchTape();
      scheduleFunnelVoice();
      refreshActive();
    });
  }

  // Strategy display names are "中文核心詞 (English Alias)". Splitting them
  // lets mobile hide the English half (too long for a 2-col grid) while
  // desktop keeps showing both — same underlying name, no data change.
  function splitStrategyName(name) {
    const s = String(name || "");
    const m = s.match(/^(.*?)\s*(\([^)]*\))\s*$/);
    return m ? { zh: m[1], en: m[2] } : { zh: s, en: "" };
  }
  function wrForStrategy(id) {
    const lb = window.QALeaderboard;
    if (!lb) return null;
    const by = lb.by_engine && (lb.by_engine[id] || lb.by_engine[String(id).toLowerCase()]);
    if (by && Number.isFinite(Number(by.win_rate))) return Number(by.win_rate);
    const rows = (lb.strategies || []).filter((r) => r && (r.id === id || r.engine === id));
    if (!rows.length) return null;
    let best = null;
    rows.forEach((r) => {
      const n = Number(r.win_rate);
      if (Number.isFinite(n) && (best == null || n > best)) best = n;
    });
    return best;
  }
  function fmtWrTag(id) {
    const wr = wrForStrategy(id);
    if (!Number.isFinite(wr)) return "";
    const pct = wr <= 1 ? wr * 100 : wr;
    return pct.toFixed(0) + "%";
  }

  function matrixRowHtml(s) {
    const checked = watchStrategyIds.includes(s.id);
    const lb = window.QALeaderboard && window.QALeaderboard.by_engine
      ? window.QALeaderboard.by_engine[s.id]
      : null;
    const zh = (lb && lb.name_zh) || splitStrategyName(s.name).zh;
    const en = (lb && lb.name_en) ? "(" + lb.name_en + ")" : splitStrategyName(s.name).en;
    const enHtml = en ? ` <span class="matrix-name-en">${escapeHtml(en)}</span>` : "";
    const wr = fmtWrTag(s.id);
    const wrHtml = wr ? `<span class="matrix-wr">${escapeHtml(wr)}</span>` : "";
    return `<label class="matrix-row${checked ? " is-checked" : ""}" data-row="${s.id}">
        <input type="checkbox" class="matrix-check" data-select="${s.id}" ${checked ? "checked" : ""} />
        <span class="matrix-dot${isHot(s.id) ? " is-hot" : ""}" data-dot="${s.id}" aria-hidden="true"></span>
        <span class="matrix-name">${escapeHtml(zh)}${enHtml}</span>
        ${wrHtml}
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
      paintConfigCounts();
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

  let countdownTimer = null;
  let pollTimer = null;
  let watchPollTimer = null;
  let lastSeenTs = new Map();
  let baselineSet = new Set();

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
    if (seq !== watchRefreshSeq) return;
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

  const legendEl = document.getElementById("warChartLegend");

  /* ========================================================= */
  /* [LOCKED MODULE: TRADINGVIEW CHART ENGINE]                 */
  /* DO NOT MODIFY OR RE-INITIALIZE DURING OTHER FEATURE EDITS */
  /* ========================================================= */

  let activeSymbolOverride = null;

  function focusCoin() {
    return activeSymbolOverride || watchCoins[watchCoins.length - 1] || "BTCUSDT";
  }
  function effectiveSymbol(s) {
    return focusCoin() || (s && s.symbol) || "BTCUSDT";
  }

  /** Only on explicit user coin/strategy focus — never from feed polls. */
  function loadTvChartForFocus() {
    const TV = window.TVChartManager;
    if (!TV) return;
    TV.load(focusCoin(), CHART_INTERVAL).catch(function () {
      /* optional */
    });
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
      renderLegend();
      loadTvChartForFocus();
      refreshActiveSignals();
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
        refreshActiveSignals();
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

  /* Poll strategy signals only — never re-init TradingView here. */
  let activeRefreshSeq = 0;
  async function refreshActiveSignals() {
    if (!activeStrategy) return;
    const seq = ++activeRefreshSeq;
    const s = activeStrategy;
    const sym = effectiveSymbol(s);
    let signalBars = [];
    try {
      signalBars = await barsOf(sym, s.interval);
    } catch {
      return;
    }
    if (seq !== activeRefreshSeq || activeStrategy !== s) return;
    if (!signalBars.length) return;

    const spec = catalog.get(s.id);
    if (!spec || typeof spec.run !== "function") return;
    let trades = [];
    try {
      trades = spec.run(signalBars) || [];
    } catch {
      trades = [];
    }
    if (seq !== activeRefreshSeq || activeStrategy !== s) return;

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

  function refreshActive() {
    return refreshActiveSignals();
  }

  /* ========================================================= */
  /* [END LOCKED MODULE: TRADINGVIEW CHART ENGINE]             */
  /* ========================================================= */

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
    loadTvChartForFocus();
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
    bindVpsExecBoard();
    bindLiveChromeOffset();
    bindScanHud();
    bindMobileExecSheet();
    bindConfigSheet();
    loadLeaderboardForRail().then(() => {
      renderMatrix(strategies);
      paintFocusHighlight(activeStrategy ? activeStrategy.id : null);
      paintConfigCounts();
    });
    window.addEventListener("qa-leaderboard-ready", () => {
      renderMatrix(strategies);
      paintFocusHighlight(activeStrategy ? activeStrategy.id : null);
    });
    scheduleIdleVoice();
    pollLiveFeedFx();
    setInterval(pollLiveFeedFx, 20000);

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
    paintConfigCounts();
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
      refreshVpsExecBoard();
      paintConfigCounts();
    });
  }

  boot().catch((err) => {
    toast(String((err && err.message) || err), "err");
  });
})();
