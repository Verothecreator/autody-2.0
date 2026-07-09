const liveWalletMoney = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2
});

const liveWalletWholeMoney = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0
});

const LIVE_WALLET_REFRESH_MS = 10000;
const LIVE_WALLET_DUST_USD = 0.005;

let liveWalletCatalog = [];
let selectedLiveWalletSymbol = new URLSearchParams(location.search).get("asset") || "USD";
let expandedLiveWalletGroupKey = null;

const liveWalletState = {
  cashBalance: 0,
  totalValue: 0,
  positionsCount: 0,
  pendingTransfers: 0,
  holdings: [],
  records: []
};

const LIVE_WALLET_GROUPS = [
  { symbol: "USD", key: "usd", name: "USD Funds", category: "cash", defaults: [], detail: "Available after a verified deposit" },
  { symbol: "AU", key: "au", name: "Autody AU", category: "currency", defaults: [], detail: "Autody balance" },
  { symbol: "CRYPTO", key: "crypto", name: "Crypto", category: "crypto", defaults: ["BTC", "USDT", "USDC", "ETH", "BNB"], detail: "Deposit-ready digital assets" },
  { symbol: "STOCKS", key: "stocks", name: "Stocks", category: "stock", defaults: ["AAPL", "NVDA", "TSLA", "MSFT", "AMZN"], detail: "Company shares" },
  { symbol: "ETFS", key: "etf", name: "ETFs", category: "etf", defaults: ["SPY", "QQQ", "VOO", "GLD", "VT"], detail: "Funds and baskets" },
  { symbol: "OILMETALS", key: "commodity", name: "Oil and metals", category: "commodity", defaults: ["GC=F", "SI=F", "CL=F", "BZ=F", "NG=F"], detail: "Commodity instruments" }
];

const LIVE_GROUP_SYMBOLS = new Set(LIVE_WALLET_GROUPS.map((group) => group.symbol));

const LIVE_CRYPTO_ICONS = {
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

function escapeLiveWalletHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function cssLiveWalletValue(value = "") {
  return window.CSS?.escape
    ? CSS.escape(String(value))
    : String(value).replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

function formatLiveWalletMoney(value, whole = false) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return whole ? "$0" : "$0.00";
  return whole ? liveWalletWholeMoney.format(amount) : liveWalletMoney.format(amount);
}

function formatLiveWalletNumber(value, maximumFractionDigits = 6) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0";
  return number.toLocaleString("en-US", { maximumFractionDigits });
}

function hasLiveWalletNumber(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function liveWalletNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function liveWalletPriceDigits(number, compact = false) {
  if (compact) return 2;
  if (Math.abs(number) < 0.01) return 8;
  if (Math.abs(number) < 1) return 6;
  return 2;
}

function formatLiveWalletPrice(value, currency = "USD") {
  const number = Number(value);
  if (!Number.isFinite(number)) return "Waiting";
  const compact = Math.abs(number) >= 100000;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      notation: compact ? "compact" : "standard",
      maximumFractionDigits: liveWalletPriceDigits(number, compact)
    }).format(number);
  } catch (err) {
    return `${currency} ${number.toLocaleString("en-US")}`;
  }
}

function formatLiveWalletMove(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "Live feed";
  const sign = number > 0 ? "+" : "";
  return `${sign}${number.toFixed(2)}%`;
}

function liveWalletMoveClass(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number === 0) return "flat";
  return number > 0 ? "gain" : "loss";
}

function setLiveWalletText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = value;
}

function showLiveWalletToast(message, tone = "") {
  let toast = document.getElementById("live-wallet-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "live-wallet-toast";
    toast.className = "market-toast";
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.className = `market-toast show ${tone}`;
  window.clearTimeout(showLiveWalletToast.timer);
  showLiveWalletToast.timer = window.setTimeout(() => toast.classList.remove("show"), 2600);
}

async function postLiveWalletJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: window.AutodyAuth?.headers?.({ "Content-Type": "application/json" }) || { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success) throw new Error(data.error || `${url} returned ${response.status}`);
  return data;
}

function liveCatalogAsset(symbol) {
  const lookup = String(symbol || "").toUpperCase();
  return liveWalletCatalog.find((asset) => String(asset.symbol).toUpperCase() === lookup) || null;
}

function liveGroupByKey(key) {
  return LIVE_WALLET_GROUPS.find((group) => group.key === key) || LIVE_WALLET_GROUPS[0];
}

function liveGroupBySymbol(symbol) {
  const lookup = String(symbol || "").toUpperCase();
  return LIVE_WALLET_GROUPS.find((group) => group.symbol === lookup) || null;
}

