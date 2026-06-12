let currentSymbol = new URLSearchParams(location.search).get("symbol") || "BTC";
let currentRange = "1d";
let currentAsset = null;
let assetLoading = false;
let assetRequestToken = 0;

const ASSET_REFRESH_MS = 30000;

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
  const options = {
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: priceDigits(number, compact)
  };

  try {
    return new Intl.NumberFormat("en-US", {
      ...options,
      style: "currency",
      currency
    }).format(number);
  } catch (err) {
    return `${currency} ${new Intl.NumberFormat("en-US", options).format(number)}`;
  }
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
  const arrow = number > 0 ? "\u2191" : number < 0 ? "\u2193" : "\u2192";
  const sign = number > 0 ? "+" : "";
  return `${arrow} ${sign}${number.toFixed(2)}%`;
}

function moveClass(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number === 0) return "flat";
  return number > 0 ? "gain" : "loss";
}

function titleLabel(value = "") {
  return String(value)
    .replace(/-/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function assetTypeLabel(asset) {
  const labels = [asset.assetType, asset.market].filter(Boolean);
  const uniqueLabels = labels.filter((label, index) => labels.findIndex((item) => String(item).toLowerCase() === String(label).toLowerCase()) === index);
  return uniqueLabels.map(titleLabel).join(" ");
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function logoFallbackText(asset) {
  const symbol = String(asset.symbol || "?")
    .replace(/=F$/i, "")
    .replace(/[^a-z0-9]/gi, "")
    .slice(0, 4)
    .toUpperCase();
  return symbol || "?";
}

function assetLogoSrc(asset) {
  if (asset.logoUrl) return asset.logoUrl;
  if (asset.customAsset || asset.symbol === "AU") return "Autody-Logo.png";
  if (asset.assetType === "crypto") return `https://assets.coincap.io/assets/icons/${encodeURIComponent(logoFallbackText(asset).toLowerCase())}@2x.png`;
  return "";
}

function assetLogoMarkup(asset, extraClass = "") {
  const fallback = logoFallbackText(asset);
  const src = assetLogoSrc(asset);
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

function formatPointTime(value) {
  if (!value) return currentRange.toUpperCase();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return currentRange.toUpperCase();
  const options = currentRange === "1d"
    ? { hour: "numeric", minute: "2-digit" }
    : { month: "short", day: "numeric", year: currentRange === "all" ? "numeric" : undefined };
  return new Intl.DateTimeFormat("en-US", options).format(date);
}

async function getJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

function chartPoints(asset, points) {
  return (points || [])
    .map((point) => ({ ...point, close: Number(point.close) }))
    .filter((point) => Number.isFinite(point.close));
}

function wireChartHover(target, plottedPoints, currency, width, height) {
  const svg = target.querySelector("svg");
  const capture = target.querySelector(".chart-hover-capture");
  const line = target.querySelector(".chart-hover-line");
  const dot = target.querySelector(".chart-hover-dot");
  const tooltip = target.querySelector(".chart-hover-tooltip");
  const tooltipPrice = target.querySelector(".chart-hover-price");
  const tooltipTime = target.querySelector(".chart-hover-time");
  if (!svg || !capture || !line || !dot || !tooltip || !tooltipPrice || !tooltipTime) return;

  function setActivePoint(point) {
    line.setAttribute("x1", point.x);
    line.setAttribute("x2", point.x);
    dot.setAttribute("cx", point.x);
    dot.setAttribute("cy", point.y);
    tooltipPrice.textContent = formatPrice(point.close, currency);
    tooltipTime.textContent = formatPointTime(point.time || point.date || point.timestamp);

    const tooltipWidth = 178;
    const tooltipHeight = 66;
    const x = Math.min(width - tooltipWidth - 10, Math.max(10, point.x + 14));
    const y = Math.min(height - tooltipHeight - 10, Math.max(10, point.y - tooltipHeight - 12));
    tooltip.setAttribute("x", x);
    tooltip.setAttribute("y", y);
    svg.classList.add("is-hovering");
  }

  function nearestPoint(clientX) {
    const rect = svg.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * width;
    return plottedPoints.reduce((nearest, point) => (
      Math.abs(point.x - x) < Math.abs(nearest.x - x) ? point : nearest
    ), plottedPoints[0]);
  }

  capture.addEventListener("pointermove", (event) => setActivePoint(nearestPoint(event.clientX)));
  capture.addEventListener("pointerenter", (event) => setActivePoint(nearestPoint(event.clientX)));
  capture.addEventListener("pointerleave", () => svg.classList.remove("is-hovering"));
}

function renderLineChart(asset, chart) {
  const target = document.getElementById("asset-line-chart");
  if (asset.customAsset && !chart.points?.length && asset.price == null) {
    target.innerHTML = `
      <div class="asset-empty-activity">
        <strong>Market maker pending.</strong>
        <span>AU will show a live chart after liquidity, pricing, and exchange routing are connected.</span>
      </div>
    `;
    return;
  }

  const points = chartPoints(asset, chart.points);
  if (!points.length) {
    target.innerHTML = `
      <div class="asset-empty-activity">
        <strong>Chart data is warming up.</strong>
        <span>Autody is building ${escapeHtml(currentRange.toUpperCase())} history from the market data cache.</span>
      </div>
    `;
    return;
  }

  const values = points.map((point) => point.close);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const width = 900;
  const height = 320;
  const padding = 20;
  const plottedPoints = points.map((point, index) => {
    const x = padding + (index / Math.max(1, points.length - 1)) * (width - padding * 2);
    const y = height - padding - ((point.close - min) / range) * (height - padding * 2);
    return { ...point, x, y };
  });
  const path = plottedPoints.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");
  const fillPath = `${path} L ${width - padding} ${height - padding} L ${padding} ${height - padding} Z`;
  const cls = moveClass(asset.changePct);
  const currency = chart.currency || asset.currency || "USD";

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
      <g class="chart-hover-layer" aria-hidden="true">
        <line class="chart-hover-line" y1="${padding}" y2="${height - padding}"></line>
        <circle class="chart-hover-dot" r="6"></circle>
        <foreignObject class="chart-hover-tooltip" width="178" height="66">
          <div xmlns="http://www.w3.org/1999/xhtml">
            <strong class="chart-hover-price"></strong>
            <span class="chart-hover-time"></span>
          </div>
        </foreignObject>
        <rect class="chart-hover-capture" x="0" y="0" width="${width}" height="${height}"></rect>
      </g>
    </svg>
  `;
  wireChartHover(target, plottedPoints, currency, width, height);
}

function detailRow(label, value) {
  return `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function renderDetails(asset, chart) {
  const stats = chart.stats || {};
  const networks = asset.depositNetworks || [];
  const currency = chart.currency || asset.currency || "USD";
  const marketCap = asset.marketCap ?? stats.marketCap;
  const fdv = asset.fdv ?? stats.fdv;
  const liquidity = asset.liquidityUsd ?? asset.totalVolume ?? stats.volume;
  const allTimeHigh = asset.ath ?? stats.allTimeHigh;
  const allTimeLow = asset.atl ?? stats.allTimeLow;

  const rows = [];

  if (asset.customAsset) {
    rows.push(detailRow("Market status", asset.status || "Market maker pending"));
    rows.push(detailRow("Backing plan", "Gold-backed AU reserve"));
    rows.push(detailRow("Primary use", "Payments, exchange, goods, and services"));
  } else if (asset.assetType === "crypto") {
    rows.push(detailRow("Network", networks[0] || "Multiple networks"));
  } else {
    rows.push(detailRow("Exchange", asset.market || "Global market"));
  }

  if (networks.length > 1 && !asset.customAsset) {
    rows.splice(1, 0, detailRow("Deposit networks", networks.slice(0, 4).join(", ")));
  }

  rows.push(detailRow("Quote currency", currency));
  if (marketCap) rows.push(detailRow("Market cap", formatPrice(marketCap, "USD")));
  if (asset.assetType === "crypto" && fdv) rows.push(detailRow("FDV", formatPrice(fdv, "USD")));
  if (liquidity) rows.push(detailRow(asset.assetType === "crypto" ? "Liquidity" : "Volume", formatPrice(liquidity, "USD")));
  if (allTimeHigh) rows.push(detailRow("All-time high", formatPrice(allTimeHigh, currency)));
  if (allTimeLow) rows.push(detailRow("All-time low", formatPrice(allTimeLow, currency)));
  if (asset.assetType === "crypto" && asset.circulatingSupply) rows.push(detailRow("Circulating supply", `${formatNumber(asset.circulatingSupply)} ${asset.symbol}`));

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
  document.getElementById("asset-logo-wrap").innerHTML = assetLogoMarkup(asset, "asset-logo-hero");
  document.getElementById("asset-type-label").textContent = assetTypeLabel(asset);
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
  const target = document.getElementById("asset-chart-stats");
  const currency = chart.currency || asset.currency || "USD";
  const rows = [];

  if (Number.isFinite(Number(asset.changePct))) rows.push(detailRow("24h move", formatMove(asset.changePct)));
  if (asset.marketCap ?? stats.marketCap) rows.push(detailRow("Market cap", formatPrice(asset.marketCap ?? stats.marketCap, "USD")));
  if (asset.liquidityUsd ?? asset.totalVolume ?? stats.volume) rows.push(detailRow(asset.assetType === "crypto" ? "Liquidity" : "Volume", formatPrice(asset.liquidityUsd ?? asset.totalVolume ?? stats.volume, "USD")));
  if (stats.rangeHigh) rows.push(detailRow("Chart high", formatPrice(stats.rangeHigh, currency)));
  if (stats.rangeLow) rows.push(detailRow("Chart low", formatPrice(stats.rangeLow, currency)));

  target.innerHTML = rows.join("");
  target.hidden = !rows.length;
}

async function loadAsset(options = {}) {
  if (assetLoading && !options.force) return;
  assetLoading = true;
  const requestToken = ++assetRequestToken;

  try {
    const data = await getJson(`/api/markets/asset/${encodeURIComponent(currentSymbol)}?range=${encodeURIComponent(currentRange)}`);
    if (!data.success) throw new Error(data.error || "Asset detail failed");
    if (requestToken !== assetRequestToken) return;
    renderAsset(data);
  } catch (err) {
    console.warn("Asset detail failed:", err);
    if (!options.silent && !currentAsset) {
      document.getElementById("asset-name").textContent = "This asset could not be loaded.";
      document.getElementById("asset-line-chart").innerHTML = `<div class="asset-empty-activity">Market details are not available right now.</div>`;
    }
  } finally {
    if (requestToken === assetRequestToken) assetLoading = false;
  }
}

function refreshAssetWhenVisible() {
  if (document.hidden) return;
  loadAsset({ silent: true });
}

document.addEventListener("click", (event) => {
  const range = event.target.closest("[data-chart-range]");
  if (!range) return;
  currentRange = range.dataset.chartRange;
  document.querySelectorAll("[data-chart-range]").forEach((button) => button.classList.toggle("active", button === range));
  if (currentAsset) loadAsset({ force: true });
});

loadAsset();
setInterval(refreshAssetWhenVisible, ASSET_REFRESH_MS);
window.addEventListener("focus", refreshAssetWhenVisible);
document.addEventListener("visibilitychange", refreshAssetWhenVisible);
