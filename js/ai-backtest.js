(function () {
  const cfg = window.QUANT_CONFIG;
  const feed = window.QAFeed;
  const GM = window.Grademark;
  const LC = window.LightweightCharts;
  const catalog = window.QACatalog;
  const $ = (id) => document.getElementById(id);

  function t(key) {
    if (window.QALang && typeof window.QALang.t === "function") return window.QALang.t(key);
    return key;
  }

  function toast(msg, kind) {
    const el = $("toast");
    if (!el) return;
    el.textContent = msg;
    el.className = "toast show " + (kind || "ok");
    setTimeout(() => el.classList.remove("show"), 2400);
  }

  function pct(x, digits) {
    const n = Number(x);
    if (!isFinite(n)) return "—";
    const sign = n > 0 ? "+" : "";
    return sign + (n * 100).toFixed(digits == null ? 2 : digits) + "%";
  }

  function clsSigned(n) {
    return n > 0 ? "pnl up" : n < 0 ? "pnl down" : "";
  }

  function wrapCode(body) {
    return (
      "/** Generated Grademark strategy — BTCUSDT daily bars */\n" +
      "function generatedStrategy(kLines, currentIndex) {\n" +
      String(body || "")
        .split("\n")
        .map((line) => "  " + line)
        .join("\n") +
      "\n}\n"
    );
  }

  function compile(body) {
    return new Function("kLines", "currentIndex", body);
  }

  function lookDays() {
    const n = Number(($("lookback") || {}).value || 365);
    return isFinite(n) && n > 0 ? n : 365;
  }

  function holdDays() {
    let n = Number(($("holdDays") || {}).value || 4);
    if (!isFinite(n)) n = 4;
    return Math.min(30, Math.max(1, Math.round(n)));
  }

  let equityChart = null;
  let ddChart = null;
  let lastMatrix = [];
  let lastCount = 0;
  let lastSliced = [];
  let lastSt = null;
  let lastEqNow = 0;

  function spanDays(barList) {
    if (!barList || barList.length < 2) return 14;
    const t0 = Number(barList[0].time);
    const t1 = Number(barList[barList.length - 1].time);
    if (!isFinite(t0) || !isFinite(t1) || t1 === t0) return 14;
    return Math.max(1, Math.round(Math.abs(t1 - t0) / 86400));
  }

  function paintDur(barList) {
    if (!$("navDur")) return;
    $("navDur").textContent = t("navDurTpl").replace("{n}", String(spanDays(barList)));
    $("navDur").className = "nav-chip nav-dur";
    if (window.QAUi) window.QAUi.flash($("navDur"), false);
  }

  function chartBox(el, h) {
    const mobile = window.matchMedia("(max-width: 768px)").matches;
    return {
      width: Math.max(el.clientWidth || 280, 280),
      height: mobile ? 280 : h,
    };
  }

  function addLine(chart, color) {
    return typeof chart.addLineSeries === "function"
      ? chart.addLineSeries({ color: color, lineWidth: 2 })
      : chart.addSeries(LC.LineSeries, { color: color, lineWidth: 2 });
  }

  function paintCharts(bars, eq, dd) {
    const eEl = $("equityChart");
    const dEl = $("ddChart");
    if (!LC || !feed || !eEl) return;
    if (equityChart) equityChart.remove();
    const es = chartBox(eEl, 220);
    equityChart = LC.createChart(eEl, feed.chartOptions(eEl, es.height, "1d"));
    equityChart.applyOptions({ width: es.width, height: es.height });
    addLine(equityChart, "#00873c").setData(bars.map((b, i) => ({ time: b.time, value: eq[i] })));
    equityChart.timeScale().fitContent();
    if (dEl) {
      if (ddChart) ddChart.remove();
      const ds = chartBox(dEl, 180);
      ddChart = LC.createChart(dEl, feed.chartOptions(dEl, ds.height, "1d"));
      ddChart.applyOptions({ width: ds.width, height: ds.height });
      addLine(ddChart, "#d0021b").setData(bars.map((b, i) => ({ time: b.time, value: (dd[i] || 0) * 100 })));
      ddChart.timeScale().fitContent();
    }
  }

  const QUOTA_KEY = "qa_ai_quota";

  function aiTier() {
    const id = window.QAIdentity;
    if (!id || typeof id.loggedIn !== "function" || !id.loggedIn()) return "guest";
    return id.seat && id.seat() === "vip" ? "vip" : "free";
  }

  function quotaCap(tier) {
    if (tier === "vip") return 100;
    if (tier === "free") return 10;
    return 3;
  }

  function todayKey() {
    return new Date().toISOString().slice(0, 10);
  }

  function readQuota() {
    try {
      const raw = localStorage.getItem(QUOTA_KEY);
      if (!raw) return null;
      const q = JSON.parse(raw);
      if (!q || q.day !== todayKey()) return null;
      return q;
    } catch {
      return null;
    }
  }

  function saveQuota(patch) {
    const tier = patch.tier || aiTier();
    const next = {
      day: todayKey(),
      tier,
      cap: patch.cap != null ? patch.cap : quotaCap(tier),
      used: patch.used != null ? patch.used : 0,
      code: patch.code || "",
    };
    try {
      localStorage.setItem(QUOTA_KEY, JSON.stringify(next));
    } catch {
      /* private mode */
    }
    return next;
  }

  function quotaBlocked() {
    const tier = aiTier();
    const q = readQuota();
    const cap = quotaCap(tier);
    if (!q) return null;
    if (q.used >= (q.cap || cap)) {
      return q.code || (tier === "guest" ? "limit_guest" : tier === "vip" ? "limit_vip" : "limit_free");
    }
    return null;
  }

  function limitPlan(code, serverMsg) {
    const tier = aiTier();
    const resolved =
      code ||
      (tier === "guest" ? "limit_guest" : tier === "vip" ? "limit_vip" : "limit_free");
    if (resolved === "limit_guest") {
      return {
        title: t("aiLimitGuestTitle"),
        msg: serverMsg || t("aiLimitGuestMsg"),
        href: "./member.html#login",
        cta: t("aiLimitGuestCta"),
      };
    }
    if (resolved === "limit_vip") {
      return {
        title: t("aiLimitTitle"),
        msg: serverMsg || t("aiLimitVipMsg"),
        href: "./member.html",
        cta: t("aiLimitVipCta"),
      };
    }
    return {
      title: t("aiLimitFreeTitle"),
      msg: serverMsg || t("aiLimitFreeMsg"),
      href: "./member.html#pay",
      cta: t("aiLimitFreeCta"),
    };
  }

  function isFetchError(err) {
    const msg = String((err && err.message) || err || "").toLowerCase();
    return (
      err instanceof TypeError ||
      err.name === "AbortError" ||
      /failed to fetch|networkerror|network error|load failed|fetch failed|timeout|aborted|aborterror|cors/i.test(msg)
    );
  }

  let runBtnState = null;

  function setRunning(on) {
    const btn = $("btnDeep");
    if (!btn) return;
    if (on) {
      runBtnState = { btn, prev: btn.textContent };
      btn.disabled = true;
      btn.textContent = t("runningDeep");
      return;
    }
    if (runBtnState && runBtnState.btn) {
      runBtnState.btn.disabled = false;
      runBtnState.btn.textContent = runBtnState.prev;
    }
    runBtnState = null;
  }

  async function fetchAi(prompt, tgId, ms) {
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), ms || 15000) : null;
    try {
      return await fetch(cfg.apiBase + "/api/ai-backtest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt, tg_id: tgId }),
        signal: ctrl ? ctrl.signal : undefined,
      });
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function handleAiLimit(code, serverMsg) {
    setRunning(false);
    showLimitPlan(limitPlan(code, serverMsg));
  }

  function handleAiNetwork() {
    const blockedCode = quotaBlocked();
    if (blockedCode) {
      handleAiLimit(blockedCode);
      return true;
    }
    if (!window.QAIdentity || !window.QAIdentity.loggedIn || !window.QAIdentity.loggedIn()) {
      handleAiLimit("limit_guest");
      return true;
    }
    if (!window.QAIdentity.seat || window.QAIdentity.seat() !== "vip") {
      handleAiLimit("limit_free");
      return true;
    }
    return false;
  }

  function showLimitPlan(plan, hrefOverride) {
    const modal = $("aiLimitModal");
    const title = $("aiLimitTitle");
    const text = $("aiLimitMsg");
    const cta = $("aiLimitCta");
    if (title) title.textContent = (plan && plan.title) || t("aiLimitTitle");
    if (text) text.textContent = (plan && plan.msg) || t("aiLimitTitle");
    if (cta) {
      cta.href = hrefOverride || (plan && plan.href) || "./member.html";
      cta.textContent = (plan && plan.cta) || t("goMember");
    }
    if (modal) {
      modal.classList.add("show");
      modal.setAttribute("aria-hidden", "false");
    }
  }

  function paintMatrix(rows) {
    const tb = $("matrixRows");
    if (!tb) return;
    tb.innerHTML = rows
      .map((r) => {
        const pl = !isFinite(r.pl) ? "∞" : r.pl.toFixed(2);
        return (
          "<tr>" +
          "<td>" +
          r.days +
          "</td>" +
          '<td class="' +
          clsSigned(r.avg) +
          '">' +
          pct(r.avg) +
          "</td>" +
          '<td class="' +
          clsSigned(r.max) +
          '">' +
          pct(r.max) +
          "</td>" +
          '<td class="' +
          clsSigned(r.min) +
          '">' +
          pct(r.min) +
          "</td>" +
          '<td class="' +
          (r.pl >= 1 ? "pnl up" : "pnl down") +
          '">' +
          pl +
          "</td>" +
          '<td class="pnl up">' +
          (r.up * 100).toFixed(2) +
          "%</td>" +
          '<td class="pnl down">' +
          (r.down * 100).toFixed(2) +
          "%</td>" +
          "</tr>"
        );
      })
      .join("");
  }

  function paintExec(rows, count) {
    $("histN").textContent = String(count) + t("timesUnit");
    if (!rows.length) {
      $("bestAvg").textContent = "—";
      $("maxUp").textContent = "—";
      return;
    }
    let best = rows[0];
    let bestUp = rows[0];
    rows.forEach((r) => {
      if (r.avg > best.avg) best = r;
      if (r.up > bestUp.up) bestUp = r;
    });
    const avgEl = $("bestAvg");
    avgEl.textContent = t("bestAvgTpl").replace("{d}", String(best.days)).replace("{pct}", pct(best.avg));
    avgEl.className = clsSigned(best.avg);
    $("maxUp").textContent = t("maxUpTpl").replace("{d}", String(bestUp.days)).replace("{pct}", (bestUp.up * 100).toFixed(2) + "%");
  }

  async function runDeep() {
    const prompt = String(($("aiPrompt") || {}).value || "").trim();
    if (prompt.length < 8) {
      toast(t("aiNeedPrompt"), "warn");
      return;
    }
    const blocked = quotaBlocked();
    if (blocked) {
      handleAiLimit(blocked);
      return;
    }
    if (!$("btnDeep")) return;
    setRunning(true);
    try {
      const tg =
        (window.QAIdentity && window.QAIdentity.loggedIn && window.QAIdentity.loggedIn() && localStorage.getItem("quant_tg")) || "";
      let res;
      try {
        res = await fetchAi(prompt, tg, 15000);
      } catch (netErr) {
        if (isFetchError(netErr) && handleAiNetwork()) return;
        throw netErr;
      }
      let data = {};
      try {
        data = await res.json();
      } catch {
        data = {};
      }
      if (res.status === 429) {
        saveQuota({
          tier: data.tier || aiTier(),
          cap: data.cap || quotaCap(data.tier || aiTier()),
          used: data.used != null ? data.used : data.cap || quotaCap(data.tier || aiTier()),
          code: data.code || "limit_guest",
        });
        handleAiLimit(data.code || "limit_guest", data.error);
        return;
      }
      if (!res.ok || !data.code) {
        if (res.status === 401 || res.status === 403) {
          handleAiLimit("limit_guest", data.error);
          return;
        }
        if (res.status === 502 || res.status === 503) {
          toast(data.error || t("aiNetErr"), "err");
          return;
        }
        throw new Error(data.error || t("aiNetErr"));
      }
      saveQuota({
        tier: data.tier || aiTier(),
        cap: data.cap || quotaCap(data.tier || aiTier()),
        used: data.used || 0,
        code: "",
      });
      lastSource = wrapCode(data.code);
      let fn;
      try {
        fn = compile(data.code);
      } catch (e) {
        throw new Error("compile");
      }
      const days = lookDays();
      let bars = [];
      try {
        bars = await feed.fetchKlines("BTCUSDT", "1d", Math.min(2000, days + 5));
      } catch {
        const off = window.QAOffline && window.QAOffline.forInterval("1d");
        if (off && off.length) bars = off.slice(-Math.min(2000, days + 5));
        else throw new Error(t("aiNetErr"));
      }
      const sliced = bars.length > days ? bars.slice(bars.length - days) : bars;
      const pred = function (kLines, i) {
        try {
          return Boolean(fn(kLines, i));
        } catch (err) {
          return false;
        }
      };
      const hold = holdDays();
      const bt = GM.backtest({ bars: sliced, predicate: pred, holdingDays: hold, startingCapital: 10000 });
      const entries = GM.signalBars ? GM.signalBars(sliced, pred) : GM.entriesFromPredicate(sliced, pred);
      const matrix = GM.holdingMatrix(sliced, entries, 10);
      const st = catalog.performanceOf(bt.trades, bt.equity, 365, sliced);
      $("codeSrc").textContent = lastSource;
      $("reportDesk").hidden = false;
      lastMatrix = matrix;
      lastCount = entries.length;
      paintExec(matrix, entries.length);
      paintMatrix(matrix);
      $("mWr").textContent = (st.wr * 100).toFixed(1) + "%";
      $("mPf").textContent = !isFinite(st.pf) ? "∞" : st.pf.toFixed(2);
      $("mTrades").textContent = String(st.trades);
      $("mBars").textContent = String(sliced.length);
      if (window.QAUi) {
        window.QAUi.flash($("mWr"), st.wr < 0.5);
        window.QAUi.flash($("mPf"), !(st.pf > 1));
        window.QAUi.flash($("mTrades"), false);
        window.QAUi.flash($("mBars"), false);
      }
      const now = bt.equity[bt.equity.length - 1] || 10000;
      lastSliced = sliced;
      lastSt = st;
      lastEqNow = now;
      $("navNow").textContent = t("navNowTpl").replace("{v}", "$" + now.toFixed(2));
      $("navPnl").textContent = t("navPnlTpl").replace("{v}", pct(st.ret));
      $("navPnl").className = "nav-chip " + (st.ret < 0 ? "down" : "up");
      $("navDd").textContent = t("navDdTpl").replace("{v}", (st.mdd * 100).toFixed(1) + "%");
      paintDur(sliced);
      if (window.QAUi) {
        window.QAUi.flash($("navNow"), st.ret < 0);
        window.QAUi.flash($("navPnl"), st.ret < 0);
        window.QAUi.flash($("navDd"), true);
      }
      paintCharts(sliced, bt.equity, bt.drawdown);
      if (!entries.length) toast(t("noSignals"), "warn");
      else toast(t("btDone").replace("{ms}", "—").replace("{n}", String(sliced.length)), "ok");
    } catch (e) {
      if (isFetchError(e) && handleAiNetwork()) return;
      toast((e && e.message) || t("aiNetErr"), "err");
    } finally {
      setRunning(false);
    }
  }

  function bootPrompt() {
    let prompt = "";
    try {
      prompt = sessionStorage.getItem("qa_ai_prompt") || "";
    } catch {
      prompt = "";
    }
    if (!prompt) {
      const q = new URLSearchParams(location.search).get("q") || "";
      prompt = q;
    }
    if ($("aiPrompt") && prompt) $("aiPrompt").value = prompt;
  }

  const closeLimit = $("aiLimitClose");
  if (closeLimit) {
    closeLimit.addEventListener("click", () => {
      const modal = $("aiLimitModal");
      if (modal) modal.classList.remove("show");
    });
  }
  if ($("btnDeep")) $("btnDeep").addEventListener("click", () => runDeep());
  if ($("btnCopyCode")) {
    $("btnCopyCode").addEventListener("click", async () => {
      const src = lastSource || ($("codeSrc") && $("codeSrc").textContent) || "";
      if (!src) return;
      try {
        if (window.copyToClipboard) {
          await window.copyToClipboard(src, () => toast(t("copyCodeOk"), "ok"));
        }
      } catch {
        toast(t("copyFail"), "err");
      }
    });
  }
  window.addEventListener("resize", () => {
    if (equityChart && $("equityChart")) {
      const s = chartBox($("equityChart"), 220);
      equityChart.applyOptions({ width: s.width, height: s.height });
    }
    if (ddChart && $("ddChart")) {
      const s = chartBox($("ddChart"), 180);
      ddChart.applyOptions({ width: s.width, height: s.height });
    }
  });
  window.addEventListener("quant-lang", () => {
    if (lastMatrix.length) paintExec(lastMatrix, lastCount);
    if (lastSt) {
      $("navNow").textContent = t("navNowTpl").replace("{v}", "$" + lastEqNow.toFixed(2));
      $("navPnl").textContent = t("navPnlTpl").replace("{v}", pct(lastSt.ret));
      $("navDd").textContent = t("navDdTpl").replace("{v}", (lastSt.mdd * 100).toFixed(1) + "%");
      paintDur(lastSliced);
    }
  });
  bootPrompt();
  if (window.QAApplyI18n) window.QAApplyI18n();
})();
