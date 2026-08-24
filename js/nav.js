(function () {
  const TICKER_SYMBOLS = [
    "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT",
    "ADAUSDT", "AVAXUSDT", "LINKUSDT", "SUIUSDT", "NEARUSDT", "APTUSDT",
    "OPUSDT", "ARBUSDT", "PEPEUSDT", "SHIBUSDT", "TIAUSDT", "INJUSDT",
    "RENDERUSDT", "AAVEUSDT",
  ];

  function tickerPillHtml(sym) {
    const short = sym.replace(/USDT$/, "");
    return (
      '<span class="ticker-pill" data-sym="' + sym + '">' +
      '<span class="tp-sym">' + short + "</span>" +
      '<span class="tp-px" data-px>—</span>' +
      '<span class="tp-chg" data-chg>▲ —</span>' +
      "</span>"
    );
  }

  function ensureCryptoTicker() {
    if (document.getElementById("tickerBar")) return;
    const topbar = document.querySelector(".topbar");
    if (!topbar) return;
    const bar = document.createElement("div");
    bar.className = "ticker-bar";
    bar.id = "tickerBar";
    bar.setAttribute("aria-label", "Market ticker");
    bar.innerHTML = '<div class="ticker-track" id="tickerTrack"></div>';
    const marquee = document.getElementById("qaFlashMarquee") || document.getElementById("bloomberg-marquee-bar");
    if (marquee && marquee.parentNode) {
      marquee.parentNode.insertBefore(bar, marquee);
    } else {
      topbar.insertAdjacentElement("afterend", bar);
    }
  }

  function ensureTickerMarquee() {
    ensureCryptoTicker();
    const bar = document.getElementById("tickerBar") || document.querySelector(".ticker-bar");
    const track = document.getElementById("tickerTrack") || (bar && bar.querySelector(".ticker-track"));
    if (!bar || !track) return;
    const need = TICKER_SYMBOLS.length * 2;
    if (track.getAttribute("data-marquee-built") === "1" && track.children.length >= need) return;
    track.setAttribute("data-marquee-built", "1");
    const pills = TICKER_SYMBOLS.map(tickerPillHtml).join("");
    track.innerHTML = pills + pills;
    bar.classList.remove("is-empty");
    let pauseTimer = null;
    const resume = () => {
      bar.classList.remove("is-paused");
      if (pauseTimer) clearTimeout(pauseTimer);
      pauseTimer = null;
    };
    const pause = () => {
      bar.classList.add("is-paused");
      if (pauseTimer) clearTimeout(pauseTimer);
      pauseTimer = setTimeout(resume, 3500);
    };
    if (bar.getAttribute("data-ticker-bound") === "1") return;
    bar.setAttribute("data-ticker-bound", "1");
    bar.addEventListener("mouseenter", pause);
    bar.addEventListener("mouseleave", resume);
    bar.addEventListener("touchstart", pause, { passive: true });
    bar.addEventListener("touchend", resume, { passive: true });
    bar.addEventListener("touchcancel", resume, { passive: true });
  }

  function restartTickerAnimation() {
    document.querySelectorAll("#tickerTrack, .ticker-bar > .ticker-track").forEach((track) => {
      track.style.animation = "none";
      void track.offsetWidth;
      track.style.animation = "";
    });
  }

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

  function installFlashMarqueeCss() {
    let link = document.querySelector('link[data-qa-flash="1"]');
    if (!link) {
      link = document.createElement("link");
      link.rel = "stylesheet";
      link.setAttribute("data-qa-flash", "1");
      document.head.appendChild(link);
    }
    link.href = "./css/marquee-ticker.css?v=mq6";
  }

  function flashMarqueeHtml() {
    return (
      '<div class="qa-flash-badge" data-i18n="flashMarqueeTag">即時快訊</div>' +
      '<div class="qa-flash-viewport">' +
      '<div class="qa-flash-track" id="qaFlashTrack"></div></div>'
    );
  }

  function setImp(el, prop, val) {
    if (el) el.style.setProperty(prop, val, "important");
  }

  function lockFlashMarquee() {
    const bar = document.getElementById("qaFlashMarquee");
    if (!bar) return;
    const badge = bar.querySelector(".qa-flash-badge");
    let vp = bar.querySelector(".qa-flash-viewport");
    let track = document.getElementById("qaFlashTrack") || bar.querySelector(".qa-flash-track");
    if (!vp) {
      vp = document.createElement("div");
      vp.className = "qa-flash-viewport";
      bar.appendChild(vp);
    }
    if (!track) {
      track = document.createElement("div");
      track.className = "qa-flash-track";
      track.id = "qaFlashTrack";
    }
    if (badge && badge.parentNode !== bar) bar.insertBefore(badge, bar.firstChild);
    if (vp.parentNode !== bar) bar.appendChild(vp);
    if (badge && vp.previousElementSibling !== badge) bar.insertBefore(vp, badge.nextSibling);
    if (track.parentNode !== vp) vp.appendChild(track);
    Array.prototype.slice.call(bar.childNodes).forEach((node) => {
      if (node !== badge && node !== vp) bar.removeChild(node);
    });

    setImp(bar, "display", "grid");
    setImp(bar, "grid-template-columns", "max-content minmax(0, 1fr)");
    setImp(bar, "grid-template-rows", "40px");
    setImp(bar, "align-items", "center");
    setImp(bar, "column-gap", "12px");
    setImp(bar, "width", "100%");
    setImp(bar, "height", "40px");
    setImp(bar, "min-height", "40px");
    setImp(bar, "max-height", "40px");
    setImp(bar, "overflow", "hidden");
    setImp(bar, "background", "#000000");
    setImp(bar, "box-sizing", "border-box");
    setImp(bar, "padding", "0 16px");
    setImp(bar, "margin", "0 0 16px");
    setImp(bar, "position", "relative");
    setImp(bar, "border", "0");
    setImp(bar, "float", "none");
    setImp(bar, "transform", "none");

    if (badge) {
      setImp(badge, "position", "relative");
      setImp(badge, "left", "auto");
      setImp(badge, "top", "auto");
      setImp(badge, "float", "none");
      setImp(badge, "transform", "none");
      setImp(badge, "z-index", "2");
      setImp(badge, "display", "inline-flex");
      setImp(badge, "align-items", "center");
      setImp(badge, "height", "24px");
      setImp(badge, "padding", "0 10px");
      setImp(badge, "margin", "0");
      setImp(badge, "background", "#ff5500");
      setImp(badge, "color", "#ffffff");
      setImp(badge, "font-size", "12px");
      setImp(badge, "font-weight", "700");
      setImp(badge, "white-space", "nowrap");
      setImp(badge, "border", "0");
    }

    setImp(vp, "min-width", "0");
    setImp(vp, "width", "auto");
    setImp(vp, "max-width", "100%");
    setImp(vp, "height", "40px");
    setImp(vp, "overflow", "hidden");
    setImp(vp, "position", "relative");
    setImp(vp, "z-index", "1");
    setImp(vp, "display", "block");
    setImp(vp, "margin", "0");
    setImp(vp, "padding", "0");
    setImp(vp, "float", "none");

    setImp(track, "display", "inline-flex");
    setImp(track, "white-space", "nowrap");
    setImp(track, "height", "40px");
    setImp(track, "line-height", "40px");
    setImp(track, "position", "relative");
    setImp(track, "float", "none");
    setImp(track, "padding", "0");
    setImp(track, "transform", "none");
    setImp(track, "overflow", "visible");

    bar.querySelectorAll("a").forEach((a) => {
      setImp(a, "color", "#e5e7eb");
      setImp(a, "text-decoration", "none");
      setImp(a, "border", "0");
      setImp(a, "background", "transparent");
    });
  }

  window.QALockFlashMarquee = lockFlashMarquee;

  function mountFlashMarquee() {
    installFlashMarqueeCss();
    const bar = document.createElement("div");
    bar.id = "qaFlashMarquee";
    bar.className = "qa-flash-marquee";
    bar.setAttribute("aria-label", "Flash news ticker");
    bar.innerHTML = flashMarqueeHtml();
    const stale =
      document.getElementById("qaFlashMarquee") ||
      document.getElementById("bloomberg-marquee-bar") ||
      document.querySelector(".qa-flash-marquee, .bb-marquee, .news-ticker-container");
    if (stale && stale.parentNode) {
      stale.parentNode.replaceChild(bar, stale);
    } else {
      const chrome = document.querySelector(".site-sticky-chrome");
      const ticker = document.getElementById("tickerBar");
      const topbar = document.querySelector(".topbar");
      if (chrome && chrome.parentNode) chrome.insertAdjacentElement("afterend", bar);
      else if (ticker && ticker.parentNode) ticker.insertAdjacentElement("afterend", bar);
      else if (topbar) topbar.insertAdjacentElement("afterend", bar);
    }
    document.querySelectorAll("#bloomberg-marquee-bar, .bb-marquee, .news-ticker-container").forEach((el) => {
      if (el !== bar) el.remove();
    });
    lockFlashMarquee();
  }

  function loadFlashMarquee() {
    if (window.__qaFlashMarqueeLoaded) return;
    const hasNewsJs = Array.prototype.some.call(document.scripts, (s) => (s.src || "").includes("news.js"));
    if (hasNewsJs) return;
    window.__qaFlashMarqueeLoaded = true;
    const s = document.createElement("script");
    s.src = "./js/flash-marquee.js?v=mq6";
    s.defer = true;
    document.head.appendChild(s);
  }

  function ensureLiveNavLink() {
    const nav = document.querySelector(".nav-actions");
    if (!nav || nav.querySelector(".nav-link-live")) return;
    const onLive = /(^|\/)live\.html$/.test(location.pathname);
    const link = document.createElement("a");
    link.className = "nav-link nav-link-live" + (onLive ? " active" : "");
    link.href = "./live.html";
    link.setAttribute("data-i18n", "navLive");
    link.textContent = "🔴 直播作戰室";
    const term = nav.querySelector('a[href="./terminal.html"], a[href="./strategies.html"]');
    if (term && term.parentNode) term.insertAdjacentElement("afterend", link);
    else nav.insertBefore(link, nav.firstChild);
  }

  ensureBloombergCss();
  mountFlashMarquee();
  ensureUtilBar();
  ensureCryptoTicker();
  ensureTickerMarquee();
  ensureLiveNavLink();
  loadFlashMarquee();

  const toggle = document.getElementById("navToggle");
  const bar = document.querySelector(".topbar");

  function ensureNavBackdrop() {
    let bd = document.getElementById("navDrawerBackdrop");
    /* Migrate legacy body-level mask into .topbar so it cannot cover links */
    if (bd && bar && bd.parentElement !== bar) {
      bd.remove();
      bd = null;
    }
    if (!bd) {
      bd = document.createElement("button");
      bd.type = "button";
      bd.id = "navDrawerBackdrop";
      bd.className = "nav-drawer-backdrop";
      bd.hidden = true;
      bd.setAttribute("aria-label", "Close menu");
      bd.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        closeNavDrawer();
      });
      if (bar) bar.insertBefore(bd, bar.firstChild);
      else document.body.insertBefore(bd, document.body.firstChild);
    }
    return bd;
  }

  function closeNavDrawer() {
    if (bar) bar.classList.remove("nav-open");
    document.body.classList.remove("nav-drawer-open");
    const bd = document.getElementById("navDrawerBackdrop");
    if (bd) bd.hidden = true;
  }

  function syncNavDrawer(forceOpen) {
    const mobile = window.matchMedia("(max-width: 768px)").matches;
    const open = forceOpen != null ? !!forceOpen : !!(bar && bar.classList.contains("nav-open"));
    if (!mobile || !open) {
      closeNavDrawer();
      return;
    }
    document.body.classList.add("nav-drawer-open");
    const bd = ensureNavBackdrop();
    bd.hidden = false;
  }

  window.addEventListener("pageshow", () => closeNavDrawer());

  if (toggle && bar) {
    ensureNavBackdrop();
    toggle.addEventListener("click", (ev) => {
      ev.stopPropagation();
      bar.classList.toggle("nav-open");
      syncNavDrawer(bar.classList.contains("nav-open"));
    });
    document.querySelectorAll(".nav-actions a, .nav-actions button").forEach((el) => {
      el.addEventListener(
        "click",
        () => {
          if (el.closest(".lang-pills") || el.id === "idPill") return;
          closeNavDrawer();
        },
        true
      );
    });
    window.addEventListener("resize", () => syncNavDrawer());
  } else {
    closeNavDrawer();
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
      const raw = el.getAttribute("data-sym");
      const sym = raw === "FETUSDT" ? "NEARUSDT" : raw;
      if (sym === "FETUSDT") return;
      if (sym && !syms.includes(sym)) {
        if (raw === "FETUSDT") el.setAttribute("data-sym", "NEARUSDT");
        syms.push(sym);
      }
    });
    return syms;
  }

  function applyTickerRow(row) {
    if (!row || !row.symbol) return;
    document.querySelectorAll(`.ticker-pill[data-sym="${row.symbol}"], .rail-quote[data-sym="${row.symbol}"]`).forEach((el) => {
      paintQuote(el, row.priceChangePercent, row.lastPrice);
    });
  }

  function loadScriptOnce(src) {
    return new Promise((resolve) => {
      let abs = src;
      try {
        abs = new URL(src, document.baseURI).href;
      } catch {
        abs = src;
      }
      const existing = Array.prototype.find.call(document.scripts, (s) => (s.src || "") === abs);
      if (window.QAFeed) {
        resolve();
        return;
      }
      if (existing) {
        existing.addEventListener("load", () => resolve());
        existing.addEventListener("error", () => resolve());
        return;
      }
      const s = document.createElement("script");
      s.src = src;
      s.onload = () => resolve();
      s.onerror = () => resolve();
      document.head.appendChild(s);
    });
  }

  async function fetchTickerDirect(syms) {
    const encoded = encodeURIComponent(JSON.stringify(syms));
    const urls = [
      "https://data-api.binance.vision/api/v3/ticker/24hr?symbols=" + encoded,
      "https://api.binance.com/api/v3/ticker/24hr?symbols=" + encoded,
    ];
    for (let i = 0; i < urls.length; i++) {
      try {
        const res = await fetch(urls[i] + (urls[i].indexOf("?") >= 0 ? "&" : "?") + "_t=" + Date.now(), {
          cache: "no-store",
          headers: { Accept: "application/json", "Cache-Control": "no-cache" },
        });
        if (!res.ok) continue;
        const rows = await res.json();
        if (Array.isArray(rows) && rows.length) return rows;
      } catch {
        /* try next venue */
      }
    }
    return [];
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
    let rows = null;
    try {
      const feed = window.QAFeed;
      if (feed && typeof feed.fetchTicker24h === "function") {
        rows = await feed.fetchTicker24h(syms);
      }
    } catch {
      rows = null;
    }
    if (!rows || !rows.length) {
      try {
        rows = await fetchTickerDirect(syms);
      } catch {
        rows = null;
      }
    }
    if (!rows || !rows.length) return;
    rows.forEach(applyTickerRow);
  }

  let tickerLiveSub = null;
  let tickerPollTimer = null;

  window.addEventListener("quant-feed-region", () => {
    refreshTicker();
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      ensureTickerMarquee();
      restartTickerAnimation();
      refreshTicker();
    }
  });

  function startTickerLoop() {
    ensureTickerMarquee();
    if (tickerLiveSub) {
      tickerLiveSub.close();
      tickerLiveSub = null;
    }
    if (tickerPollTimer) {
      clearInterval(tickerPollTimer);
      tickerPollTimer = null;
    }
    refreshTicker();
    const syms = collectTickerSyms();
    const feed = window.QAFeed;
    if (feed && typeof feed.subscribeMarketTickers === "function" && syms.length) {
      tickerLiveSub = feed.subscribeMarketTickers(syms, applyTickerRow);
    } else {
      tickerPollTimer = setInterval(refreshTicker, 2500);
    }
  }
  async function bootTicker() {
    if (!window.QAFeed) {
      await loadScriptOnce("./js/binance-feed.js?v=tick2");
    }
    ensureCryptoTicker();
    ensureTickerMarquee();
    restartTickerAnimation();
    startTickerLoop();
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(bootTicker, 0));
  } else {
    setTimeout(bootTicker, 0);
  }
  window.addEventListener("load", () => {
    ensureTickerMarquee();
    restartTickerAnimation();
  });

  document.addEventListener("focusin", (ev) => {
    const t = ev.target;
    if (t && t.matches && t.matches("input, textarea, select")) t.classList.add("is-focused");
  });
  document.addEventListener("focusout", (ev) => {
    const t = ev.target;
    if (t && t.classList) t.classList.remove("is-focused");
  });
})();
