(function () {
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

  const TICK_SYMS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT"];

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
    if (px) px.textContent = fmtPx(last);
    if (chg) {
      const arrow = up ? "▲" : "▼";
      const n = Number(pct);
      chg.textContent = arrow + " " + (Number.isFinite(n) ? Math.abs(n).toFixed(2) : "—") + "%";
      chg.classList.toggle("up", up);
      chg.classList.toggle("down", !up);
    }
    root.classList.toggle("up", up);
    root.classList.toggle("down", !up);
    flash(px || root, !up);
  }

  async function refreshTicker() {
    const pills = document.querySelectorAll(".ticker-pill[data-sym], .rail-quote[data-sym]");
    if (!pills.length) return;
    try {
      const qs = encodeURIComponent(JSON.stringify(TICK_SYMS));
      const res = await fetch("https://data-api.binance.vision/api/v3/ticker/24hr?symbols=" + qs);
      if (!res.ok) throw new Error("http");
      const rows = await res.json();
      const map = {};
      (Array.isArray(rows) ? rows : []).forEach((r) => {
        map[r.symbol] = r;
      });
      pills.forEach((el) => {
        const row = map[el.getAttribute("data-sym")];
        if (!row) return;
        paintQuote(el, row.priceChangePercent, row.lastPrice);
      });
    } catch {
      /* keep placeholders */
    }
  }

  refreshTicker();
  setInterval(refreshTicker, 15000);

  document.addEventListener("focusin", (ev) => {
    const t = ev.target;
    if (t && t.matches && t.matches("input, textarea, select")) t.classList.add("is-focused");
  });
  document.addEventListener("focusout", (ev) => {
    const t = ev.target;
    if (t && t.classList) t.classList.remove("is-focused");
  });
})();
