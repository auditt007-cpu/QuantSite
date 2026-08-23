(function (root) {
  const cfg = root.QUANT_CONFIG || {};
  const FALLBACK = {
    period_days: 7,
    by_engine: {
      dual: {
        engine: "dual",
        name_zh: "EMA雙均交叉",
        name_en: "EMA Double Cross",
        win_rate: 0.714,
        profit_factor: 2.4,
        max_drawdown: -0.062,
        net_profit_pct: 0.148,
        net_profit_usd: 1480,
        trades: 42,
      },
      ribbon: {
        engine: "ribbon",
        name_zh: "EMA快線交叉",
        name_en: "EMA Fast Cross",
        win_rate: 0.682,
        profit_factor: 2.1,
        max_drawdown: -0.071,
        net_profit_pct: 0.121,
        net_profit_usd: 1210,
        trades: 55,
      },
      squeeze: {
        engine: "squeeze",
        name_zh: "布林擠壓突破",
        name_en: "BB Squeeze Break",
        win_rate: 0.658,
        profit_factor: 1.9,
        max_drawdown: -0.085,
        net_profit_pct: 0.096,
        net_profit_usd: 960,
        trades: 38,
      },
      atr: {
        engine: "atr",
        name_zh: "ATR波動網格",
        name_en: "ATR Volatility Grid",
        win_rate: 0.641,
        profit_factor: 1.8,
        max_drawdown: -0.054,
        net_profit_pct: 0.088,
        net_profit_usd: 880,
        trades: 61,
      },
      rsi: {
        engine: "rsi",
        name_zh: "RSI超賣超買交叉",
        name_en: "RSI Threshold Cross",
        win_rate: 0.623,
        profit_factor: 1.7,
        max_drawdown: -0.079,
        net_profit_pct: 0.072,
        net_profit_usd: 720,
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

  function rowsFrom(payload) {
    const map = (payload && payload.by_engine) || {};
    return Object.keys(map).map((k) => {
      const r = map[k] || {};
      return {
        engine: r.engine || k,
        name_zh: r.name_zh || k,
        name_en: r.name_en || k,
        win_rate: Number(r.win_rate) || 0,
        profit_factor: Number(r.profit_factor) || 0,
        max_drawdown: Number(r.max_drawdown) || 0,
        net_profit_pct: Number(r.net_profit_pct) || 0,
        net_profit_usd: Number(r.net_profit_usd) || 0,
        trades: Number(r.trades) || 0,
      };
    });
  }

  function paintKpis(rows, periodDays) {
    if (!rows.length) return;
    const avgWr = rows.reduce((s, r) => s + r.win_rate, 0) / rows.length;
    const avgPf = rows.reduce((s, r) => s + r.profit_factor, 0) / rows.length;
    const worstDd = Math.min.apply(
      null,
      rows.map((r) => r.max_drawdown),
    );
    const wrEl = document.getElementById("kpiWinVal");
    const ddEl = document.getElementById("kpiDdVal");
    const pfEl = document.getElementById("kpiPfVal");
    if (wrEl) {
      wrEl.textContent = fmtPct(avgWr);
      wrEl.classList.add("is-up");
    }
    if (ddEl) ddEl.textContent = fmtPct(Math.abs(worstDd));
    if (pfEl) {
      pfEl.textContent = fmtPf(avgPf) + ":1";
      if (avgPf >= 1) pfEl.classList.add("is-up");
    }
    const periodLabel = t("hbPeriodTpl").replace("{n}", String(periodDays || 7));
    document.querySelectorAll("#hbWrPeriod, #hbPnlPeriod").forEach((el) => {
      el.textContent = periodLabel;
    });
    const kpiWinLabel = document.querySelector('.home-kpi .kpi [data-i18n="kpiWin"]');
    if (kpiWinLabel) {
      kpiWinLabel.textContent = t("kpiWinTpl").replace("{n}", String(periodDays || 7));
    }
  }

  function wrRowsHtml(rows) {
    const top = rows.slice().sort((a, b) => b.win_rate - a.win_rate).slice(0, 10);
    if (!top.length) {
      return '<tr><td class="hb-empty" colspan="6">' + t("hbEmpty") + "</td></tr>";
    }
    return top
      .map((r, i) => {
        const dd = Math.abs(r.max_drawdown);
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
          fmtPct(r.win_rate) +
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

  function pnlRowsHtml(rows) {
    const top = rows.slice().sort((a, b) => b.net_profit_usd - a.net_profit_usd).slice(0, 10);
    if (!top.length) {
      return '<tr><td class="hb-empty" colspan="5">' + t("hbEmpty") + "</td></tr>";
    }
    return top
      .map((r, i) => {
        const profit = r.net_profit_usd > 0;
        const pnl = r.net_profit_usd
          ? fmtUsd(r.net_profit_usd)
          : (r.net_profit_pct >= 0 ? "+" : "") + fmtPct(r.net_profit_pct);
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
          pnl +
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
    const days = (payload && payload.period_days) || 7;
    paintKpis(rows, days);
    const wrBody = document.getElementById("wrBoardBody");
    const pnlBody = document.getElementById("pnlBoardBody");
    if (wrBody) wrBody.innerHTML = wrRowsHtml(rows);
    if (pnlBody) pnlBody.innerHTML = pnlRowsHtml(rows);
  }

  async function loadLeaderboard() {
    const urls = [
      cfg.leaderboardUrl || "./leaderboard.json",
      "/quantsite/leaderboard.json",
      "./leaderboard.json",
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
      location.href = "./terminal.html?strategy=" + encodeURIComponent(engine);
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
