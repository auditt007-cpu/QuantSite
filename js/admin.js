const cfg = window.QUANT_CONFIG;
const $ = (id) => document.getElementById(id);

function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 1800);
}

function secret() {
  return sessionStorage.getItem("quant_admin") || "";
}

function when(ts) {
  if (!ts) return "—";
  const d = new Date(Number(ts));
  if (!isFinite(d.getTime())) return "—";
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

async function api(path, opts = {}) {
  const headers = { "content-type": "application/json", ...(opts.headers || {}) };
  if (secret()) headers["X-Admin-Secret"] = secret();
  const res = await fetch(cfg.apiBase + path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "API " + res.status);
  return data;
}

function fill(s) {
  $("id").value = s.id;
  $("name").value = s.name || "";
  $("symbols").value = (s.symbols || []).join(",");
  $("interval").value = s.interval || "1h";
  $("tags").value = (s.tags || []).join(",");
  $("engine").value = s.engine || s.id;
  $("tier").value = s.tier === "master" ? "master" : "free";
}

function paintMembers(list) {
  $("members").innerHTML = (list || [])
    .map((u) => {
      const paid = u.paid ? "已付費" : "未付費";
      const seat = u.paid ? "VIP" : u.unlocked ? "已解鎖" : "免費";
      return `<tr>
        <td>${u.tg_id || "—"}</td>
        <td>${paid}</td>
        <td>${seat}</td>
        <td>${u.login_count || 0}</td>
        <td>${when(u.last_login_at)}</td>
        <td>${when(u.last_seen)}</td>
        <td>${u.last_ip || "—"}</td>
        <td>${u.last_country || "—"}</td>
        <td>${u.invite_count || 0}</td>
        <td>${when(u.created_at)}</td>
      </tr>`;
    })
    .join("") || `<tr><td colspan="10" class="muted">尚無會員</td></tr>`;
}

async function load() {
  const [members, strats] = await Promise.all([api("/api/admin/members"), api("/api/strategies")]);
  paintMembers(members.members || []);
  $("rows").innerHTML = (strats.strategies || [])
    .map(
      (s) => `<tr>
        <td>${s.id}</td>
        <td>${s.name}</td>
        <td>${s.tier === "master" ? "大師組" : "免費區"}</td>
        <td>${(s.symbols || []).join(",")}</td>
        <td>${s.interval}</td>
        <td>${(s.tags || []).join(",")}</td>
        <td><button class="btn ghost" data-edit="${s.id}">編輯</button></td>
      </tr>`,
    )
    .join("");
  document.querySelectorAll("[data-edit]").forEach((b) => {
    b.addEventListener("click", () => {
      const s = (strats.strategies || []).find((x) => x.id === b.getAttribute("data-edit"));
      if (s) fill(s);
    });
  });
}

function body() {
  return {
    id: $("id").value.trim(),
    name: $("name").value.trim(),
    symbols: $("symbols").value,
    interval: $("interval").value.trim(),
    tags: $("tags").value,
    engine: $("engine").value.trim(),
    tier: $("tier").value,
  };
}

function showConsole() {
  $("gate").hidden = true;
  $("console").hidden = false;
}

function showGate(msg) {
  $("gate").hidden = false;
  $("console").hidden = true;
  if (msg) $("st").textContent = msg;
}

async function tryEnter() {
  const val = $("secret").value.trim();
  if (!val) {
    showGate("請輸入密碼");
    return;
  }
  sessionStorage.setItem("quant_admin", val);
  $("st").textContent = "驗證中…";
  try {
    await load();
    showConsole();
    $("st2").textContent = "已載入 " + new Date().toLocaleString();
  } catch (e) {
    sessionStorage.removeItem("quant_admin");
    showGate(e.message === "unauthorized" ? "密碼錯誤" : e.message);
  }
}

$("btnLogin").addEventListener("click", tryEnter);
$("secret").addEventListener("keydown", (e) => {
  if (e.key === "Enter") tryEnter();
});
$("btnReload").addEventListener("click", async () => {
  try {
    await load();
    $("st2").textContent = "已刷新 " + new Date().toLocaleString();
  } catch (e) {
    toast(e.message);
  }
});
$("btnLogout").addEventListener("click", () => {
  sessionStorage.removeItem("quant_admin");
  $("secret").value = "";
  showGate("已登出");
});

$("btnUpsert").addEventListener("click", async () => {
  const item = body();
  try {
    const cur = await api("/api/strategies");
    const exists = (cur.strategies || []).some((s) => s.id === item.id);
    if (exists) {
      await api("/api/strategies/" + encodeURIComponent(item.id), {
        method: "PUT",
        body: JSON.stringify(item),
      });
    } else {
      await api("/api/strategies", { method: "POST", body: JSON.stringify(item) });
    }
    toast("已寫入 KV");
    await load();
  } catch (e) {
    toast(e.message);
  }
});

$("btnDel").addEventListener("click", async () => {
  const id = $("id").value.trim();
  try {
    await api("/api/strategies/" + encodeURIComponent(id), { method: "DELETE" });
    toast("已刪除");
    await load();
  } catch (e) {
    toast(e.message);
  }
});

if (secret()) {
  $("secret").value = secret();
  tryEnter();
}
