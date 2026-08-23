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
let stream = null;
let candleChart = null;
let equityChart = null;
let ddChart = null;
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

function tradeRowsHtml(trades, eq) {
  if (!trades.length) return `<tr><td colspan="6" class="muted">${t("noTrades")}</td></tr>`;
  const rows = [];
  let n = 0;
  let currentPosition = 0;
  trades.forEach((tr) => {
    const openPx = Number(tr.entry);
    const closePx = Number(tr.exit);
    if (currentPosition === 0) {
      currentPosition = 1;
      n += 1;
      const eqOpen = eq && eq[tr.i0] != null ? eq[tr.i0] : START_EQ;
      timeAligned(tr.t0, interval);
      const openLabel = tr.side === "SHORT" ? "OPEN_SHORT" : "OPEN_LONG";
      rows.push(
        `<tr><td>${n}</td><td>${openLabel}</td><td>${fmtWhen(tr.t0)}</td><td>${openPx.toFixed(2)}</td><td>—</td><td>${fmtUsd(eqOpen)}</td></tr>`,
      );
    }
    if (currentPosition === 1) {
      currentPosition = 0;
      n += 1;
      const eqClose = eq && eq[tr.i1] != null ? eq[tr.i1] : START_EQ;
      timeAligned(tr.t1, interval);
      rows.push(
        `<tr><td>${n}</td><td>CLOSE_LONG</td><td>${fmtWhen(tr.t1)}</td><td>${closePx.toFixed(2)}</td><td>${pnlUsd(tr.pnlAbs)}</td><td>${fmtUsd(eqClose)}</td></tr>`,
      );
    }
  });
  return rows.join("");
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
  $("stratSelect").value = engineId;
  if ($("sampleHint")) $("sampleHint").textContent = t("sampleHintTpl").replace("{n}", String(bars.length || 1000));
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
  if (window.__QA_SHEET_PORTAL) return;
  const scrim = $("sheetScrim");
  const sheet = $("resultSheet");
  if (!scrim || !sheet) return;
  document.body.appendChild(scrim);
  document.body.appendChild(sheet);
  window.__QA_SHEET_PORTAL = true;
}

function bindSheetUi() {
  ensureSheetPortal();
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
  ensureSheetPortal();
  const sheet = $("resultSheet");
  const scrim = $("sheetScrim");
  if (!sheet || !isMobile()) return;
  sheet.classList.add("open");
  sheet.setAttribute("aria-hidden", "false");
  if (scrim) {
    scrim.hidden = false;
    scrim.setAttribute("aria-hidden", "false");
  }
  document.body.classList.add("sheet-open");
  requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
}

function closeSheet() {
  const sheet = $("resultSheet");
  const scrim = $("sheetScrim");
  if (sheet) {
    sheet.classList.remove("open");
    sheet.setAttribute("aria-hidden", "true");
  }
  if (scrim) {
    scrim.hidden = true;
    scrim.setAttribute("aria-hidden", "true");
  }
  document.body.classList.remove("sheet-open");
}

function syncDock() {
  const ds = $("dockSymbol");
  const dt = $("dockTf");
  if (ds) ds.value = SYMBOL;
  if (dt) dt.value = interval;
}

function fmtUsd0(n) {
  return Math.round(Number(n)).toLocaleString("en-US");
}

function tradePillsHtml(trades) {
  const closed = (trades || []).filter((tr) => !tr.open);
  if (!closed.length) return "";
  return closed
    .map((tr) => {
      const win = Number(tr.pnlAbs) > 0;
      const d = new Date(Number(tr.t1) * 1000);
      const md = isFinite(d.getTime()) ? d.getMonth() + 1 + "/" + d.getDate() : "";
      const sign = win ? "+" : "";
      const scale = 1000 / START_EQ;
      const usd = fmtUsd0(Number(tr.pnlAbs) * scale);
      return `<span class="trade-pill ${win ? "up" : "down"}">${win ? "🟢" : "🔴"} ${sign}$${usd} (${md})</span>`;
    })
    .join("");
}

