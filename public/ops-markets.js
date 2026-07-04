const controlMoney = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 8 });
let controlOverview = null;
let controlList = [];
const initialControlSymbol = new URLSearchParams(window.location.search).get("symbol");
let activeSymbol = initialControlSymbol ? initialControlSymbol.trim().toUpperCase() : "";

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function controlNotice(message, tone = "neutral") {
  const node = document.getElementById("ops-market-notice");
  if (!node) return;
  node.textContent = message;
  node.dataset.state = tone;
}

function formatControlPrice(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "$0.00";
  return controlMoney.format(number);
}

function controlNumberInput(form, name, value) {
  const input = form.elements[name];
  if (input) input.value = value ?? "";
}

function activeControl() {
  return controlOverview?.control || controlList.find((item) => item.symbol === activeSymbol) || {};
}

function controlDisplayName(control = activeControl()) {
  return control.name || control.asset?.name || activeSymbol || "Control center";
}

function defaultVenueForControl(type = "asset", symbol = "") {
  const safeType = String(type || "").trim().toLowerCase();
  const safeSymbol = String(symbol || "").trim().toUpperCase();
  if (safeSymbol === "AU") return "Autody";
  if (safeType === "stock") return "Nasdaq";
  if (safeType === "etf") return "Nasdaq";
  if (safeType === "commodity") return "NYSE Arca";
  return "Crypto";
}

function isCryptoControlType(type = "asset") {
  return String(type || "").trim().toLowerCase() === "crypto";
}

function updateNewControlTypeFields(form = document.getElementById("ops-new-control-form")) {
  if (!form) return;
  const type = String(form.elements.assetType?.value || "crypto").trim().toLowerCase();
  const crypto = isCryptoControlType(type);
  const marketField = document.getElementById("ops-new-market-field");
  const marketLabel = marketField?.querySelector("span");
  const marketInput = marketField?.querySelector("input");

  if (marketLabel) marketLabel.textContent = crypto ? "Network" : "Market / venue";
  if (marketInput) {
    marketInput.name = crypto ? "network" : "market";
    marketInput.placeholder = crypto
      ? "Autody, Ethereum, Solana"
      : type === "commodity"
        ? "NYSE Arca, CME, LME"
        : "Nasdaq, NYSE, LSE";
  }
}

function cleanControlVenue(control = {}) {
  const type = String(control.assetType || "asset").trim().toLowerCase();
  const market = String(type === "crypto" ? control.network || control.market || "" : control.market || "").trim();
  const generic = {
    crypto: ["crypto", "digital assets", "global"],
    stock: ["stock", "stocks", "equities"],
    etf: ["etf", "etfs", "fund", "funds"],
    commodity: ["commodity", "commodities", "oil and metals", "oils and metals", "metals"]
  }[type] || [];
  if (!market || generic.includes(market.toLowerCase())) return defaultVenueForControl(type, control.symbol);
  return market;
}

function controlTypeLabel(control = {}) {
  const type = String(control.assetType || "asset").trim().toLowerCase();
  const market = cleanControlVenue(control);
  const base = {
    crypto: "Crypto",
    stock: "Stock",
    etf: "ETF",
    commodity: "Oil and metals"
  }[type] || "Asset";
  return [base, market].filter(Boolean).join(" / ");
}

function canDeleteControl(control = activeControl()) {
  return String(control.symbol || "").trim().toUpperCase() !== "AU";
}

function setActiveSymbol(symbol = "") {
  activeSymbol = String(symbol || "").trim().toUpperCase();
  const url = new URL(window.location.href);
  if (activeSymbol) {
    url.searchParams.set("symbol", activeSymbol);
  } else {
    url.searchParams.delete("symbol");
  }
  window.history.replaceState({}, "", url);
  syncControlWorkspace();
}

