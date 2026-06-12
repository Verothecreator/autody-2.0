const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const bodyParser = require("body-parser");
const { ethers } = require("ethers");
const { Pool } = require("pg");
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

const DEMO_DB_STORE = path.join(__dirname, "data", "demo-db.json");
const DATABASE_SCHEMA_STORE = path.join(__dirname, "database", "schema.sql");
const PRACTICE_USER_ID = "practice-user";
const PRACTICE_USER_EMAIL = "ontold7@gmail.com";
const DATABASE_URL = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || process.env.POSTGRES_URL;
const dbPool = DATABASE_URL ? new Pool({
    connectionString: DATABASE_URL,
    ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false }
}) : null;
const LIVE_MARKET_REFRESH_MS = Number(process.env.LIVE_MARKET_REFRESH_MS || 5 * 60 * 1000);
const LIVE_NEWS_REFRESH_MS = Number(process.env.LIVE_NEWS_REFRESH_MS || 30 * 60 * 1000);
let liveRefreshInFlight = null;
let lastLiveRefresh = null;

function loadOrders() {
    return JSON.parse(fs.readFileSync(ORDER_STORE));
}
function saveOrders(data) {
    fs.writeFileSync(ORDER_STORE, JSON.stringify(data, null, 2));
}

const defaultDemoDb = {
    users: [
        {
            id: PRACTICE_USER_ID,
            name: "Vero Demo",
            email: PRACTICE_USER_EMAIL,
            mode: "paper",
            currency: "USD",
            startingBalance: 50000,
            cashBalance: 50000,
            reservedCash: 0,
            createdAt: "2026-06-11T00:00:00.000Z",
            auth: {
                passwordAlgorithm: "scrypt",
                passwordSalt: "e347422aa66d3ca056c6a13fc341e4c8",
                passwordHash: "7809fccd8f63f1516a811717074eef89debc3a4f834b21ca822dfdf035b6f8988b2e4c221814c87faa02b5609a03a428fc5b01cba3cb22bf98cfbe572392a06e",
                passwordUpdatedAt: "2026-06-11T00:00:00.000Z"
            }
        }
    ],
    sessions: [],
    wallets: {
        [PRACTICE_USER_ID]: {
            cash: {
                symbol: "USD",
                name: "USD Cash",
                balance: 50000,
                valueUsd: 50000,
                status: "Available"
            },
            holdings: [
                { symbol: "AU", name: "Autody AU", category: "currency", balance: 0, valueUsd: 0, status: "Not held" },
                { symbol: "CRYPTO", name: "Crypto", category: "crypto", balance: 0, valueUsd: 0, status: "Ready" },
                { symbol: "STOCKS", name: "Stocks", category: "stocks", balance: 0, valueUsd: 0, status: "Ready" }
            ]
        }
    },
    orders: {
        [PRACTICE_USER_ID]: []
    },
    watchlists: {
        [PRACTICE_USER_ID]: {
            crypto: ["BTC", "ETH", "SOL", "DOGE", "ADA", "AU"],
            stocks: ["SPY", "QQQ", "AAPL", "NVDA", "TSLA", "MSFT"]
        }
    },
    researchPreferences: {
        [PRACTICE_USER_ID]: ["Crypto", "Stocks", "Gold", "Rates", "Inflation", "AU utility"]
    },
    performance: {
        [PRACTICE_USER_ID]: {
            portfolioValue: 50000,
            startingBalance: 50000,
            unrealizedProfitLoss: 0,
            realizedProfitLoss: 0,
            todayProfitLoss: 0,
            todayProfitLossPct: 0,
            winRatePct: 0,
            tradesPlaced: 0
        }
    },
    settings: {
        [PRACTICE_USER_ID]: {
            defaultMode: "demo",
            currency: "USD",
            riskLevel: "practice",
            orderConfirmation: true,
            marketAlerts: true,
            newsAlerts: true
        }
    }
};

function ensureDemoDb() {
    const dir = path.dirname(DEMO_DB_STORE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(DEMO_DB_STORE)) {
        fs.writeFileSync(DEMO_DB_STORE, JSON.stringify(defaultDemoDb, null, 2));
    }
}

function loadDemoDb() {
    ensureDemoDb();
    return JSON.parse(fs.readFileSync(DEMO_DB_STORE, "utf8"));
}

function saveDemoDb(data) {
    ensureDemoDb();
    fs.writeFileSync(DEMO_DB_STORE, JSON.stringify(data, null, 2));
}

function publicUser(user) {
    const { auth, ...safeUser } = user;
    return safeUser;
}

function parseJsonBody(req) {
    const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : String(req.body || "");
    return raw ? JSON.parse(raw) : {};
}

function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
}

function hashPassword(password, salt) {
    return crypto.scryptSync(String(password || ""), salt, 64).toString("hex");
}

function verifyPassword(password, auth) {
    if (!auth?.passwordSalt || !auth?.passwordHash) return false;

    const expected = Buffer.from(auth.passwordHash, "hex");
    const actual = Buffer.from(hashPassword(password, auth.passwordSalt), "hex");
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function createDemoSession(db, userId) {
    const token = crypto.randomBytes(32).toString("hex");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 1000 * 60 * 60 * 8);
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    db.sessions = (db.sessions || [])
        .filter((session) => Date.parse(session.expiresAt) > Date.now())
        .filter((session) => session.userId !== userId);

    db.sessions.push({
        id: crypto.randomUUID(),
        userId,
        tokenHash,
        createdAt: now.toISOString(),
        expiresAt: expiresAt.toISOString()
    });

    saveDemoDb(db);

    return {
        token,
        userId,
        expiresAt: expiresAt.toISOString()
    };
}

function getPracticeAccount() {
    const db = loadDemoDb();
    const user = db.users.find((item) => item.id === PRACTICE_USER_ID);
    if (!user) throw new Error("Practice user missing from demo database");

    return {
        user,
        wallet: db.wallets[PRACTICE_USER_ID],
        orders: db.orders[PRACTICE_USER_ID] || [],
        watchlist: db.watchlists[PRACTICE_USER_ID],
        researchPreferences: db.researchPreferences[PRACTICE_USER_ID] || [],
        performance: db.performance?.[PRACTICE_USER_ID],
        settings: db.settings?.[PRACTICE_USER_ID]
    };
}

function databaseConfigured() {
    return Boolean(dbPool);
}

async function initializeDatabase() {
    if (!databaseConfigured()) {
        console.log("Supabase DATABASE_URL is not set; using JSON fallback data.");
        return;
    }

    try {
        const schema = fs.readFileSync(DATABASE_SCHEMA_STORE, "utf8");
        await dbPool.query(schema);
        console.log("Supabase schema is ready.");
    } catch (err) {
        console.error("Supabase schema initialization failed. JSON fallback remains available:", err);
    }
}

