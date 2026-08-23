const $ = (id) => document.getElementById(id);
const catalog = window.QACatalog;
const feed = window.QAFeed;
const LC = window.LightweightCharts;

function toast(msg, kind) {
  const el = $("toast");
  el.textContent = msg;
  el.className = "toast show " + (kind || "ok");
  setTimeout(() => {
    el.classList.remove("show");
  }, 2200);
}

let SYMBOL = "BTCUSDT";
let interval = "1h";
let engineId = "dual";
let bars = [];
let allBars = [];
let lastCtx = null;
let stream = null;
let candleChart = null;
let equityChart = null;
let candleSeries = null;
let volSeries = null;

function spec() {
  return catalog.get(engineId) || catalog.list[0];
}

function isMasterSpec(s) {
  return Boolean(s && (s.codeLocked || s.tier === "master"));
}

function t(key) {
  if (window.QALang && typeof window.QALang.t === "function") return window.QALang.t(key);
  const lang = localStorage.getItem("quant_lang") || localStorage.getItem("user_lang") || "en";
  const mapped = lang === "zh-Hans" ? "zh-CN" : lang;
  const pack = (window.I18N && (window.I18N[mapped] || window.I18N.en || window.I18N["zh-Hant"])) || {};
  return pack[key] || key;
}

function fmtWhen(ts) {
  const d = new Date(Number(ts) * 1000);
  if (!isFinite(d.getTime())) return "—";
  const p = (n) => String(n).padStart(2, "0");
  return (
    d.getFullYear() +
    "-" +
    p(d.getMonth() + 1) +
    "-" +
    p(d.getDate()) +
    " " +
    p(d.getHours()) +
    ":" +
    p(d.getMinutes()) +
    ":" +
    p(d.getSeconds())
  );
}

function intervalStep(iv) {
  const map = { "1h": 3600, "4h": 14400, "15m": 900, "5m": 300, "1m": 60 };
  return map[iv] || 0;
}

function timeAligned(unix, iv) {
  const step = intervalStep(iv);
  if (!step) return true;
  const ts = Number(unix);
  if (!isFinite(ts)) return false;
  const rem = ((ts % step) + step) % step;
  if (rem === 0) return true;
  const tz = (((-new Date().getTimezoneOffset()) * 60) % step + step) % step;
  return rem === tz;
}

function pnlUsd(n) {
  const v = Number(n);
  if (!isFinite(v)) return "—";
  const cls = v >= 0 ? "pnl up" : "pnl down";
  const sign = v > 0 ? "+" : "";
  return `<span class="${cls}">${sign}${fmtUsd(v)}</span>`;
}

function tradeTableHeadHtml() {
  return (
    `<thead><tr>` +
    `<th>#</th><th>${t("colAction")}</th><th>${t("colTime")}</th>` +
    `<th>${t("colPrice")}</th><th>${t("colPnl")}</th><th>${t("colEquity")}</th>` +
    `</tr></thead>`
  );
}

function singleTradeRowsHtml(tr, eq) {
  const openPx = Number(tr.entry);
  const closePx = Number(tr.exit);
  const eqOpen = eq && eq[tr.i0] != null ? eq[tr.i0] : START_EQ;
  const eqClose = eq && eq[tr.i1] != null ? eq[tr.i1] : START_EQ;
  const openLabel = tr.side === "SHORT" ? "OPEN_SHORT" : "OPEN_LONG";
  return (
    `<tr><td>1</td><td>${openLabel}</td><td>${fmtWhen(tr.t0)}</td><td>${openPx.toFixed(2)}</td><td>—</td><td>${fmtUsd(eqOpen)}</td></tr>` +
    `<tr><td>2</td><td>CLOSE_LONG</td><td>${fmtWhen(tr.t1)}</td><td>${closePx.toFixed(2)}</td><td>${pnlUsd(tr.pnlAbs)}</td><td>${fmtUsd(eqClose)}</td></tr>`
  );
}

