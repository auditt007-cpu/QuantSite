(function (root) {
  const cfg = root.QUANT_CONFIG || {};

  function hubBase() {
    return String(cfg.hubApiBase || "").replace(/\/$/, "");
  }

  function botUser() {
    return String(cfg.tgBotUser || "@grid_quant_bot").replace(/^@/, "");
  }

  function botStartUrl(startParam) {
    return "https://t.me/" + botUser() + "?start=" + encodeURIComponent(startParam);
  }

  function fbclidFromLocation() {
    try {
      const u = new URL(root.location.href);
      const q = u.searchParams.get("fbclid") || "";
      if (q) {
        localStorage.setItem("quant_fbclid", q);
        return q;
      }
    } catch {
      /* */
    }
    try {
      return localStorage.getItem("quant_fbclid") || "";
    } catch {
      return "";
    }
  }

  function makeToken() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let tail = "";
    for (let i = 0; i < 4; i += 1) {
      tail += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
    }
    return "VIP" + tail;
  }

  async function copyText(s) {
    if (root.copyToClipboard) {
      try {
        await root.copyToClipboard(s, function () {});
        return true;
      } catch {
        /* */
      }
    }
    try {
      await navigator.clipboard.writeText(s);
      return true;
    } catch {
      return false;
    }
  }

  async function claimStrategy() {
    const token = makeToken();
    const fbclid = fbclidFromLocation();
    await copyText(token);
    try {
      localStorage.setItem("quant_claim_token", token);
    } catch {
      /* */
    }
    try {
      await fetch(hubBase() + "/api/leads/bind", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: token, fbclid: fbclid }),
      });
    } catch {
      /* */
    }
    root.open(botStartUrl(token), "_blank", "noopener");
    return token;
  }

  function shouldHijack(el) {
    if (!el || !el.closest) return false;
    if (el.id === "paySupport") return false;
    if (el.matches && el.matches("[data-keep-channel]")) return false;
    if (el.matches && el.matches("[data-get-strategy], #ctaBannerBtn, #btnGetStrategy, #tgFab, #btnChannel, #btnChannel2, a.cta-btn-gold, a.tg-fab")) {
      return true;
    }
    const href = (el.getAttribute && (el.getAttribute("href") || el.getAttribute("data-href"))) || "";
    if (/t\.me\/quant_alpha_signals/i.test(href)) return true;
    if (/t\.me\/grid_quant_bot/i.test(href) && !/start=VIP/i.test(href) && el.id !== "paySupport") return true;
    return false;
  }

  document.addEventListener(
    "click",
    function (ev) {
      const el = ev.target && ev.target.closest && ev.target.closest("a, button");
      if (!shouldHijack(el)) return;
      ev.preventDefault();
      ev.stopPropagation();
      claimStrategy();
    },
    true,
  );

  function retargetHrefs() {
    fbclidFromLocation();
    const bot = "https://t.me/" + botUser();
    document.querySelectorAll("a[href*='quant_alpha_signals'], #tgFab, #btnChannel, #btnChannel2").forEach((a) => {
      if (a.id === "paySupport") return;
      a.setAttribute("href", bot);
      a.setAttribute("data-get-strategy", "1");
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", retargetHrefs);
  else retargetHrefs();
  root.QALeadBind = { claimStrategy: claimStrategy, fbclidFromLocation: fbclidFromLocation, makeToken: makeToken, botStartUrl: botStartUrl };
})(typeof window !== "undefined" ? window : globalThis);