function numberValue(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function safeIsoDate(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function catalogAssets(type = "all") {
    if (type === "crypto") return TRADE_CRYPTO_ASSETS;
    if (type === "stocks") return TRADE_STOCK_ASSETS;
    return [...TRADE_CRYPTO_ASSETS, ...TRADE_STOCK_ASSETS];
}

function marketDataSymbol(asset) {
    return asset.providerSymbol || asset.yahooSymbol || asset.product || asset.symbol;
}

function assetCatalogEntry(asset) {
    return {
        rank: asset.rank,
        symbol: asset.symbol,
        name: asset.name,
        id: asset.id || asset.symbol,
        assetType: asset.assetType,
        providerSymbol: marketDataSymbol(asset),
        market: asset.market || "Global",
        region: asset.region || "Global",
        currency: asset.currency || "USD",
        tags: asset.tags || [],
        depositNetworks: asset.depositNetworks || [],
        depositEnabled: Boolean(asset.depositNetworks?.length),
        tradeable: asset.tradeable ?? true,
        customAsset: Boolean(asset.customAsset),
        price: asset.price ?? null,
        changePct: asset.changePct ?? null,
        marketCap: asset.marketCap ?? null,
        fdv: asset.fdv ?? null,
        liquidityUsd: asset.liquidityUsd ?? null,
        totalVolume: asset.totalVolume ?? null,
        high24h: asset.high24h ?? null,
        low24h: asset.low24h ?? null,
        ath: asset.ath ?? null,
        atl: asset.atl ?? null,
        circulatingSupply: asset.circulatingSupply ?? null,
        totalSupply: asset.totalSupply ?? null,
        maxSupply: asset.maxSupply ?? null,
        sparkline: asset.sparkline || null,
        dataProvider: asset.dataProvider || null,
        capturedAt: asset.capturedAt || null,
        status: asset.status || null
    };
}

function mapDbUser(row) {
    return {
        id: row.profile_id,
        name: row.display_name,
        email: row.email,
        mode: "paper",
        currency: row.currency || "USD",
        startingBalance: numberValue(row.starting_balance, 50000),
        cashBalance: numberValue(row.cash_balance, 50000),
        reservedCash: numberValue(row.reserved_cash, 0),
        createdAt: row.created_at
    };
}

function mapDbHolding(row) {
    return {
        symbol: row.symbol,
        name: row.asset_name,
        category: row.asset_type,
        balance: numberValue(row.quantity, 0),
        valueUsd: numberValue(row.value_usd, 0),
        status: numberValue(row.quantity, 0) > 0 ? "Held" : row.symbol === "AU" ? "Not held" : "Ready"
    };
}

async function getPracticeAccountFromDatabase() {
    if (!databaseConfigured()) return null;

    const accountResult = await dbPool.query(`
        select
            p.id as profile_id,
            p.email,
            p.display_name,
            p.created_at,
            am.id as account_mode_id,
            w.id as wallet_id,
            w.currency,
            w.cash_balance,
            w.reserved_cash,
            w.starting_balance
        from profiles p
        join account_modes am on am.profile_id = p.id and am.mode = 'demo'
        join wallets w on w.account_mode_id = am.id
        where lower(p.email) = lower($1)
        limit 1
    `, [PRACTICE_USER_EMAIL]);

    const row = accountResult.rows[0];
    if (!row) return null;

    const [holdingsResult, ordersResult, watchlistResult, researchResult, performanceResult, settingsResult] = await Promise.all([
        dbPool.query(`
            select symbol, asset_name, asset_type, quantity, value_usd
            from holdings
            where wallet_id = $1
            order by case symbol when 'USD' then 0 when 'AU' then 1 when 'CRYPTO' then 2 when 'STOCKS' then 3 else 4 end, symbol
        `, [row.wallet_id]),
        dbPool.query(`
            select symbol, asset_type, side, order_type, status, quantity, notional_usd, limit_price, filled_price, created_at, filled_at
            from orders
            where account_mode_id = $1
            order by created_at desc
            limit 50
        `, [row.account_mode_id]),
        dbPool.query(`
            select symbol, asset_type
            from watchlists
            where profile_id = $1
            order by created_at asc
        `, [row.profile_id]),
        dbPool.query(`
            select topic
            from research_preferences
            where profile_id = $1
            order by created_at asc
        `, [row.profile_id]),
        dbPool.query(`
            select portfolio_value, starting_balance, unrealized_profit_loss, realized_profit_loss,
                   today_profit_loss, today_profit_loss_pct, win_rate_pct, trades_placed
            from demo_performance
            where account_mode_id = $1
            limit 1
        `, [row.account_mode_id]),
        dbPool.query(`
            select default_mode, currency, risk_level, order_confirmation, market_alerts, news_alerts
            from account_settings
            where profile_id = $1
            limit 1
        `, [row.profile_id])
    ]);

    const holdings = holdingsResult.rows.map(mapDbHolding);
    const cashHolding = holdings.find((holding) => holding.symbol === "USD");
    const cash = {
        symbol: "USD",
        name: "USD Cash",
        balance: numberValue(row.cash_balance, cashHolding?.balance || 0),
        valueUsd: numberValue(row.cash_balance, cashHolding?.valueUsd || 0),
        status: "Available"
    };
    const nonCashHoldings = holdings.filter((holding) => holding.symbol !== "USD");
    const watchlist = watchlistResult.rows.reduce((groups, item) => {
        const key = item.asset_type === "stock" || item.asset_type === "etf" ? "stocks" : "crypto";
        groups[key].push(item.symbol);
        return groups;
    }, { crypto: [], stocks: [] });

    const performanceRow = performanceResult.rows[0] || {};
    const settingsRow = settingsResult.rows[0] || {};

    return {
        user: mapDbUser(row),
        wallet: { cash, holdings: nonCashHoldings },
        orders: ordersResult.rows,
        watchlist,
        researchPreferences: researchResult.rows.map((item) => item.topic),
        performance: {
            portfolioValue: numberValue(performanceRow.portfolio_value, 50000),
            startingBalance: numberValue(performanceRow.starting_balance, 50000),
            unrealizedProfitLoss: numberValue(performanceRow.unrealized_profit_loss, 0),
            realizedProfitLoss: numberValue(performanceRow.realized_profit_loss, 0),
            todayProfitLoss: numberValue(performanceRow.today_profit_loss, 0),
            todayProfitLossPct: numberValue(performanceRow.today_profit_loss_pct, 0),
            winRatePct: numberValue(performanceRow.win_rate_pct, 0),
            tradesPlaced: numberValue(performanceRow.trades_placed, 0)
        },
        settings: {
            defaultMode: settingsRow.default_mode || "demo",
            currency: settingsRow.currency || "USD",
            riskLevel: settingsRow.risk_level || "practice",
            orderConfirmation: settingsRow.order_confirmation ?? true,
            marketAlerts: settingsRow.market_alerts ?? true,
            newsAlerts: settingsRow.news_alerts ?? true
        }
    };
}

async function getPracticeAccountAny() {
    if (databaseConfigured()) {
        try {
            const account = await getPracticeAccountFromDatabase();
            if (account) return { ...account, source: "supabase" };
        } catch (err) {
            console.error("Supabase practice account read failed, using JSON fallback:", err);
        }
    }

    return { ...getPracticeAccount(), source: "json" };
}

async function createDatabaseSession(profileId) {
    const token = crypto.randomBytes(32).toString("hex");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 1000 * 60 * 60 * 8);
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    await dbPool.query(`
        delete from app_sessions
        where profile_id = $1 or expires_at <= now()
    `, [profileId]);

    await dbPool.query(`
        insert into app_sessions (profile_id, token_hash, created_at, expires_at)
        values ($1, $2, $3, $4)
    `, [profileId, tokenHash, now.toISOString(), expiresAt.toISOString()]);

    return {
        token,
        userId: profileId,
        expiresAt: expiresAt.toISOString()
    };
}

async function signInFromDatabase(email, password) {
    if (!databaseConfigured()) return null;

    const result = await dbPool.query(`
        select
            p.id as profile_id,
            p.email,
            p.display_name,
            p.created_at,
            pc.password_algorithm,
            pc.password_salt,
            pc.password_hash
        from profiles p
        join profile_credentials pc on pc.profile_id = p.id
        where lower(p.email) = lower($1)
        limit 1
    `, [email]);

    const row = result.rows[0];
    if (!row) return null;

    const auth = {
        passwordSalt: row.password_salt,
        passwordHash: row.password_hash
    };
    if (!verifyPassword(password, auth)) return null;

    const session = await createDatabaseSession(row.profile_id);
    return {
        user: {
            id: row.profile_id,
            name: row.display_name,
            email: row.email,
            mode: "paper",
            currency: "USD",
            createdAt: row.created_at
        },
        session
    };
}

async function saveMarketSnapshots(provider, assetType, assets = []) {
    if (!databaseConfigured() || !assets.length) return;

    try {
        const values = [];
        const placeholders = assets
            .filter((asset) => asset?.symbol)
            .map((asset, index) => {
                const offset = index * 8;
                values.push(
                    provider,
                    asset.symbol,
                    asset.name || asset.symbol,
                    asset.assetType || assetType,
                    asset.price ?? asset.value ?? null,
                    asset.changePct ?? null,
                    asset.marketCap ?? null,
                    asset.currency || "USD"
                );
                return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8})`;
            });

        if (!placeholders.length) return;

        await dbPool.query(`
            insert into market_snapshots (provider, symbol, asset_name, asset_type, price_usd, change_pct, market_cap_usd, currency)
            values ${placeholders.join(", ")}
        `, values);
    } catch (err) {
        console.error("Market snapshot save failed:", err);
    }
}

async function saveNewsSnapshots(provider, articles = []) {
    if (!databaseConfigured() || !articles.length) return;

    try {
        const values = [];
        const placeholders = articles
            .filter((article) => article?.title)
            .map((article, index) => {
                const offset = index * 7;
                values.push(
                    provider,
                    article.source || "Market news",
                    article.subject || "Markets",
                    article.title,
                    article.image || null,
                    article.url || null,
                    safeIsoDate(article.publishedAt)
                );
                return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7})`;
            });

        if (!placeholders.length) return;

        await dbPool.query(`
            insert into news_snapshots (provider, source, subject, title, image_url, article_url, published_at)
            values ${placeholders.join(", ")}
            on conflict (title, source) do update
            set image_url = excluded.image_url,
                article_url = excluded.article_url,
                published_at = excluded.published_at,
                captured_at = now()
        `, values);
    } catch (err) {
        console.error("News snapshot save failed:", err);
    }
}

async function readLatestMarketSnapshots(assetType, limit = 6) {
    if (!databaseConfigured()) return [];

    try {
        const assetTypes = Array.isArray(assetType) ? assetType : [assetType];
        const result = await dbPool.query(`
            select *
            from (
                select distinct on (symbol)
                    provider,
                    symbol,
                    asset_name,
                    asset_type,
                    price_usd,
                    change_pct,
                    market_cap_usd,
                    currency,
                    captured_at
                from market_snapshots
                where asset_type = any($1)
                order by symbol, captured_at desc
            ) latest
            order by captured_at desc
            limit $2
        `, [assetTypes, limit]);

        return result.rows.map((row) => ({
            symbol: row.symbol,
            name: row.asset_name,
            price: row.price_usd == null ? null : Number(row.price_usd),
            changePct: row.change_pct == null ? null : Number(row.change_pct),
            marketCap: row.market_cap_usd == null ? null : Number(row.market_cap_usd),
            currency: row.currency || "USD",
            capturedAt: row.captured_at,
            provider: row.provider
        }));
    } catch (err) {
        console.error("Market snapshot fallback read failed:", err);
        return [];
    }
}

async function readLatestNewsSnapshots(limit = 9) {
    if (!databaseConfigured()) return [];

    try {
        const result = await dbPool.query(`
            select provider, source, subject, title, image_url as image, article_url as url, published_at, captured_at
            from news_snapshots
            order by coalesce(published_at, captured_at) desc
            limit $1
        `, [limit]);

        return result.rows.map((row) => ({
            title: row.title,
            source: row.source,
            subject: row.subject,
            image: row.image,
            url: row.url,
            publishedAt: row.published_at,
            capturedAt: row.captured_at,
            provider: row.provider
        }));
    } catch (err) {
        console.error("News snapshot fallback read failed:", err);
        return [];
    }
}

async function buildMarketCatalog(type = "all") {
    const includeCrypto = type !== "stocks";
    const includeStocks = type !== "crypto";
    const cryptoCatalog = includeCrypto ? await getCryptoCatalogAssets() : [];
    const stockCatalog = includeStocks ? TRADE_STOCK_ASSETS.map(assetCatalogEntry) : [];
    const catalog = [...cryptoCatalog, ...stockCatalog];
    const snapshotTypes = type === "crypto"
        ? ["crypto"]
        : type === "stocks"
            ? ["stock", "etf", "commodity", "index", "forex"]
            : ["crypto", "stock", "etf", "commodity", "index", "forex"];
    const snapshots = await readLatestMarketSnapshots(snapshotTypes, Math.max(catalog.length, 30));
    const snapshotMap = new Map(snapshots.map((asset) => [asset.symbol, asset]));

    return catalog.map((asset) => {
        const snapshot = snapshotMap.get(asset.symbol);
        return {
            ...asset,
            price: asset.price ?? snapshot?.price ?? null,
            changePct: asset.changePct ?? snapshot?.changePct ?? null,
            marketCap: asset.marketCap ?? snapshot?.marketCap ?? null,
            currency: asset.currency || snapshot?.currency || "USD",
            dataProvider: asset.dataProvider || snapshot?.provider || null,
            capturedAt: asset.capturedAt || snapshot?.capturedAt || null,
            status: asset.status || (snapshot ? "Live" : "Waiting for first refresh")
        };
    });
}

