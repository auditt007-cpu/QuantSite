(function (root) {
  const RISK =
    "風險提示：歷史回測資料僅供量化研究與策略分析參考，不構成任何投資建議。加密貨幣市場具備高波動風險，請審慎評估。";

  const LEGAL = {
    risk:
      "本站提供之策略、信號、回測與實盤展示內容僅供量化研究與教育用途。虛擬資產價格波動劇烈，可能導致本金重大損失。請依自身風險承受能力獨立決策，並諮詢合格顧問。",
    tos:
      "使用本站即表示您同意：不得將本站內容視為投資、財務或法律建議；不得利用本站從事違法或規避監管之行為；我們得依營運需要調整服務內容與可用性。",
    privacy:
      "我們可能處理廣告歸因參數（如 fbclid）、Telegram 綁定識別碼、以及瀏覽器 User-Agent / IP（用於轉換品質與安全風控）。資料僅用於歸因、服務提供與合規必要範圍，不會出售個人資料。",
    disclaimer:
      "歷史績效不代表未來結果。回測未完整計入滑點、手續費、資金費率與流動性衝擊。任何依本站資訊採取之交易行為，風險與損益由您自行承擔。",
  };

  function t(key, fb) {
    if (root.QALang && typeof root.QALang.t === "function") {
      const live = root.QALang.t(key);
      if (live && live !== key) return live;
    }
    return fb || key;
  }

  function ensureToast() {
    if (!document.getElementById("toast")) {
      const el = document.createElement("div");
      el.id = "toast";
      el.className = "toast";
      document.body.appendChild(el);
    }
  }

  function ensureModal() {
    if (document.getElementById("legalModal")) return;
    const wrap = document.createElement("div");
    wrap.className = "modal-bg";
    wrap.id = "legalModal";
    wrap.innerHTML =
      '<div class="modal wide">' +
      '<button type="button" class="modal-x" data-close="legalModal" aria-label="關閉">×</button>' +
      '<h3 id="legalTitle">Disclaimer</h3>' +
      '<div class="legal-body muted" id="legalBody"></div>' +
      '<button class="btn ghost" data-close="legalModal">關閉</button>' +
      "</div>";
    document.body.appendChild(wrap);
    wrap.addEventListener("click", function (ev) {
      if (ev.target === wrap || (ev.target.getAttribute && ev.target.getAttribute("data-close") === "legalModal")) {
        wrap.classList.remove("show");
      }
    });
  }

  function openLegal(kind) {
    ensureModal();
    const titles = {
      risk: t("legalRisk", "風險披露聲明 (Risk Disclosure)"),
      tos: t("legalTos", "服務條款 (Terms of Service)"),
      privacy: t("legalPrivacy", "隱私權政策 (Privacy Policy)"),
      disclaimer: t("legalDisc", "免責聲明 (Disclaimer)"),
    };
    document.getElementById("legalTitle").textContent = titles[kind] || titles.disclaimer;
    document.getElementById("legalBody").textContent = LEGAL[kind] || LEGAL.disclaimer;
    document.getElementById("legalModal").classList.add("show");
  }

  function ensureFooter() {
    let foot = document.querySelector("footer.site-foot");
    if (!foot) {
      foot = document.createElement("footer");
      foot.className = "site-foot";
      const wrap = document.querySelector(".wrap") || document.body;
      wrap.appendChild(foot);
    }
    foot.classList.add("bb-site-foot");

    foot.querySelectorAll(".bb-foot-legal").forEach(function (el) {
      el.remove();
    });

    if (foot.getAttribute("data-bb-foot") !== "1") {
      foot.setAttribute("data-bb-foot", "1");
      foot.innerHTML =
        '<p class="foot-risk-banner foot-disc" data-i18n="footRiskBanner">' +
        RISK +
        "</p>" +
        '<div class="bb-foot-main">' +
        '<div class="bb-foot-grid">' +
        '<div class="bb-foot-col">' +
        '<div class="bb-foot-h" data-i18n="footColProduct">產品</div>' +
        '<a href="./strategies.html" data-i18n="navTerminal">策略廣場</a>' +
        '<a href="./bots.html" data-i18n="navBots">網格機器人</a>' +
        '<a href="./live.html" data-i18n="navLive">直播作戰室</a>' +
        '<a href="./member.html" data-i18n="navMember">會員中心</a>' +
        "</div>" +
        '<div class="bb-foot-col">' +
        '<div class="bb-foot-h" data-i18n="footColResearch">研究</div>' +
        '<a href="./about.html" data-i18n="footAbout">關於我們</a>' +
        '<a href="./about.html#whitepaper" data-i18n="footPaperClean">策略演算法白皮書</a>' +
        '<a href="./affiliate.html" data-i18n="navAff">推薦計畫</a>' +
        "</div>" +
        '<div class="bb-foot-col">' +
        '<div class="bb-foot-h" data-i18n="footColCommunity">社群</div>' +
        '<a href="#" data-community-open="1" data-get-strategy data-i18n="footSubscribe">訂閱節點資料串流</a>' +
        '<a href="./member.html#login" data-i18n="login">TG 一鍵登入</a>' +
        "</div>" +
        '<div class="bb-foot-col">' +
        '<div class="bb-foot-h" data-i18n="footColLegal">法律</div>' +
        '<button type="button" class="bb-foot-link" data-legal="tos" data-i18n="legalTos">服務條款</button>' +
        '<button type="button" class="bb-foot-link" data-legal="privacy" data-i18n="legalPrivacy">隱私權政策</button>' +
        '<button type="button" class="bb-foot-link" data-legal="risk" data-i18n="legalRisk">風險披露</button>' +
        '<button type="button" class="bb-foot-link" data-legal="disclaimer" data-i18n="legalDisc">免責聲明</button>' +
        "</div>" +
        "</div>" +
        '<div class="bb-foot-bottom">' +
        '<div class="bb-foot-brandline">' +
        '<span class="bb-foot-mark">QUANT.ALPHA</span>' +
        '<span class="bb-foot-copy" data-i18n="footCopyright">© 2026 QUANT.ALPHA. All Rights Reserved.</span>' +
        "</div>" +
        "</div>" +
        "</div>";
    }

    foot.querySelectorAll("[data-legal]").forEach(function (btn) {
      if (btn.dataset.boundLegal === "1") return;
      btn.dataset.boundLegal = "1";
      btn.addEventListener("click", function () {
        openLegal(btn.getAttribute("data-legal"));
      });
    });

    if (typeof root.QAApplyI18n === "function") root.QAApplyI18n();
  }

  function paintLegalTitles() {
    document.querySelectorAll(".bb-site-foot [data-i18n]").forEach(function () {});
    if (typeof root.QAApplyI18n === "function") root.QAApplyI18n();
  }

  function boot() {
    ensureToast();
    ensureModal();
    ensureFooter();
    paintLegalTitles();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
  root.addEventListener("quant-lang", function () {
    ensureFooter();
    paintLegalTitles();
  });
  root.QACompliance = { openLegal: openLegal, RISK: RISK, ensureFooter: ensureFooter };
})(typeof window !== "undefined" ? window : globalThis);
