let currentSymbol = new URLSearchParams(location.search).get("symbol") || "BTC";
let currentRange = "1d";
let currentAsset = null;
let assetLoading = false;
let assetRequestToken = 0;

const ASSET_REFRESH_MS = 10000;
const ASSET_PAGE_NAME = location.pathname.split("/").pop() || "demo-asset.html";
const IS_LIVE_ASSET_PAGE = ASSET_PAGE_NAME === "account-asset.html";
const ASSET_ORDERS_PAGE = IS_LIVE_ASSET_PAGE ? "account-orders.html" : "demo-orders.html";
const ASSET_WALLET_PAGE = IS_LIVE_ASSET_PAGE ? "account-wallet.html" : "demo-wallet.html";
const ASSET_RESEARCH_PAGE = IS_LIVE_ASSET_PAGE ? "account-research.html" : "demo-research.html";
const ASSET_WATCHLIST_API = IS_LIVE_ASSET_PAGE ? "/api/account/watchlist" : "/api/demo/watchlist";

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

function normalizedAssetType(asset = {}) {
  return String(asset.assetType || "asset").trim().toLowerCase();
}

function assetVenue(asset = {}) {
  const type = normalizedAssetType(asset);
  const market = String(asset.market || "").trim();
  const generic = {
    crypto: ["crypto", "global"],
    stock: ["stock", "stocks", "equities"],
    etf: ["etf", "etfs", "fund"],
    commodity: ["commodity", "commodities", "oil and metals", "metals"]
  };
  if (!market || (generic[type] || []).includes(market.toLowerCase())) return "";
  return titleLabel(market);
}

function assetTypeLabel(asset) {
  const type = normalizedAssetType(asset);
  const base = type === "etf"
    ? "ETF"
    : type === "commodity"
      ? "Commodity"
      : type === "stock"
        ? "Stock"
        : type === "crypto"
          ? "Crypto"
          : titleLabel(type);
  return [base, assetVenue(asset)].filter(Boolean).join(" ");
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
  if (String(asset.symbol || "").toUpperCase() === "AU") return "Autody-Logo.png";
  if (asset.assetType === "crypto") return `https://assets.coincap.io/assets/icons/${encodeURIComponent(logoFallbackText(asset).toLowerCase())}@2x.png`;
  return "";
}

function assetLogoMarkup(asset, extraClass = "") {
  const fallback = logoFallbackText(asset);
  const src = assetLogoSrc(asset);
  const autodyClass = String(asset.symbol || "").toUpperCase() === "AU" ? "autody-logo" : "";
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
  const response = await fetch(url, {
    cache: "no-store",
    headers: window.AutodyAuth?.headers?.() || {}
  });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: window.AutodyAuth?.headers?.({ "Content-Type": "application/json" }) || { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success) throw new Error(data.error || `${url} returned ${response.status}`);
  return data;
}