function normalizeLiveWalletHolding(holding = {}) {
  const symbol = String(holding.symbol || "").toUpperCase();
  if (!symbol) return null;
  const market = liveCatalogAsset(symbol) || {};
  const category = holding.assetType || holding.category || market.assetType || (symbol === "USD" ? "cash" : "market");
  const price = hasLiveWalletNumber(holding.price)
    ? Number(holding.price)
    : hasLiveWalletNumber(holding.lastPrice)
      ? Number(holding.lastPrice)
      : market.price ?? null;

  let balance = liveWalletNumber(holding.balance, 0);
  let valueUsd = liveWalletNumber(holding.valueUsd, 0);
  if (["USDT", "USDC"].includes(symbol) && balance > 0) {
    valueUsd = balance;
  }
  if (balance <= 0.00000001 || valueUsd < LIVE_WALLET_DUST_USD) {
    if (symbol !== "USD" && symbol !== "AU" && !LIVE_GROUP_SYMBOLS.has(symbol)) {
      balance = 0;
      valueUsd = 0;
    }
  }

  return {
    ...market,
    ...holding,
    symbol,
    name: holding.name || holding.assetName || market.name || symbol,
    category,
    assetType: category,
    balance,
    valueUsd,
    price,
    changePct: holding.changePct ?? market.changePct ?? null,
    logoUrl: holding.logoUrl || market.logoUrl || null,
    currency: holding.currency || market.currency || "USD",
    status: holding.status || (liveWalletNumber(holding.balance, 0) > 0 ? "Held" : "Ready"),
    detail: holding.detail || "",
    url: holding.url || `account-asset?symbol=${encodeURIComponent(symbol)}`
  };
}

function liveWalletHoldings() {
  return (liveWalletState.holdings || [])
    .map(normalizeLiveWalletHolding)
    .filter(Boolean);
}

function liveWalletHoldingForSymbol(symbol) {
  const lookup = String(symbol || "").toUpperCase();
  return liveWalletHoldings().find((holding) => holding.symbol === lookup) || null;
}

