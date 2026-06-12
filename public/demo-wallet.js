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
let selectedSymbol = new URLSearchParams(location.search).get("asset") || "USD";

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
      ["Swap", "demo-orders.html"]
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
    ["Trade", "demo-orders.html"]
  ];
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
  renderDetail(selected);
  renderRecords(wallet.records || []);
}

async function loadWallet(options = {}) {
  try {
    const response = await fetch("/api/demo/wallet", { cache: "no-store" });
    if (!response.ok) throw new Error(`/api/demo/wallet returned ${response.status}`);
    const data = await response.json();
    if (!data.success) throw new Error(data.error || "Demo wallet failed");

    walletState = data.wallet;
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
  const row = event.target.closest("[data-wallet-symbol]");
  if (!row || !walletState) return;
  selectedSymbol = row.dataset.walletSymbol;
  history.replaceState(null, "", `demo-wallet.html?asset=${encodeURIComponent(selectedSymbol)}`);
  renderWallet(walletState);
});

loadWallet();
setInterval(refreshWalletWhenVisible, WALLET_REFRESH_MS);
window.addEventListener("focus", refreshWalletWhenVisible);
document.addEventListener("visibilitychange", refreshWalletWhenVisible);
