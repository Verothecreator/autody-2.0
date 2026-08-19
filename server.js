Warning: truncated output (original token count: 201225)
Total output lines: 18564

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
const EMAIL_VERIFY_FROM = process.env.EMAIL_VERIFY_FROM || "Autody Verification <verify@autodytraded.com>";
const EMAIL_SECURITY_FROM = process.env.EMAIL_SECURITY_FROM || "Autody Security <security@autodytraded.com>";
const EMAIL_NOTIFICATIONS_FROM = process.env.EMAIL_NOTIFICATIONS_FROM || "Autody Notifications <notifications@autodytraded.com>";
const EMAIL_MARKETS_FROM = process.env.EMAIL_MARKETS_FROM || "Autody Markets <markets@autodytraded.com>";
const EMAIL_SUPPORT_FROM = process.env.EMAIL_SUPPORT_FROM || "Autody Support <support@autodytraded.com>";
const MARKETING_CONSENT_VERSION = "2026-08-19";
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

function jsonWatchlistForMode(db, mode = "demo", userId = PRACTICE_USER_ID) {
    normalizeJsonWatchlists(db);
    const ownerId = userId || PRACTICE_USER_ID;
    db.watchlists = db.watchlists || {};
    if (!db.watchlists[ownerId]) {
        db.watchlists[ownerId] = {
            demo: defaultWatchlistForMode("demo"),
            live: defaultWatchlistForMode("live")
        };
    }
    const bucket = db.watchlists[ownerId];
    if (Array.isArray(bucket.crypto) || Array.isArray(bucket.stocks)) {
        db.watchlists[ownerId] = {
            demo: {
                crypto: Array.from(new Set(bucket.crypto || [])),
                stocks: Array.from(new Set(bucket.stocks || []))
            },
            live: defaultWatchlistForMode("live")
        };
    }
    ["demo", "live"].forEach((watchMode) => {
        db.watchlists[ownerId][watchMode] = db.watchlists[ownerId][watchMode] || defaultWatchlistForMode(watchMode);
        db.watchlists[ownerId][watchMode].crypto = Array.from(new Set(db.watchlists[ownerId][watchMode].crypto || []));
        db.watchlists[ownerId][watchMode].stocks = Array.from(new Set(db.watchlists[ownerId][watchMode].stocks || []));
    });
    return db.watchlists[ownerId][normalizeWatchlistMode(mode)];
}

function maskPublicPhone(value = "") {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const digits = raw.replace(/\D/g, "");
    if (digits.length <= 4) return raw;
    return `${raw.slice(0, Math.min(raw.length, 4))}...${digits.slice(-4)}`;
}

function legacyProfileSeed(email = "") {
    return crypto.createHash("sha256").update(String(email || "autody-user")).digest("hex").replace(/\D/g, "").padEnd(10, "7").slice(0, 7);
}

function legacyProfilePhone(email = "") {
    const seed = legacyProfileSeed(email);
    return `+1555${seed}`;
}

const PROFILE_PLACEHOLDER_VALUES = new Set(["not_required", "not required", "pending", "unknown", "none", "null", "undefined", "-"]);

function cleanProfileText(value = "") {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    return text && !PROFILE_PLACEHOLDER_VALUES.has(text.toLowerCase()) ? text : "";
}

function firstProfileValue(...values) {
    return values.map(cleanProfileText).find(Boolean) || "";
}

function profileNameFromEmail(email = "") {
    return String(email || "")
        .split("@")[0]
        .replace(/[._-]+/g, " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase())
        .trim();
}

function profileNamePartsFromRow(row = {}) {
    const firstName = firstProfileValue(row.first_name, row.firstName);
    const lastName = firstProfileValue(row.last_name, row.lastName);
    const source = firstProfileValue(row.legal_name, row.legalName, row.display_name, row.displayName, row.name, profileNameFromEmail(row.email));
    const parts = source.split(/\s+/).filter(Boolean);
    return {
        firstName: firstName || parts[0] || "Autody",
        lastName: lastName || parts.slice(1).join(" ") || "User",
        legalName: firstProfileValue(row.legal_name, row.legalName) || source || `${firstName} ${lastName}`.trim()
    };
}

function legacyProfileDateOfBirth(email = "") {
    const seed = Number(legacyProfileSeed(email)) || 0;
    const year = 1984 + (seed % 18);
    const month = String((seed % 12) + 1).padStart(2, "0");
    const day = String((seed % 28) + 1).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function publicProfilePhone(row = {}) {
    return firstProfileValue(row.phone) || legacyProfilePhone(row.email);
}

function publicProfileCountry(row = {}) {
    return firstProfileValue(row.country) || "United States";
}

function publicProfileDateOfBirth(row = {}) {
    return firstProfileValue(row.date_of_birth, row.dateOfBirth) || legacyProfileDateOfBirth(row.email);
}

function publicUser(user) {
    const { auth, verification, ...safeUser } = user;
    if (verification) {
        const nameParts = profileNamePartsFromRow({
            firstName: verification.firstName,
            lastName: verification.lastName,
            legalName: verification.legalName,
            name: safeUser.name,
            displayName: safeUser.displayName,
            email: safeUser.email
        });
        safeUser.profile = {
            firstName: nameParts.firstName,
            lastName: nameParts.lastName,
            legalName: nameParts.legalName,
            phone: firstProfileValue(verification.phone) || legacyProfilePhone(safeUser.email),
            country: firstProfileValue(verification.country) || "United States",
            dateOfBirth: firstProfileValue(verification.dateOfBirth) || legacyProfileDateOfBirth(safeUser.email),
            accountType: verification.accountType || "personal"
        };
        safeUser.verification = {
            email: verification.emailStatus || verification.email || "pending",
            phone: verification.phoneStatus || verification.phone || "pending",
            identity: verification.identityStatus || verification.identity || "pending"
        };
    }
    return safeUser;
}

function accountNextPage(user) {
    const verification = user?.verification || {};
    const emailStatus = verification.email || verification.emailStatus;
    const email = encodeURIComponent(user?.email || "");
    if (emailStatus && emailStatus !== "verified") return `verify-email.html?email=${email}`;
    return "account.html";
}

function parseJsonBody(req) {
    const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : String(req.body || "");
    return raw ? JSON.parse(raw) : {};
}

function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
}

const DISPOSABLE_EMAIL_DOMAINS = new Set([
    "10minutemail.com",
    "guerrillamail.com",
    "mailinator.com",
    "tempmail.com",
    "temp-mail.org",
    "throwawaymail.com",
    "yopmail.com"
]);

function emailDomain(email = "") {
    return normalizeEmail(email).split("@").pop() || "";
}

function disposableEmail(email = "") {
    const domain = emailDomain(email);
    return DISPOSABLE_EMAIL_DOMAINS.has(domain);
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

function normalizePhone(phone = "") {
    return String(phone || "").trim().replace(/[^\d+]/g, "");
}

function sameHashValue(left = "", right = "") {
    const a = Buffer.from(String(left || ""), "hex");
    const b = Buffer.from(String(right || ""), "hex");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const TOTP_ISSUER = "Autody";
const TOTP_STEP_SECONDS = 30;
const TOTP_WINDOW = 1;
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buffer) {
    let bits = "";
    for (const byte of buffer) bits += byte.toString(2).padStart(8, "0");
    let output = "";
    for (let index = 0; index < bits.length; index += 5) {
        const chunk = bits.slice(index, index + 5).padEnd(5, "0");
        output += BASE32_ALPHABET[parseInt(chunk, 2)];
    }
    return output;
}

function base32Decode(secret = "") {
    const clean = String(secret || "").toUpperCase().replace(/[^A-Z2-7]/g, "");
    let bits = "";
    for (const char of clean) {
        const value = BASE32_ALPHABET.indexOf(char);
        if (value >= 0) bits += value.toString(2).padStart(5, "0");
    }
    const bytes = [];
    for (let index = 0; index + 8 <= bits.length; index += 8) {
        bytes.push(parseInt(bits.slice(index, index + 8), 2));
    }
    return Buffer.from(bytes);
}

function generateTotpSecret() {
    return base32Encode(crypto.randomBytes(20));
}

function authenticatorUri(email, secret) {
    const label = encodeURIComponent(`${TOTP_ISSUER}:${email}`);
    const issuer = encodeURIComponent(TOTP_ISSUER);
    return `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=${TOTP_STEP_SECONDS}`;
}

function totpCode(secret, timeStep = Math.floor(Date.now() / 1000 / TOTP_STEP_SECONDS)) {
    const key = base32Decode(secret);
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(timeStep));
    const hmac = crypto.createHmac("sha1", key).update(counter).digest();
    const offset = hmac[hmac.length - 1] & 0x0f;
    const binary = ((hmac[offset] & 0x7f) << 24)
        | ((hmac[offset + 1] & 0xff) << 16)
        | ((hmac[offset + 2] & 0xff) << 8)
        | (hmac[offset + 3] & 0xff);
    return String(binary % 1000000).padStart(6, "0");
}

function verifyTotpCode(secret, code) {
    const supplied = normalizeText(code).replace(/\s+/g, "");
    if (!secret || !/^\d{6}$/.test(supplied)) return false;
    const currentStep = Math.floor(Date.now() / 1000 / TOTP_STEP_SECONDS);
    for (let offset = -TOTP_WINDOW; offset <= TOTP_WINDOW; offset += 1) {
        if (totpCode(secret, currentStep + offset) === supplied) return true;
    }
    return false;
}

function normalizeText(value = "") {
    return String(value || "").replace(/\s+/g, " ").trim();
}

function signUpError(statusCode, message) {
    const err = new Error(message);
    err.statusCode = statusCode;
    return err;
}

function truthyFormValue(value) {
    return value === true || value === "true" || value === "on" || value === 1 || value === "1";
}

function captchaClientIp(req) {
    const forwarded = String(req?.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
    return String(req?.headers?.["cf-connecting-ip"] || forwarded || req?.ip || "").trim();
}

async function verifyCaptcha(body = {}, req) {
    if (!CAPTCHA_REQUIRED) return true;
    const token = normalizeText(body.recaptchaToken || body.captchaToken || body["g-recaptcha-response"]);
    if (!RECAPTCHA_SECRET_KEY || !token) return false;

    const params = new URLSearchParams();
    params.append("secret", RECAPTCHA_SECRET_KEY);
    params.append("response", token);
    const remoteIp = captchaClientIp(req);
    if (remoteIp) params.append("remoteip", remoteIp);

    try {
        const response = await fetch(RECAPTCHA_VERIFY_URL, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: params
        });
        const result = await response.json().catch(() => ({}));
        return Boolean(response.ok && result.success);
    } catch (err) {
        console.error("reCAPTCHA verification failed:", err.message || err);
        return false;
    }
}

function passwordValidationMessage(password = "") {
    const value = String(password || "");
    if (value.length < 8) return "Password must be at least 8 characters.";
    if (!/[A-Z]/.test(value)) return "Password must include an uppercase letter.";
    if (!/[a-z]/.test(value)) return "Password must include a lowercase letter.";
    if (!/\d/.test(value)) return "Password must include a number.";
    return "";
}

function isAdultDate(dateOfBirth = "") {
    const parsed = Date.parse(dateOfBirth);
    if (!Number.isFinite(parsed)) return false;
    const birthday = new Date(parsed);
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - 18);
    return birthday <= cutoff;
}

