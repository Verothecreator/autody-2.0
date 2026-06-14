const RESEARCH_REFRESH_MS = 10000;

const researchMoney = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2
});

const researchWholeMoney = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0
});

function escapeResearchHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatResearchMoney(value, whole = false) {
  const number = Number(value);
  if (!Number.isFinite(number)) return whole ? "$0" : "$0.00";
  return whole ? researchWholeMoney.format(number) : researchMoney.format(number);
}

function formatResearchMove(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "+0.00%";
  const sign = number > 0 ? "+" : "";
  return `${sign}${number.toFixed(2)}%`;
}

function researchTone(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number === 0) return "flat";
  return number > 0 ? "gain" : "loss";
}

async function getResearchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

function flattenResearchWatchlist(watchlist = {}) {
  return Array.from(new Set([
    ...(watchlist.crypto || []),
    ...(watchlist.stocks || [])
  ].map((symbol) => String(symbol).toUpperCase())));
}

function researchAssetLabel(asset = {}) {
  if (asset.assetType === "crypto") return "Crypto";
  if (asset.assetType === "stock") return "Stock";
  if (asset.assetType === "etf") return "ETF";
  if (asset.assetType === "commodity") return "Oil and metals";
  return asset.market || "Market";
}

function renderResearchWallet(wallet = {}, watchSymbols = []) {
  const starting = Number(wallet.startingBalance || 50000);
  const total = Number(wallet.totalValue || starting);
  const profitLoss = total - starting;
  const profitLossPct = starting > 0 ? (profitLoss / starting) * 100 : 0;
  const tone = researchTone(profitLoss);

  document.getElementById("research-cash").textContent = formatResearchMoney(wallet.cashBalance, true);
  document.getElementById("research-profit-loss").textContent = formatResearchMoney(profitLoss);
  document.getElementById("research-profit-loss").className = tone;
  document.getElementById("research-return-label").textContent = `${formatResearchMove(profitLossPct)} total return`;
  document.getElementById("research-positions").textContent = String(wallet.positionsCount || 0);
  document.getElementById("research-watchlist-count").textContent = String(watchSymbols.length);
  document.getElementById("research-status").textContent = wallet.positionsCount ? "Active demo" : "Ready";

  const briefTitle = document.getElementById("research-brief-title");
  const briefCopy = document.getElementById("research-brief-copy");
  if (wallet.positionsCount) {
    briefTitle.textContent = "Your holdings are now part of the research story.";
    briefCopy.textContent = `This wallet is tracking ${wallet.positionsCount} held asset${wallet.positionsCount === 1 ? "" : "s"}, ${formatResearchMoney(wallet.cashBalance, true)} in USD funds, and market stories that can affect decisions.`;
  } else {
    briefTitle.textContent = "Build the first position with context.";
    briefCopy.textContent = "Use this page to compare live market stories, watchlist assets, and account readiness before placing a demo order.";
  }
}

function renderResearchWatchlist(symbols = [], catalog = []) {
  const catalogMap = new Map(catalog.map((asset) => [String(asset.symbol).toUpperCase(), asset]));
  const assets = symbols.map((symbol) => catalogMap.get(symbol)).filter(Boolean).slice(0, 6);
  const target = document.getElementById("research-watchlist");
  target.innerHTML = assets.length
    ? assets.map((asset) => `
      <article>
        <span>${escapeResearchHtml(asset.symbol)} / ${escapeResearchHtml(researchAssetLabel(asset))}</span>
        <h3>${escapeResearchHtml(asset.name || asset.symbol)}</h3>
      </article>
    `).join("")
    : `
      <article>
        <span>No saved assets</span>
        <h3>Add assets from Markets or Wallet to build a personal research feed.</h3>
      </article>
    `;
}

function renderResearchNews(articles = []) {
  const target = document.getElementById("research-news");
  const rows = articles.slice(0, 6);
  target.innerHTML = rows.length
    ? rows.map((article) => `
      <article>
        <span>${escapeResearchHtml(article.subject || article.source || "Markets")}</span>
        <h3>${escapeResearchHtml(article.title || "Market story")}</h3>
      </article>
    `).join("")
    : `
      <article>
        <span>Checking</span>
        <h3>Autody is checking important finance stories throughout the day.</h3>
      </article>
    `;
}

function renderResearchQueue(wallet = {}, watchSymbols = []) {
  const positions = Number(wallet.positionsCount || 0);
  const cash = Number(wallet.cashBalance || 0);
  const items = [
    {
      label: "Account",
      text: positions ? "Compare open positions with the latest market movers." : "Pick a first demo asset after checking the market board."
    },
    {
      label: "Risk",
      text: cash < 10000 ? "Buying power is lower, so review sell options before new buys." : "Buying power is healthy for practice orders."
    },
    {
      label: "Watchlist",
      text: watchSymbols.length ? "Review saved assets before opening a new position." : "Add assets to watchlist so research becomes more personal."
    }
  ];

  document.getElementById("research-queue").innerHTML = items.map((item) => `
    <article>
      <span>${escapeResearchHtml(item.label)}</span>
      <h3>${escapeResearchHtml(item.text)}</h3>
    </article>
  `).join("");
}

async function loadResearchPage() {
  try {
    const [walletData, watchlistData, catalogData, newsData] = await Promise.all([
      getResearchJson("/api/demo/wallet"),
      getResearchJson("/api/demo/watchlist").catch(() => ({ watchlist: {} })),
      getResearchJson("/api/markets/catalog?type=all").catch(() => ({ assets: [] })),
      getResearchJson("/api/news").catch(() => ({ articles: [] }))
    ]);

    const wallet = walletData.wallet || {};
    const watchSymbols = flattenResearchWatchlist(watchlistData.watchlist);
    renderResearchWallet(wallet, watchSymbols);
    renderResearchWatchlist(watchSymbols, catalogData.assets || []);
    renderResearchNews(newsData.articles || []);
    renderResearchQueue(wallet, watchSymbols);
  } catch (err) {
    console.warn("Research page failed:", err);
    document.getElementById("research-status").textContent = "Warming up";
  }
}

function refreshResearchWhenVisible() {
  if (document.hidden) return;
  loadResearchPage();
}

loadResearchPage();
setInterval(refreshResearchWhenVisible, RESEARCH_REFRESH_MS);
window.addEventListener("focus", refreshResearchWhenVisible);
document.addEventListener("visibilitychange", refreshResearchWhenVisible);
