/* Shared mobile UX helpers for terminal.html + live.html:
 *  - Segmented "Strategies / Leaderboard / News" view switcher (mobile only)
 *  - AI Strategy Lab single-line collapse (terminal.html only)
 *  - Chart touch-shield: default touch-action:pan-y so a finger swipe over a
 *    chart scrolls the page; tapping the toggle (or a long-press) opens up
 *    full pinch/pan/crosshair interaction for a few seconds.
 */
(function (root) {
  function isMobile() {
    return root.matchMedia && root.matchMedia("(max-width: 768px)").matches;
  }

  function refreshI18n() {
    if (root.QAApplyI18n) root.QAApplyI18n();
  }

  /* ---------------------------------------------------------------------
   * Segmented view tabs
   * ------------------------------------------------------------------- */
  function initViewTabs() {
    const tabs = document.getElementById("mobileViewTabs");
    if (!tabs) return;
    const buttons = Array.prototype.slice.call(tabs.querySelectorAll(".mv-tab"));
    if (!buttons.length) return;

    function setView(view) {
      document.body.setAttribute("data-mv-view", view);
      buttons.forEach((b) => b.classList.toggle("is-active", b.getAttribute("data-view") === view));
      if (view === "leaderboard") {
        root.dispatchEvent(new CustomEvent("qa-leaderboard-ready"));
      }
      try {
        window.scrollTo({ top: tabs.getBoundingClientRect().top + window.scrollY - 8, behavior: "smooth" });
      } catch {
        /* noop */
      }
    }

    buttons.forEach((btn) => {
      btn.addEventListener("click", () => setView(btn.getAttribute("data-view")));
    });

    if (!document.body.hasAttribute("data-mv-view")) setView("strategies");

    // If the terminal page opens a strategy's backtest sheet, fall back to
    // the strategies view so the segmented control doesn't fight the sheet.
    const obs = new MutationObserver(() => {
      if (document.body.classList.contains("desk-open") && document.body.getAttribute("data-mv-view") !== "strategies") {
        setView("strategies");
      }
    });
    obs.observe(document.body, { attributes: true, attributeFilter: ["class"] });
  }

  /* ---------------------------------------------------------------------
   * AI Strategy Lab: collapse to a single-line trigger on mobile.
   * ------------------------------------------------------------------- */
  function initAiLabCollapse() {
    const lab = document.querySelector(".ai-lab");
    const trigger = document.getElementById("aiLabCollapsedTrigger");
    if (!lab || !trigger) return;

    function collapse() {
      if (isMobile()) lab.classList.add("is-collapsed");
    }
    function expand() {
      lab.classList.remove("is-collapsed");
      const ta = document.getElementById("aiPrompt");
      if (ta) {
        ta.focus();
        try {
          ta.scrollIntoView({ block: "nearest", behavior: "smooth" });
        } catch {
          /* noop */
        }
      }
    }

    collapse();
    trigger.addEventListener("click", expand);
    root.addEventListener("resize", () => {
      if (!isMobile()) lab.classList.remove("is-collapsed");
    });
  }

  /* ---------------------------------------------------------------------
   * Chart touch-shield: touch-action starts as pan-y (page scroll wins);
   * a tap on the toggle — or a long-press directly on the chart — flips it
   * to touch-action:none so the chart's own pinch/pan/crosshair handling
   * takes over. Auto-reverts after a short idle window on touch devices.
   * ------------------------------------------------------------------- */
  function bindChartTouchToggle(btn) {
    const targetId = btn.getAttribute("data-target");
    const target = targetId && document.getElementById(targetId);
    if (!target) return;
    let revertTimer = null;

    function setActive(on) {
      target.classList.toggle("touch-interactive", on);
      btn.classList.toggle("is-active", on);
      const key = on ? "chartTouchOff" : "chartTouchOn";
      btn.setAttribute("data-i18n", key);
      const label = root.QALang && typeof root.QALang.t === "function" ? root.QALang.t(key) : null;
      if (label) btn.textContent = label;
      clearTimeout(revertTimer);
      if (on) {
        revertTimer = setTimeout(() => setActive(false), 15000);
      }
    }

    btn.addEventListener("click", () => setActive(!target.classList.contains("touch-interactive")));

    let pressTimer = null;
    target.addEventListener(
      "touchstart",
      () => {
        clearTimeout(pressTimer);
        pressTimer = setTimeout(() => setActive(true), 480);
      },
      { passive: true }
    );
    ["touchend", "touchcancel"].forEach((evt) => {
      target.addEventListener(evt, () => clearTimeout(pressTimer), { passive: true });
    });
  }

  function initChartTouchToggles() {
    document.querySelectorAll(".chart-touch-toggle").forEach(bindChartTouchToggle);
  }

  function boot() {
    initViewTabs();
    initAiLabCollapse();
    initChartTouchToggles();
    refreshI18n();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})(window);
