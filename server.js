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
const DB_QUERY_TIMEOUT_MS = Number(process.env.DB_QUERY_TIMEOUT_MS || 15000);
const DB_SLOW_RETRY_MS = Number(process.env.DB_SLOW_RETRY_MS || 30 * 1000);
const DB_STARTUP_FALLBACK_MS = Number(process.env.DB_STARTUP_FALLBACK_MS || 10 * 1000);
const DB_POOL_MAX = Number(process.env.DB_POOL_MAX || 3);
const DEMO_ACCOUNT_CACHE_MS = Number(process.env.DEMO_ACCOUNT_CACHE_MS || 8000);
const dbPool = DATABASE_URL ? new Pool({
    connectionString: DATABASE_URL,
    ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false },
    max: DB_POOL_MAX,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: DB_QUERY_TIMEOUT_MS,
    query_timeout: DB_QUERY_TIMEOUT_MS,
    statement_timeout: DB_QUERY_TIMEOUT_MS
}) : null;
const CHART_RANGE_KEYS = ["1d", "1w", "1m", "3m", "1y", "all"];
const LIVE_MARKET_REFRESH_MS = Number(process.env.LIVE_MARKET_REFRESH_MS || 2 * 60 * 1000);
const LIVE_MARKET_STALE_MS = Number(process.env.LIVE_MARKET_STALE_MS || Math.max(2 * 60 * 1000, LIVE_MARKET_REFRESH_MS));
const LIVE_CHART_REFRESH_MS = Number(process.env.LIVE_CHART_REFRESH_MS || 0);
const LIVE_NEWS_REFRESH_MS = Number(process.env.LIVE_NEWS_REFRESH_MS || 30 * 60 * 1000);
const MARKET_CATALOG_CACHE_MS = Number(process.env.MARKET_CATALOG_CACHE_MS || 15 * 1000);
const REQUEST_TRIGGERED_REFRESH_ENABLED = process.env.REQUEST_TRIGGERED_REFRESH_ENABLED !== "false";
const STARTUP_MARKET_REFRESH_DELAY_MS = Number(process.env.STARTUP_MARKET_REFRESH_DELAY_MS || 8 * 1000);
const STARTUP_CHART_REFRESH_DELAY_MS = Number(process.env.STARTUP_CHART_REFRESH_DELAY_MS || 0);
const LIVE_CHART_REFRESH_SYMBOLS = (process.env.LIVE_CHART_REFRESH_SYMBOLS || "BTC,ETH,SOL,SPY,QQQ,GLD,GC=F,CL=F")
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean);
const LIVE_CHART_REFRESH_RANGES = Array.from(new Set((process.env.LIVE_CHART_REFRESH_RANGES || CHART_RANGE_KEYS.join(","))
    .split(",")
    .map((range) => normalizeChartRange(range.trim().toLowerCase()))
    .filter(Boolean)));
const MARKET_BROWSER_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
let liveRefreshInFlight = null;
let lastLiveRefresh = null;
let chartRefreshInFlight = null;
let lastChartRefresh = null;
let liveMarketAssetCache = { assets: [], bySymbol: new Map(), updatedAt: 0 };
const marketCatalogCache = new Map();
const SERVER_STARTED_AT = Date.now();
let dbSlowUntil = SERVER_STARTED_AT + DB_STARTUP_FALLBACK_MS;
let practiceAccountCache = null;

function withTimeout(promise, ms, label = "Operation") {
    let timeout;
    const timeoutPromise = new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
        timeout.unref?.();
    });
    return Promise.race([
        Promise.resolve(promise).finally(() => clearTimeout(timeout)),
        timeoutPromise
    ]);
}

function dbCircuitOpen() {
    return Date.now() < dbSlowUntil;
}

function markDatabaseSlow(err) {
    dbSlowUntil = Date.now() + DB_SLOW_RETRY_MS;
    if (err) console.warn(`Database fallback active for ${DB_SLOW_RETRY_MS}ms:`, err.message || err);
}

async function withDbTimeout(promise, label = "Database query") {
    try {
        return await withTimeout(promise, DB_QUERY_TIMEOUT_MS, label);
    } catch (err) {
        markDatabaseSlow(err);
        throw err;
    }
}

function temporaryDatabaseError(err) {
    const message = String(err?.message || err || "");
    const code = String(err?.code || "");
    return /timeout|timed out|terminated|connection|ECONN|ETIMEDOUT|ECONNRESET|server closed|too many clients|remaining connection slots|read-only transaction|read only transaction/i.test(`${code} ${message}`);
}

function readOnlyTransactionError(err) {
    const message = String(err?.message || err || "");
    return /read-only transaction|read only transaction/i.test(message);
}

async function withDemoWriteFallback(label, databaseWrite, jsonWrite) {
    if (databaseConfigured()) {
        try {
            return await databaseWrite();
        } catch (err) {
            if (!temporaryDatabaseError(err)) throw err;
            if (!readOnlyTransactionError(err)) markDatabaseSlow(err);
            console.error(`${label} could not reach Supabase persistent storage:`, err.message || err);
            throw persistentDemoUnavailable(err);
        }
    }

    return jsonWrite();
}

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
            demo: {
                crypto: ["BTC", "ETH", "SOL", "DOGE", "ADA", "AU"],
                stocks: ["SPY", "QQQ", "AAPL", "NVDA", "TSLA", "MSFT"]
            },
            live: {
                crypto: [],
                stocks: []
            }
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
    const data = JSON.parse(fs.readFileSync(DEMO_DB_STORE, "utf8"));
    if (normalizeJsonWatchlists(data)) saveDemoDb(data);
    return data;
}

function saveDemoDb(data) {
    ensureDemoDb();
    fs.writeFileSync(DEMO_DB_STORE, JSON.stringify(data, null, 2));
}

function defaultWatchlistForMode(mode = "demo") {
    return mode === "live"
        ? { crypto: [], stocks: [] }
        : {
            crypto: ["BTC", "ETH", "SOL", "DOGE", "ADA", "AU"],
            stocks: ["SPY", "QQQ", "AAPL", "NVDA", "TSLA", "MSFT"]
        };
}

function normalizeWatchlistMode(mode = "demo") {
    return mode === "live" ? "live" : "demo";
}

function normalizeJsonWatchlists(db) {
    db.watchlists = db.watchlists || {};
    const bucket = db.watchlists[PRACTICE_USER_ID];
    let changed = false;

    if (!bucket) {
        db.watchlists[PRACTICE_USER_ID] = {
            demo: defaultWatchlistForMode("demo"),
            live: defaultWatchlistForMode("live")
        };
        return true;
    }

    if (Array.isArray(bucket.crypto) || Array.isArray(bucket.stocks)) {
        db.watchlists[PRACTICE_USER_ID] = {
            demo: {
                crypto: Array.from(new Set(bucket.crypto || [])),
                stocks: Array.from(new Set(bucket.stocks || []))
            },
            live: defaultWatchlistForMode("live")
        };
        return true;
    }

    ["demo", "live"].forEach((mode) => {
        if (!bucket[mode]) {
            bucket[mode] = defaultWatchlistForMode(mode);
            changed = true;
        }
        bucket[mode].crypto = Array.from(new Set(bucket[mode].crypto || []));
        bucket[mode].stocks = Array.from(new Set(bucket[mode].stocks || []));
    });

    return changed;
}

function jsonWatchlistForMode(db, mode = "demo") {
    normalizeJsonWatchlists(db);
    return db.watchlists[PRACTICE_USER_ID][normalizeWatchlistMode(mode)];
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
        watchlist: jsonWatchlistForMode(db, "demo"),
        researchPreferences: db.researchPreferences[PRACTICE_USER_ID] || [],
        performance: db.performance?.[PRACTICE_USER_ID],
        settings: db.settings?.[PRACTICE_USER_ID]
    };
}

function databaseConfigured() {
    return Boolean(dbPool);
}

function cloneDemoAccount(account) {
    return account ? JSON.parse(JSON.stringify(account)) : null;
}

function cachePracticeAccount(account, source = "supabase") {
    if (!account || !databaseConfigured()) return account;
    practiceAccountCache = {
        account: cloneDemoAccount({ ...account, source }),
        cachedAt: Date.now()
    };
    return account;
}

function cachedPracticeAccount({ allowStale = false } = {}) {
    if (!practiceAccountCache?.account) return null;
    const age = Date.now() - practiceAccountCache.cachedAt;
    if (!allowStale && age > DEMO_ACCOUNT_CACHE_MS) return null;
    return cloneDemoAccount(practiceAccountCache.account);
}

function clearPracticeAccountCache() {
    practiceAccountCache = null;
}

function persistentDemoUnavailable(err) {
    const message = err?.message || "The demo account database is not responding.";
    const wrapped = demoTradeError(503, "Demo account storage is temporarily unavailable. Please try again in a moment.");
    wrapped.details = message;
    return wrapped;
}