function paintRetail(eq, st, trades) {
  const scale = 1000 / START_EQ;
  const end = eq && eq.length ? eq[eq.length - 1] : START_EQ;
  const end1k = end * scale;
  const profit = (end - START_EQ) * scale;
  const pct = st ? st.ret : 0;
  const days = spanDays(bars);
  const closed = (trades || []).filter((tr) => !tr.open);
  const wins = closed.filter((tr) => Number(tr.pnlAbs) > 0).length;
  const losses = closed.length - wins;
  const wr = closed.length ? wins / closed.length : 0;
  const mdd = st ? st.mdd : 0;
  const riskUsd = Math.abs(mdd) * 1000;
  const sign = profit >= 0 ? "+" : "-";
  if ($("moneyEnd")) $("moneyEnd").textContent = "$1,000 → $" + fmtUsd0(end1k);
  if ($("moneyPnl")) {
    $("moneyPnl").textContent = t("moneyPnlTpl")
      .replace("{sign}", sign)
      .replace("{amt}", fmtUsd0(Math.abs(profit)))
      .replace("{pct}", fmtSignedPct(pct));
    $("moneyPnl").className = "money-pnl" + (profit < 0 ? " down" : "");
  }
  if ($("moneyDays")) $("moneyDays").textContent = t("moneyDaysTpl").replace("{n}", String(days));
  if ($("moneyHit")) {
    $("moneyHit").textContent = t("moneyHitTpl")
      .replace("{pct}", (wr * 100).toFixed(0) + "%")
      .replace("{n}", String(closed.length))
      .replace("{w}", String(wins))
      .replace("{l}", String(losses));
  }
  if ($("moneyRisk")) {
    $("moneyRisk").textContent = t("moneyRiskTpl")
      .replace("{pct}", (mdd * 100).toFixed(1) + "%")
      .replace("{amt}", fmtUsd0(riskUsd));
  }
  if ($("tradePills")) $("tradePills").innerHTML = tradePillsHtml(trades);
  const funnel = $("funnelCard");
  if (funnel) funnel.hidden = !(profit > 0);
  const shareLine = $("shareLine");
  const shareSub = $("shareSub");
  if (shareLine) shareLine.textContent = "$1,000 → $" + fmtUsd0(end1k);
  if (shareSub) shareSub.textContent = fmtSignedPct(pct) + " · " + days + "d";
}

function paintNav(eq, st) {
  const now = eq && eq.length ? eq[eq.length - 1] : START_EQ;
  const down = !!(st && st.ret < 0);
  if ($("navNow")) {
    $("navNow").textContent = t("navNowTpl").replace("{v}", "$" + fmtUsd(now));
    if (window.QAUi) window.QAUi.flash($("navNow"), down);
  }
  if ($("navPnl")) {
    $("navPnl").textContent = t("navPnlTpl").replace("{v}", fmtSignedPct(st ? st.ret : 0));
    $("navPnl").className = "nav-chip " + (st && st.ret < 0 ? "down" : "up");
    if (window.QAUi) window.QAUi.flash($("navPnl"), down);
  }
  const dd = st ? st.mdd : 0;
  if ($("navDd")) {
    $("navDd").textContent = t("navDdTpl").replace("{v}", (dd * 100).toFixed(1) + "%");
    if (window.QAUi) window.QAUi.flash($("navDd"), true);
  }
  if ($("navDur")) {
    const n = spanDays(bars);
    $("navDur").textContent = t("navDurTpl").replace("{n}", String(n));
    $("navDur").className = "nav-chip nav-dur";
    if (window.QAUi) window.QAUi.flash($("navDur"), false);
  }
}

function chartBoxSize(el, desktopH) {
  const mobile = window.matchMedia("(max-width: 768px)").matches;
  const w = Math.max(el.clientWidth || window.innerWidth - 24, 280);
  if (!mobile) return { width: w, height: Math.max(el.clientHeight || desktopH, desktopH) };
  const id = el && el.id;
  if (id === "candleChart") return { width: w, height: 250 };
  if (id === "ddChart") return { width: w, height: 140 };
  return { width: w, height: 180 };
}