function parseSignUpPayload(body = {}) {
    const providedLegalName = normalizeText(body.legalName || body.name);
    const providedNameParts = providedLegalName.split(" ").filter(Boolean);
    const firstName = normalizeText(body.firstName) || providedNameParts[0] || "";
    const lastName = normalizeText(body.lastName) || providedNameParts.slice(1).join(" ");
    const legalName = providedLegalName || normalizeText(`${firstName} ${lastName}`);
    const displayName = normalizeText(body.displayName || legalName);
    const email = normalizeEmail(body.email);
    const countryCode = normalizePhone(body.countryCode);
    const countryCodeCountry = normalizeText(body.countryCodeCountry);
    const rawPhone = normalizePhone(body.phone);
    const phone = rawPhone.startsWith("+") ? rawPhone : normalizePhone(`${countryCode}${rawPhone}`);
    const country = normalizeText(body.country);
    const dateOfBirth = String(body.dateOfBirth || "").trim();
    const accountType = "personal";
    const password = String(body.password || "");
    const acceptedAccuracy = truthyFormValue(body.acceptedAccuracy ?? body.acceptedTerms);
    const acceptedServiceTerms = truthyFormValue(body.acceptedServiceTerms ?? body.termsAccepted);
    const acceptedAt = new Date().toISOString();

    if (firstName.length < 1 || lastName.length < 1) throw signUpError(400, "Enter your first and last name.");
    if (legalName.length < 2) throw signUpError(400, "Enter your legal name.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw signUpError(400, "Enter a valid email address.");
    if (disposableEmail(email)) throw signUpError(400, "Use a permanent email address for your Autody account.");
    if (phone.replace(/\D/g, "").length < 7) throw signUpError(400, "Enter a valid phone number.");
    if (country.length < 2) throw signUpError(400, "Enter your country of residence.");
    if (countryCodeCountry && countryCodeCountry !== country) throw signUpError(400, "Select the calling code that matches your country of residence.");
    if (!isAdultDate(dateOfBirth)) throw signUpError(400, "Autody accounts require a valid date of birth for an adult user.");

    const passwordMessage = passwordValidationMessage(password);
    if (passwordMessage) throw signUpError(400, passwordMessage);
    if (!acceptedAccuracy) throw signUpError(400, "Confirm that the account information is accurate.");
    if (!acceptedServiceTerms) throw signUpError(400, "Read and accept the Terms of Service.");

    return {
        firstName,
        lastName,
        legalName,
        displayName,
        email,
        phone,
        country,
        dateOfBirth,
        accountType,
        password,
        termsVersion: ACCOUNT_TERMS_VERSION,
        termsAcceptedAt: acceptedAt,
        informationConfirmedAt: acceptedAt
    };
}

function verificationCodeHash(code, salt) {
    return crypto.createHash("sha256").update(`${salt}:${code}`).digest("hex");
}

function createVerificationCodeRecord(channel, destination, options = {}) {
    const numericCode = options.codeMode === "numeric";
    const code = numericCode || channel !== "email"
        ? String(crypto.randomInt(100000, 1000000))
        : crypto.randomBytes(24).toString("hex");
    const salt = crypto.randomBytes(16).toString("hex");
    const ttlMs = Number(options.ttlMs || (channel === "email" ? EMAIL_VERIFICATION_TTL_MS : 1000 * 60 * 10));
    return {
        channel,
        destination,
        code,
        salt,
        hash: verificationCodeHash(code, salt),
        expiresAt: new Date(Date.now() + ttlMs).toISOString()
    };
}

function appBaseUrl(req) {
    if (APP_BASE_URL) return APP_BASE_URL.replace(/\/+$/, "");
    const protocol = String(req?.headers?.["x-forwarded-proto"] || req?.protocol || "https").split(",")[0];
    const host = req?.get?.("host") || req?.headers?.host || "localhost:3000";
    return `${protocol}://${host}`;
}

function emailVerificationUrl(req, email, token) {
    const params = new URLSearchParams({ email, token });
    return `${appBaseUrl(req)}/verify-email.html?${params.toString()}`;
}

function emailHtmlEscape(value = "") {
    return String(value || "").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "\"": "&quot;",
        "'": "&#39;"
    }[char]));
}

async function sendVerificationEmail(email, token, req) {
    const verifyUrl = emailVerificationUrl(req, email, token);
    const subject = "Verify your Autody account";
    const text = `Welcome to Autody.\n\nVerify your email address within 24 hours to continue setting up your account:\n${verifyUrl}\n\nIf the link expires, return to Autody and request a new verification email. If you did not create an Autody account, you can ignore this email.`;
    const html = `
        <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827">
          <h1 style="margin:0 0 12px">Verify your Autody account</h1>
          <p>Welcome to Autody. Confirm your email address within 24 hours to continue setting up your account.</p>
          <p><a href="${verifyUrl}" style="display:inline-block;padding:12px 18px;background:#5b5fef;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700">Verify email</a></p>
          <p style="color:#4b5563">If the link expires, return to Autody and request a new verification email.</p>
          <p style="color:#4b5563">If the button does not work, copy and paste this link into your browser:</p>
          <p style="word-break:break-all">${verifyUrl}</p>
        </div>
    `;

    if (!RESEND_API_KEY) {
        console.log("Autody email verification link for", email, verifyUrl);
        return { delivered: false, provider: "console", verifyUrl };
    }

    const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${RESEND_API_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            from: EMAIL_VERIFY_FROM,
            to: email,
            subject,
            html,
            text
        })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result?.message || "Email delivery failed.");
    return { delivered: true, provider: "resend" };
}

