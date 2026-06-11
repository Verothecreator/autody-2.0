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

function formatMoney(value, whole = false) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return whole ? "$0" : "$0.00";
  return whole ? wholeMoneyFormat.format(amount) : moneyFormat.format(amount);
}

function formatBalance(asset) {
  const amount = Number(asset.balance);
  if (!Number.isFinite(amount)) return "0";
  if (asset.symbol === "USD") return formatMoney(amount);
  if (asset.symbol === "CRYPTO" || asset.symbol === "STOCKS") {
    return `${amount} positions`;
  }
  return `${amount.toLocaleString("en-US", { maximumFractionDigits: 6 })} ${asset.symbol}`;
}

function dotClass(asset) {
  const symbol = String(asset.symbol || "").toLowerCase();
  if (symbol === "usd") return "cash";
  if (symbol === "au") return "au";
  if (asset.category === "crypto") return "btc";
  if (asset.category === "stocks") return "stk";
  return "gold";
}

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = value;
}

function renderHoldings(holdings) {
  const table = document.getElementById("wallet-holdings");
  if (!table || !Array.isArray(holdings)) return;

  const rows = holdings.map((asset) => `
    <div class="asset-table-row">
      <span><i class="asset-dot ${dotClass(asset)}"></i> ${asset.name}</span>
      <span>${formatBalance(asset)}</span>
      <span>${formatMoney(asset.valueUsd)}</span>
      <span>${asset.status}</span>
    </div>
  `).join("");

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

async function loadWallet() {
  try {
    const response = await fetch("/api/demo/wallet", { cache: "no-store" });
    if (!response.ok) throw new Error(`/api/demo/wallet returned ${response.status}`);
    const data = await response.json();
    if (!data.success) throw new Error(data.error || "Demo wallet failed");

    const wallet = data.wallet;
    const au = wallet.holdings.find((asset) => asset.symbol === "AU");

    setText("sidebar-balance", `${wholeMoneyFormat.format(wallet.startingBalance)} paper USD`);
    setText("topbar-balance", `${wholeMoneyFormat.format(wallet.cashBalance)} USD`);
    setText("wallet-cash", formatMoney(wallet.cashBalance, true));
    setText("wallet-au", `${Number(au?.balance || 0).toLocaleString("en-US")} AU`);
    setText("wallet-reserved", formatMoney(wallet.reservedCash));
    renderHoldings(wallet.holdings);
  } catch (err) {
    console.warn("Demo wallet data failed:", err);
  }
}

loadWallet();
