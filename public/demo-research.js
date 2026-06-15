const RESEARCH_REFRESH_MS = 30000;
const RESEARCH_NEWS_SLIDE_MS = 9000;

let researchArticles = [];
let activeResearchArticleIndex = 0;
let researchNewsTimer = null;

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

function formatResearchPrice(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "Live feed";
  return formatResearchMoney(number);
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

function formatResearchDate(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "Recent";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function articleSubject(article = {}) {
  return article.subject || article.source || "Markets";
}

function articleSummary(article = {}) {
  if (article.summary && !/open the source/i.test(article.summary)) return article.summary;
  const subject = String(articleSubject(article)).toLowerCase();
  if (subject.includes("crypto")) return "Digital asset traders are watching liquidity, token flows, and risk appetite before making the next move.";
  if (subject.includes("business")) return "Business headlines can move stock sentiment, earnings expectations, and sector confidence.";
  if (subject.includes("economy")) return "Macro data can affect rates, inflation expectations, commodities, stocks, and crypto risk appetite.";
  return "This story is part of the broader market picture Autody is tracking for account decisions.";
}

function articleMarketAngle(article = {}) {
  const text = `${article.title || ""} ${article.subject || ""}`.toLowerCase();
  if (/fed|rate|inflation|jobs|consumer|gdp/.test(text)) return "Macro pressure";
  if (/bitcoin|crypto|token|stablecoin|wallet|ethereum/.test(text)) return "Digital assets";
  if (/earnings|stock|shares|nasdaq|s&p|ai|company/.test(text)) return "Equities";
  if (/gold|oil|metal|commodity|energy/.test(text)) return "Commodities";
  return "Market context";
}

function articleAccountAngle(article = {}) {
  const angle = articleMarketAngle(article);
  if (angle === "Digital assets") return "Compare with crypto holdings, swap plans, and watchlist coins.";
  if (angle === "Equities") return "Check whether stock positions or watchlist names are exposed to this theme.";
  if (angle === "Commodities") return "Watch inflation signals, gold confidence, oil pressure, and reserve-sensitive assets.";
  if (angle === "Macro pressure") return "Review buying power, risk level, and whether markets are reacting to rates or inflation.";
  return "Use the story as background before opening a new order.";
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
  const assets = symbols.map((symbol) => catalogMap.get(symbol) || { symbol, name: symbol }).slice(0, 6);
  const target = document.getElementById("research-watchlist");
  target.innerHTML = assets.length
    ? assets.map((asset) => `
      <article class="research-watch-item">
        <div>
          <span>${escapeResearchHtml(asset.symbol)} / ${escapeResearchHtml(researchAssetLabel(asset))}</span>
          <h3>${escapeResearchHtml(asset.name || asset.symbol)}</h3>
        </div>
        <strong>${escapeResearchHtml(formatResearchPrice(asset.price))}</strong>
        <em class="${researchTone(asset.changePct)}">${escapeResearchHtml(formatResearchMove(asset.changePct))}</em>
      </article>
    `).join("")
    : `
      <article>
        <span>No saved assets</span>
        <h3>Add assets from Markets or Wallet to build a personal research feed.</h3>
      </article>
    `;
}

function renderResearchNewsSlide() {
  const target = document.getElementById("research-news");
  const count = document.getElementById("research-news-count");
  if (!target) return;

  if (!researchArticles.length) {
    if (count) count.textContent = "Checking";
    target.innerHTML = `
      <article class="research-news-empty">
        <span>Checking</span>
        <h3>Autody is checking important finance stories throughout the day.</h3>
      </article>
    `;
    return;
  }

  activeResearchArticleIndex = (activeResearchArticleIndex + researchArticles.length) % researchArticles.length;
  const article = researchArticles[activeResearchArticleIndex];
  const imageMarkup = article.image
    ? `<img src="${escapeResearchHtml(article.image)}" alt="" loading="lazy" />`
    : `<div class="research-news-image-fallback"><span>${escapeResearchHtml(articleMarketAngle(article))}</span></div>`;
  const dots = researchArticles.map((_, index) => (
    `<button type="button" class="research-news-dot ${index === activeResearchArticleIndex ? "active" : ""}" data-research-news-index="${index}" aria-label="Show story ${index + 1}"></button>`
  )).join("");

  if (count) count.textContent = `${activeResearchArticleIndex + 1} of ${researchArticles.length}`;

  target.innerHTML = `
    <article class="research-news-feature">
      <div class="research-news-media">
        ${imageMarkup}
      </div>
      <div class="research-news-copy">
        <span>${escapeResearchHtml(articleSubject(article))}</span>
        <h3>${escapeResearchHtml(article.title || "Market story")}</h3>
        <p>${escapeResearchHtml(articleSummary(article))}</p>
        <div class="research-news-facts">
          <div>
            <small>Source</small>
            <strong>${escapeResearchHtml(article.source || "Finance news")}</strong>
          </div>
          <div>
            <small>Market angle</small>
            <strong>${escapeResearchHtml(articleMarketAngle(article))}</strong>
          </div>
          <div>
            <small>Account angle</small>
            <strong>${escapeResearchHtml(articleAccountAngle(article))}</strong>
          </div>
          <div>
            <small>Published</small>
            <strong>${escapeResearchHtml(formatResearchDate(article.publishedAt || article.capturedAt))}</strong>
          </div>
        </div>
        <div class="research-news-controls">
          <button type="button" class="research-news-arrow" data-research-news-action="prev" aria-label="Previous story">&lsaquo;</button>
          <div class="research-news-dots">${dots}</div>
          <button type="button" class="research-news-arrow" data-research-news-action="next" aria-label="Next story">&rsaquo;</button>
        </div>
      </div>
    </article>
  `;
}

function setActiveResearchArticle(index, resetTimer = true) {
  if (!researchArticles.length) return;
  activeResearchArticleIndex = (index + researchArticles.length) % researchArticles.length;
  renderResearchNewsSlide();
  if (resetTimer && researchNewsTimer) {
    clearInterval(researchNewsTimer);
    researchNewsTimer = setInterval(() => setActiveResearchArticle(activeResearchArticleIndex + 1, false), RESEARCH_NEWS_SLIDE_MS);
  }
}

function renderResearchNews(articles = []) {
  const currentTitle = researchArticles[activeResearchArticleIndex]?.title;
  researchArticles = articles
    .filter((article) => article?.title)
    .slice(0, 10);

  const preservedIndex = researchArticles.findIndex((article) => article.title === currentTitle);
  activeResearchArticleIndex = preservedIndex >= 0 ? preservedIndex : 0;
  renderResearchNewsSlide();

  if (researchNewsTimer) clearInterval(researchNewsTimer);
  if (researchArticles.length > 1) {
    researchNewsTimer = setInterval(() => setActiveResearchArticle(activeResearchArticleIndex + 1, false), RESEARCH_NEWS_SLIDE_MS);
  }
}

function topHolding(wallet = {}) {
  return [...(wallet.holdings || [])]
    .filter((holding) => !["USD", "AU", "CRYPTO", "STOCKS"].includes(String(holding.symbol || "").toUpperCase()))
    .sort((a, b) => Number(b.valueUsd || 0) - Number(a.valueUsd || 0))[0];
}

function renderResearchPlan(wallet = {}, watchSymbols = []) {
  const positions = Number(wallet.positionsCount || 0);
  const cash = Number(wallet.cashBalance || 0);
  const holding = topHolding(wallet);
  const items = [
    {
      label: "Wallet",
      title: positions ? "Start with your biggest exposure" : "Choose the first asset with context",
      text: positions
        ? `${holding?.symbol || "Top holding"} is the biggest current exposure. Check its story, chart, and recent movement before adding more.`
        : "Pick a first demo asset after checking the market board and current news.",
      action: positions ? "Open wallet" : "Explore markets",
      href: positions ? "demo-wallet.html" : "demo-markets.html"
    },
    {
      label: "Risk",
      title: cash < 10000 ? "Protect buying power" : "Use available USD with intention",
      text: cash < 10000
        ? "USD funds are lower, so compare sell or swap choices before opening new buys."
        : "USD funds are healthy, so research can focus on timing and asset quality.",
      action: "Open orders",
      href: "demo-orders.html"
    },
    {
      label: "Watchlist",
      title: watchSymbols.length ? "Follow saved assets first" : "Build your research list",
      text: watchSymbols.length
        ? `${watchSymbols.slice(0, 3).join(", ")} ${watchSymbols.length > 3 ? "and more are" : "are"} saved for follow-up.`
        : "Add assets to the watchlist so this page can become more personal.",
      action: "Open watchlist",
      href: "demo-watchlist.html"
    },
    {
      label: "News",
      title: researchArticles.length ? "Connect the headline to the account" : "Let the live brief warm up",
      text: researchArticles.length
        ? "Read the current story brief, then compare it with holdings and watchlist assets."
        : "News is warming up; use the market and watchlist sections while stories load.",
      action: "View story brief",
      href: "#research-news"
    }
  ];

  document.getElementById("research-queue").innerHTML = items.map((item) => `
    <article class="research-plan-card">
      <span>${escapeResearchHtml(item.label)}</span>
      <h3>${escapeResearchHtml(item.title)}</h3>
      <p>${escapeResearchHtml(item.text)}</p>
      <a href="${escapeResearchHtml(item.href)}">${escapeResearchHtml(item.action)}</a>
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
    renderResearchPlan(wallet, watchSymbols);
  } catch (err) {
    console.warn("Research page failed:", err);
    document.getElementById("research-status").textContent = "Warming up";
  }
}

function refreshResearchWhenVisible() {
  if (document.hidden) return;
  loadResearchPage();
}

document.addEventListener("click", (event) => {
  const arrow = event.target.closest("[data-research-news-action]");
  if (arrow?.dataset.researchNewsAction === "next") setActiveResearchArticle(activeResearchArticleIndex + 1);
  if (arrow?.dataset.researchNewsAction === "prev") setActiveResearchArticle(activeResearchArticleIndex - 1);

  const dot = event.target.closest("[data-research-news-index]");
  if (dot) setActiveResearchArticle(Number(dot.dataset.researchNewsIndex));
});

loadResearchPage();
setInterval(refreshResearchWhenVisible, RESEARCH_REFRESH_MS);
window.addEventListener("focus", refreshResearchWhenVisible);
document.addEventListener("visibilitychange", refreshResearchWhenVisible);
