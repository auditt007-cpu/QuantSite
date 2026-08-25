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

  function showClaimModal(token, copied, bound) {
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
          if (wrap.dataset.bound !== "1") return;
          root.open(botStartUrl(wrap.dataset.token || ""), "_blank", "noopener");
        }
      });
    }
    wrap.dataset.token = token;
    wrap.dataset.bound = bound ? "1" : "0";
    wrap.classList.add("show");
    const msg = document.getElementById("claimTokenMsg");
    const code = document.getElementById("claimTokenCode");
    const openBtn = wrap.querySelector("[data-open-bot]");
    if (code) code.textContent = token;
    if (openBtn) openBtn.hidden = !bound;
    if (msg) {
      if (!bound) {
        msg.textContent = "歸因寫入未成功，Telegram 尚未打開。請保留此碼並重試「訂閱」，以免 CAPI 無法回傳 fbclid。";
      } else {
        msg.textContent = copied
          ? "您的專屬訂閱碼：" + token + "（已複製）。若跳轉後未自動填入，請直接在對話框發送此碼。"
          : "您的專屬訂閱碼：" + token + "。剪貼簿不可用，請手動複製後在節點通道對話框發送此碼。";
      }
    }
    if (bound) {
      toast(
        copied
          ? "您的專屬訂閱碼：" + token + "（已複製）。若跳轉後未自動填入，請直接在對話框發送此碼。"
          : "您的專屬訂閱碼：" + token + "（請手動複製）",
        copied ? "ok" : "err",
      );
    }
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

  async function postLeadBind(token, fbclid, ua) {
    const res = await fetch(hubBase() + "/api/leads/bind", {
      method: "POST",
      headers: { "content-type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ token: token, fbclid: fbclid, user_agent: ua }),
      mode: "cors",
      credentials: "omit",
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (!res.ok || !data || data.ok !== true || !data.token) {
      throw new Error("lead_bind_failed");
    }
    return data;
  }

  async function claimStrategy() {
    const token = makeToken();
    const fbclid = fbclidFromLocation();
    const ua = (navigator && navigator.userAgent) || "";
    try {
      localStorage.setItem("quant_claim_token", token);
    } catch {
      /* */
    }
    let bound;
    try {
      bound = await postLeadBind(token, fbclid, ua);
    } catch {
      toast("節點尚未寫入歸因庫，未打開 Telegram。請檢查網絡後重試，以免 CAPI 斷鏈。", "err");
      showClaimModal(token, false, false);
      return "";
    }
    const copied = await copyText(bound.token || token);
    if (root.QAMetaEvents && typeof root.QAMetaEvents.trackLead === "function") {
      root.QAMetaEvents.trackLead({ content_name: "node_stream_subscribe" });
    }
    showClaimModal(bound.token || token, copied, true);
    setTimeout(function () {
      root.open(botStartUrl(bound.start || bound.token || token), "_blank", "noopener");
    }, 350);
    return bound.token || token;
  }

  function shouldHijack(el) {
    if (!el || !el.closest) return false;
    if (el.id === "paySupport") return false;
    if (el.matches && el.matches("[data-keep-channel]")) return false;
    if (
      el.matches &&
      el.matches(
        "[data-get-strategy], [data-community-open], #ctaBannerBtn, #btnGetStrategy, #btnChannel, #btnChannel2, a.cta-btn-gold",
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
    document.querySelectorAll("[data-community-open], #btnChannel, #btnChannel2, #btnGetStrategy, a[data-get-strategy]").forEach((a) => {
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