function addCandle(chart) {
  const opts = {
    upColor: "#00873c",
    downColor: "#d0021b",
    borderVisible: false,
    wickUpColor: "#00873c",
    wickDownColor: "#d0021b",
  };
  return typeof chart.addCandlestickSeries === "function"
    ? chart.addCandlestickSeries(opts)
    : chart.addSeries(LC.CandlestickSeries, opts);
}

function addHist(chart) {
  const opts = { priceFormat: { type: "volume" }, priceScaleId: "vol" };
  const s =
    typeof chart.addHistogramSeries === "function"
      ? chart.addHistogramSeries(opts)
      : chart.addSeries(LC.HistogramSeries, opts);
  chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
  return s;
}

function addLine(chart, color) {
  return typeof chart.addLineSeries === "function"
    ? chart.addLineSeries({ color, lineWidth: 2 })
    : chart.addSeries(LC.LineSeries, { color, lineWidth: 2 });
}

const START_EQ = 10000;
const BAR_LIMIT = 1000;
const WARMUP_BARS = 250;
let pillEq = null;

function lookbackDays() {
  const n = Number(($("btLookback") || {}).value || 30);
  return isFinite(n) && n > 0 ? n : 30;
}

function barsPerDay(iv) {
  const step = intervalStep(iv);
  return step ? 86400 / step : 24;
}

function fetchLimitForLookback(days, iv) {
  const need = WARMUP_BARS + Math.ceil(days * barsPerDay(iv));
  return Math.min(2000, Math.max(BAR_LIMIT, need));
}

function fmtDateLabel(ts) {
  const d = new Date(Number(ts) * 1000);
  if (!isFinite(d.getTime())) return "—";
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

function buildBacktestContext(sourceBars, lookDays, iv) {
  if (!sourceBars || !sourceBars.length) return null;
  const lastT = sourceBars[sourceBars.length - 1].time;
  const startT = lastT - lookDays * 86400;
  let winIdx = sourceBars.findIndex((b) => b.time >= startT);
  if (winIdx < 0) winIdx = 0;
  const runStart = Math.max(0, winIdx - WARMUP_BARS);
  const runBars = sourceBars.slice(runStart);
  const windowStartT = sourceBars[winIdx].time;
  const winBars = sourceBars.slice(winIdx);
  return {
    runBars,
    winBars,
    runStart,
    winIdx,
    windowStartT,
    windowEndT: lastT,
    windowBarCount: winBars.length,
    windowDays: spanDays(winBars),
    fromLabel: fmtDateLabel(windowStartT),
    toLabel: fmtDateLabel(lastT),
    lookDays,
    tf: iv,
  };
}

function remapWindowTrades(trades, winOffset) {
  return trades
    .filter((tr) => tr.i0 >= winOffset)
    .map((tr) => ({
      ...tr,
      i0: tr.i0 - winOffset,
      i1: tr.i1 - winOffset,
    }));
}

function paintSampleHint(ctx) {
  if (!$("sampleHint") || !ctx) return;
  $("sampleHint").textContent = t("btRangeTpl")
    .replace("{from}", ctx.fromLabel)
    .replace("{to}", ctx.toLabel)
    .replace("{days}", String(ctx.lookDays))
    .replace("{tf}", ctx.tf)
    .replace("{n}", String(ctx.windowBarCount));
}

function fmtUsd(n) {
  return Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtSignedPct(x) {
  const n = Number(x) * 100;
  const sign = n > 0 ? "+" : "";
  return sign + n.toFixed(1) + "%";
}

function paintPine() {
  const s = spec();
  if ($("stratSelect")) $("stratSelect").value = engineId;
  if ($("engineChip") && s) $("engineChip").textContent = s.name || engineId;
  if ($("sampleHint") && !lastCtx) $("sampleHint").textContent = t("btAwaitRun");
  const locked = isMasterSpec(s) || (s && s.id === "ai");
  const gate = $("masterGate");
  if (gate) {
    if (locked) {
      gate.hidden = false;
      const paid = window.QAIdentity && window.QAIdentity.seat() === "vip";
      gate.innerHTML = paid ? t("pineLockedPaid") : t("pineLockedFree");
    } else {
      gate.hidden = true;
      gate.innerHTML = "";
    }
  }
  const box = document.querySelector(".pine-box");
  const copyBtn = $("btnCopyPine");
  if (locked) {
    $("pineSrc").textContent =
      s && s.id === "ai"
        ? t("pineLockedAi")
        : t("pineLockedBody");
    if (copyBtn) copyBtn.hidden = true;
    if (box) {
      const sum = box.querySelector("summary");
      if (sum) sum.textContent = t("pineHead");
    }
  } else {
    $("pineSrc").textContent = s.pine || "";
    if (copyBtn) copyBtn.hidden = false;
  }
}

function spanDays(barList) {
  if (!barList || barList.length < 2) return 14;
  const t0 = Number(barList[0].time);
  const t1 = Number(barList[barList.length - 1].time);
  if (!isFinite(t0) || !isFinite(t1) || t1 === t0) return 14;
  return Math.max(1, Math.round(Math.abs(t1 - t0) / 86400));
}

function isMobile() {
  return window.matchMedia("(max-width: 768px)").matches;
}

function ensureSheetPortal() {
  window.__QA_SHEET_PORTAL = true;
}

function bindSheetUi() {
  ensureSheetPortal();
  bindTradePills();
  if (window.__QA_SHEET_BOUND) return;
  window.__QA_SHEET_BOUND = true;
  document.addEventListener(
    "click",
    (ev) => {
      if (ev.target && ev.target.id === "sheetScrim") {
        ev.preventDefault();
        closeSheet();
        return;
      }
      if (ev.target.closest("#sheetCloseBtn") || ev.target.closest("#sheetDoneBtn")) {
        ev.preventDefault();
        closeSheet();
      }
    },
    true,
  );
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") closeSheet();
  });
}

