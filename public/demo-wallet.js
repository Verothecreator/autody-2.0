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

const WALLET_REFRESH_MS = 30000;

let walletState = null;
let walletCatalog = [];
let selectedSymbol = new URLSearchParams(location.search).get("asset") || "USD";
let activeWalletCategory = new URLSearchParams(location.search).get("category") || "crypto";

const WALLET_CATEGORY_GROUPS = [
  { key: "usd", label: "USD", symbols: ["USD"] },
  { key: "au", label: "Autody AU", symbols: ["AU"] },
  { key: "crypto", label: "Crypto", symbols: ["BTC", "USDT", "USDC", "ETH", "BNB", "BCH", "DOGE"] },
  { key: "stocks", label: "Stocks", symbols: ["AAPL", "NVDA", "TSLA", "MSFT", "AMZN"] },
  { key: "etf", label: "ETFs", symbols: ["SPY", "QQQ", "VOO", "GLD", "VT"] },
  { key: "commodity", label: "Oil and metals", symbols: ["GC=F", "SI=F", "CL=F", "BZ=F", "NG=F"] }
];

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

function formatBalance(asset) {
  const amount = Number(asset.balance);
  if (!Number.isFinite(amount)) return "0";
  if (asset.symbol === "USD") return formatMoney(amount);
  if (asset.symbol === "CRYPTO" || asset.symbol === "STOCKS") {
    return `${amount} positions`;
  }
  return `${formatNumber(amount)} ${asset.symbol}`;
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

function dotClass(asset) {
  const symbol = String(asset.symbol || "").toLowerCase();
  if (symbol === "usd") return "cash";
  if (symbol === "au") return "au";
  if (symbol === "crypto" || asset.category === "crypto") return "btc";
  if (symbol === "stocks" || ["stock", "stocks", "etf", "commodity"].includes(asset.category)) return "stk";
  return "gold";
}

function categoryLabel(asset) {
  if (asset.symbol === "USD") return "Cash balance";
  if (asset.symbol === "AU") return "Autody balance";
  if (asset.symbol === "CRYPTO") return "Crypto bucket";
  if (asset.symbol === "STOCKS") return "Stocks bucket";
  return asset.category ? `${asset.category.toUpperCase()} position` : "Position";
}

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = value;
}

function detailRow(label, value, tone = "") {
  return `
    <div>
      <span>${escapeHtml(label)}</span>
      <strong class="${escapeHtml(tone)}">${escapeHtml(value)}</strong>
    </div>
  `;
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
  if (asset.assetType === "crypto" || asset.category === "crypto") return `https://assets.coincap.io/assets/icons/${encodeURIComponent(logoFallbackText(asset).toLowerCase())}@2x.png`;
  return "";
}

function walletLogoMarkup(asset, extraClass = "") {
  const fallback = logoFallbackText(asset);
  const src = walletLogoSrc(asset);
  const autodyClass = asset.symbol === "AU" || asset.customAsset ? "autody-logo" : "";
  const img = src
    ? `<img src="${escapeHtml(src)}" alt="" loading="lazy" onerror="this.parentElement.classList.add('logo-fallback'); this.remove();">`
    : "";
  return `
    <span class="asset-token asset-logo ${src ? "has-image" : "logo-fallback"} ${autodyClass} ${escapeHtml(extraClass)}" data-symbol="${escapeHtml(fallback)}">
      ${img}
      <b>${escapeHtml(fallback)}</b>
    </span>
  `;
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
      ["Open AU", "demo-asset.html?symbol=AU"],
      ["Swap", "demo-orders.html?side=swap&symbol=AU"]
    ];
  }
  if (asset.symbol === "CRYPTO") {
    return [
      ["Browse crypto", "demo-markets.html?filter=crypto"],
      ["Orders", "demo-orders.html"]
    ];
  }
  if (asset.symbol === "STOCKS") {
    return [
      ["Browse stocks", "demo-markets.html?filter=stocks"],
      ["Orders", "demo-orders.html"]
    ];
  }
  return [
    ["Open market", asset.url || `demo-asset.html?symbol=${encodeURIComponent(asset.symbol)}`],
    ["Trade", `demo-orders.html?side=buy&symbol=${encodeURIComponent(asset.symbol)}`]
  ];
}

function catalogAsset(symbol) {
  const lookup = String(symbol || "").toUpperCase();
  return walletCatalog.find((asset) => String(asset.symbol).toUpperCase() === lookup);
}

function walletHolding(symbol) {
  const lookup = String(symbol || "").toUpperCase();
  return (walletState?.holdings || []).find((asset) => String(asset.symbol).toUpperCase() === lookup);
}

