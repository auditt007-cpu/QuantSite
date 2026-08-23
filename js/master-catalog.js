(function (root) {
  const C = root.QACatalog;
  const I = () => root.QAIndicators;
  if (!C) return;

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

  const MASTER = [
    {
      id: "qe",
      name: "CTA 短周期動量交叉 (Short-Horizon Momentum)",
      principle: "核心原理：快均線重新領先慢均線，且動能為正，表示短線買盤重新占上風。",
      description: "核心原理：快均線重新領先慢均線，且動能為正，表示短線買盤重新占上風。觸發條件：EMA9 上穿 EMA21 且 ROC>0 時買入；快均線下穿慢均線時賣出。",
      tier: "master",
      pine: "",
      run(bars) {
        const TA = I();
        const c = col(bars, "close");
        const fast = TA.calculateEMA(c, 9);
        const slow = TA.calculateEMA(c, 21);
        const mom = TA.calculateROC(c, 12);
        return C.runPineLike(bars, (i) => ({
          enterLong: C.crossOver(fast, slow, i) && mom[i] > 0,
          exitLong: C.crossUnder(fast, slow, i),
        }));
      },
    },
    {
      id: "dm",
      name: "波動率壓縮突破 (Volatility Squeeze Breakout)",
      principle: "核心原理：布林帶寬顯著收窄後再張開，常對應由震盪切換到趨勢。",
      description: "核心原理：布林帶寬顯著收窄後再張開，常對應由震盪切換到趨勢。觸發條件：帶寬低於均帶寬且收盤突破上軌時做多、跌破下軌時做空；回到中軌平倉。",
      tier: "master",
      pine: "",
      run(bars) {
        const TA = I();
        const c = col(bars, "close");
        const bb = TA.calculateBollingerBands(c, 20, 2);
        const bwSma = TA.calculateSMA(bb.bandwidth, 100);
        return C.runPineLike(bars, (i) => {
          const folded = bb.bandwidth[i] != null && bwSma[i] != null && bb.bandwidth[i] < bwSma[i] * 0.75;
          return {
            enterLong: folded && C.crossOver(c, bb.upper, i),
            enterShort: folded && C.crossUnder(c, bb.lower, i),
            exitLong: C.crossUnder(c, bb.middle, i),
            exitShort: C.crossOver(c, bb.middle, i),
          };
        });
      },
    },
    {
      id: "sn",
      name: "RSI 背離脈衝修復 (RSI Divergence Alpha)",
      principle: "核心原理：價格更低但 RSI 抬高，或 RSI 從超賣區帶量拐頭，都表示下跌力氣在減。",
      description: "核心原理：價格更低但 RSI 抬高，或 RSI 從超賣區帶量拐頭，都表示下跌力氣在減。觸發條件：出現底背離或 RSI 從 35 下方向上穿越時買入；RSI>58 或跌破均線時賣出。",
      tier: "master",
      pine: "",
      run(bars) {
        const TA = I();
        const c = col(bars, "close");
        const h = col(bars, "high");
        const lows = col(bars, "low");
        const rsi = TA.calculateRSI(c, 14);
        const sma = TA.calculateSMA(c, 20);
        const piv = localLows(rsi, 3, 3);
        const divAt = new Set();
        for (let k = 1; k < piv.length; k++) {
          const i = piv[k];
          const p = piv[k - 1];
          if (rsi[i] == null || rsi[p] == null) continue;
          if (rsi[i] > rsi[p] && lows[i] < lows[p]) divAt.add(i);
        }
        return C.runPineLike(bars, (i) => {
          const pulse =
            rsi[i] != null &&
            rsi[i - 1] != null &&
            rsi[i - 1] < 35 &&
            rsi[i] >= 35 &&
            h[i - 1] != null &&
            c[i] > h[i - 1];
          return {
            enterLong: divAt.has(i) || pulse,
            exitLong: (rsi[i] != null && rsi[i] > 58) || C.crossUnder(c, sma, i),
          };
        });
      },
    },
    {
      id: "eh",
      name: "統計套利殘差回歸 (Statistical Arbitrage Z-Score)",
      principle: "核心原理：價格偏離自身均值達到兩個標準差以上時，多數情況會被拉回。",
      description: "核心原理：價格偏離自身均值達到兩個標準差以上時，多數情況會被拉回。觸發條件：Z 分數低於 -2 時買入；回到 -0.3 附近時賣出。",
      tier: "master",
      pine: "",
      run(bars) {
        const TA = I();
        const c = col(bars, "close");
        const basis = TA.calculateSMA(c, 50);
        const sd = TA.calculateStdev(c, 50);
        const z = c.map((px, i) => (basis[i] != null && sd[i] ? (px - basis[i]) / sd[i] : null));
        return C.runPineLike(bars, (i) => ({
          enterLong: z[i] != null && z[i] < -2,
          exitLong: z[i] != null && z[i] > -0.3,
        }));
      },
    },
    {
      id: "gw",
      name: "多周期均線共振趨勢 (Multi-EMA Resonance Trend)",
      principle: "核心原理：一組斐波那契均線同時向上排列，等於多個週期都認同同一個方向。",
      description: "核心原理：一組斐波那契均線同時向上排列，等於多個週期都認同同一個方向。觸發條件：EMA8 至 EMA55 多頭排列且價格上穿最快均線時買入；跌破 EMA21 時賣出。",
      tier: "master",
      pine: "",
      run(bars) {
        const TA = I();
        const c = col(bars, "close");
        const e1 = TA.calculateEMA(c, 8);
        const e2 = TA.calculateEMA(c, 13);
        const e3 = TA.calculateEMA(c, 21);
        const e4 = TA.calculateEMA(c, 34);
        const e5 = TA.calculateEMA(c, 55);
        return C.runPineLike(bars, (i) => {
          const resonance = e1[i] > e2[i] && e2[i] > e3[i] && e3[i] > e4[i] && e4[i] > e5[i];
          return {
            enterLong: resonance && C.crossOver(c, e1, i),
            exitLong: C.crossUnder(c, e3, i),
          };
        });
      },
    },
    {
      id: "ns",
      name: "ATR SuperTrend 趨勢跟踪 (Adaptive SuperTrend)",
      principle: "核心原理：用 ATR 動態軌道把趨勢和普通震動分開，軌道翻轉即視為方向切換。",
      description: "核心原理：用 ATR 動態軌道把趨勢和普通震動分開，軌道翻轉即視為方向切換。觸發條件：SuperTrend 發出多頭信號時買入；發出空頭信號時賣出。",
      tier: "master",
      pine: "",
      run(bars) {
        const TA = I();
        const st = TA.calculateSuperTrend(col(bars, "high"), col(bars, "low"), col(bars, "close"), 10, 3);
        return C.runPineLike(bars, (i) => ({
          enterLong: st.buySignal[i],
          enterShort: st.sellSignal[i],
          exitLong: st.trend[i] === -1,
          exitShort: st.trend[i] === 1,
        }));
      },
    },
    {
      id: "sf",
      name: "MACD-ADX 趨勢過濾動量 (Trend-Filtered Momentum)",
      principle: "核心原理：先用 ADX 確認有趨勢，再用 MACD 金叉做方向，減少震盪市裡的假信號。",
      description: "核心原理：先用 ADX 確認有趨勢，再用 MACD 金叉做方向，減少震盪市裡的假信號。觸發條件：ADX>20 且 MACD 上穿信號線時買入；MACD 下穿時賣出。",
      tier: "master",
      pine: "",
      run(bars) {
        const TA = I();
        const c = col(bars, "close");
        const macd = TA.calculateMACD(c, 12, 26, 9);
        const dmi = TA.calculateDMI(col(bars, "high"), col(bars, "low"), c, 14, 14);
        return C.runPineLike(bars, (i) => {
          const strong = dmi.adx[i] != null && dmi.adx[i] > 20;
          return {
            enterLong: strong && C.crossOver(macd.macd, macd.signal, i),
            enterShort: strong && C.crossUnder(macd.macd, macd.signal, i),
            exitLong: C.crossUnder(macd.macd, macd.signal, i),
            exitShort: C.crossOver(macd.macd, macd.signal, i),
          };
        });
      },
    },
    {
      id: "qk",
      name: "唐奇安通道動態突破 (Donchian Dynamic Breakout)",
      principle: "核心原理：收盤價穿越近 20 日最高價，代表需求把近期供給打穿。",
      description: "核心原理：收盤價穿越近 20 日最高價，代表需求把近期供給打穿。觸發條件：收盤上破 20 日高點時買入；跌破 20 日低點時賣出，或回到 20 日均線減倉。",
      tier: "master",
      pine: "",
      run(bars) {
        const TA = I();
        const c = col(bars, "close");
        const hi = TA.rollingHighest(col(bars, "high"), 20);
        const lo = TA.rollingLowest(col(bars, "low"), 20);
        const mid = TA.calculateEMA(c, 20);
        const upper = hi.map((_, i) => (i > 0 ? hi[i - 1] : null));
        const lower = lo.map((_, i) => (i > 0 ? lo[i - 1] : null));
        return C.runPineLike(bars, (i) => ({
          enterLong: C.crossOver(c, upper, i),
          enterShort: C.crossUnder(c, lower, i),
          exitLong: C.crossUnder(c, mid, i),
          exitShort: C.crossOver(c, mid, i),
        }));
      },
    },
    {
      id: "hs",
      name: "ATR 自適應網格做市 (Adaptive Volatility Grid)",
      principle: "核心原理：按 ATR 分層低吸，回升到上一層網格時兌現，讓倉位跟著波動走。",
      description: "核心原理：按 ATR 分層低吸，回升到上一層網格時兌現，讓倉位跟著波動走。觸發條件：每下跌約 1.5 倍 ATR 加一層；反彈約 1 倍 ATR 減倉。",
      tier: "master",
      pine: "",
      run(bars) {
        const TA = I();
        const atr = TA.calculateATR(col(bars, "high"), col(bars, "low"), col(bars, "close"), 14);
        const trades = [];
        let lastFill = null;
        let level = 0;
        let entryI = 0;
        let avg = 0;
        const maxDim = 4;
        for (let i = 20; i < bars.length; i++) {
          const px = bars[i].close;
          const a = atr[i];
          if (a == null) continue;
          if (lastFill == null) {
            lastFill = px;
            level = 1;
            entryI = i;
            avg = px;
            continue;
          }
          if (px <= lastFill - a * 1.5 && level < maxDim) {
            level += 1;
            avg = (avg * (level - 1) + px) / level;
            lastFill = px;
          }
          if (px >= lastFill + a * 1.0 && level > 0) {
            const feeAbs = 0.0005 * (avg + px);
            trades.push({
              side: "LONG",
              entry: avg,
              exit: px,
              pnlPct: ((px - avg) / avg) * 100 - 0.1,
              pnlAbs: px - avg - feeAbs,
              open: false,
              i0: entryI,
              i1: i,
              t0: bars[entryI].time,
              t1: bars[i].time,
            });
            lastFill = null;
            level = 0;
          }
        }
        return trades;
      },
    },
    {
      id: "hg",
      name: "量價趨勢確認突破 (Price-Volume Trend Confirmation)",
      principle: "核心原理：放量穿越長期均線，比縮量穿越更像真突破。",
      description: "核心原理：放量穿越長期均線，比縮量穿越更像真突破。觸發條件：成交量大於 20 日均量 1.5 倍且收盤上穿 EMA100 時買入；跌回均線時賣出。",
      tier: "master",
      pine: "",
      run(bars) {
        const TA = I();
        const c = col(bars, "close");
        const v = col(bars, "volume");
        const axis = TA.calculateEMA(c, 100);
        const avgVol = TA.calculateSMA(v, 20);
        return C.runPineLike(bars, (i) => {
          const hot = avgVol[i] && v[i] > avgVol[i] * 1.5;
          return {
            enterLong: hot && C.crossOver(c, axis, i),
            enterShort: hot && C.crossUnder(c, axis, i),
            exitLong: C.crossUnder(c, axis, i),
            exitShort: C.crossOver(c, axis, i),
          };
        });
      },
    },
  ];

  MASTER.forEach((s) => {
    s.codeLocked = true;
  });
  C.register(MASTER);
  C.masterIds = MASTER.map((s) => s.id);
})(typeof window !== "undefined" ? window : globalThis);
