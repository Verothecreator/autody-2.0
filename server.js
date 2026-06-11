const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const bodyParser = require("body-parser");
const { ethers } = require("ethers");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

const RPC = process.env.POLYGON_RPC;

// BUY CONTRACT
const BUY_CONTRACT_ADDRESS = process.env.BUY_CONTRACT_ADDRESS;

// ABI (only the function we call)
const BUY_ABI = [
    "function buyForBuyer(address buyer, uint256 auAmount) external",
    "function backend() view returns (address)"
];

// BACKEND PRIVATE KEY (VERY IMPORTANT)
const PRIVATE_KEY = process.env.BACKEND_PK;
if (!PRIVATE_KEY) {
    console.warn("BACKEND_PK is not set. Public site will run, but Transak webhook credits are disabled.");
}

// Transak Secret
const TRANSAK_SECRET = process.env.TRANSAK_SECRET;

// Orders store
const ORDER_STORE = path.join(__dirname, "orders.json");
if (!fs.existsSync(ORDER_STORE)) fs.writeFileSync(ORDER_STORE, "{}");

function loadOrders() {
    return JSON.parse(fs.readFileSync(ORDER_STORE));
}
function saveOrders(data) {
    fs.writeFileSync(ORDER_STORE, JSON.stringify(data, null, 2));
}

// ------------------ EXPRESS --------------------

// Transak requires raw body for signature hashing
app.use(bodyParser.raw({ type: "*/*" }));

app.use("/api", (req, res, next) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  next();
});

// ----------------------
// VERIFY TRANSAK SIGNATURE
// ----------------------
function validTransakSignature(req) {
    const signature = req.headers["x-transak-signature"];
    if (!signature || !TRANSAK_SECRET) return false;

    const computed = crypto
        .createHmac("sha256", TRANSAK_SECRET)
        .update(req.body)
        .digest("hex");

    return computed === signature;
}


// ----------------------
// WEBHOOK ENDPOINT
// ----------------------

app.post("/webhook/transak", async (req, res) => {
    try {
        if (!PRIVATE_KEY || !RPC || !BUY_CONTRACT_ADDRESS || !TRANSAK_SECRET) {
            console.error("Transak webhook is not configured. Missing BACKEND_PK, POLYGON_RPC, BUY_CONTRACT_ADDRESS, or TRANSAK_SECRET.");
            return res.status(503).send("Webhook not configured");
        }

        if (!validTransakSignature(req)) {
            console.log("❌ Invalid Transak signature");
            return res.status(401).send("Invalid signature");
        }

        const data = JSON.parse(req.body.toString());

        console.log("🟢 Webhook received:", data);

        const orderId = data?.id;
        const status = data?.status;
        const metadata = data?.metaData || {};
        const buyerWallet = metadata.wallet_to_credit;
        const auAmount = Number(metadata.au_amount);

        if (!orderId || !buyerWallet || !auAmount) {
            console.log("❌ Missing required metadata");
            return res.status(400).send("Missing metadata");
        }

        let orders = loadOrders();

        // Prevent double-credit
        if (orders[orderId]) {
            console.log("⚠ Order already processed:", orderId);
            return res.status(200).send("Already processed");
        }

        // Only credit AU after Transak confirms success
        if (status !== "COMPLETED") {
            console.log("⌛ Order not completed yet:", orderId, status);
            return res.status(200).send("Waiting for completion");
        }

        // ---------------------------
        // CALL THE BUY CONTRACT
        // ---------------------------
        const provider = new ethers.JsonRpcProvider(RPC);
        const backendWallet = new ethers.Wallet(PRIVATE_KEY, provider);

        const contract = new ethers.Contract(
            BUY_CONTRACT_ADDRESS,
            BUY_ABI,
            backendWallet
        );

        console.log("📤 Sending AU:", auAmount, "to", buyerWallet);

        const tx = await contract.buyForBuyer(buyerWallet, auAmount);
        const receipt = await tx.wait();

        console.log("✅ AU credited:", receipt.transactionHash);

        // Save order to prevent re-credit
        orders[orderId] = {
            buyer: buyerWallet,
            auAmount,
            tx: receipt.transactionHash,
            timestamp: Date.now()
        };
        saveOrders(orders);

        return res.status(200).send("Success");
    } catch (err) {
        console.error("❌ Webhook error:", err);
        return res.status(500).send("Server error");
    }
});

// ------------------ SERVE FRONTEND --------------------

