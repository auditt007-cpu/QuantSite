const $ = (id) => document.getElementById(id);
const catalog = window.QACatalog;
const feed = window.QAFeed;
const LC = window.LightweightCharts;

function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 1800);
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

function paintPine() {
  $("pineSrc").textContent = spec().pine;
  $("btTitle").textContent = spec().name + " · " + SYMBOL + " " + interval.toUpperCase();
  $("stratSelect").value = engineId;
  $("sampleHint").textContent = "近 " + bars.length + " 根 K 線累積信號";
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
  candleChart = LC.createChart(el, feed.chartOptions(el, el.clientHeight || 480));
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
}

async function load(iv) {
  interval = iv || interval;
  document.querySelectorAll("[data-tf]").forEach((b) => {
    b.classList.toggle("active", b.getAttribute("data-tf") === interval);
  });
  if (stream) stream.close();
  feed.setFeedStatus($("wsStatus"), "reconnect");
  bars = await feed.fetchKlines(SYMBOL, interval, 1000);
  mountCandles();
  paintPine();
  stream = feed.createLiveStream({
    symbol: SYMBOL,
    interval,
    onStatus(s) {
      feed.setFeedStatus($("wsStatus"), s);
    },
    onKline: upsert,
  });
}

function fmtPf(pf) {
  if (!isFinite(pf)) return pf > 0 ? "∞" : "0.00";
  return pf.toFixed(2);
}

function run() {
  if (!bars.length) {
    toast("請先載入 K 線");
    return;
  }
  const t0 = performance.now();
  const trades = spec().run(bars);
  const eq = catalog.equityFrom(bars, trades);
  const st = catalog.performanceOf(trades, eq, catalog.barsPerYear(interval));
  $("sampleHint").textContent = "近 " + bars.length + " 根 K 線累積信號";
  $("mRet").textContent = (st.ret * 100).toFixed(2) + "%";
  $("mWr").textContent = (st.wr * 100).toFixed(1) + "%";
  $("mPf").textContent = fmtPf(st.pf);
  $("mDd").textContent = (st.mdd * 100).toFixed(2) + "%";
  $("tradeRows").innerHTML = trades.length
    ? trades
        .map(
          (tr, i) => `<tr>
            <td>${i + 1}</td>
            <td>${tr.side}</td>
            <td>${tr.entry.toFixed(2)}</td>
            <td>${tr.exit.toFixed(2)}</td>
            <td>${tr.pnlPct.toFixed(2)}</td>
          </tr>`,
        )
        .join("")
    : `<tr><td colspan="5" class="muted">此樣本區間無交易</td></tr>`;
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
  equityChart = LC.createChart(eEl, feed.chartOptions(eEl, 220));
  addLine(equityChart, "#2ee59d").setData(bars.map((b, i) => ({ time: b.time, value: eq[i] })));
  equityChart.timeScale().fitContent();
  toast("回測完成 " + (performance.now() - t0).toFixed(1) + " ms · " + bars.length + " 根");
}

$("stratSelect").innerHTML = catalog.list.map((s) => `<option value="${s.id}">${s.name}</option>`).join("");
$("stratSelect").addEventListener("change", () => {
  engineId = $("stratSelect").value;
  paintPine();
});
document.querySelectorAll("[data-tf]").forEach((b) => {
  b.addEventListener("click", () => load(b.getAttribute("data-tf")).catch((e) => toast(e.message)));
});
$("btnRun").addEventListener("click", run);
$("btnCopyPine").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(spec().pine);
    toast("已成功複製至剪貼簿");
  } catch {
    toast("複製失敗");
  }
});
window.addEventListener("resize", () => {
  if (candleChart) candleChart.applyOptions({ width: $("candleChart").clientWidth, height: $("candleChart").clientHeight });
  if (equityChart) equityChart.applyOptions({ width: $("equityChart").clientWidth });
});
load("1m").catch((e) => toast(e.message));
