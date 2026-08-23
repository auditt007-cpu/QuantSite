(function () {
  const catalog = window.QACatalog;
  const ENGINES = window.QA_ENGINE_LIST || [];
  const TAPE_MAX = 50;
  const MUTE_KEY = "qa_live_mute";
  const PIN_KEY = "qa_live_pinned_ids";
  const SYMS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT"];

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

  /* ---------------------------------------------------------------------
   * Sound: synthesized "hammer strike" for bar-close confirmation.
   * No binary assets — purely generated via Web Audio oscillator/noise.
   * ------------------------------------------------------------------- */
  let audioCtx = null;
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
  function ensureAudioCtx() {
    if (audioCtx) return audioCtx;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    audioCtx = new Ctor();
    return audioCtx;
  }
  function unlockAudioOnce() {
    const unlock = () => {
      const ctx = ensureAudioCtx();
      if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
      document.removeEventListener("click", unlock);
      document.removeEventListener("touchstart", unlock);
      document.removeEventListener("keydown", unlock);
    };
    document.addEventListener("click", unlock, { once: true });
    document.addEventListener("touchstart", unlock, { once: true, passive: true });
    document.addEventListener("keydown", unlock, { once: true });
  }
  function playHammerSound() {
    if (isMuted()) return;
    const ctx = ensureAudioCtx();
    if (!ctx) return;
    try {
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(190, now);
      osc.frequency.exponentialRampToValueAtTime(46, now + 0.16);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.5, now + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.26);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.28);

      const bufSize = Math.max(1, Math.floor(ctx.sampleRate * 0.045));
      const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufSize, 2);
      }
      const noise = ctx.createBufferSource();
      noise.buffer = buf;
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 1400;
      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(0.32, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
      noise.connect(hp).connect(noiseGain).connect(ctx.destination);
      noise.start(now);
      noise.stop(now + 0.06);
    } catch {
      /* audio blocked — visuals still convey the confirmation */
    }
  }

  /* ---------------------------------------------------------------------
   * Leaderboard + card metrics (mirrors terminal.js seedMetrics logic).
   * ------------------------------------------------------------------- */
  let leaderboard = window.QALeaderboard || null;
  async function loadLeaderboard() {
    if (leaderboard) return leaderboard;
    try {
      const cfg = window.QUANT_CONFIG;
      const url = (cfg && cfg.leaderboardUrl) || "./leaderboard.json";
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) return null;
      leaderboard = await res.json();
      window.QALeaderboard = leaderboard;
      return leaderboard;
    } catch {
      return null;
    }
  }

  function lbForEngine(id) {
    if (!leaderboard || !leaderboard.by_engine) return null;
    const be = leaderboard.by_engine;
    if (be[id]) return be[id];
    const lower = String(id).toLowerCase();
    const keys = Object.keys(be);
    for (let i = 0; i < keys.length; i++) {
      if (keys[i].toLowerCase() === lower) return be[keys[i]];
    }
    return null;
  }

  function seedMetrics(id) {
    const lb = lbForEngine(id);
    if (lb) {
      return {
        wr: Number.isFinite(lb.win_rate_smooth) ? lb.win_rate_smooth : Number.isFinite(lb.win_rate) ? lb.win_rate : null,
        pf: Number.isFinite(lb.profit_factor) ? lb.profit_factor : null,
        ret: Number.isFinite(lb.roi_pct) ? lb.roi_pct / 100 : null,
        trades: Number.isFinite(lb.total_trades) ? lb.total_trades : Number.isFinite(lb.trades) ? lb.trades : null,
      };
    }
    const spec = catalog && catalog.get(id);
    const m = (spec && spec.metrics) || {};
    const parsePct = (raw) => {
      if (raw == null || raw === "") return null;
      const mm = String(raw).match(/-?\d+(?:\.\d+)?/);
      if (!mm) return null;
      const n = Number(mm[0]);
      return Number.isFinite(n) ? n / (String(raw).includes("%") || Math.abs(n) > 1 ? 100 : 1) : null;
    };
    return { wr: parsePct(m.win_rate), pf: null, ret: parsePct(m.week_return || m.optimal_return), trades: null };
  }

  /* ---------------------------------------------------------------------
   * Build strategy card model list from the canonical 45-ID engine list.
   * ------------------------------------------------------------------- */
  const INTERVAL_MS = { "1m": 60000, "5m": 300000, "15m": 900000, "1h": 3600000, "4h": 14400000, "1d": 86400000, "1w": 604800000 };

  function buildCards() {
    const out = [];
    ENGINES.forEach(([id, tier]) => {
      const spec = catalog && catalog.get(id);
      if (!spec) return;
      out.push({
        id,
        tier,
        engine: id,
        name: spec.name || id,
        symbols: (spec.symbols && spec.symbols.length && spec.symbols) || ["BTCUSDT"],
        interval: spec.interval || "1h",
        tags: (spec.tags && spec.tags.length && spec.tags) || (tier === "master" ? ["機構實盤"] : ["開源"]),
        principle: spec.principle || "",
      });
    });
    return out;
  }

  function hashStr(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  function fmtMMSS(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return String(m).padStart(2, "0") + ":" + String(r).padStart(2, "0");
  }

  /* ---------------------------------------------------------------------
   * Pinning (localStorage-backed watchlist).
   * ------------------------------------------------------------------- */
  function loadPins() {
    try {
      const raw = JSON.parse(localStorage.getItem(PIN_KEY) || "[]");
      return Array.isArray(raw) ? raw.filter((x) => typeof x === "string") : [];
    } catch {
      return [];
    }
  }
  function savePins(ids) {
    try {
      localStorage.setItem(PIN_KEY, JSON.stringify(ids));
    } catch {
      /* private mode */
    }
  }
  let pinnedIds = loadPins();

  function cardBadgeHtml(id) {
    return `<span class="lockin-badge" data-lockin="${id}"><span class="lockin-msg"></span><span class="lockin-time"></span></span>`;
  }

  function cardHtml(card, pinnedVariant) {
    const master = card.tier === "master";
    const pinned = pinnedIds.includes(card.id);
    const seed = seedMetrics(card.id);
    const wrPct = seed.wr != null ? (seed.wr * 100).toFixed(1) + "%" : "計算中";
    const pfTxt = seed.pf != null ? seed.pf.toFixed(2) : "—";
    const badge = master ? `<span class="vip-badge">🔒 機構實盤</span>` : "";
    const tags = card.tags.map((tg) => `<span class="tag">${escapeHtml(tg)}</span>`).join("");
    const openHref = "./terminal.html?strategy=" + encodeURIComponent(card.id) + "&interval=" + encodeURIComponent(card.interval);
    const hitLine =
      seed.wr != null
        ? `<p class="card-hit" data-hit-line>👑 ${t("mktWr")} ${wrPct}${seed.ret != null ? " · " + (seed.ret * 100).toFixed(1) + "%" : ""}</p>`
        : `<p class="card-hit" data-hit-line></p>`;
    return `<article class="m-card strategy-card${master ? " master" : ""}${pinnedVariant ? " pinned-card" : ""}${pinned ? " is-pinned" : ""}" data-id="${card.id}" data-engine="${card.id}">
        ${badge}
        <button type="button" class="card-pin-btn${pinned ? " is-pinned" : ""}" data-pin-toggle="${card.id}" aria-pressed="${pinned}" title="${pinned ? t("pinRemove") : t("pinAdd")}">${pinned ? "★" : "☆"}</button>
        <h3>${escapeHtml(card.name)}</h3>
        ${hitLine}
        ${card.principle ? `<p class="card-principle">${escapeHtml(card.principle)}</p>` : ""}
        <p class="muted">${card.symbols.join(" / ")} · ${String(card.interval).toUpperCase()}</p>
        <div class="tags">${tags}</div>
        <div class="stat-caps">
          <div class="stat-cap"><span>${t("mktWr")}</span><b>${wrPct}</b></div>
          <div class="stat-cap"><span>${t("mktSh")}</span><b>${pfTxt}</b></div>
        </div>
        ${cardBadgeHtml(card.id)}
        <div class="card-actions">
          <a class="btn-cta compact" href="${openHref}">⚡ ${t("mktOpenBt")}</a>
        </div>
      </article>`;
  }

  /* ---------------------------------------------------------------------
   * Render grid + pinned rail.
   * ------------------------------------------------------------------- */
  const gridEl = document.getElementById("liveGrid");
  const pinnedRail = document.getElementById("pinnedRail");
  const pinnedTrack = document.getElementById("pinnedTrack");

  function renderGrid(cards) {
    if (!gridEl) return;
    gridEl.innerHTML = cards.map((c) => cardHtml(c, false)).join("") || `<p class="muted">${t("mktEmpty")}</p>`;
  }

  function renderPinnedRail(cards) {
    if (!pinnedRail || !pinnedTrack) return;
    const byId = new Map(cards.map((c) => [c.id, c]));
    const pinnedCards = pinnedIds.map((id) => byId.get(id)).filter(Boolean);
    if (!pinnedCards.length) {
      pinnedRail.hidden = false;
      pinnedTrack.innerHTML = `<p class="pinned-empty">${t("pinnedEmpty")}</p>`;
      return;
    }
    pinnedRail.hidden = false;
    pinnedTrack.innerHTML = pinnedCards.map((c) => cardHtml(c, true)).join("");
  }

  function updatePinButtons(id, pinned) {
    document.querySelectorAll('[data-pin-toggle="' + id + '"]').forEach((btn) => {
      btn.classList.toggle("is-pinned", pinned);
      btn.setAttribute("aria-pressed", String(pinned));
      btn.textContent = pinned ? "★" : "☆";
      btn.title = pinned ? t("pinRemove") : t("pinAdd");
    });
    document.querySelectorAll('.m-card[data-id="' + id + '"]').forEach((card) => {
      card.classList.toggle("is-pinned", pinned);
    });
  }

  function togglePin(id, cards) {
    const idx = pinnedIds.indexOf(id);
    const pinning = idx === -1;
    if (pinning) pinnedIds.push(id);
    else pinnedIds.splice(idx, 1);
    savePins(pinnedIds);
    updatePinButtons(id, pinning);
    renderPinnedRail(cards);
    if (pinning && pinnedTrack) {
      const flown = pinnedTrack.querySelector('[data-id="' + id + '"]');
      if (flown) flown.classList.add("pin-fly");
    }
  }

  function bindPinClicks(cards) {
    document.addEventListener("click", (ev) => {
      const btn = ev.target.closest("[data-pin-toggle]");
      if (!btn) return;
      togglePin(btn.getAttribute("data-pin-toggle"), cards);
    });
  }

  /* ---------------------------------------------------------------------
   * Live watchers + today's signal counters (client-side atmosphere layer,
   * seeded from real leaderboard sample sizes where available).
   * ------------------------------------------------------------------- */
  const watchersEl = document.getElementById("liveWatchersCount");
  const signalsEl = document.getElementById("liveSignalsCount");
  let watchers = 180;
  let signalsToday = 1200;

  function seedCountersFromLeaderboard() {
    if (leaderboard && leaderboard.by_engine) {
      const rows = Object.values(leaderboard.by_engine);
      const totalTrades = rows.reduce((sum, r) => sum + (Number(r.total_trades || r.trades) || 0), 0);
      if (totalTrades > 0) signalsToday = 300 + (totalTrades % 900);
      watchers = 140 + (rows.length ? Math.round((totalTrades / Math.max(1, rows.length)) % 90) : 0);
    }
  }

  function paintCounters() {
    if (watchersEl) watchersEl.textContent = watchers.toLocaleString("en-US");
    if (signalsEl) signalsEl.textContent = signalsToday.toLocaleString("en-US");
  }

  function tickCounters() {
    const hourUtc = new Date().getUTCHours();
    // Mild day/night wave: busier during Asia + US session overlaps.
    const wave = 26 * Math.sin(((hourUtc + 2) / 24) * Math.PI * 2);
    const target = 180 + wave;
    watchers += Math.round((target - watchers) * 0.08 + (Math.random() * 6 - 3));
    watchers = Math.max(58, Math.min(420, watchers));
    if (Math.random() < 0.7) signalsToday += Math.floor(Math.random() * 3);
    paintCounters();
  }

  /* ---------------------------------------------------------------------
   * Global execution tape (capped at TAPE_MAX DOM nodes for robustness).
   * ------------------------------------------------------------------- */
  const tapeEl = document.getElementById("liveTape");
  function addTapeEntry(text, confirmed) {
    if (!tapeEl) return;
    const empty = tapeEl.querySelector(".muted");
    if (empty) empty.remove();
    const li = document.createElement("li");
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    li.innerHTML = `<time>[${hh}:${mm}]</time><span${confirmed ? ' class="tape-confirmed"' : ""}>${escapeHtml(text)}</span>`;
    tapeEl.insertBefore(li, tapeEl.firstChild);
    while (tapeEl.children.length > TAPE_MAX) {
      tapeEl.removeChild(tapeEl.lastChild);
    }
  }

  /* ---------------------------------------------------------------------
   * Crowd activity toast capsules (Copart-style social proof).
   * ------------------------------------------------------------------- */
  const NODES = {
    "zh-Hant": ["台北", "新加坡", "香港", "東京", "首爾", "紐約", "倫敦", "法蘭克福", "雪梨", "多倫多"],
    "zh-CN": ["台北", "新加坡", "香港", "东京", "首尔", "纽约", "伦敦", "法兰克福", "悉尼", "多伦多"],
    en: ["Taipei", "Singapore", "Hong Kong", "Tokyo", "Seoul", "New York", "London", "Frankfurt", "Sydney", "Toronto"],
  };
  const ROLES = {
    "zh-Hant": ["用戶", "會員", "節點", "機構"],
    "zh-CN": ["用户", "会员", "节点", "机构"],
    en: ["User", "Member", "Node", "Institution"],
  };
  const DIR_TXT = {
    "zh-Hant": { LONG: "做多", SHORT: "做空" },
    "zh-CN": { LONG: "做多", SHORT: "做空" },
    en: { LONG: "LONG", SHORT: "SHORT" },
  };
  const TOAST_TPL = {
    "zh-Hant": {
      follow: (n, r, sym) => `⚡ [${n}·${r}] 正在跟隨 #${sym} 突破策略`,
      sync: (n, r, sym, tf, dir) => `⚡ [${n}·${r}] 已同步執行 #${sym} ${tf} ${dir} 訊號`,
      lock: (n, r, sym, pct) => `⚡ [${n}·${r}] 成功鎖定 ${sym} 止盈點位 +${pct}%`,
    },
    "zh-CN": {
      follow: (n, r, sym) => `⚡ [${n}·${r}] 正在跟随 #${sym} 突破策略`,
      sync: (n, r, sym, tf, dir) => `⚡ [${n}·${r}] 已同步执行 #${sym} ${tf} ${dir} 信号`,
      lock: (n, r, sym, pct) => `⚡ [${n}·${r}] 成功锁定 ${sym} 止盈点位 +${pct}%`,
    },
    en: {
      follow: (n, r, sym) => `⚡ [${n} · ${r}] is following the #${sym} breakout strategy`,
      sync: (n, r, sym, tf, dir) => `⚡ [${n} · ${r}] synced a #${sym} ${tf} ${dir} signal`,
      lock: (n, r, sym, pct) => `⚡ [${n} · ${r}] locked in +${pct}% on ${sym}`,
    },
  };

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
    const nodes = NODES[key] || NODES.en;
    const roles = ROLES[key] || ROLES.en;
    const dirs = DIR_TXT[key] || DIR_TXT.en;
    const tpl = TOAST_TPL[key] || TOAST_TPL.en;
    const kind = randomFrom(["follow", "sync", "sync", "lock"]);
    const node = randomFrom(nodes);
    const role = randomFrom(roles);
    const sym = randomFrom(SYMS).replace("USDT", "");
    let text;
    if (kind === "follow") {
      text = tpl.follow(node, role, sym);
    } else if (kind === "sync") {
      const tf = randomFrom(["15M", "1H", "4H"]);
      const dir = Math.random() < 0.5 ? dirs.LONG : dirs.SHORT;
      text = tpl.sync(node, role, sym, tf, dir);
    } else {
      const pct = (0.6 + Math.random() * 4.4).toFixed(1);
      text = tpl.lock(node, role, sym, pct);
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
    const nodes = NODES[key] || NODES.en;
    const roles = ROLES[key] || ROLES.en;
    const tpl = TOAST_TPL[key] || TOAST_TPL.en;
    const pct = (0.8 + Math.random() * 4.6).toFixed(1);
    return tpl.lock(randomFrom(nodes), randomFrom(roles), sym.replace("USDT", ""), pct);
  }

  /* ---------------------------------------------------------------------
   * Bar-close lock-in countdown engine — driven by real wall-clock bar
   * boundaries per strategy interval. A deterministic hash decides which
   * ~1/3 of strategies carry a "pending signal" in any given bar bucket,
   * so all visitors see the same synchronized state (global broadcast feel).
   * ------------------------------------------------------------------- */
  function isPendingSignal(id, bucket) {
    return (hashStr(id) + bucket) % 3 === 0;
  }

  function tickCard(state, now) {
    if (state.confirmedUntil) {
      if (now < state.confirmedUntil) return { phase: "confirmed" };
      state.confirmedUntil = 0;
      state.bucket = -1;
    }
    const bucket = Math.floor(now / state.intervalMs);
    if (bucket !== state.bucket) {
      const wasPending = state.bucket >= 0 && state.pending;
      state.bucket = bucket;
      state.pending = isPendingSignal(state.id, bucket);
      if (wasPending) {
        state.confirmedUntil = now + 3200;
        return { phase: "confirmed" };
      }
    }
    if (!state.pending) return { phase: "idle" };
    const remaining = (bucket + 1) * state.intervalMs - now;
    return { phase: remaining <= 10000 ? "warn" : "pending", remaining };
  }

  function paintLockin(card, result) {
    const badges = document.querySelectorAll('.lockin-badge[data-lockin="' + card.id + '"]');
    badges.forEach((b) => {
      b.classList.remove("is-pending", "is-warn", "is-confirmed");
      const msg = b.querySelector(".lockin-msg");
      const time = b.querySelector(".lockin-time");
      if (result.phase === "idle") {
        b.classList.remove("is-pending");
        return;
      }
      b.classList.add("is-pending");
      if (result.phase === "warn") {
        b.classList.add("is-warn");
        if (msg) msg.textContent = t("lockinWarn");
        if (time) time.textContent = fmtMMSS(result.remaining);
      } else if (result.phase === "confirmed") {
        b.classList.add("is-confirmed");
        if (msg) msg.textContent = t("lockinConfirmed");
        if (time) time.textContent = "";
      } else {
        if (msg) msg.textContent = t("lockinLabel");
        if (time) time.textContent = fmtMMSS(result.remaining);
      }
    });
  }

  function fireConfirmedFx(card) {
    document.querySelectorAll('.m-card[data-id="' + card.id + '"]').forEach((el) => {
      el.classList.remove("lockin-hit");
      void el.offsetWidth;
      el.classList.add("lockin-hit");
    });
    playHammerSound();
    const sym = (card.symbols && card.symbols[0]) || "BTCUSDT";
    const text = crowdLockEventText(sym);
    pushCrowdToast(text);
    addTapeEntry(text, true);
    signalsToday += 1;
    paintCounters();
  }

  function startLockinEngine(cards) {
    const states = new Map();
    cards.forEach((card) => {
      states.set(card.id, {
        id: card.id,
        intervalMs: INTERVAL_MS[card.interval] || INTERVAL_MS["1h"],
        bucket: -1,
        pending: false,
        confirmedUntil: 0,
        lastPhase: "idle",
      });
    });
    function tick() {
      const now = Date.now();
      cards.forEach((card) => {
        const st = states.get(card.id);
        if (!st) return;
        const result = tickCard(st, now);
        if (result.phase === "confirmed" && st.lastPhase !== "confirmed") {
          fireConfirmedFx(card);
        }
        st.lastPhase = result.phase;
        paintLockin(card, result);
      });
    }
    tick();
    setInterval(tick, 1000);
  }

  /* ---------------------------------------------------------------------
   * Mute toggle.
   * ------------------------------------------------------------------- */
  function bindMuteBtn() {
    const btn = document.getElementById("liveMuteBtn");
    if (!btn) return;
    const paint = () => {
      const muted = isMuted();
      btn.setAttribute("data-i18n", muted ? "liveMuteOff" : "liveMuteOn");
      btn.textContent = muted ? t("liveMuteOff") : t("liveMuteOn");
    };
    btn.addEventListener("click", () => {
      setMuted(!isMuted());
      paint();
      if (!isMuted()) playHammerSound();
    });
    paint();
    window.addEventListener("quant-lang", paint);
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
    if (!catalog || !ENGINES.length) {
      if (gridEl) gridEl.innerHTML = `<p class="muted">${t("mktEmpty")}</p>`;
      return;
    }
    const cards = buildCards();
    if (!cards.length) {
      if (gridEl) gridEl.innerHTML = `<p class="muted">${t("mktEmpty")}</p>`;
      return;
    }
    pinnedIds = pinnedIds.filter((id) => cards.some((c) => c.id === id));
    renderGrid(cards);
    renderPinnedRail(cards);
    bindPinClicks(cards);
    bindMuteBtn();
    unlockAudioOnce();
    paintCounters();
    setInterval(tickCounters, 4000);
    scheduleCrowdLoop();
    setTimeout(spawnRandomCrowdEvent, 900);
    startLockinEngine(cards);

    await loadLeaderboard();
    if (leaderboard) {
      seedCountersFromLeaderboard();
      paintCounters();
      renderGrid(cards);
      renderPinnedRail(cards);
      window.dispatchEvent(new CustomEvent("qa-leaderboard-ready"));
    }

    window.addEventListener("quant-lang", () => {
      renderGrid(cards);
      renderPinnedRail(cards);
    });
  }

  boot().catch((err) => {
    toast(String((err && err.message) || err), "err");
  });
})();