function setAssetMessage(message, tone = "") {
  const node = document.getElementById("asset-action-message");
  if (!node) return;
  node.textContent = message;
  node.className = `order-status ${tone}`;
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

function isCryptoAsset(asset) {
  return normalizedAssetType(asset) === "crypto" || String(asset?.symbol || "").toUpperCase() === "AU";
}

function activityMetric(asset) {
  const isAutody = String(asset?.symbol || "").toUpperCase() === "AU";
  const liquidity = Number(asset.liquidityUsd);
  const volume = Number(asset.totalVolume);
  if (isCryptoAsset(asset) && !isAutody && Number.isFinite(liquidity) && liquidity > 0) {
    return { label: "Liquidity", value: liquidity };
  }
  if (isCryptoAsset(asset) && Number.isFinite(volume) && volume > 0) {
    return { label: "24h volume", value: volume };
  }
  return null;
}

function renderDetails(asset, chart) {
  const stats = chart.stats || {};
  const networks = asset.depositNetworks || [];
  const currency = chart.currency || asset.currency || "USD";
  const cryptoAsset = isCryptoAsset(asset);
  const marketCap = asset.marketCap ?? stats.marketCap;
  const fdv = asset.fdv ?? stats.fdv;
  const activity = activityMetric(asset);
  const allTimeHigh = asset.ath ?? stats.allTimeHigh;
  const allTimeLow = asset.atl ?? stats.allTimeLow;

  const rows = [];

  if (cryptoAsset) {
    const network = networks[0] || assetVenue(asset) || "Multiple networks";
    rows.push(detailRow("Network", network));
  } else {
    rows.push(detailRow("Market / venue", asset.market || "Global market"));
  }

  if (networks.length > 1) {
    rows.splice(1, 0, detailRow("Deposit networks", networks.slice(0, 4).join(", ")));
  }

  rows.push(detailRow("Quote currency", currency));
  if (cryptoAsset && marketCap) rows.push(detailRow("Market cap", formatPrice(marketCap, "USD")));
  if (cryptoAsset && fdv) rows.push(detailRow("FDV", formatPrice(fdv, "USD")));
  if (activity) rows.push(detailRow(activity.label, formatPrice(activity.value, "USD")));
  if (allTimeHigh) rows.push(detailRow("All-time high", formatPrice(allTimeHigh, currency)));
  if (allTimeLow) rows.push(detailRow("All-time low", formatPrice(allTimeLow, currency)));
  if (cryptoAsset && asset.circulatingSupply) rows.push(detailRow("Circulating supply", `${formatNumber(asset.circulatingSupply)} ${asset.symbol}`));

  document.getElementById("asset-detail-heading").textContent = cryptoAsset ? "Token details" : "Market details";
  document.getElementById("asset-detail-list").innerHTML = rows.join("");
}

function renderActions(asset) {
  const symbol = encodeURIComponent(asset.symbol);
  if (IS_LIVE_ASSET_PAGE) {
    const cryptoActions = `
      <a href="${ASSET_ORDERS_PAGE}?side=buy&symbol=${symbol}">Buy</a>
      <a href="${ASSET_ORDERS_PAGE}?side=sell&symbol=${symbol}">Sell</a>
      <a href="${ASSET_ORDERS_PAGE}?side=swap&symbol=${symbol}">Swap</a>
      <button type="button" data-live-asset-transfer="receive" data-live-asset-symbol="${symbol}">Receive</button>
      <button type="button" data-live-asset-transfer="send" data-live-asset-symbol="${symbol}">Send</button>
    `;
    const marketActions = `
      <a href="${ASSET_ORDERS_PAGE}?side=buy&symbol=${symbol}">Buy</a>
      <a href="${ASSET_ORDERS_PAGE}?side=sell&symbol=${symbol}">Sell</a>
      <button type="button" data-add-watchlist>Watchlist</button>
      <a href="${ASSET_RESEARCH_PAGE}">Research</a>
    `;
    document.getElementById("asset-action-grid").innerHTML = asset.assetType === "crypto" ? cryptoActions : marketActions;
    return;
  }

  const cryptoActions = `
    <a href="demo-orders.html?side=buy&symbol=${symbol}">Buy</a>
    <a href="demo-orders.html?side=sell&symbol=${symbol}">Sell</a>
    <a href="demo-orders.html?side=swap&symbol=${symbol}">Swap</a>
    <button type="button" data-demo-blocked-action="Receive">Receive</button>
    <button type="button" data-demo-blocked-action="Send">Send</button>
  `;
  const marketActions = `
    <a href="demo-orders.html?side=buy&symbol=${symbol}">Buy</a>
    <a href="demo-orders.html?side=sell&symbol=${symbol}">Sell</a>
    <button type="button" data-add-watchlist>Watchlist</button>
    <a href="demo-research.html">Research</a>
  `;
  document.getElementById("asset-action-grid").innerHTML = asset.assetType === "crypto" ? cryptoActions : marketActions;
}

function renderActivity(orders) {
  const target = document.getElementById("asset-activity-list");
  if (IS_LIVE_ASSET_PAGE && !orders?.length) {
    target.innerHTML = `
      <div class="asset-empty-activity">
        <strong>No live activity yet.</strong>
        <span>Deposits, buys, sells, swaps, sends, and receives will appear here for this asset.</span>
      </div>
    `;
    return;
  }

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
      <span>${escapeHtml(order.side || order.type || "Order")}</span>
      <strong>${escapeHtml(order.symbol)} ${escapeHtml(order.status || "Open")}</strong>
      <small>${formatPrice(order.notional_usd || order.notionalUsd || order.valueUsd || order.amountUsd || 0)}</small>
    </div>
  `).join("");
}

function liveHoldingForSymbol(data, symbol) {
  const lookup = String(symbol || "").toUpperCase();
  return (data.live?.wallet?.holdings || []).find((holding) => (
    String(holding.symbol || "").toUpperCase() === lookup
  ));
}

function liveActivityForSymbol(data, symbol) {
  const lookup = String(symbol || "").toUpperCase();
  const orders = (data.live?.orders || []).filter((order) => (
    String(order.symbol || "").toUpperCase() === lookup
  ));
  if (orders.length) return orders;
  return (data.live?.wallet?.records || []).filter((record) => (
    String(record.symbol || "").toUpperCase() === lookup
  ));
}

function renderAsset(data) {
  const asset = data.asset;
  const chart = data.chart || {};
  currentAsset = asset;
  document.title = `Autody ${IS_LIVE_ASSET_PAGE ? "Live Account" : "Demo Account"} | ${asset.symbol}`;
  document.getElementById("asset-logo-wrap").innerHTML = assetLogoMarkup(asset, "asset-logo-hero");
  document.getElementById("asset-type-label").textContent = assetTypeLabel(asset);
  document.getElementById("asset-symbol").textContent = asset.symbol;
  document.getElementById("asset-name").textContent = asset.name;
  document.getElementById("asset-price").textContent = formatPrice(asset.price, asset.currency || chart.currency || "USD");
  const change = document.getElementById("asset-change");
  change.textContent = formatMove(asset.changePct);
  change.className = moveClass(asset.changePct);
  document.getElementById("asset-chart-title").textContent = String(asset.symbol || "").toUpperCase() === "AU"
    ? "Autody Movement"
    : `${asset.name} movement`;
  if (IS_LIVE_ASSET_PAGE) {
    const wallet = data.live?.wallet || {};
    const cashBalance = Number(wallet.cashBalance || 0);
    const holding = liveHoldingForSymbol(data, asset.symbol);
    const heldBalance = Number(holding?.balance || 0);
    const heldValue = Number(holding?.valueUsd || 0);
    const balanceText = `${formatPrice(cashBalance, wallet.currency || "USD")} USD`;
    document.querySelectorAll("[data-live-balance]").forEach((node) => {
      node.textContent = balanceText;
    });
    document.getElementById("asset-buying-power").textContent = `Account balance ${formatPrice(cashBalance, wallet.currency || "USD")}`;
    document.getElementById("asset-owned").textContent = `${formatNumber(heldBalance, false)} ${asset.symbol}`;
    document.getElementById("asset-owned-value").textContent = formatPrice(heldValue, "USD");
    document.querySelector(".asset-action-card .muted-label").textContent = "Live actions";
    document.getElementById("asset-action-title").textContent = "Use this asset";
    document.querySelector(".asset-balance-card .muted-label").textContent = "Your live balance";
    document.querySelector(".asset-activity-card h2").textContent = "Live history";
  } else {
    document.getElementById("asset-sidebar-balance").textContent = `${formatPrice(data.demo?.buyingPower || 50000, "USD")} USD`;
    document.getElementById("asset-buying-power").textContent = `Buying power ${formatPrice(data.demo?.buyingPower || 50000, "USD")}`;
    document.getElementById("asset-owned").textContent = data.demo?.holding
      ? `${formatNumber(data.demo.holding.balance, false)} ${asset.symbol}`
      : `0 ${asset.symbol}`;
    document.getElementById("asset-owned-value").textContent = formatPrice(data.demo?.holding?.valueUsd || 0, "USD");
  }

  renderLineChart(asset, chart);
  renderDetails(asset, chart);
  renderActions(asset);
  renderActivity(IS_LIVE_ASSET_PAGE ? liveActivityForSymbol(data, asset.symbol) : data.demo?.orders || []);
  renderChartStats(asset, chart);
  setAssetMessage("");
}

function renderChartStats(asset, chart) {
  const stats = chart.stats || {};
  const target = document.getElementById("asset-chart-stats");
  const currency = chart.currency || asset.currency || "USD";
  const cryptoAsset = isCryptoAsset(asset);
  const activity = activityMetric(asset);
  const rows = [];

  if (Number.isFinite(Number(asset.changePct))) rows.push(detailRow("24h move", formatMove(asset.changePct)));
  if (cryptoAsset && (asset.marketCap ?? stats.marketCap)) rows.push(detailRow("Market cap", formatPrice(asset.marketCap ?? stats.marketCap, "USD")));
  if (activity) rows.push(detailRow(activity.label, formatPrice(activity.value, "USD")));
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
    const accountMode = IS_LIVE_ASSET_PAGE ? "live" : "demo";
    const data = await getJson(`/api/markets/asset/${encodeURIComponent(currentSymbol)}?range=${encodeURIComponent(currentRange)}&mode=${encodeURIComponent(accountMode)}`);
    if (!data.success) throw new Error(data.error || "Asset detail failed");
    if (IS_LIVE_ASSET_PAGE) {
      const [walletResult, ordersResult] = await Promise.allSettled([
        getJson("/api/account/wallet"),
        getJson("/api/account/orders")
      ]);
      data.live = {
        wallet: walletResult.status === "fulfilled" ? walletResult.value?.wallet : null,
        orders: ordersResult.status === "fulfilled" ? ordersResult.value?.orders || [] : []
      };
    }
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

document.addEventListener("click", async (event) => {
  const range = event.target.closest("[data-chart-range]");
  if (range) {
    currentRange = range.dataset.chartRange;
    document.querySelectorAll("[data-chart-range]").forEach((button) => button.classList.toggle("active", button === range));
    if (currentAsset) loadAsset({ force: true });
    return;
  }

  const moreButton = event.target.closest("#asset-more-button");
  const moreMenu = document.getElementById("asset-more-menu");
  if (moreButton && moreMenu) {
    const isHidden = moreMenu.hidden;
    moreMenu.hidden = !isHidden;
    moreButton.setAttribute("aria-expanded", String(isHidden));
    return;
  }

  const blocked = event.target.closest("[data-demo-blocked-action]");
  if (blocked) {
    const action = blocked.dataset.demoBlockedAction || "Transfer";
    setAssetMessage(`${action} is disabled in the demo account. Use Buy, Sell, or Swap for demo trading.`, "loss");
    return;
  }

  const liveTransfer = event.target.closest("[data-live-asset-transfer]");
  if (liveTransfer && IS_LIVE_ASSET_PAGE) {
    event.preventDefault();
    event.stopImmediatePropagation();
    const symbol = liveTransfer.dataset.liveAssetSymbol || currentAsset?.symbol || currentSymbol;
    const mode = liveTransfer.dataset.liveAssetTransfer || "receive";
    const opened = window.openAutodyLiveTransferModal?.(mode, symbol);
    if (!opened) {
      setAssetMessage(`${String(symbol).toUpperCase()} ${mode} is not connected yet.`, "loss");
    }
    return;
  }

  const addWatchlist = event.target.closest("[data-add-watchlist]");
  if (addWatchlist && currentAsset) {
    setAssetMessage("Saving to watchlist...");
    try {
      const data = await postJson(ASSET_WATCHLIST_API, { symbol: currentAsset.symbol });
      setAssetMessage(
        data.alreadySaved ? `${currentAsset.symbol} is already in your watchlist.` : `${currentAsset.symbol} added to your watchlist.`,
        data.alreadySaved ? "flat" : "gain"
      );
      if (moreMenu) moreMenu.hidden = true;
      document.getElementById("asset-more-button")?.setAttribute("aria-expanded", "false");
    } catch (err) {
      setAssetMessage(err.message || "Watchlist could not be updated.", "loss");
    }
    return;
  }

  if (moreMenu && !event.target.closest(".asset-more-wrap")) {
    moreMenu.hidden = true;
    document.getElementById("asset-more-button")?.setAttribute("aria-expanded", "false");
  }
});

loadAsset();
setInterval(refreshAssetWhenVisible, ASSET_REFRESH_MS);
window.addEventListener("focus", refreshAssetWhenVisible);
document.addEventListener("visibilitychange", refreshAssetWhenVisible);