function resizeCharts() {
  const cEl = $("candleChart");
  const eEl = $("equityChart");
  const dEl = $("ddChart");
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
  if (ddChart && dEl) {
    const s = chartBoxSize(dEl, 180);
    ddChart.applyOptions({ width: s.width, height: s.height });
    ddChart.timeScale().fitContent();
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

async function fetchBarsWithTimeout(sym, iv, limit, ms) {
  return Promise.race([
    feed.fetchKlines(sym, iv, limit),
    new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms || 9000)),
  ]);
}

function upsert(bar) {
  if (!bars.length || bar.time > bars[bars.length - 1].time) bars.push(bar);
  else if (bar.time === bars[bars.length - 1].time) bars[bars.length - 1] = bar;
  else return;
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
  if (candleChart) {
    candleChart.remove();
    candleChart = null;
  }
  const size = chartBoxSize(el, 480);
  candleChart = LC.createChart(el, feed.chartOptions(el, size.height, interval));
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
}

async function load(iv) {
  interval = iv || interval;
  document.querySelectorAll("[data-tf]").forEach((b) => {
    b.classList.toggle("active", b.getAttribute("data-tf") === interval);
  });
  if (stream) stream.close();
  setBtLoading(true);
  feed.setFeedStatus($("wsStatus"), "connecting");

  const seed = offlineBars(interval);
  if (seed.length) {
    bars = seed;
    feed.lastMeta.source = "offline";
    mountCandles();
    paintPine();
    requestAnimationFrame(() => run(true));
    feed.setFeedStatus($("wsStatus"), "connecting");
  }

  try {
    const live = await fetchBarsWithTimeout(SYMBOL, interval, 420, 9000);
    if (live && live.length) {
      bars = live;
      feed.lastMeta.source = "live";
      mountCandles();
      run(true);
      feed.setFeedStatus($("wsStatus"), "live");
    } else if (!bars.length) {
      throw new Error("empty");
    }
  } catch {
    if (!bars.length) {
      bars = offlineBars(interval);
      feed.lastMeta.source = "offline";
      if (bars.length) {
        mountCandles();
        paintPine();
        run(true);
      }
    }
    if (feed.lastMeta.source === "offline") {
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

  paintPine();
  stream = feed.createLiveStream({
    symbol: SYMBOL,
    interval,
    preferRest: true,
    onStatus(s, extra) {
      feed.setFeedStatus($("wsStatus"), s, extra);
    },
    onKline: upsert,
  });
  syncDock();
}

function fmtPf(pf) {
  if (!isFinite(pf)) return pf > 0 ? "∞" : "0.00";
  return pf.toFixed(2);
}

function run(silent) {
  if (!bars.length) {
    if (!silent) toast(t("needBars") || "請先載入 K 線", "warn");
    return;
  }
  const t0 = performance.now();
  const trades = spec().run(bars);
  const GM = window.Grademark;
  const eq = GM ? GM.computeEquityCurve(trades, bars, START_EQ) : catalog.equityFrom(bars, trades);
  const ddSeries = GM ? GM.computeDrawdown(eq) : [];
  const st = catalog.performanceOf(trades, eq, catalog.barsPerYear(interval), bars);
  if ($("sampleHint")) $("sampleHint").textContent = t("sampleHintTpl").replace("{n}", String(bars.length));
  paintNav(eq, st);
  paintRetail(eq, st, trades);
  if ($("mWr")) {
    $("mWr").textContent = (st.hit * 100).toFixed(1) + "%";
    if (window.QAUi) window.QAUi.flash($("mWr"), st.hit < 0.5);
  }
  if ($("mPf")) {
    $("mPf").textContent = fmtPf(st.pf);
    if (window.QAUi) window.QAUi.flash($("mPf"), !(st.pf > 1));
  }
  if ($("mTrades")) {
    $("mTrades").textContent = String(st.trades);
    if (window.QAUi) window.QAUi.flash($("mTrades"), false);
  }
  if ($("mBars")) {
    $("mBars").textContent = String(bars.length);
    if (window.QAUi) window.QAUi.flash($("mBars"), false);
  }
  if ($("tradeRows")) $("tradeRows").innerHTML = tradeRowsHtml(trades, eq);
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
  const size = chartBoxSize(eEl, 220);
  equityChart = LC.createChart(eEl, feed.chartOptions(eEl, size.height, interval));
  equityChart.applyOptions({ width: size.width, height: size.height });
  addLine(equityChart, "#00873c").setData(bars.map((b, i) => ({ time: b.time, value: eq[i] })));
  equityChart.timeScale().fitContent();
  const dEl = $("ddChart");
  const ddVisible = dEl && window.getComputedStyle(dEl).display !== "none";
  if (dEl && LC && ddSeries.length && ddVisible) {
    if (ddChart) ddChart.remove();
    const ds = chartBoxSize(dEl, 180);
    ddChart = LC.createChart(dEl, feed.chartOptions(dEl, ds.height, interval));
    ddChart.applyOptions({ width: ds.width, height: ds.height });
    addLine(ddChart, "#d0021b").setData(bars.map((b, i) => ({ time: b.time, value: (ddSeries[i] || 0) * 100 })));
    ddChart.timeScale().fitContent();
  }
  scheduleFit();
  if (!silent) {
    toast(t("btDone").replace("{ms}", (performance.now() - t0).toFixed(1)).replace("{n}", String(bars.length)), "ok");
    openSheet();
  }
}

$("stratSelect").innerHTML = catalog.list
  .map((s) => {
    const tag = s.tier === "master" ? "[機構實盤] " : s.id === "ai" ? "[AI] " : "";
    return `<option value="${s.id}">${tag}${s.name}</option>`;
  })
  .join("");
function bindDesk() {
  if (document.getElementById("stratSelect") && document.getElementById("stratSelect").getAttribute("data-bound") === "1") return;
  if ($("stratSelect")) $("stratSelect").setAttribute("data-bound", "1");
  $("stratSelect").addEventListener("change", () => {
    engineId = $("stratSelect").value;
    paintPine();
    run(true);
  });
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
  window.addEventListener("quant-lang", () => {
    if (bars.length) run(true);
  });
}
function refillSelect() {
  if (!$("stratSelect")) return;
  $("stratSelect").innerHTML = catalog.list
    .map((s) => {
      const tag = s.tier === "master" ? "[機構實盤] " : s.id === "ai" ? "[AI] " : "";
      return `<option value="${s.id}">${tag}${s.name}</option>`;
    })
    .join("");
}
function boot() {
  bindSheetUi();
  bindDesk();
  refillSelect();
  scheduleFit();
  const q = new URLSearchParams(location.search);
  const qIv = q.get("interval");
  const qSt = q.get("strategy") || q.get("engine");
  if (qSt && catalog.get(qSt)) {
    engineId = qSt;
    $("stratSelect").value = engineId;
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
      refillSelect();
      if (id && catalog.get(id)) engineId = id;
      if ($("stratSelect")) $("stratSelect").value = engineId;
      const startIv = INTERVALS_OK(iv) ? iv : interval || "1h";
      setBtLoading(true);
      return load(startIv)
        .then(() => {
          run(false);
        })
        .catch((e) => toast(e.message, "warn"))
        .finally(() => setBtLoading(false));
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
  requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
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
        Promise.resolve(window.QABacktest.open(engineId || "dual", iv)).then(() => run(false));
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
      if ($("viewBacktest") && !$("viewBacktest").hidden) {
        load(interval).catch((e) => toast(e.message));
      }
    });
  }
  if ($("sheetCloseBtn")) $("sheetCloseBtn").addEventListener("click", closeSheet);
  if ($("sheetDoneBtn")) $("sheetDoneBtn").addEventListener("click", closeSheet);
  if ($("sheetScrim")) $("sheetScrim").addEventListener("click", closeSheet);
  bindSheetUi();
  if ($("btnShareCard")) {
    $("btnShareCard").addEventListener("click", () => {
      const ov = $("shareOverlay");
      if (ov) ov.hidden = false;
    });
  }
  if ($("shareClose")) {
    $("shareClose").addEventListener("click", () => {
      const ov = $("shareOverlay");
      if (ov) ov.hidden = true;
    });
  }
  const tg = $("funnelTg");
  const cfg = window.QUANT_CONFIG;
  if (tg && cfg && cfg.tgChannelUrl) tg.href = cfg.tgChannelUrl;
  syncDock();
}
bindChrome();
const DEFER = Boolean(document.getElementById("viewList"));
if (!DEFER) {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
}
