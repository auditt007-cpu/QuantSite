(async function () {
  const grid = document.getElementById("grid");
  const cfg = window.QUANT_CONFIG;
  const catalog = window.QACatalog;
  const feed = window.QAFeed;
  const cache = new Map();

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

  let payload;
  try {
    const res = await fetch(cfg.apiBase + "/api/strategies");
    payload = await res.json();
  } catch {
    grid.innerHTML = `<p class="muted">無法讀取 /api/strategies</p>`;
    return;
  }
  const list = payload.strategies || [];
  if (!list.length) {
    grid.innerHTML = `<p class="muted">廣場尚無策略</p>`;
    return;
  }

  grid.innerHTML = list
    .map(
      (s) => `<article class="m-card" data-id="${s.id}">
        <h3>${s.name}</h3>
        <p class="muted">${(s.symbols || []).join(" / ")} · ${String(s.interval || "").toUpperCase()}</p>
        <div class="tags">${(s.tags || []).map((t) => `<span class="tag">${t}</span>`).join("")}</div>
        <div class="stats-row">
          <div class="stat"><span>勝率</span><b data-wr>—</b></div>
          <div class="stat"><span>夏普</span><b data-sh>—</b></div>
        </div>
        <a class="btn cyan" href="./backtest.html?strategy=${encodeURIComponent(s.engine || s.id)}&interval=${encodeURIComponent(s.interval || "1m")}">打開回測</a>
      </article>`,
    )
    .join("");

  for (const s of list) {
    const card = grid.querySelector(`[data-id="${s.id}"]`);
    if (!card) continue;
    if (s.winRate != null) card.querySelector("[data-wr]").textContent = fmtPct(Number(s.winRate) > 1 ? Number(s.winRate) / 100 : Number(s.winRate));
    if (s.sharpe != null) card.querySelector("[data-sh]").textContent = fmtN(Number(s.sharpe));
    if (s.winRate != null && s.sharpe != null) continue;
    try {
      const spec = catalog.get(s.engine || s.id);
      const bars = await barsOf((s.symbols && s.symbols[0]) || "BTCUSDT", s.interval || "1h");
      const trades = spec.run(bars);
      const eq = catalog.equityFrom(bars, trades);
      const st = catalog.performanceOf(trades, eq, catalog.barsPerYear(s.interval || "1h"));
      if (s.winRate == null) card.querySelector("[data-wr]").textContent = fmtPct(st.wr);
      if (s.sharpe == null) card.querySelector("[data-sh]").textContent = fmtN(st.sharpe);
    } catch {
      /* leave dash */
    }
  }
})();
