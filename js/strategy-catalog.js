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

  function fillPrice(bars, i) {
    const bar = bars[i];
    if (!bar) return 0;
    return Number(bar.close);
  }

  function runTrades(bars, signalAt) {
    const trades = [];
    let currentPosition = 0;
    let entry = 0;
    let entryI = 0;
    for (let i = 1; i < bars.length; i++) {
      const s = signalAt(i);
      if (currentPosition === 0 && s === 1) {
        currentPosition = 1;
        entry = fillPrice(bars, i);
        entryI = i;
      } else if (currentPosition === 1 && s === -1) {
        const px = fillPrice(bars, i);
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
        currentPosition = 0;
      }
    }
    if (currentPosition === 1) {
      const lastI = bars.length - 1;
      const px = fillPrice(bars, lastI);
      trades.push({
        side: "LONG",
        entry,
        exit: px,
        pnlPct: ((px - entry) / entry) * 100,
        pnlAbs: px - entry,
        i0: entryI,
        i1: lastI,
        t0: bars[entryI].time,
        t1: bars[lastI].time,
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
strategy("Dual SuperTrend Strategy (BTCUSDT 1H)", overlay=true, initial_capital=10000, default_qty_type=strategy.percent_of_equity, default_qty_value=100, commission_type=strategy.commission.percent, commission_value=0.05)

// --- 参数设置 ---
atrPeriod1 = input.int(10, "Fast ATR Period", minval=1)
factor1 = input.float(1.5, "Fast SuperTrend Factor", minval=0.1, step=0.1)
atrPeriod2 = input.int(20, "Slow ATR Period", minval=1)
factor2 = input.float(3.0, "Slow SuperTrend Factor", minval=0.1, step=0.1)

// --- SuperTrend 计算 ---
[st1, dir1] = ta.supertrend(factor1, atrPeriod1)
[st2, dir2] = ta.supertrend(factor2, atrPeriod2)

// dir == -1 表示多头趋势 (Bullish), dir == 1 表示空头趋势 (Bearish)
bullish = (dir1 == -1) and (dir2 == -1)
bearish = (dir1 == 1) or (dir2 == 1)

// --- 交易信号 ---
longCondition = bullish and not (dir1[1] == -1 and dir2[1] == -1)
exitCondition = bearish and (dir1[1] == -1 and dir2[1] == -1)

if (longCondition)
    strategy.entry("Long", strategy.long)

if (exitCondition)
    strategy.close("Long")
`,
    ribbon: `//@version=5
strategy("EMA Ribbon Momentum (BTCUSDT 1H)", overlay=true, initial_capital=10000, default_qty_type=strategy.percent_of_equity, default_qty_value=100, commission_type=strategy.commission.percent, commission_value=0.05)

ema20 = ta.ema(close, 20)
ema50 = ta.ema(close, 50)
ema100 = ta.ema(close, 100)
ema200 = ta.ema(close, 200)

// 多头共振排列
bullishRibbon = (ema20 > ema50) and (ema50 > ema100) and (ema100 > ema200)
enterLong = bullishRibbon and ta.crossover(close, ema20)
exitLong = ta.crossunder(close, ema50) or (ema20 < ema50)

if (enterLong)
    strategy.entry("EMA_Ribbon_Long", strategy.long)

if (exitLong)
    strategy.close("EMA_Ribbon_Long")
`,
    rsi: `//@version=5
strategy("RSI Divergence Engine (BTCUSDT 15M)", overlay=true, initial_capital=10000, default_qty_type=strategy.percent_of_equity, default_qty_value=100, commission_type=strategy.commission.percent, commission_value=0.05)

rsiLength = input.int(14, "RSI Length")
lookback = input.int(5, "Pivot Lookback", minval=2)
rsi = ta.rsi(close, rsiLength)

// 局部极值检测 (Pivot High / Low)
pl = ta.pivotlow(rsi, lookback, lookback)
ph = ta.pivothigh(rsi, lookback, lookback)

// 底背离判定
bullishDiv = false
if not na(pl)
    prevLowPrice = ta.valuewhen(not na(pl), low[lookback], 1)
    currentLowPrice = low[lookback]
    prevRsi = ta.valuewhen(not na(pl), rsi[lookback], 1)
    currentRsi = rsi[lookback]
    if (currentLowPrice < prevLowPrice) and (currentRsi > prevRsi) and (currentRsi < 35)
        bullishDiv := true

if (bullishDiv)
    strategy.entry("RSI_Div_Long", strategy.long)

if (ta.crossover(rsi, 70) or ta.crossunder(rsi, 45))
    strategy.close("RSI_Div_Long")
`,
    squeeze: `//@version=5
strategy("Bollinger Squeeze Breakout (BTCUSDT 1H)", overlay=true, initial_capital=10000, default_qty_type=strategy.percent_of_equity, default_qty_value=100, commission_type=strategy.commission.percent, commission_value=0.05)

length = 20
multBB = 2.0
multKC = 1.5

// 布林带与肯特纳通道
basis = ta.sma(close, length)
dev = multBB * ta.stdev(close, length)
upperBB = basis + dev
lowerBB = basis - dev

atrVal = ta.atr(length)
upperKC = basis + (atrVal * multKC)
lowerKC = basis - (atrVal * multKC)

// 动量
val = ta.linreg(close - math.avg(math.avg(ta.highest(high, length), ta.lowest(low, length)), ta.sma(close, length)), length, 0)

squeezeCondition = (upperBB < upperKC) and (lowerBB > lowerKC)
breakoutLong = (upperBB > upperKC) and (val > 0) and (val > val[1])
exitLong = (val < val[1]) or (close < basis)

if (breakoutLong)
    strategy.entry("BB_Squeeze_Long", strategy.long)
if (exitLong)
    strategy.close("BB_Squeeze_Long")
`,
    atr: `//@version=5
strategy("Adaptive ATR Grid (BTCUSDT 5M)", overlay=true, initial_capital=10000, default_qty_type=strategy.percent_of_equity, default_qty_value=20, max_bars_back=500)

atrLength = 14
atrMult = 0.5
gridStep = ta.atr(atrLength) * atrMult
midPrice = ta.ema(close, 50)

gridBuyLevel = midPrice - gridStep
gridTakeProfit = midPrice + gridStep

if (ta.crossunder(close, gridBuyLevel))
    strategy.entry("GridBuy", strategy.long)

if (ta.crossover(close, gridTakeProfit))
    strategy.close("GridBuy")
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