function openSheet() {
  const sheet = $("resultSheet") || $("moneyCard");
  if (sheet && typeof sheet.scrollIntoView === "function") {
    sheet.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
}

function closeSheet() {
  document.body.classList.remove("sheet-open");
}

function resetBacktestResults() {
  lastCtx = null;
  closeSheet();
  if (candleSeries) candleSeries.setMarkers([]);
  if ($("sampleHint")) $("sampleHint").textContent = t("btAwaitRun");
  if ($("moneyEnd")) $("moneyEnd").textContent = "$10,000.00 → $10,000.00";
  if ($("moneyPnl")) {
    $("moneyPnl").textContent = t("moneyPnlIdle");
    $("moneyPnl").className = "bb-term-pnl";
  }
  if ($("tradePills")) $("tradePills").innerHTML = "";
  pillEq = null;
  if ($("mWr")) $("mWr").textContent = "—";
  if ($("mPf")) $("mPf").textContent = "—";
  if ($("mTrades")) $("mTrades").textContent = "—";
  if ($("mBars")) $("mBars").textContent = "—";
  if ($("navStart")) $("navStart").textContent = "$10,000.00";
  if ($("navNow")) $("navNow").textContent = "$10,000.00";
  if ($("navPnl")) {
    $("navPnl").textContent = "+0.00%";
    $("navPnl").className = "val up";
  }
  if ($("navDd")) {
    $("navDd").textContent = "0.0%";
    $("navDd").className = "val down";
  }
  if ($("navDur")) {
    $("navDur").textContent = t("navDurIdle");
    $("navDur").className = "val";
  }
  if (equityChart) {
    equityChart.remove();
    equityChart = null;
  }
}

function syncDock() {
  const ds = $("dockSymbol");
  const dt = $("dockTf");
  const bs = $("btSymbol");
  const bl = $("btLookback");
  if (ds) ds.value = SYMBOL;
  if (dt) dt.value = interval;
  if (bs) bs.value = SYMBOL;
  if (bl && !bl.value) bl.value = "30";
}

function bindBacktestParams() {
  const bs = $("btSymbol");
  const bl = $("btLookback");
  if (bs && bs.getAttribute("data-bound") !== "1") {
    bs.setAttribute("data-bound", "1");
    bs.addEventListener("change", () => {
      SYMBOL = bs.value || SYMBOL;
      syncDock();
      load(interval).catch((e) => toast(e.message, "warn"));
    });
  }
  if (bl && bl.getAttribute("data-bound") !== "1") {
    bl.setAttribute("data-bound", "1");
    bl.addEventListener("change", () => {
      load(interval).catch((e) => toast(e.message, "warn"));
    });
  }
}

function fmtUsd0(n) {
  return Math.round(Number(n)).toLocaleString("en-US");
}

function tradePillDetailHtml(tr) {
  const eq = pillEq || [];
  return (
    `<div class="trade-pill-table-wrap">` +
    `<table class="trade-pill-table">${tradeTableHeadHtml()}<tbody>${singleTradeRowsHtml(tr, eq)}</tbody></table>` +
    `</div>`
  );
}

function tradePillsHtml(trades) {
  const closed = (trades || []).filter((tr) => !tr.open);
  if (!closed.length) return "";
  return closed
    .map((tr, idx) => {
      const win = Number(tr.pnlAbs) > 0;
      const d = new Date(Number(tr.t1) * 1000);
      const md = isFinite(d.getTime()) ? d.getMonth() + 1 + "/" + d.getDate() : "";
      const usd = fmtUsd0(Math.abs(Number(tr.pnlAbs)));
      const sign = win ? "+" : "-";
      return (
        `<div class="trade-pill-item" data-trade-item="${idx}">` +
        `<button type="button" class="trade-pill ${win ? "up" : "down"}" data-trade-idx="${idx}" aria-expanded="false">` +
        `${sign}$${usd} · ${md}` +
        `</button>` +
        `<div class="trade-pill-detail" id="tradeDetail${idx}" hidden>${tradePillDetailHtml(tr)}</div>` +
        `</div>`
      );
    })
    .join("");
}

function bindTradePills() {
  if (window.__QA_TRADE_PILLS_BOUND) return;
  window.__QA_TRADE_PILLS_BOUND = true;
  document.addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-trade-idx]");
    const host = $("tradePills");
    if (!btn || !host || !host.contains(btn)) return;
    ev.preventDefault();
    ev.stopPropagation();
    const idx = btn.getAttribute("data-trade-idx");
    const detail = host.querySelector(`#tradeDetail${idx}`);
    const item = btn.closest("[data-trade-item]");
    if (!detail) return;
    const wasOpen = btn.getAttribute("aria-expanded") === "true";
    host.querySelectorAll(".trade-pill-detail").forEach((el) => {
      el.hidden = true;
    });
    host.querySelectorAll(".trade-pill[data-trade-idx]").forEach((el) => {
      el.setAttribute("aria-expanded", "false");
      el.classList.remove("open");
    });
    host.querySelectorAll("[data-trade-item]").forEach((el) => el.classList.remove("open"));
    if (!wasOpen) {
      detail.hidden = false;
      btn.setAttribute("aria-expanded", "true");
      btn.classList.add("open");
      if (item) item.classList.add("open");
    }
  });
}