function syncControlWorkspace() {
  const home = document.getElementById("ops-control-home");
  const detail = document.getElementById("ops-control-detail");
  const hasAsset = Boolean(activeSymbol);
  if (home) home.hidden = hasAsset;
  if (detail) detail.hidden = !hasAsset;
}

function calculateDerivedMetrics(form) {
  const currentPrice = Number(form.elements.currentPrice?.value || 0);
  const circulatingSupply = Number(form.elements.circulatingSupply?.value || 0);
  const totalSupply = Number(form.elements.totalSupply?.value || 0);
  return {
    marketCap: Number.isFinite(currentPrice) && Number.isFinite(circulatingSupply) && circulatingSupply > 0
      ? currentPrice * circulatingSupply
      : 0,
    fdv: Number.isFinite(currentPrice) && Number.isFinite(totalSupply) && totalSupply > 0
      ? currentPrice * totalSupply
      : 0
  };
}

function renderDerivedMetrics() {
  const form = document.getElementById("ops-market-form");
  if (!form) return;
  const derived = calculateDerivedMetrics(form);
  controlNumberInput(form, "marketCap", derived.marketCap ? derived.marketCap.toFixed(2) : "");
  controlNumberInput(form, "fdv", derived.fdv ? derived.fdv.toFixed(2) : "");
}

function fillControlForm(control = {}) {
  const form = document.getElementById("ops-market-form");
  if (!form) return;
  form.elements.enabled.checked = control.enabled !== false;
  controlNumberInput(form, "currentPrice", control.currentPrice);
  controlNumberInput(form, "minPrice", control.minPrice);
  controlNumberInput(form, "maxPrice", control.maxPrice);
  controlNumberInput(form, "updateIntervalSeconds", control.updateIntervalSeconds);
  controlNumberInput(form, "stepPercent", control.stepPercent);
  controlNumberInput(form, "trendBias", control.trendBias);
  controlNumberInput(form, "reserveAssetQuantity", control.reserveAssetQuantity);
  controlNumberInput(form, "reserveUsd", control.reserveUsd || control.liquidityUsd);
  controlNumberInput(form, "marketCap", control.marketCap);
  controlNumberInput(form, "fdv", control.fdv);
  controlNumberInput(form, "totalVolume", control.totalVolume);
  controlNumberInput(form, "volumeMinUsd", control.volumeMinUsd);
  controlNumberInput(form, "volumeMaxUsd", control.volumeMaxUsd);
  controlNumberInput(form, "volumeRollIntervalMinutes", control.volumeRollIntervalMinutes || 1440);
  controlNumberInput(form, "circulatingSupply", control.circulatingSupply);
  controlNumberInput(form, "totalSupply", control.totalSupply);
  if (form.elements.market) form.elements.market.value = cleanControlVenue(control);
  if (form.elements.network) form.elements.network.value = cleanControlVenue(control);
  if (form.elements.status) form.elements.status.value = control.status || "admin controlled";
  renderDerivedMetrics();
}