async function sendWelcomeEmail(email, req) {
    const subject = "Welcome to Autody";
    const text = `Welcome to Autody.\n\nYour email is verified and your account workspace is ready.\n\nAutody brings live market information, crypto, stocks, ETFs, commodities, wallet views, orders, watchlists, and research into one account experience. Demo mode gives you practice funds to learn the platform before using live funding. Live mode is where verified balances, deposits, sends, receives, and future custody features will continue to grow.\n\nAutody AU is part of the long-term platform vision: a gold-backed utility token intended to support future exchange, payment, and account-use cases beyond simple buy-low/sell-high speculation.\n\nKeep your password private, review market risks before every order, and use the research and watchlist tools before making account decisions.\n\nWelcome aboard,\nThe Autody Team`;
    const html = `
        <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827">
          <h1 style="margin:0 0 12px">Welcome to Autody</h1>
          <p>Your email is verified and your account workspace is ready.</p>
          <p>Autody brings live market information, crypto, stocks, ETFs, commodities, wallet views, orders, watchlists, and research into one account experience.</p>
          <p>Demo mode gives you practice funds to learn the platform before using live funding. Live mode is where verified balances, deposits, sends, receives, and future custody features will continue to grow.</p>
          <p>Autody AU is part of the long-term platform vision: a gold-backed utility token intended to support future exchange, payment, and account-use cases beyond simple buy-low/sell-high speculation.</p>
          <p style="color:#4b5563">Keep your password private, review market risks before every order, and use the research and watchlist tools before making account decisions.</p>
          <p>Welcome aboard,<br>The Autody Team</p>
        </div>
    `;

    if (!RESEND_API_KEY) {
        console.log("Autody welcome email for", email);
        return { delivered: false, provider: "console" };
    }

    const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${RESEND_API_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            from: EMAIL_NOTIFICATIONS_FROM,
            to: email,
            subject,
            html,
            text
        })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result?.message || "Welcome email delivery failed.");
    return { delivered: true, provider: "resend" };
}

async function sendLoginCodeEmail(email, code) {
    const subject = "Your Autody sign-in code";
    const text = `Your Autody sign-in code is ${code}.\n\nThis code expires in 5 minutes. If you did not try to sign in, change your password and contact Autody support.`;
    const html = `
        <div style="margin:0;padding:24px;background:#ffffff;font-family:Arial,sans-serif;color:#111827">
          <div style="max-width:560px;margin:0 auto">
            <div style="font-size:13px;letter-spacing:3px;text-transform:uppercase;color:#5b5cf6;font-weight:800">Autody secure sign in</div>
            <h1 style="margin:16px 0 10px;font-size:28px;line-height:1.2;color:#111827">Your sign-in code</h1>
            <p style="margin:0 0 20px;color:#374151;font-size:16px;line-height:1.55">Use this one-time code to finish opening your Autody account.</p>
            <div style="margin:20px 0;padding:20px;border-radius:12px;background:#f4f6ff;text-align:center;border:1px solid #d7ddf3">
              <div style="font-size:40px;line-height:1;letter-spacing:8px;font-weight:900;color:#111827">${code}</div>
            </div>
            <p style="margin:0;color:#374151;font-size:14px;line-height:1.55">This code expires in <strong style="color:#111827">5 minutes</strong>. If you did not try to sign in, change your password and contact Autody support.</p>
          </div>
        </div>
    `;

    if (!RESEND_API_KEY) {
        console.log("Autody login code for", email, code);
        return { delivered: false, provider: "console" };
    }

    const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${RESEND_API_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            from: EMAIL_SECURITY_FROM,
            to: email,
            subject,
            html,
            text
        })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result?.message || "Login code delivery failed.");
    return { delivered: true, provider: "resend" };
}

async function sendAdminLoginCodeEmail(email, code) {
    const subject = "Your Autody admin access code";
    const text = `Your Autody admin access code is ${code}.\n\nThis code expires in 5 minutes. If you did not request admin access, change the admin password and review admin activity immediately.`;
    const html = `
        <div style="margin:0;padding:24px;background:#ffffff;font-family:Arial,sans-serif;color:#111827">
          <div style="max-width:560px;margin:0 auto">
            <div style="font-size:13px;letter-spacing:3px;text-transform:uppercase;color:#5b5cf6;font-weight:800">Autody private operations</div>
            <h1 style="margin:16px 0 10px;font-size:28px;line-height:1.2;color:#111827">Admin access code</h1>
            <p style="margin:0 0 20px;color:#374151;font-size:16px;line-height:1.55">Use this one-time code to open the Autody operations console.</p>
            <div style="margin:20px 0;padding:20px;border-radius:12px;background:#f4f6ff;text-align:center;border:1px solid #d7ddf3">
              <div style="font-size:40px;line-height:1;letter-spacing:8px;font-weight:900;color:#111827">${code}</div>
            </div>
            <p style="margin:0;color:#374151;font-size:14px;line-height:1.55">This code expires in <strong style="color:#111827">5 minutes</strong>. If this was not you, change the admin password and review admin activity immediately.</p>
          </div>
        </div>
    `;

    if (!RESEND_API_KEY) {
        console.log("Autody admin access code for", email, code);
        return { delivered: false, provider: "console" };
    }

    const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${RESEND_API_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            from: EMAIL_SECURITY_FROM,
            to: email,
            subject,
            html,
            text
        })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result?.message || "Admin code delivery failed.");
    return { delivered: true, provider: "resend" };
}

async function sendPasswordChangeCodeEmail(email, code) {
    const subject = "Confirm your Autody password change";
    const text = `Your Autody password change code is ${code}.\n\nThis code expires in 5 minutes. If you did not request a password change, sign in and contact Autody support.`;
    const html = `
        <div style="margin:0;padding:24px;background:#ffffff;font-family:Arial,sans-serif;color:#111827">
          <div style="max-width:560px;margin:0 auto">
            <div style="font-size:13px;letter-spacing:3px;text-transform:uppercase;color:#5b5cf6;font-weight:800">Autody account security</div>
            <h1 style="margin:16px 0 10px;font-size:28px;line-height:1.2;color:#111827">Confirm your password change</h1>
            <p style="margin:0 0 20px;color:#374151;font-size:16px;line-height:1.55">Use this one-time code to finish changing your Autody password.</p>
            <div style="margin:20px 0;padding:20px;border-radius:12px;background:#f4f6ff;text-align:center;border:1px solid #d7ddf3">
              <div style="font-size:40px;line-height:1;letter-spacing:8px;font-weight:900;color:#111827">${code}</div>
            </div>
            <p style="margin:0;color:#374151;font-size:14px;line-height:1.55">This code expires in <strong style="color:#111827">5 minutes</strong>. If this was not you, contact Autody support immediately.</p>
          </div>
        </div>
    `;

    if (!RESEND_API_KEY) {
        console.log("Autody password change code for", email, code);
        return { delivered: false, provider: "console" };
    }

    const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${RESEND_API_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            from: EMAIL_SECURITY_FROM,
            to: email,
            subject,
            html,
            text
        })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result?.message || "Password code delivery failed.");
    return { delivered: true, provider: "resend" };
}

function passwordResetUrl(req, email, token) {
    const params = new URLSearchParams({ email, token });
    return `${appBaseUrl(req)}/forgot-password.html?${params.toString()}`;
}

