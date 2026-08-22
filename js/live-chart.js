(function (root) {
  function $(id) {
    return document.getElementById(id);
  }

  function addCandle(chart) {
    const opts = {
      upColor: "#2ee59d",
      downColor: "#ff5a6a",
      borderVisible: false,
      wickUpColor: "#2ee59d",
      wickDownColor: "#ff5a6a",
    };
    if (typeof chart.addCandlestickSeries === "function") return chart.addCandlestickSeries(opts);
    return chart.addSeries(root.LightweightCharts.CandlestickSeries, opts);
  }

  function addHist(chart) {
    const opts = { priceFormat: { type: "volume" }, priceScaleId: "vol" };
    const s =
      typeof chart.addHistogramSeries === "function"
        ? chart.addHistogramSeries(opts)
        : chart.addSeries(root.LightweightCharts.HistogramSeries, opts);
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.78, bottom: 0 } });
    return s;
  }

  function startLiveDesk() {
    const symbol = "BTCUSDT";
    const interval = "1m";
    const engineId = "dual";
    const catalog = root.QACatalog;
    const feed = root.QAFeed;
    let bars = [];
    let chart = null;
    let candle = null;
    let vol = null;
    let stream = null;
    let lastMarkAt = 0;

    function applyMarks() {
      if (!candle || bars.length < 10) return;
      const trades = catalog.get(engineId).run(bars);
      candle.setMarkers(
        trades.flatMap((tr) => [
          { time: tr.t0, position: "belowBar", color: "#2ee59d", shape: "arrowUp", text: "BUY" },
          { time: tr.t1, position: "aboveBar", color: "#ff5a6a", shape: "arrowDown", text: "SELL" },
        ]),
      );
    }

    function upsert(bar) {
      if (!bars.length || bar.time > bars[bars.length - 1].time) bars.push(bar);
      else if (bar.time === bars[bars.length - 1].time) bars[bars.length - 1] = bar;
      else return;
      if (candle) {
        candle.update({ time: bar.time, open: bar.open, high: bar.high, low: bar.low, close: bar.close });
        vol.update({
          time: bar.time,
          value: bar.volume,
          color: bar.close >= bar.open ? "rgba(46,229,157,0.45)" : "rgba(255,90,106,0.45)",
        });
      }
      if ($("lastPx")) $("lastPx").textContent = bar.close.toLocaleString(undefined, { maximumFractionDigits: 2 });
    }

    function mountChart() {
      const el = $("tvChart");
      if (!el) return;
      if (chart) {
        chart.remove();
        chart = null;
      }
      chart = root.LightweightCharts.createChart(el, feed.chartOptions(el, el.clientHeight || 520));
      candle = addCandle(chart);
      vol = addHist(chart);
      candle.setData(bars.map((b) => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close })));
      vol.setData(
        bars.map((b) => ({
          time: b.time,
          value: b.volume,
          color: b.close >= b.open ? "rgba(46,229,157,0.45)" : "rgba(255,90,106,0.45)",
        })),
      );
      chart.timeScale().fitContent();
      applyMarks();
    }

    async function load() {
      feed.setFeedStatus($("wsStatus"), "reconnect");
      if (stream) stream.close();
      bars = await feed.fetchKlines(symbol, interval, 1000);
      mountChart();
      stream = feed.createLiveStream({
        symbol,
        interval,
        onStatus(s) {
          feed.setFeedStatus($("wsStatus"), s);
        },
        onKline(bar) {
          upsert(bar);
          const now = Date.now();
          if (bar.closed || now - lastMarkAt > 2500) {
            lastMarkAt = now;
            applyMarks();
          }
        },
      });
    }

    window.addEventListener("resize", () => {
      if (chart && $("tvChart")) chart.applyOptions({ width: $("tvChart").clientWidth });
    });
    load().catch(() => feed.setFeedStatus($("wsStatus"), "reconnect"));
  }

  root.QALiveDesk = { start: startLiveDesk };
})(typeof window !== "undefined" ? window : globalThis);
