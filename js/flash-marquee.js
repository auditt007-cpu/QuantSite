(function (root) {
  if (root.__qaFlashMarqueeBooted) return;
  const hasNewsJs = Array.prototype.some.call(document.scripts, (s) => (s.src || "").includes("news.js"));
  if (hasNewsJs) return;

  const POLL_MS = 60000;
  const CC = "https://min-api.cryptocompare.com/data/v2/news/?extraParams=quantalpha&lang=";
  const RSS = "https://api.rss2json.com/v1/api.json?rss_url=";

  const COPY = {
    "zh-Hans": {
      marqueeTag: "即时快讯",
      flashFb: [
        "美联储利率决议对比特币流动性和风险资产定价的影响",
        "以太坊 L2 活跃地址再创新高，链上手续费维持低位",
        "美元指数走弱，黄金与数字货币同步吸引避险资金",
        "现货 ETF 净流入回升，机构仓位重新偏多",
        "亚太盘开市，BTC 波动率收敛后等待方向选择",
      ],
    },
    "zh-Hant": {
      marqueeTag: "即時快訊",
      flashFb: [
        "聯準會利率決議牽動比特幣流動性與風險資產定價",
        "以太坊 L2 活躍地址再創新高，鏈上手續費維持低檔",
        "美元指數走弱，黃金與加密貨幣同步吸引避險資金",
        "現貨 ETF 淨流入回升，機構部位重新偏多",
        "亞太盤開市，BTC 波動率收斂後等待方向選擇",
      ],
    },
  };

  function newsKey() {
    const pack = root.QALang && root.QALang.current ? root.QALang.current() : "zh-Hant";
    if (pack === "zh-CN" || pack === "zh-Hans") return "zh-Hans";
    return "zh-Hant";
  }

  function copyOf(key) {
    return COPY[key] || COPY["zh-Hant"];
  }

  function t(key) {
    const live = root.QALang && typeof root.QALang.t === "function" ? root.QALang.t(key) : "";
    if (live && live !== key) return live;
    if (key === "flashMarqueeTag") return copyOf(newsKey()).marqueeTag;
    return live || key;
  }

  function localeFor(key) {
    if (key === "zh-Hans") return "zh-CN";
    return "zh-TW";
  }

  function hhmm(epoch, key) {
    const d = new Date(Number(epoch) * 1000);
    const now = isFinite(d.getTime()) ? d : new Date();
    try {
      return now.toLocaleTimeString(localeFor(key), { hour: "2-digit", minute: "2-digit", hour12: false });
    } catch (err) {
      const pad = (n) => String(n).padStart(2, "0");
      return pad(now.getHours()) + ":" + pad(now.getMinutes());
    }
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function localizeTitle(title, key) {
    let out = String(title || "").replace(/\s+/g, " ").trim();
    if (key === "zh-Hant" && typeof root.toTraditional === "function") out = root.toTraditional(out);
    return out;
  }

  function fetchJson(url, ms) {
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = setTimeout(() => {
      if (ctrl) ctrl.abort();
    }, ms || 7000);
    return fetch(url, { cache: "no-store", signal: ctrl ? ctrl.signal : undefined })
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
        return res.json();
      })
      .finally(() => clearTimeout(timer));
  }

  function mustRows(rows) {
    if (!rows || !rows.length) throw new Error("empty");
    return rows.filter((row) => row && row.title).slice(0, 10);
  }

  async function pullCc(key) {
    const lang = "ZH";
    const json = await fetchJson(CC + lang);
    const data = json && json.Data ? json.Data : [];
    return mustRows(
      data.map((item) => ({
        title: localizeTitle(item.title, key),
        url: item.url,
        time: item.published_on,
        source: (item.source_info && item.source_info.name) || "CryptoCompare",
      }))
    );
  }

  async function pullCoinGecko(key) {
    const json = await fetchJson("https://api.coingecko.com/api/v3/news");
    const data = (json && (json.data || json.news || json)) || [];
    const list = Array.isArray(data) ? data : [];
    return mustRows(
      list.map((item) => ({
        title: localizeTitle(item.title || (item.attributes && item.attributes.title), key),
        url: item.url || item.news_url || (item.attributes && item.attributes.url) || "https://www.coingecko.com/news",
        time: item.updated_at || item.created_at ? new Date(item.updated_at || item.created_at).getTime() / 1000 : Date.now() / 1000,
        source: item.news_site || item.author || "CoinGecko",
      }))
    );
  }

  async function pullRss(key, feed) {
    const json = await fetchJson(RSS + encodeURIComponent(feed));
    const rows = Array.isArray(json.items) ? json.items : [];
    return mustRows(
      rows.map((row) => ({
        title: localizeTitle(row.title, key),
        url: row.link || row.url || "#",
        time: row.pubDate ? new Date(row.pubDate).getTime() / 1000 : Date.now() / 1000,
        source: row.author || "RSS",
      }))
    );
  }

  function nodesFor(key) {
    const binance = "https://www.binance.com/zh-CN/support/announcement";
    const extra = key === "zh-Hant" ? "https://www.blocktempo.com/feed/" : "https://www.jinse.cn/rss";
    return [
      () => pullCc(key),
      () => pullCoinGecko(key),
      () => pullRss(key, binance).catch(() => pullRss(key, extra)),
    ];
  }

  function firstOk(factories) {
    const jobs = factories.map((fn) =>
      Promise.resolve()
        .then(fn)
        .then((rows) => {
          if (!rows || !rows.length) throw new Error("empty");
          return rows;
        })
    );
    if (typeof Promise.any === "function") return Promise.any(jobs);
    return new Promise((resolve, reject) => {
      let left = jobs.length;
      jobs.forEach((job) => {
        job.then(resolve).catch(() => {
          left -= 1;
          if (!left) reject(new Error("all"));
        });
      });
    });
  }

  function fallbackItems(key) {
    const pack = copyOf(key);
    return pack.flashFb.map((title, i) => ({
      title,
      url: "https://www.coindesk.com/",
      time: Date.now() / 1000 - i * 600,
      source: key === "zh-Hans" ? "宏观快讯" : "宏觀快訊",
    }));
  }

  function paintMarquee(items, key) {
    const track = document.getElementById("qaFlashTrack") || document.getElementById("bbMarqueeTrack");
    const bar = document.getElementById("qaFlashMarquee") || document.getElementById("bloomberg-marquee-bar");
    const tag = bar && bar.querySelector(".qa-flash-badge, .ticker-badge, .bb-tag");
    if (tag) tag.textContent = t("flashMarqueeTag");
    if (!track) return;
    const rows = items && items.length ? items : fallbackItems(key);
    const bits = rows
      .map((it) => {
        const clock = typeof it.time === "string" ? it.time : hhmm(it.time, key);
        return (
          '<span class="qa-flash-item">' +
          `<a href="${escapeHtml(it.url)}" target="_blank" rel="noopener noreferrer">` +
          `[ ${clock} ] ${escapeHtml(it.title)}` +
          "</a></span>"
        );
      })
      .join("");
    /* Duplicate for seamless -50% scroll loop */
    track.innerHTML = bits + bits;
    if (typeof root.QALockFlashMarquee === "function") root.QALockFlashMarquee();
  }

  let newsTimer = 0;
  let newsReq = 0;

  async function refreshNews() {
    const key = newsKey();
    const req = ++newsReq;
    try {
      const items = await firstOk(nodesFor(key));
      if (req !== newsReq) return;
      paintMarquee(items.slice(0, 10), key);
    } catch (err) {
      if (req !== newsReq) return;
      paintMarquee(fallbackItems(key), key);
    }
  }

  function bindMarqueePause() {
    const bar = document.getElementById("qaFlashMarquee") || document.getElementById("bloomberg-marquee-bar");
    if (!bar || bar.dataset.bound === "1") return;
    bar.dataset.bound = "1";
    const pause = () => bar.classList.add("is-paused");
    const resume = () => bar.classList.remove("is-paused");
    bar.addEventListener("mouseenter", pause);
    bar.addEventListener("mouseleave", resume);
    bar.addEventListener("touchstart", pause, { passive: true });
    bar.addEventListener("touchend", resume, { passive: true });
    bar.addEventListener("touchcancel", resume, { passive: true });
  }

  function boot() {
    if (!document.getElementById("qaFlashTrack") && !document.getElementById("bbMarqueeTrack")) return;
    root.__qaFlashMarqueeBooted = true;
    bindMarqueePause();
    paintMarquee(fallbackItems(newsKey()), newsKey());
    refreshNews();
    clearInterval(newsTimer);
    newsTimer = setInterval(refreshNews, POLL_MS);
  }

  root.addEventListener("quant-lang", () => refreshNews());

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})(window);