function mergeRankedMarketAssets(...assetGroups) {
    const merged = new Map();
    for (const assets of assetGroups) {
        for (const asset of assets || []) {
            if (!asset?.symbol || asset.price == null) continue;
            if (!merged.has(asset.symbol)) merged.set(asset.symbol, asset);
        }
    }
    return [...merged.values()].sort((a, b) => (a.rank || 999) - (b.rank || 999));
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

const CRYPTO_MARKET_LIMIT = 200;
const CRYPTO_CATALOG_CACHE_MS = 1000 * 60 * 3;
let cryptoCatalogCache = { expiresAt: 0, assets: [] };

const AUTODY_MARKET_ASSET = {
  rank: 0,
  id: "autody-au",
  symbol: "AU",
  name: "Autody AU",
  assetType: "crypto",
  market: "Autody",
  tags: ["Gold-backed", "Payments", "Autody ecosystem"],
  depositNetworks: ["Autody network pending"],
  tradeable: false,
  customAsset: true,
  status: "Market maker pending"
};

const TRADE_CRYPTO_ASSETS = [
  { rank: 1, id: "bitcoin", symbol: "BTC", name: "Bitcoin", product: "BTC-USD", assetType: "crypto", market: "Crypto", tags: ["Blue chip", "Store of value"], depositNetworks: ["Bitcoin"] },
  { rank: 2, id: "ethereum", symbol: "ETH", name: "Ethereum", product: "ETH-USD", assetType: "crypto", market: "Crypto", tags: ["Smart contracts", "DeFi"], depositNetworks: ["Ethereum"] },
  { rank: 3, id: "tether", symbol: "USDT", name: "Tether USDt", product: "USDT-USD", assetType: "crypto", market: "Stablecoin", tags: ["Stablecoin", "Payments"], depositNetworks: ["Ethereum ERC-20", "Tron TRC-20", "BNB Smart Chain BEP-20", "Polygon PoS", "Solana SPL", "Arbitrum One", "Optimism", "Avalanche C-Chain"] },
  { rank: 4, id: "usd-coin", symbol: "USDC", name: "USD Coin", product: "USDC-USD", assetType: "crypto", market: "Stablecoin", tags: ["Stablecoin", "Payments"], depositNetworks: ["Ethereum ERC-20", "Base", "Solana SPL", "Polygon PoS", "Arbitrum One", "Optimism", "Avalanche C-Chain", "Stellar"] },
  { rank: 5, id: "solana", symbol: "SOL", name: "Solana", product: "SOL-USD", assetType: "crypto", market: "Crypto", tags: ["High demand", "Apps"], depositNetworks: ["Solana"] },
  { rank: 6, id: "ripple", symbol: "XRP", name: "XRP", product: "XRP-USD", assetType: "crypto", market: "Crypto", tags: ["Payments"], depositNetworks: ["XRP Ledger"] },
  { rank: 7, id: "binancecoin", symbol: "BNB", name: "BNB", product: null, yahooSymbol: "BNB-USD", assetType: "crypto", market: "Crypto", tags: ["Large cap"], depositNetworks: ["BNB Smart Chain BEP-20", "BNB Beacon Chain"] },
  { rank: 8, id: "dogecoin", symbol: "DOGE", name: "Dogecoin", product: "DOGE-USD", assetType: "crypto", market: "Crypto", tags: ["Popular"], depositNetworks: ["Dogecoin"] },
  { rank: 9, id: "cardano", symbol: "ADA", name: "Cardano", product: "ADA-USD", assetType: "crypto", market: "Crypto", tags: ["Smart contracts"], depositNetworks: ["Cardano"] },
  { rank: 10, id: "avalanche-2", symbol: "AVAX", name: "Avalanche", product: "AVAX-USD", assetType: "crypto", market: "Crypto", tags: ["Layer 1"], depositNetworks: ["Avalanche C-Chain"] },
  { rank: 11, id: "chainlink", symbol: "LINK", name: "Chainlink", product: "LINK-USD", assetType: "crypto", market: "Crypto", tags: ["Data oracles"], depositNetworks: ["Ethereum ERC-20", "Polygon PoS", "Arbitrum One"] },
  { rank: 12, id: "litecoin", symbol: "LTC", name: "Litecoin", product: "LTC-USD", assetType: "crypto", market: "Crypto", tags: ["Payments"], depositNetworks: ["Litecoin"] },
  { rank: 13, id: "polkadot", symbol: "DOT", name: "Polkadot", product: "DOT-USD", assetType: "crypto", market: "Crypto", tags: ["Interoperability"], depositNetworks: ["Polkadot"] },
  { rank: 14, id: "bitcoin-cash", symbol: "BCH", name: "Bitcoin Cash", product: "BCH-USD", assetType: "crypto", market: "Crypto", tags: ["Payments"], depositNetworks: ["Bitcoin Cash"] },
  { rank: 15, id: "stellar", symbol: "XLM", name: "Stellar", product: "XLM-USD", assetType: "crypto", market: "Crypto", tags: ["Payments"], depositNetworks: ["Stellar"] },
  { rank: 16, id: "tron", symbol: "TRX", name: "TRON", product: null, yahooSymbol: "TRX-USD", assetType: "crypto", market: "Crypto", tags: ["Payments"], depositNetworks: ["Tron TRC-20"] },
  { rank: 17, id: "the-open-network", symbol: "TON", name: "Toncoin", product: null, yahooSymbol: "TON11419-USD", assetType: "crypto", market: "Crypto", tags: ["Messaging", "Layer 1"], depositNetworks: ["TON"] },
  { rank: 18, id: "sui", symbol: "SUI", name: "Sui", product: "SUI-USD", assetType: "crypto", market: "Crypto", tags: ["Layer 1"], depositNetworks: ["Sui"] },
  { rank: 19, id: "hedera-hashgraph", symbol: "HBAR", name: "Hedera", product: "HBAR-USD", assetType: "crypto", market: "Crypto", tags: ["Enterprise"], depositNetworks: ["Hedera"] },
  { rank: 20, id: "shiba-inu", symbol: "SHIB", name: "Shiba Inu", product: "SHIB-USD", assetType: "crypto", market: "Crypto", tags: ["Popular"], depositNetworks: ["Ethereum ERC-20", "Shibarium"] },
  { rank: 21, id: "polygon-ecosystem-token", symbol: "POL", name: "Polygon", product: "POL-USD", assetType: "crypto", market: "Crypto", tags: ["Scaling"], depositNetworks: ["Polygon PoS", "Ethereum ERC-20"] },
  { rank: 22, id: "uniswap", symbol: "UNI", name: "Uniswap", product: "UNI-USD", assetType: "crypto", market: "Crypto", tags: ["DeFi"], depositNetworks: ["Ethereum ERC-20", "Arbitrum One", "Polygon PoS"] },
  { rank: 23, id: "aave", symbol: "AAVE", name: "Aave", product: "AAVE-USD", assetType: "crypto", market: "Crypto", tags: ["DeFi", "Lending"], depositNetworks: ["Ethereum ERC-20", "Polygon PoS", "Arbitrum One"] },
  { rank: 24, id: "cosmos", symbol: "ATOM", name: "Cosmos", product: "ATOM-USD", assetType: "crypto", market: "Crypto", tags: ["Interoperability"], depositNetworks: ["Cosmos"] },
  { rank: 25, id: "near", symbol: "NEAR", name: "NEAR Protocol", product: "NEAR-USD", assetType: "crypto", market: "Crypto", tags: ["Layer 1"], depositNetworks: ["NEAR"] },
  { rank: 26, id: "aptos", symbol: "APT", name: "Aptos", product: "APT-USD", assetType: "crypto", market: "Crypto", tags: ["Layer 1"], depositNetworks: ["Aptos"] },
  { rank: 27, id: "arbitrum", symbol: "ARB", name: "Arbitrum", product: "ARB-USD", assetType: "crypto", market: "Crypto", tags: ["Scaling"], depositNetworks: ["Arbitrum One"] },
  { rank: 28, id: "optimism", symbol: "OP", name: "Optimism", product: "OP-USD", assetType: "crypto", market: "Crypto", tags: ["Scaling"], depositNetworks: ["Optimism"] },
  { rank: 29, id: "injective-protocol", symbol: "INJ", name: "Injective", product: "INJ-USD", assetType: "crypto", market: "Crypto", tags: ["DeFi"], depositNetworks: ["Injective", "Ethereum ERC-20"] },
  { rank: 30, id: "internet-computer", symbol: "ICP", name: "Internet Computer", product: "ICP-USD", assetType: "crypto", market: "Crypto", tags: ["Compute"], depositNetworks: ["Internet Computer"] },
  { rank: 31, id: "filecoin", symbol: "FIL", name: "Filecoin", product: "FIL-USD", assetType: "crypto", market: "Crypto", tags: ["Storage"], depositNetworks: ["Filecoin"] },
  { rank: 32, id: "ethereum-classic", symbol: "ETC", name: "Ethereum Classic", product: "ETC-USD", assetType: "crypto", market: "Crypto", tags: ["Proof of work"], depositNetworks: ["Ethereum Classic"] },
  { rank: 33, id: "vechain", symbol: "VET", name: "VeChain", product: null, yahooSymbol: "VET-USD", assetType: "crypto", market: "Crypto", tags: ["Supply chain"], depositNetworks: ["VeChain"] },
  { rank: 34, id: "algorand", symbol: "ALGO", name: "Algorand", product: "ALGO-USD", assetType: "crypto", market: "Crypto", tags: ["Layer 1"], depositNetworks: ["Algorand"] },
  { rank: 35, id: "monero", symbol: "XMR", name: "Monero", product: null, yahooSymbol: "XMR-USD", assetType: "crypto", market: "Crypto", tags: ["Privacy"], depositNetworks: ["Monero"] },
  { rank: 36, id: "fetch-ai", symbol: "FET", name: "Artificial Superintelligence Alliance", product: "FET-USD", assetType: "crypto", market: "Crypto", tags: ["AI"], depositNetworks: ["Ethereum ERC-20", "Cosmos"] },
  { rank: 37, id: "render-token", symbol: "RENDER", name: "Render", product: "RENDER-USD", assetType: "crypto", market: "Crypto", tags: ["AI", "Compute"], depositNetworks: ["Solana SPL", "Ethereum ERC-20"] },
  { rank: 38, id: "pepe", symbol: "PEPE", name: "Pepe", product: "PEPE-USD", assetType: "crypto", market: "Crypto", tags: ["Popular"], depositNetworks: ["Ethereum ERC-20"] },
  { rank: 39, id: "bonk", symbol: "BONK", name: "Bonk", product: "BONK-USD", assetType: "crypto", market: "Crypto", tags: ["Popular"], depositNetworks: ["Solana SPL"] },
  { rank: 40, id: "dogwifcoin", symbol: "WIF", name: "dogwifhat", product: "WIF-USD", assetType: "crypto", market: "Crypto", tags: ["Popular"], depositNetworks: ["Solana SPL"] },
  { rank: 41, id: "dai", symbol: "DAI", name: "Dai", product: "DAI-USD", assetType: "crypto", market: "Stablecoin", tags: ["Stablecoin", "DeFi"], depositNetworks: ["Ethereum ERC-20", "Polygon PoS", "Arbitrum One", "Optimism"] },
  { rank: 42, id: "paypal-usd", symbol: "PYUSD", name: "PayPal USD", product: "PYUSD-USD", assetType: "crypto", market: "Stablecoin", tags: ["Stablecoin", "Payments"], depositNetworks: ["Ethereum ERC-20", "Solana SPL"] },
  { rank: 43, id: "first-digital-usd", symbol: "FDUSD", name: "First Digital USD", product: null, yahooSymbol: "FDUSD-USD", assetType: "crypto", market: "Stablecoin", tags: ["Stablecoin"], depositNetworks: ["Ethereum ERC-20", "BNB Smart Chain BEP-20"] },
  { rank: 44, id: "true-usd", symbol: "TUSD", name: "TrueUSD", product: null, yahooSymbol: "TUSD-USD", assetType: "crypto", market: "Stablecoin", tags: ["Stablecoin"], depositNetworks: ["Ethereum ERC-20", "BNB Smart Chain BEP-20", "Tron TRC-20"] },
  { rank: 45, id: "maker", symbol: "MKR", name: "Maker", product: "MKR-USD", assetType: "crypto", market: "Crypto", tags: ["DeFi"], depositNetworks: ["Ethereum ERC-20"] },
  { rank: 46, id: "lido-dao", symbol: "LDO", name: "Lido DAO", product: "LDO-USD", assetType: "crypto", market: "Crypto", tags: ["Staking"], depositNetworks: ["Ethereum ERC-20", "Arbitrum One"] },
  { rank: 47, id: "quant-network", symbol: "QNT", name: "Quant", product: "QNT-USD", assetType: "crypto", market: "Crypto", tags: ["Interoperability"], depositNetworks: ["Ethereum ERC-20"] },
  { rank: 48, id: "the-graph", symbol: "GRT", name: "The Graph", product: "GRT-USD", assetType: "crypto", market: "Crypto", tags: ["Data"], depositNetworks: ["Ethereum ERC-20", "Arbitrum One"] },
  { rank: 49, id: "curve-dao-token", symbol: "CRV", name: "Curve DAO", product: "CRV-USD", assetType: "crypto", market: "Crypto", tags: ["DeFi"], depositNetworks: ["Ethereum ERC-20", "Arbitrum One"] },
  { rank: 50, id: "decentraland", symbol: "MANA", name: "Decentraland", product: "MANA-USD", assetType: "crypto", market: "Crypto", tags: ["Gaming"], depositNetworks: ["Ethereum ERC-20", "Polygon PoS"] }
];

function staticCryptoFallbackCatalog() {
  return [AUTODY_MARKET_ASSET, ...TRADE_CRYPTO_ASSETS].map(assetCatalogEntry);
}

function existingCryptoMetadata() {
  const metadata = new Map();
  for (const asset of TRADE_CRYPTO_ASSETS) {
    metadata.set(asset.id, asset);
    metadata.set(asset.symbol, asset);
  }
  return metadata;
}

function cryptoMarketKind(row, existing) {
  const stableSymbols = new Set(["USDT", "USDC", "DAI", "PYUSD", "FDUSD", "TUSD", "USDE", "USD1", "USDD", "FRAX"]);
  const symbol = String(row.symbol || "").toUpperCase();
  const price = Number(row.current_price);
  if (existing?.market === "Stablecoin" || stableSymbols.has(symbol) || (Number.isFinite(price) && price > 0.97 && price < 1.03 && /usd|dai|frax/i.test(row.name || ""))) {
    return "Stablecoin";
  }
  return "Crypto";
}

function mapCoinGeckoMarketAsset(row, index, metadata) {
  const symbol = String(row.symbol || "").toUpperCase();
  const existing = metadata.get(row.id) || metadata.get(symbol) || {};
  const price = Number(row.current_price);
  const changePct = Number(row.price_change_percentage_24h_in_currency ?? row.price_change_percentage_24h);
  const marketCap = Number(row.market_cap);
  const fdv = Number(row.fully_diluted_valuation);
  const totalVolume = Number(row.total_volume);
  const high24h = Number(row.high_24h);
  const low24h = Number(row.low_24h);
  const ath = Number(row.ath);
  const atl = Number(row.atl);

  return assetCatalogEntry({
    ...existing,
    rank: row.market_cap_rank || index + 1,
    id: row.id,
    symbol,
    name: row.name || existing.name || symbol,
    assetType: "crypto",
    market: cryptoMarketKind(row, existing),
    currency: "USD",
    tags: existing.tags || [],
    depositNetworks: existing.depositNetworks || [],
    price: Number.isFinite(price) ? price : null,
    changePct: Number.isFinite(changePct) ? changePct : null,
    marketCap: Number.isFinite(marketCap) ? marketCap : null,
    fdv: Number.isFinite(fdv) ? fdv : null,
    liquidityUsd: Number.isFinite(totalVolume) ? totalVolume : null,
    totalVolume: Number.isFinite(totalVolume) ? totalVolume : null,
    high24h: Number.isFinite(high24h) ? high24h : null,
    low24h: Number.isFinite(low24h) ? low24h : null,
    ath: Number.isFinite(ath) ? ath : null,
    atl: Number.isFinite(atl) ? atl : null,
    circulatingSupply: Number(row.circulating_supply) || null,
    totalSupply: Number(row.total_supply) || null,
    maxSupply: Number(row.max_supply) || null,
    sparkline: row.sparkline_in_7d?.price || null,
    dataProvider: "coingecko",
    capturedAt: row.last_updated || new Date().toISOString(),
    status: "Live"
  });
}

async function fetchCoinGeckoRankedCryptoAssets(limit = CRYPTO_MARKET_LIMIT) {
  const perPage = Math.min(Math.max(limit, 1), 250);
  const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${perPage}&page=1&sparkline=true&price_change_percentage=1h,24h,7d,30d,1y&precision=full`;
  const json = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Autody/1.0 market catalog"
    }
  }).then((r) => {
    if (!r.ok) throw new Error(`CoinGecko markets HTTP ${r.status}`);
    return r.json();
  });

  if (!Array.isArray(json)) throw new Error("CoinGecko markets response was not a list");
  const metadata = existingCryptoMetadata();
  return json.map((row, index) => mapCoinGeckoMarketAsset(row, index, metadata));
}

async function getCryptoCatalogAssets(options = {}) {
  const forceRefresh = Boolean(options.forceRefresh);
  const throwOnError = Boolean(options.throwOnError);

  if (!forceRefresh && cryptoCatalogCache.assets.length && cryptoCatalogCache.expiresAt > Date.now()) {
    return cryptoCatalogCache.assets;
  }

  try {
    const liveAssets = await fetchCoinGeckoRankedCryptoAssets(CRYPTO_MARKET_LIMIT);
    const assets = [assetCatalogEntry(AUTODY_MARKET_ASSET), ...liveAssets];
    cryptoCatalogCache = { assets, expiresAt: Date.now() + CRYPTO_CATALOG_CACHE_MS };
    return assets;
  } catch (err) {
    console.error("CoinGecko ranked catalog error:", err);
    if (cryptoCatalogCache.assets.length) return cryptoCatalogCache.assets;
    if (throwOnError) throw err;
    return staticCryptoFallbackCatalog();
  }
}

const TRADE_STOCK_ASSETS = [
  { rank: 1, symbol: "SPY", name: "SPDR S&P 500 ETF", assetType: "etf", market: "NYSE Arca", region: "US", tags: ["S&P 500", "ETF"] },
  { rank: 2, symbol: "QQQ", name: "Invesco QQQ Trust", assetType: "etf", market: "Nasdaq", region: "US", tags: ["Nasdaq 100", "ETF"] },
  { rank: 3, symbol: "VOO", name: "Vanguard S&P 500 ETF", assetType: "etf", market: "NYSE Arca", region: "US", tags: ["S&P 500", "ETF"] },
  { rank: 4, symbol: "VT", name: "Vanguard Total World Stock ETF", assetType: "etf", market: "NYSE Arca", region: "Global", tags: ["World equity", "ETF"] },
  { rank: 5, symbol: "DIA", name: "SPDR Dow Jones ETF", assetType: "etf", market: "NYSE Arca", region: "US", tags: ["Dow", "ETF"] },
  { rank: 6, symbol: "IWM", name: "iShares Russell 2000 ETF", assetType: "etf", market: "NYSE Arca", region: "US", tags: ["Small caps", "ETF"] },
  { rank: 7, symbol: "GLD", name: "SPDR Gold Shares", assetType: "etf", market: "NYSE Arca", region: "Commodity", tags: ["Gold", "Commodity ETF"] },
  { rank: 8, symbol: "SLV", name: "iShares Silver Trust", assetType: "etf", market: "NYSE Arca", region: "Commodity", tags: ["Silver", "Commodity ETF"] },
  { rank: 9, symbol: "USO", name: "United States Oil Fund", assetType: "etf", market: "NYSE Arca", region: "Commodity", tags: ["Oil", "WTI"] },
  { rank: 10, symbol: "BNO", name: "United States Brent Oil Fund", assetType: "etf", market: "NYSE Arca", region: "Commodity", tags: ["Oil", "Brent"] },
  { rank: 11, symbol: "UNG", name: "United States Natural Gas Fund", assetType: "etf", market: "NYSE Arca", region: "Commodity", tags: ["Natural gas", "Energy"] },
  { rank: 12, symbol: "NVDA", name: "NVIDIA", assetType: "stock", market: "Nasdaq", region: "US", tags: ["AI", "Semiconductors"] },
  { rank: 13, symbol: "AAPL", name: "Apple", assetType: "stock", market: "Nasdaq", region: "US", tags: ["Mega cap", "Consumer tech"] },
  { rank: 14, symbol: "MSFT", name: "Microsoft", assetType: "stock", market: "Nasdaq", region: "US", tags: ["AI", "Cloud"] },
  { rank: 15, symbol: "TSLA", name: "Tesla", assetType: "stock", market: "Nasdaq", region: "US", tags: ["EV", "High demand"] },
  { rank: 16, symbol: "AMZN", name: "Amazon", assetType: "stock", market: "Nasdaq", region: "US", tags: ["Cloud", "Consumer"] },
  { rank: 17, symbol: "GOOGL", name: "Alphabet", assetType: "stock", market: "Nasdaq", region: "US", tags: ["AI", "Search"] },
  { rank: 18, symbol: "META", name: "Meta Platforms", assetType: "stock", market: "Nasdaq", region: "US", tags: ["AI", "Social"] },
  { rank: 19, symbol: "AMD", name: "AMD", assetType: "stock", market: "Nasdaq", region: "US", tags: ["Semiconductors"] },
  { rank: 20, symbol: "AVGO", name: "Broadcom", assetType: "stock", market: "Nasdaq", region: "US", tags: ["Semiconductors"] },
  { rank: 21, symbol: "NFLX", name: "Netflix", assetType: "stock", market: "Nasdaq", region: "US", tags: ["Streaming"] },
  { rank: 22, symbol: "PLTR", name: "Palantir", assetType: "stock", market: "Nasdaq", region: "US", tags: ["AI", "Data"] },
  { rank: 23, symbol: "COIN", name: "Coinbase Global", assetType: "stock", market: "Nasdaq", region: "US", tags: ["Crypto equity"] },
  { rank: 24, symbol: "MSTR", name: "Strategy", assetType: "stock", market: "Nasdaq", region: "US", tags: ["Bitcoin equity"] },
  { rank: 25, symbol: "JPM", name: "JPMorgan Chase", assetType: "stock", market: "NYSE", region: "US", tags: ["Banking"] },
  { rank: 26, symbol: "V", name: "Visa", assetType: "stock", market: "NYSE", region: "US", tags: ["Payments"] },
  { rank: 27, symbol: "XOM", name: "Exxon Mobil", assetType: "stock", market: "NYSE", region: "US", tags: ["Oil", "Energy"] },
  { rank: 28, symbol: "CVX", name: "Chevron", assetType: "stock", market: "NYSE", region: "US", tags: ["Oil", "Energy"] },
  { rank: 29, symbol: "SHEL", name: "Shell ADR", assetType: "stock", market: "NYSE", region: "UK", tags: ["Oil", "Energy"] },
  { rank: 30, symbol: "BP", name: "BP ADR", assetType: "stock", market: "NYSE", region: "UK", tags: ["Oil", "Energy"] },
  { rank: 31, symbol: "TSM", name: "Taiwan Semiconductor", assetType: "stock", market: "NYSE", region: "Taiwan", tags: ["Semiconductors"] },
  { rank: 32, symbol: "ASML", name: "ASML Holding", assetType: "stock", market: "Nasdaq", region: "Netherlands", tags: ["Semiconductors"] },
  { rank: 33, symbol: "NVO", name: "Novo Nordisk ADR", assetType: "stock", market: "NYSE", region: "Denmark", tags: ["Healthcare"] },
  { rank: 34, symbol: "BABA", name: "Alibaba ADR", assetType: "stock", market: "NYSE", region: "China", tags: ["Ecommerce", "China"] },
  { rank: 35, symbol: "TM", name: "Toyota Motor ADR", assetType: "stock", market: "NYSE", region: "Japan", tags: ["Autos"] },
  { rank: 36, symbol: "SONY", name: "Sony Group ADR", assetType: "stock", market: "NYSE", region: "Japan", tags: ["Consumer tech", "Entertainment"] },
  { rank: 37, symbol: "SHOP", name: "Shopify", assetType: "stock", market: "NYSE", region: "Canada", tags: ["Ecommerce"] },
  { rank: 38, symbol: "MELI", name: "MercadoLibre", assetType: "stock", market: "Nasdaq", region: "Latin America", tags: ["Ecommerce", "Fintech"] },
  { rank: 39, symbol: "RIO", name: "Rio Tinto ADR", assetType: "stock", market: "NYSE", region: "UK/Australia", tags: ["Mining", "Materials"] },
  { rank: 40, symbol: "BHP", name: "BHP Group ADR", assetType: "stock", market: "NYSE", region: "Australia", tags: ["Mining", "Materials"] },
  { rank: 41, symbol: "HSBC", name: "HSBC Holdings ADR", assetType: "stock", market: "NYSE", region: "UK/Hong Kong", tags: ["Banking"] },
  { rank: 42, symbol: "SAP", name: "SAP ADR", assetType: "stock", market: "NYSE", region: "Germany", tags: ["Software"] },
  { rank: 43, symbol: "RELIANCE.NS", name: "Reliance Industries", assetType: "stock", market: "NSE India", region: "India", currency: "INR", tags: ["Energy", "Conglomerate"] },
  { rank: 44, symbol: "INFY.NS", name: "Infosys", assetType: "stock", market: "NSE India", region: "India", currency: "INR", tags: ["Technology"] },
  { rank: 45, symbol: "0700.HK", name: "Tencent Holdings", assetType: "stock", market: "Hong Kong", region: "China", currency: "HKD", tags: ["Internet", "Gaming"] },
  { rank: 46, symbol: "9988.HK", name: "Alibaba Hong Kong", assetType: "stock", market: "Hong Kong", region: "China", currency: "HKD", tags: ["Ecommerce", "China"] },
  { rank: 47, symbol: "7203.T", name: "Toyota Motor", assetType: "stock", market: "Tokyo", region: "Japan", currency: "JPY", tags: ["Autos"] },
  { rank: 48, symbol: "005930.KS", name: "Samsung Electronics", assetType: "stock", market: "Korea Exchange", region: "South Korea", currency: "KRW", tags: ["Semiconductors", "Consumer tech"] },
  { rank: 49, symbol: "MC.PA", name: "LVMH", assetType: "stock", market: "Euronext Paris", region: "France", currency: "EUR", tags: ["Luxury", "Consumer"] },
  { rank: 50, symbol: "NESN.SW", name: "Nestle", assetType: "stock", market: "SIX Swiss", region: "Switzerland", currency: "CHF", tags: ["Consumer staples"] },
  { rank: 51, symbol: "BRK-B", name: "Berkshire Hathaway", assetType: "stock", market: "NYSE", region: "US", tags: ["Insurance", "Conglomerate"] },
  { rank: 52, symbol: "MA", name: "Mastercard", assetType: "stock", market: "NYSE", region: "US", tags: ["Payments"] },
  { rank: 53, symbol: "UNH", name: "UnitedHealth Group", assetType: "stock", market: "NYSE", region: "US", tags: ["Healthcare"] },
  { rank: 54, symbol: "LLY", name: "Eli Lilly", assetType: "stock", market: "NYSE", region: "US", tags: ["Healthcare"] },
  { rank: 55, symbol: "WMT", name: "Walmart", assetType: "stock", market: "NYSE", region: "US", tags: ["Retail"] },
  { rank: 56, symbol: "ORCL", name: "Oracle", assetType: "stock", market: "NYSE", region: "US", tags: ["Cloud", "Software"] },
  { rank: 57, symbol: "IBM", name: "IBM", assetType: "stock", market: "NYSE", region: "US", tags: ["AI", "Enterprise"] },
  { rank: 58, symbol: "CRM", name: "Salesforce", assetType: "stock", market: "NYSE", region: "US", tags: ["Software"] },
  { rank: 59, symbol: "NOW", name: "ServiceNow", assetType: "stock", market: "NYSE", region: "US", tags: ["Software", "Workflow"] },
  { rank: 60, symbol: "INTU", name: "Intuit", assetType: "stock", market: "Nasdaq", region: "US", tags: ["Software", "Fintech"] },
  { rank: 61, symbol: "QCOM", name: "Qualcomm", assetType: "stock", market: "Nasdaq", region: "US", tags: ["Semiconductors"] },
  { rank: 62, symbol: "TXN", name: "Texas Instruments", assetType: "stock", market: "Nasdaq", region: "US", tags: ["Semiconductors"] },
  { rank: 63, symbol: "AMAT", name: "Applied Materials", assetType: "stock", market: "Nasdaq", region: "US", tags: ["Semiconductors"] },
  { rank: 64, symbol: "MU", name: "Micron Technology", assetType: "stock", market: "Nasdaq", region: "US", tags: ["Memory", "Semiconductors"] },
  { rank: 65, symbol: "PANW", name: "Palo Alto Networks", assetType: "stock", market: "Nasdaq", region: "US", tags: ["Cybersecurity"] },
  { rank: 66, symbol: "CRWD", name: "CrowdStrike", assetType: "stock", market: "Nasdaq", region: "US", tags: ["Cybersecurity"] },
  { rank: 67, symbol: "DIS", name: "Walt Disney", assetType: "stock", market: "NYSE", region: "US", tags: ["Entertainment"] },
  { rank: 68, symbol: "NKE", name: "Nike", assetType: "stock", market: "NYSE", region: "US", tags: ["Consumer"] },
  { rank: 69, symbol: "SBUX", name: "Starbucks", assetType: "stock", market: "Nasdaq", region: "US", tags: ["Consumer"] },
  { rank: 70, symbol: "MCD", name: "McDonald's", assetType: "stock", market: "NYSE", region: "US", tags: ["Restaurants"] },
  { rank: 71, symbol: "HD", name: "Home Depot", assetType: "stock", market: "NYSE", region: "US", tags: ["Retail", "Housing"] },
  { rank: 72, symbol: "COST", name: "Costco", assetType: "stock", market: "Nasdaq", region: "US", tags: ["Retail"] },
  { rank: 73, symbol: "WFC", name: "Wells Fargo", assetType: "stock", market: "NYSE", region: "US", tags: ["Banking"] },
  { rank: 74, symbol: "BAC", name: "Bank of America", assetType: "stock", market: "NYSE", region: "US", tags: ["Banking"] },
  { rank: 75, symbol: "GS", name: "Goldman Sachs", assetType: "stock", market: "NYSE", region: "US", tags: ["Banking"] },
  { rank: 76, symbol: "BLK", name: "BlackRock", assetType: "stock", market: "NYSE", region: "US", tags: ["Asset management"] },
  { rank: 77, symbol: "TTE", name: "TotalEnergies ADR", assetType: "stock", market: "NYSE", region: "France", tags: ["Oil", "Energy"] },
  { rank: 78, symbol: "EQNR", name: "Equinor ADR", assetType: "stock", market: "NYSE", region: "Norway", tags: ["Oil", "Energy"] },
  { rank: 79, symbol: "VALE", name: "Vale ADR", assetType: "stock", market: "NYSE", region: "Brazil", tags: ["Mining", "Materials"] },
  { rank: 80, symbol: "PBR", name: "Petrobras ADR", assetType: "stock", market: "NYSE", region: "Brazil", tags: ["Oil", "Energy"] },
  { rank: 81, symbol: "FMX", name: "Fomento Economico Mexicano ADR", assetType: "stock", market: "NYSE", region: "Mexico", tags: ["Consumer", "Latin America"] },
  { rank: 82, symbol: "NU", name: "Nu Holdings", assetType: "stock", market: "NYSE", region: "Latin America", tags: ["Fintech", "Banking"] },
  { rank: 83, symbol: "HDB", name: "HDFC Bank ADR", assetType: "stock", market: "NYSE", region: "India", tags: ["Banking"] },
  { rank: 84, symbol: "TCS.NS", name: "Tata Consultancy Services", assetType: "stock", market: "NSE India", region: "India", currency: "INR", tags: ["Technology"] },
  { rank: 85, symbol: "HDFCBANK.NS", name: "HDFC Bank India", assetType: "stock", market: "NSE India", region: "India", currency: "INR", tags: ["Banking"] },
  { rank: 86, symbol: "0005.HK", name: "HSBC Hong Kong", assetType: "stock", market: "Hong Kong", region: "Hong Kong", currency: "HKD", tags: ["Banking"] },
  { rank: 87, symbol: "1299.HK", name: "AIA Group", assetType: "stock", market: "Hong Kong", region: "Hong Kong", currency: "HKD", tags: ["Insurance"] },
  { rank: 88, symbol: "1810.HK", name: "Xiaomi", assetType: "stock", market: "Hong Kong", region: "China", currency: "HKD", tags: ["Consumer tech"] },
  { rank: 89, symbol: "6758.T", name: "Sony Group Tokyo", assetType: "stock", market: "Tokyo", region: "Japan", currency: "JPY", tags: ["Consumer tech", "Entertainment"] },
  { rank: 90, symbol: "9984.T", name: "SoftBank Group", assetType: "stock", market: "Tokyo", region: "Japan", currency: "JPY", tags: ["Technology", "Investing"] },
  { rank: 91, symbol: "2330.TW", name: "TSMC Taiwan", assetType: "stock", market: "Taiwan", region: "Taiwan", currency: "TWD", tags: ["Semiconductors"] },
  { rank: 92, symbol: "005380.KS", name: "Hyundai Motor", assetType: "stock", market: "Korea Exchange", region: "South Korea", currency: "KRW", tags: ["Autos"] },
  { rank: 93, symbol: "035420.KS", name: "NAVER", assetType: "stock", market: "Korea Exchange", region: "South Korea", currency: "KRW", tags: ["Internet", "AI"] },
  { rank: 94, symbol: "7201.T", name: "Nissan Motor", assetType: "stock", market: "Tokyo", region: "Japan", currency: "JPY", tags: ["Autos"] },
  { rank: 95, symbol: "8306.T", name: "Mitsubishi UFJ Financial", assetType: "stock", market: "Tokyo", region: "Japan", currency: "JPY", tags: ["Banking"] },
  { rank: 96, symbol: "AIR.PA", name: "Airbus", assetType: "stock", market: "Euronext Paris", region: "France", currency: "EUR", tags: ["Aerospace"] },
  { rank: 97, symbol: "OR.PA", name: "L'Oreal", assetType: "stock", market: "Euronext Paris", region: "France", currency: "EUR", tags: ["Consumer"] },
  { rank: 98, symbol: "SIE.DE", name: "Siemens", assetType: "stock", market: "Xetra", region: "Germany", currency: "EUR", tags: ["Industrial", "Automation"] },
  { rank: 99, symbol: "DTE.DE", name: "Deutsche Telekom", assetType: "stock", market: "Xetra", region: "Germany", currency: "EUR", tags: ["Telecom"] },
  { rank: 100, symbol: "AZN.L", name: "AstraZeneca London", assetType: "stock", market: "London", region: "UK", currency: "GBp", tags: ["Healthcare"] }
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
  const products = TRADE_CRYPTO_ASSETS.filter((asset) => asset.product);

  const settled = await Promise.allSettled(products.map(async (asset) => {
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
    return { ...assetCatalogEntry(asset), price: isFinite(price) ? price : null, changePct, marketCap: null };
  }));

  return settled
    .filter((result) => result.status === "fulfilled")
    .map((result) => result.value)
    .filter((asset) => asset.price != null)
    .sort((a, b) => a.rank - b.rank);
}

async function fetchYahooChartSignal(symbol, name) {
  const encoded = encodeURIComponent(symbol);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?range=1d&interval=5m`;
  const json = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Autody/1.0 market preview"
    }
  }).then((r) => {
    if (!r.ok) throw new Error(`Yahoo chart HTTP ${r.status}`);
    return r.json();
  });

  const result = json.chart?.result?.[0];
  const meta = result?.meta || {};
  const price = Number(meta.regularMarketPrice ?? meta.chartPreviousClose);
  const previous = Number(meta.previousClose ?? meta.chartPreviousClose);
  const changePct = isFinite(price) && isFinite(previous) && previous > 0 ? ((price - previous) / previous) * 100 : null;
  return {
    symbol,
    name,
    price: isFinite(price) ? price : null,
    changePct
  };
}