const fallbackNews = [
  {
    title: "Markets watch inflation, rates, and consumer strength for the next signal.",
    source: "Autody market brief",
    url: "#",
    subject: "Economy",
    summary: "A quick economy brief focused on the market signals that can affect stocks, crypto, and consumer confidence.",
    image: "https://images.unsplash.com/photo-1551836022-d5d88e9218df?auto=format&fit=crop&w=1200&q=80"
  },
  {
    title: "Crypto traders keep liquidity, wallet activity, and risk appetite in focus.",
    source: "Autody market brief",
    url: "#",
    subject: "Crypto",
    summary: "A quick crypto brief focused on the conditions that can affect digital assets and wallet decisions.",
    image: "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=1200&q=80"
  },
  {
    title: "Stocks react to earnings guidance, AI spending, and global demand.",
    source: "Autody market brief",
    url: "#",
    subject: "Business",
    summary: "A quick business brief focused on company news and market pressure that can shape account decisions.",
    image: "https://images.unsplash.com/photo-1556761175-b413da4baf72?auto=format&fit=crop&w=1200&q=80"
  }
];

function parseStooqCsv(csv) {
  const lines = csv.trim().split(/\r?\n/);
  const headers = lines.shift().split(",");
  return lines.map((line) => {
    const values = line.split(",");
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index]]));
    const close = Number(row.Close);
    const open = Number(row.Open);
    const change = isFinite(close) && isFinite(open) && open > 0 ? ((close - open) / open) * 100 : null;
    return {
      symbol: row.Symbol,
      name: row.Symbol?.replace(".US", "").replace(".us", "").toUpperCase(),
      price: isFinite(close) ? close : null,
      changePct: change,
      date: row.Date,
      time: row.Time
    };
  });
}

async function fetchStooqQuotes(symbols) {
  const url = `https://stooq.com/q/l/?s=${symbols}&f=sd2t2ohlcv&h&e=csv`;
  const text = await fetch(url, {
    headers: {
      Accept: "text/csv",
      "User-Agent": "Autody/1.0 market preview"
    }
  }).then((r) => {
    if (!r.ok) throw new Error(`Stooq HTTP ${r.status}`);
    return r.text();
  });

  return parseStooqCsv(text).filter((asset) => asset.price != null);
}

async function fetchCoinbaseCrypto() {
  const products = [
    { id: "bitcoin", symbol: "BTC", name: "Bitcoin", product: "BTC-USD" },
    { id: "ethereum", symbol: "ETH", name: "Ethereum", product: "ETH-USD" },
    { id: "solana", symbol: "SOL", name: "Solana", product: "SOL-USD" },
    { id: "dogecoin", symbol: "DOGE", name: "Dogecoin", product: "DOGE-USD" }
  ];

  const assets = await Promise.all(products.map(async (asset) => {
    const [spot, stats] = await Promise.all([
      fetch(`https://api.coinbase.com/v2/prices/${asset.product}/spot`, {
        headers: { Accept: "application/json", "User-Agent": "Autody/1.0 market preview" }
      }).then((r) => {
        if (!r.ok) throw new Error(`Coinbase spot HTTP ${r.status}`);
        return r.json();
      }),
      fetch(`https://api.exchange.coinbase.com/products/${asset.product}/stats`, {
        headers: { Accept: "application/json", "User-Agent": "Autody/1.0 market preview" }
      }).then((r) => {
        if (!r.ok) throw new Error(`Coinbase stats HTTP ${r.status}`);
        return r.json();
      }).catch(() => null)
    ]);

    const price = Number(spot?.data?.amount);
    const open = Number(stats?.open);
    const changePct = isFinite(price) && isFinite(open) && open > 0 ? ((price - open) / open) * 100 : null;
    return { ...asset, price: isFinite(price) ? price : null, changePct, marketCap: null };
  }));

  return assets.filter((asset) => asset.price != null);
}