function updateControlLabels() {
  const control = activeControl();
  const name = controlDisplayName(control);
  const crypto = isCryptoControlType(control.assetType || "crypto");
  const title = document.getElementById("ops-control-title");
  const description = document.getElementById("ops-control-description");
  const activeKind = document.getElementById("ops-active-kind");
  const activeTitle = document.getElementById("ops-active-title");
  const activeCopy = document.getElementById("ops-active-copy");
  const price = document.getElementById("ops-price-label");
  const settings = document.getElementById("ops-settings-label");
  const chart = document.getElementById("ops-chart-label");
  const save = document.getElementById("ops-save-label");
  const deleteButton = document.getElementById("ops-delete-control");
  const marketField = document.getElementById("ops-control-market-field");
  const marketLabel = marketField?.querySelector("span");
  const marketInput = marketField?.querySelector("input");

  if (!activeSymbol) {
    if (title) title.textContent = "Control center";
    if (description) description.textContent = "Choose a controlled asset, open its own workspace, and manage pricing, graph movement, supply, and live display data.";
    if (save) save.textContent = "Save Control";
    if (deleteButton) deleteButton.hidden = true;
    return;
  }

  if (title) title.textContent = `${name} control`;
  if (description) description.textContent = `Control ${activeSymbol} pricing, range, 24h volume, supply, and graph movement from the database.`;
  if (activeKind) activeKind.textContent = `${control.assetType || "asset"} workspace`;
  if (activeTitle) activeTitle.textContent = `${name} market control`;
  if (activeCopy) activeCopy.textContent = `This is ${activeSymbol}'s own control page. Reset, force a tick, edit the formula, and review chart history without touching other assets.`;
  if (price) price.textContent = `${activeSymbol} price`;
  if (settings) settings.textContent = `${activeSymbol} settings`;
  if (chart) chart.textContent = `${activeSymbol} graph`;
  if (marketLabel) marketLabel.textContent = crypto ? "Network" : "Market / venue";
  if (marketInput) marketInput.placeholder = crypto ? "Autody, Ethereum, Solana" : "Nasdaq, NYSE Arca, Autody";
  if (save) save.textContent = "Save Control";
  if (deleteButton) deleteButton.hidden = !canDeleteControl(control);
}

function renderKpis(overview = {}) {
  const control = overview.control || {};
  const stats = overview.stats || {};
  const price = document.querySelector('[data-au-kpi="price"]');
  const change = document.querySelector('[data-au-kpi="change"]');
  const range = document.querySelector('[data-au-kpi="range"]');
  const ticks = document.querySelector('[data-au-kpi="ticks"]');
  const retention = document.querySelector('[data-au-kpi="retention"]');
  const status = document.querySelector('[data-au-kpi="status"]');
  const interval = document.querySelector('[data-au-kpi="interval"]');
  if (price) price.textContent = formatControlPrice(control.currentPrice);
  if (change) {
    const value = Number(control.changePct || 0);
    change.textContent = `${value > 0 ? "+" : ""}${value.toFixed(4)}%`;
    change.className = value > 0 ? "positive" : value < 0 ? "negative" : "";
  }
  if (range) range.textContent = `${formatControlPrice(control.minPrice)} - ${formatControlPrice(control.maxPrice)}`;
  if (ticks) ticks.textContent = stats.tickCount || 0;
  if (retention) retention.textContent = `${overview.retention?.days || 0} days / ${overview.retention?.maxRows || 0} max`;
  if (status) status.textContent = control.enabled === false ? "Paused" : "Active";
  if (interval) interval.textContent = `${control.updateIntervalSeconds || 30}s updates`;
}

