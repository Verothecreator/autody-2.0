const orderMoney = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2
});

const orderWholeMoney = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0
});

const orderParams = new URLSearchParams(location.search);
let orderSide = ["buy", "sell", "swap"].includes(orderParams.get("side")) ? orderParams.get("side") : "buy";
let orderAssets = [];
let orderWallet = null;
let orderHistory = [];
let orderStatusTimer = null;
const ORDER_REFRESH_MS = 10000;
const ORDER_GROUP_SYMBOLS = new Set(["USD", "AU", "CRYPTO", "STOCKS", "ETFS", "OILMETALS"]);

function escapeOrderHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatOrderMoney(value, whole = false) {
  const number = Number(value);
  if (!Number.isFinite(number)) return whole ? "$0" : "$0.00";
  return whole ? orderWholeMoney.format(number) : orderMoney.format(number);
}

function formatOrderNumber(value, maximumFractionDigits = 6) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0";
  return number.toLocaleString("en-US", { maximumFractionDigits });
}

function assetPriceDigits(number, compact = false) {
  if (compact) return 2;
  if (Math.abs(number) < 0.01) return 8;
  if (Math.abs(number) < 1) return 6;
  return 2;
}

function formatAssetPrice(value, currency = "USD") {
  const number = Number(value);
  if (!Number.isFinite(number)) return "Waiting";
  const compact = Math.abs(number) >= 100000;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      notation: compact ? "compact" : "standard",
      maximumFractionDigits: assetPriceDigits(number, compact)
    }).format(number);
  } catch (err) {
    return `${currency} ${number.toLocaleString("en-US")}`;
  }
}

function moveClass(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number === 0) return "flat";
  return number > 0 ? "gain" : "loss";
}

function moveLabel(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "Live feed";
  const arrow = number > 0 ? "\u2191" : number < 0 ? "\u2193" : "\u2192";
  const sign = number > 0 ? "+" : "";
  return `${arrow} ${sign}${number.toFixed(2)}%`;
}

function logoFallback(asset) {
  return String(asset.symbol || "?")
    .replace(/=F$/i, "")
    .replace(/[^a-z0-9]/gi, "")
    .slice(0, 4)
    .toUpperCase() || "?";
}

function orderLogoSrc(asset) {
  if (asset.logoUrl) return asset.logoUrl;
  if (asset.customAsset || asset.symbol === "AU") return "Autody-Logo.png";
  if (asset.assetType === "crypto") return `https://assets.coincap.io/assets/icons/${encodeURIComponent(logoFallback(asset).toLowerCase())}@2x.png`;
  return "";
}

function orderLogoMarkup(asset, extraClass = "") {
  const fallback = logoFallback(asset);
  const src = orderLogoSrc(asset);
  const autodyClass = asset.symbol === "AU" || asset.customAsset ? "autody-logo" : "";
  const img = src
    ? `<img src="${escapeOrderHtml(src)}" alt="" loading="lazy" onerror="this.parentElement.classList.add('logo-fallback'); this.remove();">`
    : "";
  return `
    <span class="asset-token asset-logo ${src ? "has-image" : "logo-fallback"} ${autodyClass} ${escapeOrderHtml(extraClass)}" data-symbol="${escapeOrderHtml(fallback)}">
      ${img}
      <b>${escapeOrderHtml(fallback)}</b>
    </span>
  `;
}

async function getOrderJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

async function postOrderJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success) {
    const fallback = response.status === 502
      ? "Demo order server timed out. Please wait a moment and try again."
      : `${url} returned ${response.status}`;
    throw new Error(data.error || fallback);
  }
  return data;
}

function bySymbol(symbol) {
  const lookup = String(symbol || "").toUpperCase();
  return orderAssets.find((asset) => String(asset.symbol).toUpperCase() === lookup);
}

function orderAssetType(asset = {}) {
  const type = String(asset.assetType || asset.category || "market").toLowerCase();
  if (type === "stocks") return "stock";
  return type;
}

function isSwapAsset(asset = {}) {
  const type = orderAssetType(asset);
  const symbol = String(asset.symbol || "").toUpperCase();
  return type === "crypto" || symbol === "AU";
}

function holdingForSymbol(symbol) {
  const lookup = String(symbol || "").toUpperCase();
  return currentHoldings().find((holding) => String(holding.symbol || "").toUpperCase() === lookup);
}