function paintRetail(eq, st, trades, ctx) {
  const end = eq && eq.length ? eq[eq.length - 1] : START_EQ;
  const profit = end - START_EQ;
  const pct = st ? st.ret : 0;
  const days = ctx ? ctx.windowDays : spanDays(bars);
  const sign = profit >= 0 ? "+" : "-";
  if ($("moneyEnd")) $("moneyEnd").textContent = "$" + fmtUsd(START_EQ) + " → $" + fmtUsd(end);
  if ($("moneyPnl")) {
    $("moneyPnl").textContent = t("moneyPnlTpl")
      .replace("{sign}", sign)
      .replace("{amt}", fmtUsd(Math.abs(profit)))
      .replace("{pct}", fmtSignedPct(pct));
    $("moneyPnl").className = "bb-term-pnl " + (profit < 0 ? "down" : "up");
  }
  pillEq = eq;
  if ($("tradePills")) $("tradePills").innerHTML = tradePillsHtml(trades);
  const shareLine = $("shareLine");
  const shareSub = $("shareSub");
  if (shareLine) shareLine.textContent = "$" + fmtUsd0(START_EQ) + " → $" + fmtUsd0(end);
  if (shareSub) shareSub.textContent = fmtSignedPct(pct) + " · " + days + "d";
}