function categoryForHolding(holding) {
  const category = String(holding.category || holding.assetType || "").toLowerCase();
  if (holding.symbol === "USD") return "usd";
  if (holding.symbol === "AU") return "au";
  if (category === "crypto" || category === "currency") return "crypto";
  if (category === "stock" || category === "stocks") return "stocks";
  if (category === "etf") return "etf";
  if (category === "commodity") return "commodity";
  return "crypto";
}

function walletCategoryAssets(group) {
  const heldSymbols = (walletState?.holdings || [])
    .filter((holding) => Number(holding.balance) > 0 && categoryForHolding(holding) === group.key)
    .map((holding) => holding.symbol);
  const symbols = Array.from(new Set([...heldSymbols, ...group.symbols]));

  return symbols.map((symbol) => {
    const holding = walletHolding(symbol);
    const market = catalogAsset(symbol);
    if (symbol === "USD") {
      return walletState?.holdings?.find((asset) => asset.symbol === "USD") || {
        symbol: "USD",
        name: "USD Cash",
        category: "cash",
        balance: walletState?.cashBalance || 0,
        valueUsd: walletState?.cashBalance || 0,
        price: 1,
        changePct: null
      };
    }
    return {
      ...market,
      ...holding,
      symbol,
      name: holding?.name || market?.name || symbol,
      category: holding?.category || market?.assetType || group.key,
      assetType: holding?.assetType || market?.assetType || group.key,
      price: market?.price ?? holding?.price ?? holding?.lastPrice ?? null,
      changePct: market?.changePct ?? holding?.changePct ?? null,
      logoUrl: market?.logoUrl || holding?.logoUrl || null,
      valueUsd: holding?.valueUsd || 0,
      balance: holding?.balance || 0,
      market: market?.market || holding?.market || null,
      currency: market?.currency || "USD",
      url: symbol === "AU" ? "demo-asset.html?symbol=AU" : `demo-asset.html?symbol=${encodeURIComponent(symbol)}`
    };
  });
}

function renderWalletCategories() {
  const tabs = document.getElementById("wallet-category-tabs");
  const panel = document.getElementById("wallet-category-panel");
  if (!tabs || !panel) return;

  const activeGroup = WALLET_CATEGORY_GROUPS.find((group) => group.key === activeWalletCategory) || WALLET_CATEGORY_GROUPS[2];
  activeWalletCategory = activeGroup.key;

  tabs.innerHTML = WALLET_CATEGORY_GROUPS.map((group) => `
    <button class="${group.key === activeWalletCategory ? "active" : ""}" type="button" data-wallet-category="${escapeHtml(group.key)}">${escapeHtml(group.label)}</button>
  `).join("");

  const assets = walletCategoryAssets(activeGroup);
  panel.innerHTML = `
    <div class="wallet-category-heading">
      <span>${escapeHtml(activeGroup.label)}</span>
      <strong>${assets.length} visible</strong>
    </div>
    <div class="wallet-category-assets">
      ${assets.map((asset) => {
        const held = Number(asset.balance) > 0;
        const content = `
          ${walletLogoMarkup(asset, "asset-logo-small")}
          <span>
            <b>${escapeHtml(asset.symbol)}</b>
            <em>${escapeHtml(asset.name || asset.symbol)}</em>
          </span>
          <strong>${held ? escapeHtml(formatMoney(asset.valueUsd)) : escapeHtml(formatPrice(asset.price, asset.currency || "USD"))}</strong>
          <small class="${moveClass(asset.changePct)}">${escapeHtml(held ? `${formatNumber(asset.balance)} held` : formatMove(asset.changePct))}</small>
        `;
        if (asset.symbol === "USD") {
          return `<button type="button" data-wallet-symbol="USD">${content}</button>`;
        }
        return `<a href="${escapeHtml(asset.url || `demo-asset.html?symbol=${encodeURIComponent(asset.symbol)}`)}">${content}</a>`;
      }).join("")}
    </div>
  `;
}

function renderHoldings(holdings) {
  const table = document.getElementById("wallet-holdings");
  if (!table || !Array.isArray(holdings)) return;

  const rows = holdings.map((asset) => {
    const isActive = asset.symbol === selectedSymbol;
    const change = hasNumber(asset.changePct)
      ? `<small class="${moveClass(asset.changePct)}">${formatMove(asset.changePct)}</small>`
      : "";

    return `
      <button class="asset-table-row wallet-holding-row ${isActive ? "active" : ""}" type="button" data-wallet-symbol="${escapeHtml(asset.symbol)}">
        <span><i class="asset-dot ${dotClass(asset)}"></i><b>${escapeHtml(asset.name)}</b>${change}</span>
        <span>${escapeHtml(formatBalance(asset))}</span>
        <span>${escapeHtml(formatMoney(asset.valueUsd))}</span>
        <span>${escapeHtml(asset.status || "Ready")}</span>
      </button>
    `;
  }).join("");

  table.innerHTML = `
    <div class="asset-table-row head">
      <span>Asset</span>
      <span>Balance</span>
      <span>Value</span>
      <span>Status</span>
    </div>
    ${rows}
  `;
}

