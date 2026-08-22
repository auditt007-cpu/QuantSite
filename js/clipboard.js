(function (root) {
  function t(key) {
    const lang = (typeof localStorage !== "undefined" && localStorage.getItem("quant_lang")) || "zh-Hant";
    const pack = (root.I18N && (root.I18N[lang] || root.I18N["zh-Hant"])) || {};
    return pack[key] || key;
  }

  function toast(msg, kind) {
    const el = document.getElementById("toast");
    if (!el) return;
    el.textContent = msg;
    el.className = "toast show " + (kind || "ok");
    setTimeout(() => el.classList.remove("show"), 2400);
  }

  async function copyToClipboard(text, successCallback) {
    const s = String(text || "");
    let ok = false;
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        await navigator.clipboard.writeText(s);
        ok = true;
      }
    } catch {
      ok = false;
    }
    if (!ok) {
      const ta = document.createElement("textarea");
      ta.value = s;
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try {
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      }
      document.body.removeChild(ta);
    }
    if (!ok) {
      toast(t("copyFail"), "err");
      throw new Error("copy failed");
    }
    if (typeof successCallback === "function") successCallback();
    else toast(t("copyInviteOk") || t("copied"), "ok");
    return true;
  }

  function bindCopyButton(btn, getText, doneKey) {
    if (!btn) return;
    btn.addEventListener("click", async () => {
      const prev = btn.textContent;
      try {
        await copyToClipboard(typeof getText === "function" ? getText() : getText, () => {
          btn.textContent = t("copiedBang");
          toast(t(doneKey || "copyInviteOk"), "ok");
          setTimeout(() => {
            btn.textContent = prev;
          }, 2000);
        });
      } catch {
        /* toast already */
      }
    });
  }

  root.copyToClipboard = copyToClipboard;
  root.QACopy = { copyToClipboard, bindCopyButton, toast, t };
})(typeof window !== "undefined" ? window : globalThis);
