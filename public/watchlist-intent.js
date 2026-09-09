(function () {
  "use strict";
  const key = "autodyWatchlistIntent";
  const lifetime = 24 * 60 * 60 * 1000;
  function clear() { try { localStorage.removeItem(key); } catch {} }
  function read() {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "null");
      if (!value) return null;
      const url = new URL(value.returnTo, location.origin);
      if (url.origin !== location.origin || !["/top-assets", "/account-rankings"].includes(url.pathname) ||
          !Number.isFinite(value.createdAt) || Date.now() - value.createdAt > lifetime || value.createdAt > Date.now() ||
          typeof value.symbol !== "string" || value.symbol.length > 40) {
        clear(); return null;
      }
      return value;
    } catch { clear(); return null; }
  }
  function begin(symbol = "", name = "") {
    const returnTo = new URL(/^\/account-rankings(?:\.html)?$/.test(location.pathname) ? "/account-rankings" : "/top-assets", location.origin);
    const current = new URL(location.href);
    ["type", "limit", "q", "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"].forEach((param) => {
      if (current.searchParams.has(param)) returnTo.searchParams.set(param, current.searchParams.get(param).slice(0, 200));
    });
    const intent = { symbol, name: String(name).slice(0, 160), returnTo: returnTo.pathname + returnTo.search, createdAt: Date.now() };
    try { localStorage.setItem(key, JSON.stringify(intent)); return true; } catch { return false; }
  }
  function destination(fallback) {
    const intent = read();
    if (!intent) return fallback;
    // Verification and sign-in must finish before returning to the public list.
    const pathname = new URL(fallback, location.origin).pathname;
    if (/^\/(verify-|sign-in|sign-up)/.test(pathname)) return fallback;
    return intent.returnTo;
  }
  window.AutodyWatchlistIntent = { read, begin, clear, destination };
})();
