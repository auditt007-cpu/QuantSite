(function (root) {
  const FEE = 0.0004;
  const CACHE = {};
  const PRESETS = {
    eth: {
      symbol: "ETHUSDT",
      lowerMult: 0.82,
      upperMult: 1.18,
      grids: 80,
      leverage: 5,
      geo: false,
      days: 30,
    },
    btc: {
      symbol: "BTCUSDT",
      lowerMult: 0.72,
      upperMult: 1.28,
      grids: 40,
      leverage: 3,
      geo: false,
      days: 90,
    },
    sol: {
      symbol: "SOLUSDT",
      lowerMult: 0.78,
      upperMult: 1.22,
      grids: 110,
      leverage: 7,
      geo: true,
      days: 30,
    },
  };

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
    if (!bars || bars.length < 8) {
      return { ok: false, reason: "bars" };
    }
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
    let peak = 1;
    let mdd = 0;

    function applyTo(target, px) {
      while (idx < target && idx < L.length - 1) {
        const a = L[idx];
        const b = L[idx + 1];
        const ret = (b - a) / a;
        realized += lot * (ret - 2 * FEE);
        sells += 1;
        idx += 1;
      }
      while (idx > target && idx > 0) {
        realized -= lot * 2 * FEE * 0.5;
        buys += 1;
        idx -= 1;
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
    for (let i = 1; i < bars.length; i += 1) {
      const bar = bars[i];
      const path = [prev, bar.low, bar.high, bar.close];
      let nav = 1;
      for (let p = 1; p < path.length; p += 1) {
        const px = Number(path[p]);
        if (!Number.isFinite(px) || px <= 0) continue;
        nav = applyTo(nearestIdx(L, px), px);
      }
      eq.push({ t: bar.time, v: nav });
      prev = bar.close;
    }

    const last = eq[eq.length - 1].v;
    const days = Math.max(1 / 24, (bars[bars.length - 1].time - bars[0].time) / 86400);
    const apy = (last - 1) * (365 / days);
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
      apy: apy,
      trades: sells,
      buys: buys,
      sharpe: sharpe,
      mdd: Math.abs(mdd),
      equity: eq,
      days: days,
      last: last,
    };
  }

  function periodSpec(days) {
    const d = Number(days) || 30;
    if (d <= 7) return { interval: "15m", limit: 7 * 24 * 4 };
    if (d <= 30) return { interval: "1h", limit: 30 * 24 };
    return { interval: "4h", limit: 90 * 6 };
  }

  async function loadBars(symbol, days) {
    const spec = periodSpec(days);
    const key = symbol + "|" + spec.interval + "|" + spec.limit;
    if (CACHE[key] && Date.now() - CACHE[key].at < 180000) return CACHE[key].bars;
    const feed = root.QAFeed;
    let bars = [];
    if (feed && typeof feed.fetchKlines === "function") {
      try {
        bars = await feed.fetchKlines(symbol, spec.interval, spec.limit);
      } catch {
        bars = [];
      }
    }
    if (!bars.length && root.QAOffline && typeof root.QAOffline.forInterval === "function") {
      bars = root.QAOffline.forInterval(spec.interval);
    }
    if (bars && bars.length) CACHE[key] = { at: Date.now(), bars: bars };
    return bars || [];
  }

  function fmtPct(n, digits) {
    const x = Number(n);
    if (!Number.isFinite(x)) return "—";
    const sign = x > 0 ? "+" : "";
    return sign + (x * 100).toFixed(digits == null ? 1 : digits) + "%";
  }

  function drawEquity(canvas, eq) {
    if (!canvas || !eq || eq.length < 2) return;
    const dpr = Math.min(2, root.devicePixelRatio || 1);
    const w = Math.max(280, canvas.clientWidth || 640);
    const h = Math.max(160, canvas.clientHeight || 200);
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const pad = { l: 8, r: 8, t: 10, b: 8 };
    let mn = Infinity;
    let mx = -Infinity;
    eq.forEach(function (p) {
      if (p.v < mn) mn = p.v;
      if (p.v > mx) mx = p.v;
    });
    if (!(mx > mn)) {
      mx = mn + 0.01;
    }
    const up = eq[eq.length - 1].v >= eq[0].v;
    const col = up ? "#0f7b3a" : "#c2410c";
    ctx.beginPath();
    eq.forEach(function (p, i) {
      const x = pad.l + (i / (eq.length - 1)) * (w - pad.l - pad.r);
      const y = pad.t + (1 - (p.v - mn) / (mx - mn)) * (h - pad.t - pad.b);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();
    const last = eq[eq.length - 1];
    const lx = pad.l + (w - pad.l - pad.r);
    const ly = pad.t + (1 - (last.v - mn) / (mx - mn)) * (h - pad.t - pad.b);
    ctx.beginPath();
    ctx.arc(lx, ly, 3, 0, Math.PI * 2);
    ctx.fillStyle = col;
    ctx.fill();
  }

  function readForm() {
    return {
      symbol: ($("botSymbol") && $("botSymbol").value) || "BTCUSDT",
      lower: Number($("botLower") && $("botLower").value),
      upper: Number($("botUpper") && $("botUpper").value),
      grids: Number($("botGrids") && $("botGrids").value),
      leverage: Number(document.querySelector(".bot-lev.is-on") && document.querySelector(".bot-lev.is-on").getAttribute("data-lev")) || 1,
      geo: !!(document.querySelector(".bot-mode.is-on") && document.querySelector(".bot-mode.is-on").getAttribute("data-mode") === "geo"),
      days: Number(document.querySelector(".bot-days.is-on") && document.querySelector(".bot-days.is-on").getAttribute("data-days")) || 30,
    };
  }

  function setLev(n) {
    document.querySelectorAll(".bot-lev").forEach(function (b) {
      b.classList.toggle("is-on", Number(b.getAttribute("data-lev")) === Number(n));
    });
  }

  function setDays(n) {
    document.querySelectorAll(".bot-days").forEach(function (b) {
      b.classList.toggle("is-on", Number(b.getAttribute("data-days")) === Number(n));
    });
  }

  function setMode(geo) {
    document.querySelectorAll(".bot-mode").forEach(function (b) {
      const isGeo = b.getAttribute("data-mode") === "geo";
      b.classList.toggle("is-on", !!geo === isGeo);
    });
  }

  function paintStats(res) {
    const apy = $("botApy");
    const n = $("botTrades");
    const sh = $("botSharpe");
    const dd = $("botDd");
    if (!res || !res.ok) {
      if (apy) apy.textContent = "—";
      if (n) n.textContent = "—";
      if (sh) sh.textContent = "—";
      if (dd) dd.textContent = "—";
      return;
    }
    if (apy) {
      apy.textContent = fmtPct(res.apy, 1);
      apy.className = "bot-kpi-val " + (res.apy >= 0 ? "is-up" : "is-down");
    }
    if (n) n.textContent = String(res.trades);
    if (sh) sh.textContent = Number.isFinite(res.sharpe) ? res.sharpe.toFixed(2) : "—";
    if (dd) {
      dd.textContent = (res.mdd * 100).toFixed(1) + "%";
      dd.className = "bot-kpi-val is-down";
    }
    drawEquity($("botChart"), res.equity);
  }

  let running = false;
  async function runBacktest() {
    if (running) return;
    running = true;
    const status = $("botStatus");
    if (status) status.textContent = t("botRunning", "回測運算中…");
    try {
      const cfg = readForm();
      const bars = await loadBars(cfg.symbol, cfg.days);
      const res = simulate(bars, cfg);
      paintStats(res);
      if (status) {
        status.textContent = res.ok
          ? t("botDone", "已用真實 K 線完成本地回測（含 4bps 來回成本）")
          : t("botFail", "K 線不足，請稍後再試");
      }
    } catch (err) {
      if (status) status.textContent = t("botFail", "K 線不足，請稍後再試");
    }
    running = false;
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
  }

  function loadPreset(id) {
    const p = PRESETS[id];
    if (!p) return;
    if ($("botSymbol")) $("botSymbol").value = p.symbol;
    setLev(p.leverage);
    setDays(p.days);
    setMode(p.geo);
    if ($("botGrids")) {
      $("botGrids").value = p.grids;
      if ($("botGridsOut")) $("botGridsOut").textContent = String(p.grids);
    }
    loadBars(p.symbol, p.days).then(function (bars) {
      const px = bars.length ? Number(bars[bars.length - 1].close) : 0;
      if (px > 0) {
        if ($("botLower")) {
          $("botLower").value = (px * p.lowerMult).toFixed(px >= 100 ? 1 : 4);
          $("botLower").setAttribute("data-lock", "1");
        }
        if ($("botUpper")) {
          $("botUpper").value = (px * p.upperMult).toFixed(px >= 100 ? 1 : 4);
          $("botUpper").setAttribute("data-lock", "1");
        }
      }
      runBacktest();
    });
  }

  function openDeployModal() {
    const bg = $("botDeployBg");
    if (bg) bg.classList.add("show");
  }

  function closeDeployModal() {
    const bg = $("botDeployBg");
    if (bg) bg.classList.remove("show");
  }

  function bind() {
    const g = $("botGrids");
    const go = $("botGridsOut");
    if (g && go) {
      go.textContent = g.value;
      g.addEventListener("input", function () {
        go.textContent = g.value;
        runDebounced();
      });
    }
    ["botLower", "botUpper", "botSymbol"].forEach(function (id) {
      const el = $(id);
      if (!el) return;
      el.addEventListener("change", function () {
        if (id === "botLower" || id === "botUpper") el.setAttribute("data-lock", "1");
        runDebounced();
      });
      el.addEventListener("input", runDebounced);
    });
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
        setMode(b.getAttribute("data-mode") === "geo");
        runDebounced();
      });
    });
    const runBtn = $("botRun");
    if (runBtn) runBtn.addEventListener("click", runBacktest);
    const dep = $("botDeploy");
    if (dep) dep.addEventListener("click", openDeployModal);
    document.querySelectorAll("[data-bot-preset]").forEach(function (b) {
      b.addEventListener("click", function () {
        loadPreset(b.getAttribute("data-bot-preset"));
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
          /* ignore quota */
        }
        closeDeployModal();
        const login = $("btnAuth") || document.getElementById("btnAuth");
        if (login) login.click();
        else location.href = "./member.html#login";
      });
    }
    seedBandFromSpot().then(runBacktest);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind);
  else bind();

  root.QAGridBots = { simulate: simulate, runBacktest: runBacktest, loadPreset: loadPreset };
})(typeof window !== "undefined" ? window : globalThis);
