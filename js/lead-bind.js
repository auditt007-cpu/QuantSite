(function (root) {
  const cfg = root.QUANT_CONFIG || {};

  function hubBase() {
    const raw = String(cfg.hubApiBase || "https://api.quantalpha.space").replace(/\/$/, "");
    return raw;
  }

  function botUser() {
    return String(cfg.tgBotUser || "@grid_quant_bot").replace(/^@/, "");
  }

  function communityBase() {
    if (root.QACommunity && typeof root.QACommunity.endpoint === "function") {
      return root.QACommunity.endpoint();
    }
    return String(cfg.COMMUNITY_ENDPOINT || cfg.tgBotUrl || "").replace(/\/$/, "") || "https://t.me/" + botUser();
  }

  function botStartUrl(startParam) {
    if (root.QACommunity && typeof root.QACommunity.endpoint === "function") {
      return root.QACommunity.endpoint(startParam);
    }
    return communityBase() + "?start=" + encodeURIComponent(startParam);
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

  function toast(msg, kind) {
    let el = document.getElementById("toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "toast";
      el.className = "toast";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.className = "toast show " + (kind || "ok");
    clearTimeout(el._hide);
    el._hide = setTimeout(function () {
      el.classList.remove("show");
    }, 5200);
  }

  function showClaimModal(token, copied) {
    let wrap = document.getElementById("claimTokenModal");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.className = "modal-bg show";
      wrap.id = "claimTokenModal";
      wrap.innerHTML =
        '<div class="modal">' +
        '<button type="button" class="modal-x" data-close-claim aria-label="關閉">×</button>' +
        "<h3>節點訂閱碼已就緒</h3>" +
        '<p class="muted" id="claimTokenMsg"></p>' +
        '<p style="font-size:1.35rem;letter-spacing:.12em;font-weight:700;margin:12px 0" id="claimTokenCode"></p>' +
        '<button type="button" class="btn-cta compact" data-open-bot>前往節點通道綁定</button>' +
        '<button type="button" class="btn ghost" data-close-claim>關閉</button>' +
        "</div>";
      document.body.appendChild(wrap);
      wrap.addEventListener("click", function (ev) {
        if (ev.target === wrap || ev.target.hasAttribute("data-close-claim")) wrap.classList.remove("show");
        if (ev.target && ev.target.hasAttribute("data-open-bot")) {
          root.open(botStartUrl(wrap.dataset.token || ""), "_blank", "noopener");
        }
      });
    }
    wrap.dataset.token = token;
    wrap.classList.add("show");
    const msg = document.getElementById("claimTokenMsg");
    const code = document.getElementById("claimTokenCode");
    if (code) code.textContent = token;
    if (msg) {
      msg.textContent = copied
        ? "您的專屬訂閱碼：" + token + "（已複製）。若跳轉後未自動填入，請直接在對話框發送此碼。"
        : "您的專屬訂閱碼：" + token + "。剪貼簿不可用，請手動複製後在節點通道對話框發送此碼。";
    }
    toast(
      copied
        ? "您的專屬訂閱碼：" + token + "（已複製）。若跳轉後未自動填入，請直接在對話框發送此碼。"
        : "您的專屬訂閱碼：" + token + "（請手動複製）",
      copied ? "ok" : "err",
    );
  }

  async function copyText(s) {
    if (root.copyToClipboard) {
      try {
        await root.copyToClipboard(s, function () {});
        return true;
      } catch {
        /* fall through */
      }
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(s);
        return true;
      }
    } catch {
      /* */
    }
    try {
      const ta = document.createElement("textarea");
      ta.value = s;
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return !!ok;
    } catch {
      return false;
    }
  }

  async function claimStrategy() {
    const token = makeToken();
    const fbclid = fbclidFromLocation();
    const ua = (navigator && navigator.userAgent) || "";
    const copied = await copyText(token);
    try {
      localStorage.setItem("quant_claim_token", token);
    } catch {
      /* */
    }
    /* Lead only on explicit subscribe CTA — never on bare page load */
    if (root.QAMetaEvents && typeof root.QAMetaEvents.trackLead === "function") {
      root.QAMetaEvents.trackLead({ content_name: "node_stream_subscribe" });
    }
    try {
      await fetch(hubBase() + "/api/leads/bind", {
        method: "POST",
        headers: { "content-type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ token: token, fbclid: fbclid, user_agent: ua }),
        mode: "cors",
        credentials: "omit",
      });
    } catch {
      /* offline / CORS — still open community with start payload */
    }
    showClaimModal(token, copied);
    setTimeout(function () {
      root.open(botStartUrl(token), "_blank", "noopener");
    }, 350);
    return token;
  }

  function shouldHijack(el) {
    if (!el || !el.closest) return false;
    if (el.id === "paySupport") return false;
    if (el.matches && el.matches("[data-keep-channel]")) return false;
    if (
      el.matches &&
      el.matches(
        "[data-get-strategy], [data-community-open], #ctaBannerBtn, #btnGetStrategy, #tgFab, #btnChannel, #btnChannel2, a.cta-btn-gold, a.tg-fab",
      )
    ) {
      return true;
    }
    const href = (el.getAttribute && (el.getAttribute("href") || el.getAttribute("data-href"))) || "";
    if (/t\.me\//i.test(href) && el.id !== "paySupport" && el.id !== "btnOpenBot") return true;
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
    const bot = communityBase();
    document.querySelectorAll("[data-community-open], #tgFab, #btnChannel, #btnChannel2, #btnGetStrategy, a[data-get-strategy]").forEach((a) => {
      if (a.id === "paySupport" || a.id === "btnOpenBot") return;
      if (a.tagName === "A") {
        a.setAttribute("href", "#");
        a.setAttribute("role", "button");
      }
      a.setAttribute("data-get-strategy", "1");
      a.setAttribute("data-community-open", "1");
    });
    const bind = document.getElementById("btnOpenBot");
    if (bind && root.QACommunity && typeof root.QACommunity.bindUrl === "function") {
      bind.setAttribute("href", root.QACommunity.bindUrl());
    }
    void bot;
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", retargetHrefs);
  else retargetHrefs();
  root.QALeadBind = {
    claimStrategy: claimStrategy,
    fbclidFromLocation: fbclidFromLocation,
    makeToken: makeToken,
    botStartUrl: botStartUrl,
  };
})(typeof window !== "undefined" ? window : globalThis);
