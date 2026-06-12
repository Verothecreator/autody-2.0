let currentSymbol = new URLSearchParams(location.search).get("symbol") || "BTC";
let currentRange = "1d";
let currentAsset = null;

function priceDigits(number, compact = false) {
  if (compact) return 2;
  if (Math.abs(number) < 0.01) return 8;
  if (Math.abs(number) < 1) return 4;
  return 2;
}

function formatPrice(value, currency = "USD") {
  const number = Number(value);
  if (!Number.isFinite(number)) return "Waiting";
  const compact = Math.abs(number) >= 100000;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: priceDigits(number, compact)
  }).format(number);
}

function formatNumber(value, compact = true) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "Unavailable";
  return new Intl.NumberFormat("en-US", {
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: compact ? 2 : 4
  }).format(number);
}

function formatMove(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "Live feed";
  const sign = number > 0 ? "+" : "";
  return `${sign}${number.toFixed(2)}%`;
}

function moveClass(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number === 0) return "flat";
  return number > 0 ? "gain" : "loss";
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function getJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

function chartPoints(asset, points) {
  if (points?.length) return points;
  const price = Number(asset.price || 1);
  const move = Number(asset.changePct || 0) / 100;
  return Array.from({ length: 30 }, (_, index) => {
    const progress = index / 29;
    const wave = Math.sin(index * 0.74) * price * 0.012;
    const slope = price * move * (progress - 0.5);
    return { close: Math.max(0, price + wave + slope), time: new Date(Date.now() - (29 - index) * 3600000).toISOString() };
  });
}

