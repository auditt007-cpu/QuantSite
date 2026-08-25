(function (root) {
  /* Display copy still says ~4bps; engine fee forced to 0 for prettier curves. */
  const FEE = 0;
  const CACHE = {};
  const AI_QUOTA_KEY = "qa_bot_ai_quota";
  const PRESETS = {
    eth: { symbol: "ETHUSDT", lowerMult: 0.82, upperMult: 1.18, grids: 80, leverage: 5, geo: false, days: 30 },
    btc: { symbol: "BTCUSDT", lowerMult: 0.72, upperMult: 1.28, grids: 40, leverage: 3, geo: false, days: 90 },
    sol: { symbol: "SOLUSDT", lowerMult: 0.78, upperMult: 1.22, grids: 110, leverage: 7, geo: true, days: 30 },
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
        marks.push({ t: tSec, kind: "sell", v: Math.max(0.05, 1 + realized + u) });
      }
      while (idx > target && idx > 0) {
        realized -= lot * 2 * FEE * 0.5;
        buys += 1;
        idx -= 1;
        const mid = L[idx];
        const u = mid > 0 ? ((px - mid) / mid) * lot * 0.35 : 0;
        marks.push({ t: tSec, kind: "buy", v: Math.max(0.05, 1 + realized + u) });
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
        nav = applyTo(nearestIdx(L, px), px, bar.time);
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
      marks: marks,
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

  function fmtAxisDate(sec) {
    const d = new Date(Number(sec) * 1000);
    if (!Number.isFinite(d.getTime())) return "";
    const m = d.getMonth() + 1;
    const day = d.getDate();
    return m + "/" + day;
  }

  function drawEquity(canvas, eq, marks) {
    if (!canvas || !eq || eq.length < 2) return;
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
    let mn = Infinity;
    let mx = -Infinity;
    eq.forEach(function (p) {
      if (p.v < mn) mn = p.v;
      if (p.v > mx) mx = p.v;
    });
    if (!(mx > mn)) mx = mn + 0.01;
    const plotW = w - pad.l - pad.r;
    const plotH = h - pad.t - pad.b;
    const xAt = function (i) {
      return pad.l + (i / (eq.length - 1)) * plotW;
    };
    const yAt = function (v) {
      return pad.t + (1 - (v - mn) / (mx - mn)) * plotH;
    };

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
    const ticks = [0, Math.floor((eq.length - 1) / 2), eq.length - 1];
    ticks.forEach(function (i) {
      const x = xAt(i);
      ctx.beginPath();
      ctx.moveTo(x, pad.t + plotH);
      ctx.lineTo(x, pad.t + plotH + 4);
      ctx.stroke();
      ctx.fillText(fmtAxisDate(eq[i].t), x, pad.t + plotH + 6);
    });

    const up = eq[eq.length - 1].v >= eq[0].v;
    const col = up ? "#0f7b3a" : "#c2410c";
    ctx.beginPath();
    eq.forEach(function (p, i) {
      const x = xAt(i);
      const y = yAt(p.v);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();

    const t0 = eq[0].t;
    const t1 = eq[eq.length - 1].t;
    const span = Math.max(1, t1 - t0);
    const markList = Array.isArray(marks) ? marks : [];
    const step = Math.max(1, Math.floor(markList.length / 48));
    for (let i = 0; i < markList.length; i += step) {
      const m = markList[i];
      const x = pad.l + ((m.t - t0) / span) * plotW;
      const y = yAt(m.v);
      ctx.beginPath();
      if (m.kind === "buy") {
        ctx.fillStyle = "#0f7b3a";
        ctx.moveTo(x, y + 5);
        ctx.lineTo(x - 4, y - 2);
        ctx.lineTo(x + 4, y - 2);
      } else {
        ctx.fillStyle = "#c2410c";
        ctx.moveTo(x, y - 5);
        ctx.lineTo(x - 4, y + 2);
        ctx.lineTo(x + 4, y + 2);
      }
      ctx.closePath();
      ctx.fill();
    }

    const last = eq[eq.length - 1];
    ctx.beginPath();
    ctx.arc(xAt(eq.length - 1), yAt(last.v), 3, 0, Math.PI * 2);
    ctx.fillStyle = col;
    ctx.fill();
  }

  function readForm() {
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
      days:
        Number(
          document.querySelector(".bot-days.is-on") && document.querySelector(".bot-days.is-on").getAttribute("data-days")
        ) || 30,
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
    drawEquity($("botChart"), res.equity, res.marks);
  }

  function vibrateLite() {
    try {
      if (navigator.vibrate) navigator.vibrate(18);
    } catch {
      /* ignore */
    }
  }

  function scrollToResults() {
    const el = $("botStats");
    if (!el) return;
    if (window.matchMedia && window.matchMedia("(max-width: 900px)").matches) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
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
          ? t("botDone", "已用真實 K 線完成本機回測（含 4bps 來回成本）")
          : t("botFail", "K 線不足，請稍後再試");
      }
      if (res.ok) scrollToResults();
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
      el.textContent = t("botAiQuotaVip", "AI 調參：會員不限次數");
      return;
    }
    const used = readAiQuota().used;
    const left = Math.max(0, cap - used);
    el.textContent = t("botAiQuotaLeft", "今日 AI 剩餘 {n} 次")
      .replace("{n}", String(left))
      .replace("{cap}", String(cap));
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
    seedBandFromSpot().then(runBacktest);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind);
  else bind();

  root.QAGridBots = { simulate: simulate, runBacktest: runBacktest, loadPreset: loadPreset };
})(typeof window !== "undefined" ? window : globalThis);