async function sendPasswordResetEmail(email, token, req) {
    const resetUrl = passwordResetUrl(req, email, token);
    const subject = "Reset your Autody password";
    const text = `Reset your Autody password with this secure link:\n${resetUrl}\n\nThis link expires in 5 minutes. If you did not request a password reset, you can ignore this email.`;
    const html = `
        <div style="margin:0;padding:24px;background:#ffffff;font-family:Arial,sans-serif;color:#111827">
          <div style="max-width:560px;margin:0 auto">
            <div style="font-size:13px;letter-spacing:3px;text-transform:uppercase;color:#5b5cf6;font-weight:800">Autody account security</div>
            <h1 style="margin:16px 0 10px;font-size:28px;line-height:1.2;color:#111827">Reset your password</h1>
            <p style="margin:0 0 20px;color:#374151;font-size:16px;line-height:1.55">Use the secure link below to set a new Autody password.</p>
            <p style="margin:20px 0"><a href="${resetUrl}" style="display:inline-block;padding:12px 18px;background:#5b5fef;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700">Reset password</a></p>
            <p style="margin:0;color:#374151;font-size:14px;line-height:1.55">This link expires in <strong style="color:#111827">5 minutes</strong>. If this was not you, no password change will happen.</p>
          </div>
        </div>
    `;

    if (!RESEND_API_KEY) {
        console.log("Autody password reset link for", email, resetUrl);
        return { delivered: false, provider: "console" };
    }

    const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${RESEND_API_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            from: EMAIL_SECURITY_FROM,
            to: email,
            subject,
            html,
            text
        })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result?.message || "Password reset delivery failed.");
    return { delivered: true, provider: "resend" };
}

function formatDepositUsd(amount) {
    const number = numberValue(amount, 0);
    return `$${number.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDepositAssetAmount(amount, symbol = "") {
    const number = numberValue(amount, 0);
    const text = number.toLocaleString("en-US", {
        minimumFractionDigits: number >= 1 ? 2 : 0,
        maximumFractionDigits: 10
    });
    return `${text} ${normalizeTradeSymbol(symbol) || "asset"}`.trim();
}

async function sendDepositLifecycleEmail(email, options = {}) {
    if (!email) return { delivered: false, provider: "none", skipped: true };
    const kind = options.kind === "confirmed" ? "confirmed" : "detected";
    const symbol = normalizeTradeSymbol(options.symbol);
    const amountText = formatDepositAssetAmount(options.amount, symbol);
    const usdText = options.amountUsd != null && Number(options.amountUsd) > 0
        ? ` (${formatDepositUsd(options.amountUsd)})`
        : "";
    const network = normalizeText(options.network) || "selected network";
    const confirmations = Math.max(0, Number(options.confirmations || 0));
    const requiredConfirmations = Math.max(1, Number(options.requiredConfirmations || DEPOSIT_MIN_CONFIRMATIONS));
    const txHash = normalizeText(options.txHash);
    const detected = kind === "detected";
    const subject = detected ? "Deposit detected" : "Deposit confirmed";
    const title = detected ? "Deposit detected" : "Deposit confirmed";
    const statusCopy = detected
        ? `Autody detected your ${amountText}${usdText} deposit on ${network}. It will be credited after ${requiredConfirmations} network confirmations.`
        : `Your ${amountText}${usdText} deposit on ${network} has been confirmed and credited to your Autody account.`;
    const confirmationCopy = detected
        ? `${confirmations} of ${requiredConfirmations} confirmations received`
        : `${Math.max(confirmations, requiredConfirmations)} confirmations received`;
    const text = `${title}\n\n${statusCopy}\n\nStatus: ${confirmationCopy}${txHash ? `\nTransaction: ${txHash}` : ""}\n\nThe Autody Team`;
    const html = `
        <div style="font-family:Arial,sans-serif;line-height:1.55;color:#111827">
          <div style="font-size:13px;letter-spacing:3px;text-transform:uppercase;color:${detected ? "#5b5cf6" : "#16a34a"};font-weight:800">Autody deposit update</div>
          <h1 style="margin:16px 0 10px;font-size:28px;line-height:1.2">${title}</h1>
          <p>${emailHtmlEscape(statusCopy)}</p>
          <div style="margin:18px 0;padding:16px;border-radius:12px;background:#f4f6ff;border:1px solid #d7ddf3">
            <strong>Amount</strong><br>${emailHtmlEscape(`${amountText}${usdText}`)}<br><br>
            <strong>Network</strong><br>${emailHtmlEscape(network)}<br><br>
            <strong>Status</strong><br>${emailHtmlEscape(confirmationCopy)}
            ${txHash ? `<br><br><strong>Transaction</strong><br><span style="word-break:break-all">${emailHtmlEscape(txHash)}</span>` : ""}
          </div>
          <p>The Autody Team</p>
        </div>
    `;

    if (!RESEND_API_KEY) {
        console.log(`Autody deposit ${kind} email for`, email, amountText, network, txHash);
        return { delivered: false, provider: "console" };
    }

    const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${RESEND_API_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ from: EMAIL_NOTIFICATIONS_FROM, to: email, subject, html, text })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result?.message || "Deposit email delivery failed.");
    return { delivered: true, provider: "resend" };
}

async function markDepositNotificationSent(eventId, kind) {
    if (!databaseConfigured() || !eventId) return;
    const key = kind === "confirmed" ? "depositConfirmedEmailSentAt" : "depositDetectedEmailSentAt";
    await dbPool.query(`
        update crypto_deposit_events
        set metadata = coalesce(metadata, '{}'::jsonb) || $2::jsonb,
            updated_at = now()
        where id = $1
    `, [eventId, JSON.stringify({ [key]: new Date().toISOString() })]);
}

async function deliverDepositNotifications(notifications = []) {
    for (const notification of notifications || []) {
        try {
            const delivery = await sendDepositLifecycleEmail(notification.email, notification);
            if (!delivery?.delivered) {
                console.error("Deposit notification was not delivered; it will be retried:", delivery?.provider || "unknown provider");
                continue;
            }
            await markDepositNotificationSent(notification.eventId, notification.kind);
        } catch (err) {
            console.error("Deposit notification email failed:", err.message || err);
        }
    }
}

async function sendWithdrawalLifecycleEmail(email, request = {}) {
    if (!email) return { delivered: false, provider: "none", skipped: true };

    const internal = request.type === "internal";
    const symbol = normalizeTradeSymbol(request.asset || request.symbol);
    const amountText = formatDepositAssetAmount(request.amount, symbol);
    const usdText = request.amountUsd != null && Number(request.amountUsd) > 0
        ? ` (${formatDepositUsd(request.amountUsd)})`
        : "";
    const network = normalizeText(request.network) || "selected network";
    const destination = internal
        ? normalizeText(request.recipientEmail) || "another Autody account"
        : normalizeText(request.destination) || "external wallet";
    const subject = internal ? "Transfer completed" : "Withdrawal request received";
    const title = internal ? "Transfer completed" : "Withdrawal request received";
    const statusCopy = internal
        ? `Your ${amountText}${usdText} transfer to ${destination} is complete.`
        : `Your ${amountText}${usdText} withdrawal request has been received and is being processed. You will receive another update when it is completed.`;
    const text = `${title}\n\n${statusCopy}\n\nNetwork: ${network}\nDestination: ${destination}\n\nThe Autody Team`;
    const html = `
        <div style="font-family:Arial,sans-serif;line-height:1.55;color:#111827">
          <div style="font-size:13px;letter-spacing:3px;text-transform:uppercase;color:#5b5cf6;font-weight:800">Autody account update</div>
          <h1 style="margin:16px 0 10px;font-size:28px;line-height:1.2">${title}</h1>
          <p>${emailHtmlEscape(statusCopy)}</p>
          <div style="margin:18px 0;padding:16px;border-radius:12px;background:#f4f6ff;border:1px solid #d7ddf3">
            <strong>Amount</strong><br>${emailHtmlEscape(`${amountText}${usdText}`)}<br><br>
            <strong>Network</strong><br>${emailHtmlEscape(network)}<br><br>
            <strong>${internal ? "Recipient" : "Destination"}</strong><br><span style="word-break:break-all">${emailHtmlEscape(destination)}</span>
          </div>
          <p>The Autody Team</p>
        </div>
    `;

    if (!RESEND_API_KEY) {
        console.log(`Autody ${internal ? "transfer" : "withdrawal"} email for`, email, amountText, network, destination);
        return { delivered: false, provider: "console" };
    }

    const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${RESEND_API_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ from: EMAIL_NOTIFICATIONS_FROM, to: email, subject, html, text })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result?.message || "Withdrawal email delivery failed.");
    return { delivered: true, provider: "resend" };
}

function kycRejectionReasonLabel(value = "") {
    const labels = {
        invalid_document: "Invalid document",
        invalid_id: "Invalid ID",
        inadequate_selfie: "Inadequate selfie",
        document_selfie_mismatch: "Document and selfie mismatch",
        expired_document: "Expired document",
        unclear_document: "Unclear document",
        unsupported_document: "Unsupported document",
        other: "Other"
    };
    return labels[normalizeKycRejectionReason(value)] || labels.other;
}

function normalizeKycRejectionReason(value = "") {
    const normalized = String(…171225 tokens truncated…res) => {
  try {
    let body = {};
    try {
      body = parseJsonBody(req);
    } catch (err) {
      return res.status(400).json({ success: false, error: "Invalid JSON payload." });
    }
    if (!adminRequestAuthorized(req, body)) {
      return res.status(403).json({ success: false, error: "Admin fee overview is not authorized." });
    }
    const result = await getAdminFeeOverview(body);
    return res.json(result);
  } catch (err) {
    console.error("Admin fee overview failed:", err);
    return res.status(err.status || 500).json({ success: false, error: err.message || "Fee overview failed." });
  }
});

app.post("/api/admin/news/overview", async (req, res) => {
  try {
    let body = {};
    try {
      body = parseJsonBody(req);
    } catch (err) {
      return res.status(400).json({ success: false, error: "Invalid JSON payload." });
    }
    if (!adminRequestAuthorized(req, body)) {
      return res.status(403).json({ success: false, error: "Admin news overview is not authorized." });
    }
    const result = await getAdminNewsOverview(body);
    return res.json(result);
  } catch (err) {
    console.error("Admin news overview failed:", err);
    return res.status(err.status || 500).json({ success: false, error: err.message || "News overview failed." });
  }
});

app.post("/api/admin/news/publish", async (req, res) => {
  try {
    let body = {};
    try {
      body = parseJsonBody(req);
    } catch (err) {
      return res.status(400).json({ success: false, error: "Invalid JSON payload." });
    }
    if (!adminRequestAuthorized(req, body)) {
      return res.status(403).json({ success: false, error: "Admin news publish is not authorized." });
    }
    const result = await publishAdminNewsArticle(body);
    return res.json(result);
  } catch (err) {
    console.error("Admin news publish failed:", err);
    return res.status(err.status || 500).json({ success: false, error: err.message || "News publish failed." });
  }
});

app.post("/api/admin/accounts/overview", async (req, res) => {
  try {
    let body = {};
    try {
      body = parseJsonBody(req);
    } catch (err) {
      return res.status(400).json({ success: false, error: "Invalid JSON payload." });
    }
    if (!adminRequestAuthorized(req, body)) {
      return res.status(403).json({ success: false, error: "Admin account overview is not authorized." });
    }
    const result = await getAdminAccountsOverview(body);
    return res.json(result);
  } catch (err) {
    console.error("Admin account overview failed:", err);
    return res.status(err.status || 500).json({ success: false, error: err.message || "Account overview failed." });
  }
});

app.post("/api/admin/accounts/control", async (req, res) => {
  try {
    let body = {};
    try {
      body = parseJsonBody(req);
    } catch (err) {
      return res.status(400).json({ success: false, error: "Invalid JSON payload." });
    }
    if (!adminRequestAuthorized(req, body)) {
      return res.status(403).json({ success: false, error: "Admin account control is not authorized." });
    }
    const result = await updateAdminAccountControl(body);
    return res.json(result);
  } catch (err) {
    console.error("Admin account control failed:", err);
    return res.status(err.status || 500).json({ success: false, error: err.message || "Account control failed." });
  }
});

app.post("/api/admin/accounts/impersonate", async (req, res) => {
  try {
    let body = {};
    try {
      body = parseJsonBody(req);
    } catch (err) {
      return res.status(400).json({ success: false, error: "Invalid JSON payload." });
    }
    if (!adminRequestAuthorized(req, body)) {
      return res.status(403).json({ success: false, error: "Admin account access is not authorized." });
    }
    const result = await createAdminAccountImpersonation(body);
    return res.json(result);
  } catch (err) {
    console.error("Admin account impersonation failed:", err);
    return res.status(err.status || 500).json({ success: false, error: err.message || "Account access failed." });
  }
});

app.post("/api/admin/accounts/permanent-delete", async (req, res) => {
  try {
    let body = {};
    try {
      body = parseJsonBody(req);
    } catch (err) {
      return res.status(400).json({ success: false, error: "Invalid JSON payload." });
    }
    if (!adminRequestAuthorized(req, body)) {
      return res.status(403).json({ success: false, error: "Admin account deletion is not authorized." });
    }
    const result = await permanentlyDeleteAdminAccount(body);
    return res.json(result);
  } catch (err) {
    console.error("Admin permanent account delete failed:", err);
    return res.status(err.status || 500).json({ success: false, error: err.message || "Permanent account deletion failed." });
  }
});

app.post("/api/admin/withdrawals/decision", async (req, res) => {
  try {
    let body = {};
    try {
      body = parseJsonBody(req);
    } catch (err) {
      return res.status(400).json({ success: false, error: "Invalid JSON payload." });
    }
    if (!adminRequestAuthorized(req, body)) {
      return res.status(403).json({ success: false, error: "Admin withdrawal review is not authorized." });
    }
    const result = await decideDatabaseWithdrawalRequest(body);
    return res.json(result);
  } catch (err) {
    console.error("Admin withdrawal decision failed:", err);
    return res.status(err.status || 500).json({ success: false, error: err.message || "Withdrawal review failed." });
  }
});

app.post("/api/admin/kyc/overview", async (req, res) => {
  try {
    let body = {};
    try {
      body = parseJsonBody(req);
    } catch (err) {
      return res.status(400).json({ success: false, error: "Invalid JSON payload." });
    }
    if (!adminRequestAuthorized(req, body)) {
      return res.status(403).json({ success: false, error: "Admin KYC overview is not authorized." });
    }
    const result = await getAdminKycOverview(body);
    return res.json(result);
  } catch (err) {
    console.error("Admin KYC overview failed:", err);
    return res.status(err.status || 500).json({ success: false, error: err.message || "KYC overview failed." });
  }
});

app.post("/api/admin/kyc/download", async (req, res) => {
  try {
    let body = {};
    try {
      body = parseJsonBody(req);
    } catch (err) {
      return res.status(400).json({ success: false, error: "Invalid JSON payload." });
    }
    if (!adminRequestAuthorized(req, body)) {
      return res.status(403).json({ success: false, error: "Admin KYC download is not authorized." });
    }
    const file = await getAdminKycDownload(body);
    res.setHeader("Content-Type", file.contentType);
    res.setHeader("Content-Length", file.bytes.length);
    res.setHeader("Content-Disposition", `attachment; filename="${file.fileName.replace(/"/g, "")}"`);
    return res.send(file.bytes);
  } catch (err) {
    console.error("Admin KYC download failed:", err);
    return res.status(err.status || 500).json({ success: false, error: err.message || "KYC download failed." });
  }
});

