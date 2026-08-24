const cfg = window.QUANT_CONFIG;
const $ = (id) => document.getElementById(id);

function t(key) {
  if (window.QALang && typeof window.QALang.t === "function") return window.QALang.t(key);
  const lang = localStorage.getItem("quant_lang") || localStorage.getItem("user_lang") || "en";
  const mapped = lang === "zh-Hans" ? "zh-CN" : lang;
  const pack = (window.I18N && (window.I18N[mapped] || window.I18N.en || window.I18N["zh-Hant"])) || {};
  return pack[key] || key;
}

function loggedIn() {
  if (window.QAAuth && typeof window.QAAuth.loggedIn === "function") return window.QAAuth.loggedIn();
  return Boolean(localStorage.getItem("quant_tg"));
}

function toast(msg, kind) {
  const el = $("toast");
  if (!el) return;
  el.textContent = msg;
  el.className = "toast show " + (kind || "ok");
  setTimeout(() => el.classList.remove("show"), 2400);
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

function showPanels() {
  const ok = loggedIn();
  if ($("loginPanel")) $("loginPanel").hidden = ok;
  if ($("dashPanel")) $("dashPanel").hidden = !ok;
}

function applyAuthUi() {
  const tg = localStorage.getItem("quant_tg") || "";
  const vip = localStorage.getItem("quant_paid") === "1";
  if ($("dashUser")) $("dashUser").textContent = tg ? "Telegram ID  " + tg : "";
  if ($("nodeName")) $("nodeName").textContent = vip ? t("nodePro") : t("nodeBasic");
  if ($("dashLevel")) $("dashLevel").textContent = vip ? t("dashLevelVip") : t("dashLevelFree");
  if (loggedIn() && !localStorage.getItem("quant_join_at")) {
    localStorage.setItem("quant_join_at", String(Date.now()));
  }
  const hook = $("hookUrl");
  if (hook && cfg.apiBase) {
    hook.textContent = cfg.apiBase.replace(/\/$/, "") + "/api/webhook-relay";
    const tgId = localStorage.getItem("quant_tg") || "";
    if ($("hookPayload")) {
      $("hookPayload").textContent = JSON.stringify(
        { symbol: "{{ticker}}", action: "{{strategy.order.action}}", price: "{{close}}", tg_id: tgId },
        null,
        2,
      );
    }
  }
  showPanels();
  refreshInviteUi();
  window.dispatchEvent(new Event("quant-auth"));
}

let loginBusy = false;
function lockUntil() { return Number(localStorage.getItem("quant_login_lock") || 0); }
function failCount() { return Number(localStorage.getItem("quant_login_fails") || 0); }
function bumpLoginFail() {
  const n = failCount() + 1;
  localStorage.setItem("quant_login_fails", String(n));
  if (n >= 5) localStorage.setItem("quant_login_lock", String(Date.now() + 15 * 60 * 1000));
  return n;
}
function otpCells() { return Array.from(document.querySelectorAll(".otp-cell")); }
function otpRead() {
  const v = otpCells().map((el) => el.value.replace(/\D/g, "")).join("").slice(0, 4);
  if ($("loginCode")) $("loginCode").value = v;
  return v;
}
function otpWrite(str) {
  const s = String(str || "").replace(/\D/g, "").slice(0, 4);
  otpCells().forEach((el, i) => { el.value = s[i] || ""; });
  if ($("loginCode")) $("loginCode").value = s;
}
function wireOtp() {
  const cells = otpCells();
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

function parentInviteFromUrl() {
  const q = new URLSearchParams(location.search).get("ref");
  if (q) localStorage.setItem("quant_ref", q);
  return q || localStorage.getItem("quant_ref") || "";
}

async function doLogin() {
  const st = $("loginStatus");
  const btn = $("btnDoLogin");
  if (loginBusy || !st || !btn) return;
  if (lockUntil() > Date.now()) {
    st.className = "status err";
    st.textContent = t("locked");
    return;
  }
  const code = otpRead() || String($("loginCode").value || "").replace(/\D/g, "").slice(0, 4);
  otpWrite(code);
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
    if (window.QAAuth) window.QAAuth.persistSession(data.tg_id, data.token);
    else {
      localStorage.setItem("quant_tg", String(data.tg_id));
      localStorage.setItem("login_timestamp", String(Date.now()));
    }
    if (!localStorage.getItem("quant_join_at")) localStorage.setItem("quant_join_at", String(Date.now()));
    if (data.invite_code) localStorage.setItem("quant_invite", data.invite_code);
    if (data.invite_count != null) localStorage.setItem("quant_invites", String(data.invite_count));
    st.textContent = t("logged");
    toast(t("logged"), "ok");
    applyAuthUi();
    if (location.hash === "#pay" && $("payBox")) $("payBox").scrollIntoView({ behavior: "smooth" });
  } catch {
    const n = bumpLoginFail();
    st.className = "status err";
    st.textContent = lockUntil() > Date.now() ? t("locked") : t("badCode") + " · " + t("leftTries").replace("{n}", String(Math.max(0, 5 - n)));
  } finally {
    loginBusy = false;
    btn.disabled = false;
    btn.textContent = t("doLogin");
  }
}

async function refreshInviteUi() {
  if (!$("inviteLink")) return;
  const origin = location.origin + "/";
  const tg = localStorage.getItem("quant_tg");
  let code = localStorage.getItem("quant_invite") || "";
  let count = Number(localStorage.getItem("quant_invites") || "0");
  let avail = 0;
  let pend = 0;
  if (tg) {
    try {
      const res = await fetch(cfg.apiBase + "/api/affiliate?tg_id=" + encodeURIComponent(tg));
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "載入失敗");
      code = data.me?.invite_code || code;
      count = data.me?.invite_count ?? count;
      avail = Number(data.withdrawable || 0);
      pend = Number(data.pending || 0);
      if (data.me?.paid) localStorage.setItem("quant_paid", "1");
      if (data.me?.unlocked || (data.me?.invite_count || 0) >= 2) localStorage.setItem("quant_unlocked", "1");
      else localStorage.removeItem("quant_unlocked");
      localStorage.setItem("quant_invite", code);
      localStorage.setItem("quant_invites", String(count));
      if ($("refBar")) $("refBar").style.width = Math.min(100, (count / 2) * 100) + "%";
    } catch {
      /* keep cached */
    }
  }
  const lang = localStorage.getItem("quant_lang") || "zh-Hant";
  $("inviteLink").textContent = code ? `${origin}?ref=${code}` : "—";
  if ($("refCount")) $("refCount").textContent = `${count}${lang === "en" ? " / 2 binds" : " / 2 人"}`;
  const money = window.QAMoney;
  if ($("refAvail")) $("refAvail").textContent = money ? money.fmtUsdt(avail) : avail.toFixed(2) + " USDT";
  if ($("refPend")) $("refPend").textContent = money ? money.fmtUsdt(pend) : pend.toFixed(2) + " USDT";
}

