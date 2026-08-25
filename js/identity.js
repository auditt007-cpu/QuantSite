(function (root) {
  const LOGIN_TTL_MS = 86400000;
  const TS_KEY = "login_timestamp";

  function t(key) {
    if (root.QALang && typeof root.QALang.t === "function") return root.QALang.t(key);
    const lang = localStorage.getItem("quant_lang") || localStorage.getItem("user_lang") || "en";
    const mapped = lang === "zh-Hans" ? "zh-CN" : lang;
    const pack = (root.I18N && (root.I18N[mapped] || root.I18N.en || root.I18N["zh-Hant"])) || {};
    const fallback = (root.I18N && root.I18N.en) || {};
    return pack[key] || fallback[key] || key;
  }

  function seat() {
    const paid = localStorage.getItem("quant_paid") === "1";
    const n = Number(localStorage.getItem("quant_invites") || "0");
    const unlocked = localStorage.getItem("quant_unlocked") === "1" || n >= 2;
    if (paid) return "vip";
    if (unlocked) return "pro";
    return "free";
  }

  function clearSession() {
    localStorage.removeItem("quant_tg");
    localStorage.removeItem("quant_token");
    localStorage.removeItem(TS_KEY);
    localStorage.removeItem("quant_paid");
    try {
      sessionStorage.removeItem("quant_tg");
      sessionStorage.removeItem("quant_token");
      sessionStorage.removeItem(TS_KEY);
    } catch {
      /* private mode */
    }
  }

  function persistSession(tgId, token) {
    const id = String(tgId || "");
    if (!id) return;
    localStorage.setItem("quant_tg", id);
    localStorage.setItem(TS_KEY, String(Date.now()));
    if (token) localStorage.setItem("quant_token", String(token));
    try {
      sessionStorage.removeItem("quant_tg");
    } catch {
      /* */
    }
  }

  function loggedIn() {
    const tg = localStorage.getItem("quant_tg");
    if (!tg) return false;
    let ts = Number(localStorage.getItem(TS_KEY) || 0);
    if (!ts) {
      localStorage.setItem(TS_KEY, String(Date.now()));
      return true;
    }
    if (Date.now() - ts > LOGIN_TTL_MS) {
      clearSession();
      return false;
    }
    return true;
  }

  function closeNavIfOpen() {
    if (typeof window.QACloseNavDrawer === "function") {
      window.QACloseNavDrawer();
      return;
    }
    const bar = document.querySelector(".topbar");
    if (bar) bar.classList.remove("nav-open");
    document.body.classList.remove("nav-drawer-open");
    const bd = document.getElementById("navDrawerBackdrop");
    if (bd) {
      bd.hidden = true;
      bd.style.pointerEvents = "none";
    }
  }

  function openAuth() {
    closeNavIfOpen();
    if (loggedIn()) {
      if (!/member\.html/i.test(location.pathname)) {
        location.href = "./member.html";
        return;
      }
      const dash = document.getElementById("dashPanel");
      if (dash) dash.hidden = false;
      return;
    }
    const login = document.getElementById("loginModal");
    if (login) {
      login.classList.add("show");
      return;
    }
    location.href = "./member.html#login";
  }

  function bindDock(el) {
    if (!el || el.getAttribute("data-auth-bound") === "1") return;
    el.setAttribute("data-auth-bound", "1");
    el.addEventListener("click", openAuth);
  }

  function paint() {
    const ok = loggedIn();
    const loginBtn = document.getElementById("btnAuth");
    let pill = document.getElementById("idPill");
    const dock = document.getElementById("authDock");
    const hint = document.querySelector(".micro-tag");
    if (hint) hint.style.display = "none";

    if (!ok) {
      if (pill) pill.hidden = true;
      if (loginBtn) {
        loginBtn.className = "auth-btn";
        loginBtn.hidden = false;
        loginBtn.textContent = t("loginDock");
        bindDock(loginBtn);
      }
      const onb = document.getElementById("onboardBanner");
      if (onb) onb.hidden = true;
      return;
    }

    if (loginBtn) loginBtn.hidden = true;
    if (!pill && dock) {
      pill = document.createElement("button");
      pill.type = "button";
      pill.id = "idPill";
      pill.className = "id-pill";
      dock.appendChild(pill);
    }
    if (pill) {
      bindDock(pill);
      pill.hidden = false;
      const kind = seat();
      pill.className = "id-pill " + kind;
      if (kind === "vip") pill.textContent = t("pillVip");
      else if (kind === "pro") pill.textContent = t("pillPro");
      else pill.textContent = t("pillFree");
    }
    paintOnboard();
  }

  function paintOnboard() {
    const box = document.getElementById("onboardBanner");
    if (!box || !loggedIn()) {
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
  setInterval(() => {
    const had = Boolean(localStorage.getItem("quant_tg"));
    if (had && !loggedIn()) paint();
  }, 30000);

  root.QAIdentity = { paint, seat, loggedIn, persistSession, clearSession, openAuth, LOGIN_TTL_MS };
  root.QAAuth = root.QAIdentity;
  function pingPresence() {
    const cfg = root.QUANT_CONFIG;
    const tg = localStorage.getItem("quant_tg");
    if (!cfg || !cfg.apiBase || !tg || !loggedIn()) return;
    fetch(cfg.apiBase + "/api/presence", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tg_id: tg }),
    }).catch(() => {});
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", paint);
  else paint();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", pingPresence);
  else pingPresence();
  window.addEventListener("quant-lang", paint);
  window.addEventListener("quant-auth", paint);
})(typeof window !== "undefined" ? window : globalThis);