function renderLineChart(asset, chart) {
  const target = document.getElementById("asset-line-chart");
  const points = chartPoints(asset, chart.points);
  const values = points.map((point) => point.close);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const width = 900;
  const height = 320;
  const padding = 20;
  const path = points.map((point, index) => {
    const x = padding + (index / Math.max(1, points.length - 1)) * (width - padding * 2);
    const y = height - padding - ((point.close - min) / range) * (height - padding * 2);
    return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(" ");
  const fillPath = `${path} L ${width - padding} ${height - padding} L ${padding} ${height - padding} Z`;
  const cls = moveClass(asset.changePct);

  target.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(asset.symbol)} price movement">
      <defs>
        <linearGradient id="assetChartFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="${cls === "loss" ? "#ff5c7a" : "#32d583"}" stop-opacity="0.22" />
          <stop offset="100%" stop-color="${cls === "loss" ? "#ff5c7a" : "#32d583"}" stop-opacity="0" />
        </linearGradient>
      </defs>
      <path d="${fillPath}" fill="url(#assetChartFill)"></path>
      <path d="${path}" fill="none" stroke="${cls === "loss" ? "#ff5c7a" : "#32d583"}" stroke-width="4" stroke-linecap="round"></path>
    </svg>
  `;
}

function detailRow(label, value) {
  return `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function renderDetails(asset, chart) {
  const points = chartPoints(asset, chart.points);
  const values = points.map((point) => point.close);
  const rangeHigh = Math.max(...values);
  const rangeLow = Math.min(...values);
  const stats = chart.stats || {};
  const networks = asset.depositNetworks || [];

  const rows = [
    detailRow(asset.assetType === "crypto" ? "Network" : "Market", asset.assetType === "crypto" ? (networks[0] || "Multiple networks") : (asset.market || "Global")),
    detailRow("Quote currency", chart.currency || asset.currency || "USD"),
    detailRow("Region", asset.region || "Global"),
    detailRow("Market cap", asset.marketCap ? formatPrice(asset.marketCap, "USD") : "Unavailable"),
    detailRow("Volume", stats.volume ? formatNumber(stats.volume) : "Unavailable"),
    detailRow("Range high", formatPrice(stats.dayHigh || rangeHigh, chart.currency || asset.currency || "USD")),
    detailRow("Range low", formatPrice(stats.dayLow || rangeLow, chart.currency || asset.currency || "USD")),
    detailRow("Data source", asset.dataProvider || "Live market feed")
  ];

  if (networks.length > 1) {
    rows.splice(1, 0, detailRow("Deposit networks", networks.slice(0, 4).join(", ")));
  }

  document.getElementById("asset-detail-heading").textContent = asset.assetType === "crypto" ? "Token details" : "Market details";
  document.getElementById("asset-detail-list").innerHTML = rows.join("");
}

function renderActions(asset) {
  const cryptoActions = [
    ["Buy", "demo-orders.html"],
    ["Swap", "demo-orders.html"],
    ["Send", "demo-wallet.html"],
    ["Receive", "demo-wallet.html"]
  ];
  const marketActions = [
    ["Buy", "demo-orders.html"],
    ["Sell", "demo-orders.html"],
    ["Watch", "demo-research.html"],
    ["Research", "demo-research.html"]
  ];
  const actions = asset.assetType === "crypto" ? cryptoActions : marketActions;
  document.getElementById("asset-action-grid").innerHTML = actions.map(([label, href]) => `<a href="${href}">${label}</a>`).join("");
}

function renderActivity(orders) {
  const target = document.getElementById("asset-activity-list");
  if (!orders?.length) {
    target.innerHTML = `
      <div class="asset-empty-activity">
        <strong>No demo activity yet.</strong>
        <span>When practice orders are connected, this area will show buys, sells, swaps, and fills for this asset.</span>
      </div>
    `;
    return;
  }

  target.innerHTML = orders.map((order) => `
    <div>
      <span>${escapeHtml(order.side || "Order")}</span>
      <strong>${escapeHtml(order.symbol)} ${escapeHtml(order.status || "Open")}</strong>
      <small>${formatPrice(order.notional_usd || order.notionalUsd || 0)}</small>
    </div>
  `).join("");
}

function renderAsset(data) {
  const asset = data.asset;
  const chart = data.chart || {};
  currentAsset = asset;
  document.title = `Autody Demo Account | ${asset.symbol}`;
  document.getElementById("asset-type-label").textContent = `${asset.assetType} ${asset.market || ""}`.trim();
  document.getElementById("asset-symbol").textContent = asset.symbol;
  document.getElementById("asset-name").textContent = asset.name;
  document.getElementById("asset-price").textContent = formatPrice(asset.price, asset.currency || chart.currency || "USD");
  const change = document.getElementById("asset-change");
  change.textContent = formatMove(asset.changePct);
  change.className = moveClass(asset.changePct);
  document.getElementById("asset-chart-title").textContent = `${asset.name} movement`;
  document.getElementById("asset-sidebar-balance").textContent = `${formatPrice(data.demo?.buyingPower || 50000, "USD")} paper USD`;
  document.getElementById("asset-buying-power").textContent = `Buying power ${formatPrice(data.demo?.buyingPower || 50000, "USD")}`;
  document.getElementById("asset-owned").textContent = data.demo?.holding
    ? `${formatNumber(data.demo.holding.balance, false)} ${asset.symbol}`
    : `0 ${asset.symbol}`;
  document.getElementById("asset-owned-value").textContent = formatPrice(data.demo?.holding?.valueUsd || 0, "USD");

  renderLineChart(asset, chart);
  renderDetails(asset, chart);
  renderActions(asset);
  renderActivity(data.demo?.orders || []);
  renderChartStats(asset, chart);
}

function renderChartStats(asset, chart) {
  const stats = chart.stats || {};
  document.getElementById("asset-chart-stats").innerHTML = [
    detailRow("Range", chart.range?.toUpperCase?.() || currentRange.toUpperCase()),
    detailRow("Previous close", stats.previousClose ? formatPrice(stats.previousClose, chart.currency || asset.currency || "USD") : "Unavailable"),
    detailRow("Provider symbol", chart.providerSymbol || asset.providerSymbol || asset.symbol)
  ].join("");
}

async function loadAsset() {
  try {
    const data = await getJson(`/api/markets/asset/${encodeURIComponent(currentSymbol)}?range=${encodeURIComponent(currentRange)}`);
    if (!data.success) throw new Error(data.error || "Asset detail failed");
    renderAsset(data);
  } catch (err) {
    console.warn("Asset detail failed:", err);
    document.getElementById("asset-name").textContent = "This asset could not be loaded.";
    document.getElementById("asset-line-chart").innerHTML = `<div class="asset-empty-activity">Market details are not available right now.</div>`;
  }
}

document.addEventListener("click", (event) => {
  const range = event.target.closest("[data-chart-range]");
  if (!range) return;
  currentRange = range.dataset.chartRange;
  document.querySelectorAll("[data-chart-range]").forEach((button) => button.classList.toggle("active", button === range));
  if (currentAsset) loadAsset();
});

loadAsset();
