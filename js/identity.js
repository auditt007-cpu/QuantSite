(function (root) {
  function t(key) {
    const lang = localStorage.getItem("quant_lang") || "zh-Hant";
    const pack = (root.I18N && (root.I18N[lang] || root.I18N["zh-Hant"])) || {};
    return pack[key] || key;
  }

  function seat() {
    const paid = localStorage.getItem("quant_paid") === "1";
    const n = Number(localStorage.getItem("quant_invites") || "0");
    const unlocked = localStorage.getItem("quant_unlocked") === "1" || n >= 2;
    if (paid) return "vip";
    if (unlocked) return "pro";
    return "free";
  }

  function paint() {
    const bar = document.getElementById("navActions");
    if (!bar) return;
    let pill = document.getElementById("idPill");
    const tg = localStorage.getItem("quant_tg");
    const loginBtn = document.getElementById("btnAuth");
    const hint = document.querySelector(".micro-tag");
    if (!tg) {
      if (pill) pill.hidden = true;
      if (loginBtn) loginBtn.hidden = false;
      if (hint) hint.style.display = "";
      const onb = document.getElementById("onboardBanner");
      if (onb) onb.hidden = true;
      return;
    }
    if (loginBtn) loginBtn.hidden = true;
    if (hint) hint.style.display = "none";
    if (!pill) {
      pill = document.createElement("button");
      pill.type = "button";
      pill.id = "idPill";
      pill.className = "id-pill";
      const lang = bar.querySelector(".lang-pills");
      bar.insertBefore(pill, lang || null);
      pill.addEventListener("click", () => {
        const dash = document.getElementById("dashModal");
        if (dash) {
          dash.classList.add("show");
          return;
        }
        location.href = "./index.html#dash";
      });
    }
    pill.hidden = false;
    const n = Number(localStorage.getItem("quant_invites") || "0");
    const kind = seat();
    pill.className = "id-pill " + kind;
    if (kind === "vip") pill.textContent = t("pillVip");
    else if (kind === "pro") pill.textContent = t("pillPro");
    else pill.textContent = t("pillFree").replace("{n}", String(n));
    paintOnboard();
  }

  function paintOnboard() {
    const box = document.getElementById("onboardBanner");
    if (!box || !localStorage.getItem("quant_tg")) {
      if (box) box.hidden = true;
      return;
    }
    box.hidden = false;
    const n = Number(localStorage.getItem("quant_invites") || "0");
    const left = Math.max(0, 2 - n);
    const kind = seat();
    const seatLabel = kind === "vip" ? t("seatVip") : kind === "pro" ? t("seatPro") : t("seatFree");
    const hi = document.getElementById("onboardHi");
    if (hi) hi.textContent = t("onboardHi").replace("{seat}", seatLabel);
    const need = document.getElementById("onboardNeed");
    if (need) need.textContent = t("onboardNeed").replace("{n}", String(left));
    tickCountdown();
  }

  function tickCountdown() {
    const el = document.getElementById("newbieClock");
    const bar = document.getElementById("newbieBar");
    if (!el) return;
    let start = Number(localStorage.getItem("quant_join_at") || "0");
    if (!start) return;
    const end = start + 24 * 60 * 60 * 1000;
    const now = Date.now();
    const left = Math.max(0, end - now);
    const h = Math.floor(left / 3600000);
    const m = Math.floor((left % 3600000) / 60000);
    const s = Math.floor((left % 60000) / 1000);
    const p = (x) => String(x).padStart(2, "0");
    el.textContent = left ? p(h) + ":" + p(m) + ":" + p(s) : "00:00:00";
    if (bar) bar.style.width = (100 * Math.max(0, 1 - left / (24 * 3600000))) + "%";
  }

  setInterval(tickCountdown, 1000);
  root.QAIdentity = { paint, seat };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", paint);
  else paint();
  window.addEventListener("quant-lang", paint);
  window.addEventListener("quant-auth", paint);
})(typeof window !== "undefined" ? window : globalThis);