function assetForHolding(holding = {}) {
  const marketAsset = bySymbol(holding.symbol);
  return {
    ...marketAsset,
    ...holding,
    symbol: String(holding.symbol || marketAsset?.symbol || "").toUpperCase(),
    name: holding.name || marketAsset?.name || holding.symbol,
    assetType: marketAsset?.assetType || holding.assetType || holding.category,
    category: holding.category || marketAsset?.assetType,
    price: marketAsset?.price ?? holding.price ?? holding.lastPrice ?? null,
    changePct: marketAsset?.changePct ?? holding.changePct ?? null,
    logoUrl: marketAsset?.logoUrl || holding.logoUrl || null
  };
}

function holdingValueUsd(holding = {}) {
  const direct = Number(holding.valueUsd);
  if (Number.isFinite(direct)) return direct;
  const asset = assetForHolding(holding);
  const balance = Number(holding.balance || 0);
  const price = Number(asset.price);
  return Number.isFinite(balance) && Number.isFinite(price) ? balance * price : 0;
}

function currentHoldings() {
  return (orderWallet?.holdings || []).filter((holding) => (
    !ORDER_GROUP_SYMBOLS.has(String(holding.symbol || "").toUpperCase()) && Number(holding.balance) > 0
  ));
}

function selectedAsset() {
  return bySymbol(document.getElementById("order-symbol")?.value);
}

function selectedAmount() {
  return Number(document.getElementById("order-amount")?.value || 0);
}

function setStatus(message, tone = "", options = {}) {
  const node = document.getElementById("order-status");
  if (!node) return;
  if (orderStatusTimer) {
    clearTimeout(orderStatusTimer);
    orderStatusTimer = null;
  }
  node.textContent = message;
  node.className = `order-status ${tone}`;

  if (message && !options.sticky) {
    orderStatusTimer = setTimeout(() => {
      node.textContent = "";
      node.className = "order-status";
      orderStatusTimer = null;
    }, options.delay || 5000);
  }
}

function assetOption(asset) {
  const price = Number.isFinite(Number(asset.price)) ? ` - ${formatAssetPrice(asset.price, asset.currency || "USD")}` : "";
  return `<option value="${escapeOrderHtml(asset.symbol)}">${escapeOrderHtml(asset.symbol)} / ${escapeOrderHtml(asset.name)}${escapeOrderHtml(price)}</option>`;
}

function sortAssetsAlphabetically(assets = []) {
  return [...assets].sort((a, b) => {
    const aSymbol = String(a.symbol || "");
    const bSymbol = String(b.symbol || "");
    return aSymbol.localeCompare(bSymbol);
  });
}

function swapSources() {
  return currentHoldings()
    .map(assetForHolding)
    .filter((asset) => isSwapAsset(asset) && Number(asset.price) > 0 && Number(asset.balance || 0) > 0)
    .sort((a, b) => String(a.symbol).localeCompare(String(b.symbol)));
}

function renderAssetSelect() {
  const symbolSelect = document.getElementById("order-symbol");
  const fromSelect = document.getElementById("order-from");
  const requestedSymbol = symbolSelect.value || orderParams.get("symbol") || "BTC";
  const requestedFrom = String(fromSelect.value || orderParams.get("from") || "").toUpperCase();
  const holdings = currentHoldings();
  const sellSymbols = new Set(holdings.map((holding) => holding.symbol));

  const sources = swapSources();
  fromSelect.innerHTML = sources.length ? sources.map((asset) => {
    const suffix = ` - ${formatOrderMoney(holdingValueUsd(holdingForSymbol(asset.symbol)))}`;
    return `<option value="${escapeOrderHtml(asset.symbol)}">${escapeOrderHtml(asset.symbol)} / ${escapeOrderHtml(asset.name)}${escapeOrderHtml(suffix)}</option>`;
  }).join("") : `<option value="">Buy crypto first</option>`;
  if (sources.length) {
    fromSelect.value = sources.some((asset) => asset.symbol === requestedFrom) ? requestedFrom : sources[0].symbol;
  }

  const tradableAssets = orderAssets.filter((asset) => Number(asset.price) > 0);
  const assetsForSide = orderSide === "sell"
    ? sortAssetsAlphabetically(tradableAssets.filter((asset) => sellSymbols.has(asset.symbol)))
    : orderSide === "swap"
      ? sortAssetsAlphabetically(tradableAssets
        .filter((asset) => sources.length && isSwapAsset(asset) && asset.symbol !== fromSelect.value)
      )
      : sortAssetsAlphabetically(tradableAssets);

  symbolSelect.innerHTML = assetsForSide.length
    ? assetsForSide.map(assetOption).join("")
    : `<option value="">${orderSide === "sell" ? "No held assets to sell" : orderSide === "swap" ? "No crypto assets available" : "Market data loading"}</option>`;

  const preferred = assetsForSide.find((asset) => asset.symbol === requestedSymbol) || assetsForSide[0];
  if (preferred) symbolSelect.value = preferred.symbol;
}

