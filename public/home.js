const moneyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2
});

const compactMoneyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 2
});

function formatMoney(value, compact = false) {
  const number = Number(value);
  if (!isFinite(number)) return "-";
  return compact ? compactMoneyFormatter.format(number) : moneyFormatter.format(number);
}

function formatPct(value) {
  const number = Number(value);
  if (!isFinite(number)) return "0.00%";
  const sign = number > 0 ? "+" : "";
  return `${sign}${number.toFixed(2)}%`;
}

function changeClass(value) {
  const number = Number(value);
  if (!isFinite(number) || number === 0) return "";
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
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

function renderMarketList(targetId, assets, options = {}) {
  const target = document.getElementById(targetId);
  if (!target) return;

  target.innerHTML = assets.slice(0, 5).map((asset) => {
    const change = asset.changePct ?? 0;
    return `
      <div class="market-row">
        <div>
          <strong>${asset.name || asset.symbol || "Market"}</strong>
          <span>${asset.symbol || asset.id || "Live"}</span>
        </div>
        <div>
          <strong>${formatMoney(asset.price, options.compact)}</strong>
          <span class="${changeClass(change)}">${formatPct(change)}</span>
        </div>
      </div>
    `;
  }).join("");
}

function renderHeroPulse(cryptoAssets, stockAssets, newsCount) {
  const target = document.getElementById("hero-market-grid");
  const status = document.getElementById("market-status");
  if (!target) return;

  const btc = cryptoAssets.find((asset) => asset.id === "bitcoin") || cryptoAssets[0];
  const spy = stockAssets.find((asset) => String(asset.symbol).toLowerCase().includes("spy")) || stockAssets[0];

  target.innerHTML = `
    <div class="pulse-card">
      <span>Bitcoin</span>
      <strong>${formatMoney(btc?.price, true)}</strong>
      <small class="${changeClass(btc?.changePct)}">${formatPct(btc?.changePct)}</small>
    </div>
    <div class="pulse-card">
      <span>S&P ETF</span>
      <strong>${formatMoney(spy?.price)}</strong>
      <small class="${changeClass(spy?.changePct)}">${formatPct(spy?.changePct)}</small>
    </div>
    <div class="pulse-card">
      <span>Gold</span>
      <strong>Reserve view</strong>
      <small>AU confidence layer</small>
    </div>
    <div class="pulse-card">
      <span>Economy</span>
      <strong>Watching</strong>
      <small>Rates and inflation</small>
    </div>
  `;

  if (status) status.textContent = "Live data active";
}

function renderNews(articles) {
  const target = document.getElementById("news-feed");
  if (!target) return;

  target.innerHTML = articles.slice(0, 6).map((article, index) => `
    <article class="news-card ${article.image ? "has-image" : ""}">
      ${article.image ? `<img src="${escapeHtml(article.image)}" alt="" loading="lazy">` : ""}
      <div>
        <span>${escapeHtml(article.subject || "Markets")}</span>
        <h3>${escapeHtml(article.title || "Market story")}</h3>
        <p>Source: ${escapeHtml(article.source || "Finance news")}</p>
      </div>
    </article>
  `).join("");
}

async function loadHomeData() {
  const status = document.getElementById("market-status");

  const [cryptoResult, stocksResult, newsResult] = await Promise.allSettled([
    getJson("/api/markets/crypto"),
    getJson("/api/markets/stocks"),
    getJson("/api/news")
  ]);

  const crypto = cryptoResult.status === "fulfilled" ? cryptoResult.value : { assets: [] };
  const stocks = stocksResult.status === "fulfilled" ? stocksResult.value : { assets: [] };
  const news = newsResult.status === "fulfilled" ? newsResult.value : { articles: [] };

  const cryptoAssets = crypto.assets || [];
  const stockAssets = stocks.assets || [];
  const articles = news.articles || [];

  if (cryptoResult.status === "rejected") console.warn("Crypto market data failed:", cryptoResult.reason);
  if (stocksResult.status === "rejected") console.warn("Stock market data failed:", stocksResult.reason);
  if (newsResult.status === "rejected") console.warn("News data failed:", newsResult.reason);

  renderMarketList("crypto-market-list", cryptoAssets, { compact: true });
  renderMarketList("stock-market-list", stockAssets);
  renderNews(articles);
  renderHeroPulse(cryptoAssets, stockAssets, articles.length);

  const usingFallback = crypto.fallback || stocks.fallback || news.fallback;
  if (status) status.textContent = usingFallback ? "Market preview active" : "Live data active";
  const newsUpdated = document.getElementById("news-updated");
  if (newsUpdated) {
    newsUpdated.textContent = `Checking every minute. Last checked ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  loadHomeData();
  setInterval(loadHomeData, 60000);
});
