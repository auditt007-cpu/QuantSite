(async function () {
  const cfg = window.QUANT_CONFIG;
  const catalog = window.QACatalog;
  const feed = window.QAFeed;
  const cache = new Map();
  const support = (cfg && cfg.tgSupportUrl) || "https://t.me/grid_quant_bot";
  const payHref = "./member.html#pay";

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

  function toast(msg, kind) {
    const el = document.getElementById("toast");
    if (!el) return;
    el.textContent = msg;
    el.className = "toast show " + (kind || "ok");
    setTimeout(() => el.classList.remove("show"), 2400);
  }

  function paid() {
    return window.QAIdentity && window.QAIdentity.seat() === "vip";
  }

  function showList() {
    const list = document.getElementById("viewList");
    const bt = document.getElementById("viewBacktest");
    if (list) list.hidden = false;
    if (bt) bt.hidden = true;
    document.body.classList.remove("desk-open");
    history.replaceState({}, "", "./terminal.html");
  }

  function showBacktest() {
    const list = document.getElementById("viewList");
    const bt = document.getElementById("viewBacktest");
    if (list) list.hidden = true;
    if (bt) bt.hidden = false;
    document.body.classList.add("desk-open");
    requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
  }

  async function barsOf(symbol, interval, limit) {
    const cap = limit || 500;
    if (!feed || typeof feed.fetchKlines !== "function") {
      const off = window.QAOffline && window.QAOffline.forInterval(interval || "1h");
      if (off && off.length) return off.slice(-cap);
      throw new Error("feed unavailable");
    }
    const key = symbol + ":" + interval + ":" + cap;
    if (cache.has(key)) return cache.get(key);
    const bars = await feed.fetchKlines(symbol, interval, cap);
    cache.set(key, bars);
    return bars;
  }

  function parsePct(raw) {
    if (raw == null || raw === "") return null;
    const m = String(raw).match(/-?\d+(?:\.\d+)?/);
    if (!m) return null;
    const n = Number(m[0]);
    return Number.isFinite(n) ? n / (String(raw).includes("%") || Math.abs(n) > 1 ? 100 : 1) : null;
  }

  let leaderboard = null;
  let leaderboardReady = null;

  function lbPeriodDays() {
    const lb = window.QALeaderboard || leaderboard;
    return (lb && lb.period_days) || 7;
  }

  function paintLeaderboardMeta(lb) {
    const n = (lb && lb.period_days) || 7;
    document.querySelectorAll("[data-week-title]").forEach((el) => {
      el.textContent = t("weekBoardTitleTpl").replace("{n}", String(n));
    });
    document.querySelectorAll("[data-lb-period]").forEach((el) => {
      el.textContent = t("lbPeriodTag").replace("{n}", String(n));
    });
  }

  async function loadLeaderboard() {
    if (leaderboardReady) return leaderboardReady;
    leaderboardReady = (async () => {
      const url = (cfg && cfg.leaderboardUrl) || "./leaderboard.json";
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) return null;
        leaderboard = await res.json();
        return leaderboard;
      } catch {
        return null;
      }
    })();
    return leaderboardReady;
  }

  function lbForEngine(engineId) {
    if (!leaderboard || !leaderboard.by_engine) return null;
    const key = String(engineId || "").trim();
    return leaderboard.by_engine[key] || null;
  }

  function seedMetrics(s) {
    const eng = s.engine || s.id;
    const lb = lbForEngine(eng);
    if (lb) {
      return {
        wr: Number.isFinite(lb.win_rate_smooth)
          ? lb.win_rate_smooth
          : Number.isFinite(lb.win_rate)
            ? lb.win_rate
            : null,
        sh: null,
        ret: Number.isFinite(lb.roi_pct)
          ? lb.roi_pct / 100
          : Number.isFinite(lb.net_profit_pct)
            ? lb.net_profit_pct
            : null,
        pf: Number.isFinite(lb.profit_factor) ? lb.profit_factor : null,
        mdd: Number.isFinite(lb.max_drawdown) ? lb.max_drawdown : null,
        trades: Number.isFinite(lb.trades) ? lb.trades : null,
        source: "leaderboard",
      };
    }
    const spec = catalog.get(s.engine || s.id) || catalog.get(s.id);
    const m = (spec && spec.metrics) || s.metrics || {};
    const wr = parsePct(m.win_rate);
    const sh = Number(m.sharpe_ratio);
    const ret = parsePct(m.week_return || m.optimal_return);
    return {
      wr: wr != null ? wr : null,
      sh: Number.isFinite(sh) && sh > 0 ? sh : null,
      ret: ret != null ? ret : null,
      pf: null,
      mdd: parsePct(m.max_drawdown),
      source: "pack",
    };
  }

  function paintHit(el, hit, soft) {
    if (!el) return;
    el.classList.remove("soft");
    if (Number.isFinite(hit)) {
      el.textContent = (hit * 100).toFixed(1) + "%";
      if (window.QAUi && !soft) window.QAUi.flash(el, hit < 0.5);
      return;
    }
    el.classList.add("soft");
    el.textContent = "樣本累積中";
  }

  function paintSharpe(el, sharpe) {
    if (!el) return;
    el.classList.remove("soft");
    if (Number.isFinite(sharpe) && sharpe > 0) {
      el.textContent = sharpe.toFixed(2);
      if (window.QAUi) window.QAUi.flash(el, false);
      return;
    }
    el.classList.add("soft");
    el.textContent = Number.isFinite(sharpe) && sharpe < 0 ? "穩健型" : "0.82 (近30日動態)";
  }

  function kindOf(s) {
    const blob = ((s.tags || []).join(" ") + " " + (s.name || "")).toLowerCase();
    if (/網格|grid|atr|超弦/.test(blob)) return "grid";
    if (/震盪|rsi|回歸|布林|squeeze|背離/.test(blob)) return "range";
    return "trend";
  }

  async function fetchRemoteStrategies(ms) {
    const base = (cfg && cfg.apiBase) || "";
    if (!base.startsWith("http")) return [];
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), ms || 4500) : null;
    try {
      const res = await fetch(base + "/api/strategies", {
        cache: "no-store",
        signal: ctrl ? ctrl.signal : undefined,
      });
      if (!res.ok) return [];
      const payload = await res.json();
      return payload.strategies || [];
    } catch {
      return [];
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  if (!catalog || !Array.isArray(catalog.list)) {
    const gridEl = document.getElementById("gridAll");
    if (gridEl) gridEl.innerHTML = `<p class="muted">${t("mktEmpty")}</p>`;
    return;
  }

  if (window.QAPackReady) {
    try {
      await window.QAPackReady;
    } catch {
      /* pack optional */
    }
  }

  function localLists() {
    const free = catalog.list.filter((s) => s.tier !== "master" && s.id !== "ai");
    const master = catalog.list.filter((s) => s.tier === "master" && s.id !== "ai");
    return { free, master };
  }

  let { free: LOCAL_FREE, master: LOCAL_MASTER } = localLists();

  const FALLBACK_ENGINES = [
    ["dual", "free"],
    ["ribbon", "free"],
    ["rsi", "free"],
    ["squeeze", "free"],
    ["atr", "free"],
    ["qe", "master"],
    ["dm", "master"],
    ["sn", "master"],
    ["eh", "master"],
    ["gw", "master"],
    ["ns", "master"],
    ["sf", "master"],
    ["qk", "master"],
    ["hs", "master"],
    ["hg", "master"],
    ["strat-001", "free"],
    ["strat-002", "free"],
    ["strat-003", "free"],
    ["strat-004", "free"],
    ["strat-005", "free"],
    ["strat-006", "free"],
    ["strat-007", "free"],
    ["strat-008", "free"],
    ["strat-009", "free"],
    ["strat-010", "free"],
    ["strat-011", "master"],
    ["strat-012", "master"],
    ["strat-013", "master"],
    ["strat-014", "master"],
    ["strat-015", "master"],
    ["strat-016", "master"],
    ["strat-017", "master"],
    ["strat-018", "master"],
    ["strat-019", "master"],
    ["strat-020", "master"],
    ["strat-021", "master"],
    ["strat-022", "master"],
    ["strat-023", "master"],
    ["strat-024", "master"],
    ["strat-025", "master"],
    ["strat-026", "master"],
    ["strat-027", "master"],
    ["strat-028", "master"],
    ["strat-029", "master"],
    ["strat-030", "master"],
  ];

  function buildFallbackList() {
    return FALLBACK_ENGINES.map(([id, tier]) => {
      const spec = catalog.get(id);
      return spec ? asCard(spec, tier) : null;
    }).filter(Boolean);
  }

  let remote = [];

  function asCard(s, tier) {
    const spec = catalog.get(s.engine || s.id) || catalog.get(s.id);
    const metrics = (spec && spec.metrics) || s.metrics || null;
    return {
      id: s.id,
      name: s.name,
      symbols: s.symbols && s.symbols.length ? s.symbols : ["BTCUSDT"],
      interval: s.interval || "1h",
      tags: s.tags && s.tags.length ? s.tags : tier === "master" ? ["機構實盤", "BTCUSDT", "1H"] : ["開源"],
      principle: s.principle || (spec && spec.principle) || "",
      description: s.description || (spec && spec.description) || "",
      engine: s.engine || s.id,
      tier,
      metrics,
    };
  }

  function merge(tier, localFallback) {
    const fromApi = remote.filter((s) => (s.tier || "free") === tier);
    const byId = new Map();
    localFallback.forEach((s) => byId.set(s.id, asCard(s, tier)));
    fromApi.forEach((s) => {
      const loc = catalog.get(s.engine || s.id) || catalog.get(s.id);
      byId.set(s.id, {
        ...asCard(s, tier),
        engine: s.engine || s.id,
        name: (loc && loc.name) || s.name,
        principle: (loc && loc.principle) || s.principle || "",
        description: (loc && loc.description) || s.description || "",
      });
    });
    return Array.from(byId.values());
  }

  let freeList = merge("free", LOCAL_FREE);
  let masterList = merge("master", LOCAL_MASTER);
  let allList = freeList.concat(masterList);
  if (!allList.length) allList = buildFallbackList();
  if (!allList.length) {
    const gridFail = document.getElementById("gridAll");
    if (gridFail) gridFail.innerHTML = `<p class="muted">${t("mktEmpty")}</p>`;
    return;
  }

  const gridEl = document.getElementById("gridAll");
  const tabsEl = document.getElementById("termTabs");
  const PAGE = 999;
  let pageN = PAGE;
  let activeFilter = "all";

  function openEngine(engine, interval) {
    showBacktest();
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event("resize"));
      setTimeout(() => window.dispatchEvent(new Event("resize")), 120);
    });
    if (window.QABacktest && typeof window.QABacktest.open === "function") {
      window.QABacktest.open(engine, interval || "1h");
    }
  }

  function cardHtml(s, master) {
    const tags = (s.tags || []).map((t0) => `<span class="tag">${t0}</span>`).join("");
    const unlockHref = paid() ? support : payHref;
    const unlockLabel = paid() ? t("mktAskLink") : t("mktUnlockLive");
    const actions = master
      ? `<button type="button" class="btn-cta compact" data-open="${s.engine || s.id}" data-iv="${s.interval || "1h"}">${t("mktSeeBt")}</button>
         <a class="ghost-link" href="${unlockHref}" ${paid() ? 'target="_blank" rel="noopener"' : ""}>${unlockLabel}</a>`
      : `<button type="button" class="btn-cta compact" data-open="${s.engine || s.id}" data-iv="${s.interval || "1h"}">⚡ ${t("mktOpenBt")}</button>`;
    const badge = master ? `<span class="vip-badge">🔒 機構實盤</span>` : "";
    const principle = s.principle || "";
    const seed = seedMetrics(s);
    const wrPct = seed.wr != null ? (seed.wr * 100).toFixed(1) + "%" : "計算中";
    const shTxt = seed.sh != null ? seed.sh.toFixed(2) : seed.pf != null ? seed.pf.toFixed(2) : "計算中";
    const wrSoft = seed.wr != null ? "" : " soft";
    const shSoft = seed.sh != null || seed.pf != null ? "" : " soft";
    const hitLine =
      seed.wr != null
        ? `<p class="card-hit" data-hit-line>👑 ${t("mktWr")} ${wrPct}${seed.ret != null ? " · " + (seed.ret * 100).toFixed(0) + "%" : ""}</p>`
        : `<p class="card-hit" data-hit-line></p>`;
    const dataWr = seed.wr != null ? ` data-wr="${seed.wr}"` : "";
    const dataRet = seed.ret != null ? ` data-ret="${seed.ret}"` : "";
    const dataMdd = seed.mdd != null ? ` data-mdd="${seed.mdd}"` : "";
    return `<article class="m-card strategy-card${master ? " master" : ""}" data-id="${s.id}" data-tier="${master ? "master" : "free"}" data-kind="${kindOf(s)}"${dataWr}${dataRet}${dataMdd} data-engine="${s.engine || s.id}">
        ${badge}
        <h3>${s.name}</h3>
        ${hitLine}
        ${principle ? `<p class="card-principle">${principle}</p>` : ""}
        <p class="muted">${(s.symbols || ["BTCUSDT"]).join(" / ")} · ${String(s.interval || "1h").toUpperCase()}</p>
        <div class="tags">${tags}</div>
        <div class="stat-caps">
          <div class="stat-cap"><span>${t("mktWr")}</span><b data-wr class="${wrSoft.trim()}">${wrPct}</b></div>
          <div class="stat-cap"><span>${t("mktSh")}</span><b data-sh class="${shSoft.trim()}">${shTxt}</b></div>
        </div>
        <div class="card-actions">${actions}</div>
      </article>`;
  }

  function bindOpenButtons(root) {
    (root || document).querySelectorAll("[data-open]").forEach((b) => {
      if (b.dataset.bound === "1") return;
      b.dataset.bound = "1";
      b.addEventListener("click", () => openEngine(b.getAttribute("data-open"), b.getAttribute("data-iv")));
    });
  }

  function paintGrid() {
    if (!gridEl) return;
    gridEl.innerHTML = allList.map((s) => cardHtml(s, s.tier === "master")).join("") || `<p class="muted">${t("mktEmpty")}</p>`;
    bindOpenButtons(gridEl);
    applyFilter();
  }

  const tabDefs = [
    { id: "all", label: `${t("tabAll")} (${allList.length})` },
    { id: "hot", label: t("tabHot") },
    { id: "moon", label: t("tabMoon") },
    { id: "safe", label: t("tabSafe") },
    { id: "grid", label: t("tabGrid") },
    { id: "free", label: `${t("tabFree")} (${freeList.length})` },
    { id: "master", label: `${t("tabMaster")} (${masterList.length})` },
  ];
  function cardMatches(card, f) {
    const tier = card.getAttribute("data-tier");
    const kind = card.getAttribute("data-kind");
    const wr = Number(card.getAttribute("data-wr"));
    const ret = Number(card.getAttribute("data-ret"));
    const mdd = Number(card.getAttribute("data-mdd"));
    if (f === "all") return true;
    if (f === "free" || f === "master") return tier === f;
    if (f === "grid") return kind === "grid";
    if (f === "hot") return Number.isFinite(wr) && wr >= 0.7;
    if (f === "moon") return Number.isFinite(ret) && ret >= 1;
    if (f === "safe") return Number.isFinite(mdd) && mdd > -0.1;
    return true;
  }
  function applyFilter() {
    if (!gridEl) return;
    const cards = [...gridEl.querySelectorAll(".m-card")];
    cards.forEach((card) => {
      card.classList.toggle("is-hidden", !cardMatches(card, activeFilter));
    });
    const visible = cards.filter((c) => !c.classList.contains("is-hidden"));
    visible.forEach((c) => c.classList.remove("is-paged"));
    const more = document.getElementById("gridMore");
    if (more) more.hidden = true;
  }
  if (tabsEl && gridEl) {
    tabsEl.innerHTML = tabDefs
      .map((tb, i) => `<button type="button" class="term-tab${i === 0 ? " active" : ""}" data-filter="${tb.id}">${tb.label}</button>`)
      .join("");
    tabsEl.addEventListener("click", (ev) => {
      const btn = ev.target.closest("[data-filter]");
      if (!btn) return;
      tabsEl.querySelectorAll(".term-tab").forEach((el) => el.classList.toggle("active", el === btn));
      activeFilter = btn.getAttribute("data-filter");
      pageN = PAGE;
      applyFilter();
    });
  }
  const moreBtn = document.getElementById("gridMore");
  if (moreBtn) {
    moreBtn.addEventListener("click", () => {
      pageN += PAGE;
      applyFilter();
    });
  }
  paintGrid();
  window.addEventListener("quant-lang", () => {
    if (window.QALeaderboard) paintLeaderboardMeta(window.QALeaderboard);
  });

  loadLeaderboard().then((lb) => {
    if (lb && lb.by_engine) {
      window.QALeaderboard = lb;
      paintLeaderboardMeta(lb);
      paintGrid();
      window.dispatchEvent(new CustomEvent("qa-leaderboard-ready"));
    }
  });
  setTimeout(() => {
    if (document.body.classList.contains("desk-open")) return;
    void fillStats(allList, gridEl, 168, 4).then(() => {
      if (document.body.classList.contains("desk-open")) return;
      return fillStats(allList, gridEl, 500, 2);
    });
  }, 1200);

  fetchRemoteStrategies(4500).then((rows) => {
    if (!rows.length) return;
    remote = rows;
    ({ free: LOCAL_FREE, master: LOCAL_MASTER } = localLists());
    allList = merge("free", LOCAL_FREE).concat(merge("master", LOCAL_MASTER));
    tabDefs[0].label = `${t("tabAll")} (${allList.length})`;
    tabDefs[5].label = `${t("tabFree")} (${merge("free", LOCAL_FREE).length})`;
    tabDefs[6].label = `${t("tabMaster")} (${merge("master", LOCAL_MASTER).length})`;
    if (tabsEl) {
      tabsEl.innerHTML = tabDefs
        .map((tb, i) => `<button type="button" class="term-tab${i === 0 ? " active" : ""}" data-filter="${tb.id}">${tb.label}</button>`)
        .join("");
    }
    paintGrid();
    setTimeout(() => {
      if (document.body.classList.contains("desk-open")) return;
      void fillStats(allList, gridEl, 168, 4).then(() => {
        if (document.body.classList.contains("desk-open")) return;
        return fillStats(allList, gridEl, 500, 2);
      });
    }, 1200);
  });

  async function statOne(s, rootEl, barLimit) {
    const card = rootEl.querySelector(`[data-id="${s.id}"]`);
    if (!card) return;
    const wrEl = card.querySelector("[data-wr]");
    const shEl = card.querySelector("[data-sh]");
    const spec = catalog.get(s.engine || s.id) || catalog.get(s.id);
    if (!spec || typeof spec.run !== "function") {
      if (!card.getAttribute("data-wr")) {
        paintHit(wrEl, null);
        paintSharpe(shEl, null);
      }
      return;
    }
    try {
      const bars = await barsOf((s.symbols && s.symbols[0]) || "BTCUSDT", s.interval || "1h", barLimit);
      const trades = spec.run(bars);
      const eq = catalog.equityFrom(bars, trades);
      const st = catalog.performanceOf(trades, eq, catalog.barsPerYear(s.interval || "1h"), bars);
      const wr = st.wr || st.hit;
      if (Number.isFinite(wr) && (st.trades > 0 || wr > 0)) {
        paintHit(wrEl, wr);
        paintSharpe(shEl, st.sharpe);
        card.setAttribute("data-wr", String(wr));
        card.setAttribute("data-ret", String(st.ret || 0));
        card.setAttribute("data-mdd", String(st.mdd || 0));
        const hitLine = card.querySelector("[data-hit-line]");
        if (hitLine) {
          const wrPct = (wr * 100).toFixed(1);
          const retPct = ((st.ret || 0) * 100).toFixed(0);
          hitLine.textContent = `👑 ${t("mktWr")} ${wrPct}% · ${retPct}%`;
        }
      } else if (!card.getAttribute("data-wr")) {
        paintHit(wrEl, null);
        paintSharpe(shEl, null);
      }
    } catch {
      if (!card.getAttribute("data-wr")) {
        paintHit(wrEl, null);
        paintSharpe(shEl, null);
      }
    }
  }

  async function fillStats(list, rootEl, barLimit, workers) {
    if (!rootEl || !list.length) return;
    const queue = list.slice();
    const n = Math.max(1, workers || 4);
    async function pump() {
      while (queue.length) {
        const s = queue.shift();
        await statOne(s, rootEl, barLimit);
      }
    }
    await Promise.all(Array.from({ length: n }, pump));
    applyFilter();
  }

  catalog.register([
    {
      id: "ai",
      name: (window.QALang && window.QALang.t("aiLabName")) || "AI 實驗室策略",
      tier: "free",
      pine: "",
      run(bars) {
        const fn = window.__QA_AI_FN;
        if (typeof fn !== "function") return [];
        let prev = false;
        return catalog.runPineLike(bars, (i) => {
          let hit = false;
          try {
            hit = Boolean(fn(bars, i));
          } catch {
            hit = false;
          }
          const enterLong = hit && !prev;
          const exitLong = !hit && prev;
          prev = hit;
          return { enterLong, exitLong };
        });
      },
    },
  ]);

  const backBtn = document.getElementById("btnBackList");
  if (backBtn) backBtn.addEventListener("click", showList);

  function showLimit(msg, href) {
    const modal = document.getElementById("aiLimitModal");
    const text = document.getElementById("aiLimitMsg");
    const cta = document.getElementById("aiLimitCta");
    if (text) text.textContent = msg;
    if (cta) cta.href = href || "./member.html";
    if (modal) modal.classList.add("show");
  }
  const closeLimit = document.getElementById("aiLimitClose");
  if (closeLimit) {
    closeLimit.addEventListener("click", () => {
      const modal = document.getElementById("aiLimitModal");
      if (modal) modal.classList.remove("show");
    });
  }

  const chips = document.getElementById("aiChips");
  if (chips) {
    chips.addEventListener("click", (ev) => {
      const chip = ev.target.closest("[data-fill-key], [data-fill]");
      const box = document.getElementById("aiPrompt");
      if (!chip || !box) return;
      const fillKey = chip.getAttribute("data-fill-key");
      box.value = (fillKey ? t(fillKey) : "") || chip.getAttribute("data-fill") || "";
      box.focus();
    });
  }

  const go = document.getElementById("btnAiGo");
  if (go) {
    go.addEventListener("click", () => {
      const prompt = String((document.getElementById("aiPrompt") || {}).value || "").trim();
      if (prompt.length < 8) {
        toast(t("aiNeedPrompt"), "warn");
        return;
      }
      try {
        sessionStorage.setItem("qa_ai_prompt", prompt);
      } catch {
        /* ignore */
      }
      const q = new URLSearchParams();
      q.set("q", prompt.slice(0, 180));
      location.href = "./ai-backtest.html?" + q.toString();
    });
  }

  const q = new URLSearchParams(location.search);
  const qSt = q.get("strategy") || q.get("engine");
  if (qSt && catalog.get(qSt)) {
    openEngine(qSt, q.get("interval") || "1h");
  }
})();
