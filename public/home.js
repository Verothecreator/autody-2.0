let newsItems = [];
let activeNewsIndex = 0;
let newsSlideTimer = null;
let marketRefreshTimer = null;
let newsRefreshTimer = null;

const HOME_MARKET_REFRESH_MS = 10000;
const HOME_NEWS_REFRESH_MS = 1800000;
const HOME_CRYPTO_SYMBOLS = ["BTC", "ETH", "BCH", "SOL", "BNB", "XRP"];
const HOME_STOCK_SYMBOLS = ["SPY", "QQQ", "AAPL", "NVDA", "TSLA", "MSFT"];
const HOME_STABLE_SYMBOLS = new Set(["USDT", "USDC", "DAI", "PYUSD", "FDUSD", "TUSD", "USDE", "USD1", "USDD", "FRAX"]);

function priceDigits(number, compact = false) {
  if (compact) return 2;
  if (Math.abs(number) < 0.01) return 8;
  if (Math.abs(number) < 1) return 4;
  return 2;
}

function formatMoney(value, compact = false, currency = "USD") {
  const number = Number(value);
  if (!isFinite(number)) return "-";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: priceDigits(number, compact)
  }).format(number);
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
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

function normalizeSymbol(value = "") {
  return String(value || "").trim().toUpperCase();
}

function orderedAssetsFromCatalog(catalog = [], symbols = []) {
  const bySymbol = new Map(
    catalog
      .filter(Boolean)
      .map((asset) => [normalizeSymbol(asset.symbol), asset])
  );

  return symbols
    .map((symbol) => bySymbol.get(normalizeSymbol(symbol)))
    .filter(Boolean);
}

function fillAssetsFromCatalog(selected = [], catalog = [], predicate = () => true, limit = 6) {
  const used = new Set(selected.map((asset) => normalizeSymbol(asset.symbol)));
  const extra = catalog
    .filter((asset) => asset?.symbol && !used.has(normalizeSymbol(asset.symbol)))
    .filter(predicate)
    .slice(0, Math.max(0, limit - selected.length));
  return [...selected, ...extra].slice(0, limit);
}

function firstCatalogMatch(catalog = [], symbols = []) {
  return orderedAssetsFromCatalog(catalog, symbols)[0] || null;
}

function renderMarketList(targetId, assets, options = {}) {
  const target = document.getElementById(targetId);
  if (!target) return;

  target.innerHTML = assets.slice(0, 6).map((asset) => {
    const change = asset.changePct ?? 0;
    return `
      <div class="market-row">
        <div>
          <strong>${asset.name || asset.symbol || "Market"}</strong>
          <span>${asset.symbol || asset.id || "Live"}</span>
        </div>
        <div>
          <strong>${formatMoney(asset.price, options.compact, asset.currency || "USD")}</strong>
          <span class="${changeClass(change)}">${formatMove(change)}</span>
        </div>
      </div>
    `;
  }).join("");
}