const CHART_RANGE_CONFIG = {
  "1d": { range: "1d", interval: "5m" },
  "1w": { range: "5d", interval: "15m" },
  "1m": { range: "1mo", interval: "1d" },
  "3m": { range: "3mo", interval: "1d" },
  "1y": { range: "1y", interval: "1wk" },
  all: { range: "5y", interval: "1mo" }
};

const COINGECKO_CHART_DAYS = {
  "1d": "1",
  "1w": "7",
  "1m": "30",
  "3m": "90",
  "1y": "365",
  all: "max"
};

async function fetchYahooChartSeries(asset, requestedRange = "1d") {
  const requested = String(requestedRange || "1d").toLowerCase();
  const selectedRange = CHART_RANGE_CONFIG[requested] ? requested : "1d";
  const config = CHART_RANGE_CONFIG[selectedRange];
  const encoded = encodeURIComponent(marketDataSymbol(asset));
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?range=${config.range}&interval=${config.interval}`;
  const json = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Autody/1.0 market detail"
    }
  }).then((r) => {
    if (!r.ok) throw new Error(`Yahoo chart HTTP ${r.status}`);
    return r.json();
  });

  const result = json.chart?.result?.[0];
  const meta = result?.meta || {};
  const timestamps = result?.timestamp || [];
  const quote = result?.indicators?.quote?.[0] || {};
  const closes = quote.close || [];
  const volumes = quote.volume || [];

  const points = timestamps.map((time, index) => ({
    time: new Date(time * 1000).toISOString(),
    close: Number(closes[index]),
    volume: volumes[index] == null ? null : Number(volumes[index])
  })).filter((point) => Number.isFinite(point.close));

  const high = Number(meta.regularMarketDayHigh);
  const low = Number(meta.regularMarketDayLow);
  const previousClose = Number(meta.previousClose ?? meta.chartPreviousClose);
  const volume = Number(meta.regularMarketVolume);

  return {
    range: selectedRange,
    providerSymbol: marketDataSymbol(asset),
    currency: meta.currency || asset.currency || "USD",
    points,
    stats: {
      previousClose: Number.isFinite(previousClose) ? previousClose : null,
      dayHigh: Number.isFinite(high) ? high : null,
      dayLow: Number.isFinite(low) ? low : null,
      volume: Number.isFinite(volume) ? volume : null,
      exchangeName: meta.exchangeName || asset.market || null,
      instrumentType: meta.instrumentType || null
    }
  };
}

function pointRangeStats(points = []) {
  const values = points.map((point) => Number(point.close)).filter(Number.isFinite);
  if (!values.length) return { high: null, low: null };
  return {
    high: Math.max(...values),
    low: Math.min(...values)
  };
}

function sparklineChartSeries(asset, selectedRange = "1w") {
  const prices = Array.isArray(asset.sparkline) ? asset.sparkline.filter(Number.isFinite) : [];
  if (!prices.length) return null;
  const now = Date.now();
  const step = (1000 * 60 * 60 * 24 * 7) / Math.max(1, prices.length - 1);
  const points = prices.map((close, index) => ({
    time: new Date(now - (prices.length - 1 - index) * step).toISOString(),
    close,
    volume: null
  }));
  const range = pointRangeStats(points);
  return {
    range: selectedRange,
    providerSymbol: asset.id || asset.symbol,
    currency: asset.currency || "USD",
    points,
    stats: {
      rangeHigh: range.high,
      rangeLow: range.low,
      allTimeHigh: asset.ath ?? null,
      allTimeLow: asset.atl ?? null,
      volume: asset.totalVolume ?? asset.liquidityUsd ?? null
    }
  };
}

async function fetchCoinGeckoChartSeries(asset, requestedRange = "1d") {
  const requested = String(requestedRange || "1d").toLowerCase();
  const selectedRange = COINGECKO_CHART_DAYS[requested] ? requested : "1d";
  const days = COINGECKO_CHART_DAYS[selectedRange];
  const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(asset.id)}/market_chart?vs_currency=usd&days=${days}&precision=full`;

  try {
    const json = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Autody/1.0 market detail"
      }
    }).then((r) => {
      if (!r.ok) throw new Error(`CoinGecko chart HTTP ${r.status}`);
      return r.json();
    });

    const prices = Array.isArray(json.prices) ? json.prices : [];
    const volumes = Array.isArray(json.total_volumes) ? json.total_volumes : [];
    const marketCaps = Array.isArray(json.market_caps) ? json.market_caps : [];
    const points = prices.map(([time, close], index) => ({
      time: new Date(time).toISOString(),
      close: Number(close),
      volume: volumes[index] ? Number(volumes[index][1]) : null,
      marketCap: marketCaps[index] ? Number(marketCaps[index][1]) : null
    })).filter((point) => Number.isFinite(point.close));

    const range = pointRangeStats(points);
    const lastVolume = [...points].reverse().find((point) => Number.isFinite(point.volume))?.volume ?? asset.totalVolume ?? asset.liquidityUsd ?? null;
    return {
      range: selectedRange,
      providerSymbol: asset.id || asset.symbol,
      currency: "USD",
      points,
      stats: {
        rangeHigh: range.high,
        rangeLow: range.low,
        allTimeHigh: asset.ath ?? null,
        allTimeLow: asset.atl ?? null,
        volume: lastVolume,
        marketCap: asset.marketCap ?? null,
        fdv: asset.fdv ?? null
      }
    };
  } catch (err) {
    const fallback = sparklineChartSeries(asset, selectedRange);
    if (fallback) return fallback;
    throw err;
  }
}

