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

let newsItems = [];
let activeNewsIndex = 0;
let newsSlideTimer = null;

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

function formatMove(value) {
  const number = Number(value);
  if (!isFinite(number)) return "Live feed";
  const arrow = number > 0 ? "&uarr;" : number < 0 ? "&darr;" : "&rarr;";
  return `${arrow} ${formatPct(number)}`;
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
          <span class="${changeClass(change)}">${formatMove(change)}</span>
        </div>
      </div>
    `;
  }).join("");
}

function renderHeroPulse(cryptoAssets, stockAssets, signals = {}) {
  const target = document.getElementById("hero-market-grid");
  const status = document.getElementById("market-status");
  if (!target) return;

  const btc = cryptoAssets.find((asset) => asset.id === "bitcoin") || cryptoAssets[0];
  const spy = stockAssets.find((asset) => String(asset.symbol).toLowerCase().includes("spy")) || stockAssets[0];
  const gold = signals.gold;

  target.innerHTML = `
    <div class="pulse-card">
      <span>Bitcoin</span>
      <strong>${btc?.price ? formatMoney(btc.price, true) : "Unavailable"}</strong>
      <small class="${changeClass(btc?.changePct)}">${formatMove(btc?.changePct)}</small>
    </div>
    <div class="pulse-card">
      <span>S&P ETF</span>
      <strong>${spy?.price ? formatMoney(spy.price) : "Unavailable"}</strong>
      <small class="${changeClass(spy?.changePct)}">${formatMove(spy?.changePct)}</small>
    </div>
    <div class="pulse-card">
      <span>Gold</span>
      <strong>${gold?.price ? formatMoney(gold.price) : "Watching"}</strong>
      <small class="${changeClass(gold?.changePct)}">${gold?.changePct == null ? "Reserve signal" : formatMove(gold.changePct)}</small>
    </div>
    <div class="pulse-card">
      <span>Economy</span>
      <strong>Watching</strong>
      <small>Rates and inflation</small>
    </div>
  `;

  if (status) status.textContent = "Live data active";
}

function renderActiveNews() {
  const target = document.getElementById("news-feed");
  if (!target) return;
  if (!newsItems.length) {
    target.innerHTML = `
      <article class="news-feature">
        <div class="news-feature-image"></div>
        <div class="news-feature-copy">
          <span>Markets</span>
          <h3>Important finance news will appear here.</h3>
          <p>Autody is checking for useful market stories.</p>
        </div>
      </article>
    `;
    return;
  }

  const article = newsItems[activeNewsIndex] || newsItems[0];
  const dots = newsItems.map((_, index) => `<button type="button" class="news-dot ${index === activeNewsIndex ? "active" : ""}" data-news-index="${index}" aria-label="Show story ${index + 1}"></button>`).join("");

  target.innerHTML = `
    <article class="news-feature">
      <img src="${escapeHtml(article.image || "")}" alt="" loading="lazy">
      <div class="news-feature-copy">
        <span>${escapeHtml(article.subject || "Markets")}</span>
        <h3>${escapeHtml(article.title || "Market story")}</h3>
        <p>Source: ${escapeHtml(article.source || "Finance news")}</p>
      </div>
      <div class="news-controls" aria-label="News carousel controls">
        <button type="button" class="news-arrow" data-news-action="prev" aria-label="Previous story">‹</button>
        <div class="news-dots">${dots}</div>
        <button type="button" class="news-arrow" data-news-action="next" aria-label="Next story">›</button>
      </div>
    </article>
  `;
}

function setActiveNews(index) {
  if (!newsItems.length) return;
  activeNewsIndex = (index + newsItems.length) % newsItems.length;
  renderActiveNews();
}

function renderNews(articles) {
  newsItems = articles.slice(0, 9);
  activeNewsIndex = 0;
  renderActiveNews();

  if (newsSlideTimer) clearInterval(newsSlideTimer);
  newsSlideTimer = setInterval(() => setActiveNews(activeNewsIndex + 1), 9000);
}

async function loadMarketData() {
  const status = document.getElementById("market-status");

  const [cryptoResult, stocksResult, signalsResult] = await Promise.allSettled([
    getJson("/api/markets/crypto"),
    getJson("/api/markets/stocks"),
    getJson("/api/markets/signals")
  ]);

  const crypto = cryptoResult.status === "fulfilled" ? cryptoResult.value : { assets: [] };
  const stocks = stocksResult.status === "fulfilled" ? stocksResult.value : { assets: [] };
  const signals = signalsResult.status === "fulfilled" ? signalsResult.value : {};

  const cryptoAssets = crypto.assets || [];
  const stockAssets = stocks.assets || [];

  if (cryptoResult.status === "rejected") console.warn("Crypto market data failed:", cryptoResult.reason);
  if (stocksResult.status === "rejected") console.warn("Stock market data failed:", stocksResult.reason);
  if (signalsResult.status === "rejected") console.warn("Signal data failed:", signalsResult.reason);

  renderMarketList("crypto-market-list", cryptoAssets, { compact: true });
  renderMarketList("stock-market-list", stockAssets);
  renderHeroPulse(cryptoAssets, stockAssets, signals);

  const usingFallback = crypto.fallback || stocks.fallback || signals.fallback;
  if (status) status.textContent = usingFallback ? "Market preview active" : "Live data active";
}

async function loadNewsData() {
  const newsResult = await Promise.allSettled([getJson("/api/news")]);
  const news = newsResult[0].status === "fulfilled" ? newsResult[0].value : { articles: [] };
  const articles = news.articles || [];

  if (newsResult[0].status === "rejected") console.warn("News data failed:", newsResult[0].reason);

  renderNews(articles);

  const newsUpdated = document.getElementById("news-updated");
  if (newsUpdated) {
    newsUpdated.textContent = `Checking for important stories throughout the day. Last checked ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`;
  }
}

document.addEventListener("click", (event) => {
  const arrow = event.target.closest("[data-news-action]");
  if (arrow?.dataset.newsAction === "next") setActiveNews(activeNewsIndex + 1);
  if (arrow?.dataset.newsAction === "prev") setActiveNews(activeNewsIndex - 1);

  const dot = event.target.closest("[data-news-index]");
  if (dot) setActiveNews(Number(dot.dataset.newsIndex));
});

document.addEventListener("DOMContentLoaded", () => {
  loadMarketData();
  loadNewsData();
  setInterval(loadMarketData, 60000);
  setInterval(loadNewsData, 1800000);
});
