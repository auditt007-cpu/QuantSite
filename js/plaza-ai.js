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
    const display = String(row.title || row.name || "").trim();
    const lockedSym = symbolFromName(display, row);
    const symbols = lockedSym
      ? [lockedSym]
      : Array.isArray(row.symbols) && row.symbols.length
        ? row.symbols
        : row.symbol
          ? [String(row.symbol).replace(/\//g, "")]
          : undefined;
    return {
      id: String(id),
      name: display || String(id),
      title: display || undefined,
      copy: copy,
      chart: chart,
      chart_url: chart,
      status: row.status || "",
      strategy_type: row.strategy_type || row.subtype || "",
      metrics: m,
      sharpe: pickNum(row.sharpe, m.sharpe, m.sharpe_ratio, m.robustness, row.robustness),
      return_pct: pickNum(
        row.return_pct,
        m.return_pct,
        m.ret,
        m.backtest_apy_pct != null ? Number(m.backtest_apy_pct) / 100 : NaN
      ),
      max_drawdown: pickNum(row.max_drawdown, m.max_drawdown_pct, m.max_drawdown, m.mdd),
      profit_factor: pickNum(row.profit_factor, m.profit_factor, m.pf),
      win_rate: pickNum(row.win_rate, m.win_rate_pct, m.win_rate, m.hit),
      trades: row.trades != null ? row.trades : m.trades,
      symbols: symbols,
      symbol: lockedSym || row.symbol || "",
      interval: row.interval || row.tf || "1h",
      params: row.params,
      code: row.code,
      category: row.category || "",
      engine: row.engine || row.engine_id || "",
      listed: row.listed,
      period_days: pickNum(row.period_days, row.backtest_days, m.period_days, 60),
      disclaimer: m.disclaimer || row.disclaimer || "",
      metrics_source: m.metrics_source || row.metrics_source || "",
    };
  }

  function symbolFromName(name, row) {
    const n = String(name || "").trim();
    const m = n.match(/^([A-Za-z0-9]+)\s*[·・.]/);
    if (m) return m[1].toUpperCase().replace(/USDT$/i, "") + "USDT";
    if (row && row.symbol) return String(row.symbol).replace(/\//g, "").toUpperCase();
    if (row && Array.isArray(row.symbols) && row.symbols[0]) {
      return String(row.symbols[0]).replace(/\//g, "").toUpperCase();
    }
    return "";
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
    const r = Number.isFinite(Number(ret)) ? Number(ret) : 0;
    const d = Math.abs(Number.isFinite(Number(mdd)) ? Number(mdd) : 0.08);
    let h = hashSeed(id);
    const n = 28;
    const raw = [];
    let v = 0.42;
    const drift = Math.max(-0.35, Math.min(0.55, r <= 1.5 ? r : r / 100)) / n;
    const dipAt = Math.floor(n * 0.62);
    for (let i = 0; i < n; i += 1) {
      h = (Math.imul(h, 1664525) + 1013904223) >>> 0;
      const noise = ((h % 1000) / 1000 - 0.5) * 0.035;
      const dip = i === dipAt ? -Math.min(0.28, d <= 1.5 ? d : d / 100) : 0;
      v = Math.max(0.08, Math.min(0.92, v + drift + noise + dip));
      raw.push(v);
    }
    const sm = raw.map(function (x, i, a) {
      const a0 = a[Math.max(0, i - 1)];
      const a2 = a[Math.min(a.length - 1, i + 1)];
      return (a0 + x + a2) / 3;
    });
    const w = 240;
    const ht = 72;
    const pad = 4;
    const pts = sm.map(function (x, i) {
      return [pad + (i / (n - 1)) * (w - pad * 2), ht - pad - x * (ht - pad * 2)];
    });
    let dPath = "M" + pts[0][0].toFixed(1) + "," + pts[0][1].toFixed(1);
    for (let i = 1; i < pts.length; i += 1) {
      const p0 = pts[i - 1];
      const p1 = pts[i];
      const mx = ((p0[0] + p1[0]) / 2).toFixed(1);
      dPath += " Q" + p0[0].toFixed(1) + "," + p0[1].toFixed(1) + " " + mx + "," + ((p0[1] + p1[1]) / 2).toFixed(1);
    }
    const last = pts[pts.length - 1];
    dPath += " L" + last[0].toFixed(1) + "," + last[1].toFixed(1);
    const area =
      dPath +
      " L" +
      last[0].toFixed(1) +
      "," +
      (ht - 1) +
      " L" +
      pts[0][0].toFixed(1) +
      "," +
      (ht - 1) +
      " Z";
    const gid = "eqg-" + String(id || "x").replace(/[^a-zA-Z0-9_-]/g, "");
    const up = r >= 0;
    const stroke = up ? "#0f7b3a" : "#c2410c";
    const fill0 = up ? "rgba(15,123,58,0.22)" : "rgba(194,65,12,0.18)";
    return (
      '<svg class="ai-eq-thumb plaza-eq-svg" viewBox="0 0 ' +
      w +
      " " +
      ht +
      '" preserveAspectRatio="none" role="img" aria-hidden="true">' +
      "<defs><linearGradient id=\"" +
      gid +
      '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="' +
      fill0 +
      '"/><stop offset="100%" stop-color="rgba(255,255,255,0)"/></linearGradient></defs>' +
      '<path d="' +
      area +
      '" fill="url(#' +
      gid +
      ')" stroke="none"/>' +
      '<path d="' +
      dPath +
      '" fill="none" stroke="' +
      stroke +
      '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
      "</svg>"
    );
  }

  function chartBlockHtml(s) {
    const url = chartUrl(s);
    if (url) {
      const title = displayName(s);
      return (
        '<img class="ai-eq-thumb" src="' +
        url +
        '" alt="' +
        title +
        ' equity" loading="lazy" />'
      );
    }
    return equitySparkSvg(s.id || s.name, s.return_pct, s.max_drawdown);
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

  function fmtRet(n) {
    if (!Number.isFinite(n)) return "—";
    const pct = Math.abs(n) <= 1.5 ? n * 100 : n;
    const sign = pct > 0 ? "+" : "";
    return sign + pct.toFixed(1) + "%";
  }

  function fmtPf(n) {
    if (!Number.isFinite(n) || n <= 0) return "—";
    return n.toFixed(2);
  }

  function fmtTrades(n) {
    const x = Number(n);
    if (!Number.isFinite(x) || x <= 0) return "—";
    return Math.round(x).toLocaleString("en-US");
  }

  function retLabel(days) {
    const d = Number.isFinite(Number(days)) && Number(days) > 0 ? Math.round(Number(days)) : 60;
    const tpl = t("mktRet", "回測{d}日區間報酬");
    return String(tpl).replace(/\{d\}/g, String(d));
  }

  function metricsBoardHtml(seed) {
    const sh = fmtSharpe(seed.sh);
    const wr = seed.wrLabel || fmtWr(seed.wr);
    const mdd = fmtMdd(seed.mdd);
    const ret = fmtRet(seed.ret);
    const pf = fmtPf(seed.pf);
    const trades = fmtTrades(seed.trades);
    const mddCls = mdd !== "—" ? " is-down" : "";
    const wrCls = wr !== "—" ? " is-up" : "";
    const retCls = seed.ret == null ? "" : Number(seed.ret) >= 0 ? " is-up" : " is-down";
    const retLab =
      seed.source === "backtest" || (Number.isFinite(seed.ret) && Math.abs(seed.ret) > 0.2)
        ? t("mktApy", "回測年化 APY")
        : retLabel(seed.periodDays);
    const retTip = t("mktRetTip", "指定回測窗口內的累積報酬（非整年年化）");
    const disc = seed.disclaimer || (seed.source === "backtest" ? "基於 60 日回測數據" : "");
    const discHtml = disc
      ? '<div class="stat-cap plaza-disclaimer" style="flex-basis:100%;opacity:.72;font-size:11px;letter-spacing:.02em"><span></span><b style="font-weight:500;color:#8b9bb4">' +
        disc +
        "</b></div>"
      : "";
    return (
      '<div class="stat-caps plaza-metrics">' +
      '<div class="stat-cap"><span>' +
      t("mktSh", "抗震穩健度") +
      "</span><b>" +
      sh +
      "</b></div>" +
      '<div class="stat-cap" title="' +
      retTip +
      '"><span>' +
      retLab +
      "</span><b class=\"" +
      retCls.trim() +
      '">' +
      ret +
      "</b><em class=\"stat-tip\">" +
      retTip +
      "</em></div>" +
      '<div class="stat-cap"><span>' +
      t("mktWr", "命中率") +
      '</span><b class="' +
      wrCls.trim() +
      '">' +
      wr +
      "</b></div>" +
      '<div class="stat-cap"><span>' +
      t("mktMdd", "歷史最大回跌") +
      '</span><b class="' +
      mddCls.trim() +
      '">' +
      mdd +
      "</b></div>" +
      '<div class="stat-cap"><span>' +
      t("kpiPf", "盈虧因子") +
      "</span><b>" +
      pf +
      "</b></div>" +
      '<div class="stat-cap"><span>' +
      t("hbColTrades", "樣本筆數") +
      "</span><b>" +
      trades +
      "</b></div>" +
      discHtml +
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
    // Prefer JSON `name`/`title`; only fall back to strategy_id when empty.
    const n = String((row && (row.title || row.name)) || "").trim();
    if (n) return n;
    return String((row && (row.id || row.strategy_id)) || "—");
  }

  function toCard(row) {
    const r = normalizeRow(row) || row;
    const status = String(r.status || row.status || "").toUpperCase();
    const m = (r.metrics && typeof r.metrics === "object" ? r.metrics : row.metrics) || {};
    let sh = Number(r.sharpe);
    if (!Number.isFinite(sh) || sh === 0) sh = Number(m.sharpe_ratio);
    let ret = Number(r.return_pct);
    if (!Number.isFinite(ret) || ret === 0) {
      const apy = Number(m.backtest_apy_pct);
      if (Number.isFinite(apy) && apy !== 0) ret = apy / 100;
    }
    let mdd = Number(r.max_drawdown);
    if (!Number.isFinite(mdd) || mdd === 0) {
      const dd = Number(m.max_drawdown_pct);
      if (Number.isFinite(dd) && dd !== 0) mdd = dd;
    }
    if (Number.isFinite(mdd) && Math.abs(mdd) > 1.5) mdd = mdd / 100;
    if (Number.isFinite(mdd) && mdd > 0) mdd = -Math.abs(mdd);
    let wr = Number(r.win_rate);
    if (!Number.isFinite(wr) || wr === 0) wr = Number(m.win_rate_pct);
    if (Number.isFinite(wr) && wr > 1) wr = wr / 100;
    let pf = Number(r.profit_factor);
    if (!Number.isFinite(pf) || pf === 0) pf = Number(m.profit_factor);
    const copy = r.copy || "";
    const cat = String(r.category || row.category || "");
    const stype = String(r.strategy_type || row.strategy_type || "").toUpperCase();
    const isAi =
      /AI/.test(cat) ||
      String(r.id).indexOf("ai_") === 0 ||
      stype === "GRID" ||
      /GRID/.test(stype) ||
      status === "BACKTEST_READY" ||
      status === "INITIALIZING";
    const tags = Array.isArray(row.tags) ? row.tags.slice() : ["PIPELINE", String(r.interval || "1h").toUpperCase()];
    if (isAi) tags.push("AI");
    if (/網格|grid|GRID/.test([r.id, r.name, stype, tags.join(" ")].join(" "))) tags.push("grid");
    const symLocked = symbolFromName(displayName(r), r) || (r.symbols && r.symbols[0]) || "BTCUSDT";
    const periodDays = Number(r.period_days) > 0 ? Number(r.period_days) : 60;
    return {
      id: r.id,
      name: displayName(r),
      engine: r.engine || r.id,
      tier: "free",
      ai: isAi,
      status: status,
      strategy_type: stype || "GRID",
      category: cat,
      copy: copy,
      chart: chartUrl(r),
      tags: tags,
      symbols: [symLocked],
      symbol: symLocked,
      interval: r.interval || "1h",
      principle: briefCopy(copy, 200),
      description: copy,
      disclaimer: r.disclaimer || m.disclaimer || "基於 60 日回測數據",
      metrics_source: r.metrics_source || m.metrics_source || "backtest_60d",
      period_days: periodDays,
      metrics: {
        sharpe_ratio: sh,
        backtest_apy_pct: m.backtest_apy_pct,
        week_return: Number.isFinite(ret) ? (ret * 100).toFixed(1) + "%" : null,
        max_drawdown: Number.isFinite(mdd) ? (-Math.abs(mdd) * 100).toFixed(1) + "%" : null,
        win_rate: Number.isFinite(wr) ? (wr * 100).toFixed(1) + "%" : null,
        profit_factor: pf,
        disclaimer: r.disclaimer || m.disclaimer || "基於 60 日回測數據",
      },
      sharpe: sh,
      return_pct: ret,
      max_drawdown: mdd,
      profit_factor: pf,
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
    const m = (s && s.metrics && typeof s.metrics === "object" ? s.metrics : {}) || {};
    let wr = s.win_rate != null ? Number(s.win_rate) : null;
    if (!Number.isFinite(wr) || wr === 0) {
      const w = Number(m.win_rate_pct != null ? m.win_rate_pct : m.win_rate);
      if (Number.isFinite(w)) wr = w;
    }
    if (wr != null && Number.isFinite(wr) && wr > 1) wr = wr / 100;
    let mdd = s.max_drawdown != null ? Number(s.max_drawdown) : null;
    if (!Number.isFinite(mdd) || mdd === 0) {
      const d = Number(m.max_drawdown_pct != null ? m.max_drawdown_pct : m.max_drawdown);
      if (Number.isFinite(d)) mdd = d;
    }
    if (mdd != null && Number.isFinite(mdd) && Math.abs(mdd) > 1.5) mdd = mdd / 100;
    if (mdd != null && Number.isFinite(mdd) && mdd > 0) mdd = -Math.abs(mdd);
    let sh = s.sharpe != null ? Number(s.sharpe) : null;
    if (!Number.isFinite(sh) || sh === 0) {
      const x = Number(m.sharpe_ratio);
      if (Number.isFinite(x)) sh = x;
    }
    let ret = Number(s.return_pct);
    const apy = Number(m.backtest_apy_pct);
    // FOMO: surface annualized backtest APY as the hero return when present.
    if (Number.isFinite(apy) && apy >= 8) {
      ret = apy / 100;
    } else if (!Number.isFinite(ret) || ret === 0) {
      if (Number.isFinite(Number(m.return_pct))) ret = Number(m.return_pct);
    }
    let pf = Number(s.profit_factor);
    if (!Number.isFinite(pf) || pf <= 0) pf = Number(m.profit_factor);
    const trades = Number(s.trades != null ? s.trades : m.trades);
    let periodDays = Number(s.period_days || s.backtest_days || s.periodDays || m.period_days);
    if (!Number.isFinite(periodDays) || periodDays < 1) periodDays = 60;
    const fromBacktest =
      String(s.metrics_source || m.metrics_source || "").indexOf("backtest") >= 0 ||
      (Number.isFinite(Number(m.backtest_apy_pct)) && Number(m.backtest_apy_pct) > 0);
    return {
      wr: Number.isFinite(wr) ? wr : null,
      sh: Number.isFinite(sh) ? sh : null,
      mdd: Number.isFinite(mdd) ? mdd : null,
      ret: Number.isFinite(ret) ? ret : null,
      pf: Number.isFinite(pf) && pf > 0 ? pf : null,
      trades: Number.isFinite(trades) && trades > 0 ? trades : null,
      periodDays: periodDays,
      source: fromBacktest ? "backtest" : "live",
      disclaimer: s.disclaimer || m.disclaimer || (fromBacktest ? "基於 60 日回測數據" : ""),
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
    const title = displayName(s);
    const grid = isGridMartin(s) || /GRID/i.test(String(s.strategy_type || ""));
    const badge = s.ai
      ? '<span class="ai-badge">' + t("mktBadgeAi", "AI 挖礦") + "</span>"
      : grid
        ? '<span class="grid-hero-badge">24H 波動率套利流水線</span>'
        : '<span class="classic-badge">' + t("mktBadgeClassic", "量化經典") + "</span>";
    const principle = briefCopy(s.principle || s.description || s.copy || "", 200);
    const rawSym =
      symbolFromName(displayName(s), s) || (s.symbols && s.symbols[0]) || s.symbol || "BTCUSDT";
    const sym = String(rawSym).replace(/\//g, "").replace(/USDT$/i, "") + "USDT";
    const iv = String(s.interval || "1h").toUpperCase();
    const kind = grid ? "grid" : s.ai ? "ai" : s.tier === "master" ? "master" : "classic";
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
      '" data-status="' +
      (s.status || "") +
      '"' +
      (s.ai ? ' data-ai="1"' : "") +
      (seed.wr != null ? ' data-wr="' + seed.wr + '"' : "") +
      (seed.ret != null ? ' data-ret="' + seed.ret + '"' : "") +
      (seed.sh != null ? ' data-sh="' + seed.sh + '"' : "") +
      (seed.mdd != null ? ' data-mdd="' + seed.mdd + '"' : "") +
      ">" +
      badge +
      "<h3>" +
      title +
      "</h3>" +
      chartBlockHtml(s) +
      (principle ? '<p class="card-principle">' + principle + "</p>" : "") +
      '<p class="card-meta muted">' +
      sym +
      " · " +
      iv +
      "</p>" +
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