async function fetchYahooAllTimeStats(asset) {
  const encoded = encodeURIComponent(marketDataSymbol(asset));
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?range=max&interval=1mo`;
  const json = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Autody/1.0 market detail"
    }
  }).then((r) => {
    if (!r.ok) throw new Error(`Yahoo all-time chart HTTP ${r.status}`);
    return r.json();
  });

  const result = json.chart?.result?.[0];
  const closes = result?.indicators?.quote?.[0]?.close || [];
  const values = closes.map(Number).filter(Number.isFinite);
  return {
    allTimeHigh: values.length ? Math.max(...values) : null,
    allTimeLow: values.length ? Math.min(...values) : null
  };
}

async function fetchAssetChartSeries(asset, requestedRange = "1d") {
  if (asset.customAsset) {
    return {
      range: CHART_RANGE_CONFIG[String(requestedRange || "1d").toLowerCase()] ? String(requestedRange || "1d").toLowerCase() : "1d",
      providerSymbol: asset.symbol,
      currency: asset.currency || "USD",
      points: [],
      stats: {}
    };
  }

  if (asset.assetType === "crypto" && asset.id && !asset.customAsset) {
    return fetchCoinGeckoChartSeries(asset, requestedRange);
  }

  const chart = await fetchYahooChartSeries(asset, requestedRange);
  const allTimeStats = await fetchYahooAllTimeStats(asset).catch(() => ({}));
  chart.stats = { ...(chart.stats || {}), ...allTimeStats };
  return chart;
}

async function fetchYahooChartAssets(assets) {
  const settled = await Promise.allSettled(assets.map(async (asset) => {
    const quote = await fetchYahooChartSignal(marketDataSymbol(asset), asset.name);
    return {
      ...assetCatalogEntry(asset),
      price: quote.price,
      changePct: quote.changePct,
      date: null,
      time: null
    };
  }));

  return settled
    .filter((result) => result.status === "fulfilled")
    .map((result) => result.value)
    .filter((asset) => asset.price != null)
    .sort((a, b) => a.rank - b.rank);
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

async function fetchCryptoMarketData() {
  try {
    const assets = (await getCryptoCatalogAssets({ forceRefresh: true, throwOnError: true }))
      .filter((asset) => asset.symbol !== AUTODY_MARKET_ASSET.symbol && asset.price != null);

    const minimumUsefulCryptoCount = Math.ceil(CRYPTO_MARKET_LIMIT * 0.7);
    if (assets.length < minimumUsefulCryptoCount) {
      throw new Error(`CoinGecko returned only ${assets.length} crypto assets`);
    }

    saveMarketSnapshots("coingecko", "crypto", assets);
    return { success: true, provider: "coingecko", assets };
  } catch (err) {
    console.error("Crypto market proxy error:", err);
    try {
      const [coinbaseAssets, yahooAssets] = await Promise.all([
        fetchCoinbaseCrypto().catch((fallbackErr) => {
          console.error("Coinbase crypto fallback error:", fallbackErr);
          return [];
        }),
        fetchYahooChartAssets(TRADE_CRYPTO_ASSETS).catch((fallbackErr) => {
          console.error("Yahoo crypto fallback error:", fallbackErr);
          return [];
        })
      ]);
      const assets = mergeRankedMarketAssets(coinbaseAssets, yahooAssets);
      if (!assets.length) throw new Error("Crypto fallbacks returned no assets");
      saveMarketSnapshots("coinbase-yahoo", "crypto", assets);
      return { success: true, provider: "coinbase-yahoo", assets };
    } catch (fallbackErr) {
      console.error("Crypto fallback error:", fallbackErr);
      const cachedAssets = await readLatestMarketSnapshots("crypto", CRYPTO_MARKET_LIMIT);
      if (cachedAssets.length) {
        return { success: true, provider: "supabase-cache", cached: true, assets: cachedAssets };
      }
      return {
        success: true,
        fallback: true,
        error: "Live crypto providers unavailable",
        assets: []
      };
    }
  }
}

async function fetchStockMarketData() {
  try {
    const symbols = TRADE_STOCK_ASSETS.map((asset) => marketDataSymbol(asset)).join(",");
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols}&fields=symbol,shortName,currency,regularMarketPrice,regularMarketChangePercent,regularMarketTime,marketCap,regularMarketVolume,fiftyTwoWeekHigh,fiftyTwoWeekLow`;
    const json = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Autody/1.0 market preview"
      }
    }).then((r) => {
      if (!r.ok) throw new Error(`Yahoo Finance HTTP ${r.status}`);
      return r.json();
    });

    const catalogBySymbol = new Map(TRADE_STOCK_ASSETS.flatMap((asset) => [
      [asset.symbol, asset],
      [marketDataSymbol(asset), asset]
    ]));
    const assets = (json.quoteResponse?.result || []).map((quote) => {
      const catalog = catalogBySymbol.get(quote.symbol) || { symbol: quote.symbol, name: quote.shortName || quote.symbol, assetType: "stock", rank: 999 };
      return {
        ...assetCatalogEntry(catalog),
        name: catalog.name || quote.shortName || quote.symbol,
        currency: quote.currency || catalog.currency || "USD",
        price: quote.regularMarketPrice ?? null,
        changePct: quote.regularMarketChangePercent ?? null,
        marketCap: quote.marketCap ?? null,
        totalVolume: quote.regularMarketVolume ?? null,
        date: quote.regularMarketTime ? new Date(quote.regularMarketTime * 1000).toISOString() : null,
        time: quote.regularMarketTime ?? null
      };
    }).filter((asset) => asset.price != null).sort((a, b) => a.rank - b.rank);

    const minimumUsefulStockCount = Math.ceil(TRADE_STOCK_ASSETS.length * 0.6);
    if (assets.length < minimumUsefulStockCount) {
      throw new Error(`Yahoo quote returned only ${assets.length} stock assets`);
    }

    saveMarketSnapshots("yahoo", "stock", assets);
    return { success: true, provider: "yahoo", assets };
  } catch (err) {
    console.error("Stock market proxy error:", err);
    try {
      const assets = await fetchYahooChartAssets(TRADE_STOCK_ASSETS);
      if (!assets.length) throw new Error("Yahoo chart returned no stock assets");
      saveMarketSnapshots("yahoo-chart", "stock", assets);
      return { success: true, provider: "yahoo-chart", assets };
    } catch (chartErr) {
      console.error("Yahoo chart stock fallback error:", chartErr);
      try {
        const stooqCandidates = TRADE_STOCK_ASSETS.filter((asset) => asset.stooqSymbol || (asset.region === "US" && /^[A-Z]+$/.test(asset.symbol)));
        const stooqSymbols = stooqCandidates.map((asset) => asset.stooqSymbol || `${asset.symbol.toLowerCase()}.us`).join(",");
        const stooqAssets = await fetchStooqQuotes(stooqSymbols);
        const catalogBySymbol = new Map(stooqCandidates.flatMap((asset) => [
          [asset.symbol, asset],
          [(asset.stooqSymbol || `${asset.symbol}.US`).toUpperCase(), asset]
        ]));
        const assets = stooqAssets.map((asset) => {
          const catalog = catalogBySymbol.get(asset.symbol) || catalogBySymbol.get(String(asset.symbol).toUpperCase()) || { symbol: asset.symbol, name: asset.name, assetType: "stock", rank: 999 };
          return {
            ...assetCatalogEntry(catalog),
            price: asset.price,
            changePct: asset.changePct,
            date: asset.date,
            time: asset.time
          };
        }).sort((a, b) => a.rank - b.rank);
        saveMarketSnapshots("stooq", "stock", assets);
        return { success: true, provider: "stooq", assets };
      } catch (fallbackErr) {
        console.error("Stooq stock fallback error:", fallbackErr);
      }

      const cachedAssets = await readLatestMarketSnapshots(["stock", "etf", "commodity", "index", "forex"], TRADE_STOCK_ASSETS.length);
      if (cachedAssets.length) {
        return { success: true, provider: "supabase-cache", cached: true, assets: cachedAssets };
      }
      return {
        success: true,
        fallback: true,
        error: "Live stock providers unavailable",
        assets: []
      };
    }
  }
}

