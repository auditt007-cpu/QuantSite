(function (root) {
  function round2(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return 0;
    return Math.round((x + Number.EPSILON) * 100) / 100;
  }

  function fmtUsdt(n, withSymbol) {
    const x = round2(n);
    const body = x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return withSymbol === false ? body : "$" + body + " USDT";
  }

  function isTrc20(addr) {
    return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(String(addr || "").trim());
  }

  function isTxHash(h) {
    const s = String(h || "").trim();
    return /^[0-9a-fA-F]{64}$/.test(s);
  }

  root.QAMoney = { round2, fmtUsdt, isTrc20, isTxHash };
})(typeof window !== "undefined" ? window : globalThis);
