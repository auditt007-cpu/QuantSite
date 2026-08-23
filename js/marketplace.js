(async function () {
  const cfg = window.QUANT_CONFIG;
  const catalog = window.QACatalog;
  const feed = window.QAFeed;
  const cache = new Map();
  const support = (cfg && cfg.tgSupportUrl) || "https://t.me/grid_quant_bot";
  const payHref = "./member.html#pay";

  function t(key) {
    const lang = localStorage.getItem("quant_lang") || "zh-Hant";
    const pack = (window.I18N && (window.I18N[lang] || window.I18N["zh-Hant"])) || {};
    const fallback = (window.I18N && window.I18N["zh-Hant"]) || {};
    return pack[key] || fallback[key] || key;
  }

  async function barsOf(symbol, interval) {
    const key = symbol + ":" + interval;
    if (cache.has(key)) return cache.get(key);
    const bars = await feed.fetchKlines(symbol, interval, 500);
    cache.set(key, bars);
    return bars;
  }

  function fmtPct(x) {
    return x == null || !Number.isFinite(x) ? "—" : (x * 100).toFixed(1) + "%";
  }
  function fmtN(x) {
    return x == null || !Number.isFinite(x) ? "—" : x.toFixed(2);
  }
  function paid() {
    return window.QAIdentity && window.QAIdentity.seat() === "vip";
  }

  if (window.QAPackReady) {
    try {
      await window.QAPackReady;
    } catch {
      /* ignore */
    }
  }

  const LOCAL_FREE = (catalog.list || []).filter((s) => s.tier !== "master");
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
        return { ...s, engine: s.engine || s.id, name: s.name || (loc && loc.name), tier };
      });
    }
    return localFallback.map((s) => ({
      id: s.id,
      name: s.name,
      symbols: ["BTCUSDT"],
      interval: "1h",
      tags: tier === "master" ? ["大師組", "BTCUSDT", "1H"] : [],
      engine: s.id,
      tier,
    }));
  }

  const freeList = merge("free", LOCAL_FREE);
  const masterList = merge("master", LOCAL_MASTER);

  function cardHtml(s, master) {
    const href = `./backtest.html?strategy=${encodeURIComponent(s.engine || s.id)}&interval=${encodeURIComponent(s.interval || "1h")}`;
    const tags = (s.tags || []).map((t0) => `<span class="tag">${t0}</span>`).join("");
    const actions = master
      ? `<a class="btn cyan" href="${href}">${t("mktSeeBt")}</a>
         <a class="btn amber" href="${paid() ? support : payHref}" ${paid() ? 'target="_blank" rel="noopener"' : ""}>${paid() ? t("mktAskLink") : t("mktPayUnlock")}</a>`
      : `<a class="btn cyan" href="${href}">${t("mktOpenBt")}</a>`;
    const lock = master ? `<p class="code-lock">${t("mktCodeLock")}</p>` : "";
    return `<article class="m-card${master ? " master" : ""}" data-id="${s.id}">
        <h3>${s.name}</h3>
        <p class="muted">${(s.symbols || ["BTCUSDT"]).join(" / ")} · ${String(s.interval || "1h").toUpperCase()}</p>
        <div class="tags">${tags}</div>
        <div class="stats-row">
          <div class="stat"><span>${t("mktWr")}</span><b data-wr>—</b></div>
          <div class="stat"><span>${t("mktSh")}</span><b data-sh>—</b></div>
        </div>
        ${lock}
        <div class="card-actions">${actions}</div>
      </article>`;
  }

  const freeEl = document.getElementById("gridFree");
  const masterEl = document.getElementById("gridMaster");
  if (freeEl) freeEl.innerHTML = freeList.map((s) => cardHtml(s, false)).join("") || `<p class="muted">${t("mktEmpty")}</p>`;
  if (masterEl) masterEl.innerHTML = masterList.map((s) => cardHtml(s, true)).join("");

  async function fillStats(list, rootEl) {
    if (!rootEl) return;
    for (const s of list) {
      const card = rootEl.querySelector(`[data-id="${s.id}"]`);
      if (!card) continue;
      const spec = catalog.get(s.engine || s.id);
      if (!spec || typeof spec.run !== "function") continue;
      try {
        const bars = await barsOf((s.symbols && s.symbols[0]) || "BTCUSDT", s.interval || "1h");
        const trades = spec.run(bars);
        const eq = catalog.equityFrom(bars, trades);
        const st = catalog.performanceOf(trades, eq, catalog.barsPerYear(s.interval || "1h"), bars);
        card.querySelector("[data-wr]").textContent = st.hit ? fmtPct(st.hit) : "—";
        card.querySelector("[data-sh]").textContent = st.sharpe ? fmtN(st.sharpe) : "—";
      } catch {
        /* leave dash */
      }
    }
  }

  await fillStats(freeList, freeEl);
  await fillStats(masterList, masterEl);
})();