async function fetchSignalMarketData() {
  try {
    const [goldResult, economyResult] = await Promise.allSettled([
      fetchYahooChartSignal("GC=F", "Gold futures"),
      fetchYahooChartSignal("^TNX", "US 10Y Treasury Yield")
    ]);
    const gold = goldResult.status === "fulfilled" ? goldResult.value : null;
    const economy = economyResult.status === "fulfilled" ? economyResult.value : null;

    saveMarketSnapshots("yahoo", "signal", [
      gold ? { symbol: "GC=F", name: gold.name, price: gold.price, changePct: gold.changePct } : null,
      economy ? { symbol: "^TNX", name: economy.name, price: economy.price, changePct: economy.changePct } : null
    ].filter(Boolean));

    return {
      success: true,
      gold: gold ? {
        symbol: "GC=F",
        name: gold.name,
        price: gold.price,
        changePct: gold.changePct,
        date: null,
        time: null
      } : null,
      economy: economy ? {
        name: economy.name,
        value: economy.price,
        changePct: economy.changePct,
        detail: "10Y yield signal"
      } : null
    };
  } catch (err) {
    console.error("Signal proxy error:", err);
    const cachedSignals = await readLatestMarketSnapshots("signal", 2);
    const gold = cachedSignals.find((asset) => asset.symbol === "GC=F");
    const economy = cachedSignals.find((asset) => asset.symbol === "^TNX");
    if (gold || economy) {
      return {
        success: true,
        provider: "supabase-cache",
        cached: true,
        gold: gold ? {
          symbol: gold.symbol,
          name: gold.name,
          price: gold.price,
          changePct: gold.changePct,
          date: gold.capturedAt,
          time: null
        } : null,
        economy: economy ? {
          name: economy.name,
          value: economy.price,
          changePct: economy.changePct,
          detail: "10Y yield signal"
        } : null
      };
    }
    return {
      success: true,
      fallback: true,
      gold: null,
      economy: null
    };
  }
}