function renderSideState() {
  document.querySelectorAll("[data-order-side]").forEach((button) => {
    button.classList.toggle("active", button.dataset.orderSide === orderSide);
  });
  document.getElementById("order-buy-from-wrap").hidden = orderSide !== "buy";
  document.getElementById("order-from-wrap").hidden = orderSide !== "swap";
  document.getElementById("order-to-wrap").hidden = orderSide !== "sell";
  document.getElementById("order-asset-label").textContent = orderSide === "sell" ? "Asset to sell" : orderSide === "swap" ? "Receive" : "Asset to buy";
  document.getElementById("order-amount-label").textContent = orderSide === "sell" ? "Sell amount (USD)" : orderSide === "swap" ? "Swap amount (USD)" : "Buy amount (USD)";
  const submit = document.getElementById("order-submit");
  submit.textContent = orderSide === "swap"
    ? "Place Demo Swap"
    : `Place Demo ${orderSide.charAt(0).toUpperCase()}${orderSide.slice(1)}`;
  renderAssetSelect();
  renderPreview();
}

function tradeValidation(asset, amount) {
  if (!asset) return { blocked: true, message: "Choose an asset first.", availableUsd: 0 };
  if (!Number.isFinite(amount) || amount <= 0) return { blocked: true, message: `Enter a ${orderSide} amount greater than zero.`, availableUsd: 0 };

  if (orderSide === "buy") {
    const availableUsd = Number(orderWallet?.cashBalance || 0);
    return {
      blocked: amount > availableUsd + 0.005,
      message: amount > availableUsd + 0.005 ? "Not enough USD funds for this buy." : "",
      availableUsd,
      availableLabel: "Available funds"
    };
  }

  if (orderSide === "sell") {
    const holding = holdingForSymbol(asset.symbol);
    const availableUsd = holdingValueUsd(holding);
    return {
      blocked: !holding || amount > availableUsd + 0.005,
      message: !holding ? `No ${asset.symbol} available to sell.` : amount > availableUsd + 0.005 ? `You only have ${formatOrderMoney(availableUsd)} of ${asset.symbol} available.` : "",
      availableUsd,
      availableLabel: "Available to sell"
    };
  }

  const fromSymbol = document.getElementById("order-from")?.value || "";
  if (!isSwapAsset(asset)) {
    return { blocked: true, message: "Swap is only for crypto assets.", availableUsd: 0 };
  }
  if (!fromSymbol) {
    return { blocked: true, message: "Buy a crypto asset first before using Swap.", availableUsd: 0 };
  }
  if (fromSymbol === "USD") {
    return { blocked: true, message: "Use Buy when spending USD funds. Swap is crypto-to-crypto only.", availableUsd: 0 };
  }
  if (fromSymbol === asset.symbol) {
    return { blocked: true, message: "Choose a different asset to receive.", availableUsd: 0 };
  }

  const sourceHolding = holdingForSymbol(fromSymbol);
  const sourceAsset = assetForHolding(sourceHolding);
  const availableUsd = holdingValueUsd(sourceHolding);
  if (!sourceHolding || !isSwapAsset(sourceAsset)) {
    return { blocked: true, message: "Choose a held crypto asset to swap from.", availableUsd: 0 };
  }
  return {
    blocked: amount > availableUsd + 0.005,
    message: amount > availableUsd + 0.005 ? `You only have ${formatOrderMoney(availableUsd)} of ${fromSymbol} available.` : "",
    availableUsd,
    availableLabel: `${fromSymbol} value available`
  };
}

