(function () {
  "use strict";
  const isAccountPage = /^\/account-rankings(?:\.html)?$/.test(location.pathname);
  if (isAccountPage && !window.AutodyAuth) {
    window.AutodyWatchlistIntent?.begin();
    return;
  }
  const labels = { crypto: "crypto assets", stock: "stocks", etf: "ETFs", commodity: "commodities" };
  const params = new URLSearchParams(location.search);
  const state = { type: Object.hasOwn(labels, params.get("type")) ? params.get("type") : "crypto", limit: params.has("limit") && [0, 10, 100, 200].includes(Number(params.get("limit"))) ? Number(params.get("limit")) : 10, search: (params.get("q") || "").slice(0, 80), assets: [], saved: new Set(), busy: new Set(), loaded: false, loading: false, session: null, detail: null };
  const REFRESH_MS = 60000;
  let refreshTimer;
  const $ = (id) => document.getElementById(id);
  const intent = window.AutodyWatchlistIntent;
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const number = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
  const compact = (value) => number(value) ? "$" + new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(Number(value)) : "—";
  function price(asset) {
    if (!number(asset.price) || Number(asset.price) <= 0) return "Unavailable";
    try { return new Intl.NumberFormat("en-US", { style: "currency", currency: asset.currency || "USD", maximumFractionDigits: Number(asset.price) < 0.01 ? 8 : Number(asset.price) < 1 ? 6 : 2 }).format(Number(asset.price)); }
    catch { return `${Number(asset.price).toLocaleString("en-US")} ${asset.currency || ""}`; }
  }
  function change(asset) { return number(asset.changePct) ? `${Number(asset.changePct) > 0 ? "+" : ""}${Number(asset.changePct).toFixed(2)}%` : "—"; }
  function tone(asset) { return number(asset.changePct) ? Number(asset.changePct) > 0 ? "gain" : Number(asset.changePct) < 0 ? "loss" : "flat" : "flat"; }
  function metric(asset) { return state.type === "crypto" ? Number(asset.marketCap) : Number(asset.changePct); }
  function ranked() {
    return state.assets.filter((asset) => asset.assetType === state.type && !asset.customAsset &&
      (state.type === "crypto" ? number(asset.marketCap) && Number(asset.marketCap) > 0 : number(asset.changePct)))
      .sort((a, b) => metric(b) - metric(a) || String(a.symbol).localeCompare(String(b.symbol)));
  }
  function status(message, error = false) { $("page-status").textContent = message; $("page-status").classList.toggle("error", error); }
  function session() {
    try { const value = JSON.parse(localStorage.getItem("autodyDemoSession") || "null"); return value?.token && Date.parse(value.expiresAt) > Date.now() ? value : null; }
    catch { return null; }
  }
  function setSaved(watchlist) { state.saved = new Set([...(watchlist?.crypto || []), ...(watchlist?.stocks || [])].map((symbol) => String(symbol).toUpperCase())); }
  function accountLinks() {
    const link = $("account-link"); link.textContent = state.session ? "My watchlist ↗" : "Build my watchlist ↗"; link.href = state.session ? "/account-watchlist" : "/sign-up";
  }
  function updateUrl() {
    const url = new URL(location.href); url.searchParams.set("type", state.type); url.searchParams.set("limit", state.limit);
    if (state.search) url.searchParams.set("q", state.search); else url.searchParams.delete("q"); history.replaceState(null, "", url.pathname + url.search);
  }
  function render() {
    const all = ranked();
    const limits = [10, 100, 200].filter((limit) => limit <= all.length);
    if (all.length < 200 && !limits.includes(all.length)) limits.push(0);
    if (state.loaded && !limits.includes(state.limit)) {
      state.limit = limits.includes(100) ? 100 : limits.includes(0) ? 0 : limits[0] || 0;
      updateUrl();
    }
    document.querySelectorAll("[data-type]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.type === state.type)));
    document.querySelectorAll("[data-limit]").forEach((button) => {
      const limit = Number(button.dataset.limit);
      button.hidden = state.loaded ? !limits.includes(limit) : limit !== 10;
      button.setAttribute("aria-pressed", String(limit === state.limit));
      if (!limit) button.textContent = `All ${all.length}`;
    });
    for (const type of Object.keys(labels)) document.querySelector(`[data-count="${type}"]`).textContent = state.loaded ? state.assets.filter((asset) => asset.assetType === type && !asset.customAsset).length : "—";
    $("list-title").textContent = `${state.limit ? `Top ${state.limit}` : "All"} ${labels[state.type]}`;
    $("ranking-method").textContent = state.type === "crypto" ? "Largest market capitalization · among covered assets" : "Highest daily percentage change · among covered assets";
    $("metric-title").textContent = state.type === "crypto" ? "Market cap" : "Market";
    const top = all.slice(0, state.limit || all.length);
    const times = top.map((asset) => Date.parse(asset.capturedAt)).filter(Number.isFinite);
    const oldest = times.length ? Math.min(...times) : null;
    const newest = times.length ? Math.max(...times) : null;
    $("quote-freshness").textContent = newest ? `Latest quote ${new Date(newest).toLocaleTimeString([], {hour: "2-digit", minute: "2-digit"})} · Auto-refresh 60s${Date.now() - oldest > 15 * 60000 ? " · Some quotes delayed" : ""}` : "Quote times unavailable · Auto-refresh 60s";
    const rows = top.map((asset, index) => ({ asset, rank: index + 1 })).filter(({ asset }) => `${asset.name} ${asset.symbol}`.toLowerCase().includes(state.search.toLowerCase()));
    $("asset-rows").innerHTML = rows.map(({ asset, rank }) => {
      const symbol = String(asset.symbol).toUpperCase(); const saved = state.saved.has(symbol); const busy = state.busy.has(symbol);
      const logo = /^https:\/\//i.test(asset.logoUrl || "") ? `<img src="${esc(asset.logoUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" />` : "";
      return `<tr><td class="rank">${rank}</td><td><button class="asset-button" data-detail="${esc(symbol)}" aria-label="View ${esc(asset.name)} details"><span class="asset-icon">${esc(symbol.slice(0, 3))}${logo}</span><span><strong>${esc(asset.name)}</strong><small>${esc(symbol)}</small></span></button></td><td class="numeric">${esc(price(asset))}</td><td class="numeric ${tone(asset)}">${change(asset)}</td><td class="numeric metric">${esc(state.type === "crypto" ? compact(asset.marketCap) : asset.market || "—")}</td><td class="save-col"><button class="save-button ${saved ? "saved" : ""}" data-save="${esc(symbol)}" aria-label="${saved ? `${esc(asset.name)} is in your watchlist` : `Add ${esc(asset.name)} to watchlist`}" title="${saved ? "In your watchlist" : "Add to watchlist"}" ${saved || busy ? "disabled" : ""}>${busy ? "…" : saved ? "✓" : "+"}</button></td></tr>`;
    }).join("") || `<tr><td colspan="6" class="empty">${!state.loaded ? "Loading market data…" : state.search ? "No matches in this ranking. Try another name or a larger list." : "No ranking data is available for this market yet. Try refreshing."}</td></tr>`;
    $("asset-rows").querySelectorAll("img").forEach((img) => img.addEventListener("error", () => img.remove(), { once: true }));
    const missing = state.assets.filter((asset) => asset.assetType === state.type && !asset.customAsset).length - all.length;
    $("coverage").textContent = state.loaded ? `${rows.length} shown · ${all.length} ranked assets available${missing ? ` · ${missing} without ranking data omitted` : ""}` : "Preparing the latest available data.";
    updateDetailSave();
  }
  function showSignup(asset) {
    const remembered = intent.begin(asset?.symbol || "", asset?.name || "");
    if (isAccountPage) {
      location.href = "/sign-in?next=account-rankings";
      return;
    }
    $("signup-title").textContent = asset ? `Follow ${asset.name}` : "Start your watchlist";
    $("signup-copy").textContent = asset ? `Create your free account to add ${asset.name} to your watchlist. We’ll save your selection after you finish signing up.` : "Create your free account to keep the assets you follow together.";
    $("storage-note").hidden = remembered; $("asset-dialog").close(); $("signup-dialog").showModal();
  }
  async function save(asset, automatic = false) {
    const symbol = String(asset.symbol).toUpperCase(); if (state.busy.has(symbol)) return;
    state.session = session(); accountLinks();
    if (!state.session) { showSignup(asset); return; }
    if (state.saved.has(symbol)) { if (automatic) intent.clear(); status(`${asset.name} is already in your watchlist.`); return; }
    state.busy.add(symbol); render();
    try {
      const response = await fetch("/api/account/watchlist", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${state.session.token}` }, body: JSON.stringify({ symbol }), signal: AbortSignal.timeout(30000) });
      const result = await response.json();
      if (response.status === 401 || response.status === 403) { state.session = null; accountLinks(); showSignup(asset); return; }
      if (!response.ok || !result.success) throw new Error(result.error || "Could not save this asset. Please try again.");
      setSaved(result.watchlist); state.saved.add(symbol); if (intent.read()?.symbol === symbol) intent.clear();
      status(`${asset.name} added to your watchlist. Keep exploring or open My watchlist.`);
      if (automatic) $("page-status").scrollIntoView({ block: "nearest" });
    } catch (error) {
      status(error.message || "Could not save this asset. Please try again.", true);
      if (state.detail?.symbol === symbol) $("detail-time").textContent = "Could not save this asset. Please try again.";
    } finally { state.busy.delete(symbol); render(); }
  }
  function updateDetailSave() {
    if (!state.detail) return;
    const symbol = String(state.detail.symbol).toUpperCase(); const saved = state.saved.has(symbol); const busy = state.busy.has(symbol);
    $("detail-save").disabled = saved || busy; $("detail-save").textContent = saved ? "✓ In your watchlist" : busy ? "Saving…" : "+ Add to watchlist";
  }
  function showDetail(asset) {
    state.detail = asset; $("detail-symbol").textContent = `${asset.symbol} · ${asset.assetType}`; $("detail-title").textContent = asset.name;
    $("detail-values").innerHTML = [["Price", price(asset)], ["Daily change", change(asset)], ["Market", asset.market || "—"], ["Market capitalization", compact(asset.marketCap)]].map(([key, value]) => `<div><dt>${esc(key)}</dt><dd>${esc(value)}</dd></div>`).join("");
    const time = new Date(asset.capturedAt);
    $("detail-time").textContent = Number.isFinite(time.getTime()) ? `Quote as of ${time.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}. Data may be delayed.` : "Quote time unavailable. Data may be delayed.";
    updateDetailSave(); $("asset-dialog").showModal();
  }
  async function loadWatchlist() {
    state.session = session(); accountLinks(); if (!state.session) return;
    try {
      const response = await fetch("/api/account/watchlist", { headers: { Authorization: `Bearer ${state.session.token}` }, cache: "no-store", signal: AbortSignal.timeout(15000) });
      const result = await response.json();
      if (response.ok && result.success) setSaved(result.watchlist); else if (response.status === 401 || response.status === 403) state.session = null;
    } catch { /* Save still authenticates and reports failures. */ }
    accountLinks(); render();
  }
  async function load({ automatic = false } = {}) {
    if (state.loading) return;
    state.loading = true;
    clearTimeout(refreshTimer);
    $("refresh").disabled = true;
    if (!automatic) status(state.loaded ? "Refreshing market data…" : "Loading market rankings…");
    try {
      const response = await fetch("/api/markets/catalog?type=all", { cache: "no-store", signal: AbortSignal.timeout(30000) }); const result = await response.json();
      if (!response.ok || !result.success || !Array.isArray(result.assets)) throw new Error("Market data unavailable");
      state.assets = result.assets; state.loaded = true;
      if (!automatic || $("page-status").classList.contains("error")) status("");
      render();
      if (state.detail && $("asset-dialog").open) {
        const asset = state.assets.find((item) => item.symbol === state.detail.symbol);
        if (asset) showDetail(asset);
      }
      const pending = intent.read();
      if (pending && state.session) {
        if (!pending.symbol) intent.clear();
        else {
          const asset = state.assets.find((item) => String(item.symbol).toUpperCase() === pending.symbol);
          if (asset) await save(asset, true); else status("Your selected asset is unavailable right now. Your selection is remembered; try Refresh later.", true);
        }
      }
    } catch {
      status(state.loaded ? "Refresh failed. Showing the last loaded quotes; try again." : "Could not load market rankings. Please try Refresh.", true);
      if (!state.loaded) $("asset-rows").innerHTML = '<tr><td colspan="6" class="empty">Market data could not be loaded. Use Refresh to try again.</td></tr>';
    }
    finally {
      state.loading = false;
      $("refresh").disabled = false;
      if (!document.hidden) refreshTimer = setTimeout(() => load({ automatic: true }), REFRESH_MS);
    }
  }
  document.querySelectorAll("[data-type]").forEach((button) => button.addEventListener("click", () => { state.type = button.dataset.type; updateUrl(); render(); }));
  document.querySelectorAll("[data-limit]").forEach((button) => button.addEventListener("click", () => { state.limit = Number(button.dataset.limit); updateUrl(); render(); }));
  $("asset-search").value = state.search; $("asset-search").addEventListener("input", (event) => { state.search = event.target.value; updateUrl(); render(); });
  $("asset-rows").addEventListener("click", (event) => {
    const button = event.target.closest("[data-save], [data-detail]"); if (!button) return;
    const asset = state.assets.find((item) => String(item.symbol).toUpperCase() === (button.dataset.save || button.dataset.detail));
    if (asset) button.dataset.save ? save(asset) : showDetail(asset);
  });
  $("detail-save").addEventListener("click", () => { if (state.detail) save(state.detail); }); $("refresh").addEventListener("click", load);
  document.querySelectorAll("[data-auth]").forEach((link) => link.addEventListener("click", () => { if (!state.session) intent.begin(); }));
  document.querySelectorAll("dialog").forEach((dialog) => {
    dialog.querySelector("[data-close]").addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", (event) => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } });
  });
  $("signup-dialog").addEventListener("close", () => intent.clear());
  $("signup-dialog").addEventListener("cancel", () => intent.clear());
  document.addEventListener("visibilitychange", () => {
    clearTimeout(refreshTimer);
    if (!document.hidden) load({ automatic: true });
  });
  window.addEventListener("pagehide", () => clearTimeout(refreshTimer));
  render(); loadWatchlist().then(load);
})();
