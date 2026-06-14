const moneyFormat = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2
});

const wholeMoneyFormat = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0
});

const WALLET_REFRESH_MS = 10000;

let walletState = null;
let walletCatalog = [];
let selectedSymbol = new URLSearchParams(location.search).get("asset") || "USD";
let expandedGroupKey = null;

const WALLET_GROUPS = [
  { symbol: "USD", key: "usd", name: "USD Cash", category: "cash", defaults: [], detail: "Buying power" },
  { symbol: "AU", key: "au", name: "Autody AU", category: "currency", defaults: [], detail: "Autody balance" },
  { symbol: "CRYPTO", key: "crypto", name: "Crypto", category: "crypto", defaults: ["BTC", "USDT", "USDC", "ETH", "BNB"], detail: "Coins and stablecoins" },
  { symbol: "STOCKS", key: "stocks", name: "Stocks", category: "stock", defaults: ["AAPL", "NVDA", "TSLA", "MSFT", "AMZN"], detail: "Company shares" },
  { symbol: "ETFS", key: "etf", name: "ETFs", category: "etf", defaults: ["SPY", "QQQ", "VOO", "GLD", "VT"], detail: "Funds and baskets" },
  { symbol: "OILMETALS", key: "commodity", name: "Oil and metals", category: "commodity", defaults: ["GC=F", "SI=F", "CL=F", "BZ=F", "NG=F"], detail: "Commodities" }
];

const GROUP_SYMBOLS = new Set(WALLET_GROUPS.map((group) => group.symbol));
const CRYPTO_ICON_SYMBOLS = {
  BTC: "btc",
  ETH: "eth",
  USDT: "usdt",
  USDC: "usdc",
  SOL: "sol",
  XRP: "xrp",
  BNB: "bnb",
  DOGE: "doge",
  ADA: "ada",
  AVAX: "avax",
  LINK: "link",
  LTC: "ltc",
  DOT: "dot",
  BCH: "bch",
  XLM: "xlm",
  TRX: "trx",
  POL: "pol"
};

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatMoney(value, whole = false) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return whole ? "$0" : "$0.00";
  return whole ? wholeMoneyFormat.format(amount) : moneyFormat.format(amount);
}

function formatNumber(value, maximumFractionDigits = 6) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0";
  return number.toLocaleString("en-US", { maximumFractionDigits });
}

function hasNumber(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function priceDigits(number, compact = false) {
  if (compact) return 2;
  if (Math.abs(number) < 0.01) return 8;
  if (Math.abs(number) < 1) return 6;
  return 2;
}

function formatPrice(value, currency = "USD") {
  const number = Number(value);
  if (!Number.isFinite(number)) return "Waiting";
  const compact = Math.abs(number) >= 100000;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      notation: compact ? "compact" : "standard",
      maximumFractionDigits: priceDigits(number, compact)
    }).format(number);
  } catch (err) {
    return `${currency} ${number.toLocaleString("en-US")}`;
  }
}

function formatMove(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "Live feed";
  const arrow = number > 0 ? "\u2191" : number < 0 ? "\u2193" : "\u2192";
  const sign = number > 0 ? "+" : "";
  return `${arrow} ${sign}${number.toFixed(2)}%`;
}

function moveClass(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number === 0) return "flat";
  return number > 0 ? "gain" : "loss";
}

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = value;
}

function cssWalletValue(value = "") {
  return window.CSS?.escape
    ? CSS.escape(String(value))
    : String(value).replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

function showWalletToast(message, tone = "") {
  let toast = document.getElementById("wallet-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "wallet-toast";
    toast.className = "market-toast";
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.className = `market-toast show ${tone}`;
  window.clearTimeout(showWalletToast.timer);
  showWalletToast.timer = window.setTimeout(() => toast.classList.remove("show"), 2600);
}

async function postWalletJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success) throw new Error(data.error || `${url} returned ${response.status}`);
  return data;
}

function catalogAsset(symbol) {
  const lookup = String(symbol || "").toUpperCase();
  return walletCatalog.find((asset) => String(asset.symbol).toUpperCase() === lookup) || null;
}