function renderPreview() {
  const preview = document.getElementById("order-preview");
  const asset = selectedAsset();
  const amount = selectedAmount();
  const submit = document.getElementById("order-submit");
  if (!preview || !asset) {
    if (submit) submit.disabled = true;
    if (preview) {
      preview.className = "order-preview flat";
      preview.innerHTML = `
        <span>Estimated fill</span>
        <strong>${orderSide === "sell" ? "No held asset selected" : orderSide === "swap" ? "Buy crypto first to swap" : "Choose an asset"}</strong>
      `;
    }
    return;
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    if (submit) submit.disabled = true;
    preview.className = "order-preview flat";
    preview.innerHTML = `
      <span>${orderSide === "buy" ? "Buy with USD funds" : orderSide === "sell" ? "Sell to USD funds" : "Swap crypto to crypto"}</span>
      <strong>Enter an amount to preview</strong>
      <small>${orderSide === "swap" ? "Only held crypto assets can be used as the swap source." : "USD value is used for the demo order."}</small>
    `;
    return;
  }

  const price = Number(asset.price);
  const quantity = Number.isFinite(price) && price > 0 && amount > 0 ? amount / price : 0;
  const fromSymbol = document.getElementById("order-from")?.value || "";
  const validation = tradeValidation(asset, amount);
  let swapSourceQuantity = 0;
  if (orderSide === "swap") {
    const sourceHolding = holdingForSymbol(fromSymbol);
    const sourceAsset = assetForHolding(sourceHolding);
    const sourceBalance = Number(sourceHolding?.balance || sourceHolding?.quantity || 0);
    const sourceValue = holdingValueUsd(sourceHolding);
    let sourcePrice = Number(sourceAsset.price);
    if ((!Number.isFinite(sourcePrice) || sourcePrice <= 0) && sourceBalance > 0 && sourceValue > 0) {
      sourcePrice = sourceValue / sourceBalance;
    }
    swapSourceQuantity = Number.isFinite(sourcePrice) && sourcePrice > 0 ? amount / sourcePrice : 0;
  }
  const actionText = orderSide === "swap"
    ? `Swap ${formatOrderMoney(amount)} from ${formatOrderNumber(swapSourceQuantity)} ${fromSymbol} into ${formatOrderNumber(quantity)} ${asset.symbol}`
    : `${orderSide === "sell" ? "Sell about" : "Buy about"} ${formatOrderNumber(quantity)} ${asset.symbol}`;
  const detail = validation.availableLabel
    ? `${validation.availableLabel}: ${formatOrderMoney(validation.availableUsd)}`
    : "Live demo market order";

  preview.className = `order-preview ${validation.blocked ? "loss" : "gain"}`;
  preview.innerHTML = `
    <span>${escapeOrderHtml(actionText)}</span>
    <strong>${escapeOrderHtml(formatAssetPrice(price, asset.currency || "USD"))} live demo price</strong>
    <small>${escapeOrderHtml(validation.message || detail)}</small>
  `;
  if (submit) submit.disabled = validation.blocked;
}

function renderWalletSummary() {
  if (!orderWallet) return;
  const usdBalanceLabel = `USD Funds - ${formatOrderMoney(orderWallet.cashBalance)} available`;
  document.getElementById("orders-sidebar-balance").textContent = `${formatOrderMoney(orderWallet.cashBalance, true)} USD`;
  document.getElementById("orders-buying-power").textContent = `${formatOrderMoney(orderWallet.cashBalance)} USD`;
  document.getElementById("orders-cash").textContent = formatOrderMoney(orderWallet.cashBalance, true);
  document.getElementById("orders-total").textContent = formatOrderMoney(orderWallet.totalValue, true);
  document.getElementById("orders-positions").textContent = String(orderWallet.positionsCount || 0);
  document.getElementById("order-buy-from-usd").value = usdBalanceLabel;
  document.getElementById("order-to-usd").value = usdBalanceLabel;
}

function renderOrderHistory() {
  const table = document.getElementById("orders-table");
  const rows = orderHistory.map((order) => {
    const side = String(order.side || "order").toUpperCase();
    const symbol = String(order.symbol || "-").toUpperCase();
    const notional = order.notional_usd ?? order.notionalUsd ?? 0;
    return `
      <a class="asset-table-row order-row-link" href="demo-asset.html?symbol=${encodeURIComponent(symbol)}">
        <span>${escapeOrderHtml(side)}</span>
        <span>${escapeOrderHtml(symbol)}</span>
        <span>${escapeOrderHtml(formatOrderMoney(notional))}</span>
        <span>${escapeOrderHtml(order.status || "filled")}</span>
      </a>
    `;
  }).join("");

  table.innerHTML = `
    <div class="asset-table-row head">
      <span>Type</span>
      <span>Asset</span>
      <span>Amount</span>
      <span>Status</span>
    </div>
    ${rows || `
      <div class="asset-table-row">
        <span>No orders yet</span>
        <span>-</span>
        <span>$0.00</span>
        <span>Fresh account</span>
      </div>
    `}
  `;
}

