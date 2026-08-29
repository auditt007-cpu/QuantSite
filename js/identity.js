(function (root) {
  const LOGIN_TTL_MS = 86400000;
  const TS_KEY = "login_timestamp";

  function t(key) {
    if (root.QALang && typeof root.QALang.t === "function") return root.QALang.t(key);
    const lang = localStorage.getItem("quant_lang") || localStorage.getItem("user_lang") || "zh-Hant";
    const mapped = lang === "zh-Hans" ? "zh-CN" : lang === "en" || lang === "en-US" ? "zh-Hant" : lang;
    const pack = (root.I18N && (root.I18N[mapped] || root.I18N["zh-Hant"] || root.I18N["zh-CN"])) || {};
    const fallback = (root.I18N && root.I18N["zh-Hant"]) || {};
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

  function joinTgUrl() {
    const cfg = root.QUANT_CONFIG || {};
    const base = String(cfg.tgBotUrl || cfg.JOIN_BOT_URL || "https://t.me/grid_quant_bot").replace(/\/$/, "");
    const start = cfg.JOIN_BOT_START;
    return start ? base + "?start=" + encodeURIComponent(String(start)) : base;
  }

  function openJoin() {
    closeNavIfOpen();
    const url = joinTgUrl();
    if (url && url !== "#") root.open(url, "_blank", "noopener,noreferrer");
  }

  function openAuth() {
    /* 转化导流：不再做网页端登录，一键直达 Telegram 免费群 */
    openJoin();
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
        loginBtn.className = "auth-btn btn-join-tg";
        loginBtn.hidden = false;
        loginBtn.textContent = "免费加 Telegram 信号群";
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
    /* 转化导流：废弃积分新手指引，一律隐藏 */
    const box = document.getElementById("onboardBanner");
    if (box) box.hidden = true;
    return;
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

  root.QAIdentity = { paint, seat, loggedIn, persistSession, clearSession, openAuth, openJoin, joinTgUrl, LOGIN_TTL_MS };
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