app.post("/api/admin/kyc/delete", async (req, res) => {
  try {
    let body = {};
    try {
      body = parseJsonBody(req);
    } catch (err) {
      return res.status(400).json({ success: false, error: "Invalid JSON payload." });
    }
    if (!adminRequestAuthorized(req, body)) {
      return res.status(403).json({ success: false, error: "Admin KYC delete is not authorized." });
    }
    const result = await deleteAdminKycSubmission(body);
    return res.json(result);
  } catch (err) {
    console.error("Admin KYC delete failed:", err);
    return res.status(err.status || 500).json({ success: false, error: err.message || "KYC delete failed." });
  }
});

app.post("/api/admin/kyc/review", async (req, res) => {
  try {
    let body = {};
    try {
      body = parseJsonBody(req);
    } catch (err) {
      return res.status(400).json({ success: false, error: "Invalid JSON payload." });
    }
    if (!adminRequestAuthorized(req, body)) {
      return res.status(403).json({ success: false, error: "Admin KYC review is not authorized." });
    }
    const result = await reviewKycSubmission(body);
    return res.json(result);
  } catch (err) {
    console.error("Admin KYC review failed:", err);
    return res.status(err.status || 500).json({ success: false, error: err.message || "KYC review failed." });
  }
});

app.post("/api/auth/resend-email", async (req, res) => {
  try {
    const email = normalizeEmail(parseJsonBody(req).email);
    if (!email) return res.status(400).json({ success: false, error: "Email is required." });

    const databaseProfile = await databaseProfileVerification(email).catch(() => null);
    if (databaseProfile?.email_status === "verified") {
      return res.status(409).json({
        success: false,
        verified: true,
        next: "account.html",
        error: "This email is already verified."
      });
    }

    const databaseCode = databaseProfile
      ? await createDatabaseVerificationCode(email, "email").catch(() => null)
      : null;
    const db = loadDemoDb();
    const jsonUser = jsonUserByEmail(db, email);
    if (!databaseCode && jsonUser?.verification?.emailStatus === "verified") {
      return res.status(409).json({
        success: false,
        verified: true,
        next: "account.html",
        error: "This email is already verified."
      });
    }

    const created = databaseCode || (jsonUser ? createJsonVerificationCode(email, "email") : null);
    if (!created) return res.status(404).json({ success: false, error: "Account not found." });

    const delivery = await sendVerificationEmail(email, created.code, req).catch((err) => {
      console.error("Verification email resend failed:", err.message || err);
      return { delivered: false, provider: "error", error: err.message || "Email delivery failed" };
    });
    return res.json({
      success: true,
      delivery: delivery.delivered ? "Verification email sent." : "Verification link created. Delivery provider is not fully connected yet."
    });
  } catch (err) {
    console.error("Resend email failed:", err);
    return res.status(500).json({ success: false, error: "Could not resend verification email." });
  }
});

