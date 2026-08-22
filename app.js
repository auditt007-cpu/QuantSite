const cfg = window.QUANT_CONFIG;
const $ = (id) => document.getElementById(id);
let lang = "zh-Hant";

function t(key) {
  const pack = window.I18N[lang] || window.I18N["zh-Hant"];
  return pack[key] || window.I18N["zh-Hant"][key] || key;
}

function detectLang() {
  const saved = localStorage.getItem("quant_lang");
  if (saved && window.I18N[saved]) return saved;
  return "zh-Hant";
}

function loggedIn() {
  return Boolean(localStorage.getItem("quant_tg"));
}

function applyAuthUi() {
  const btn = $("btnAuth");
  btn.textContent = loggedIn() ? t("member") : t("login");
  const hint = document.querySelector(".micro-tag");
  if (hint) hint.style.display = loggedIn() ? "none" : "";
  const tg = localStorage.getItem("quant_tg") || "";
  $("dashUser").textContent = tg ? "Telegram ID  " + tg : "";
  const vip = localStorage.getItem("quant_paid") === "1";
  $("nodeName").textContent = vip ? t("nodePro") : t("nodeBasic");
  $("dashLevel").textContent = vip ? "Pro" : (lang === "en" ? "Free node" : lang === "zh-CN" ? "等级：免费节点" : "等級：免費節點");
  refreshInviteUi();
}

function applyI18n() {
  document.documentElement.lang = lang === "en" ? "en" : lang === "zh-CN" ? "zh-CN" : "zh-Hant";
  document.title = t("title");
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    if (el.id === "nodeName" || el.id === "dashLevel" || el.id === "mCap" || el.id === "mWin" || el.id === "mPf" || el.id === "mDd" || el.id === "btnAuth" || el.id === "refCount") return;
    el.textContent = t(el.getAttribute("data-i18n"));
  });
  document.querySelectorAll("[data-ph]").forEach((el) => {
    el.placeholder = t(el.getAttribute("data-ph"));
  });
  if ($("txid") && !$("txid").getAttribute("data-ph")) $("txid").placeholder = t("phTxid");
  document.querySelectorAll("[data-lang]").forEach((b) => {
    b.classList.toggle("active", b.getAttribute("data-lang") === lang);
  });
  applyAuthUi();
  applyDesk(false);
}

function toast(msg, kind) {
  const el = $("toast");
  el.textContent = msg;
  el.className = "toast show " + (kind || "ok");
  setTimeout(() => el.classList.remove("show"), 2400);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast(t("copied"));
  } catch {
    toast(t("copyFail"));
  }
}

function uid() {
  let id = localStorage.getItem("quant_uid");
  if (!id) {
    id = "web_" + Math.random().toString(36).slice(2, 10);
    localStorage.setItem("quant_uid", id);
  }
  return id;
}

