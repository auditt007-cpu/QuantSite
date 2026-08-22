/**
 * Local indicator engine.
 * SMA / EMA / RSI / MACD / Bollinger / ATR follow anandanand84/technicalindicators
 * (MIT) generator math: SMA seed, EMA k=2/(n+1), RSI Wilder + 2-decimal RS,
 * Bollinger population SD (÷ period), ATR = WEMA(TrueRange) with k=1/n.
 * SuperTrend follows the Pine/ATR band-flip used by wahack's Supertrend port
 * (not in the original anandanand84 set).
 */
(function (root) {
  function alignedNull(n) {
    return new Array(n).fill(null);
  }

  function calculateSMA(data, period) {
    const n = data.length;
    const out = alignedNull(n);
    if (!period || period < 1) return out;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      sum += data[i];
      if (i >= period) sum -= data[i - period];
      if (i >= period - 1) out[i] = sum / period;
    }
    return out;
  }

  function emaFromSeries(data, period, exponent) {
    const n = data.length;
    const out = alignedNull(n);
    const sma = calculateSMA(data, period);
    let prev;
    for (let i = 0; i < n; i++) {
      if (prev === undefined) {
        if (sma[i] != null) {
          prev = sma[i];
          out[i] = prev;
        }
      } else {
        prev = (data[i] - prev) * exponent + prev;
        out[i] = prev;
      }
    }
    return out;
  }

  function calculateEMA(data, period) {
    return emaFromSeries(data, period, 2 / (period + 1));
  }

  function calculateWEMA(data, period) {
    return emaFromSeries(data, period, 1 / period);
  }

  function rsiFrom(avgGain, avgLoss) {
    if (avgLoss === 0) return 100;
    if (avgGain === 0) return 0;
    const rs = avgGain / avgLoss;
    return Number((100 - 100 / (1 + (isNaN(rs) ? 0 : rs))).toFixed(2));
  }

  function calculateRSI(data, period) {
    if (period == null) period = 14;
    const n = data.length;
    const out = alignedNull(n);
    if (n < period + 1) return out;
    let gainSum = 0;
    let lossSum = 0;
    for (let i = 1; i <= period; i++) {
      const ch = data[i] - data[i - 1];
      if (ch > 0) gainSum += ch;
      else lossSum -= ch;
    }
    let avgGain = gainSum / period;
    let avgLoss = lossSum / period;
    out[period] = rsiFrom(avgGain, avgLoss);
    for (let i = period + 1; i < n; i++) {
      const ch = data[i] - data[i - 1];
      const g = ch > 0 ? ch : 0;
      const l = ch < 0 ? -ch : 0;
      avgGain = (avgGain * (period - 1) + g) / period;
      avgLoss = (avgLoss * (period - 1) + l) / period;
      out[i] = rsiFrom(avgGain, avgLoss);
    }
    return out;
  }

  function compactDefined(series) {
    const values = [];
    const index = [];
    for (let i = 0; i < series.length; i++) {
      if (series[i] != null) {
        values.push(series[i]);
        index.push(i);
      }
    }
    return { values, index };
  }

  function scatter(n, compactValues, index) {
    const out = alignedNull(n);
    for (let j = 0; j < compactValues.length; j++) {
      if (compactValues[j] != null) out[index[j]] = compactValues[j];
    }
    return out;
  }

  function calculateMACD(data, fastPeriod, slowPeriod, signalPeriod) {
    if (fastPeriod == null) fastPeriod = 12;
    if (slowPeriod == null) slowPeriod = 26;
    if (signalPeriod == null) signalPeriod = 9;
    const fast = calculateEMA(data, fastPeriod);
    const slow = calculateEMA(data, slowPeriod);
    const macd = data.map((_, i) =>
      fast[i] != null && slow[i] != null ? fast[i] - slow[i] : null,
    );
    const packed = compactDefined(macd);
    const sigPacked = calculateEMA(packed.values, signalPeriod);
    const signal = scatter(data.length, sigPacked, packed.index);
    const histogram = data.map((_, i) =>
      macd[i] != null && signal[i] != null ? macd[i] - signal[i] : null,
    );
    return { macd, signal, histogram };
  }

  function populationSd(window, mean) {
    let sum = 0;
    for (let i = 0; i < window.length; i++) sum += (window[i] - mean) * (window[i] - mean);
    return Math.sqrt(sum / window.length);
  }

  function calculateBollingerBands(data, period, stdDev) {
    if (period == null) period = 20;
    if (stdDev == null) stdDev = 2;
    const n = data.length;
    const middle = calculateSMA(data, period);
    const upper = alignedNull(n);
    const lower = alignedNull(n);
    const pb = alignedNull(n);
    const bandwidth = alignedNull(n);
    for (let i = period - 1; i < n; i++) {
      const slice = data.slice(i - period + 1, i + 1);
      const mean = middle[i];
      const sd = populationSd(slice, mean);
      const u = mean + sd * stdDev;
      const l = mean - sd * stdDev;
      upper[i] = u;
      lower[i] = l;
      pb[i] = u === l ? 0.5 : (data[i] - l) / (u - l);
      bandwidth[i] = mean === 0 ? 0 : (u - l) / mean;
    }
    return { middle, upper, lower, pb, bandwidth };
  }

  function trueRange(highs, lows, closes) {
    const n = closes.length;
    const tr = alignedNull(n);
    for (let i = 1; i < n; i++) {
      tr[i] = Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1]),
      );
    }
    return tr;
  }

  function calculateATR(highs, lows, closes, period) {
    if (period == null) period = 14;
    const tr = trueRange(highs, lows, closes);
    const packed = compactDefined(tr);
    const wema = calculateWEMA(packed.values, period);
    return scatter(closes.length, wema, packed.index);
  }

  function calculateSuperTrend(highs, lows, closes, period, multiplier) {
    if (period == null) period = 10;
    if (multiplier == null) multiplier = 3;
    const n = closes.length;
    const atr = calculateATR(highs, lows, closes, period);
    const supertrend = alignedNull(n);
    const upper = alignedNull(n);
    const lower = alignedNull(n);
    const trend = alignedNull(n);
    const buySignal = new Array(n).fill(false);
    const sellSignal = new Array(n).fill(false);
    const up = alignedNull(n);
    const dn = alignedNull(n);

    for (let i = 0; i < n; i++) {
      if (atr[i] == null) continue;
      const src = (highs[i] + lows[i]) / 2;
      const basicUp = src - multiplier * atr[i];
      const basicDn = src + multiplier * atr[i];
      const up1 = i > 0 ? up[i - 1] : null;
      const dn1 = i > 0 ? dn[i - 1] : null;
      if (i > 0 && up1 != null && closes[i - 1] > up1) up[i] = Math.max(basicUp, up1);
      else up[i] = basicUp;
      if (i > 0 && dn1 != null && closes[i - 1] < dn1) dn[i] = Math.min(basicDn, dn1);
      else dn[i] = basicDn;

      const prevTrend = i > 0 && trend[i - 1] != null ? trend[i - 1] : 1;
      let t = prevTrend;
      if (prevTrend === -1 && dn1 != null && closes[i] > dn1) t = 1;
      else if (prevTrend === 1 && up1 != null && closes[i] < up1) t = -1;
      trend[i] = t;
      lower[i] = up[i];
      upper[i] = dn[i];
      supertrend[i] = t === 1 ? up[i] : dn[i];
      if (i > 0 && trend[i - 1] != null) {
        buySignal[i] = t === 1 && trend[i - 1] === -1;
        sellSignal[i] = t === -1 && trend[i - 1] === 1;
      }
    }
    return { supertrend, upper, lower, trend, buySignal, sellSignal, atr };
  }

  const api = {
    calculateSMA,
    calculateEMA,
    calculateWEMA,
    calculateRSI,
    calculateMACD,
    calculateBollingerBands,
    calculateATR,
    calculateSuperTrend,
  };

  root.QAIndicators = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
