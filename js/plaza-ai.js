(function (root) {
  const STYLE = `
.ai-eq-thumb{width:100%;max-height:120px;object-fit:contain;background:#0b0b0c;border:1px solid rgba(212,160,23,.25);margin:8px 0}
.ai-badge{display:inline-block;font-size:11px;letter-spacing:.08em;color:#d4a017;border:1px solid #d4a017;padding:1px 6px;margin-bottom:6px}
#aiStratModal .ai-eq-full{width:100%;max-height:280px;object-fit:contain;background:#0b0b0c}
#aiStratCopy{white-space:pre-wrap;line-height:1.55;color:#c8c8c8}
#plazaCount{margin:8px 0 14px;color:#c8c8c8;font-size:13px}
`;

  function ensureStyle() {
    if (document.getElementById("plaza-ai-css")) return;
    const s = document.createElement("style");
    s.id = "plaza-ai-css";
    s.textContent = STYLE;
    document.head.appendChild(s);
  }

  function whenDomReady() {
    if (document.readyState === "loading") {
      return new Promise(function (resolve) {
        document.addEventListener("DOMContentLoaded", resolve, { once: true });
      });
    }
    return Promise.resolve();
  }

  function pickNum() {
    for (let i = 0; i < arguments.length; i += 1) {
      const n = Number(arguments[i]);
      if (Number.isFinite(n)) return n;
    }
    return NaN;
  }

  function normalizeRow(row) {
    if (!row || typeof row !== "object") return null;
    const m = row.metrics && typeof row.metrics === "object" ? row.metrics : {};
    const id = row.id || row.strategy_id;
    if (!id) return null;
    const copy = row.copy || row.description || row.intro || "";
    const chart = row.chart_url || row.chart || "";
    return {
      id: String(id),
      name: row.title || row.name || String(id),
      title: row.title || row.name,
      copy: copy,
      chart: chart,
      chart_url: chart,
      sharpe: pickNum(row.sharpe, m.sharpe, m.sharpe_ratio),
      return_pct: pickNum(row.return_pct, m.return_pct, m.ret),
      max_drawdown: pickNum(row.max_drawdown, m.max_drawdown, m.mdd),
      profit_factor: pickNum(row.profit_factor, m.profit_factor, m.pf),
      trades: row.trades != null ? row.trades : m.trades,
      symbols: row.symbols,
      interval: row.interval || row.tf || "1h",
      params: row.params,
      code: row.code,
    };
  }

  function ensureModal() {
    if (document.getElementById("aiStratModal")) return;
    const wrap = document.createElement("div");
    wrap.className = "modal-bg";
    wrap.id = "aiStratModal";
    wrap.innerHTML =
      '<div class="modal wide">' +
      '<button type="button" class="modal-x" data-close-ai aria-label="關閉">×</button>' +
      '<span class="ai-badge">AI PIPELINE</span>' +
      '<h3 id="aiStratTitle"></h3>' +
      '<p class="muted" id="aiStratMeta"></p>' +
      '<img id="aiStratChart" class="ai-eq-full" alt="equity curve" />' +
      '<p id="aiStratCopy"></p>' +
      '<a class="btn-cta" href="#" data-get-strategy>獲取策略</a>' +
      "</div>";
    document.body.appendChild(wrap);
    wrap.addEventListener("click", function (ev) {
      if (ev.target === wrap || ev.target.hasAttribute("data-close-ai")) wrap.classList.remove("show");
    });
  }

  function chartUrl(row) {
    const u = row.chart_url || row.chart;
    if (u) return u;
    return "/static/charts/" + row.id + ".svg";
  }

  function displayName(row) {
    const n = String(row.title || row.name || "");
    if (n && !/^AI ai_/i.test(n)) return n;
    const copy = String(row.copy || "");
    if (/布林/.test(copy)) return "AI 布林帶突破";
    if (/RSI|rsi/.test(copy)) return "AI RSI 均值回歸";
    return "AI 策略 " + String(row.id || "").replace(/^ai_/, "");
  }

  function toCard(row) {
    const r = normalizeRow(row) || row;
    const sh = Number(r.sharpe);
    const ret = Number(r.return_pct);
    const mdd = Number(r.max_drawdown);
    const pf = Number(r.profit_factor);
    return {
      id: r.id,
      name: displayName(r),
      engine: r.id,
      tier: "free",
      ai: true,
      copy: r.copy || "",
      chart: chartUrl(r),
      symbols: r.symbols && r.symbols.length ? r.symbols : ["BTCUSDT", "ETHUSDT", "SOLUSDT"],
      interval: r.interval || "1h",
      tags: ["AI", "PIPELINE", "1H"],
      principle: String(r.copy || "").slice(0, 80),
      description: r.copy || "",
      metrics: {
        sharpe_ratio: sh,
        week_return: Number.isFinite(ret) ? (ret * 100).toFixed(1) + "%" : null,
        max_drawdown: Number.isFinite(mdd) ? (-Math.abs(mdd) * 100).toFixed(1) + "%" : null,
      },
      sharpe: sh,
      return_pct: ret,
      max_drawdown: mdd,
      profit_factor: pf,
      trades: r.trades,
    };
  }

  async function fetchRows() {
    await whenDomReady();
    const stamp = Date.now();
    const urls = ["/strategies.json?t=" + stamp, "./strategies.json?t=" + stamp];
    for (let i = 0; i < urls.length; i += 1) {
      try {
        const res = await fetch(urls[i], { cache: "no-store", headers: { Accept: "application/json" } });
        if (!res.ok) continue;
        const payload = await res.json();
        const raw = payload.strategies || payload.items || payload || [];
        if (!Array.isArray(raw)) continue;
        return raw.map(normalizeRow).filter(Boolean);
      } catch {
        /* try next */
      }
    }
    return [];
  }

  function cardHtml(s) {
    const sh = Number.isFinite(s.sharpe) ? s.sharpe.toFixed(2) : "—";
    const ret = Number.isFinite(s.return_pct) ? (s.return_pct * 100).toFixed(1) + "%" : "—";
    const mdd = Number.isFinite(s.max_drawdown) ? (s.max_drawdown * 100).toFixed(1) + "%" : "—";
    return (
      '<article class="m-card strategy-card ai-card" data-id="' +
      s.id +
      '" data-tier="free" data-kind="hot" data-ai="1" data-ret="' +
      (s.return_pct || 0) +
      '">' +
      '<span class="ai-badge">AI 挖礦</span>' +
      "<h3>" +
      s.name +
      "</h3>" +
      '<p class="card-hit">夏普 ' +
      sh +
      " · 收益 " +
      ret +
      " · 回撤 " +
      mdd +
      "</p>" +
      '<img class="ai-eq-thumb" src="' +
      s.chart +
      '" alt="equity" />' +
      '<p class="card-principle">' +
      (s.principle || "") +
      "</p>" +
      '<p class="muted">' +
      (s.symbols || []).join(" / ") +
      " · " +
      String(s.interval || "1h").toUpperCase() +
      "</p>" +
      '<div class="card-actions">' +
      '<button type="button" class="btn-cta compact" data-ai-detail="' +
      s.id +
      '">查看解說與曲線</button>' +
      '<a class="btn-cta compact" href="#" data-get-strategy>獲取策略</a>' +
      "</div></article>"
    );
  }

  function openDetail(row) {
    ensureModal();
    const modal = document.getElementById("aiStratModal");
    document.getElementById("aiStratTitle").textContent = displayName(row);
    document.getElementById("aiStratMeta").textContent =
      "Sharpe " +
      Number(row.sharpe).toFixed(2) +
      " · PF " +
      Number(row.profit_factor).toFixed(2) +
      " · 收益 " +
      (Number(row.return_pct) * 100).toFixed(1) +
      "%";
    const img = document.getElementById("aiStratChart");
    img.src = chartUrl(row);
    img.alt = displayName(row) + " 累計收益曲線";
    document.getElementById("aiStratCopy").textContent = row.copy || "";
    modal.classList.add("show");
  }

  function inject(rows) {
    const grid = document.getElementById("gridAll") || document.getElementById("gridFree");
    if (!grid || !rows.length) return;
    const cards = rows.map(toCard);
    cards
      .slice()
      .reverse()
      .forEach(function (s) {
        if (grid.querySelector('[data-id="' + s.id + '"]')) return;
        grid.insertAdjacentHTML("afterbegin", cardHtml(s));
      });
  }

  function paintPlazaMeta(n) {
    const el = document.getElementById("plazaCount");
    if (!el) return;
    el.textContent = "策略廣場已載入 " + n + " 套 AI 新挖策略（置頂展示，與基礎目錄並列）";
  }

  root.QAPipeline = {
    toCard: toCard,
    displayName: displayName,
    chartUrl: chartUrl,
    fetchRows: fetchRows,
    openDetail: openDetail,
    normalizeRow: normalizeRow,
  };
  root.QAPipelineReady = fetchRows().then(function (rows) {
    root.QAPipelineStrategies = rows;
    ensureStyle();
    ensureModal();
    inject(rows);
    paintPlazaMeta(rows.length);
    const grid = document.getElementById("gridAll");
    if (grid && !grid._aiObs) {
      grid._aiObs = new MutationObserver(function () {
        inject(root.QAPipelineStrategies || []);
      });
      grid._aiObs.observe(grid, { childList: true });
    }
    document.addEventListener("click", function (ev) {
      const btn = ev.target.closest("[data-ai-detail]");
      if (!btn) return;
      const id = btn.getAttribute("data-ai-detail");
      const row = (root.QAPipelineStrategies || []).find(function (r) {
        return r.id === id;
      });
      if (row) openDetail(row);
    });
    return rows;
  });
})(typeof window !== "undefined" ? window : globalThis);