function renderHeroPulse(cryptoAssets, stockAssets, signals = {}, catalog = []) {
  const target = document.getElementById("hero-market-grid");
  const status = document.getElementById("market-status");
  if (!target) return;

  const btc = firstCatalogMatch(cryptoAssets, ["BTC"]) || cryptoAssets[0];
  const spy = firstCatalogMatch(stockAssets, ["SPY", "VOO", "IVV"]) || stockAssets[0];
  const gold = firstCatalogMatch(catalog, ["GLD", "GC=F"]) || signals.gold;
  const economy = signals.economy;

  target.innerHTML = `
    <div class="pulse-card">
      <span>Bitcoin</span>
      <strong>${btc?.price ? formatMoney(btc.price, true, btc.currency || "USD") : "Unavailable"}</strong>
      <small class="${changeClass(btc?.changePct)}">${formatMove(btc?.changePct)}</small>
    </div>
    <div class="pulse-card">
      <span>S&P ETF</span>
      <strong>${spy?.price ? formatMoney(spy.price, false, spy.currency || "USD") : "Unavailable"}</strong>
      <small class="${changeClass(spy?.changePct)}">${formatMove(spy?.changePct)}</small>
    </div>
    <div class="pulse-card">
      <span>Gold</span>
      <strong>${gold?.price ? formatMoney(gold.price) : "Watching"}</strong>
      <small class="${changeClass(gold?.changePct)}">${gold?.changePct == null ? "Reserve signal" : formatMove(gold.changePct)}</small>
    </div>
    <div class="pulse-card">
      <span>Economy</span>
      <strong>${economy?.value ? `${Number(economy.value).toFixed(2)}%` : "Watching"}</strong>
      <small class="${changeClass(economy?.changePct)}">${economy?.changePct == null ? "10Y yield signal" : formatMove(economy.changePct)}</small>
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

  const [catalogResult, signalsResult] = await Promise.allSettled([
    getJson("/api/markets/catalog?type=all"),
    getJson("/api/markets/signals")
  ]);

  const catalogData = catalogResult.status === "fulfilled" ? catalogResult.value : { assets: [] };
  const signals = signalsResult.status === "fulfilled" ? signalsResult.value : {};
  const catalog = catalogData.assets || [];

  const cryptoAssets = fillAssetsFromCatalog(
    orderedAssetsFromCatalog(catalog, HOME_CRYPTO_SYMBOLS),
    catalog,
    (asset) => asset.assetType === "crypto" && !HOME_STABLE_SYMBOLS.has(normalizeSymbol(asset.symbol))
  );
  const stockAssets = fillAssetsFromCatalog(
    orderedAssetsFromCatalog(catalog, HOME_STOCK_SYMBOLS),
    catalog,
    (asset) => ["stock", "etf"].includes(asset.assetType)
  );

  if (catalogResult.status === "rejected") console.warn("Market catalog data failed:", catalogResult.reason);
  if (signalsResult.status === "rejected") console.warn("Signal data failed:", signalsResult.reason);

  renderMarketList("crypto-market-list", cryptoAssets, { compact: true });
  renderMarketList("stock-market-list", stockAssets);
  renderHeroPulse(cryptoAssets, stockAssets, signals, catalog);

  const usingFallback = catalogData.fallback || signals.fallback;
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
    newsUpdated.textContent = "Checking for important stories throughout the day.";
  }
}

function setPublicSupportOpen(open) {
  const modal = document.querySelector("[data-public-support-modal]");
  if (!modal) return;
  modal.hidden = !open;
  document.body.classList.toggle("modal-open", open);
  if (open) {
    window.setTimeout(() => document.getElementById("public-support-email")?.focus(), 50);
  }
}

function setPublicSupportStatus(message = "", tone = "info") {
  const status = document.getElementById("public-support-status");
  if (!status) return;
  status.textContent = message;
  status.dataset.tone = tone;
}

function publicSupportPayload() {
  return {
    name: document.getElementById("public-support-name")?.value?.trim() || "",
    email: document.getElementById("public-support-email")?.value?.trim() || "",
    category: document.getElementById("public-support-type")?.value?.trim() || "General question",
    topic: document.getElementById("public-support-topic")?.value?.trim() || "Homepage support request",
    message: document.getElementById("public-support-message")?.value?.trim() || "",
    mode: "public"
  };
}

document.addEventListener("click", (event) => {
  if (event.target.closest("[data-public-support-open]")) {
    setPublicSupportOpen(true);
    return;
  }

  if (event.target.closest("[data-public-support-close]")) {
    setPublicSupportOpen(false);
    return;
  }

  const supportModal = event.target.closest("[data-public-support-modal]");
  if (supportModal && event.target === supportModal) {
    setPublicSupportOpen(false);
    return;
  }

  const arrow = event.target.closest("[data-news-action]");
  if (arrow?.dataset.newsAction === "next") setActiveNews(activeNewsIndex + 1);
  if (arrow?.dataset.newsAction === "prev") setActiveNews(activeNewsIndex - 1);

  const dot = event.target.closest("[data-news-index]");
  if (dot) setActiveNews(Number(dot.dataset.newsIndex));
});

document.getElementById("public-support-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = publicSupportPayload();
  if (!payload.email || !payload.message) {
    setPublicSupportStatus("Enter your email and message before submitting.", "error");
    return;
  }
  const submitButton = form.querySelector("button[type='submit']");
  const originalText = submitButton?.textContent || "Submit Ticket";
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = "Submitting";
  }
  setPublicSupportStatus("Sending ticket...", "info");
  try {
    const response = await fetch("/api/public/support/tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) throw new Error(data.error || "Ticket could not be submitted.");
    form.reset();
    setPublicSupportStatus("Ticket submitted. Autody will follow up by email.", "success");
  } catch (err) {
    setPublicSupportStatus(err.message || "Ticket could not be submitted. Please try again.", "error");
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = originalText;
    }
  }
});

document.addEventListener("DOMContentLoaded", () => {
  loadMarketData();
  loadNewsData();
  marketRefreshTimer = setInterval(loadMarketData, HOME_MARKET_REFRESH_MS);
  newsRefreshTimer = setInterval(loadNewsData, HOME_NEWS_REFRESH_MS);
});

window.addEventListener("focus", loadMarketData);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  loadMarketData();
  loadNewsData();
});