function renderChart(chart = {}) {
  const target = document.getElementById("ops-chart-stage");
  if (!target) return;
  const points = (chart.points || []).map((point) => ({ ...point, close: Number(point.close) })).filter((point) => Number.isFinite(point.close));
  if (points.length < 2) {
    target.innerHTML = `<div class="admin-empty">${escapeHtml(activeSymbol)} chart history is warming up.</div>`;
    return;
  }
  const width = 760;
  const height = 330;
  const padding = 26;
  const values = points.map((point) => point.close);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = Math.max(0.00000001, max - min);
  const path = points.map((point, index) => {
    const x = padding + (index / Math.max(1, points.length - 1)) * (width - padding * 2);
    const y = height - padding - ((point.close - min) / spread) * (height - padding * 2);
    return `${index ? "L" : "M"} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(" ");
  const area = `${path} L ${width - padding} ${height - padding} L ${padding} ${height - padding} Z`;
  target.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(activeSymbol)} controlled price chart">
      <defs>
        <linearGradient id="opsControlFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="#2de18b" stop-opacity="0.4" />
          <stop offset="100%" stop-color="#2de18b" stop-opacity="0" />
        </linearGradient>
      </defs>
      <path d="${area}" fill="url(#opsControlFill)"></path>
      <path d="${path}" fill="none" stroke="#2de18b" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"></path>
    </svg>
  `;
}

function renderTicks(ticks = []) {
  const target = document.getElementById("ops-tick-list");
  if (!target) return;
  if (!ticks.length) {
    target.innerHTML = `<div class="admin-empty">No ${escapeHtml(activeSymbol)} ticks yet.</div>`;
    return;
  }
  target.innerHTML = ticks.slice(0, 12).map((tick) => `
    <article class="admin-record ops-tick-record">
      <div>
        <strong>${formatControlPrice(tick.price)}</strong>
        <span>${escapeHtml(tick.source || "admin-control")}</span>
      </div>
      <div>
        <span>${Number(tick.changePct || 0).toFixed(4)}%</span>
        <small>${new Date(tick.createdAt).toLocaleString()}</small>
      </div>
    </article>
  `).join("");
}

function renderControlList() {
  const target = document.getElementById("ops-control-list");
  const count = document.getElementById("ops-control-count");
  if (count) count.textContent = controlList.length;
  if (!target) return;
  if (!controlList.length) {
    target.innerHTML = `<div class="admin-empty">No controlled assets yet.</div>`;
    return;
  }
  target.innerHTML = controlList.map((control) => {
    const active = control.symbol === activeSymbol;
    const change = Number(control.changePct || 0);
    const changeClass = change > 0 ? "positive" : change < 0 ? "negative" : "";
    const deletable = canDeleteControl(control);
    return `
      <article class="ops-control-pill${active ? " active" : ""}" data-symbol="${escapeHtml(control.symbol)}">
        <span class="ops-control-pill-top">
          <strong>${escapeHtml(control.symbol)} control</strong>
          <em>${escapeHtml(controlTypeLabel(control))}</em>
        </span>
        <span>${escapeHtml(control.name || control.symbol)}</span>
        <span class="ops-control-pill-meta">
          <b>${formatControlPrice(control.currentPrice)}</b>
          <i class="${changeClass}">${change > 0 ? "+" : ""}${change.toFixed(4)}%</i>
        </span>
        <span class="ops-control-pill-actions">
          <button type="button" class="ops-control-pill-open" data-open-control="${escapeHtml(control.symbol)}">Open workspace</button>
          ${deletable ? `<button type="button" class="ops-control-delete" data-delete-control="${escapeHtml(control.symbol)}">Delete</button>` : ""}
        </span>
      </article>
    `;
  }).join("");
}

async function loadControlList() {
  const result = await opsPost("/api/admin/markets/list", {});
  controlList = Array.isArray(result.controls) ? result.controls : [];
  if (activeSymbol && !controlList.some((item) => item.symbol === activeSymbol)) {
    controlOverview = null;
    setActiveSymbol("");
  }
  renderControlList();
  updateControlLabels();
}

async function loadControlOverview(forceTick = false) {
  await opsRequireSession();
  if (!activeSymbol) {
    controlOverview = null;
    syncControlWorkspace();
    updateControlLabels();
    controlNotice("Select an asset control to open its dedicated workspace.", "neutral");
    return;
  }
  const range = document.getElementById("ops-chart-range")?.value || "1d";
  controlNotice(forceTick ? `Advancing ${activeSymbol} price...` : `Loading ${activeSymbol} control...`, "neutral");
  controlOverview = await opsPost("/api/admin/markets/overview", { symbol: activeSymbol, range, forceTick });
  const listed = controlList.find((item) => item.symbol === controlOverview.control?.symbol);
  if (!listed && controlOverview.control?.symbol) {
    controlList.push(controlOverview.control);
    renderControlList();
  }
  fillControlForm(controlOverview.control);
  updateControlLabels();
  renderKpis(controlOverview);
  renderChart(controlOverview.chart);
  renderTicks(controlOverview.ticks || []);
  controlNotice(`${activeSymbol} market loaded. Last tick ${controlOverview.stats?.lastTickAt ? new Date(controlOverview.stats.lastTickAt).toLocaleTimeString() : "not yet"}.`, "success");
}

function formControlBody(form) {
  const body = { symbol: activeSymbol, range: document.getElementById("ops-chart-range")?.value || "1d" };
  for (const [key, rawValue] of new FormData(form).entries()) {
    if (key === "enabled") {
      body.enabled = true;
      continue;
    }
    const value = String(rawValue || "").trim();
    if (!value) continue;
    if (["marketCap", "fdv"].includes(key)) continue;
    body[key] = ["status", "market", "network"].includes(key) ? value : Number(value);
  }
  if (!new FormData(form).has("enabled")) body.enabled = false;
  return body;
}

function newControlBody(form) {
  const body = {};
  for (const [key, rawValue] of new FormData(form).entries()) {
    const value = String(rawValue || "").trim();
    if (!value) continue;
    body[key] = ["symbol", "name", "assetType", "market", "network"].includes(key) ? value : Number(value);
  }
  body.range = document.getElementById("ops-chart-range")?.value || "1d";
  return body;
}

async function openControlWorkspace(symbol, options = {}) {
  setActiveSymbol(symbol);
  renderControlList();
  await loadControlOverview(Boolean(options.forceTick));
}

async function deleteControl(symbol) {
  const safe = String(symbol || "").trim().toUpperCase();
  if (!safe || safe === "AU") {
    controlNotice("Autody AU cannot be deleted.", "error");
    return;
  }
  const ok = window.confirm(`Delete ${safe} from controlled assets? This removes its admin history and market snapshot.`);
  if (!ok) return;
  controlNotice(`Deleting ${safe}...`, "neutral");
  const result = await opsPost("/api/admin/markets/delete", { symbol: safe });
  controlList = Array.isArray(result.controls) ? result.controls : controlList.filter((item) => item.symbol !== safe);
  if (activeSymbol === safe) {
    controlOverview = null;
    setActiveSymbol("");
  }
  renderControlList();
  updateControlLabels();
  controlNotice(`${safe} deleted from controlled assets.`, "success");
}

async function saveControl(form, submit) {
  submit.disabled = true;
  submit.textContent = "Saving...";
  controlOverview = await opsPost("/api/admin/markets/control", formControlBody(form));
  fillControlForm(controlOverview.control);
  updateControlLabels();
  renderKpis(controlOverview);
  renderChart(controlOverview.chart);
  renderTicks(controlOverview.ticks || []);
  await loadControlList().catch(() => null);
  controlNotice(`${activeSymbol} control saved.`, "success");
  submit.disabled = false;
  submit.textContent = "Save Control";
}

function wireControlOps() {
  document.getElementById("ops-control-list")?.addEventListener("click", (event) => {
    const deleteButton = event.target.closest("[data-delete-control]");
    if (deleteButton) {
      deleteControl(deleteButton.dataset.deleteControl).catch((err) => controlNotice(err.message, "error"));
      return;
    }
    const openButton = event.target.closest("[data-open-control]");
    const card = event.target.closest("[data-symbol]");
    const symbol = openButton?.dataset.openControl || card?.dataset.symbol;
    if (!symbol) return;
    openControlWorkspace(symbol).catch((err) => controlNotice(err.message, "error"));
  });

  document.getElementById("ops-control-back")?.addEventListener("click", () => {
    setActiveSymbol("");
    controlOverview = null;
    renderControlList();
    updateControlLabels();
    controlNotice("Select an asset control to open its dedicated workspace.", "neutral");
  });

  document.getElementById("ops-new-control-toggle")?.addEventListener("click", () => {
    const form = document.getElementById("ops-new-control-form");
    if (!form) return;
    form.hidden = !form.hidden;
    updateNewControlTypeFields(form);
  });

  document.getElementById("ops-new-control-form")?.elements.assetType?.addEventListener("change", (event) => {
    updateNewControlTypeFields(event.currentTarget.form);
  });

  document.getElementById("ops-new-control-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = event.currentTarget.querySelector('button[type="submit"]');
    try {
      submit.disabled = true;
      submit.textContent = "Creating...";
      const result = await opsPost("/api/admin/markets/create", newControlBody(event.currentTarget));
      setActiveSymbol(result.symbol || result.control?.symbol || event.currentTarget.elements.symbol.value);
      event.currentTarget.reset();
      updateNewControlTypeFields(event.currentTarget);
      event.currentTarget.hidden = true;
      await loadControlList();
      await loadControlOverview(false);
      controlNotice(`${activeSymbol} control created.`, "success");
    } catch (err) {
      controlNotice(err.message || "Could not create asset control.", "error");
    } finally {
      submit.disabled = false;
      submit.textContent = "Create Asset";
    }
  });

  document.getElementById("ops-market-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = event.currentTarget.querySelector('button[type="submit"]');
    try {
      await saveControl(event.currentTarget, submit);
    } catch (err) {
      controlNotice(err.message || "Could not save control.", "error");
      submit.disabled = false;
      submit.textContent = "Save Control";
    }
  });

  document.getElementById("ops-force-tick")?.addEventListener("click", () => {
    if (!activeSymbol) return controlNotice("Select an asset before forcing a tick.", "error");
    return loadControlOverview(true).catch((err) => controlNotice(err.message, "error"));
  });
  document.getElementById("ops-chart-range")?.addEventListener("change", () => {
    if (!activeSymbol) return;
    loadControlOverview(false).catch((err) => controlNotice(err.message, "error"));
  });
  document.getElementById("ops-reset-control")?.addEventListener("click", async () => {
    if (!activeSymbol) {
      controlNotice("Select an asset before resetting.", "error");
      return;
    }
    const ok = window.confirm(`Reset ${activeSymbol} market history, snapshots, 24h volume, and chart data? User wallets and orders will not be changed.`);
    if (!ok) return;
    try {
      controlNotice(`Resetting ${activeSymbol}...`, "neutral");
      controlOverview = await opsPost("/api/admin/markets/reset", {
        symbol: activeSymbol,
        currentPrice: document.getElementById("ops-market-form")?.elements.currentPrice?.value,
        minPrice: document.getElementById("ops-market-form")?.elements.minPrice?.value,
        maxPrice: document.getElementById("ops-market-form")?.elements.maxPrice?.value,
        range: document.getElementById("ops-chart-range")?.value || "1d"
      });
      fillControlForm(controlOverview.control);
      updateControlLabels();
      renderKpis(controlOverview);
      renderChart(controlOverview.chart);
      renderTicks(controlOverview.ticks || []);
      await loadControlList().catch(() => null);
      controlNotice(`${activeSymbol} reset. You can enter fresh data from here.`, "success");
    } catch (err) {
      controlNotice(err.message || "Could not reset market control.", "error");
    }
  });
  document.getElementById("ops-delete-control")?.addEventListener("click", () => {
    if (!activeSymbol) return controlNotice("Select an asset before deleting.", "error");
    return deleteControl(activeSymbol).catch((err) => controlNotice(err.message, "error"));
  });

  document.getElementById("ops-market-form")?.addEventListener("input", (event) => {
    if (["currentPrice", "circulatingSupply", "totalSupply"].includes(event.target?.name)) renderDerivedMetrics();
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  try {
    await opsRequireSession();
    wireControlOps();
    updateNewControlTypeFields();
    await loadControlList();
    if (activeSymbol) {
      await loadControlOverview(false);
    } else {
      syncControlWorkspace();
      updateControlLabels();
      controlNotice("Select an asset control to open its dedicated workspace.", "neutral");
    }
  } catch (err) {
    controlNotice(err.message || "Could not load market control.", "error");
  }
});
