(function (root) {
  function currentLang() {
    const saved = localStorage.getItem("quant_lang");
    if (saved && root.I18N && root.I18N[saved]) return saved;
    return "zh-Hant";
  }

  function t(key) {
    const pack = (root.I18N && (root.I18N[currentLang()] || root.I18N["zh-Hant"])) || {};
    const fallback = (root.I18N && root.I18N["zh-Hant"]) || {};
    return pack[key] || fallback[key] || key;
  }

  function applyI18nDom() {
    if (!root.I18N) return;
    const lang = currentLang();
    document.documentElement.lang = lang === "en" ? "en" : lang === "zh-CN" ? "zh-CN" : "zh-Hant";
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      if (el.id === "btnAuth" || el.id === "idPill" || el.id === "nodeName" || el.id === "dashLevel" || el.id === "refCount") return;
      el.textContent = t(el.getAttribute("data-i18n"));
    });
    document.querySelectorAll("[data-ph]").forEach((el) => {
      el.placeholder = t(el.getAttribute("data-ph"));
    });
    document.querySelectorAll("[data-lang]").forEach((b) => {
      b.classList.toggle("active", b.getAttribute("data-lang") === lang);
    });
    const ws = document.getElementById("wsStatus");
    if (ws && root.QAFeed) {
      root.QAFeed.setFeedStatus(ws, ws.classList.contains("live") ? "live" : "reconnect");
    }
  }

  function setLang(lang) {
    if (!root.I18N || !root.I18N[lang]) lang = "zh-Hant";
    localStorage.setItem("quant_lang", lang);
    applyI18nDom();
    root.dispatchEvent(new CustomEvent("quant-lang", { detail: lang }));
  }

  root.QAApplyI18n = applyI18nDom;
  root.addEventListener("click", (e) => {
    const btn = e.target && e.target.closest && e.target.closest(".lang-pills [data-lang]");
    if (!btn) return;
    setLang(btn.getAttribute("data-lang"));
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", applyI18nDom);
  else applyI18nDom();
})(window);