app.post("/api/auth/verify-email", async (req, res) => {
  try {
    const body = parseJsonBody(req);
    const email = normalizeEmail(body.email);
    const token = normalizeText(body.token);
    if (!email || !token) return res.status(400).json({ success: false, error: "Verification link is incomplete." });

    const databaseProfile = await databaseProfileVerification(email).catch(() => null);
    if (databaseProfile?.email_status === "verified") {
      return res.status(409).json({
        success: false,
        verified: true,
        next: "account.html",
        error: "This email is already verified."
      });
    }

    const databaseResult = await verifyDatabaseCode(email, "email", token).catch(() => null);
    if (databaseResult?.success) {
      const session = await createDatabaseSession(databaseResult.profile.id);
      const user = databasePublicUser(databaseResult.profile);
      await sendWelcomeEmail(user.email, req).catch((err) => {
        console.error("Welcome email delivery failed:", err.message || err);
      });
      return res.json({
        success: true,
        user,
        session,
        next: "account.html",
        message: "Email verified. Opening your Autody account.",
        source: "supabase"
      });
    }
    if (databaseResult?.error) return res.status(400).json(databaseResult);

    const jsonStatusDb = loadDemoDb();
    const jsonStatusUser = jsonUserByEmail(jsonStatusDb, email);
    if (jsonStatusUser?.verification?.emailStatus === "verified") {
      return res.status(409).json({
        success: false,
        verified: true,
        next: "account.html",
        error: "This email is already verified."
      });
    }

    const jsonResult = verifyJsonCode(email, "email", token);
    if (!jsonResult.success) return res.status(400).json(jsonResult);
    const db = loadDemoDb();
    const user = jsonUserByEmail(db, email);
    const session = createDemoSession(db, user.id);
    await sendWelcomeEmail(user.email, req).catch((err) => {
      console.error("Welcome email delivery failed:", err.message || err);
    });

    return res.json({
      success: true,
      user: publicUser(user),
      session,
      next: "account.html",
      message: "Email verified. Opening your Autody account.",
      source: "json"
    });
  } catch (err) {
    console.error("Email verification failed:", err);
    return res.status(500).json({ success: false, error: "Email verification unavailable." });
  }
});

app.post("/api/auth/complete-email-verification", async (req, res) => {
  try {
    const body = parseJsonBody(req);
    const email = normalizeEmail(body.email);
    const handoffToken = normalizeText(body.handoffToken);
    if (!email || !handoffToken) {
      return res.status(400).json({ success: false, error: "Verification session is incomplete." });
    }

    const databaseProfile = await databaseProfileVerification(email).catch(() => null);
    if (databaseProfile) {
      if (databaseProfile.email_status !== "verified") {
        return res.json({ success: true, verified: false });
      }
      const handoff = await verifyDatabaseCode(email, "email", handoffToken, "email_handoff", { markProfileVerified: false }).catch(() => null);
      if (!handoff?.success) {
        return res.status(400).json({ success: false, error: handoff?.error || "Verification session expired. Sign in to continue." });
      }
      const session = await createDatabaseSession(databaseProfile.id);
      const user = databasePublicUser(databaseProfile);
      return res.json({
        success: true,
        verified: true,
        user,
        session,
        next: "account.html",
        source: "supabase"
      });
    }

    const db = loadDemoDb();
    const user = jsonUserByEmail(db, email);
    if (!user) return res.status(404).json({ success: false, error: "Account not found." });
    if (user.verification?.emailStatus !== "verified") {
      return res.json({ success: true, verified: false });
    }
    const handoff = verifyJsonCode(email, "email", handoffToken, "email_handoff", { markProfileVerified: false });
    if (!handoff.success) {
      return res.status(400).json({ success: false, error: handoff.error || "Verification session expired. Sign in to continue." });
    }
    const latestDb = loadDemoDb();
    const latestUser = jsonUserByEmail(latestDb, email);
    const session = createDemoSession(latestDb, latestUser.id);
    return res.json({
      success: true,
      verified: true,
      user: publicUser(latestUser),
      session,
      next: "account.html",
      source: "json"
    });
  } catch (err) {
    console.error("Email verification completion failed:", err);
    return res.status(500).json({ success: false, error: "Could not complete email verification." });
  }
});

app.post("/api/auth/sign-up", async (req, res) => {
  try {
    const body = parseJsonBody(req);
    if (!await verifyCaptcha(body, req)) {
      return res.status(400).json({
        success: false,
        error: "Complete the human verification."
      });
    }

    const signUp = parseSignUpPayload(body);
    let created = null;

    if (databaseConfigured()) {
      created = await createDatabaseAccount(signUp).catch((err) => {
        if (err.statusCode) throw err;
        console.error("Supabase sign up failed, using JSON fallback:", err);
        return null;
      });
    }

    if (!created) {
      created = createJsonAccount(signUp);
    }

    await markMarketingLeadConverted(signUp.email).catch((err) => {
      console.error("Marketing lead conversion tracking failed:", err.message || err);
    });

    const emailDelivery = await sendVerificationEmail(signUp.email, created.verificationDelivery?.emailToken || "", req)
      .catch((err) => {
        console.error("Verification email delivery failed:", err.message || err);
        return { delivered: false, provider: "error", error: err.message || "Email delivery failed" };
      });

    return res.status(201).json({
      success: true,
      user: created.user,
      next: `verify-email.html?email=${encodeURIComponent(signUp.email)}`,
      emailHandoffToken: created.verificationDelivery?.emailHandoffToken || "",
      verification: {
        email: "pending",
        phone: "not_required",
        identity: "pending",
        delivery: emailDelivery.delivered ? "Verification email sent." : "Verification link created. Delivery provider is not fully connected yet."
      },
      source: created.source || "json"
    });
  } catch (err) {
    console.error("Sign up error:", err);
    return res.status(err.statusCode || 500).json({
      success: false,
      error: err.statusCode ? err.message : "Sign up unavailable"
    });
  }
});

