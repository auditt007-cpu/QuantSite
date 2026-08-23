(function (root) {
  function $(id) {
    return document.getElementById(id);
  }

  function addCandle(chart) {
    const opts = {
      upColor: "#00873c",
      downColor: "#d0021b",
      borderVisible: false,
      wickUpColor: "#00873c",
      wickDownColor: "#d0021b",
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
          { time: tr.t0, position: "belowBar", color: "#00873c", shape: "arrowUp", text: "BUY" },
          { time: tr.t1, position: "aboveBar", color: "#d0021b", shape: "arrowDown", text: "SELL" },
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
          color: bar.close >= bar.open ? "rgba(0,135,60,0.45)" : "rgba(208,2,27,0.45)",
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
      const sizeH = window.matchMedia("(max-width: 768px)").matches ? 350 : Math.max(el.clientHeight || 520, 400);
      chart = root.LightweightCharts.createChart(el, feed.chartOptions(el, sizeH, interval));
      chart.applyOptions({ width: Math.max(el.clientWidth, 280), height: sizeH });
      candle = addCandle(chart);
      vol = addHist(chart);
      candle.setData(bars.map((b) => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close })));
      vol.setData(
        bars.map((b) => ({
          time: b.time,
          value: b.volume,
          color: b.close >= b.open ? "rgba(0,135,60,0.45)" : "rgba(208,2,27,0.45)",
        })),
      );
      chart.timeScale().fitContent();
      applyMarks();
      if (typeof chart.subscribeCrosshairMove === "function") {
        chart.subscribeCrosshairMove((param) => {
          const line = $("ohlcLine");
          if (!line || !param || !param.seriesData) return;
          const d = param.seriesData.get(candle);
          if (d) line.textContent = `O ${d.open}  H ${d.high}  L ${d.low}  C ${d.close}`;
        });
      }
      setTimeout(() => {
        if (chart && el) {
          chart.applyOptions({ width: Math.max(el.clientWidth, 280), height: sizeH });
          chart.timeScale().fitContent();
        }
      }, 100);
    }

    async function load() {
      feed.setFeedStatus($("wsStatus"), "connecting");
      if (stream) stream.close();
      try {
        bars = await feed.fetchKlines(symbol, interval, 1000);
      } catch {
        bars = (root.QAOffline && root.QAOffline.forInterval(interval)) || [];
        feed.lastMeta.source = "offline";
      }
      mountChart();
      if (feed.lastMeta.source === "offline") {
        feed.setFeedStatus($("wsStatus"), "offline", { updatedAt: feed.lastMeta.updatedAt });
      }
      const last = bars[bars.length - 1];
      if (last && $("lastPx")) $("lastPx").textContent = last.close.toLocaleString(undefined, { maximumFractionDigits: 2 });
      if ($("ohlcLine") && last) $("ohlcLine").textContent = `O ${last.open}  H ${last.high}  L ${last.low}  C ${last.close}`;
      stream = feed.createLiveStream({
        symbol,
        interval,
        preferRest: feed.preferRest || feed.lastMeta.source === "offline",
        onStatus(s, extra) {
          feed.setFeedStatus($("wsStatus"), s, extra);
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
    window.addEventListener("quant-lang", () => {
      if (feed && typeof feed.resetRegion === "function") feed.resetRegion();
      load();
    });
    load();
  }

  root.QALiveDesk = { start: startLiveDesk };
})(typeof window !== "undefined" ? window : globalThis);
