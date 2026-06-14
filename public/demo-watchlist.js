const watchMoney = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2
});

let watchCatalog = [];
let watchSymbols = [];
let watchSearch = "";
const WATCH_CRYPTO_ICON_SYMBOLS = {
  BTC: "btc",
  ETH: "eth",
  USDT: "usdt",
  USDC: "usdc",
  SOL: "sol",
  XRP: "xrp",
  BNB: "bnb",
  DOGE: "doge",
  ADA: "ada",
  AVAX: "avax",
  LINK: "link",
  LTC: "ltc",
  DOT: "dot",
  BCH: "bch",
  XLM: "xlm",
  TRX: "trx",
  POL: "pol"
};

function escapeWatchHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function cssWatchValue(value = "") {
  return window.CSS?.escape
    ? CSS.escape(String(value))
    : String(value).replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
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
  if (asset.assetType === "crypto") {
    const symbol = WATCH_CRYPTO_ICON_SYMBOLS[String(asset.symbol || "").toUpperCase()] || watchLogoFallback(asset).toLowerCase();
    return `https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/128/color/${encodeURIComponent(symbol)}.png`;
  }
  return "";
}

function watchLogoMarkup(asset, extraClass = "") {
  const fallback = watchLogoFallback(asset);
  const src = watchLogoSrc(asset);
  const autodyClass = asset.symbol === "AU" || asset.customAsset ? "autody-logo" : "";
  const typeClass = `logo-type-${String(asset.assetType || asset.category || "market").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const symbolClass = `logo-symbol-${fallback.toLowerCase()}`;
  const img = src
    ? `<span class="asset-logo-fit"><img src="${escapeWatchHtml(src)}" alt="" loading="lazy" onerror="this.closest('.asset-logo').classList.add('logo-fallback'); this.closest('.asset-logo-fit')?.remove();"></span>`
    : "";
  return `
    <span class="asset-token asset-logo ${src ? "has-image" : "logo-fallback"} ${autodyClass} ${typeClass} ${symbolClass} ${escapeWatchHtml(extraClass)}" data-symbol="${escapeWatchHtml(fallback)}">
      ${img}
      <b>${escapeWatchHtml(fallback)}</b>
    </span>
  `;
}

async function getWatchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

async function deleteWatchJson(url) {
  const response = await fetch(url, { method: "DELETE", cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success) throw new Error(data.error || `${url} returned ${response.status}`);
  return data;
}

function flattenWatchlist(watchlist = {}) {
  return Array.from(new Set([
    ...(watchlist.crypto || []),
    ...(watchlist.stocks || [])
  ].map((symbol) => String(symbol).toUpperCase())));
}

function watchAssetRow(asset) {
  const moveClass = watchMoveClass(asset.changePct);
  return `
    <div class="asset-table-row watchlist-row">
      <span>
        ${watchLogoMarkup(asset)}
        <a href="demo-asset.html?symbol=${encodeURIComponent(asset.symbol)}">
          <span class="asset-copy">
            <b>${escapeWatchHtml(asset.symbol)}</b>
            <small>${escapeWatchHtml(asset.name || asset.symbol)}</small>
          </span>
        </a>
      </span>
      <span>${escapeWatchHtml(formatWatchPrice(asset.price, asset.currency || "USD"))}</span>
      <span class="${moveClass}">${escapeWatchHtml(watchMove(asset.changePct))}</span>
      <span class="watchlist-menu-cell">
        <button class="asset-row-menu-button" type="button" data-watch-menu-symbol="${escapeWatchHtml(asset.symbol)}" aria-label="More ${escapeWatchHtml(asset.symbol)} actions" aria-expanded="false">...</button>
        <div class="asset-row-menu" data-watch-menu="${escapeWatchHtml(asset.symbol)}" hidden>
          <button type="button" data-watch-remove-symbol="${escapeWatchHtml(asset.symbol)}">Remove from watchlist</button>
        </div>
      </span>
    </div>
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
    ? `
      <div class="asset-table-row head">
        <span>Asset</span>
        <span>Price</span>
        <span>Move</span>
        <span>Status</span>
      </div>
      ${assets.map(watchAssetRow).join("")}
    `
    : `
      <div class="asset-table-row head">
        <span>Asset</span>
        <span>Price</span>
        <span>Move</span>
        <span>Status</span>
      </div>
      <div class="asset-table-row">
        <span>No saved assets match that search.</span>
        <span>-</span>
        <span>-</span>
        <span>Empty</span>
      </div>
    `;

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
      document.getElementById("watchlist-sidebar-balance").textContent = `${formatWatchPrice(wallet.wallet.cashBalance, "USD")} USD`;
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

document.addEventListener("click", async (event) => {
  const menuButton = event.target.closest("[data-watch-menu-symbol]");
  if (menuButton) {
    const symbol = menuButton.dataset.watchMenuSymbol;
    document.querySelectorAll("[data-watch-menu]").forEach((menu) => {
      const isTarget = menu.dataset.watchMenu === symbol;
      menu.hidden = !isTarget || !menu.hidden;
    });
    document.querySelectorAll("[data-watch-menu-symbol]").forEach((button) => {
      const expanded = button === menuButton && !document.querySelector(`[data-watch-menu="${cssWatchValue(symbol)}"]`)?.hidden;
      button.setAttribute("aria-expanded", String(expanded));
    });
    return;
  }

  const removeButton = event.target.closest("[data-watch-remove-symbol]");
  if (removeButton) {
    const symbol = removeButton.dataset.watchRemoveSymbol;
    removeButton.disabled = true;
    try {
      const data = await deleteWatchJson(`/api/demo/watchlist/${encodeURIComponent(symbol)}`);
      watchSymbols = flattenWatchlist(data.watchlist);
      renderWatchlist();
    } catch (err) {
      console.warn("Watchlist remove failed:", err);
      removeButton.disabled = false;
    }
    return;
  }

  if (!event.target.closest(".watchlist-row")) {
    document.querySelectorAll("[data-watch-menu]").forEach((menu) => {
      menu.hidden = true;
    });
    document.querySelectorAll("[data-watch-menu-symbol]").forEach((button) => {
      button.setAttribute("aria-expanded", "false");
    });
  }
});

loadWatchlist();