async function fetchNewsData() {
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

    saveNewsSnapshots("gdelt-rss", importantArticles);

    return {
      success: true,
      articles: importantArticles.length ? importantArticles : fallbackNews.map(ensureArticleImage),
      fallback: importantArticles.length === 0
    };
  } catch (err) {
    console.error("News proxy error:", err);
    const cachedArticles = await readLatestNewsSnapshots(9);
    if (cachedArticles.length) {
      return { success: true, provider: "supabase-cache", cached: true, articles: cachedArticles };
    }
    return { success: true, articles: fallbackNews.map(ensureArticleImage), fallback: true };
  }
}

async function refreshLiveData({ includeNews = false, reason = "manual" } = {}) {
  const startedAt = new Date();
  const refreshes = [
    ["crypto", fetchCryptoMarketData()],
    ["stocks", fetchStockMarketData()],
    ["signals", fetchSignalMarketData()]
  ];

  if (includeNews) refreshes.push(["news", fetchNewsData()]);

  const settled = await Promise.allSettled(refreshes.map(([, promise]) => promise));
  const results = {};

  settled.forEach((result, index) => {
    const key = refreshes[index][0];
    const value = result.status === "fulfilled" ? result.value : null;
    const count = value
      ? value.assets?.length ?? value.articles?.length ?? [value.gold, value.economy].filter(Boolean).length
      : 0;
    results[key] = result.status === "fulfilled"
      ? { ok: true, provider: value.provider || null, count }
      : { ok: false, error: String(result.reason?.message || result.reason) };
  });

  return {
    success: true,
    reason,
    database: databaseConfigured() ? "supabase-postgres" : "json",
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    results
  };
}

async function runLiveRefresh(options = {}) {
  if (liveRefreshInFlight) return liveRefreshInFlight;

  liveRefreshInFlight = refreshLiveData(options)
    .then((result) => {
      lastLiveRefresh = result;
      return result;
    })
    .finally(() => {
      liveRefreshInFlight = null;
    });

  return liveRefreshInFlight;
}

