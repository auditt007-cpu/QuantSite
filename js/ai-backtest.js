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

  function showLimit(msg, href) {
    const modal = $("aiLimitModal");
    const text = $("aiLimitMsg");
    const cta = $("aiLimitCta");
    if (text) text.textContent = msg;
    if (cta) cta.href = href || "./member.html";
    if (modal) modal.classList.add("show");
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
    const btn = $("btnDeep");
    const prev = btn.textContent;
    btn.disabled = true;
    btn.textContent = t("runningDeep");
    try {
      const tg =
        (window.QAIdentity && window.QAIdentity.loggedIn && window.QAIdentity.loggedIn() && localStorage.getItem("quant_tg")) || "";
      const res = await fetch(cfg.apiBase + "/api/ai-backtest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: prompt, tg_id: tg }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 429) {
        const href = data.code === "limit_guest" ? "./member.html" : "./member.html#pay";
        showLimit(data.error || t("aiLimitTitle"), href);
        return;
      }
      if (!res.ok || !data.code) throw new Error(data.error || "AI failed");
      lastSource = wrapCode(data.code);
      let fn;
      try {
        fn = compile(data.code);
      } catch (e) {
        throw new Error("compile");
      }
      const days = lookDays();
      const bars = await feed.fetchKlines("BTCUSDT", "1d", Math.min(2000, days + 5));
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
      const now = bt.equity[bt.equity.length - 1] || 10000;
      $("navNow").textContent = t("navNowTpl").replace("{v}", "$" + now.toFixed(2));
      $("navPnl").textContent = t("navPnlTpl").replace("{v}", pct(st.ret));
      $("navPnl").className = "nav-chip " + (st.ret < 0 ? "down" : "up");
      $("navDd").textContent = t("navDdTpl").replace("{v}", (st.mdd * 100).toFixed(1) + "%");
      paintCharts(sliced, bt.equity, bt.drawdown);
      if (!entries.length) toast(t("noSignals"), "warn");
      else toast(t("btDone").replace("{ms}", "—").replace("{n}", String(sliced.length)), "ok");
    } catch (e) {
      toast(e.message || "err", "err");
    } finally {
      btn.disabled = false;
      btn.textContent = prev;
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
  });
  bootPrompt();
  if (window.QAApplyI18n) window.QAApplyI18n();
})();
