const overviewMoney = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2
});

const overviewWholeMoney = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0
});

const OVERVIEW_REFRESH_MS = 10000;
const OVERVIEW_GROUP_SYMBOLS = new Set(["USD", "CRYPTO", "STOCKS", "ETFS", "OILMETALS"]);
const OVERVIEW_PAGE_NAME = location.pathname.split("/").pop() || "demo-account.html";
const IS_LIVE_OVERVIEW_PAGE = OVERVIEW_PAGE_NAME === "account.html";
const OVERVIEW_WALLET_API = IS_LIVE_OVERVIEW_PAGE ? "/api/account/wallet" : "/api/demo/wallet";
const OVERVIEW_ORDERS_API = IS_LIVE_OVERVIEW_PAGE ? "/api/account/orders" : "/api/demo/orders";
const OVERVIEW_WATCHLIST_API = IS_LIVE_OVERVIEW_PAGE ? "/api/account/watchlist" : "/api/demo/watchlist";
const OVERVIEW_ASSET_PAGE = IS_LIVE_OVERVIEW_PAGE ? "account-asset.html" : "demo-asset.html";

function escapeOverviewHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatOverviewMoney(value, whole = false) {
  const number = Number(value);
  if (!Number.isFinite(number)) return whole ? "$0" : "$0.00";
  return whole ? overviewWholeMoney.format(number) : overviewMoney.format(number);
}

function formatOverviewNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0";
  return number.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

function formatOverviewMove(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "+0.00%";
  const sign = number > 0 ? "+" : "";
  return `${sign}${number.toFixed(2)}%`;
}

function overviewMoveClass(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number === 0) return "flat";
  return number > 0 ? "gain" : "loss";
}

function setOverviewText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = value;
}

async function getOverviewJson(url) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: window.AutodyAuth?.headers?.() || {}
  });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

function flattenWatchlist(watchlist = {}) {
  return [
    ...(watchlist.crypto || []),
    ...(watchlist.stocks || [])
  ].filter(Boolean);
}

function overviewLogoFallback(holding = {}) {
  return String(holding.symbol || "?")
    .replace(/=F$/i, "")
    .replace(/[^a-z0-9]/gi, "")
    .slice(0, 4)
    .toUpperCase() || "?";
}

function overviewLogoMarkup(holding = {}) {
  const fallback = overviewLogoFallback(holding);
  const src = holding.logoUrl || "";
  const img = src
    ? `<img src="${escapeOverviewHtml(src)}" alt="" loading="lazy" onerror="this.parentElement.classList.add('logo-fallback'); this.remove();">`
    : "";
  return `
    <span class="asset-token asset-logo asset-logo-small ${src ? "has-image" : "logo-fallback"} ${holding.symbol === "AU" ? "autody-logo" : ""}" data-symbol="${escapeOverviewHtml(fallback)}">
      ${img}
      <b>${escapeOverviewHtml(fallback)}</b>
    </span>
  `;
}

function portfolioChart(wallet, orders = []) {
  const target = document.getElementById("overview-chart");
  if (!target) return;
  const fallbackStarting = IS_LIVE_OVERVIEW_PAGE ? 0 : 50000;
  const starting = Number(wallet.startingBalance ?? fallbackStarting);
  const total = Number(wallet.totalValue ?? starting);
  const liveMovePct = Number(wallet.profitLossPct);
  const movePct = IS_LIVE_OVERVIEW_PAGE && Number.isFinite(liveMovePct)
    ? liveMovePct
    : starting > 0 ? ((total - starting) / starting) * 100 : 0;
  const orderCount = orders.length;
  const bars = Array.from({ length: 12 }, (_, index) => {
    const progress = index / 11;
    const wave = orderCount ? Math.sin((index + 1) * 0.85) * 4 : 0;
    const height = Math.max(18, Math.min(88, 52 + (movePct * progress * 2.4) + wave));
    return `<span style="height:${height.toFixed(1)}%"></span>`;
  }).join("");
  target.classList.toggle("flat-chart", !orderCount && Math.abs(movePct) < 0.01);
  target.innerHTML = bars;
}

function renderOverviewActivity(orders = []) {
  const target = document.getElementById("overview-activity-list");
  if (!target) return;
  const rows = orders.slice(0, 5).map((order) => {
    const side = String(order.side || "order").toUpperCase();
    const symbol = String(order.symbol || "-").toUpperCase();
    const notional = order.notional_usd ?? order.notionalUsd ?? 0;
    return `
      <a class="asset-table-row order-row-link" href="${OVERVIEW_ASSET_PAGE}?symbol=${encodeURIComponent(symbol)}">
        <span>${escapeOverviewHtml(side)}</span>
        <span>${escapeOverviewHtml(symbol)}</span>
        <span>${escapeOverviewHtml(formatOverviewMoney(notional))}</span>
        <span>${escapeOverviewHtml(order.status || "filled")}</span>
      </a>
    `;
  }).join("");

  target.innerHTML = rows || `
    <div class="asset-table-row">
      <span>${IS_LIVE_OVERVIEW_PAGE ? "No live orders" : "No orders yet"}</span>
      <span>-</span>
      <span>$0.00</span>
      <span>${IS_LIVE_OVERVIEW_PAGE ? "Awaiting funding" : "Ready"}</span>
    </div>
  `;
}

