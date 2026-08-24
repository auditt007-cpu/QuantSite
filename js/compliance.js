(function (root) {
  const RISK =
    "風險提示：歷史回測數據僅供量化研究與策略分析參考，不構成任何投資建議。加密貨幣市場具備高波動風險，請審慎評估。";

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

  function ensureToast() {
    if (!document.getElementById("toast")) {
      const t = document.createElement("div");
      t.id = "toast";
      t.className = "toast";
      document.body.appendChild(t);
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
      risk: "風險披露聲明 (Risk Disclosure)",
      tos: "服務條款 (Terms of Service)",
      privacy: "隱私權政策 (Privacy Policy)",
      disclaimer: "免責聲明 (Disclaimer)",
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
    if (!foot.querySelector(".foot-risk-banner")) {
      const risk = document.createElement("p");
      risk.className = "foot-risk-banner foot-disc";
      risk.setAttribute("data-i18n", "footRiskBanner");
      risk.textContent = RISK;
      foot.insertBefore(risk, foot.firstChild);
    }
    if (!foot.querySelector(".foot-legal")) {
      const nav = document.createElement("nav");
      nav.className = "foot-legal";
      nav.innerHTML =
        '<button type="button" class="foot-link" data-legal="risk">Risk Disclosure</button>' +
        '<button type="button" class="foot-link" data-legal="tos">Terms of Service</button>' +
        '<button type="button" class="foot-link" data-legal="privacy">Privacy Policy</button>' +
        '<button type="button" class="foot-link" data-legal="disclaimer">Disclaimer</button>';
      foot.appendChild(nav);
    }
    foot.querySelectorAll("[data-legal]").forEach(function (btn) {
      if (btn.dataset.boundLegal === "1") return;
      btn.dataset.boundLegal = "1";
      btn.addEventListener("click", function () {
        openLegal(btn.getAttribute("data-legal"));
      });
    });
  }

  function boot() {
    ensureToast();
    ensureModal();
    ensureFooter();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
  root.QACompliance = { openLegal: openLegal, RISK: RISK };
})(typeof window !== "undefined" ? window : globalThis);
