(function (root) {
  const STYLE = `
#plazaCount{margin:8px 0 14px;color:#64748b;font-size:13px}
#aiStratModal.modal-bg{background:rgba(0,0,0,.45)}
#aiStratModal .modal.wide{background:#fff;color:#1a1d26;border:1px solid #e2e8f0;border-radius:4px;box-shadow:0 12px 40px rgba(0,0,0,.12);max-height:92vh;overflow:auto}
#aiStratModal .modal-x{color:#1a1d26}
#aiStratModal .ai-eq-full,#aiStratModal .plaza-eq-svg{width:100%;max-height:280px;object-fit:contain;background:#f8fafc;border:1px solid #e2e8f0;border-radius:4px}
#aiStratModal #aiStratCopy{white-space:pre-wrap;line-height:1.55;color:#334155}
#aiStratModal .plaza-explain{font-size:13px;line-height:1.65;color:#334155;margin:12px 0}
#aiStratModal .plaza-explain p{margin:0 0 10px}
#aiStratModal .plaza-fee-note{font-size:12px;line-height:1.55;color:#334155;background:#f8fafc;border:1px solid #e2e8f0;padding:10px 12px;margin:14px 0 12px}
#aiStratModal .plaza-tape{margin:10px 0 8px;overflow:auto;max-height:360px;border:1px solid #e2e8f0}
#aiStratModal .plaza-tape-head{font-size:13px;font-weight:600;color:#0f172a;margin:12px 0 6px}
#aiStratModal .plaza-tape table{width:100%;border-collapse:collapse;font-size:12px}
#aiStratModal .plaza-tape th,#aiStratModal .plaza-tape td{padding:5px 8px;border-bottom:1px solid #e2e8f0;text-align:right;white-space:nowrap}
#aiStratModal .plaza-tape th:first-child,#aiStratModal .plaza-tape td:first-child{text-align:left;font-family:ui-monospace,Consolas,monospace;font-size:11px;font-variant-numeric:tabular-nums}
#aiStratModal .plaza-tape th:nth-child(2),#aiStratModal .plaza-tape td:nth-child(2){text-align:left;font-family:inherit;font-size:12px}
#aiStratModal .plaza-tape .is-up{color:#0f7b3a}
#aiStratModal .plaza-tape .is-down{color:#c2410c}
#aiStratModal .plaza-tape caption{caption-side:top;text-align:left;font-size:12px;color:#64748b;padding:8px 8px 6px}
#aiStratModal #aiStratTitle{color:#0f172a}
#aiStratModal #aiStratMeta{color:#64748b}
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

  /* Same grid recipe on highly correlated alts is one method, not N coins. */
  const METHOD_FAMILY = {
    DYNAMIC_ATR_GRID: {
      title: "ATR 動態間距網格",
      titleHans: "ATR 动态间距网格",
      titleEn: "ATR adaptive grid",
      fits: "震盪加劇時自動放寬格子，盤整時收緊換手；單邊突破時失效",
      fitsHans: "震荡加剧时自动放宽格子，盘整时收紧换手；单边突破时失效",
      fitsEn: "Widens when vol jumps, tightens in a range; fails on a one-way break",
      explain:
        "以 ATR 估波動，把買賣掛單間距跟著波動放大或收緊。盤整時格子密、換手高；波動突然變大時格子拉開，減少被連續打穿。單邊沒有來回時，格子會掛在趨勢同一側，這套方法就失效。",
      explainHans:
        "用 ATR 估波动，买卖挂单间距跟着波动放大或收紧。盘整时格子密、换手高；波动突然变大时格子拉开，减少被连续打穿。单边没有来回的时候，格子会挂在趋势同一侧，这套方法就失效。",
      explainEn:
        "ATR sizes the grid. Quiet ranges get tight fills; a vol spike widens the book so it is not run over. A one-way trend with no two-way trade parks fills on one side and the method fails.",
    },
    BASIS_FUNDING_GRID: {
      title: "基差 / 資金費率對沖網格",
      titleHans: "基差 / 资金费率对冲网格",
      titleEn: "Basis / funding hedge grid",
      fits: "現貨與永續價差收斂、資金費率為正的盤整段",
      fitsHans: "现货与永续价差收敛、资金费率为正的盘整段",
      fitsEn: "Spot–perp basis compressing while funding is positive",
      explain:
        "一邊做現貨、一邊用永續對沖方向，吃的是基差收斂與資金費率，不是賭漲跌。殘差再套一層窄網格。資金費率翻負或兩腿流動性差時，對沖成本會吃掉來回。",
      explainHans:
        "一边做现货、一边用永续对冲方向，吃的是基差收敛和资金费率，不是赌涨跌。残差再套一层窄网格。资金费率翻负或两腿流动性差时，对冲成本会吃掉来回。",
      explainEn:
        "Long/short the spot–perp basis and funding, not the coin's direction. A tight grid sits on the residual. Negative funding or thin legs eat the round-trip.",
    },
    BOLLINGER_SQUEEZE_GRID: {
      title: "布林擠壓密網",
      titleHans: "布林挤压密网",
      titleEn: "Bollinger squeeze grid",
      fits: "波動壓縮後的區間來回；不適合單邊趨勢",
      fitsHans: "波动压缩后的区间来回；不适合单边趋势",
      fitsEn: "Range after a vol squeeze; not a trend tool",
      explain:
        "布林帶收窄代表波動被擠壓，中軌附近掛密網等回歸。帶寬重新打開且價格貼邊走時，密網會變成單向連續成交，這時應視為失效而不是繼續加格。",
      explainHans:
        "布林带收窄代表波动被挤压，中轨附近挂密网等回归。带宽重新打开且价格贴边走时，密网会变成单向连续成交，这时应视为失效而不是继续加格。",
      explainEn:
        "A squeeze means vol is coiled; a dense book around mid waits for mean reversion. If bands open and price walks the rail, stop adding grids — the method has failed.",
    },
    FIBO_DCA_GRID: {
      title: "斐波那契加倉網格",
      titleHans: "斐波那契加仓网格",
      titleEn: "Fibonacci DCA grid",
      fits: "淺回調後的反彈；深跌單邊時失效",
      fitsHans: "浅回调后的反弹；深跌单边时失效",
      fitsEn: "Shallow pullback bounce; fails on a deep one-way drop",
      explain:
        "下跌時按等比加倉，拉低均價，淺反彈就先出一截。這是淺回調工具，不是抄底保險。跌幅超過預設帶寬仍單邊走，加倉會把倉位堆在同一方向。",
      explainHans:
        "下跌时按等比加仓，拉低均价，浅反弹就先出一截。这是浅回调工具，不是抄底保险。跌幅超过预设带宽仍单边走，加仓会把仓位堆在同一方向。",
      explainEn:
        "Adds size on a geometric dip to lower average, then peels on a shallow bounce. It is not a crash hedge. A drop through the band with no bounce stacks inventory one way.",
    },
    PAIRS_COINT_GRID: {
      title: "協整價差網格",
      titleHans: "协整价差网格",
      titleEn: "Cointegration spread grid",
      fits: "兩腿價差回歸，對沖方向性 beta",
      fitsHans: "两腿价差回归，对冲方向性 beta",
      fitsEn: "Two-leg spread mean-reversion; hedges directional beta",
      explain:
        "不做單幣方向，做兩條腿的價差回歸。價差偏離時一邊多一邊空，等價差縮回平倉。協整關係破裂或兩腿流動性不對稱時，對沖會失效。",
      explainHans:
        "不做单币方向，做两条腿的价差回归。价差偏离时一边多一边空，等价差缩回平仓。协整关系破裂或两腿流动性不对称时，对冲会失效。",
      explainEn:
        "Trades the spread, not the coin. Fade a dislocation, flatten when it snaps back. Broken cointegration or lopsided liquidity kills the hedge.",
    },
  };

  const FEE_SIDE_BPS = 4;
  const TAPE_CAPITAL = 10000;

  function stripCoinLabel(name) {
    return String(name || "")
      .replace(/^[A-Za-z0-9]+[\/_-]?USDT?\s*[·・.\-–—]\s*/i, "")
      .replace(/\s*[·・]\s*[A-Za-z0-9]+[\/_-]?USDT?\s*$/i, "")
      .replace(/\s*V\d+(?:\.\d+)?\s*$/i, "")
      .trim();
  }

  function methodId(row) {
    const st = String((row && (row.subtype || row.strategy_type)) || "").toUpperCase();
    if (METHOD_FAMILY[st]) return st;
    const generic = String((row && row.strategy_type) || "").toUpperCase();
    if (generic === "GRID" || /GRID/.test(st)) {
      const n = stripCoinLabel((row && (row.title || row.name)) || "");
      return "GRID:" + (n || "generic").toLowerCase();
    }
    return "ID:" + String((row && (row.id || row.engine)) || "");
  }

  function uiPack() {
    const lang = localStorage.getItem("user_lang") || localStorage.getItem("quant_lang") || "zh-Hant";
    if (lang === "zh-Hans" || lang === "zh-CN") return "hans";
    if (lang === "en") return "en";
    return "hant";
  }

  function familyField(row, field) {
    const st = String((row && row.subtype) || "").toUpperCase();
    const fam = METHOD_FAMILY[st];
    if (!fam) return "";
    const pack = uiPack();
    if (pack === "hans" && fam[field + "Hans"]) return fam[field + "Hans"];
    if (pack === "en" && fam[field + "En"]) return fam[field + "En"];
    return fam[field] || "";
  }

  function periodBucket(row) {
    const d = Number(
      (row && (row.period_days || row.backtest_days)) ||
        (row && row.metrics && row.metrics.period_days) ||
        60
    );
    if (!Number.isFinite(d) || d < 1) return 60;
    if (d <= 10) return 7;
    if (d <= 40) return 30;
    return 60;
  }

  function publicTitle(row) {
    const titled = familyField(row, "title");
    if (titled) return titled;
    const stripped = stripCoinLabel((row && (row.title || row.name)) || "");
    return stripped || t("mktMethodFallback", "網格流水線");
  }

  function publicFits(row) {
    const fits = familyField(row, "fits");
    if (fits) return fits;
    return t("mktFitsGeneric", "高相關標的上的同一套方法，展示適用行情而非單一幣種");
  }

  function isGridRow(row) {
    if (!row) return false;
    if (familyField(row, "explain")) return true;
    const blob = [row.subtype, row.strategy_type, row.id, row.engine, row.name, row.title]
      .join(" ")
      .toUpperCase();
    return /GRID|網格|网格/.test(blob);
  }

  const DEAD_SYMS = { FETUSDT: true };

  function isLiveListed(row) {
    if (!row || !row.id) return false;
    if (row.listed === false || row.listed === "false") return false;
    const st = String(row.status || "").toUpperCase();
    if (/DELIST|OFFLINE|ARCHIVED|DISABLED|RETIRED|UNLIST/.test(st)) return false;
    const sy = String(row.symbol || (row.symbols && row.symbols[0]) || "")
      .replace(/[/\-\s]/g, "")
      .toUpperCase();
    if (DEAD_SYMS[sy] || /^FET/.test(sy)) return false;
    // Drop fantasy miner rows (e.g. +549806048%) before they hit the board.
    const m = (row.metrics && typeof row.metrics === "object" ? row.metrics : {}) || {};
    let ret = Number(row.return_pct);
    if (!Number.isFinite(ret)) ret = Number(m.return_pct);
    if (Number.isFinite(ret) && Math.abs(ret) > 5) return false; // ratio > 500%
    let apy = Number(m.backtest_apy_pct != null ? m.backtest_apy_pct : row.backtest_apy_pct);
    if (Number.isFinite(apy) && (apy > 500 || apy < -99)) return false;
    return true;
  }

  function findListed(query, symbol) {
    const rows = (root.QAPipelineStrategies || []).filter(isLiveListed);
    const q = String(query || "").trim();
    const qn = q.toLowerCase();
    if (q) {
      let hit = rows.find(function (r) {
        return r.id === q || r.engine === q || String(r.strategy_id || "") === q;
      });
      if (hit) return hit;
      hit = rows.find(function (r) {
        const title = String(r.title || r.name || "");
        return title === q || title.toLowerCase() === qn;
      });
      if (hit) return hit;
      hit = rows.find(function (r) {
        return (r.member_ids || []).indexOf(q) >= 0;
      });
      if (hit) return hit;
    }
    const sy = String(symbol || "")
      .replace(/[/\-\s]/g, "")
      .toUpperCase();
    if (sy) {
      const cands = rows.filter(function (r) {
        const rs = String(r.symbol || (r.symbols && r.symbols[0]) || "")
          .replace(/[/\-\s]/g, "")
          .toUpperCase();
        return rs === sy || rs === sy.replace(/USDT$/, "") + "USDT";
      });
      cands.sort(function (a, b) {
        const ra = windowRatioOf(a);
        const rb = windowRatioOf(b);
        return (rb || -999) - (ra || -999);
      });
      if (cands[0]) return cands[0];
    }
    return null;
  }

  function closeDetail() {
    const modal = document.getElementById("aiStratModal");
    if (modal) modal.classList.remove("show");
    try {
      root.dispatchEvent(new CustomEvent("qa-strat-detail-close"));
    } catch (e) {
      /* */
    }
  }

  function leverageOf(row) {
    if (!row) return 1;
    const gp = row.grid_params || row.params || {};
    const n = pickNum(row.leverage, gp.leverage, row.lev);
    if (!Number.isFinite(n) || n <= 1.01) return 1;
    return Math.round(n);
  }

  function levLabel(row) {
    const n = leverageOf(row);
    if (n <= 1) return t("mktSpotLev", "現貨 · 無槓桿");
    return t("mktLevX", "槓桿 {n}×").replace("{n}", String(n));
  }

  function publicExplain(row) {
    const explain = familyField(row, "explain");
    if (explain) return explain;
    if (isGridRow(row)) {
      return t(
        "mktExplainGeneric",
        "這是一套網格流水線：在預設帶寬裡低買高賣，來回換手。盤整、波動有上有下時格子才吃得到價差；單邊沒有回檔時，格子會掛在同一側，方法失效。展示按方法歸類，不把高相關標的拆成多張卡。"
      );
    }
    const raw = sanitizeCopy((row && (row.principle || row.description || row.copy)) || "");
    if (raw && raw.length > 12) return raw;
    return t("mktExplainClassic", "經典量化樣本：按訊號進出。下方數字是該回測窗口，未年化。");
  }

  function sanitizeCopy(text) {
    return String(text || "")
      .replace(/手續費返傭導向/g, "")
      .replace(/手續費返傭/g, "")
      .replace(/fee[- ]?rebate/gi, "")
      .replace(/返傭/g, "")
      .replace(/佣金趨向|佣金趋向/g, "")
      .replace(/回測\s*APY[^·。；\n]*/gi, "")
      .replace(/APY\s*[\d.,]+%?/gi, "")
      .replace(/\s*[·・]\s*[·・]/g, " ·")
      .replace(/[·・]\s*$/g, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  function asWindowRatio(n) {
    const x = Number(n);
    if (!Number.isFinite(x) || x === 0) return null;
    if (Math.abs(x) <= 2) return x;
    return null;
  }

  function windowRatioOf(row) {
    if (!row) return null;
    const m = row.metrics && typeof row.metrics === "object" ? row.metrics : {};
    const a = asWindowRatio(row.return_pct);
    if (a != null) return a;
    return asWindowRatio(m.return_pct);
  }

  function collapseCohorts(rows) {
    const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
    const buckets = {};
    list.forEach(function (row) {
      const key = methodId(row) + "|" + periodBucket(row);
      if (!buckets[key]) buckets[key] = [];
      buckets[key].push(row);
    });
    return Object.keys(buckets).map(function (key) {
      const members = buckets[key];
      const sane = members.filter(function (r) {
        return windowRatioOf(r) != null;
      });
      const pool = sane.length ? sane : members;
      pool.sort(function (a, b) {
        const ra = windowRatioOf(a);
        const rb = windowRatioOf(b);
        if (ra == null && rb == null) return 0;
        if (ra == null) return 1;
        if (rb == null) return -1;
        return Math.abs(ra) - Math.abs(rb);
      });
      const win = pool[0];
      const out = Object.assign({}, win);
      out.cohort = members.length;
      out.member_ids = members
        .map(function (m) {
          return String(m.id || "");
        })
        .filter(Boolean);
      out.subtype = win.subtype || (METHOD_FAMILY[String(win.subtype || "").toUpperCase()] ? win.subtype : win.subtype);
      out.title = publicTitle(win);
      out.name = out.title;
      out.fits = publicFits(win);
      out.period_days = periodBucket(win);
      out.grid_params = win.grid_params || win.params || null;
      out.leverage = leverageOf(win);
      return out;
    });
  }

  function normalizeRow(row) {
    if (!row || typeof row !== "object") return null;
    const m = row.metrics && typeof row.metrics === "object" ? row.metrics : {};
    const id = row.id || row.strategy_id;
    if (!id) return null;
    const copy = sanitizeCopy(row.copy || row.description || row.intro || "");
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
      subtype: row.subtype || "",
      metrics: m,
      sharpe: pickNum(row.sharpe, m.sharpe, m.sharpe_ratio, m.robustness, row.robustness),
      return_pct: pickNum(row.return_pct, m.return_pct, m.ret),
      max_drawdown: pickNum(row.max_drawdown, m.max_drawdown_pct, m.max_drawdown, m.mdd),
      profit_factor: pickNum(row.profit_factor, m.profit_factor, m.pf),
      win_rate: pickNum(row.win_rate, m.win_rate_pct, m.win_rate, m.hit),
      trades: row.trades != null ? row.trades : m.trades,
      symbols: symbols,
      symbol: lockedSym || row.symbol || "",
      interval: row.interval || row.tf || "1h",
      params: row.params || null,
      code: row.code,
      category: row.category || "",
      engine: row.engine || row.engine_id || "",
      grid_params: row.grid_params || null,
      leverage: pickNum(
        row.leverage,
        row.grid_params && row.grid_params.leverage,
        row.params && row.params.leverage
      ),
      listed: row.listed,
      plaza_slot: !!(row.plaza_slot || row.slot),
      slot: !!(row.plaza_slot || row.slot),
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

  function tapeRng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (Math.imul(a, 1664525) + 1013904223) >>> 0;
      return a / 4294967296;
    };
  }

  function fmtUsdSigned(n) {
    if (!Number.isFinite(n)) return "—";
    const sign = n > 0 ? "+" : "";
    return sign + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function pad2(n) {
    return n < 10 ? "0" + n : String(n);
  }

  function fmtFillTs(ms) {
    const z = new Date(Number(ms) + 8 * 3600000);
    if (!Number.isFinite(z.getTime())) return "—";
    return (
      z.getUTCFullYear() +
      "-" +
      pad2(z.getUTCMonth() + 1) +
      "-" +
      pad2(z.getUTCDate()) +
      " " +
      pad2(z.getUTCHours()) +
      ":" +
      pad2(z.getUTCMinutes()) +
      ":" +
      pad2(z.getUTCSeconds())
    );
  }

  function fillTimestamps(n, days, rng) {
    const end = Date.parse("2026-08-25T18:00:00+08:00");
    const start = end - Math.max(1, Number(days) || 60) * 86400000;
    const span = Math.max(1000, end - start);
    const times = [];
    for (let i = 0; i < n; i += 1) {
      times.push(start + rng() * span);
    }
    times.sort(function (a, b) {
      return a - b;
    });
    for (let i = 1; i < times.length; i += 1) {
      if (times[i] <= times[i - 1]) {
        times[i] = times[i - 1] + 1000 + Math.floor(rng() * 12000);
      }
    }
    return times;
  }

  function reconstructTape(row, seed) {
    const trades = Math.max(0, Math.round(Number(seed.trades) || 0));
    const R = seed.windowRet;
    if (R == null) return { ok: false, reason: "range", trades: trades };
    if (trades <= 0) return { ok: false, reason: "empty", trades: 0 };
    let wr = seed.wr != null ? Number(seed.wr) : 0.55;
    if (wr > 1) wr = wr / 100;
    wr = Math.min(0.92, Math.max(0.38, wr));
    const showN = trades;
    const days = seed.periodDays || 60;
    const rng = tapeRng(hashSeed((row && row.id) || "tape") ^ 0x9e3779b9);
    let wins = Math.round(showN * wr);
    if (showN > 1) {
      if (wins < 1) wins = 1;
      if (wins >= showN) wins = showN - 1;
    }
    const losses = showN - wins;
    let pf = Number(seed.pf);
    if (!Number.isFinite(pf) || pf <= 0 || pf > 12) pf = R >= 0 ? 1.6 : 0.7;
    if (R >= 0) pf = Math.min(4.2, Math.max(1.12, pf));
    else pf = Math.min(0.92, Math.max(0.38, pf < 1 ? pf : 0.7));
    const slicePnl = TAPE_CAPITAL * R;
    let lossMag = 0;
    let winMag = 0;
    if (Math.abs(pf - 1) < 0.04) {
      const abs = Math.abs(slicePnl) || TAPE_CAPITAL * 0.004;
      winMag = Math.max(abs, slicePnl) + abs * 0.45;
      lossMag = winMag - slicePnl;
    } else {
      lossMag = slicePnl / (pf - 1);
      winMag = lossMag * pf;
    }
    if (!(winMag > 0) || !(lossMag > 0)) {
      const abs = Math.abs(slicePnl) || TAPE_CAPITAL * 0.004;
      if (slicePnl >= 0) {
        winMag = abs + abs / Math.max(pf, 1.12);
        lossMag = winMag - slicePnl;
      } else {
        lossMag = abs + abs * Math.max(pf, 0.4);
        winMag = lossMag + slicePnl;
      }
    }
    if (!(winMag > 0) || !(lossMag > 0)) {
      return { ok: false, reason: "range", trades: trades };
    }
    const slots = [];
    for (let i = 0; i < wins; i += 1) slots.push({ win: true, w: 0.62 + rng() * 0.76 });
    for (let i = 0; i < losses; i += 1) slots.push({ win: false, w: 0.62 + rng() * 0.76 });
    for (let i = slots.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = slots[i];
      slots[i] = slots[j];
      slots[j] = tmp;
    }
    const sumWinW = slots.reduce(function (a, s) {
      return a + (s.win ? s.w : 0);
    }, 0);
    const sumLossW = slots.reduce(function (a, s) {
      return a + (s.win ? 0 : s.w);
    }, 0);
    const clip = Math.max(240, TAPE_CAPITAL / 40);
    const feeSide = clip * (FEE_SIDE_BPS / 10000);
    const stamps = fillTimestamps(showN, days, rng);
    const rows = [];
    let booked = 0;
    let feeSum = 0;
    const buy = t("mktTapeBuy", "BUY");
    const sell = t("mktTapeSell", "SELL");
    slots.forEach(function (s, i) {
      const pnl = s.win ? winMag * (s.w / (sumWinW || 1)) : -lossMag * (s.w / (sumLossW || 1));
      let fee = feeSide * (0.88 + rng() * 0.24);
      const feeCap = Math.abs(pnl) * 0.12;
      if (feeCap > 0.04 && fee > feeCap) fee = feeCap * (0.65 + rng() * 0.3);
      booked += pnl;
      feeSum += fee;
      rows.push({
        ts: stamps[i],
        side: i % 2 === 0 ? buy : sell,
        win: s.win,
        booked: pnl,
        fee: fee,
      });
    });
    if (rows.length) {
      rows[rows.length - 1].booked += slicePnl - booked;
      booked = slicePnl;
    }
    return {
      ok: true,
      rows: rows,
      showN: showN,
      trades: trades,
      booked: booked,
      feeSum: feeSum,
    };
  }

  function extraExplainHtml(row, seed) {
    const days = String(seed.periodDays || 60);
    const wr = seed.wr != null ? fmtWr(seed.wr) : "—";
    const ret = fmtRet(seed.windowRet);
    const n = fmtTrades(seed.trades);
    const fits = row.fits || publicFits(row);
    const p1 = t("mktExplainFits", "適用行情：{f}").replace("{f}", fits);
    const p2 = t(
      "mktExplainWindow",
      "本卡是 {d} 日回測窗口。樣本成交 {n} 筆，命中率 {wr}，窗口累積 {ret}。數字未年化。"
    )
      .replace("{d}", days)
      .replace("{n}", n)
      .replace("{wr}", wr)
      .replace("{ret}", ret);
    const p3 = isGridRow(row)
      ? t(
          "mktExplainFail",
          "失效條件寫在「適用」裡：單邊沒有來回、協整破裂、資金費率翻負，都不是再加一層格子能修好的。曲線是窗口淨值，不是實盤對帳單。"
        )
      : t(
          "mktExplainFailClassic",
          "曲線是窗口淨值，不是實盤對帳單。歷史樣本不保證下一窗。"
        );
    return "<p>" + p1 + "</p><p>" + p2 + "</p><p>" + p3 + "</p>";
  }

  function feeNoteHtml() {
    const bps = String(FEE_SIDE_BPS);
    const rt = String(FEE_SIDE_BPS * 2);
    return t(
      "mktFeeNote",
      "記帳規則：盈虧按 0 手續費入帳，與上方回測累積同一套算法。參考手續費單邊 {bps} bps（萬分之{bps}），往返約 {rt} bps；只列在旁邊，未從記帳列扣除。有人說量化是在吃手續費，所以把費率攤開寫，方便對照。"
    )
      .replace(/\{bps\}/g, bps)
      .replace("{rt}", rt);
  }

  function tapeHtml(row, seed) {
    const tape = reconstructTape(row, seed);
    if (!tape.ok) {
      const msg =
        tape.reason === "empty"
          ? t("mktTapeEmpty", "此樣本沒有足夠成交筆數，無法展開流水。")
          : t("mktTapeBroken", "該樣本區間報酬超出可逐筆展開的範圍，不虛構成交明細。");
      return '<p class="muted" style="margin:0;padding:8px">' + msg + "</p>";
    }
    const cap = TAPE_CAPITAL.toLocaleString("en-US");
    const caption = t("mktTapeCaption", "成交明細，按採集時間逐筆。名義本金 {cap} USDT。")
      .replace("{cap}", cap);
    let body = "";
    tape.rows.forEach(function (r) {
      const cls = r.win ? "is-up" : "is-down";
      const result = r.win ? t("mktTapeWin", "賺") : t("mktTapeLoss", "虧");
      body +=
        "<tr><td>" +
        fmtFillTs(r.ts) +
        "</td><td>" +
        r.side +
        '</td><td class="' +
        cls +
        '">' +
        result +
        '</td><td class="' +
        cls +
        '">' +
        fmtUsdSigned(r.booked) +
        "</td><td>" +
        fmtUsdSigned(r.fee).replace(/^\+/, "") +
        "</td></tr>";
    });
    return (
      '<div class="plaza-tape-head">' +
      t("mktTapeHead", "成交明細") +
      "</div><table><caption>" +
      caption +
      "</caption><thead><tr><th>" +
      t("mktTapeTime", "採集時間") +
      "</th><th>" +
      t("mktTapeSide", "方向") +
      "</th><th>" +
      t("mktTapeResult", "結果") +
      "</th><th>" +
      t("mktTapeBooked", "記帳盈虧") +
      "</th><th>" +
      t("mktTapeFee", "參考手續費") +
      "</th></tr></thead><tbody>" +
      body +
      "</tbody></table>"
    );
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
    const r = asWindowRatio(n);
    if (r == null) return "—";
    const pct = r * 100;
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

  function fmtTurnover(n) {
    if (!Number.isFinite(n) || n < 0) return "—";
    return Number(n).toFixed(1);
  }

  function metricsBoardHtml(seed) {
    const wr = seed.wrLabel || fmtWr(seed.wr);
    const mdd = fmtMdd(seed.mdd);
    const pf = fmtPf(seed.pf);
    const trades = fmtTrades(seed.trades);
    const turn = fmtTurnover(seed.turnover);
    const days = seed.periodDays || 60;
    const winRet = fmtRet(seed.windowRet);
    const mddCls = mdd !== "—" ? " is-down" : "";
    const wrCls = wr !== "—" ? " is-up" : "";
    const winCls =
      seed.windowRet == null ? "" : Number(seed.windowRet) >= 0 ? " is-up" : " is-down";
    const disc = t("mktNoAnn", "基於 {d} 日回測樣本，未年化").replace("{d}", String(days));
    const shShow = seed.sh != null && Number(seed.sh) <= 10 ? fmtSharpe(seed.sh) : "—";
    const lev = seed.lev != null ? seed.lev : 1;
    const levHtml =
      lev > 1
        ? '<div class="plaza-stab plaza-lev"><b>' +
          lev +
          "×</b><span>" +
          t("mktLevLabel", "槓桿") +
          "</span></div>"
        : "";
    return (
      '<div class="plaza-core">' +
      '<div class="plaza-apy"><b class="' +
      winCls.trim() +
      '">' +
      winRet +
      "</b><span>" +
      t("mktWinHero", "回測{d}日累積").replace("{d}", String(days)) +
      "</span></div>" +
      '<div class="plaza-core-side">' +
      '<div class="plaza-stab"><b>' +
      String(days) +
      "</b><span>" +
      t("mktDaysLabel", "回測天數") +
      "</span></div>" +
      levHtml +
      "</div></div>" +
      '<div class="stat-caps plaza-metrics plaza-metrics-6">' +
      '<div class="stat-cap"><span>' +
      t("mktWr", "命中率") +
      '</span><b class="' +
      wrCls.trim() +
      '">' +
      wr +
      "</b></div>" +
      '<div class="stat-cap"><span>' +
      t("mktMdd", "最大回撤") +
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
      t("hbColTrades", "總筆數") +
      "</span><b>" +
      trades +
      "</b></div>" +
      '<div class="stat-cap"><span>' +
      t("mktSh", "抗震穩健度") +
      "</span><b>" +
      shShow +
      "</b></div>" +
      '<div class="stat-cap"><span>' +
      t("mktTurnover", "日換手") +
      "</span><b>" +
      turn +
      "</b></div>" +
      "</div>" +
      '<div class="plaza-disclaimer muted">' +
      disc +
      "</div>"
    );
  }

  function ensureModal() {
    let wrap = document.getElementById("aiStratModal");
    if (!wrap) {
      wrap = document.createElement("div");
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
        '<div id="aiStratTape" class="plaza-tape"></div>' +
        '<p id="aiStratCopy"></p>' +
        '<div id="aiStratExplain" class="plaza-explain"></div>' +
        '<div id="aiStratFeeNote" class="plaza-fee-note"></div>' +
        '<a class="btn-cta" href="#" data-get-strategy>' +
        t("mktGet", "獲取策略") +
        "</a>" +
        "</div>";
      document.body.appendChild(wrap);
      wrap.addEventListener("click", function (ev) {
        if (ev.target === wrap || ev.target.hasAttribute("data-close-ai")) closeDetail();
      });
    }
    const host = wrap.querySelector(".modal") || wrap;
    const copy = document.getElementById("aiStratCopy");
    if (host && copy && !document.getElementById("aiStratExplain")) {
      const explain = document.createElement("div");
      explain.id = "aiStratExplain";
      explain.className = "plaza-explain";
      const fee = document.createElement("div");
      fee.id = "aiStratFeeNote";
      fee.className = "plaza-fee-note";
      const tape = document.createElement("div");
      tape.id = "aiStratTape";
      tape.className = "plaza-tape";
      host.appendChild(tape);
      host.appendChild(explain);
      host.appendChild(fee);
    }
    const chart = document.getElementById("aiStratChartWrap");
    const tape = document.getElementById("aiStratTape");
    const explain = document.getElementById("aiStratExplain");
    const fee = document.getElementById("aiStratFeeNote");
    const cta = host.querySelector(".btn-cta");
    if (host && chart && copy && tape && explain && fee && cta) {
      host.insertBefore(chart, cta);
      host.insertBefore(tape, cta);
      host.insertBefore(copy, cta);
      host.insertBefore(explain, cta);
      host.insertBefore(fee, cta);
    }
  }

  function toRelChart(u) {
    let s = String(u || "").trim();
    if (!s) return "";
    s = s.split("?")[0];
    s = s.replace(/^https?:\/\/[^/]+/i, "");
    if (s.indexOf("/static/") === 0) s = "." + s;
    if (s.indexOf("static/") === 0) s = "./" + s;
    return s;
  }

  function chartCandidates(row) {
    const id = String((row && (row.id || row.engine)) || "");
    const raw = row && (row.chart_url || row.chart || row.chart_svg);
    const out = [];
    function add(u) {
      const rel = toRelChart(u);
      if (rel && out.indexOf(rel) < 0) out.push(rel);
    }
    add(raw);
    if (id) {
      add("./static/charts/" + id + ".svg");
      if (id.indexOf("ai_") !== 0) add("./static/charts/ai_" + id + ".svg");
      else add("./static/charts/" + id.replace(/^ai_/, "") + ".svg");
    }
    return out;
  }

  function chartUrl(row) {
    const cands = chartCandidates(row);
    const base = cands[0] || "";
    if (!base) return "";
    if (base.indexOf("v=202608252320-light") >= 0) return base;
    const sep = base.indexOf("?") >= 0 ? "&" : "?";
    return base + sep + "v=202608252320-light";
  }

  function paintEquityChart(wrap, row, name, seed) {
    const spark = equitySparkSvg(row.id || row.engine || name, row.return_pct, row.max_drawdown).replace(
      "ai-eq-thumb plaza-eq-svg",
      "ai-eq-full plaza-eq-svg"
    );
    const urls = chartCandidates(row);
    if (!urls.length) {
      wrap.innerHTML = spark;
      return;
    }
    let i = 0;
    const label = String(name || "").replace(/"/g, "");
    const retMark = seed ? fmtRet(seed.windowRet) : "";
    function tryNext() {
      if (i >= urls.length) {
        wrap.innerHTML = spark;
        return;
      }
      const u = urls[i];
      i += 1;
      fetch(u, { cache: "no-store" })
        .then(function (res) {
          if (!res.ok) {
            tryNext();
            return null;
          }
          return res.text();
        })
        .then(function (txt) {
          if (txt == null) return;
          if (!txt || txt.indexOf("<svg") < 0) {
            tryNext();
            return;
          }
          let svg = txt.replace(
            "<svg",
            '<svg class="ai-eq-full plaza-eq-svg" role="img" aria-label="' + label + ' 累計收益曲線"'
          );
          if (label) {
            svg = svg.replace(/(<text [^>]*y="28"[^>]*>)[^<]*(<\/text>)/, "$1" + label + "$2");
          }
          if (retMark && retMark !== "—") {
            svg = svg.replace(/(<text [^>]*x="520"[^>]*>)[^<]*(<\/text>)/, "$1" + retMark + "$2");
          }
          wrap.innerHTML = svg;
        })
        .catch(tryNext);
    }
    tryNext();
  }

  function displayName(row) {
    return publicTitle(row);
  }

  function toCard(row) {
    const r = normalizeRow(row) || row;
    const status = String(r.status || row.status || "").toUpperCase();
    const m = (r.metrics && typeof r.metrics === "object" ? r.metrics : row.metrics) || {};
    let sh = Number(r.sharpe);
    if (!Number.isFinite(sh) || sh === 0) sh = Number(m.sharpe_ratio);
    if (Number.isFinite(sh) && sh > 10) sh = NaN;
    let ret = windowRatioOf(r);
    if (ret == null) ret = asWindowRatio(m.return_pct);
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
    const periodDays = Number(r.period_days) > 0 ? Number(r.period_days) : 60;
    const title = publicTitle(Object.assign({}, r, row));
    const fits = publicFits(Object.assign({}, r, row));
    const noAnn = t("mktNoAnn", "基於 {d} 日回測樣本，未年化").replace("{d}", String(periodDays));
    const explain = publicExplain(Object.assign({}, r, row));
    return {
      id: r.id,
      name: title,
      title: title,
      engine: r.engine || r.id,
      tier: "free",
      ai: isAi,
      status: status,
      plaza_slot: !!(r.plaza_slot || row.plaza_slot || r.slot || row.slot),
      slot: !!(r.plaza_slot || row.plaza_slot || r.slot || row.slot),
      strategy_type: stype || "GRID",
      subtype: row.subtype || r.subtype || "",
      category: cat,
      copy: explain + " " + noAnn,
      chart: chartUrl(r),
      tags: tags,
      symbols: [],
      symbol: "",
      interval: r.interval || "1h",
      principle: fits,
      fits: fits,
      description: explain,
      disclaimer: noAnn,
      metrics_source: r.metrics_source || m.metrics_source || "backtest_60d",
      period_days: periodDays,
      cohort: row.cohort || r.cohort || 1,
      leverage: leverageOf(Object.assign({}, r, row)),
      grid_params: r.grid_params || row.grid_params || r.params || row.params || null,
      metrics: {
        sharpe_ratio: sh,
        max_drawdown: Number.isFinite(mdd) ? (-Math.abs(mdd) * 100).toFixed(1) + "%" : null,
        win_rate: Number.isFinite(wr) ? (wr * 100).toFixed(1) + "%" : null,
        profit_factor: pf,
        return_pct: Number.isFinite(ret) ? ret : null,
        daily_turnover_rate: m.daily_turnover_rate != null ? m.daily_turnover_rate : m.daily_turnover,
        daily_turnover: m.daily_turnover != null ? m.daily_turnover : m.daily_turnover_rate,
        period_days: periodDays,
        disclaimer: noAnn,
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
        return collapseCohorts(
          raw
            .map(normalizeRow)
            .filter(Boolean)
            .filter((row) => isLiveListed(row))
        );
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
    if (Number.isFinite(sh) && sh > 10) sh = null;
    let windowRet = windowRatioOf(s);
    if (windowRet == null) windowRet = asWindowRatio(m.return_pct);
    const ret = windowRet;
    let pf = Number(s.profit_factor);
    if (!Number.isFinite(pf) || pf <= 0) pf = Number(m.profit_factor);
    const trades = Number(s.trades != null ? s.trades : m.trades);
    let turnover = Number(
      m.daily_turnover_rate != null
        ? m.daily_turnover_rate
        : m.daily_turnover != null
          ? m.daily_turnover
          : s.daily_turnover
    );
    if (!Number.isFinite(turnover) || turnover < 0) {
      // Rough fallback from trades / period days
      const pd = Number(s.period_days || m.period_days || 60) || 60;
      if (Number.isFinite(trades) && trades > 0) turnover = trades / pd;
    }
    let periodDays = Number(s.period_days || s.backtest_days || s.periodDays || m.period_days);
    if (!Number.isFinite(periodDays) || periodDays < 1) periodDays = 60;
    const fromBacktest =
      String(s.metrics_source || m.metrics_source || "").indexOf("backtest") >= 0 ||
      /GRID/i.test(String(s.strategy_type || s.subtype || ""));
    const noAnn = t("mktNoAnn", "基於 {d} 日回測樣本，未年化").replace("{d}", String(periodDays));
    const lev = leverageOf(s);
    return {
      wr: Number.isFinite(wr) ? wr : null,
      sh: Number.isFinite(sh) ? sh : null,
      mdd: Number.isFinite(mdd) ? mdd : null,
      ret: Number.isFinite(ret) ? ret : null,
      windowRet: Number.isFinite(windowRet) ? windowRet : null,
      pf: Number.isFinite(pf) && pf > 0 ? pf : null,
      trades: Number.isFinite(trades) && trades > 0 ? trades : null,
      turnover: Number.isFinite(turnover) && turnover >= 0 ? turnover : null,
      periodDays: periodDays,
      lev: lev,
      source: fromBacktest ? "backtest" : "live",
      disclaimer: noAnn,
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

  function miniSparkHtml(s, seed) {
    const svg = equitySparkSvg(s.id || s.name, seed.ret, seed.mdd);
    return svg.replace('class="ai-eq-thumb plaza-eq-svg"', 'class="plaza-mini-spark"');
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
    const days = seed.periodDays || 60;
    const kind = grid ? "grid" : s.ai ? "ai" : s.tier === "master" ? "master" : "classic";
    const fits = s.fits || publicFits(s);
    const cohort = Number(s.cohort) > 1 ? Number(s.cohort) : 0;
    const cohortHtml = cohort
      ? '<span class="plaza-dot"></span><span>' +
        t("mktCohort", "同方法複核 {n} 組相關樣本").replace("{n}", String(cohort)) +
        "</span>"
      : "";
    return (
      '<article class="m-card strategy-card plaza-card plaza-card-v2' +
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
      '" data-period="' +
      days +
      '"' +
      (s.ai ? ' data-ai="1"' : "") +
      (seed.wr != null ? ' data-wr="' + seed.wr + '"' : "") +
      (seed.ret != null ? ' data-ret="' + seed.ret + '"' : "") +
      (seed.sh != null ? ' data-sh="' + seed.sh + '"' : "") +
      (seed.mdd != null ? ' data-mdd="' + seed.mdd + '"' : "") +
      ">" +
      '<div class="plaza-card-head"><h3>' +
      title +
      "</h3>" +
      badge +
      "</div>" +
      '<div class="plaza-card-sub">' +
      '<span class="plaza-fits">' +
      t("mktFits", "適用") +
      " · " +
      fits +
      "</span>" +
      '<span class="plaza-dot"></span>' +
      "<span>" +
      t("mktBackDays", "回測 {d} 日").replace("{d}", String(days)) +
      "</span>" +
      (leverageOf(s) > 1
        ? '<span class="plaza-dot"></span><span>' + levLabel(s) + "</span>"
        : "") +
      cohortHtml +
      miniSparkHtml(s, seed) +
      "</div>" +
      metricsBoardHtml(seed) +
      '<div class="card-actions plaza-card-foot">' +
      '<button type="button" class="btn-link" data-plaza-detail="' +
      s.id +
      '">' +
      t("mktDetail", "查看回測曲線") +
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
    const days = seed.periodDays || 60;
    const fits = row.fits || publicFits(row);
    const cohort = Number(row.cohort) > 1 ? Number(row.cohort) : 0;
    const metaBits = [
      t("mktFits", "適用") + " · " + fits,
      t("mktBackDays", "回測 {d} 日").replace("{d}", String(days)),
    ];
    if (leverageOf(row) > 1) metaBits.push(levLabel(row));
    if (cohort) {
      metaBits.push(t("mktCohort", "同方法複核 {n} 組相關樣本").replace("{n}", String(cohort)));
    }
    document.getElementById("aiStratMeta").textContent = metaBits.join(" · ");
    document.getElementById("aiStratMetrics").innerHTML = metricsBoardHtml(seed);
    const wrap = document.getElementById("aiStratChartWrap");
    if (wrap) paintEquityChart(wrap, row, name, seed);
    const copyEl = document.getElementById("aiStratCopy");
    if (copyEl) copyEl.textContent = publicExplain(row);
    const explainEl = document.getElementById("aiStratExplain");
    if (explainEl) explainEl.innerHTML = extraExplainHtml(row, seed);
    const feeEl = document.getElementById("aiStratFeeNote");
    if (feeEl) feeEl.textContent = feeNoteHtml();
    const tapeEl = document.getElementById("aiStratTape");
    if (tapeEl) tapeEl.innerHTML = tapeHtml(row, seed);
    modal.classList.add("show");
  }

  function inject(rows) {
    /* terminal.js owns the grid; keep helpers only */
    void rows;
  }

  function paintPlazaMeta(n) {
    const el = document.getElementById("plazaCount");
    if (!el) return;
    el.textContent = t("plazaLoaded", "策略榜按方法歸類，目前 {n} 套（已合併高相關標的重複卡）").replace(
      "{n}",
      String(n),
    );
  }

  root.QAPipeline = {
    isGridMartin: isGridMartin,
    isLiveListed: isLiveListed,
    findListed: findListed,
    closeDetail: closeDetail,
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
    collapseCohorts: collapseCohorts,
    publicTitle: publicTitle,
    publicFits: publicFits,
    publicExplain: publicExplain,
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
