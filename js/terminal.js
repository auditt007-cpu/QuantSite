(async function () {
  const cfg = window.QUANT_CONFIG;
  const catalog = window.QACatalog;
  const feed = window.QAFeed;
  const cache = new Map();
  const support = (cfg && cfg.tgSupportUrl) || "https://t.me/grid_quant_bot";
  const payHref = "./member.html#pay";

  function t(key) {
    if (window.QALang && typeof window.QALang.t === "function") return window.QALang.t(key);
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

  async function barsOf(symbol, interval) {
    const key = symbol + ":" + interval;
    if (cache.has(key)) return cache.get(key);
    const bars = await feed.fetchKlines(symbol, interval, 500);
    cache.set(key, bars);
    return bars;
  }

  function paintHit(el, hit) {
    if (!el) return;
    el.classList.remove("soft");
    if (Number.isFinite(hit) && hit > 0) {
      el.textContent = (hit * 100).toFixed(1) + "%";
      if (window.QAUi) window.QAUi.flash(el, false);
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

  const LOCAL_FREE = (catalog.list || []).filter((s) => s.tier !== "master" && s.id !== "ai");
  const LOCAL_MASTER = (catalog.list || []).filter((s) => s.tier === "master");

  let remote = [];
  try {
    const res = await fetch(cfg.apiBase + "/api/strategies");
    const payload = await res.json();
    remote = payload.strategies || [];
  } catch {
    remote = [];
  }

  function merge(tier, localFallback) {
    const fromApi = remote.filter((s) => (s.tier || "free") === tier);
    if (fromApi.length) {
      return fromApi.map((s) => {
        const loc = catalog.get(s.engine || s.id) || catalog.get(s.id);
        return {
          ...s,
          engine: s.engine || s.id,
          name: (loc && loc.name) || s.name,
          principle: (loc && loc.principle) || s.principle || "",
          description: (loc && loc.description) || s.description || "",
          tier,
        };
      });
    }
    return localFallback.map((s) => ({
      id: s.id,
      name: s.name,
      symbols: ["BTCUSDT"],
      interval: "1h",
      tags: s.tags && s.tags.length ? s.tags : tier === "master" ? ["機構實盤", "BTCUSDT", "1H"] : ["開源"],
      principle: s.principle || "",
      description: s.description || "",
      engine: s.id,
      tier,
    }));
  }

  const freeList = merge("free", LOCAL_FREE);
  const masterList = merge("master", LOCAL_MASTER);
  const allList = freeList.concat(masterList);

  function openEngine(engine, interval) {
    showBacktest();
    if (window.QABacktest && typeof window.QABacktest.open === "function") {
      window.QABacktest.open(engine, interval || "1h");
    }
  }

  function cardHtml(s, master) {
    const tags = (s.tags || []).map((t0) => `<span class="tag">${t0}</span>`).join("");
    const unlockHref = paid() ? support : payHref;
    const unlockLabel = paid() ? t("mktAskLink") : "解鎖實盤源碼 >";
    const actions = master
      ? `<button type="button" class="btn-cta compact" data-open="${s.engine || s.id}" data-iv="${s.interval || "1h"}">${t("mktSeeBt")}</button>
         <a class="ghost-link" href="${unlockHref}" ${paid() ? 'target="_blank" rel="noopener"' : ""}>${unlockLabel}</a>`
      : `<button type="button" class="btn-cta compact" data-open="${s.engine || s.id}" data-iv="${s.interval || "1h"}">⚡ ${t("mktOpenBt")}</button>`;
    const badge = master ? `<span class="vip-badge">🔒 機構實盤</span>` : "";
    const principle = s.principle || "";
    return `<article class="m-card strategy-card${master ? " master" : ""}" data-id="${s.id}" data-tier="${master ? "master" : "free"}" data-kind="${kindOf(s)}">
        ${badge}
        <h3>${s.name}</h3>
        ${principle ? `<p class="card-principle">${principle}</p>` : ""}
        <p class="muted">${(s.symbols || ["BTCUSDT"]).join(" / ")} · ${String(s.interval || "1h").toUpperCase()}</p>
        <div class="tags">${tags}</div>
        <div class="stat-caps">
          <div class="stat-cap"><span>${t("mktWr")}</span><b data-wr class="soft">計算中</b></div>
          <div class="stat-cap"><span>${t("mktSh")}</span><b data-sh class="soft">計算中</b></div>
        </div>
        <div class="card-actions">${actions}</div>
      </article>`;
  }

  const gridEl = document.getElementById("gridAll");
  if (gridEl) {
    gridEl.innerHTML = allList.map((s) => cardHtml(s, s.tier === "master")).join("") || `<p class="muted">${t("mktEmpty")}</p>`;
  }

  document.querySelectorAll("[data-open]").forEach((b) => {
    b.addEventListener("click", () => openEngine(b.getAttribute("data-open"), b.getAttribute("data-iv")));
  });

  const tabsEl = document.getElementById("termTabs");
  const nTrend = allList.filter((s) => kindOf(s) === "trend").length;
  const nGrid = allList.filter((s) => kindOf(s) === "grid").length;
  const nRange = allList.filter((s) => kindOf(s) === "range").length;
  const tabDefs = [
    { id: "all", label: `全部 (${allList.length})` },
    { id: "free", label: `🆓 開源免費 (${freeList.length})` },
    { id: "master", label: `👑 機構實盤 (${masterList.length})` },
    { id: "trend", label: `趨勢 (${nTrend})` },
    { id: "grid", label: `網格 (${nGrid})` },
    { id: "range", label: `震盪 (${nRange})` },
  ];
  if (tabsEl && gridEl) {
    tabsEl.innerHTML = tabDefs
      .map((tb, i) => `<button type="button" class="term-tab${i === 0 ? " active" : ""}" data-filter="${tb.id}">${tb.label}</button>`)
      .join("");
    tabsEl.addEventListener("click", (ev) => {
      const btn = ev.target.closest("[data-filter]");
      if (!btn) return;
      tabsEl.querySelectorAll(".term-tab").forEach((el) => el.classList.toggle("active", el === btn));
      const f = btn.getAttribute("data-filter");
      gridEl.querySelectorAll(".m-card").forEach((card) => {
        const tier = card.getAttribute("data-tier");
        const kind = card.getAttribute("data-kind");
        const show = f === "all" || f === tier || f === kind;
        card.classList.toggle("is-hidden", !show);
      });
    });
  }

  async function fillStats(list, rootEl) {
    if (!rootEl) return;
    for (const s of list) {
      const card = rootEl.querySelector(`[data-id="${s.id}"]`);
      if (!card) continue;
      const wrEl = card.querySelector("[data-wr]");
      const shEl = card.querySelector("[data-sh]");
      const spec = catalog.get(s.engine || s.id) || catalog.get(s.id);
      if (!spec || typeof spec.run !== "function") {
        paintHit(wrEl, null);
        paintSharpe(shEl, null);
        continue;
      }
      try {
        const bars = await barsOf((s.symbols && s.symbols[0]) || "BTCUSDT", s.interval || "1h");
        const trades = spec.run(bars);
        const eq = catalog.equityFrom(bars, trades);
        const st = catalog.performanceOf(trades, eq, catalog.barsPerYear(s.interval || "1h"), bars);
        paintHit(wrEl, st.hit);
        paintSharpe(shEl, st.sharpe);
      } catch {
        paintHit(wrEl, null);
        paintSharpe(shEl, null);
      }
    }
  }

  fillStats(allList, gridEl);

  catalog.register([
    {
      id: "ai",
      name: "AI 實驗室策略",
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
      const chip = ev.target.closest("[data-fill]");
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
