let allMarketAssets = [];
const initialMarketFilter = new URLSearchParams(location.search).get("filter");
let activeFilter = ["all", "crypto", "stablecoin", "stocks", "etf", "commodity"].includes(initialMarketFilter)
  ? initialMarketFilter
  : "all";
let activeSearch = "";
let demoWallet = null;
let marketsLoading = false;

const MARKET_REFRESH_MS = 10000;
const MIN_STABLE_MARKET_ASSETS = 390;
const MARKET_PAGE_NAME = location.pathname.split("/").pop() || "demo-markets.html";
const MARKET_HISTORY_PAGE = MARKET_PAGE_NAME === "account-markets.html" ? "account-markets.html" : "demo-markets.html";
const IS_LIVE_MARKET_PAGE = MARKET_PAGE_NAME === "account-markets.html";
const MARKET_WATCHLIST_API = IS_LIVE_MARKET_PAGE ? "/api/account/watchlist" : "/api/demo/watchlist";

function marketPriceDigits(number, compact = false) {
  if (compact) return 2;
  if (Math.abs(number) < 0.01) return 8;
  if (Math.abs(number) < 1) return 6;
  return 2;
}

function marketPrice(value, currency = "USD") {
  const number = Number(value);
  if (!Number.isFinite(number)) return "Waiting";
  const compact = Math.abs(number) >= 100000;
  const options = {
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: marketPriceDigits(number, compact)
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

function marketMove(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "First refresh";
  const arrow = number > 0 ? "\u2191" : number < 0 ? "\u2193" : "\u2192";
  const sign = number > 0 ? "+" : "";
  return `${arrow} ${sign}${number.toFixed(2)}%`;
}

function marketMoveClass(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number === 0) return "flat";
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

function cssValue(value = "") {
  return window.CSS?.escape
    ? CSS.escape(String(value))
    : String(value).replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

function assetUrl(asset) {
  const page = IS_LIVE_MARKET_PAGE ? "account-asset.html" : "demo-asset.html";
  return `${page}?symbol=${encodeURIComponent(asset.symbol)}`;
}

function logoFallbackText(asset) {
  const symbol = String(asset.symbol || "?")
    .replace(/=F$/i, "")
    .replace(/[^a-z0-9]/gi, "")
    .slice(0, 4)
    .toUpperCase();
  return symbol || "?";
}

function marketLogoSrc(asset) {
  if (asset.logoUrl) return asset.logoUrl;
  if (asset.customAsset || asset.symbol === "AU") return "Autody-Logo.png";
  if (asset.assetType === "crypto") return `https://assets.coincap.io/assets/icons/${encodeURIComponent(logoFallbackText(asset).toLowerCase())}@2x.png`;
  return "";
}

function marketLogoMarkup(asset, extraClass = "") {
  const fallback = logoFallbackText(asset);
  const src = marketLogoSrc(asset);
  const autodyClass = asset.symbol === "AU" || asset.customAsset ? "autody-logo" : "";
  const img = src
    ? `<img src="${escapeMarketHtml(src)}" alt="" loading="lazy" onerror="this.parentElement.classList.add('logo-fallback'); this.remove();">`
    : "";
  return `
    <span class="asset-token asset-logo ${src ? "has-image" : "logo-fallback"} ${autodyClass} ${escapeMarketHtml(extraClass)}" data-symbol="${escapeMarketHtml(fallback)}">
      ${img}
      <b>${escapeMarketHtml(fallback)}</b>
    </span>
  `;
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

function showMarketToast(message, tone = "") {
  let toast = document.getElementById("market-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "market-toast";
    toast.className = "market-toast";
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.className = `market-toast show ${tone}`;
  window.clearTimeout(showMarketToast.timer);
  showMarketToast.timer = window.setTimeout(() => toast.classList.remove("show"), 2600);
}

function assetSearchText(asset) {
  return [
    asset.symbol,
    asset.name,
    asset.assetType,
    asset.market,
    asset.region,
    ...(asset.tags || []),
    ...(asset.depositNetworks || [])
  ].join(" ").toLowerCase();
}

function filterAsset(asset) {
  const text = assetSearchText(asset);
  const matchesSearch = !activeSearch || text.includes(activeSearch);
  if (!matchesSearch) return false;

  if (activeFilter === "all") return true;
  if (activeFilter === "crypto") return asset.assetType === "crypto";
  if (activeFilter === "stablecoin") return asset.market === "Stablecoin" || (asset.tags || []).includes("Stablecoin");
  if (activeFilter === "stocks") return asset.assetType === "stock";
  if (activeFilter === "etf") return asset.assetType === "etf";
  if (activeFilter === "commodity") return asset.assetType === "commodity";
  return true;
}

function sortByMove(assets) {
  return [...assets].sort((a, b) => Math.abs(Number(b.changePct || 0)) - Math.abs(Number(a.changePct || 0)));
}

function assetTone(asset) {
  if (asset.market === "Autody" || asset.customAsset) return "crypto";
  if (asset.market === "Stablecoin") return "stable";
  if (asset.assetType === "crypto") return "crypto";
  if (asset.assetType === "commodity") return "commodity";
  return "equity";
}

function miniChartBars(asset, count = 18) {
  const base = Math.max(12, Math.min(88, 50 + Number(asset.changePct || 0) * 4));
  return Array.from({ length: count }, (_, index) => {
    const wave = Math.sin((index + asset.rank) * 0.78) * 18;
    const slope = Number(asset.changePct || 0) * (index / count) * 5;
    const height = Math.max(10, Math.min(92, base + wave + slope));
    return `<span style="height:${height.toFixed(1)}%"></span>`;
  }).join("");
}

function marketCard(asset) {
  const moveClass = marketMoveClass(asset.changePct);
  return `
    <article class="market-asset-card ${assetTone(asset)}">
      <button class="market-card-menu" type="button" data-market-menu-symbol="${escapeMarketHtml(asset.symbol)}" aria-label="More ${escapeMarketHtml(asset.symbol)} actions" aria-expanded="false">...</button>
      <div class="market-card-popover" data-market-menu="${escapeMarketHtml(asset.symbol)}" hidden>
        <button type="button" data-market-watch-symbol="${escapeMarketHtml(asset.symbol)}">Add to watchlist</button>
      </div>
      <a class="market-card-main" href="${assetUrl(asset)}">
        <div class="asset-card-top">
          ${marketLogoMarkup(asset)}
          <span class="asset-pill">${escapeMarketHtml(asset.assetType.toUpperCase())}</span>
        </div>
        <strong>${escapeMarketHtml(asset.name)}</strong>
        <small>${escapeMarketHtml(asset.market || asset.region || "Market")}</small>
        <div class="asset-card-chart ${moveClass}" aria-hidden="true">${miniChartBars(asset, 14)}</div>
        <div class="asset-card-bottom">
          <span>${marketPrice(asset.price, asset.currency || "USD")}</span>
          <em class="${moveClass}">${marketMove(asset.changePct)}</em>
        </div>
      </a>
    </article>
  `;
}

function compactRow(asset) {
  return `
    <a href="${assetUrl(asset)}">
      ${marketLogoMarkup(asset, "asset-logo-small")}
      <span><b>${escapeMarketHtml(asset.symbol)}</b><em>${escapeMarketHtml(asset.name)}</em></span>
      <strong>${marketPrice(asset.price, asset.currency || "USD")}</strong>
      <small class="${marketMoveClass(asset.changePct)}">${marketMove(asset.changePct)}</small>
    </a>
  `;
}

function renderSpotlight(asset) {
  if (!asset) return;
  const moveClass = marketMoveClass(asset.changePct);
  document.getElementById("spotlight-logo-wrap").innerHTML = marketLogoMarkup(asset, "asset-logo-large");
  document.getElementById("spotlight-name").textContent = asset.name;
  document.getElementById("spotlight-price").textContent = marketPrice(asset.price, asset.currency || "USD");
  const move = document.getElementById("spotlight-move");
  move.textContent = marketMove(asset.changePct);
  move.className = moveClass;
  document.getElementById("spotlight-link").href = assetUrl(asset);
  document.getElementById("spotlight-chart").innerHTML = miniChartBars(asset, 34);
  document.getElementById("spotlight-meta").innerHTML = [
    asset.symbol,
    asset.market || asset.assetType,
    asset.region,
    (asset.depositNetworks || [])[0]
  ].filter(Boolean).map((item) => `<span>${escapeMarketHtml(item)}</span>`).join("");
}

function renderMovers(assets) {
  const target = document.getElementById("market-movers-list");
  if (!target) return;
  const movers = sortByMove(assets).slice(0, 6);
  target.innerHTML = movers.map((asset, index) => `
    <a href="${assetUrl(asset)}">
      <span>${index + 1}</span>
      ${marketLogoMarkup(asset, "asset-logo-small")}
      <strong>${escapeMarketHtml(asset.symbol)}</strong>
      <small>${escapeMarketHtml(asset.name)}</small>
      <em class="${marketMoveClass(asset.changePct)}">${marketMove(asset.changePct)}</em>
    </a>
  `).join("");
}

function renderCompactLists(assets) {
  const funding = assets
    .filter((asset) => asset.assetType === "crypto" && asset.depositEnabled)
    .slice(0, 8);
  const global = assets
    .filter((asset) => asset.assetType !== "crypto" && (asset.region !== "US" || asset.assetType === "commodity" || asset.symbol === "VT"))
    .slice(0, 8);

  document.getElementById("funding-assets-list").innerHTML = funding.map(compactRow).join("");
  document.getElementById("global-assets-list").innerHTML = global.map(compactRow).join("");
}

function renderMarketCards() {
  const filtered = allMarketAssets.filter(filterAsset);
  const ordered = [...filtered].sort((a, b) => {
    const aLive = a.status === "Live" ? 0 : 1;
    const bLive = b.status === "Live" ? 0 : 1;
    return aLive - bLive || a.rank - b.rank;
  });
  const filterTitles = {
    all: "All markets",
    crypto: "Crypto markets",
    stablecoin: "Stablecoins",
    stocks: "Stocks",
    etf: "ETFs",
    commodity: "Oil and metals"
  };

  document.getElementById("market-result-count").textContent = `${ordered.length} assets`;
  document.getElementById("market-list-title").textContent = activeSearch ? "Search results" : filterTitles[activeFilter] || "All markets";
  document.getElementById("market-card-grid").innerHTML = ordered.length
    ? ordered.map(marketCard).join("")
    : `<article class="market-empty-state">No assets match that search.</article>`;
}

function syncActiveFilterButtons() {
  document.querySelectorAll("[data-market-filter]").forEach((button) => {
    button.classList.toggle("active", button.dataset.marketFilter === activeFilter);
  });
}

function updateDashboard() {
  const liveAssets = allMarketAssets.filter((asset) => asset.price != null);
  const topMover = sortByMove(liveAssets)[0];
  const holdings = demoWallet?.holdings || [];
  const openPositions = IS_LIVE_MARKET_PAGE
    ? 0
    : holdings.filter((asset) => !["USD", "AU", "CRYPTO", "STOCKS"].includes(asset.symbol) && Number(asset.valueUsd) > 0).length;

  document.getElementById("market-total-count").textContent = String(allMarketAssets.length || 0);
  document.getElementById("market-top-mover").textContent = topMover ? topMover.symbol : "Waiting";
  document.getElementById("market-top-mover-detail").textContent = topMover ? `${topMover.name} ${marketMove(topMover.changePct)}` : "Live percentage move";
  document.getElementById("market-open-positions").textContent = `${openPositions} positions`;

  if (IS_LIVE_MARKET_PAGE) {
    document.getElementById("market-buying-power").textContent = "$0.00";
  } else if (demoWallet) {
    const sidebarBalance = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: demoWallet.currency || "USD",
      maximumFractionDigits: 0
    }).format(Number(demoWallet.cashBalance || 0));
    document.querySelectorAll(".sidebar-profile strong").forEach((node) => {
      node.textContent = `${sidebarBalance} ${demoWallet.currency || "USD"}`;
    });
    document.getElementById("market-buying-power").textContent = marketPrice(demoWallet.cashBalance, demoWallet.currency || "USD");
  }

  renderSpotlight(topMover || liveAssets[0] || allMarketAssets[0]);
  renderMovers(liveAssets);
  renderCompactLists(allMarketAssets);
  renderMarketCards();
}

async function loadDemoMarkets(options = {}) {
  if (marketsLoading) return;
  marketsLoading = true;

  try {
    const [catalog, wallet] = await Promise.all([
      getJson("/api/markets/catalog?type=all"),
      IS_LIVE_MARKET_PAGE ? Promise.resolve(null) : getJson("/api/demo/wallet").catch(() => null)
    ]);

    const nextAssets = catalog.assets || [];
    if (allMarketAssets.length >= MIN_STABLE_MARKET_ASSETS && nextAssets.length < MIN_STABLE_MARKET_ASSETS) {
      console.warn(`Skipping short market catalog refresh: ${nextAssets.length} assets`);
      return;
    }

    allMarketAssets = nextAssets;
    demoWallet = wallet?.wallet || null;
    updateDashboard();
  } catch (err) {
    console.warn("Market catalog failed:", err);
    if (!options.silent && !allMarketAssets.length) {
      document.getElementById("market-card-grid").innerHTML = `<article class="market-empty-state">Market data is still loading. Try refreshing in a moment.</article>`;
    }
  } finally {
    marketsLoading = false;
  }
}

function refreshMarketsWhenVisible() {
  if (document.hidden) return;
  loadDemoMarkets({ silent: true });
}

document.addEventListener("input", (event) => {
  if (event.target.id !== "market-search") return;
  activeSearch = event.target.value.trim().toLowerCase();
  renderMarketCards();
});

document.addEventListener("click", (event) => {
  const menuButton = event.target.closest("[data-market-menu-symbol]");
  if (menuButton) {
    const symbol = menuButton.dataset.marketMenuSymbol;
    document.querySelectorAll("[data-market-menu]").forEach((menu) => {
      const isTarget = menu.dataset.marketMenu === symbol;
      menu.hidden = !isTarget || !menu.hidden;
    });
    document.querySelectorAll("[data-market-menu-symbol]").forEach((button) => {
      const expanded = button === menuButton && !document.querySelector(`[data-market-menu="${cssValue(symbol)}"]`)?.hidden;
      button.setAttribute("aria-expanded", String(expanded));
    });
    return;
  }

  const watchButton = event.target.closest("[data-market-watch-symbol]");
  if (watchButton) {
    const symbol = watchButton.dataset.marketWatchSymbol;
    watchButton.disabled = true;
    postJson(MARKET_WATCHLIST_API, { symbol })
      .then((data) => {
        document.querySelector(`[data-market-menu="${cssValue(symbol)}"]`)?.setAttribute("hidden", "");
        document.querySelector(`[data-market-menu-symbol="${cssValue(symbol)}"]`)?.setAttribute("aria-expanded", "false");
        showMarketToast(
          data.alreadySaved ? `${symbol} is already in your watchlist.` : `${symbol} added to your watchlist.`,
          data.alreadySaved ? "flat" : "gain"
        );
      })
      .catch((err) => showMarketToast(err.message || "Watchlist could not be updated.", "loss"))
      .finally(() => {
        watchButton.disabled = false;
      });
    return;
  }

  if (!event.target.closest(".market-asset-card")) {
    document.querySelectorAll("[data-market-menu]").forEach((menu) => {
      menu.hidden = true;
    });
    document.querySelectorAll("[data-market-menu-symbol]").forEach((button) => {
      button.setAttribute("aria-expanded", "false");
    });
  }

  const filter = event.target.closest("[data-market-filter]");
  if (!filter) return;
  activeFilter = filter.dataset.marketFilter;
  history.replaceState(null, "", `${MARKET_HISTORY_PAGE}?filter=${encodeURIComponent(activeFilter)}`);
  syncActiveFilterButtons();
  renderMarketCards();
});

syncActiveFilterButtons();
loadDemoMarkets();
setInterval(refreshMarketsWhenVisible, MARKET_REFRESH_MS);
window.addEventListener("focus", refreshMarketsWhenVisible);
document.addEventListener("visibilitychange", refreshMarketsWhenVisible);
