const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const bodyParser = require("body-parser");
const { ethers } = require("ethers");
const { Pool } = require("pg");
const QRCode = require("qrcode");
const fetch = global.fetch || require("node-fetch");
const bip39 = require("bip39");
const { BIP32Factory } = require("bip32");
const ecc = require("tiny-secp256k1");
const bitcoin = require("bitcoinjs-lib");
const cashaddr = require("cashaddrjs");
const {
    Connection: SolanaConnection,
    PublicKey: SolanaPublicKey,
    Keypair: SolanaKeypair,
    LAMPORTS_PER_SOL
} = require("@solana/web3.js");
const { derivePath: deriveEd25519Path } = require("ed25519-hd-key");
const rippleKeypairs = require("ripple-keypairs");
const StellarSdk = require("stellar-sdk");
const TronWebModule = require("tronweb");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;
const bip32 = BIP32Factory(ecc);
const TronWeb = TronWebModule.TronWeb || TronWebModule.default || TronWebModule;
bitcoin.initEccLib?.(ecc);

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
const ACCOUNT_TERMS_VERSION = "2026-06-17";
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
const RECAPTCHA_SITE_KEY = process.env.RECAPTCHA_SITE_KEY || process.env.GOOGLE_RECAPTCHA_SITE_KEY || process.env.CAPTCHA_SITE_KEY || "";
const RECAPTCHA_SECRET_KEY = process.env.RECAPTCHA_SECRET_KEY || process.env.GOOGLE_RECAPTCHA_SECRET_KEY || process.env.CAPTCHA_SECRET_KEY || "";
const RECAPTCHA_VERIFY_URL = "https://www.google.com/recaptcha/api/siteverify";
const CAPTCHA_REQUIRED = process.env.CAPTCHA_REQUIRED !== "false";
const APP_BASE_URL = process.env.APP_BASE_URL || "";
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const EMAIL_FROM = process.env.EMAIL_FROM || "Autody <onboarding@resend.dev>";
const SUPABASE_URL = String(process.env.SUPABASE_URL || process.env.SUPABASE_PROJECT_URL || "").replace(/\/+$/, "");
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "";
const KYC_STORAGE_BUCKET = process.env.KYC_STORAGE_BUCKET || "autody-kyc";
const KYC_MAX_FILE_BYTES = Number(process.env.KYC_MAX_FILE_BYTES || 8 * 1024 * 1024);
const FIAT_PAYMENT_PROCESSOR = String(process.env.FIAT_PAYMENT_PROCESSOR || process.env.PAYMENT_PROCESSOR || "stripe").trim().toLowerCase();
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || process.env.PAYMENT_PROCESSOR_SECRET_KEY || "";
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || process.env.PAYMENT_PROCESSOR_WEBHOOK_SECRET || "";
const STRIPE_API_BASE = process.env.STRIPE_API_BASE || "https://api.stripe.com/v1";
const PLATFORM_TRADING_FEE_BPS = Math.max(0, Number(process.env.PLATFORM_TRADING_FEE_BPS || 25));
const ADMIN_RESET_KEY = process.env.ADMIN_RESET_KEY || "";
const ADMIN_ACCOUNT_EMAIL = normalizeEmail(process.env.AUTODY_ADMIN_EMAIL || process.env.ADMIN_EMAIL || "");
const ADMIN_ACCOUNT_PASSWORD = process.env.AUTODY_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || "";
const ADMIN_ACCOUNT_PASSWORD_SALT = process.env.AUTODY_ADMIN_PASSWORD_SALT || process.env.ADMIN_PASSWORD_SALT || "";
const ADMIN_ACCOUNT_PASSWORD_HASH = process.env.AUTODY_ADMIN_PASSWORD_HASH || process.env.ADMIN_PASSWORD_HASH || "";
const ADMIN_SESSION_SECRET = process.env.AUTODY_ADMIN_SESSION_SECRET || process.env.ADMIN_SESSION_SECRET || ADMIN_RESET_KEY || ADMIN_ACCOUNT_PASSWORD_HASH || ADMIN_ACCOUNT_PASSWORD;
const ADMIN_KEY_BYPASS_ENABLED = process.env.AUTODY_ADMIN_KEY_BYPASS === "true";
const ADMIN_SESSION_HOURS = Number(process.env.ADMIN_SESSION_HOURS || 2);
const ADMIN_EMAIL_CODE_TTL_MS = Number(process.env.ADMIN_EMAIL_CODE_TTL_MS || 1000 * 60 * 5);
const AU_MARKET_TICK_RETENTION_DAYS = Math.max(7, Number(process.env.AU_MARKET_TICK_RETENTION_DAYS || 400));
const AU_MARKET_TICK_MAX_ROWS = Math.max(1000, Number(process.env.AU_MARKET_TICK_MAX_ROWS || 20000));
const SESSION_HOURS = Number(process.env.SESSION_HOURS || 8);
const REMEMBER_SESSION_HOURS = Number(process.env.REMEMBER_SESSION_HOURS || 24 * 30);
const EMAIL_VERIFICATION_TTL_MS = Number(process.env.EMAIL_VERIFICATION_TTL_MS || 1000 * 60 * 60 * 24);
const LOGIN_EMAIL_CODE_TTL_MS = Number(process.env.LOGIN_EMAIL_CODE_TTL_MS || 1000 * 60 * 5);
const UNVERIFIED_ACCOUNT_RETENTION_DAYS = Number(process.env.UNVERIFIED_ACCOUNT_RETENTION_DAYS || 30);
const DEPOSIT_ADDRESS_TTL_HOURS = Number(process.env.DEPOSIT_ADDRESS_TTL_HOURS || 24);
const DEPOSIT_MONITOR_ENABLED = process.env.DEPOSIT_MONITOR_ENABLED === "true";
const DEPOSIT_MONITOR_INTERVAL_MS = Math.max(15 * 1000, Number(process.env.DEPOSIT_MONITOR_INTERVAL_MS || 60 * 1000));
const DEPOSIT_PROVIDER_MIN_INTERVAL_MS = Math.max(0, Number(process.env.DEPOSIT_PROVIDER_MIN_INTERVAL_MS || 1200));
const DEPOSIT_PROVIDER_COOLDOWN_MS = Math.max(10 * 1000, Number(process.env.DEPOSIT_PROVIDER_COOLDOWN_MS || 60 * 1000));
const DEPOSIT_PROVIDER_MAX_COOLDOWN_MS = Math.max(DEPOSIT_PROVIDER_COOLDOWN_MS, Number(process.env.DEPOSIT_PROVIDER_MAX_COOLDOWN_MS || 10 * 60 * 1000));
const DEPOSIT_MONITOR_JITTER_MS = Math.max(0, Number(process.env.DEPOSIT_MONITOR_JITTER_MS || 5000));
const DEPOSIT_MONITOR_ADDRESS_LIMIT = Number(process.env.DEPOSIT_MONITOR_ADDRESS_LIMIT || 500);
const DEPOSIT_MIN_CONFIRMATIONS = Math.max(1, Number(process.env.DEPOSIT_MIN_CONFIRMATIONS || 3));
const DEPOSIT_MIN_AUTO_CREDIT_USD = Math.max(0, Number(process.env.DEPOSIT_MIN_AUTO_CREDIT_USD || 0.01));
const DEPOSIT_MIN_AUTO_STABLECOIN_CREDIT = Math.max(0, Number(process.env.DEPOSIT_MIN_AUTO_STABLECOIN_CREDIT || 0.01));
const DEPOSIT_DUST_CLEANUP_LIMIT = Math.max(0, Number(process.env.DEPOSIT_DUST_CLEANUP_LIMIT || 250));
const DEPOSIT_EVM_LOG_LOOKBACK_BLOCKS = Number(process.env.DEPOSIT_EVM_LOG_LOOKBACK_BLOCKS || 10000);
const DEPOSIT_EVM_SCAN_OVERLAP_BLOCKS = Number(process.env.DEPOSIT_EVM_SCAN_OVERLAP_BLOCKS || 5000);
const DEPOSIT_EVM_LOG_SCAN_CHUNK_BLOCKS = Math.max(100, Number(process.env.DEPOSIT_EVM_LOG_SCAN_CHUNK_BLOCKS || 5000));
const DEPOSIT_EVM_LOG_REQUEST_CHUNK_BLOCKS = Math.max(100, Number(process.env.DEPOSIT_EVM_LOG_REQUEST_CHUNK_BLOCKS || 500));
const DEPOSIT_EVM_SCAN_CURSOR_VERSION = String(process.env.DEPOSIT_EVM_SCAN_CURSOR_VERSION || "v2").trim() || "v2";
const DEPOSIT_EVM_TOPIC_ADDRESS_BATCH_SIZE = Math.max(1, Number(process.env.DEPOSIT_EVM_TOPIC_ADDRESS_BATCH_SIZE || 80));
const DEPOSIT_NATIVE_LOOKBACK_BLOCKS = Number(process.env.DEPOSIT_NATIVE_LOOKBACK_BLOCKS || 120);
const DEPOSIT_NATIVE_BLOCK_SCAN_LIMIT = Number(process.env.DEPOSIT_NATIVE_BLOCK_SCAN_LIMIT || 40);
const DEPOSIT_ACCOUNT_TX_LIMIT = Number(process.env.DEPOSIT_ACCOUNT_TX_LIMIT || 100);
const DEPOSIT_REST_TIMEOUT_MS = Number(process.env.DEPOSIT_REST_TIMEOUT_MS || 12 * 1000);
const DEPOSIT_REST_RETRY_ATTEMPTS = Math.max(0, Number(process.env.DEPOSIT_REST_RETRY_ATTEMPTS || 2));
const DEPOSIT_RPC_TIMEOUT_MS = Number(process.env.DEPOSIT_RPC_TIMEOUT_MS || 10 * 1000);
const DEPOSIT_RPC_RETRY_ATTEMPTS = Math.max(0, Number(process.env.DEPOSIT_RPC_RETRY_ATTEMPTS || 1));
const DEPOSIT_BLOCKSCOUT_EMPTY_FALLBACK = process.env.DEPOSIT_BLOCKSCOUT_EMPTY_FALLBACK === "true";
const FIAT_FUNDING_METHODS = new Set(["card", "ach", "wire"]);
const FIAT_FUNDING_LABELS = {
    card: "Debit card",
    ach: "ACH",
    wire: "Wire"
};
const DEPOSIT_ROUTE_PROVIDER = process.env.DEPOSIT_ROUTE_PROVIDER || process.env.CUSTODY_PROVIDER || "manual";
const DEPOSIT_ROUTE_MODE = String(process.env.AUTODY_DEPOSIT_ROUTE_MODE || process.env.DEPOSIT_ROUTE_MODE || "self_custody")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_");
const DEPOSIT_SWEEP_GAS_LIMIT = BigInt(Math.max(21000, Number(process.env.DEPOSIT_SWEEP_GAS_LIMIT || 140000)));
const DEPOSIT_SWEEP_DESTINATION_OVERRIDE = process.env.DEPOSIT_SWEEP_DESTINATION_OVERRIDE === "true";
const DEPOSIT_MNEMONIC = String(
    process.env.AUTODY_DEPOSIT_MNEMONIC
    || process.env.AUTODY_EVM_DEPOSIT_MNEMONIC
    || process.env.AUTODY_CUSTODY_EVM_MNEMONIC
    || ""
).trim();
const DEPOSIT_MNEMONIC_PASSWORD = process.env.AUTODY_DEPOSIT_PASSWORD || process.env.AUTODY_EVM_DEPOSIT_PASSWORD || process.env.AUTODY_CUSTODY_EVM_PASSWORD || "";
const EVM_DEPOSIT_MNEMONIC = DEPOSIT_MNEMONIC;
const EVM_DEPOSIT_PASSWORD = DEPOSIT_MNEMONIC_PASSWORD;
const EVM_DEPOSIT_BASE_PATH = process.env.AUTODY_EVM_DEPOSIT_BASE_PATH || process.env.AUTODY_CUSTODY_EVM_BASE_PATH || "m/44'/60'/0'/0";
let liveRefreshInFlight = null;
let lastLiveRefresh = null;
let chartRefreshInFlight = null;
let lastChartRefresh = null;
let depositMonitorTimer = null;
let depositMonitorInFlight = null;
let lastDepositMonitor = null;
const depositProviderStates = new Map();
const adminLoginChallenges = new Map();
let liveMarketAssetCache = { assets: [], bySymbol: new Map(), updatedAt: 0 };
const marketCatalogCache = new Map();
const SERVER_STARTED_AT = Date.now();
let dbSlowUntil = SERVER_STARTED_AT + DB_STARTUP_FALLBACK_MS;
let practiceAccountCache = null;
let signUpSchemaReadyPromise = null;

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
            },
            verification: {
                firstName: "Adrian",
                lastName: "Cole",
                legalName: "Adrian Cole",
                phone: "+15550190777",
                country: "United States",
                dateOfBirth: "1994-08-16",
                accountType: "personal",
                emailStatus: "verified",
                phoneStatus: "not_required",
                identityStatus: "pending",
                riskStatus: "standard",
                termsVersion: ACCOUNT_TERMS_VERSION,
                termsAcceptedAt: "2026-06-11T00:00:00.000Z",
                informationConfirmedAt: "2026-06-11T00:00:00.000Z"
            }
        }
    ],
    sessions: [],
    trustedDevices: [],
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
    depositRequests: {
        [PRACTICE_USER_ID]: []
    },
    fiatFundingRequests: {
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
            orderConfirmation: false,
            marketAlerts: false,
            newsAlerts: false
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
    let changed = false;
    if (normalizePracticeJsonUser(data)) changed = true;
    if (normalizeJsonWatchlists(data)) changed = true;
    if (changed) saveDemoDb(data);
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

function normalizePracticeJsonUser(db) {
    const user = (db.users || []).find((item) => item.id === PRACTICE_USER_ID || normalizeEmail(item.email) === PRACTICE_USER_EMAIL);
    if (!user) return false;
    const expected = defaultDemoDb.users[0].verification;
    const nextVerification = {
        ...expected,
        ...(user.verification || {}),
        emailStatus: "verified",
        phoneStatus: "not_required"
    };
    const changed = JSON.stringify(user.verification || {}) !== JSON.stringify(nextVerification);
    if (changed) user.verification = nextVerification;
    return changed;
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

    if (Array.isArray…187630 tokens truncated…rocessor.checkoutUrl
        ? "Continue to secure checkout."
        : request.method === "wire"
          ? "Wire reference saved. Bank instructions can be completed from the admin side."
          : processor.message || `${request.label} checkout is pending provider connection.`
    });
  } catch (err) {
    console.error("Live fiat funding request error:", err);
    return sendDemoError(res, err, "Funding request could not be created");
  }
});

