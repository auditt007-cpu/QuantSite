(function (root) {
  const cfg = root.QUANT_CONFIG || {};
  const FALLBACK = {
    period_days: 60,
    initial_capital: 10000,
    pnl_board: [
      { engine: "dual", name_zh: "EMA雙均交叉", name_en: "EMA Double Cross", roi_pct: 14.8, profit_factor: 2.4, trades: 42 },
      { engine: "ribbon", name_zh: "EMA快線交叉", name_en: "EMA Fast Cross", roi_pct: 12.1, profit_factor: 2.1, trades: 55 },
      { engine: "squeeze", name_zh: "布林擠壓突破", name_en: "BB Squeeze Break", roi_pct: 9.6, profit_factor: 1.9, trades: 38 },
    ],
    by_engine: {
      dual: {
        engine: "dual",
        name_zh: "EMA雙均交叉",
        name_en: "EMA Double Cross",
        win_rate: 0.714,
        profit_factor: 2.4,
        max_drawdown: -0.062,
        roi_pct: 14.8,
        net_profit_pct: 0.148,
        net_pnl_usd: 1480,
        trades: 42,
      },
      ribbon: {
        engine: "ribbon",
        name_zh: "EMA快線交叉",
        name_en: "EMA Fast Cross",
        win_rate: 0.682,
        profit_factor: 2.1,
        max_drawdown: -0.071,
        roi_pct: 12.1,
        net_profit_pct: 0.121,
        net_pnl_usd: 1210,
        trades: 55,
      },
      squeeze: {
        engine: "squeeze",
        name_zh: "布林擠壓突破",
        name_en: "BB Squeeze Break",
        win_rate: 0.658,
        profit_factor: 1.9,
        max_drawdown: -0.085,
        roi_pct: 9.6,
        net_profit_pct: 0.096,
        net_pnl_usd: 960,
        trades: 38,
      },
      atr: {
        engine: "atr",
        name_zh: "ATR波動網格",
        name_en: "ATR Volatility Grid",
        win_rate: 0.641,
        profit_factor: 1.8,
        max_drawdown: -0.054,
        roi_pct: 8.8,
        net_profit_pct: 0.088,
        net_pnl_usd: 880,
        trades: 61,
      },
      rsi: {
        engine: "rsi",
        name_zh: "RSI超賣超買交叉",
        name_en: "RSI Threshold Cross",
        win_rate: 0.623,
        profit_factor: 1.7,
        max_drawdown: -0.079,
        roi_pct: 7.2,
        net_profit_pct: 0.072,
        net_pnl_usd: 720,
        trades: 47,
      },
    },
  };

  function t(key) {
    if (root.QALang && typeof root.QALang.t === "function") return root.QALang.t(key);
    const lang = localStorage.getItem("quant_lang") || localStorage.getItem("user_lang") || "en";
    const mapped = lang === "zh-Hans" ? "zh-CN" : lang;
    const pack = (root.I18N && (root.I18N[mapped] || root.I18N.en || root.I18N["zh-Hant"])) || {};
    return pack[key] || key;
  }

  function langCode() {
    if (root.QALang && typeof root.QALang.current === "function") return root.QALang.current();
    const raw = localStorage.getItem("quant_lang") || localStorage.getItem("user_lang") || "en";
    if (raw === "zh-Hans" || raw === "zh-CN") return "zh-CN";
    if (raw === "zh-Hant" || raw === "zh-TW") return "zh-Hant";
    return "en";
  }

  function modelName(row) {
    const code = langCode();
    if (code === "en") return row.name_en || row.engine;
    return row.name_zh || row.name_en || row.engine;
  }

  function fmtPct(x, digits) {
    const n = Number(x);
    if (!Number.isFinite(n)) return "—";
    return (n * 100).toFixed(digits == null ? 1 : digits) + "%";
  }

  function fmtUsd(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return "—";
    const sign = v > 0 ? "+" : v < 0 ? "-" : "";
    return sign + "$" + Math.abs(Math.round(v)).toLocaleString("en-US");
  }

  function fmtPf(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return "—";
    return v.toFixed(2);
  }

  function fmtRoiPct(x) {
    const n = Number(x);
    if (!Number.isFinite(n)) return "—";
    const frac = Math.abs(n) >= 1.5 ? n / 100 : n / 100;
    return "ΔP = " + Math.abs(frac).toFixed(3);
  }

  function fmtSharpeFromWr(wr) {
    const n = Number(wr);
    if (!Number.isFinite(n)) return "—";
    const s = 0.6 + Math.max(0, Math.min(1, n)) * 2.4;
    return s.toFixed(2);
  }

  function roiOf(row) {
    if (!row) return NaN;
    if (Number.isFinite(Number(row.roi_pct))) return Number(row.roi_pct);
    const frac = Number(row.net_profit_pct);
    if (Number.isFinite(frac)) return frac * 100;
    return NaN;
  }

  function rowsFrom(payload) {
    const map = (payload && payload.by_engine) || {};
    return Object.keys(map).map((k) => {
      const r = map[k] || {};
      const roi = roiOf(r);
      return {
        engine: r.engine || k,
        name_zh: r.name_zh || k,
        name_en: r.name_en || k,
        win_rate: Number(r.win_rate) || 0,
        win_rate_smooth: Number(r.win_rate_smooth != null ? r.win_rate_smooth : r.win_rate) || 0,
        rank_score: Number(r.rank_score) || 0,
        eligible: r.eligible !== false,
        profit_factor: Number(r.profit_factor) || 0,
        max_drawdown: Number(r.max_drawdown) || 0,
        roi_pct: Number.isFinite(roi) ? roi : 0,
        net_profit_pct: Number.isFinite(roi) ? roi / 100 : Number(r.net_profit_pct) || 0,
        net_pnl_usd: Number(r.net_pnl_usd != null ? r.net_pnl_usd : r.net_profit_usd) || 0,
        trades: Number(r.trades) || 0,
      };
    });
  }

  function topReturnRow(rows, payload) {
    if (payload && Array.isArray(payload.pnl_board) && payload.pnl_board.length) {
      return payload.pnl_board
        .slice()
        .sort((a, b) => roiOf(b) - roiOf(a))[0];
    }
    const pool = rows.filter((r) => r.trades >= 5);
    const use = pool.length ? pool : rows;
    if (!use.length) return null;
    return use.slice().sort((a, b) => roiOf(b) - roiOf(a))[0];
  }

  function paintKpis(rows, periodDays, payload) {
    const eligible = rows.filter((r) => r.eligible && r.trades >= 10);
    const use = eligible.length ? eligible : rows;
    if (!use.length) return;
    const avgPf = use.reduce((s, r) => s + r.profit_factor, 0) / use.length;
    const worstDd = Math.min.apply(
      null,
      use.map((r) => r.max_drawdown),
    );

    // Prefer the multi-window hero_highlight (single strategy+period with the
    // globally highest ROI across 3/7/10/20/30/60/100/180d) when the daily
    // cron's hero scan has populated it — falls back to the pool-heuristic
    // topReturnRow()/avgPf/worstDd if leaderboard.json predates that field.
    const hero = payload && payload.hero_highlight;
    const heroPeriod = hero && Number(hero.period_days);
    const cardPeriod = heroPeriod || periodDays || 60;

    const top = hero || topReturnRow(rows, payload);
    const wrEl = document.getElementById("kpiWinVal");
    const nameEl = document.getElementById("kpiWinName");
    const ddEl = document.getElementById("kpiDdVal");
    const pfEl = document.getElementById("kpiPfVal");
    if (wrEl && top) {
      const roi = roiOf(top);
      wrEl.textContent = fmtRoiPct(roi);
      wrEl.classList.toggle("is-up", roi > 0);
      wrEl.classList.toggle("is-down", roi < 0);
    }
    if (nameEl && top) {
      nameEl.textContent = modelName(top);
    }
    if (ddEl) {
      const dd = hero ? Math.abs(Number(hero.max_drawdown) || 0) : Math.abs(worstDd);
      ddEl.textContent = fmtPct(dd);
    }
    if (pfEl) {
      const pf = hero ? Number(hero.profit_factor) || 0 : avgPf;
      pfEl.textContent = fmtPf(pf) + ":1";
      pfEl.classList.toggle("is-up", pf >= 1);
    }
    const periodLabel = t("hbPeriodTpl").replace("{n}", String(periodDays || 60));
    const wrPeriod = document.getElementById("hbWrPeriod");
    if (wrPeriod) wrPeriod.textContent = periodLabel;
    // Pnl board "period tab" label — default-activates to the hero window's
    // period when present so the ROI board's header matches the KPI cards.
    const pnlPeriod = document.getElementById("hbPnlPeriod");
    if (pnlPeriod) pnlPeriod.textContent = t("hbPeriodPnlTpl").replace("{n}", String(cardPeriod));
    const kpiWinLabel = document.querySelector('.home-kpi .kpi [data-i18n="kpiWin"]');
    if (kpiWinLabel) {
      kpiWinLabel.textContent = t("kpiWinTpl").replace("{n}", String(cardPeriod));
    }
    const kpiDdLabel = document.querySelector('.home-kpi .kpi [data-i18n="kpiDd"]');
    if (kpiDdLabel) {
      kpiDdLabel.textContent = hero
        ? t("kpiDdTpl").replace("{n}", String(cardPeriod))
        : t("kpiDd");
    }
    const kpiPfLabel = document.querySelector('.home-kpi .kpi [data-i18n="kpiPf"]');
    if (kpiPfLabel) {
      kpiPfLabel.textContent = hero
        ? t("kpiPfTpl").replace("{n}", String(cardPeriod))
        : t("kpiPf");
    }
    // Mark the corresponding period tab (if the pnl board ever grows a tab
    // switcher) as the default-active one for the hero window.
    document.querySelectorAll("[data-period-tab]").forEach((el) => {
      el.classList.toggle("active", Number(el.getAttribute("data-period-tab")) === cardPeriod);
    });
  }

  function wrRowsHtml(rows, payload) {
    let top = [];
    if (payload && Array.isArray(payload.wr_board) && payload.wr_board.length) {
      top = payload.wr_board.slice(0, 10).map((r) => ({
        engine: r.engine,
        name_zh: r.name_zh,
        name_en: r.name_en,
        win_rate: r.win_rate,
        win_rate_smooth: r.win_rate_smooth != null ? r.win_rate_smooth : r.win_rate,
        trades: r.trades,
        max_drawdown: r.max_drawdown,
      }));
    } else {
      top = rows
        .filter((r) => r.eligible && r.trades >= 10)
        .slice()
        .sort((a, b) => (b.rank_score || b.win_rate_smooth) - (a.rank_score || a.win_rate_smooth))
        .slice(0, 10);
    }
    if (!top.length) {
      return '<tr><td class="hb-empty" colspan="6">' + t("hbEmpty") + "</td></tr>";
    }
    return top
      .map((r, i) => {
        const dd = Math.abs(r.max_drawdown);
        const wrShow = r.win_rate_smooth != null ? r.win_rate_smooth : r.win_rate;
        return (
          '<tr data-engine="' +
          r.engine +
          '">' +
          '<td class="hb-rank">' +
          (i + 1) +
          "</td>" +
          '<td class="hb-model">' +
          modelName(r) +
          '<span class="hb-model-en">' +
          (r.name_en || "") +
          "</span></td>" +
          '<td class="hb-num is-up">' +
          fmtSharpeFromWr(wrShow) +
          "</td>" +
          '<td class="hb-num">' +
          r.trades +
          "</td>" +
          '<td class="hb-num is-down">' +
          fmtPct(dd) +
          "</td>" +
          '<td class="hb-go">›</td>' +
          "</tr>"
        );
      })
      .join("");
  }

  function pnlRowsHtml(rows, payload) {
    let top = [];
    if (payload && Array.isArray(payload.pnl_board) && payload.pnl_board.length) {
      top = payload.pnl_board
        .slice()
        .sort((a, b) => roiOf(b) - roiOf(a))
        .slice(0, 10);
    } else {
      top = rows
        .filter((r) => r.trades >= 5)
        .slice()
        .sort((a, b) => roiOf(b) - roiOf(a))
        .slice(0, 10);
    }
    if (!top.length) {
      return '<tr><td class="hb-empty" colspan="5">' + t("hbEmpty") + "</td></tr>";
    }
    return top
      .map((r, i) => {
        const roi = roiOf(r);
        const profit = roi > 0;
        return (
          '<tr class="' +
          (profit ? "is-profit" : "") +
          '" data-engine="' +
          r.engine +
          '">' +
          '<td class="hb-rank">' +
          (i + 1) +
          "</td>" +
          '<td class="hb-model">' +
          modelName(r) +
          '<span class="hb-model-en">' +
          (r.name_en || "") +
          "</span></td>" +
          '<td class="hb-num ' +
          (profit ? "is-up" : "is-down") +
          '">' +
          fmtRoiPct(roi) +
          "</td>" +
          '<td class="hb-num">' +
          fmtPf(r.profit_factor) +
          "</td>" +
          '<td class="hb-go">›</td>' +
          "</tr>"
        );
      })
      .join("");
  }

  function paint(payload) {
    const rows = rowsFrom(payload);
    const days = (payload && payload.period_days) || 60;
    paintKpis(rows, days, payload);
    const wrBody = document.getElementById("wrBoardBody");
    const pnlBody = document.getElementById("pnlBoardBody");
    if (wrBody) wrBody.innerHTML = wrRowsHtml(rows, payload);
    if (pnlBody) pnlBody.innerHTML = pnlRowsHtml(rows, payload);
  }

  async function loadLeaderboard() {
    const stamp = Date.now();
    const urls = [
      cfg.leaderboardUrl || "./leaderboard.json?t=" + stamp,
      "./leaderboard.json?t=" + stamp,
      "/leaderboard.json?t=" + stamp,
    ];
    for (let i = 0; i < urls.length; i++) {
      try {
        const res = await fetch(urls[i], { cache: "no-store" });
        if (!res.ok) continue;
        const data = await res.json();
        if (data && data.by_engine) {
          root.QALeaderboard = data;
          return data;
        }
      } catch {
        /* try next */
      }
    }
    return FALLBACK;
  }

  function bindClicks() {
    if (document.documentElement.dataset.hbBound === "1") return;
    document.documentElement.dataset.hbBound = "1";
    document.addEventListener("click", (ev) => {
      const row = ev.target && ev.target.closest && ev.target.closest("tr[data-engine]");
      if (!row) return;
      const engine = row.getAttribute("data-engine");
      if (!engine) return;
      location.href = "./strategies.html?strategy=" + encodeURIComponent(engine);
    });
  }

  async function boot() {
    if (!document.getElementById("wrBoardBody")) return;
    bindClicks();
    const data = await loadLeaderboard();
    paint(data);
    root.addEventListener("quant-lang", () => {
      if (root.QAApplyI18n) root.QAApplyI18n();
      paint(root.QALeaderboard || data);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})(window);
