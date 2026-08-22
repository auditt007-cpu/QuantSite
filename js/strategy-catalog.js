(function (root) {
  const I = () => root.QAIndicators;

  function col(bars, key) {
    return bars.map((b) => b[key]);
  }

  function localLows(values, left, right) {
    const idx = [];
    for (let i = left; i < values.length - right; i++) {
      if (values[i] == null) continue;
      let ok = true;
      for (let j = i - left; j <= i + right; j++) {
        if (j === i || values[j] == null) continue;
        if (values[j] <= values[i]) {
          ok = false;
          break;
        }
      }
      if (ok) idx.push(i);
    }
    return idx;
  }

  function runTrades(bars, signalAt) {
    const trades = [];
    let pos = 0;
    let entry = 0;
    let entryI = 0;
    for (let i = 1; i < bars.length; i++) {
      const s = signalAt(i);
      if (pos === 0 && s === 1) {
        pos = 1;
        entry = bars[i].close;
        entryI = i;
      } else if (pos === 1 && s === -1) {
        const px = bars[i].close;
        trades.push({
          side: "LONG",
          entry,
          exit: px,
          pnlPct: ((px - entry) / entry) * 100,
          pnlAbs: px - entry,
          i0: entryI,
          i1: i,
          t0: bars[entryI].time,
          t1: bars[i].time,
        });
        pos = 0;
      }
    }
    if (pos === 1) {
      const last = bars[bars.length - 1];
      trades.push({
        side: "LONG",
        entry,
        exit: last.close,
        pnlPct: ((last.close - entry) / entry) * 100,
        pnlAbs: last.close - entry,
        i0: entryI,
        i1: bars.length - 1,
        t0: bars[entryI].time,
        t1: last.time,
      });
    }
    return trades;
  }

  function equityFrom(bars, trades) {
    const eq = new Array(bars.length).fill(10000);
    let cash = 10000;
    let units = 0;
    let inPos = false;
    const inn = new Map();
    const out = new Map();
    trades.forEach((tr) => {
      inn.set(tr.i0, tr);
      out.set(tr.i1, tr);
    });
    for (let i = 0; i < bars.length; i++) {
      if (inn.has(i) && !inPos) {
        units = cash / bars[i].close;
        cash = 0;
        inPos = true;
      }
      eq[i] = inPos ? units * bars[i].close : cash;
      if (out.has(i) && inPos) {
        cash = units * bars[i].close;
        units = 0;
        inPos = false;
        eq[i] = cash;
      }
    }
    return eq;
  }

  function performanceOf(trades, eq, barsPerYear) {
    const wins = trades.filter((t) => t.pnlAbs > 0);
    const losses = trades.filter((t) => t.pnlAbs < 0);
    const gp = wins.reduce((s, t) => s + t.pnlAbs, 0);
    const gl = Math.abs(losses.reduce((s, t) => s + t.pnlAbs, 0));
    let peak = eq[0] || 10000;
    let mdd = 0;
    for (let i = 0; i < eq.length; i++) {
      if (eq[i] > peak) peak = eq[i];
      const dd = (eq[i] - peak) / peak;
      if (dd < mdd) mdd = dd;
    }
    const rets = [];
    for (let i = 1; i < eq.length; i++) rets.push(eq[i] / eq[i - 1] - 1);
    const m = rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : 0;
    const v = rets.length ? rets.reduce((a, b) => a + (b - m) ** 2, 0) / rets.length : 0;
    const sd = Math.sqrt(v);
    const sharpe = sd === 0 ? 0 : (m / sd) * Math.sqrt(barsPerYear || 365);
    return {
      ret: eq.length ? eq[eq.length - 1] / eq[0] - 1 : 0,
      wr: trades.length ? wins.length / trades.length : 0,
      pf: gl === 0 ? (gp > 0 ? Infinity : 0) : gp / gl,
      mdd,
      sharpe,
      end: eq[eq.length - 1] || 10000,
      trades: trades.length,
    };
  }

  const PINE = {
    dual: `//@version=5
strategy("Dual SuperTrend", overlay=true, initial_capital=10000)
stA = ta.supertrend(3, 10)
stB = ta.supertrend(5, 10)
long = close > stA and close > stB
if long
    strategy.entry("L", strategy.long)
if not long
    strategy.close("L")
`,
    ribbon: `//@version=5
strategy("EMA Ribbon", overlay=true, initial_capital=10000)
e20 = ta.ema(close, 20)
e50 = ta.ema(close, 50)
e200 = ta.ema(close, 200)
plot(e20, color=color.aqua)
plot(e50, color=color.orange)
plot(e200, color=color.gray)
if e20 > e50 and e50 > e200
    strategy.entry("L", strategy.long)
if e20 < e50 or e50 < e200
    strategy.close("L")
`,
    rsi: `//@version=5
strategy("RSI Divergence", overlay=false, initial_capital=10000)
r = ta.rsi(close, 14)
if ta.crossover(r, 30)
    strategy.entry("L", strategy.long)
if ta.crossunder(r, 70)
    strategy.close("L")
`,
    squeeze: `//@version=5
strategy("BB Squeeze Breakout", overlay=true, initial_capital=10000)
[mid, up, lo] = ta.bb(close, 20, 2)
bw = (up - lo) / mid
squeeze = bw == ta.lowest(bw, 20)
if squeeze and close > up
    strategy.entry("L", strategy.long)
if close < mid
    strategy.close("L")
`,
    atr: `//@version=5
strategy("Adaptive ATR Grid", overlay=true, initial_capital=10000)
basis = ta.ema(close, 20)
a = ta.atr(14)
if close < basis - a
    strategy.entry("L", strategy.long)
if close > basis + a
    strategy.close("L")
`,
  };

  const STRATS = [
    {
      id: "dual",
      name: "Dual SuperTrend 趨勢追蹤",
      pine: PINE.dual,
      run(bars) {
        const TA = I();
        const h = col(bars, "high");
        const l = col(bars, "low");
        const c = col(bars, "close");
        const a = TA.calculateSuperTrend(h, l, c, 10, 3);
        const b = TA.calculateSuperTrend(h, l, c, 10, 5);
        return runTrades(bars, (i) => {
          if (a.trend[i] == null || b.trend[i] == null) return 0;
          const long = a.trend[i] === 1 && b.trend[i] === 1;
          const prev = a.trend[i - 1] === 1 && b.trend[i - 1] === 1;
          if (long && !prev) return 1;
          if (!long && prev) return -1;
          return 0;
        });
      },
    },
    {
      id: "ribbon",
      name: "EMA Ribbon 均線多頭共振",
      pine: PINE.ribbon,
      run(bars) {
        const TA = I();
        const c = col(bars, "close");
        const e20 = TA.calculateEMA(c, 20);
        const e50 = TA.calculateEMA(c, 50);
        const e200 = TA.calculateEMA(c, 200);
        return runTrades(bars, (i) => {
          if (e20[i] == null || e50[i] == null || e200[i] == null) return 0;
          const stack = e20[i] > e50[i] && e50[i] > e200[i];
          const was = e20[i - 1] > e50[i - 1] && e50[i - 1] > e200[i - 1];
          if (stack && !was) return 1;
          if (!stack && was) return -1;
          return 0;
        });
      },
    },
    {
      id: "rsi",
      name: "RSI Divergence 頂底背離",
      pine: PINE.rsi,
      run(bars) {
        const TA = I();
        const c = col(bars, "close");
        const r = TA.calculateRSI(c, 14);
        const lows = localLows(c, 3, 3);
        const divAt = new Set();
        for (let k = 1; k < lows.length; k++) {
          const i = lows[k];
          const p = lows[k - 1];
          if (r[i] == null || r[p] == null) continue;
          if (c[i] < c[p] && r[i] > r[p] && r[i] < 40) divAt.add(i);
        }
        return runTrades(bars, (i) => {
          if (r[i] == null || r[i - 1] == null) return 0;
          if (r[i] > 30 && r[i - 1] <= 30) return 1;
          if (divAt.has(i)) return 1;
          if (r[i] < 70 && r[i - 1] >= 70) return -1;
          return 0;
        });
      },
    },
    {
      id: "squeeze",
      name: "Bollinger Squeeze 突破",
      pine: PINE.squeeze,
      run(bars) {
        const TA = I();
        const c = col(bars, "close");
        const bb = TA.calculateBollingerBands(c, 20, 2);
        return runTrades(bars, (i) => {
          if (bb.bandwidth[i] == null || i < 20) return 0;
          let lo = Infinity;
          for (let j = i - 19; j <= i; j++) {
            if (bb.bandwidth[j] != null) lo = Math.min(lo, bb.bandwidth[j]);
          }
          const squeeze = bb.bandwidth[i] === lo;
          if (squeeze && c[i] > bb.upper[i] && c[i - 1] <= bb.upper[i - 1]) return 1;
          if (c[i] < bb.middle[i] && c[i - 1] >= bb.middle[i - 1]) return -1;
          return 0;
        });
      },
    },
    {
      id: "atr",
      name: "Adaptive ATR 動態網格",
      pine: PINE.atr,
      run(bars) {
        const TA = I();
        const h = col(bars, "high");
        const l = col(bars, "low");
        const c = col(bars, "close");
        const basis = TA.calculateEMA(c, 20);
        const a = TA.calculateATR(h, l, c, 14);
        return runTrades(bars, (i) => {
          if (basis[i] == null || a[i] == null || a[i - 1] == null) return 0;
          if (c[i] < basis[i] - a[i] && c[i - 1] >= basis[i - 1] - a[i - 1]) return 1;
          if (c[i] > basis[i] + a[i] && c[i - 1] <= basis[i - 1] + a[i - 1]) return -1;
          return 0;
        });
      },
    },
  ];

  root.QACatalog = {
    list: STRATS,
    get(id) {
      return STRATS.find((s) => s.id === id) || STRATS[0];
    },
    runTrades,
    equityFrom,
    performanceOf,
    barsPerYear(interval) {
      const map = { "1s": 365 * 24 * 3600, "1m": 365 * 24 * 60, "5m": 365 * 24 * 12, "15m": 365 * 24 * 4, "1h": 365 * 24, "4h": 365 * 6, "1d": 365, "1w": 52 };
      return map[interval] || 365;
    },
  };
})(typeof window !== "undefined" ? window : globalThis);
