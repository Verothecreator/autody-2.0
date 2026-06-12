const watchMoney = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2
});

let watchCatalog = [];
let watchSymbols = [];
let watchSearch = "";

function escapeWatchHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function watchPriceDigits(number, compact = false) {
  if (compact) return 2;
  if (Math.abs(number) < 0.01) return 8;
  if (Math.abs(number) < 1) return 6;
  return 2;
}

function formatWatchPrice(value, currency = "USD") {
  const number = Number(value);
  if (!Number.isFinite(number)) return "Waiting";
  const compact = Math.abs(number) >= 100000;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      notation: compact ? "compact" : "standard",
      maximumFractionDigits: watchPriceDigits(number, compact)
    }).format(number);
  } catch (err) {
    return `${currency} ${watchMoney.format(number)}`;
  }
}

function watchMove(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "Live feed";
  const arrow = number > 0 ? "\u2191" : number < 0 ? "\u2193" : "\u2192";
  const sign = number > 0 ? "+" : "";
  return `${arrow} ${sign}${number.toFixed(2)}%`;
}

function watchMoveClass(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number === 0) return "flat";
  return number > 0 ? "gain" : "loss";
}

function watchLogoFallback(asset) {
  return String(asset.symbol || "?")
    .replace(/=F$/i, "")
    .replace(/[^a-z0-9]/gi, "")
    .slice(0, 4)
    .toUpperCase() || "?";
}

function watchLogoSrc(asset) {
  if (asset.logoUrl) return asset.logoUrl;
  if (asset.customAsset || asset.symbol === "AU") return "Autody-Logo.png";
  if (asset.assetType === "crypto") return `https://assets.coincap.io/assets/icons/${encodeURIComponent(watchLogoFallback(asset).toLowerCase())}@2x.png`;
  return "";
}

function watchLogoMarkup(asset, extraClass = "") {
  const fallback = watchLogoFallback(asset);
  const src = watchLogoSrc(asset);
  const autodyClass = asset.symbol === "AU" || asset.customAsset ? "autody-logo" : "";
  const img = src
    ? `<img src="${escapeWatchHtml(src)}" alt="" loading="lazy" onerror="this.parentElement.classList.add('logo-fallback'); this.remove();">`
    : "";
  return `
    <span class="asset-token asset-logo ${src ? "has-image" : "logo-fallback"} ${autodyClass} ${escapeWatchHtml(extraClass)}" data-symbol="${escapeWatchHtml(fallback)}">
      ${img}
      <b>${escapeWatchHtml(fallback)}</b>
    </span>
  `;
}

function watchTone(asset) {
  if (asset.market === "Autody" || asset.customAsset) return "crypto";
  if (asset.market === "Stablecoin") return "stable";
  if (asset.assetType === "crypto") return "crypto";
  if (asset.assetType === "commodity") return "commodity";
  return "equity";
}

function miniBars(asset, count = 14) {
  const base = Math.max(12, Math.min(88, 50 + Number(asset.changePct || 0) * 4));
  return Array.from({ length: count }, (_, index) => {
    const wave = Math.sin((index + (asset.rank || 1)) * 0.78) * 18;
    const slope = Number(asset.changePct || 0) * (index / count) * 5;
    const height = Math.max(10, Math.min(92, base + wave + slope));
    return `<span style="height:${height.toFixed(1)}%"></span>`;
  }).join("");
}

async function getWatchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

function flattenWatchlist(watchlist = {}) {
  return Array.from(new Set([
    ...(watchlist.crypto || []),
    ...(watchlist.stocks || [])
  ].map((symbol) => String(symbol).toUpperCase())));
}

function watchAssetCard(asset) {
  const moveClass = watchMoveClass(asset.changePct);
  return `
    <a class="market-asset-card ${watchTone(asset)}" href="demo-asset.html?symbol=${encodeURIComponent(asset.symbol)}">
      <div class="asset-card-top">
        ${watchLogoMarkup(asset)}
        <span class="asset-pill">${escapeWatchHtml(String(asset.assetType || "asset").toUpperCase())}</span>
      </div>
      <strong>${escapeWatchHtml(asset.name || asset.symbol)}</strong>
      <small>${escapeWatchHtml(asset.market || asset.region || "Market")}</small>
      <div class="asset-card-chart ${moveClass}" aria-hidden="true">${miniBars(asset)}</div>
      <div class="asset-card-bottom">
        <span>${escapeWatchHtml(formatWatchPrice(asset.price, asset.currency || "USD"))}</span>
        <em class="${moveClass}">${escapeWatchHtml(watchMove(asset.changePct))}</em>
      </div>
    </a>
  `;
}

function renderWatchlist() {
  const catalogMap = new Map(watchCatalog.map((asset) => [String(asset.symbol).toUpperCase(), asset]));
  const assets = watchSymbols
    .map((symbol) => catalogMap.get(symbol))
    .filter(Boolean)
    .filter((asset) => {
      const searchText = [asset.symbol, asset.name, asset.assetType, asset.market].join(" ").toLowerCase();
      return !watchSearch || searchText.includes(watchSearch);
    });

  document.getElementById("watchlist-count").textContent = `${watchSymbols.length} assets`;
  document.getElementById("watchlist-grid").innerHTML = assets.length
    ? assets.map(watchAssetCard).join("")
    : `<article class="market-empty-state">No saved assets match that search.</article>`;

  const cryptoCount = assets.filter((asset) => asset.assetType === "crypto" || asset.symbol === "AU").length;
  const marketCount = assets.length - cryptoCount;
  document.getElementById("watchlist-groups").innerHTML = `
    <div><span>Crypto</span><strong>${cryptoCount} saved</strong><small>Coins, stablecoins, and AU</small></div>
    <div><span>Markets</span><strong>${marketCount} saved</strong><small>Stocks, ETFs, oil, and metals</small></div>
  `;
}

async function loadWatchlist() {
  try {
    const [catalog, watchlist, wallet] = await Promise.all([
      getWatchJson("/api/markets/catalog?type=all"),
      getWatchJson("/api/demo/watchlist"),
      getWatchJson("/api/demo/wallet").catch(() => null)
    ]);
    watchCatalog = catalog.assets || [];
    watchSymbols = flattenWatchlist(watchlist.watchlist);
    if (wallet?.wallet) {
      document.getElementById("watchlist-sidebar-balance").textContent = `${formatWatchPrice(wallet.wallet.startingBalance, "USD")} paper USD`;
    }
    renderWatchlist();
  } catch (err) {
    console.warn("Watchlist failed:", err);
    document.getElementById("watchlist-grid").innerHTML = `<article class="market-empty-state">Watchlist data is not available right now.</article>`;
  }
}

document.addEventListener("input", (event) => {
  if (event.target.id !== "watchlist-search") return;
  watchSearch = event.target.value.trim().toLowerCase();
  renderWatchlist();
});

loadWatchlist();