function walletHolding(symbol) {
  const lookup = String(symbol || "").toUpperCase();
  return (walletState?.holdings || []).find((asset) => String(asset.symbol).toUpperCase() === lookup) || null;
}

function positionHoldings() {
  return (walletState?.holdings || []).filter((holding) => !GROUP_SYMBOLS.has(String(holding.symbol || "").toUpperCase()));
}

function assetPurchaseOrderTime(symbol) {
  const lookup = String(symbol || "").toUpperCase();
  const matchingRecords = (walletState?.records || [])
    .filter((record) => {
      const recordSymbol = String(record.symbol || "").toUpperCase();
      const type = String(record.type || "").toLowerCase();
      return recordSymbol === lookup && ["buy", "swap"].includes(type);
    })
    .map((record) => Date.parse(record.createdAt || record.created_at || ""))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  return matchingRecords[0] ?? null;
}

function holdingSortTime(holding) {
  return Date.parse(holding?.updatedAt || holding?.updated_at || "") || null;
}

function holdingPurchaseOrderTime(holding) {
  const direct = Date.parse(holding?.firstPurchasedAt || holding?.first_purchased_at || "");
  if (Number.isFinite(direct)) return direct;
  return assetPurchaseOrderTime(holding?.symbol);
}

function groupKeyForAsset(asset = {}) {
  const symbol = String(asset.symbol || "").toUpperCase();
  const category = String(asset.category || asset.assetType || "").toLowerCase();
  if (symbol === "USD") return "usd";
  if (symbol === "AU") return "au";
  if (category === "crypto" || category === "currency") return "crypto";
  if (category === "stock" || category === "stocks") return "stocks";
  if (category === "etf") return "etf";
  if (category === "commodity") return "commodity";
  return "crypto";
}

function groupByKey(key) {
  return WALLET_GROUPS.find((group) => group.key === key) || WALLET_GROUPS[0];
}

function groupBySymbol(symbol) {
  const lookup = String(symbol || "").toUpperCase();
  return WALLET_GROUPS.find((group) => group.symbol === lookup) || null;
}

function selectedGroupKey() {
  return expandedGroupKey;
}

function groupKeyForSymbol(symbol) {
  const group = groupBySymbol(symbol);
  if (group) return group.key;
  const selectedHolding = walletHolding(symbol);
  if (selectedHolding) return groupKeyForAsset(selectedHolding);
  const market = catalogAsset(symbol);
  return market ? groupKeyForAsset(market) : null;
}

function dotClass(asset) {
  const symbol = String(asset.symbol || "").toLowerCase();
  const category = String(asset.category || asset.assetType || "").toLowerCase();
  if (symbol === "usd") return "cash";
  if (symbol === "au") return "au";
  if (symbol === "crypto" || category === "crypto") return "btc";
  if (symbol === "oilmetals" || category === "commodity") return "gold";
  return "stk";
}

function logoFallbackText(asset) {
  const symbol = String(asset.symbol || "?")
    .replace(/=F$/i, "")
    .replace(/[^a-z0-9]/gi, "")
    .slice(0, 4)
    .toUpperCase();
  return symbol || "?";
}

function walletLogoSrc(asset) {
  if (asset.logoUrl) return asset.logoUrl;
  if (asset.customAsset || asset.symbol === "AU") return "Autody-Logo.png";
  if (asset.assetType === "crypto" || asset.category === "crypto") {
    const symbol = CRYPTO_ICON_SYMBOLS[String(asset.symbol || "").toUpperCase()] || logoFallbackText(asset).toLowerCase();
    return `https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/128/color/${encodeURIComponent(symbol)}.png`;
  }
  return "";
}