async function api(path, opts = {}) {
  const res = await fetch(cfg.apiBase + path, {
    headers: { "content-type": "application/json", ...(opts.headers || {}) },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || "API " + res.status);
  return data;
}

function applyDesk() {}

function openModal(id) { $(id).classList.add("show"); }
function closeModal(id) { $(id).classList.remove("show"); }

function onAuthClick() {
  if (loggedIn()) {
    $("payDetail").hidden = true;
    applyAuthUi();
    openModal("dashModal");
  } else openModal("loginModal");
}

let loginBusy = false;

function lockUntil() {
  return Number(localStorage.getItem("quant_login_lock") || 0);
}

function failCount() {
  return Number(localStorage.getItem("quant_login_fails") || 0);
}

function bumpLoginFail() {
  const n = failCount() + 1;
  localStorage.setItem("quant_login_fails", String(n));
  if (n >= 5) localStorage.setItem("quant_login_lock", String(Date.now() + 15 * 60 * 1000));
  return n;
}

function otpCells() {
  return Array.from(document.querySelectorAll(".otp-cell"));
}

function otpRead() {
  const v = otpCells().map((el) => el.value.replace(/\D/g, "")).join("").slice(0, 4);
  if ($("loginCode")) $("loginCode").value = v;
  return v;
}

function otpWrite(str) {
  const s = String(str || "").replace(/\D/g, "").slice(0, 4);
  otpCells().forEach((el, i) => {
    el.value = s[i] || "";
  });
  if ($("loginCode")) $("loginCode").value = s;
}

function wireOtp() {
  const cells = otpCells();
  if (!cells.length) return;
  cells.forEach((el, i) => {
    el.addEventListener("input", () => {
      el.value = el.value.replace(/\D/g, "").slice(-1);
      otpRead();
      if (el.value && cells[i + 1]) cells[i + 1].focus();
      if (otpRead().length === 4) doLogin();
    });
    el.addEventListener("keydown", (e) => {
      if (e.key === "Backspace" && !el.value && cells[i - 1]) cells[i - 1].focus();
      if (e.key === "Enter") doLogin();
    });
    el.addEventListener("paste", (e) => {
      e.preventDefault();
      otpWrite((e.clipboardData || window.clipboardData).getData("text"));
      if (otpRead().length === 4) doLogin();
    });
  });
}

async function doLogin() {
  const st = $("loginStatus");
  const btn = $("btnDoLogin");
  if (loginBusy) return;
  const until = lockUntil();
  if (until > Date.now()) {
    st.className = "status err";
    st.textContent = t("locked");
    return;
  }
  const code = otpRead() || String($("loginCode").value || "").replace(/\D/g, "").slice(0, 4);
  otpWrite(code);
  st.className = "status";
  if (!/^\d{4}$/.test(code)) {
    st.className = "status err";
    st.textContent = t("needLogin");
    return;
  }
  loginBusy = true;
  btn.disabled = true;
  btn.textContent = t("logging");
  st.textContent = t("logging");
  try {
    const data = await api("/api/bind-tg", {
      method: "POST",
      body: JSON.stringify({ code, parent_invite: parentInviteFromUrl() }),
    });
    if (!data || !data.ok || !data.tg_id) throw new Error(t("badCode"));
    localStorage.removeItem("quant_login_fails");
    localStorage.removeItem("quant_login_lock");
    localStorage.setItem("quant_tg", String(data.tg_id));
    if (data.invite_code) localStorage.setItem("quant_invite", data.invite_code);
    if (data.invite_count != null) localStorage.setItem("quant_invites", String(data.invite_count));
    st.className = "status";
    st.textContent = t("logged");
    toast(t("logged"), "ok");
    applyAuthUi();
    closeModal("loginModal");
    openModal("dashModal");
  } catch (e) {
    const n = bumpLoginFail();
    st.className = "status err";
    if (lockUntil() > Date.now()) st.textContent = t("locked");
    else st.textContent = t("badCode") + " · " + t("leftTries").replace("{n}", String(Math.max(0, 5 - n)));
  } finally {
    loginBusy = false;
    btn.disabled = false;
    btn.textContent = t("doLogin");
  }
}

function parentInviteFromUrl() {
  const q = new URLSearchParams(location.search).get("ref");
  if (q) localStorage.setItem("quant_ref", q);
  return q || localStorage.getItem("quant_ref") || "";
}

async function refreshInviteUi() {
  const origin = location.origin + location.pathname.replace(/index\.html$/, "");
  const tg = localStorage.getItem("quant_tg");
  let code = localStorage.getItem("quant_invite") || "";
  let count = Number(localStorage.getItem("quant_invites") || "0");
  let avail = 0;
  let pend = 0;
  if (tg) {
    try {
      let res = await fetch(cfg.apiBase + "/api/affiliate?tg_id=" + encodeURIComponent(tg));
      let data = await res.json();
      if (!res.ok) throw new Error(data.error || "載入失敗");
      code = data.me?.invite_code || code;
      count = data.me?.invite_count ?? count;
      avail = Number(data.withdrawable || 0);
      pend = Number(data.pending || 0);
      if (data.me?.paid) localStorage.setItem("quant_paid", "1");
      localStorage.setItem("quant_invite", code);
      localStorage.setItem("quant_invites", String(count));
      const bar = $("refBar");
      if (bar) bar.style.width = Math.min(100, (count / 2) * 100) + "%";
    } catch {
      /* keep cached */
    }
  }
  $("inviteLink").textContent = code ? `${origin}?ref=${code}` : "—";
  const unit = lang === "en" ? " / 2 binds" : " / 2 人";
  $("refCount").textContent = `${count}${unit}`;
  $("refAvail").textContent = avail.toFixed(2) + " USDT";
  $("refPend").textContent = pend.toFixed(2) + " USDT";
}

const LEGAL = {
  risk: {
    title: "風險披露聲明 (Risk Disclosure)",
    body: "數位資產與槓桿交易具有極高風險，可能導致本金全部損失。歷史回測績效不代表未來結果。請僅以可承受損失之資金參與研究。QUANT ALPHA TECHNOLOGIES LTD. 不對任何交易損益負責。",
  },
  tos: {
    title: "服務條款 (Terms of Service)",
    body: "使用本站即表示您同意：本平台提供量化回測展示、程式碼樣本與通知工具。您須自行遵守所在地法律。我們可因維護、合規或濫用行為中止服務。邀請與佣金以系統記錄為準，異常帳戶可被取消。",
  },
  privacy: {
    title: "隱私權政策 (Privacy Policy)",
    body: "我們僅處理您主動提供的 Telegram ID、綁定碼與鏈上 TXID，用於開通通知與核驗付款。資料存放於 Cloudflare 邊緣儲存。我們不出售個人資料。您可透過會員中心登出並停止使用。",
  },
  disclaimer: {
    title: "免責聲明 (Disclaimer)",
    body: "本平台所有策略、代碼與信號僅供量化回測與學術研究，不構成任何投資建議與收益承諾。看板數據、買賣點標記與績效數字均為研究展示，不得視為實盤保證。使用者應獨立判斷並自行承擔全部風險。",
  },
};

function openLegal(kind) {
  const doc = LEGAL[kind];
  if (!doc) return;
  $("legalTitle").textContent = t(kind === "risk" ? "legalRisk" : kind === "tos" ? "legalTos" : kind === "privacy" ? "legalPrivacy" : "legalDisc");
  $("legalBody").textContent = doc.body;
  openModal("legalModal");
}
function logout() {
  localStorage.removeItem("quant_tg");
  localStorage.removeItem("quant_paid");
  applyAuthUi();
  closeModal("dashModal");
}

async function loadPay(plan) {
  const userId = localStorage.getItem("quant_tg") || uid();
  $("payStatus").textContent = t("locking");
  $("payDetail").hidden = false;
  try {
    const q = "/api/pay-intent?user_id=" + encodeURIComponent(userId) + "&plan=" + encodeURIComponent(plan || "vip");
    const data = await api(q);
    $("payAmount").textContent = data.amount + " USDT";
    $("payMeta").textContent = t("lockMeta").replace("{t}", new Date(data.expires_at).toLocaleString());
    $("payStatus").textContent = t("payHint");
    $("wallet").textContent = cfg.usdtWallet;
  } catch (e) {
    $("payStatus").className = "status err";
    $("payStatus").textContent = e.message;
  }
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function verifyTx() {
  const txid = $("txid").value.trim();
  const userId = localStorage.getItem("quant_tg") || uid();
  if (txid.length < 16) {
    $("payStatus").className = "status err";
    $("payStatus").textContent = t("txShort");
    return;
  }
  $("payBtn").disabled = true;
  $("payStatus").className = "status";
  let lastErr = t("verifying");
  try {
    for (let n = 1; n <= 12; n++) {
      $("payStatus").textContent = t("chainSync").replace("{n}", String(n));
      try {
        const data = await api("/api/verify-usdt", {
          method: "POST",
          body: JSON.stringify({ txid, user_id: userId }),
        });
        localStorage.setItem("quant_paid", "1");
        applyAuthUi();
        $("payStatus").textContent = data.message || t("paidOk");
        toast(t("paidOk"), "ok");
        return;
      } catch (e) {
        lastErr = e.message;
        await sleep(2500);
      }
    }
    $("payStatus").className = "status err";
    $("payStatus").textContent = lastErr;
  } finally {
    $("payBtn").disabled = false;
  }
}

function wire() {
  lang = detectLang();
  parentInviteFromUrl();
  applyI18n();
  $("btnChannel").href = cfg.tgChannelUrl;
  if ($("btnChannel2")) $("btnChannel2").href = cfg.tgChannelUrl;
  $("btnOpenBot").href = cfg.tgBotUrl;
  $("wallet").textContent = cfg.usdtWallet;
  if ($("paySupport")) $("paySupport").href = cfg.tgSupportUrl || cfg.tgBotUrl;
  if ($("tgFab")) $("tgFab").href = cfg.tgChannelUrl;
  wireOtp();
  if (location.hash === "#login") openModal("loginModal");
  const tick = $("signalTicker");
  if (tick) {
    const spin = () => {
      const px = ($("lastPx") && $("lastPx").textContent) || "64,200";
      tick.textContent = t("tickerTpl").replace("{px}", px);
    };
    spin();
    setInterval(spin, 8000);
  }
  window.addEventListener("quant-lang", () => {
    lang = detectLang();
    applyI18n();
  });
  $("btnAuth").addEventListener("click", onAuthClick);
  $("btnDoLogin").addEventListener("click", doLogin);
  $("btnLogout").addEventListener("click", logout);
  $("btnPayIntent").addEventListener("click", () => loadPay("vip"));
  if ($("btnPayTrial")) $("btnPayTrial").addEventListener("click", () => loadPay("trial"));
  $("btnCopyInvite").addEventListener("click", async () => {
    const btn = $("btnCopyInvite");
    const prev = btn.textContent;
    await copyText($("inviteLink").textContent);
    btn.textContent = t("copyDone");
    setTimeout(() => {
      btn.textContent = t("copyInvite");
    }, 2000);
  });
  $("btnCopyAddr").addEventListener("click", () => copyText(cfg.usdtWallet));
  $("payBtn").addEventListener("click", verifyTx);
  document.querySelectorAll("[data-legal]").forEach((b) => {
    b.addEventListener("click", () => openLegal(b.getAttribute("data-legal")));
  });
  document.querySelectorAll("[data-close]").forEach((b) => {
    b.addEventListener("click", () => closeModal(b.getAttribute("data-close")));
  });
  window.QALiveDesk.start();
}

wire();