function sendDemoError(res, err, fallbackMessage) {
    const status = err?.status || 500;
    return res.status(status).json({
        success: false,
        error: err?.message || fallbackMessage,
        retryable: status === 503 || temporaryDatabaseError(err)
    });
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

function nullableNumber(value) {
    if (value === undefined || value === null || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function positiveNumber(value) {
    const number = nullableNumber(value);
    return number && number > 0 ? number : null;
}

function firstPositive(...values) {
    for (const value of values) {
        const number = positiveNumber(value);
        if (number !== null) return number;
    }
    return null;
}

function firstPresent(...values) {
    return values.find((value) => value !== undefined && value !== null);
}

function catalogAssets(type = "all") {
    if (type === "crypto") return TRADE_CRYPTO_ASSETS;
    if (type === "stocks") return TRADE_STOCK_ASSETS;
    return [...TRADE_CRYPTO_ASSETS, ...TRADE_STOCK_ASSETS];
}

function marketDataSymbol(asset) {
    return asset.providerSymbol || asset.yahooSymbol || asset.product || asset.symbol;
}

const FINANCIAL_LOGO_SYMBOLS = {
    "GC=F": "GLD",
    "SI=F": "SLV",
    "CL=F": "USO",
    "BZ=F": "BNO",
    "NG=F": "UNG",
    "HG=F": "CPER",
    "PL=F": "PPLT",
    "PA=F": "PALL",
    "ZC=F": "CORN",
    "ZW=F": "WEAT",
    "ZS=F": "SOYB",
    "KC=F": "JO",
    "SB=F": "CANE",
    "CC=F": "NIB",
    "CT=F": "BAL"
};

const CRYPTO_ICON_SYMBOLS = {
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
    TON: "ton",
    SUI: "sui",
    HBAR: "hbar",
    SHIB: "shib",
    POL: "pol",
    UNI: "uni",
    AAVE: "aave",
    ATOM: "atom",
    NEAR: "near",
    APT: "apt",
    ARB: "arb",
    OP: "op",
    INJ: "inj",
    ICP: "icp",
    FIL: "fil",
    ETC: "etc",
    VET: "vet",
    ALGO: "algo",
    XMR: "xmr",
    FET: "fet",
    RENDER: "render",
    PEPE: "pepe",
    BONK: "bonk",
    WIF: "wif",
    DAI: "dai",
    PYUSD: "pyusd",
    FDUSD: "fdusd",
    TUSD: "tusd",
    MKR: "mkr",
    LDO: "ldo",
    QNT: "qnt",
    GRT: "grt",
    CRV: "crv",
    MANA: "mana"
};

const STATIC_MARKET_QUOTES = {
    BTC: { price: 64150.38, changePct: 0.52 },
    ETH: { price: 1688.42, changePct: 0.44 },
    USDT: { price: 0.9995, changePct: 0.01 },
    USDC: { price: 1.0001, changePct: 0 },
    SOL: { price: 68.12, changePct: 1.08 },
    XRP: { price: 1.14, changePct: -0.27 },
    BNB: { price: 607.4, changePct: 0.34 },
    DOGE: { price: 0.1412, changePct: 0.66 },
    BCH: { price: 478.2, changePct: 0.42 },
    AAPL: { price: 291.13, changePct: 0.31 },
    NVDA: { price: 205.19, changePct: 1.12 },
    TSLA: { price: 406.43, changePct: -0.84 },
    MSFT: { price: 390.74, changePct: 0.26 },
    AMZN: { price: 188.41, changePct: 0.18 },
    SPY: { price: 741.75, changePct: 0.24 },
    QQQ: { price: 721.34, changePct: 0.38 },
    VOO: { price: 680.12, changePct: 0.23 },
    GLD: { price: 304.2, changePct: 0.19 },
    VT: { price: 120.3, changePct: 0.16 },
    "GC=F": { price: 3340.2, changePct: 0.22 },
    "SI=F": { price: 36.25, changePct: -0.13 },
    "CL=F": { price: 68.31, changePct: 0.41 },
    "BZ=F": { price: 72.8, changePct: 0.35 },
    "NG=F": { price: 3.42, changePct: -0.74 }
};

function financialLogoSymbol(asset) {
    const provider = marketDataSymbol(asset);
    const symbol = String(provider || asset.symbol || "").toUpperCase();
    return FINANCIAL_LOGO_SYMBOLS[symbol] || symbol.replace(/\.[A-Z]+$/, "");
}

function cryptoLogoSymbol(asset) {
    const symbol = String(asset.symbol || "").toUpperCase();
    return (CRYPTO_ICON_SYMBOLS[symbol] || symbol)
        .replace(/[^a-z0-9]/gi, "")
        .toLowerCase();
}

function assetLogoUrl(asset) {
    if (asset.logoUrl || asset.image) return asset.logoUrl || asset.image;
    if (asset.customAsset || asset.symbol === "AU") return "Autody-Logo.png";
    if (asset.assetType === "crypto") {
        const symbol = cryptoLogoSymbol(asset);
        return symbol ? `https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/128/color/${encodeURIComponent(symbol)}.png` : null;
    }
    if (asset.assetType && asset.assetType !== "crypto") {
        const symbol = financialLogoSymbol(asset);
        return symbol ? `https://financialmodelingprep.com/image-stock/${encodeURIComponent(symbol)}.png` : null;
    }
    return null;
}

function fallbackMarketQuote(symbol) {
    return STATIC_MARKET_QUOTES[String(symbol || "").toUpperCase()] || {};
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
        logoUrl: assetLogoUrl(asset),
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
    const balance = numberValue(row.quantity, 0);
    const valueUsd = numberValue(row.value_usd, 0);
    return {
        symbol: row.symbol,
        name: row.asset_name,
        category: row.asset_type,
        balance,
        averageCost: nullableNumber(row.average_cost),
        lastPrice: nullableNumber(row.last_price),
        valueUsd,
        updatedAt: row.updated_at,
        status: balance > 0 ? "Held" : row.symbol === "AU" ? "Not held" : "Ready"
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
            select symbol, asset_name, asset_type, quantity, average_cost, last_price, value_usd, updated_at
            from holdings
            where wallet_id = $1
            order by case symbol when 'USD' then 0 when 'AU' then 1 when 'CRYPTO' then 2 when 'STOCKS' then 3 else 4 end, symbol
        `, [row.wallet_id]),
        dbPool.query(`
            select id, symbol, asset_type, side, order_type, status, quantity, notional_usd, limit_price, filled_price, created_at, filled_at
            from orders
            where account_mode_id = $1
            order by created_at desc
            limit 50
        `, [row.account_mode_id]),
        dbPool.query(`
            select symbol, asset_type
            from watchlists
            where profile_id = $1
              and mode = 'demo'
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
    const watchlist = reduceWatchlistRows(watchlistResult.rows);

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
        const cached = cachedPracticeAccount();
        if (cached) return cached;

        try {
            const account = await withDbTimeout(
                getPracticeAccountFromDatabase(),
                "Supabase practice account read"
            );
            if (account) {
                cachePracticeAccount(account);
                return { ...account, source: "supabase" };
            }
        } catch (err) {
            const stale = cachedPracticeAccount({ allowStale: true });
            if (stale) {
                console.error("Supabase practice account read failed, serving cached persistent account:", err.message || err);
                return { ...stale, source: "supabase-cache" };
            }
            console.error("Supabase practice account read failed:", err.message || err);
            throw persistentDemoUnavailable(err);
        }
    }

    return { ...getPracticeAccount(), source: "json" };
}

const WALLET_GROUP_SYMBOLS = new Set(["USD", "CRYPTO", "STOCKS"]);

function walletHoldingUrl(holding) {
    const symbol = String(holding.symbol || "").toUpperCase();
    if (symbol === "USD") return "demo-wallet.html?asset=USD";
    if (symbol === "CRYPTO") return "demo-markets.html?filter=crypto";
    if (symbol === "STOCKS") return "demo-markets.html?filter=stocks";
    return `demo-asset.html?symbol=${encodeURIComponent(symbol)}`;
}

function walletDefaultHolding(symbol, name, category, status = "Ready") {
    return {
        symbol,
        name,
        category,
        balance: 0,
        valueUsd: 0,
        status
    };
}

function walletRecordFromOrder(order) {
    const side = String(order.side || "order").toLowerCase();
    const symbol = String(order.symbol || "").toUpperCase();
    const status = order.status || "draft";
    const valueUsd = numberValue(order.notional_usd ?? order.notionalUsd, 0);

    return {
        type: side,
        title: `${side.charAt(0).toUpperCase()}${side.slice(1)} ${symbol}`,
        symbol,
        assetType: order.asset_type || order.assetType || "market",
        valueUsd,
        status,
        createdAt: order.created_at || order.createdAt || null
    };
}

function buildWalletRecords(account) {
    const orderRecords = (account.orders || []).map(walletRecordFromOrder);
    const fundingRecord = {
        type: "funding",
        title: "Demo account funded",
        symbol: "USD",
        assetType: "cash",
        valueUsd: numberValue(account.user.startingBalance, 50000),
        status: "complete",
        createdAt: account.user.createdAt || null
    };

    return [fundingRecord, ...orderRecords]
        .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0))
        .slice(0, 8);
}

async function buildDemoWalletSnapshot(account) {
    const baseCash = account.wallet.cash || walletDefaultHolding("USD", "USD Cash", "cash", "Available");
    const rawHoldings = account.wallet.holdings || [];
    const holdingsBySymbol = new Map(rawHoldings.map((holding) => [String(holding.symbol || "").toUpperCase(), holding]));
    const symbolsForMarket = [...holdingsBySymbol.keys()]
        .filter((symbol) => symbol !== "AU" && !WALLET_GROUP_SYMBOLS.has(symbol));
    const marketAssets = symbolsForMarket.length
        ? (await Promise.all(symbolsForMarket.map((symbol) => findMarketAssetBySymbol(symbol).catch(() => null)))).filter(Boolean)
        : [];
    const marketMap = new Map(marketAssets.map((asset) => [String(asset.symbol || "").toUpperCase(), asset]));

    const cash = {
        ...baseCash,
        symbol: "USD",
        name: "USD Cash",
        category: "cash",
        balance: numberValue(account.user.cashBalance, baseCash.balance),
        valueUsd: numberValue(account.user.cashBalance, baseCash.valueUsd),
        price: 1,
        changePct: null,
        url: walletHoldingUrl({ symbol: "USD" }),
        status: "Available",
        detail: "Buying power"
    };

    const enrichHolding = (holding) => {
        const symbol = String(holding.symbol || "").toUpperCase();
        const marketAsset = marketMap.get(symbol);
        const symbolOrders = (account.orders || [])
            .filter((order) => String(order.symbol || "").toUpperCase() === symbol)
            .filter((order) => ["buy", "swap"].includes(String(order.side || "").toLowerCase()))
            .map((order) => safeIsoDate(order.created_at || order.createdAt || order.filled_at || order.filledAt))
            .filter(Boolean)
            .sort();
        const category = holding.category || marketAsset?.assetType || "market";
        const balance = numberValue(holding.balance, 0);
        const price = firstPositive(marketAsset?.price, holding.lastPrice);
        const valueUsd = symbol === "USD"
            ? cash.valueUsd
            : balance > 0 && price != null
                ? balance * price
                : numberValue(holding.valueUsd, 0);
        const averageCost = positiveNumber(holding.averageCost);
        const costBasis = averageCost != null && balance > 0 ? averageCost * balance : null;
        const unrealizedProfitLoss = costBasis != null ? valueUsd - costBasis : null;

        return {
            ...holding,
            symbol,
            name: holding.name || marketAsset?.name || symbol,
            category,
            assetType: category,
            balance,
            price,
            changePct: nullableNumber(marketAsset?.changePct),
            market: marketAsset?.market || holding.market || null,
            logoUrl: marketAsset?.logoUrl || holding.logoUrl || null,
            valueUsd,
            averageCost,
            costBasis,
            unrealizedProfitLoss,
            firstPurchasedAt: symbolOrders[0] || null,
            lastPurchasedAt: symbolOrders[symbolOrders.length - 1] || holding.updatedAt || marketAsset?.capturedAt || null,
            url: walletHoldingUrl({ symbol }),
            status: balance > 0 ? "Held" : symbol === "AU" ? "Not held" : "Ready",
            updatedAt: holding.updatedAt || marketAsset?.capturedAt || null
        };
    };

    const au = enrichHolding(holdingsBySymbol.get("AU") || walletDefaultHolding("AU", "Autody AU", "currency", "Not held"));
    const rawPositionHoldings = rawHoldings.filter((holding) => {
        const symbol = String(holding.symbol || "").toUpperCase();
        return symbol !== "AU" && !WALLET_GROUP_SYMBOLS.has(symbol);
    });
    const positions = rawPositionHoldings.map(enrichHolding).filter((holding) => holding.balance > 0 || holding.valueUsd > 0);
    const cryptoPositions = positions.filter((holding) => holding.category === "crypto" || holding.category === "currency");
    const stockPositions = positions.filter((holding) => ["stock", "stocks", "etf", "commodity"].includes(holding.category));
    const cryptoValue = cryptoPositions.reduce((sum, holding) => sum + numberValue(holding.valueUsd, 0), 0);
    const stockValue = stockPositions.reduce((sum, holding) => sum + numberValue(holding.valueUsd, 0), 0);
    const auValue = numberValue(au.valueUsd, 0);
    const totalValue = cash.valueUsd + auValue + cryptoValue + stockValue;
    const investedValue = auValue + cryptoValue + stockValue;

    const cryptoGroup = {
        ...walletDefaultHolding("CRYPTO", "Crypto", "crypto"),
        balance: cryptoPositions.length,
        valueUsd: cryptoValue,
        url: walletHoldingUrl({ symbol: "CRYPTO" }),
        status: cryptoPositions.length ? "Tracking" : "Ready",
        detail: "Digital assets"
    };
    const stockGroup = {
        ...walletDefaultHolding("STOCKS", "Stocks", "stock"),
        balance: stockPositions.length,
        valueUsd: stockValue,
        url: walletHoldingUrl({ symbol: "STOCKS" }),
        status: stockPositions.length ? "Tracking" : "Ready",
        detail: "Equities and ETFs"
    };

    return {
        currency: account.user.currency,
        startingBalance: account.user.startingBalance,
        cashBalance: cash.valueUsd,
        reservedCash: account.user.reservedCash,
        totalValue,
        investedValue,
        positionsCount: positions.length + (au.balance > 0 ? 1 : 0),
        groups: {
            cashValue: cash.valueUsd,
            auValue,
            cryptoValue,
            stockValue
        },
        holdings: [cash, au, cryptoGroup, stockGroup, ...positions],
        records: buildWalletRecords(account)
    };
}

function liveWalletHoldingUrl(holding) {
    const symbol = String(holding.symbol || "").toUpperCase();
    if (symbol === "USD") return "account-wallet.html?asset=USD";
    if (symbol === "AU") return "account-wallet.html?asset=AU";
    if (symbol === "CRYPTO") return "account-markets.html?filter=crypto";
    if (symbol === "STOCKS") return "account-markets.html?filter=stocks";
    if (symbol === "ETFS") return "account-markets.html?filter=etf";
    if (symbol === "OILMETALS") return "account-markets.html?filter=commodity";
    return `account-asset.html?symbol=${encodeURIComponent(symbol)}`;
}

function buildLiveWalletSnapshot(account) {
    const currency = account?.user?.currency || "USD";
    const createdAt = account?.user?.createdAt || new Date().toISOString();
    const holding = (symbol, name, category, status, detail) => ({
        symbol,
        name,
        category,
        assetType: category,
        balance: 0,
        valueUsd: 0,
        price: symbol === "USD" ? 1 : null,
        changePct: null,
        status,
        detail,
        url: liveWalletHoldingUrl({ symbol })
    });

    return {
        currency,
        startingBalance: 0,
        cashBalance: 0,
        reservedCash: 0,
        totalValue: 0,
        investedValue: 0,
        positionsCount: 0,
        pendingTransfers: 0,
        groups: {
            cashValue: 0,
            auValue: 0,
            cryptoValue: 0,
            stockValue: 0,
            etfValue: 0,
            commodityValue: 0
        },
        holdings: [
            holding("USD", "USD Funds", "cash", "Awaiting deposit", "Available after a verified deposit"),
            holding("AU", "Autody AU", "crypto", "Not held", "Autody balance"),
            holding("CRYPTO", "Crypto", "crypto", "Ready", "Deposit-ready digital assets"),
            holding("STOCKS", "Stocks", "stock", "Ready", "Company shares"),
            holding("ETFS", "ETFs", "etf", "Ready", "Funds and baskets"),
            holding("OILMETALS", "Oil and metals", "commodity", "Ready", "Commodity instruments")
        ],
        records: [
            {
                type: "setup",
                title: "Live account opened",
                symbol: "LIVE",
                assetType: "account",
                valueUsd: 0,
                status: "awaiting funding",
                createdAt
            }
        ]
    };
}

function demoTradeError(status, message) {
    const err = new Error(message);
    err.status = status;
    return err;
}

function tradeAssetType(asset) {
    if (asset?.symbol === "AU" || asset?.customAsset) return "currency";
    const assetType = String(asset?.assetType || "crypto").toLowerCase();
    if (assetType === "stocks") return "stock";
    if (["crypto", "stock", "etf", "commodity", "currency"].includes(assetType)) return assetType;
    return "crypto";
}

function swapEligibleAsset(asset) {
    const symbol = normalizeTradeSymbol(asset?.symbol);
    return tradeAssetType(asset) === "crypto" || symbol === "AU";
}

function assertSwapEligibleAsset(asset, role = "asset") {
    if (swapEligibleAsset(asset)) return;
    throw demoTradeError(400, `Swap is only available for crypto assets. Use Sell, then Buy, for ${role}.`);
}

function tradeAssetPrice(asset) {
    return firstPositive(asset?.price, asset?.lastPrice, asset?.value);
}

function normalizeTradeSymbol(symbol) {
    return String(symbol || "").trim().toUpperCase();
}

function orderNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function calculateTradeSize(body, price) {
    const quantity = orderNumber(body.quantity);
    const notionalUsd = orderNumber(body.notionalUsd ?? body.notional_usd ?? body.amountUsd ?? body.amount);

    if (quantity != null && quantity > 0) {
        return {
            quantity,
            notionalUsd: quantity * price
        };
    }

    if (notionalUsd != null && notionalUsd > 0) {
        return {
            quantity: notionalUsd / price,
            notionalUsd
        };
    }

    throw demoTradeError(400, "Enter a demo amount greater than zero.");
}

async function resolveTradeAsset(symbol) {
    const lookup = normalizeTradeSymbol(symbol);
    if (!lookup) throw demoTradeError(400, "Choose an asset first.");

    const asset = await findMarketAssetBySymbol(lookup);
    if (!asset) throw demoTradeError(404, "That asset is not available in Markets yet.");

    const price = tradeAssetPrice(asset);
    if (!price) throw demoTradeError(409, `${asset.symbol} does not have a live demo price yet.`);

    return {
        ...asset,
        symbol: String(asset.symbol || lookup).toUpperCase(),
        price
    };
}

async function resolveWatchlistAsset(symbol) {
    const lookup = normalizeTradeSymbol(symbol);
    if (!lookup) throw demoTradeError(400, "Choose an asset first.");

    const asset = await findMarketAssetBySymbol(lookup);
    if (!asset) throw demoTradeError(404, "That asset is not available in Markets yet.");

    return {
        ...asset,
        symbol: String(asset.symbol || lookup).toUpperCase()
    };
}

async function getPracticeDbContext(client = dbPool) {
    if (!databaseConfigured()) return null;

    const result = await client.query(`
        select
            p.id as profile_id,
            am.id as account_mode_id,
            w.id as wallet_id,
            w.cash_balance,
            w.reserved_cash,
            w.starting_balance
        from profiles p
        join account_modes am on am.profile_id = p.id and am.mode = 'demo'
        join wallets w on w.account_mode_id = am.id
        where lower(p.email) = lower($1)
        limit 1
    `, [PRACTICE_USER_EMAIL]);

    if (!result.rows[0]) throw demoTradeError(503, "Practice account is not ready yet.");
    return result.rows[0];
}

function reduceWatchlistRows(rows = []) {
    return rows.reduce((groups, item) => {
        const key = item.asset_type === "stock" || item.asset_type === "etf" || item.asset_type === "commodity" ? "stocks" : "crypto";
        groups[key].push(item.symbol);
        return groups;
    }, { crypto: [], stocks: [] });
}

async function getDatabaseWatchlist(mode = "demo") {
    const context = await getPracticeDbContext();
    const result = await dbPool.query(`
        select symbol, asset_type
        from watchlists
        where profile_id = $1
          and mode = $2
        order by created_at asc
    `, [context.profile_id, normalizeWatchlistMode(mode)]);
    return reduceWatchlistRows(result.rows);
}

async function getPracticeWatchlistAny(mode = "demo") {
    const watchlistMode = normalizeWatchlistMode(mode);
    if (databaseConfigured()) {
        try {
            return await withDbTimeout(
                getDatabaseWatchlist(watchlistMode),
                `Supabase ${watchlistMode} watchlist read`
            );
        } catch (err) {
            console.error(`Supabase ${watchlistMode} watchlist read failed:`, err.message || err);
            throw persistentDemoUnavailable(err);
        }
    }

    const db = loadDemoDb();
    return jsonWatchlistForMode(db, watchlistMode);
}

async function getPracticeAccountAfterDatabaseWrite(label) {
    const stale = cachedPracticeAccount({ allowStale: true });
    clearPracticeAccountCache();
    try {
        const account = await withDbTimeout(getPracticeAccountFromDatabase(), `${label} account reload`);
        cachePracticeAccount(account);
        return { ...account, source: "supabase" };
    } catch (err) {
        if (!temporaryDatabaseError(err)) throw err;
        markDatabaseSlow(err);
        console.error(`${label} committed, but Supabase account reload failed:`, err.message || err);
        if (stale) {
            return {
                ...stale,
                source: "supabase-cache",
                refreshWarning: "The order was saved, but the wallet reload is waiting on Supabase."
            };
        }
        throw persistentDemoUnavailable(err);
    }
}

async function adjustDbCash(client, walletId, deltaUsd) {
    const walletResult = await client.query(`
        select cash_balance
        from wallets
        where id = $1
        for update
    `, [walletId]);
    const currentCash = numberValue(walletResult.rows[0]?.cash_balance, 0);
    const nextCash = currentCash + deltaUsd;

    if (nextCash < -0.005) {
        throw demoTradeError(400, "Not enough demo buying power for this order.");
    }

    await client.query(`
        update wallets
        set cash_balance = $2,
            updated_at = now()
        where id = $1
    `, [walletId, nextCash]);

    await client.query(`
        insert into holdings (wallet_id, symbol, asset_name, asset_type, quantity, average_cost, last_price, value_usd, updated_at)
        values ($1, 'USD', 'USD Cash', 'cash', $2, 1, 1, $2, now())
        on conflict (wallet_id, symbol) do update
        set quantity = excluded.quantity,
            last_price = 1,
            value_usd = excluded.value_usd,
            updated_at = now()
    `, [walletId, nextCash]);

    return nextCash;
}

async function readDbHoldingForUpdate(client, walletId, symbol) {
    const result = await client.query(`
        select symbol, asset_name, asset_type, quantity, average_cost, last_price, value_usd
        from holdings
        where wallet_id = $1 and upper(symbol) = upper($2)
        for update
    `, [walletId, symbol]);
    return result.rows[0] || null;
}

async function saveDbHolding(client, walletId, asset, quantity, averageCost, price) {
    const valueUsd = Math.max(0, quantity * price);
    await client.query(`
        insert into holdings (wallet_id, symbol, asset_name, asset_type, quantity, average_cost, last_price, value_usd, updated_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, now())
        on conflict (wallet_id, symbol) do update
        set asset_name = excluded.asset_name,
            asset_type = excluded.asset_type,
            quantity = excluded.quantity,
            average_cost = excluded.average_cost,
            last_price = excluded.last_price,
            value_usd = excluded.value_usd,
            updated_at = now()
    `, [
        walletId,
        asset.symbol,
        asset.name || asset.assetName || asset.symbol,
        tradeAssetType(asset),
        quantity,
        averageCost,
        price,
        valueUsd
    ]);

    return valueUsd;
}

async function applyDbBuy(client, walletId, asset, quantity, notionalUsd) {
    const existing = await readDbHoldingForUpdate(client, walletId, asset.symbol);
    const currentQuantity = numberValue(existing?.quantity, 0);
    const currentAverage = firstPositive(existing?.average_cost, existing?.last_price, asset.price) || asset.price;
    const nextQuantity = currentQuantity + quantity;
    const nextAverage = nextQuantity > 0
        ? ((currentQuantity * currentAverage) + notionalUsd) / nextQuantity
        : asset.price;

    await saveDbHolding(client, walletId, asset, nextQuantity, nextAverage, asset.price);
    return { realizedProfitLoss: 0, quantity: nextQuantity };
}

async function applyDbSell(client, walletId, asset, quantity) {
    const existing = await readDbHoldingForUpdate(client, walletId, asset.symbol);
    const currentQuantity = numberValue(existing?.quantity, 0);

    if (currentQuantity + 1e-10 < quantity) {
        throw demoTradeError(400, `Not enough ${asset.symbol} in this demo wallet.`);
    }

    const averageCost = firstPositive(existing?.average_cost, existing?.last_price, asset.price) || asset.price;
    const nextQuantity = Math.max(0, currentQuantity - quantity);
    const realizedProfitLoss = (asset.price - averageCost) * quantity;
    await saveDbHolding(client, walletId, {
        ...asset,
        name: existing?.asset_name || asset.name,
        assetType: existing?.asset_type || asset.assetType
    }, nextQuantity, nextQuantity > 0 ? averageCost : null, asset.price);

    return { realizedProfitLoss, quantity: nextQuantity };
}

async function insertDbOrder(client, context, order) {
    const result = await client.query(`
        insert into orders (account_mode_id, symbol, asset_type, side, order_type, status, quantity, notional_usd, filled_price, filled_at)
        values ($1, $2, $3, $4, 'market', 'filled', $5, $6, $7, now())
        returning id, symbol, asset_type, side, order_type, status, quantity, notional_usd, filled_price, created_at, filled_at
    `, [
        context.account_mode_id,
        order.symbol,
        order.assetType,
        order.side,
        order.quantity,
        order.notionalUsd,
        order.filledPrice
    ]);
    return result.rows[0];
}

async function refreshDbPerformance(client, context, realizedDelta = 0) {
    const walletResult = await client.query(`
        select cash_balance, starting_balance
        from wallets
        where id = $1
    `, [context.wallet_id]);
    const wallet = walletResult.rows[0] || context;
    const holdingsResult = await client.query(`
        select
            coalesce(sum(case when symbol <> 'USD' then value_usd else 0 end), 0) as invested_value,
            coalesce(sum(
                case
                    when symbol <> 'USD' and quantity > 0 and average_cost is not null and last_price is not null
                    then (last_price - average_cost) * quantity
                    else 0
                end
            ), 0) as unrealized_profit_loss
        from holdings
        where wallet_id = $1
    `, [context.wallet_id]);
    const investedValue = numberValue(holdingsResult.rows[0]?.invested_value, 0);
    const cashBalance = numberValue(wallet.cash_balance, 0);
    const startingBalance = numberValue(wallet.starting_balance, 50000);
    const portfolioValue = cashBalance + investedValue;
    const unrealizedProfitLoss = numberValue(holdingsResult.rows[0]?.unrealized_profit_loss, 0);
    const totalMove = portfolioValue - startingBalance;
    const totalMovePct = startingBalance > 0 ? (totalMove / startingBalance) * 100 : 0;

    await client.query(`
        insert into demo_performance (
            account_mode_id,
            portfolio_value,
            starting_balance,
            unrealized_profit_loss,
            realized_profit_loss,
            today_profit_loss,
            today_profit_loss_pct,
            trades_placed,
            updated_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, 1, now())
        on conflict (account_mode_id) do update
        set portfolio_value = excluded.portfolio_value,
            starting_balance = excluded.starting_balance,
            unrealized_profit_loss = excluded.unrealized_profit_loss,
            realized_profit_loss = demo_performance.realized_profit_loss + $5,
            today_profit_loss = excluded.today_profit_loss,
            today_profit_loss_pct = excluded.today_profit_loss_pct,
            trades_placed = demo_performance.trades_placed + 1,
            updated_at = now()
    `, [
        context.account_mode_id,
        portfolioValue,
        startingBalance,
        unrealizedProfitLoss,
        realizedDelta,
        totalMove,
        totalMovePct
    ]);
}

async function placeDatabaseDemoOrder(body) {
    const side = String(body.side || "buy").trim().toLowerCase();
    const client = await dbPool.connect();

    try {
        await client.query("begin");
        const context = await getPracticeDbContext(client);
        let order;
        let realizedDelta = 0;

        if (side === "buy") {
            const asset = await resolveTradeAsset(body.symbol);
            const trade = calculateTradeSize(body, asset.price);
            await adjustDbCash(client, context.wallet_id, -trade.notionalUsd);
            await applyDbBuy(client, context.wallet_id, asset, trade.quantity, trade.notionalUsd);
            order = await insertDbOrder(client, context, {
                symbol: asset.symbol,
                assetType: tradeAssetType(asset),
                side,
                quantity: trade.quantity,
                notionalUsd: trade.notionalUsd,
                filledPrice: asset.price
            });
        } else if (side === "sell") {
            const asset = await resolveTradeAsset(body.symbol);
            const trade = calculateTradeSize(body, asset.price);
            const result = await applyDbSell(client, context.wallet_id, asset, trade.quantity);
            realizedDelta += result.realizedProfitLoss;
            await adjustDbCash(client, context.wallet_id, trade.notionalUsd);
            order = await insertDbOrder(client, context, {
                symbol: asset.symbol,
                assetType: tradeAssetType(asset),
                side,
                quantity: trade.quantity,
                notionalUsd: trade.notionalUsd,
                filledPrice: asset.price
            });
        } else if (side === "swap") {
            const fromSymbol = normalizeTradeSymbol(body.fromSymbol || body.sourceSymbol);
            const toAsset = await resolveTradeAsset(body.toSymbol || body.symbol);
            const tradeInput = calculateTradeSize(body, 1);
            const notionalUsd = tradeInput.notionalUsd;
            assertSwapEligibleAsset(toAsset, toAsset.symbol);
            if (!fromSymbol || fromSymbol === "USD") {
                throw demoTradeError(400, "Use Buy when spending USD funds. Swap is crypto-to-crypto only.");
            }
            if (fromSymbol === toAsset.symbol) {
                throw demoTradeError(400, "Choose a different asset to receive.");
            }

            const fromAsset = await resolveTradeAsset(fromSymbol);
            assertSwapEligibleAsset(fromAsset, fromAsset.symbol);
            const fromQuantity = notionalUsd / fromAsset.price;
            const sellResult = await applyDbSell(client, context.wallet_id, fromAsset, fromQuantity);
            realizedDelta += sellResult.realizedProfitLoss;

            const toQuantity = notionalUsd / toAsset.price;
            await applyDbBuy(client, context.wallet_id, toAsset, toQuantity, notionalUsd);
            order = await insertDbOrder(client, context, {
                symbol: toAsset.symbol,
                assetType: tradeAssetType(toAsset),
                side,
                quantity: toQuantity,
                notionalUsd,
                filledPrice: toAsset.price
            });
        } else {
            throw demoTradeError(400, "Choose buy, sell, or swap.");
        }

        await refreshDbPerformance(client, context, realizedDelta);
        await client.query("commit");
        const account = await getPracticeAccountAfterDatabaseWrite("Supabase demo order");
        return {
            order,
            account,
            source: "supabase"
        };
    } catch (err) {
        await client.query("rollback").catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

function upsertJsonHolding(wallet, asset, quantity, averageCost, price) {
    wallet.holdings = wallet.holdings || [];
    const index = wallet.holdings.findIndex((holding) => normalizeTradeSymbol(holding.symbol) === asset.symbol);
    const nextHolding = {
        symbol: asset.symbol,
        name: asset.name || asset.symbol,
        category: tradeAssetType(asset),
        balance: quantity,
        averageCost,
        lastPrice: price,
        valueUsd: Math.max(0, quantity * price),
        status: quantity > 0 ? "Held" : "Ready",
        updatedAt: new Date().toISOString()
    };

    if (index >= 0) {
        wallet.holdings[index] = { ...wallet.holdings[index], ...nextHolding };
    } else {
        wallet.holdings.push(nextHolding);
    }

    return nextHolding;
}

async function placeJsonDemoOrder(body) {
    const db = loadDemoDb();
    const user = db.users.find((item) => item.id === PRACTICE_USER_ID);
    const wallet = db.wallets[PRACTICE_USER_ID];
    const side = String(body.side || "buy").trim().toLowerCase();
    if (!user || !wallet) throw demoTradeError(503, "Practice account is not ready yet.");

    const adjustCash = (delta) => {
        const nextCash = numberValue(user.cashBalance, 50000) + delta;
        if (nextCash < -0.005) throw demoTradeError(400, "Not enough demo buying power for this order.");
        user.cashBalance = nextCash;
        wallet.cash = {
            ...(wallet.cash || {}),
            symbol: "USD",
            name: "USD Cash",
            balance: nextCash,
            valueUsd: nextCash,
            status: "Available"
        };
        return nextCash;
    };

    const findHolding = (symbol) => (wallet.holdings || []).find((holding) => normalizeTradeSymbol(holding.symbol) === symbol);
    const buyHolding = (asset, quantity, notionalUsd) => {
        const existing = findHolding(asset.symbol);
        const currentQuantity = numberValue(existing?.balance ?? existing?.quantity, 0);
        const currentAverage = firstPositive(existing?.averageCost, existing?.lastPrice, asset.price) || asset.price;
        const nextQuantity = currentQuantity + quantity;
        const nextAverage = nextQuantity > 0 ? ((currentQuantity * currentAverage) + notionalUsd) / nextQuantity : asset.price;
        return upsertJsonHolding(wallet, asset, nextQuantity, nextAverage, asset.price);
    };
    const sellHolding = (asset, quantity) => {
        const existing = findHolding(asset.symbol);
        const currentQuantity = numberValue(existing?.balance ?? existing?.quantity, 0);
        if (currentQuantity + 1e-10 < quantity) {
            throw demoTradeError(400, `Not enough ${asset.symbol} in this demo wallet.`);
        }
        const averageCost = firstPositive(existing?.averageCost, existing?.lastPrice, asset.price) || asset.price;
        const nextQuantity = Math.max(0, currentQuantity - quantity);
        upsertJsonHolding(wallet, asset, nextQuantity, nextQuantity > 0 ? averageCost : null, asset.price);
        return (asset.price - averageCost) * quantity;
    };

    let order;
    let realizedDelta = 0;

    if (side === "buy") {
        const asset = await resolveTradeAsset(body.symbol);
        const trade = calculateTradeSize(body, asset.price);
        adjustCash(-trade.notionalUsd);
        buyHolding(asset, trade.quantity, trade.notionalUsd);
        order = { symbol: asset.symbol, assetType: tradeAssetType(asset), side, orderType: "market", status: "filled", quantity: trade.quantity, notionalUsd: trade.notionalUsd, filledPrice: asset.price };
    } else if (side === "sell") {
        const asset = await resolveTradeAsset(body.symbol);
        const trade = calculateTradeSize(body, asset.price);
        realizedDelta += sellHolding(asset, trade.quantity);
        adjustCash(trade.notionalUsd);
        order = { symbol: asset.symbol, assetType: tradeAssetType(asset), side, orderType: "market", status: "filled", quantity: trade.quantity, notionalUsd: trade.notionalUsd, filledPrice: asset.price };
    } else if (side === "swap") {
        const fromSymbol = normalizeTradeSymbol(body.fromSymbol || body.sourceSymbol);
        const toAsset = await resolveTradeAsset(body.toSymbol || body.symbol);
        const tradeInput = calculateTradeSize(body, 1);
        const notionalUsd = tradeInput.notionalUsd;
        assertSwapEligibleAsset(toAsset, toAsset.symbol);
        if (!fromSymbol || fromSymbol === "USD") {
            throw demoTradeError(400, "Use Buy when spending USD funds. Swap is crypto-to-crypto only.");
        }
        if (fromSymbol === toAsset.symbol) {
            throw demoTradeError(400, "Choose a different asset to receive.");
        }
        const fromAsset = await resolveTradeAsset(fromSymbol);
        assertSwapEligibleAsset(fromAsset, fromAsset.symbol);
        realizedDelta += sellHolding(fromAsset, notionalUsd / fromAsset.price);
        const toQuantity = notionalUsd / toAsset.price;
        buyHolding(toAsset, toQuantity, notionalUsd);
        order = { symbol: toAsset.symbol, assetType: tradeAssetType(toAsset), side, orderType: "market", status: "filled", quantity: toQuantity, notionalUsd, filledPrice: toAsset.price };
    } else {
        throw demoTradeError(400, "Choose buy, sell, or swap.");
    }

    order = {
        id: crypto.randomUUID(),
        ...order,
        createdAt: new Date().toISOString(),
        filledAt: new Date().toISOString()
    };
    db.orders = db.orders || {};
    db.orders[PRACTICE_USER_ID] = [order, ...(db.orders[PRACTICE_USER_ID] || [])].slice(0, 50);

    const investedValue = (wallet.holdings || [])
        .filter((holding) => !["USD", "CRYPTO", "STOCKS"].includes(normalizeTradeSymbol(holding.symbol)))
        .reduce((sum, holding) => sum + numberValue(holding.valueUsd, 0), 0);
    const startingBalance = numberValue(user.startingBalance, 50000);
    const portfolioValue = numberValue(user.cashBalance, 0) + investedValue;
    db.performance = db.performance || {};
    const existingPerformance = db.performance[PRACTICE_USER_ID] || {};
    db.performance[PRACTICE_USER_ID] = {
        ...existingPerformance,
        portfolioValue,
        startingBalance,
        unrealizedProfitLoss: portfolioValue - startingBalance - numberValue(existingPerformance.realizedProfitLoss, 0),
        realizedProfitLoss: numberValue(existingPerformance.realizedProfitLoss, 0) + realizedDelta,
        todayProfitLoss: portfolioValue - startingBalance,
        todayProfitLossPct: startingBalance > 0 ? ((portfolioValue - startingBalance) / startingBalance) * 100 : 0,
        tradesPlaced: numberValue(existingPerformance.tradesPlaced, 0) + 1
    };

    saveDemoDb(db);
    return {
        order,
        account: { ...getPracticeAccount(), source: "json" },
        source: "json"
    };
}

async function placeDemoOrder(body) {
    return withDemoWriteFallback(
        "Supabase demo order",
        () => placeDatabaseDemoOrder(body),
        () => placeJsonDemoOrder(body)
    );
}

async function addDatabaseWatchlistSymbol(symbol, mode = "demo") {
    const asset = await resolveWatchlistAsset(symbol);
    const context = await getPracticeDbContext();
    const watchlistMode = normalizeWatchlistMode(mode);
    const result = await dbPool.query(`
        insert into watchlists (profile_id, symbol, asset_type, mode)
        values ($1, $2, $3, $4)
        on conflict (profile_id, symbol, mode) do nothing
        returning symbol
    `, [context.profile_id, asset.symbol, tradeAssetType(asset), watchlistMode]);

    const watchlist = await getDatabaseWatchlist(watchlistMode);
    const account = await getPracticeAccountAfterDatabaseWrite(`Supabase ${watchlistMode} watchlist add`);

    return {
        asset,
        account: { ...account, watchlist },
        watchlist,
        alreadySaved: !result.rows.length,
        source: "supabase"
    };
}

async function addJsonWatchlistSymbol(symbol, mode = "demo") {
    const asset = await resolveWatchlistAsset(symbol);
    const db = loadDemoDb();
    const watchlistMode = normalizeWatchlistMode(mode);
    const watchlist = jsonWatchlistForMode(db, watchlistMode);
    const key = ["stock", "etf", "commodity"].includes(tradeAssetType(asset)) ? "stocks" : "crypto";
    const alreadySaved = (watchlist[key] || []).some((item) => normalizeTradeSymbol(item) === asset.symbol);
    watchlist[key] = Array.from(new Set([...(watchlist[key] || []), asset.symbol]));
    saveDemoDb(db);
    return {
        asset,
        account: { ...getPracticeAccount(), watchlist },
        watchlist,
        alreadySaved,
        source: "json"
    };
}

async function addWatchlistSymbol(symbol, mode = "demo") {
    const watchlistMode = normalizeWatchlistMode(mode);
    return withDemoWriteFallback(
        `Supabase ${watchlistMode} watchlist add`,
        () => addDatabaseWatchlistSymbol(symbol, watchlistMode),
        () => addJsonWatchlistSymbol(symbol, watchlistMode)
    );
}

async function addDemoWatchlistSymbol(symbol) {
    return addWatchlistSymbol(symbol, "demo");
}

async function addLiveWatchlistSymbol(symbol) {
    return addWatchlistSymbol(symbol, "live");
}

async function removeDatabaseWatchlistSymbol(symbol, mode = "demo") {
    const lookup = normalizeTradeSymbol(symbol);
    if (!lookup) throw demoTradeError(400, "Choose an asset first.");

    const context = await getPracticeDbContext();
    const watchlistMode = normalizeWatchlistMode(mode);
    await dbPool.query(`
        delete from watchlists
        where profile_id = $1 and upper(symbol) = upper($2)
          and mode = $3
    `, [context.profile_id, lookup, watchlistMode]);

    const watchlist = await getDatabaseWatchlist(watchlistMode);
    const account = await getPracticeAccountAfterDatabaseWrite(`Supabase ${watchlistMode} watchlist remove`);
    return { account: { ...account, watchlist }, watchlist, source: "supabase" };
}

async function removeJsonWatchlistSymbol(symbol, mode = "demo") {
    const lookup = normalizeTradeSymbol(symbol);
    if (!lookup) throw demoTradeError(400, "Choose an asset first.");

    const db = loadDemoDb();
    const watchlist = jsonWatchlistForMode(db, normalizeWatchlistMode(mode));
    watchlist.crypto = (watchlist.crypto || []).filter((item) => normalizeTradeSymbol(item) !== lookup);
    watchlist.stocks = (watchlist.stocks || []).filter((item) => normalizeTradeSymbol(item) !== lookup);
    saveDemoDb(db);
    return { account: { ...getPracticeAccount(), watchlist }, watchlist, source: "json" };
}

async function removeWatchlistSymbol(symbol, mode = "demo") {
    const watchlistMode = normalizeWatchlistMode(mode);
    return withDemoWriteFallback(
        `Supabase ${watchlistMode} watchlist remove`,
        () => removeDatabaseWatchlistSymbol(symbol, watchlistMode),
        () => removeJsonWatchlistSymbol(symbol, watchlistMode)
    );
}

async function removeDemoWatchlistSymbol(symbol) {
    return removeWatchlistSymbol(symbol, "demo");
}

async function removeLiveWatchlistSymbol(symbol) {
    return removeWatchlistSymbol(symbol, "live");
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
        const columnCount = 22;
        const normalizedAssets = assets.filter((asset) => asset?.symbol);
        let savedCount = 0;

        for (const batch of chunkItems(normalizedAssets, 40)) {
            const values = [];
            const placeholders = batch.map((asset, index) => {
                const offset = index * columnCount;
                values.push(
                    provider,
                    asset.symbol,
                    asset.name || asset.symbol,
                    asset.assetType || assetType,
                    asset.providerSymbol || marketDataSymbol(asset),
                    asset.market || null,
                    nullableNumber(asset.price ?? asset.value),
                    nullableNumber(asset.changePct),
                    nullableNumber(asset.marketCap),
                    nullableNumber(asset.fdv),
                    nullableNumber(asset.liquidityUsd),
                    nullableNumber(asset.totalVolume),
                    nullableNumber(asset.high24h),
                    nullableNumber(asset.low24h),
                    nullableNumber(asset.ath),
                    nullableNumber(asset.atl),
                    nullableNumber(asset.circulatingSupply),
                    nullableNumber(asset.totalSupply),
                    nullableNumber(asset.maxSupply),
                    asset.currency || "USD",
                    asset.logoUrl || asset.image || null,
                    Array.isArray(asset.depositNetworks) && asset.depositNetworks.length ? JSON.stringify(asset.depositNetworks) : null
                );
                const fields = Array.from({ length: columnCount }, (_, fieldIndex) => {
                    const placeholder = `$${offset + fieldIndex + 1}`;
                    return fieldIndex === columnCount - 1 ? `${placeholder}::jsonb` : placeholder;
                });
                return `(${fields.join(", ")})`;
            });

            if (!placeholders.length) continue;

            await dbPool.query(`
                insert into market_latest_snapshots (
                    provider,
                    symbol,
                    asset_name,
                    asset_type,
                    provider_symbol,
                    market,
                    price_usd,
                    change_pct,
                    market_cap_usd,
                    fdv_usd,
                    liquidity_usd,
                    total_volume_usd,
                    high_24h,
                    low_24h,
                    ath,
                    atl,
                    circulating_supply,
                    total_supply,
                    max_supply,
                    currency,
                    logo_url,
                    deposit_networks
                )
                values ${placeholders.join(", ")}
                on conflict (symbol) do update
                set provider = excluded.provider,
                    asset_name = excluded.asset_name,
                    asset_type = excluded.asset_type,
                    provider_symbol = coalesce(excluded.provider_symbol, market_latest_snapshots.provider_symbol),
                    market = coalesce(excluded.market, market_latest_snapshots.market),
                    price_usd = excluded.price_usd,
                    change_pct = excluded.change_pct,
                    market_cap_usd = coalesce(excluded.market_cap_usd, market_latest_snapshots.market_cap_usd),
                    fdv_usd = coalesce(excluded.fdv_usd, market_latest_snapshots.fdv_usd),
                    liquidity_usd = coalesce(excluded.liquidity_usd, market_latest_snapshots.liquidity_usd),
                    total_volume_usd = coalesce(excluded.total_volume_usd, market_latest_snapshots.total_volume_usd),
                    high_24h = coalesce(excluded.high_24h, market_latest_snapshots.high_24h),
                    low_24h = coalesce(excluded.low_24h, market_latest_snapshots.low_24h),
                    ath = coalesce(excluded.ath, market_latest_snapshots.ath),
                    atl = coalesce(excluded.atl, market_latest_snapshots.atl),
                    circulating_supply = coalesce(excluded.circulating_supply, market_latest_snapshots.circulating_supply),
                    total_supply = coalesce(excluded.total_supply, market_latest_snapshots.total_supply),
                    max_supply = coalesce(excluded.max_supply, market_latest_snapshots.max_supply),
                    currency = excluded.currency,
                    logo_url = coalesce(excluded.logo_url, market_latest_snapshots.logo_url),
                    deposit_networks = coalesce(excluded.deposit_networks, market_latest_snapshots.deposit_networks),
                    captured_at = now()
            `, values);

            savedCount += placeholders.length;
        }

        return savedCount;
    } catch (err) {
        console.error("Market snapshot save failed:", err);
        throw err;
    }
}

function normalizeChartRange(range = "1d") {
    const selected = String(range || "1d").toLowerCase();
    return CHART_RANGE_KEYS.includes(selected) ? selected : "1d";
}

async function saveMarketChartSnapshot(provider, asset, chart) {
    if (!databaseConfigured() || !asset?.symbol || !chart?.points?.length) return;

    try {
        await dbPool.query(`
            insert into market_latest_chart_snapshots (provider, symbol, asset_type, range_key, provider_symbol, currency, points, stats)
            values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)
            on conflict (symbol, range_key) do update
            set provider = excluded.provider,
                asset_type = excluded.asset_type,
                provider_symbol = excluded.provider_symbol,
                currency = excluded.currency,
                points = excluded.points,
                stats = excluded.stats,
                captured_at = now()
        `, [
            provider || chart.provider || "market-provider",
            asset.symbol,
            asset.assetType || "market",
            normalizeChartRange(chart.range),
            chart.providerSymbol || asset.providerSymbol || marketDataSymbol(asset),
            chart.currency || asset.currency || "USD",
            JSON.stringify(chart.points || []),
            JSON.stringify(chart.stats || {})
        ]);

    } catch (err) {
        console.error("Market chart snapshot save failed:", err);
    }
}

async function readLatestMarketChartSnapshot(symbol, range = "1d") {
    if (!databaseConfigured() || !symbol) return null;

    try {
        const result = await dbPool.query(`
            select provider, symbol, asset_type, range_key, provider_symbol, currency, points, stats, captured_at
            from market_latest_chart_snapshots
            where upper(symbol) = upper($1) and range_key = $2
            limit 1
        `, [symbol, normalizeChartRange(range)]);

        const row = result.rows[0];
        if (!row) return null;

        return {
            range: row.range_key,
            provider: row.provider,
            providerSymbol: row.provider_symbol || row.symbol,
            currency: row.currency || "USD",
            points: Array.isArray(row.points) ? row.points : [],
            stats: row.stats && typeof row.stats === "object" ? row.stats : {},
            cached: true,
            capturedAt: row.captured_at
        };
    } catch (err) {
        console.error("Market chart snapshot fallback read failed:", err);
        return null;
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
    if (!databaseConfigured() || dbCircuitOpen()) return [];

    try {
        const assetTypes = Array.isArray(assetType) ? assetType : [assetType];
        const latestResult = await withDbTimeout(dbPool.query(`
            select *
            from (
                select distinct on (symbol)
                    provider,
                    symbol,
                    asset_name,
                    asset_type,
                    provider_symbol,
                    market,
                    price_usd,
                    change_pct,
                    market_cap_usd,
                    fdv_usd,
                    liquidity_usd,
                    total_volume_usd,
                    high_24h,
                    low_24h,
                    ath,
                    atl,
                    circulating_supply,
                    total_supply,
                    max_supply,
                    currency,
                    logo_url,
                    deposit_networks,
                    captured_at
                from market_latest_snapshots
                where asset_type = any($1)
                order by symbol, captured_at desc
            ) latest
            order by captured_at desc
            limit $2
        `, [assetTypes, limit]), "Market snapshot read");

        const symbols = latestResult.rows.map((row) => row.symbol).filter(Boolean);
        const richRows = new Map();

        if (symbols.length) {
            const richResult = await withDbTimeout(dbPool.query(`
                select distinct on (symbol)
                    provider,
                    symbol,
                    asset_name,
                    asset_type,
                    provider_symbol,
                    market,
                    market_cap_usd,
                    fdv_usd,
                    liquidity_usd,
                    total_volume_usd,
                    high_24h,
                    low_24h,
                    ath,
                    atl,
                    circulating_supply,
                    total_supply,
                    max_supply,
                    currency,
                    logo_url,
                    deposit_networks,
                    captured_at
                from market_latest_snapshots
                where asset_type = any($1)
                  and symbol = any($2)
                  and (
                    market_cap_usd is not null
                    or fdv_usd is not null
                    or liquidity_usd is not null
                    or total_volume_usd is not null
                    or high_24h is not null
                    or low_24h is not null
                    or ath is not null
                    or atl is not null
                    or circulating_supply is not null
                    or total_supply is not null
                    or max_supply is not null
                  )
                order by symbol, captured_at desc
            `, [assetTypes, symbols]), "Market snapshot metadata read");

            richResult.rows.forEach((row) => richRows.set(row.symbol, row));
        }

        return latestResult.rows.map((row) => {
            const rich = richRows.get(row.symbol) || {};
            return {
                symbol: row.symbol,
                name: row.asset_name || rich.asset_name,
                assetType: row.asset_type || rich.asset_type,
                providerSymbol: row.provider_symbol || rich.provider_symbol || row.symbol,
                market: row.market || rich.market || null,
                price: nullableNumber(row.price_usd),
                changePct: nullableNumber(row.change_pct),
                marketCap: firstPositive(row.market_cap_usd, rich.market_cap_usd),
                fdv: firstPositive(row.fdv_usd, rich.fdv_usd),
                liquidityUsd: firstPositive(row.liquidity_usd, rich.liquidity_usd),
                totalVolume: firstPositive(row.total_volume_usd, rich.total_volume_usd),
                high24h: firstPositive(row.high_24h, rich.high_24h),
                low24h: firstPositive(row.low_24h, rich.low_24h),
                ath: firstPositive(row.ath, rich.ath),
                atl: firstPositive(row.atl, rich.atl),
                circulatingSupply: firstPositive(row.circulating_supply, rich.circulating_supply),
                totalSupply: firstPositive(row.total_supply, rich.total_supply),
                maxSupply: firstPositive(row.max_supply, rich.max_supply),
                currency: row.currency || rich.currency || "USD",
                logoUrl: row.logo_url || rich.logo_url || null,
                depositNetworks: Array.isArray(row.deposit_networks) && row.deposit_networks.length
                    ? row.deposit_networks
                    : Array.isArray(rich.deposit_networks) ? rich.deposit_networks : [],
                capturedAt: row.captured_at,
                provider: row.provider,
                metadataProvider: rich.provider || null,
                metadataCapturedAt: rich.captured_at || null
            };
        });
    } catch (err) {
        console.error("Market snapshot fallback read failed:", err);
        return [];
    }
}

function marketSnapshotRowToAsset(row = {}) {
    return {
        symbol: row.symbol,
        name: row.asset_name,
        assetType: row.asset_type,
        providerSymbol: row.provider_symbol || row.symbol,
        market: row.market || null,
        price: nullableNumber(row.price_usd),
        changePct: nullableNumber(row.change_pct),
        marketCap: firstPositive(row.market_cap_usd),
        fdv: firstPositive(row.fdv_usd),
        liquidityUsd: firstPositive(row.liquidity_usd),
        totalVolume: firstPositive(row.total_volume_usd),
        high24h: firstPositive(row.high_24h),
        low24h: firstPositive(row.low_24h),
        ath: firstPositive(row.ath),
        atl: firstPositive(row.atl),
        circulatingSupply: firstPositive(row.circulating_supply),
        totalSupply: firstPositive(row.total_supply),
        maxSupply: firstPositive(row.max_supply),
        currency: row.currency || "USD",
        logoUrl: row.logo_url || null,
        depositNetworks: Array.isArray(row.deposit_networks) ? row.deposit_networks : [],
        capturedAt: row.captured_at,
        provider: row.provider
    };
}

async function readLatestMarketSnapshotByLookup(lookup) {
    if (!databaseConfigured() || !lookup) return null;

    try {
        const result = await withDbTimeout(dbPool.query(`
            select provider, symbol, asset_name, asset_type, provider_symbol, market, price_usd, change_pct, market_cap_usd, fdv_usd, liquidity_usd, total_volume_usd, high_24h, low_24h, ath, atl, circulating_supply, total_supply, max_supply, currency, logo_url, deposit_networks, captured_at
            from market_latest_snapshots
            where upper(symbol) = upper($1)
               or upper(provider_symbol) = upper($1)
            order by captured_at desc
            limit 1
        `, [lookup]), "Market symbol snapshot read");

        return result.rows[0] ? marketSnapshotRowToAsset(result.rows[0]) : null;
    } catch (err) {
        console.error(`Market snapshot lookup failed for ${lookup}:`, err.message || err);
        return null;
    }
}

function marketAssetMatchesLookup(asset = {}, lookup = "") {
    const candidates = [asset.symbol, asset.id, asset.providerSymbol]
        .filter(Boolean)
        .map((value) => String(value).toUpperCase());
    return candidates.includes(String(lookup || "").toUpperCase());
}

function findStaticMarketAssetByLookup(lookup) {
    const cryptoCatalog = cryptoCatalogCache.assets.length
        ? cryptoCatalogCache.assets
        : staticCryptoFallbackCatalog();
    const stockCatalog = TRADE_STOCK_ASSETS.map(assetCatalogEntry);
    return [...cryptoCatalog, ...stockCatalog].find((asset) => marketAssetMatchesLookup(asset, lookup)) || null;
}

function mergeResolvedMarketAsset(lookup, baseAsset = null, snapshot = null) {
    const symbol = String(snapshot?.symbol || baseAsset?.symbol || lookup || "").toUpperCase();
    const memorySnapshot = liveMarketAssetCache.bySymbol.get(symbol) || liveMarketAssetCache.bySymbol.get(String(lookup || "").toUpperCase());
    const fallbackQuote = fallbackMarketQuote(symbol);
    const fallbackStatus = fallbackQuote.price != null ? "Backup quote" : "Waiting for first refresh";
    const seed = baseAsset || assetCatalogEntry({
        symbol,
        name: snapshot?.name || symbol,
        assetType: snapshot?.assetType || "crypto",
        market: snapshot?.market || "Global",
        currency: snapshot?.currency || "USD"
    });

    return {
        ...seed,
        symbol,
        name: memorySnapshot?.name || snapshot?.name || seed.name || symbol,
        assetType: memorySnapshot?.assetType || snapshot?.assetType || seed.assetType || "crypto",
        price: memorySnapshot?.price ?? snapshot?.price ?? seed.price ?? fallbackQuote.price ?? null,
        changePct: memorySnapshot?.changePct ?? snapshot?.changePct ?? seed.changePct ?? fallbackQuote.changePct ?? null,
        marketCap: memorySnapshot?.marketCap ?? seed.marketCap ?? snapshot?.marketCap ?? null,
        fdv: memorySnapshot?.fdv ?? seed.fdv ?? snapshot?.fdv ?? null,
        liquidityUsd: memorySnapshot?.liquidityUsd ?? seed.liquidityUsd ?? snapshot?.liquidityUsd ?? null,
        totalVolume: memorySnapshot?.totalVolume ?? seed.totalVolume ?? snapshot?.totalVolume ?? null,
        high24h: memorySnapshot?.high24h ?? seed.high24h ?? snapshot?.high24h ?? null,
        low24h: memorySnapshot?.low24h ?? seed.low24h ?? snapshot?.low24h ?? null,
        ath: memorySnapshot?.ath ?? seed.ath ?? snapshot?.ath ?? null,
        atl: memorySnapshot?.atl ?? seed.atl ?? snapshot?.atl ?? null,
        circulatingSupply: memorySnapshot?.circulatingSupply ?? seed.circulatingSupply ?? snapshot?.circulatingSupply ?? null,
        totalSupply: memorySnapshot?.totalSupply ?? seed.totalSupply ?? snapshot?.totalSupply ?? null,
        maxSupply: memorySnapshot?.maxSupply ?? seed.maxSupply ?? snapshot?.maxSupply ?? null,
        currency: memorySnapshot?.currency || seed.currency || snapshot?.currency || "USD",
        providerSymbol: memorySnapshot?.providerSymbol || seed.providerSymbol || snapshot?.providerSymbol || marketDataSymbol(seed),
        market: memorySnapshot?.market || seed.market || snapshot?.market || "Global",
        depositNetworks: seed.depositNetworks?.length ? seed.depositNetworks : memorySnapshot?.depositNetworks || snapshot?.depositNetworks || [],
        logoUrl: memorySnapshot?.logoUrl || seed.logoUrl || snapshot?.logoUrl || assetLogoUrl(seed),
        dataProvider: memorySnapshot?.dataProvider || seed.dataProvider || snapshot?.provider || null,
        capturedAt: memorySnapshot?.capturedAt || seed.capturedAt || snapshot?.capturedAt || null,
        status: memorySnapshot ? "Live" : seed.status || (snapshot ? "Live" : fallbackStatus)
    };
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
    const cacheKey = String(type || "all");
    const cached = marketCatalogCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.assets;
    }

    const includeCrypto = type !== "stocks";
    const includeStocks = type !== "crypto";
    const cryptoCatalog = includeCrypto
        ? (cryptoCatalogCache.assets.length ? cryptoCatalogCache.assets : staticCryptoFallbackCatalog())
        : [];
    const stockCatalog = includeStocks ? TRADE_STOCK_ASSETS.map(assetCatalogEntry) : [];
    let catalog = [...cryptoCatalog, ...stockCatalog];
    const snapshotTypes = type === "crypto"
        ? ["crypto"]
        : type === "stocks"
            ? ["stock", "etf", "commodity", "index", "forex"]
            : ["crypto", "stock", "etf", "commodity", "index", "forex"];
    const snapshotLimit = Math.max(catalog.length, includeCrypto ? CRYPTO_MARKET_LIMIT + stockCatalog.length + 1 : stockCatalog.length, 30);
    const snapshots = await readLatestMarketSnapshots(snapshotTypes, snapshotLimit);
    const cryptoSnapshots = includeCrypto ? await readLatestMarketSnapshots("crypto", CRYPTO_MARKET_LIMIT) : [];
    const snapshotMap = new Map(snapshots.map((asset) => [asset.symbol, asset]));
    cryptoSnapshots.forEach((asset) => snapshotMap.set(asset.symbol, asset));

    if (includeCrypto && cryptoSnapshots.length && cryptoCatalog.length < CRYPTO_MARKET_LIMIT + 1) {
        const catalogSymbols = new Set(catalog.map((asset) => asset.symbol));
        const supplementalCrypto = cryptoSnapshots
            .filter((asset) => asset.symbol && !catalogSymbols.has(asset.symbol))
            .map((asset, index) => assetCatalogEntry({
                rank: CRYPTO_MARKET_LIMIT + index + 1,
                symbol: asset.symbol,
                name: asset.name || asset.symbol,
                assetType: "crypto",
                market: "Crypto",
                region: "Global",
                currency: asset.currency || "USD",
                price: asset.price,
                changePct: asset.changePct,
                marketCap: asset.marketCap,
                fdv: asset.fdv,
                liquidityUsd: asset.liquidityUsd,
                totalVolume: asset.totalVolume,
                high24h: asset.high24h,
                low24h: asset.low24h,
                ath: asset.ath,
                atl: asset.atl,
                circulatingSupply: asset.circulatingSupply,
                totalSupply: asset.totalSupply,
                maxSupply: asset.maxSupply,
                logoUrl: asset.logoUrl,
                depositNetworks: asset.depositNetworks || [],
                dataProvider: asset.provider,
                capturedAt: asset.capturedAt,
                status: "Cached live"
            }));
        catalog = [...catalog, ...supplementalCrypto];
    }

    const assets = catalog.map((asset) => {
        const snapshot = snapshotMap.get(asset.symbol);
        const memorySnapshot = liveMarketAssetCache.bySymbol.get(String(asset.symbol || "").toUpperCase());
        const fallbackQuote = fallbackMarketQuote(asset.symbol);
        const fallbackStatus = fallbackQuote.price != null ? "Backup quote" : "Waiting for first refresh";
        return {
            ...asset,
            price: memorySnapshot?.price ?? snapshot?.price ?? asset.price ?? fallbackQuote.price ?? null,
            changePct: memorySnapshot?.changePct ?? snapshot?.changePct ?? asset.changePct ?? fallbackQuote.changePct ?? null,
            marketCap: memorySnapshot?.marketCap ?? asset.marketCap ?? snapshot?.marketCap ?? null,
            fdv: memorySnapshot?.fdv ?? asset.fdv ?? snapshot?.fdv ?? null,
            liquidityUsd: memorySnapshot?.liquidityUsd ?? asset.liquidityUsd ?? snapshot?.liquidityUsd ?? null,
            totalVolume: memorySnapshot?.totalVolume ?? asset.totalVolume ?? snapshot?.totalVolume ?? null,
            high24h: memorySnapshot?.high24h ?? asset.high24h ?? snapshot?.high24h ?? null,
            low24h: memorySnapshot?.low24h ?? asset.low24h ?? snapshot?.low24h ?? null,
            ath: memorySnapshot?.ath ?? asset.ath ?? snapshot?.ath ?? null,
            atl: memorySnapshot?.atl ?? asset.atl ?? snapshot?.atl ?? null,
            circulatingSupply: memorySnapshot?.circulatingSupply ?? asset.circulatingSupply ?? snapshot?.circulatingSupply ?? null,
            totalSupply: memorySnapshot?.totalSupply ?? asset.totalSupply ?? snapshot?.totalSupply ?? null,
            maxSupply: memorySnapshot?.maxSupply ?? asset.maxSupply ?? snapshot?.maxSupply ?? null,
            currency: memorySnapshot?.currency || asset.currency || snapshot?.currency || "USD",
            providerSymbol: memorySnapshot?.providerSymbol || asset.providerSymbol || snapshot?.providerSymbol || marketDataSymbol(asset),
            market: memorySnapshot?.market || asset.market || snapshot?.market || "Global",
            depositNetworks: asset.depositNetworks?.length ? asset.depositNetworks : memorySnapshot?.depositNetworks || snapshot?.depositNetworks || [],
            logoUrl: memorySnapshot?.logoUrl || asset.logoUrl || snapshot?.logoUrl || assetLogoUrl(asset),
            dataProvider: memorySnapshot?.dataProvider || asset.dataProvider || snapshot?.provider || null,
            capturedAt: memorySnapshot?.capturedAt || asset.capturedAt || snapshot?.capturedAt || null,
            status: memorySnapshot ? "Live" : asset.status || (snapshot ? "Live" : fallbackStatus)
        };
    });

    marketCatalogCache.set(cacheKey, {
        assets,
        expiresAt: Date.now() + MARKET_CATALOG_CACHE_MS
    });
    return assets;
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

function cacheLiveMarketAssets(assets = [], provider = "live-provider") {
  const existing = new Map(liveMarketAssetCache.bySymbol);
  const capturedAt = new Date().toISOString();

  for (const asset of assets || []) {
    if (!asset?.symbol || asset.price == null) continue;
    const entry = {
      ...asset,
      symbol: String(asset.symbol).toUpperCase(),
      dataProvider: asset.dataProvider || asset.provider || provider,
      provider: asset.provider || asset.dataProvider || provider,
      capturedAt: asset.capturedAt || capturedAt,
      status: "Live"
    };
    existing.set(entry.symbol, entry);
  }

  liveMarketAssetCache = {
    assets: [...existing.values()],
    bySymbol: existing,
    updatedAt: Date.now()
  };
  marketCatalogCache.clear();
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
  logoUrl: "Autody-Logo.png",
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

const SUPPLEMENTAL_CRYPTO_FALLBACK_DATA = `
WETH|Wrapped Ether|Crypto
WBTC|Wrapped Bitcoin|Crypto
LEO|UNUS SED LEO|Crypto
OKB|OKB|Crypto
CRO|Cronos|Crypto
KAS|Kaspa|Crypto
TAO|Bittensor|Crypto
XDC|XDC Network|Crypto
ONDO|Ondo|Crypto
JUP|Jupiter|Crypto
SEI|Sei|Crypto
ENA|Ethena|Crypto
WLD|Worldcoin|Crypto
STX|Stacks|Crypto
RUNE|THORChain|Crypto
SAND|The Sandbox|Gaming
AXS|Axie Infinity|Gaming
THETA|Theta Network|Crypto
GALA|Gala|Gaming
FLOW|Flow|Crypto
EOS|EOS|Crypto
KAVA|Kava|Crypto
NEO|Neo|Crypto
IOTA|IOTA|Crypto
JASMY|JasmyCoin|Crypto
HNT|Helium|Crypto
PYTH|Pyth Network|Crypto
MNT|Mantle|Crypto
METH|Mantle Staked Ether|Crypto
WEETH|Wrapped eETH|Crypto
BGB|Bitget Token|Crypto
GT|GateToken|Crypto
FTT|FTX Token|Crypto
RAY|Raydium|DeFi
FLOKI|FLOKI|Popular
FLR|Flare|Crypto
VIRTUAL|Virtuals Protocol|AI
SPX|SPX6900|Popular
KCS|KuCoin Token|Crypto
NEXO|Nexo|Crypto
XTZ|Tezos|Crypto
EGLD|MultiversX|Crypto
MINA|Mina|Crypto
ROSE|Oasis Network|Crypto
CFX|Conflux|Crypto
CHZ|Chiliz|Crypto
ZEC|Zcash|Crypto
DASH|Dash|Crypto
COMP|Compound|DeFi
SNX|Synthetix|DeFi
YFI|yearn.finance|DeFi
BAL|Balancer|DeFi
SUSHI|SushiSwap|DeFi
1INCH|1inch Network|DeFi
BAT|Basic Attention Token|Crypto
ZRX|0x Protocol|DeFi
ENJ|Enjin Coin|Gaming
GMT|STEPN|Gaming
IMX|Immutable|Gaming
LRC|Loopring|DeFi
MASK|Mask Network|Crypto
ENS|Ethereum Name Service|Crypto
LPT|Livepeer|Crypto
BLUR|Blur|NFT
DYDX|dYdX|DeFi
GMX|GMX|DeFi
PENDLE|Pendle|DeFi
JTO|Jito|DeFi
STRK|Starknet|Scaling
TIA|Celestia|Crypto
W|Wormhole|Crypto
ZK|ZKsync|Scaling
ZRO|LayerZero|Crypto
NOT|Notcoin|Popular
PEOPLE|ConstitutionDAO|Popular
ORDI|ORDI|Bitcoin ecosystem
SATS|SATS|Bitcoin ecosystem
BSV|Bitcoin SV|Crypto
RON|Ronin|Gaming
BEAM|Beam|Gaming
AKT|Akash Network|Crypto
OSMO|Osmosis|DeFi
DYM|Dymension|Crypto
CELO|Celo|Crypto
ONE|Harmony|Crypto
QTUM|Qtum|Crypto
ZIL|Zilliqa|Crypto
RVN|Ravencoin|Crypto
SC|Siacoin|Storage
ANKR|Ankr|Crypto
COTI|COTI|Payments
SKL|SKALE|Scaling
STORJ|Storj|Storage
AUDIO|Audius|Crypto
API3|API3|Data oracles
BAND|Band Protocol|Data oracles
UMA|UMA|DeFi
MAGIC|Treasure|Gaming
ILV|Illuvium|Gaming
YGG|Yield Guild Games|Gaming
RSR|Reserve Rights|Payments
ACH|Alchemy Pay|Payments
AMP|Amp|Payments
GLM|Golem|Crypto
SFP|SafePal|Wallets
TWT|Trust Wallet Token|Wallets
CSPR|Casper|Crypto
KSM|Kusama|Crypto
GLMR|Moonbeam|Crypto
ASTR|Astar|Crypto
KDA|Kadena|Crypto
LUNA|Terra|Crypto
LUNC|Terra Classic|Crypto
USTC|TerraClassicUSD|Stablecoin
FXS|Frax Share|DeFi
FRAX|Frax|Stablecoin
USDD|USDD|Stablecoin
USDE|Ethena USDe|Stablecoin
USD1|USD1|Stablecoin
USDP|Pax Dollar|Stablecoin
GUSD|Gemini Dollar|Stablecoin
LUSD|Liquity USD|Stablecoin
T|Threshold|Crypto
CVX|Convex Finance|DeFi
SPELL|Spell Token|DeFi
ONG|Ontology Gas|Crypto
ONT|Ontology|Crypto
ICX|ICON|Crypto
XEC|eCash|Crypto
KAIA|Kaia|Crypto
XCH|Chia|Crypto
ZEN|Horizen|Crypto
DCR|Decred|Crypto
AR|Arweave|Storage
TFUEL|Theta Fuel|Crypto
XNO|Nano|Payments
HOT|Holo|Crypto
CELR|Celer Network|Scaling
CKB|Nervos Network|Crypto
METIS|Metis|Scaling
KNC|Kyber Network Crystal|DeFi
APE|ApeCoin|Popular
MEME|Memecoin|Popular
MEW|cat in a dogs world|Popular
BOME|Book of Meme|Popular
TURBO|Turbo|Popular
PNUT|Peanut the Squirrel|Popular
POPCAT|Popcat|Popular
MOG|Mog Coin|Popular
BRETT|Brett|Popular
AERO|Aerodrome Finance|DeFi
AIOZ|AIOZ Network|Crypto
WAVES|Waves|Crypto
NMR|Numeraire|AI
RLC|iExec RLC|AI
POWR|Powerledger|Crypto
TRB|Tellor|Data oracles
EDU|Open Campus|Crypto
ID|SPACE ID|Crypto
SSV|SSV Network|Staking
SAFE|Safe|Wallets
COW|CoW Protocol|DeFi
EIGEN|EigenLayer|Staking
MORPHO|Morpho|DeFi
GRASS|Grass|AI
`.trim();

const SUPPLEMENTAL_CRYPTO_FALLBACKS = SUPPLEMENTAL_CRYPTO_FALLBACK_DATA
  .split(/\r?\n/)
  .map((line, index) => {
    const [symbol, name, market = "Crypto"] = line.split("|").map((part) => part.trim());
    return {
      rank: TRADE_CRYPTO_ASSETS.length + index + 1,
      id: String(name || symbol).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
      symbol,
      name: name || symbol,
      assetType: "crypto",
      market,
      tags: ["Market fallback"],
      depositNetworks: []
    };
  });

function staticCryptoFallbackCatalog() {
  const supplementalCount = Math.max(0, CRYPTO_MARKET_LIMIT - TRADE_CRYPTO_ASSETS.length);
  return [
    AUTODY_MARKET_ASSET,
    ...TRADE_CRYPTO_ASSETS,
    ...SUPPLEMENTAL_CRYPTO_FALLBACKS.slice(0, supplementalCount)
  ].map(assetCatalogEntry);
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
    logoUrl: row.image || existing.logoUrl || existing.image || null,
    tags: existing.tags || [],
    depositNetworks: existing.depositNetworks || [],
    price: Number.isFinite(price) ? price : null,
    changePct: Number.isFinite(changePct) ? changePct : null,
    marketCap: Number.isFinite(marketCap) ? marketCap : null,
    fdv: Number.isFinite(fdv) ? fdv : null,
    liquidityUsd: existing.liquidityUsd ?? null,
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
    const minimumUsefulCryptoCount = CRYPTO_MARKET_LIMIT;
    if (liveAssets.length < minimumUsefulCryptoCount) {
      throw new Error(`CoinGecko returned only ${liveAssets.length} ranked assets`);
    }
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

const RAW_TRADE_STOCK_ASSETS = [
  { rank: 1, symbol: "SPY", name: "SPDR S&P 500 ETF", assetType: "etf", market: "NYSE Arca", region: "US", tags: ["S&P 500", "ETF"] },
  { rank: 2, symbol: "QQQ", name: "Invesco QQQ Trust", assetType: "etf", market: "Nasdaq", region: "US", tags: ["Nasdaq 100", "ETF"] },
  { rank: 3, symbol: "VOO", name: "Vanguard S&P 500 ETF", assetType: "etf", market: "NYSE Arca", region: "US", tags: ["S&P 500", "ETF"] },
  { rank: 4, symbol: "VT", name: "Vanguard Total World Stock ETF", assetType: "etf", market: "NYSE Arca", region: "Global", tags: ["World equity", "ETF"] },
  { rank: 5, symbol: "DIA", name: "SPDR Dow Jones ETF", assetType: "etf", market: "NYSE Arca", region: "US", tags: ["Dow", "ETF"] },
  { rank: 6, symbol: "IWM", name: "iShares Russell 2000 ETF", assetType: "etf", market: "NYSE Arca", region: "US", tags: ["Small caps", "ETF"] },
  { symbol: "IVV", name: "iShares Core S&P 500 ETF", assetType: "etf", market: "NYSE Arca", region: "US", tags: ["S&P 500", "ETF"] },
  { symbol: "VTI", name: "Vanguard Total Stock Market ETF", assetType: "etf", market: "NYSE Arca", region: "US", tags: ["Total market", "ETF"] },
  { symbol: "VEA", name: "Vanguard FTSE Developed Markets ETF", assetType: "etf", market: "NYSE Arca", region: "Global", tags: ["Developed markets", "ETF"] },
  { symbol: "VWO", name: "Vanguard FTSE Emerging Markets ETF", assetType: "etf", market: "NYSE Arca", region: "Global", tags: ["Emerging markets", "ETF"] },
  { symbol: "EFA", name: "iShares MSCI EAFE ETF", assetType: "etf", market: "NYSE Arca", region: "Global", tags: ["Developed markets", "ETF"] },
  { symbol: "EEM", name: "iShares MSCI Emerging Markets ETF", assetType: "etf", market: "NYSE Arca", region: "Global", tags: ["Emerging markets", "ETF"] },
  { symbol: "IEFA", name: "iShares Core MSCI EAFE ETF", assetType: "etf", market: "NYSE Arca", region: "Global", tags: ["Developed markets", "ETF"] },
  { symbol: "AGG", name: "iShares Core U.S. Aggregate Bond ETF", assetType: "etf", market: "NYSE Arca", region: "US", tags: ["Bonds", "ETF"] },
  { symbol: "BND", name: "Vanguard Total Bond Market ETF", assetType: "etf", market: "Nasdaq", region: "US", tags: ["Bonds", "ETF"] },
  { symbol: "TLT", name: "iShares 20+ Year Treasury Bond ETF", assetType: "etf", market: "Nasdaq", region: "US", tags: ["Treasuries", "ETF"] },
  { symbol: "HYG", name: "iShares iBoxx High Yield Corporate Bond ETF", assetType: "etf", market: "NYSE Arca", region: "US", tags: ["High yield", "ETF"] },
  { symbol: "LQD", name: "iShares iBoxx Investment Grade Corporate Bond ETF", assetType: "etf", market: "NYSE Arca", region: "US", tags: ["Corporate bonds", "ETF"] },
  { symbol: "SHY", name: "iShares 1-3 Year Treasury Bond ETF", assetType: "etf", market: "Nasdaq", region: "US", tags: ["Treasuries", "ETF"] },
  { symbol: "TIP", name: "iShares TIPS Bond ETF", assetType: "etf", market: "NYSE Arca", region: "US", tags: ["Inflation", "ETF"] },
  { symbol: "XLK", name: "Technology Select Sector SPDR Fund", assetType: "etf", market: "NYSE Arca", region: "US", tags: ["Technology", "ETF"] },
  { symbol: "XLF", name: "Financial Select Sector SPDR Fund", assetType: "etf", market: "NYSE Arca", region: "US", tags: ["Financials", "ETF"] },
  { symbol: "XLE", name: "Energy Select Sector SPDR Fund", assetType: "etf", market: "NYSE Arca", region: "US", tags: ["Energy stocks", "ETF"] },
  { symbol: "XLV", name: "Health Care Select Sector SPDR Fund", assetType: "etf", market: "NYSE Arca", region: "US", tags: ["Healthcare", "ETF"] },
  { symbol: "XLY", name: "Consumer Discretionary Select Sector SPDR Fund", assetType: "etf", market: "NYSE Arca", region: "US", tags: ["Consumer", "ETF"] },
  { symbol: "XLP", name: "Consumer Staples Select Sector SPDR Fund", assetType: "etf", market: "NYSE Arca", region: "US", tags: ["Consumer staples", "ETF"] },
  { symbol: "XLI", name: "Industrial Select Sector SPDR Fund", assetType: "etf", market: "NYSE Arca", region: "US", tags: ["Industrials", "ETF"] },
  { symbol: "XLU", name: "Utilities Select Sector SPDR Fund", assetType: "etf", market: "NYSE Arca", region: "US", tags: ["Utilities", "ETF"] },
  { symbol: "XLB", name: "Materials Select Sector SPDR Fund", assetType: "etf", market: "NYSE Arca", region: "US", tags: ["Materials", "ETF"] },
  { symbol: "XLRE", name: "Real Estate Select Sector SPDR Fund", assetType: "etf", market: "NYSE Arca", region: "US", tags: ["Real estate", "ETF"] },
  { symbol: "XLC", name: "Communication Services Select Sector SPDR Fund", assetType: "etf", market: "NYSE Arca", region: "US", tags: ["Communications", "ETF"] },
  { symbol: "SMH", name: "VanEck Semiconductor ETF", assetType: "etf", market: "Nasdaq", region: "US", tags: ["Semiconductors", "ETF"] },
  { symbol: "SOXX", name: "iShares Semiconductor ETF", assetType: "etf", market: "Nasdaq", region: "US", tags: ["Semiconductors", "ETF"] },
  { symbol: "ARKK", name: "ARK Innovation ETF", assetType: "etf", market: "NYSE Arca", region: "US", tags: ["Innovation", "ETF"] },
  { symbol: "VNQ", name: "Vanguard Real Estate ETF", assetType: "etf", market: "NYSE Arca", region: "US", tags: ["Real estate", "ETF"] },
  { symbol: "SCHD", name: "Schwab U.S. Dividend Equity ETF", assetType: "etf", market: "NYSE Arca", region: "US", tags: ["Dividend", "ETF"] },
  { symbol: "VIG", name: "Vanguard Dividend Appreciation ETF", assetType: "etf", market: "NYSE Arca", region: "US", tags: ["Dividend", "ETF"] },
  { symbol: "VYM", name: "Vanguard High Dividend Yield ETF", assetType: "etf", market: "NYSE Arca", region: "US", tags: ["Dividend", "ETF"] },
  { symbol: "IWF", name: "iShares Russell 1000 Growth ETF", assetType: "etf", market: "NYSE Arca", region: "US", tags: ["Growth", "ETF"] },
  { symbol: "IWD", name: "iShares Russell 1000 Value ETF", assetType: "etf", market: "NYSE Arca", region: "US", tags: ["Value", "ETF"] },
  { symbol: "IJH", name: "iShares Core S&P Mid-Cap ETF", assetType: "etf", market: "NYSE Arca", region: "US", tags: ["Mid cap", "ETF"] },
  { symbol: "IJR", name: "iShares Core S&P Small-Cap ETF", assetType: "etf", market: "NYSE Arca", region: "US", tags: ["Small cap", "ETF"] },
  { symbol: "RSP", name: "Invesco S&P 500 Equal Weight ETF", assetType: "etf", market: "NYSE Arca", region: "US", tags: ["Equal weight", "ETF"] },
  { symbol: "ACWI", name: "iShares MSCI ACWI ETF", assetType: "etf", market: "Nasdaq", region: "Global", tags: ["World equity", "ETF"] },
  { symbol: "EWJ", name: "iShares MSCI Japan ETF", assetType: "etf", market: "NYSE Arca", region: "Japan", tags: ["Japan", "ETF"] },
  { symbol: "EWZ", name: "iShares MSCI Brazil ETF", assetType: "etf", market: "NYSE Arca", region: "Brazil", tags: ["Brazil", "ETF"] },
  { symbol: "FXI", name: "iShares China Large-Cap ETF", assetType: "etf", market: "NYSE Arca", region: "China", tags: ["China", "ETF"] },
  { symbol: "MCHI", name: "iShares MSCI China ETF", assetType: "etf", market: "Nasdaq", region: "China", tags: ["China", "ETF"] },
  { symbol: "INDA", name: "iShares MSCI India ETF", assetType: "etf", market: "BATS", region: "India", tags: ["India", "ETF"] },
  { symbol: "EWG", name: "iShares MSCI Germany ETF", assetType: "etf", market: "NYSE Arca", region: "Germany", tags: ["Germany", "ETF"] },
  { symbol: "EWU", name: "iShares MSCI United Kingdom ETF", assetType: "etf", market: "NYSE Arca", region: "UK", tags: ["UK", "ETF"] },
  { symbol: "EWC", name: "iShares MSCI Canada ETF", assetType: "etf", market: "NYSE Arca", region: "Canada", tags: ["Canada", "ETF"] },
  { symbol: "GLD", name: "SPDR Gold Shares", assetType: "commodity", market: "NYSE Arca", region: "Commodity", tags: ["Gold", "Metals"] },
  { symbol: "SLV", name: "iShares Silver Trust", assetType: "commodity", market: "NYSE Arca", region: "Commodity", tags: ["Silver", "Metals"] },
  { symbol: "USO", name: "United States Oil Fund", assetType: "commodity", market: "NYSE Arca", region: "Commodity", tags: ["Oil", "WTI"] },
  { symbol: "BNO", name: "United States Brent Oil Fund", assetType: "commodity", market: "NYSE Arca", region: "Commodity", tags: ["Oil", "Brent"] },
  { symbol: "UNG", name: "United States Natural Gas Fund", assetType: "commodity", market: "NYSE Arca", region: "Commodity", tags: ["Natural gas", "Energy"] },
  { symbol: "GC=F", name: "Gold Futures", assetType: "commodity", market: "COMEX", region: "Commodity", tags: ["Gold", "Metals"] },
  { symbol: "SI=F", name: "Silver Futures", assetType: "commodity", market: "COMEX", region: "Commodity", tags: ["Silver", "Metals"] },
  { symbol: "HG=F", name: "Copper Futures", assetType: "commodity", market: "COMEX", region: "Commodity", tags: ["Copper", "Metals"] },
  { symbol: "PL=F", name: "Platinum Futures", assetType: "commodity", market: "NYMEX", region: "Commodity", tags: ["Platinum", "Metals"] },
  { symbol: "PA=F", name: "Palladium Futures", assetType: "commodity", market: "NYMEX", region: "Commodity", tags: ["Palladium", "Metals"] },
  { symbol: "CL=F", name: "WTI Crude Oil Futures", assetType: "commodity", market: "NYMEX", region: "Commodity", tags: ["Oil", "WTI"] },
  { symbol: "BZ=F", name: "Brent Crude Oil Futures", assetType: "commodity", market: "NYMEX", region: "Commodity", tags: ["Oil", "Brent"] },
  { symbol: "NG=F", name: "Natural Gas Futures", assetType: "commodity", market: "NYMEX", region: "Commodity", tags: ["Natural gas", "Energy"] },
  { symbol: "RB=F", name: "RBOB Gasoline Futures", assetType: "commodity", market: "NYMEX", region: "Commodity", tags: ["Gasoline", "Energy"] },
  { symbol: "HO=F", name: "Heating Oil Futures", assetType: "commodity", market: "NYMEX", region: "Commodity", tags: ["Heating oil", "Energy"] },
  { symbol: "ZC=F", name: "Corn Futures", assetType: "commodity", market: "CBOT", region: "Commodity", tags: ["Corn", "Agriculture"] },
  { symbol: "ZW=F", name: "Wheat Futures", assetType: "commodity", market: "CBOT", region: "Commodity", tags: ["Wheat", "Agriculture"] },
  { symbol: "ZS=F", name: "Soybean Futures", assetType: "commodity", market: "CBOT", region: "Commodity", tags: ["Soybeans", "Agriculture"] },
  { symbol: "ZM=F", name: "Soybean Meal Futures", assetType: "commodity", market: "CBOT", region: "Commodity", tags: ["Soybean meal", "Agriculture"] },
  { symbol: "ZL=F", name: "Soybean Oil Futures", assetType: "commodity", market: "CBOT", region: "Commodity", tags: ["Soybean oil", "Agriculture"] },
  { symbol: "KC=F", name: "Coffee Futures", assetType: "commodity", market: "ICE", region: "Commodity", tags: ["Coffee", "Softs"] },
  { symbol: "SB=F", name: "Sugar Futures", assetType: "commodity", market: "ICE", region: "Commodity", tags: ["Sugar", "Softs"] },
  { symbol: "CC=F", name: "Cocoa Futures", assetType: "commodity", market: "ICE", region: "Commodity", tags: ["Cocoa", "Softs"] },
  { symbol: "CT=F", name: "Cotton Futures", assetType: "commodity", market: "ICE", region: "Commodity", tags: ["Cotton", "Softs"] },
  { symbol: "LE=F", name: "Live Cattle Futures", assetType: "commodity", market: "CME", region: "Commodity", tags: ["Cattle", "Livestock"] },
  { symbol: "HE=F", name: "Lean Hogs Futures", assetType: "commodity", market: "CME", region: "Commodity", tags: ["Hogs", "Livestock"] },
  { symbol: "GF=F", name: "Feeder Cattle Futures", assetType: "commodity", market: "CME", region: "Commodity", tags: ["Cattle", "Livestock"] },
  { symbol: "OJ=F", name: "Orange Juice Futures", assetType: "commodity", market: "ICE", region: "Commodity", tags: ["Orange juice", "Softs"] },
  { symbol: "LBS=F", name: "Lumber Futures", assetType: "commodity", market: "CME", region: "Commodity", tags: ["Lumber", "Materials"] },
  { symbol: "ZO=F", name: "Oats Futures", assetType: "commodity", market: "CBOT", region: "Commodity", tags: ["Oats", "Agriculture"] },
  { symbol: "ZR=F", name: "Rough Rice Futures", assetType: "commodity", market: "CBOT", region: "Commodity", tags: ["Rice", "Agriculture"] },
  { symbol: "IAU", name: "iShares Gold Trust", assetType: "commodity", market: "NYSE Arca", region: "Commodity", tags: ["Gold", "Metals"] },
  { symbol: "PPLT", name: "abrdn Physical Platinum Shares ETF", assetType: "commodity", market: "NYSE Arca", region: "Commodity", tags: ["Platinum", "Metals"] },
  { symbol: "PALL", name: "abrdn Physical Palladium Shares ETF", assetType: "commodity", market: "NYSE Arca", region: "Commodity", tags: ["Palladium", "Metals"] },
  { symbol: "CPER", name: "United States Copper Index Fund", assetType: "commodity", market: "NYSE Arca", region: "Commodity", tags: ["Copper", "Metals"] },
  { symbol: "DBA", name: "Invesco DB Agriculture Fund", assetType: "commodity", market: "NYSE Arca", region: "Commodity", tags: ["Agriculture", "Basket"] },
  { symbol: "DBC", name: "Invesco DB Commodity Index Tracking Fund", assetType: "commodity", market: "NYSE Arca", region: "Commodity", tags: ["Commodity basket"] },
  { symbol: "GSG", name: "iShares S&P GSCI Commodity-Indexed Trust", assetType: "commodity", market: "NYSE Arca", region: "Commodity", tags: ["Commodity basket"] },
  { symbol: "COMT", name: "iShares GSCI Commodity Dynamic Roll Strategy ETF", assetType: "commodity", market: "Nasdaq", region: "Commodity", tags: ["Commodity basket"] },
  { symbol: "WEAT", name: "Teucrium Wheat Fund", assetType: "commodity", market: "NYSE Arca", region: "Commodity", tags: ["Wheat", "Agriculture"] },
  { symbol: "CORN", name: "Teucrium Corn Fund", assetType: "commodity", market: "NYSE Arca", region: "Commodity", tags: ["Corn", "Agriculture"] },
  { symbol: "SOYB", name: "Teucrium Soybean Fund", assetType: "commodity", market: "NYSE Arca", region: "Commodity", tags: ["Soybeans", "Agriculture"] },
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
  { rank: 100, symbol: "AZN.L", name: "AstraZeneca London", assetType: "stock", market: "London", region: "UK", currency: "GBp", tags: ["Healthcare"] },
  { symbol: "PEP", name: "PepsiCo", assetType: "stock", market: "Nasdaq", region: "US", tags: ["Consumer staples", "Beverages"] },
  { symbol: "KO", name: "Coca-Cola", assetType: "stock", market: "NYSE", region: "US", tags: ["Consumer staples", "Beverages"] },
  { symbol: "PG", name: "Procter & Gamble", assetType: "stock", market: "NYSE", region: "US", tags: ["Consumer staples"] },
  { symbol: "JNJ", name: "Johnson & Johnson", assetType: "stock", market: "NYSE", region: "US", tags: ["Healthcare"] },
  { symbol: "ABBV", name: "AbbVie", assetType: "stock", market: "NYSE", region: "US", tags: ["Healthcare", "Pharma"] },
  { symbol: "MRK", name: "Merck", assetType: "stock", market: "NYSE", region: "US", tags: ["Healthcare", "Pharma"] },
  { symbol: "CAT", name: "Caterpillar", assetType: "stock", market: "NYSE", region: "US", tags: ["Industrial", "Machinery"] },
  { symbol: "GE", name: "GE Aerospace", assetType: "stock", market: "NYSE", region: "US", tags: ["Industrial", "Aerospace"] },
  { symbol: "UBER", name: "Uber Technologies", assetType: "stock", market: "NYSE", region: "US", tags: ["Mobility", "Consumer tech"] },
  { symbol: "ARM", name: "Arm Holdings ADR", assetType: "stock", market: "Nasdaq", region: "UK", tags: ["Semiconductors"] },
  { symbol: "SE", name: "Sea Limited ADR", assetType: "stock", market: "NYSE", region: "Singapore", tags: ["Internet", "Gaming"] }
];

const TRADE_STOCK_ASSETS = RAW_TRADE_STOCK_ASSETS.map((asset, index) => ({
  ...asset,
  rank: index + 1
}));

function chunkItems(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

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
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encoded}?range=1d&interval=5m&includePrePost=false`;
  const json = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": MARKET_BROWSER_USER_AGENT
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
  "1y": "365"
};

const COINBASE_CHART_CONFIG = {
  "1d": { granularity: 300, days: 1 },
  "1w": { granularity: 3600, days: 7 },
  "1m": { granularity: 21600, days: 30 },
  "3m": { granularity: 86400, days: 90 },
  "1y": { granularity: 86400, days: 365 },
  all: { granularity: 86400, days: 365 * 5 }
};
const COINBASE_MAX_CANDLES_PER_REQUEST = 290;

const CHART_REFRESH_MS_BY_RANGE = {
  "1d": 60 * 1000,
  "1w": 5 * 60 * 1000,
  "1m": 15 * 60 * 1000,
  "3m": 30 * 60 * 1000,
  "1y": 60 * 60 * 1000,
  all: 6 * 60 * 60 * 1000
};

function chartSnapshotAgeMs(snapshot) {
  const captured = Date.parse(snapshot?.capturedAt || snapshot?.captured_at || "");
  if (!Number.isFinite(captured)) return Infinity;
  return Date.now() - captured;
}

function isUsableChartSnapshot(snapshot, range) {
  if (!snapshot?.points?.length) return false;
  const selectedRange = normalizeChartRange(range);
  if (normalizeChartRange(snapshot.range) !== selectedRange) return false;
  if (snapshot.provider === "coingecko-sparkline") return false;
  return true;
}

function isFreshChartSnapshot(snapshot, range) {
  if (!isUsableChartSnapshot(snapshot, range)) return false;
  const refreshMs = CHART_REFRESH_MS_BY_RANGE[normalizeChartRange(range)] || CHART_REFRESH_MS_BY_RANGE["1d"];
  return chartSnapshotAgeMs(snapshot) <= refreshMs;
}

async function fetchYahooChartSeries(asset, requestedRange = "1d") {
  const requested = normalizeChartRange(requestedRange);
  const selectedRange = CHART_RANGE_CONFIG[requested] ? requested : "1d";
  const config = CHART_RANGE_CONFIG[selectedRange];
  const encoded = encodeURIComponent(marketDataSymbol(asset));
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encoded}?range=${config.range}&interval=${config.interval}&includePrePost=false`;
  const json = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": MARKET_BROWSER_USER_AGENT
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
  const rangeStats = pointRangeStats(points);

  return {
    range: selectedRange,
    provider: "yahoo",
    providerSymbol: marketDataSymbol(asset),
    currency: meta.currency || asset.currency || "USD",
    points,
    stats: {
      rangeHigh: rangeStats.high,
      rangeLow: rangeStats.low,
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

function coinbaseProductSymbol(asset) {
  const candidate = String(asset.product || asset.providerSymbol || asset.yahooSymbol || "").toUpperCase();
  return /^[A-Z0-9-]+-USD$/.test(candidate) ? candidate : null;
}

async function fetchCoinbaseCandleBatch(product, startMs, endMs, granularity) {
  const params = new URLSearchParams({
    granularity: String(granularity),
    start: new Date(startMs).toISOString(),
    end: new Date(endMs).toISOString()
  });
  const url = `https://api.exchange.coinbase.com/products/${encodeURIComponent(product)}/candles?${params.toString()}`;
  const json = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Autody/1.0 market detail"
    }
  }).then((r) => {
    if (!r.ok) throw new Error(`Coinbase candles HTTP ${r.status}`);
    return r.json();
  });

  if (!Array.isArray(json)) {
    throw new Error(`Coinbase candles unavailable for ${product}`);
  }

  return json;
}

async function fetchCoinbaseChartSeries(asset, requestedRange = "1d") {
  const selectedRange = normalizeChartRange(requestedRange);
  const config = COINBASE_CHART_CONFIG[selectedRange] || COINBASE_CHART_CONFIG["1d"];
  const product = coinbaseProductSymbol(asset);
  if (!product) throw new Error(`Coinbase product missing for ${asset.symbol}`);

  const endMs = Date.now();
  const startMs = endMs - config.days * 24 * 60 * 60 * 1000;
  const windowMs = config.granularity * 1000 * COINBASE_MAX_CANDLES_PER_REQUEST;
  const candlesByTime = new Map();

  for (let cursor = startMs; cursor < endMs; cursor += windowMs) {
    const batchEndMs = Math.min(cursor + windowMs, endMs);
    const candles = await fetchCoinbaseCandleBatch(product, cursor, batchEndMs, config.granularity);
    for (const candle of candles) {
      if (Array.isArray(candle) && Number.isFinite(Number(candle[0]))) {
        candlesByTime.set(Number(candle[0]), candle);
      }
    }
  }

  const points = [...candlesByTime.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, candle]) => {
      const [time, low, high, open, close, volume] = candle.map(Number);
      return {
        time: new Date(time * 1000).toISOString(),
        open: Number.isFinite(open) ? open : null,
        high: Number.isFinite(high) ? high : null,
        low: Number.isFinite(low) ? low : null,
        close: Number(close),
        volume: Number.isFinite(volume) ? volume : null
      };
    })
    .filter((point) => Number.isFinite(point.close));

  if (!points.length) throw new Error(`Coinbase returned no candles for ${product} ${selectedRange}`);

  const range = {
    high: Math.max(...points.map((point) => Number(point.high ?? point.close)).filter(Number.isFinite)),
    low: Math.min(...points.map((point) => Number(point.low ?? point.close)).filter(Number.isFinite))
  };
  const latestVolume = [...points].reverse().find((point) => Number.isFinite(point.volume))?.volume ?? asset.totalVolume ?? asset.liquidityUsd ?? null;

  return {
    range: selectedRange,
    provider: selectedRange === "all" ? "coinbase-history" : "coinbase",
    providerSymbol: product,
    currency: "USD",
    points,
    stats: {
      rangeHigh: Number.isFinite(range.high) ? range.high : null,
      rangeLow: Number.isFinite(range.low) ? range.low : null,
      allTimeHigh: asset.ath ?? null,
      allTimeLow: asset.atl ?? null,
      volume: latestVolume,
      marketCap: asset.marketCap ?? null,
      fdv: asset.fdv ?? null
    }
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
    provider: "coingecko-sparkline",
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
  const requested = normalizeChartRange(requestedRange);
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
      provider: "coingecko",
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
    const fallback = selectedRange === "1w" ? sparklineChartSeries(asset, selectedRange) : null;
    if (fallback) return fallback;
    throw err;
  }
}

async function fetchCryptoChartSeries(asset, requestedRange = "1d") {
  const selectedRange = normalizeChartRange(requestedRange);
  const errors = [];

  if (selectedRange === "all") {
    try {
      return await fetchCoinbaseChartSeries(asset, selectedRange);
    } catch (err) {
      errors.push(err);
    }
  }

  if (selectedRange !== "all" && asset.id) {
    try {
      return await fetchCoinGeckoChartSeries(asset, selectedRange);
    } catch (err) {
      errors.push(err);
    }
  }

  try {
    return await fetchCoinbaseChartSeries(asset, selectedRange);
  } catch (err) {
    errors.push(err);
  }

  const yahooSymbol = marketDataSymbol(asset);
  if (yahooSymbol && /-USD$/i.test(yahooSymbol)) {
    try {
      const yahooChart = await fetchYahooChartSeries(asset, selectedRange);
      return {
        ...yahooChart,
        provider: selectedRange === "all" ? "yahoo-crypto-history" : "yahoo-crypto-fallback",
        stats: {
          ...(yahooChart.stats || {}),
          allTimeHigh: asset.ath ?? yahooChart.stats?.allTimeHigh ?? null,
          allTimeLow: asset.atl ?? yahooChart.stats?.allTimeLow ?? null,
          marketCap: asset.marketCap ?? null,
          fdv: asset.fdv ?? null,
          volume: yahooChart.stats?.volume ?? asset.totalVolume ?? asset.liquidityUsd ?? null
        }
      };
    } catch (err) {
      errors.push(err);
    }
  }

  if (selectedRange === "1w") {
    const fallback = sparklineChartSeries(asset, selectedRange);
    if (fallback) return fallback;
  }

  throw errors[0] || new Error(`No crypto chart provider available for ${asset.symbol} ${selectedRange}`);
}

async function fetchYahooAllTimeStats(asset) {
  const encoded = encodeURIComponent(marketDataSymbol(asset));
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encoded}?range=max&interval=1mo&includePrePost=false`;
  const json = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": MARKET_BROWSER_USER_AGENT
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

async function fetchLiveAssetChartSeries(asset, requestedRange = "1d") {
  const selectedRange = normalizeChartRange(requestedRange);

  const chart = asset.assetType === "crypto"
    ? await fetchCryptoChartSeries(asset, selectedRange)
    : await (async () => {
        const yahooChart = await fetchYahooChartSeries(asset, selectedRange);
        const allTimeStats = await fetchYahooAllTimeStats(asset).catch(() => ({}));
        yahooChart.stats = { ...(yahooChart.stats || {}), ...allTimeStats };
        return yahooChart;
      })();

  return chart;
}

async function fetchAssetChartSeries(asset, requestedRange = "1d") {
  const selectedRange = normalizeChartRange(requestedRange);

  if (asset.customAsset) {
    return {
      range: selectedRange,
      provider: "autody",
      providerSymbol: asset.symbol,
      currency: asset.currency || "USD",
      points: [],
      stats: {}
    };
  }

  const cached = await readLatestMarketChartSnapshot(asset.symbol, selectedRange);
  if (isFreshChartSnapshot(cached, selectedRange)) {
    return { ...cached, source: "database" };
  }

  try {
    const liveChart = await fetchLiveAssetChartSeries(asset, selectedRange);
    await saveMarketChartSnapshot(liveChart.provider, asset, liveChart);
    const storedChart = await readLatestMarketChartSnapshot(asset.symbol, selectedRange);
    return storedChart ? { ...storedChart, source: "database", refreshed: true } : liveChart;
  } catch (err) {
    console.error(`Live chart refresh failed for ${asset.symbol} ${selectedRange}, using chart cache if available:`, err);
    if (isUsableChartSnapshot(cached, selectedRange)) return { ...cached, source: "database", stale: true };
    throw err;
  }
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

    const minimumUsefulCryptoCount = CRYPTO_MARKET_LIMIT;
    if (assets.length < minimumUsefulCryptoCount) {
      throw new Error(`CoinGecko returned only ${assets.length} crypto assets`);
    }

    await saveMarketSnapshots("coingecko", "crypto", assets).catch((saveErr) => {
      console.error("Crypto market snapshot save unavailable:", saveErr);
    });
    cacheLiveMarketAssets(assets, "coingecko");
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
      await saveMarketSnapshots("coinbase-yahoo", "crypto", assets).catch((saveErr) => {
        console.error("Crypto fallback snapshot save unavailable:", saveErr);
      });
      cacheLiveMarketAssets(assets, "coinbase-yahoo");
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
    const quoteResults = [];
    for (const batch of chunkItems(TRADE_STOCK_ASSETS, 60)) {
      const symbols = batch.map((asset) => marketDataSymbol(asset)).join(",");
      const url = `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${symbols}&fields=symbol,shortName,currency,regularMarketPrice,regularMarketChangePercent,regularMarketTime,marketCap,regularMarketVolume,fiftyTwoWeekHigh,fiftyTwoWeekLow`;
      const json = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": MARKET_BROWSER_USER_AGENT
        }
      }).then((r) => {
        if (!r.ok) throw new Error(`Yahoo Finance HTTP ${r.status}`);
        return r.json();
      });

      quoteResults.push(...(json.quoteResponse?.result || []));
    }

    const catalogBySymbol = new Map(TRADE_STOCK_ASSETS.flatMap((asset) => [
      [asset.symbol, asset],
      [marketDataSymbol(asset), asset]
    ]));
    const assets = quoteResults.map((quote) => {
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

    await saveMarketSnapshots("yahoo", "stock", assets).catch((saveErr) => {
      console.error("Stock market snapshot save unavailable:", saveErr);
    });
    cacheLiveMarketAssets(assets, "yahoo");
    return { success: true, provider: "yahoo", assets };
  } catch (err) {
    console.error("Stock market proxy error:", err);
    try {
      const assets = await fetchYahooChartAssets(TRADE_STOCK_ASSETS);
      if (!assets.length) throw new Error("Yahoo chart returned no stock assets");
      await saveMarketSnapshots("yahoo-chart", "stock", assets).catch((saveErr) => {
        console.error("Yahoo chart snapshot save unavailable:", saveErr);
      });
      cacheLiveMarketAssets(assets, "yahoo-chart");
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
        await saveMarketSnapshots("stooq", "stock", assets).catch((saveErr) => {
          console.error("Stooq snapshot save unavailable:", saveErr);
        });
        cacheLiveMarketAssets(assets, "stooq");
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

    const signalAssets = [
      gold ? { symbol: "GC=F", name: gold.name, price: gold.price, changePct: gold.changePct } : null,
      economy ? { symbol: "^TNX", name: economy.name, price: economy.price, changePct: economy.changePct } : null
    ].filter(Boolean);
    await saveMarketSnapshots("yahoo", "signal", signalAssets).catch((saveErr) => {
      console.error("Signal snapshot save unavailable:", saveErr);
    });
    cacheLiveMarketAssets(signalAssets, "yahoo");

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

async function refreshCoreChartSnapshots() {
  if (!databaseConfigured() || !LIVE_CHART_REFRESH_SYMBOLS.length) {
    return { count: 0, skipped: true };
  }

  let count = 0;
  for (const symbol of LIVE_CHART_REFRESH_SYMBOLS) {
    const asset = await findMarketAssetBySymbol(symbol).catch((err) => {
      console.error(`Core chart asset lookup failed for ${symbol}:`, err);
      return null;
    });
    if (!asset || asset.customAsset) continue;

    for (const range of LIVE_CHART_REFRESH_RANGES.map(normalizeChartRange)) {
      try {
        const chart = await fetchAssetChartSeries(asset, range);
        if (chart?.points?.length) count += 1;
      } catch (err) {
        console.error(`Core chart refresh failed for ${symbol} ${range}:`, err);
      }
    }
  }

  return { count };
}

async function refreshLiveData({ includeNews = false, includeCharts = false, reason = "manual" } = {}) {
  const startedAt = new Date();
  const refreshes = [
    ["crypto", fetchCryptoMarketData()],
    ["stocks", fetchStockMarketData()],
    ["signals", fetchSignalMarketData()]
  ];

  if (includeCharts) refreshes.push(["charts", refreshCoreChartSnapshots()]);
  if (includeNews) refreshes.push(["news", fetchNewsData()]);

  const settled = await Promise.allSettled(refreshes.map(([, promise]) => promise));
  const results = {};

  settled.forEach((result, index) => {
    const key = refreshes[index][0];
    const value = result.status === "fulfilled" ? result.value : null;
    const count = value
      ? value.count ?? value.assets?.length ?? value.articles?.length ?? [value.gold, value.economy].filter(Boolean).length
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

async function runChartRefresh(reason = "chart-interval") {
  if (chartRefreshInFlight) return chartRefreshInFlight;

  const startedAt = new Date();
  chartRefreshInFlight = refreshCoreChartSnapshots()
    .then((result) => {
      lastChartRefresh = {
        success: true,
        reason,
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        result
      };
      return lastChartRefresh;
    })
    .catch((err) => {
      lastChartRefresh = {
        success: false,
        reason,
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        error: String(err?.message || err)
      };
      throw err;
    })
    .finally(() => {
      chartRefreshInFlight = null;
    });

  return chartRefreshInFlight;
}

function lastMarketRefreshTime() {
  const value = lastLiveRefresh?.finishedAt || lastLiveRefresh?.startedAt;
  const time = value ? Date.parse(value) : 0;
  return Number.isFinite(time) ? time : 0;
}

function maybeKickLiveMarketRefresh(reason = "request-stale") {
  if (!REQUEST_TRIGGERED_REFRESH_ENABLED) return;
  if (!databaseConfigured()) return;
  if (liveRefreshInFlight) return;

  const lastRefreshAt = lastMarketRefreshTime();
  if (!lastRefreshAt && Date.now() - SERVER_STARTED_AT < STARTUP_MARKET_REFRESH_DELAY_MS) return;
  if (lastRefreshAt && Date.now() - lastRefreshAt < LIVE_MARKET_STALE_MS) return;

  runLiveRefresh({ includeNews: false, includeCharts: false, reason }).catch((err) => {
    console.error("Request-triggered live market refresh failed:", err);
  });
}

function startLiveDataRefreshLoop() {
  if (!databaseConfigured()) return;

  if (STARTUP_MARKET_REFRESH_DELAY_MS > 0) {
    const startupTimer = setTimeout(() => {
      runLiveRefresh({ includeNews: false, includeCharts: false, reason: "startup" }).catch((err) => {
        console.error("Startup live data refresh failed:", err);
      });
    }, STARTUP_MARKET_REFRESH_DELAY_MS);
    startupTimer.unref?.();
  }

  if (STARTUP_CHART_REFRESH_DELAY_MS > 0) {
    const startupChartTimer = setTimeout(() => {
      runChartRefresh("startup-charts").catch((err) => {
        console.error("Startup chart refresh failed:", err);
      });
    }, STARTUP_CHART_REFRESH_DELAY_MS);
    startupChartTimer.unref?.();
  }

  if (LIVE_MARKET_REFRESH_MS > 0) {
    const marketTimer = setInterval(() => {
      runLiveRefresh({ includeNews: false, includeCharts: false, reason: "market-interval" }).catch((err) => {
        console.error("Market refresh interval failed:", err);
      });
    }, LIVE_MARKET_REFRESH_MS);
    marketTimer.unref?.();
  }

  if (LIVE_CHART_REFRESH_MS > 0) {
    const chartTimer = setInterval(() => {
      runChartRefresh("chart-interval").catch((err) => {
        console.error("Chart refresh interval failed:", err);
      });
    }, LIVE_CHART_REFRESH_MS);
    chartTimer.unref?.();
  }

  if (LIVE_NEWS_REFRESH_MS > 0) {
    const newsTimer = setInterval(() => {
      runLiveRefresh({ includeNews: true, includeCharts: false, reason: "news-interval" }).catch((err) => {
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

  if (dbCircuitOpen()) {
    return res.status(503).json({
      success: true,
      configured: true,
      provider: "supabase-postgres",
      connected: false,
      error: "Database connection is slow right now. Demo account routes will wait for persistent Supabase storage."
    });
  }

  try {
    const result = await withDbTimeout(
      dbPool.query("select now() as connected_at"),
      "Database status"
    );
    return res.json({
      success: true,
      configured: true,
      provider: "supabase-postgres",
      connectedAt: result.rows[0]?.connected_at
    });
  } catch (err) {
    console.error("Database status error:", err);
    return res.status(503).json({
      success: true,
      configured: true,
      provider: "supabase-postgres",
      connected: false,
      error: "Database connection is slow right now. Demo account routes will wait for persistent Supabase storage."
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
    let result;
    if (symbol) {
      result = await dbPool.query(`
          select provider, symbol, asset_name, asset_type, provider_symbol, market, price_usd, change_pct, market_cap_usd, fdv_usd, liquidity_usd, total_volume_usd, high_24h, low_24h, ath, atl, circulating_supply, total_supply, max_supply, currency, logo_url, deposit_networks, captured_at
          from market_latest_snapshots
          where upper(symbol) = $1
          order by captured_at desc
          limit $2
        `, [symbol, limit]);
    } else {
      result = await dbPool.query(`
          select provider, symbol, asset_name, asset_type, provider_symbol, market, price_usd, change_pct, market_cap_usd, fdv_usd, liquidity_usd, total_volume_usd, high_24h, low_24h, ath, atl, circulating_supply, total_supply, max_supply, currency, logo_url, deposit_networks, captured_at
          from market_latest_snapshots
          order by captured_at desc
          limit $1
        `, [limit]);
    }

    return res.json({ success: true, configured: true, snapshots: result.rows });
  } catch (err) {
    console.error("Market snapshot read failed:", err);
    return res.status(500).json({
      success: false,
      error: "Market snapshots unavailable",
      detail: err.message || String(err),
      code: err.code || null
    });
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
    maybeKickLiveMarketRefresh("catalog-request-stale");
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

async function findMarketAssetBySymbol(symbol) {
  const lookup = String(symbol || "").trim().toUpperCase();
  if (!lookup) return null;

  const cached = marketCatalogCache.get("all");
  if (cached && cached.expiresAt > Date.now()) {
    const cachedAsset = cached.assets.find((item) => marketAssetMatchesLookup(item, lookup));
    if (cachedAsset) return cachedAsset;
  }

  const baseAsset = findStaticMarketAssetByLookup(lookup);
  const snapshot = await readLatestMarketSnapshotByLookup(lookup);
  if (baseAsset || snapshot) {
    return mergeResolvedMarketAsset(lookup, baseAsset, snapshot);
  }

  const assets = await buildMarketCatalog("all");
  return assets.find((item) => marketAssetMatchesLookup(item, lookup)) || null;
}

app.get("/api/markets/charts/:symbol", async (req, res) => {
  try {
    maybeKickLiveMarketRefresh("chart-request-stale");
    const symbol = decodeURIComponent(req.params.symbol || "").trim().toUpperCase();
    const range = normalizeChartRange(req.query.range);
    const asset = await findMarketAssetBySymbol(symbol);

    if (!asset) {
      return res.status(404).json({ success: false, error: "Asset not found" });
    }

    const chart = await fetchAssetChartSeries(asset, range);
    return res.json({
      success: true,
      symbol: asset.symbol,
      assetType: asset.assetType,
      range,
      chart
    });
  } catch (err) {
    console.error("Market chart API error:", err);
    return res.status(500).json({ success: false, error: "Market chart unavailable" });
  }
});

app.get("/api/markets/asset/:symbol", async (req, res) => {
  try {
    maybeKickLiveMarketRefresh("asset-request-stale");
    const symbol = decodeURIComponent(req.params.symbol || "").trim().toUpperCase();
    const range = normalizeChartRange(req.query.range);
    const asset = await findMarketAssetBySymbol(symbol);

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
    chartRefreshInFlight: Boolean(chartRefreshInFlight),
    intervals: {
      marketMs: LIVE_MARKET_REFRESH_MS,
      staleMs: LIVE_MARKET_STALE_MS,
      chartMs: LIVE_CHART_REFRESH_MS,
      newsMs: LIVE_NEWS_REFRESH_MS
    },
    liveCache: {
      count: liveMarketAssetCache.assets.length,
      updatedAt: liveMarketAssetCache.updatedAt ? new Date(liveMarketAssetCache.updatedAt).toISOString() : null
    },
    lastRefresh: lastLiveRefresh,
    lastChartRefresh
  });
});

app.post("/api/live/refresh", async (req, res) => {
  try {
    const includeNews = req.query.news !== "false";
    const includeCharts = req.query.charts === "true";
    const result = await runLiveRefresh({ includeNews, includeCharts, reason: "manual-api" });
    return res.json(result);
  } catch (err) {
    console.error("Manual live refresh failed:", err);
    return res.status(500).json({ success: false, error: "Live refresh failed" });
  }
});

app.get("/api/live/refresh", async (req, res) => {
  try {
    const includeNews = req.query.news !== "false";
    const includeCharts = req.query.charts === "true";
    const result = await runLiveRefresh({ includeNews, includeCharts, reason: "manual-api" });
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
    return sendDemoError(res, err, "Practice account unavailable");
  }
});

app.get("/api/demo/wallet", async (req, res) => {
  try {
    const account = await getPracticeAccountAny();
    const wallet = await buildDemoWalletSnapshot(account);

    return res.json({
      success: true,
      user: publicUser(account.user),
      wallet,
      source: account.source
    });
  } catch (err) {
    console.error("Demo wallet API error:", err);
    return sendDemoError(res, err, "Demo wallet unavailable");
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
    return sendDemoError(res, err, "Demo orders unavailable");
  }
});

app.post("/api/demo/orders", async (req, res) => {
  try {
    const body = parseJsonBody(req);
    const result = await placeDemoOrder(body);
    const wallet = await buildDemoWalletSnapshot(result.account);

    return res.json({
      success: true,
      order: result.order,
      wallet,
      source: result.source
    });
  } catch (err) {
    console.error("Demo order placement error:", err);
    return sendDemoError(res, err, "Demo order could not be placed");
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
    return sendDemoError(res, err, "Demo watchlist unavailable");
  }
});

app.post("/api/demo/watchlist", async (req, res) => {
  try {
    const body = parseJsonBody(req);
    const result = await addDemoWatchlistSymbol(body.symbol);
    return res.json({
      success: true,
      asset: result.asset,
      watchlist: result.watchlist || result.account.watchlist,
      alreadySaved: Boolean(result.alreadySaved),
      source: result.source
    });
  } catch (err) {
    console.error("Demo watchlist add error:", err);
    return sendDemoError(res, err, "Watchlist could not be updated");
  }
});

app.delete("/api/demo/watchlist/:symbol", async (req, res) => {
  try {
    const symbol = decodeURIComponent(req.params.symbol || "");
    const result = await removeDemoWatchlistSymbol(symbol);
    return res.json({
      success: true,
      watchlist: result.watchlist || result.account.watchlist,
      source: result.source
    });
  } catch (err) {
    console.error("Demo watchlist remove error:", err);
    return sendDemoError(res, err, "Watchlist could not be updated");
  }
});

app.get("/api/account/wallet", async (req, res) => {
  try {
    const account = await getPracticeAccountAny();
    const wallet = buildLiveWalletSnapshot(account);
    return res.json({
      success: true,
      user: publicUser(account.user),
      wallet,
      source: account.source
    });
  } catch (err) {
    console.error("Live wallet API error:", err);
    return sendDemoError(res, err, "Live wallet unavailable");
  }
});

app.get("/api/account/orders", async (req, res) => {
  try {
    const account = await getPracticeAccountAny();
    return res.json({
      success: true,
      user: publicUser(account.user),
      orders: [],
      source: account.source
    });
  } catch (err) {
    console.error("Live orders API error:", err);
    return sendDemoError(res, err, "Live orders unavailable");
  }
});

app.get("/api/account/watchlist", async (req, res) => {
  try {
    const account = await getPracticeAccountAny();
    const watchlist = await getPracticeWatchlistAny("live");
    return res.json({
      success: true,
      user: publicUser(account.user),
      watchlist,
      source: account.source
    });
  } catch (err) {
    console.error("Live watchlist API error:", err);
    return sendDemoError(res, err, "Live watchlist unavailable");
  }
});

app.post("/api/account/watchlist", async (req, res) => {
  try {
    const body = parseJsonBody(req);
    const result = await addLiveWatchlistSymbol(body.symbol);
    return res.json({
      success: true,
      asset: result.asset,
      watchlist: result.watchlist || result.account.watchlist,
      alreadySaved: Boolean(result.alreadySaved),
      source: result.source
    });
  } catch (err) {
    console.error("Live watchlist add error:", err);
    return sendDemoError(res, err, "Watchlist could not be updated");
  }
});

app.delete("/api/account/watchlist/:symbol", async (req, res) => {
  try {
    const symbol = decodeURIComponent(req.params.symbol || "");
    const result = await removeLiveWatchlistSymbol(symbol);
    return res.json({
      success: true,
      watchlist: result.watchlist || result.account.watchlist,
      source: result.source
    });
  } catch (err) {
    console.error("Live watchlist remove error:", err);
    return sendDemoError(res, err, "Watchlist could not be updated");
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
    return sendDemoError(res, err, "Demo performance unavailable");
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
    return sendDemoError(res, err, "Demo settings unavailable");
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



app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, filePath) {
    if (/\.(html|css|js)$/i.test(filePath)) {
      res.setHeader("Cache-Control", "no-store");
    } else {
      res.setHeader("Cache-Control", "public, max-age=86400");
    }
  }
}));
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
