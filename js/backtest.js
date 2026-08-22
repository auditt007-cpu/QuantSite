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

const SYMBOL = "BTCUSDT";
let interval = "1m";
let engineId = "dual";
let bars = [];
let stream = null;
let candleChart = null;
let equityChart = null;
let candleSeries = null;
let volSeries = null;

function spec() {
  return catalog.get(engineId);
}

function t(key) {
  const lang = localStorage.getItem("quant_lang") || "zh-Hant";
  const pack = (window.I18N && (window.I18N[lang] || window.I18N["zh-Hant"])) || {};
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
    p(d.getMinutes())
  );
}

function pnlCell(pct) {
  const n = Number(pct);
  const cls = n >= 0 ? "pnl up" : "pnl down";
  const sign = n > 0 ? "+" : "";
  return `<span class="${cls}">${sign}${n.toFixed(2)}%</span>`;
}

function tradeRowsHtml(trades) {
  if (!trades.length) return `<tr><td colspan="5" class="muted">${t("noTrades")}</td></tr>`;
  const rows = [];
  let n = 0;
  trades.forEach((tr) => {
    const openLabel = tr.side === "SHORT" ? t("actShort") : t("actLong");
    n += 1;
    rows.push(
      `<tr><td>${n}</td><td>${openLabel}</td><td>${Number(tr.entry).toFixed(2)}</td><td>${fmtWhen(tr.t0)}</td><td>—</td></tr>`,
    );
    n += 1;
    rows.push(
      `<tr><td>${n}</td><td>${t("actExit")}</td><td>${Number(tr.exit).toFixed(2)}</td><td>${fmtWhen(tr.t1)}</td><td>${pnlCell(tr.pnlPct)}</td></tr>`,
    );
  });
  return rows.join("");
}

function addCandle(chart) {
  const opts = {
    upColor: "#2ee59d",
    downColor: "#ff5a6a",
    borderVisible: false,
    wickUpColor: "#2ee59d",
    wickDownColor: "#ff5a6a",
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
  $("pineSrc").textContent = spec().pine;
  $("stratSelect").value = engineId;
  $("sampleHint").textContent = "近 " + (bars.length || 1000) + " 根 K 線累積信號";
}

function paintNav(eq, st) {
  const now = eq && eq.length ? eq[eq.length - 1] : START_EQ;
  $("navNow").textContent = "當前淨值: $" + fmtUsd(now) + " USDT";
  $("navPnl").textContent = "累計淨利: " + fmtSignedPct(st ? st.ret : 0);
  $("navPnl").className = "nav-chip " + (st && st.ret < 0 ? "down" : "up");
  const dd = st ? st.mdd : 0;
  $("navDd").textContent = "最大回撤: " + (dd * 100).toFixed(1) + "%";
}

function chartBoxSize(el, desktopH) {
  const mobile = window.matchMedia("(max-width: 768px)").matches;
  const w = Math.max(el.clientWidth || window.innerWidth - 24, 280);
  const h = mobile ? 350 : Math.max(el.clientHeight || desktopH, desktopH);
  return { width: w, height: h };
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

function upsert(bar) {
  if (!bars.length || bar.time > bars[bars.length - 1].time) bars.push(bar);
  else if (bar.time === bars[bars.length - 1].time) bars[bars.length - 1] = bar;
  else return;
  if (!candleSeries) return;
  candleSeries.update({ time: bar.time, open: bar.open, high: bar.high, low: bar.low, close: bar.close });
  volSeries.update({
    time: bar.time,
    value: bar.volume,
    color: bar.close >= bar.open ? "rgba(46,229,157,0.45)" : "rgba(255,90,106,0.45)",
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
      color: b.close >= b.open ? "rgba(46,229,157,0.45)" : "rgba(255,90,106,0.45)",
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
  feed.setFeedStatus($("wsStatus"), "connecting");
  try {
    bars = await feed.fetchKlines(SYMBOL, interval, 1000);
  } catch {
    bars = (window.QAOffline && window.QAOffline.forInterval(interval)) || [];
    feed.lastMeta.source = "offline";
  }
  mountCandles();
  if (feed.lastMeta.source === "offline") {
    feed.setFeedStatus($("wsStatus"), "offline", { updatedAt: feed.lastMeta.updatedAt });
  }
  paintPine();
  stream = feed.createLiveStream({
    symbol: SYMBOL,
    interval,
    preferRest: feed.preferRest || feed.lastMeta.source === "offline",
    onStatus(s, extra) {
      feed.setFeedStatus($("wsStatus"), s, extra);
    },
    onKline: upsert,
  });
  run(true);
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
  const eq = catalog.equityFrom(bars, trades);
  const st = catalog.performanceOf(trades, eq, catalog.barsPerYear(interval));
  $("sampleHint").textContent = "近 " + bars.length + " 根 K 線累積信號";
  paintNav(eq, st);
  $("mWr").textContent = (st.wr * 100).toFixed(1) + "%";
  $("mPf").textContent = fmtPf(st.pf);
  $("mTrades").textContent = String(st.trades);
  $("mBars").textContent = String(bars.length);
  $("tradeRows").innerHTML = tradeRowsHtml(trades);
  if (candleSeries) {
    candleSeries.setMarkers(
      trades.flatMap((tr) => [
        { time: tr.t0, position: "belowBar", color: "#2ee59d", shape: "arrowUp", text: "BUY" },
        { time: tr.t1, position: "aboveBar", color: "#ff5a6a", shape: "arrowDown", text: "SELL" },
      ]),
    );
  }
  const eEl = $("equityChart");
  if (equityChart) equityChart.remove();
  const size = chartBoxSize(eEl, 220);
  equityChart = LC.createChart(eEl, feed.chartOptions(eEl, size.height, interval));
  equityChart.applyOptions({ width: size.width, height: size.height });
  addLine(equityChart, "#2ee59d").setData(bars.map((b, i) => ({ time: b.time, value: eq[i] })));
  equityChart.timeScale().fitContent();
  scheduleFit();
  if (!silent) toast("回測完成 " + (performance.now() - t0).toFixed(1) + " ms · " + bars.length + " 根");
}

$("stratSelect").innerHTML = catalog.list.map((s) => `<option value="${s.id}">${s.name}</option>`).join("");
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
  try {
    await navigator.clipboard.writeText(spec().pine);
    toast("已成功複製至剪貼簿");
  } catch {
    toast("複製失敗");
  }
});
window.addEventListener("resize", resizeCharts);
window.addEventListener("quant-lang", () => {
  if (bars.length) run(true);
});
function boot() {
  scheduleFit();
  const retry = $("btnFeedRetry");
  const node = $("btnFeedNode");
  if (retry) retry.onclick = () => {
    feed.preferRest = false;
    load(interval).catch((e) => toast(e.message, "warn"));
  };
  if (node) node.onclick = () => {
    feed.preferRest = true;
    load(interval).catch((e) => toast(e.message, "warn"));
  };
  load("1m").catch((e) => toast(e.message, "warn"));
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
