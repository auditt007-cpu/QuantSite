(function (root) {
  const C = root.QACatalog;
  const TA = () => root.QAIndicators;
  if (!C) return;

  function nums(series) {
    if (!series || !series.length) return [];
    if (typeof series[0] === "number") return series;
    return series.map((b) => Number(b.close));
  }

  function last(arr, i) {
    if (!arr || i < 0) return null;
    const v = arr[i];
    return v == null ? null : v;
  }

  function smaAt(arr, period, i) {
    if (i < period - 1) return null;
    let s = 0;
    for (let k = i - period + 1; k <= i; k++) s += arr[k];
    return s / period;
  }

  function stdevAt(arr, period, i) {
    const m = smaAt(arr, period, i);
    if (m == null) return null;
    let s = 0;
    for (let k = i - period + 1; k <= i; k++) s += (arr[k] - m) ** 2;
    return Math.sqrt(s / period);
  }

  function hhll(series, period, i, key) {
    let v = key === "high" ? -Infinity : Infinity;
    const from = Math.max(0, i - period);
    for (let k = from; k < i; k++) {
      const x = Number(series[k][key]);
      if (key === "high") v = Math.max(v, x);
      else v = Math.min(v, x);
    }
    return v;
  }

  function sarSeries(bars, step, maxAf) {
    const n = bars.length;
    const out = new Array(n).fill(null);
    if (n < 3) return out;
    let up = bars[1].close >= bars[0].close;
    let af = step;
    let ep = up ? bars[1].high : bars[1].low;
    out[1] = up ? bars[0].low : bars[0].high;
    for (let i = 2; i < n; i++) {
      let sar = out[i - 1] + af * (ep - out[i - 1]);
      if (up) {
        sar = Math.min(sar, bars[i - 1].low, bars[i - 2].low);
        if (bars[i].low < sar) {
          up = false;
          sar = ep;
          ep = bars[i].low;
          af = step;
        } else {
          if (bars[i].high > ep) {
            ep = bars[i].high;
            af = Math.min(maxAf, af + step);
          }
        }
      } else {
        sar = Math.max(sar, bars[i - 1].high, bars[i - 2].high);
        if (bars[i].high > sar) {
          up = true;
          sar = ep;
          ep = bars[i].high;
          af = step;
        } else {
          if (bars[i].low < ep) {
            ep = bars[i].low;
            af = Math.min(maxAf, af + step);
          }
        }
      }
      out[i] = sar;
    }
    return out;
  }

  function makeIndicators(bars) {
    const T = TA();
    const c = nums(bars);
    const h = bars.map((b) => b.high);
    const l = bars.map((b) => b.low);
    const cache = {};
    function memo(key, fn) {
      if (!cache[key]) cache[key] = fn();
      return cache[key];
    }
    return {
      ema(series, period, index) {
        const arr = nums(series);
        const key = "ema:" + period + ":" + arr.length;
        const line = memo(key, () => T.calculateEMA(arr, period));
        return last(line, index);
      },
      sma(series, period, index) {
        const arr = nums(series);
        const key = "sma:" + period + ":" + (arr[0] || 0) + ":" + arr.length;
        const line = memo(key, () => T.calculateSMA(arr, period));
        return last(line, index);
      },
      rsi(series, period, index) {
        const arr = nums(series);
        const line = memo("rsi:" + period, () => T.calculateRSI(arr, period));
        return last(line, index);
      },
      rsiSeries(series, period, from, to) {
        const arr = nums(series);
        const line = memo("rsi:" + period, () => T.calculateRSI(arr, period));
        return line.slice(from, to + 1).map((v) => (v == null ? 50 : v));
      },
      atr(series, period, index) {
        const line = memo("atr:" + period, () => T.calculateATR(h, l, c, period));
        return last(line, index) || 0;
      },
      superTrend(series, period, mult, index) {
        const st = memo("st:" + period + ":" + mult, () => T.calculateSuperTrend(h, l, c, period, mult));
        return { direction: st.trend[index] == null ? 0 : st.trend[index] };
      },
      sar(series, step, maxAf, index) {
        const line = memo("sar:" + step + ":" + maxAf, () => sarSeries(bars, step || 0.02, maxAf || 0.2));
        return last(line, index);
      },
      ichimoku(series, tenkanN, kijunN, senkouN, index) {
        const tenkan = (hhll(bars, tenkanN, index + 1, "high") + hhll(bars, tenkanN, index + 1, "low")) / 2;
        const kijun = (hhll(bars, kijunN, index + 1, "high") + hhll(bars, kijunN, index + 1, "low")) / 2;
        const spanA = (tenkan + kijun) / 2;
        const spanB = (hhll(bars, senkouN, index + 1, "high") + hhll(bars, senkouN, index + 1, "low")) / 2;
        return { tenkan, kijun, spanA, spanB };
      },
      bollingerBands(series, period, k, index) {
        const arr = nums(series);
        const bb = memo("bb:" + period + ":" + k, () => T.calculateBollingerBands(arr, period, k));
        return { lower: bb.lower[index], middle: bb.middle[index], upper: bb.upper[index] };
      },
      bandwidthSeries(series, period, from, to) {
        const arr = nums(series);
        const bb = memo("bb:" + period + ":2", () => T.calculateBollingerBands(arr, period, 2));
        const out = [];
        for (let i = from; i <= to; i++) {
          if (bb.middle[i]) out.push((bb.upper[i] - bb.lower[i]) / bb.middle[i]);
          else out.push(0);
        }
        return out;
      },
      kdj(series, n, m1, m2, index) {
        n = n || 9;
        m1 = m1 || 3;
        const line = memo("kdj:" + n + ":" + m1, () => {
          const out = [];
          let k = 50;
          let d = 50;
          for (let i = 0; i < bars.length; i++) {
            if (i < n) {
              out[i] = { k: 50, d: 50, j: 50 };
              continue;
            }
            const hh = hhll(bars, n, i + 1, "high");
            const ll = hhll(bars, n, i + 1, "low");
            const rsv = hh === ll ? 50 : ((bars[i].close - ll) / (hh - ll)) * 100;
            k = (k * (m1 - 1) + rsv) / m1;
            d = (d * (m1 - 1) + k) / m1;
            out[i] = { k, d, j: 3 * k - 2 * d };
          }
          return out;
        });
        return line[index] || { k: 50, d: 50, j: 50 };
      },
      cci(series, period, index) {
        const tp = bars.map((b) => (b.high + b.low + b.close) / 3);
        const m = smaAt(tp, period, index);
        if (m == null) return 0;
        let md = 0;
        for (let k = index - period + 1; k <= index; k++) md += Math.abs(tp[k] - m);
        md /= period;
        return md ? (tp[index] - m) / (0.015 * md) : 0;
      },
      keltnerChannels(series, period, mult, index) {
        const mid = smaAt(c, period, index);
        const a = this.atr(series, period, index);
        return { lower: mid - mult * a, middle: mid, upper: mid + mult * a };
      },
      williamsR(series, period, index) {
        const hh = hhll(bars, period, index + 1, "high");
        const ll = hhll(bars, period, index + 1, "low");
        if (hh === ll) return -50;
        return ((hh - bars[index].close) / (hh - ll)) * -100;
      },
      pivotPoints(prev) {
        const bar = prev && prev.high != null ? prev : bars[Math.max(0, bars.length - 2)];
        const p = (bar.high + bar.low + bar.close) / 3;
        return { p, r1: 2 * p - bar.low, s1: 2 * p - bar.high, r2: p + (bar.high - bar.low), s2: p - (bar.high - bar.low) };
      },
      obv(series, index) {
        const line = memo("obv", () => {
          const o = [0];
          for (let i = 1; i < bars.length; i++) {
            const d = bars[i].close >= bars[i - 1].close ? bars[i].volume : -bars[i].volume;
            o[i] = o[i - 1] + (d || 0);
          }
          return o;
        });
        return line[index];
      },
      obvMa(series, period, index) {
        const line = memo("obv", () => {
          const o = [0];
          for (let i = 1; i < bars.length; i++) {
            const d = bars[i].close >= bars[i - 1].close ? bars[i].volume : -bars[i].volume;
            o[i] = o[i - 1] + (d || 0);
          }
          return o;
        });
        return smaAt(line, period, index);
      },
      fractalUpper(series, index) {
        if (index < 2 || index > bars.length - 3) return bars[index].high;
        const x = bars[index].high;
        if (x > bars[index - 1].high && x > bars[index - 2].high && x > bars[index + 1].high && x > bars[index + 2].high) return x;
        return bars[index].high * 1.02;
      },
      fractalLower(series, index) {
        if (index < 2 || index > bars.length - 3) return bars[index].low;
        const x = bars[index].low;
        if (x < bars[index - 1].low && x < bars[index - 2].low && x < bars[index + 1].low && x < bars[index + 2].low) return x;
        return bars[index].low * 0.98;
      },
      hmmRegime(series, index) {
        const mom = index > 20 ? c[index] / c[index - 20] - 1 : 0;
        return { state: mom > 0.02 ? "BULLISH_TREND" : mom < -0.02 ? "BEARISH_TREND" : "RANGE" };
      },
      volWeightedMomentum(series, period, index) {
        if (index < period) return 0;
        return (c[index] - c[index - period]) / c[index - period];
      },
      residualZScore(series, index, period) {
        const m = smaAt(c, period, index);
        const sd = stdevAt(c, period, index);
        if (!sd) return 0;
        return (c[index] - m) / sd;
      },
      relativeStrengthRank(series, bench, period, index) {
        const mom = index >= period ? c[index] / c[index - period] - 1 : 0;
        return mom > 0.03 ? 0.95 : mom > 0 ? 0.8 : 0.4;
      },
      vcpPattern(series, index) {
        const look = Math.min(40, index);
        const slice = bars.slice(index - look, index + 1);
        const ranges = slice.map((b) => (b.high - b.low) / b.close);
        const first = ranges.slice(0, Math.floor(ranges.length / 2)).reduce((a, b) => a + b, 0);
        const second = ranges.slice(Math.floor(ranges.length / 2)).reduce((a, b) => a + b, 0);
        const pivot = hhll(bars, look, index + 1, "high");
        const avgVol = slice.reduce((s, b) => s + (b.volume || 0), 0) / (slice.length || 1);
        return { isDetected: second < first * 0.7, pivotPrice: pivot, avgVol };
      },
      cupWithHandle(series, index) {
        const vcp = this.vcpPattern(series, index);
        return { completed: vcp.isDetected, pivot: vcp.pivotPrice };
      },
      historicalVolatility(series, period, index) {
        if (index < period) return 0.2;
        let s = 0;
        for (let k = index - period + 1; k <= index; k++) s += Math.abs(c[k] / c[k - 1] - 1);
        return s / period * Math.sqrt(365);
      },
      orderFlowImbalance(series, period, index) {
        let buy = 0;
        let sell = 0;
        for (let k = Math.max(1, index - period + 1); k <= index; k++) {
          const vol = bars[k].volume || 1;
          if (bars[k].close >= bars[k].open) buy += vol;
          else sell += vol;
        }
        return sell ? buy / sell : 1;
      },
      cumulativeVolumeDelta(series, index) {
        let d = 0;
        const from = Math.max(1, index - 10);
        for (let k = from; k <= index; k++) d += bars[k].close >= bars[k].open ? bars[k].volume || 1 : -(bars[k].volume || 1);
        const prev = d - ((bars[index].close >= bars[index].open ? 1 : -1) * (bars[index].volume || 1));
        return { slope: d - prev };
      },
    };
  }

  function compile(src) {
    try {
      return new Function("return (" + src + ")")();
    } catch {
      return null;
    }
  }

  function kindTag(row) {
    const cat = String(row.category || "");
    if (cat === "grid") return ["網格"];
    if (cat === "mean_reversion") return ["震盪"];
    if (cat === "breakout" || cat === "trend") return ["趨勢"];
    // [PLAIN-TAG]
    return ["機構真錢交易"];
  }

  function toSpec(row) {
    const fn = compile(row.source_code || "");
    const vip = !!row.is_vip;
    return {
      id: row.id,
      name: row.name,
      principle: row.principle || "",
      description: row.description || "",
      pine: vip ? "" : row.source_code || "",
      tier: vip ? "master" : "free",
      tags: kindTag(row),
      metrics: row.metrics,
      release_date: row.release_date || "",
      run(bars) {
        if (!fn || !bars || bars.length < 30) return [];
        const indicators = makeIndicators(bars);
        const pos = { hasPosition: false, entryPrice: 0, lastPrice: 0, addCount: 0 };
        bars.entryIndex = 0;
        return C.runPineLike(bars, (i) => {
          let sig = { buyRule: false, sellRule: false };
          try {
            sig = fn(bars, i, pos, bars) || sig;
          } catch {
            sig = { buyRule: false, sellRule: false };
          }
          const enterLong = !!sig.buyRule && !pos.hasPosition;
          const exitLong = !!sig.sellRule && pos.hasPosition;
          if (pos.hasPosition && sig.sellRule) pos.hasPosition = false;
          else if (!pos.hasPosition && sig.buyRule) {
            pos.hasPosition = true;
            pos.entryPrice = bars[i].close;
            pos.lastPrice = bars[i].close;
            pos.addCount = 0;
            bars.entryIndex = i;
          } else if (pos.hasPosition && sig.buyRule) {
            pos.lastPrice = bars[i].close;
            pos.addCount += 1;
          }
          return { enterLong, exitLong };
        });
      },
    };
  }

  function ingest(rows) {
    if (!Array.isArray(rows) || !rows.length) return 0;
    C.register(rows.map(toSpec));
    return rows.length;
  }

  let loaded = 0;
  if (Array.isArray(root.QA_STRATEGY_ROWS) && root.QA_STRATEGY_ROWS.length) {
    loaded = ingest(root.QA_STRATEGY_ROWS);
  }

  async function refresh() {
    const urls = ["./js/strategies_data.json", "./gemini-code-1787470320177.json"];
    for (let i = 0; i < urls.length; i++) {
      try {
        const res = await fetch(urls[i], { cache: "no-store" });
        if (!res.ok) continue;
        const data = await res.json();
        if (Array.isArray(data) && data.length) return ingest(data);
      } catch {
        /* try next */
      }
    }
    return loaded;
  }

  root.QAPackReady = loaded ? Promise.resolve(loaded) : refresh();
})(typeof window !== "undefined" ? window : globalThis);