function logout() {
  if (window.QAAuth) window.QAAuth.clearSession();
  else {
    localStorage.removeItem("quant_tg");
    localStorage.removeItem("quant_token");
    localStorage.removeItem("login_timestamp");
    localStorage.removeItem("quant_paid");
  }
  applyAuthUi();
}

async function loadPay(plan) {
  const userId = localStorage.getItem("quant_tg") || uid();
  if ($("payStatus")) $("payStatus").textContent = t("locking");
  if ($("payDetail")) $("payDetail").hidden = false;
  try {
    const data = await api("/api/pay-intent?user_id=" + encodeURIComponent(userId) + "&plan=" + encodeURIComponent(plan || "vip"));
    $("payAmount").textContent = window.QAMoney ? window.QAMoney.fmtUsdt(data.amount) : data.amount + " USDT";
    $("payMeta").textContent = t("lockMeta").replace("{t}", new Date(data.expires_at).toLocaleString());
    $("payStatus").textContent = t("payHint");
    $("wallet").textContent = cfg.usdtWallet;
  } catch (e) {
    $("payStatus").className = "status err";
    $("payStatus").textContent = e.message;
  }
}

let payLock = 0;
let payTimer = null;
async function verifyTx() {
  if (payLock > 0) return;
  const raw = $("txid").value.trim();
  const userId = localStorage.getItem("quant_tg") || uid();
  if (window.QAMoney && !window.QAMoney.isTxHash(raw)) {
    $("payStatus").className = "status err";
    $("payStatus").textContent = t("badTx");
    return;
  }
  if (raw.length < 16) {
    $("payStatus").className = "status err";
    $("payStatus").textContent = t("txShort");
    return;
  }
  payLock = 10;
  $("payBtn").disabled = true;
  $("payBtn").textContent = t("payBusy").replace("{n}", "10");
  payTimer = setInterval(() => {
    payLock -= 1;
    if (payLock <= 0) {
      clearInterval(payTimer);
      payTimer = null;
      $("payBtn").disabled = false;
      $("payBtn").textContent = t("submitPay");
      return;
    }
    $("payBtn").textContent = t("payBusy").replace("{n}", String(payLock));
  }, 1000);
  $("payStatus").className = "status";
  try {
    const data = await api("/api/verify-usdt", {
      method: "POST",
      body: JSON.stringify({ txid: raw, user_id: userId }),
    });
    localStorage.setItem("quant_paid", "1");
    applyAuthUi();
    $("payStatus").textContent = data.message || t("paidOk");
    toast(t("paidOk"), "ok");
  } catch (e) {
    $("payStatus").className = "status err";
    $("payStatus").textContent = e.message;
  }
}