function paintNav(eq, st, ctx) {
  const now = eq && eq.length ? eq[eq.length - 1] : START_EQ;
  const down = !!(st && st.ret < 0);
  const dd = st ? st.mdd : 0;
  const n = ctx ? ctx.windowDays : spanDays(bars);
  if ($("navStart")) $("navStart").textContent = "$" + fmtUsd(START_EQ);
  if ($("navNow")) {
    $("navNow").textContent = "$" + fmtUsd(now);
    if (window.QAUi) window.QAUi.flash($("navNow"), down);
  }
  if ($("navPnl")) {
    $("navPnl").textContent = fmtSignedPct(st ? st.ret : 0);
    $("navPnl").className = "val " + (st && st.ret < 0 ? "down" : "up");
    if (window.QAUi) window.QAUi.flash($("navPnl"), down);
  }
  if ($("navDd")) {
    $("navDd").textContent = (dd * 100).toFixed(1) + "%";
    $("navDd").className = "val down";
    if (window.QAUi) window.QAUi.flash($("navDd"), true);
  }
  if ($("navDur")) {
    $("navDur").textContent = t("navDurTpl").replace("{n}", String(n));
    $("navDur").className = "val accent";
    if (window.QAUi) window.QAUi.flash($("navDur"), false);
  }
}

function chartBoxSize(el, desktopH) {
  const mobile = window.matchMedia("(max-width: 768px)").matches;
  const fallbackH = desktopH || (el && el.id === "candleChart" ? 480 : 220);
  const w = Math.max((el && el.clientWidth) || 0, window.innerWidth - 48, 280);
  if (!mobile) {
    return {
      width: w,
      height: Math.max((el && el.clientHeight) || 0, fallbackH, 220),
    };
  }
  const id = el && el.id;
  if (id === "candleChart") return { width: w, height: 250 };
  return { width: w, height: 180 };
}

function resizeCharts() {
  const cEl = $("candleChart");
  const eEl = $("equityChart");
  if (candleChart && cEl) {
    const s = chartBoxSize(cEl, 480);
    candleChart.applyOptions({ width: s.width, height: s.height });
    candleChart.timeScale().fitContent();
  }
  if (equityChart && eEl) {
    const s = chartBoxSize(eEl, 220);
    equityChart.applyOptions({ width: s.width, height: s.height });
    equityChart.timeScale().fitContent();
  }
}

function scheduleFit() {
  requestAnimationFrame(() => {
    setTimeout(resizeCharts, 100);
  });
}

function setBtLoading(on) {
  const el = $("btLoading");
  if (!el) return;
  el.classList.toggle("show", !!on);
  if (on && el.querySelector("p")) {
    el.querySelector("p").textContent = t("btLoading");
  }
}

function offlineBars(iv) {
  const off = window.QAOffline && window.QAOffline.forInterval(iv || interval);
  return off && off.length ? off.slice() : [];
}