app.post("/api/auth/sign-in", async (req, res) => {
  try {
    const body = parseJsonBody(req);
    const email = normalizeEmail(body.email);
    const password = String(body.password || "");
    const rememberDevice = truthyFormValue(body.rememberDevice);
    const trustedDeviceToken = normalizeText(body.trustedDeviceToken);
    if (!await verifyCaptcha(body, req)) {
      return res.status(400).json({
        success: false,
        error: "Complete the human verification."
      });
    }
    const databaseSignIn = await signInFromDatabase(email, password, { createSession: false }).catch((err) => {
      console.error("Supabase sign in failed, using JSON fallback:", err);
      return null;
    });

    if (databaseSignIn) {
      const next = accountNextPage(databaseSignIn.user);
      if (next.startsWith("verify-email")) {
        return res.json({
          success: true,
          next,
          source: "supabase"
        });
      }
      if (await verifyDatabaseTrustedDevice(databaseSignIn.user.id, trustedDeviceToken)) {
        const session = await createDatabaseSession(databaseSignIn.user.id, REMEMBER_SESSION_HOURS);
        return res.json({
          success: true,
          user: databaseSignIn.user,
          session,
          next,
          source: "supabase",
          trustedDevice: true
        });
      }
      const authenticatorEnabled = await authenticatorEnabledForProfile(databaseSignIn.user.id).catch(() => false);
      const loginCode = await createDatabaseVerificationCode(email, "email", "sign_in", {
        codeMode: "numeric",
        ttlMs: LOGIN_EMAIL_CODE_TTL_MS
      });
      const delivery = await sendLoginCodeEmail(email, loginCode.code).catch((err) => {
        console.error("Login code delivery failed:", err.message || err);
        throw signUpError(502, "Could not send the sign-in code. Try again.");
      });
      return res.json({
        success: true,
        requiresEmailCode: true,
        authenticatorEnabled,
        next: `verify-login.html?email=${encodeURIComponent(email)}&remember=${rememberDevice ? "1" : "0"}&authenticator=${authenticatorEnabled ? "1" : "0"}`,
        delivery: delivery.delivered ? "Sign-in code sent." : "Sign-in code created. Email delivery provider is not fully connected yet.",
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

    const safeUser = publicUser(user);
    const next = accountNextPage(safeUser);
    if (next.startsWith("verify-email")) {
      return res.json({
        success: true,
        next,
        source: "json"
      });
    }
    if (verifyJsonTrustedDevice(db, user.id, trustedDeviceToken)) {
      const session = createDemoSession(db, user.id, REMEMBER_SESSION_HOURS);
      return res.json({
        success: true,
        user: safeUser,
        session,
        next,
        source: "json",
        trustedDevice: true
      });
    }
    const authenticatorEnabled = authenticatorEnabledForJsonUser(user);
    const loginCode = createJsonVerificationCode(email, "email", "sign_in", {
      codeMode: "numeric",
      ttlMs: LOGIN_EMAIL_CODE_TTL_MS
    });
    const delivery = await sendLoginCodeEmail(email, loginCode.code).catch((err) => {
      console.error("Login code delivery failed:", err.message || err);
      throw signUpError(502, "Could not send the sign-in code. Try again.");
    });
    return res.json({
      success: true,
      requiresEmailCode: true,
      authenticatorEnabled,
      next: `verify-login.html?email=${encodeURIComponent(email)}&remember=${rememberDevice ? "1" : "0"}&authenticator=${authenticatorEnabled ? "1" : "0"}`,
      delivery: delivery.delivered ? "Sign-in code sent." : "Sign-in code created. Email delivery provider is not fully connected yet.",
      source: "json"
    });
  } catch (err) {
    console.error("Sign in error:", err);
    return res.status(err.statusCode || 500).json({ success: false, error: err.statusCode ? err.message : "Sign in unavailable" });
  }
});

app.post("/api/auth/resend-login-code", async (req, res) => {
  try {
    const body = parseJsonBody(req);
    const email = normalizeEmail(body.email);
    if (!email) return res.status(400).json({ success: false, error: "Email is required." });

    const databaseProfile = await databaseProfileVerification(email).catch(() => null);
    if (databaseProfile) {
      if (databaseProfile.email_status !== "verified") {
        return res.status(403).json({ success: false, error: "Verify your email before signing in." });
      }
      const loginCode = await createDatabaseVerificationCode(email, "email", "sign_in", {
        codeMode: "numeric",
        ttlMs: LOGIN_EMAIL_CODE_TTL_MS
      });
      const delivery = await sendLoginCodeEmail(email, loginCode.code).catch((err) => {
        console.error("Login code resend failed:", err.message || err);
        throw signUpError(502, "Could not resend the sign-in code. Try again.");
      });
      return res.json({
        success: true,
        delivery: delivery.delivered ? "New sign-in code sent." : "New sign-in code created. Email delivery provider is not fully connected yet.",
        source: "supabase"
      });
    }

    const db = loadDemoDb();
    const user = jsonUserByEmail(db, email);
    if (!user) return res.status(404).json({ success: false, error: "Account not found." });
    if (user.verification?.emailStatus !== "verified") {
      return res.status(403).json({ success: false, error: "Verify your email before signing in." });
    }

    const loginCode = createJsonVerificationCode(email, "email", "sign_in", {
      codeMode: "numeric",
      ttlMs: LOGIN_EMAIL_CODE_TTL_MS
    });
    const delivery = await sendLoginCodeEmail(email, loginCode.code).catch((err) => {
      console.error("Login code resend failed:", err.message || err);
      throw signUpError(502, "Could not resend the sign-in code. Try again.");
    });
    return res.json({
      success: true,
      delivery: delivery.delivered ? "New sign-in code sent." : "New sign-in code created. Email delivery provider is not fully connected yet.",
      source: "json"
    });
  } catch (err) {
    console.error("Login code resend failed:", err);
    return res.status(err.statusCode || 500).json({ success: false, error: err.statusCode ? err.message : "Could not resend the sign-in code." });
  }
});

app.post("/api/auth/verify-login", async (req, res) => {
  try {
    const body = parseJsonBody(req);
    const email = normalizeEmail(body.email);
    const code = normalizeText(body.code).replace(/\s+/g, "");
    const method = normalizeText(body.method || "email").toLowerCase() === "authenticator" ? "authenticator" : "email";
    const rememberDevice = truthyFormValue(body.rememberDevice);
    const sessionHours = rememberDevice ? REMEMBER_SESSION_HOURS : SESSION_HOURS;
    if (!email || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ success: false, error: "Enter the 6-digit sign-in code." });
    }

    if (method === "authenticator") {
      const databaseTotp = await verifyDatabaseAuthenticatorLogin(email, code).catch((err) => {
        console.error("Database authenticator login failed:", err);
        return null;
      });
      if (databaseTotp?.success) {
        const user = databasePublicUser(databaseTotp.profile);
        const session = await createDatabaseSession(databaseTotp.profile.id, sessionHours);
        const trustedDevice = rememberDevice ? await createDatabaseTrustedDevice(databaseTotp.profile.id) : null;
        return res.json({
          success: true,
          user,
          session,
          trustedDevice,
          next: "account.html",
          source: "supabase"
        });
      }
      if (databaseTotp?.error) return res.status(400).json(databaseTotp);

      const db = loadDemoDb();
      const jsonTotp = verifyJsonAuthenticatorLogin(db, email, code);
      if (!jsonTotp.success) return res.status(400).json(jsonTotp);
      const session = createDemoSession(db, jsonTotp.user.id, sessionHours);
      const trustedDevice = rememberDevice ? createJsonTrustedDevice(db, jsonTotp.user.id) : null;
      return res.json({
        success: true,
        user: publicUser(jsonTotp.user),
        session,
        trustedDevice,
        next: "account.html",
        source: "json"
      });
    }

    const databaseResult = await verifyDatabaseCode(email, "email", code, "sign_in", { markProfileVerified: false }).catch(() => null);
    if (databaseResult?.success) {
      if (databaseResult.profile.email_status !== "verified") {
        return res.status(403).json({ success: false, error: "Verify your email before signing in." });
      }
      const user = databasePublicUser(databaseResult.profile);
      const session = await createDatabaseSession(databaseResult.profile.id, sessionHours);
      const trustedDevice = rememberDevice ? await createDatabaseTrustedDevice(databaseResult.profile.id) : null;
      return res.json({
        success: true,
        user,
        session,
        trustedDevice,
        next: "account.html",
        source: "supabase"
      });
    }
    if (databaseResult?.error) return res.status(400).json(databaseResult);

    const jsonResult = verifyJsonCode(email, "email", code, "sign_in", { markProfileVerified: false });
    if (!jsonResult.success) return res.status(400).json(jsonResult);
    if (jsonResult.user.verification?.emailStatus !== "verified") {
      return res.status(403).json({ success: false, error: "Verify your email before signing in." });
    }
    const db = loadDemoDb();
    const user = jsonUserByEmail(db, email);
    const session = createDemoSession(db, user.id, sessionHours);
    const trustedDevice = rememberDevice ? createJsonTrustedDevice(db, user.id) : null;
    return res.json({
      success: true,
      user: publicUser(user),
      session,
      trustedDevice,
      next: "account.html",
      source: "json"
    });
  } catch (err) {
    console.error("Login code verification failed:", err);
    return res.status(500).json({ success: false, error: "Could not verify the sign-in code." });
  }
});

app.post("/api/auth/password-reset/request", async (req, res) => {
  try {
    const body = parseJsonBody(req);
    const email = normalizeEmail(body.email);
    if (!email) return res.status(400).json({ success: false, error: "Enter the email address on your Autody account." });

    const databaseCode = databaseConfigured()
      ? await createDatabaseVerificationCode(email, "email", "password_reset", {
          ttlMs: LOGIN_EMAIL_CODE_TTL_MS
        }).catch(() => null)
      : null;
    const jsonCode = databaseCode
      ? null
      : createJsonVerificationCode(email, "email", "password_reset", {
          ttlMs: LOGIN_EMAIL_CODE_TTL_MS
        });
    const codeRecord = databaseCode || jsonCode;
    if (!codeRecord?.code) {
      return res.status(404).json({ success: false, error: "That email is not linked to an Autody account." });
    }

    const delivery = await sendPasswordResetEmail(email, codeRecord.code, req).catch((err) => {
      console.error("Password reset email delivery failed:", err.message || err);
      throw signUpError(502, "Could not send the password reset link. Try again.");
    });
    return res.json({
      success: true,
      delivery: delivery.delivered ? "Password reset link sent. Check your email to continue." : "Password reset link created. Email delivery is not fully connected yet."
    });
  } catch (err) {
    console.error("Password reset request error:", err);
    return res.status(err.statusCode || 500).json({ success: false, error: err.statusCode ? err.message : "Could not start password reset." });
  }
});

app.post("/api/auth/password-reset/confirm", async (req, res) => {
  try {
    const body = parseJsonBody(req);
    const email = normalizeEmail(body.email);
    const code = normalizeText(body.code).replace(/\s+/g, "");
    const newPassword = String(body.newPassword || "");
    const passwordMessage = passwordValidationMessage(newPassword);
    if (!email || !code) {
      return res.status(400).json({ success: false, error: "Password reset link is invalid or expired." });
    }
    if (passwordMessage) return res.status(400).json({ success: false, error: passwordMessage });

    const databaseResult = databaseConfigured()
      ? await verifyDatabaseCode(email, "email", code, "password_reset", { markProfileVerified: false, consumeCode: false }).catch(() => null)
      : null;
    if (databaseResult?.success) {
      const reusedPassword = await databaseAccountPasswordMatchesEmail(email, newPassword);
      if (reusedPassword) {
        return res.status(400).json({ success: false, error: "Choose a new password that is different from your current password." });
      }
      const consumed = await verifyDatabaseCode(email, "email", code, "password_reset", { markProfileVerified: false });
      if (!consumed?.success) {
        return res.status(400).json({ success: false, error: consumed?.error || "Password reset link is invalid or expired." });
      }
      const updated = await updateDatabaseAccountPasswordByEmail(email, newPassword);
      if (!updated) return res.status(404).json({ success: false, error: "Autody account was not found." });
      return res.json({ success: true });
    }

    const jsonResult = verifyJsonCode(email, "email", code, "password_reset", { markProfileVerified: false, consumeCode: false });
    if (!jsonResult?.success) {
      return res.status(400).json({ success: false, error: databaseResult?.error || jsonResult?.error || "Password reset code is invalid." });
    }
    if (jsonAccountPasswordMatchesEmail(email, newPassword)) {
      return res.status(400).json({ success: false, error: "Choose a new password that is different from your current password." });
    }
    const consumedJson = verifyJsonCode(email, "email", code, "password_reset", { markProfileVerified: false });
    if (!consumedJson?.success) {
      return res.status(400).json({ success: false, error: consumedJson?.error || "Password reset link is invalid or expired." });
    }
    const updated = updateJsonAccountPasswordByEmail(email, newPassword);
    if (!updated) return res.status(404).json({ success: false, error: "Autody account was not found." });
    return res.json({ success: true });
  } catch (err) {
    console.error("Password reset confirm error:", err);
    return res.status(err.statusCode || 500).json({ success: false, error: err.statusCode ? err.message : "Could not reset password." });
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
    const account = await getAuthenticatedAccount(req, "demo");
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
    const account = await getAuthenticatedAccount(req, "demo");
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
    const auth = await authenticatedAccountContext(req);
    const result = await placeDemoOrder(body, auth);
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
    const account = await getAuthenticatedAccount(req, "demo");
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
    const auth = await authenticatedAccountContext(req);
    const result = await addDemoWatchlistSymbol(body.symbol, auth);
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
    const auth = await authenticatedAccountContext(req);
    const result = await removeDemoWatchlistSymbol(symbol, auth);
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
    const account = await getAuthenticatedAccount(req, "live");
    const wallet = await buildLiveWalletSnapshot(account);
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

app.post("/api/account/deposits/address", async (req, res) => {
  try {
    const body = parseJsonBody(req);
    const auth = await authenticatedAccountContext(req);
    const deposit = await createLiveDepositRequest(auth, body);
    return res.json({
      success: true,
      deposit,
      treasury: {
        provider: deposit.provider,
        routeType: deposit.routeType,
        custodyConnected: Boolean(deposit.custodyConnected),
        uniqueAddress: Boolean(deposit.uniqueAddress),
        directTreasury: Boolean(deposit.directTreasury),
        sweepRequired: Boolean(deposit.sweepRequired),
        routeMode: deposit.routeMode || depositRouteMode()
      }
    });
  } catch (err) {
    console.error("Live deposit address error:", err);
    return sendDemoError(res, err, "Deposit route could not be created");
  }
});

app.post("/api/payments/stripe/webhook", async (req, res) => {
  try {
    if (!databaseConfigured()) {
      throw demoTradeError(503, "Database is required before payment settlement can run.");
    }
    const event = verifyStripeWebhookPayload(req);
    const result = await handleStripeFundingWebhook(event);
    return res.json({
      received: true,
      success: true,
      result
    });
  } catch (err) {
    console.error("Stripe funding webhook error:", err);
    return sendDemoError(res, err, "Payment webhook could not be processed");
  }
});

app.post("/api/account/funding/request", async (req, res) => {
  try {
    const body = parseJsonBody(req);
    const auth = await authenticatedAccountContext(req);
    let request = await createLiveFiatFundingRequest(auth, body);
    const processor = await prepareFiatPaymentProcessor(auth, request);
    request = await updateFiatFundingProcessor(auth, request, processor);
    return res.json({
      success: true,
      request,
      provider: processor.provider,
      providerConfigured: Boolean(processor.configured),
      checkoutUrl: processor.checkoutUrl || "",
      nextStep: processor.checkoutUrl
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
    await sendSupportTicketConfirmationEmail(ticket).catch((err) => {
      console.error("Support confirmation email failed:", err.message || err);
    });
    return res.json({
      success: true,
      ticket
    });
  } catch (err) {
    console.error("Support ticket error:", err);
    return sendDemoError(res, err, "Support ticket could not be submitted");
  }
});

app.post("/api/marketing/leads", async (req, res) => {
  try {
    const body = parseJsonBody(req);
    const lead = await createMarketingLead(body);
    const delivery = await sendMarketLeadWelcomeEmail(lead, req).catch((err) => {
      console.error("Market lead welcome email failed:", err.message || err);
      return { delivered: false, provider: "error" };
    });
    return res.status(201).json({
      success: true,
      leadId: lead.id,
      next: `/sign-up?lead=${encodeURIComponent(lead.id)}`,
      delivery: delivery.delivered ? "sent" : "pending"
    });
  } catch (err) {
    console.error("Marketing lead capture error:", err);
    return sendDemoError(res, err, "Market briefing request could not be saved");
  }
});

app.post("/api/public/support/tickets", async (req, res) => {
  try {
    const body = parseJsonBody(req);
    const ticket = await createSupportTicket({ source: "public", profileId: null, userId: null, user: null }, body);
    await sendSupportTicketConfirmationEmail(ticket).catch((err) => {
      console.error("Public support confirmation email failed:", err.message || err);
    });
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



app.get(["/research", "/research.html"], (req, res) => {
  res.redirect(301, "/");
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

