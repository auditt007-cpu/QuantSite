(function (root) {
  const SRC_PRIMARY = "https://min-api.cryptocompare.com/data/v2/news/?lang=EN&extraParams=quantalpha";
  const SRC_BACKUP = "https://api.rss2json.com/v1/api.json?rss_url=" + encodeURIComponent("https://cointelegraph.com/rss");
  const POLL_MS = 60000;

  function t(key) {
    if (root.QALang && typeof root.QALang.t === "function") return root.QALang.t(key);
    return key;
  }

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function hhmm(ts) {
    const d = new Date(Number(ts) * 1000);
    if (!isFinite(d.getTime())) {
      const n = new Date();
      return pad(n.getHours()) + ":" + pad(n.getMinutes());
    }
    return pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fallbackItems() {
    return [1, 2, 3, 4, 5].map((n, i) => ({
      title: t("flashFb" + n),
      url: "https://www.coindesk.com/",
      time: Date.now() / 1000 - i * 600,
    }));
  }

  async function pullPrimary() {
    const res = await fetch(SRC_PRIMARY, { cache: "no-store" });
    if (!res.ok) throw new Error("cc");
    const json = await res.json();
    const rows = Array.isArray(json.Data) ? json.Data : [];
    return rows.slice(0, 10).map((row) => ({
      title: row.title || "",
      url: row.url || row.guid || "#",
      time: row.published_on || Date.now() / 1000,
    })).filter((x) => x.title);
  }

  async function pullBackup() {
    const res = await fetch(SRC_BACKUP, { cache: "no-store" });
    if (!res.ok) throw new Error("rss");
    const json = await res.json();
    const rows = Array.isArray(json.items) ? json.items : [];
    return rows.slice(0, 10).map((row) => ({
      title: row.title || "",
      url: row.link || row.url || "#",
      time: row.pubDate ? new Date(row.pubDate).getTime() / 1000 : Date.now() / 1000,
    })).filter((x) => x.title);
  }

  function paint(items) {
    const list = document.getElementById("flashNews");
    if (!list) return;
    const live = items && items.length;
    const rows = live ? items : fallbackItems();
    list.dataset.fallback = live ? "0" : "1";
    list.innerHTML = rows
      .map(
        (it) =>
          `<li><a class="flash-row" href="${escapeHtml(it.url)}" target="_blank" rel="noopener noreferrer">` +
          `<time>[ ${hhmm(it.time)} ]</time>` +
          `<span>${escapeHtml(it.title)}</span>` +
          `</a></li>`,
      )
      .join("");
  }

  let timer = 0;
  let scrollTimer = 0;

  async function refresh() {
    try {
      let items = [];
      try {
        items = await pullPrimary();
      } catch {
        items = await pullBackup();
      }
      paint(items.slice(0, 10));
    } catch {
      paint(fallbackItems());
    }
  }

  function startScroll() {
    const list = document.getElementById("flashNews");
    if (!list) return;
    let dir = 1;
    clearInterval(scrollTimer);
    scrollTimer = setInterval(() => {
      if (list.matches(":hover")) return;
      const max = list.scrollHeight - list.clientHeight;
      if (max <= 0) return;
      list.scrollTop += dir;
      if (list.scrollTop >= max) dir = -1;
      if (list.scrollTop <= 0) dir = 1;
    }, 80);
  }

  function boot() {
    const list = document.getElementById("flashNews");
    if (!list) return;
    paint(fallbackItems());
    refresh();
    startScroll();
    clearInterval(timer);
    timer = setInterval(refresh, POLL_MS);
  }

  root.addEventListener("quant-lang", () => {
    const list = document.getElementById("flashNews");
    if (list && list.dataset.fallback === "1") paint(fallbackItems());
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})(window);
