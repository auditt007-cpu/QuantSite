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
    history.replaceState({}, "", /strategies\.html/i.test(location.pathname) ? "./strategies.html" : "./terminal.html");
  }

  function scrollPageTop() {
    window.scrollTo(0, 0);
    if (document.documentElement) document.documentElement.scrollTop = 0;
    if (document.body) document.body.scrollTop = 0;
  }

  function showBacktest() {
    const list = document.getElementById("viewList");
    const bt = document.getElementById("viewBacktest");
    if (list) list.hidden = true;
    if (bt) bt.hidden = false;
    document.body.classList.add("desk-open");
    scrollPageTop();
    requestAnimationFrame(scrollPageTop);
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
    const be = leaderboard.by_engine;
    const raw = String(engineId || "").trim();
    if (!raw) return null;
    if (be[raw]) return be[raw];
    const lower = raw.toLowerCase();
    if (be[lower]) return be[lower];
    const dashed = lower.replace(/_/g, "-");
    if (be[dashed]) return be[dashed];
    const underscored = lower.replace(/-/g, "_");
    if (be[underscored]) return be[underscored];
    // Case-insensitive scan (guards against legacy key casing)
    const keys = Object.keys(be);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (k.toLowerCase() === lower || k.toLowerCase() === dashed || k.toLowerCase() === underscored) {
        return be[k];
      }
    }
    return null;
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
        sh: Number.isFinite(lb.sharpe)
          ? lb.sharpe
          : Number.isFinite(lb.profit_factor)
            ? lb.profit_factor
            : null,
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
    const sh = Number(s.sharpe != null ? s.sharpe : m.sharpe_ratio);
    const ret =
      s.return_pct != null && Number.isFinite(Number(s.return_pct))
        ? Number(s.return_pct)
        : parsePct(m.week_return || m.optimal_return);
    let mdd =
      s.max_drawdown != null && Number.isFinite(Number(s.max_drawdown))
        ? -Math.abs(Number(s.max_drawdown))
        : parsePct(m.max_drawdown);
    if (mdd != null && mdd > 0) mdd = -Math.abs(mdd);
    let wrN = wr != null ? wr : null;
    if (s.win_rate != null && Number.isFinite(Number(s.win_rate))) {
      wrN = Number(s.win_rate);
      if (wrN > 1) wrN = wrN / 100;
    }
    return {
      wr: wrN,
      sh: Number.isFinite(sh) ? sh : null,
      ret: ret != null ? ret : null,
      pf: Number.isFinite(Number(s.profit_factor)) ? Number(s.profit_factor) : null,
      mdd: mdd,
      source: s.ai ? "pipeline" : "pack",
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
    el.textContent = "—";
  }

  function paintSharpe(el, sharpe) {
    if (!el) return;
    el.classList.remove("soft");
    if (Number.isFinite(sharpe) && sharpe > 0) {
      el.textContent = sharpe.toFixed(2);
      if (window.QAUi) window.QAUi.flash(el, false);
      return;
    }
    el.textContent = "—";
  }

  function kindOf(s) {
    if (s.ai) return "hot";
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

  const FALLBACK_ENGINES = window.QA_ENGINE_LIST || [
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
  const pipelineRows = await (window.QAPipelineReady || Promise.resolve([]));
  const aiList = (pipelineRows || []).map((row) =>
    window.QAPipeline && typeof window.QAPipeline.toCard === "function"
      ? window.QAPipeline.toCard(row)
      : { id: row.id, name: row.name, ai: true, chart: row.chart, copy: row.copy, sharpe: row.sharpe, return_pct: row.return_pct, max_drawdown: row.max_drawdown, profit_factor: row.profit_factor, symbols: row.symbols, interval: row.interval || "1h", tags: ["AI"], tier: "free", engine: row.id },
  );
  let allList = aiList.concat(freeList.concat(masterList));
  if (!allList.length) allList = buildFallbackList();
  if (!allList.length) {
    const gridFail = document.getElementById("gridAll");
    if (gridFail) gridFail.innerHTML = `<p class="muted">${t("mktEmpty")}</p>`;
    return;
  }

  function paintPlazaCount() {
    const el = document.getElementById("plazaCount");
    if (!el) return;
    const aiN = allList.filter((s) => s.ai).length;
    el.textContent = `目前展示 ${allList.length} 套（基礎目錄 + AI 新挖 ${aiN} 套，新策略置頂）`;
  }

  const gridEl = document.getElementById("gridAll");
  const tabsEl = document.getElementById("termTabs");
  const PAGE = 999;
  let pageN = PAGE;
  let activeFilter = "all";

  async function openEngine(engine, interval) {
    showBacktest();
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event("resize"));
      setTimeout(() => window.dispatchEvent(new Event("resize")), 120);
    });
    if (window.QABacktest && typeof window.QABacktest.open === "function") {
      await window.QABacktest.open(engine, interval || "1h");
    }
  }

  function briefCopy(text) {
    if (window.QAPipeline && typeof window.QAPipeline.briefCopy === "function") {
      return window.QAPipeline.briefCopy(text, 200);
    }
    const raw = String(text || "").replace(/\s+/g, " ").trim();
    return raw.length > 200 ? raw.slice(0, 200) + "…" : raw;
  }

  function cardHtml(s) {
    const seed = seedMetrics(s);
    const pipe = window.QAPipeline || {};
    const enriched = {
      ...s,
      sharpe: seed.sh != null ? seed.sh : s.sharpe,
      win_rate: seed.wr != null ? seed.wr : s.win_rate,
      max_drawdown: seed.mdd != null ? seed.mdd : s.max_drawdown,
      return_pct: seed.ret != null ? seed.ret : s.return_pct,
      principle: briefCopy(s.principle || s.description || s.copy || ""),
      description: s.description || s.copy || s.principle || "",
      copy: s.copy || s.description || s.principle || "",
    };
    if (typeof pipe.cardHtml === "function") {
      return pipe.cardHtml(enriched);
    }
    const badge = s.ai
      ? `<span class="ai-badge">${t("mktBadgeAi")}</span>`
      : `<span class="classic-badge">${t("mktBadgeClassic")}</span>`;
    const principle = enriched.principle;
    const sym = ((s.symbols && s.symbols[0]) || "BTCUSDT");
    const iv = String(s.interval || "1h").toUpperCase();
    const wrPct = seed.wr != null ? (seed.wr * 100).toFixed(1) + "%" : "—";
    const shTxt = seed.sh != null ? seed.sh.toFixed(2) : "—";
    const mddTxt =
      seed.mdd != null ? (-Math.abs(seed.mdd <= 1.5 ? seed.mdd * 100 : seed.mdd)).toFixed(1) + "%" : "—";
    const chartBlock = s.chart
      ? `<img class="ai-eq-thumb" src="${s.chart}" alt="${s.name} equity" loading="lazy" />`
      : "";
    return `<article class="m-card strategy-card plaza-card${s.ai ? " ai-card" : ""}${s.tier === "master" ? " master" : ""}" data-id="${s.id}" data-tier="${s.tier === "master" ? "master" : "free"}" data-kind="${kindOf(s)}" data-engine="${s.engine || s.id}">
        ${badge}
        <h3>${s.name}</h3>
        ${chartBlock}
        ${principle ? `<p class="card-principle">${principle}</p>` : ""}
        <p class="card-meta muted">${sym} · ${iv}</p>
        <div class="stat-caps plaza-metrics">
          <div class="stat-cap"><span>${t("mktSh")}</span><b>${shTxt}</b><em class="stat-tip">${t("mktShTip")}</em></div>
          <div class="stat-cap"><span>${t("mktWr")}</span><b class="is-up">${wrPct}</b><em class="stat-tip">${t("mktWrTip")}</em></div>
          <div class="stat-cap"><span>${t("mktMdd")}</span><b class="is-down">${mddTxt}</b><em class="stat-tip">${t("mktMddTip")}</em></div>
        </div>
        <div class="card-actions">
          <button type="button" class="btn-cta compact" data-plaza-detail="${s.id}">${t("mktDetail")}</button>
          <a class="btn-cta compact" href="#" data-get-strategy>${t("mktGet")}</a>
        </div>
      </article>`;
  }

  function bindOpenButtons() {
    /* Plaza cards no longer open the heavy browser backtest desk. */
  }

  window.QAPlazaOpenDetail = function (id) {
    const s = allList.find((row) => row.id === id);
    if (!s) return;
    const seed = seedMetrics(s);
    const payload = {
      ...s,
      ai: Boolean(s.ai),
      sharpe: seed.sh,
      win_rate: seed.wr,
      max_drawdown: seed.mdd,
      return_pct: seed.ret,
      copy: s.copy || s.description || s.principle || "",
      description: s.description || s.copy || s.principle || "",
      chart: s.chart || s.chart_url || "",
    };
    if (window.QAPipeline && typeof window.QAPipeline.openDetail === "function") {
      window.QAPipeline.openDetail(payload);
    }
  };

  function paintGrid() {
    if (!gridEl) return;
    gridEl.innerHTML = allList.map((s) => cardHtml(s)).join("") || `<p class="muted">${t("mktEmpty")}</p>`;
    applyFilter();
  }

  function focusStrategyFromQuery() {
    const q = new URLSearchParams(location.search);
    const id = q.get("id") || q.get("strategy");
    if (!id || !gridEl) return;
    const card =
      gridEl.querySelector('.m-card[data-id="' + id + '"]') ||
      gridEl.querySelector('.m-card[data-engine="' + id + '"]');
    if (card) {
      card.classList.add("is-focus");
      setTimeout(() => card.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
    }
    const row =
      allList.find((s) => s.id === id) ||
      allList.find((s) => s.engine === id) ||
      allList.find((s) => s.name === id);
    if (row && window.QAPipeline && typeof window.QAPipeline.openDetail === "function") {
      window.QAPipeline.openDetail(row);
    }
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
  paintPlazaCount();
  focusStrategyFromQuery();
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

  fetchRemoteStrategies(4500).then(async (rows) => {
    let pipe = window.QAPipelineStrategies;
    if ((!pipe || !pipe.length) && window.QAPipeline && typeof window.QAPipeline.fetchRows === "function") {
      pipe = await window.QAPipeline.fetchRows();
      window.QAPipelineStrategies = pipe;
    }
    const aiNext = (pipe || []).map((row) =>
      window.QAPipeline && typeof window.QAPipeline.toCard === "function"
        ? window.QAPipeline.toCard(row)
        : { id: row.id, name: row.name || row.title, ai: true, chart: row.chart || row.chart_url, copy: row.copy, sharpe: row.sharpe, return_pct: row.return_pct, max_drawdown: row.max_drawdown, profit_factor: row.profit_factor, symbols: row.symbols, interval: row.interval || "1h", tags: ["AI"], tier: "free", engine: row.id },
    );
    if (rows.length) {
      remote = rows;
      ({ free: LOCAL_FREE, master: LOCAL_MASTER } = localLists());
    }
    allList = aiNext.concat(merge("free", LOCAL_FREE).concat(merge("master", LOCAL_MASTER)));
    tabDefs[0].label = `${t("tabAll")} (${allList.length})`;
    tabDefs[5].label = `${t("tabFree")} (${merge("free", LOCAL_FREE).length})`;
    tabDefs[6].label = `${t("tabMaster")} (${merge("master", LOCAL_MASTER).length})`;
    if (tabsEl) {
      tabsEl.innerHTML = tabDefs
        .map((tb, i) => `<button type="button" class="term-tab${i === 0 ? " active" : ""}" data-filter="${tb.id}">${tb.label}</button>`)
        .join("");
    }
    paintGrid();
    paintPlazaCount();
    focusStrategyFromQuery();
  });

  /* Browser-side fillStats removed: plaza metrics come from pack / leaderboard / pipeline only. */

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
  if (qSt && catalog.get(qSt) && !q.get("id")) {
    openEngine(qSt, q.get("interval") || "1h");
  }
})();