app.post("/api/account/withdrawals/request", async (req, res) => {
  try {
    const body = parseJsonBody(req);
    const auth = await authenticatedAccountContext(req);
    const request = await createLiveWithdrawalRequest(auth, body);
    const emailDelivery = await sendWithdrawalLifecycleEmail(auth.user?.email, request).catch((err) => {
      console.error("Withdrawal notification email failed:", err.message || err);
      return { delivered: false, provider: "error" };
    });
    return res.json({
      success: true,
      request,
      nextStep: request.type === "internal"
        ? "Transfer completed."
        : "Your withdrawal request has been received. You will receive an update when it is completed.",
      emailDelivered: Boolean(emailDelivery?.delivered)
    });
  } catch (err) {
    console.error("Live withdrawal request error:", err);
    return sendDemoError(res, err, "Withdrawal request could not be created");
  }
});

app.get("/api/qr", async (req, res) => {
  try {
    const text = String(req.query.text || "").trim();
    if (!text) return res.status(400).send("Missing QR text.");
    if (text.length > 320) return res.status(400).send("QR text is too long.");

    const svg = await QRCode.toString(text, {
      type: "svg",
      margin: 1,
      width: 220,
      color: {
        dark: "#111620",
        light: "#f7f9ff"
      }
    });
    res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.send(svg);
  } catch (err) {
    console.error("QR generation error:", err);
    return res.status(500).send("QR code could not be generated.");
  }
});