function walletLogoMarkup(asset, extraClass = "") {
  const fallback = logoFallbackText(asset);
  const src = walletLogoSrc(asset);
  const autodyClass = asset.symbol === "AU" || asset.customAsset ? "autody-logo" : "";
  const typeClass = `logo-type-${String(asset.assetType || asset.category || "market").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const symbolClass = `logo-symbol-${fallback.toLowerCase()}`;
  const img = src
    ? `<span class="asset-logo-fit"><img src="${escapeHtml(src)}" alt="" loading="lazy" onerror="this.closest('.asset-logo').classList.add('logo-fallback'); this.closest('.asset-logo-fit')?.remove();"></span>`
    : "";
  return `
    <span class="asset-token asset-logo ${src ? "has-image" : "logo-fallback"} ${autodyClass} ${typeClass} ${symbolClass} ${escapeHtml(extraClass)}" data-symbol="${escapeHtml(fallback)}">
      ${img}
      <b>${escapeHtml(fallback)}</b>
    </span>
  `;
}

function walletLogoElement(asset, extraClass = "") {
  const template = document.createElement("template");
  template.innerHTML = walletLogoMarkup(asset, extraClass).trim();
  return template.content.firstElementChild;
}

function groupRow(group) {
  const baseHolding = walletHolding(group.symbol);
  if (group.symbol === "USD") {
    return {
      ...group,
      balance: walletState?.cashBalance || baseHolding?.balance || 0,
      valueUsd: walletState?.cashBalance || baseHolding?.valueUsd || 0,
      status: "Available",
      price: 1,
      isGroup: false
    };
  }
  if (group.symbol === "AU") {
    return {
      ...group,
      ...baseHolding,
      symbol: "AU",
      name: "Autody AU",
      category: "currency",
      balance: Number(baseHolding?.balance || 0),
      valueUsd: Number(baseHolding?.valueUsd || 0),
      status: Number(baseHolding?.balance || 0) > 0 ? "Held" : "Not held",
      isGroup: false
    };
  }

  const positions = positionHoldings().filter((holding) => groupKeyForAsset(holding) === group.key);
  const valueUsd = positions.reduce((sum, holding) => sum + Number(holding.valueUsd || 0), 0);
  return {
    ...group,
    balance: positions.length,
    valueUsd,
    status: positions.length ? "Tracking" : "Ready",
    isGroup: true
  };
}

function tableRows() {
  return WALLET_GROUPS.map(groupRow);
}

function groupAssets(group) {
  if (!group.defaults.length) return [];

  const defaultSymbols = group.defaults.map((symbol) => String(symbol).toUpperCase());
  const defaultRank = new Map(defaultSymbols.map((symbol, index) => [symbol, index]));
  const heldPositions = positionHoldings()
    .filter((holding) => Number(holding.balance || 0) > 0)
    .filter((holding) => groupKeyForAsset(holding) === group.key)
    .sort((a, b) => {
      const aSymbol = String(a.symbol || "").toUpperCase();
      const bSymbol = String(b.symbol || "").toUpperCase();
      const aPurchase = holdingPurchaseOrderTime(a);
      const bPurchase = holdingPurchaseOrderTime(b);
      if (aPurchase !== null || bPurchase !== null) return (aPurchase ?? Number.MAX_SAFE_INTEGER) - (bPurchase ?? Number.MAX_SAFE_INTEGER);
      const aUpdated = holdingSortTime(a);
      const bUpdated = holdingSortTime(b);
      if (aUpdated !== null || bUpdated !== null) return (aUpdated ?? Number.MAX_SAFE_INTEGER) - (bUpdated ?? Number.MAX_SAFE_INTEGER);
      return (defaultRank.get(aSymbol) ?? 999) - (defaultRank.get(bSymbol) ?? 999);
    });
  const heldSymbols = heldPositions.map((holding) => String(holding.symbol || "").toUpperCase());
  const symbols = [...heldSymbols, ...defaultSymbols.filter((symbol) => !heldSymbols.includes(symbol))];

  return symbols.map((symbol) => {
    const holding = walletHolding(symbol);
    const market = catalogAsset(symbol);
    return {
      ...market,
      ...holding,
      symbol,
      name: holding?.name || market?.name || symbol,
      category: holding?.category || market?.assetType || group.category,
      assetType: holding?.assetType || market?.assetType || group.category,
      price: market?.price ?? holding?.price ?? holding?.lastPrice ?? null,
      changePct: market?.changePct ?? holding?.changePct ?? null,
      logoUrl: market?.logoUrl || holding?.logoUrl || null,
      valueUsd: Number(holding?.valueUsd || 0),
      balance: Number(holding?.balance || 0),
      currency: market?.currency || "USD",
      status: Number(holding?.balance || 0) > 0 ? "Held" : "Not held",
      url: `demo-asset.html?symbol=${encodeURIComponent(symbol)}`
    };
  });
}

function formatBalance(asset) {
  const amount = Number(asset.balance);
  if (!Number.isFinite(amount)) return "0";
  if (asset.symbol === "USD") return formatMoney(amount);
  if (asset.isGroup) return `${amount} assets`;
  return `${formatNumber(amount)} ${asset.symbol}`;
}

function assetMarketUrl(symbol) {
  return `demo-asset.html?symbol=${encodeURIComponent(symbol)}`;
}

function tradeUrl(side, symbol) {
  return `demo-orders.html?side=${encodeURIComponent(side)}&symbol=${encodeURIComponent(symbol)}`;
}

function detailRow(label, value, tone = "") {
  return `
    <div>
      <span>${escapeHtml(label)}</span>
      <strong class="${escapeHtml(tone)}">${escapeHtml(value)}</strong>
    </div>
  `;
}

function categoryLabel(asset) {
  if (asset.symbol === "USD") return "Cash balance";
  if (asset.symbol === "AU") return "Autody balance";
  if (asset.isGroup) return `${asset.name} balance`;
  return asset.category ? `${asset.category.toUpperCase()} position` : "Position";
}

function walletActions(asset) {
  if (asset.symbol === "USD") {
    return [
      ["Buy assets", "demo-markets.html"],
      ["Orders", "demo-orders.html"]
    ];
  }
  if (asset.symbol === "AU") {
    return [
      ["Buy", tradeUrl("buy", asset.symbol)],
      ["Sell", tradeUrl("sell", asset.symbol)],
      ["Swap", tradeUrl("swap", asset.symbol)]
    ];
  }
  if (asset.isGroup) {
    const filter = asset.key === "stocks" ? "stocks" : asset.key;
    return [
      [`Browse ${asset.name}`, `demo-markets.html?filter=${encodeURIComponent(filter)}`],
      ["Orders", "demo-orders.html"]
    ];
  }
  const type = String(asset.assetType || asset.category || "").toLowerCase();
  const canSwap = type === "crypto" || type === "currency";
  const actions = [
    ["Buy", tradeUrl("buy", asset.symbol)],
    ["Sell", tradeUrl("sell", asset.symbol)]
  ];
  if (canSwap) actions.push(["Swap", tradeUrl("swap", asset.symbol)]);
  return actions;
}

function renderAssetName(asset, smallChange = false) {
  const change = smallChange && hasNumber(asset.changePct)
    ? `<small class="${moveClass(asset.changePct)}">${formatMove(asset.changePct)}</small>`
    : "";
  return `
    <span class="wallet-asset-name">
      <i class="asset-dot ${dotClass(asset)}"></i>
      <span class="asset-copy"><b>${escapeHtml(asset.name)}</b></span>
      ${change}
    </span>
  `;
}

function walletAssetMenu(asset) {
  if (asset.symbol === "USD" || asset.isGroup) return "";
  const symbol = escapeHtml(asset.symbol);
  return `
    <button class="asset-row-menu-button wallet-row-menu-button" type="button" data-wallet-menu-symbol="${symbol}" aria-label="More ${symbol} actions" aria-expanded="false">...</button>
    <div class="asset-row-menu wallet-asset-menu" data-wallet-menu="${symbol}" hidden>
      <button type="button" data-wallet-watch-symbol="${symbol}">Add to watchlist</button>
      <a href="${escapeHtml(asset.url || assetMarketUrl(asset.symbol))}" data-wallet-market-link="${symbol}">View in market</a>
    </div>
  `;
}

function renderStatusCell(asset, status, tone = "") {
  return `
    <span class="wallet-menu-cell">
      <span class="wallet-row-status ${escapeHtml(tone)}">${escapeHtml(status)}</span>
      ${walletAssetMenu(asset)}
    </span>
  `;
}

function renderNestedRows(group) {
  const assets = groupAssets(group);
  if (!assets.length) return "";

  return assets.map((asset) => {
    const held = Number(asset.balance) > 0;
    const status = held
      ? "Held"
      : hasNumber(asset.price)
        ? `Price ${formatPrice(asset.price, asset.currency || "USD")}`
        : "Waiting";
    return `
      <div class="asset-table-row wallet-holding-row wallet-subasset-row ${asset.symbol === selectedSymbol ? "active" : ""}" role="button" tabindex="0" data-wallet-symbol="${escapeHtml(asset.symbol)}">
        <span class="wallet-asset-name">
          ${walletLogoMarkup(asset, "asset-logo-small")}
          <span class="asset-copy"><b>${escapeHtml(asset.symbol)}</b><small>${escapeHtml(asset.name || asset.symbol)}</small></span>
        </span>
        <span>${escapeHtml(`${formatNumber(asset.balance)} ${asset.symbol}`)}</span>
        <span>${escapeHtml(formatMoney(asset.valueUsd))}</span>
        ${renderStatusCell(asset, status, held ? "gain" : moveClass(asset.changePct))}
      </div>
    `;
  }).join("");
}

function renderHoldings(rows) {
  const table = document.getElementById("wallet-holdings");
  if (!table || !Array.isArray(rows)) return;

  const expandedKey = selectedGroupKey();
  const renderedRows = rows.map((asset) => {
    const isActive = asset.symbol === selectedSymbol || (asset.isGroup && expandedKey === asset.key);
    const mainRow = `
      <div class="asset-table-row wallet-holding-row wallet-group-row ${isActive ? "active" : ""}" role="button" tabindex="0" data-wallet-symbol="${escapeHtml(asset.symbol)}">
        ${renderAssetName(asset, true)}
        <span>${escapeHtml(formatBalance(asset))}</span>
        <span>${escapeHtml(formatMoney(asset.valueUsd))}</span>
        ${renderStatusCell(asset, asset.status || "Ready")}
      </div>
    `;
    return `${mainRow}${asset.isGroup && expandedKey === asset.key ? renderNestedRows(asset) : ""}`;
  }).join("");

  table.innerHTML = `
    <div class="asset-table-row head">
      <span>Asset</span>
      <span>Balance</span>
      <span>Value</span>
      <span>Status</span>
    </div>
    ${renderedRows}
  `;
}

function renderDetail(asset) {
  if (!asset) return;
  const moveTone = moveClass(asset.changePct);
  const balance = Number(asset.balance || 0);
  const valueUsd = Number(asset.valueUsd || 0);
  const heroValue = !asset.isGroup && asset.symbol !== "USD" && valueUsd <= 0 && hasNumber(asset.price)
    ? formatPrice(asset.price, asset.currency || "USD")
    : formatMoney(valueUsd);
  const heroSubtitle = !asset.isGroup && balance <= 0 && hasNumber(asset.price)
    ? "Live price before you buy"
    : asset.detail || asset.market || asset.status || "Wallet balance";
  const rows = asset.isGroup
    ? [
      detailRow("Default assets", String(asset.defaults.length)),
      detailRow("Held assets", String(asset.balance)),
      detailRow("Value", formatMoney(asset.valueUsd)),
      detailRow("Status", asset.status || "Ready")
    ]
    : [
      detailRow("Balance", formatBalance(asset)),
      detailRow("Value", formatMoney(asset.valueUsd))
    ];

  if (!asset.isGroup && hasNumber(asset.price) && asset.symbol !== "USD") {
    rows.push(detailRow("Last price", formatMoney(asset.price)));
  }
  if (!asset.isGroup && hasNumber(asset.changePct)) {
    rows.push(detailRow("24h move", formatMove(asset.changePct), moveTone));
  }
  if (!asset.isGroup && hasNumber(asset.averageCost)) {
    rows.push(detailRow("Average cost", formatMoney(asset.averageCost)));
  }
  if (!asset.isGroup && hasNumber(asset.costBasis)) {
    rows.push(detailRow("Cost basis", formatMoney(asset.costBasis)));
  }
  if (!asset.isGroup && hasNumber(asset.unrealizedProfitLoss)) {
    rows.push(detailRow("Unrealized P/L", formatMoney(asset.unrealizedProfitLoss), moveClass(asset.unrealizedProfitLoss)));
  }
  if (!asset.isGroup) rows.push(detailRow("Status", asset.status || "Ready"));

  setText("wallet-detail-label", categoryLabel(asset));
  setText("wallet-detail-title", asset.name);
  setText("wallet-detail-value", heroValue);
  setText("wallet-detail-subtitle", heroSubtitle);
  const icon = document.getElementById("wallet-detail-icon");
  if (icon) {
    const nextIcon = walletLogoElement(asset, "asset-logo-large");
    icon.replaceWith(nextIcon);
    nextIcon.id = "wallet-detail-icon";
  }
  document.getElementById("wallet-detail-list").innerHTML = rows.join("");
  document.getElementById("wallet-detail-actions").innerHTML = walletActions(asset)
    .map(([label, href]) => `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`)
    .join("");
}

function renderRecords(records = []) {
  const target = document.getElementById("wallet-record-list");
  if (!target) return;

  target.innerHTML = records.length
    ? records.map((record) => `
      <div class="wallet-record-row">
        <span>${escapeHtml(record.symbol || "USD")}</span>
        <strong>${escapeHtml(record.title || "Wallet record")}</strong>
        <small>${escapeHtml(formatMoney(record.valueUsd))}</small>
      </div>
    `).join("")
    : `<div class="wallet-empty-state">No wallet records yet.</div>`;
}

function selectedAsset(rows) {
  return rows.find((asset) => asset.symbol === selectedSymbol)
    || walletAssetForSymbol(selectedSymbol)
    || rows[0];
}

function walletAssetForSymbol(symbol) {
  const lookup = String(symbol || "").toUpperCase();
  const holding = walletHolding(lookup);
  const market = catalogAsset(lookup);
  if (!holding && !market) return null;
  const groupKey = groupKeyForSymbol(lookup);
  const group = groupByKey(groupKey);
  return {
    ...market,
    ...holding,
    symbol: lookup,
    name: holding?.name || market?.name || lookup,
    category: holding?.category || market?.assetType || group.category,
    assetType: holding?.assetType || market?.assetType || group.category,
    price: market?.price ?? holding?.price ?? holding?.lastPrice ?? null,
    changePct: market?.changePct ?? holding?.changePct ?? null,
    logoUrl: market?.logoUrl || holding?.logoUrl || null,
    valueUsd: Number(holding?.valueUsd || 0),
    balance: Number(holding?.balance || 0),
    currency: market?.currency || "USD",
    status: Number(holding?.balance || 0) > 0 ? "Held" : "Not held",
    detail: Number(holding?.balance || 0) > 0 ? "Wallet position" : "Available to trade",
    url: assetMarketUrl(lookup)
  };
}

function renderWallet(wallet) {
  walletState = wallet;
  const rows = tableRows();
  if (!expandedGroupKey) {
    const key = groupKeyForSymbol(selectedSymbol);
    if (key && !["usd", "au"].includes(key) && !groupBySymbol(selectedSymbol)) {
      expandedGroupKey = key;
    }
  }
  const selected = selectedAsset(rows);
  selectedSymbol = selected?.symbol || "USD";

  setText("sidebar-balance", `${wholeMoneyFormat.format(wallet.cashBalance)} USD`);
  setText("topbar-balance", `${wholeMoneyFormat.format(wallet.cashBalance)} USD`);
  setText("wallet-cash", formatMoney(wallet.cashBalance, true));
  setText("wallet-total", formatMoney(wallet.totalValue, true));
  setText("wallet-positions", String(wallet.positionsCount || 0));
  setText("wallet-reserved", formatMoney(wallet.reservedCash));

  renderHoldings(rows);
  renderDetail(selected);
  renderRecords(wallet.records || []);
}

async function loadWallet(options = {}) {
  try {
    const catalogRequest = fetch("/api/markets/catalog?type=all", { cache: "no-store" }).then((response) => {
        if (!response.ok) throw new Error(`/api/markets/catalog returned ${response.status}`);
        return response.json();
      }).catch(() => ({ assets: walletCatalog }));

    const data = await fetch("/api/demo/wallet", { cache: "no-store" }).then((response) => {
      if (!response.ok) throw new Error(`/api/demo/wallet returned ${response.status}`);
      return response.json();
    });
    if (!data.success) throw new Error(data.error || "Demo wallet failed");

    renderWallet(data.wallet);

    const catalog = await catalogRequest;
    walletCatalog = catalog.assets || walletCatalog;
    renderWallet(data.wallet);
  } catch (err) {
    console.warn("Demo wallet data failed:", err);
    if (!options.silent) {
      renderRecords([]);
    }
  }
}

function refreshWalletWhenVisible() {
  if (document.hidden) return;
  loadWallet({ silent: true });
}

function closeWalletMenus() {
  document.querySelectorAll("[data-wallet-menu]").forEach((menu) => {
    menu.hidden = true;
  });
  document.querySelectorAll("[data-wallet-menu-symbol]").forEach((button) => {
    button.setAttribute("aria-expanded", "false");
  });
  document.querySelectorAll(".wallet-holding-row.menu-open").forEach((row) => {
    row.classList.remove("menu-open");
  });
}

function openWalletMenu(symbol, menuButton) {
  const escapedSymbol = cssWalletValue(symbol);
  const targetMenu = document.querySelector(`[data-wallet-menu="${escapedSymbol}"]`);
  const shouldOpen = Boolean(targetMenu?.hidden);
  closeWalletMenus();
  if (!targetMenu || !shouldOpen) return;
  targetMenu.hidden = false;
  menuButton.setAttribute("aria-expanded", "true");
  menuButton.closest(".wallet-holding-row")?.classList.add("menu-open");
}

document.addEventListener("click", (event) => {
  const menuButton = event.target.closest("[data-wallet-menu-symbol]");
  if (menuButton) {
    openWalletMenu(menuButton.dataset.walletMenuSymbol, menuButton);
    return;
  }

  const watchButton = event.target.closest("[data-wallet-watch-symbol]");
  if (watchButton) {
    const symbol = watchButton.dataset.walletWatchSymbol;
    watchButton.disabled = true;
    postWalletJson("/api/demo/watchlist", { symbol })
      .then((data) => {
        closeWalletMenus();
        showWalletToast(
          data.alreadySaved ? `${symbol} is already in your watchlist.` : `${symbol} added to your watchlist.`,
          data.alreadySaved ? "flat" : "gain"
        );
      })
      .catch((err) => showWalletToast(err.message || "Watchlist could not be updated.", "loss"))
      .finally(() => {
        watchButton.disabled = false;
      });
    return;
  }

  if (event.target.closest(".asset-row-menu")) return;

  const row = event.target.closest("[data-wallet-symbol]");
  if (row && walletState) {
    const nextSymbol = row.dataset.walletSymbol;
    const group = groupBySymbol(nextSymbol);
    if (group?.defaults?.length) {
      expandedGroupKey = expandedGroupKey === group.key ? null : group.key;
      selectedSymbol = nextSymbol;
    } else {
      selectedSymbol = nextSymbol;
      const key = groupKeyForSymbol(nextSymbol);
      if (key && !["usd", "au"].includes(key)) expandedGroupKey = key;
    }
    closeWalletMenus();
    history.replaceState(null, "", `demo-wallet.html?asset=${encodeURIComponent(selectedSymbol)}`);
    renderWallet(walletState);
    return;
  }

  closeWalletMenus();
});

document.addEventListener("keydown", (event) => {
  if (!["Enter", " "].includes(event.key)) return;
  if (event.target.closest("button, a")) return;
  const row = event.target.closest("[data-wallet-symbol]");
  if (!row) return;
  event.preventDefault();
  row.click();
});

loadWallet();
setInterval(refreshWalletWhenVisible, WALLET_REFRESH_MS);
window.addEventListener("focus", refreshWalletWhenVisible);
document.addEventListener("visibilitychange", refreshWalletWhenVisible);