async function load(iv) {
  if (typeof feed.readyGeo === "function") {
    try {
      await feed.readyGeo();
    } catch {
      /* keep current region */
    }
  }
  interval = iv || interval;
  document.querySelectorAll("[data-tf]").forEach((b) => {
    b.classList.toggle("active", b.getAttribute("data-tf") === interval);
  });
  if (stream) stream.close();
  resetBacktestResults();
  setBtLoading(true);
  feed.setFeedStatus($("wsStatus"), "connecting");

  const limit = fetchLimitForLookback(lookbackDays(), interval);
  try {
    allBars = await feed.fetchKlines(SYMBOL, interval, limit);
    bars = allBars;
    feed.lastMeta.source = "live";
    mountCandles();
    paintPine();
    if ($("sampleHint")) $("sampleHint").textContent = t("btAwaitRun");
    feed.setFeedStatus($("wsStatus"), "live");
  } catch {
    allBars = offlineBars(interval);
    bars = allBars;
    feed.lastMeta.source = "offline";
    if (bars.length) {
      mountCandles();
      paintPine();
      feed.setFeedStatus($("wsStatus"), "offline", { updatedAt: feed.lastMeta.updatedAt });
    } else {
      feed.setFeedStatus($("wsStatus"), "retry");
    }
  } finally {
    setBtLoading(false);
  }

  if (!bars.length) {
    toast(t("aiNetErr") || t("needBars") || "K line load failed", "warn");
    return;
  }

  stream = feed.createLiveStream({
    symbol: SYMBOL,
    interval,
    preferRest: feed.lastMeta.source === "offline",
    onStatus(s, extra) {
      feed.setFeedStatus($("wsStatus"), s, extra);
    },
    onKline: upsert,
  });
  syncDock();
}

function upsert(bar) {
  if (!allBars.length || bar.time > allBars[allBars.length - 1].time) allBars.push(bar);
  else if (bar.time === allBars[allBars.length - 1].time) allBars[allBars.length - 1] = bar;
  else return;
  bars = allBars;
  if (!candleSeries) return;
  candleSeries.update({ time: bar.time, open: bar.open, high: bar.high, low: bar.low, close: bar.close });
  volSeries.update({
    time: bar.time,
    value: bar.volume,
    color: bar.close >= bar.open ? "rgba(0,135,60,0.45)" : "rgba(208,2,27,0.45)",
  });
}

function mountCandles() {
  const el = $("candleChart");
  const Charts = window.LightweightCharts;
  if (!el || !Charts || !feed || !bars.length) return;

  const draw = () => {
    const size = chartBoxSize(el, 480);
    const host = $("viewBacktest");
    if (size.width < 80 && host && !host.hidden) {
      requestAnimationFrame(draw);
      return;
    }
    if (candleChart) {
      candleChart.remove();
      candleChart = null;
    }
    candleChart = Charts.createChart(el, feed.chartOptions(el, size.height, interval));
    candleChart.applyOptions({ width: size.width, height: size.height });
    candleSeries = addCandle(candleChart);
    volSeries = addHist(candleChart);
    candleSeries.setData(bars.map((b) => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close })));
    volSeries.setData(
      bars.map((b) => ({
        time: b.time,
        value: b.volume,
        color: b.close >= b.open ? "rgba(0,135,60,0.45)" : "rgba(208,2,27,0.45)",
      })),
    );
    candleChart.timeScale().fitContent();
    scheduleFit();
  };

  requestAnimationFrame(draw);
}

function fmtPf(pf) {
  if (!isFinite(pf)) return pf > 0 ? "∞" : "0.00";
  return pf.toFixed(2);
}

