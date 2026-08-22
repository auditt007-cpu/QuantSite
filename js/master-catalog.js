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
      name: "Quantum Entanglement 量子糾纏動量矩陣",
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
      name: "Dark Matter Fold 暗物質波動率摺疊引擎",
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
      name: "Supernova Pulse 超新星脈衝捕獲系統",
      tier: "master",
      pine: "",
      run(bars) {
        const TA = I();
        const c = col(bars, "close");
        const lows = col(bars, "low");
        const rsi = TA.calculateRSI(c, 14);
        const piv = localLows(rsi, 5, 5);
        const divAt = new Set();
        for (let k = 1; k < piv.length; k++) {
          const i = piv[k];
          const p = piv[k - 1];
          if (rsi[i] == null || rsi[p] == null) continue;
          if (rsi[i] > rsi[p] && lows[i] < lows[p]) divAt.add(i);
        }
        return C.runPineLike(bars, (i) => ({
          enterLong: divAt.has(i),
          exitLong: rsi[i] != null && rsi[i] > 60,
        }));
      },
    },
    {
      id: "eh",
      name: "Event Horizon 黑洞視界均值回歸儀",
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
      name: "Gravitational Wave 引力波共振諧振器",
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
      name: "Neutron Lock 中子星頻率鎖定器",
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
      name: "Spin Flip 費米子自旋翻轉探測器",
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
      name: "Quark Breakout 夸克禁閉突破加速器",
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
      name: "Hyperstring Grid 超弦十一維網格收割機",
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
      name: "Higgs Breach 希格斯場對稱性破缺引擎",
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
