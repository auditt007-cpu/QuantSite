(function (root) {
  const PACKS = ["zh-Hant", "zh-CN", "en"];

  function packOf(code) {
    const raw = String(code || "").trim();
    if (!raw) return null;
    if (raw === "zh-Hans" || raw === "zh-CN" || raw === "zh-SG") return "zh-CN";
    if (raw === "zh-Hant" || raw === "zh-TW" || raw === "zh-HK" || raw === "zh-MO") return "zh-Hant";
    if (raw === "en") return "en";
    if (root.I18N && root.I18N[raw]) return raw;
    return null;
  }

  function detectBrowserLang() {
    const list =
      typeof navigator !== "undefined" && navigator.languages && navigator.languages.length
        ? navigator.languages
        : [typeof navigator !== "undefined" ? navigator.language || navigator.userLanguage : "en"];
    for (let i = 0; i < list.length; i++) {
      const tag = String(list[i] || "")
        .toLowerCase()
        .replace(/_/g, "-");
      const base = tag.split("-")[0];
      const region = tag.split("-")[1] || "";
      if (base === "zh") {
        if (region === "cn" || region === "sg" || region === "hans") return "zh-CN";
        if (region === "tw" || region === "hk" || region === "mo" || region === "hant") return "zh-Hant";
        if (tag.indexOf("hans") >= 0) return "zh-CN";
        if (tag.indexOf("hant") >= 0) return "zh-Hant";
        return "zh-CN";
      }
    }
    return "en";
  }

  function persist(pack) {
    const user = pack === "zh-CN" ? "zh-Hans" : pack;
    try {
      localStorage.setItem("user_lang", user);
      localStorage.setItem("quant_lang", pack);
    } catch {
      /* private mode */
    }
  }

  function currentLang() {
    let pack = null;
    try {
      pack = packOf(localStorage.getItem("user_lang")) || packOf(localStorage.getItem("quant_lang"));
    } catch {
      pack = null;
    }
    if (pack && root.I18N && root.I18N[pack]) return pack;
    pack = detectBrowserLang();
    if (!root.I18N || !root.I18N[pack]) pack = "en";
    persist(pack);
    return pack;
  }

  function lookup(dict, key) {
    if (!dict || !key) return "";
    if (dict[key]) return dict[key];
    const lower = String(key).toLowerCase();
    const names = Object.keys(dict);
    for (let i = 0; i < names.length; i++) {
      if (names[i].toLowerCase() === lower) return dict[names[i]];
    }
    return "";
  }

  function t(key) {
    const pack = (root.I18N && (root.I18N[currentLang()] || root.I18N.en || root.I18N["zh-Hant"])) || {};
    const en = (root.I18N && root.I18N.en) || {};
    const hant = (root.I18N && root.I18N["zh-Hant"]) || {};
    const cn = (root.I18N && root.I18N["zh-CN"]) || {};
    return lookup(pack, key) || lookup(en, key) || lookup(hant, key) || lookup(cn, key) || key;
  }

  function htmlLang(pack) {
    if (pack === "en") return "en";
    if (pack === "zh-CN") return "zh-Hans";
    return "zh-Hant";
  }

  function applyI18nDom() {
    if (!root.I18N) return;
    const lang = currentLang();
    document.documentElement.lang = htmlLang(lang);
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      if (el.id === "btnAuth" || el.id === "idPill" || el.id === "nodeName" || el.id === "dashLevel" || el.id === "refCount") return;
      const key = el.getAttribute("data-i18n");
      const val = t(key);
      if (!val) return;
      if (el.classList.contains("hint") || el.hasAttribute("title")) el.setAttribute("title", val === key ? el.getAttribute("title") || val : val);
      if (el.children.length) return;
      const cur = (el.textContent || "").trim();
      if (val === key && cur && cur !== key && cur.toUpperCase() !== String(key).toUpperCase()) return;
      el.textContent = val;
    });
    document.querySelectorAll("[data-i18n-html]").forEach((el) => {
      el.innerHTML = t(el.getAttribute("data-i18n-html"));
    });
    document.querySelectorAll("[data-ph]").forEach((el) => {
      el.placeholder = t(el.getAttribute("data-ph"));
    });
    document.querySelectorAll("[data-fill-key]").forEach((el) => {
      el.setAttribute("data-fill", t(el.getAttribute("data-fill-key")));
    });
    document.querySelectorAll("[data-lang]").forEach((b) => {
      const btnPack = packOf(b.getAttribute("data-lang")) || b.getAttribute("data-lang");
      b.classList.toggle("active", btnPack === lang);
    });
    const ws = document.getElementById("wsStatus");
    if (ws && root.QAFeed) {
      root.QAFeed.setFeedStatus(ws, ws.classList.contains("live") ? "live" : "reconnect");
    }
    const page = document.body && (document.body.getAttribute("data-title-key") || document.body.getAttribute("data-title-key"));
    if (page) document.title = t(page);
  }

  function setLang(lang) {
    let pack = packOf(lang);
    if (!pack || !root.I18N || !root.I18N[pack]) pack = "en";
    persist(pack);
    applyI18nDom();
    root.dispatchEvent(new CustomEvent("quant-lang", { detail: pack }));
  }

  root.QALang = {
    current: currentLang,
    t: t,
    set: setLang,
    packOf: packOf,
    detect: detectBrowserLang,
    packs: PACKS,
  };
  root.QAApplyI18n = applyI18nDom;
  root.addEventListener("click", (e) => {
    const btn = e.target && e.target.closest && e.target.closest("[data-lang], [data-lang]");
    if (!btn || !btn.closest(".lang-pills, .lang-pills")) return;
    setLang(btn.getAttribute("data-lang") || btn.getAttribute("data-lang"));
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", applyI18nDom);
  else applyI18nDom();
})(window);
