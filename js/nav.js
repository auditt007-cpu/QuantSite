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
    topbar.insertAdjacentElement("afterend", bar);
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
    bar.addEventListener(
      "touchstart",
      function () {
        pause();
        if (pauseTimer) clearTimeout(pauseTimer);
        pauseTimer = setTimeout(resume, 1200);
      },
      { passive: true }
    );
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

  function langPillsHtml() {
    return (
      '<div class="lang-pills bb-lang-pills" role="group" aria-label="Language">' +
      '<button type="button" data-lang="zh-CN">简体</button>' +
      '<button type="button" data-lang="zh-Hant">繁體</button>' +
      '<button type="button" data-lang="en">EN</button>' +
      "</div>"
    );
  }

  function ensureUtilBar() {
    let bar = document.getElementById("bbUtilBar");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "bbUtilBar";
      bar.className = "bb-util-bar";
      const chrome = document.querySelector(".site-sticky-chrome");
      const wrap = document.querySelector(".wrap");
      if (chrome && chrome.parentNode) {
        chrome.parentNode.insertBefore(bar, chrome);
      } else if (wrap && wrap.parentNode) {
        wrap.parentNode.insertBefore(bar, wrap);
      } else {
        document.body.insertBefore(bar, document.body.firstChild);
      }
    }
    /* Slim Bloomberg-style strip: brand cue left, language right — no utility links */
    bar.innerHTML =
      '<div class="bb-util-right bb-util-right-only" id="bbUtilRight">' +
      langPillsHtml() +
      "</div>";
    document.body.classList.add("has-bb-util");
    /* Remove duplicate lang controls from the main nav drawer host */
    document.querySelectorAll(".nav-actions > .lang-pills").forEach(function (el) {
      el.remove();
    });
    if (typeof window.QAApplyI18n === "function") window.QAApplyI18n();
  }

  function ensureBotsNavLink() {
    const nav = document.querySelector(".nav-actions");
    if (!nav || nav.querySelector(".nav-link-bots")) return;
    const onBots = /(^|\/)bots\.html$/.test(location.pathname);
    const link = document.createElement("a");
    link.className = "nav-link nav-link-bots" + (onBots ? " active" : "");
    link.href = "./bots.html";
    link.setAttribute("data-i18n", "navBots");
    link.textContent = "網格機器人";
    const term = nav.querySelector('a[href="./strategies.html"]');
    if (term && term.parentNode) term.insertAdjacentElement("afterend", link);
    else nav.insertBefore(link, nav.firstChild);
  }

  function ensureLiveNavLink() {
    const nav = document.querySelector(".nav-actions");
    if (!nav || nav.querySelector(".nav-link-live")) return;
    const onLive = /(^|\/)live\.html$/.test(location.pathname);
    const link = document.createElement("a");
    link.className = "nav-link nav-link-live" + (onLive ? " active" : "");
    link.href = "./live.html";
    link.setAttribute("data-i18n", "navLive");
    link.textContent = "直播作戰室";
    const bots = nav.querySelector('a[href="./bots.html"]');
    const term = nav.querySelector('a[href="./terminal.html"], a[href="./strategies.html"]');
    if (bots && bots.parentNode) bots.insertAdjacentElement("afterend", link);
    else if (term && term.parentNode) term.insertAdjacentElement("afterend", link);
    else nav.insertBefore(link, nav.firstChild);
  }

  ensureBloombergCss();
  ensureUtilBar();
  ensureCryptoTicker();
  ensureTickerMarquee();
  ensureBotsNavLink();
  ensureLiveNavLink();

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
    if (bd) {
      bd.hidden = true;
      bd.style.pointerEvents = "none";
    }
    if (toggle) toggle.setAttribute("aria-expanded", "false");
  }

  window.QACloseNavDrawer = closeNavDrawer;

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
    bd.style.pointerEvents = "auto";
    if (toggle) toggle.setAttribute("aria-expanded", "true");
  }

  window.addEventListener("pageshow", () => closeNavDrawer());

  if (toggle && bar) {
    ensureNavBackdrop();
    let toggleLock = 0;
    function toggleNav(ev) {
      if (ev) {
        ev.preventDefault();
        ev.stopPropagation();
      }
      const now = Date.now();
      if (now - toggleLock < 400) return;
      toggleLock = now;
      const willOpen = !bar.classList.contains("nav-open");
      if (willOpen) {
        bar.classList.add("nav-open");
        document.body.classList.add("nav-drawer-open");
        const bd = ensureNavBackdrop();
        bd.hidden = false;
        bd.style.pointerEvents = "auto";
        toggle.setAttribute("aria-expanded", "true");
      } else {
        closeNavDrawer();
      }
    }
    toggle.addEventListener("click", toggleNav, true);
    document.querySelectorAll(".nav-actions a, .nav-actions button").forEach((el) => {
      el.addEventListener(
        "click",
        () => {
          if (el.closest(".lang-pills") || el.id === "idPill") return;
          closeNavDrawer();
          if (toggle) toggle.setAttribute("aria-expanded", "false");
        },
        true
      );
    });
    window.addEventListener("resize", () => {
      if (!window.matchMedia("(max-width: 768px)").matches) closeNavDrawer();
    });
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
    const n = Number(pct);
    const hasChg = Number.isFinite(n);
    const up = !hasChg || n >= 0;
    const prevPx = px ? px.getAttribute("data-last") : null;
    const nextPx = last != null ? String(last) : "";
    if (px) {
      px.textContent = fmtPx(last);
      if (nextPx) px.setAttribute("data-last", nextPx);
    }
    if (chg) {
      if (hasChg) {
        chg.textContent = (up ? "▲" : "▼") + " " + Math.abs(n).toFixed(2) + "%";
        chg.classList.toggle("up", up);
        chg.classList.toggle("down", !up);
      }
    }
    root.classList.remove("up", "down", "data-updated-up", "data-updated-down");
    if (hasChg && prevPx !== nextPx) flash(chg, !up);
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
      document.querySelectorAll(".ticker-bar.is-paused").forEach((bar) => bar.classList.remove("is-paused"));
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
      await loadScriptOnce("./js/binance-feed.js?v=fs2");
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

  function pressTarget(el) {
    if (!el || !el.closest) return null;
    if (el.closest("input, textarea, select, option, .bot-band-thumb, .bot-band-track, .ticker-bar")) {
      return null;
    }
    return el.closest(
      "button, a.btn-cta, a.btn, a.nav-link, a.bot-btn, .auth-btn, .id-pill, .nav-toggle, .mv-tab, .bot-mode, .bot-days, .bot-ai-chip, .bot-ai-top3-btn, .lang-pills button, .bb-lang-pills button, [data-plaza-detail], [data-get-strategy], [data-bot-preset], [data-bot-deploy], .term-tab, .strat-tab, .seg-btn"
    );
  }

  function isAndroidUA() {
    return /Android/i.test(navigator.userAgent || "");
  }

  function bindPressFeel() {
    if (document.documentElement.getAttribute("data-qa-press") === "1") return;
    document.documentElement.setAttribute("data-qa-press", "1");
    const release = function () {
      document.querySelectorAll(".is-pressing").forEach(function (n) {
        n.classList.remove("is-pressing");
      });
    };
    document.addEventListener(
      "pointerdown",
      function (ev) {
        const hit = pressTarget(ev.target);
        if (!hit || hit.disabled) return;
        hit.classList.add("is-pressing");
        if (isAndroidUA() && navigator.vibrate) {
          try {
            navigator.vibrate(10);
          } catch (e) {
            /* ignore */
          }
        }
      },
      { passive: true }
    );
    document.addEventListener("pointerup", release, { passive: true });
    document.addEventListener("pointercancel", release, { passive: true });
    document.addEventListener("pointerleave", release, { passive: true });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindPressFeel, { once: true });
  } else {
    bindPressFeel();
  }
})();