function renderHoldingList() {
  const target = document.getElementById("order-holdings-list");
  const holdings = currentHoldings();
  target.innerHTML = holdings.length
    ? holdings.slice(0, 8).map((holding) => {
      const asset = bySymbol(holding.symbol) || holding;
      return `
        <a href="demo-orders.html?side=sell&symbol=${encodeURIComponent(holding.symbol)}">
          ${orderLogoMarkup(asset, "asset-logo-small")}
          <span><b>${escapeOrderHtml(holding.symbol)}</b><em>${escapeOrderHtml(holding.name)}</em></span>
          <strong>${escapeOrderHtml(formatOrderMoney(holding.valueUsd))}</strong>
          <small>Sell</small>
        </a>
      `;
    }).join("")
    : `<article class="wallet-empty-state">Buy your first demo asset from this ticket or the Markets page.</article>`;
}

function renderOrdersPage() {
  renderWalletSummary();
  renderSideState();
  renderOrderHistory();
  renderHoldingList();
}

async function loadOrdersPage(options = {}) {
  try {
    const [catalog, wallet, orders] = await Promise.all([
      getOrderJson("/api/markets/catalog?type=all"),
      getOrderJson("/api/demo/wallet"),
      getOrderJson("/api/demo/orders")
    ]);
    orderAssets = (catalog.assets || [])
      .filter((asset) => asset.price != null)
      .sort((a, b) => (a.rank || 9999) - (b.rank || 9999));
    orderWallet = wallet.wallet;
    orderHistory = orders.orders || [];
    renderOrdersPage();
  } catch (err) {
    console.warn("Demo orders page failed:", err);
    if (!options.silent) setStatus("Orders are warming up. Try again in a moment.", "loss");
  }
}

async function submitOrder(event) {
  event.preventDefault();
  const asset = selectedAsset();
  const amount = selectedAmount();
  if (!asset) {
    setStatus("Choose an asset first.", "loss");
    return;
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    setStatus("Enter a demo amount greater than zero.", "loss");
    return;
  }
  const validation = tradeValidation(asset, amount);
  if (validation.blocked) {
    setStatus(validation.message || "This order cannot be placed yet.", "loss");
    renderPreview();
    return;
  }

  const payload = {
    side: orderSide,
    symbol: asset.symbol,
    notionalUsd: amount
  };
  if (orderSide === "swap") {
    payload.fromSymbol = document.getElementById("order-from").value || "";
    payload.toSymbol = asset.symbol;
  }

  const submit = document.getElementById("order-submit");
  submit.disabled = true;
  setStatus("Placing demo order...", "", { sticky: true });

  try {
    const data = await postOrderJson("/api/demo/orders", payload);
    orderWallet = data.wallet;
    setStatus(`${orderSide.toUpperCase()} filled for ${asset.symbol}. Wallet updated.`, "gain");
    await loadOrdersPage({ silent: true });
  } catch (err) {
    setStatus(err.message || "Demo order failed.", "loss");
  } finally {
    renderPreview();
  }
}

document.addEventListener("click", (event) => {
  const sideButton = event.target.closest("[data-order-side]");
  if (!sideButton) return;
  orderSide = sideButton.dataset.orderSide;
  const symbol = document.getElementById("order-symbol")?.value || orderParams.get("symbol") || "BTC";
  history.replaceState(null, "", `demo-orders.html?side=${encodeURIComponent(orderSide)}&symbol=${encodeURIComponent(symbol)}`);
  renderSideState();
});

document.addEventListener("input", (event) => {
  if (event.target.id === "order-amount") renderPreview();
});

document.addEventListener("change", (event) => {
  if (event.target.id === "order-from") {
    const symbol = document.getElementById("order-symbol")?.value || "BTC";
    const from = document.getElementById("order-from")?.value || "";
    history.replaceState(null, "", `demo-orders.html?side=${encodeURIComponent(orderSide)}&symbol=${encodeURIComponent(symbol)}&from=${encodeURIComponent(from)}`);
    renderSideState();
    return;
  }

  if (event.target.id === "order-symbol") {
    const symbol = document.getElementById("order-symbol")?.value || "BTC";
    history.replaceState(null, "", `demo-orders.html?side=${encodeURIComponent(orderSide)}&symbol=${encodeURIComponent(symbol)}`);
    renderPreview();
  }
});

function refreshOrdersWhenVisible() {
  if (document.hidden) return;
  loadOrdersPage({ silent: true });
}

document.getElementById("order-form").addEventListener("submit", submitOrder);
loadOrdersPage();
setInterval(refreshOrdersWhenVisible, ORDER_REFRESH_MS);
window.addEventListener("focus", refreshOrdersWhenVisible);
document.addEventListener("visibilitychange", refreshOrdersWhenVisible);