app.get("/api/account/orders", async (req, res) => {
  try {
    const account = await getAuthenticatedAccount(req, "live");
    return res.json({
      success: true,
      user: publicUser(account.user),
      orders: account.orders || [],
      tradingFee: publicTradingFeeConfig(),
      source: account.source
    });
  } catch (err) {
    console.error("Live orders API error:", err);
    return sendDemoError(res, err, "Live orders unavailable");
  }
});

app.post("/api/account/orders", async (req, res) => {
  try {
    const body = parseJsonBody(req);
    const auth = await authenticatedAccountContext(req);
    const result = await placeLiveOrder(body, auth);
    const wallet = await buildLiveWalletSnapshot(result.account);

    return res.json({
      success: true,
      order: result.order,
      wallet,
      tradingFee: publicTradingFeeConfig(),
      source: result.source
    });
  } catch (err) {
    console.error("Live order placement error:", err);
    return sendDemoError(res, err, "Live order could not be placed");
  }
});

app.get("/api/account/watchlist", async (req, res) => {
  try {
    const account = await getAuthenticatedAccount(req, "live");
    return res.json({
      success: true,
      user: publicUser(account.user),
      watchlist: account.watchlist,
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
    const auth = await authenticatedAccountContext(req);
    const result = auth.source === "supabase"
      ? await addDatabaseWatchlistSymbol(body.symbol, "live", auth.profileId)
      : await addJsonWatchlistSymbol(body.symbol, "live", auth.userId);
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
    const auth = await authenticatedAccountContext(req);
    const result = auth.source === "supabase"
      ? await removeDatabaseWatchlistSymbol(symbol, "live", auth.profileId)
      : await removeJsonWatchlistSymbol(symbol, "live", auth.userId);
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

app.post("/api/kyc/submissions", async (req, res) => {
  try {
    const body = parseJsonBody(req);
    const auth = await authenticatedAccountContext(req);
    const submission = await createKycSubmission(auth, body);
    return res.json({
      success: true,
      submission
    });
  } catch (err) {
    console.error("KYC submission error:", err);
    return sendDemoError(res, err, "Identity review could not be submitted");
  }
});

app.get("/api/demo/performance", async (req, res) => {
  try {
    const account = await getAuthenticatedAccount(req, "demo");
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

app.post("/api/support/tickets", async (req, res) => {
  try {
    const body = parseJsonBody(req);
    const auth = await authenticatedAccountContext(req);
    const ticket = await createSupportTicket(auth, body);
    return res.json({
      success: true,
      ticket
    });
  } catch (err) {
    console.error("Support ticket error:", err);
    return sendDemoError(res, err, "Support ticket could not be submitted");
  }
});

app.post("/api/public/support/tickets", async (req, res) => {
  try {
    const body = parseJsonBody(req);
    const ticket = await createSupportTicket({ source: "public", profileId: null, userId: null, user: null }, body);
    return res.json({
      success: true,
      ticket
    });
  } catch (err) {
    console.error("Public support ticket error:", err);
    return sendDemoError(res, err, "Support ticket could not be submitted");
  }
});

app.get("/api/account/security/devices", async (req, res) => {
  try {
    const auth = await authenticatedAccountContext(req);
    const devices = await listTrustedDevicesForAccount(auth);
    return res.json({
      success: true,
      devices
    });
  } catch (err) {
    console.error("Remembered devices API error:", err);
    return sendDemoError(res, err, "Remembered devices unavailable");
  }
});

app.delete("/api/account/security/devices/:deviceId", async (req, res) => {
  try {
    const auth = await authenticatedAccountContext(req);
    const removed = await deleteTrustedDeviceForAccount(auth, normalizeText(req.params.deviceId));
    return res.json({
      success: true,
      removed
    });
  } catch (err) {
    console.error("Remembered device delete error:", err);
    return sendDemoError(res, err, "Remembered device could not be removed");
  }
});

app.post("/api/account/security/password/request", async (req, res) => {
  try {
    const auth = await authenticatedAccountContext(req);

    const email = auth.user?.email;
    const codeRecord = auth.source === "supabase"
      ? await createDatabaseVerificationCode(email, "email", "password_change", {
          codeMode: "numeric",
          ttlMs: LOGIN_EMAIL_CODE_TTL_MS
        })
      : createJsonVerificationCode(email, "email", "password_change", {
          codeMode: "numeric",
          ttlMs: LOGIN_EMAIL_CODE_TTL_MS
        });
    if (!codeRecord?.code) throw signUpError(500, "Could not create a password change code.");

    const delivery = await sendPasswordChangeCodeEmail(email, codeRecord.code).catch((err) => {
      console.error("Password change code delivery failed:", err.message || err);
      throw signUpError(502, "Could not send the password change code. Try again.");
    });
    return res.json({
      success: true,
      delivery: delivery.delivered ? "Password change code sent." : "Password change code created. Email delivery provider is not fully connected yet."
    });
  } catch (err) {
    console.error("Password code request error:", err);
    return res.status(err.statusCode || 500).json({ success: false, error: err.statusCode ? err.message : "Could not start password change." });
  }
});

app.post("/api/account/security/password/confirm", async (req, res) => {
  try {
    const body = parseJsonBody(req);
    const auth = await authenticatedAccountContext(req);
    const currentPassword = String(body.currentPassword || "");
    const code = normalizeText(body.code).replace(/\s+/g, "");
    const newPassword = String(body.newPassword || "");
    const passwordMessage = passwordValidationMessage(newPassword);
    if (!currentPassword || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ success: false, error: "Enter your current password and the 6-digit email code." });
    }
    if (passwordMessage) return res.status(400).json({ success: false, error: passwordMessage });
    if (!await verifyAccountPassword(auth, currentPassword)) {
      return res.status(403).json({ success: false, error: "Current password is incorrect." });
    }

    const email = auth.user?.email;
    const verified = auth.source === "supabase"
      ? await verifyDatabaseCode(email, "email", code, "password_change", { markProfileVerified: false }).catch(() => null)
      : verifyJsonCode(email, "email", code, "password_change", { markProfileVerified: false });
    if (!verified?.success) {
      return res.status(400).json({ success: false, error: verified?.error || "Password change code is invalid." });
    }

    await updateAccountPassword(auth, newPassword);
    return res.json({
      success: true
    });
  } catch (err) {
    console.error("Password change confirm error:", err);
    return res.status(err.statusCode || 500).json({ success: false, error: err.statusCode ? err.message : "Could not change password." });
  }
});

app.get("/api/account/security/authenticator", async (req, res) => {
  try {
    const auth = await authenticatedAccountContext(req);
    const status = await authenticatorStatusForAccount(auth);
    return res.json({
      success: true,
      ...status
    });
  } catch (err) {
    console.error("Authenticator status error:", err);
    return sendDemoError(res, err, "Authenticator status unavailable");
  }
});

app.post("/api/account/security/authenticator/setup", async (req, res) => {
  try {
    const body = parseJsonBody(req);
    const auth = await authenticatedAccountContext(req);
    const currentPassword = String(body.currentPassword || "");
    if (!currentPassword) return res.status(400).json({ success: false, error: "Current password is required." });
    if (!await verifyAccountPassword(auth, currentPassword)) {
      return res.status(403).json({ success: false, error: "Current password is incorrect." });
    }
    const setup = await startAuthenticatorSetup(auth);
    return res.json({
      success: true,
      ...setup
    });
  } catch (err) {
    console.error("Authenticator setup error:", err);
    return res.status(err.statusCode || 500).json({ success: false, error: err.statusCode ? err.message : "Could not start authenticator setup." });
  }
});

app.post("/api/account/security/authenticator/confirm", async (req, res) => {
  try {
    const body = parseJsonBody(req);
    const auth = await authenticatedAccountContext(req);
    const currentPassword = String(body.currentPassword || "");
    const code = normalizeText(body.code).replace(/\s+/g, "");
    if (!currentPassword || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ success: false, error: "Enter your current password and the 6-digit authenticator code." });
    }
    if (!await verifyAccountPassword(auth, currentPassword)) {
      return res.status(403).json({ success: false, error: "Current password is incorrect." });
    }
    await confirmAuthenticatorSetup(auth, code);
    return res.json({
      success: true
    });
  } catch (err) {
    console.error("Authenticator confirm error:", err);
    return res.status(err.statusCode || 500).json({ success: false, error: err.statusCode ? err.message : "Could not enable authenticator." });
  }
});

const ACCOUNT_SETTINGS_FIELDS = {
  "settings-order-confirmation": { key: "orderConfirmation", column: "order_confirmation" },
  "settings-market-alerts": { key: "marketAlerts", column: "market_alerts" },
  "settings-news-alerts": { key: "newsAlerts", column: "news_alerts" },
  "settings-deposit-alerts": { key: "depositAlerts", column: "deposit_alerts" },
  "settings-withdrawal-alerts": { key: "withdrawalAlerts", column: "withdrawal_alerts" },
  "settings-price-alerts": { key: "priceAlerts", column: "price_alerts" },
  "settings-research-brief": { key: "researchBrief", column: "research_brief" }
};

app.post("/api/account/settings", async (req, res) => {
  try {
    const body = parseJsonBody(req);
    const field = ACCOUNT_SETTINGS_FIELDS[normalizeText(body.key)];
    if (!field) return res.status(400).json({ success: false, error: "Unknown setting." });

    const mode = normalizeText(body.mode).toLowerCase() === "demo" ? "demo" : "live";
    const enabled = body.value === true || normalizeText(body.value).toLowerCase() === "true";
    const account = await getAuthenticatedAccount(req, mode);

    if (account.source === "supabase") {
      await ensureSignUpTables();
      await dbPool.query(`
        insert into account_settings (profile_id, default_mode, currency, risk_level, ${field.column})
        values ($1, $2, 'USD', $3, $4)
        on conflict (profile_id) do update
        set ${field.column} = excluded.${field.column},
            updated_at = now()
      `, [
        account.user.id,
        mode,
        mode === "demo" ? "practice" : "standard",
        enabled
      ]);
    } else {
      const db = loadDemoDb();
      db.settings = db.settings || {};
      db.settings[account.user.id] = {
        ...(db.settings[account.user.id] || {}),
        [field.key]: enabled
      };
      saveDemoDb(db);
    }

    return res.json({ success: true, key: field.key, value: enabled });
  } catch (err) {
    console.error("Account settings update error:", err);
    return sendDemoError(res, err, "Could not save setting.");
  }
});

app.get("/api/demo/settings", async (req, res) => {
  try {
    const account = await getAuthenticatedAccount(req, "demo");
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



app.use((req, res, next) => {
  if (req.method === "GET" && /\.html$/i.test(req.path)) {
    const queryIndex = req.url.indexOf("?");
    const query = queryIndex >= 0 ? req.url.slice(queryIndex) : "";
    const cleanPath = req.path
      .replace(/\/index\.html$/i, "/")
      .replace(/\.html$/i, "");
    return res.redirect(301, `${cleanPath || "/"}${query}`);
  }
  return next();
});

app.use(express.static(path.join(__dirname, 'public'), {
  extensions: ["html"],
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
    startDepositMonitorLoop();
  });
}

startServer().catch((err) => {
  console.error("Autody startup failed:", err);
  process.exit(1);
});

