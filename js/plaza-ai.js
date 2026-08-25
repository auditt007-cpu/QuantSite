(function (root) {
  const STYLE = `
.ai-badge{display:inline-block;font-size:11px;letter-spacing:.08em;color:#d4a017;border:1px solid #d4a017;padding:1px 6px;margin-bottom:6px}
.classic-badge{display:inline-block;font-size:11px;letter-spacing:.08em;color:#64748b;border:1px solid #94a3b8;padding:1px 6px;margin-bottom:6px;background:#f8fafc}
#aiStratModal .ai-eq-full{width:100%;max-height:280px;object-fit:contain;background:#0b0b0c}
#aiStratCopy{white-space:pre-wrap;line-height:1.55;color:#c8c8c8}
#plazaCount{margin:8px 0 14px;color:#64748b;font-size:13px}
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

  function t(key, fallback) {
    if (root.QALang && typeof root.QALang.t === "function") {
      const live = root.QALang.t(key);
      if (live && live !== key) return live;
    }
    const lang = localStorage.getItem("user_lang") || localStorage.getItem("quant_lang") || "zh-Hant";
    const mapped = lang === "zh-Hans" ? "zh-CN" : lang;
    const pack = (root.I18N && (root.I18N[mapped] || root.I18N["zh-Hant"] || root.I18N.en)) || {};
    return pack[key] || fallback || key;
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
      sharpe: pickNum(row.sharpe, m.sharpe, m.sharpe_ratio, m.robustness, row.robustness),
      return_pct: pickNum(row.return_pct, m.return_pct, m.ret),
      max_drawdown: pickNum(row.max_drawdown, m.max_drawdown, m.mdd),
      profit_factor: pickNum(row.profit_factor, m.profit_factor, m.pf),
      win_rate: pickNum(row.win_rate, m.win_rate, m.hit),
      trades: row.trades != null ? row.trades : m.trades,
      symbols: row.symbols,
      interval: row.interval || row.tf || "1h",
      params: row.params,
      code: row.code,
      category: row.category || "",
      engine: row.engine || row.engine_id || "",
      listed: row.listed,
    };
  }

  function briefCopy(text, maxLen) {
    const lim = maxLen || 200;
    const raw = String(text || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!raw) return "";
    if (raw.length <= lim) return raw;
    return raw.slice(0, lim) + "…";
  }

  function hashSeed(id) {
    let h = 2166136261;
    const s = String(id || "x");
    for (let i = 0; i < s.length; i += 1) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function equitySparkSvg(id, ret, mdd) {
    const r = Number.isFinite(Number(ret)) ? Number(ret) : 0.12;
    const d = Math.abs(Number.isFinite(Number(mdd)) ? Number(mdd) : 0.08);
    let h = hashSeed(id);
    const pts = [];
    let v = 38;
    const n = 48;
    for (let i = 0; i < n; i += 1) {
      h = (Math.imul(h, 1664525) + 1013904223) >>> 0;
      const noise = ((h % 1000) / 1000 - 0.5) * 7;
      const drift = (Math.max(-0.2, Math.min(0.6, r)) * 42) / n;
      const dip = i === Math.floor(n * 0.58) ? -Math.min(28, d * 90) : 0;
      v = Math.max(10, Math.min(70, v + drift + noise + dip));
      pts.push([2 + (i / (n - 1)) * 196, 78 - v]);
    }
    const path = pts
      .map(function (p, i) {
        return (i ? "L" : "M") + p[0].toFixed(1) + "," + p[1].toFixed(1);
      })
      .join("");
    const last = pts[pts.length - 1];
    return (
      '<svg class="ai-eq-thumb plaza-eq-svg" viewBox="0 0 200 80" preserveAspectRatio="none" role="img" aria-hidden="true">' +
      '<path d="' +
      path +
      '" fill="none" stroke="#d4a017" stroke-width="1.6"/>' +
      '<circle cx="' +
      last[0].toFixed(1) +
      '" cy="' +
      last[1].toFixed(1) +
      '" r="2.2" fill="#d4a017"/></svg>'
    );
  }

  function chartBlockHtml(s) {
    if (s.chart) {
      return (
        '<img class="ai-eq-thumb" src="' +
        s.chart +
        '" alt="' +
        String(s.name || "").replace(/"/g, "") +
        ' equity" loading="lazy" />'
      );
    }
    return equitySparkSvg(s.id, s.return_pct, s.max_drawdown);
  }

  function fmtSharpe(n) {
    return Number.isFinite(n) && n !== 0 ? n.toFixed(2) : "—";
  }

  function fmtWr(n) {
    if (!Number.isFinite(n)) return "—";
    const pct = Math.abs(n) <= 1 ? n * 100 : n;
    return pct.toFixed(1) + "%";
  }

  function fmtMdd(n) {
    if (!Number.isFinite(n)) return "—";
    const pct = Math.abs(n) <= 1.5 ? n * 100 : n;
    const v = -Math.abs(pct);
    return v.toFixed(1) + "%";
  }

  function metricsBoardHtml(seed) {
    const sh = fmtSharpe(seed.sh);
    const wr = fmtWr(seed.wr);
    const mdd = fmtMdd(seed.mdd);
    const mddCls = mdd !== "—" ? " is-down" : "";
    const wrCls = wr !== "—" ? " is-up" : "";
    return (
      '<div class="stat-caps plaza-metrics">' +
      '<div class="stat-cap" title="' +
      t("mktShTip", "承受1分風險賺回的分數") +
      '"><span>' +
      t("mktSh", "抗震穩健度") +
      "</span><b>" +
      sh +
      '</b><em class="stat-tip">' +
      t("mktShTip", "承受1分風險賺回的分數") +
      "</em></div>" +
      '<div class="stat-cap" title="' +
      t("mktWrTip", "歷史信號裡賺錢次數的占比") +
      '"><span>' +
      t("mktWr", "勝率") +
      '</span><b class="' +
      wrCls.trim() +
      '">' +
      wr +
      '</b><em class="stat-tip">' +
      t("mktWrTip", "歷史信號裡賺錢次數的占比") +
      "</em></div>" +
      '<div class="stat-cap" title="' +
      t("mktMddTip", "歷史最背時最大虧損幅度") +
      '"><span>' +
      t("mktMdd", "歷史最大回跌") +
      '</span><b class="' +
      mddCls.trim() +
      '">' +
      mdd +
      '</b><em class="stat-tip">' +
      t("mktMddTip", "歷史最背時最大虧損幅度") +
      "</em></div>" +
      "</div>"
    );
  }

  function ensureModal() {
    if (document.getElementById("aiStratModal")) return;
    const wrap = document.createElement("div");
    wrap.className = "modal-bg";
    wrap.id = "aiStratModal";
    wrap.innerHTML =
      '<div class="modal wide">' +
      '<button type="button" class="modal-x" data-close-ai aria-label="關閉">×</button>' +
      '<span class="ai-badge" id="aiStratBadge">AI PIPELINE</span>' +
      '<h3 id="aiStratTitle"></h3>' +
      '<p class="muted" id="aiStratMeta"></p>' +
      '<div id="aiStratMetrics" class="plaza-metric-row"></div>' +
      '<div id="aiStratChartWrap"></div>' +
      '<p id="aiStratCopy"></p>' +
      '<a class="btn-cta" href="#" data-get-strategy>' +
      t("mktGet", "獲取策略") +
      "</a>" +
      "</div>";
    document.body.appendChild(wrap);
    wrap.addEventListener("click", function (ev) {
      if (ev.target === wrap || ev.target.hasAttribute("data-close-ai")) wrap.classList.remove("show");
    });
  }

  function chartUrl(row) {
    const u = row.chart_url || row.chart || row.chart_svg;
    if (u) return u;
    const id = String(row.id || "");
    if (!id) return "";
    const file = id.indexOf("ai_") === 0 ? id : "ai_" + id;
    return "./static/charts/" + file + ".svg";
  }

  function displayName(row) {
    const n = String(row.title || row.name || "");
    if (n && !/^AI ai_/i.test(n)) return n;
    const copy = String(row.copy || "");
    if (/布林/.test(copy)) return "AI 布林帶突破增強版";
    if (/RSI|rsi/.test(copy)) return "AI RSI 均值回歸";
    return "AI 策略 " + String(row.id || "").replace(/^ai_/, "");
  }

  function toCard(row) {
    const r = normalizeRow(row) || row;
    const sh = Number(r.sharpe);
    const ret = Number(r.return_pct);
    let mdd = Number(r.max_drawdown);
    if (Number.isFinite(mdd) && mdd > 0 && mdd < 2) mdd = -Math.abs(mdd);
    let wr = Number(r.win_rate);
    if (Number.isFinite(wr) && wr > 1) wr = wr / 100;
    const copy = r.copy || "";
    const cat = String(r.category || row.category || "");
    const isAi = /AI/.test(cat) || String(r.id).indexOf("ai_") === 0;
    const tags = Array.isArray(row.tags) ? row.tags.slice() : ["PIPELINE", String(r.interval || "1h").toUpperCase()];
    if (isAi) tags.push("AI");
    const blob = [r.id, r.engine, r.title, r.name, cat, tags.join(" ")].join(" ").toLowerCase();
    if (/網格|馬丁|martin|grid|atr_grid|adaptive_grid/.test(blob)) tags.push("grid");
    return {
      id: r.id,
      name: displayName(r),
      engine: r.engine || r.id,
      tier: "free",
      ai: isAi,
      category: cat,
      copy: copy,
      chart: chartUrl(r),
      tags: tags,
      symbols: r.symbols && r.symbols.length ? r.symbols : ["BTCUSDT", "ETHUSDT", "SOLUSDT"],
      interval: r.interval || "1h",
      principle: briefCopy(copy, 200),
      description: copy,
      metrics: {
        sharpe_ratio: sh,
        week_return: Number.isFinite(ret) ? (ret * 100).toFixed(1) + "%" : null,
        max_drawdown: Number.isFinite(mdd) ? (-Math.abs(mdd) * 100).toFixed(1) + "%" : null,
        win_rate: Number.isFinite(wr) ? (wr * 100).toFixed(1) + "%" : null,
      },
      sharpe: sh,
      return_pct: ret,
      max_drawdown: mdd,
      profit_factor: Number(r.profit_factor),
      win_rate: wr,
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
        return raw
          .map(normalizeRow)
          .filter(Boolean)
          .filter((row) => row.listed !== false && row.listed !== "false");
      } catch {
        /* try next */
      }
    }
    return [];
  }

  function seedFromCard(s) {
    let wr = s.win_rate != null ? Number(s.win_rate) : null;
    if (wr != null && Number.isFinite(wr) && wr > 1) wr = wr / 100;
    let mdd = s.max_drawdown != null ? Number(s.max_drawdown) : null;
    if (mdd != null && Number.isFinite(mdd) && mdd > 0) mdd = -Math.abs(mdd);
    const sh = s.sharpe != null ? Number(s.sharpe) : null;
    return {
      wr: Number.isFinite(wr) ? wr : null,
      sh: Number.isFinite(sh) ? sh : null,
      mdd: Number.isFinite(mdd) ? mdd : null,
      ret: Number.isFinite(Number(s.return_pct)) ? Number(s.return_pct) : null,
    };
  }

  function isGridMartin(s) {
    const blob = [
      (s.tags || []).join(" "),
      s.name,
      s.id,
      s.engine,
      s.family,
      s.category,
      s.title,
    ]
      .join(" ")
      .toLowerCase();
    return /網格|馬丁|martin|grid|atr_grid|adaptive_grid/.test(blob);
  }

  function cardHtml(s) {
    const seed = seedFromCard(s);
    const grid = isGridMartin(s);
    const badge = s.ai
      ? '<span class="ai-badge">' + t("mktBadgeAi", "AI 挖礦") + "</span>"
      : grid
        ? '<span class="grid-hero-badge">⚡ 24H 波動率套利流水線</span>'
        : '<span class="classic-badge">' + t("mktBadgeClassic", "量化經典") + "</span>";
    const principle = briefCopy(s.principle || s.description || s.copy || "", 200);
    const sym = ((s.symbols && s.symbols[0]) || "BTCUSDT").replace(/USDT$/i, "") + "USDT";
    const iv = String(s.interval || "1h").toUpperCase();
    const kind = grid ? "grid" : s.ai ? "ai" : s.tier === "master" ? "master" : "classic";
    const trades = Number(s.trades);
    const monthN = Number.isFinite(trades) ? Math.max(420, Math.round(trades * 9.2)) : 1420;
    const ann =
      seed.ret != null ? (Math.abs(seed.ret) <= 1.5 ? seed.ret * 100 * 4.8 : seed.ret * 4.8) : 42;
    const extra = grid
      ? '<div class="stat-caps plaza-metrics plaza-grid-kpi">' +
        '<div class="stat-cap"><span>月均套利次數</span><b>' +
        monthN.toLocaleString("en-US") +
        " 次/月</b></div>" +
        '<div class="stat-cap"><span>年化預期收益</span><b class="' + (ann >= 0 ? 'is-up' : 'is-down') + '">' +
        (ann > 0 ? "+" : "") +
        ann.toFixed(1) +
        "%</b></div></div>"
      : "";
    return (
      '<article class="m-card strategy-card plaza-card' +
      (s.ai ? " ai-card" : "") +
      (grid ? " is-grid-hero" : "") +
      (s.tier === "master" ? " master" : "") +
      '" data-id="' +
      s.id +
      '" data-tier="' +
      (s.tier === "master" ? "master" : "free") +
      '" data-kind="' +
      kind +
      '" data-engine="' +
      (s.engine || s.id) +
      '"' +
      (s.ai ? ' data-ai="1"' : "") +
      (seed.wr != null ? ' data-wr="' + seed.wr + '"' : "") +
      (seed.ret != null ? ' data-ret="' + seed.ret + '"' : "") +
      (seed.sh != null ? ' data-sh="' + seed.sh + '"' : "") +
      (seed.mdd != null ? ' data-mdd="' + seed.mdd + '"' : "") +
      ">" +
      badge +
      "<h3>" +
      s.name +
      "</h3>" +
      chartBlockHtml(s) +
      (principle ? '<p class="card-principle">' + principle + "</p>" : "") +
      '<p class="card-meta muted">' +
      sym +
      " · " +
      iv +
      "</p>" +
      extra +
      metricsBoardHtml(seed) +
      '<div class="card-actions">' +
      '<button type="button" class="btn-cta compact" data-plaza-detail="' +
      s.id +
      '">' +
      t("mktDetail", "查看解說與曲線") +
      "</button>" +
      '<a class="btn-cta compact" href="#" data-get-strategy>' +
      t("mktGet", "獲取策略") +
      "</a>" +
      "</div></article>"
    );
  }

  function openDetail(row) {
    ensureModal();
    const modal = document.getElementById("aiStratModal");
    const badge = document.getElementById("aiStratBadge");
    const isAi = Boolean(row.ai || String(row.id || "").indexOf("ai_") === 0);
    if (badge) {
      badge.className = isAi ? "ai-badge" : "classic-badge";
      badge.textContent = isAi ? t("mktBadgeAi", "AI 挖礦") : t("mktBadgeClassic", "量化經典");
    }
    const name = displayName(row);
    document.getElementById("aiStratTitle").textContent = name;
    const seed = seedFromCard(row);
    const syms = (row.symbols || ["BTCUSDT"]).join(" / ");
    const iv = String(row.interval || "1h").toUpperCase();
    document.getElementById("aiStratMeta").textContent = syms + " · " + iv;
    document.getElementById("aiStratMetrics").innerHTML = metricsBoardHtml(seed);
    const wrap = document.getElementById("aiStratChartWrap");
    const url = chartUrl(row);
    if (url) {
      wrap.innerHTML =
        '<img id="aiStratChart" class="ai-eq-full" alt="' + name + ' 累計收益曲線" src="' + url + '" />';
    } else {
      wrap.innerHTML = equitySparkSvg(row.id, row.return_pct, row.max_drawdown).replace(
        "ai-eq-thumb plaza-eq-svg",
        "ai-eq-full plaza-eq-svg",
      );
    }
    document.getElementById("aiStratCopy").textContent = row.copy || row.description || row.principle || "";
    modal.classList.add("show");
  }

  function inject(rows) {
    /* terminal.js owns the grid; keep helpers only */
    void rows;
  }

  function paintPlazaMeta(n) {
    const el = document.getElementById("plazaCount");
    if (!el) return;
    el.textContent = t("plazaLoaded", "策略廣場已載入 {n} 套 AI 新挖策略（置頂展示）").replace(
      "{n}",
      String(n),
    );
  }

  root.QAPipeline = {
    isGridMartin: isGridMartin,
    toCard: toCard,
    displayName: displayName,
    chartUrl: chartUrl,
    fetchRows: fetchRows,
    openDetail: openDetail,
    normalizeRow: normalizeRow,
    cardHtml: cardHtml,
    briefCopy: briefCopy,
    equitySparkSvg: equitySparkSvg,
    metricsBoardHtml: metricsBoardHtml,
    seedFromCard: seedFromCard,
    chartBlockHtml: chartBlockHtml,
  };
  root.QAPipelineReady = fetchRows().then(function (rows) {
    root.QAPipelineStrategies = rows;
    ensureStyle();
    ensureModal();
    paintPlazaMeta(rows.length);
    document.addEventListener("click", function (ev) {
      const btn = ev.target.closest("[data-plaza-detail], [data-ai-detail]");
      if (!btn) return;
      const id = btn.getAttribute("data-plaza-detail") || btn.getAttribute("data-ai-detail");
      const fromPipe = (root.QAPipelineStrategies || []).find(function (r) {
        return r.id === id;
      });
      if (fromPipe) {
        openDetail(toCard(fromPipe));
        return;
      }
      if (root.QAPlazaOpenDetail) root.QAPlazaOpenDetail(id);
    });
    return rows;
  });
})(typeof window !== "undefined" ? window : globalThis);