function renderOverviewHoldings(wallet = {}) {
  const target = document.getElementById("overview-holdings-list");
  if (!target) return;
  const holdings = (wallet.holdings || [])
    .filter((holding) => !OVERVIEW_GROUP_SYMBOLS.has(String(holding.symbol || "").toUpperCase()))
    .filter((holding) => Number(holding.balance || 0) > 0 || Number(holding.valueUsd || 0) > 0)
    .sort((a, b) => Number(b.valueUsd || 0) - Number(a.valueUsd || 0))
    .slice(0, 6);

  target.innerHTML = holdings.length
    ? holdings.map((holding) => `
      <a href="${escapeOverviewHtml(holding.url || `${OVERVIEW_ASSET_PAGE}?symbol=${encodeURIComponent(holding.symbol)}`)}">
        ${overviewLogoMarkup(holding)}
        <span><b>${escapeOverviewHtml(holding.symbol)}</b><em>${escapeOverviewHtml(holding.name || holding.symbol)}</em></span>
        <strong>${escapeOverviewHtml(formatOverviewMoney(holding.valueUsd))}</strong>
        <small>${escapeOverviewHtml(formatOverviewNumber(holding.balance))}</small>
      </a>
    `).join("")
    : `<article class="wallet-empty-state">${IS_LIVE_OVERVIEW_PAGE ? "No live positions yet. Fund the account or receive crypto first." : "No positions yet. Start from Markets or Orders."}</article>`;
}

function renderOverview({ wallet, orders, watchlist }) {
  const fallbackStarting = IS_LIVE_OVERVIEW_PAGE ? 0 : 50000;
  const starting = Number(wallet.startingBalance ?? fallbackStarting);
  const totalValue = Number(wallet.totalValue ?? starting);
  const liveProfitLoss = Number(wallet.profitLoss);
  const liveProfitLossPct = Number(wallet.profitLossPct);
  const profitLoss = IS_LIVE_OVERVIEW_PAGE && Number.isFinite(liveProfitLoss) ? liveProfitLoss : totalValue - starting;
  const profitLossPct = IS_LIVE_OVERVIEW_PAGE && Number.isFinite(liveProfitLossPct)
    ? liveProfitLossPct
    : starting > 0 ? (profitLoss / starting) * 100 : 0;
  const tone = overviewMoveClass(profitLoss);
  const watchCount = flattenWatchlist(watchlist).length;
  const orderCount = orders.length;
  const cashBalance = Number(wallet.cashBalance ?? 0);
  const positionCount = Number(wallet.positionsCount || 0);

  setOverviewText("overview-sidebar-balance", `${formatOverviewMoney(cashBalance, true)} USD`);
  setOverviewText("overview-top-balance", `${formatOverviewMoney(cashBalance, true)} USD`);
  setOverviewText("overview-portfolio-value", formatOverviewMoney(totalValue));
  setOverviewText("overview-buying-power", formatOverviewMoney(cashBalance, true));
  setOverviewText("overview-position-count", String(positionCount));
  setOverviewText("overview-position-label", positionCount ? "Assets currently held" : IS_LIVE_OVERVIEW_PAGE ? "No live assets held yet" : "Choose assets in Markets");
  setOverviewText("overview-watchlist-count", String(watchCount));
  setOverviewText("overview-profit-loss", formatOverviewMoney(profitLoss));
  setOverviewText("overview-return-label", `${formatOverviewMove(profitLossPct)} total return`);
  setOverviewText("overview-status-pill", orderCount ? (IS_LIVE_OVERVIEW_PAGE ? "Active live" : "Active demo") : (IS_LIVE_OVERVIEW_PAGE ? "Awaiting funding" : "Ready"));

  const profitNode = document.getElementById("overview-profit-loss");
  if (profitNode) profitNode.className = tone;
  const moveLine = document.getElementById("overview-move-line");
  if (moveLine) {
    const arrow = profitLoss > 0 ? "&uarr;" : profitLoss < 0 ? "&darr;" : "&rarr;";
    const activityText = orderCount
      ? `${orderCount} filled ${IS_LIVE_OVERVIEW_PAGE ? "live" : "demo"} order${orderCount === 1 ? "" : "s"}`
      : IS_LIVE_OVERVIEW_PAGE ? "no verified live deposits yet" : "no trades placed yet";
    moveLine.innerHTML = `<span class="${tone}">${arrow} ${escapeOverviewHtml(formatOverviewMove(profitLossPct))}</span> ${activityText}`;
  }

  portfolioChart(wallet, orders);
  renderOverviewActivity(orders);
  renderOverviewHoldings(wallet);
}

async function loadOverview(options = {}) {
  try {
    const [walletData, ordersData, watchlistData] = await Promise.all([
      getOverviewJson(OVERVIEW_WALLET_API),
      getOverviewJson(OVERVIEW_ORDERS_API),
      getOverviewJson(OVERVIEW_WATCHLIST_API).catch(() => ({ watchlist: {} }))
    ]);
    if (!walletData.success) throw new Error(walletData.error || `${IS_LIVE_OVERVIEW_PAGE ? "Live" : "Demo"} wallet failed`);
    renderOverview({
      wallet: walletData.wallet,
      orders: ordersData.orders || [],
      watchlist: watchlistData.watchlist || {}
    });
  } catch (err) {
    console.warn(`${IS_LIVE_OVERVIEW_PAGE ? "Live" : "Demo"} overview failed:`, err);
    if (!options.silent) {
      setOverviewText("overview-status-pill", "Warming up");
    }
  }
}

function refreshOverviewWhenVisible() {
  if (document.hidden) return;
  loadOverview({ silent: true });
}

loadOverview();
setInterval(refreshOverviewWhenVisible, OVERVIEW_REFRESH_MS);
window.addEventListener("focus", refreshOverviewWhenVisible);
document.addEventListener("visibilitychange", refreshOverviewWhenVisible);
