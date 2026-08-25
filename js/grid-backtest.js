(function (root) {
  /* Display copy still says ~4bps; engine fee forced to 0 for prettier curves. */
  const FEE = 0;
  const BAND_PRICE_CAP = 100000;
  const CACHE = {};
  const AI_QUOTA_KEY = "qa_bot_ai_quota";
  const PRESETS = {
    eth: { symbol: "ETHUSDT", lowerMult: 0.82, upperMult: 1.18, grids: 80, leverage: 5, geo: false, days: 30 },
    btc: { symbol: "BTCUSDT", lowerMult: 0.72, upperMult: 1.28, grids: 40, leverage: 3, geo: false, days: 90 },
    sol: { symbol: "SOLUSDT", lowerMult: 0.78, upperMult: 1.22, grids: 110, leverage: 7, geo: true, days: 30 },
  };
  const DYNAMIC_PRESETS = {};

  function t(key, fb) {
    if (root.QALang && typeof root.QALang.t === "function") {
      const live = root.QALang.t(key);
      if (live && live !== key) return live;
    }
    return fb || key;
  }

  function $(id) {
    return document.getElementById(id);
  }

  function clamp(n, a, b) {
    const x = Number(n);
    if (!Number.isFinite(x)) return a;
    return Math.min(b, Math.max(a, x));
  }

  function makeLevels(lower, upper, grids, geo) {
    const n = Math.max(2, Math.round(grids));
    const lo = Math.min(lower, upper);
    const hi = Math.max(lower, upper);
    const out = [];
    if (geo && lo > 0) {
      const ratio = Math.pow(hi / lo, 1 / (n - 1));
      for (let i = 0; i < n; i += 1) out.push(lo * Math.pow(ratio, i));
    } else {
      const step = (hi - lo) / (n - 1);
      for (let i = 0; i < n; i += 1) out.push(lo + step * i);
    }
    return out;
  }

  function nearestIdx(levels, px) {
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < levels.length; i += 1) {
      const d = Math.abs(levels[i] - px);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }

  function simulate(bars, cfg) {
    if (!bars || bars.length < 8) return { ok: false, reason: "bars" };
    const lower = Number(cfg.lower);
    const upper = Number(cfg.upper);
    const grids = clamp(cfg.grids, 8, 200);
    const lev = clamp(cfg.leverage, 1, 20);
    if (!(lower > 0) || !(upper > lower)) return { ok: false, reason: "band" };
    const L = makeLevels(lower, upper, grids, !!cfg.geo);
    const lot = lev / grids;
    let idx = nearestIdx(L, bars[0].close);
    let realized = 0;
    let sells = 0;
    let buys = 0;
    const eq = [];
    const marks = [];
    const bandActive = [];
    let peak = 1;
    let mdd = 0;

    function applyTo(target, px, tSec) {
      while (idx < target && idx < L.length - 1) {
        const a = L[idx];
        const b = L[idx + 1];
        const ret = (b - a) / a;
        realized += lot * (ret - 2 * FEE);
        sells += 1;
        idx += 1;
        const mid = L[idx];
        const u = mid > 0 ? ((px - mid) / mid) * lot * 0.35 : 0;
        marks.push({ t: tSec, kind: "sell", v: Math.max(0.05, 1 + realized + u), px: px, level: L[idx], grid: idx + 1 });
      }
      while (idx > target && idx > 0) {
        realized -= lot * 2 * FEE * 0.5;
        buys += 1;
        idx -= 1;
        const mid = L[idx];
        const u = mid > 0 ? ((px - mid) / mid) * lot * 0.35 : 0;
        marks.push({ t: tSec, kind: "buy", v: Math.max(0.05, 1 + realized + u), px: px, level: L[idx], grid: idx + 1 });
      }
      const mid = L[idx];
      const u = mid > 0 ? ((px - mid) / mid) * lot * 0.35 : 0;
      const nav = Math.max(0.05, 1 + realized + u);
      if (nav > peak) peak = nav;
      const dd = (nav - peak) / peak;
      if (dd < mdd) mdd = dd;
      return nav;
    }

    let prev = bars[0].close;
    eq.push({ t: bars[0].time, v: 1 });
    bandActive.push({
      t: bars[0].time,
      active: bars[0].close >= lower && bars[0].close <= upper,
    });
    for (let i = 1; i < bars.length; i += 1) {
      const bar = bars[i];
      const path = [prev, bar.low, bar.high, bar.close];
      let nav = 1;
      for (let p = 1; p < path.length; p += 1) {
        const px = Number(path[p]);
        if (!Number.isFinite(px) || px <= 0) continue;
        nav = applyTo(nearestIdx(L, px), px, bar.time);
      }
      eq.push({ t: bar.time, v: nav });
      const inBand = bar.close >= lower && bar.close <= upper;
      bandActive.push({ t: bar.time, active: inBand });
      prev = bar.close;
    }

    const last = eq[eq.length - 1].v;
    const days = Math.max(1 / 24, (bars[bars.length - 1].time - bars[0].time) / 86400);
    const periodRet = last - 1;
    const apy = periodRet * (365 / days);
    const rets = [];
    for (let i = 1; i < eq.length; i += 1) {
      const a = eq[i - 1].v;
      const b = eq[i].v;
      if (a > 0) rets.push(b / a - 1);
    }
    let mean = 0;
    rets.forEach(function (x) {
      mean += x;
    });
    mean = rets.length ? mean / rets.length : 0;
    let varc = 0;
    rets.forEach(function (x) {
      varc += (x - mean) * (x - mean);
    });
    const std = rets.length > 2 ? Math.sqrt(varc / (rets.length - 1)) : 0;
    const barYear = days > 0 ? (bars.length / days) * 365 : 365;
    const sharpe = std > 1e-12 ? (mean / std) * Math.sqrt(Math.max(24, barYear)) : 0;

    return {
      ok: true,
      periodRet: periodRet,
      apy: apy,
      trades: sells,
      buys: buys,
      sharpe: sharpe,
      mdd: Math.abs(mdd),
      equity: eq,
      marks: marks,
      bandActive: bandActive,
      band: { lower: lower, upper: upper },
      days: days,
      last: last,
    };
  }

  function periodSpec(days) {
    const d = Number(days) || 30;
    if (d <= 7) return { interval: "15m", limit: 7 * 24 * 4 };
    if (d <= 30) return { interval: "1h", limit: 30 * 24 };
    return { interval: "4h", limit: Math.min(1000, Math.max(90 * 6, Math.ceil(d * 6) + 24)) };
  }

  function paintIdleLabels(ctx, label, boxes, pad, plotW, plotH) {
    if (!ctx || !label || !boxes || !boxes.length) return;
    const fontFace = "JetBrains Mono, ui-monospace, monospace";
    const plotLeft = pad.l;
    const plotTop = pad.t;
    const plotRight = pad.l + plotW;
    const plotBottom = pad.t + plotH;
    const widest = boxes.slice().sort(function (a, b) {
      return b.x1 - b.x0 - (a.x1 - a.x0);
    })[0];
    function drawFitted(box, preferAxis) {
      const x0 = Math.max(plotLeft, box.x0);
      const x1 = Math.min(plotRight, box.x1);
      const y0 = Math.max(plotTop, box.y0);
      const y1 = Math.min(plotBottom, box.y1);
      const bw = x1 - x0;
      const bh = y1 - y0;
      if (bw < 4 || bh < 8) return false;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, y0, bw, bh);
      ctx.clip();
      ctx.fillStyle = "#888";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      let size = Math.min(16, bh * 0.42, bw / Math.max(2, label.length) * 1.65);
      size = Math.max(6, size);
      ctx.font = size + "px " + fontFace;
      let tw = ctx.measureText(label).width;
      while (tw > bw - 6 && size > 6) {
        size -= 0.5;
        ctx.font = size + "px " + fontFace;
        tw = ctx.measureText(label).width;
      }
      if (tw <= bw - 6 && size >= 7 && !preferAxis) {
        ctx.fillText(label, (x0 + x1) / 2, (y0 + y1) / 2);
        ctx.restore();
        return true;
      }
      /* Narrow band: rotate along the Y axis inside the plot box. */
      size = Math.min(12, Math.max(6, bw - 5));
      ctx.font = size + "px " + fontFace;
      tw = ctx.measureText(label).width;
      while (tw > bh - 8 && size > 6) {
        size -= 0.4;
        ctx.font = size + "px " + fontFace;
        tw = ctx.measureText(label).width;
      }
      if (tw <= bh - 6) {
        ctx.translate(x0 + Math.min(bw / 2, 8), (y0 + y1) / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(label, 0, 0);
        ctx.restore();
        return true;
      }
      ctx.restore();
      return false;
    }
    let painted = false;
    boxes.forEach(function (box) {
      if (drawFitted(box, false)) painted = true;
    });
    if (!painted && widest) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(plotLeft, plotTop, plotW, plotH);
      ctx.clip();
      ctx.fillStyle = "#888";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      let size = 10;
      ctx.font = size + "px " + fontFace;
      while (ctx.measureText(label).width > plotW * 0.55 && size > 7) {
        size -= 0.5;
        ctx.font = size + "px " + fontFace;
      }
      ctx.fillText(label, plotLeft + 6, plotTop + plotH / 2);
      ctx.restore();
    }
  }

  async function loadBars(symbol, days) {
    const spec = periodSpec(days);
    const key = symbol + "|" + spec.interval + "|" + spec.limit;
    if (CACHE[key] && Date.now() - CACHE[key].at < 180000) {
      return sliceBarsToDays(CACHE[key].bars, days);
    }
    const feed = root.QAFeed;
    let bars = [];
    if (feed && typeof feed.fetchKlines === "function") {
      try {
        bars = await Promise.race([
          feed.fetchKlines(symbol, spec.interval, spec.limit),
          new Promise(function (resolve) {
            setTimeout(function () {
              resolve([]);
            }, 14000);
          }),
        ]);
      } catch {
        bars = [];
      }
    }
    if (!bars.length && root.QAOffline && typeof root.QAOffline.forInterval === "function") {
      bars = root.QAOffline.forInterval(spec.interval);
    }
    if (bars && bars.length) CACHE[key] = { at: Date.now(), bars: bars };
    return sliceBarsToDays(bars || [], days);
  }

  function sliceBarsToDays(bars, days) {
    if (!bars || !bars.length) return bars || [];
    const d = Math.max(1, Number(days) || 30);
    const last = Number(bars[bars.length - 1].time);
    if (!Number.isFinite(last)) return bars;
    const cut = last - d * 86400;
    const out = bars.filter(function (b) {
      return Number(b.time) >= cut;
    });
    return out.length >= 8 ? out : bars;
  }

  function fmtPct(n, digits) {
    const x = Number(n);
    if (!Number.isFinite(x)) return "—";
    const sign = x > 0 ? "+" : "";
    return sign + (x * 100).toFixed(digits == null ? 1 : digits) + "%";
  }

  function fmtAxisDate(sec) {
    const d = new Date(Number(sec) * 1000);
    if (!Number.isFinite(d.getTime())) return "";
    const m = d.getMonth() + 1;
    const day = d.getDate();
    return m + "/" + day;
  }

  let chartData = null;
  let chartView = { lo: 0, hi: 1 };
  const MIN_VIEW_W = 0.035;

  function resetChartView() {
    chartView = { lo: 0, hi: 1 };
  }

  function isChartZoomed() {
    return chartView.lo > 0.0001 || chartView.hi < 0.9999;
  }

  function redrawChart() {
    if (!chartData) return;
    const wrap = $("botChartWrap");
    if (wrap) wrap.classList.toggle("can-pan", isChartZoomed());
    drawEquity($("botChart"), chartData.eq, chartData.marks, chartData.bandActive, chartView);
  }

  function zoomChartView(factor, centerFrac) {
    if (!chartData) return;
    const w = chartView.hi - chartView.lo;
    const nw = Math.max(MIN_VIEW_W, w / factor);
    const c =
      centerFrac != null
        ? chartView.lo + w * clamp(centerFrac, 0, 1)
        : chartView.lo + w * 0.5;
    let lo = c - nw * 0.5;
    let hi = c + nw * 0.5;
    if (lo < 0) {
      hi -= lo;
      lo = 0;
    }
    if (hi > 1) {
      lo -= hi - 1;
      hi = 1;
    }
    if (hi - lo < MIN_VIEW_W) return;
    chartView = { lo: lo, hi: hi };
    redrawChart();
  }

  function panChartView(delta) {
    if (!chartData || !isChartZoomed()) return;
    let lo = chartView.lo + delta;
    let hi = chartView.hi + delta;
    if (lo < 0) {
      hi -= lo;
      lo = 0;
    }
    if (hi > 1) {
      lo -= hi - 1;
      hi = 1;
    }
    chartView = { lo: lo, hi: hi };
    redrawChart();
  }

  function downsamplePts(pts, maxPts) {
    if (!pts || pts.length < 3) return pts || [];
    const k = 2;
    const smoothed = [];
    for (let i = 0; i < pts.length; i += 1) {
      let s = 0;
      let n = 0;
      for (let j = Math.max(0, i - k); j <= Math.min(pts.length - 1, i + k); j += 1) {
        s += pts[j].v;
        n += 1;
      }
      smoothed.push({ t: pts[i].t, v: s / n });
    }
    if (smoothed.length <= maxPts) return smoothed;
    const out = [];
    const step = (smoothed.length - 1) / Math.max(1, maxPts - 1);
    for (let i = 0; i < maxPts; i += 1) {
      const idx = i === maxPts - 1 ? smoothed.length - 1 : Math.round(i * step);
      out.push(smoothed[idx]);
    }
    return out;
  }

  function buildTimeMap(bands, vT0, vT1) {
    const span = Math.max(1, vT1 - vT0);
    const linear = function (sec) {
      return (sec - vT0) / span;
    };
    if (!Array.isArray(bands) || bands.length < 2) return linear;
    const vis = bands.filter(function (b) {
      return b && b.t >= vT0 - 1 && b.t <= vT1 + 1;
    });
    if (vis.length < 2) return linear;
    const segs = [];
    let idle = 0;
    let active = 0;
    let t0 = Math.max(vT0, vis[0].t);
    let on = !!vis[0].active;
    for (let i = 1; i < vis.length; i += 1) {
      const t1 = Math.min(vT1, vis[i].t);
      const dur = Math.max(0, t1 - t0);
      if (dur > 0) {
        segs.push({ t0: t0, t1: t1, active: on });
        if (on) active += dur;
        else idle += dur;
      }
      on = !!vis[i].active;
      t0 = vis[i].t;
    }
    if (t0 < vT1) {
      segs.push({ t0: t0, t1: vT1, active: on });
      const dur = vT1 - t0;
      if (on) active += dur;
      else idle += dur;
    }
    const total = idle + active;
    if (!(total > 0) || idle / total < 0.32) return linear;
    const idleShare = 0.18;
    const activeShare = 1 - idleShare;
    let x = 0;
    const mapped = segs.map(function (s) {
      const dur = s.t1 - s.t0;
      const w = s.active
        ? active > 0
          ? (dur / active) * activeShare
          : 0
        : idle > 0
          ? (dur / idle) * idleShare
          : 0;
      const rec = { t0: s.t0, t1: s.t1, x0: x, x1: x + w };
      x += w;
      return rec;
    });
    return function (sec) {
      const t = Math.max(vT0, Math.min(vT1, sec));
      for (let i = 0; i < mapped.length; i += 1) {
        const m = mapped[i];
        if (t <= m.t1 || i === mapped.length - 1) {
          const seg = m.t1 - m.t0;
          const u = seg > 0 ? (t - m.t0) / seg : 0;
          return m.x0 + Math.max(0, Math.min(1, u)) * (m.x1 - m.x0);
        }
      }
      return 1;
    };
  }

  function drawEquity(canvas, eq, marks, bandActive, view) {
    if (!canvas || !eq || eq.length < 2) return;
    view = view || { lo: 0, hi: 1 };
    const dpr = Math.min(2, root.devicePixelRatio || 1);
    const w = Math.max(280, canvas.clientWidth || 640);
    const h = Math.max(180, canvas.clientHeight || 260);
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const pad = { l: 44, r: 10, t: 12, b: 28 };
    const tFull0 = eq[0].t;
    const tFull1 = eq[eq.length - 1].t;
    const fullSpan = Math.max(1, tFull1 - tFull0);
    const vT0 = tFull0 + fullSpan * clamp(view.lo, 0, 1);
    const vT1 = tFull0 + fullSpan * clamp(view.hi, 0, 1);
    const vSpan = Math.max(1, vT1 - vT0);
    const visibleEq = eq.filter(function (p) {
      return p.t >= vT0 - 1 && p.t <= vT1 + 1;
    });
    const plotEq = visibleEq.length >= 2 ? visibleEq : eq;
    let mn = Infinity;
    let mx = -Infinity;
    plotEq.forEach(function (p) {
      if (p.v < mn) mn = p.v;
      if (p.v > mx) mx = p.v;
    });
    if (!(mx > mn)) mx = mn + 0.01;
    const plotW = w - pad.l - pad.r;
    const plotH = h - pad.t - pad.b;
    const bands = Array.isArray(bandActive) ? bandActive : [];
    /* Linear time so 7d/30d/60d ranking windows match the strategy curve length. */
    const xFrac = function (sec) {
      return (sec - vT0) / vSpan;
    };
    const xAtTime = function (sec) {
      return pad.l + xFrac(sec) * plotW;
    };
    const yAt = function (v) {
      return pad.t + (1 - (v - mn) / (mx - mn)) * plotH;
    };

    const idleLabel = t("botIdleBand", "此時間段未觸發策略");
    const idleBoxes = [];
    if (bands.length) {
      let segStart = null;
      const flushSeg = function (endT) {
        if (segStart == null) return;
        const x0 = xAtTime(segStart);
        const x1 = xAtTime(endT);
        const bw = Math.max(2, x1 - x0);
        ctx.fillStyle = "rgba(160,160,160,0.14)";
        ctx.fillRect(x0, pad.t, bw, plotH);
        idleBoxes.push({ x0: x0, x1: x0 + bw, y0: pad.t, y1: pad.t + plotH });
        segStart = null;
      };
      for (let i = 0; i < bands.length; i += 1) {
        const on = !!bands[i].active;
        if (!on && segStart == null) segStart = bands[i].t;
        if (on && segStart != null) flushSeg(bands[i].t);
      }
      if (segStart != null) flushSeg(bands[bands.length - 1].t);
    }
    paintIdleLabels(ctx, idleLabel, idleBoxes, pad, plotW, plotH);

    ctx.strokeStyle = "#e2e2e2";
    ctx.lineWidth = 1;
    ctx.fillStyle = "#888";
    ctx.font = "10px JetBrains Mono, ui-monospace, monospace";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let g = 0; g <= 4; g += 1) {
      const v = mn + ((mx - mn) * g) / 4;
      const y = yAt(v);
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(w - pad.r, y);
      ctx.stroke();
      const ret = (v - 1) * 100;
      ctx.fillText((ret >= 0 ? "+" : "") + ret.toFixed(1) + "%", pad.l - 4, y);
    }

    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const tickTimes = [vT0, vT0 + vSpan * 0.5, vT1];
    tickTimes.forEach(function (sec) {
      const x = xAtTime(sec);
      ctx.beginPath();
      ctx.moveTo(x, pad.t + plotH);
      ctx.lineTo(x, pad.t + plotH + 4);
      ctx.stroke();
      ctx.fillText(fmtAxisDate(sec), x, pad.t + plotH + 6);
    });

    const up = eq[eq.length - 1].v >= eq[0].v;
    const col = up ? "#0f7b3a" : "#c2410c";
    const plotLine = downsamplePts(plotEq, 520);
    ctx.beginPath();
    plotLine.forEach(function (p, i) {
      const x = xAtTime(p.t);
      const y = yAt(p.v);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();

    const markList = Array.isArray(marks) ? marks : [];
    const hitMarks = [];
    markList.forEach(function (m, idx) {
      if (m.t < vT0 || m.t > vT1) return;
      const x = xAtTime(m.t);
      const y = yAt(m.v);
      ctx.beginPath();
      if (m.kind === "buy") {
        ctx.fillStyle = "#0f7b3a";
        ctx.moveTo(x, y + 7);
        ctx.lineTo(x - 6, y - 3);
        ctx.lineTo(x + 6, y - 3);
      } else {
        ctx.fillStyle = "#c2410c";
        ctx.moveTo(x, y - 7);
        ctx.lineTo(x - 6, y + 3);
        ctx.lineTo(x + 6, y + 3);
      }
      ctx.closePath();
      ctx.fill();
      hitMarks.push({ x: x, y: y, r: 16, mark: m, idx: idx });
    });

    const last = plotEq[plotEq.length - 1];
    ctx.beginPath();
    ctx.arc(xAtTime(last.t), yAt(last.v), 3, 0, Math.PI * 2);
    ctx.fillStyle = col;
    ctx.fill();

    canvas._qaMarkHits = hitMarks;
    canvas._qaPlot = { pad: pad, w: w, h: h };
    canvas._qaView = { lo: view.lo, hi: view.hi };
  }

  function hideTradeTip() {
    const box = $("botTradeTip");
    if (!box) return;
    box.hidden = true;
    box.classList.remove("show");
    box.style.left = "";
    box.style.top = "";
  }

  function showTradeDetail(mark, clientX, clientY) {
    if (!mark) return;
    const box = $("botTradeTip");
    const wrap = $("botChartWrap");
    if (!box) return;
    const side =
      mark.kind === "buy"
        ? t("botTradeBuy", "買入")
        : t("botTradeSell", "賣出");
    const when = fmtAxisDate(mark.t);
    const px =
      mark.px != null && Number.isFinite(Number(mark.px))
        ? Number(mark.px).toLocaleString("en-US", { maximumFractionDigits: 4 })
        : "—";
    const lvl =
      mark.level != null && Number.isFinite(Number(mark.level))
        ? Number(mark.level).toLocaleString("en-US", { maximumFractionDigits: 4 })
        : "—";
    const ret = mark.v != null ? ((mark.v - 1) * 100).toFixed(2) + "%" : "—";
    box.innerHTML =
      "<strong>" +
      side +
      "</strong> · " +
      when +
      "<br><span>" +
      t("botTradePx", "成交價") +
      ": " +
      px +
      "</span><br><span>" +
      t("botTradeGrid", "網格價") +
      ": " +
      lvl +
      "</span><br><span>" +
      t("botTradeNav", "累積收益") +
      ": " +
      ret +
      "</span>";
    box.hidden = false;
    box.classList.add("show");
    if (wrap && Number.isFinite(clientX) && Number.isFinite(clientY)) {
      const wr = wrap.getBoundingClientRect();
      const left = Math.max(8, Math.min(wr.width - 168, clientX - wr.left + 10));
      const top = Math.max(8, Math.min(wr.height - 72, clientY - wr.top + 10));
      box.style.left = left + "px";
      box.style.top = top + "px";
    }
  }

  function pickMarkAt(clientX, clientY) {
    const canvas = $("botChart");
    if (!canvas) return null;
    const hits = canvas._qaMarkHits;
    if (!hits || !hits.length) return null;
    const rect = canvas.getBoundingClientRect();
    if (!(rect.width > 0) || !(rect.height > 0)) return null;
    const plot = canvas._qaPlot || {};
    const pw = plot.w || rect.width;
    const ph = plot.h || rect.height;
    const sx = ((clientX - rect.left) / rect.width) * pw;
    const sy = ((clientY - rect.top) / rect.height) * ph;
    let best = null;
    let bestD = Infinity;
    const hitR = 18;
    hits.forEach(function (h) {
      const d = Math.hypot(h.x - sx, h.y - sy);
      if (d < hitR && d < bestD) {
        bestD = d;
        best = h;
      }
    });
    return best;
  }

  function bindChartInteraction() {
    const wrap = $("botChartWrap");
    const canvas = $("botChart");
    if (!wrap || !canvas || wrap.getAttribute("data-chart-bound") === "1") return;
    wrap.setAttribute("data-chart-bound", "1");

    const zIn = $("botChartZoomIn");
    const zOut = $("botChartZoomOut");
    const zReset = $("botChartZoomReset");
    if (zIn) zIn.addEventListener("click", function () { zoomChartView(1.35, 0.5); });
    if (zOut) zOut.addEventListener("click", function () { zoomChartView(0.74, 0.5); });
    if (zReset) {
      zReset.addEventListener("click", function () {
        resetChartView();
        redrawChart();
      });
    }

    wrap.addEventListener(
      "wheel",
      function (ev) {
        if (!chartData) return;
        ev.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const frac = rect.width > 0 ? (ev.clientX - rect.left) / rect.width : 0.5;
        zoomChartView(ev.deltaY < 0 ? 1.18 : 0.84, frac);
      },
      { passive: false }
    );

    let pan = null;
    let touchDist = null;
    let ptr = null;

    function applyPanDelta(clientX, origin) {
      const rect = canvas.getBoundingClientRect();
      const w = origin.hi - origin.lo;
      const delta = rect.width > 0 ? (-(clientX - origin.x) / rect.width) * w : 0;
      chartView = { lo: origin.lo + delta, hi: origin.hi + delta };
      if (chartView.lo < 0) {
        chartView.hi -= chartView.lo;
        chartView.lo = 0;
      }
      if (chartView.hi > 1) {
        chartView.lo -= chartView.hi - 1;
        chartView.hi = 1;
      }
      redrawChart();
    }

    canvas.addEventListener("pointerdown", function (ev) {
      if (ev.pointerType === "touch") return;
      ptr = {
        id: ev.pointerId,
        x: ev.clientX,
        y: ev.clientY,
        moved: false,
        panning: false,
      };
    });

    canvas.addEventListener("pointermove", function (ev) {
      if (!ptr || ptr.id !== ev.pointerId) return;
      const dx = ev.clientX - ptr.x;
      const dy = ev.clientY - ptr.y;
      if (!ptr.moved && Math.hypot(dx, dy) > 6) ptr.moved = true;
      if (ptr.moved && isChartZoomed() && !ptr.panning) {
        ptr.panning = true;
        pan = { x: ptr.x, lo: chartView.lo, hi: chartView.hi };
        wrap.classList.add("is-panning");
        try {
          canvas.setPointerCapture(ev.pointerId);
        } catch {
          /* ignore */
        }
      }
      if (ptr.panning && pan) applyPanDelta(ev.clientX, pan);
    });

    function endPointer(ev) {
      if (!ptr || (ev && ptr.id !== ev.pointerId)) return;
      const wasPan = ptr.panning;
      const x = ev && ev.clientX != null ? ev.clientX : ptr.x;
      const y = ev && ev.clientY != null ? ev.clientY : ptr.y;
      if (ptr.panning) {
        try {
          canvas.releasePointerCapture(ptr.id);
        } catch {
          /* ignore */
        }
      }
      wrap.classList.remove("is-panning");
      pan = null;
      const tap = ptr;
      ptr = null;
      if (wasPan || tap.moved) return;
      const hit = pickMarkAt(x, y);
      if (hit) {
        ev && ev.preventDefault && ev.preventDefault();
        showTradeDetail(hit.mark, x, y);
      } else {
        hideTradeTip();
      }
    }

    canvas.addEventListener("pointerup", endPointer);
    canvas.addEventListener("pointercancel", function (ev) {
      ptr = null;
      pan = null;
      wrap.classList.remove("is-panning");
      try {
        canvas.releasePointerCapture(ev.pointerId);
      } catch {
        /* ignore */
      }
    });

    /* Desktop click fallback (some browsers skip pointerup→click quirks) */
    canvas.addEventListener("click", function (ev) {
      if (ev.pointerType === "touch") return;
      const hit = pickMarkAt(ev.clientX, ev.clientY);
      if (hit) {
        ev.preventDefault();
        ev.stopPropagation();
        showTradeDetail(hit.mark, ev.clientX, ev.clientY);
      }
    });

    wrap.addEventListener(
      "touchstart",
      function (ev) {
        if (ev.touches.length === 2) {
          const dx = ev.touches[0].clientX - ev.touches[1].clientX;
          const dy = ev.touches[0].clientY - ev.touches[1].clientY;
          touchDist = Math.hypot(dx, dy);
          pan = null;
        } else if (ev.touches.length === 1) {
          ptr = {
            x: ev.touches[0].clientX,
            y: ev.touches[0].clientY,
            moved: false,
            panning: false,
          };
          if (isChartZoomed()) {
            pan = { x: ptr.x, lo: chartView.lo, hi: chartView.hi };
          }
        }
      },
      { passive: true }
    );

    wrap.addEventListener(
      "touchmove",
      function (ev) {
        if (ev.touches.length === 2 && touchDist != null) {
          ev.preventDefault();
          const dx = ev.touches[0].clientX - ev.touches[1].clientX;
          const dy = ev.touches[0].clientY - ev.touches[1].clientY;
          const dist = Math.hypot(dx, dy);
          const factor = dist / touchDist;
          if (Math.abs(factor - 1) > 0.02) {
            const rect = canvas.getBoundingClientRect();
            const midX = (ev.touches[0].clientX + ev.touches[1].clientX) * 0.5;
            const frac = rect.width > 0 ? (midX - rect.left) / rect.width : 0.5;
            zoomChartView(factor, frac);
            touchDist = dist;
          }
          if (ptr) ptr.moved = true;
        } else if (pan && ev.touches.length === 1 && isChartZoomed()) {
          ev.preventDefault();
          if (ptr) {
            const d = Math.hypot(ev.touches[0].clientX - ptr.x, ev.touches[0].clientY - ptr.y);
            if (d > 6) ptr.moved = true;
          }
          applyPanDelta(ev.touches[0].clientX, pan);
          wrap.classList.add("is-panning");
        }
      },
      { passive: false }
    );

    wrap.addEventListener(
      "touchend",
      function (ev) {
        const wasPinch = touchDist != null;
        touchDist = null;
        wrap.classList.remove("is-panning");
        if (wasPinch || (ptr && ptr.moved) || !ptr) {
          pan = null;
          ptr = null;
          return;
        }
        const t = ev.changedTouches && ev.changedTouches[0];
        const x = t ? t.clientX : ptr.x;
        const y = t ? t.clientY : ptr.y;
        pan = null;
        ptr = null;
        const hit = pickMarkAt(x, y);
        if (hit) showTradeDetail(hit.mark, x, y);
        else hideTradeTip();
      },
      { passive: true }
    );

    document.addEventListener("pointerdown", function (ev) {
      const tip = $("botTradeTip");
      if (!tip || tip.hidden) return;
      if (wrap.contains(ev.target) || tip.contains(ev.target)) return;
      hideTradeTip();
    });

    root.addEventListener("resize", function () {
      if (chartData) redrawChart();
    });
  }

  let daysOverride = null;

  function nearestDayChip(n) {
    const chips = [7, 30, 90];
    const x = Number(n) || 30;
    for (let i = 0; i < chips.length; i += 1) {
      if (chips[i] >= x - 0.5) return chips[i];
    }
    return chips[chips.length - 1];
  }

  function readForm() {
    const chipDays = Number(
      document.querySelector(".bot-days.is-on") && document.querySelector(".bot-days.is-on").getAttribute("data-days")
    );
    const days = Number.isFinite(daysOverride) && daysOverride > 0 ? daysOverride : chipDays || 30;
    return {
      symbol: ($("botSymbol") && $("botSymbol").value) || "BTCUSDT",
      lower: Number($("botLower") && $("botLower").value),
      upper: Number($("botUpper") && $("botUpper").value),
      grids: Number($("botGrids") && $("botGrids").value),
      leverage:
        Number(
          document.querySelector(".bot-lev.is-on") && document.querySelector(".bot-lev.is-on").getAttribute("data-lev")
        ) || 1,
      geo: !!(
        document.querySelector(".bot-mode.is-on") &&
        document.querySelector(".bot-mode.is-on").getAttribute("data-mode") === "geo"
      ),
      days: days,
    };
  }

  function setLev(n) {
    document.querySelectorAll(".bot-lev").forEach(function (b) {
      b.classList.toggle("is-on", Number(b.getAttribute("data-lev")) === Number(n));
    });
  }

  function setDays(n, keepOverride) {
    if (!keepOverride) daysOverride = null;
    const chip = nearestDayChip(n);
    document.querySelectorAll(".bot-days").forEach(function (b) {
      b.classList.toggle("is-on", Number(b.getAttribute("data-days")) === Number(chip));
    });
    resetChartView();
  }

  function setMode(geo) {
    document.querySelectorAll(".bot-mode").forEach(function (b) {
      const isGeo = b.getAttribute("data-mode") === "geo";
      b.classList.toggle("is-on", !!geo === isGeo);
    });
  }

  function fmtGridStep(v) {
    const x = Math.abs(Number(v));
    if (!Number.isFinite(x) || x === 0) return "";
    if (x >= 100) return Number(v).toFixed(1);
    if (x >= 1) return Number(v).toFixed(2);
    if (x >= 0.01) return Number(v).toFixed(4);
    return Number(v).toFixed(6);
  }

  function paintGridStep() {
    const el = $("botGridStep");
    if (!el) return;
    const lo = Number($("botLower") && $("botLower").value);
    const hi = Number($("botUpper") && $("botUpper").value);
    const n = Math.max(2, Math.round(Number($("botGrids") && $("botGrids").value) || 2));
    if (!(hi > lo)) {
      el.textContent = "";
      return;
    }
    el.textContent = fmtGridStep((hi - lo) / (n - 1));
  }

  let modeHintT = 0;
  function flashModeHint(geo) {
    const el = $("botModeHint");
    if (!el) return;
    el.hidden = false;
    el.textContent = geo
      ? t("botGeoHint", "越往上，每一格隔得越寬")
      : t("botArithHint", "每一格隔開的價錢一樣多");
    clearTimeout(modeHintT);
    modeHintT = setTimeout(function () {
      el.hidden = true;
    }, 3200);
  }

  const kpiPrev = { apy: null, trades: null, sharpe: null, mdd: null };
  const kpiRaf = {};

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  function animateKpi(el, from, to, opts) {
    if (!el) return;
    const id = el.id;
    if (kpiRaf[id]) {
      cancelAnimationFrame(kpiRaf[id]);
      kpiRaf[id] = 0;
    }
    const fmt = opts.fmt;
    const shouldFlash = from != null && Number.isFinite(from) && from !== to;
    if (shouldFlash && root.QAUi) root.QAUi.flash(el, !!opts.down);
    if (from == null || !Number.isFinite(from) || from === to) {
      el.textContent = fmt(to);
      return;
    }
    const start = performance.now();
    const dur = Math.min(1170, 540 + Math.abs(to - from) * 18);
    const step = function (now) {
      const t = Math.min(1, (now - start) / dur);
      const v = from + (to - from) * easeOutCubic(t);
      el.textContent = fmt(v);
      if (t < 1) {
        kpiRaf[id] = requestAnimationFrame(step);
      } else {
        el.textContent = fmt(to);
        kpiRaf[id] = 0;
      }
    };
    kpiRaf[id] = requestAnimationFrame(step);
  }

  function paintStats(res) {
    const apy = $("botApy");
    const n = $("botTrades");
    const sh = $("botSharpe");
    const dd = $("botDd");
    const lab = apy && apy.parentElement && apy.parentElement.querySelector(".bot-kpi-lab");
    if (!res || !res.ok) {
      kpiPrev.apy = null;
      kpiPrev.trades = null;
      kpiPrev.sharpe = null;
      kpiPrev.mdd = null;
      if (apy) apy.textContent = "—";
      if (n) n.textContent = "—";
      if (sh) sh.textContent = "—";
      if (dd) dd.textContent = "—";
      if (lab) lab.textContent = t("botApy", "區間報酬率");
      return;
    }
    const periodVal = Number.isFinite(res.periodRet) ? res.periodRet : res.last - 1;
    const daysLab = Number.isFinite(res.days) ? Math.max(1, Math.round(res.days)) : null;
    if (lab) {
      lab.textContent =
        t("botApy", "區間報酬率") + (daysLab ? " · " + daysLab + "d" : "");
    }
    let changed = false;
    if (apy && periodVal !== kpiPrev.apy) {
      changed = true;
      const prev = kpiPrev.apy;
      animateKpi(apy, prev, periodVal, {
        fmt: function (v) {
          return fmtPct(v, 1);
        },
        down: Number.isFinite(prev) && periodVal < prev,
      });
      apy.className = "bot-kpi-val " + (periodVal >= 0 ? "is-up" : "is-down");
      kpiPrev.apy = periodVal;
    }
    if (n && res.trades !== kpiPrev.trades) {
      changed = true;
      const prev = kpiPrev.trades;
      animateKpi(n, prev, res.trades, {
        fmt: function (v) {
          return String(Math.round(v));
        },
        down: Number.isFinite(prev) && res.trades < prev,
      });
      kpiPrev.trades = res.trades;
    }
    if (sh && res.sharpe !== kpiPrev.sharpe) {
      changed = true;
      const prev = kpiPrev.sharpe;
      animateKpi(sh, prev, res.sharpe, {
        fmt: function (v) {
          return Number.isFinite(v) ? v.toFixed(2) : "—";
        },
        down: Number.isFinite(prev) && res.sharpe < prev,
      });
      sh.className = "bot-kpi-val is-gold";
      kpiPrev.sharpe = res.sharpe;
    }
    if (dd && res.mdd !== kpiPrev.mdd) {
      changed = true;
      const prev = kpiPrev.mdd;
      animateKpi(dd, prev, res.mdd, {
        fmt: function (v) {
          return Number.isFinite(v) ? (v * 100).toFixed(1) + "%" : "—";
        },
        down: Number.isFinite(prev) && res.mdd < prev,
      });
      dd.className = "bot-kpi-val is-down";
      kpiPrev.mdd = res.mdd;
    }
    if (changed) vibrateLite();
    chartData = {
      eq: res.equity,
      marks: res.marks,
      bandActive: res.bandActive,
    };
    resetChartView();
    redrawChart();
  }

  function vibrateLite() {
    /* Site-wide 10ms press haptic lives in nav.js */
  }

  function scrollToResults() {
    const el = $("botStats");
    if (!el) return;
    if (window.matchMedia && window.matchMedia("(max-width: 900px)").matches) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  let runSeq = 0;
  async function runBacktest() {
    const seq = ++runSeq;
    const status = $("botStatus");
    if (status) status.textContent = t("botRunning", "回測運算中…");
    try {
      const cfg = readForm();
      const bars = await loadBars(cfg.symbol, cfg.days);
      if (seq !== runSeq) return;
      const res = simulate(bars, cfg);
      if (seq !== runSeq) return;
      paintStats(res);
      paintGridStep();
      if (status) {
        status.textContent = res.ok
          ? t("botDone", "已用真實 K 線完成本機回測（含 4bps 來回成本）")
          : t("botFail", "K 線不足，請稍後再試");
      }
      if (res.ok) scrollToResults();
    } catch (err) {
      if (seq !== runSeq) return;
      if (status) status.textContent = t("botFail", "K 線不足，請稍後再試");
    }
  }

  function debounce(fn, ms) {
    let tmr = 0;
    return function () {
      clearTimeout(tmr);
      tmr = setTimeout(fn, ms);
    };
  }

  const runDebounced = debounce(runBacktest, 100);

  async function seedBandFromSpot() {
    const cfg = readForm();
    const bars = await loadBars(cfg.symbol, cfg.days);
    if (!bars.length) return;
    const px = Number(bars[bars.length - 1].close);
    if (!(px > 0)) return;
    if ($("botLower") && !$("botLower").getAttribute("data-lock")) {
      $("botLower").value = (px * 0.88).toFixed(px >= 100 ? 1 : 4);
    }
    if ($("botUpper") && !$("botUpper").getAttribute("data-lock")) {
      $("botUpper").value = (px * 1.12).toFixed(px >= 100 ? 1 : 4);
    }
    syncBandTrack();
    paintGridStep();
  }

  function ensureSymbolOption(sym) {
    const sel = $("botSymbol");
    if (!sel || !sym) return;
    const v = String(sym).toUpperCase();
    let found = false;
    for (let i = 0; i < sel.options.length; i += 1) {
      if (String(sel.options[i].value).toUpperCase() === v) found = true;
    }
    if (!found) {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v.replace(/USDT$/i, "/USDT");
      sel.appendChild(opt);
    }
    sel.value = v;
  }

  function loadPreset(id) {
    const p = DYNAMIC_PRESETS[id] || PRESETS[id];
    if (!p) return;
    ensureSymbolOption(p.symbol);
    setLev(p.leverage);
    daysOverride = Number(p.days) > 0 ? Number(p.days) : 30;
    setDays(daysOverride, true);
    setMode(p.geo);
    if ($("botGrids")) {
      $("botGrids").value = p.grids;
      if ($("botGridsOut")) $("botGridsOut").textContent = String(p.grids);
    }
    loadBars(p.symbol, daysOverride).then(function (bars) {
      const px = bars.length ? Number(bars[bars.length - 1].close) : 0;
      if (px > 0) {
        const lo = Number.isFinite(p.lower) ? p.lower : px * p.lowerMult;
        const hi = Number.isFinite(p.upper) ? p.upper : px * p.upperMult;
        if ($("botLower")) {
          $("botLower").value = Number(lo).toFixed(px >= 100 ? 1 : 4);
          $("botLower").setAttribute("data-lock", "1");
        }
        if ($("botUpper")) {
          $("botUpper").value = Number(hi).toFixed(px >= 100 ? 1 : 4);
          $("botUpper").setAttribute("data-lock", "1");
        }
        syncBandTrack();
      }
      paintGridStep();
      runBacktest();
    });
  }

  function gridRetOf(row) {
    const m = row.metrics || {};
    let r = Number(row.return_pct);
    if (!Number.isFinite(r)) r = Number(m.return_pct);
    if (!Number.isFinite(r)) return -Infinity;
    const pct = Math.abs(r) <= 5 ? r * 100 : r;
    if (!(pct > -80) || pct > 400) return -Infinity;
    return r;
  }

  function isGridStrategy(row) {
    if (!row || typeof row !== "object") return false;
    if (String(row.strategy_type || "").toUpperCase() === "GRID") return true;
    if (row.subtype && /GRID/i.test(String(row.subtype))) return true;
    const blob = [row.title, row.name, row.id, row.copy].join(" ").toLowerCase();
    return /grid|網格|网格/.test(blob);
  }

  function fmtRetPct(frac) {
    if (!Number.isFinite(frac)) return "—";
    const pct = Math.abs(frac) <= 5 ? frac * 100 : frac;
    const sign = pct > 0 ? "+" : "";
    return sign + pct.toFixed(1) + "%";
  }

  function renderTopGridCards(rows) {
    const grid = $("botPresetGrid");
    const sel = $("botPresetSelect");
    if (!grid) return;
    Object.keys(DYNAMIC_PRESETS).forEach(function (k) {
      delete DYNAMIC_PRESETS[k];
    });
    const top = (rows || []).slice(0, 3);
    if (!top.length) {
      // Fallback: classic eth/btc/sol presets
      ["eth", "btc", "sol"].forEach(function (id) {
        const p = PRESETS[id];
        DYNAMIC_PRESETS[id] = Object.assign({ title: id.toUpperCase() + " grid" }, p);
      });
      top.push(
        { id: "eth", title: "ETH 智能震盪網格", return_pct: null, _fallback: "eth" },
        { id: "btc", title: "BTC 寬幅防破網格", return_pct: null, _fallback: "btc" },
        { id: "sol", title: "SOL 突破動量網格", return_pct: null, _fallback: "sol" }
      );
    }
    const cards = [];
    const opts = ['<option value="" data-i18n="botPresetNone">' + t("botPresetNone", "— 手動調參 —") + "</option>"];
    top.forEach(function (row, i) {
      const pid = row._fallback || "g" + i;
      const gp = row.grid_params || {};
      const symRaw = String(row.symbol || gp.symbol || "ETH/USDT");
      const symbol = symRaw.replace("/", "").replace("-", "");
      const lev = clamp(Number(gp.leverage) || 5, 1, 10);
      const grids = clamp(Number(gp.grids_count) || 60, 20, 150);
      const geo = String(gp.grid_mode || "").toLowerCase() === "geometric";
      const days = clamp(Number(row.period_days) || Number(row.backtest_days) || Number(row.metrics && row.metrics.period_days) || 30, 7, 90);
      const preset = {
        symbol: /USDT$/i.test(symbol) ? symbol : symbol + "USDT",
        leverage: lev,
        grids: grids,
        geo: geo,
        days: days,
        lowerMult: 0.85,
        upperMult: 1.15,
        title: row.title || row.name || row.subtype || pid,
      };
      if (Number.isFinite(Number(gp.lower_price)) && Number(gp.lower_price) > 0) {
        preset.lower = Number(gp.lower_price);
      }
      if (Number.isFinite(Number(gp.upper_price)) && Number(gp.upper_price) > 0) {
        preset.upper = Number(gp.upper_price);
      }
      if (row._fallback && PRESETS[row._fallback]) {
        Object.assign(preset, PRESETS[row._fallback]);
      }
      DYNAMIC_PRESETS[pid] = preset;
      const retTxt = fmtRetPct(gridRetOf(row));
      const sub = row.subtype || "GRID";
      const title = preset.title;
      cards.push(
        '<article class="bot-card">' +
          "<h3>" +
          title +
          "</h3>" +
          "<p>" +
          sub +
          " · " +
          t("botApy", "區間報酬率") +
          " " +
          retTxt +
          "</p>" +
          '<div class="bot-card-meta">' +
          preset.symbol.replace("USDT", "/USDT") +
          " · " +
          lev +
          "x · " +
          (geo ? t("botGeo", "等比") : t("botArith", "等差")) +
          " · " +
          days +
          "d</div>" +
          '<div class="bot-card-actions">' +
          '<button type="button" data-bot-preset="' +
          pid +
          '">' +
          t("botLoad", "一鍵載入參數") +
          "</button>" +
          '<button type="button" class="solid" data-bot-deploy="' +
          pid +
          '">' +
          t("botDeployCard", "一鍵部署") +
          "</button>" +
          "</div></article>"
      );
      opts.push('<option value="' + pid + '">' + title + " (" + retTxt + ")</option>");
    });
    grid.innerHTML = cards.join("");
    if (sel) sel.innerHTML = opts.join("");
    const top3Row = $("botAiTop3Row");
    if (top3Row) {
      top3Row.innerHTML = top
        .map(function (row, i) {
          const pid = row._fallback || "g" + i;
          const preset = DYNAMIC_PRESETS[pid] || {};
          const retTxt = fmtRetPct(gridRetOf(row));
          const title = preset.title || row.title || row.name || pid;
          const short = String(title).length > 16 ? String(title).slice(0, 14) + "…" : title;
          return (
            '<button type="button" class="bot-ai-top3-btn" data-bot-preset="' +
            pid +
            '"><span>' +
            short +
            "</span><small>" +
            retTxt +
            "</small></button>"
          );
        })
        .join("");
      top3Row.querySelectorAll("[data-bot-preset]").forEach(function (b) {
        b.addEventListener("click", function () {
          const id = b.getAttribute("data-bot-preset");
          loadPreset(id);
          if (sel && id) sel.value = id;
        });
      });
    }
    grid.querySelectorAll("[data-bot-preset]").forEach(function (b) {
      b.addEventListener("click", function () {
        const id = b.getAttribute("data-bot-preset");
        loadPreset(id);
        if (sel && id) sel.value = id;
      });
    });
    grid.querySelectorAll("[data-bot-deploy]").forEach(function (b) {
      b.addEventListener("click", function () {
        const id = b.getAttribute("data-bot-deploy");
        if (id) loadPreset(id);
        openDeployModal();
      });
    });
  }

  const DEAD_GRID_SYMS = { FETUSDT: true };

  function normGridSym(raw) {
    return String(raw || "")
      .replace("/", "")
      .replace("-", "")
      .replace(/\s/g, "")
      .toUpperCase();
  }

  function isListedGrid(row) {
    if (!isGridStrategy(row)) return false;
    if (row.listed === false || row.listed === "false") return false;
    const st = String(row.status || "").toUpperCase();
    if (/DELIST|OFFLINE|ARCHIVED|DISABLED|RETIRED|UNLIST/.test(st)) return false;
    const gp = row.grid_params || {};
    const sym = normGridSym(row.symbol || gp.symbol || (row.symbols && row.symbols[0]) || "");
    if (!sym) return false;
    if (DEAD_GRID_SYMS[sym] || DEAD_GRID_SYMS[sym.replace(/USDT$/, "") + "USDT"]) return false;
    if (/^FET/.test(sym)) return false;
    return true;
  }

  function mergeStrategyRows(a, b) {
    const map = {};
    (a || []).concat(b || []).forEach(function (row) {
      if (!row || typeof row !== "object") return;
      const id = String(row.id || row.engine || "");
      if (!id) return;
      const prev = map[id];
      if (!prev) {
        map[id] = row;
        return;
      }
      const ta = Date.parse(row.replaced_at || row.updated_at || 0) || 0;
      const tb = Date.parse(prev.replaced_at || prev.updated_at || 0) || 0;
      if (ta >= tb) map[id] = row;
    });
    return Object.keys(map).map(function (k) {
      return map[k];
    });
  }

  async function fetchStrategyPack(url, ms) {
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = ctrl && ms ? setTimeout(function () { ctrl.abort(); }, ms) : null;
    try {
      const res = await fetch(url, {
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: ctrl ? ctrl.signal : undefined,
      });
      if (!res.ok) return [];
      const data = await res.json();
      const rows = Array.isArray(data.strategies)
        ? data.strategies
        : Array.isArray(data.items)
          ? data.items
          : Array.isArray(data)
            ? data
            : [];
      return rows;
    } catch {
      return [];
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function listedGridSorted(rows) {
    let grids = (rows || []).filter(isListedGrid);
    if (root.QAPipeline && typeof root.QAPipeline.collapseCohorts === "function") {
      try {
        grids = root.QAPipeline.collapseCohorts(grids) || grids;
      } catch {
        /* keep */
      }
    }
    grids.sort(function (a, b) {
      const ra = gridRetOf(b) - gridRetOf(a);
      if (ra !== 0) return ra;
      const ta = Date.parse(b.replaced_at || b.updated_at || 0) || 0;
      const tb = Date.parse(a.replaced_at || a.updated_at || 0) || 0;
      return ta - tb;
    });
    return grids;
  }

  async function loadTopGridStrategies() {
    const stamp = Date.now();
    const cfg = root.QUANT_CONFIG || {};
    let rows = await fetchStrategyPack("./strategies.json?_=" + stamp, 8000);
    if (!rows.length) rows = await fetchStrategyPack("/strategies.json?_=" + stamp, 4000);
    renderTopGridCards(listedGridSorted(rows));
    mergeLiveStrategyPacks(rows, stamp, cfg);
  }

  function mergeLiveStrategyPacks(baseRows, stamp, cfg) {
    const remotes = [];
    const hub = String((cfg || {}).hubApiBase || "").replace(/\/$/, "");
    const api = String((cfg || {}).apiBase || "").replace(/\/$/, "");
    if (hub) remotes.push(fetchStrategyPack(hub + "/api/strategies?t=" + stamp, 4500));
    if (api) remotes.push(fetchStrategyPack(api + "/api/strategies?t=" + stamp, 4500));
    if (root.QAPipeline && typeof root.QAPipeline.fetchRows === "function") {
      remotes.push(
        Promise.resolve()
          .then(function () {
            return root.QAPipeline.fetchRows();
          })
          .catch(function () {
            return [];
          })
      );
    }
    if (!remotes.length) return;
    Promise.all(remotes).then(function (extra) {
      let merged = baseRows;
      let added = false;
      extra.forEach(function (pack) {
        if (pack && pack.length) {
          merged = mergeStrategyRows(merged, pack);
          added = true;
        }
      });
      if (added) renderTopGridCards(listedGridSorted(merged));
    });
  }

  let topRefreshTimer = 0;
  function scheduleTopRefresh() {
    if (topRefreshTimer) return;
    topRefreshTimer = setInterval(function () {
      loadTopGridStrategies();
    }, 10 * 60 * 1000);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") loadTopGridStrategies();
    });
  }

  /* ---- AI tune (quota: guest 3 / logged-in 10 / paid unlimited) ---- */
  function aiTier() {
    const id = root.QAIdentity;
    if (!id || typeof id.loggedIn !== "function" || !id.loggedIn()) return "guest";
    if (id.seat && id.seat() === "vip") return "vip";
    return "free";
  }

  function quotaCap(tier) {
    if (tier === "vip") return Infinity;
    if (tier === "free") return 10;
    return 3;
  }

  function todayKey() {
    return new Date().toISOString().slice(0, 10);
  }

  function readAiQuota() {
    try {
      const raw = localStorage.getItem(AI_QUOTA_KEY);
      if (!raw) return { day: todayKey(), used: 0 };
      const q = JSON.parse(raw);
      if (!q || q.day !== todayKey()) return { day: todayKey(), used: 0 };
      return { day: q.day, used: Number(q.used) || 0 };
    } catch {
      return { day: todayKey(), used: 0 };
    }
  }

  function saveAiQuota(used) {
    try {
      localStorage.setItem(AI_QUOTA_KEY, JSON.stringify({ day: todayKey(), used: used }));
    } catch {
      /* ignore */
    }
  }

  function paintAiQuota() {
    const el = $("botAiQuota");
    if (!el) return;
    const tier = aiTier();
    const cap = quotaCap(tier);
    if (!Number.isFinite(cap)) {
      el.textContent = t("botAiRemainVip", "今日 AI 調參不限次數");
      return;
    }
    const used = readAiQuota().used;
    const left = Math.max(0, cap - used);
    el.textContent = t("botAiRemainLeft", "今日還可 AI 調參 {n} 次").replace("{n}", String(left));
  }

  function showAiLimit(code) {
    const modal = $("aiLimitModal");
    const title = $("aiLimitTitle");
    const text = $("aiLimitMsg");
    const cta = $("aiLimitCta");
    if (code === "guest") {
      if (title) title.textContent = t("botAiLimitGuestTitle", "今日 AI 次數用完");
      if (text) text.textContent = t("botAiLimitGuestMsg", "訪客每天可 AI 調參 3 次。登入後每天 10 次；付費會員不限。普通回測不限次數。");
      if (cta) {
        cta.href = "./member.html#login";
        cta.textContent = t("botAiLimitLogin", "去登入");
      }
    } else {
      if (title) title.textContent = t("botAiLimitFreeTitle", "今日 AI 次數用完");
      if (text) text.textContent = t("botAiLimitFreeMsg", "已登入用戶每天可 AI 調參 10 次。開通會員後不限次數。普通回測仍可隨意使用。");
      if (cta) {
        cta.href = "./member.html#pay";
        cta.textContent = t("botAiLimitPay", "開通會員");
      }
    }
    if (modal) modal.classList.add("show");
  }

  function consumeAiQuota() {
    const tier = aiTier();
    const cap = quotaCap(tier);
    if (!Number.isFinite(cap)) return true;
    const q = readAiQuota();
    if (q.used >= cap) {
      showAiLimit(tier === "guest" ? "guest" : "free");
      return false;
    }
    saveAiQuota(q.used + 1);
    paintAiQuota();
    return true;
  }

  function parseAiPrompt(text) {
    const s = String(text || "");
    const out = {};
    const symMap = [
      [/BTC|比特幣|比特币/i, "BTCUSDT"],
      [/ETH|以太/i, "ETHUSDT"],
      [/SOL|索拉娜|索拉/i, "SOLUSDT"],
      [/BNB/i, "BNBUSDT"],
      [/XRP|瑞波/i, "XRPUSDT"],
    ];
    for (let i = 0; i < symMap.length; i += 1) {
      if (symMap[i][0].test(s)) {
        out.symbol = symMap[i][1];
        break;
      }
    }
    const lev = s.match(/(\d+)\s*[xX倍]/);
    if (lev) out.leverage = clamp(lev[1], 1, 20);
    else if (/現貨|现货|spot/i.test(s)) out.leverage = 1;
    const grids = s.match(/(\d+)\s*格/);
    if (grids) out.grids = clamp(grids[1], 20, 150);
    if (/等比|幾何|几何/i.test(s)) out.geo = true;
    if (/等差|算術|算术/i.test(s)) out.geo = false;
    if (/7\s*天|一週|一周/i.test(s)) out.days = 7;
    else if (/90\s*天|三個?月/i.test(s)) out.days = 90;
    else if (/30\s*天|一個?月/i.test(s)) out.days = 30;
    if (/寬|宽|防破|牛熊/i.test(s)) {
      out.lowerMult = 0.72;
      out.upperMult = 1.28;
      out.grids = out.grids || 40;
      out.leverage = out.leverage || 3;
    } else if (/密|震盪|震荡|高頻|高频/i.test(s)) {
      out.lowerMult = 0.88;
      out.upperMult = 1.12;
      out.grids = out.grids || 80;
      out.leverage = out.leverage || 5;
    } else if (/波動|波动|動量|动量|突破/i.test(s)) {
      out.lowerMult = 0.78;
      out.upperMult = 1.22;
      out.grids = out.grids || 110;
      out.leverage = out.leverage || 7;
      out.geo = out.geo != null ? out.geo : true;
    } else {
      out.lowerMult = 0.88;
      out.upperMult = 1.12;
    }
    return out;
  }

  async function applyAiTune() {
    const box = $("botAiPrompt");
    const prompt = String((box && box.value) || "").trim();
    if (prompt.length < 4) {
      if ($("botStatus")) $("botStatus").textContent = t("botAiNeed", "請先用白話寫一句想怎麼調網格");
      return;
    }
    if (!consumeAiQuota()) return;
    vibrateLite();
    const hint = parseAiPrompt(prompt);
    if (hint.symbol && $("botSymbol")) $("botSymbol").value = hint.symbol;
    if (hint.leverage) setLev(hint.leverage);
    if (hint.days) setDays(hint.days);
    if (hint.geo != null) setMode(!!hint.geo);
    if (hint.grids && $("botGrids")) {
      $("botGrids").value = hint.grids;
      if ($("botGridsOut")) $("botGridsOut").textContent = String(hint.grids);
    }
    const cfg = readForm();
    const bars = await loadBars(cfg.symbol, cfg.days);
    const px = bars.length ? Number(bars[bars.length - 1].close) : 0;
    if (px > 0) {
      const lo = hint.lowerMult || 0.88;
      const hi = hint.upperMult || 1.12;
      if ($("botLower")) {
        $("botLower").value = (px * lo).toFixed(px >= 100 ? 1 : 4);
        $("botLower").setAttribute("data-lock", "1");
      }
      if ($("botUpper")) {
        $("botUpper").value = (px * hi).toFixed(px >= 100 ? 1 : 4);
        $("botUpper").setAttribute("data-lock", "1");
      }
      syncBandTrack();
    }
    if ($("botStatus")) $("botStatus").textContent = t("botAiApplied", "AI 已套用參數，正在回測…");
    await runBacktest();
  }

  function openDeployModal() {
    const bg = $("botDeployBg");
    if (bg) bg.classList.add("show");
  }

  function closeDeployModal() {
    const bg = $("botDeployBg");
    if (bg) bg.classList.remove("show");
  }

  let bandLimits = null;

  function bandSpan() {
    const lo = Number($("botLower") && $("botLower").value);
    const hi = Number($("botUpper") && $("botUpper").value);
    if (bandLimits && bandLimits.max > bandLimits.min) {
      return { min: bandLimits.min, max: bandLimits.max, lo: lo, hi: hi };
    }
    const mid =
      Number.isFinite(lo) && Number.isFinite(hi) && hi > lo
        ? (lo + hi) / 2
        : Number.isFinite(lo)
          ? lo
          : 1;
    const width =
      Number.isFinite(lo) && Number.isFinite(hi) && hi > lo ? hi - lo : Math.abs(mid) * 0.2;
    const pad = Math.max(width * 1.5, Math.abs(mid) * 0.12, 1e-6);
    const min = Math.max(1e-8, mid - pad * 2);
    let max = mid + pad * 2;
    if (mid >= BAND_PRICE_CAP) {
      max = Math.min(max, mid * 1.25);
    } else {
      max = Math.min(max, BAND_PRICE_CAP);
    }
    if (Number.isFinite(hi) && hi > max) max = hi;
    if (!(max > min)) max = min * 1.05;
    return { min: min, max: max, lo: lo, hi: hi };
  }

  function syncBandTrack() {
    const fill = $("botBandFill");
    const thumbL = $("botBandThumbL");
    const thumbR = $("botBandThumbR");
    if (!fill || !thumbL || !thumbR) return;
    const span = bandSpan();
    if (!(span.max > span.min) || !Number.isFinite(span.lo) || !Number.isFinite(span.hi) || !(span.hi > span.lo)) return;
    const p1 = ((span.lo - span.min) / (span.max - span.min)) * 100;
    const p2 = ((span.hi - span.min) / (span.max - span.min)) * 100;
    const left = Math.max(0, Math.min(100, p1));
    const right = Math.max(left + 0.5, Math.min(100, p2));
    fill.style.left = left + "%";
    fill.style.width = right - left + "%";
    thumbL.style.left = left + "%";
    thumbR.style.left = right + "%";
  }

  function setBandFromRatio(which, ratio) {
    const span = bandSpan();
    if (!(span.max > span.min)) return;
    const v = span.min + Math.max(0, Math.min(1, ratio)) * (span.max - span.min);
    const loEl = $("botLower");
    const hiEl = $("botUpper");
    if (!loEl || !hiEl) return;
    let lo = Number(loEl.value);
    let hi = Number(hiEl.value);
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || !(hi > lo)) {
      lo = span.min + (span.max - span.min) * 0.25;
      hi = span.min + (span.max - span.min) * 0.75;
    }
    const digits = Math.max(lo, hi) >= 100 ? 1 : 4;
    const gap = Math.max((hi - lo) * 0.02, (span.max - span.min) * 0.008);
    if (which === "lo") {
      lo = Math.min(Math.max(span.min, v), hi - gap);
      loEl.value = lo.toFixed(digits);
      loEl.setAttribute("data-lock", "1");
    } else {
      hi = Math.max(Math.min(span.max, v), lo + gap);
      hiEl.value = hi.toFixed(digits);
      hiEl.setAttribute("data-lock", "1");
    }
    syncBandTrack();
    paintGridStep();
    runDebounced();
  }

  function bindBandDrag() {
    const track = $("botBandTrack");
    if (!track || track.getAttribute("data-bound") === "1") return;
    track.setAttribute("data-bound", "1");
    let drag = null;

    function ratioFromEvent(ev) {
      const rect = track.getBoundingClientRect();
      if (!(rect.width > 0)) return 0;
      const x =
        (ev.clientX != null
          ? ev.clientX
          : (ev.touches && ev.touches[0] && ev.touches[0].clientX) || 0) - rect.left;
      return Math.max(0, Math.min(1, x / rect.width));
    }

    function onMove(ev) {
      if (!drag) return;
      ev.preventDefault();
      setBandFromRatio(drag.which, ratioFromEvent(ev));
    }

    function onUp(ev) {
      if (!drag) return;
      try {
        if (drag.el && ev.pointerId != null) drag.el.releasePointerCapture(ev.pointerId);
      } catch (e) {
        /* ignore */
      }
      drag = null;
      bandLimits = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      syncBandTrack();
    }

    function start(which, el, ev) {
      const span = bandSpan();
      bandLimits = { min: span.min, max: span.max };
      drag = { which: which, el: el };
      try {
        if (ev.pointerId != null) el.setPointerCapture(ev.pointerId);
      } catch (e) {
        /* ignore */
      }
      setBandFromRatio(which, ratioFromEvent(ev));
      window.addEventListener("pointermove", onMove, { passive: false });
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    }

    const thumbL = $("botBandThumbL");
    const thumbR = $("botBandThumbR");
    if (thumbL) {
      thumbL.addEventListener("pointerdown", function (ev) {
        ev.preventDefault();
        start("lo", thumbL, ev);
      });
    }
    if (thumbR) {
      thumbR.addEventListener("pointerdown", function (ev) {
        ev.preventDefault();
        start("hi", thumbR, ev);
      });
    }
    track.addEventListener("pointerdown", function (ev) {
      if (ev.target === thumbL || ev.target === thumbR) return;
      const ratio = ratioFromEvent(ev);
      const span = bandSpan();
      if (!(span.max > span.min)) return;
      const loR = (span.lo - span.min) / (span.max - span.min);
      const hiR = (span.hi - span.min) / (span.max - span.min);
      const which = Math.abs(ratio - loR) <= Math.abs(ratio - hiR) ? "lo" : "hi";
      start(which, which === "lo" ? thumbL : thumbR, ev);
    });
    syncBandTrack();
  }

  function bind() {
    const g = $("botGrids");
    const go = $("botGridsOut");
    if (g && go) {
      go.textContent = g.value;
      paintGridStep();
      g.addEventListener("input", function () {
        go.textContent = g.value;
        paintGridStep();
        runDebounced();
      });
    }
    ["botLower", "botUpper", "botSymbol"].forEach(function (id) {
      const el = $(id);
      if (!el) return;
      el.addEventListener("change", function () {
        if (id === "botLower" || id === "botUpper") el.setAttribute("data-lock", "1");
        syncBandTrack();
        paintGridStep();
        runDebounced();
      });
      el.addEventListener("input", function () {
        syncBandTrack();
        paintGridStep();
        runDebounced();
      });
    });
    bindBandDrag();
    paintGridStep();
    document.querySelectorAll(".bot-lev").forEach(function (b) {
      b.addEventListener("click", function () {
        setLev(b.getAttribute("data-lev"));
        runDebounced();
      });
    });
    document.querySelectorAll(".bot-days").forEach(function (b) {
      b.addEventListener("click", function () {
        setDays(b.getAttribute("data-days"));
        runBacktest();
      });
    });
    document.querySelectorAll(".bot-mode").forEach(function (b) {
      b.addEventListener("click", function () {
        const geo = b.getAttribute("data-mode") === "geo";
        setMode(geo);
        flashModeHint(geo);
        paintGridStep();
        runDebounced();
      });
    });
    const runBtn = $("botRun");
    if (runBtn) {
      runBtn.addEventListener("click", function () {
        vibrateLite();
        runBacktest();
      });
    }
    const dep = $("botDeploy");
    if (dep) dep.addEventListener("click", openDeployModal);
    document.querySelectorAll("[data-bot-preset]").forEach(function (b) {
      b.addEventListener("click", function () {
        const id = b.getAttribute("data-bot-preset");
        loadPreset(id);
        const sel = $("botPresetSelect");
        if (sel && id) sel.value = id;
      });
    });
    document.querySelectorAll("[data-bot-deploy]").forEach(function (b) {
      b.addEventListener("click", function () {
        const id = b.getAttribute("data-bot-deploy");
        if (id) loadPreset(id);
        openDeployModal();
      });
    });
    const bg = $("botDeployBg");
    if (bg) {
      bg.addEventListener("click", function (ev) {
        if (ev.target === bg || ev.target.getAttribute("data-close-bot") != null) closeDeployModal();
      });
    }
    const goLive = $("botGoLive");
    if (goLive) {
      goLive.addEventListener("click", function () {
        try {
          const draft = {
            at: Date.now(),
            cfg: readForm(),
            uid: ($("botUid") && $("botUid").value) || "",
          };
          root.localStorage.setItem("qa_grid_deploy_draft", JSON.stringify(draft));
        } catch {
          /* ignore */
        }
        closeDeployModal();
        const login = $("btnAuth") || document.getElementById("btnAuth");
        if (login) login.click();
        else location.href = "./member.html#login";
      });
    }

    const chips = $("botAiChips");
    if (chips) {
      chips.addEventListener("click", function (ev) {
        const chip = ev.target.closest("[data-fill-key]");
        const box = $("botAiPrompt");
        if (!chip || !box) return;
        box.value = t(chip.getAttribute("data-fill-key"), chip.textContent || "");
        box.focus();
      });
    }
    const aiGo = $("botAiGo");
    if (aiGo) aiGo.addEventListener("click", applyAiTune);
    const limitClose = $("aiLimitClose");
    if (limitClose) {
      limitClose.addEventListener("click", function () {
        const m = $("aiLimitModal");
        if (m) m.classList.remove("show");
      });
    }
    paintAiQuota();
    root.addEventListener("quant-lang", paintAiQuota);
    bindChartInteraction();
    bindPresetSelect();
    loadTopGridStrategies().finally(function () {
      seedBandFromSpot().then(runBacktest);
    });
    scheduleTopRefresh();
  }

  function bindPresetSelect() {
    const sel = $("botPresetSelect");
    if (!sel || sel.getAttribute("data-bound") === "1") return;
    sel.setAttribute("data-bound", "1");
    sel.addEventListener("change", function () {
      const id = sel.value;
      if (id) loadPreset(id);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind);
  else bind();

  root.QAGridBots = { simulate: simulate, runBacktest: runBacktest, loadPreset: loadPreset };
})(typeof window !== "undefined" ? window : globalThis);
