(function () {
  function ensureBloombergCss() {
    if (document.querySelector('link[href*="bloomberg-system.css"]')) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "./css/bloomberg-system.css";
    document.head.appendChild(link);
    if (!document.querySelector('link[href*="JetBrains+Mono"]')) {
      const pre1 = document.createElement("link");
      pre1.rel = "preconnect";
      pre1.href = "https://fonts.googleapis.com";
      const pre2 = document.createElement("link");
      pre2.rel = "preconnect";
      pre2.href = "https://fonts.gstatic.com";
      pre2.crossOrigin = "anonymous";
      const font = document.createElement("link");
      font.rel = "stylesheet";
      font.href = "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&display=swap";
      document.head.appendChild(pre1);
      document.head.appendChild(pre2);
      document.head.appendChild(font);
    }
  }

  function ensureUtilBar() {
    if (document.getElementById("bbUtilBar")) return;
    const bar = document.createElement("div");
    bar.id = "bbUtilBar";
    bar.className = "bb-util-bar";
    bar.innerHTML =
      '<div class="bb-util-left">' +
      '<span class="bb-util-node"><i class="bb-util-dot" aria-hidden="true"></i>' +
      '<span data-i18n="bbUtilNode">NODE READY · 24ms</span></span>' +
      '<span class="bb-util-tz">UTC+8 / TW</span>' +
      "</div>" +
      '<div class="bb-util-right" id="bbUtilRight"></div>';
    const wrap = document.querySelector(".wrap");
    if (wrap && wrap.parentNode) {
      wrap.parentNode.insertBefore(bar, wrap);
    } else {
      document.body.insertBefore(bar, document.body.firstChild);
    }
    document.body.classList.add("has-bb-util");
    const host = bar.querySelector("#bbUtilRight");
    const lang = document.querySelector(".topbar .nav-actions > .lang-pills");
    if (host && lang) host.appendChild(lang);
  }

  function ensureFlashMarquee() {
    const topbar = document.querySelector(".topbar");
    if (!topbar || document.getElementById("bloomberg-marquee-bar")) return;
    const bar = document.createElement("div");
    bar.id = "bloomberg-marquee-bar";
    bar.className = "bb-marquee";
    bar.setAttribute("aria-label", "Flash news ticker");
    bar.innerHTML =
      '<span class="bb-tag" data-i18n="flashMarqueeTag">LIVE</span>' +
      '<div class="bb-track-wrap"><div class="bb-track" id="bbMarqueeTrack"></div></div>';
    topbar.insertAdjacentElement("afterend", bar);
  }

  function loadFlashMarquee() {
    if (window.__qaFlashMarqueeLoaded) return;
    const hasNewsJs = Array.prototype.some.call(document.scripts, (s) => (s.src || "").includes("news.js"));
    if (hasNewsJs) return;
    window.__qaFlashMarqueeLoaded = true;
    const s = document.createElement("script");
    s.src = "./js/flash-marquee.js";
    s.defer = true;
    document.head.appendChild(s);
  }

  function normalizeMarqueeTag() {
    const tag = document.querySelector("#bloomberg-marquee-bar .bb-tag");
    if (!tag) return;
    if (!tag.getAttribute("data-i18n")) tag.setAttribute("data-i18n", "flashMarqueeTag");
  }

  ensureBloombergCss();
  ensureUtilBar();
  ensureFlashMarquee();
  normalizeMarqueeTag();
  loadFlashMarquee();

  const toggle = document.getElementById("navToggle");
  const bar = document.querySelector(".topbar");
  if (toggle && bar) {
    toggle.addEventListener("click", () => {
      bar.classList.toggle("nav-open");
    });
    document.querySelectorAll(".nav-actions a, .nav-actions button").forEach((el) => {
      el.addEventListener("click", () => {
        if (el.closest(".lang-pills") || el.id === "idPill") return;
        if (window.matchMedia("(max-width: 768px)").matches) bar.classList.remove("nav-open");
      });
    });
  }

  function fmtPx(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return "—";
    if (x >= 1000) return x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (x >= 1) return x.toFixed(2);
    return x.toPrecision(4);
  }

  function flash(el, down) {
    if (!el) return;
    el.classList.remove("data-updated-up", "data-updated-down");
    void el.offsetWidth;
    el.classList.add(down ? "data-updated-down" : "data-updated-up");
  }

  function paintQuote(root, pct, last) {
    if (!root) return;
    const px = root.querySelector("[data-px]");
    const chg = root.querySelector("[data-chg]");
    const up = Number(pct) >= 0;
    const prevPx = px ? px.getAttribute("data-last") : null;
    const nextPx = last != null ? String(last) : "";
    if (px) {
      px.textContent = fmtPx(last);
      if (nextPx) px.setAttribute("data-last", nextPx);
    }
    if (chg) {
      const arrow = up ? "▲" : "▼";
      const n = Number(pct);
      chg.textContent = arrow + " " + (Number.isFinite(n) ? Math.abs(n).toFixed(2) : "—") + "%";
      chg.classList.toggle("up", up);
      chg.classList.toggle("down", !up);
    }
    root.classList.toggle("up", up);
    root.classList.toggle("down", !up);
    if (prevPx !== nextPx) flash(root, !up);
  }

  function collectTickerSyms() {
    const pills = document.querySelectorAll(".ticker-pill[data-sym], .rail-quote[data-sym]");
    const syms = [];
    pills.forEach((el) => {
      const sym = el.getAttribute("data-sym");
      if (sym && !syms.includes(sym)) syms.push(sym);
    });
    return syms;
  }

  function applyTickerRow(row) {
    if (!row || !row.symbol) return;
    document.querySelectorAll(`.ticker-pill[data-sym="${row.symbol}"], .rail-quote[data-sym="${row.symbol}"]`).forEach((el) => {
      paintQuote(el, row.priceChangePercent, row.lastPrice);
    });
  }

  async function refreshTicker() {
    if (window.QAFeed && typeof window.QAFeed.readyGeo === "function") {
      try {
        await window.QAFeed.readyGeo();
      } catch {
        /* keep current region */
      }
    }
    const syms = collectTickerSyms();
    if (!syms.length) return;
    try {
      const feed = window.QAFeed;
      const rows = feed && typeof feed.fetchTicker24h === "function" ? await feed.fetchTicker24h(syms) : null;
      if (!rows || !rows.length) throw new Error("empty");
      rows.forEach(applyTickerRow);
    } catch {
      /* keep placeholders */
    }
  }

  let tickerLiveSub = null;

  window.addEventListener("quant-feed-region", () => {
    refreshTicker();
  });

  function startTickerLoop() {
    if (tickerLiveSub) {
      tickerLiveSub.close();
      tickerLiveSub = null;
    }
    refreshTicker();
    const syms = collectTickerSyms();
    const feed = window.QAFeed;
    if (feed && typeof feed.subscribeMarketTickers === "function" && syms.length) {
      tickerLiveSub = feed.subscribeMarketTickers(syms, applyTickerRow);
    } else {
      setInterval(refreshTicker, 2500);
    }
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(startTickerLoop, 0));
  } else {
    setTimeout(startTickerLoop, 0);
  }

  document.addEventListener("focusin", (ev) => {
    const t = ev.target;
    if (t && t.matches && t.matches("input, textarea, select")) t.classList.add("is-focused");
  });
  document.addEventListener("focusout", (ev) => {
    const t = ev.target;
    if (t && t.classList) t.classList.remove("is-focused");
  });
})();
