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

  const FEE = 0.0005;

  function pushTrade(trades, bars, side, entry, entryI, i) {
    const px = fillPrice(bars, i);
    const raw = side === "SHORT" ? entry - px : px - entry;
    const feeAbs = FEE * (entry + px);
    trades.push({
      side,
      entry,
      exit: px,
      pnlPct: (raw / entry) * 100 - FEE * 200,
      pnlAbs: raw - feeAbs,
      open: false,
      i0: entryI,
      i1: i,
      t0: bars[entryI].time,
      t1: bars[i].time,
    });
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
        pushTrade(trades, bars, "LONG", entry, entryI, i);
        currentPosition = 0;
      }
    }
    if (currentPosition === 1 && bars.length) {
      pushTrade(trades, bars, "LONG", entry, entryI, bars.length - 1);
    }
    return trades;
  }

  function runPineLike(bars, atBar) {
    const trades = [];
    let pos = 0;
    let entry = 0;
    let entryI = 0;
    for (let i = 1; i < bars.length; i++) {
      const sig = atBar(i) || {};
      if (pos === 1 && (sig.exitLong || sig.enterShort)) {
        pushTrade(trades, bars, "LONG", entry, entryI, i);
        pos = 0;
      } else if (pos === -1 && (sig.exitShort || sig.enterLong)) {
        pushTrade(trades, bars, "SHORT", entry, entryI, i);
        pos = 0;
      }
      if (pos === 0 && sig.enterLong) {
        pos = 1;
        entry = fillPrice(bars, i);
        entryI = i;
      } else if (pos === 0 && sig.enterShort) {
        pos = -1;
        entry = fillPrice(bars, i);
        entryI = i;
      }
    }
    if (pos === 1) pushTrade(trades, bars, "LONG", entry, entryI, bars.length - 1);
    if (pos === -1) pushTrade(trades, bars, "SHORT", entry, entryI, bars.length - 1);
    return trades;
  }

  function crossOver(a, b, i) {
    return a[i] != null && b[i] != null && a[i - 1] != null && b[i - 1] != null && a[i] > b[i] && a[i - 1] <= b[i - 1];
  }
  function crossUnder(a, b, i) {
    return a[i] != null && b[i] != null && a[i - 1] != null && b[i - 1] != null && a[i] < b[i] && a[i - 1] >= b[i - 1];
  }

  function equityFrom(bars, trades) {
    const eq = new Array(bars.length).fill(10000);
    let cash = 10000;
    let units = 0;
    let side = 0;
    let entry = 0;
    const inn = new Map();
    const out = new Map();
    trades.forEach((tr) => {
      inn.set(tr.i0, tr);
      out.set(tr.i1, tr);
    });
    for (let i = 0; i < bars.length; i++) {
      const open = inn.get(i);
      if (open && !side) {
        units = cash / bars[i].close;
        entry = bars[i].close;
        side = open.side === "SHORT" ? -1 : 1;
        cash = 0;
      }
      if (side === 1) eq[i] = units * bars[i].close;
      else if (side === -1) eq[i] = units * (2 * entry - bars[i].close);
      else eq[i] = cash;
      if (out.has(i) && side) {
        cash = eq[i];
        units = 0;
        side = 0;
        eq[i] = cash;
      }
    }
    return eq;
  }

  function barHitRate(bars, trades) {
    if (!bars || bars.length < 3 || !trades.length) return 0;
    const pos = new Array(bars.length).fill(0);
    trades.forEach((tr) => {
      const dir = tr.side === "SHORT" ? -1 : 1;
      const a = Math.max(0, tr.i0);
      const b = Math.min(bars.length - 1, tr.i1);
      for (let i = a; i < b; i++) pos[i] = dir;
    });
    let ok = 0;
    let n = 0;
    for (let i = 1; i < bars.length; i++) {
      if (!pos[i]) continue;
      const ch = bars[i].close - bars[i - 1].close;
      if (ch === 0) continue;
      n += 1;
      if ((pos[i] > 0 && ch > 0) || (pos[i] < 0 && ch < 0)) ok += 1;
    }
    return n ? ok / n : 0;
  }

  function dailySharpe(bars, eq) {
    if (!bars || !eq || bars.length < 10) return 0;
    const last = new Map();
    for (let i = 0; i < bars.length; i++) {
      const d = new Date(Number(bars[i].time) * 1000);
      const key = d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
      last.set(key, eq[i]);
    }
    const vals = [...last.values()];
    const rets = [];
    for (let i = 1; i < vals.length; i++) {
      if (vals[i - 1]) rets.push(vals[i] / vals[i - 1] - 1);
    }
    if (rets.length < 5) return 0;
    const m = rets.reduce((a, b) => a + b, 0) / rets.length;
    const v = rets.reduce((a, b) => a + (b - m) ** 2, 0) / rets.length;
    const sd = Math.sqrt(v);
    return sd === 0 ? 0 : (m / sd) * Math.sqrt(365);
  }

  function performanceOf(trades, eq, barsPerYear, bars) {
    const closed = trades.filter((t) => !t.open);
    const wins = closed.filter((t) => t.pnlAbs > 0);
    const losses = closed.filter((t) => t.pnlAbs < 0);
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
    const sharpeBar = sd === 0 ? 0 : (m / sd) * Math.sqrt(barsPerYear || 365);
    return {
      ret: eq.length ? eq[eq.length - 1] / eq[0] - 1 : 0,
      wr: closed.length ? wins.length / closed.length : 0,
      hit: bars && bars.length ? barHitRate(bars, trades) : 0,
      pf: gl === 0 ? (gp > 0 ? Infinity : 0) : gp / gl,
      mdd,
      sharpe: bars && bars.length ? dailySharpe(bars, eq) : sharpeBar,
      end: eq[eq.length - 1] || 10000,
      trades: closed.length,
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
      name: "ATR 雙 SuperTrend 趨勢跟踪 (Dual SuperTrend)",
      principle: "核心原理：兩條不同靈敏度的 SuperTrend 同時翻多，比單條均線更能過濾假突破。",
      description: "核心原理：兩條不同靈敏度的 SuperTrend 同時翻多，比單條均線更能過濾假突破。觸發條件：快慢 SuperTrend 同時轉為多頭時買入；任一轉空時賣出。",
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
      name: "CTA 多周期均線動量共振 (Multi-Horizon EMA Trend)",
      principle: "核心原理：短中長均線同時向上，等於多個時間尺度都站在多頭一邊。",
      description: "核心原理：短中長均線同時向上，等於多個時間尺度都站在多頭一邊。觸發條件：EMA20>EMA50>EMA200 形成多頭排列時買入；排列破壞時賣出。",
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
      // [PLAIN-TAG]
      name: "RSI 極值均值回歸修復 (Mean Reversion 收益)",
      principle: "核心原理：價格創新低但 RSI 不再創新低，說明下跌力氣在減，容易出現修復。",
      description: "核心原理：價格創新低但 RSI 不再創新低，說明下跌力氣在減，容易出現修復。觸發條件：RSI 從 30 以下回升或出現底背離時買入；RSI 從 70 以上回落時賣出。",
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
      name: "布林帶波動率壓縮突破 (Bollinger Squeeze Breakout)",
      principle: "核心原理：帶寬縮到極窄代表市場在蓄力，隨後張開往往伴隨方向性行情。",
      description: "核心原理：帶寬縮到極窄代表市場在蓄力，隨後張開往往伴隨方向性行情。觸發條件：帶寬處於近 20 根最低且收盤上破上軌時買入；跌回中軌時賣出。",
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
      name: "ATR 自適應波動率做市網格 (Adaptive Volatility Grid)",
      principle: "核心原理：用 ATR 當尺子，跌多了低吸、漲多了高拋，讓網格跟著波動呼吸。",
      description: "核心原理：用 ATR 當尺子，跌多了低吸、漲多了高拋，讓網格跟著波動呼吸。觸發條件：價格跌破均線減 1 倍 ATR 時買入；漲破均線加 1 倍 ATR 時賣出。",
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
  STRATS.forEach((s) => {
    if (!s.tier) s.tier = "free";
  });

  root.QACatalog = {
    list: STRATS,
    get(id) {
      return STRATS.find((s) => s.id === id);
    },
    register(items) {
      (items || []).forEach((s) => {
        if (!s || !s.id) return;
        const i = STRATS.findIndex((x) => x.id === s.id);
        if (i >= 0) STRATS[i] = s;
        else STRATS.push(s);
      });
    },
    runTrades,
    runPineLike,
    equityFrom,
    performanceOf,
    crossOver,
    crossUnder,
    barsPerYear(interval) {
      const map = { "1s": 365 * 24 * 3600, "1m": 365 * 24 * 60, "5m": 365 * 24 * 12, "15m": 365 * 24 * 4, "1h": 365 * 24, "4h": 365 * 6, "1d": 365, "1w": 52 };
      return map[interval] || 365;
    },
  };
})(typeof window !== "undefined" ? window : globalThis);