parentInviteFromUrl();
showPanels();
applyAuthUi();
if ($("btnChannel")) $("btnChannel").href = "#";
if ($("btnOpenBot") && window.QACommunity && typeof window.QACommunity.bindUrl === "function") {
  $("btnOpenBot").href = window.QACommunity.bindUrl();
} else if ($("btnOpenBot")) {
  const u = String((cfg && cfg.COMMUNITY_ENDPOINT) || (cfg && cfg.tgBotUrl) || "").replace(/\/$/, "");
  $("btnOpenBot").href = u ? u + "?start=bind" : "#";
}
if ($("paySupport") && window.QACommunity && typeof window.QACommunity.endpoint === "function") {
  $("paySupport").href = window.QACommunity.endpoint();
}
if ($("btnOpenBot")) $("btnOpenBot").href = cfg.tgBotUrl;
if ($("wallet")) $("wallet").textContent = cfg.usdtWallet;
if ($("paySupport")) $("paySupport").href = cfg.tgSupportUrl || cfg.tgBotUrl;
wireOtp();
if (window.QACopy) {
  if ($("btnCopyInvite")) window.QACopy.bindCopyButton($("btnCopyInvite"), () => $("inviteLink").textContent, "copyInviteOk");
  if ($("btnCopyAddr")) window.QACopy.bindCopyButton($("btnCopyAddr"), () => cfg.usdtWallet, "copyAddrOk");
  if ($("btnCopyHook")) window.QACopy.bindCopyButton($("btnCopyHook"), () => $("hookUrl").textContent, "copyHookOk");
  if ($("btnCopyPayload")) window.QACopy.bindCopyButton($("btnCopyPayload"), () => $("hookPayload").textContent, "copyPayloadOk");
}
if ($("btnDoLogin")) $("btnDoLogin").addEventListener("click", doLogin);
if ($("btnLogout")) $("btnLogout").addEventListener("click", logout);
if ($("btnPayIntent")) $("btnPayIntent").addEventListener("click", () => loadPay("vip"));
if ($("btnPayTrial")) $("btnPayTrial").addEventListener("click", () => loadPay("trial"));
if ($("payBtn")) $("payBtn").addEventListener("click", verifyTx);
window.addEventListener("quant-lang", applyAuthUi);
window.addEventListener("quant-auth", showPanels);
if (location.hash === "#pay" && loggedIn() && $("payBox")) {
  $("payBox").scrollIntoView({ behavior: "smooth" });
}
