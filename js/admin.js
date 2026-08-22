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
  $("winRate").value = s.winRate == null ? "" : s.winRate;
  $("sharpe").value = s.sharpe == null ? "" : s.sharpe;
  $("pine").value = s.pine || "";
}

async function load() {
  const data = await api("/api/strategies");
  $("rows").innerHTML = (data.strategies || [])
    .map(
      (s) => `<tr>
        <td>${s.id}</td>
        <td>${s.name}</td>
        <td>${(s.symbols || []).join(",")}</td>
        <td>${s.interval}</td>
        <td>${(s.tags || []).join(",")}</td>
        <td><button class="btn ghost" data-edit="${s.id}">編輯</button></td>
      </tr>`,
    )
    .join("");
  document.querySelectorAll("[data-edit]").forEach((b) => {
    b.addEventListener("click", () => {
      const s = data.strategies.find((x) => x.id === b.getAttribute("data-edit"));
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
    winRate: $("winRate").value.trim() === "" ? null : Number($("winRate").value),
    sharpe: $("sharpe").value.trim() === "" ? null : Number($("sharpe").value),
    pine: $("pine").value,
  };
}

$("btnSaveSecret").addEventListener("click", async () => {
  sessionStorage.setItem("quant_admin", $("secret").value.trim());
  $("st").textContent = "已保存，載入列表…";
  try {
    await load();
    $("st").textContent = "載入完成";
  } catch (e) {
    $("st").textContent = e.message;
  }
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
  load().catch((e) => {
    $("st").textContent = e.message;
  });
} else {
  load().catch(() => {});
}
