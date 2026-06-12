const marketMoney = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2
});

const compactMarketMoney = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 2
});

function marketPrice(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "Waiting";
  return number >= 100000 ? compactMarketMoney.format(number) : marketMoney.format(number);
}

function marketMove(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "First refresh";
  const arrow = number > 0 ? "\u2191" : number < 0 ? "\u2193" : "\u2192";
  const sign = number > 0 ? "+" : "";
  return `${arrow} ${sign}${number.toFixed(2)}%`;
}

function marketMoveClass(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number === 0) return "";
  return number > 0 ? "gain" : "loss";
}

function escapeMarketHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function fetchCatalog(type) {
  const response = await fetch(`/api/markets/catalog?type=${type}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Catalog ${type} returned ${response.status}`);
  return response.json();
}

function renderCatalog(targetId, assets) {
  const target = document.getElementById(targetId);
  if (!target) return;

  target.innerHTML = assets.map((asset) => `
    <div class="market-choice" data-symbol="${escapeMarketHtml(asset.symbol)}" data-name="${escapeMarketHtml(asset.name)}">
      <span>${escapeMarketHtml(asset.symbol)}</span>
      <strong>${marketPrice(asset.price)}</strong>
      <small class="${marketMoveClass(asset.changePct)}">${marketMove(asset.changePct)}</small>
    </div>
  `).join("");
}

function selectAsset(symbol, name) {
  const input = document.getElementById("ticket-asset");
  if (input) input.value = `${symbol} / ${name}`;
}

async function loadDemoMarkets() {
  try {
    const [crypto, stocks] = await Promise.all([
      fetchCatalog("crypto"),
      fetchCatalog("stocks")
    ]);

    renderCatalog("demo-crypto-list", crypto.assets || []);
    renderCatalog("demo-stock-list", stocks.assets || []);
  } catch (err) {
    console.warn("Demo market catalog failed:", err);
  }
}

document.addEventListener("click", (event) => {
  const choice = event.target.closest(".market-choice");
  if (!choice) return;
  selectAsset(choice.dataset.symbol, choice.dataset.name);
});

loadDemoMarkets();
setInterval(loadDemoMarkets, 60000);