function liveGroupKeyForAsset(asset = {}) {
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

function liveGroupKeyForSymbol(symbol) {
  const group = liveGroupBySymbol(symbol);
  if (group) return group.key;
  const market = liveCatalogAsset(symbol);
  return market ? liveGroupKeyForAsset(market) : null;
}

function liveWalletDotClass(asset) {
  const symbol = String(asset.symbol || "").toLowerCase();
  const category = String(asset.category || asset.assetType || "").toLowerCase();
  if (symbol === "usd") return "cash";
  if (symbol === "au") return "au";
  if (symbol === "crypto" || category === "crypto") return "btc";
  if (symbol === "oilmetals" || category === "commodity") return "gold";
  if (category === "etf") return "etf";
  return "stk";
}

function liveLogoFallbackText(asset) {
  const symbol = String(asset.symbol || "?")
    .replace(/=F$/i, "")
    .replace(/[^a-z0-9]/gi, "")
    .slice(0, 4)
    .toUpperCase();
  return symbol || "?";
}

function liveWalletLogoSrc(asset) {
  const symbol = String(asset.symbol || "").toUpperCase();
  const assetType = String(asset.assetType || asset.category || "").toLowerCase();
  if (asset.logoUrl) return asset.logoUrl;
  if (symbol === "AU") return "Autody-Logo.png";
  if (assetType === "crypto") {
    const icon = LIVE_CRYPTO_ICONS[symbol] || liveLogoFallbackText(asset).toLowerCase();
    return `https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/128/color/${encodeURIComponent(icon)}.png`;
  }
  return "";
}

function liveWalletLogoMarkup(asset, extraClass = "") {
  const fallback = liveLogoFallbackText(asset);
  const src = liveWalletLogoSrc(asset);
  const autodyClass = asset.symbol === "AU" ? "autody-logo" : "";
  const customClass = asset.customAsset && asset.symbol !== "AU" ? "custom-logo" : "";
  const typeClass = `logo-type-${String(asset.assetType || asset.category || "market").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const symbolClass = `logo-symbol-${fallback.toLowerCase()}`;
  const img = src
    ? `<span class="asset-logo-fit"><img src="${escapeLiveWalletHtml(src)}" alt="" loading="lazy" onerror="this.closest('.asset-logo').classList.add('logo-fallback'); this.closest('.asset-logo-fit')?.remove();"></span>`
    : "";
  return `
    <span class="asset-token asset-logo ${src ? "has-image" : "logo-fallback"} ${autodyClass} ${customClass} ${typeClass} ${symbolClass} ${escapeLiveWalletHtml(extraClass)}" data-symbol="${escapeLiveWalletHtml(fallback)}">
      ${img}
      <b>${escapeLiveWalletHtml(fallback)}</b>
    </span>
  `;
}

function liveWalletLogoElement(asset, extraClass = "") {
  const template = document.createElement("template");
  template.innerHTML = liveWalletLogoMarkup(asset, extraClass).trim();
  return template.content.firstElementChild;
}

function liveWalletGroupRow(group) {
  const saved = liveWalletHoldingForSymbol(group.symbol);
  if (saved) {
    return {
      ...group,
      ...saved,
      key: group.key,
      defaults: group.defaults,
      detail: saved.detail || group.detail,
      isGroup: Boolean(group.defaults.length),
      customAsset: group.symbol === "AU" || saved.customAsset
    };
  }

  if (group.symbol === "USD") {
    return {
      ...group,
      balance: liveWalletState.cashBalance,
      valueUsd: liveWalletState.cashBalance,
      status: "Awaiting deposit",
      price: 1,
      isGroup: false
    };
  }
  if (group.symbol === "AU") {
    return {
      ...group,
      symbol: "AU",
      name: "Autody AU",
      category: "currency",
      customAsset: true,
      balance: 0,
      valueUsd: 0,
      status: "Not held",
      isGroup: false
    };
  }
  return {
    ...group,
    balance: 0,
    valueUsd: 0,
    status: "Ready",
    isGroup: true
  };
}

function liveWalletRows() {
  return LIVE_WALLET_GROUPS.map(liveWalletGroupRow);
}

function liveGroupAssets(group) {
  if (!group.defaults.length) return [];
  const heldAssets = liveWalletHoldings()
    .filter((asset) => !LIVE_GROUP_SYMBOLS.has(asset.symbol))
    .filter((asset) => liveWalletNumber(asset.balance, 0) > 0.00000001 && liveWalletNumber(asset.valueUsd, 0) >= LIVE_WALLET_DUST_USD)
    .filter((asset) => liveGroupKeyForAsset(asset) === group.key)
    .sort((left, right) => liveWalletNumber(right.valueUsd, 0) - liveWalletNumber(left.valueUsd, 0));
  const heldSymbols = new Set(heldAssets.map((asset) => asset.symbol));
  const defaultAssets = group.defaults.filter((symbol) => !heldSymbols.has(String(symbol || "").toUpperCase())).map((symbol) => {
    const market = liveCatalogAsset(symbol) || {};
    const assetType = market.assetType || group.category;
    return {
      ...market,
      symbol,
      name: market.name || symbol,
      category: market.assetType || group.category,
      assetType,
      price: market.price ?? null,
      changePct: market.changePct ?? null,
      logoUrl: market.logoUrl || null,
      valueUsd: 0,
      balance: 0,
      currency: market.currency || "USD",
      status: "Not held",
      url: `account-asset?symbol=${encodeURIComponent(symbol)}`
    };
  });

  return [...heldAssets, ...defaultAssets];
}

function liveWalletAssetForSymbol(symbol) {
  const lookup = String(symbol || "").toUpperCase();
  const group = liveGroupBySymbol(lookup);
  if (group) return liveWalletGroupRow(group);
  const holding = liveWalletHoldingForSymbol(lookup);
  if (holding) return holding;
  const market = liveCatalogAsset(lookup);
  if (!market) return null;
  const groupKey = liveGroupKeyForSymbol(lookup);
  return {
    ...market,
    symbol: lookup,
    name: market.name || lookup,
    category: market.assetType || liveGroupByKey(groupKey).category,
    assetType: market.assetType || liveGroupByKey(groupKey).category,
    price: market.price ?? null,
    changePct: market.changePct ?? null,
    logoUrl: market.logoUrl || null,
    valueUsd: 0,
    balance: 0,
    currency: market.currency || "USD",
    status: "Not held",
    detail: hasLiveWalletNumber(market.price) ? "Live price before you hold" : "Available after market data loads",
    url: `account-asset?symbol=${encodeURIComponent(lookup)}`
  };
}

function formatLiveBalance(asset) {
  const amount = Number(asset.balance);
  if (asset.symbol === "USD") return formatLiveWalletMoney(amount);
  if (asset.isGroup) return `${amount || 0} assets`;
  return `${formatLiveWalletNumber(amount)} ${asset.symbol}`;
}

function liveAssetMarketUrl(symbol) {
  return `account-asset?symbol=${encodeURIComponent(symbol)}`;
}

function liveTradeUrl(side, symbol) {
  return `account-orders?side=${encodeURIComponent(side)}&symbol=${encodeURIComponent(symbol)}`;
}

function liveWalletUsesCryptoActionGrid(asset = {}) {
  const type = String(asset.assetType || asset.category || "").toLowerCase();
  return !asset.isGroup && asset.symbol !== "USD" && (
    asset.symbol === "AU" ||
    type === "crypto" ||
    type === "currency" ||
    type === "stablecoin"
  );
}

function liveDetailRow(label, value, tone = "") {
  return `
    <div>
      <span>${escapeLiveWalletHtml(label)}</span>
      <strong class="${escapeLiveWalletHtml(tone)}">${escapeLiveWalletHtml(value)}</strong>
    </div>
  `;
}

function liveCategoryLabel(asset) {
  if (asset.symbol === "USD") return "USD balance";
  if (asset.symbol === "AU") return "Autody balance";
  if (asset.isGroup) return `${asset.name} balance`;
  return asset.category ? `${String(asset.category).toUpperCase()} market` : "Market";
}

function liveWalletActions(asset) {
  if (asset.symbol === "USD") {
    return [
      ["Add Funds", "modal:funding"],
      ["Receive Crypto", "modal:receive"]
    ];
  }
  if (asset.symbol === "AU") {
    return [
      ["Buy", liveTradeUrl("buy", asset.symbol)],
      ["Sell", liveTradeUrl("sell", asset.symbol)],
      ["Swap", liveTradeUrl("swap", asset.symbol)],
      ["Receive", "modal:receive"],
      ["Send", "modal:send"]
    ];
  }
  if (asset.isGroup) {
    const filter = asset.key === "stocks" ? "stocks" : asset.key;
    const primary = asset.key === "crypto" ? ["Receive Crypto", "modal:receive"] : [`Browse ${asset.name}`, `account-markets?filter=${encodeURIComponent(filter)}`];
    return [
      primary,
      ["Orders", "account-orders"]
    ];
  }
  const type = String(asset.assetType || asset.category || "").toLowerCase();
  const actions = [
    ["Buy", liveTradeUrl("buy", asset.symbol)],
    ["Sell", liveTradeUrl("sell", asset.symbol)]
  ];
  if (type === "crypto" || type === "currency") {
    actions.push(["Swap", liveTradeUrl("swap", asset.symbol)]);
    actions.push(["Receive", "modal:receive"]);
    actions.push(["Send", "modal:send"]);
  }
  return actions;
}

function liveRenderAssetName(asset, smallChange = false) {
  const change = smallChange && hasLiveWalletNumber(asset.changePct)
    ? `<small class="${liveWalletMoveClass(asset.changePct)}">${formatLiveWalletMove(asset.changePct)}</small>`
    : "";
  return `
    <span class="wallet-asset-name">
      <i class="asset-dot ${liveWalletDotClass(asset)}"></i>
      <span class="asset-copy"><b>${escapeLiveWalletHtml(asset.name)}</b></span>
      ${change}
    </span>
  `;
}

function liveWalletAssetMenu(asset) {
  if (asset.symbol === "USD" || asset.isGroup) return "";
  const symbol = escapeLiveWalletHtml(asset.symbol);
  return `
    <button class="asset-row-menu-button wallet-row-menu-button" type="button" data-live-wallet-menu-symbol="${symbol}" aria-label="More ${symbol} actions" aria-expanded="false">...</button>
    <div class="asset-row-menu wallet-asset-menu" data-live-wallet-menu="${symbol}" hidden>
      <button type="button" data-live-wallet-watch-symbol="${symbol}">Add to watchlist</button>
      <a href="${escapeLiveWalletHtml(asset.url || liveAssetMarketUrl(asset.symbol))}" data-live-wallet-market-link="${symbol}">View in market</a>
    </div>
  `;
}

function liveRenderStatusCell(asset, status, tone = "") {
  return `
    <span class="wallet-menu-cell">
      <span class="wallet-row-status ${escapeLiveWalletHtml(tone)}">${escapeLiveWalletHtml(status)}</span>
      ${liveWalletAssetMenu(asset)}
    </span>
  `;
}

function liveRenderNestedRows(group) {
  const assets = liveGroupAssets(group);
  if (!assets.length) return "";

  return assets.map((asset) => {
    const status = hasLiveWalletNumber(asset.price)
      ? `Price ${formatLiveWalletPrice(asset.price, asset.currency || "USD")}`
      : "Waiting";
    return `
      <div class="asset-table-row wallet-holding-row wallet-subasset-row ${asset.symbol === selectedLiveWalletSymbol ? "active" : ""}" role="button" tabindex="0" data-live-wallet-symbol="${escapeLiveWalletHtml(asset.symbol)}">
        <span class="wallet-asset-name">
          ${liveWalletLogoMarkup(asset, "asset-logo-small")}
          <span class="asset-copy"><b>${escapeLiveWalletHtml(asset.symbol)}</b><small>${escapeLiveWalletHtml(asset.name || asset.symbol)}</small></span>
        </span>
        <span>${escapeLiveWalletHtml(`${formatLiveWalletNumber(asset.balance)} ${asset.symbol}`)}</span>
        <span>${escapeLiveWalletHtml(formatLiveWalletMoney(asset.valueUsd))}</span>
        ${liveRenderStatusCell(asset, status, liveWalletMoveClass(asset.changePct))}
      </div>
    `;
  }).join("");
}

function liveRenderHoldings(rows) {
  const table = document.getElementById("live-wallet-holdings");
  if (!table || !Array.isArray(rows)) return;

  const renderedRows = rows.map((asset) => {
    const isActive = asset.symbol === selectedLiveWalletSymbol || (asset.isGroup && expandedLiveWalletGroupKey === asset.key);
    const showMainRowMove = asset.symbol !== "AU";
    const mainRow = `
      <div class="asset-table-row wallet-holding-row wallet-group-row ${isActive ? "active" : ""}" role="button" tabindex="0" data-live-wallet-symbol="${escapeLiveWalletHtml(asset.symbol)}">
        ${liveRenderAssetName(asset, showMainRowMove)}
        <span>${escapeLiveWalletHtml(formatLiveBalance(asset))}</span>
        <span>${escapeLiveWalletHtml(formatLiveWalletMoney(asset.valueUsd))}</span>
        ${liveRenderStatusCell(asset, asset.status || "Ready")}
      </div>
    `;
    return `${mainRow}${asset.isGroup && expandedLiveWalletGroupKey === asset.key ? liveRenderNestedRows(asset) : ""}`;
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

function liveRenderDetail(asset) {
  if (!asset) return;
  const moveTone = liveWalletMoveClass(asset.changePct);
  const balance = Number(asset.balance || 0);
  const valueUsd = Number(asset.valueUsd || 0);
  const heroValue = !asset.isGroup && asset.symbol !== "USD" && valueUsd <= 0 && hasLiveWalletNumber(asset.price)
    ? formatLiveWalletPrice(asset.price, asset.currency || "USD")
    : formatLiveWalletMoney(valueUsd);
  const heroSubtitle = !asset.isGroup && balance <= 0 && hasLiveWalletNumber(asset.price)
    ? "Live price before you hold"
    : asset.detail || asset.status || "Wallet balance";
  const rows = asset.isGroup
    ? [
      liveDetailRow("Default assets", String(asset.defaults.length)),
      liveDetailRow("Held assets", String(asset.balance || 0)),
      liveDetailRow("Value", formatLiveWalletMoney(asset.valueUsd)),
      liveDetailRow("Status", asset.status || "Ready")
    ]
    : [
      liveDetailRow("Balance", formatLiveBalance(asset)),
      liveDetailRow("Value", formatLiveWalletMoney(asset.valueUsd))
    ];

  if (!asset.isGroup && hasLiveWalletNumber(asset.price) && asset.symbol !== "USD") {
    rows.push(liveDetailRow("Last price", formatLiveWalletPrice(asset.price, asset.currency || "USD")));
  }
  if (!asset.isGroup && hasLiveWalletNumber(asset.changePct)) {
    rows.push(liveDetailRow("24h move", formatLiveWalletMove(asset.changePct), moveTone));
  }
  if (!asset.isGroup && hasLiveWalletNumber(asset.averageCost)) {
    rows.push(liveDetailRow("Average cost", formatLiveWalletMoney(asset.averageCost)));
  }
  if (!asset.isGroup && hasLiveWalletNumber(asset.costBasis)) {
    rows.push(liveDetailRow("Cost basis", formatLiveWalletMoney(asset.costBasis)));
  }
  if (!asset.isGroup && hasLiveWalletNumber(asset.unrealizedProfitLoss)) {
    rows.push(liveDetailRow("Unrealized P/L", formatLiveWalletMoney(asset.unrealizedProfitLoss), liveWalletMoveClass(asset.unrealizedProfitLoss)));
  }
  if (!asset.isGroup) rows.push(liveDetailRow("Status", asset.status || "Ready"));

  setLiveWalletText("live-wallet-detail-label", liveCategoryLabel(asset));
  setLiveWalletText("live-wallet-detail-title", asset.name);
  setLiveWalletText("live-wallet-detail-value", heroValue);
  setLiveWalletText("live-wallet-detail-subtitle", heroSubtitle);

  const icon = document.getElementById("live-wallet-detail-icon");
  if (icon) {
    const nextIcon = liveWalletLogoElement(asset, "asset-logo-large");
    icon.replaceWith(nextIcon);
    nextIcon.id = "live-wallet-detail-icon";
  }

  const list = document.getElementById("live-wallet-detail-list");
  if (list) list.innerHTML = rows.join("");

  const actions = document.getElementById("live-wallet-detail-actions");
  if (actions) {
    actions.classList.toggle("wallet-action-grid-crypto", liveWalletUsesCryptoActionGrid(asset));
    actions.innerHTML = liveWalletActions(asset)
      .map(([label, href]) => {
        if (href === "modal:funding") {
          return `<button type="button" data-live-wallet-funding>${escapeLiveWalletHtml(label)}</button>`;
        }
        return href.startsWith("modal:")
          ? `<button type="button" data-live-wallet-transfer="${escapeLiveWalletHtml(href.replace("modal:", ""))}">${escapeLiveWalletHtml(label)}</button>`
          : `<a href="${escapeLiveWalletHtml(href)}">${escapeLiveWalletHtml(label)}</a>`;
      })
      .join("");
  }
}

function liveRenderRecords(records = []) {
  const target = document.getElementById("live-wallet-record-list");
  if (!target) return;
  target.innerHTML = records.length
    ? records.map((record) => `
      <div class="wallet-record-row">
        <span>${escapeLiveWalletHtml(record.symbol || "USD")}</span>
        <strong>${escapeLiveWalletHtml(record.title || "Wallet record")}</strong>
        <small>${escapeLiveWalletHtml(formatLiveWalletMoney(record.valueUsd))}</small>
      </div>
    `).join("")
    : `<div class="wallet-empty-state">No live wallet records yet.</div>`;
}

function liveSelectedAsset(rows) {
  return rows.find((asset) => asset.symbol === selectedLiveWalletSymbol)
    || liveWalletAssetForSymbol(selectedLiveWalletSymbol)
    || rows[0];
}

function renderLiveWallet() {
  const rows = liveWalletRows();
  if (!expandedLiveWalletGroupKey) {
    const key = liveGroupKeyForSymbol(selectedLiveWalletSymbol);
    if (key && !["usd", "au"].includes(key) && !liveGroupBySymbol(selectedLiveWalletSymbol)) {
      expandedLiveWalletGroupKey = key;
    }
  }
  const selected = liveSelectedAsset(rows);
  selectedLiveWalletSymbol = selected?.symbol || "USD";

  const balanceText = `${formatLiveWalletMoney(liveWalletState.cashBalance)} USD`;
  document.querySelectorAll("[data-live-balance]").forEach((node) => {
    node.textContent = balanceText;
  });
  setLiveWalletText("live-wallet-topbar", balanceText);
  setLiveWalletText("live-wallet-cash", formatLiveWalletMoney(liveWalletState.cashBalance));
  setLiveWalletText("live-wallet-total", formatLiveWalletMoney(liveWalletState.totalValue));
  setLiveWalletText("live-wallet-positions", String(liveWalletState.positionsCount));
  setLiveWalletText("live-wallet-positions-label", liveWalletState.positionsCount ? "Assets currently held" : "No assets held yet");
  setLiveWalletText("live-wallet-pending", String(liveWalletState.pendingTransfers));

  liveRenderHoldings(rows);
  liveRenderDetail(selected);
  liveRenderRecords(liveWalletState.records);
}

async function loadLiveWallet() {
  renderLiveWallet();
  try {
    const authHeaders = window.AutodyAuth?.headers?.() || {};
    const [walletResult, catalogResult] = await Promise.allSettled([
      fetch("/api/account/wallet", {
        cache: "no-store",
        headers: authHeaders
      }),
      fetch("/api/markets/catalog?type=all", {
        cache: "no-store",
        headers: authHeaders
      })
    ]);

    if (walletResult.status !== "fulfilled") {
      throw walletResult.reason || new Error("Live wallet request failed.");
    }
    const walletResponse = walletResult.value;
    if (walletResponse.ok) {
      const walletData = await walletResponse.json();
      if (walletData?.wallet) {
        liveWalletState.cashBalance = liveWalletNumber(walletData.wallet.cashBalance, 0);
        liveWalletState.totalValue = liveWalletNumber(walletData.wallet.totalValue, liveWalletState.cashBalance);
        liveWalletState.positionsCount = liveWalletNumber(walletData.wallet.positionsCount, 0);
        liveWalletState.pendingTransfers = liveWalletNumber(walletData.wallet.pendingTransfers, 0);
        liveWalletState.holdings = Array.isArray(walletData.wallet.holdings) ? walletData.wallet.holdings : [];
        liveWalletState.records = Array.isArray(walletData.wallet.records) ? walletData.wallet.records : [];
      }
    } else {
      throw new Error(`/api/account/wallet returned ${walletResponse.status}`);
    }

    if (catalogResult.status !== "fulfilled") {
      console.warn("Live market catalog failed:", catalogResult.reason);
      renderLiveWallet();
      return;
    }
    const catalogResponse = catalogResult.value;
    if (catalogResponse.ok) {
      const catalogData = await catalogResponse.json();
      if (Array.isArray(catalogData.assets)) liveWalletCatalog = catalogData.assets;
    } else {
      console.warn(`/api/markets/catalog returned ${catalogResponse.status}`);
    }

    renderLiveWallet();
  } catch (err) {
    console.warn("Live wallet data failed:", err);
  }
}

function refreshLiveWalletWhenVisible() {
  if (document.hidden) return;
  loadLiveWallet();
}

function closeLiveWalletMenus() {
  document.querySelectorAll("[data-live-wallet-menu]").forEach((menu) => {
    menu.hidden = true;
  });
  document.querySelectorAll("[data-live-wallet-menu-symbol]").forEach((button) => {
    button.setAttribute("aria-expanded", "false");
  });
  document.querySelectorAll(".wallet-holding-row.menu-open").forEach((row) => {
    row.classList.remove("menu-open");
  });
}

function openLiveWalletMenu(symbol, menuButton) {
  const escapedSymbol = cssLiveWalletValue(symbol);
  const targetMenu = document.querySelector(`[data-live-wallet-menu="${escapedSymbol}"]`);
  const shouldOpen = Boolean(targetMenu?.hidden);
  closeLiveWalletMenus();
  if (!targetMenu || !shouldOpen) return;
  targetMenu.hidden = false;
  menuButton.setAttribute("aria-expanded", "true");
  menuButton.closest(".wallet-holding-row")?.classList.add("menu-open");
}

function liveCryptoSelectValue(symbol) {
  const value = String(symbol || selectedLiveWalletSymbol || "BTC").toUpperCase();
  const cryptoSymbols = new Set([
    "AU", "BTC", "ETH", "USDT", "USDC", "BNB", "SOL", "XRP", "DOGE", "LTC", "BCH", "XLM", "TRX",
    "AVAX", "LINK", "POL", "UNI", "AAVE", "ARB", "OP", "SHIB", "FET", "RENDER", "PEPE", "DAI",
    "PYUSD", "FDUSD", "TUSD", "MKR", "LDO", "QNT", "GRT", "CRV", "MANA"
  ]);
  return cryptoSymbols.has(value) ? value : "BTC";
}

function setLiveTransferTab(mode = "receive") {
  const normalized = mode === "send" ? "send" : "receive";
  document.querySelectorAll("[data-live-transfer-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.liveTransferTab === normalized);
  });
  document.querySelectorAll("[data-live-transfer-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.liveTransferPanel !== normalized;
  });
  document.getElementById("live-crypto")?.setAttribute("data-transfer-mode", normalized);
  setLiveWalletText("live-transfer-eyebrow", normalized === "send" ? "Crypto withdrawal" : "Crypto deposit");
  setLiveWalletText("live-transfer-title", normalized === "send" ? "Send crypto" : "Receive crypto");
  setLiveWalletText(
    "live-transfer-intro",
    normalized === "send"
      ? "Submit an internal transfer or external wallet withdrawal request."
      : "If this address is not accepted by your sending platform, generate a new address and try again."
  );
  if (normalized === "send" && typeof updateWithdrawalTypeFields === "function") updateWithdrawalTypeFields();
}

function openLiveTransferModal(mode = "receive", symbol = selectedLiveWalletSymbol) {
  const modal = document.getElementById("live-crypto");
  if (!modal) return;
  const assetSymbol = liveCryptoSelectValue(symbol);
  const receiveSelect = document.getElementById("receive-asset");
  const sendSelect = document.getElementById("send-asset");
  if (receiveSelect) {
    receiveSelect.value = assetSymbol;
    if (typeof updateReceiveNetworks === "function") updateReceiveNetworks();
  }
  if (sendSelect) {
    sendSelect.value = assetSymbol;
    if (typeof updateSendNetworks === "function") updateSendNetworks();
  }
  setLiveTransferTab(mode);
  modal.hidden = false;
  document.body.classList.add("modal-open");
  if (mode !== "send" && typeof window.ensureLiveReceiveAddress === "function") {
    window.ensureLiveReceiveAddress();
  }
}

function closeLiveTransferModal() {
  document.getElementById("live-crypto")?.setAttribute("hidden", "");
  document.body.classList.remove("modal-open");
}

document.addEventListener("click", (event) => {
  const fundingButton = event.target.closest("[data-live-wallet-funding]");
  if (fundingButton) {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (typeof window.openAutodyLiveFundingModal === "function") {
      window.openAutodyLiveFundingModal("card");
    } else {
      window.location.href = "account-wallet#live-funding";
    }
    return;
  }

  const transferButton = event.target.closest("[data-live-wallet-transfer]");
  if (transferButton) {
    event.preventDefault();
    event.stopImmediatePropagation();
    openLiveTransferModal(transferButton.dataset.liveWalletTransfer);
    return;
  }

  const cryptoFocus = event.target.closest('[data-live-focus="crypto"]');
  if (cryptoFocus) {
    event.preventDefault();
    event.stopImmediatePropagation();
    openLiveTransferModal("receive");
    return;
  }

  const transferTab = event.target.closest("[data-live-transfer-tab]");
  if (transferTab) {
    event.preventDefault();
    setLiveTransferTab(transferTab.dataset.liveTransferTab);
    if (transferTab.dataset.liveTransferTab !== "send" && typeof window.ensureLiveReceiveAddress === "function") {
      window.ensureLiveReceiveAddress();
    }
    return;
  }

  if (event.target.closest("[data-live-transfer-close]")) {
    event.preventDefault();
    closeLiveTransferModal();
    return;
  }

  const menuButton = event.target.closest("[data-live-wallet-menu-symbol]");
  if (menuButton) {
    event.preventDefault();
    event.stopPropagation();
    openLiveWalletMenu(menuButton.dataset.liveWalletMenuSymbol, menuButton);
    return;
  }

  const watchButton = event.target.closest("[data-live-wallet-watch-symbol]");
  if (watchButton) {
    event.preventDefault();
    event.stopPropagation();
    const symbol = watchButton.dataset.liveWalletWatchSymbol;
    watchButton.disabled = true;
    closeLiveWalletMenus();
    postLiveWalletJson("/api/account/watchlist", { symbol })
      .then((data) => {
        showLiveWalletToast(
          data.alreadySaved ? `${symbol} is already in your watchlist.` : `${symbol} added to your watchlist.`,
          data.alreadySaved ? "flat" : "gain"
        );
      })
      .catch((err) => showLiveWalletToast(err.message || "Watchlist could not be updated.", "loss"))
      .finally(() => {
        watchButton.disabled = false;
      });
    return;
  }

  if (event.target.closest(".asset-row-menu")) return;

  const row = event.target.closest("[data-live-wallet-symbol]");
  if (row) {
    const nextSymbol = row.dataset.liveWalletSymbol;
    const group = liveGroupBySymbol(nextSymbol);
    if (group?.defaults?.length) {
      expandedLiveWalletGroupKey = expandedLiveWalletGroupKey === group.key ? null : group.key;
      selectedLiveWalletSymbol = nextSymbol;
    } else {
      selectedLiveWalletSymbol = nextSymbol;
      const key = liveGroupKeyForSymbol(nextSymbol);
      if (key && !["usd", "au"].includes(key)) expandedLiveWalletGroupKey = key;
    }
    closeLiveWalletMenus();
    history.replaceState(null, "", `account-wallet?asset=${encodeURIComponent(selectedLiveWalletSymbol)}`);
    renderLiveWallet();
    return;
  }

  closeLiveWalletMenus();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeLiveTransferModal();
    closeLiveWalletMenus();
    return;
  }

  if (!["Enter", " "].includes(event.key)) return;
  if (event.target.closest("button, a")) return;
  const row = event.target.closest("[data-live-wallet-symbol]");
  if (!row) return;
  event.preventDefault();
  row.click();
});

loadLiveWallet();
if (location.hash === "#live-crypto") {
  const initialTransferMode = new URLSearchParams(location.search).get("transfer") === "send" ? "send" : "receive";
  openLiveTransferModal(initialTransferMode, selectedLiveWalletSymbol);
}
setInterval(refreshLiveWalletWhenVisible, LIVE_WALLET_REFRESH_MS);
window.addEventListener("focus", refreshLiveWalletWhenVisible);
document.addEventListener("visibilitychange", refreshLiveWalletWhenVisible);