function decodeXml(value = "") {
  return String(value)
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function pickTag(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeXml(match[1]) : "";
}

function pickAttr(xml, attr) {
  const match = xml.match(new RegExp(`${attr}=["']([^"']+)["']`, "i"));
  return match ? decodeXml(match[1]) : "";
}

function parseRss(xml, fallbackSubject) {
  const items = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
  return items.map((item) => {
    const title = pickTag(item, "title");
    const description = pickTag(item, "description").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    const imageFromMedia = (item.match(/<media:content[^>]*>/i) || item.match(/<media:thumbnail[^>]*>/i) || [""])[0];
    const imageFromEnclosure = (item.match(/<enclosure[^>]*>/i) || [""])[0];
    const imageFromDescription = description.match(/<img[^>]+src=["']([^"']+)["']/i);
    const rawLink = pickTag(item, "link");

    return {
      title,
      source: pickTag(item, "source") || new URL(rawLink || "https://news.google.com").hostname.replace("www.", ""),
      url: rawLink,
      image: pickAttr(imageFromMedia, "url") || pickAttr(imageFromEnclosure, "url") || decodeXml(imageFromDescription?.[1] || ""),
      summary: description || "Open the source for the full story and market context.",
      publishedAt: pickTag(item, "pubDate") || pickTag(item, "dc:date") || null,
      subject: inferNewsSubject(title, fallbackSubject)
    };
  }).filter((article) => article.title && article.url);
}

function inferNewsSubject(title = "", fallback = "Markets") {
  const text = title.toLowerCase();
  if (/(bitcoin|crypto|ethereum|token|blockchain|stablecoin)/.test(text)) return "Crypto";
  if (/(stock|shares|nasdaq|s&p|dow|earnings|nvidia|apple|tesla|market)/.test(text)) return "Stocks";
  if (/(inflation|fed|rates|jobs|economy|tariff|gdp|dollar|treasury)/.test(text)) return "Economy";
  if (/(company|business|ceo|startup|profit|revenue|deal|merger)/.test(text)) return "Business";
  return fallback;
}

function scoreNews(article) {
  const text = `${article.title || ""} ${article.source || ""}`.toLowerCase();
  let score = 0;
  if (/(breaking|urgent|fed|inflation|rates|jobs|earnings|bitcoin|crypto|stock|market|tariff|recession|gold|oil)/.test(text)) score += 4;
  if (/(nvidia|apple|tesla|microsoft|amazon|ethereum|bitcoin|s&p|nasdaq|dow|gold|oil)/.test(text)) score += 3;
  if (article.image) score += 2;
  if (article.publishedAt) score += 1;
  return score;
}

function isCompetitorPromo(article) {
  const text = `${article.title || ""} ${article.source || ""} ${article.url || ""}`.toLowerCase();
  const competitorNames = /(binance|coinbase|kraken|bybit|okx|kucoin|robinhood|etoro|webull|revolut|crypto\.com)/;
  const promoTerms = /(how to|step[-\s]?by[-\s]?step|guide for beginners|buy and sell|sign up|referral|bonus|promo|coupon|tutorial|learn how)/;
  return competitorNames.test(text) && promoTerms.test(text);
}

function subjectImage(subject = "Markets") {
  const key = subject.toLowerCase();
  if (key.includes("crypto")) return "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=1200&q=80";
  if (key.includes("stock")) return "https://images.unsplash.com/photo-1551836022-d5d88e9218df?auto=format&fit=crop&w=1200&q=80";
  if (key.includes("business")) return "https://images.unsplash.com/photo-1556761175-b413da4baf72?auto=format&fit=crop&w=1200&q=80";
  if (key.includes("economy")) return "https://images.unsplash.com/photo-1551836022-d5d88e9218df?auto=format&fit=crop&w=1200&q=80";
  return "https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=1200&q=80";
}

function ensureArticleImage(article) {
  return {
    ...article,
    image: article.image || subjectImage(article.subject),
    summary: article.summary || "Open the source for the full story and market context."
  };
}

function uniqueArticles(articles) {
  const seen = new Set();
  return articles.filter((article) => {
    if (isCompetitorPromo(article)) return false;
    const key = (article.title || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 90);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

app.get("/api/markets/crypto", async (req, res) => {
  try {
    const ids = "bitcoin,ethereum,solana,dogecoin,polygon-ecosystem-token";
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true`;
    const json = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Autody/1.0 market preview"
      }
    }).then((r) => {
      if (!r.ok) throw new Error(`CoinGecko HTTP ${r.status}`);
      return r.json();
    });

    const labels = {
      bitcoin: "Bitcoin",
      ethereum: "Ethereum",
      solana: "Solana",
      dogecoin: "Dogecoin",
      "polygon-ecosystem-token": "Polygon"
    };

    return res.json({
      success: true,
      provider: "coingecko",
      assets: Object.entries(json).map(([id, data]) => ({
        id,
        name: labels[id] || id,
        symbol: id === "bitcoin" ? "BTC" : id === "ethereum" ? "ETH" : id === "solana" ? "SOL" : id === "dogecoin" ? "DOGE" : "POL",
        price: data.usd ?? null,
        changePct: data.usd_24h_change ?? null,
        marketCap: data.usd_market_cap ?? null
      }))
    });
  } catch (err) {
    console.error("Crypto market proxy error:", err);
    try {
      const assets = await fetchCoinbaseCrypto();
      return res.json({ success: true, provider: "coinbase", assets });
    } catch (fallbackErr) {
      console.error("Coinbase crypto fallback error:", fallbackErr);
      return res.json({
        success: true,
        fallback: true,
        error: "Live crypto providers unavailable",
        assets: []
      });
    }
  }
});

app.get("/api/markets/stocks", async (req, res) => {
  try {
    const symbols = "SPY,QQQ,AAPL,NVDA,TSLA,MSFT,AMZN";
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols}&fields=symbol,shortName,regularMarketPrice,regularMarketChangePercent,regularMarketTime`;
    const json = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Autody/1.0 market preview"
      }
    }).then((r) => {
      if (!r.ok) throw new Error(`Yahoo Finance HTTP ${r.status}`);
      return r.json();
    });

    const assets = (json.quoteResponse?.result || []).map((quote) => ({
      symbol: quote.symbol,
      name: quote.shortName || quote.symbol,
      price: quote.regularMarketPrice ?? null,
      changePct: quote.regularMarketChangePercent ?? null,
      date: quote.regularMarketTime ? new Date(quote.regularMarketTime * 1000).toISOString() : null,
      time: quote.regularMarketTime ?? null
    })).filter((asset) => asset.price != null);

    return res.json({ success: true, provider: "yahoo", assets });
  } catch (err) {
    console.error("Stock market proxy error:", err);
    try {
      const assets = await fetchStooqQuotes("spy.us,qqq.us,aapl.us,nvda.us,tsla.us,msft.us,amzn.us");
      return res.json({ success: true, provider: "stooq", assets });
    } catch (fallbackErr) {
      console.error("Stooq stock fallback error:", fallbackErr);
      return res.json({
        success: true,
        fallback: true,
        error: "Live stock providers unavailable",
        assets: []
      });
    }
  }
});

app.get("/api/markets/signals", async (req, res) => {
  try {
    const gold = (await fetchStooqQuotes("xauusd")).find((asset) => asset.price != null);
    return res.json({
      success: true,
      gold: gold ? {
        symbol: "XAU/USD",
        name: "Gold spot",
        price: gold.price,
        changePct: gold.changePct,
        date: gold.date,
        time: gold.time
      } : null,
      economy: {
        name: "Economy",
        status: "Watching",
        detail: "Rates and inflation"
      }
    });
  } catch (err) {
    console.error("Signal proxy error:", err);
    return res.json({
      success: true,
      fallback: true,
      gold: null,
      economy: {
        name: "Economy",
        status: "Watching",
        detail: "Rates and inflation"
      }
    });
  }
});

app.get("/api/news", async (req, res) => {
  try {
    const gdeltQuery = encodeURIComponent("(finance OR markets OR stocks OR crypto OR economy OR business OR gold)");
    const gdeltUrl = `https://api.gdeltproject.org/api/v2/doc/doc?query=${gdeltQuery}&mode=ArtList&maxrecords=12&format=json&sort=HybridRel`;
    const rssFeeds = [
      {
        subject: "Markets",
        url: "https://news.google.com/rss/search?q=(finance%20OR%20markets%20OR%20stocks%20OR%20crypto%20OR%20economy)%20-binance%20-coinbase%20when:1d&hl=en-US&gl=US&ceid=US:en"
      },
      {
        subject: "Markets",
        url: "https://www.cnbc.com/id/15839069/device/rss/rss.html"
      },
      {
        subject: "Economy",
        url: "https://www.cnbc.com/id/100003114/device/rss/rss.html"
      }
    ];

    const gdeltPromise = fetch(gdeltUrl, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Autody/1.0 news preview"
      }
    }).then((r) => {
      if (!r.ok) throw new Error(`GDELT HTTP ${r.status}`);
      return r.json();
    }).then((json) => (json.articles || []).map((article) => ({
      title: article.title,
      source: article.domain || article.sourceCountry || "Market news",
      url: article.url,
      image: article.socialimage || null,
      summary: article.title ? `Important ${inferNewsSubject(article.title, "market").toLowerCase()} story from ${article.domain || "a market news source"}. Open the original source for the full report.` : "Open the source for the full story and market context.",
      publishedAt: article.seendate || null,
      subject: inferNewsSubject(article.title, "Markets")
    })));

    const rssPromises = rssFeeds.map((feed) => fetch(feed.url, {
      headers: {
        Accept: "application/rss+xml, application/xml, text/xml",
        "User-Agent": "Autody/1.0 news preview"
      }
    }).then((r) => {
      if (!r.ok) throw new Error(`RSS HTTP ${r.status}`);
      return r.text();
    }).then((xml) => parseRss(xml, feed.subject)));

    const settled = await Promise.allSettled([gdeltPromise, ...rssPromises]);
    const articles = settled
      .filter((result) => result.status === "fulfilled")
      .flatMap((result) => result.value);

    const importantArticles = uniqueArticles(articles)
      .sort((a, b) => scoreNews(b) - scoreNews(a))
      .slice(0, 9)
      .map(ensureArticleImage);

    return res.json({
      success: true,
      articles: importantArticles.length ? importantArticles : fallbackNews.map(ensureArticleImage),
      fallback: importantArticles.length === 0
    });
  } catch (err) {
    console.error("News proxy error:", err);
    return res.json({ success: true, articles: fallbackNews.map(ensureArticleImage), fallback: true });
  }
});


