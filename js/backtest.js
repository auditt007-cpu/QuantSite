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
  $("sampleHint").textContent = "近 " + (bars.length || 1000) + " 根 K 線累積信號";
  const locked = isMasterSpec(s) || (s && s.id === "ai");
  const gate = $("masterGate");
  if (gate) {
    if (locked) {
      gate.hidden = false;
      const paid = window.QAIdentity && window.QAIdentity.seat() === "vip";
      gate.innerHTML = paid
        ? "大師組可回測，源碼不公開。請聯繫客服獲取指定交易平台接入連結。"
        : '大師組免費可看業績與回測，但不能複製源碼、不能實盤接入。<a href="./member.html#pay">前往會員中心付費開通</a>';
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
        ? "此邏輯由 AI 即時生成，僅在本機回測。不提供 Pine 複製與實盤接入。"
        : "大師組源碼不在網站公開。付費後請聯繫客服，索取指定交易平台的接入配置連結。";
    if (copyBtn) copyBtn.hidden = true;
    if (box) {
      const sum = box.querySelector("summary");
      if (sum) sum.textContent = "源碼鎖定 · 僅提供平台接入";
    }
  } else {
    $("pineSrc").textContent = s.pine || "";
    if (copyBtn) copyBtn.hidden = false;
  }
}

function paintNav(eq, st) {
  const now = eq && eq.length ? eq[eq.length - 1] : START_EQ;
  if ($("navNow")) $("navNow").textContent = t("navNowTpl").replace("{v}", "$" + fmtUsd(now));
  if ($("navPnl")) {
    $("navPnl").textContent = t("navPnlTpl").replace("{v}", fmtSignedPct(st ? st.ret : 0));
    $("navPnl").className = "nav-chip " + (st && st.ret < 0 ? "down" : "up");
  }
  const dd = st ? st.mdd : 0;
  if ($("navDd")) $("navDd").textContent = t("navDdTpl").replace("{v}", (dd * 100).toFixed(1) + "%");
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
  const GM = window.Grademark;
  const eq = GM ? GM.computeEquityCurve(trades, bars, START_EQ) : catalog.equityFrom(bars, trades);
  const ddSeries = GM ? GM.computeDrawdown(eq) : [];
  const st = catalog.performanceOf(trades, eq, catalog.barsPerYear(interval), bars);
  if ($("sampleHint")) $("sampleHint").textContent = t("sampleHintTpl").replace("{n}", String(bars.length));
  paintNav(eq, st);
  if ($("mWr")) $("mWr").textContent = (st.hit * 100).toFixed(1) + "%";
  if ($("mPf")) $("mPf").textContent = fmtPf(st.pf);
  if ($("mTrades")) $("mTrades").textContent = String(st.trades);
  if ($("mBars")) $("mBars").textContent = String(bars.length);
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
  if (dEl && LC && ddSeries.length) {
    if (ddChart) ddChart.remove();
    const ds = chartBoxSize(dEl, 180);
    ddChart = LC.createChart(dEl, feed.chartOptions(dEl, ds.height, interval));
    ddChart.applyOptions({ width: ds.width, height: ds.height });
    addLine(ddChart, "#d0021b").setData(bars.map((b, i) => ({ time: b.time, value: (ddSeries[i] || 0) * 100 })));
    ddChart.timeScale().fitContent();
  }
  scheduleFit();
  if (!silent) toast(t("btDone").replace("{ms}", (performance.now() - t0).toFixed(1)).replace("{n}", String(bars.length)), "ok");
}

$("stratSelect").innerHTML = catalog.list
  .map((s) => {
    const tag = s.tier === "master" ? "[大師組] " : s.id === "ai" ? "[AI] " : "";
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
      toast("此策略源碼不公開複製", "warn");
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
      const tag = s.tier === "master" ? "[大師組] " : s.id === "ai" ? "[AI] " : "";
      return `<option value="${s.id}">${tag}${s.name}</option>`;
    })
    .join("");
}
function boot() {
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
  const startIv = INTERVALS_OK(qIv) ? qIv : "1m";
  load(startIv).catch((e) => toast(e.message, "warn"));
}
function INTERVALS_OK(iv) {
  return ["1s", "1m", "5m", "15m", "1h", "4h", "1d", "1w"].includes(iv);
}
window.QABacktest = {
  open(id, iv) {
    bindDesk();
    refillSelect();
    if (id && catalog.get(id)) engineId = id;
    if ($("stratSelect")) $("stratSelect").value = engineId;
    const startIv = INTERVALS_OK(iv) ? iv : interval || "1h";
    load(startIv).catch((e) => toast(e.message, "warn"));
  },
};
const DEFER = Boolean(document.getElementById("viewList"));
if (!DEFER) {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
}