function run(silent) {
  if (!allBars.length) {
    if (!silent) toast(t("needBars") || "請先載入 K 線", "warn");
    return;
  }
  const ctx = buildBacktestContext(allBars, lookbackDays(), interval);
  if (!ctx || !ctx.runBars.length || !ctx.winBars.length) {
    if (!silent) toast(t("needBars") || "請先載入 K 線", "warn");
    return;
  }
  lastCtx = ctx;
  const t0 = performance.now();
  const winOffset = ctx.winIdx - ctx.runStart;
  const rawTrades = spec().run(ctx.runBars);
  const trades = remapWindowTrades(rawTrades, winOffset);
  const winBars = ctx.winBars;
  const GM = window.Grademark;
  const eq = GM ? GM.computeEquityCurve(trades, winBars, START_EQ) : catalog.equityFrom(winBars, trades);
  const st = catalog.performanceOf(trades, eq, catalog.barsPerYear(interval), winBars);
  paintSampleHint(ctx);
  paintNav(eq, st, ctx);
  paintRetail(eq, st, trades, ctx);
  if ($("mWr")) {
    $("mWr").textContent = (st.hit * 100).toFixed(1) + "%";
    if (window.QAUi) window.QAUi.flash($("mWr"), st.hit < 0.5);
  }
  if ($("mPf")) {
    $("mPf").textContent = fmtPf(st.pf);
    const pfCell = $("mPf").closest(".bb-param");
    if (pfCell) pfCell.title = t("statPfHint");
    if (window.QAUi) window.QAUi.flash($("mPf"), !(st.pf > 1));
  }
  if ($("mTrades")) {
    $("mTrades").textContent = String(st.trades);
    if (window.QAUi) window.QAUi.flash($("mTrades"), false);
  }
  if ($("mBars")) {
    $("mBars").textContent = String(ctx.windowBarCount);
    if (window.QAUi) window.QAUi.flash($("mBars"), false);
  }
  if (candleSeries) {
    candleSeries.setMarkers(
      trades.flatMap((tr) => [
        { time: tr.t0, position: "belowBar", color: "#00873c", shape: "arrowUp", text: "BUY" },
        { time: tr.t1, position: "aboveBar", color: "#d0021b", shape: "arrowDown", text: "SELL" },
      ]),
    );
  }
  const eEl = $("equityChart");
  if (equityChart) equityChart.remove();
  const Charts = window.LightweightCharts;
  if (!Charts || !eEl) return;
  const paintEq = () => {
    const size = chartBoxSize(eEl, 220);
    if (size.width < 80) {
      requestAnimationFrame(paintEq);
      return;
    }
    equityChart = Charts.createChart(eEl, feed.chartOptions(eEl, size.height, interval));
    equityChart.applyOptions({ width: size.width, height: size.height });
    addLine(equityChart, "#00873c").setData(winBars.map((b, i) => ({ time: b.time, value: eq[i] })));
    equityChart.timeScale().fitContent();
    scheduleFit();
  };
  requestAnimationFrame(paintEq);
  if (!silent) {
    toast(t("btDone").replace("{ms}", (performance.now() - t0).toFixed(1)).replace("{n}", String(ctx.windowBarCount)), "ok");
    openSheet();
  }
}