function startLiveDataRefreshLoop() {
  if (!databaseConfigured()) return;

  const startupTimer = setTimeout(() => {
    runLiveRefresh({ includeNews: true, reason: "startup" }).catch((err) => {
      console.error("Startup live data refresh failed:", err);
    });
  }, 5000);
  startupTimer.unref?.();

  if (LIVE_MARKET_REFRESH_MS > 0) {
    const marketTimer = setInterval(() => {
      runLiveRefresh({ includeNews: false, reason: "market-interval" }).catch((err) => {
        console.error("Market refresh interval failed:", err);
      });
    }, LIVE_MARKET_REFRESH_MS);
    marketTimer.unref?.();
  }

  if (LIVE_NEWS_REFRESH_MS > 0) {
    const newsTimer = setInterval(() => {
      runLiveRefresh({ includeNews: true, reason: "news-interval" }).catch((err) => {
        console.error("News refresh interval failed:", err);
      });
    }, LIVE_NEWS_REFRESH_MS);
    newsTimer.unref?.();
  }
}

app.get("/api/db/status", async (req, res) => {
  if (!databaseConfigured()) {
    return res.json({
      success: true,
      configured: false,
      provider: "json",
      message: "DATABASE_URL is not set. Autody is using the local JSON seed."
    });
  }

  try {
    const result = await dbPool.query("select now() as connected_at");
    return res.json({
      success: true,
      configured: true,
      provider: "supabase-postgres",
      connectedAt: result.rows[0]?.connected_at
    });
  } catch (err) {
    console.error("Database status error:", err);
    return res.status(500).json({
      success: false,
      configured: true,
      provider: "supabase-postgres",
      error: "Database connection failed"
    });
  }
});

app.get("/api/markets/snapshots", async (req, res) => {
  if (!databaseConfigured()) {
    return res.json({ success: true, configured: false, snapshots: [] });
  }

  try {
    const symbol = String(req.query.symbol || "").trim().toUpperCase();
    const limit = Math.min(Number(req.query.limit || 30), 100);
    const result = symbol
      ? await dbPool.query(`
          select provider, symbol, asset_name, asset_type, price_usd, change_pct, market_cap_usd, currency, captured_at
          from market_snapshots
          where upper(symbol) = $1
          order by captured_at desc
          limit $2
        `, [symbol, limit])
      : await dbPool.query(`
          select distinct on (symbol) provider, symbol, asset_name, asset_type, price_usd, change_pct, market_cap_usd, currency, captured_at
          from market_snapshots
          order by symbol, captured_at desc
          limit $1
        `, [limit]);

    return res.json({ success: true, configured: true, snapshots: result.rows });
  } catch (err) {
    console.error("Market snapshot read failed:", err);
    return res.status(500).json({ success: false, error: "Market snapshots unavailable" });
  }
});

app.get("/api/news/snapshots", async (req, res) => {
  if (!databaseConfigured()) {
    return res.json({ success: true, configured: false, articles: [] });
  }

  try {
    const limit = Math.min(Number(req.query.limit || 9), 30);
    const result = await dbPool.query(`
        select provider, source, subject, title, image_url as image, article_url as url, published_at, captured_at
        from news_snapshots
        order by coalesce(published_at, captured_at) desc
        limit $1
      `, [limit]);

    return res.json({ success: true, configured: true, articles: result.rows });
  } catch (err) {
    console.error("News snapshot read failed:", err);
    return res.status(500).json({ success: false, error: "News snapshots unavailable" });
  }
});

app.get("/api/markets/catalog", async (req, res) => {
  try {
    const type = String(req.query.type || "all").toLowerCase();
    const safeType = ["all", "crypto", "stocks"].includes(type) ? type : "all";
    const assets = await buildMarketCatalog(safeType);
    return res.json({
      success: true,
      type: safeType,
      configured: databaseConfigured(),
      count: assets.length,
      assets
    });
  } catch (err) {
    console.error("Market catalog error:", err);
    return res.status(500).json({ success: false, error: "Market catalog unavailable" });
  }
});

app.get("/api/markets/asset/:symbol", async (req, res) => {
  try {
    const symbol = decodeURIComponent(req.params.symbol || "").trim().toUpperCase();
    const range = String(req.query.range || "1d").toLowerCase();
    const assets = await buildMarketCatalog("all");
    const asset = assets.find((item) => {
      const candidates = [item.symbol, item.id, item.providerSymbol].filter(Boolean).map((value) => String(value).toUpperCase());
      return candidates.includes(symbol);
    });

    if (!asset) {
      return res.status(404).json({ success: false, error: "Asset not found" });
    }

    const [chartResult, accountResult] = await Promise.allSettled([
      fetchAssetChartSeries(asset, range),
      getPracticeAccountAny()
    ]);

    const chart = chartResult.status === "fulfilled"
      ? chartResult.value
      : { range, providerSymbol: asset.providerSymbol, currency: asset.currency || "USD", points: [], stats: {} };

    const account = accountResult.status === "fulfilled" ? accountResult.value : null;
    const holding = account?.wallet?.holdings?.find((item) => String(item.symbol).toUpperCase() === asset.symbol) || null;
    const orders = (account?.orders || [])
      .filter((order) => String(order.symbol).toUpperCase() === asset.symbol)
      .slice(0, 8);

    return res.json({
      success: true,
      asset,
      chart,
      demo: {
        buyingPower: account?.user?.cashBalance ?? 50000,
        startingBalance: account?.user?.startingBalance ?? 50000,
        holding,
        orders
      }
    });
  } catch (err) {
    console.error("Market asset detail error:", err);
    return res.status(500).json({ success: false, error: "Market asset unavailable" });
  }
});

app.get("/api/live/status", (req, res) => {
  return res.json({
    success: true,
    database: databaseConfigured() ? "supabase-postgres" : "json",
    refreshInFlight: Boolean(liveRefreshInFlight),
    lastRefresh: lastLiveRefresh
  });
});

app.post("/api/live/refresh", async (req, res) => {
  try {
    const includeNews = req.query.news !== "false";
    const result = await runLiveRefresh({ includeNews, reason: "manual-api" });
    return res.json(result);
  } catch (err) {
    console.error("Manual live refresh failed:", err);
    return res.status(500).json({ success: false, error: "Live refresh failed" });
  }
});

app.get("/api/live/refresh", async (req, res) => {
  try {
    const includeNews = req.query.news !== "false";
    const result = await runLiveRefresh({ includeNews, reason: "manual-api" });
    return res.json(result);
  } catch (err) {
    console.error("Manual live refresh failed:", err);
    return res.status(500).json({ success: false, error: "Live refresh failed" });
  }
});

app.get("/api/markets/crypto", async (req, res) => {
  return res.json(await fetchCryptoMarketData());
});

app.get("/api/markets/stocks", async (req, res) => {
  return res.json(await fetchStockMarketData());
});

app.get("/api/markets/signals", async (req, res) => {
  return res.json(await fetchSignalMarketData());
});

app.get("/api/news", async (req, res) => {
  return res.json(await fetchNewsData());
});

app.post("/api/auth/sign-in", async (req, res) => {
  try {
    const body = parseJsonBody(req);
    const email = normalizeEmail(body.email);
    const password = String(body.password || "");
    const databaseSignIn = await signInFromDatabase(email, password).catch((err) => {
      console.error("Supabase sign in failed, using JSON fallback:", err);
      return null;
    });

    if (databaseSignIn) {
      return res.json({
        success: true,
        user: databaseSignIn.user,
        session: databaseSignIn.session,
        next: "account.html",
        source: "supabase"
      });
    }

    const db = loadDemoDb();
    const user = db.users.find((item) => normalizeEmail(item.email) === email);

    if (!user || !verifyPassword(password, user.auth)) {
      return res.status(401).json({
        success: false,
        error: "Email or password is incorrect."
      });
    }

    const session = createDemoSession(db, user.id);
    return res.json({
      success: true,
      user: publicUser(user),
      session,
      next: "account.html",
      source: "json"
    });
  } catch (err) {
    console.error("Sign in error:", err);
    return res.status(500).json({ success: false, error: "Sign in unavailable" });
  }
});

app.get("/api/demo/practice-user", async (req, res) => {
  try {
    const account = await getPracticeAccountAny();
    return res.json({
      success: true,
      user: publicUser(account.user),
      wallet: account.wallet,
      orders: account.orders,
      watchlist: account.watchlist,
      researchPreferences: account.researchPreferences,
      performance: account.performance,
      settings: account.settings,
      source: account.source
    });
  } catch (err) {
    console.error("Practice user API error:", err);
    return res.status(500).json({ success: false, error: "Practice account unavailable" });
  }
});

app.get("/api/demo/wallet", async (req, res) => {
  try {
    const account = await getPracticeAccountAny();
    const cash = account.wallet.cash;
    const holdings = [cash, ...account.wallet.holdings];
    const totalValue = holdings.reduce((sum, asset) => sum + Number(asset.valueUsd || 0), 0);

    return res.json({
      success: true,
      user: publicUser(account.user),
      wallet: {
        currency: account.user.currency,
        startingBalance: account.user.startingBalance,
        cashBalance: account.user.cashBalance,
        reservedCash: account.user.reservedCash,
        totalValue,
        holdings
      },
      source: account.source
    });
  } catch (err) {
    console.error("Demo wallet API error:", err);
    return res.status(500).json({ success: false, error: "Demo wallet unavailable" });
  }
});

app.get("/api/demo/orders", async (req, res) => {
  try {
    const account = await getPracticeAccountAny();
    return res.json({
      success: true,
      user: publicUser(account.user),
      orders: account.orders,
      source: account.source
    });
  } catch (err) {
    console.error("Demo orders API error:", err);
    return res.status(500).json({ success: false, error: "Demo orders unavailable" });
  }
});

app.get("/api/demo/watchlist", async (req, res) => {
  try {
    const account = await getPracticeAccountAny();
    return res.json({
      success: true,
      user: publicUser(account.user),
      watchlist: account.watchlist,
      source: account.source
    });
  } catch (err) {
    console.error("Demo watchlist API error:", err);
    return res.status(500).json({ success: false, error: "Demo watchlist unavailable" });
  }
});

app.get("/api/demo/performance", async (req, res) => {
  try {
    const account = await getPracticeAccountAny();
    return res.json({
      success: true,
      user: publicUser(account.user),
      performance: account.performance,
      source: account.source
    });
  } catch (err) {
    console.error("Demo performance API error:", err);
    return res.status(500).json({ success: false, error: "Demo performance unavailable" });
  }
});

app.get("/api/demo/settings", async (req, res) => {
  try {
    const account = await getPracticeAccountAny();
    return res.json({
      success: true,
      user: publicUser(account.user),
      settings: account.settings,
      source: account.source
    });
  } catch (err) {
    console.error("Demo settings API error:", err);
    return res.status(500).json({ success: false, error: "Demo settings unavailable" });
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

async function startServer() {
  await initializeDatabase();

  app.listen(PORT, () => {
    console.log(`Autody is running at http://localhost:${PORT}`);
    startLiveDataRefreshLoop();
  });
}

startServer().catch((err) => {
  console.error("Autody startup failed:", err);
  process.exit(1);
});
