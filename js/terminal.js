(async function () {
  const cfg = window.QUANT_CONFIG;
  const catalog = window.QACatalog;
  const feed = window.QAFeed;
  const cache = new Map();
  const support = (cfg && (cfg.COMMUNITY_ENDPOINT || cfg.tgSupportUrl)) || "#";
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
    history.replaceState({}, "", "./strategies.html");
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
    document.querySelectorAll("[data-week-title]").forEach((el) => {
      el.textContent = t("weekBoardTitlePeak");
    });
    document.querySelectorAll("[data-lb-period]").forEach((el) => {
      el.textContent = t("lbPeriodTagPeak");
    });
  }

  function langCode() {
    const raw = localStorage.getItem("quant_lang") || localStorage.getItem("user_lang") || "en";
    if (raw === "zh-Hans" || raw === "zh-CN") return "zh-CN";
    if (raw === "zh-Hant" || raw === "zh-TW") return "zh-Hant";
    return "en";
  }

  function modelName(row) {
    if (!row) return "—";
    const code = langCode();
    if (code === "en") return row.name_en || row.engine || row.id || "—";
    return row.name_zh || row.name_en || row.engine || row.id || "—";
  }

  function roiOfRow(row) {
    if (!row) return NaN;
    if (Number.isFinite(Number(row.roi_pct))) return Number(row.roi_pct);
    const frac = Number(row.net_profit_pct);
    if (Number.isFinite(frac)) return frac * 100;
    return NaN;
  }

  function bestWindowFromTrades(tradeLog, maxDays) {
    const trades = (tradeLog || [])
      .map((t) => ({
        ts: Number(t.exit_ts),
        pnl: Number(t.pnl_pct),
      }))
      .filter((t) => Number.isFinite(t.ts) && Number.isFinite(t.pnl))
      .sort((a, b) => a.ts - b.ts);
    if (!trades.length) return null;
    const DAY = 86400000;
    let best = null;
    const cap = maxDays || 30;
    for (let days = 1; days <= cap; days++) {
      const win = days * DAY;
      let j = 0;
      let sum = 0;
      for (let i = 0; i < trades.length; i++) {
        sum += trades[i].pnl;
        while (j <= i && trades[i].ts - trades[j].ts > win) {
          sum -= trades[j].pnl;
          j += 1;
        }
        if (!best || sum > best.roi) best = { roi: sum, days: days };
      }
    }
    return best;
  }

  function buildPeakBoard(lb) {
    const rows = [];
    const seen = new Set();
    const hbp = (lb && lb.hero_by_period) || {};
    Object.keys(hbp)
      .map((k) => ({ k: k, entry: hbp[k] }))
      .filter((x) => x.entry)
      .sort((a, b) => (Number(b.entry.roi_pct) || 0) - (Number(a.entry.roi_pct) || 0))
      .forEach((x) => {
        const entry = x.entry;
        const days = Number(entry.period_days != null ? entry.period_days : x.k);
        if (!Number.isFinite(days) || days < 1 || days > 30) return;
        const eng = entry.engine || entry.id;
        if (!eng || seen.has(eng)) return;
        seen.add(eng);
        rows.push({
          engine: eng,
          id: eng,
          name_zh: entry.name_zh,
          name_en: entry.name_en,
          roi_pct: Number(entry.roi_pct),
          period_days: days,
        });
      });

    const be = (lb && lb.by_engine) || {};
    Object.keys(be).forEach((eng) => {
      if (seen.has(eng)) return;
      const row = be[eng];
      const hit = bestWindowFromTrades(row.trade_log || row.execution_logs, 30);
      if (!hit || !Number.isFinite(hit.roi)) return;
      seen.add(eng);
      rows.push({
        engine: eng,
        id: eng,
        name_zh: row.name_zh,
        name_en: row.name_en,
        roi_pct: hit.roi,
        period_days: hit.days,
      });
    });

    rows.sort((a, b) => (Number(b.roi_pct) || -1e9) - (Number(a.roi_pct) || -1e9));
    return rows.slice(0, 5);
  }

  function paintWeekBoard(lb) {
    const boards = document.querySelectorAll("[data-week-board]");
    if (!boards.length) return;
    let top = buildPeakBoard(lb);
    if (!top.length && lb && Array.isArray(lb.pnl_board) && lb.pnl_board.length) {
      top = lb.pnl_board
        .slice()
        .sort((a, b) => roiOfRow(b) - roiOfRow(a))
        .slice(0, 5)
        .map((r) => ({
          ...r,
          period_days: Number((lb && lb.period_days) || 7),
        }));
    }
    const html = top.length
      ? top
          .map((r, i) => {
            const roi = roiOfRow(r);
            const up = roi >= 0;
            const id = r.engine || r.id || "";
            const days = Number(r.period_days) || Number((lb && lb.period_days) || 7);
            return (
              '<li><button type="button" class="week-row" data-open-week="' +
              id +
              '"><b>' +
              (i + 1) +
              "</b><span>" +
              modelName(r) +
              '</span><em class="' +
              (up ? "up" : "down") +
              '">' +
              (up ? "+" : "") +
              roi.toFixed(1) +
              '% <small class="week-days">' +
              days +
              t("weekDaysUnit") +
              "</small></em></button></li>"
            );
          })
          .join("")
      : '<li class="muted week-empty">' + t("weekBoardEmpty") + "</li>";
    boards.forEach((el) => {
      el.innerHTML = html;
    });
  }

  function bindWeekBoardClicks() {
    if (document.documentElement.dataset.weekBoardBound === "1") return;
    document.documentElement.dataset.weekBoardBound = "1";
    document.addEventListener("click", (ev) => {
      const btn = ev.target.closest && ev.target.closest("[data-open-week]");
      if (!btn) return;
      const id = btn.getAttribute("data-open-week");
      if (!id) return;
      location.href = "./strategies.html?strategy=" + encodeURIComponent(id);
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
    const m = (s.metrics && typeof s.metrics === "object" ? s.metrics : {}) || {};
    const hasBacktest =
      Number.isFinite(Number(m.return_pct)) ||
      Number.isFinite(Number(s.return_pct)) ||
      String(s.metrics_source || m.metrics_source || "").indexOf("backtest") >= 0;
    const isGrid =
      String(s.strategy_type || "").toUpperCase() === "GRID" ||
      /grid/i.test(String(s.subtype || "")) ||
      (Array.isArray(s.tags) && s.tags.some((t) => /grid/i.test(String(t))));
    // Plaza GRID / prerender packs must NOT inherit legacy leaderboard DD/ROI.
    if (!hasBacktest && !isGrid && String(s.status || "").toUpperCase() !== "BACKTEST_READY") {
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
          periodDays: Number(lb.period_days) || Number((window.__QA_LB && window.__QA_LB.period_days) || 60),
          source: "leaderboard",
        };
      }
    }
    const spec = catalog.get(s.engine || s.id) || catalog.get(s.id);
    const pack = (spec && spec.metrics) || m;
    let wr = parsePct(pack.win_rate);
    if (wr == null && Number.isFinite(Number(pack.win_rate_pct))) {
      wr = Number(pack.win_rate_pct) / 100;
    }
    if (s.win_rate != null && Number.isFinite(Number(s.win_rate))) {
      wr = Number(s.win_rate);
      if (wr > 1) wr = wr / 100;
    }
    let sh = Number(s.sharpe != null ? s.sharpe : pack.sharpe_ratio);
    let ret =
      s.return_pct != null && Number.isFinite(Number(s.return_pct)) && Number(s.return_pct) !== 0
        ? Number(s.return_pct)
        : parsePct(pack.week_return || pack.optimal_return);
    if (Number.isFinite(ret) && Math.abs(ret) > 2) ret = null;
    let mdd =
      s.max_drawdown != null && Number.isFinite(Number(s.max_drawdown)) && Number(s.max_drawdown) !== 0
        ? Number(s.max_drawdown)
        : null;
    if (mdd == null && Number.isFinite(Number(pack.max_drawdown_pct))) {
      mdd = Number(pack.max_drawdown_pct);
    }
    if (mdd == null) mdd = parsePct(pack.max_drawdown);
    if (mdd != null && Math.abs(mdd) > 1.5) mdd = mdd / 100;
    if (mdd != null && mdd > 0) mdd = -Math.abs(mdd);
    let pf = Number(s.profit_factor != null ? s.profit_factor : pack.profit_factor);
    let periodDays = Number(s.period_days || s.backtest_days || pack.period_days);
    if (!Number.isFinite(periodDays) || periodDays < 1) periodDays = 60;
    return {
      wr: wr != null ? wr : null,
      sh: Number.isFinite(sh) && sh !== 0 ? sh : Number.isFinite(Number(pack.sharpe_ratio)) ? Number(pack.sharpe_ratio) : null,
      ret: ret != null ? ret : null,
      pf: Number.isFinite(pf) && pf > 0 ? pf : null,
      mdd: mdd,
      trades: Number.isFinite(Number(s.trades)) ? Number(s.trades) : Number(pack.trades) || null,
      periodDays: periodDays,
      source: hasBacktest || isGrid ? "backtest" : s.ai ? "pipeline" : "pack",
      disclaimer: "基於 " + periodDays + " 日回測樣本，未年化",
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

  function isGridMartin(s) {
    const blob = ((s.tags || []).join(" ") + " " + (s.name || "") + " " + (s.id || "") + " " + (s.engine || "")).toLowerCase();
    return /網格|馬丁|martin|grid|atr_grid|adaptive_grid/.test(blob);
  }

  function kindOf(s) {
    if (isGridMartin(s)) return "grid";
    if (s.ai) return "ai";
    const blob = ((s.tags || []).join(" ") + " " + (s.name || "")).toLowerCase();
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
    const packRow =
      (Array.isArray(window.QA_STRATEGY_ROWS) &&
        window.QA_STRATEGY_ROWS.find((r) => r && (r.id === s.id || r.id === (s.engine || s.id)))) ||
      null;
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
      release_date: s.release_date || (packRow && packRow.release_date) || (spec && spec.release_date) || "",
    };
  }

  function merge(tier, localFallback) {
    const fromApi = remote.filter((s) => (s.tier || "free") === tier);
    const byId = new Map();
    localFallback.forEach((s) => byId.set(s.id, asCard(s, tier)));
    fromApi.forEach((s) => {
      const loc = catalog.get(s.engine || s.id) || catalog.get(s.id);
      const remoteName = String(s.name || s.title || "").trim();
      byId.set(s.id, {
        ...asCard(s, tier),
        engine: s.engine || s.id,
        // Prefer strategies.json display name over stale catalog labels (EMA/RSI…).
        name: remoteName || (loc && loc.name) || s.id,
        principle: s.principle || (loc && loc.principle) || "",
        description: s.description || (loc && loc.description) || "",
        status: s.status || "",
        strategy_type: s.strategy_type || "",
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
  (function ensureFullCatalog() {
    const have = new Set(allList.map((s) => s.id));
    buildFallbackList().forEach((s) => {
      if (!have.has(s.id)) {
        allList.push(s);
        have.add(s.id);
      }
    });
  })();
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
  let activeFilter = "d60";

  function strategyPeriodDays(s) {
    const d = Number(
      s && (s.period_days != null ? s.period_days : s.backtest_days != null ? s.backtest_days : s.metrics && s.metrics.period_days)
    );
    if (d === 7 || d === 30 || d === 60) return d;
    const id = String((s && (s.id || s.engine)) || "");
    let h = 0;
    for (let i = 0; i < id.length; i += 1) h = (h + id.charCodeAt(i) * (i + 1)) % 997;
    return [7, 30, 60][h % 3];
  }

  function cardReturn(s) {
    const seed = seedMetrics(s);
    if (seed.ret != null && Number.isFinite(Number(seed.ret))) return Number(seed.ret);
    const r = Number(s && s.return_pct);
    return Number.isFinite(r) ? r : -Infinity;
  }


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
    const title =
      (typeof pipe.publicTitle === "function" && pipe.publicTitle(s)) ||
      String(s.name || s.title || "").trim() ||
      String(s.id || s.engine || "—");
    const enriched = {
      ...s,
      name: title,
      title: title,
      fits: typeof pipe.publicFits === "function" ? pipe.publicFits(s) : s.fits,
      symbols: [],
      symbol: "",
      sharpe: seed.sh != null ? seed.sh : s.sharpe,
      win_rate: seed.wr != null ? seed.wr : s.win_rate,
      max_drawdown: seed.mdd != null ? seed.mdd : s.max_drawdown,
      return_pct: seed.ret != null ? seed.ret : s.return_pct,
      period_days: strategyPeriodDays({ ...s, period_days: seed.periodDays != null ? seed.periodDays : s.period_days }),
      principle: briefCopy(s.principle || s.description || s.copy || ""),
      description: s.description || s.copy || s.principle || "",
      copy: s.copy || s.description || s.principle || "",
      disclaimer: seed.disclaimer || s.disclaimer || "",
    };
    if (typeof pipe.cardHtml === "function") {
      return pipe.cardHtml(enriched);
    }
    const badge = s.ai
      ? `<span class="ai-badge">${t("mktBadgeAi")}</span>`
      : `<span class="classic-badge">${t("mktBadgeClassic")}</span>`;
    const principle = enriched.principle;
    const wrPct =
      seed.wrLabel || (seed.wr != null ? (seed.wr * 100).toFixed(1) + "%" : "—");
    const shTxt = seed.sh != null ? Number(seed.sh).toFixed(2) : "—";
    const mddTxt =
      seed.mdd != null
        ? (-Math.abs(seed.mdd <= 1.5 ? seed.mdd * 100 : seed.mdd)).toFixed(1) + "%"
        : "—";
    const disc =
      seed.disclaimer ||
      (seed.source === "backtest" ? "基於 " + (seed.periodDays || 60) + " 日回測樣本，未年化" : "");
    const chartBlock = s.chart
      ? `<img class="ai-eq-thumb" src="${s.chart}" alt="${title} equity" loading="lazy" />`
      : "";
    return `<article class="m-card strategy-card plaza-card${s.ai ? " ai-card" : ""}${s.tier === "master" ? " master" : ""}" data-id="${s.id}" data-tier="${s.tier === "master" ? "master" : "free"}" data-kind="${kindOf(s)}" data-engine="${s.engine || s.id}" data-release="${s.release_date || ""}" data-status="${s.status || ""}">
        ${badge}
        <h3>${title}</h3>
        ${chartBlock}
        ${principle ? `<p class="card-principle">${principle}</p>` : ""}
        <p class="card-meta muted">${t("mktBackDays").replace("{d}", String(seed.periodDays || 60))}</p>
        <div class="stat-caps plaza-metrics">
          <div class="stat-cap"><span>${t("mktSh")}</span><b>${shTxt}</b><em class="stat-tip">${t("mktShTip")}</em></div>
          <div class="stat-cap"><span>${t("mktWr")}</span><b class="is-up">${wrPct}</b><em class="stat-tip">${t("mktWrTip")}</em></div>
          <div class="stat-cap"><span>${t("mktMdd")}</span><b class="is-down">${mddTxt}</b><em class="stat-tip">${t("mktMddTip")}</em></div>
        </div>
        ${disc ? `<p class="muted" style="font-size:11px;opacity:.75;margin:4px 0 0">${disc}</p>` : ""}
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

  function listMatches(s, f) {
    const days = strategyPeriodDays(s);
    if (f === "d7") return days === 7;
    if (f === "d30") return days === 30;
    if (f === "d60") return days === 60;
    if (f === "all") return true;
    return true;
  }

  function countLane(f) {
    return allList.filter((s) => listMatches(s, f)).length;
  }

  function buildTabDefs() {
    return [
      { id: "d7", label: "回測 7 天 (" + countLane("d7") + ")" },
      { id: "d30", label: "回測 30 天 (" + countLane("d30") + ")" },
      { id: "d60", label: "回測 60 天 (" + countLane("d60") + ")" },
    ];
  }

  function renderTabs() {
    const defs = buildTabDefs();
    if (!tabsEl) return;
    tabsEl.classList.remove("term-tabs-mobile-select");
    tabsEl.innerHTML = defs
      .map((tb) => {
        const on = tb.id === activeFilter;
        return (
          '<button type="button" class="term-tab' +
          (on ? " active" : "") +
          '" data-filter="' +
          tb.id +
          '">' +
          tb.label +
          "</button>"
        );
      })
      .join("");
  }

  function cardMatches(card, f) {
    const dummy = {
      id: card.getAttribute("data-id"),
      engine: card.getAttribute("data-engine"),
      period_days: Number(card.getAttribute("data-period")),
      return_pct: Number(card.getAttribute("data-ret")),
    };
    return listMatches(dummy, f);
  }
  function applyFilter() {
    if (!gridEl) return;
    const cards = [...gridEl.querySelectorAll(".m-card")];
    cards.sort((a, b) => {
      const ra = Number(a.getAttribute("data-ret"));
      const rb = Number(b.getAttribute("data-ret"));
      const na = Number.isFinite(ra) ? ra : -Infinity;
      const nb = Number.isFinite(rb) ? rb : -Infinity;
      return nb - na;
    });
    cards.forEach((c) => gridEl.appendChild(c));
    cards.forEach((card) => {
      const show = cardMatches(card, activeFilter);
      card.classList.toggle("is-hidden", !show);
      if (show) {
        card.classList.add("plaza-fade");
        setTimeout(() => card.classList.remove("plaza-fade"), 280);
      }
    });
    const more = document.getElementById("gridMore");
    if (more) more.hidden = true;
  }

  if (tabsEl && gridEl) {
    renderTabs();
    tabsEl.addEventListener("click", (ev) => {
      const btn = ev.target.closest("[data-filter]");
      if (!btn) return;
      activeFilter = btn.getAttribute("data-filter");
      renderTabs();
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
    if (window.QALeaderboard) {
      paintLeaderboardMeta(window.QALeaderboard);
      paintWeekBoard(window.QALeaderboard);
    }
    renderTabs();
    paintGrid();
    paintPlazaCount();
  });

  bindWeekBoardClicks();

  window.addEventListener("qa-leaderboard-ready", () => {
    if (window.QALeaderboard) paintWeekBoard(window.QALeaderboard);
  });

  let tabResizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(tabResizeTimer);
    tabResizeTimer = setTimeout(renderTabs, 120);
  });

  loadLeaderboard().then((lb) => {
    if (lb && lb.by_engine) {
      window.QALeaderboard = lb;
      paintLeaderboardMeta(lb);
      paintWeekBoard(lb);
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
    (function preferPipelineById() {
      // strategies.json plaza wipe wins over catalog EMA names / leaderboard ghosts.
      const byId = new Map();
      allList.forEach((s) => byId.set(s.id, s));
      aiNext.forEach((s) => {
        if (!s || !s.id) return;
        byId.set(s.id, s);
      });
      allList = Array.from(byId.values());
      // Keep INITIALIZING / plaza GRID rows near top.
      allList.sort((a, b) => {
        const ai = (x) => (String(x.status || "").toUpperCase() === "INITIALIZING" || x.ai ? 0 : 1);
        return ai(a) - ai(b);
      });
    })();
    (function ensureFullCatalog() {
      const have = new Set(allList.map((s) => s.id));
      buildFallbackList().forEach((s) => {
        if (!have.has(s.id)) {
          allList.push(s);
          have.add(s.id);
        }
      });
    })();
    if (window.QAPipeline && typeof window.QAPipeline.collapseCohorts === "function") {
      allList = window.QAPipeline.collapseCohorts(allList);
    }
    renderTabs();
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