function renderDetail(asset) {
  if (!asset) return;
  const moveTone = moveClass(asset.changePct);
  const rows = [
    detailRow("Balance", formatBalance(asset)),
    detailRow("Value", formatMoney(asset.valueUsd))
  ];

  if (hasNumber(asset.price) && asset.symbol !== "USD") {
    rows.push(detailRow("Last price", formatMoney(asset.price)));
  }
  if (hasNumber(asset.changePct)) {
    rows.push(detailRow("24h move", formatMove(asset.changePct), moveTone));
  }
  if (hasNumber(asset.averageCost)) {
    rows.push(detailRow("Average cost", formatMoney(asset.averageCost)));
  }
  if (hasNumber(asset.costBasis)) {
    rows.push(detailRow("Cost basis", formatMoney(asset.costBasis)));
  }
  if (hasNumber(asset.unrealizedProfitLoss)) {
    rows.push(detailRow("Unrealized P/L", formatMoney(asset.unrealizedProfitLoss), moveClass(asset.unrealizedProfitLoss)));
  }
  rows.push(detailRow("Status", asset.status || "Ready"));

  setText("wallet-detail-label", categoryLabel(asset));
  setText("wallet-detail-title", asset.name);
  setText("wallet-detail-value", formatMoney(asset.valueUsd));
  setText("wallet-detail-subtitle", asset.detail || asset.market || asset.status || "Wallet balance");
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

function renderWallet(wallet) {
  const holdings = wallet.holdings || [];
  const selected = holdings.find((asset) => asset.symbol === selectedSymbol) || holdings[0];
  selectedSymbol = selected?.symbol || "USD";

  setText("sidebar-balance", `${wholeMoneyFormat.format(wallet.startingBalance)} paper USD`);
  setText("topbar-balance", `${wholeMoneyFormat.format(wallet.cashBalance)} USD`);
  setText("wallet-cash", formatMoney(wallet.cashBalance, true));
  setText("wallet-total", formatMoney(wallet.totalValue, true));
  setText("wallet-positions", String(wallet.positionsCount || 0));
  setText("wallet-reserved", formatMoney(wallet.reservedCash));

  renderHoldings(holdings);
  renderWalletCategories();
  renderDetail(selected);
  renderRecords(wallet.records || []);
}

async function loadWallet(options = {}) {
  try {
    const [data, catalog] = await Promise.all([
      fetch("/api/demo/wallet", { cache: "no-store" }).then((response) => {
        if (!response.ok) throw new Error(`/api/demo/wallet returned ${response.status}`);
        return response.json();
      }),
      walletCatalog.length
        ? Promise.resolve({ assets: walletCatalog })
        : fetch("/api/markets/catalog?type=all", { cache: "no-store" }).then((response) => {
          if (!response.ok) throw new Error(`/api/markets/catalog returned ${response.status}`);
          return response.json();
        }).catch(() => ({ assets: walletCatalog }))
    ]);
    if (!data.success) throw new Error(data.error || "Demo wallet failed");

    walletState = data.wallet;
    walletCatalog = catalog.assets || walletCatalog;
    renderWallet(walletState);
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

document.addEventListener("click", (event) => {
  const category = event.target.closest("[data-wallet-category]");
  if (category && walletState) {
    activeWalletCategory = category.dataset.walletCategory;
    history.replaceState(null, "", `demo-wallet.html?asset=${encodeURIComponent(selectedSymbol)}&category=${encodeURIComponent(activeWalletCategory)}`);
    renderWallet(walletState);
    return;
  }

  const row = event.target.closest("[data-wallet-symbol]");
  if (!row || !walletState) return;
  selectedSymbol = row.dataset.walletSymbol;
  history.replaceState(null, "", `demo-wallet.html?asset=${encodeURIComponent(selectedSymbol)}&category=${encodeURIComponent(activeWalletCategory)}`);
  renderWallet(walletState);
});

loadWallet();
setInterval(refreshWalletWhenVisible, WALLET_REFRESH_MS);
window.addEventListener("focus", refreshWalletWhenVisible);
document.addEventListener("visibilitychange", refreshWalletWhenVisible);