function bindDesk() {
  if (window.__QA_DESK_BOUND) return;
  window.__QA_DESK_BOUND = true;
  document.querySelectorAll("[data-tf]").forEach((b) => {
    b.addEventListener("click", () => load(b.getAttribute("data-tf")).catch((e) => toast(e.message)));
  });
  $("btnRun").addEventListener("click", () => run(false));
  $("btnCopyPine").addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (isMasterSpec(spec()) || spec().id === "ai") {
      toast(t("pineCopyDenied"), "warn");
      return;
    }
    const btn = $("btnCopyPine");
    const prev = btn.textContent;
    try {
      if (window.copyToClipboard) {
        await window.copyToClipboard(spec().pine, () => {
          btn.textContent = t("copiedBang");
          toast(t("copyPineOk"), "ok");
          setTimeout(() => {
            btn.textContent = prev;
          }, 2000);
        });
      } else {
        toast(t("copyFail"), "err");
      }
    } catch {
      toast(t("copyFail"), "err");
    }
  });
  window.addEventListener("resize", resizeCharts);
  window.addEventListener("quant-feed-region", () => {
    load(interval).catch((e) => toast(e.message, "warn"));
  });
}
function refillSelect() {}
function boot() {
  bindSheetUi();
  bindBacktestParams();
  bindDesk();
  refillSelect();
  scheduleFit();
  const q = new URLSearchParams(location.search);
  const qIv = q.get("interval");
  const qSt = q.get("strategy") || q.get("engine");
  if (qSt && catalog.get(qSt)) {
    engineId = qSt;
  }
  const startIv = INTERVALS_OK(qIv) ? qIv : "1h";
  load(startIv).catch((e) => toast(e.message, "warn"));
}
function INTERVALS_OK(iv) {
  return ["1s", "1m", "5m", "15m", "1h", "4h", "1d", "1w"].includes(iv);
}
window.QABacktest = {
  setLoading: setBtLoading,
  open(id, iv) {
    const start = () => {
      bindDesk();
      bindBacktestParams();
      refillSelect();
      if (id && catalog.get(id)) engineId = id;
      if ($("stratSelect")) $("stratSelect").value = engineId;
      const startIv = INTERVALS_OK(iv) ? iv : interval || "1h";
      interval = startIv;
      syncDock();
      paintPine();
      resetBacktestResults();
      return load(startIv).catch((e) => toast(e.message, "warn"));
    };
    if (window.QAPackReady) return window.QAPackReady.then(start);
    return start();
  },
};
function revealBacktest() {
  const list = $("viewList");
  const bt = $("viewBacktest");
  if (list) list.hidden = true;
  if (bt) bt.hidden = false;
  document.body.classList.add("desk-open");
  requestAnimationFrame(() => {
    window.dispatchEvent(new Event("resize"));
    setTimeout(() => window.dispatchEvent(new Event("resize")), 120);
  });
}
function bindChrome() {
  if ($("dockRun") && $("dockRun").getAttribute("data-bound") !== "1") {
    $("dockRun").setAttribute("data-bound", "1");
    $("dockRun").addEventListener("click", () => {
      const bt = $("viewBacktest");
      const iv = ($("dockTf") && $("dockTf").value) || "1h";
      if ($("dockSymbol")) SYMBOL = $("dockSymbol").value;
      if (bt && bt.hidden) {
        revealBacktest();
        Promise.resolve(window.QABacktest.open(engineId || "dual", iv));
        return;
      }
      run(false);
    });
  }
  if ($("dockTf") && $("dockTf").getAttribute("data-bound") !== "1") {
    $("dockTf").setAttribute("data-bound", "1");
    $("dockTf").addEventListener("change", () => {
      const iv = $("dockTf").value;
      if ($("viewBacktest") && !$("viewBacktest").hidden) {
        load(iv).catch((e) => toast(e.message));
      } else {
        interval = iv;
      }
    });
  }
  if ($("dockSymbol") && $("dockSymbol").getAttribute("data-bound") !== "1") {
    $("dockSymbol").setAttribute("data-bound", "1");
    $("dockSymbol").addEventListener("change", () => {
      SYMBOL = $("dockSymbol").value;
      if ($("btSymbol")) $("btSymbol").value = SYMBOL;
      if ($("viewBacktest") && !$("viewBacktest").hidden) {
        load(interval).catch((e) => toast(e.message));
      }
    });
  }
  if ($("sheetCloseBtn")) $("sheetCloseBtn").addEventListener("click", closeSheet);
  if ($("sheetDoneBtn")) $("sheetDoneBtn").addEventListener("click", closeSheet);
  if ($("sheetScrim")) $("sheetScrim").addEventListener("click", closeSheet);
  bindSheetUi();
  if ($("shareClose")) {
    $("shareClose").addEventListener("click", () => {
      const ov = $("shareOverlay");
      if (ov) ov.hidden = true;
    });
  }
  syncDock();
}
bindChrome();
const DEFER = Boolean(document.getElementById("viewList"));
if (!DEFER) {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
}