// Dexscreener proxy (avoids CORS issues)
app.get('/api/dex/pair', async (req, res) => {
  try {
    const { pair } = req.query;
    if (!pair) return res.status(400).json({ error: 'Missing ?pair=' });

    // Dexscreener polygon pair endpoint (no API key)
    const url = `https://api.dexscreener.com/latest/dex/pairs/polygon/${pair}`;

    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!r.ok) {
      const body = await r.text().catch(()=>'<no body>');
      return res.status(502).json({ error: 'Dexscreener fetch failed', status: r.status, body });
    }
    const json = await r.json();

    // Normalize a small subset that the front-end will use:
    // We'll return the full dexscreener response as `raw` and a `summary` mapping
    const pairData = json?.pair || json?.pairs?.[0] || null;

    const summary = {
      pairAddress: pair,
      priceUsd: pairData?.priceUsd ?? null,
      fdv: pairData?.fdv ?? null,
      liquidityUsd: pairData?.liquidity?.usd ?? pairData?.liquidityUsd ?? null,
      // time-windowed stats (safe-read multiple possible key names)
      txns: {
        '5m': pairData?.txns?.m5 ?? pairData?.txns?.['5m'] ?? null,
        '1h': pairData?.txns?.h1 ?? pairData?.txns?.['1h'] ?? null,
        '6h': pairData?.txns?.h6 ?? null,
        '24h': pairData?.txns?.h24 ?? pairData?.txns?.['24h'] ?? null,
      },
      volume: {
        '5m': pairData?.volume?.m5 ?? pairData?.volume?.['5m'] ?? null,
        '1h': pairData?.volume?.h1 ?? null,
        '6h': pairData?.volume?.h6 ?? null,
        '24h': pairData?.volume?.h24 ?? pairData?.volume?.['24h'] ?? null,
      },
      // in case dexscreener exposes buys/sells split (some versions do)
      buys: {
        '5m': pairData?.buys?.m5 ?? null,
        '1h': pairData?.buys?.h1 ?? null,
        '6h': pairData?.buys?.h6 ?? null,
        '24h': pairData?.buys?.h24 ?? null,
      },
      sells: {
        '5m': pairData?.sells?.m5 ?? null,
        '1h': pairData?.sells?.h1 ?? null,
        '6h': pairData?.sells?.h6 ?? null,
        '24h': pairData?.sells?.h24 ?? null,
      }
    };

    return res.json({ success: true, raw: json, summary });
  } catch (err) {
    console.error("Dex proxy error:", err);
    return res.status(500).json({ error: "Failed to fetch Dexscreener", details: String(err?.message || err) });
  }
});

// --- serve frontend

app.get("/config", (req, res) => {
    return res.json({
        rpc: process.env.POLYGON_RPC,

        tokenContract: process.env.TOKEN_CONTRACT,
        poolAddress: process.env.POOL_ADDRESS,
        vaultAddress: process.env.VAULT_ADDRESS,

        walletconnect: {
            projectId: process.env.WALLETCONNECT_PROJECT_ID
        },

        transak: {
            apiKey: process.env.TRANSAK_API_KEY,
            environment: process.env.TRANSAK_ENV
        },

        google: {
            sheetUrl: process.env.GOOGLE_SHEET_URL
        }
    });
});



app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

app.listen(PORT, () => {
  console.log(`Autody is running at http://localhost:${PORT}`);
});
