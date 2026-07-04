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
const DEPOSIT_MONITOR_INTERVAL_MS = Number(process.env.DEPOSIT_MONITOR_INTERVAL_MS || 60 * 1000);
const DEPOSIT_MONITOR_ADDRESS_LIMIT = Number(process.env.DEPOSIT_MONITOR_ADDRESS_LIMIT || 80);
const DEPOSIT_MIN_CONFIRMATIONS = Math.max(1, Number(process.env.DEPOSIT_MIN_CONFIRMATIONS || 3));
const DEPOSIT_EVM_LOG_LOOKBACK_BLOCKS = Number(process.env.DEPOSIT_EVM_LOG_LOOKBACK_BLOCKS || 5000);
const DEPOSIT_EVM_SCAN_OVERLAP_BLOCKS = Number(process.env.DEPOSIT_EVM_SCAN_OVERLAP_BLOCKS || 250);
const DEPOSIT_NATIVE_LOOKBACK_BLOCKS = Number(process.env.DEPOSIT_NATIVE_LOOKBACK_BLOCKS || 120);
const DEPOSIT_NATIVE_BLOCK_SCAN_LIMIT = Number(process.env.DEPOSIT_NATIVE_BLOCK_SCAN_LIMIT || 40);
const DEPOSIT_ACCOUNT_TX_LIMIT = Number(process.env.DEPOSIT_ACCOUNT_TX_LIMIT || 30);
const DEPOSIT_REST_TIMEOUT_MS = Number(process.env.DEPOSIT_REST_TIMEOUT_MS || 12 * 1000);
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
            from: EMAIL_FROM,
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
            from: EMAIL_FROM,
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
            from: EMAIL_FROM,
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
            from: EMAIL_FROM,
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
            from: EMAIL_FROM,
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
    const normalized = String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, "_");
    const allowed = new Set([
        "invalid_document",
        "invalid_id",
        "inadequate_selfie",
        "document_selfie_mismatch",
        "expired_document",
        "unclear_document",
        "unsupported_document",
        "other"
    ]);
    return allowed.has(normalized) ? normalized : "other";
}

async function sendKycSubmittedEmail(email, displayName = "") {
    if (!email) return { delivered: false, provider: "none", skipped: true };
    const name = normalizeText(displayName) || titleFromEmail(email) || "there";
    const safeName = emailHtmlEscape(name);
    const subject = "Autody received your identity review";
    const text = `Hi ${name},\n\nWe received your identity document and face scan.\n\nReviews usually take 2-3 business days. You do not need to upload anything else unless Autody asks for a clearer document.\n\nWe will email you when your identity review is approved or if it needs another upload.\n\nThe Autody Team`;
    const html = `
        <div style="font-family:Arial,sans-serif;line-height:1.55;color:#111827">
          <div style="font-size:13px;letter-spacing:3px;text-transform:uppercase;color:#5b5cf6;font-weight:800">Autody identity review</div>
          <h1 style="margin:16px 0 10px;font-size:28px;line-height:1.2">Documents received</h1>
          <p>Hi ${safeName},</p>
          <p>We received your identity document and face scan.</p>
          <div style="margin:18px 0;padding:16px;border-radius:12px;background:#f4f6ff;border:1px solid #d7ddf3">
            <strong>Review time</strong><br>
            Reviews usually take 2-3 business days. You do not need to upload anything else unless Autody asks for a clearer document.
          </div>
          <p>We will email you when your identity review is approved or if it needs another upload.</p>
          <p>The Autody Team</p>
        </div>
    `;

    if (!RESEND_API_KEY) {
        console.log("Autody KYC received email for", email);
        return { delivered: false, provider: "console" };
    }

    const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${RESEND_API_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ from: EMAIL_FROM, to: email, subject, html, text })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result?.message || "KYC received email delivery failed.");
    return { delivered: true, provider: "resend" };
}

async function sendKycDecisionEmail(email, options = {}) {
    if (!email) return { delivered: false, provider: "none", skipped: true };
    const status = normalizeText(options.status).toLowerCase();
    if (!["approved", "rejected"].includes(status)) return { delivered: false, provider: "none", skipped: true };
    const name = normalizeText(options.displayName) || titleFromEmail(email) || "there";
    const safeName = emailHtmlEscape(name);
    const reason = kycRejectionReasonLabel(options.reviewReason);
    const note = normalizeText(options.reviewNote);
    const displayNote = note && note !== reason ? note : "";
    const safeReason = emailHtmlEscape(reason);
    const safeNote = emailHtmlEscape(displayNote);
    const approved = status === "approved";
    const subject = approved ? "Autody identity review approved" : "Autody identity review needs attention";
    const text = approved
        ? `Hi ${name},\n\nYour Autody identity review has been approved.\n\nHigher limits, withdrawals, and larger funding actions can be enabled as the platform expands.\n\nThe Autody Team`
        : `Hi ${name},\n\nYour Autody identity review could not be approved yet.\n\nReason: ${reason}${displayNote ? `\nNote: ${displayNote}` : ""}\n\nOpen Verify Identity in your profile and upload a clearer document and fresh face scan.\n\nThe Autody Team`;
    const html = approved ? `
        <div style="font-family:Arial,sans-serif;line-height:1.55;color:#111827">
          <div style="font-size:13px;letter-spacing:3px;text-transform:uppercase;color:#16a34a;font-weight:800">Autody identity review</div>
          <h1 style="margin:16px 0 10px;font-size:28px;line-height:1.2">Identity verified</h1>
          <p>Hi ${safeName},</p>
          <p>Your Autody identity review has been approved.</p>
          <p>Higher limits, withdrawals, and larger funding actions can be enabled as the platform expands.</p>
          <p>The Autody Team</p>
        </div>
    ` : `
        <div style="font-family:Arial,sans-serif;line-height:1.55;color:#111827">
          <div style="font-size:13px;letter-spacing:3px;text-transform:uppercase;color:#ef4444;font-weight:800">Autody identity review</div>
          <h1 style="margin:16px 0 10px;font-size:28px;line-height:1.2">Another upload is needed</h1>
          <p>Hi ${safeName},</p>
          <p>Your Autody identity review could not be approved yet.</p>
          <div style="margin:18px 0;padding:16px;border-radius:12px;background:#fff1f2;border:1px solid #fecdd3">
            <strong>Reason</strong><br>
            ${safeReason}${safeNote ? `<br><span style="color:#4b5563">${safeNote}</span>` : ""}
          </div>
          <p>Open Verify Identity in your profile and upload a clearer document and fresh face scan.</p>
          <p>The Autody Team</p>
        </div>
    `;

    if (!RESEND_API_KEY) {
        console.log("Autody KYC decision email for", email, status, reason);
        return { delivered: false, provider: "console" };
    }

    const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${RESEND_API_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ from: EMAIL_FROM, to: email, subject, html, text })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result?.message || "KYC decision email delivery failed.");
    return { delivered: true, provider: "resend" };
}

function createDemoSession(db, userId, sessionHours = SESSION_HOURS) {
    const token = crypto.randomBytes(32).toString("hex");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 1000 * 60 * 60 * sessionHours);
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

async function ensureSignUpSchemaReady() {
    if (!databaseConfigured()) return;

    if (!signUpSchemaReadyPromise) {
        signUpSchemaReadyPromise = ensureSignUpTables().catch((err) => {
            signUpSchemaReadyPromise = null;
            throw err;
        });
    }

    await signUpSchemaReadyPromise;
}

function kycStorageConfigured() {
    return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY && KYC_STORAGE_BUCKET);
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
        await ensureSignUpSchemaReady();
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
    if (String(asset.symbol || "").toUpperCase() === "AU") return "Autody-Logo.png";
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
    await ensureSignUpSchemaReady();

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
            select default_mode, currency, risk_level, order_confirmation, market_alerts, news_alerts,
                   deposit_alerts, withdrawal_alerts, price_alerts, research_brief
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
            orderConfirmation: settingsRow.order_confirmation ?? false,
            marketAlerts: settingsRow.market_alerts ?? false,
            newsAlerts: settingsRow.news_alerts ?? false,
            depositAlerts: settingsRow.deposit_alerts ?? false,
            withdrawalAlerts: settingsRow.withdrawal_alerts ?? false,
            priceAlerts: settingsRow.price_alerts ?? false,
            researchBrief: settingsRow.research_brief ?? false
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

async function getDatabaseAccountByProfileId(profileId, mode = "live") {
    if (!databaseConfigured() || !profileId) return null;
    await ensureSignUpSchemaReady();

    const accountMode = normalizeWatchlistMode(mode);

    let accountResult = await dbPool.query(`
        select
            p.id as profile_id,
            p.email,
            p.display_name,
            p.created_at,
            pv.first_name,
            pv.last_name,
            pv.legal_name,
            pv.phone,
            pv.country,
            pv.date_of_birth,
            pv.account_type,
            pv.email_status,
            pv.phone_status,
            pv.identity_status,
            pv.terms_version,
            pv.terms_accepted_at,
            pv.information_confirmed_at,
            am.id as account_mode_id,
            w.id as wallet_id,
            w.currency,
            w.cash_balance,
            w.reserved_cash,
            w.starting_balance
        from profiles p
        join account_modes am on am.profile_id = p.id and am.mode = $2
        join wallets w on w.account_mode_id = am.id
        left join profile_verifications pv on pv.profile_id = p.id
        where p.id = $1
        limit 1
    `, [profileId, accountMode]);

    if (!accountResult.rows[0]) {
        await seedAccountWallet(dbPool, profileId, accountMode, accountMode === "demo" ? 50000 : 0);
        accountResult = await dbPool.query(`
            select
                p.id as profile_id,
                p.email,
                p.display_name,
                p.created_at,
                pv.first_name,
                pv.last_name,
                pv.legal_name,
                pv.phone,
                pv.country,
                pv.date_of_birth,
                pv.account_type,
                pv.email_status,
                pv.phone_status,
                pv.identity_status,
                pv.terms_version,
                pv.terms_accepted_at,
                pv.information_confirmed_at,
                am.id as account_mode_id,
                w.id as wallet_id,
                w.currency,
                w.cash_balance,
                w.reserved_cash,
                w.starting_balance
            from profiles p
            join account_modes am on am.profile_id = p.id and am.mode = $2
            join wallets w on w.account_mode_id = am.id
            left join profile_verifications pv on pv.profile_id = p.id
            where p.id = $1
            limit 1
        `, [profileId, accountMode]);
    }

    const row = accountResult.rows[0];
    if (!row) return null;

    const [holdingsResult, ordersResult, watchlistResult, researchResult, performanceResult, settingsResult, latestKycResult] = await Promise.all([
        dbPool.query(`
            select symbol, asset_name, asset_type, quantity, average_cost, last_price, value_usd, updated_at
            from holdings
            where wallet_id = $1
            order by case symbol when 'USD' then 0 when 'AU' then 1 when 'CRYPTO' then 2 when 'STOCKS' then 3 when 'ETFS' then 4 when 'OILMETALS' then 5 else 6 end, symbol
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
              and mode = $2
            order by created_at asc
        `, [row.profile_id, accountMode]),
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
            select default_mode, currency, risk_level, order_confirmation, market_alerts, news_alerts,
                   deposit_alerts, withdrawal_alerts, price_alerts, research_brief
            from account_settings
            where profile_id = $1
            limit 1
        `, [row.profile_id]),
        dbPool.query(`
            select status, review_reason, review_note, reviewer, created_at, updated_at, reviewed_at
            from kyc_submissions
            where profile_id = $1
            order by created_at desc
            limit 1
        `, [row.profile_id]).catch(() => ({ rows: [] }))
    ]);

    const holdings = holdingsResult.rows.map(mapDbHolding);
    const cashHolding = holdings.find((holding) => holding.symbol === "USD");
    const cashBalance = numberValue(row.cash_balance, cashHolding?.balance || 0);
    const cash = {
        symbol: "USD",
        name: accountMode === "demo" ? "USD Cash" : "USD Funds",
        balance: cashBalance,
        valueUsd: cashBalance,
        status: accountMode === "demo" ? "Available" : cashBalance > 0 ? "Available" : "Awaiting deposit"
    };
    const nonCashHoldings = holdings.filter((holding) => holding.symbol !== "USD");
    const performanceRow = performanceResult.rows[0] || {};
    const settingsRow = settingsResult.rows[0] || {};
    const latestKycRow = latestKycResult.rows[0] || {};
    const startingBalance = numberValue(row.starting_balance, accountMode === "demo" ? 50000 : 0);
    const portfolioFallback = cashBalance + nonCashHoldings.reduce((sum, holding) => sum + numberValue(holding.valueUsd, 0), 0);
    const nameParts = profileNamePartsFromRow(row);

    return {
        user: {
            id: row.profile_id,
            name: row.display_name,
            email: row.email,
            mode: accountMode === "demo" ? "paper" : "live",
            currency: row.currency || "USD",
            startingBalance,
            cashBalance,
            reservedCash: numberValue(row.reserved_cash, 0),
            createdAt: row.created_at,
            profile: {
                firstName: nameParts.firstName,
                lastName: nameParts.lastName,
                legalName: nameParts.legalName,
                phone: publicProfilePhone(row),
                country: publicProfileCountry(row),
                dateOfBirth: publicProfileDateOfBirth(row),
                accountType: row.account_type || "personal",
                termsVersion: row.terms_version || "",
                termsAcceptedAt: row.terms_accepted_at || "",
                informationConfirmedAt: row.information_confirmed_at || ""
            },
            verification: {
                email: row.email_status || "pending",
                phone: row.phone_status || "pending",
                identity: row.identity_status || "pending",
                reviewStatus: latestKycRow.status || "",
                reviewReason: latestKycRow.review_reason || "",
                reviewNote: latestKycRow.review_note || "",
                reviewer: latestKycRow.reviewer || "",
                submittedAt: latestKycRow.created_at || "",
                reviewedAt: latestKycRow.reviewed_at || ""
            }
        },
        wallet: { cash, holdings: nonCashHoldings },
        orders: ordersResult.rows,
        watchlist: reduceWatchlistRows(watchlistResult.rows),
        researchPreferences: researchResult.rows.map((item) => item.topic),
        performance: {
            portfolioValue: numberValue(performanceRow.portfolio_value, portfolioFallback),
            startingBalance,
            unrealizedProfitLoss: numberValue(performanceRow.unrealized_profit_loss, 0),
            realizedProfitLoss: numberValue(performanceRow.realized_profit_loss, 0),
            todayProfitLoss: numberValue(performanceRow.today_profit_loss, 0),
            todayProfitLossPct: numberValue(performanceRow.today_profit_loss_pct, 0),
            winRatePct: numberValue(performanceRow.win_rate_pct, 0),
            tradesPlaced: numberValue(performanceRow.trades_placed, 0)
        },
        settings: {
            defaultMode: settingsRow.default_mode || accountMode,
            currency: settingsRow.currency || "USD",
            riskLevel: settingsRow.risk_level || (accountMode === "demo" ? "practice" : "standard"),
            orderConfirmation: settingsRow.order_confirmation ?? false,
            marketAlerts: settingsRow.market_alerts ?? false,
            newsAlerts: settingsRow.news_alerts ?? false,
            depositAlerts: settingsRow.deposit_alerts ?? false,
            withdrawalAlerts: settingsRow.withdrawal_alerts ?? false,
            priceAlerts: settingsRow.price_alerts ?? false,
            researchBrief: settingsRow.research_brief ?? false
        },
        source: "supabase"
    };
}

function getJsonAccountByUserId(userId, mode = "live") {
    const db = loadDemoDb();
    const user = (db.users || []).find((item) => item.id === userId);
    if (!user) return null;
    const wallet = db.wallets?.[userId] || {};
    const liveCash = wallet.liveCash || {
        symbol: "USD",
        name: "USD Funds",
        balance: 0,
        valueUsd: 0,
        status: "Awaiting deposit"
    };
    const accountMode = normalizeWatchlistMode(mode);
    const cash = accountMode === "live" ? liveCash : wallet.cash;
    return {
        user: {
            ...user,
            mode: accountMode === "live" ? "live" : "paper",
            startingBalance: accountMode === "live" ? 0 : numberValue(user.startingBalance, 50000),
            cashBalance: numberValue(cash?.balance, 0),
            reservedCash: numberValue(user.reservedCash, 0)
        },
        wallet: {
            cash,
            holdings: wallet.holdings || []
        },
        orders: db.orders?.[userId] || [],
        watchlist: jsonWatchlistForMode(db, accountMode, userId),
        researchPreferences: db.researchPreferences?.[userId] || [],
        performance: db.performance?.[userId] || {},
        settings: db.settings?.[userId] || {},
        source: "json"
    };
}

async function getAuthenticatedAccount(req, mode = "live") {
    const auth = await authenticatedAccountContext(req);
    if (auth.source === "supabase") {
        const account = await getDatabaseAccountByProfileId(auth.profileId, mode);
        if (account) return account;
    }
    const account = getJsonAccountByUserId(auth.userId, mode);
    if (!account) throw demoTradeError(401, "Sign in again to open this account data.");
    return account;
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

const LIVE_WALLET_GROUP_SYMBOLS = new Set(["USD", "AU", "CRYPTO", "STOCKS", "ETFS", "OILMETALS"]);

function buildLiveWalletRecords(account) {
    const orderRecords = (account.orders || []).map(walletRecordFromOrder);
    const createdAt = account?.user?.createdAt || null;
    const setupRecord = {
        type: "setup",
        title: "Live account opened",
        symbol: "LIVE",
        assetType: "account",
        valueUsd: 0,
        status: "awaiting funding",
        createdAt
    };

    return [setupRecord, ...orderRecords]
        .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0))
        .slice(0, 10);
}

async function buildLiveWalletSnapshot(account) {
    const baseCash = account.wallet?.cash || walletDefaultHolding("USD", "USD Funds", "cash", "Awaiting deposit");
    const rawHoldings = account.wallet?.holdings || [];
    const holdingsBySymbol = new Map(rawHoldings.map((holding) => [String(holding.symbol || "").toUpperCase(), holding]));
    const symbolsForMarket = [...holdingsBySymbol.keys()]
        .filter((symbol) => symbol !== "AU" && !LIVE_WALLET_GROUP_SYMBOLS.has(symbol));
    const marketAssets = symbolsForMarket.length
        ? (await Promise.all(symbolsForMarket.map((symbol) => findMarketAssetBySymbol(symbol).catch(() => null)))).filter(Boolean)
        : [];
    const marketMap = new Map(marketAssets.map((asset) => [String(asset.symbol || "").toUpperCase(), asset]));

    const cash = {
        ...baseCash,
        symbol: "USD",
        name: "USD Funds",
        category: "cash",
        assetType: "cash",
        balance: numberValue(account.user?.cashBalance, baseCash.balance),
        valueUsd: numberValue(account.user?.cashBalance, baseCash.valueUsd),
        price: 1,
        changePct: null,
        url: liveWalletHoldingUrl({ symbol: "USD" }),
        status: numberValue(account.user?.cashBalance, baseCash.valueUsd) > 0 ? "Available" : "Awaiting deposit",
        detail: "Verified funds"
    };

    const enrichHolding = (holding) => {
        const symbol = String(holding.symbol || "").toUpperCase();
        const marketAsset = marketMap.get(symbol);
        const category = holding.category || marketAsset?.assetType || (symbol === "AU" ? "currency" : "market");
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
            name: holding.name || marketAsset?.name || LIVE_DEPOSIT_ASSETS[symbol]?.name || symbol,
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
            url: liveWalletHoldingUrl({ symbol }),
            status: balance > 0 ? "Held" : symbol === "AU" ? "Not held" : "Ready",
            detail: balance > 0 ? "Verified live holding" : holding.detail || "Available after deposit",
            updatedAt: holding.updatedAt || marketAsset?.capturedAt || null
        };
    };

    const au = enrichHolding(holdingsBySymbol.get("AU") || walletDefaultHolding("AU", "Autody AU", "currency", "Not held"));
    const rawPositionHoldings = rawHoldings.filter((holding) => {
        const symbol = String(holding.symbol || "").toUpperCase();
        return !LIVE_WALLET_GROUP_SYMBOLS.has(symbol);
    });
    const positions = rawPositionHoldings.map(enrichHolding).filter((holding) => holding.balance > 0 || holding.valueUsd > 0);
    const cryptoPositions = positions.filter((holding) => ["crypto", "currency", "stablecoin"].includes(String(holding.category || "").toLowerCase()));
    const stockPositions = positions.filter((holding) => ["stock", "stocks"].includes(String(holding.category || "").toLowerCase()));
    const etfPositions = positions.filter((holding) => String(holding.category || "").toLowerCase() === "etf");
    const commodityPositions = positions.filter((holding) => String(holding.category || "").toLowerCase() === "commodity");
    const cryptoValue = cryptoPositions.reduce((sum, holding) => sum + numberValue(holding.valueUsd, 0), 0);
    const stockValue = stockPositions.reduce((sum, holding) => sum + numberValue(holding.valueUsd, 0), 0);
    const etfValue = etfPositions.reduce((sum, holding) => sum + numberValue(holding.valueUsd, 0), 0);
    const commodityValue = commodityPositions.reduce((sum, holding) => sum + numberValue(holding.valueUsd, 0), 0);
    const auValue = numberValue(au.valueUsd, 0);
    const totalValue = cash.valueUsd + auValue + cryptoValue + stockValue + etfValue + commodityValue;
    const investedValue = auValue + cryptoValue + stockValue + etfValue + commodityValue;
    const groupHolding = (symbol, name, category, balance, valueUsd, detail) => ({
        ...walletDefaultHolding(symbol, name, category),
        assetType: category,
        balance,
        valueUsd,
        url: liveWalletHoldingUrl({ symbol }),
        status: balance ? "Tracking" : "Ready",
        detail
    });

    return {
        currency: account.user?.currency || "USD",
        startingBalance: account.user?.startingBalance || 0,
        cashBalance: cash.valueUsd,
        reservedCash: account.user?.reservedCash || 0,
        totalValue,
        investedValue,
        positionsCount: positions.length + (au.balance > 0 ? 1 : 0),
        pendingTransfers: 0,
        groups: {
            cashValue: cash.valueUsd,
            auValue,
            cryptoValue,
            stockValue,
            etfValue,
            commodityValue
        },
        holdings: [
            cash,
            au,
            groupHolding("CRYPTO", "Crypto", "crypto", cryptoPositions.length, cryptoValue, "Deposit-ready digital assets"),
            groupHolding("STOCKS", "Stocks", "stock", stockPositions.length, stockValue, "Company shares"),
            groupHolding("ETFS", "ETFs", "etf", etfPositions.length, etfValue, "Funds and baskets"),
            groupHolding("OILMETALS", "Oil and metals", "commodity", commodityPositions.length, commodityValue, "Commodity instruments"),
            ...positions
        ],
        records: buildLiveWalletRecords(account)
    };
}

function demoTradeError(status, message) {
    const err = new Error(message);
    err.status = status;
    return err;
}

const LIVE_DEPOSIT_ASSETS = {
    AU: { name: "Autody AU", networks: ["Autody"] },
    BTC: { name: "Bitcoin", networks: ["Bitcoin"] },
    ETH: { name: "Ethereum", networks: ["Ethereum ERC-20", "Base", "Arbitrum One", "Optimism"] },
    USDT: { name: "Tether USDt", networks: ["Ethereum ERC-20", "BNB Smart Chain BEP-20", "Polygon PoS", "Arbitrum One", "Optimism", "Avalanche C-Chain", "Tron TRC-20"] },
    USDC: { name: "USD Coin", networks: ["Ethereum ERC-20", "Base", "Polygon PoS", "Arbitrum One", "Optimism", "Avalanche C-Chain"] },
    SOL: { name: "Solana", networks: ["Solana"] },
    XRP: { name: "XRP", networks: ["XRP Ledger"] },
    BNB: { name: "BNB", networks: ["BNB Smart Chain BEP-20"] },
    DOGE: { name: "Dogecoin", networks: ["Dogecoin"] },
    LTC: { name: "Litecoin", networks: ["Litecoin"] },
    BCH: { name: "Bitcoin Cash", networks: ["Bitcoin Cash"] },
    XLM: { name: "Stellar", networks: ["Stellar"] },
    TRX: { name: "TRON", networks: ["Tron TRC-20"] },
    AVAX: { name: "Avalanche", networks: ["Avalanche C-Chain"] },
    LINK: { name: "Chainlink", networks: ["Ethereum ERC-20", "Polygon PoS", "Arbitrum One"] },
    POL: { name: "Polygon", networks: ["Polygon PoS", "Ethereum ERC-20"] },
    UNI: { name: "Uniswap", networks: ["Ethereum ERC-20", "Polygon PoS", "Arbitrum One"] },
    AAVE: { name: "Aave", networks: ["Ethereum ERC-20", "Polygon PoS", "Arbitrum One"] },
    ARB: { name: "Arbitrum", networks: ["Arbitrum One"] },
    OP: { name: "Optimism", networks: ["Optimism"] },
    SHIB: { name: "Shiba Inu", networks: ["Ethereum ERC-20"] },
    FET: { name: "Artificial Superintelligence Alliance", networks: ["Ethereum ERC-20"] },
    RENDER: { name: "Render", networks: ["Ethereum ERC-20"] },
    PEPE: { name: "Pepe", networks: ["Ethereum ERC-20"] },
    DAI: { name: "Dai", networks: ["Ethereum ERC-20", "Polygon PoS", "Arbitrum One", "Optimism"] },
    PYUSD: { name: "PayPal USD", networks: ["Ethereum ERC-20"] },
    FDUSD: { name: "First Digital USD", networks: ["Ethereum ERC-20", "BNB Smart Chain BEP-20"] },
    TUSD: { name: "TrueUSD", networks: ["Ethereum ERC-20", "BNB Smart Chain BEP-20"] },
    MKR: { name: "Maker", networks: ["Ethereum ERC-20"] },
    LDO: { name: "Lido DAO", networks: ["Ethereum ERC-20", "Arbitrum One"] },
    QNT: { name: "Quant", networks: ["Ethereum ERC-20"] },
    GRT: { name: "The Graph", networks: ["Ethereum ERC-20", "Arbitrum One"] },
    CRV: { name: "Curve DAO", networks: ["Ethereum ERC-20", "Arbitrum One"] },
    MANA: { name: "Decentraland", networks: ["Ethereum ERC-20", "Polygon PoS"] }
};

const EVM_DEPOSIT_NETWORK_CONFIGS = {
    "Ethereum ERC-20": {
        scannerKey: "ethereum",
        nativeAssets: ["ETH"],
        rpcEnv: ["AUTODY_ETHEREUM_RPC_URL", "ETHEREUM_RPC_URL", "ETH_RPC_URL"],
        publicRpcUrl: "https://ethereum-rpc.publicnode.com"
    },
    Base: {
        scannerKey: "base",
        nativeAssets: ["ETH"],
        rpcEnv: ["AUTODY_BASE_RPC_URL", "BASE_RPC_URL"],
        publicRpcUrl: "https://base-rpc.publicnode.com"
    },
    "Arbitrum One": {
        scannerKey: "arbitrum",
        nativeAssets: ["ETH"],
        rpcEnv: ["AUTODY_ARBITRUM_RPC_URL", "ARBITRUM_RPC_URL"],
        publicRpcUrl: "https://arbitrum-one-rpc.publicnode.com"
    },
    Optimism: {
        scannerKey: "optimism",
        nativeAssets: ["ETH"],
        rpcEnv: ["AUTODY_OPTIMISM_RPC_URL", "OPTIMISM_RPC_URL"],
        publicRpcUrl: "https://optimism-rpc.publicnode.com"
    },
    "BNB Smart Chain BEP-20": {
        scannerKey: "bsc",
        nativeAssets: ["BNB"],
        rpcEnv: ["AUTODY_BSC_RPC_URL", "BSC_RPC_URL", "BNB_RPC_URL"],
        publicRpcUrl: "https://bsc-rpc.publicnode.com"
    },
    "Polygon PoS": {
        scannerKey: "polygon",
        nativeAssets: ["POL"],
        rpcEnv: ["AUTODY_POLYGON_RPC_URL", "POLYGON_RPC_URL", "POLYGON_RPC"],
        publicRpcUrl: "https://polygon-bor-rpc.publicnode.com",
        blockscoutApiUrl: "https://polygon.blockscout.com/api/v2"
    },
    "Avalanche C-Chain": {
        scannerKey: "avalanche",
        nativeAssets: ["AVAX"],
        rpcEnv: ["AUTODY_AVALANCHE_RPC_URL", "AVALANCHE_RPC_URL"],
        publicRpcUrl: "https://avalanche-c-chain-rpc.publicnode.com"
    }
};

const EVM_TOKEN_DEPOSIT_CONTRACTS = {
    USDT: {
        "Ethereum ERC-20": { address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6 },
        "BNB Smart Chain BEP-20": { address: "0x55d398326f99059fF775485246999027B3197955", decimals: 18 },
        "Polygon PoS": { address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", decimals: 6 },
        "Arbitrum One": { address: "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9", decimals: 6 },
        Optimism: { address: "0x94b008aa00579c1307B0eF2c499AD98a8ce58e58", decimals: 6 },
        "Avalanche C-Chain": { address: "0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7", decimals: 6 }
    },
    USDC: {
        "Ethereum ERC-20": { address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 },
        Base: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
        "Polygon PoS": { address: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174", decimals: 6 },
        "Arbitrum One": { address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6 },
        Optimism: { address: "0x0b2c639c533813f4aa9d7837caf62653d097ff85", decimals: 6 },
        "Avalanche C-Chain": { address: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", decimals: 6 }
    },
    LINK: {
        "Ethereum ERC-20": { address: "0x514910771AF9Ca656af840dff83E8264EcF986CA", decimals: 18 },
        "Polygon PoS": { address: "0x53E0bca35eC356BD5ddDFEBbd1Fc0fD03Fabad39", decimals: 18 },
        "Arbitrum One": { address: "0xf97f4df75117a78c1A5a0DBb814Af92458539FB4", decimals: 18 }
    },
    UNI: {
        "Ethereum ERC-20": { address: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984", decimals: 18 },
        "Polygon PoS": { address: "0xb33EaAd8d922B1083446DC23f610c2567fB5180f", decimals: 18 },
        "Arbitrum One": { address: "0xfa7f8980b0f1e64a2062791cc3b0871572f1f7f0", decimals: 18 }
    },
    AAVE: {
        "Ethereum ERC-20": { address: "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9", decimals: 18 },
        "Polygon PoS": { address: "0xD6DF932A45C0f255f85145f286ea0b292B21C90B", decimals: 18 },
        "Arbitrum One": { address: "0xba5DdD1f9d7F570dc94a51479a000E3BCE967196", decimals: 18 }
    },
    ARB: { "Arbitrum One": { address: "0x912CE59144191C1204E64559FE8253a0e49E6548", decimals: 18 } },
    OP: { Optimism: { address: "0x4200000000000000000000000000000000000042", decimals: 18 } },
    SHIB: { "Ethereum ERC-20": { address: "0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE", decimals: 18 } },
    FET: { "Ethereum ERC-20": { address: "0xaea46A60368A7bD060eec7DF8CBa43b7EF41Ad85", decimals: 18 } },
    RENDER: { "Ethereum ERC-20": { address: "0x6De037ef9aD2725EB40118Bb1702EBb27e4Aeb24", decimals: 18 } },
    PEPE: { "Ethereum ERC-20": { address: "0x6982508145454Ce325dDbE47a25d4ec3d2311933", decimals: 18 } },
    DAI: {
        "Ethereum ERC-20": { address: "0x6B175474E89094C44Da98b954EedeAC495271d0F", decimals: 18 },
        "Polygon PoS": { address: "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063", decimals: 18 },
        "Arbitrum One": { address: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1", decimals: 18 },
        Optimism: { address: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1", decimals: 18 }
    },
    PYUSD: { "Ethereum ERC-20": { address: "0x6c3ea9036406852006290770BEdFcAbA0e23A0e8", decimals: 6 } },
    FDUSD: {
        "Ethereum ERC-20": { address: "0xc5f0f7b66764f6ec8c8dff7ba683102295e16409", decimals: 18 },
        "BNB Smart Chain BEP-20": { address: "0xc5f0f7b66764f6ec8c8dff7ba683102295e16409", decimals: 18 }
    },
    TUSD: {
        "Ethereum ERC-20": { address: "0x0000000000085d4780B73119b644AE5ecd22b376", decimals: 18 },
        "BNB Smart Chain BEP-20": { address: "0x14016E85a25aeb13065688cAFB43044C2ef86784", decimals: 18 }
    },
    MKR: { "Ethereum ERC-20": { address: "0x9f8F72aA9304c8B593d555F12ef6589cC3A579A2", decimals: 18 } },
    LDO: {
        "Ethereum ERC-20": { address: "0x5A98FcBEA516Cf06857215779Fd812CA3beF1B32", decimals: 18 },
        "Arbitrum One": { address: "0x13A7dedb7169a17BE92B0E3C7C2315B46F4772B3", decimals: 18 }
    },
    QNT: { "Ethereum ERC-20": { address: "0x4a220E6096B25EADb88358cb44068A3248254675", decimals: 18 } },
    GRT: {
        "Ethereum ERC-20": { address: "0xc944E90C64B2c07662A292be6244BDf05Cda44a7", decimals: 18 },
        "Arbitrum One": { address: "0x9623063377ad1b27544c965ccd7342f7ea7e88c7", decimals: 18 }
    },
    CRV: {
        "Ethereum ERC-20": { address: "0xD533a949740bb3306d119CC777fa900bA034cd52", decimals: 18 },
        "Arbitrum One": { address: "0x11cdb42b0eb46d95f990bedd4695a6e3fa034978", decimals: 18 }
    },
    MANA: {
        "Ethereum ERC-20": { address: "0x0F5D2fB29fb7d3Cb17dB3aB3b5D7A0277D4bD2", decimals: 18 },
        "Polygon PoS": { address: "0xA1C57f48F0Deb89f569DfBE6E2B7f46D33606f89", decimals: 18 }
    }
};

const EVM_SELF_CUSTODY_NETWORKS = new Set([
    "Ethereum",
    "Ethereum ERC-20",
    "Base",
    "Arbitrum One",
    "Optimism",
    "BNB Smart Chain BEP-20",
    "Polygon PoS",
    "Avalanche C-Chain"
].map((network) => network.toLowerCase()));

const SELF_CUSTODY_NETWORK_FAMILIES = new Map([
    ["bitcoin", "bitcoin"],
    ["bitcoin cash", "bitcoin-cash"],
    ["dogecoin", "dogecoin"],
    ["litecoin", "litecoin"],
    ["solana", "solana"],
    ["xrp ledger", "xrp"],
    ["stellar", "stellar"],
    ["tron trc-20", "tron"]
]);

const ACCOUNT_DEPOSIT_SCANNER_CONFIGS = {
    bitcoin: {
        scanner: "utxo-mempool",
        asset: "BTC",
        networks: ["Bitcoin"],
        baseUrlEnv: ["AUTODY_BITCOIN_API_URL", "BITCOIN_API_URL", "BTC_API_URL"],
        publicBaseUrl: "https://mempool.space/api",
        decimals: 8
    },
    "bitcoin-cash": {
        scanner: "blockchair-utxo",
        asset: "BCH",
        networks: ["Bitcoin Cash"],
        chain: "bitcoin-cash",
        baseUrlEnv: ["AUTODY_BCH_API_URL", "BCH_API_URL"],
        publicBaseUrl: "https://api.blockchair.com/bitcoin-cash",
        decimals: 8
    },
    dogecoin: {
        scanner: "blockchair-utxo",
        asset: "DOGE",
        networks: ["Dogecoin"],
        chain: "dogecoin",
        baseUrlEnv: ["AUTODY_DOGE_API_URL", "DOGE_API_URL"],
        publicBaseUrl: "https://api.blockchair.com/dogecoin",
        decimals: 8
    },
    litecoin: {
        scanner: "utxo-mempool",
        asset: "LTC",
        networks: ["Litecoin"],
        baseUrlEnv: ["AUTODY_LITECOIN_API_URL", "LITECOIN_API_URL", "LTC_API_URL"],
        publicBaseUrl: "https://litecoinspace.org/api",
        decimals: 8
    },
    solana: {
        scanner: "solana-rpc",
        asset: "SOL",
        networks: ["Solana"],
        rpcEnv: ["AUTODY_SOLANA_RPC_URL", "SOLANA_RPC_URL"],
        publicRpcUrl: "https://api.mainnet-beta.solana.com",
        decimals: 9
    },
    xrp: {
        scanner: "xrp-rpc",
        asset: "XRP",
        networks: ["XRP Ledger"],
        rpcEnv: ["AUTODY_XRP_RPC_URL", "XRP_RPC_URL"],
        publicRpcUrl: "https://s1.ripple.com:51234/"
    },
    stellar: {
        scanner: "stellar-horizon",
        asset: "XLM",
        networks: ["Stellar"],
        baseUrlEnv: ["AUTODY_STELLAR_HORIZON_URL", "STELLAR_HORIZON_URL"],
        publicBaseUrl: "https://horizon.stellar.org"
    },
    tron: {
        scanner: "tron-grid",
        asset: "TRX",
        networks: ["Tron TRC-20"],
        baseUrlEnv: ["AUTODY_TRON_API_URL", "TRON_API_URL"],
        publicBaseUrl: "https://api.trongrid.io",
        decimals: 6
    }
};

const TRON_TRC20_DEPOSIT_CONTRACTS = {
    USDT: { address: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", decimals: 6 }
};

const LITECOIN_NETWORK = {
    messagePrefix: "\x19Litecoin Signed Message:\n",
    bech32: "ltc",
    bip32: { public: 0x019da462, private: 0x019d9cfe },
    pubKeyHash: 0x30,
    scriptHash: 0x32,
    wif: 0xb0
};

const DOGECOIN_NETWORK = {
    messagePrefix: "\x19Dogecoin Signed Message:\n",
    bip32: { public: 0x02facafd, private: 0x02fac398 },
    pubKeyHash: 0x1e,
    scriptHash: 0x16,
    wif: 0x9e
};

let evmDepositRootCache = null;
let depositSeedCache = null;

function normalizeDepositAssetSymbol(value) {
    const symbol = normalizeTradeSymbol(value);
    if (!LIVE_DEPOSIT_ASSETS[symbol]) {
        throw demoTradeError(400, "Choose a supported crypto asset for receiving.");
    }
    return symbol;
}

function normalizeDepositNetwork(assetSymbol, value) {
    const asset = LIVE_DEPOSIT_ASSETS[assetSymbol] || LIVE_DEPOSIT_ASSETS[Object.keys(LIVE_DEPOSIT_ASSETS)[0]];
    const requested = String(value || asset.networks[0] || "").trim();
    const match = asset.networks.find((network) => network.toLowerCase() === requested.toLowerCase());
    if (!match) throw demoTradeError(400, `Choose a supported ${assetSymbol} deposit network.`);
    return match;
}

function normalizeManualCreditAssetSymbol(value) {
    const symbol = normalizeTradeSymbol(value);
    if (!symbol) throw demoTradeError(400, "Enter an asset to credit.");
    if (["USD", "USDFUNDS", "USD_FUNDS", "USD_CASH", "USDCASH", "FUNDS", "CASH"].includes(symbol)) {
        return "USD";
    }
    return symbol;
}

function normalizeManualCreditNetwork(assetSymbol, value) {
    const requested = normalizeText(value);
    if (requested) return requested;
    if (assetSymbol === "USD") return "Manual ledger";
    return LIVE_DEPOSIT_ASSETS[assetSymbol]?.networks?.[0] || "Manual ledger";
}

function depositEnvKeyPart(value = "") {
    return String(value || "")
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
}

function getDepositRpcUrl(config = {}) {
    const envName = (config.rpcEnv || []).find((name) => String(process.env[name] || "").trim());
    return envName ? String(process.env[envName]).trim() : config.publicRpcUrl || "";
}

function getDepositRestBaseUrl(config = {}) {
    const envName = (config.baseUrlEnv || []).find((name) => String(process.env[name] || "").trim());
    const rawUrl = envName ? String(process.env[envName]).trim() : config.publicBaseUrl || "";
    return rawUrl.replace(/\/+$/g, "");
}

async function fetchDepositJson(url, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEPOSIT_REST_TIMEOUT_MS);
    timeout.unref?.();

    const headers = {
        Accept: "application/json",
        "User-Agent": "Autody/1.0 deposit monitor",
        ...(options.headers || {})
    };
    if (options.body) headers["Content-Type"] = "application/json";

    try {
        const response = await fetch(url, {
            method: options.method || "GET",
            headers,
            body: options.body ? JSON.stringify(options.body) : undefined,
            signal: controller.signal
        });
        const text = await response.text();
        let json = {};
        try {
            json = text ? JSON.parse(text) : {};
        } catch (err) {
            json = { raw: text };
        }
        if (!response.ok) {
            throw new Error(json?.error || json?.message || json?.raw || `Deposit API returned ${response.status}`);
        }
        return json;
    } finally {
        clearTimeout(timeout);
    }
}

function getEvmNetworkConfig(network = "") {
    const selected = Object.entries(EVM_DEPOSIT_NETWORK_CONFIGS)
        .find(([name]) => name.toLowerCase() === String(network || "").trim().toLowerCase());
    if (!selected) return null;
    return { name: selected[0], ...selected[1] };
}

function depositTokenContractEnvCandidates(assetSymbol, network) {
    const assetKey = depositEnvKeyPart(assetSymbol);
    const networkKey = depositEnvKeyPart(network);
    return [
        `AUTODY_TOKEN_CONTRACT_${assetKey}_${networkKey}`,
        `AUTODY_DEPOSIT_TOKEN_${assetKey}_${networkKey}`,
        `TOKEN_CONTRACT_${assetKey}_${networkKey}`
    ];
}

function depositTokenDecimalsEnvCandidates(assetSymbol, network) {
    const assetKey = depositEnvKeyPart(assetSymbol);
    const networkKey = depositEnvKeyPart(network);
    return [
        `AUTODY_TOKEN_DECIMALS_${assetKey}_${networkKey}`,
        `AUTODY_DEPOSIT_TOKEN_DECIMALS_${assetKey}_${networkKey}`,
        `TOKEN_DECIMALS_${assetKey}_${networkKey}`
    ];
}

function getEvmTokenDepositContract(assetSymbol, network) {
    const envNames = depositTokenContractEnvCandidates(assetSymbol, network);
    const envName = envNames.find((name) => String(process.env[name] || "").trim());
    const configured = EVM_TOKEN_DEPOSIT_CONTRACTS[assetSymbol]?.[network] || null;
    const rawAddress = envName ? String(process.env[envName] || "").trim() : configured?.address;
    if (!rawAddress) return null;

    try {
        const decimalsEnvName = depositTokenDecimalsEnvCandidates(assetSymbol, network)
            .find((name) => String(process.env[name] || "").trim());
        const decimals = decimalsEnvName
            ? Number(process.env[decimalsEnvName])
            : Number(configured?.decimals ?? 18);
        return {
            address: ethers.getAddress(rawAddress),
            decimals: Number.isFinite(decimals) ? decimals : 18,
            envName: envName || null
        };
    } catch (err) {
        console.error(`Invalid token contract for ${assetSymbol} on ${network}:`, err.message || err);
        return null;
    }
}

function getAccountDepositScannerConfig(assetSymbol, network, family) {
    const asset = normalizeTradeSymbol(assetSymbol);
    const networkName = String(network || "").trim();

    if (family === "tron" && TRON_TRC20_DEPOSIT_CONTRACTS[asset]) {
        return {
            ...ACCOUNT_DEPOSIT_SCANNER_CONFIGS.tron,
            scanner: "tron-trc20",
            asset,
            tokenContract: TRON_TRC20_DEPOSIT_CONTRACTS[asset]
        };
    }

    const config = ACCOUNT_DEPOSIT_SCANNER_CONFIGS[family];
    if (!config) return null;
    if (config.asset !== asset) return null;
    if (!config.networks.some((candidate) => candidate.toLowerCase() === networkName.toLowerCase())) return null;
    return { ...config, asset };
}

function isNativeEvmDepositAsset(assetSymbol, network) {
    const config = getEvmNetworkConfig(network);
    return Boolean(config?.nativeAssets?.includes(assetSymbol));
}

function normalizeEvmAddress(address) {
    try {
        return ethers.getAddress(String(address || "").trim());
    } catch (err) {
        return "";
    }
}

function evmAddressTopic(address) {
    const normalized = normalizeEvmAddress(address);
    return normalized ? ethers.zeroPadValue(normalized, 32) : "";
}

function adminAuthConfigured() {
    return Boolean(ADMIN_ACCOUNT_EMAIL && (ADMIN_ACCOUNT_PASSWORD || (ADMIN_ACCOUNT_PASSWORD_SALT && ADMIN_ACCOUNT_PASSWORD_HASH)) && ADMIN_SESSION_SECRET);
}

function adminPasswordMatches(password = "") {
    if (ADMIN_ACCOUNT_PASSWORD_SALT && ADMIN_ACCOUNT_PASSWORD_HASH) {
        return verifyPassword(password, {
            passwordSalt: ADMIN_ACCOUNT_PASSWORD_SALT,
            passwordHash: ADMIN_ACCOUNT_PASSWORD_HASH
        });
    }

    if (!ADMIN_ACCOUNT_PASSWORD) return false;
    const expected = Buffer.from(String(ADMIN_ACCOUNT_PASSWORD));
    const provided = Buffer.from(String(password || ""));
    return expected.length === provided.length && crypto.timingSafeEqual(expected, provided);
}

function maskedAdminEmail(email = "") {
    const value = normalizeEmail(email);
    const [name, domain] = value.split("@");
    if (!name || !domain) return "admin email";
    const visible = name.length <= 2 ? `${name[0] || ""}*` : `${name.slice(0, 2)}***${name.slice(-1)}`;
    return `${visible}@${domain}`;
}

function adminRequestMeta(req) {
    return {
        ip: captchaClientIp(req) || req?.ip || "",
        userAgent: String(req?.get?.("user-agent") || "").slice(0, 500)
    };
}

async function ensureAdminAuthTables(client = dbPool) {
    if (!client) return false;
    await client.query(`
        create table if not exists admin_login_challenges (
            id text primary key,
            email text not null,
            code_salt text not null,
            code_hash text not null,
            status text not null default 'pending',
            attempts integer not null default 0,
            label text,
            ip_address text,
            user_agent text,
            expires_at timestamptz not null,
            created_at timestamptz not null default now(),
            verified_at timestamptz
        )
    `);
    await client.query(`
        create index if not exists admin_login_challenges_email_status_idx
          on admin_login_challenges (email, status, created_at desc)
    `);
    await client.query(`
        create table if not exists admin_access_events (
            id bigserial primary key,
            email text,
            event_type text not null,
            status text not null,
            ip_address text,
            user_agent text,
            details jsonb not null default '{}'::jsonb,
            created_at timestamptz not null default now()
        )
    `);
    return true;
}

async function recordAdminAccessEvent(eventType, status, req, details = {}) {
    const meta = adminRequestMeta(req);
    if (!databaseConfigured()) return;
    try {
        await ensureAdminAuthTables();
        await dbPool.query(`
            insert into admin_access_events (email, event_type, status, ip_address, user_agent, details)
            values ($1, $2, $3, $4, $5, $6::jsonb)
        `, [
            normalizeEmail(details.email || ADMIN_ACCOUNT_EMAIL) || null,
            normalizeText(eventType) || "admin_event",
            normalizeText(status) || "unknown",
            meta.ip,
            meta.userAgent,
            JSON.stringify(details || {})
        ]);
    } catch (err) {
        console.error("Admin access event logging failed:", err.message || err);
    }
}

async function createAdminLoginChallenge(email, label, req) {
    if (!adminAuthConfigured()) {
        const err = new Error("Admin login is not configured.");
        err.status = 503;
        throw err;
    }

    const normalizedEmail = normalizeEmail(email);
    if (normalizedEmail !== ADMIN_ACCOUNT_EMAIL) {
        await recordAdminAccessEvent("admin_password", "rejected_email", req, { email: normalizedEmail });
        const err = new Error("Admin email or password is incorrect.");
        err.status = 401;
        throw err;
    }

    const item = createVerificationCodeRecord("email", normalizedEmail, {
        codeMode: "numeric",
        ttlMs: ADMIN_EMAIL_CODE_TTL_MS
    });
    const challengeId = crypto.randomUUID();
    const safeLabel = normalizeText(label || "Autody admin").slice(0, 80);
    const meta = adminRequestMeta(req);

    if (databaseConfigured()) {
        await ensureAdminAuthTables();
        await dbPool.query(`
            update admin_login_challenges
            set status = 'replaced'
            where email = $1 and status = 'pending'
        `, [normalizedEmail]);
        await dbPool.query(`
            insert into admin_login_challenges (id, email, code_salt, code_hash, label, ip_address, user_agent, expires_at)
            values ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [challengeId, normalizedEmail, item.salt, item.hash, safeLabel, meta.ip, meta.userAgent, item.expiresAt]);
    } else {
        for (const [id, record] of adminLoginChallenges.entries()) {
            if (record.email === normalizedEmail && record.status === "pending") {
                adminLoginChallenges.set(id, { ...record, status: "replaced" });
            }
        }
        adminLoginChallenges.set(challengeId, {
            id: challengeId,
            email: normalizedEmail,
            salt: item.salt,
            hash: item.hash,
            label: safeLabel,
            expiresAt: item.expiresAt,
            attempts: 0,
            status: "pending"
        });
    }

    const delivery = await sendAdminLoginCodeEmail(normalizedEmail, item.code);
    await recordAdminAccessEvent("admin_code_requested", "sent", req, { email: normalizedEmail, challengeId });
    return {
        challengeId,
        maskedEmail: maskedAdminEmail(normalizedEmail),
        expiresAt: item.expiresAt,
        delivery
    };
}

async function verifyAdminLoginChallenge(challengeId, code, req) {
    const id = normalizeText(challengeId);
    const suppliedCode = normalizeText(code).replace(/\s+/g, "");
    if (!id || !/^\d{6}$/.test(suppliedCode)) {
        const err = new Error("Enter the 6-digit admin code.");
        err.status = 400;
        throw err;
    }

    if (databaseConfigured()) {
        await ensureAdminAuthTables();
        const result = await dbPool.query(`
            select id, email, code_salt, code_hash, attempts, expires_at, label
            from admin_login_challenges
            where id = $1 and status = 'pending'
            limit 1
        `, [id]);
        const record = result.rows[0];
        if (!record) {
            const err = new Error("Admin code is no longer active.");
            err.status = 400;
            throw err;
        }
        if (Date.parse(record.expires_at) <= Date.now()) {
            await dbPool.query("update admin_login_challenges set status = 'expired' where id = $1", [id]);
            const err = new Error("Admin code expired. Request a new one.");
            err.status = 400;
            throw err;
        }
        if (Number(record.attempts || 0) >= 5) {
            const err = new Error("Too many attempts. Request a new admin code.");
            err.status = 429;
            throw err;
        }
        const suppliedHash = verificationCodeHash(suppliedCode, record.code_salt);
        if (!sameHashValue(suppliedHash, record.code_hash)) {
            await dbPool.query("update admin_login_challenges set attempts = attempts + 1 where id = $1", [id]);
            await recordAdminAccessEvent("admin_code", "incorrect", req, { email: record.email, challengeId: id });
            const err = new Error("Admin code is incorrect.");
            err.status = 400;
            throw err;
        }
        await dbPool.query("update admin_login_challenges set status = 'verified', verified_at = now() where id = $1", [id]);
        await recordAdminAccessEvent("admin_code", "verified", req, { email: record.email, challengeId: id });
        return { email: record.email, label: record.label || "Autody admin" };
    }

    const record = adminLoginChallenges.get(id);
    if (!record || record.status !== "pending") {
        const err = new Error("Admin code is no longer active.");
        err.status = 400;
        throw err;
    }
    if (Date.parse(record.expiresAt) <= Date.now()) {
        adminLoginChallenges.set(id, { ...record, status: "expired" });
        const err = new Error("Admin code expired. Request a new one.");
        err.status = 400;
        throw err;
    }
    if (Number(record.attempts || 0) >= 5) {
        const err = new Error("Too many attempts. Request a new admin code.");
        err.status = 429;
        throw err;
    }
    const suppliedHash = verificationCodeHash(suppliedCode, record.salt);
    if (!sameHashValue(suppliedHash, record.hash)) {
        adminLoginChallenges.set(id, { ...record, attempts: Number(record.attempts || 0) + 1 });
        const err = new Error("Admin code is incorrect.");
        err.status = 400;
        throw err;
    }
    adminLoginChallenges.set(id, { ...record, status: "verified" });
    return { email: record.email, label: record.label || "Autody admin" };
}

function base64UrlEncode(value) {
    return Buffer.from(value).toString("base64url");
}

function base64UrlDecode(value = "") {
    return Buffer.from(String(value || ""), "base64url").toString("utf8");
}

function adminSessionSignature(payload = "") {
    if (!ADMIN_SESSION_SECRET) return "";
    return crypto.createHmac("sha256", ADMIN_SESSION_SECRET).update(String(payload || "")).digest("base64url");
}

function createAdminSessionToken(label = "Autody admin", email = ADMIN_ACCOUNT_EMAIL) {
    const now = Date.now();
    const expiresAt = now + ADMIN_SESSION_HOURS * 60 * 60 * 1000;
    const payload = base64UrlEncode(JSON.stringify({
        scope: "autody-admin",
        email: normalizeEmail(email),
        label: String(label || "Autody admin").slice(0, 80),
        nonce: crypto.randomBytes(16).toString("hex"),
        iat: now,
        exp: expiresAt
    }));
    const signature = adminSessionSignature(payload);
    return {
        token: `${payload}.${signature}`,
        expiresAt: new Date(expiresAt).toISOString()
    };
}

function verifyAdminSessionToken(token = "") {
    if (!ADMIN_SESSION_SECRET || !token) return null;
    const [payload, signature] = String(token || "").split(".");
    if (!payload || !signature) return null;

    const expected = adminSessionSignature(payload);
    const expectedBuffer = Buffer.from(expected);
    const providedBuffer = Buffer.from(signature);
    if (expectedBuffer.length !== providedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, providedBuffer)) {
        return null;
    }

    try {
        const decoded = JSON.parse(base64UrlDecode(payload));
        if (decoded.scope !== "autody-admin" || Number(decoded.exp) <= Date.now()) return null;
        return decoded;
    } catch (err) {
        return null;
    }
}

function requestAdminSessionToken(req, body = {}) {
    const authHeader = String(req.get("authorization") || "");
    const bearer = authHeader.match(/^Bearer\s+(.+)$/i)?.[1];
    return String(bearer || req.get("x-admin-session") || body.adminSession || "").trim();
}

function adminRequestAuthorized(req, body = {}) {
    const session = verifyAdminSessionToken(requestAdminSessionToken(req, body));
    if (session) return true;

    if (adminAuthConfigured() && !ADMIN_KEY_BYPASS_ENABLED) return false;
    if (!ADMIN_RESET_KEY) return false;

    const providedKey = normalizeText(req.get("x-admin-reset-key") || req.get("x-admin-key") || body.adminKey);
    return Boolean(providedKey && providedKey === ADMIN_RESET_KEY);
}

function looksLikePrivateTreasurySecret(value = "") {
    const trimmed = String(value || "").trim();
    if (!trimmed) return false;
    const compact = trimmed.replace(/\s+/g, " ");
    const lower = compact.toLowerCase();
    const words = lower.split(" ").filter(Boolean);

    return /^0x[a-f0-9]{64}$/i.test(trimmed)
        || /^[a-f0-9]{64}$/i.test(trimmed)
        || /^[5KL][1-9A-HJ-NP-Za-km-z]{50,51}$/.test(trimmed)
        || /^(xprv|yprv|zprv|tprv)[1-9A-HJ-NP-Za-km-z]{80,}$/.test(trimmed)
        || /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(trimmed)
        || /(private[_\s-]?key|seed[_\s-]?phrase|mnemonic|recovery[_\s-]?phrase)/i.test(trimmed)
        || (words.length >= 12 && words.length <= 24 && /^[a-z]+(?: [a-z]+){11,23}$/.test(lower));
}

function isEvmDepositNetwork(network = "") {
    return EVM_SELF_CUSTODY_NETWORKS.has(String(network || "").trim().toLowerCase());
}

function selfCustodyNetworkFamily(network = "") {
    const normalized = String(network || "").trim().toLowerCase();
    if (isEvmDepositNetwork(normalized)) return "evm";
    return SELF_CUSTODY_NETWORK_FAMILIES.get(normalized) || "";
}

function normalizedDepositMnemonic() {
    return DEPOSIT_MNEMONIC
        .replace(/[(),]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function normalizedEvmMnemonic() {
    return normalizedDepositMnemonic();
}

function selfCustodyEvmConfigured() {
    return Boolean(normalizedDepositMnemonic());
}

function evmDepositEnvName() {
    if (String(process.env.AUTODY_DEPOSIT_MNEMONIC || "").trim()) return "AUTODY_DEPOSIT_MNEMONIC";
    if (String(process.env.AUTODY_EVM_DEPOSIT_MNEMONIC || "").trim()) return "AUTODY_EVM_DEPOSIT_MNEMONIC";
    if (String(process.env.AUTODY_CUSTODY_EVM_MNEMONIC || "").trim()) return "AUTODY_CUSTODY_EVM_MNEMONIC";
    return "AUTODY_DEPOSIT_MNEMONIC";
}

function getDepositSeed() {
    if (depositSeedCache) return depositSeedCache;
    const mnemonic = normalizedDepositMnemonic();
    if (!mnemonic) return null;
    if (!bip39.validateMnemonic(mnemonic)) {
        throw new Error("Deposit mnemonic is not a valid BIP-39 seed phrase.");
    }
    depositSeedCache = bip39.mnemonicToSeedSync(mnemonic, DEPOSIT_MNEMONIC_PASSWORD);
    return depositSeedCache;
}

function deriveBip32Address(pathValue, network, paymentType = "p2wpkh") {
    const seed = getDepositSeed();
    if (!seed) return "";
    const node = bip32.fromSeed(seed, network).derivePath(pathValue);
    const pubkey = Buffer.from(node.publicKey);
    if (paymentType === "p2pkh") {
        return bitcoin.payments.p2pkh({ pubkey, network }).address || "";
    }
    return bitcoin.payments.p2wpkh({ pubkey, network }).address || "";
}

function deriveBitcoinCashAddress(index) {
    const seed = getDepositSeed();
    if (!seed) return "";
    const node = bip32.fromSeed(seed, bitcoin.networks.bitcoin).derivePath(`m/44'/145'/0'/0/${index}`);
    const hash = bitcoin.crypto.hash160(Buffer.from(node.publicKey));
    return cashaddr.encode("bitcoincash", "P2PKH", hash);
}

function deriveEd25519Seed(pathValue) {
    const seed = getDepositSeed();
    if (!seed) return null;
    return deriveEd25519Path(pathValue, seed.toString("hex")).key;
}

function deriveXrpAddress(index) {
    const seed = getDepositSeed();
    if (!seed) return "";
    const entropy = crypto.createHmac("sha256", seed)
        .update(`xrp:${index}`)
        .digest()
        .subarray(0, 16);
    const xrpSeed = rippleKeypairs.generateSeed({ entropy });
    return rippleKeypairs.deriveAddress(rippleKeypairs.deriveKeypair(xrpSeed).publicKey);
}

function deriveTronAddress(index) {
    const seed = getDepositSeed();
    if (!seed) return "";
    const node = bip32.fromSeed(seed).derivePath(`m/44'/195'/0'/0/${index}`);
    return TronWeb.address.fromPrivateKey(Buffer.from(node.privateKey).toString("hex"));
}

function deriveSelfCustodyDepositAddress(family, index) {
    switch (family) {
        case "evm":
            return {
                address: deriveEvmDepositAddress(index),
                derivationPath: `${EVM_DEPOSIT_BASE_PATH}/${index}`
            };
        case "bitcoin":
            return {
                address: deriveBip32Address(`m/84'/0'/0'/0/${index}`, bitcoin.networks.bitcoin, "p2wpkh"),
                derivationPath: `m/84'/0'/0'/0/${index}`
            };
        case "bitcoin-cash":
            return {
                address: deriveBitcoinCashAddress(index),
                derivationPath: `m/44'/145'/0'/0/${index}`
            };
        case "dogecoin":
            return {
                address: deriveBip32Address(`m/44'/3'/0'/0/${index}`, DOGECOIN_NETWORK, "p2pkh"),
                derivationPath: `m/44'/3'/0'/0/${index}`
            };
        case "litecoin":
            return {
                address: deriveBip32Address(`m/84'/2'/0'/0/${index}`, LITECOIN_NETWORK, "p2wpkh"),
                derivationPath: `m/84'/2'/0'/0/${index}`
            };
        case "solana": {
            const pathValue = `m/44'/501'/${index}'/0'`;
            const seed = deriveEd25519Seed(pathValue);
            return {
                address: seed ? SolanaKeypair.fromSeed(seed).publicKey.toBase58() : "",
                derivationPath: pathValue
            };
        }
        case "xrp":
            return {
                address: deriveXrpAddress(index),
                derivationPath: `autody-xrp-hmac/${index}`
            };
        case "stellar": {
            const pathValue = `m/44'/148'/${index}'`;
            const seed = deriveEd25519Seed(pathValue);
            return {
                address: seed ? StellarSdk.Keypair.fromRawEd25519Seed(seed).publicKey() : "",
                derivationPath: pathValue
            };
        }
        case "tron":
            return {
                address: deriveTronAddress(index),
                derivationPath: `m/44'/195'/0'/0/${index}`
            };
        default:
            return { address: "", derivationPath: "" };
    }
}

function getEvmDepositRoot() {
    if (evmDepositRootCache) return evmDepositRootCache;
    const mnemonic = normalizedEvmMnemonic();
    if (mnemonic) {
        evmDepositRootCache = ethers.HDNodeWallet.fromPhrase(
            mnemonic,
            EVM_DEPOSIT_PASSWORD,
            EVM_DEPOSIT_BASE_PATH
        );
        return evmDepositRootCache;
    }
    return null;
}

function deriveEvmDepositAddress(index) {
    const root = getEvmDepositRoot();
    if (!root) return "";
    const child = root.deriveChild(index);
    return ethers.getAddress(child.address);
}

function deriveEvmDepositWallet(index, provider = null) {
    const root = getEvmDepositRoot();
    if (!root) return null;
    const child = root.deriveChild(index);
    return provider ? child.connect(provider) : child;
}

function normalizeDepositMetadata(metadata) {
    if (!metadata) return {};
    if (typeof metadata === "string") {
        try {
            return JSON.parse(metadata);
        } catch (err) {
            return {};
        }
    }
    if (typeof metadata === "object") return metadata;
    return {};
}

function treasuryAddressEnvCandidates(assetSymbol, network) {
    const assetKey = depositEnvKeyPart(assetSymbol);
    const networkKey = depositEnvKeyPart(network);
    const candidates = [
        `AUTODY_TREASURY_${assetKey}_${networkKey}_ADDRESS`,
        `TREASURY_${assetKey}_${networkKey}_ADDRESS`,
        `AUTODY_TREASURY_${assetKey}_ADDRESS`,
        `TREASURY_${assetKey}_ADDRESS`,
        `AUTODY_TREASURY_${networkKey}_ADDRESS`,
        `TREASURY_${networkKey}_ADDRESS`,
        `AUTODY_SWEEP_TREASURY_${networkKey}_ADDRESS`
    ];
    if (isEvmDepositNetwork(network)) {
        candidates.push(
            "AUTODY_TREASURY_EVM_ADDRESS",
            "AUTODY_SWEEP_TREASURY_EVM_ADDRESS",
            "AUTODY_TREASURY_ADDRESS",
            "TREASURY_ADDRESS"
        );
    }
    return candidates;
}

function depositRouteMode() {
    if (["direct", "treasury", "treasury_only", "treasury_direct", "treasury_direct_only"].includes(DEPOSIT_ROUTE_MODE)) {
        return "treasury_direct";
    }
    if (["self", "self_custody", "self_custody_only", "generated", "generated_addresses"].includes(DEPOSIT_ROUTE_MODE)) {
        return "self_custody";
    }
    return "hybrid";
}

function depositRoutePrefersTreasury() {
    return ["treasury_direct", "hybrid"].includes(depositRouteMode());
}

function depositRouteAllowsSelfCustody() {
    return ["self_custody", "hybrid"].includes(depositRouteMode());
}

function isDirectTreasuryRouteType(routeType = "") {
    return ["treasury_direct", "shared_treasury_manual"].includes(String(routeType || "").trim().toLowerCase());
}

function sweepTreasuryAddressEnvCandidates(network) {
    const networkKey = depositEnvKeyPart(network);
    return [
        `AUTODY_SWEEP_TREASURY_${networkKey}_ADDRESS`,
        `AUTODY_TREASURY_${networkKey}_ADDRESS`,
        "AUTODY_SWEEP_TREASURY_EVM_ADDRESS",
        "AUTODY_TREASURY_EVM_ADDRESS",
        "AUTODY_SWEEP_TREASURY_ADDRESS",
        "AUTODY_TREASURY_ADDRESS"
    ];
}

function resolveSweepTreasuryAddress(network, body = {}) {
    const requestedDestination = String(
        body.destinationAddress ||
        body.destination ||
        body.treasuryAddress ||
        body.toAddress ||
        ""
    ).trim();

    if (requestedDestination) {
        return {
            address: ethers.getAddress(requestedDestination),
            source: body.destination
                ? "request.destination"
                : body.destinationAddress
                    ? "request.destinationAddress"
                    : body.treasuryAddress
                        ? "request.treasuryAddress"
                        : "request.toAddress"
        };
    }

    for (const envName of sweepTreasuryAddressEnvCandidates(network)) {
        const value = String(process.env[envName] || "").trim();
        if (!value) continue;
        return {
            address: ethers.getAddress(value),
            source: envName
        };
    }

    return { address: "", source: "" };
}

function resolveTreasuryDepositRoute(assetSymbol, network) {
    const envNames = treasuryAddressEnvCandidates(assetSymbol, network);
    const envName = envNames.find((name) => String(process.env[name] || "").trim());
    const address = envName ? String(process.env[envName] || "").trim() : "";
    const provider = DEPOSIT_ROUTE_PROVIDER;

    if (address && looksLikePrivateTreasurySecret(address)) {
        console.error(`Rejected treasury deposit route from ${envName}: value looks like a private secret, not a public receiving address.`);
        return {
            address: "",
            provider,
            routeType: "treasury_secret_rejected",
            status: "route_rejected",
            envName,
            custodyConnected: false,
            uniqueAddress: false,
            warnings: [
                `${envName} does not look like a public receiving address.`,
                "Use only a public receive address. Never put a seed phrase, private key, recovery phrase, or wallet login in Render."
            ]
        };
    }

    if (!address) {
        return {
            address: "",
            provider,
            routeType: "custody_not_connected",
            status: "route_required",
            envName: envNames[0],
            custodyConnected: false,
            uniqueAddress: false,
            warnings: [
                `No treasury address is configured for ${assetSymbol} on ${network}.`,
                `Add ${envNames[0]} on the server or connect a custody provider before sending real funds.`
            ]
        };
    }

    return {
        address,
        provider,
        routeType: "treasury_direct",
        status: "address_issued",
        envName,
        custodyConnected: false,
        uniqueAddress: false,
        warnings: [
            "This route sends funds directly to the treasury wallet and does not need a child-address sweep.",
            "Because this address can be shared, credit matching should use a deposit request, transaction hash, memo/tag, or admin review."
        ]
    };
}

async function resolveDatabaseSelfCustodyEvmRoute(client, profileId, assetSymbol, network, requestedFresh) {
    if (!selfCustodyEvmConfigured() || !isEvmDepositNetwork(network)) return null;

    const provider = "self_custody_evm";
    const routeType = "self_custody_hd";
    try {
        if (!requestedFresh) {
            const existing = await client.query(`
                select address, metadata
                from crypto_deposit_addresses
                where profile_id = $1
                  and asset_symbol = $2
                  and network = $3
                  and provider = $4
                  and route_type = $5
                  and status = 'active'
                order by last_issued_at desc
                limit 1
            `, [profileId, assetSymbol, network, provider, routeType]);

            if (existing.rows[0]?.address) {
                return {
                    address: existing.rows[0].address,
                    provider,
                    routeType,
                    status: "address_issued",
                    envName: evmDepositEnvName(),
                    custodyConnected: true,
                    uniqueAddress: true,
                    metadata: existing.rows[0].metadata || {},
                    warnings: []
                };
            }
        }

        await client.query("select pg_advisory_xact_lock(hashtext('autody:self_custody_evm_deposit_index'))");
        const indexResult = await client.query(`
            select coalesce(max((metadata->>'derivationIndex')::integer), -1) as max_index
            from crypto_deposit_addresses
            where provider = $1
              and route_type = $2
              and metadata ? 'derivationIndex'
        `, [provider, routeType]);
        const maxIndex = indexResult.rows[0]?.max_index;
        const nextIndex = Number(maxIndex ?? -1) + 1;
        const address = deriveEvmDepositAddress(nextIndex);

        return {
            address,
            provider,
            routeType,
            status: "address_issued",
            envName: evmDepositEnvName(),
            custodyConnected: true,
            uniqueAddress: true,
            metadata: {
                derivationIndex: nextIndex,
                derivationBasePath: EVM_DEPOSIT_BASE_PATH,
                networkFamily: "evm"
            },
            warnings: []
        };
    } catch (err) {
        console.error("Self-custody EVM deposit route error:", err);
        return {
            address: "",
            provider,
            routeType: "self_custody_error",
            status: "route_error",
            envName: evmDepositEnvName(),
            custodyConnected: false,
            uniqueAddress: false,
            metadata: { networkFamily: "evm" },
            warnings: [
                "Self-custody EVM address generation is not configured correctly.",
                `Check ${evmDepositEnvName()} before accepting deposits.`
            ]
        };
    }
}

function resolveJsonSelfCustodyEvmRoute(db, userId, assetSymbol, network, requestedFresh) {
    if (!selfCustodyEvmConfigured() || !isEvmDepositNetwork(network)) return null;

    const provider = "self_custody_evm";
    const routeType = "self_custody_hd";
    db.depositAddressBook = db.depositAddressBook || {};
    db.depositAddressBook[userId] = db.depositAddressBook[userId] || [];

    try {
        if (!requestedFresh) {
            const existing = db.depositAddressBook[userId]
                .filter((item) => item.asset === assetSymbol
                    && item.network === network
                    && item.provider === provider
                    && item.routeType === routeType
                    && item.status === "active")
                .sort((a, b) => String(b.lastIssuedAt || "").localeCompare(String(a.lastIssuedAt || "")))[0];
            if (existing?.address) {
                existing.lastIssuedAt = new Date().toISOString();
                return {
                    address: existing.address,
                    provider,
                    routeType,
                    status: "address_issued",
                    envName: evmDepositEnvName(),
                    custodyConnected: true,
                    uniqueAddress: true,
                    metadata: existing.metadata || {},
                    warnings: []
                };
            }
        }

        db.depositAddressIndexes = db.depositAddressIndexes || {};
        const nextIndex = Number(db.depositAddressIndexes.evm || 0);
        const address = deriveEvmDepositAddress(nextIndex);
        db.depositAddressIndexes.evm = nextIndex + 1;
        const now = new Date().toISOString();
        const record = {
            id: crypto.randomUUID(),
            userId,
            asset: assetSymbol,
            network,
            address,
            provider,
            routeType,
            status: "active",
            firstIssuedAt: now,
            lastIssuedAt: now,
            metadata: {
                derivationIndex: nextIndex,
                derivationBasePath: EVM_DEPOSIT_BASE_PATH,
                networkFamily: "evm"
            }
        };
        db.depositAddressBook[userId].unshift(record);
        return {
            address,
            provider,
            routeType,
            status: "address_issued",
            envName: evmDepositEnvName(),
            custodyConnected: true,
            uniqueAddress: true,
            metadata: record.metadata,
            warnings: []
        };
    } catch (err) {
        console.error("JSON self-custody EVM deposit route error:", err);
        return {
            address: "",
            provider,
            routeType: "self_custody_error",
            status: "route_error",
            envName: evmDepositEnvName(),
            custodyConnected: false,
            uniqueAddress: false,
            metadata: { networkFamily: "evm" },
            warnings: [
                "Self-custody EVM address generation is not configured correctly.",
                `Check ${evmDepositEnvName()} before accepting deposits.`
            ]
        };
    }
}

function selfCustodyProviderName(family) {
    return `self_custody_${String(family || "").replace(/[^a-z0-9]+/gi, "_")}`;
}

async function resolveDatabaseSelfCustodyRoute(client, profileId, assetSymbol, network, requestedFresh) {
    const family = selfCustodyNetworkFamily(network);
    if (!family || !selfCustodyEvmConfigured()) return null;

    const provider = selfCustodyProviderName(family);
    const routeType = "self_custody_hd";
    try {
        if (!requestedFresh) {
            const existing = await client.query(`
                select address, metadata
                from crypto_deposit_addresses
                where profile_id = $1
                  and asset_symbol = $2
                  and network = $3
                  and provider = $4
                  and route_type = $5
                  and status = 'active'
                order by last_issued_at desc
                limit 1
            `, [profileId, assetSymbol, network, provider, routeType]);

            if (existing.rows[0]?.address) {
                return {
                    address: existing.rows[0].address,
                    provider,
                    routeType,
                    status: "address_issued",
                    envName: evmDepositEnvName(),
                    custodyConnected: true,
                    uniqueAddress: true,
                    metadata: existing.rows[0].metadata || {},
                    warnings: []
                };
            }
        }

        await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [`autody:self_custody_${family}_deposit_index`]);
        const indexResult = await client.query(`
            select coalesce(max((metadata->>'derivationIndex')::integer), -1) as max_index
            from crypto_deposit_addresses
            where provider = $1
              and route_type = $2
              and metadata ? 'derivationIndex'
        `, [provider, routeType]);
        const maxIndex = indexResult.rows[0]?.max_index;
        const nextIndex = Number(maxIndex ?? -1) + 1;
        const derived = deriveSelfCustodyDepositAddress(family, nextIndex);
        if (!derived.address) throw new Error(`No ${family} address was derived.`);

        return {
            address: derived.address,
            provider,
            routeType,
            status: "address_issued",
            envName: evmDepositEnvName(),
            custodyConnected: true,
            uniqueAddress: true,
            metadata: {
                derivationIndex: nextIndex,
                derivationPath: derived.derivationPath,
                networkFamily: family
            },
            warnings: []
        };
    } catch (err) {
        console.error(`Self-custody ${family} deposit route error:`, err);
        return {
            address: "",
            provider,
            routeType: "self_custody_error",
            status: "route_error",
            envName: evmDepositEnvName(),
            custodyConnected: false,
            uniqueAddress: false,
            metadata: { networkFamily: family },
            warnings: [
                `Self-custody ${family} address generation is not configured correctly.`,
                `Check ${evmDepositEnvName()} before accepting deposits.`
            ]
        };
    }
}

function resolveJsonSelfCustodyRoute(db, userId, assetSymbol, network, requestedFresh) {
    const family = selfCustodyNetworkFamily(network);
    if (!family || !selfCustodyEvmConfigured()) return null;

    const provider = selfCustodyProviderName(family);
    const routeType = "self_custody_hd";
    db.depositAddressBook = db.depositAddressBook || {};
    db.depositAddressBook[userId] = db.depositAddressBook[userId] || [];

    try {
        if (!requestedFresh) {
            const existing = db.depositAddressBook[userId]
                .filter((item) => item.asset === assetSymbol
                    && item.network === network
                    && item.provider === provider
                    && item.routeType === routeType
                    && item.status === "active")
                .sort((a, b) => String(b.lastIssuedAt || "").localeCompare(String(a.lastIssuedAt || "")))[0];
            if (existing?.address) {
                existing.lastIssuedAt = new Date().toISOString();
                return {
                    address: existing.address,
                    provider,
                    routeType,
                    status: "address_issued",
                    envName: evmDepositEnvName(),
                    custodyConnected: true,
                    uniqueAddress: true,
                    metadata: existing.metadata || {},
                    warnings: []
                };
            }
        }

        db.depositAddressIndexes = db.depositAddressIndexes || {};
        const indexKey = family.replace(/[^a-z0-9]+/gi, "_");
        const nextIndex = Number(db.depositAddressIndexes[indexKey] || 0);
        const derived = deriveSelfCustodyDepositAddress(family, nextIndex);
        if (!derived.address) throw new Error(`No ${family} address was derived.`);
        db.depositAddressIndexes[indexKey] = nextIndex + 1;
        const now = new Date().toISOString();
        const record = {
            id: crypto.randomUUID(),
            userId,
            asset: assetSymbol,
            network,
            address: derived.address,
            provider,
            routeType,
            status: "active",
            firstIssuedAt: now,
            lastIssuedAt: now,
            metadata: {
                derivationIndex: nextIndex,
                derivationPath: derived.derivationPath,
                networkFamily: family
            }
        };
        db.depositAddressBook[userId].unshift(record);
        return {
            address: derived.address,
            provider,
            routeType,
            status: "address_issued",
            envName: evmDepositEnvName(),
            custodyConnected: true,
            uniqueAddress: true,
            metadata: record.metadata,
            warnings: []
        };
    } catch (err) {
        console.error(`JSON self-custody ${family} deposit route error:`, err);
        return {
            address: "",
            provider,
            routeType: "self_custody_error",
            status: "route_error",
            envName: evmDepositEnvName(),
            custodyConnected: false,
            uniqueAddress: false,
            metadata: { networkFamily: family },
            warnings: [
                `Self-custody ${family} address generation is not configured correctly.`,
                `Check ${evmDepositEnvName()} before accepting deposits.`
            ]
        };
    }
}

async function resolveDatabaseDepositRoute(client, profileId, assetSymbol, network, requestedFresh) {
    const treasuryRoute = resolveTreasuryDepositRoute(assetSymbol, network);
    if (depositRouteMode() === "treasury_direct") return treasuryRoute;

    const selfCustodyRoute = depositRouteAllowsSelfCustody()
        ? await resolveDatabaseSelfCustodyRoute(client, profileId, assetSymbol, network, requestedFresh)
        : null;
    if (selfCustodyRoute?.address || depositRouteMode() === "self_custody") return selfCustodyRoute || treasuryRoute;
    if (depositRoutePrefersTreasury() && treasuryRoute.address) return treasuryRoute;
    return selfCustodyRoute || treasuryRoute;
}

function resolveJsonDepositRoute(db, userId, assetSymbol, network, requestedFresh) {
    const treasuryRoute = resolveTreasuryDepositRoute(assetSymbol, network);
    if (depositRouteMode() === "treasury_direct") return treasuryRoute;

    const selfCustodyRoute = depositRouteAllowsSelfCustody()
        ? resolveJsonSelfCustodyRoute(db, userId, assetSymbol, network, requestedFresh)
        : null;
    if (selfCustodyRoute?.address || depositRouteMode() === "self_custody") return selfCustodyRoute || treasuryRoute;
    if (depositRoutePrefersTreasury() && treasuryRoute.address) return treasuryRoute;
    return selfCustodyRoute || treasuryRoute;
}

async function ensureDepositTables(client = dbPool) {
    await client.query(`
        create table if not exists crypto_deposit_addresses (
          id uuid primary key default gen_random_uuid(),
          profile_id uuid not null references profiles(id) on delete cascade,
          asset_symbol text not null,
          network text not null,
          address text not null,
          route_type text not null default 'shared_treasury_manual',
          provider text not null default 'manual',
          status text not null default 'active',
          first_issued_at timestamptz not null default now(),
          last_issued_at timestamptz not null default now(),
          metadata jsonb not null default '{}'::jsonb,
          unique(profile_id, asset_symbol, network, address)
        );

        create index if not exists crypto_deposit_addresses_profile_idx
          on crypto_deposit_addresses (profile_id, asset_symbol, network, last_issued_at desc);

        create table if not exists crypto_deposit_requests (
          id uuid primary key default gen_random_uuid(),
          profile_id uuid not null references profiles(id) on delete cascade,
          account_mode_id uuid references account_modes(id) on delete cascade,
          address_id uuid references crypto_deposit_addresses(id) on delete set null,
          asset_symbol text not null,
          network text not null,
          address text,
          provider text not null default 'manual',
          route_type text not null default 'shared_treasury_manual',
          status text not null default 'address_issued',
          requested_fresh boolean not null default true,
          warnings jsonb not null default '[]'::jsonb,
          created_at timestamptz not null default now(),
          expires_at timestamptz,
          credited_at timestamptz
        );

        create index if not exists crypto_deposit_requests_profile_idx
          on crypto_deposit_requests (profile_id, created_at desc);

        create index if not exists crypto_deposit_requests_address_status_idx
          on crypto_deposit_requests (address, status, created_at desc);

        alter table crypto_deposit_requests
          add column if not exists amount_received numeric(28, 10),
          add column if not exists amount_usd numeric(18, 2),
          add column if not exists confirmations integer not null default 0,
          add column if not exists tx_hash text,
          add column if not exists updated_at timestamptz not null default now();

        create table if not exists crypto_deposit_events (
          id uuid primary key default gen_random_uuid(),
          profile_id uuid not null references profiles(id) on delete cascade,
          address_id uuid references crypto_deposit_addresses(id) on delete set null,
          request_id uuid references crypto_deposit_requests(id) on delete set null,
          asset_symbol text not null,
          network text not null,
          address text not null,
          tx_hash text not null,
          log_index integer,
          block_number numeric(20, 0),
          amount numeric(28, 10) not null,
          amount_usd numeric(18, 2),
          confirmations integer not null default 0,
          status text not null default 'detected',
          credited_at timestamptz,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now(),
          metadata jsonb not null default '{}'::jsonb
        );

        create unique index if not exists crypto_deposit_events_unique_idx
          on crypto_deposit_events (network, tx_hash, asset_symbol, address, (coalesce(log_index, -1)));

        create index if not exists crypto_deposit_events_profile_idx
          on crypto_deposit_events (profile_id, created_at desc);

        create table if not exists crypto_deposit_scan_state (
          scan_key text primary key,
          network text not null,
          asset_symbol text,
          scanner text not null,
          last_scanned_block numeric(20, 0) not null default 0,
          updated_at timestamptz not null default now()
        );

        do $$
        begin
          if exists (
            select 1
            from pg_constraint
            where conname = 'orders_side_check'
              and conrelid = 'orders'::regclass
              and pg_get_constraintdef(oid) not like '%deposit%'
          ) then
            alter table orders drop constraint orders_side_check;
          end if;

          if not exists (
            select 1
            from pg_constraint
            where conname = 'orders_side_check'
              and conrelid = 'orders'::regclass
          ) then
            alter table orders
              add constraint orders_side_check
              check (side in ('buy', 'sell', 'swap', 'deposit', 'withdrawal'));
          end if;
        end $$;
    `);
}

async function createDatabaseDepositRequest(auth, body = {}) {
    const assetSymbol = normalizeDepositAssetSymbol(body.asset);
    const network = normalizeDepositNetwork(assetSymbol, body.network);
    const requestedFresh = body.fresh !== false;
    const client = await dbPool.connect();

    try {
        await client.query("begin");
        await ensureDepositTables(client);
        const context = await getPracticeDbContext(client, auth.profileId, "live");
        const route = await resolveDatabaseDepositRoute(client, auth.profileId, assetSymbol, network, requestedFresh);
        const expiresAt = new Date(Date.now() + DEPOSIT_ADDRESS_TTL_HOURS * 60 * 60 * 1000).toISOString();
        let addressId = null;

        if (route.address) {
            const addressResult = await client.query(`
                insert into crypto_deposit_addresses (
                  profile_id, asset_symbol, network, address, route_type, provider, status, metadata
                )
                values ($1, $2, $3, $4, $5, $6, 'active', $7::jsonb)
                on conflict (profile_id, asset_symbol, network, address) do update
                set last_issued_at = now(),
                    route_type = excluded.route_type,
                    provider = excluded.provider,
                    status = 'active'
                returning id
            `, [
                auth.profileId,
                assetSymbol,
                network,
                route.address,
                route.routeType,
                route.provider,
                JSON.stringify({
                    envName: route.envName || null,
                    uniqueAddress: route.uniqueAddress,
                    ...(route.metadata || {})
                })
            ]);
            addressId = addressResult.rows[0]?.id || null;
        }

        const requestResult = await client.query(`
            insert into crypto_deposit_requests (
              profile_id, account_mode_id, address_id, asset_symbol, network, address,
              provider, route_type, status, requested_fresh, warnings, expires_at
            )
            values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12)
            returning id, asset_symbol, network, address, provider, route_type, status, requested_fresh,
                      warnings, created_at, expires_at
        `, [
            auth.profileId,
            context.account_mode_id,
            addressId,
            assetSymbol,
            network,
            route.address || null,
            route.provider,
            route.routeType,
            route.status,
            requestedFresh,
            JSON.stringify(route.warnings || []),
            route.address ? expiresAt : null
        ]);

        await client.query("commit");
        const row = requestResult.rows[0];
        return {
            id: row.id,
            asset: row.asset_symbol,
            assetName: LIVE_DEPOSIT_ASSETS[assetSymbol]?.name || assetSymbol,
            network: row.network,
            address: row.address || "",
            provider: row.provider,
            routeType: row.route_type,
            status: row.status,
            requestedFresh: row.requested_fresh,
            warnings: Array.isArray(row.warnings) ? row.warnings : route.warnings || [],
            custodyConnected: route.custodyConnected,
            uniqueAddress: route.uniqueAddress,
            directTreasury: isDirectTreasuryRouteType(route.routeType),
            sweepRequired: route.routeType === "self_custody_hd",
            routeMode: depositRouteMode(),
            createdAt: row.created_at,
            expiresAt: row.expires_at
        };
    } catch (err) {
        await client.query("rollback").catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

function createJsonDepositRequest(auth, body = {}) {
    const assetSymbol = normalizeDepositAssetSymbol(body.asset);
    const network = normalizeDepositNetwork(assetSymbol, body.network);
    const requestedFresh = body.fresh !== false;
    const db = loadDemoDb();
    const route = resolveJsonDepositRoute(db, auth.userId, assetSymbol, network, requestedFresh);
    const now = new Date().toISOString();
    const expiresAt = route.address
        ? new Date(Date.now() + DEPOSIT_ADDRESS_TTL_HOURS * 60 * 60 * 1000).toISOString()
        : null;
    const request = {
        id: crypto.randomUUID(),
        userId: auth.userId,
        asset: assetSymbol,
        assetName: LIVE_DEPOSIT_ASSETS[assetSymbol]?.name || assetSymbol,
        network,
        address: route.address || "",
        provider: route.provider,
        routeType: route.routeType,
        status: route.status,
        requestedFresh,
        warnings: route.warnings || [],
        custodyConnected: route.custodyConnected,
        uniqueAddress: route.uniqueAddress,
        directTreasury: isDirectTreasuryRouteType(route.routeType),
        sweepRequired: route.routeType === "self_custody_hd",
        routeMode: depositRouteMode(),
        createdAt: now,
        expiresAt
    };
    db.depositRequests = db.depositRequests || {};
    db.depositRequests[auth.userId] = [request, ...(db.depositRequests[auth.userId] || [])].slice(0, 50);
    saveDemoDb(db);
    return request;
}

async function createLiveDepositRequest(auth, body = {}) {
    if (auth.source === "supabase") return createDatabaseDepositRequest(auth, body);
    return createJsonDepositRequest(auth, body);
}

function normalizeFiatFundingMethod(method) {
    const raw = String(method || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
    const aliases = {
        debit: "card",
        debit_card: "card",
        credit: "card",
        credit_card: "card",
        bank: "ach",
        bank_link: "ach",
        bank_transfer: "ach"
    };
    const normalized = aliases[raw] || raw;
    if (!FIAT_FUNDING_METHODS.has(normalized)) {
        throw demoTradeError(400, "Choose debit card, ACH, or wire.");
    }
    return normalized;
}

function normalizeFiatFundingAmount(value, method) {
    if (value == null || value === "") return 0;
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0) {
        throw demoTradeError(400, "Enter a valid USD amount.");
    }
    if ((method === "card" || method === "ach") && amount <= 0) {
        throw demoTradeError(400, "Enter a USD amount to start this funding request.");
    }
    return Math.round(amount * 100) / 100;
}

function estimateFiatFundingFee(method, amountUsd) {
    if (!amountUsd) return 0;
    if (method === "card") return Math.round(((amountUsd * 0.039) + 0.3) * 100) / 100;
    if (method === "ach") return Math.round(Math.min(amountUsd * 0.01, 5) * 100) / 100;
    return 0;
}

function fiatFundingStatus(method) {
    if (method === "wire") return "instructions_pending";
    return "provider_pending";
}

function fiatFundingReference(method) {
    return `AUTODY-${String(method || "fund").toUpperCase()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

function mapFiatFundingRequest(row) {
    return {
        id: row.id,
        method: row.method,
        label: FIAT_FUNDING_LABELS[row.method] || row.method,
        status: row.status,
        amountUsd: numberValue(row.amount_usd, 0),
        feeUsd: numberValue(row.fee_usd, 0),
        netUsd: numberValue(row.net_usd, 0),
        referenceCode: row.reference_code,
        provider: row.provider,
        metadata: row.metadata || {},
        checkoutUrl: row.metadata?.checkoutUrl || "",
        processorConfigured: Boolean(row.metadata?.processorConfigured),
        processorStatus: row.metadata?.processorStatus || "",
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

async function ensureFiatFundingTables(client = dbPool) {
    await client.query(`
        do $$
        begin
          if to_regclass('fiat_funding_requests') is not null then
            execute 'update fiat_funding_requests
              set method = ''wire'',
                  status = ''instructions_pending'',
                  updated_at = now()
              where method = ''direct''';
          end if;
        end $$;

        create table if not exists fiat_funding_requests (
          id uuid primary key default gen_random_uuid(),
          profile_id uuid not null references profiles(id) on delete cascade,
          account_mode_id uuid references account_modes(id) on delete cascade,
          method text not null check (method in ('card', 'ach', 'wire')),
          status text not null default 'provider_pending',
          amount_usd numeric(18, 2) not null default 0,
          fee_usd numeric(18, 2) not null default 0,
          net_usd numeric(18, 2) not null default 0,
          reference_code text not null unique,
          provider text not null default 'pending',
          metadata jsonb not null default '{}'::jsonb,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now(),
          settled_at timestamptz
        );

        create index if not exists fiat_funding_requests_profile_idx
          on fiat_funding_requests (profile_id, created_at desc);

        do $$
        begin
          if exists (
            select 1
            from pg_constraint
            where conname = 'fiat_funding_requests_method_check'
              and conrelid = 'fiat_funding_requests'::regclass
          ) then
            alter table fiat_funding_requests drop constraint fiat_funding_requests_method_check;
          end if;

          alter table fiat_funding_requests
            add constraint fiat_funding_requests_method_check
            check (method in ('card', 'ach', 'wire'));
        end $$;
    `);
}

async function createDatabaseFiatFundingRequest(auth, body = {}) {
    const method = normalizeFiatFundingMethod(body.method);
    const amountUsd = normalizeFiatFundingAmount(body.amountUsd ?? body.amount, method);
    const feeUsd = estimateFiatFundingFee(method, amountUsd);
    const netUsd = Math.max(0, Math.round((amountUsd - feeUsd) * 100) / 100);
    const metadata = {
        fundingSource: normalizeText(body.fundingSource || body.source || ""),
        transferSpeed: normalizeText(body.transferSpeed || ""),
        note: normalizeText(body.note || ""),
        providerConnected: false
    };
    const client = await dbPool.connect();

    try {
        await client.query("begin");
        await ensureFiatFundingTables(client);
        const context = await getPracticeDbContext(client, auth.profileId, "live");
        const result = await client.query(`
            insert into fiat_funding_requests (
              profile_id, account_mode_id, method, status, amount_usd, fee_usd, net_usd,
              reference_code, provider, metadata
            )
            values ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9::jsonb)
            returning *
        `, [
            auth.profileId,
            context.account_mode_id,
            method,
            fiatFundingStatus(method),
            amountUsd,
            feeUsd,
            netUsd,
            fiatFundingReference(method),
            JSON.stringify(metadata)
        ]);
        await client.query("commit");
        return mapFiatFundingRequest(result.rows[0]);
    } catch (err) {
        await client.query("rollback").catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

function createJsonFiatFundingRequest(auth, body = {}) {
    const method = normalizeFiatFundingMethod(body.method);
    const amountUsd = normalizeFiatFundingAmount(body.amountUsd ?? body.amount, method);
    const feeUsd = estimateFiatFundingFee(method, amountUsd);
    const now = new Date().toISOString();
    const request = {
        id: crypto.randomUUID(),
        userId: auth.userId,
        method,
        label: FIAT_FUNDING_LABELS[method] || method,
        status: fiatFundingStatus(method),
        amountUsd,
        feeUsd,
        netUsd: Math.max(0, Math.round((amountUsd - feeUsd) * 100) / 100),
        referenceCode: fiatFundingReference(method),
        provider: "pending",
        metadata: {
            fundingSource: normalizeText(body.fundingSource || body.source || ""),
            transferSpeed: normalizeText(body.transferSpeed || ""),
            note: normalizeText(body.note || ""),
            providerConnected: false
        },
        createdAt: now,
        updatedAt: now
    };
    const db = loadDemoDb();
    db.fiatFundingRequests = db.fiatFundingRequests || {};
    db.fiatFundingRequests[auth.userId] = [request, ...(db.fiatFundingRequests[auth.userId] || [])].slice(0, 50);
    saveDemoDb(db);
    return request;
}

async function createLiveFiatFundingRequest(auth, body = {}) {
    if (auth.source === "supabase") return createDatabaseFiatFundingRequest(auth, body);
    return createJsonFiatFundingRequest(auth, body);
}

function appAbsoluteUrl(pathname, params = {}) {
    const base = String(APP_BASE_URL || "").trim().replace(/\/+$/, "");
    if (!base) return "";
    const url = new URL(pathname, `${base}/`);
    Object.entries(params).forEach(([key, value]) => {
        if (value != null && value !== "") url.searchParams.set(key, String(value));
    });
    return url.toString();
}

function stripeFundingConfigured() {
    return Boolean(STRIPE_SECRET_KEY && APP_BASE_URL);
}

function stripePaymentMethodForFunding(method) {
    if (method === "ach") return "us_bank_account";
    if (method === "card") return "card";
    return "";
}

async function createStripeFundingCheckout(auth, request) {
    const paymentMethodType = stripePaymentMethodForFunding(request.method);
    if (!paymentMethodType) return null;
    if (!stripeFundingConfigured()) {
        return {
            provider: "stripe",
            configured: false,
            processorStatus: "not_configured",
            message: "Stripe funding is not configured yet."
        };
    }

    const amountCents = Math.round(numberValue(request.amountUsd, 0) * 100);
    if (amountCents <= 0) throw demoTradeError(400, "Enter a USD amount to start this funding request.");

    const successUrl = appAbsoluteUrl("account-wallet.html", {
        funding: "success",
        reference: request.referenceCode
    });
    const cancelUrl = appAbsoluteUrl("account-wallet.html", {
        funding: "cancelled",
        reference: request.referenceCode
    });
    if (!successUrl || !cancelUrl) {
        return {
            provider: "stripe",
            configured: false,
            processorStatus: "missing_return_url",
            message: "APP_BASE_URL is required before checkout can open."
        };
    }

    const params = new URLSearchParams();
    params.append("mode", "payment");
    params.append("success_url", successUrl);
    params.append("cancel_url", cancelUrl);
    params.append("payment_method_types[]", paymentMethodType);
    params.append("line_items[0][price_data][currency]", "usd");
    params.append("line_items[0][price_data][unit_amount]", String(amountCents));
    params.append("line_items[0][price_data][product_data][name]", `${request.label} Autody USD funding`);
    params.append("line_items[0][quantity]", "1");
    params.append("client_reference_id", request.referenceCode);
    params.append("metadata[profile_id]", auth.profileId || auth.userId || "");
    params.append("metadata[email]", auth.user?.email || "");
    params.append("metadata[reference_code]", request.referenceCode || "");
    params.append("metadata[funding_method]", request.method || "");
    if (auth.user?.email) params.append("customer_email", auth.user.email);

    const response = await fetch(`${STRIPE_API_BASE}/checkout/sessions`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
            "Content-Type": "application/x-www-form-urlencoded"
        },
        body: params
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        const message = data?.error?.message || "Payment processor could not create checkout.";
        throw demoTradeError(502, message);
    }

    return {
        provider: "stripe",
        configured: true,
        checkoutUrl: data.url || "",
        checkoutSessionId: data.id || "",
        processorStatus: data.status || "checkout_created",
        message: "Checkout session created."
    };
}

async function prepareFiatPaymentProcessor(auth, request) {
    if (request.method === "wire") {
        return {
            provider: "wire",
            configured: false,
            processorStatus: "instructions_pending",
            message: "Wire funding request saved for manual instructions."
        };
    }

    if (FIAT_PAYMENT_PROCESSOR !== "stripe") {
        return {
            provider: FIAT_PAYMENT_PROCESSOR || "pending",
            configured: false,
            processorStatus: "processor_not_supported",
            message: `${FIAT_PAYMENT_PROCESSOR || "Payment"} processor is not connected in this build.`
        };
    }

    return createStripeFundingCheckout(auth, request);
}

async function updateDatabaseFiatFundingProcessor(requestId, processor = {}) {
    const result = await dbPool.query(`
        update fiat_funding_requests
        set provider = $2,
            status = case
              when $3 = 'checkout_created' or $3 = 'open' then 'checkout_pending'
              when $3 = 'not_configured' then 'provider_pending'
              when $3 = 'instructions_pending' then 'instructions_pending'
              else status
            end,
            metadata = metadata || $4::jsonb,
            updated_at = now()
        where id = $1
        returning *
    `, [
        requestId,
        processor.provider || "pending",
        processor.processorStatus || "",
        JSON.stringify({
            processorConfigured: Boolean(processor.configured),
            processorStatus: processor.processorStatus || "",
            checkoutUrl: processor.checkoutUrl || "",
            checkoutSessionId: processor.checkoutSessionId || "",
            processorMessage: processor.message || ""
        })
    ]);
    return result.rows[0] ? mapFiatFundingRequest(result.rows[0]) : null;
}

function updateJsonFiatFundingProcessor(auth, requestId, processor = {}) {
    const db = loadDemoDb();
    const requests = db.fiatFundingRequests?.[auth.userId] || [];
    const index = requests.findIndex((request) => request.id === requestId);
    if (index === -1) return null;
    requests[index] = {
        ...requests[index],
        provider: processor.provider || requests[index].provider || "pending",
        status: processor.processorStatus === "checkout_created" || processor.processorStatus === "open"
            ? "checkout_pending"
            : processor.processorStatus === "instructions_pending"
              ? "instructions_pending"
              : requests[index].status,
        metadata: {
            ...(requests[index].metadata || {}),
            processorConfigured: Boolean(processor.configured),
            processorStatus: processor.processorStatus || "",
            checkoutUrl: processor.checkoutUrl || "",
            checkoutSessionId: processor.checkoutSessionId || "",
            processorMessage: processor.message || ""
        },
        checkoutUrl: processor.checkoutUrl || "",
        processorConfigured: Boolean(processor.configured),
        processorStatus: processor.processorStatus || "",
        updatedAt: new Date().toISOString()
    };
    saveDemoDb(db);
    return requests[index];
}

async function updateFiatFundingProcessor(auth, request, processor = {}) {
    if (!request?.id) return request;
    if (auth.source === "supabase") {
        return await updateDatabaseFiatFundingProcessor(request.id, processor) || request;
    }
    return updateJsonFiatFundingProcessor(auth, request.id, processor) || request;
}

function stripeSignatureParts(header = "") {
    return String(header || "")
        .split(",")
        .map((part) => part.split("="))
        .reduce((acc, [key, value]) => {
            const name = String(key || "").trim();
            if (!name) return acc;
            acc[name] = acc[name] || [];
            acc[name].push(String(value || "").trim());
            return acc;
        }, {});
}

function verifyStripeWebhookPayload(req) {
    if (!STRIPE_WEBHOOK_SECRET) {
        throw demoTradeError(503, "Stripe webhook secret is not configured.");
    }
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body || ""), "utf8");
    const parts = stripeSignatureParts(req.headers["stripe-signature"]);
    const timestamp = parts.t?.[0];
    const signatures = parts.v1 || [];
    if (!timestamp || !signatures.length) throw demoTradeError(400, "Stripe signature is missing.");

    const payload = Buffer.concat([
        Buffer.from(`${timestamp}.`, "utf8"),
        rawBody
    ]);
    const expected = crypto
        .createHmac("sha256", STRIPE_WEBHOOK_SECRET)
        .update(payload)
        .digest("hex");

    const valid = signatures.some((signature) => {
        try {
            const left = Buffer.from(signature, "hex");
            const right = Buffer.from(expected, "hex");
            return left.length === right.length && crypto.timingSafeEqual(left, right);
        } catch (err) {
            return false;
        }
    });
    if (!valid) throw demoTradeError(400, "Stripe signature is invalid.");

    const ageSeconds = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
    if (!Number.isFinite(ageSeconds) || ageSeconds > 5 * 60) {
        throw demoTradeError(400, "Stripe signature is too old.");
    }

    return JSON.parse(rawBody.toString("utf8") || "{}");
}

function stripeEventFundingReference(event = {}) {
    const object = event?.data?.object || {};
    return normalizeText(
        object.client_reference_id
        || object.metadata?.reference_code
        || object.payment_intent?.metadata?.reference_code
        || ""
    );
}

function stripeEventProcessorReference(event = {}) {
    const object = event?.data?.object || {};
    return normalizeText(object.id || object.payment_intent || "");
}

function stripeEventSucceeded(event = {}) {
    const object = event?.data?.object || {};
    if (event.type === "checkout.session.completed") return object.payment_status === "paid";
    if (event.type === "checkout.session.async_payment_succeeded") return true;
    if (event.type === "payment_intent.succeeded") return true;
    return false;
}

function stripeEventFailed(event = {}) {
    return event?.type === "checkout.session.async_payment_failed"
        || event?.type === "payment_intent.payment_failed";
}

async function markDatabaseFiatFundingFailed(referenceCode, event = {}) {
    if (!referenceCode) return null;
    const result = await dbPool.query(`
        update fiat_funding_requests
        set status = 'failed',
            metadata = metadata || $2::jsonb,
            updated_at = now()
        where reference_code = $1
          and settled_at is null
        returning *
    `, [
        referenceCode,
        JSON.stringify({
            processorStatus: "failed",
            processorEventId: event.id || "",
            processorEventType: event.type || ""
        })
    ]);
    return result.rows[0] ? mapFiatFundingRequest(result.rows[0]) : null;
}

async function settleDatabaseFiatFundingRequest(referenceCode, event = {}) {
    if (!referenceCode) throw demoTradeError(400, "Funding reference is missing.");
    const client = await dbPool.connect();
    try {
        await client.query("begin");
        const requestResult = await client.query(`
            select *
            from fiat_funding_requests
            where reference_code = $1
            for update
        `, [referenceCode]);
        const request = requestResult.rows[0];
        if (!request) {
            await client.query("commit");
            return { credited: false, reason: "request_not_found", referenceCode };
        }
        if (request.settled_at) {
            await client.query("commit");
            return {
                credited: false,
                duplicate: true,
                request: mapFiatFundingRequest(request)
            };
        }
        if (!["card", "ach"].includes(request.method)) {
            await client.query("commit");
            return {
                credited: false,
                reason: "manual_method",
                request: mapFiatFundingRequest(request)
            };
        }

        const walletResult = await client.query(`
            select id
            from wallets
            where account_mode_id = $1
            for update
        `, [request.account_mode_id]);
        const walletId = walletResult.rows[0]?.id;
        if (!walletId) throw demoTradeError(404, "Live wallet was not found for this funding request.");

        const creditAmount = numberValue(request.net_usd, 0);
        if (creditAmount <= 0) throw demoTradeError(400, "Funding request has no net USD to credit.");
        await adjustDbCash(client, walletId, creditAmount);

        const updateResult = await client.query(`
            update fiat_funding_requests
            set status = 'settled',
                provider = 'stripe',
                metadata = metadata || $2::jsonb,
                settled_at = now(),
                updated_at = now()
            where id = $1
            returning *
        `, [
            request.id,
            JSON.stringify({
                processorStatus: "paid",
                processorEventId: event.id || "",
                processorEventType: event.type || "",
                processorReference: stripeEventProcessorReference(event),
                creditedUsd: creditAmount
            })
        ]);

        await client.query("commit");
        return {
            credited: true,
            amountUsd: creditAmount,
            request: mapFiatFundingRequest(updateResult.rows[0])
        };
    } catch (err) {
        await client.query("rollback").catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

async function handleStripeFundingWebhook(event = {}) {
    const referenceCode = stripeEventFundingReference(event);
    if (!referenceCode) return { ignored: true, reason: "missing_reference" };
    if (stripeEventSucceeded(event)) {
        return await settleDatabaseFiatFundingRequest(referenceCode, event);
    }
    if (stripeEventFailed(event)) {
        return await markDatabaseFiatFundingFailed(referenceCode, event);
    }
    return { ignored: true, eventType: event.type, referenceCode };
}

const evmDepositProviderCache = new Map();
const ERC20_TRANSFER_TOPIC = ethers.id("Transfer(address,address,uint256)");
const ERC20_TRANSFER_INTERFACE = new ethers.Interface([
    "event Transfer(address indexed from, address indexed to, uint256 value)"
]);
const ERC20_SWEEP_ABI = [
    "function balanceOf(address account) view returns (uint256)",
    "function transfer(address to, uint256 amount) returns (bool)"
];
const STABLE_DEPOSIT_ASSETS = new Set(["USDT", "USDC", "DAI", "PYUSD", "FDUSD", "TUSD"]);

function getEvmDepositProvider(network) {
    const config = getEvmNetworkConfig(network);
    if (!config) return null;
    const rpcUrl = getDepositRpcUrl(config);
    if (!rpcUrl) return null;
    const cacheKey = `${config.scannerKey}:${rpcUrl}`;
    if (!evmDepositProviderCache.has(cacheKey)) {
        evmDepositProviderCache.set(cacheKey, new ethers.JsonRpcProvider(rpcUrl));
    }
    return {
        provider: evmDepositProviderCache.get(cacheKey),
        config,
        rpcUrl
    };
}

function numericBlockOption(value) {
    if (value == null || value === "") return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : null;
}

function hasDepositScanBlockOverride(options = {}) {
    return numericBlockOption(options.fromBlock) != null || numericBlockOption(options.toBlock) != null;
}

function buildDepositScanWindowOverride({ scanKey, network, assetSymbol = null, scanner, latestBlock, lookbackBlocks, maxBlocks = null, options = {} }) {
    const safeToBlock = Math.max(0, latestBlock - DEPOSIT_MIN_CONFIRMATIONS + 1);
    if (safeToBlock <= 0) return null;

    let fromBlock = numericBlockOption(options.fromBlock);
    let toBlock = numericBlockOption(options.toBlock);
    if (fromBlock == null) fromBlock = Math.max(0, safeToBlock - Math.max(1, lookbackBlocks));
    if (toBlock == null) toBlock = safeToBlock;
    toBlock = Math.min(toBlock, safeToBlock);

    if (maxBlocks && toBlock - fromBlock + 1 > maxBlocks) {
        fromBlock = Math.max(0, toBlock - maxBlocks + 1);
    }

    if (fromBlock > toBlock) return null;

    return {
        scanKey,
        network,
        assetSymbol,
        scanner,
        fromBlock,
        toBlock,
        latestBlock,
        manualOverride: true
    };
}

async function getDepositScanWindow(client, { scanKey, network, assetSymbol = null, scanner, latestBlock, lookbackBlocks, maxBlocks = null, overlapBlocks = 0 }) {
    const safeToBlock = Math.max(0, latestBlock - DEPOSIT_MIN_CONFIRMATIONS + 1);
    if (safeToBlock <= 0) return null;

    const stateResult = await client.query(`
        select last_scanned_block
        from crypto_deposit_scan_state
        where scan_key = $1
        limit 1
    `, [scanKey]);
    const lastScanned = Number(stateResult.rows[0]?.last_scanned_block || 0);
    let fromBlock = lastScanned > 0
        ? Math.max(0, lastScanned - Math.max(0, Number(overlapBlocks || 0)) + 1)
        : Math.max(0, safeToBlock - Math.max(1, lookbackBlocks));

    if (maxBlocks && safeToBlock - fromBlock + 1 > maxBlocks) {
        fromBlock = safeToBlock - maxBlocks + 1;
    }

    if (fromBlock > safeToBlock) return null;

    return {
        scanKey,
        network,
        assetSymbol,
        scanner,
        fromBlock,
        toBlock: safeToBlock,
        latestBlock
    };
}

async function saveDepositScanState(client, window) {
    if (!window?.scanKey || window.toBlock == null) return;
    await client.query(`
        insert into crypto_deposit_scan_state (scan_key, network, asset_symbol, scanner, last_scanned_block, updated_at)
        values ($1, $2, $3, $4, $5, now())
        on conflict (scan_key) do update
        set last_scanned_block = greatest(crypto_deposit_scan_state.last_scanned_block, excluded.last_scanned_block),
            updated_at = now()
    `, [window.scanKey, window.network, window.assetSymbol, window.scanner, window.toBlock]);
}

async function resolveDepositCreditAsset(symbol, priceHint = null) {
    const lookup = normalizeTradeSymbol(symbol);
    const marketAsset = await findMarketAssetBySymbol(lookup).catch(() => null);
    const stableFallback = STABLE_DEPOSIT_ASSETS.has(lookup) ? 1 : null;
    const price = firstPositive(marketAsset?.price, priceHint, stableFallback) || 0;
    const assetType = marketAsset?.assetType || marketAsset?.asset_type || marketAsset?.type
        || (lookup === "AU" ? "currency" : LIVE_DEPOSIT_ASSETS[lookup] ? "crypto" : "asset");

    return {
        ...(marketAsset || {}),
        symbol: lookup,
        name: marketAsset?.name || LIVE_DEPOSIT_ASSETS[lookup]?.name || lookup,
        assetType,
        price
    };
}

async function creditDatabaseDepositHolding(client, addressRow, detection) {
    const amount = numberValue(detection.amount, 0);
    if (amount <= 0) throw demoTradeError(400, "Deposit amount must be greater than zero.");

    const context = await getPracticeDbContext(client, addressRow.profile_id, "live");
    const assetSymbol = normalizeTradeSymbol(addressRow.asset_symbol);
    if (assetSymbol === "USD") {
        const creditUsd = firstPositive(detection.amountUsd, amount) || amount;
        const nextCash = await adjustDbCash(client, context.wallet_id, creditUsd);
        await client.query(`
            insert into orders (account_mode_id, symbol, asset_type, side, order_type, status, quantity, notional_usd, filled_price, filled_at)
            values ($1, 'USD', 'cash', 'deposit', 'manual_credit', 'filled', $2, $2, 1, now())
        `, [context.account_mode_id, creditUsd]);

        return {
            walletId: context.wallet_id,
            accountModeId: context.account_mode_id,
            amount: creditUsd,
            price: 1,
            notionalUsd: creditUsd,
            nextQuantity: Number(nextCash) || 0
        };
    }

    const priceHint = amount > 0 && detection.amountUsd != null
        ? Number(detection.amountUsd) / amount
        : null;
    const asset = await resolveDepositCreditAsset(addressRow.asset_symbol, priceHint);
    const price = firstPositive(asset.price, priceHint) || 0;
    const existing = await readDbHoldingForUpdate(client, context.wallet_id, asset.symbol);
    const currentQuantity = numberValue(existing?.quantity, 0);
    const currentAverage = firstPositive(existing?.average_cost, existing?.last_price, price) || price;
    const nextQuantity = currentQuantity + amount;
    const notionalUsd = price > 0 ? amount * price : numberValue(detection.amountUsd, 0);
    const nextAverage = nextQuantity > 0
        ? ((currentQuantity * currentAverage) + Math.max(0, notionalUsd)) / nextQuantity
        : price;

    await saveDbHolding(client, context.wallet_id, {
        ...asset,
        name: existing?.asset_name || asset.name,
        assetType: existing?.asset_type || asset.assetType
    }, nextQuantity, nextAverage, price);

    await client.query(`
        insert into orders (account_mode_id, symbol, asset_type, side, order_type, status, quantity, notional_usd, filled_price, filled_at)
        values ($1, $2, $3, 'deposit', 'crypto_deposit', 'filled', $4, $5, $6, now())
    `, [
        context.account_mode_id,
        asset.symbol,
        tradeAssetType(asset),
        amount,
        notionalUsd,
        price || null
    ]);

    return {
        walletId: context.wallet_id,
        accountModeId: context.account_mode_id,
        amount,
        price,
        notionalUsd,
        nextQuantity
    };
}

async function latestDepositRequestForAddress(client, addressRow) {
    const result = await client.query(`
        select id
        from crypto_deposit_requests
        where address_id = $1
           or (profile_id = $2 and address = $3 and asset_symbol = $4 and network = $5)
        order by created_at desc
        limit 1
    `, [
        addressRow.id,
        addressRow.profile_id,
        addressRow.address,
        addressRow.asset_symbol,
        addressRow.network
    ]);
    return result.rows[0]?.id || null;
}

async function duplicateDepositEventDetails(client, eventId) {
    if (!eventId) return null;
    const result = await client.query(`
        select
            e.id,
            e.profile_id,
            p.email,
            e.asset_symbol,
            e.network,
            e.address,
            e.tx_hash,
            e.log_index,
            e.block_number,
            e.amount,
            e.amount_usd,
            e.confirmations,
            e.status,
            e.credited_at,
            a.provider as address_provider,
            a.route_type as address_route_type,
            a.metadata as address_metadata,
            h.quantity as holding_quantity,
            h.value_usd as holding_value_usd,
            h.updated_at as holding_updated_at
        from crypto_deposit_events e
        join profiles p on p.id = e.profile_id
        left join crypto_deposit_addresses a on a.id = e.address_id
        left join account_modes am on am.profile_id = e.profile_id and am.mode = 'live'
        left join wallets w on w.account_mode_id = am.id
        left join holdings h on h.wallet_id = w.id and upper(h.symbol) = upper(e.asset_symbol)
        where e.id = $1
        limit 1
    `, [eventId]);
    const row = result.rows[0];
    if (!row) return null;
    return {
        eventId: row.id,
        profileId: row.profile_id,
        email: row.email,
        symbol: row.asset_symbol,
        network: row.network,
        address: row.address,
        txHash: row.tx_hash,
        logIndex: row.log_index == null ? null : Number(row.log_index),
        blockNumber: row.block_number == null ? null : Number(row.block_number),
        amount: numberValue(row.amount, 0),
        amountUsd: row.amount_usd == null ? null : numberValue(row.amount_usd, 0),
        confirmations: numberValue(row.confirmations, 0),
        status: row.status,
        creditedAt: row.credited_at,
        routeType: row.address_route_type || null,
        provider: row.address_provider || null,
        derivationIndex: row.address_metadata?.derivationIndex ?? null,
        derivationPath: row.address_metadata?.derivationPath || null,
        holdingQuantity: row.holding_quantity == null ? 0 : numberValue(row.holding_quantity, 0),
        holdingValueUsd: row.holding_value_usd == null ? 0 : numberValue(row.holding_value_usd, 0),
        holdingUpdatedAt: row.holding_updated_at || null
    };
}

function formatNativeAmount(value) {
    try {
        return ethers.formatEther(value || 0n);
    } catch (err) {
        return "0";
    }
}

function safeBigInt(value, fallback = 0n) {
    try {
        if (typeof value === "bigint") return value;
        if (value == null || value === "") return fallback;
        return BigInt(value);
    } catch (err) {
        return fallback;
    }
}

async function estimateEvmSweepGas(contract, destination, amountRaw) {
    try {
        const estimated = await contract.transfer.estimateGas(destination, amountRaw);
        return estimated > 0n ? estimated : DEPOSIT_SWEEP_GAS_LIMIT;
    } catch (err) {
        return DEPOSIT_SWEEP_GAS_LIMIT;
    }
}

async function sweepDatabaseDepositAddress(body = {}) {
    if (!databaseConfigured()) {
        return { success: false, configured: false, error: "Database is not configured." };
    }

    const requestedAddress = String(body.address || "").trim();
    const assetSymbol = normalizeDepositAssetSymbol(body.asset || body.symbol);
    const network = normalizeDepositNetwork(assetSymbol, body.network);
    if (!requestedAddress) throw demoTradeError(400, "Provide the generated deposit address to sweep.");

    const client = await dbPool.connect();
    try {
        await ensureDepositTables(client);
        const params = [requestedAddress.toLowerCase(), assetSymbol, network.toLowerCase()];
        const result = await client.query(`
            select id, profile_id, asset_symbol, network, address, provider, route_type, status, metadata, last_issued_at
            from crypto_deposit_addresses
            where lower(address) = $1
              and upper(asset_symbol) = $2
              and lower(network) = $3
            order by last_issued_at desc
            limit 1
        `, params);
        const row = result.rows[0];
        if (!row) throw demoTradeError(404, "Deposit address was not found in Autody records.");

        if (isDirectTreasuryRouteType(row.route_type)) {
            return {
                success: true,
                configured: true,
                sweepRequired: false,
                executable: false,
                asset: assetSymbol,
                network,
                address: row.address,
                routeType: row.route_type,
                provider: row.provider,
                message: "This is a direct treasury route. Funds sent here already land in the treasury wallet, so no child-address sweep is required."
            };
        }

        const networkConfig = getEvmNetworkConfig(network);
        if (!networkConfig) {
            throw demoTradeError(400, "Automated sweeping is currently available for EVM deposit networks only.");
        }

        const token = getEvmTokenDepositContract(assetSymbol, network);
        const nativeAsset = (networkConfig.nativeAssets || []).map((item) => normalizeTradeSymbol(item));
        const isNative = nativeAsset.includes(assetSymbol);
        if (!token && !isNative) {
            throw demoTradeError(400, `No sweep contract is configured for ${assetSymbol} on ${network}.`);
        }

        const treasury = resolveSweepTreasuryAddress(network, body);
        if (!treasury.address) {
            return {
                success: false,
                configured: false,
                error: "Treasury sweep address is not configured.",
                setEnv: sweepTreasuryAddressEnvCandidates(network)[0],
                acceptedFallbacks: sweepTreasuryAddressEnvCandidates(network)
            };
        }

        const providerConfig = getEvmDepositProvider(network);
        if (!providerConfig?.provider) {
            throw demoTradeError(500, `No RPC provider is configured for ${network}.`);
        }

        if (row.route_type !== "self_custody_hd") throw demoTradeError(400, "Only generated self-custody deposit addresses can be swept.");

        const metadata = normalizeDepositMetadata(row.metadata);
        const derivationIndex = Number(metadata.derivationIndex);
        if (!Number.isInteger(derivationIndex) || derivationIndex < 0) {
            throw demoTradeError(400, "This deposit address does not have a derivation index.");
        }

        const signer = deriveEvmDepositWallet(derivationIndex, providerConfig.provider);
        if (!signer?.address) throw demoTradeError(500, "Could not derive the deposit signer from the configured seed phrase.");
        const signerAddress = ethers.getAddress(signer.address);
        const depositAddress = ethers.getAddress(row.address);
        if (signerAddress !== depositAddress) {
            throw demoTradeError(409, "Configured seed phrase does not match this deposit address.");
        }

        const nativeSymbol = networkConfig.nativeAssets?.[0] || "native";
        const nativeBalance = await providerConfig.provider.getBalance(depositAddress);
        const feeData = await providerConfig.provider.getFeeData();
        const gasPrice = safeBigInt(feeData.gasPrice || feeData.maxFeePerGas, 0n);

        if (token) {
            const contract = new ethers.Contract(token.address, ERC20_SWEEP_ABI, signer);
            const tokenBalance = await contract.balanceOf(depositAddress);
            const amountRaw = body.amount
                ? ethers.parseUnits(String(body.amount), token.decimals)
                : tokenBalance;
            if (amountRaw <= 0n || tokenBalance <= 0n) {
                return {
                    success: false,
                    configured: true,
                    error: `No ${assetSymbol} balance is available to sweep from this address.`,
                    address: depositAddress,
                    balance: ethers.formatUnits(tokenBalance, token.decimals)
                };
            }
            if (amountRaw > tokenBalance) {
                throw demoTradeError(400, `Sweep amount is greater than the ${assetSymbol} balance.`);
            }

            const gasLimit = await estimateEvmSweepGas(contract, treasury.address, amountRaw);
            const requiredGas = gasPrice > 0n ? gasLimit * gasPrice : 0n;
            const gasReady = requiredGas === 0n || nativeBalance >= requiredGas;
            const base = {
                success: gasReady,
                configured: true,
                executable: gasReady,
                asset: assetSymbol,
                network,
                address: depositAddress,
                treasuryAddress: treasury.address,
                treasurySource: treasury.source,
                derivationIndex,
                derivationPath: metadata.derivationPath || `${EVM_DEPOSIT_BASE_PATH}/${derivationIndex}`,
                tokenBalance: ethers.formatUnits(tokenBalance, token.decimals),
                sweepAmount: ethers.formatUnits(amountRaw, token.decimals),
                nativeGasAsset: nativeSymbol,
                nativeGasBalance: formatNativeAmount(nativeBalance),
                estimatedGasLimit: gasLimit.toString(),
                estimatedGasCost: formatNativeAmount(requiredGas),
                needsGas: !gasReady
            };

            if (!gasReady) {
                return {
                    ...base,
                    success: false,
                    error: `Send a small amount of ${nativeSymbol} to the generated deposit address before sweeping ${assetSymbol}.`,
                    gasDepositAddress: depositAddress
                };
            }

            const execute = body.execute === true || body.dryRun === false;
            if (!execute) {
                return {
                    ...base,
                    success: true,
                    dryRun: true,
                    message: "Sweep is ready. Send the same request with execute=true to submit the transfer."
                };
            }

            const tx = await contract.transfer(treasury.address, amountRaw);
            return {
                ...base,
                success: true,
                dryRun: false,
                txHash: tx.hash,
                status: "submitted"
            };
        }

        const gasLimit = 21000n;
        const requiredGas = gasPrice > 0n ? gasLimit * gasPrice : 0n;
        const requestedRaw = body.amount ? ethers.parseEther(String(body.amount)) : null;
        const sweepableRaw = nativeBalance > requiredGas ? nativeBalance - requiredGas : 0n;
        const amountRaw = requestedRaw == null ? sweepableRaw : requestedRaw;
        if (amountRaw <= 0n || amountRaw + requiredGas > nativeBalance) {
            return {
                success: false,
                configured: true,
                error: `Not enough ${nativeSymbol} balance to sweep after gas.`,
                asset: assetSymbol,
                network,
                address: depositAddress,
                treasuryAddress: treasury.address,
                nativeGasAsset: nativeSymbol,
                nativeGasBalance: formatNativeAmount(nativeBalance),
                estimatedGasCost: formatNativeAmount(requiredGas),
                needsGas: true,
                gasDepositAddress: depositAddress
            };
        }

        const base = {
            success: true,
            configured: true,
            executable: true,
            asset: assetSymbol,
            network,
            address: depositAddress,
            treasuryAddress: treasury.address,
            treasurySource: treasury.source,
            derivationIndex,
            derivationPath: metadata.derivationPath || `${EVM_DEPOSIT_BASE_PATH}/${derivationIndex}`,
            sweepAmount: ethers.formatEther(amountRaw),
            nativeGasAsset: nativeSymbol,
            nativeGasBalance: formatNativeAmount(nativeBalance),
            estimatedGasLimit: gasLimit.toString(),
            estimatedGasCost: formatNativeAmount(requiredGas),
            needsGas: false
        };
        const execute = body.execute === true || body.dryRun === false;
        if (!execute) {
            return {
                ...base,
                dryRun: true,
                message: "Native sweep is ready. Send the same request with execute=true to submit the transfer."
            };
        }

        const tx = await signer.sendTransaction({ to: treasury.address, value: amountRaw });
        return {
            ...base,
            dryRun: false,
            txHash: tx.hash,
            status: "submitted"
        };
    } finally {
        client.release();
    }
}

async function recordAndCreditDatabaseDeposit(client, addressRow, detection) {
    const address = String(addressRow.address || detection.address || "").trim();
    const requestId = await latestDepositRequestForAddress(client, addressRow);
    const amount = numberValue(detection.amount, 0);
    const amountUsd = detection.amountUsd == null ? null : numberValue(detection.amountUsd, 0);
    const logIndex = detection.logIndex == null ? null : Number(detection.logIndex);

    const eventResult = await client.query(`
        insert into crypto_deposit_events (
          profile_id, address_id, request_id, asset_symbol, network, address, tx_hash, log_index,
          block_number, amount, amount_usd, confirmations, status, metadata, updated_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'detected', $13::jsonb, now())
        on conflict (network, tx_hash, asset_symbol, address, (coalesce(log_index, -1))) do update
        set confirmations = greatest(crypto_deposit_events.confirmations, excluded.confirmations),
            amount_usd = coalesce(crypto_deposit_events.amount_usd, excluded.amount_usd),
            updated_at = now()
        returning id, status, credited_at
    `, [
        addressRow.profile_id,
        addressRow.id,
        requestId,
        addressRow.asset_symbol,
        addressRow.network,
        address,
        detection.txHash,
        logIndex,
        detection.blockNumber || null,
        amount,
        amountUsd,
        Math.max(0, Number(detection.confirmations || 0)),
        JSON.stringify(detection.metadata || {})
    ]);

    const event = eventResult.rows[0];
    if (!event || event.credited_at || event.status === "credited") {
        return {
            credited: false,
            reason: "already credited",
            eventId: event?.id || null,
            duplicate: await duplicateDepositEventDetails(client, event?.id)
        };
    }

    const credit = await creditDatabaseDepositHolding(client, addressRow, { ...detection, amount, amountUsd });
    await client.query(`
        update crypto_deposit_events
        set status = 'credited',
            amount_usd = $2,
            credited_at = now(),
            updated_at = now()
        where id = $1
    `, [event.id, credit.notionalUsd]);

    if (requestId) {
        await client.query(`
            update crypto_deposit_requests
            set status = 'credited',
                amount_received = $2,
                amount_usd = $3,
                confirmations = greatest(confirmations, $4),
                tx_hash = $5,
                credited_at = coalesce(credited_at, now()),
                updated_at = now()
            where id = $1
        `, [
            requestId,
            amount,
            credit.notionalUsd,
            Math.max(0, Number(detection.confirmations || 0)),
            detection.txHash
        ]);
    }

    return {
        credited: true,
        eventId: event.id,
        symbol: addressRow.asset_symbol,
        network: addressRow.network,
        amount,
        amountUsd: credit.notionalUsd,
        txHash: detection.txHash
    };
}

async function creditDetectedDepositWithTransaction(client, addressRow, detection) {
    await client.query("begin");
    try {
        const result = await recordAndCreditDatabaseDeposit(client, addressRow, detection);
        await client.query("commit");
        return result;
    } catch (err) {
        await client.query("rollback").catch(() => {});
        throw err;
    }
}

function addDepositScanResult(summary, result) {
    if (result?.credited) {
        summary.credited.push(result);
        return;
    }
    summary.duplicates += 1;
    if (result?.duplicate) {
        if (!Array.isArray(summary.duplicateEvents)) summary.duplicateEvents = [];
        summary.duplicateEvents.push(result.duplicate);
    }
}

function activeDepositAddressGroups(rows = []) {
    const groups = {
        evmNative: new Map(),
        evmToken: new Map(),
        accountHistory: new Map(),
        unsupported: []
    };

    rows.forEach((row) => {
        const asset = normalizeTradeSymbol(row.asset_symbol);
        const network = String(row.network || "").trim();
        const config = getEvmNetworkConfig(network);
        if (!config) {
            const family = selfCustodyNetworkFamily(network);
            const accountConfig = getAccountDepositScannerConfig(asset, network, family);
            if (accountConfig) {
                const key = `${accountConfig.scanner}:${network}:${asset}`;
                if (!groups.accountHistory.has(key)) {
                    groups.accountHistory.set(key, { config: accountConfig, rows: [] });
                }
                groups.accountHistory.get(key).rows.push(row);
                return;
            }
            groups.unsupported.push(row);
            return;
        }

        if (isNativeEvmDepositAsset(asset, network)) {
            const key = network;
            groups.evmNative.set(key, [...(groups.evmNative.get(key) || []), row]);
            return;
        }

        if (getEvmTokenDepositContract(asset, network)) {
            const key = `${network}:${asset}`;
            groups.evmToken.set(key, [...(groups.evmToken.get(key) || []), row]);
            return;
        }

        groups.unsupported.push(row);
    });

    return groups;
}

function blockscoutAddressHash(value) {
    if (!value) return "";
    if (typeof value === "string") return normalizeEvmAddress(value);
    return normalizeEvmAddress(value.hash || value.address_hash || value.address || "");
}

function blockscoutTokenContract(value) {
    const token = value?.token || {};
    return normalizeEvmAddress(token.address_hash || token.address || value?.token_address || value?.tokenAddress || "");
}

function blockscoutTransferAmount(value, fallbackDecimals = 18) {
    const rawValue = firstPresent(value?.total?.value, value?.value, value?.amount);
    if (rawValue == null || rawValue === "") return 0;
    const decimals = Number(value?.total?.decimals ?? value?.token?.decimals ?? fallbackDecimals);
    const safeDecimals = Number.isFinite(decimals) ? decimals : fallbackDecimals;
    const rawText = String(rawValue).trim();
    if (/^\d+$/.test(rawText)) {
        try {
            return numberValue(ethers.formatUnits(BigInt(rawText), safeDecimals), 0);
        } catch (err) {
            return 0;
        }
    }
    return numberValue(rawText, 0);
}

function blockscoutTokenTransfersUrl(baseUrl, address, params = {}) {
    const url = new URL(`${baseUrl.replace(/\/+$/g, "")}/addresses/${encodeURIComponent(address)}/token-transfers`);
    url.searchParams.set("type", "ERC-20");
    Object.entries(params || {}).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== "") {
            url.searchParams.set(key, String(value));
        }
    });
    return url.toString();
}

async function scanEvmTokenDepositsFromBlockscout(client, config, contract, rows, summary, window, latestBlock) {
    const baseUrl = String(config?.blockscoutApiUrl || "").replace(/\/+$/g, "");
    if (!baseUrl) return false;

    const contractAddress = normalizeEvmAddress(contract.address);
    let detected = 0;

    for (const row of rows) {
        const rowAddress = normalizeEvmAddress(row.address);
        if (!rowAddress) continue;

        let url = blockscoutTokenTransfersUrl(baseUrl, rowAddress);
        for (let page = 0; page < 5 && url; page += 1) {
            const json = await fetchDepositJson(url);
            const items = Array.isArray(json?.items) ? json.items : [];
            for (const item of items) {
                const blockNumber = Number(item.block_number || item.blockNumber || 0);
                if (!Number.isFinite(blockNumber) || blockNumber < window.fromBlock || blockNumber > window.toBlock) {
                    continue;
                }

                const to = blockscoutAddressHash(item.to);
                const itemContract = blockscoutTokenContract(item);
                if (!to || to !== rowAddress || !itemContract || itemContract !== contractAddress) continue;

                const amount = blockscoutTransferAmount(item, contract.decimals);
                if (amount <= 0) continue;

                const confirmations = Math.max(0, latestBlock - blockNumber + 1);
                const result = await creditDetectedDepositWithTransaction(client, row, {
                    amount,
                    txHash: item.transaction_hash || item.transactionHash,
                    logIndex: Number(item.log_index ?? item.logIndex ?? 0),
                    blockNumber,
                    confirmations,
                    amountUsd: firstPositive(item.total?.usd_value, item.usd_value, item.value_usd),
                    metadata: {
                        scanner: "blockscout-token",
                        contract: contract.address,
                        tokenDecimals: contract.decimals,
                        from: blockscoutAddressHash(item.from),
                        to,
                        source: baseUrl
                    }
                });
                addDepositScanResult(summary, result);
                detected += 1;
            }

            const nextParams = json?.next_page_params;
            url = nextParams ? blockscoutTokenTransfersUrl(baseUrl, rowAddress, nextParams) : "";
        }
    }

    return detected >= 0;
}

async function scanEvmTokenDepositGroup(client, network, assetSymbol, rows, summary, options = {}) {
    const contract = getEvmTokenDepositContract(assetSymbol, network);
    const providerConfig = getEvmDepositProvider(network);
    if (!contract || !providerConfig) {
        summary.skipped.push({ network, asset: assetSymbol, reason: "scanner not configured" });
        return;
    }

    const { provider, config } = providerConfig;
    const latestBlock = await provider.getBlockNumber();
    const windowParams = {
        scanKey: `evm-token:${config.scannerKey}:${assetSymbol}`,
        network,
        assetSymbol,
        scanner: "evm-token",
        latestBlock,
        lookbackBlocks: DEPOSIT_EVM_LOG_LOOKBACK_BLOCKS
    };
    const window = hasDepositScanBlockOverride(options)
        ? buildDepositScanWindowOverride({ ...windowParams, options })
        : await getDepositScanWindow(client, {
            ...windowParams,
            overlapBlocks: DEPOSIT_EVM_SCAN_OVERLAP_BLOCKS
        });
    if (!window) return;

    const rowsByTopic = rows.reduce((map, row) => {
        const topicAddress = evmAddressTopic(row.address);
        if (!topicAddress) return map;
        if (!map.has(topicAddress)) map.set(topicAddress, []);
        map.get(topicAddress).push(row);
        return map;
    }, new Map());

    const addressTopics = Array.from(rowsByTopic.keys());
    if (!addressTopics.length) return;

    let logs = [];
    try {
        logs = await provider.getLogs({
            address: contract.address,
            fromBlock: window.fromBlock,
            toBlock: window.toBlock,
            topics: [ERC20_TRANSFER_TOPIC, null, addressTopics]
        });
    } catch (err) {
        if (config.blockscoutApiUrl) {
            try {
                await scanEvmTokenDepositsFromBlockscout(client, config, contract, rows, summary, window, latestBlock);
                if (!window.manualOverride) await saveDepositScanState(client, window);
                return;
            } catch (fallbackErr) {
                summary.errors.push({
                    network,
                    asset: assetSymbol,
                    scanner: "blockscout-token",
                    error: fallbackErr.message || String(fallbackErr)
                });
            }
        }
        throw err;
    }

    for (const log of logs) {
        const parsed = ERC20_TRANSFER_INTERFACE.parseLog(log);
        const topicAddress = evmAddressTopic(parsed.args.to);
        const matchingRows = rowsByTopic.get(topicAddress) || [];
        const amountText = ethers.formatUnits(parsed.args.value, contract.decimals);
        const amount = numberValue(amountText, 0);
        if (amount <= 0) continue;
        const confirmations = Math.max(0, latestBlock - Number(log.blockNumber || 0) + 1);
        for (const row of matchingRows) {
            const result = await creditDetectedDepositWithTransaction(client, row, {
                amount,
                txHash: log.transactionHash,
                logIndex: Number(log.index ?? log.logIndex ?? 0),
                blockNumber: Number(log.blockNumber || 0),
                confirmations,
                metadata: {
                    scanner: "evm-token",
                    contract: contract.address,
                    tokenDecimals: contract.decimals,
                    from: parsed.args.from,
                    to: parsed.args.to
                }
            });
            addDepositScanResult(summary, result);
        }
    }

    if (!window.manualOverride) await saveDepositScanState(client, window);
}

async function scanEvmNativeDepositGroup(client, network, rows, summary, options = {}) {
    const providerConfig = getEvmDepositProvider(network);
    if (!providerConfig) {
        summary.skipped.push({ network, asset: "native", reason: "scanner not configured" });
        return;
    }

    const { provider, config } = providerConfig;
    const latestBlock = await provider.getBlockNumber();
    const windowParams = {
        scanKey: `evm-native:${config.scannerKey}`,
        network,
        scanner: "evm-native",
        latestBlock,
        lookbackBlocks: DEPOSIT_NATIVE_LOOKBACK_BLOCKS,
        maxBlocks: DEPOSIT_NATIVE_BLOCK_SCAN_LIMIT
    };
    const window = hasDepositScanBlockOverride(options)
        ? buildDepositScanWindowOverride({ ...windowParams, options })
        : await getDepositScanWindow(client, {
            ...windowParams,
            overlapBlocks: DEPOSIT_EVM_SCAN_OVERLAP_BLOCKS
        });
    if (!window) return;

    const rowsByAddress = rows.reduce((map, row) => {
        const address = normalizeEvmAddress(row.address);
        if (!address) return map;
        if (!map.has(address)) map.set(address, []);
        map.get(address).push(row);
        return map;
    }, new Map());

    if (!rowsByAddress.size) return;

    for (let blockNumber = window.fromBlock; blockNumber <= window.toBlock; blockNumber += 1) {
        const block = await provider.getBlock(blockNumber, true);
        const transactions = Array.isArray(block?.prefetchedTransactions)
            ? block.prefetchedTransactions
            : (Array.isArray(block?.transactions) ? block.transactions.filter((tx) => typeof tx === "object") : []);
        for (const tx of transactions) {
            const to = normalizeEvmAddress(tx.to);
            if (!to || !rowsByAddress.has(to)) continue;
            const amount = numberValue(ethers.formatEther(tx.value || 0), 0);
            if (amount <= 0) continue;
            const confirmations = Math.max(0, latestBlock - blockNumber + 1);
            for (const row of rowsByAddress.get(to)) {
                const result = await creditDetectedDepositWithTransaction(client, row, {
                    amount,
                    txHash: tx.hash,
                    logIndex: null,
                    blockNumber,
                    confirmations,
                    metadata: {
                        scanner: "evm-native",
                        from: tx.from,
                        to
                    }
                });
                addDepositScanResult(summary, result);
            }
        }
    }

    if (!window.manualOverride) await saveDepositScanState(client, window);
}

function normalizeChainAddressForCompare(address = "") {
    return String(address || "")
        .trim()
        .toLowerCase()
        .replace(/^bitcoincash:/, "");
}

function chainAddressMatches(left = "", right = "") {
    return normalizeChainAddressForCompare(left) === normalizeChainAddressForCompare(right);
}

async function creditAccountHistoryDeposit(client, row, detection, summary) {
    const result = await creditDetectedDepositWithTransaction(client, row, detection);
    addDepositScanResult(summary, result);
}

function mempoolDepositOutputAmount(tx = {}, address = "") {
    return (tx.vout || []).reduce((sum, output) => {
        const outputAddress = output.scriptpubkey_address || output.scriptpubkeyAddress || output.address;
        if (!chainAddressMatches(outputAddress, address)) return sum;
        return sum + Math.max(0, Number(output.value || 0));
    }, 0);
}

async function scanMempoolUtxoDepositGroup(client, config, rows, summary) {
    const baseUrl = getDepositRestBaseUrl(config);
    if (!baseUrl) {
        summary.skipped.push({ asset: config.asset, network: config.networks?.[0], reason: "scanner endpoint not configured" });
        return;
    }

    const tipJson = await fetchDepositJson(`${baseUrl}/blocks/tip/height`);
    const tipHeight = Number(tipJson?.raw ?? tipJson);
    for (const row of rows) {
        try {
            const txs = await fetchDepositJson(`${baseUrl}/address/${encodeURIComponent(row.address)}/txs`);
            const transactions = Array.isArray(txs) ? txs : [];
            for (const tx of transactions.slice(0, DEPOSIT_ACCOUNT_TX_LIMIT)) {
                const txHash = normalizeText(tx.txid || tx.hash);
                const amountSmallestUnit = mempoolDepositOutputAmount(tx, row.address);
                if (!txHash || amountSmallestUnit <= 0) continue;
                const blockNumber = Number(tx.status?.block_height || 0);
                const confirmed = Boolean(tx.status?.confirmed && blockNumber);
                const confirmations = confirmed && Number.isFinite(tipHeight)
                    ? Math.max(0, tipHeight - blockNumber + 1)
                    : 0;
                if (confirmations < DEPOSIT_MIN_CONFIRMATIONS) continue;

                await creditAccountHistoryDeposit(client, row, {
                    amount: amountSmallestUnit / (10 ** config.decimals),
                    txHash,
                    logIndex: null,
                    blockNumber,
                    confirmations,
                    metadata: {
                        scanner: config.scanner,
                        outputUnit: "sats",
                        address: row.address
                    }
                }, summary);
            }
        } catch (err) {
            summary.errors.push({ network: row.network, asset: row.asset_symbol, scanner: config.scanner, address: row.address, error: err.message || String(err) });
        }
    }
}

function blockchairAddressTransactions(json = {}, address = "") {
    const data = json.data || {};
    const matchingKey = Object.keys(data).find((key) => chainAddressMatches(key, address)) || Object.keys(data)[0];
    const entry = matchingKey ? data[matchingKey] : null;
    const transactions = Array.isArray(entry?.transactions) ? entry.transactions : [];
    return transactions.filter((tx) => tx && typeof tx === "object");
}

async function scanBlockchairUtxoDepositGroup(client, config, rows, summary) {
    const baseUrl = getDepositRestBaseUrl(config);
    if (!baseUrl) {
        summary.skipped.push({ asset: config.asset, network: config.networks?.[0], reason: "scanner endpoint not configured" });
        return;
    }

    for (const row of rows) {
        try {
            const url = `${baseUrl}/dashboards/address/${encodeURIComponent(row.address)}?transaction_details=true&limit=${DEPOSIT_ACCOUNT_TX_LIMIT}`;
            const json = await fetchDepositJson(url);
            const transactions = blockchairAddressTransactions(json, row.address);
            for (const tx of transactions) {
                const txHash = normalizeText(tx.hash || tx.transaction_hash || tx.tx_hash);
                const balanceChange = Number(tx.balance_change ?? tx.address?.balance_change ?? 0);
                const blockNumber = Number(tx.block_id || tx.block_height || 0);
                if (!txHash || balanceChange <= 0 || !blockNumber) continue;

                await creditAccountHistoryDeposit(client, row, {
                    amount: balanceChange / (10 ** config.decimals),
                    txHash,
                    logIndex: null,
                    blockNumber,
                    confirmations: DEPOSIT_MIN_CONFIRMATIONS,
                    metadata: {
                        scanner: config.scanner,
                        chain: config.chain,
                        outputUnit: "sats",
                        address: row.address
                    }
                }, summary);
            }
        } catch (err) {
            summary.errors.push({ network: row.network, asset: row.asset_symbol, scanner: config.scanner, address: row.address, error: err.message || String(err) });
        }
    }
}

async function scanSolanaDepositGroup(client, config, rows, summary) {
    const rpcUrl = getDepositRpcUrl(config);
    if (!rpcUrl) {
        summary.skipped.push({ asset: config.asset, network: config.networks?.[0], reason: "scanner endpoint not configured" });
        return;
    }

    const connection = new SolanaConnection(rpcUrl, "confirmed");
    for (const row of rows) {
        try {
            const publicKey = new SolanaPublicKey(row.address);
            const signatures = await connection.getSignaturesForAddress(publicKey, { limit: DEPOSIT_ACCOUNT_TX_LIMIT }, "confirmed");
            for (const signatureInfo of signatures || []) {
                const confirmations = signatureInfo.confirmationStatus === "finalized" ? DEPOSIT_MIN_CONFIRMATIONS : 1;
                if (confirmations < DEPOSIT_MIN_CONFIRMATIONS) continue;
                const parsed = await connection.getParsedTransaction(signatureInfo.signature, { maxSupportedTransactionVersion: 0 });
                const accountKeys = parsed?.transaction?.message?.accountKeys || [];
                const addressIndex = accountKeys.findIndex((key) => {
                    const account = key.pubkey?.toBase58?.() || key.pubkey || key;
                    return String(account) === row.address;
                });
                if (addressIndex < 0) continue;
                const preBalance = Number(parsed?.meta?.preBalances?.[addressIndex] || 0);
                const postBalance = Number(parsed?.meta?.postBalances?.[addressIndex] || 0);
                const diffLamports = postBalance - preBalance;
                if (diffLamports <= 0) continue;

                await creditAccountHistoryDeposit(client, row, {
                    amount: diffLamports / LAMPORTS_PER_SOL,
                    txHash: signatureInfo.signature,
                    logIndex: null,
                    blockNumber: Number(parsed?.slot || signatureInfo.slot || 0),
                    confirmations,
                    metadata: {
                        scanner: config.scanner,
                        unit: "lamports",
                        address: row.address
                    }
                }, summary);
            }
        } catch (err) {
            const message = err.message || String(err);
            if (!/not found|could not find/i.test(message)) {
                summary.errors.push({ network: row.network, asset: row.asset_symbol, scanner: config.scanner, address: row.address, error: message });
            }
        }
    }
}

async function scanXrpDepositGroup(client, config, rows, summary) {
    const rpcUrl = getDepositRpcUrl(config);
    if (!rpcUrl) {
        summary.skipped.push({ asset: config.asset, network: config.networks?.[0], reason: "scanner endpoint not configured" });
        return;
    }

    for (const row of rows) {
        try {
            const json = await fetchDepositJson(rpcUrl, {
                method: "POST",
                body: {
                    method: "account_tx",
                    params: [{
                        account: row.address,
                        ledger_index_min: -1,
                        ledger_index_max: -1,
                        limit: DEPOSIT_ACCOUNT_TX_LIMIT,
                        forward: false
                    }]
                }
            });
            if (json?.result?.error === "actNotFound") continue;
            const transactions = json?.result?.transactions || [];
            for (const entry of transactions) {
                const tx = entry.tx_json || entry.tx || entry;
                const amountDrops = typeof tx.Amount === "string" ? Number(tx.Amount) : 0;
                const txHash = normalizeText(tx.hash || tx.Hash || entry.hash);
                const ledgerIndex = Number(tx.ledger_index || entry.ledger_index || 0);
                if (entry.validated === false) continue;
                if (tx.TransactionType !== "Payment" || tx.Destination !== row.address || amountDrops <= 0 || !txHash) continue;

                await creditAccountHistoryDeposit(client, row, {
                    amount: amountDrops / 1_000_000,
                    txHash,
                    logIndex: null,
                    blockNumber: ledgerIndex,
                    confirmations: DEPOSIT_MIN_CONFIRMATIONS,
                    metadata: {
                        scanner: config.scanner,
                        source: tx.Account,
                        destination: tx.Destination,
                        unit: "drops"
                    }
                }, summary);
            }
        } catch (err) {
            summary.errors.push({ network: row.network, asset: row.asset_symbol, scanner: config.scanner, address: row.address, error: err.message || String(err) });
        }
    }
}

async function scanStellarDepositGroup(client, config, rows, summary) {
    const baseUrl = getDepositRestBaseUrl(config);
    if (!baseUrl) {
        summary.skipped.push({ asset: config.asset, network: config.networks?.[0], reason: "scanner endpoint not configured" });
        return;
    }

    for (const row of rows) {
        try {
            const json = await fetchDepositJson(`${baseUrl}/accounts/${encodeURIComponent(row.address)}/payments?order=desc&limit=${DEPOSIT_ACCOUNT_TX_LIMIT}`);
            const records = json?._embedded?.records || [];
            for (const record of records) {
                let amount = 0;
                if (record.type === "payment" && record.to === row.address && record.asset_type === "native") {
                    amount = numberValue(record.amount, 0);
                } else if (record.type === "create_account" && record.account === row.address) {
                    amount = numberValue(record.starting_balance, 0);
                }
                const txHash = normalizeText(record.transaction_hash);
                if (amount <= 0 || !txHash) continue;

                await creditAccountHistoryDeposit(client, row, {
                    amount,
                    txHash,
                    logIndex: record.id ? Number(String(record.id).replace(/\D/g, "").slice(-9)) : null,
                    blockNumber: Number(record.ledger || 0),
                    confirmations: DEPOSIT_MIN_CONFIRMATIONS,
                    metadata: {
                        scanner: config.scanner,
                        paymentType: record.type,
                        source: record.from || record.funder || null,
                        destination: record.to || record.account || null
                    }
                }, summary);
            }
        } catch (err) {
            const message = err.message || String(err);
            if (!/404|not found/i.test(message)) {
                summary.errors.push({ network: row.network, asset: row.asset_symbol, scanner: config.scanner, address: row.address, error: message });
            }
        }
    }
}

function tronDepositHeaders() {
    const apiKey = String(process.env.TRON_PRO_API_KEY || process.env.AUTODY_TRON_API_KEY || "").trim();
    return apiKey ? { "TRON-PRO-API-KEY": apiKey } : {};
}

function tronHexToBase58(value = "") {
    try {
        return TronWeb.address.fromHex(value);
    } catch (err) {
        return "";
    }
}

async function scanTronNativeDepositGroup(client, config, rows, summary) {
    const baseUrl = getDepositRestBaseUrl(config);
    if (!baseUrl) {
        summary.skipped.push({ asset: config.asset, network: config.networks?.[0], reason: "scanner endpoint not configured" });
        return;
    }

    for (const row of rows) {
        try {
            const url = `${baseUrl}/v1/accounts/${encodeURIComponent(row.address)}/transactions?only_confirmed=true&only_to=true&limit=${DEPOSIT_ACCOUNT_TX_LIMIT}&order_by=block_timestamp,desc`;
            const json = await fetchDepositJson(url, { headers: tronDepositHeaders() });
            for (const tx of json?.data || []) {
                const value = tx.raw_data?.contract?.[0]?.parameter?.value || {};
                const toAddress = tronHexToBase58(value.to_address);
                const amountSun = Number(value.amount || 0);
                const txHash = normalizeText(tx.txID || tx.txid || tx.hash);
                if (!chainAddressMatches(toAddress, row.address) || amountSun <= 0 || !txHash) continue;
                const resultStatus = tx.ret?.[0]?.contractRet || "";
                if (resultStatus && resultStatus !== "SUCCESS") continue;

                await creditAccountHistoryDeposit(client, row, {
                    amount: amountSun / 1_000_000,
                    txHash,
                    logIndex: null,
                    blockNumber: Number(tx.blockNumber || 0),
                    confirmations: DEPOSIT_MIN_CONFIRMATIONS,
                    metadata: {
                        scanner: config.scanner,
                        unit: "sun",
                        from: tronHexToBase58(value.owner_address),
                        to: toAddress
                    }
                }, summary);
            }
        } catch (err) {
            summary.errors.push({ network: row.network, asset: row.asset_symbol, scanner: config.scanner, address: row.address, error: err.message || String(err) });
        }
    }
}

async function scanTronTrc20DepositGroup(client, config, rows, summary) {
    const baseUrl = getDepositRestBaseUrl(config);
    const contract = config.tokenContract;
    if (!baseUrl || !contract?.address) {
        summary.skipped.push({ asset: config.asset, network: config.networks?.[0], reason: "scanner endpoint not configured" });
        return;
    }

    for (const row of rows) {
        try {
            const url = `${baseUrl}/v1/accounts/${encodeURIComponent(row.address)}/transactions/trc20?only_confirmed=true&limit=${DEPOSIT_ACCOUNT_TX_LIMIT}&contract_address=${encodeURIComponent(contract.address)}`;
            const json = await fetchDepositJson(url, { headers: tronDepositHeaders() });
            for (const tx of json?.data || []) {
                const toAddress = tx.to || tx.to_address || tx.toAddress;
                const rawValue = String(tx.value || "0");
                const txHash = normalizeText(tx.transaction_id || tx.txID || tx.hash);
                if (!chainAddressMatches(toAddress, row.address) || !txHash) continue;
                const amount = numberValue(ethers.formatUnits(BigInt(rawValue), contract.decimals), 0);
                if (amount <= 0) continue;

                await creditAccountHistoryDeposit(client, row, {
                    amount,
                    txHash,
                    logIndex: Number(tx.log_index || tx.event_index || 0),
                    blockNumber: Number(tx.block_number || tx.blockNumber || 0),
                    confirmations: DEPOSIT_MIN_CONFIRMATIONS,
                    metadata: {
                        scanner: config.scanner,
                        contract: contract.address,
                        tokenDecimals: contract.decimals,
                        from: tx.from || tx.from_address || null,
                        to: toAddress
                    }
                }, summary);
            }
        } catch (err) {
            summary.errors.push({ network: row.network, asset: row.asset_symbol, scanner: config.scanner, address: row.address, error: err.message || String(err) });
        }
    }
}

async function scanAccountHistoryDepositGroup(client, config, rows, summary) {
    switch (config.scanner) {
        case "utxo-mempool":
            await scanMempoolUtxoDepositGroup(client, config, rows, summary);
            return;
        case "blockchair-utxo":
            await scanBlockchairUtxoDepositGroup(client, config, rows, summary);
            return;
        case "solana-rpc":
            await scanSolanaDepositGroup(client, config, rows, summary);
            return;
        case "xrp-rpc":
            await scanXrpDepositGroup(client, config, rows, summary);
            return;
        case "stellar-horizon":
            await scanStellarDepositGroup(client, config, rows, summary);
            return;
        case "tron-grid":
            await scanTronNativeDepositGroup(client, config, rows, summary);
            return;
        case "tron-trc20":
            await scanTronTrc20DepositGroup(client, config, rows, summary);
            return;
        default:
            summary.skipped.push({ asset: config.asset, network: config.networks?.[0], reason: "scanner not configured" });
    }
}

async function scanDatabaseCryptoDeposits(options = {}) {
    if (!databaseConfigured()) {
        return { success: false, configured: false, error: "Database is not configured." };
    }

    const client = await dbPool.connect();
    const summary = {
        success: true,
        configured: true,
        scannedAddresses: 0,
        credited: [],
        duplicates: 0,
        duplicateEvents: [],
        skipped: [],
        errors: []
    };

    try {
        await ensureDepositTables(client);
        const limit = Math.max(1, Number(options.limit || DEPOSIT_MONITOR_ADDRESS_LIMIT));
        const filters = [
            "status = 'active'",
            "route_type = 'self_custody_hd'",
            "address is not null"
        ];
        const params = [];
        const requestedAddress = String(options.address || "").trim();
        const requestedAsset = normalizeTradeSymbol(options.asset || options.symbol || "");
        const requestedNetwork = String(options.network || "").trim();
        if (requestedAddress) {
            params.push(requestedAddress.toLowerCase());
            filters.push(`lower(address) = $${params.length}`);
        }
        if (requestedAsset) {
            params.push(requestedAsset);
            filters.push(`upper(asset_symbol) = $${params.length}`);
        }
        if (requestedNetwork) {
            params.push(requestedNetwork.toLowerCase());
            filters.push(`lower(network) = $${params.length}`);
        }
        params.push(limit);
        const addressResult = await client.query(`
            select id, profile_id, asset_symbol, network, address, provider, route_type, status, metadata, last_issued_at
            from crypto_deposit_addresses
            where ${filters.join("\n              and ")}
            order by last_issued_at desc
            limit $${params.length}
        `, params);
        const rows = addressResult.rows || [];
        summary.scannedAddresses = rows.length;
        const groups = activeDepositAddressGroups(rows);
        summary.skipped.push(...groups.unsupported.map((row) => ({
            asset: row.asset_symbol,
            network: row.network,
            reason: "automatic watcher not available yet"
        })));

        for (const [network, groupRows] of groups.evmNative.entries()) {
            try {
                await scanEvmNativeDepositGroup(client, network, groupRows, summary, options);
            } catch (err) {
                console.error(`Native deposit scan failed for ${network}:`, err);
                summary.errors.push({ network, scanner: "evm-native", error: err.message || String(err) });
            }
        }

        for (const [key, groupRows] of groups.evmToken.entries()) {
            const [network, assetSymbol] = key.split(":");
            try {
                await scanEvmTokenDepositGroup(client, network, assetSymbol, groupRows, summary, options);
            } catch (err) {
                console.error(`Token deposit scan failed for ${key}:`, err);
                summary.errors.push({ network, asset: assetSymbol, scanner: "evm-token", error: err.message || String(err) });
            }
        }

        for (const [key, group] of groups.accountHistory.entries()) {
            try {
                await scanAccountHistoryDepositGroup(client, group.config, group.rows, summary);
            } catch (err) {
                console.error(`Account-history deposit scan failed for ${key}:`, err);
                summary.errors.push({
                    network: group.config.networks?.[0] || "",
                    asset: group.config.asset,
                    scanner: group.config.scanner,
                    error: err.message || String(err)
                });
            }
        }

        return summary;
    } finally {
        client.release();
    }
}

async function manuallyCreditDatabaseDeposit(body = {}) {
    if (!databaseConfigured()) {
        return { success: false, configured: false, error: "Database is not configured." };
    }

    const email = normalizeEmail(body.email);
    const profileId = normalizeText(body.profileId);
    const assetSymbol = normalizeManualCreditAssetSymbol(body.asset || body.symbol);
    const network = normalizeManualCreditNetwork(assetSymbol, body.network);
    const amount = numberValue(body.amount, 0);
    const txHash = normalizeText(body.txHash || body.hash || `manual-${crypto.randomUUID()}`);

    if (!email && !profileId) throw demoTradeError(400, "Provide a profileId or email to credit.");
    if (amount <= 0) throw demoTradeError(400, "Enter a deposit amount greater than zero.");

    const client = await dbPool.connect();
    try {
        await client.query("begin");
        await ensureDepositTables(client);
        const profileResult = profileId
            ? await client.query("select id from profiles where id = $1 limit 1", [profileId])
            : await client.query("select id from profiles where lower(email) = lower($1) limit 1", [email]);
        const profile = profileResult.rows[0];
        if (!profile) throw demoTradeError(404, "Account not found.");

        const context = await getPracticeDbContext(client, profile.id, "live");
        const address = normalizeText(body.address) || `manual:${profile.id}:${assetSymbol}:${network}`;
        const addressResult = await client.query(`
            insert into crypto_deposit_addresses (
              profile_id, asset_symbol, network, address, route_type, provider, status, metadata
            )
            values ($1, $2, $3, $4, 'manual_admin_credit', 'admin', 'active', '{}'::jsonb)
            on conflict (profile_id, asset_symbol, network, address) do update
            set last_issued_at = now()
            returning id, profile_id, asset_symbol, network, address, provider, route_type, status, metadata
        `, [profile.id, assetSymbol, network, address]);

        const row = addressResult.rows[0];
        row.profile_id = profile.id;
        const result = await recordAndCreditDatabaseDeposit(client, row, {
            amount,
            amountUsd: body.amountUsd == null ? null : numberValue(body.amountUsd, 0),
            txHash,
            logIndex: body.logIndex == null ? null : Number(body.logIndex),
            blockNumber: body.blockNumber == null ? null : Number(body.blockNumber),
            confirmations: body.confirmations == null ? DEPOSIT_MIN_CONFIRMATIONS : Number(body.confirmations),
            metadata: { scanner: "manual-admin-credit", accountModeId: context.account_mode_id }
        });
        await client.query("commit");
        return { success: true, ...result };
    } catch (err) {
        await client.query("rollback").catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

function adminDepositProfileName(row = {}) {
    const firstLast = [row.first_name, row.last_name]
        .map((value) => String(value || "").trim())
        .filter(Boolean)
        .join(" ");
    return firstLast || row.display_name || row.email || "Unknown account";
}

function adminDepositMetadata(metadata) {
    return normalizeDepositMetadata(metadata);
}

function adminDepositAddressRow(row = {}) {
    const metadata = adminDepositMetadata(row.metadata);
    return {
        id: row.id,
        profileId: row.profile_id,
        email: row.email,
        profileName: adminDepositProfileName(row),
        symbol: row.asset_symbol,
        network: row.network,
        address: row.address,
        routeType: row.route_type,
        provider: row.provider,
        status: row.status,
        derivationIndex: metadata.derivationIndex ?? null,
        derivationPath: metadata.derivationPath || null,
        firstIssuedAt: row.first_issued_at || null,
        lastIssuedAt: row.last_issued_at || null,
        metadata
    };
}

function adminDepositRequestRow(row = {}) {
    const warnings = Array.isArray(row.warnings) ? row.warnings : [];
    return {
        id: row.id,
        profileId: row.profile_id,
        email: row.email,
        profileName: adminDepositProfileName(row),
        symbol: row.asset_symbol,
        network: row.network,
        address: row.address,
        routeType: row.route_type,
        provider: row.provider,
        status: row.status,
        requestedFresh: Boolean(row.requested_fresh),
        amount: row.amount_received == null ? null : numberValue(row.amount_received, 0),
        amountUsd: row.amount_usd == null ? null : numberValue(row.amount_usd, 0),
        confirmations: numberValue(row.confirmations, 0),
        txHash: row.tx_hash || null,
        warnings,
        createdAt: row.created_at || null,
        updatedAt: row.updated_at || null,
        creditedAt: row.credited_at || null,
        expiresAt: row.expires_at || null
    };
}

function adminDepositEventRow(row = {}) {
    const metadata = adminDepositMetadata(row.metadata);
    const addressMetadata = adminDepositMetadata(row.address_metadata);
    return {
        id: row.id,
        profileId: row.profile_id,
        email: row.email,
        profileName: adminDepositProfileName(row),
        symbol: row.asset_symbol,
        network: row.network,
        address: row.address,
        txHash: row.tx_hash,
        logIndex: row.log_index == null ? null : Number(row.log_index),
        blockNumber: row.block_number == null ? null : Number(row.block_number),
        amount: numberValue(row.amount, 0),
        amountUsd: row.amount_usd == null ? null : numberValue(row.amount_usd, 0),
        confirmations: numberValue(row.confirmations, 0),
        status: row.status,
        creditedAt: row.credited_at || null,
        createdAt: row.created_at || null,
        updatedAt: row.updated_at || null,
        routeType: row.route_type || null,
        provider: row.provider || null,
        derivationIndex: addressMetadata.derivationIndex ?? null,
        derivationPath: addressMetadata.derivationPath || null,
        metadata
    };
}

function adminDepositScanStateRow(row = {}) {
    return {
        scanKey: row.scan_key,
        network: row.network,
        symbol: row.asset_symbol || null,
        scanner: row.scanner,
        lastScannedBlock: row.last_scanned_block == null ? null : Number(row.last_scanned_block),
        updatedAt: row.updated_at || null
    };
}

function adminDepositSupportedAssets(extraAssets = []) {
    const cachedMarketAssets = Array.isArray(liveMarketAssetCache.assets) ? liveMarketAssetCache.assets : [];
    const rows = [
        { symbol: "USD", name: "USD Funds", networks: ["Manual ledger"] },
        ...Object.entries(LIVE_DEPOSIT_ASSETS).map(([symbol, asset]) => ({
            symbol,
            name: asset.name || symbol,
            networks: [...(asset.networks || [])]
        })),
        ...cachedMarketAssets.map((asset) => ({
            symbol: asset.symbol,
            name: asset.name || asset.symbol,
            networks: ["Manual ledger"]
        })),
        ...extraAssets.map((asset) => ({
            symbol: asset.symbol,
            name: asset.name || asset.assetName || asset.asset_name || asset.symbol,
            networks: ["Manual ledger"]
        }))
    ];

    const bySymbol = new Map();
    rows.forEach((asset) => {
        const symbol = normalizeTradeSymbol(asset.symbol);
        if (!symbol) return;
        const current = bySymbol.get(symbol);
        const networks = [...new Set([
            ...(current?.networks || []),
            ...(Array.isArray(asset.networks) ? asset.networks : [])
        ].map((network) => normalizeText(network)).filter(Boolean))]
            .sort((a, b) => a.localeCompare(b));
        bySymbol.set(symbol, {
            symbol,
            name: current?.name || normalizeText(asset.name) || symbol,
            networks: networks.length ? networks : ["Manual ledger"]
        });
    });

    return [...bySymbol.values()].sort((a, b) => {
        if (a.symbol === "USD") return -1;
        if (b.symbol === "USD") return 1;
        return a.symbol.localeCompare(b.symbol);
    });
}

async function getAdminDepositOverview(body = {}) {
    if (!databaseConfigured()) {
        return { success: false, configured: false, error: "Database is not configured." };
    }

    const limit = Math.min(100, Math.max(10, Number(body.limit || 50)));
    const client = await dbPool.connect();
    try {
        await ensureDepositTables(client);
        const totalsResult = await client.query(`
            select
              (select count(*) from crypto_deposit_addresses where status = 'active') as active_addresses,
              (select count(*) from crypto_deposit_addresses where route_type = 'self_custody_hd') as generated_addresses,
              (select count(*) from crypto_deposit_addresses where route_type in ('treasury_direct', 'shared_treasury_manual')) as treasury_addresses,
              (select count(*) from crypto_deposit_requests where status not in ('credited', 'cancelled', 'expired')) as open_requests,
              (select count(*) from crypto_deposit_events) as total_events,
              (select count(*) from crypto_deposit_events where status = 'credited') as credited_events,
              (select coalesce(sum(amount_usd), 0) from crypto_deposit_events where status = 'credited') as credited_usd,
              (select count(*) from crypto_deposit_scan_state) as scan_states
        `);

        const addressesResult = await client.query(`
            select
              a.id, a.profile_id, p.email, p.display_name, pv.first_name, pv.last_name,
              a.asset_symbol, a.network, a.address, a.route_type, a.provider, a.status,
              a.first_issued_at, a.last_issued_at, a.metadata
            from crypto_deposit_addresses a
            join profiles p on p.id = a.profile_id
            left join profile_verifications pv on pv.profile_id = p.id
            order by a.last_issued_at desc
            limit $1
        `, [limit]);

        const requestsResult = await client.query(`
            select
              r.id, r.profile_id, p.email, p.display_name, pv.first_name, pv.last_name,
              r.asset_symbol, r.network, r.address, r.provider, r.route_type, r.status,
              r.requested_fresh, r.warnings, r.amount_received, r.amount_usd, r.confirmations,
              r.tx_hash, r.created_at, r.updated_at, r.credited_at, r.expires_at
            from crypto_deposit_requests r
            join profiles p on p.id = r.profile_id
            left join profile_verifications pv on pv.profile_id = p.id
            order by r.created_at desc
            limit $1
        `, [limit]);

        const eventsResult = await client.query(`
            select
              e.id, e.profile_id, p.email, p.display_name, pv.first_name, pv.last_name,
              e.asset_symbol, e.network, e.address, e.tx_hash, e.log_index, e.block_number,
              e.amount, e.amount_usd, e.confirmations, e.status, e.credited_at,
              e.created_at, e.updated_at, e.metadata,
              a.route_type, a.provider, a.metadata as address_metadata
            from crypto_deposit_events e
            join profiles p on p.id = e.profile_id
            left join profile_verifications pv on pv.profile_id = p.id
            left join crypto_deposit_addresses a on a.id = e.address_id
            order by e.created_at desc
            limit $1
        `, [limit]);

        const scanStatesResult = await client.query(`
            select scan_key, network, asset_symbol, scanner, last_scanned_block, updated_at
            from crypto_deposit_scan_state
            order by updated_at desc
            limit $1
        `, [limit]);

        let controlledAssets = [];
        try {
            await ensureAdminMarketTables();
            const controlledResult = await client.query(`
                select symbol, asset_name, asset_type, market
                from admin_market_controls
                order by case when symbol = 'AU' then 0 else 1 end, asset_type asc, symbol asc
            `);
            controlledAssets = controlledResult.rows.map((row) => ({
                symbol: row.symbol,
                name: row.asset_name,
                assetType: row.asset_type,
                market: row.market
            }));
        } catch (err) {
            console.error("Admin deposit controlled asset list failed:", err.message || err);
        }

        const totals = totalsResult.rows[0] || {};
        return {
            success: true,
            configured: true,
            generatedAt: new Date().toISOString(),
            capabilities: {
                childAddresses: depositRouteAllowsSelfCustody(),
                evmSweep: true,
                nonEvmSweep: false,
                manualCredit: true,
                automaticMonitor: DEPOSIT_MONITOR_ENABLED
            },
            supportedAssets: adminDepositSupportedAssets(controlledAssets),
            totals: {
                activeAddresses: numberValue(totals.active_addresses, 0),
                generatedAddresses: numberValue(totals.generated_addresses, 0),
                treasuryAddresses: numberValue(totals.treasury_addresses, 0),
                openRequests: numberValue(totals.open_requests, 0),
                totalEvents: numberValue(totals.total_events, 0),
                creditedEvents: numberValue(totals.credited_events, 0),
                creditedUsd: numberValue(totals.credited_usd, 0),
                scanStates: numberValue(totals.scan_states, 0)
            },
            addresses: addressesResult.rows.map(adminDepositAddressRow),
            requests: requestsResult.rows.map(adminDepositRequestRow),
            events: eventsResult.rows.map(adminDepositEventRow),
            scanStates: scanStatesResult.rows.map(adminDepositScanStateRow)
        };
    } finally {
        client.release();
    }
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

async function getPracticeDbContext(client = dbPool, profileId = null, mode = "demo") {
    if (!databaseConfigured()) return null;
    const accountMode = normalizeWatchlistMode(mode);

    const readContext = () => profileId
        ? client.query(`
            select
                p.id as profile_id,
                am.id as account_mode_id,
                w.id as wallet_id,
                w.cash_balance,
                w.reserved_cash,
                w.starting_balance
            from profiles p
            join account_modes am on am.profile_id = p.id and am.mode = $2
            join wallets w on w.account_mode_id = am.id
            where p.id = $1
            limit 1
        `, [profileId, accountMode])
        : client.query(`
            select
                p.id as profile_id,
                am.id as account_mode_id,
                w.id as wallet_id,
                w.cash_balance,
                w.reserved_cash,
                w.starting_balance
            from profiles p
            join account_modes am on am.profile_id = p.id and am.mode = $2
            join wallets w on w.account_mode_id = am.id
            where lower(p.email) = lower($1)
            limit 1
        `, [PRACTICE_USER_EMAIL, accountMode]);

    let result = await readContext();

    if (!result.rows[0] && profileId) {
        const seeded = await seedAccountWallet(client, profileId, accountMode, accountMode === "demo" ? 50000 : 0);
        if (accountMode === "demo") {
            await client.query(`
                insert into demo_performance (account_mode_id, portfolio_value, starting_balance)
                values ($1, 50000, 50000)
                on conflict (account_mode_id) do nothing
            `, [seeded.accountModeId]);
        }
        result = await readContext();
    }

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

async function getDatabaseWatchlist(mode = "demo", profileId = null) {
    const context = profileId ? { profile_id: profileId } : await getPracticeDbContext();
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

async function placeDatabaseDemoOrder(body, auth = {}) {
    const side = String(body.side || "buy").trim().toLowerCase();
    const client = await dbPool.connect();

    try {
        await client.query("begin");
        const context = await getPracticeDbContext(
            client,
            auth.source === "supabase" ? auth.profileId : null,
            "demo"
        );
        let order;
        let realizedDelta = 0;
        const marketImpacts = [];

        if (side === "buy") {
            const asset = await resolveTradeAsset(body.symbol);
            const trade = calculateTradeSize(body, asset.price);
            await adjustDbCash(client, context.wallet_id, -trade.notionalUsd);
            await applyDbBuy(client, context.wallet_id, asset, trade.quantity, trade.notionalUsd);
            marketImpacts.push({ symbol: asset.symbol, side: "buy", notionalUsd: trade.notionalUsd, source: "demo-buy" });
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
            marketImpacts.push({ symbol: asset.symbol, side: "sell", notionalUsd: trade.notionalUsd, source: "demo-sell" });
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
            marketImpacts.push({ symbol: fromAsset.symbol, side: "sell", notionalUsd, source: "demo-swap-out" });

            const toQuantity = notionalUsd / toAsset.price;
            await applyDbBuy(client, context.wallet_id, toAsset, toQuantity, notionalUsd);
            marketImpacts.push({ symbol: toAsset.symbol, side: "buy", notionalUsd, source: "demo-swap-in" });
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
        for (const impact of marketImpacts) {
            await applyAdminControlledTradeImpact(impact.symbol, impact.side, impact.notionalUsd, impact.source).catch((err) => {
                console.error("Admin controlled demo trade impact failed:", err.message || err);
            });
        }
        const account = auth.source === "supabase" && auth.profileId
            ? await getDatabaseAccountByProfileId(auth.profileId, "demo")
            : await getPracticeAccountAfterDatabaseWrite("Supabase demo order");
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

async function placeJsonDemoOrder(body, userId = PRACTICE_USER_ID) {
    const db = loadDemoDb();
    const user = db.users.find((item) => item.id === userId);
    const wallet = db.wallets[userId];
    const side = String(body.side || "buy").trim().toLowerCase();
    if (!user || !wallet) throw demoTradeError(503, "Practice account is not ready yet.");

    const adjustCash = (delta) => {
        const currentCash = numberValue(wallet.cash?.balance ?? user.cashBalance, 50000);
        const nextCash = currentCash + delta;
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
    const marketImpacts = [];

    if (side === "buy") {
        const asset = await resolveTradeAsset(body.symbol);
        const trade = calculateTradeSize(body, asset.price);
        adjustCash(-trade.notionalUsd);
        buyHolding(asset, trade.quantity, trade.notionalUsd);
        marketImpacts.push({ symbol: asset.symbol, side: "buy", notionalUsd: trade.notionalUsd, source: "demo-json-buy" });
        order = { symbol: asset.symbol, assetType: tradeAssetType(asset), side, orderType: "market", status: "filled", quantity: trade.quantity, notionalUsd: trade.notionalUsd, filledPrice: asset.price };
    } else if (side === "sell") {
        const asset = await resolveTradeAsset(body.symbol);
        const trade = calculateTradeSize(body, asset.price);
        realizedDelta += sellHolding(asset, trade.quantity);
        adjustCash(trade.notionalUsd);
        marketImpacts.push({ symbol: asset.symbol, side: "sell", notionalUsd: trade.notionalUsd, source: "demo-json-sell" });
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
        marketImpacts.push({ symbol: fromAsset.symbol, side: "sell", notionalUsd, source: "demo-json-swap-out" });
        const toQuantity = notionalUsd / toAsset.price;
        buyHolding(toAsset, toQuantity, notionalUsd);
        marketImpacts.push({ symbol: toAsset.symbol, side: "buy", notionalUsd, source: "demo-json-swap-in" });
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
    db.orders[userId] = [order, ...(db.orders[userId] || [])].slice(0, 50);

    const investedValue = (wallet.holdings || [])
        .filter((holding) => !["USD", "CRYPTO", "STOCKS"].includes(normalizeTradeSymbol(holding.symbol)))
        .reduce((sum, holding) => sum + numberValue(holding.valueUsd, 0), 0);
    const startingBalance = numberValue(user.startingBalance, 50000);
    const portfolioValue = numberValue(user.cashBalance, 0) + investedValue;
    db.performance = db.performance || {};
    const existingPerformance = db.performance[userId] || {};
    db.performance[userId] = {
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
    for (const impact of marketImpacts) {
        await applyAdminControlledTradeImpact(impact.symbol, impact.side, impact.notionalUsd, impact.source).catch((err) => {
            console.error("Admin controlled JSON demo trade impact failed:", err.message || err);
        });
    }
    return {
        order,
        account: { ...(getJsonAccountByUserId(userId, "demo") || getPracticeAccount()), source: "json" },
        source: "json"
    };
}

async function placeDemoOrder(body, auth = {}) {
    return withDemoWriteFallback(
        "Supabase demo order",
        () => placeDatabaseDemoOrder(body, auth),
        () => placeJsonDemoOrder(body, auth.userId || PRACTICE_USER_ID)
    );
}

async function addDatabaseWatchlistSymbol(symbol, mode = "demo", profileId = null) {
    const asset = await resolveWatchlistAsset(symbol);
    const context = profileId ? { profile_id: profileId } : await getPracticeDbContext();
    const watchlistMode = normalizeWatchlistMode(mode);
    const result = await dbPool.query(`
        insert into watchlists (profile_id, symbol, asset_type, mode)
        values ($1, $2, $3, $4)
        on conflict (profile_id, symbol, mode) do nothing
        returning symbol
    `, [context.profile_id, asset.symbol, tradeAssetType(asset), watchlistMode]);

    const watchlist = await getDatabaseWatchlist(watchlistMode, context.profile_id);
    const account = profileId
        ? await getDatabaseAccountByProfileId(profileId, watchlistMode)
        : await getPracticeAccountAfterDatabaseWrite(`Supabase ${watchlistMode} watchlist add`);

    return {
        asset,
        account: { ...account, watchlist },
        watchlist,
        alreadySaved: !result.rows.length,
        source: "supabase"
    };
}

async function addJsonWatchlistSymbol(symbol, mode = "demo", userId = PRACTICE_USER_ID) {
    const asset = await resolveWatchlistAsset(symbol);
    const db = loadDemoDb();
    const watchlistMode = normalizeWatchlistMode(mode);
    const watchlist = jsonWatchlistForMode(db, watchlistMode, userId);
    const key = ["stock", "etf", "commodity"].includes(tradeAssetType(asset)) ? "stocks" : "crypto";
    const alreadySaved = (watchlist[key] || []).some((item) => normalizeTradeSymbol(item) === asset.symbol);
    watchlist[key] = Array.from(new Set([...(watchlist[key] || []), asset.symbol]));
    saveDemoDb(db);
    return {
        asset,
        account: { ...(getJsonAccountByUserId(userId, watchlistMode) || getPracticeAccount()), watchlist },
        watchlist,
        alreadySaved,
        source: "json"
    };
}

async function addWatchlistSymbol(symbol, mode = "demo", options = {}) {
    const watchlistMode = normalizeWatchlistMode(mode);
    return withDemoWriteFallback(
        `Supabase ${watchlistMode} watchlist add`,
        () => addDatabaseWatchlistSymbol(symbol, watchlistMode, options.profileId || null),
        () => addJsonWatchlistSymbol(symbol, watchlistMode, options.userId || PRACTICE_USER_ID)
    );
}

async function addDemoWatchlistSymbol(symbol, auth = {}) {
    return addWatchlistSymbol(symbol, "demo", {
        profileId: auth.source === "supabase" ? auth.profileId : null,
        userId: auth.userId || PRACTICE_USER_ID
    });
}

async function addLiveWatchlistSymbol(symbol, auth = {}) {
    return addWatchlistSymbol(symbol, "live", {
        profileId: auth.source === "supabase" ? auth.profileId : null,
        userId: auth.userId || PRACTICE_USER_ID
    });
}

async function removeDatabaseWatchlistSymbol(symbol, mode = "demo", profileId = null) {
    const lookup = normalizeTradeSymbol(symbol);
    if (!lookup) throw demoTradeError(400, "Choose an asset first.");

    const context = profileId ? { profile_id: profileId } : await getPracticeDbContext();
    const watchlistMode = normalizeWatchlistMode(mode);
    await dbPool.query(`
        delete from watchlists
        where profile_id = $1 and upper(symbol) = upper($2)
          and mode = $3
    `, [context.profile_id, lookup, watchlistMode]);

    const watchlist = await getDatabaseWatchlist(watchlistMode, context.profile_id);
    const account = profileId
        ? await getDatabaseAccountByProfileId(profileId, watchlistMode)
        : await getPracticeAccountAfterDatabaseWrite(`Supabase ${watchlistMode} watchlist remove`);
    return { account: { ...account, watchlist }, watchlist, source: "supabase" };
}

async function removeJsonWatchlistSymbol(symbol, mode = "demo", userId = PRACTICE_USER_ID) {
    const lookup = normalizeTradeSymbol(symbol);
    if (!lookup) throw demoTradeError(400, "Choose an asset first.");

    const db = loadDemoDb();
    const watchlist = jsonWatchlistForMode(db, normalizeWatchlistMode(mode), userId);
    watchlist.crypto = (watchlist.crypto || []).filter((item) => normalizeTradeSymbol(item) !== lookup);
    watchlist.stocks = (watchlist.stocks || []).filter((item) => normalizeTradeSymbol(item) !== lookup);
    saveDemoDb(db);
    return { account: { ...(getJsonAccountByUserId(userId, normalizeWatchlistMode(mode)) || getPracticeAccount()), watchlist }, watchlist, source: "json" };
}

async function removeWatchlistSymbol(symbol, mode = "demo", options = {}) {
    const watchlistMode = normalizeWatchlistMode(mode);
    return withDemoWriteFallback(
        `Supabase ${watchlistMode} watchlist remove`,
        () => removeDatabaseWatchlistSymbol(symbol, watchlistMode, options.profileId || null),
        () => removeJsonWatchlistSymbol(symbol, watchlistMode, options.userId || PRACTICE_USER_ID)
    );
}

async function removeDemoWatchlistSymbol(symbol, auth = {}) {
    return removeWatchlistSymbol(symbol, "demo", {
        profileId: auth.source === "supabase" ? auth.profileId : null,
        userId: auth.userId || PRACTICE_USER_ID
    });
}

async function removeLiveWatchlistSymbol(symbol, auth = {}) {
    return removeWatchlistSymbol(symbol, "live", {
        profileId: auth.source === "supabase" ? auth.profileId : null,
        userId: auth.userId || PRACTICE_USER_ID
    });
}

async function createDatabaseSessionWithClient(client, profileId, sessionHours = SESSION_HOURS) {
    const token = crypto.randomBytes(32).toString("hex");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 1000 * 60 * 60 * sessionHours);
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    await client.query(`
        delete from app_sessions
        where profile_id = $1 or expires_at <= now()
    `, [profileId]);

    await client.query(`
        insert into app_sessions (profile_id, token_hash, created_at, expires_at)
        values ($1, $2, $3, $4)
    `, [profileId, tokenHash, now.toISOString(), expiresAt.toISOString()]);

    return {
        token,
        userId: profileId,
        expiresAt: expiresAt.toISOString()
    };
}

function tokenHashValue(token) {
    return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function requestSessionToken(req) {
    const authHeader = String(req.get("authorization") || "");
    const bearer = authHeader.match(/^Bearer\s+(.+)$/i)?.[1];
    return String(bearer || req.get("x-autody-session") || "").trim();
}

function createJsonTrustedDevice(db, userId) {
    const token = crypto.randomBytes(32).toString("hex");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 1000 * 60 * 60 * REMEMBER_SESSION_HOURS);
    db.trustedDevices = (db.trustedDevices || [])
        .filter((device) => Date.parse(device.expiresAt || "") > Date.now())
        .filter((device) => device.userId !== userId);
    db.trustedDevices.push({
        id: crypto.randomUUID(),
        userId,
        tokenHash: tokenHashValue(token),
        createdAt: now.toISOString(),
        expiresAt: expiresAt.toISOString()
    });
    saveDemoDb(db);
    return { token, userId, expiresAt: expiresAt.toISOString() };
}

function verifyJsonTrustedDevice(db, userId, token) {
    if (!token) return false;
    const tokenHash = tokenHashValue(token);
    const now = Date.now();
    const before = (db.trustedDevices || []).length;
    db.trustedDevices = (db.trustedDevices || []).filter((device) => Date.parse(device.expiresAt || "") > now);
    const changed = before !== db.trustedDevices.length;
    if (changed) saveDemoDb(db);
    return db.trustedDevices.some((device) => device.userId === userId && device.tokenHash === tokenHash);
}

async function createDatabaseTrustedDevice(profileId) {
    const token = crypto.randomBytes(32).toString("hex");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 1000 * 60 * 60 * REMEMBER_SESSION_HOURS);
    await ensureSignUpTables();
    await dbPool.query(`
        delete from trusted_devices
        where profile_id = $1 or expires_at <= now()
    `, [profileId]);
    await dbPool.query(`
        insert into trusted_devices (profile_id, token_hash, created_at, expires_at)
        values ($1, $2, $3, $4)
    `, [profileId, tokenHashValue(token), now.toISOString(), expiresAt.toISOString()]);
    return { token, userId: profileId, expiresAt: expiresAt.toISOString() };
}

async function verifyDatabaseTrustedDevice(profileId, token) {
    if (!databaseConfigured() || !profileId || !token) return false;
    await ensureSignUpTables();
    await dbPool.query(`delete from trusted_devices where expires_at <= now()`);
    const result = await dbPool.query(`
        select 1
        from trusted_devices
        where profile_id = $1
          and token_hash = $2
          and expires_at > now()
        limit 1
    `, [profileId, tokenHashValue(token)]);
    return Boolean(result.rows[0]);
}

function publicTrustedDevice(device = {}, index = 0) {
    return {
        id: device.id,
        label: device.label || `Remembered device ${index + 1}`,
        createdAt: device.created_at || device.createdAt || "",
        expiresAt: device.expires_at || device.expiresAt || ""
    };
}

async function listTrustedDevicesForAccount(auth) {
    if (auth.source === "supabase" && databaseConfigured()) {
        await ensureSignUpTables();
        await dbPool.query(`delete from trusted_devices where expires_at <= now()`);
        const result = await dbPool.query(`
            select id, created_at, expires_at
            from trusted_devices
            where profile_id = $1
            order by created_at desc
        `, [auth.profileId]);
        return result.rows.map(publicTrustedDevice);
    }

    const db = loadDemoDb();
    const now = Date.now();
    const devices = (db.trustedDevices || []).filter((device) => {
        return device.userId === auth.userId && Date.parse(device.expiresAt || "") > now;
    });
    return devices.map(publicTrustedDevice);
}

async function deleteTrustedDeviceForAccount(auth, deviceId) {
    if (auth.source === "supabase" && databaseConfigured()) {
        await ensureSignUpTables();
        const result = await dbPool.query(`
            delete from trusted_devices
            where id = $1 and profile_id = $2
        `, [deviceId, auth.profileId]);
        return result.rowCount > 0;
    }

    const db = loadDemoDb();
    const before = (db.trustedDevices || []).length;
    db.trustedDevices = (db.trustedDevices || []).filter((device) => !(device.id === deviceId && device.userId === auth.userId));
    if (db.trustedDevices.length !== before) saveDemoDb(db);
    return db.trustedDevices.length !== before;
}

async function verifyAccountPassword(auth, password) {
    if (auth.source === "supabase" && databaseConfigured()) {
        const result = await dbPool.query(`
            select password_salt, password_hash
            from profile_credentials
            where profile_id = $1
            limit 1
        `, [auth.profileId]);
        const row = result.rows[0];
        return verifyPassword(password, {
            passwordSalt: row?.password_salt,
            passwordHash: row?.password_hash
        });
    }

    const db = loadDemoDb();
    const user = (db.users || []).find((item) => item.id === auth.userId);
    return Boolean(user && verifyPassword(password, user.auth));
}

async function updateAccountPassword(auth, password) {
    const salt = crypto.randomBytes(16).toString("hex");
    const passwordHash = hashPassword(password, salt);

    if (auth.source === "supabase" && databaseConfigured()) {
        await dbPool.query(`
            update profile_credentials
            set password_salt = $2,
                password_hash = $3
            where profile_id = $1
        `, [auth.profileId, salt, passwordHash]);
        return true;
    }

    const db = loadDemoDb();
    const user = (db.users || []).find((item) => item.id === auth.userId);
    if (!user) return false;
    user.auth = {
        ...(user.auth || {}),
        passwordSalt: salt,
        passwordHash
    };
    saveDemoDb(db);
    return true;
}

async function databaseAuthenticator(profileId) {
    if (!databaseConfigured()) return null;
    await ensureSignUpTables();
    const result = await dbPool.query(`
        select totp_secret, totp_pending_secret, totp_enabled, totp_confirmed_at
        from profile_credentials
        where profile_id = $1
        limit 1
    `, [profileId]);
    return result.rows[0] || null;
}

function jsonAuthenticator(user = {}) {
    return user.authenticator || {};
}

async function authenticatorStatusForAccount(auth) {
    if (auth.source === "supabase" && databaseConfigured()) {
        const row = await databaseAuthenticator(auth.profileId);
        return {
            enabled: Boolean(row?.totp_enabled && row?.totp_secret),
            pending: Boolean(row?.totp_pending_secret),
            confirmedAt: row?.totp_confirmed_at || ""
        };
    }
    const db = loadDemoDb();
    const user = (db.users || []).find((item) => item.id === auth.userId);
    const authn = jsonAuthenticator(user);
    return {
        enabled: Boolean(authn.enabled && authn.secret),
        pending: Boolean(authn.pendingSecret),
        confirmedAt: authn.confirmedAt || ""
    };
}

async function authenticatorEnabledForProfile(profileId) {
    const row = await databaseAuthenticator(profileId);
    return Boolean(row?.totp_enabled && row?.totp_secret);
}

function authenticatorEnabledForJsonUser(user) {
    const authn = jsonAuthenticator(user);
    return Boolean(authn.enabled && authn.secret);
}

async function startAuthenticatorSetup(auth) {
    const secret = generateTotpSecret();
    const email = auth.user?.email || auth.email || "";
    const uri = authenticatorUri(email, secret);
    const qrDataUrl = await QRCode.toDataURL(uri, { margin: 1, width: 220 });

    if (auth.source === "supabase" && databaseConfigured()) {
        await ensureSignUpTables();
        await dbPool.query(`
            update profile_credentials
            set totp_pending_secret = $2
            where profile_id = $1
        `, [auth.profileId, secret]);
    } else {
        const db = loadDemoDb();
        const user = (db.users || []).find((item) => item.id === auth.userId);
        if (!user) throw signUpError(404, "Account not found.");
        user.authenticator = {
            ...(user.authenticator || {}),
            pendingSecret: secret
        };
        saveDemoDb(db);
    }

    return { secret, uri, qrDataUrl };
}

async function confirmAuthenticatorSetup(auth, code) {
    if (auth.source === "supabase" && databaseConfigured()) {
        const row = await databaseAuthenticator(auth.profileId);
        const secret = row?.totp_pending_secret || row?.totp_secret;
        if (!verifyTotpCode(secret, code)) throw signUpError(400, "Authenticator code is incorrect.");
        await dbPool.query(`
            update profile_credentials
            set totp_secret = $2,
                totp_pending_secret = null,
                totp_enabled = true,
                totp_confirmed_at = now()
            where profile_id = $1
        `, [auth.profileId, secret]);
        return true;
    }

    const db = loadDemoDb();
    const user = (db.users || []).find((item) => item.id === auth.userId);
    if (!user) throw signUpError(404, "Account not found.");
    const secret = user.authenticator?.pendingSecret || user.authenticator?.secret;
    if (!verifyTotpCode(secret, code)) throw signUpError(400, "Authenticator code is incorrect.");
    user.authenticator = {
        secret,
        enabled: true,
        confirmedAt: new Date().toISOString()
    };
    saveDemoDb(db);
    return true;
}

async function verifyDatabaseAuthenticatorLogin(email, code) {
    const profile = await databaseProfileVerification(email);
    if (!profile) return null;
    if (profile.email_status !== "verified") {
        return { success: false, error: "Verify your email before signing in." };
    }
    const row = await databaseAuthenticator(profile.id);
    if (!row?.totp_enabled || !row?.totp_secret) {
        return { success: false, error: "Authenticator is not enabled for this account." };
    }
    if (!verifyTotpCode(row.totp_secret, code)) {
        return { success: false, error: "Authenticator code is incorrect." };
    }
    return { success: true, profile };
}

function verifyJsonAuthenticatorLogin(db, email, code) {
    const user = jsonUserByEmail(db, email);
    if (!user) return { success: false, error: "Account not found." };
    if (user.verification?.emailStatus !== "verified") {
        return { success: false, error: "Verify your email before signing in." };
    }
    if (!authenticatorEnabledForJsonUser(user)) {
        return { success: false, error: "Authenticator is not enabled for this account." };
    }
    if (!verifyTotpCode(user.authenticator.secret, code)) {
        return { success: false, error: "Authenticator code is incorrect." };
    }
    return { success: true, user };
}

async function databaseProfileFromSessionToken(token) {
    if (!databaseConfigured() || !token) return null;
    const result = await dbPool.query(`
        select
            p.id,
            p.email,
            p.display_name,
            p.created_at,
            pv.first_name,
            pv.last_name,
            pv.legal_name,
            pv.phone,
            pv.country,
            pv.date_of_birth,
            pv.account_type,
            pv.email_status,
            pv.phone_status,
            pv.identity_status,
            pv.terms_version,
            pv.terms_accepted_at,
            pv.information_confirmed_at
        from app_sessions s
        join profiles p on p.id = s.profile_id
        left join profile_verifications pv on pv.profile_id = p.id
        where s.token_hash = $1
          and s.expires_at > now()
        limit 1
    `, [tokenHashValue(token)]);
    return result.rows[0] || null;
}

function jsonProfileFromSessionToken(db, token) {
    if (!token) return null;
    const tokenHash = tokenHashValue(token);
    db.sessions = (db.sessions || []).filter((session) => Date.parse(session.expiresAt || "") > Date.now());
    const session = db.sessions.find((item) => item.tokenHash === tokenHash);
    if (!session) return null;
    return (db.users || []).find((user) => user.id === session.userId) || null;
}

async function authenticatedAccountContext(req) {
    const token = requestSessionToken(req);
    if (!token) throw demoTradeError(401, "Sign in again to open this account data.");

    if (databaseConfigured()) {
        const profile = await databaseProfileFromSessionToken(token).catch((err) => {
            console.error("Account session lookup failed:", err.message || err);
            return null;
        });
        if (profile) {
            return {
                source: "supabase",
                profileId: profile.id,
                userId: profile.id,
                user: databasePublicUser(profile)
            };
        }
    }

    const db = loadDemoDb();
    const user = jsonProfileFromSessionToken(db, token);
    if (!user) throw demoTradeError(401, "Sign in again to open this account data.");
    return {
        source: "json",
        profileId: user.id,
        userId: user.id,
        user: publicUser(user)
    };
}

async function ensureSupportTicketTables(client = dbPool) {
    await client.query(`
        create table if not exists support_tickets (
          id uuid primary key,
          profile_id uuid references profiles(id) on delete set null,
          account_mode text not null default 'live',
          category text not null,
          topic text not null default '',
          contact_name text not null default '',
          contact_email text not null default '',
          priority text not null default 'normal',
          message text not null,
          status text not null default 'open',
          created_at timestamptz not null default now()
        );

        alter table if exists support_tickets
          add column if not exists topic text not null default '',
          add column if not exists contact_name text not null default '',
          add column if not exists contact_email text not null default '';

        create index if not exists support_tickets_profile_idx
          on support_tickets (profile_id, created_at desc);
    `);
}

async function createSupportTicket(auth = {}, body = {}) {
    const category = normalizeText(body.category || body.type || "Other").slice(0, 80) || "Other";
    const priority = normalizeText(body.priority || "Normal").slice(0, 40) || "Normal";
    const topic = normalizeText(body.topic || body.subject || "").slice(0, 160);
    const contactName = normalizeText(body.name || body.contactName || "").slice(0, 120);
    const contactEmail = normalizeEmail(body.email || body.contactEmail || auth.user?.email || "");
    const message = normalizeText(body.message).slice(0, 4000);
    const requestedMode = String(body.mode || body.accountMode || "").trim().toLowerCase();
    const accountMode = requestedMode === "public"
        ? "public"
        : normalizeWatchlistMode(body.mode || body.accountMode || (String(body.live).toLowerCase() === "true" ? "live" : "demo"));
    if (!message || message.length < 6) throw demoTradeError(400, "Write a short message before submitting a ticket.");
    if (!auth.profileId && !contactEmail) throw demoTradeError(400, "Enter an email address so Autody can respond.");

    const ticket = {
        id: crypto.randomUUID(),
        profileId: auth.profileId || auth.userId || null,
        email: contactEmail,
        name: contactName,
        accountMode,
        category,
        topic,
        priority,
        message,
        status: "open",
        createdAt: new Date().toISOString()
    };

    if (databaseConfigured()) {
        await ensureSupportTicketTables();
        await dbPool.query(`
            insert into support_tickets (
                id, profile_id, account_mode, category, topic, contact_name, contact_email, priority, message, status, created_at
            )
            values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'open', now())
        `, [ticket.id, auth.profileId || null, accountMode, category, topic, contactName, contactEmail, priority, message]);
        return ticket;
    }

    const db = loadDemoDb();
    db.supportTickets = Array.isArray(db.supportTickets) ? db.supportTickets : [];
    db.supportTickets.unshift(ticket);
    db.supportTickets = db.supportTickets.slice(0, 500);
    saveDemoDb(db);
    return ticket;
}

async function ensureKycTables(client = dbPool) {
    await client.query(`
        create table if not exists kyc_submissions (
          id uuid primary key,
          profile_id uuid not null references profiles(id) on delete cascade,
          account_mode text not null default 'live',
          document_type text not null,
          status text not null default 'in_review',
          document_path text not null,
          document_file_name text,
          document_content_type text,
          document_size_bytes integer not null default 0,
          document_back_path text,
          document_back_file_name text,
          document_back_content_type text,
          document_back_size_bytes integer not null default 0,
          selfie_path text not null,
          selfie_file_name text,
          selfie_content_type text,
          selfie_size_bytes integer not null default 0,
          review_reason text,
          review_note text,
          reviewer text,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now(),
          reviewed_at timestamptz
        );

        create index if not exists kyc_submissions_profile_idx
          on kyc_submissions (profile_id, created_at desc);

        create index if not exists kyc_submissions_status_idx
          on kyc_submissions (status, created_at desc);

        alter table kyc_submissions
          add column if not exists document_back_path text,
          add column if not exists document_back_file_name text,
          add column if not exists document_back_content_type text,
          add column if not exists document_back_size_bytes integer not null default 0,
          add column if not exists review_reason text;
    `);
}

function normalizeKycDocumentType(value = "") {
    const allowed = new Set(["passport", "government_id", "driver_license", "residence_permit"]);
    const normalized = String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, "_");
    return allowed.has(normalized) ? normalized : "government_id";
}

function kycContentExtension(contentType = "") {
    const type = String(contentType || "").toLowerCase();
    if (type === "image/jpeg" || type === "image/jpg") return "jpg";
    if (type === "image/png") return "png";
    if (type === "image/webp") return "webp";
    if (type === "application/pdf") return "pdf";
    return "bin";
}

function safeKycFileName(value = "", fallback = "upload") {
    return String(value || fallback)
        .trim()
        .replace(/[^a-zA-Z0-9._-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 120) || fallback;
}

function decodeKycUpload(file = {}, options = {}) {
    const label = options.label || "File";
    const allowPdf = Boolean(options.allowPdf);
    const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
    if (allowPdf) allowedTypes.add("application/pdf");
    if (!file || typeof file !== "object") throw demoTradeError(400, `${label} is required.`);

    let data = String(file.data || "");
    let contentType = String(file.type || "").trim().toLowerCase();
    const dataUrlMatch = data.match(/^data:([^;,]+);base64,(.*)$/);
    if (dataUrlMatch) {
        contentType = contentType || dataUrlMatch[1].toLowerCase();
        data = dataUrlMatch[2];
    }
    if (!data) throw demoTradeError(400, `${label} is empty.`);
    if (!allowedTypes.has(contentType)) {
        const expected = allowPdf ? "JPG, PNG, WEBP, or PDF" : "JPG, PNG, or WEBP";
        throw demoTradeError(400, `${label} must be ${expected}.`);
    }

    const bytes = Buffer.from(data, "base64");
    if (!bytes.length) throw demoTradeError(400, `${label} could not be read.`);
    if (bytes.length > KYC_MAX_FILE_BYTES) {
        throw demoTradeError(413, `${label} is too large. Keep it under ${Math.round(KYC_MAX_FILE_BYTES / 1024 / 1024)} MB.`);
    }

    return {
        bytes,
        name: safeKycFileName(file.name, `${label.toLowerCase().replace(/\s+/g, "-")}.${kycContentExtension(contentType)}`),
        contentType,
        size: bytes.length
    };
}

function encodeStoragePath(storagePath = "") {
    return String(storagePath || "")
        .split("/")
        .filter(Boolean)
        .map((part) => encodeURIComponent(part))
        .join("/");
}

async function uploadKycObject(storagePath, file) {
    if (!kycStorageConfigured()) {
        throw demoTradeError(503, "KYC private storage is not configured yet.");
    }
    const endpoint = `${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(KYC_STORAGE_BUCKET)}/${encodeStoragePath(storagePath)}`;
    const response = await fetch(endpoint, {
        method: "PUT",
        headers: {
            "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Content-Type": file.contentType,
            "x-upsert": "false"
        },
        body: file.bytes
    });
    if (!response.ok) {
        const detail = await response.text().catch(() => "");
        console.error("KYC storage upload failed:", response.status, detail.slice(0, 300));
        throw demoTradeError(502, "KYC private storage upload failed.");
    }
    return storagePath;
}

async function signedKycObjectUrl(storagePath, expiresIn = 600) {
    if (!kycStorageConfigured() || !storagePath) return "";
    const endpoint = `${SUPABASE_URL}/storage/v1/object/sign/${encodeURIComponent(KYC_STORAGE_BUCKET)}/${encodeStoragePath(storagePath)}`;
    const response = await fetch(endpoint, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ expiresIn })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
        console.error("KYC signed URL failed:", response.status, result);
        return "";
    }
    const signedUrl = result.signedURL || result.signedUrl || "";
    if (!signedUrl) return "";
    return signedUrl.startsWith("http")
        ? signedUrl
        : `${SUPABASE_URL}/storage/v1${signedUrl.startsWith("/") ? signedUrl : `/${signedUrl}`}`;
}

async function fetchKycObject(storagePath) {
    if (!kycStorageConfigured() || !storagePath) {
        throw demoTradeError(503, "KYC private storage is not configured yet.");
    }
    const endpoint = `${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(KYC_STORAGE_BUCKET)}/${encodeStoragePath(storagePath)}`;
    const response = await fetch(endpoint, {
        headers: {
            "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            "apikey": SUPABASE_SERVICE_ROLE_KEY
        }
    });
    if (!response.ok) {
        const detail = await response.text().catch(() => "");
        console.error("KYC storage download failed:", response.status, detail.slice(0, 300));
        throw demoTradeError(response.status === 404 ? 404 : 502, "KYC private storage download failed.");
    }
    return Buffer.from(await response.arrayBuffer());
}

async function deleteKycObject(storagePath) {
    if (!storagePath) return { path: "", deleted: false, skipped: true };
    if (!kycStorageConfigured()) {
        throw demoTradeError(503, "KYC private storage is not configured yet.");
    }
    const endpoint = `${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(KYC_STORAGE_BUCKET)}/${encodeStoragePath(storagePath)}`;
    const response = await fetch(endpoint, {
        method: "DELETE",
        headers: {
            "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            "apikey": SUPABASE_SERVICE_ROLE_KEY
        }
    });
    if (!response.ok && response.status !== 404) {
        const detail = await response.text().catch(() => "");
        console.error("KYC storage delete failed:", response.status, detail.slice(0, 300));
        throw demoTradeError(502, "KYC private storage delete failed.");
    }
    return { path: storagePath, deleted: response.ok, missing: response.status === 404 };
}

async function createKycSubmission(auth, body = {}) {
    if (!databaseConfigured()) {
        throw demoTradeError(503, "KYC review needs the secured account database first.");
    }
    if (auth.source !== "supabase") {
        throw demoTradeError(403, "Sign in with your Autody account before starting identity review.");
    }
    if (!kycStorageConfigured()) {
        throw demoTradeError(503, "KYC private storage is not configured yet.");
    }

    await ensureSignUpTables();
    await ensureKycTables();

    const verification = await dbPool.query(`
        select identity_status
        from profile_verifications
        where profile_id = $1
        limit 1
    `, [auth.profileId]);
    const activeIdentityStatus = normalizeText(verification.rows[0]?.identity_status).toLowerCase();
    if (["in_review", "verified"].includes(activeIdentityStatus)) {
        throw demoTradeError(
            409,
            activeIdentityStatus === "verified"
                ? "Identity is already verified."
                : "Identity review is already in progress."
        );
    }

    const documentType = normalizeKycDocumentType(body.documentType);
    const accountMode = normalizeWatchlistMode(body.mode || body.accountMode || "live");
    const documentUploads = Array.isArray(body.documentFiles) && body.documentFiles.length
        ? body.documentFiles
        : [body.documentFile].filter(Boolean);
    if (!documentUploads.length) throw demoTradeError(400, "Identity document is required.");
    if (documentUploads.length > 2) throw demoTradeError(400, "Upload no more than 2 identity document files.");
    const documentFile = decodeKycUpload(documentUploads[0], { label: "Identity document", allowPdf: true });
    const documentBackFile = documentUploads[1]
        ? decodeKycUpload(documentUploads[1], { label: "Identity document back", allowPdf: true })
        : null;
    const selfieFile = decodeKycUpload(body.selfieFile || body.faceFile, { label: "Face scan", allowPdf: false });
    const submissionId = crypto.randomUUID();
    const profileId = auth.profileId;
    const basePath = `profiles/${profileId}/${submissionId}`;
    const documentPath = `${basePath}/document.${kycContentExtension(documentFile.contentType)}`;
    const documentBackPath = documentBackFile
        ? `${basePath}/document-back.${kycContentExtension(documentBackFile.contentType)}`
        : null;
    const selfiePath = `${basePath}/face-scan.${kycContentExtension(selfieFile.contentType)}`;

    await uploadKycObject(documentPath, documentFile);
    if (documentBackFile && documentBackPath) await uploadKycObject(documentBackPath, documentBackFile);
    await uploadKycObject(selfiePath, selfieFile);
    await dbPool.query(`
        insert into kyc_submissions (
            id, profile_id, account_mode, document_type, status,
            document_path, document_file_name, document_content_type, document_size_bytes,
            document_back_path, document_back_file_name, document_back_content_type, document_back_size_bytes,
            selfie_path, selfie_file_name, selfie_content_type, selfie_size_bytes,
            created_at, updated_at
        )
        values ($1, $2, $3, $4, 'in_review', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, now(), now())
    `, [
        submissionId,
        profileId,
        accountMode,
        documentType,
        documentPath,
        documentFile.name,
        documentFile.contentType,
        documentFile.size,
        documentBackPath,
        documentBackFile?.name || null,
        documentBackFile?.contentType || null,
        documentBackFile?.size || 0,
        selfiePath,
        selfieFile.name,
        selfieFile.contentType,
        selfieFile.size
    ]);
    await dbPool.query(`
        update profile_verifications
        set identity_status = 'in_review',
            updated_at = now()
        where profile_id = $1
    `, [profileId]);

    const emailDelivery = await sendKycSubmittedEmail(auth.user?.email, auth.user?.name || auth.user?.displayName || "")
        .catch((err) => {
            console.error("KYC received email failed:", err.message || err);
            return { delivered: false, provider: "error", error: err.message || String(err) };
        });

    return {
        id: submissionId,
        status: "in_review",
        documentType,
        accountMode,
        createdAt: new Date().toISOString(),
        emailDelivery
    };
}

async function getAdminKycOverview(body = {}) {
    if (!databaseConfigured()) {
        throw demoTradeError(503, "KYC admin review needs the secured database.");
    }
    await ensureSignUpTables();
    await ensureKycTables();
    const limit = Math.max(1, Math.min(Number(body.limit || 25), 75));
    const status = normalizeText(body.status || "all").toLowerCase();
    const statusFilter = ["in_review", "approved", "rejected"].includes(status) ? status : "";
    const values = [];
    let where = "";
    if (statusFilter) {
        values.push(statusFilter);
        where = "where ks.status = $1";
    }
    values.push(limit);
    const limitPlaceholder = `$${values.length}`;
    const result = await dbPool.query(`
        select
            ks.id,
            ks.profile_id,
            ks.account_mode,
            ks.document_type,
            ks.status,
            ks.document_path,
            ks.document_file_name,
            ks.document_content_type,
            ks.document_size_bytes,
            ks.document_back_path,
            ks.document_back_file_name,
            ks.document_back_content_type,
            ks.document_back_size_bytes,
            ks.selfie_path,
            ks.selfie_file_name,
            ks.selfie_content_type,
            ks.selfie_size_bytes,
            ks.review_reason,
            ks.review_note,
            ks.reviewer,
            ks.created_at,
            ks.updated_at,
            ks.reviewed_at,
            p.email,
            p.display_name,
            pv.first_name,
            pv.last_name,
            pv.legal_name,
            pv.country,
            pv.date_of_birth,
            pv.identity_status
        from kyc_submissions ks
        join profiles p on p.id = ks.profile_id
        left join profile_verifications pv on pv.profile_id = p.id
        ${where}
        order by
          case when ks.status = 'in_review' then 0 else 1 end,
          ks.created_at desc
        limit ${limitPlaceholder}
    `, values);

    const rows = await Promise.all(result.rows.map(async (row) => {
        const displayName = normalizeText(row.display_name || row.legal_name || `${row.first_name || ""} ${row.last_name || ""}`) || titleFromEmail(row.email);
        return {
            id: row.id,
            profileId: row.profile_id,
            email: row.email,
            displayName,
            firstName: row.first_name || "",
            lastName: row.last_name || "",
            country: row.country || "",
            dateOfBirth: row.date_of_birth || "",
            accountMode: row.account_mode,
            documentType: row.document_type,
            status: row.status,
            identityStatus: row.identity_status || "pending",
            documentFileName: row.document_file_name || "Identity document",
            documentContentType: row.document_content_type || "",
            documentSizeBytes: Number(row.document_size_bytes || 0),
            documentBackFileName: row.document_back_file_name || "Identity document back",
            documentBackContentType: row.document_back_content_type || "",
            documentBackSizeBytes: Number(row.document_back_size_bytes || 0),
            selfieFileName: row.selfie_file_name || "Face scan",
            selfieContentType: row.selfie_content_type || "",
            selfieSizeBytes: Number(row.selfie_size_bytes || 0),
            documentUrl: await signedKycObjectUrl(row.document_path),
            documentBackUrl: await signedKycObjectUrl(row.document_back_path),
            selfieUrl: await signedKycObjectUrl(row.selfie_path),
            reviewReason: row.review_reason || "",
            reviewNote: row.review_note || "",
            reviewer: row.reviewer || "",
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            reviewedAt: row.reviewed_at
        };
    }));

    return {
        success: true,
        configured: kycStorageConfigured(),
        bucket: KYC_STORAGE_BUCKET,
        submissions: rows,
        generatedAt: new Date().toISOString()
    };
}

async function getAdminKycDownload(body = {}) {
    if (!databaseConfigured()) {
        throw demoTradeError(503, "KYC admin download needs the secured database.");
    }
    await ensureSignUpTables();
    await ensureKycTables();
    const submissionId = normalizeText(body.submissionId || body.id);
    const requestedKind = normalizeText(body.kind || body.fileKind || body.type).toLowerCase();
    const kind = ["selfie", "face", "face_scan", "face-scan"].includes(requestedKind)
        ? "selfie"
        : ["document_back", "document-back", "back", "documentback"].includes(requestedKind)
            ? "document_back"
            : "document";
    if (!submissionId) throw demoTradeError(400, "Submission ID is required.");

    const result = await dbPool.query(`
        select
            ks.id,
            ks.document_path,
            ks.document_file_name,
            ks.document_content_type,
            ks.document_back_path,
            ks.document_back_file_name,
            ks.document_back_content_type,
            ks.selfie_path,
            ks.selfie_file_name,
            ks.selfie_content_type,
            p.email
        from kyc_submissions ks
        join profiles p on p.id = ks.profile_id
        where ks.id = $1
        limit 1
    `, [submissionId]);
    const row = result.rows[0];
    if (!row) throw demoTradeError(404, "KYC submission was not found.");

    const fileMeta = {
        document: {
            storagePath: row.document_path,
            contentType: row.document_content_type,
            originalName: row.document_file_name,
            prefix: "identity-document"
        },
        document_back: {
            storagePath: row.document_back_path,
            contentType: row.document_back_content_type,
            originalName: row.document_back_file_name,
            prefix: "identity-document-back"
        },
        selfie: {
            storagePath: row.selfie_path,
            contentType: row.selfie_content_type,
            originalName: row.selfie_file_name,
            prefix: "face-scan"
        }
    }[kind];
    if (!fileMeta?.storagePath) throw demoTradeError(404, "Requested KYC file was not found.");
    const contentType = fileMeta.contentType || "application/octet-stream";
    const fallbackName = `${fileMeta.prefix}-${submissionId}.${kycContentExtension(contentType)}`;
    const safeName = safeKycFileName(fileMeta.originalName, fallbackName);
    const accountPrefix = safeKycFileName(String(row.email || "autody-account").split("@")[0], "autody-account");
    const fileName = `${accountPrefix}-${fileMeta.prefix}-${safeName}`;
    const bytes = await fetchKycObject(fileMeta.storagePath);

    return {
        bytes,
        contentType: contentType || "application/octet-stream",
        fileName
    };
}

async function deleteAdminKycSubmission(body = {}) {
    if (!databaseConfigured()) {
        throw demoTradeError(503, "KYC admin delete needs the secured database.");
    }
    await ensureSignUpTables();
    await ensureKycTables();
    const submissionId = normalizeText(body.submissionId || body.id);
    if (!submissionId) throw demoTradeError(400, "Submission ID is required.");

    const result = await dbPool.query(`
        select id, profile_id, status, document_path, document_back_path, selfie_path
        from kyc_submissions
        where id = $1
        limit 1
    `, [submissionId]);
    const row = result.rows[0];
    if (!row) throw demoTradeError(404, "KYC submission was not found.");

    const deletedFiles = [];
    deletedFiles.push(await deleteKycObject(row.document_path));
    deletedFiles.push(await deleteKycObject(row.document_back_path));
    deletedFiles.push(await deleteKycObject(row.selfie_path));

    await dbPool.query(`delete from kyc_submissions where id = $1`, [submissionId]);
    const remaining = await dbPool.query(`
        select status
        from kyc_submissions
        where profile_id = $1
        order by created_at desc
        limit 1
    `, [row.profile_id]);
    const remainingStatus = remaining.rows[0]?.status || "pending";
    const identityStatus = remainingStatus === "approved" ? "verified" : remainingStatus;
    await dbPool.query(`
        update profile_verifications
        set identity_status = $2,
            updated_at = now()
        where profile_id = $1
    `, [row.profile_id, identityStatus]);

    return {
        success: true,
        deletedSubmission: submissionId,
        deletedFiles,
        identityStatus
    };
}

async function reviewKycSubmission(body = {}) {
    if (!databaseConfigured()) {
        throw demoTradeError(503, "KYC admin review needs the secured database.");
    }
    await ensureSignUpTables();
    await ensureKycTables();
    const submissionId = normalizeText(body.submissionId || body.id);
    const requestedStatus = normalizeText(body.status || body.action).toLowerCase();
    const statusMap = {
        approve: "approved",
        approved: "approved",
        verify: "approved",
        verified: "approved",
        reject: "rejected",
        rejected: "rejected",
        review: "in_review",
        in_review: "in_review"
    };
    const status = statusMap[requestedStatus] || "";
    if (!submissionId) throw demoTradeError(400, "Submission ID is required.");
    if (!status) throw demoTradeError(400, "Choose approved, rejected, or in_review.");

    const reviewer = normalizeText(body.reviewer || "Autody admin") || "Autody admin";
    const reviewReason = status === "rejected"
        ? normalizeKycRejectionReason(body.reviewReason || body.reason)
        : "";
    const reviewNote = normalizeText(body.reviewNote || body.note || (status === "rejected" ? kycRejectionReasonLabel(reviewReason) : ""));
    const identityStatus = status === "approved" ? "verified" : status;
    const result = await dbPool.query(`
        update kyc_submissions
        set status = $2,
            review_note = $3,
            review_reason = $4,
            reviewer = $5,
            reviewed_at = case when $2 = 'in_review' then null else now() end,
            updated_at = now()
        where id = $1
        returning id, profile_id, status, review_reason, review_note, reviewed_at
    `, [submissionId, status, reviewNote, reviewReason, reviewer]);
    const row = result.rows[0];
    if (!row) throw demoTradeError(404, "KYC submission was not found.");

    await dbPool.query(`
        update profile_verifications
        set identity_status = $2,
            updated_at = now()
        where profile_id = $1
    `, [row.profile_id, identityStatus]);

    const profileResult = await dbPool.query(`
        select p.email, p.display_name, pv.first_name, pv.last_name, pv.legal_name
        from profiles p
        left join profile_verifications pv on pv.profile_id = p.id
        where p.id = $1
        limit 1
    `, [row.profile_id]).catch(() => ({ rows: [] }));
    const profile = profileResult.rows[0] || {};
    const displayName = normalizeText(profile.display_name || profile.legal_name || `${profile.first_name || ""} ${profile.last_name || ""}`) || titleFromEmail(profile.email);
    const emailDelivery = await sendKycDecisionEmail(profile.email, {
        status,
        displayName,
        reviewReason: row.review_reason,
        reviewNote: row.review_note
    }).catch((err) => {
        console.error("KYC decision email failed:", err.message || err);
        return { delivered: false, provider: "error", error: err.message || String(err) };
    });

    return {
        success: true,
        submission: {
            id: row.id,
            profileId: row.profile_id,
            status: row.status,
            reviewReason: row.review_reason || "",
            reviewNote: row.review_note || "",
            identityStatus,
            reviewedAt: row.reviewed_at
        },
        emailDelivery
    };
}

async function createDatabaseSession(profileId, sessionHours = SESSION_HOURS) {
    return createDatabaseSessionWithClient(dbPool, profileId, sessionHours);
}

async function ensureSignUpTables(client = dbPool) {
    await client.query(`
        create table if not exists profile_verifications (
          profile_id uuid primary key references profiles(id) on delete cascade,
          first_name text,
          last_name text,
          legal_name text not null,
          phone text not null,
          country text not null,
          date_of_birth date not null,
          account_type text not null default 'personal',
          email_status text not null default 'pending',
          phone_status text not null default 'pending',
          identity_status text not null default 'pending',
          risk_status text not null default 'pending',
          terms_version text not null default '${ACCOUNT_TERMS_VERSION}',
          terms_accepted_at timestamptz,
          information_confirmed_at timestamptz,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        );

        alter table if exists profile_verifications
          add column if not exists first_name text,
          add column if not exists last_name text,
          add column if not exists terms_version text not null default '${ACCOUNT_TERMS_VERSION}',
          add column if not exists terms_accepted_at timestamptz,
          add column if not exists information_confirmed_at timestamptz;

        create index if not exists profile_verifications_phone_idx
          on profile_verifications (phone);

        create table if not exists verification_codes (
          id uuid primary key default gen_random_uuid(),
          profile_id uuid not null references profiles(id) on delete cascade,
          channel text not null check (channel in ('email', 'phone')),
          destination text not null,
          purpose text not null default 'sign_up',
          code_salt text not null,
          code_hash text not null,
          status text not null default 'pending',
          attempts integer not null default 0,
          created_at timestamptz not null default now(),
          expires_at timestamptz not null,
          verified_at timestamptz
        );

        create index if not exists verification_codes_profile_status_idx
          on verification_codes (profile_id, channel, status, created_at desc);

        create index if not exists verification_codes_profile_purpose_status_idx
          on verification_codes (profile_id, channel, purpose, status, created_at desc);

        create table if not exists trusted_devices (
          id uuid primary key default gen_random_uuid(),
          profile_id uuid not null references profiles(id) on delete cascade,
          token_hash text not null unique,
          created_at timestamptz not null default now(),
          expires_at timestamptz not null
        );

        create index if not exists trusted_devices_profile_idx
          on trusted_devices (profile_id, expires_at desc);

        alter table if exists profile_credentials
          add column if not exists totp_secret text,
          add column if not exists totp_pending_secret text,
          add column if not exists totp_enabled boolean not null default false,
          add column if not exists totp_confirmed_at timestamptz;

        alter table if exists account_settings
          add column if not exists deposit_alerts boolean not null default false,
          add column if not exists withdrawal_alerts boolean not null default false,
          add column if not exists price_alerts boolean not null default false,
          add column if not exists research_brief boolean not null default false;
    `);
}

async function seedAccountWallet(client, profileId, mode, startingBalance) {
    const modeResult = await client.query(`
        insert into account_modes (profile_id, mode, status)
        values ($1, $2, 'active')
        on conflict (profile_id, mode) do update set status = 'active'
        returning id
    `, [profileId, mode]);
    const accountModeId = modeResult.rows[0].id;

    const walletResult = await client.query(`
        insert into wallets (account_mode_id, currency, cash_balance, reserved_cash, starting_balance)
        values ($1, 'USD', $2, 0, $2)
        on conflict (account_mode_id) do update
        set currency = excluded.currency,
            updated_at = now()
        returning id
    `, [accountModeId, startingBalance]);
    const walletId = walletResult.rows[0].id;

    const seedHoldings = [
        ["USD", mode === "demo" ? "USD Cash" : "USD Funds", "cash", startingBalance, startingBalance],
        ["AU", "Autody AU", "currency", 0, 0],
        ["CRYPTO", "Crypto", "crypto", 0, 0],
        ["STOCKS", "Stocks", "stock", 0, 0],
        ["ETFS", "ETFs", "etf", 0, 0],
        ["OILMETALS", "Oil and metals", "commodity", 0, 0]
    ];

    for (const [symbol, assetName, assetType, quantity, valueUsd] of seedHoldings) {
        await client.query(`
            insert into holdings (wallet_id, symbol, asset_name, asset_type, quantity, average_cost, last_price, value_usd, updated_at)
            values ($1, $2, $3, $4, $5, case when $2 = 'USD' then 1 else null end, case when $2 = 'USD' then 1 else null end, $6, now())
            on conflict (wallet_id, symbol) do nothing
        `, [walletId, symbol, assetName, assetType, quantity, valueUsd]);
    }

    return { accountModeId, walletId };
}

async function createDatabaseAccount(signUp) {
    if (!databaseConfigured()) return null;

    const client = await dbPool.connect();
    try {
        await client.query("begin");
        await ensureSignUpTables(client);
        await cleanupExpiredDatabasePendingAccounts(client).catch((err) => {
            console.error("Pending account cleanup failed:", err.message || err);
        });

        const existing = await client.query(`
            select id from profiles where lower(email) = lower($1) limit 1
        `, [signUp.email]);
        if (existing.rows[0]) throw signUpError(409, "An Autody account already exists for this email.");

        const existingPhone = await client.query(`
            select 1 from profile_verifications where phone = $1 limit 1
        `, [signUp.phone]);
        if (existingPhone.rows[0]) throw signUpError(409, "This phone number is already connected to an Autody account.");

        const profileResult = await client.query(`
            insert into profiles (email, display_name)
            values ($1, $2)
            returning id, email, display_name, created_at
        `, [signUp.email, signUp.displayName]);
        const profile = profileResult.rows[0];

        const passwordSalt = crypto.randomBytes(16).toString("hex");
        await client.query(`
            insert into profile_credentials (profile_id, password_algorithm, password_salt, password_hash)
            values ($1, 'scrypt', $2, $3)
        `, [profile.id, passwordSalt, hashPassword(signUp.password, passwordSalt)]);

        await client.query(`
            insert into profile_verifications (
              profile_id, first_name, last_name, legal_name, phone, country, date_of_birth, account_type,
              email_status, phone_status, identity_status, risk_status, terms_version, terms_accepted_at,
              information_confirmed_at
            )
            values ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', 'not_required', 'pending', 'pending', $9, $10, $11)
        `, [
            profile.id,
            signUp.firstName,
            signUp.lastName,
            signUp.legalName,
            signUp.phone,
            signUp.country,
            signUp.dateOfBirth,
            signUp.accountType,
            signUp.termsVersion,
            signUp.termsAcceptedAt,
            signUp.informationConfirmedAt
        ]);

        const emailVerificationCode = createVerificationCodeRecord("email", signUp.email);
        const emailHandoffCode = createVerificationCodeRecord("email", signUp.email);
        const verificationCodes = [
            { ...emailVerificationCode, purpose: "sign_up" },
            { ...emailHandoffCode, purpose: "email_handoff" }
        ];
        for (const item of verificationCodes) {
            await client.query(`
                insert into verification_codes (profile_id, channel, destination, purpose, code_salt, code_hash, expires_at)
                values ($1, $2, $3, $4, $5, $6, $7)
            `, [profile.id, item.channel, item.destination, item.purpose, item.salt, item.hash, item.expiresAt]);
        }

        await client.query(`
            insert into account_settings (profile_id, default_mode, currency, risk_level, order_confirmation, market_alerts, news_alerts)
            values ($1, 'live', 'USD', 'standard', false, false, false)
            on conflict (profile_id) do nothing
        `, [profile.id]);

        const demoAccount = await seedAccountWallet(client, profile.id, "demo", 50000);
        await seedAccountWallet(client, profile.id, "live", 0);

        await client.query(`
            insert into demo_performance (account_mode_id, portfolio_value, starting_balance)
            values ($1, 50000, 50000)
            on conflict (account_mode_id) do nothing
        `, [demoAccount.accountModeId]);

        for (const topic of ["Crypto", "Stocks", "Gold", "Rates", "Inflation", "AU utility"]) {
            await client.query(`
                insert into research_preferences (profile_id, topic)
                values ($1, $2)
                on conflict (profile_id, topic) do nothing
            `, [profile.id, topic]);
        }

        await client.query("commit");

        console.log("Autody verification codes created for", signUp.email, verificationCodes.map((item) => `${item.channel}:${item.code}`).join(" "));

        return {
            user: {
                id: profile.id,
                name: profile.display_name,
                email: profile.email,
                mode: "live",
                currency: "USD",
                createdAt: profile.created_at,
                verification: {
                    email: "pending",
                    phone: "not_required",
                    identity: "pending"
                }
            },
            source: "supabase",
            verificationDelivery: {
                emailToken: emailVerificationCode.code || "",
                emailHandoffToken: emailHandoffCode.code || ""
            }
        };
    } catch (err) {
        await client.query("rollback").catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

function cleanupExpiredJsonPendingAccounts(db) {
    if (!UNVERIFIED_ACCOUNT_RETENTION_DAYS) return false;
    const cutoff = Date.now() - UNVERIFIED_ACCOUNT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const removedIds = new Set();

    db.users = (db.users || []).filter((user) => {
        if (user.id === PRACTICE_USER_ID) return true;
        const emailVerified = user.verification?.emailStatus === "verified";
        const createdAt = Date.parse(user.createdAt || "");
        if (!emailVerified && Number.isFinite(createdAt) && createdAt < cutoff) {
            removedIds.add(user.id);
            return false;
        }
        return true;
    });

    if (!removedIds.size) return false;

    for (const id of removedIds) {
        delete db.wallets?.[id];
        delete db.orders?.[id];
        delete db.watchlists?.[id];
        delete db.researchPreferences?.[id];
        delete db.performance?.[id];
        delete db.settings?.[id];
        delete db.verificationCodes?.[id];
        delete db.depositRequests?.[id];
        delete db.fiatFundingRequests?.[id];
    }
    db.sessions = (db.sessions || []).filter((session) => !removedIds.has(session.userId));
    return true;
}

function createJsonAccount(signUp) {
    const db = loadDemoDb();
    cleanupExpiredJsonPendingAccounts(db);
    const existing = (db.users || []).find((user) => normalizeEmail(user.email) === signUp.email);
    if (existing) throw signUpError(409, "An Autody account already exists for this email.");
    const phoneOwner = (db.users || []).find((user) => user.id !== PRACTICE_USER_ID && normalizePhone(user.verification?.phone) === signUp.phone);
    if (phoneOwner) throw signUpError(409, "This phone number is already connected to an Autody account.");

    const userId = crypto.randomUUID();
    const passwordSalt = crypto.randomBytes(16).toString("hex");
    const now = new Date().toISOString();
    const user = {
        id: userId,
        name: signUp.displayName,
        email: signUp.email,
        mode: "live",
        currency: "USD",
        startingBalance: 50000,
        cashBalance: 0,
        reservedCash: 0,
        createdAt: now,
        auth: {
            passwordAlgorithm: "scrypt",
            passwordSalt,
            passwordHash: hashPassword(signUp.password, passwordSalt),
            passwordUpdatedAt: now
        },
        verification: {
            firstName: signUp.firstName,
            lastName: signUp.lastName,
            legalName: signUp.legalName,
            phone: signUp.phone,
            country: signUp.country,
            dateOfBirth: signUp.dateOfBirth,
            accountType: signUp.accountType,
            emailStatus: "pending",
            phoneStatus: "not_required",
            identityStatus: "pending",
            termsVersion: signUp.termsVersion,
            termsAcceptedAt: signUp.termsAcceptedAt,
            informationConfirmedAt: signUp.informationConfirmedAt
        }
    };

    db.users = db.users || [];
    db.users.push(user);
    db.wallets = db.wallets || {};
    db.wallets[userId] = {
        cash: {
            symbol: "USD",
            name: "USD Cash",
            balance: 50000,
            valueUsd: 50000,
            status: "Available"
        },
        liveCash: {
            symbol: "USD",
            name: "USD Funds",
            balance: 0,
            valueUsd: 0,
            status: "Awaiting deposit"
        },
        holdings: [
            { symbol: "AU", name: "Autody AU", category: "currency", balance: 0, valueUsd: 0, status: "Not held" },
            { symbol: "CRYPTO", name: "Crypto", category: "crypto", balance: 0, valueUsd: 0, status: "Ready" },
            { symbol: "STOCKS", name: "Stocks", category: "stocks", balance: 0, valueUsd: 0, status: "Ready" },
            { symbol: "ETFS", name: "ETFs", category: "etf", balance: 0, valueUsd: 0, status: "Ready" },
            { symbol: "OILMETALS", name: "Oil and metals", category: "commodity", balance: 0, valueUsd: 0, status: "Ready" }
        ]
    };
    db.orders = db.orders || {};
    db.orders[userId] = [];
    db.depositRequests = db.depositRequests || {};
    db.depositRequests[userId] = [];
    db.fiatFundingRequests = db.fiatFundingRequests || {};
    db.fiatFundingRequests[userId] = [];
    db.watchlists = db.watchlists || {};
    db.watchlists[userId] = {
        demo: defaultWatchlistForMode("demo"),
        live: defaultWatchlistForMode("live")
    };
    db.researchPreferences = db.researchPreferences || {};
    db.researchPreferences[userId] = ["Crypto", "Stocks", "Gold", "Rates", "Inflation", "AU utility"];
    db.performance = db.performance || {};
    db.performance[userId] = {
        portfolioValue: 50000,
        startingBalance: 50000,
        unrealizedProfitLoss: 0,
        realizedProfitLoss: 0,
        todayProfitLoss: 0,
        todayProfitLossPct: 0,
        winRatePct: 0,
        tradesPlaced: 0
    };
    db.settings = db.settings || {};
    db.settings[userId] = {
        defaultMode: "live",
        currency: "USD",
        riskLevel: "standard",
        orderConfirmation: false,
        marketAlerts: false,
        newsAlerts: false
    };

    const emailVerificationCode = createVerificationCodeRecord("email", signUp.email);
    const emailHandoffCode = createVerificationCodeRecord("email", signUp.email);
    const verificationCodes = [
        { ...emailVerificationCode, purpose: "sign_up" },
        { ...emailHandoffCode, purpose: "email_handoff" }
    ];
    db.verificationCodes = db.verificationCodes || {};
    db.verificationCodes[userId] = verificationCodes.map((item) => ({
        channel: item.channel,
        purpose: item.purpose,
        destination: item.destination,
        salt: item.salt,
        hash: item.hash,
        expiresAt: item.expiresAt,
        status: "pending",
        createdAt: now
    }));

    saveDemoDb(db);
    console.log("Autody local verification codes created for", signUp.email, verificationCodes.map((item) => `${item.channel}:${item.code}`).join(" "));

    return {
        user: publicUser(user),
        source: "json",
        verificationDelivery: {
            emailToken: emailVerificationCode.code || "",
            emailHandoffToken: emailHandoffCode.code || ""
        }
    };
}

async function databaseProfileVerification(email) {
    if (!databaseConfigured()) return null;
    await ensureSignUpTables();
    const result = await dbPool.query(`
        select
            p.id,
            p.email,
            p.display_name,
            p.created_at,
            pv.first_name,
            pv.last_name,
            pv.legal_name,
            pv.phone,
            pv.country,
            pv.date_of_birth,
            pv.account_type,
            pv.email_status,
            pv.phone_status,
            pv.identity_status,
            pv.terms_version,
            pv.terms_accepted_at,
            pv.information_confirmed_at
        from profiles p
        join profile_verifications pv on pv.profile_id = p.id
        where lower(p.email) = lower($1)
        limit 1
    `, [email]);
    return syncDatabaseEmailStatusFromVerifiedCode(result.rows[0] || null);
}

async function syncDatabaseEmailStatusFromVerifiedCode(profile, client = dbPool) {
    if (!profile || profile.email_status === "verified") return profile;
    const profileId = profile.id || profile.profile_id;
    if (!profileId) return profile;
    const verifiedCode = await client.query(`
        select 1
        from verification_codes
        where profile_id = $1
          and channel = 'email'
          and purpose = 'sign_up'
          and status = 'verified'
        limit 1
    `, [profileId]);
    if (!verifiedCode.rows[0]) return profile;
    await client.query(`
        update profile_verifications
        set email_status = 'verified', updated_at = now()
        where profile_id = $1
    `, [profileId]);
    return { ...profile, email_status: "verified" };
}

async function cleanupExpiredDatabasePendingAccounts(client = dbPool) {
    if (!databaseConfigured() || !UNVERIFIED_ACCOUNT_RETENTION_DAYS) return;
    await ensureSignUpTables(client);
    const cutoff = new Date(Date.now() - UNVERIFIED_ACCOUNT_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    await client.query(`
        delete from profiles p
        using profile_verifications pv
        where pv.profile_id = p.id
          and coalesce(pv.email_status, 'pending') <> 'verified'
          and p.created_at < $1
    `, [cutoff]);
}

function resetJsonAccountsToEmail(keepEmail = PRACTICE_USER_EMAIL) {
    const db = loadDemoDb();
    const normalizedKeepEmail = normalizeEmail(keepEmail || PRACTICE_USER_EMAIL);
    const keepIds = new Set((db.users || [])
        .filter((user) => normalizeEmail(user.email) === normalizedKeepEmail || user.id === PRACTICE_USER_ID)
        .map((user) => user.id));
    if (!keepIds.size) keepIds.add(PRACTICE_USER_ID);

    const before = (db.users || []).length;
    db.users = (db.users || []).filter((user) => keepIds.has(user.id));
    db.sessions = (db.sessions || []).filter((session) => keepIds.has(session.userId));
    db.trustedDevices = (db.trustedDevices || []).filter((device) => keepIds.has(device.userId));
    for (const key of ["wallets", "orders", "watchlists", "researchPreferences", "performance", "settings", "verificationCodes", "depositRequests", "fiatFundingRequests"]) {
        if (!db[key] || typeof db[key] !== "object") continue;
        Object.keys(db[key]).forEach((userId) => {
            if (!keepIds.has(userId)) delete db[key][userId];
        });
    }
    saveDemoDb(db);
    return {
        kept: db.users.map((user) => user.email),
        deleted: Math.max(0, before - db.users.length)
    };
}

async function resetDatabaseAccountsToEmail(keepEmail = PRACTICE_USER_EMAIL) {
    if (!databaseConfigured()) return { configured: false, deleted: 0, kept: [] };
    const normalizedKeepEmail = normalizeEmail(keepEmail || PRACTICE_USER_EMAIL);
    const client = await dbPool.connect();
    try {
        await client.query("begin");
        const keptBefore = await client.query(`
            select email from profiles where lower(email) = lower($1)
        `, [normalizedKeepEmail]);
        const deleteTargets = await client.query(`
            select id, email
            from profiles
            where lower(email) <> lower($1)
        `, [normalizedKeepEmail]);

        await client.query(`
            delete from holdings
            where wallet_id in (
              select w.id
              from wallets w
              join account_modes am on am.id = w.account_mode_id
              join profiles p on p.id = am.profile_id
              where lower(p.email) <> lower($1)
            )
        `, [normalizedKeepEmail]);
        await client.query(`
            delete from demo_performance
            where account_mode_id in (
              select am.id
              from account_modes am
              join profiles p on p.id = am.profile_id
              where lower(p.email) <> lower($1)
            )
        `, [normalizedKeepEmail]);
        await client.query(`
            delete from orders
            where account_mode_id in (
              select am.id
              from account_modes am
              join profiles p on p.id = am.profile_id
              where lower(p.email) <> lower($1)
            )
        `, [normalizedKeepEmail]);
        await client.query(`
            delete from wallets
            where account_mode_id in (
              select am.id
              from account_modes am
              join profiles p on p.id = am.profile_id
              where lower(p.email) <> lower($1)
            )
        `, [normalizedKeepEmail]);
        await client.query(`
            delete from account_modes
            where profile_id in (
              select id from profiles where lower(email) <> lower($1)
            )
        `, [normalizedKeepEmail]);
        await client.query(`
            delete from app_sessions
            where profile_id in (
              select id from profiles where lower(email) <> lower($1)
            )
        `, [normalizedKeepEmail]);
        await client.query(`
            delete from verification_codes
            where profile_id in (
              select id from profiles where lower(email) <> lower($1)
            )
        `, [normalizedKeepEmail]);
        await client.query(`
            delete from watchlists
            where profile_id in (
              select id from profiles where lower(email) <> lower($1)
            )
        `, [normalizedKeepEmail]);
        await client.query(`
            delete from research_preferences
            where profile_id in (
              select id from profiles where lower(email) <> lower($1)
            )
        `, [normalizedKeepEmail]);
        await client.query(`
            delete from account_settings
            where profile_id in (
              select id from profiles where lower(email) <> lower($1)
            )
        `, [normalizedKeepEmail]);
        await client.query(`
            delete from profile_credentials
            where profile_id in (
              select id from profiles where lower(email) <> lower($1)
            )
        `, [normalizedKeepEmail]);
        await client.query(`
            delete from profile_verifications
            where profile_id in (
              select id from profiles where lower(email) <> lower($1)
            )
        `, [normalizedKeepEmail]);
        const deleted = await client.query(`
            delete from profiles
            where lower(email) <> lower($1)
            returning email
        `, [normalizedKeepEmail]);
        await client.query(`
            insert into profile_verifications (
              profile_id, first_name, last_name, legal_name, phone, country, date_of_birth, account_type,
              email_status, phone_status, identity_status, risk_status, terms_version, terms_accepted_at,
              information_confirmed_at
            )
            select id,
                   'Adrian',
                   'Cole',
                   'Adrian Cole',
                   '+15550190777',
                   'United States',
                   '1994-08-16',
                   'personal',
                   'verified',
                   'not_required',
                   'pending',
                   'standard',
                   $2,
                   now(),
                   now()
            from profiles
            where lower(email) = lower($1)
            on conflict (profile_id) do update
            set first_name = excluded.first_name,
                last_name = excluded.last_name,
                legal_name = excluded.legal_name,
                phone = excluded.phone,
                country = excluded.country,
                date_of_birth = excluded.date_of_birth,
                account_type = excluded.account_type,
                email_status = 'verified',
                phone_status = excluded.phone_status,
                identity_status = excluded.identity_status,
                risk_status = excluded.risk_status,
                terms_version = excluded.terms_version,
                terms_accepted_at = coalesce(profile_verifications.terms_accepted_at, excluded.terms_accepted_at),
                information_confirmed_at = coalesce(profile_verifications.information_confirmed_at, excluded.information_confirmed_at),
                updated_at = now()
        `, [normalizedKeepEmail, ACCOUNT_TERMS_VERSION]);
        await client.query(`
            create unique index if not exists profile_verifications_phone_unique_idx
              on profile_verifications (phone)
        `);
        await client.query("commit");
        return {
            configured: true,
            deleted: deleteTargets.rowCount || deleted.rowCount || 0,
            deletedEmails: deleteTargets.rows.map((row) => row.email),
            kept: keptBefore.rows.map((row) => row.email)
        };
    } catch (err) {
        await client.query("rollback").catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

function databasePublicUser(row) {
    if (!row) return null;
    const nameParts = profileNamePartsFromRow(row);
    return {
        id: row.id || row.profile_id,
        name: row.display_name,
        email: row.email,
        mode: "live",
        currency: "USD",
        createdAt: row.created_at,
        profile: {
            firstName: nameParts.firstName,
            lastName: nameParts.lastName,
            legalName: nameParts.legalName,
            phone: publicProfilePhone(row),
            country: publicProfileCountry(row),
            dateOfBirth: publicProfileDateOfBirth(row),
            accountType: row.account_type || "personal",
            termsVersion: row.terms_version || "",
            termsAcceptedAt: row.terms_accepted_at || "",
            informationConfirmedAt: row.information_confirmed_at || ""
        },
        verification: {
            email: row.email_status || "pending",
            phone: row.phone_status || "pending",
            identity: row.identity_status || "pending"
        }
    };
}

async function createDatabaseVerificationCode(email, channel, purpose = "sign_up", options = {}) {
    const profile = await databaseProfileVerification(email);
    if (!profile) return null;

    const destination = channel === "email" ? profile.email : profile.phone;
    const item = createVerificationCodeRecord(channel, destination, options);
    await dbPool.query(`
        update verification_codes
        set status = 'replaced'
        where profile_id = $1 and channel = $2 and purpose = $3 and status = 'pending'
    `, [profile.id, channel, purpose]);
    await dbPool.query(`
        insert into verification_codes (profile_id, channel, destination, purpose, code_salt, code_hash, expires_at)
        values ($1, $2, $3, $4, $5, $6, $7)
    `, [profile.id, channel, destination, purpose, item.salt, item.hash, item.expiresAt]);

    return { profile, code: item.code, destination };
}

async function verifyDatabaseCode(email, channel, code, purpose = "sign_up", options = {}) {
    if (!databaseConfigured()) return null;
    const profile = await databaseProfileVerification(email);
    if (!profile) return null;
    if (channel === "phone" && profile.email_status !== "verified") {
        return { success: false, error: "Verify your email before confirming your phone number." };
    }

    const result = await dbPool.query(`
        select id, code_salt, code_hash, expires_at, attempts
        from verification_codes
        where profile_id = $1 and channel = $2 and purpose = $3 and status = 'pending'
        order by created_at desc
        limit 1
    `, [profile.id, channel, purpose]);
    const record = result.rows[0];
    if (!record) return { success: false, error: "No active verification code found." };
    if (Date.parse(record.expires_at) <= Date.now()) {
        await dbPool.query("update verification_codes set status = 'expired' where id = $1", [record.id]);
        return { success: false, error: "Verification code expired. Request a new one." };
    }
    if (Number(record.attempts || 0) >= 5) {
        return { success: false, error: "Too many verification attempts. Request a new code." };
    }

    const suppliedHash = verificationCodeHash(code, record.code_salt);
    if (!sameHashValue(suppliedHash, record.code_hash)) {
        await dbPool.query("update verification_codes set attempts = attempts + 1 where id = $1", [record.id]);
        return { success: false, error: "Verification code is incorrect." };
    }

    await dbPool.query("update verification_codes set status = 'verified', verified_at = now() where id = $1", [record.id]);
    if (options.markProfileVerified !== false) {
        const statusColumn = channel === "email" ? "email_status" : "phone_status";
        await dbPool.query(`
            update profile_verifications
            set ${statusColumn} = 'verified', updated_at = now()
            where profile_id = $1
        `, [profile.id]);
    }

    const updated = await databaseProfileVerification(email);
    return { success: true, profile: updated };
}

function jsonUserByEmail(db, email) {
    return (db.users || []).find((user) => normalizeEmail(user.email) === normalizeEmail(email));
}

function createJsonVerificationCode(email, channel, purpose = "sign_up", options = {}) {
    const db = loadDemoDb();
    const user = jsonUserByEmail(db, email);
    if (!user) return null;

    const destination = channel === "email" ? user.email : user.verification?.phone;
    const item = createVerificationCodeRecord(channel, destination, options);
    db.verificationCodes = db.verificationCodes || {};
    db.verificationCodes[user.id] = (db.verificationCodes[user.id] || []).map((record) => (
        record.channel === channel && (record.purpose || "sign_up") === purpose && record.status === "pending" ? { ...record, status: "replaced" } : record
    ));
    db.verificationCodes[user.id].push({
        channel: item.channel,
        purpose,
        destination: item.destination,
        salt: item.salt,
        hash: item.hash,
        expiresAt: item.expiresAt,
        status: "pending",
        attempts: 0,
        createdAt: new Date().toISOString()
    });
    saveDemoDb(db);
    return { user, code: item.code, destination };
}

function verifyJsonCode(email, channel, code, purpose = "sign_up", options = {}) {
    const db = loadDemoDb();
    const user = jsonUserByEmail(db, email);
    if (!user) return { success: false, error: "Account not found." };
    if (channel === "phone" && user.verification?.emailStatus !== "verified") {
        return { success: false, error: "Verify your email before confirming your phone number." };
    }

    const records = db.verificationCodes?.[user.id] || [];
    const record = [...records].reverse().find((item) => item.channel === channel && (item.purpose || "sign_up") === purpose && item.status === "pending");
    if (!record) return { success: false, error: "No active verification code found." };
    if (Date.parse(record.expiresAt) <= Date.now()) {
        record.status = "expired";
        saveDemoDb(db);
        return { success: false, error: "Verification code expired. Request a new one." };
    }
    if (Number(record.attempts || 0) >= 5) {
        return { success: false, error: "Too many verification attempts. Request a new code." };
    }

    const suppliedHash = verificationCodeHash(code, record.salt);
    if (!sameHashValue(suppliedHash, record.hash)) {
        record.attempts = Number(record.attempts || 0) + 1;
        saveDemoDb(db);
        return { success: false, error: "Verification code is incorrect." };
    }

    record.status = "verified";
    record.verifiedAt = new Date().toISOString();
    if (options.markProfileVerified !== false) {
        user.verification = user.verification || {};
        if (channel === "email") user.verification.emailStatus = "verified";
        if (channel === "phone") user.verification.phoneStatus = "verified";
    }
    saveDemoDb(db);
    return { success: true, user };
}

async function signInFromDatabase(email, password, options = {}) {
    if (!databaseConfigured()) return null;

    const result = await dbPool.query(`
        select
            p.id as profile_id,
            p.email,
            p.display_name,
            p.created_at,
            pv.first_name,
            pv.last_name,
            pv.legal_name,
            pv.phone,
            pv.country,
            pv.date_of_birth,
            pv.account_type,
            pv.email_status,
            pv.phone_status,
            pv.identity_status,
            pv.terms_version,
            pv.terms_accepted_at,
            pv.information_confirmed_at,
            pc.password_algorithm,
            pc.password_salt,
            pc.password_hash
        from profiles p
        join profile_credentials pc on pc.profile_id = p.id
        left join profile_verifications pv on pv.profile_id = p.id
        where lower(p.email) = lower($1)
        limit 1
    `, [email]);

    let row = result.rows[0];
    if (!row) return null;

    const auth = {
        passwordSalt: row.password_salt,
        passwordHash: row.password_hash
    };
    if (!verifyPassword(password, auth)) return null;
    row = await syncDatabaseEmailStatusFromVerifiedCode(row);

    const session = options.createSession === false
        ? null
        : await createDatabaseSession(row.profile_id, options.sessionHours || SESSION_HOURS);
    const nameParts = profileNamePartsFromRow(row);
    return {
        user: {
            id: row.profile_id,
            name: row.display_name,
            email: row.email,
            mode: "live",
            currency: "USD",
            createdAt: row.created_at,
            profile: {
                firstName: nameParts.firstName,
                lastName: nameParts.lastName,
                legalName: nameParts.legalName,
                phone: publicProfilePhone(row),
                country: publicProfileCountry(row),
                dateOfBirth: publicProfileDateOfBirth(row),
                accountType: row.account_type || "personal",
                termsVersion: row.terms_version || "",
                termsAcceptedAt: row.terms_accepted_at || "",
                informationConfirmedAt: row.information_confirmed_at || ""
            },
            verification: {
                email: row.email_status || "pending",
                phone: row.phone_status || "pending",
                identity: row.identity_status || "pending"
            }
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

function controlledMarketSymbol(symbol = "AU") {
    return String(symbol || "AU").trim().toUpperCase() || "AU";
}

function controlledMarketDefaultPrice() {
    return Math.max(0.00000001, Number(process.env.AUTODY_AU_START_PRICE || 0.001));
}

function normalizeAdminMarketAssetType(value = "crypto") {
    const normalized = String(value || "crypto").trim().toLowerCase();
    const map = {
        crypto: "crypto",
        token: "crypto",
        coin: "crypto",
        stock: "stock",
        stocks: "stock",
        equity: "stock",
        equities: "stock",
        etf: "etf",
        etfs: "etf",
        fund: "etf",
        commodity: "commodity",
        commodities: "commodity",
        oil: "commodity",
        metal: "commodity",
        metals: "commodity"
    };
    return map[normalized] || "crypto";
}

function adminMarketNameForType(assetType = "crypto") {
    const normalized = normalizeAdminMarketAssetType(assetType);
    if (normalized === "stock") return "Stocks";
    if (normalized === "etf") return "ETFs";
    if (normalized === "commodity") return "Oil and metals";
    return "Crypto";
}

const ADMIN_CONTROLLED_LOGO_DIR = path.join(__dirname, "public", "assets", "logos", "generated");
const ADMIN_CONTROLLED_LOGO_PUBLIC_BASE = "assets/logos/generated";

function adminMarketDefaultVenueForType(assetType = "crypto", symbol = "") {
    const normalized = normalizeAdminMarketAssetType(assetType);
    const safeSymbol = controlledMarketSymbol(symbol || "");
    if (safeSymbol === "AU") return "Autody";
    if (normalized === "stock") return "Nasdaq";
    if (normalized === "etf") return "Nasdaq";
    if (normalized === "commodity") return "NYSE Arca";
    return "Crypto";
}

function normalizeAdminMarketVenue(assetType = "crypto", symbol = "", market = "") {
    const normalized = normalizeAdminMarketAssetType(assetType);
    const raw = normalizeText(market || "").slice(0, 40);
    const genericByType = {
        crypto: new Set(["crypto", "digital assets", "global"]),
        stock: new Set(["stock", "stocks", "equities"]),
        etf: new Set(["etf", "etfs", "fund", "funds"]),
        commodity: new Set(["commodity", "commodities", "oil and metals", "oils and metals", "metals"])
    };
    if (!raw || (genericByType[normalized] || new Set()).has(raw.toLowerCase())) {
        return adminMarketDefaultVenueForType(normalized, symbol);
    }
    return raw;
}

function escapeSvgText(value = "") {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

function hashAdminLogoSeed(value = "") {
    let hash = 0;
    for (const char of String(value)) {
        hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    }
    return hash;
}

function ensureAdminControlledLogo(control = {}) {
    const symbol = controlledMarketSymbol(control.symbol || "");
    if (!symbol || symbol === "AU") return "Autody-Logo.png";
    const existing = normalizeText(control.logoUrl || "");
    const generatedBase = `${ADMIN_CONTROLLED_LOGO_PUBLIC_BASE}/`;
    if (existing && !existing.includes("Autody-Logo.png") && !existing.startsWith(generatedBase)) return existing;

    const name = normalizeText(control.name || control.assetName || symbol) || symbol;
    const assetType = normalizeAdminMarketAssetType(control.assetType || "asset");
    const market = normalizeAdminMarketVenue(assetType, symbol, control.market);
    const seed = hashAdminLogoSeed(`${symbol}:${name}:${assetType}:${market}`);
    const palettes = [
        ["#5b5fef", "#26d4a0", "#10162a"],
        ["#2488ff", "#73f2ff", "#07182a"],
        ["#ff5d7d", "#ffc45c", "#271018"],
        ["#8957ff", "#f18cff", "#190f2b"],
        ["#111827", "#8ee8ff", "#050910"],
        ["#0f766e", "#c4ff68", "#071815"],
        ["#ff7a3d", "#ffd76a", "#211106"],
        ["#38bdf8", "#a78bfa", "#08111f"]
    ];
    const palette = palettes[seed % palettes.length];
    const glowOpacity = 0.45 + ((seed % 20) / 100);
    const angle = seed % 360;
    const initials = escapeSvgText(symbol.slice(0, 3));
    const safeName = escapeSvgText(name);
    const orbX = 28 + ((seed >> 3) % 72);
    const orbY = 24 + ((seed >> 8) % 70);
    const ringSize = 34 + ((seed >> 13) % 15);
    const slashOne = 14 + ((seed >> 17) % 28);
    const slashTwo = 82 + ((seed >> 21) % 24);
    const lowerArc = 78 + ((seed >> 25) % 12);
    const fileName = `${symbol.toLowerCase().replace(/[^a-z0-9_-]/gi, "-")}-mark.svg`;
    const filePath = path.join(ADMIN_CONTROLLED_LOGO_DIR, fileName);
    const publicPath = `${ADMIN_CONTROLLED_LOGO_PUBLIC_BASE}/${fileName}`;

    try {
        fs.mkdirSync(ADMIN_CONTROLLED_LOGO_DIR, { recursive: true });
        fs.writeFileSync(filePath, `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128" data-autody-generated-logo="2">
<defs>
  <linearGradient id="bg" x1="16" y1="12" x2="116" y2="118" gradientUnits="userSpaceOnUse"><stop stop-color="${palette[2]}"/><stop offset="1" stop-color="#05070d"/></linearGradient>
  <linearGradient id="accent" x1="18" y1="18" x2="110" y2="112" gradientUnits="userSpaceOnUse"><stop stop-color="${palette[0]}"/><stop offset="1" stop-color="${palette[1]}"/></linearGradient>
  <radialGradient id="orb" cx="35%" cy="25%" r="68%"><stop stop-color="#fff" stop-opacity=".55"/><stop offset=".55" stop-color="${palette[1]}" stop-opacity=".18"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
  <filter id="softGlow" x="-25%" y="-25%" width="150%" height="150%"><feGaussianBlur stdDeviation="5" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
</defs>
<rect width="128" height="128" rx="30" fill="url(#bg)"/>
<circle cx="${orbX}" cy="${orbY}" r="58" fill="url(#orb)" opacity="${glowOpacity.toFixed(2)}"/>
<path d="M${slashOne} 108 L${slashTwo} 14" stroke="url(#accent)" stroke-width="18" stroke-linecap="round" opacity=".24" transform="rotate(${angle} 64 64)"/>
<path d="M18 ${lowerArc} C38 52 88 52 110 ${lowerArc}" fill="none" stroke="url(#accent)" stroke-width="10" stroke-linecap="round" opacity=".55"/>
<circle cx="64" cy="64" r="${ringSize}" fill="none" stroke="url(#accent)" stroke-width="4" opacity=".78" filter="url(#softGlow)"/>
<circle cx="64" cy="64" r="${ringSize - 12}" fill="#0a0f1b" opacity=".42"/>
<text x="64" y="75" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="${initials.length > 2 ? 31 : 40}" font-weight="900" letter-spacing="-1" fill="#fff">${initials}</text>
<path d="M43 92 C53 99 75 99 85 92" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity=".38"/>
<title>${safeName}</title>
</svg>`, "utf8");
    } catch (err) {
        console.error("Could not write generated asset logo:", err.message || err);
    }

    return publicPath;
}

function clampNumber(value, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return Number(min);
    return Math.min(Number(max), Math.max(Number(min), number));
}

function roundMarketPrice(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return null;
    return Number(number.toFixed(10));
}

function roundAdminUsd(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Number(number.toFixed(2));
}

function roundAdminReserveQuantity(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Number(number.toFixed(8));
}

const ADMIN_MARKET_DEFAULT_VOLUME_ROLL_MINUTES = 24 * 60;

function randomAdminMarketVolume(min, max) {
    const low = Math.max(0, Number(min || 0));
    const high = Math.max(0, Number(max || 0));
    if (!Number.isFinite(low) || !Number.isFinite(high) || high <= 0 || high < low) return null;
    if (high === low) return roundAdminUsd(low);
    return roundAdminUsd(low + Math.random() * (high - low));
}

function deriveAdminMarketMetrics(values = {}) {
    const currentPrice = nullableNumber(values.currentPrice ?? values.current_price ?? values.price_usd) ?? 0;
    const circulatingSupply = nullableNumber(values.circulatingSupply ?? values.circulating_supply);
    const totalSupply = nullableNumber(values.totalSupply ?? values.total_supply);

    return {
        marketCap: circulatingSupply !== null ? roundAdminUsd(currentPrice * circulatingSupply) : 0,
        fdv: totalSupply !== null ? roundAdminUsd(currentPrice * totalSupply) : 0
    };
}

function deriveAdminMarketReservePrice(assetReserve, usdReserve) {
    const base = positiveNumber(assetReserve);
    const quote = positiveNumber(usdReserve);
    if (!base || !quote) return null;
    return roundMarketPrice(quote / base);
}

let adminMarketTablesReady = false;
let adminMarketTablesPromise = null;

async function ensureAdminMarketTables(client = dbPool) {
    if (!databaseConfigured()) return false;
    if (adminMarketTablesReady) return true;
    if (!adminMarketTablesPromise) {
        adminMarketTablesPromise = client.query(`
            create table if not exists admin_market_controls (
              symbol text primary key,
              asset_name text not null,
              asset_type text not null default 'crypto',
              market text,
              logo_url text,
              enabled boolean not null default true,
              min_price numeric(24, 10) not null default 0.0001000000,
              max_price numeric(24, 10) not null default 0.0100000000,
              current_price numeric(24, 10) not null default 0.0010000000,
              last_price numeric(24, 10),
              change_pct numeric(12, 6) not null default 0,
              update_interval_seconds integer not null default 30,
              step_percent numeric(12, 6) not null default 0.750000,
              trend_bias numeric(12, 6) not null default 0,
              liquidity_usd numeric(24, 2) not null default 0,
              reserve_asset_quantity numeric(32, 8) not null default 0,
              reserve_usd numeric(24, 2) not null default 0,
              market_cap_usd numeric(24, 2) not null default 0,
              fdv_usd numeric(24, 2) not null default 0,
              total_volume_usd numeric(24, 2) not null default 0,
              volume_min_usd numeric(24, 2) not null default 0,
              volume_max_usd numeric(24, 2) not null default 0,
              volume_roll_interval_minutes integer not null default 1440,
              volume_last_roll_at timestamptz,
              circulating_supply numeric(32, 8),
              total_supply numeric(32, 8),
              max_supply numeric(32, 8),
              status text not null default 'admin controlled',
              updated_by text,
              last_tick_at timestamptz,
              created_at timestamptz not null default now(),
              updated_at timestamptz not null default now()
            );

            create table if not exists admin_market_ticks (
              id bigserial primary key,
              symbol text not null,
              price_usd numeric(24, 10) not null,
              change_pct numeric(12, 6) not null default 0,
              volume_usd numeric(24, 2) not null default 0,
              source text not null default 'admin-control',
              created_at timestamptz not null default now()
            );

            create index if not exists admin_market_ticks_symbol_time_idx
              on admin_market_ticks (symbol, created_at desc);

            alter table if exists admin_market_controls
              add column if not exists asset_type text not null default 'crypto';
            alter table if exists admin_market_controls
              add column if not exists market text;
            alter table if exists admin_market_controls
              add column if not exists logo_url text;
            alter table if exists admin_market_controls
              add column if not exists volume_min_usd numeric(24, 2) not null default 0;
            alter table if exists admin_market_controls
              add column if not exists volume_max_usd numeric(24, 2) not null default 0;
            alter table if exists admin_market_controls
              add column if not exists volume_roll_interval_minutes integer not null default 1440;
            alter table if exists admin_market_controls
              add column if not exists volume_last_roll_at timestamptz;
            alter table if exists admin_market_controls
              add column if not exists max_supply numeric(32, 8);
            alter table if exists admin_market_controls
              add column if not exists reserve_asset_quantity numeric(32, 8) not null default 0;
            alter table if exists admin_market_controls
              add column if not exists reserve_usd numeric(24, 2) not null default 0;
        `).then(() => {
            adminMarketTablesReady = true;
            return true;
        }).catch((err) => {
            adminMarketTablesPromise = null;
            throw err;
        });
    }
    return adminMarketTablesPromise;
}

function normalizeAdminMarketControlRow(row = {}) {
    if (!row?.symbol) return null;
    const symbol = controlledMarketSymbol(row.symbol);
    const assetType = normalizeAdminMarketAssetType(row.asset_type);
    const market = normalizeAdminMarketVenue(assetType, symbol, row.market);
    const control = {
        symbol,
        name: row.asset_name || (symbol === "AU" ? "Autody AU" : symbol),
        assetType,
        market,
        logoUrl: normalizeText(row.logo_url || "") || null,
        enabled: row.enabled !== false,
        minPrice: nullableNumber(row.min_price) ?? 0.0001,
        maxPrice: nullableNumber(row.max_price) ?? 0.01,
        currentPrice: nullableNumber(row.current_price) ?? controlledMarketDefaultPrice(),
        lastPrice: nullableNumber(row.last_price),
        changePct: nullableNumber(row.change_pct) ?? 0,
        updateIntervalSeconds: Math.max(10, Number(row.update_interval_seconds || 30)),
        stepPercent: Math.max(0, Number(row.step_percent || 0.75)),
        trendBias: clampNumber(row.trend_bias ?? 0, -1, 1),
        liquidityUsd: nullableNumber(row.liquidity_usd) ?? 0,
        reserveAssetQuantity: nullableNumber(row.reserve_asset_quantity) ?? 0,
        reserveUsd: nullableNumber(row.reserve_usd) ?? 0,
        marketCap: nullableNumber(row.market_cap_usd) ?? 0,
        fdv: nullableNumber(row.fdv_usd) ?? 0,
        totalVolume: nullableNumber(row.total_volume_usd) ?? 0,
        volumeMinUsd: nullableNumber(row.volume_min_usd) ?? 0,
        volumeMaxUsd: nullableNumber(row.volume_max_usd) ?? 0,
        volumeRollIntervalMinutes: Math.max(1, Number(row.volume_roll_interval_minutes || ADMIN_MARKET_DEFAULT_VOLUME_ROLL_MINUTES)),
        volumeLastRollAt: row.volume_last_roll_at || null,
        circulatingSupply: nullableNumber(row.circulating_supply),
        totalSupply: nullableNumber(row.total_supply),
        maxSupply: nullableNumber(row.max_supply),
        status: row.status || "admin controlled",
        updatedBy: row.updated_by || "",
        lastTickAt: row.last_tick_at || null,
        createdAt: row.created_at || null,
        updatedAt: row.updated_at || null
    };
    const reservePrice = deriveAdminMarketReservePrice(control.reserveAssetQuantity, control.reserveUsd);
    return {
        ...control,
        reservePrice,
        ...deriveAdminMarketMetrics(control)
    };
}

async function ensureAdminMarketControl(symbol = "AU") {
    if (!databaseConfigured()) return null;
    await ensureAdminMarketTables();
    const safeSymbol = controlledMarketSymbol(symbol);
    const startPrice = controlledMarketDefaultPrice();

    await dbPool.query(`
        insert into admin_market_controls (
            symbol,
            asset_name,
            asset_type,
            market,
            logo_url,
            enabled,
            min_price,
            max_price,
            current_price,
            last_price,
            change_pct,
            update_interval_seconds,
            step_percent,
            trend_bias,
            status,
            last_tick_at
        )
        values ($1, $2, 'crypto', $3, $4, true, $5, $6, $7, $7, 0, 30, 0.75, 0, 'admin controlled', now())
        on conflict (symbol) do nothing
    `, [
        safeSymbol,
        safeSymbol === "AU" ? "Autody AU" : safeSymbol,
        adminMarketDefaultVenueForType("crypto", safeSymbol),
        safeSymbol === "AU" ? "Autody-Logo.png" : ensureAdminControlledLogo({ symbol: safeSymbol, assetType: "crypto" }),
        0.0001,
        0.01,
        startPrice
    ]);

    const tickResult = await dbPool.query(`select id from admin_market_ticks where symbol = $1 limit 1`, [safeSymbol]);
    if (!tickResult.rows.length) {
        await dbPool.query(`
            insert into admin_market_ticks (symbol, price_usd, change_pct, volume_usd, source)
            values ($1, $2, 0, 0, 'admin-seed')
        `, [safeSymbol, startPrice]);
    }

    const result = await dbPool.query(`select * from admin_market_controls where symbol = $1 limit 1`, [safeSymbol]);
    return normalizeAdminMarketControlRow(result.rows[0]);
}

async function readAdminMarketControl(symbol = "AU") {
    if (!databaseConfigured()) return null;
    await ensureAdminMarketTables();
    const safeSymbol = controlledMarketSymbol(symbol);
    const result = await dbPool.query(`select * from admin_market_controls where symbol = $1 limit 1`, [safeSymbol]);
    return normalizeAdminMarketControlRow(result.rows[0]);
}

async function listAdminMarketControls() {
    if (!databaseConfigured()) {
        const err = new Error("Database is not configured for admin market controls.");
        err.status = 503;
        throw err;
    }
    await ensureAdminMarketTables();
    await ensureAdminMarketControl("AU");
    const result = await dbPool.query(`
        select *
        from admin_market_controls
        order by case when symbol = 'AU' then 0 else 1 end, asset_type asc, symbol asc
    `);
    return result.rows.map(normalizeAdminMarketControlRow).filter(Boolean);
}

async function createAdminMarketControl(body = {}) {
    if (!databaseConfigured()) {
        const err = new Error("Database is not configured for admin market controls.");
        err.status = 503;
        throw err;
    }
    await ensureAdminMarketTables();
    const rawSymbol = String(body.symbol || "").trim().toUpperCase();
    const symbol = controlledMarketSymbol(rawSymbol);
    if (!rawSymbol || !/^[A-Z0-9.:-]{1,20}$/.test(symbol)) {
        const err = new Error("Enter a valid asset symbol.");
        err.status = 400;
        throw err;
    }
    const existing = await readAdminMarketControl(symbol);
    if (existing) {
        const err = new Error(`${symbol} already has a control.`);
        err.status = 409;
        throw err;
    }

    const assetType = normalizeAdminMarketAssetType(body.assetType || "crypto");
    const name = normalizeText(body.name || body.assetName || symbol).slice(0, 90) || symbol;
    const market = normalizeAdminMarketVenue(assetType, symbol, body.market || body.exchange);
    const logoUrl = ensureAdminControlledLogo({ symbol, name, assetType, market });
    const currentPrice = roundMarketPrice(adminPositiveValue(body.currentPrice, controlledMarketDefaultPrice(), 0.00000001));
    const minPrice = roundMarketPrice(adminPositiveValue(body.minPrice, Math.max(0.00000001, currentPrice * 0.5), 0.00000001));
    const maxPriceFallback = Math.max(currentPrice * 2, minPrice + 0.00000001);
    const maxPrice = roundMarketPrice(adminPositiveValue(body.maxPrice, maxPriceFallback, 0.00000001));
    if (maxPrice <= minPrice) {
        const err = new Error("Max price must be higher than min price.");
        err.status = 400;
        throw err;
    }

    const circulatingSupply = nullableNumber(body.circulatingSupply);
    const totalSupply = nullableNumber(body.totalSupply);
    const maxSupply = nullableNumber(body.maxSupply);
    const reserveUsd = adminPositiveValue(body.reserveUsd ?? body.liquidityUsd, 0, 0);
    const reserveAssetQuantity = adminPositiveValue(
        body.reserveAssetQuantity,
        reserveUsd && currentPrice ? reserveUsd / currentPrice : 0,
        0
    );
    const liquidityUsd = reserveUsd || adminPositiveValue(body.liquidityUsd, 0, 0);
    const totalVolume = adminPositiveValue(body.totalVolume, 0, 0);
    const derived = deriveAdminMarketMetrics({ currentPrice, circulatingSupply, totalSupply });

    await dbPool.query(`
        insert into admin_market_controls (
            symbol,
            asset_name,
            asset_type,
            market,
            logo_url,
            enabled,
            min_price,
            max_price,
            current_price,
            last_price,
            change_pct,
            update_interval_seconds,
            step_percent,
            trend_bias,
            liquidity_usd,
            reserve_asset_quantity,
            reserve_usd,
            market_cap_usd,
            fdv_usd,
            total_volume_usd,
            circulating_supply,
            total_supply,
            max_supply,
            status,
            updated_by,
            last_tick_at
        )
        values ($1, $2, $3, $4, $5, true, $6, $7, $8, $8, 0, 30, 0.75, 0, $9, $10, $11, $12, $13, $14, $15, $16, $17, 'admin controlled', 'admin', now())
    `, [
        symbol,
        name,
        assetType,
        market,
        logoUrl,
        minPrice,
        maxPrice,
        currentPrice,
        liquidityUsd,
        reserveAssetQuantity,
        reserveUsd,
        derived.marketCap,
        derived.fdv,
        totalVolume,
        circulatingSupply,
        totalSupply,
        maxSupply
    ]);

    await dbPool.query(`
        insert into admin_market_ticks (symbol, price_usd, change_pct, volume_usd, source)
        values ($1, $2, 0, 0, 'admin-seed')
    `, [symbol, currentPrice]);

    const control = await readAdminMarketControl(symbol);
    await saveAdminMarketSnapshot(control);
    await saveAdminControlledCharts(symbol);
    return getAdminMarketOverview({ symbol, range: body.range || "1d" });
}

async function adminMarketStats(symbol = "AU") {
    if (!databaseConfigured()) return {};
    await ensureAdminMarketTables();
    const safeSymbol = controlledMarketSymbol(symbol);
    const result = await dbPool.query(`
        select
            max(price_usd) filter (where created_at >= now() - interval '1 day') as high_24h,
            min(price_usd) filter (where created_at >= now() - interval '1 day') as low_24h,
            max(price_usd) as all_time_high,
            min(price_usd) as all_time_low,
            count(*) as tick_count,
            max(created_at) as last_tick_at
        from admin_market_ticks
        where symbol = $1
    `, [safeSymbol]);
    const row = result.rows[0] || {};
    return {
        high24h: nullableNumber(row.high_24h),
        low24h: nullableNumber(row.low_24h),
        allTimeHigh: nullableNumber(row.all_time_high),
        allTimeLow: nullableNumber(row.all_time_low),
        tickCount: Number(row.tick_count || 0),
        lastTickAt: row.last_tick_at || null
    };
}

function adminMarketAssetFromControl(control, stats = {}) {
    const symbol = controlledMarketSymbol(control?.symbol || "AU");
    const assetType = normalizeAdminMarketAssetType(control?.assetType || "crypto");
    const exposesTokenMetrics = assetType === "crypto" || symbol === "AU";
    const market = normalizeAdminMarketVenue(assetType, symbol, control?.market);
    const logoUrl = symbol === "AU"
        ? "Autody-Logo.png"
        : ensureAdminControlledLogo({ ...control, symbol, assetType, market });
    const asset = symbol === "AU" ? {
        ...AUTODY_MARKET_ASSET,
        market,
        logoUrl,
        customAsset: true
    } : {
        rank: 999,
        id: symbol,
        symbol,
        name: control?.name || symbol,
        assetType,
        market,
        tags: ["Admin controlled"],
        depositNetworks: [],
        tradeable: true,
        customAsset: true,
        logoUrl,
        status: "admin controlled"
    };

    return {
        ...assetCatalogEntry(asset),
        price: control.currentPrice,
        changePct: control.changePct,
        marketCap: exposesTokenMetrics ? control.marketCap || null : null,
        fdv: exposesTokenMetrics ? control.fdv || null : null,
        liquidityUsd: exposesTokenMetrics ? control.reserveUsd || control.liquidityUsd || null : null,
        totalVolume: exposesTokenMetrics ? control.totalVolume || null : null,
        high24h: stats.high24h ?? null,
        low24h: stats.low24h ?? null,
        ath: stats.allTimeHigh ?? null,
        atl: stats.allTimeLow ?? null,
        circulatingSupply: exposesTokenMetrics ? control.circulatingSupply : null,
        totalSupply: exposesTokenMetrics ? control.totalSupply : null,
        maxSupply: exposesTokenMetrics ? control.maxSupply : null,
        currency: "USD",
        providerSymbol: control.symbol,
        dataProvider: "autody-admin",
        capturedAt: control.lastTickAt || control.updatedAt || new Date().toISOString(),
        status: control.enabled ? "Admin controlled" : "Paused"
    };
}

async function saveAdminMarketSnapshot(control) {
    if (!control) return null;
    const stats = await adminMarketStats(control.symbol).catch(() => ({}));
    const asset = adminMarketAssetFromControl(control, stats);
    await saveMarketSnapshots("autody-admin", asset.assetType || control.assetType || "crypto", [asset]).catch((err) => {
        console.error("Admin market snapshot save failed:", err.message || err);
    });
    cacheLiveMarketAssets([asset], "autody-admin");
    marketCatalogCache.delete("all");
    marketCatalogCache.delete(asset.assetType || control.assetType || "crypto");
    marketCatalogCache.delete(["stock", "etf", "commodity"].includes(asset.assetType) ? "stocks" : "crypto");
    return asset;
}

async function trimAdminMarketTicks(symbol = "AU") {
    if (!databaseConfigured()) return;
    await ensureAdminMarketTables();
    const safeSymbol = controlledMarketSymbol(symbol);
    await dbPool.query(`
        delete from admin_market_ticks
        where symbol = $1
          and created_at < now() - make_interval(days => $2)
    `, [safeSymbol, AU_MARKET_TICK_RETENTION_DAYS]).catch(() => null);

    await dbPool.query(`
        delete from admin_market_ticks
        where symbol = $1
          and id not in (
            select id
            from admin_market_ticks
            where symbol = $1
            order by created_at desc
            limit $2
          )
    `, [safeSymbol, AU_MARKET_TICK_MAX_ROWS]).catch(() => null);
}

async function advanceAdminControlledMarket(symbol = "AU", options = {}) {
    if (!databaseConfigured()) return null;
    const safeSymbol = controlledMarketSymbol(symbol);
    let control = await ensureAdminMarketControl(safeSymbol);
    if (!control) return null;
    control = await rollAdminMarketVolumeIfDue(control, { forceVolumeRoll: Boolean(options.forceVolumeRoll) });

    const now = Date.now();
    const lastTickMs = Date.parse(control.lastTickAt || control.updatedAt || 0);
    const due = options.force || !lastTickMs || (now - lastTickMs >= control.updateIntervalSeconds * 1000);
    if (!control.enabled || !due) {
        await saveAdminMarketSnapshot(control);
        return control;
    }

    const previousPrice = Math.max(0.00000001, Number(control.currentPrice || controlledMarketDefaultPrice()));
    const step = Math.max(0.0001, Math.min(50, control.stepPercent || 0.75)) / 100;
    const bias = clampNumber(control.trendBias || 0, -1, 1) * step * 0.35;
    let movement = (Math.random() * 2 - 1) * step + bias;
    if (previousPrice <= control.minPrice && movement < 0) movement = Math.abs(movement);
    if (previousPrice >= control.maxPrice && movement > 0) movement = -Math.abs(movement);

    const rawNext = previousPrice * (1 + movement);
    const nextPrice = roundMarketPrice(clampNumber(rawNext, control.minPrice, control.maxPrice)) || previousPrice;
    const changePct = previousPrice ? Number((((nextPrice - previousPrice) / previousPrice) * 100).toFixed(6)) : 0;
    const tickVolume = positiveNumber(options.volumeUsd) ?? 0;
    const nextTotalVolume = tickVolume
        ? roundAdminUsd((control.totalVolume || 0) + tickVolume)
        : roundAdminUsd(control.totalVolume || 0);
    const derived = deriveAdminMarketMetrics({
        ...control,
        currentPrice: nextPrice
    });

    const result = await dbPool.query(`
        update admin_market_controls
        set current_price = $2,
            last_price = $3,
            change_pct = $4,
            market_cap_usd = $5,
            fdv_usd = $6,
            total_volume_usd = $7,
            last_tick_at = now(),
            updated_at = now()
        where symbol = $1
        returning *
    `, [safeSymbol, nextPrice, previousPrice, changePct, derived.marketCap, derived.fdv, nextTotalVolume]);

    await dbPool.query(`
        insert into admin_market_ticks (symbol, price_usd, change_pct, volume_usd, source)
        values ($1, $2, $3, $4, $5)
    `, [safeSymbol, nextPrice, changePct, tickVolume, options.source || "admin-control"]);

    await trimAdminMarketTicks(safeSymbol);
    const updated = normalizeAdminMarketControlRow(result.rows[0]);
    await saveAdminMarketSnapshot(updated);
    await saveAdminControlledCharts(safeSymbol).catch((err) => {
        console.error("Admin chart snapshot save failed:", err.message || err);
    });
    return updated;
}

async function rollAdminMarketVolumeIfDue(control, options = {}) {
    if (!control?.symbol || !databaseConfigured()) return control;
    if (control.enabled === false && !options.forceVolumeRoll) return control;
    const nextVolume = randomAdminMarketVolume(control.volumeMinUsd, control.volumeMaxUsd);
    if (nextVolume === null) return control;
    const lastRollMs = Date.parse(control.volumeLastRollAt || 0);
    const intervalMinutes = Math.max(1, Number(control.volumeRollIntervalMinutes || ADMIN_MARKET_DEFAULT_VOLUME_ROLL_MINUTES));
    const due = options.forceVolumeRoll || !lastRollMs || (Date.now() - lastRollMs >= intervalMinutes * 60 * 1000);
    if (!due) return control;

    const result = await dbPool.query(`
        update admin_market_controls
        set total_volume_usd = $2,
            volume_last_roll_at = now(),
            updated_at = now()
        where symbol = $1
        returning *
    `, [control.symbol, nextVolume]);
    return normalizeAdminMarketControlRow(result.rows[0]) || control;
}

async function applyAdminControlledTradeImpact(symbol, side, notionalUsd, source = "order-trade") {
    if (!databaseConfigured()) return null;
    const safeSymbol = controlledMarketSymbol(symbol);
    const existing = await readAdminMarketControl(safeSymbol);
    if (!existing) return null;
    const amountUsd = positiveNumber(notionalUsd);
    if (!amountUsd) return null;

    await ensureAdminMarketTables();
    const control = await ensureAdminMarketControl(safeSymbol);
    if (!control?.enabled) return control;

    const currentPrice = Math.max(0.00000001, Number(control.currentPrice || controlledMarketDefaultPrice()));
    const direction = String(side || "").toLowerCase() === "sell" ? -1 : 1;
    const reserveAsset = positiveNumber(control.reserveAssetQuantity);
    const reserveUsd = positiveNumber(control.reserveUsd);
    let nextReserveAsset = control.reserveAssetQuantity || 0;
    let nextReserveUsd = control.reserveUsd || 0;
    let nextLiquidity = control.liquidityUsd || 0;
    let nextPrice;
    let impactSource = source;

    if (reserveAsset && reserveUsd) {
        const constantProduct = reserveAsset * reserveUsd;
        if (direction > 0) {
            nextReserveUsd = reserveUsd + amountUsd;
            nextReserveAsset = constantProduct / Math.max(0.00000001, nextReserveUsd);
        } else {
            const assetIn = amountUsd / currentPrice;
            nextReserveAsset = reserveAsset + assetIn;
            nextReserveUsd = constantProduct / Math.max(0.00000001, nextReserveAsset);
        }
        const reservePrice = nextReserveUsd / Math.max(0.00000001, nextReserveAsset);
        nextPrice = roundMarketPrice(clampNumber(reservePrice, control.minPrice, control.maxPrice)) || currentPrice;
        nextReserveAsset = roundAdminReserveQuantity(nextReserveAsset);
        nextReserveUsd = roundAdminUsd(nextPrice * nextReserveAsset);
        nextLiquidity = nextReserveUsd;
        impactSource = `${source}:reserve-pool`;
    } else {
        const fallbackLiquidity = positiveNumber(process.env.AUTODY_AU_DEFAULT_LIQUIDITY_USD) || 10000;
        const impactBase = Math.max(control.liquidityUsd || 0, amountUsd, fallbackLiquidity);
        const maxImpact = clampNumber(process.env.AUTODY_AU_TRADE_MAX_IMPACT_PCT || 3, 0.01, 25) / 100;
        const impactMultiplier = clampNumber(process.env.AUTODY_AU_TRADE_IMPACT_MULTIPLIER || 0.35, 0.01, 5);
        const impact = Math.min(maxImpact, (amountUsd / impactBase) * impactMultiplier);
        nextPrice = roundMarketPrice(clampNumber(currentPrice * (1 + direction * impact), control.minPrice, control.maxPrice)) || currentPrice;
        const liquidityShift = roundAdminUsd(amountUsd * 0.05);
        nextLiquidity = roundAdminUsd(Math.max(0, (control.liquidityUsd || 0) + (direction > 0 ? -liquidityShift : liquidityShift)));
    }
    const changePct = currentPrice ? Number((((nextPrice - currentPrice) / currentPrice) * 100).toFixed(6)) : 0;
    const nextTotalVolume = roundAdminUsd((control.totalVolume || 0) + amountUsd);
    const derived = deriveAdminMarketMetrics({
        ...control,
        currentPrice: nextPrice
    });

    const result = await dbPool.query(`
        update admin_market_controls
        set current_price = $2,
            last_price = $3,
            change_pct = $4,
            liquidity_usd = $5,
            reserve_asset_quantity = $6,
            reserve_usd = $7,
            market_cap_usd = $8,
            fdv_usd = $9,
            total_volume_usd = $10,
            last_tick_at = now(),
            updated_at = now()
        where symbol = $1
        returning *
    `, [
        safeSymbol,
        nextPrice,
        currentPrice,
        changePct,
        nextLiquidity,
        nextReserveAsset,
        nextReserveUsd,
        derived.marketCap,
        derived.fdv,
        nextTotalVolume
    ]);

    await dbPool.query(`
        insert into admin_market_ticks (symbol, price_usd, change_pct, volume_usd, source)
        values ($1, $2, $3, $4, $5)
    `, [safeSymbol, nextPrice, changePct, amountUsd, impactSource]);

    await trimAdminMarketTicks(safeSymbol);
    const updated = normalizeAdminMarketControlRow(result.rows[0]);
    await saveAdminMarketSnapshot(updated);
    await saveAdminControlledCharts(safeSymbol).catch((err) => {
        console.error("Admin trade chart snapshot save failed:", err.message || err);
    });
    return updated;
}

function chartStartDateForRange(range = "1d") {
    const selected = normalizeChartRange(range);
    const days = {
        "1d": 1,
        "1w": 7,
        "1m": 31,
        "3m": 93,
        "1y": 366
    }[selected];
    return days ? new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString() : null;
}

function downsampleAdminTicks(rows = [], maxPoints = 240) {
    if (rows.length <= maxPoints) return rows;
    const step = rows.length / maxPoints;
    const sampled = [];
    for (let index = 0; index < maxPoints; index += 1) {
        sampled.push(rows[Math.floor(index * step)]);
    }
    const last = rows[rows.length - 1];
    if (sampled[sampled.length - 1]?.id !== last.id) sampled[sampled.length - 1] = last;
    return sampled;
}

async function buildAdminControlledChart(symbol = "AU", range = "1d") {
    if (!databaseConfigured()) return null;
    await ensureAdminMarketTables();
    const safeSymbol = controlledMarketSymbol(symbol);
    const selectedRange = normalizeChartRange(range);
    const startDate = chartStartDateForRange(selectedRange);
    const result = await dbPool.query(`
        select id, price_usd, change_pct, volume_usd, created_at
        from admin_market_ticks
        where symbol = $1
          and ($2::timestamptz is null or created_at >= $2::timestamptz)
        order by created_at asc
        limit 5000
    `, [safeSymbol, startDate]);

    let rows = downsampleAdminTicks(result.rows || []);
    if (!rows.length) {
        const control = await ensureAdminMarketControl(safeSymbol);
        rows = [{
            id: 0,
            price_usd: control?.currentPrice || controlledMarketDefaultPrice(),
            change_pct: 0,
            volume_usd: 0,
            created_at: new Date().toISOString()
        }];
    }

    if (rows.length === 1) {
        const created = new Date(rows[0].created_at);
        const earlier = new Date(created.getTime() - 60 * 1000).toISOString();
        rows = [{ ...rows[0], id: -1, created_at: earlier }, rows[0]];
    }

    const points = rows.map((row) => ({
        time: row.created_at,
        close: nullableNumber(row.price_usd) ?? controlledMarketDefaultPrice(),
        changePct: nullableNumber(row.change_pct) ?? 0,
        volume: nullableNumber(row.volume_usd) ?? 0
    }));
    const values = points.map((point) => point.close).filter(Number.isFinite);
    const allStats = await adminMarketStats(safeSymbol).catch(() => ({}));
    const rangeHigh = values.length ? Math.max(...values) : null;
    const rangeLow = values.length ? Math.min(...values) : null;

    return {
        range: selectedRange,
        provider: "autody-admin",
        providerSymbol: safeSymbol,
        currency: "USD",
        points,
        stats: {
            rangeHigh,
            rangeLow,
            allTimeHigh: allStats.allTimeHigh ?? rangeHigh,
            allTimeLow: allStats.allTimeLow ?? rangeLow
        }
    };
}

async function saveAdminControlledCharts(symbol = "AU") {
    const safeSymbol = controlledMarketSymbol(symbol);
    const control = await readAdminMarketControl(safeSymbol);
    if (!control) return [];
    const asset = adminMarketAssetFromControl(control, await adminMarketStats(safeSymbol).catch(() => ({})));
    const saved = [];
    for (const range of CHART_RANGE_KEYS) {
        const chart = await buildAdminControlledChart(safeSymbol, range);
        if (chart?.points?.length) {
            await saveMarketChartSnapshot("autody-admin", asset, chart);
            saved.push(range);
        }
    }
    return saved;
}

async function controlledMarketAssetForLookup(symbol = "AU", options = {}) {
    const safeSymbol = controlledMarketSymbol(symbol);
    if (!databaseConfigured()) return safeSymbol === "AU" ? assetCatalogEntry(AUTODY_MARKET_ASSET) : null;
    const existing = await readAdminMarketControl(safeSymbol);
    if (!existing && safeSymbol !== "AU") return null;
    const control = await advanceAdminControlledMarket(safeSymbol, options).catch((err) => {
        console.error("Admin controlled market advance failed:", err.message || err);
        return null;
    });
    if (!control) return null;
    const stats = await adminMarketStats(safeSymbol).catch(() => ({}));
    return adminMarketAssetFromControl(control, stats);
}

async function refreshAdminControlledMarketsForCatalog() {
    if (!databaseConfigured()) {
        await controlledMarketAssetForLookup("AU").catch(() => null);
        return;
    }
    const controls = await listAdminMarketControls().catch((err) => {
        console.error("Admin controlled market list refresh failed:", err.message || err);
        return [];
    });
    const now = Date.now();
    const dueControls = controls.filter((control) => {
        if (control.enabled === false) return false;
        const lastTickMs = Date.parse(control.lastTickAt || control.updatedAt || 0);
        return !lastTickMs || (now - lastTickMs >= (control.updateIntervalSeconds || 30) * 1000);
    });
    await Promise.allSettled(dueControls.slice(0, 50).map((control) => (
        advanceAdminControlledMarket(control.symbol).catch((err) => {
            console.error("Admin controlled market refresh failed:", err.message || err);
            return null;
        })
    )));
}

function adminBooleanValue(value, fallback = false) {
    if (value === undefined || value === null || value === "") return fallback;
    if (typeof value === "boolean") return value;
    return ["true", "1", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function adminPositiveValue(value, fallback, min = 0) {
    const number = nullableNumber(value);
    if (number === null) return fallback;
    return Math.max(min, number);
}

async function latestAdminMarketTicks(symbol = "AU", limit = 40) {
    if (!databaseConfigured()) return [];
    await ensureAdminMarketTables();
    const safeSymbol = controlledMarketSymbol(symbol);
    const safeLimit = Math.max(1, Math.min(200, Number(limit || 40)));
    const result = await dbPool.query(`
        select id, symbol, price_usd, change_pct, volume_usd, source, created_at
        from admin_market_ticks
        where symbol = $1
        order by created_at desc
        limit $2
    `, [safeSymbol, safeLimit]);
    return result.rows.map((row) => ({
        id: row.id,
        symbol: row.symbol,
        price: nullableNumber(row.price_usd),
        changePct: nullableNumber(row.change_pct),
        volumeUsd: nullableNumber(row.volume_usd),
        source: row.source,
        createdAt: row.created_at
    }));
}

async function getAdminMarketOverview(body = {}) {
    if (!databaseConfigured()) {
        const err = new Error("Database is not configured for admin market controls.");
        err.status = 503;
        throw err;
    }
    const range = normalizeChartRange(body.range || "1d");
    const symbol = controlledMarketSymbol(body.symbol || "AU");
    const control = await advanceAdminControlledMarket(symbol, { force: Boolean(body.forceTick) });
    const stats = await adminMarketStats(symbol);
    const asset = adminMarketAssetFromControl(control, stats);
    const chart = await buildAdminControlledChart(symbol, range);
    const ticks = await latestAdminMarketTicks(symbol, body.limit || 40);

    return {
        success: true,
        configured: true,
        symbol,
        asset,
        control,
        stats,
        chart,
        ticks,
        retention: {
            days: AU_MARKET_TICK_RETENTION_DAYS,
            maxRows: AU_MARKET_TICK_MAX_ROWS
        },
        generatedAt: new Date().toISOString()
    };
}

async function resetAdminMarketControl(body = {}) {
    if (!databaseConfigured()) {
        const err = new Error("Database is not configured for admin market controls.");
        err.status = 503;
        throw err;
    }
    await ensureAdminMarketTables();
    const symbol = controlledMarketSymbol(body.symbol || "AU");
    const current = await ensureAdminMarketControl(symbol);
    if (!current) {
        const err = new Error("Market control not found.");
        err.status = 404;
        throw err;
    }

    const minPrice = adminPositiveValue(body.minPrice, current.minPrice, 0.00000001);
    const maxPrice = adminPositiveValue(body.maxPrice, current.maxPrice, 0.00000001);
    if (maxPrice <= minPrice) {
        const err = new Error("Max price must be higher than min price.");
        err.status = 400;
        throw err;
    }
    const desiredPrice = adminPositiveValue(body.currentPrice, current.currentPrice || controlledMarketDefaultPrice(), 0.00000001);
    const currentPrice = roundMarketPrice(clampNumber(desiredPrice, minPrice, maxPrice));
    const derived = deriveAdminMarketMetrics({ ...current, currentPrice });

    await dbPool.query(`delete from admin_market_ticks where symbol = $1`, [symbol]);
    await dbPool.query(`delete from market_latest_snapshots where upper(symbol) = upper($1) and provider = 'autody-admin'`, [symbol]).catch(() => null);
    await dbPool.query(`delete from market_latest_chart_snapshots where upper(symbol) = upper($1) and provider = 'autody-admin'`, [symbol]).catch(() => null);

    const result = await dbPool.query(`
        update admin_market_controls
        set current_price = $2,
            last_price = $2,
            change_pct = 0,
            min_price = $3,
            max_price = $4,
            market_cap_usd = $5,
            fdv_usd = $6,
            total_volume_usd = 0,
            volume_last_roll_at = null,
            last_tick_at = now(),
            updated_by = $7,
            updated_at = now()
        where symbol = $1
        returning *
    `, [symbol, currentPrice, minPrice, maxPrice, derived.marketCap, derived.fdv, normalizeText(body.updatedBy || "admin")]);

    await dbPool.query(`
        insert into admin_market_ticks (symbol, price_usd, change_pct, volume_usd, source)
        values ($1, $2, 0, 0, 'admin-reset')
    `, [symbol, currentPrice]);

    const updated = normalizeAdminMarketControlRow(result.rows[0]);
    await saveAdminMarketSnapshot(updated);
    await saveAdminControlledCharts(symbol);
    return getAdminMarketOverview({ symbol, range: body.range || "1d" });
}

async function updateAdminMarketControl(body = {}) {
    if (!databaseConfigured()) {
        const err = new Error("Database is not configured for admin market controls.");
        err.status = 503;
        throw err;
    }
    const symbol = controlledMarketSymbol(body.symbol || "AU");
    const current = await ensureAdminMarketControl(symbol);
    const minPrice = adminPositiveValue(body.minPrice, current.minPrice, 0.00000001);
    const maxPrice = adminPositiveValue(body.maxPrice, current.maxPrice, 0.00000001);
    if (maxPrice <= minPrice) {
        const err = new Error("Max price must be higher than min price.");
        err.status = 400;
        throw err;
    }

    const desiredPrice = adminPositiveValue(body.currentPrice, current.currentPrice, 0.00000001);
    const currentPrice = roundMarketPrice(clampNumber(desiredPrice, minPrice, maxPrice));
    const previousPrice = current.currentPrice || currentPrice;
    const priceChanged = Math.abs(Number(currentPrice) - Number(previousPrice)) > 0.0000000001;
    const changePct = priceChanged && previousPrice
        ? Number((((currentPrice - previousPrice) / previousPrice) * 100).toFixed(6))
        : current.changePct || 0;
    const circulatingSupply = nullableNumber(body.circulatingSupply) ?? current.circulatingSupply;
    const totalSupply = nullableNumber(body.totalSupply) ?? current.totalSupply;
    const maxSupply = nullableNumber(body.maxSupply) ?? current.maxSupply;
    const totalVolume = adminPositiveValue(body.totalVolume, current.totalVolume, 0);
    const volumeMinUsd = adminPositiveValue(body.volumeMinUsd, current.volumeMinUsd, 0);
    const volumeMaxUsd = adminPositiveValue(body.volumeMaxUsd, current.volumeMaxUsd, 0);
    const volumeRollIntervalMinutes = Math.max(1, Math.min(10080, Math.round(Number(
        body.volumeRollIntervalMinutes || current.volumeRollIntervalMinutes || ADMIN_MARKET_DEFAULT_VOLUME_ROLL_MINUTES
    ))));
    const reserveAssetQuantity = adminPositiveValue(body.reserveAssetQuantity, current.reserveAssetQuantity, 0);
    const reserveUsd = adminPositiveValue(body.reserveUsd, current.reserveUsd || current.liquidityUsd, 0);
    const liquidityUsd = reserveUsd || adminPositiveValue(body.liquidityUsd, current.liquidityUsd, 0);
    if (volumeMaxUsd > 0 && volumeMaxUsd < volumeMinUsd) {
        const err = new Error("24h volume max must be higher than 24h volume min.");
        err.status = 400;
        throw err;
    }
    const manualVolumeChanged = Object.prototype.hasOwnProperty.call(body, "totalVolume");
    const derived = deriveAdminMarketMetrics({
        currentPrice,
        circulatingSupply,
        totalSupply
    });
    const market = normalizeAdminMarketVenue(current.assetType, symbol, body.market || current.market);
    const logoUrl = symbol === "AU"
        ? "Autody-Logo.png"
        : ensureAdminControlledLogo({ ...current, symbol, market });

    const result = await dbPool.query(`
        update admin_market_controls
        set enabled = $2,
            min_price = $3,
            max_price = $4,
            current_price = $5,
            last_price = $6,
            change_pct = $7,
            update_interval_seconds = $8,
            step_percent = $9,
            trend_bias = $10,
            liquidity_usd = $11,
            reserve_asset_quantity = $12,
            reserve_usd = $13,
            market_cap_usd = $14,
            fdv_usd = $15,
            total_volume_usd = $16,
            volume_min_usd = $17,
            volume_max_usd = $18,
            volume_roll_interval_minutes = $19,
            circulating_supply = $20,
            total_supply = $21,
            max_supply = $22,
            status = $23,
            updated_by = $24,
            last_tick_at = case when $25 then now() else last_tick_at end,
            volume_last_roll_at = case when $26 then now() else volume_last_roll_at end,
            market = $27,
            logo_url = coalesce(nullif($28, ''), logo_url),
            updated_at = now()
        where symbol = $1
        returning *
    `, [
        symbol,
        adminBooleanValue(body.enabled, current.enabled),
        minPrice,
        maxPrice,
        currentPrice,
        previousPrice,
        changePct,
        Math.max(10, Math.min(3600, Math.round(Number(body.updateIntervalSeconds || current.updateIntervalSeconds || 30)))),
        Math.max(0.01, Math.min(50, Number(body.stepPercent || current.stepPercent || 0.75))),
        clampNumber(body.trendBias ?? current.trendBias ?? 0, -1, 1),
        liquidityUsd,
        reserveAssetQuantity,
        reserveUsd,
        derived.marketCap,
        derived.fdv,
        totalVolume,
        volumeMinUsd,
        volumeMaxUsd,
        volumeRollIntervalMinutes,
        circulatingSupply,
        totalSupply,
        maxSupply,
        normalizeText(body.status || current.status || "admin controlled"),
        normalizeText(body.updatedBy || "admin"),
        priceChanged,
        manualVolumeChanged,
        market,
        logoUrl
    ]);

    if (priceChanged) {
        await dbPool.query(`
            insert into admin_market_ticks (symbol, price_usd, change_pct, volume_usd, source)
            values ($1, $2, $3, $4, 'admin-manual')
        `, [symbol, currentPrice, changePct, totalVolume]);
    }

    await trimAdminMarketTicks(symbol);
    const updated = normalizeAdminMarketControlRow(result.rows[0]);
    await saveAdminMarketSnapshot(updated);
    await saveAdminControlledCharts(symbol);
    return getAdminMarketOverview({ symbol, range: body.range || "1d" });
}

async function deleteAdminMarketControl(body = {}) {
    if (!databaseConfigured()) {
        const err = new Error("Database is not configured for admin market controls.");
        err.status = 503;
        throw err;
    }
    await ensureAdminMarketTables();
    const symbol = controlledMarketSymbol(body.symbol || "");
    if (!symbol) {
        const err = new Error("Choose a controlled asset to delete.");
        err.status = 400;
        throw err;
    }
    if (symbol === "AU") {
        const err = new Error("Autody AU cannot be deleted.");
        err.status = 400;
        throw err;
    }

    const current = await readAdminMarketControl(symbol);
    if (!current) {
        const err = new Error("Market control not found.");
        err.status = 404;
        throw err;
    }

    await dbPool.query(`delete from admin_market_ticks where symbol = $1`, [symbol]);
    await dbPool.query(`delete from market_latest_snapshots where upper(symbol) = upper($1) and provider = 'autody-admin'`, [symbol]).catch(() => null);
    await dbPool.query(`delete from market_latest_chart_snapshots where upper(symbol) = upper($1) and provider = 'autody-admin'`, [symbol]).catch(() => null);
    await dbPool.query(`delete from admin_market_controls where symbol = $1`, [symbol]);

    const logoUrl = normalizeText(current.logoUrl || "");
    if (logoUrl.startsWith(`${ADMIN_CONTROLLED_LOGO_PUBLIC_BASE}/`)) {
        const logoFile = path.join(__dirname, "public", logoUrl.replace(/\//g, path.sep));
        try {
            fs.unlinkSync(logoFile);
        } catch (_) {
            // The database delete is the source of truth; a missing generated logo is harmless.
        }
    }

    try {
        marketCatalogCache.clear();
    } catch (_) {}
    try {
        liveMarketAssetCache.bySymbol.delete(symbol);
        liveMarketAssetCache.assets = liveMarketAssetCache.assets.filter((asset) => asset.symbol !== symbol);
    } catch (_) {}

    return {
        success: true,
        configured: true,
        symbol,
        controls: await listAdminMarketControls(),
        generatedAt: new Date().toISOString()
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

    await refreshAdminControlledMarketsForCatalog();

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

    const catalogSymbols = new Set(catalog.map((asset) => asset.symbol));
    const controlledSupplemental = snapshots
        .filter((asset) => asset?.symbol && asset.provider === "autody-admin" && !catalogSymbols.has(asset.symbol))
        .map((asset, index) => assetCatalogEntry({
            rank: 900 + index,
            symbol: asset.symbol,
            name: asset.name || asset.symbol,
            assetType: asset.assetType || "crypto",
            market: normalizeAdminMarketVenue(asset.assetType, asset.symbol, asset.market),
            region: asset.assetType === "crypto" ? "Global" : normalizeAdminMarketVenue(asset.assetType, asset.symbol, asset.market),
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
            customAsset: true,
            status: "Admin controlled"
        }));
    if (controlledSupplemental.length) {
        catalog = [...catalog, ...controlledSupplemental];
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

// Transak requires raw body for signature hashing. KYC uploads use JSON with base64 files.
app.use(bodyParser.raw({ type: "*/*", limit: process.env.REQUEST_BODY_LIMIT || "18mb" }));

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

const NEWS_IMAGE_LIBRARY = {
  Markets: [
    "/news/image00003.jpeg",
    "/news/image00005.jpeg",
    "/news/image00006.jpeg",
    "/news/image00008.jpeg",
    "/news/image00015.jpeg",
    "/news/image00017.jpeg",
    "/news/image00019.jpeg"
  ],
  Stocks: [
    "/news/image00003.jpeg",
    "/news/image00006.jpeg",
    "/news/image00008.jpeg",
    "/news/image00017.jpeg",
    "/news/image00019.jpeg"
  ],
  Economy: [
    "/news/image00004.jpeg",
    "/news/image00005.jpeg",
    "/news/image00009.jpeg",
    "/news/image00015.jpeg"
  ],
  Crypto: [
    "/news/image00009.jpeg",
    "/news/image00012.jpeg",
    "/news/image00015.jpeg",
    "/news/image00017.jpeg"
  ],
  Business: [
    "/news/image00007.jpeg",
    "/news/image00010.jpeg",
    "/news/image00011.jpeg",
    "/news/image00013.jpeg",
    "/news/image00016.jpeg",
    "/news/image00020.jpeg"
  ]
};

const NEWS_BLOCKED_TERMS = [
  /\bnigeria\b/i,
  /\bnigerian\b/i,
  /\blagos\b/i,
  /\babuja\b/i,
  /\bnaira\b/i
];

const fallbackNews = [
  {
    title: "Markets watch inflation, rates, and consumer strength for the next signal.",
    source: "Autody market brief",
    url: "#",
    subject: "Economy",
    summary: "A quick economy brief focused on the market signals that can affect stocks, crypto, and consumer confidence.",
    image: "/news/image00004.jpeg"
  },
  {
    title: "Crypto traders keep liquidity, wallet activity, and risk appetite in focus.",
    source: "Autody market brief",
    url: "#",
    subject: "Crypto",
    summary: "A quick crypto brief focused on the conditions that can affect digital assets and wallet decisions.",
    image: "/news/image00009.jpeg"
  },
  {
    title: "Stocks react to earnings guidance, AI spending, and global demand.",
    source: "Autody market brief",
    url: "#",
    subject: "Business",
    summary: "A quick business brief focused on company news and market pressure that can shape account decisions.",
    image: "/news/image00013.jpeg"
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
  depositNetworks: ["Autody"],
  tradeable: true,
  customAsset: true,
  logoUrl: "Autody-Logo.png",
  status: "Admin controlled"
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

function isAdminControlledMarketAsset(asset = {}) {
  const symbol = String(asset?.symbol || "").toUpperCase();
  const provider = String(asset?.dataProvider || asset?.provider || "").toLowerCase();
  const status = String(asset?.status || "").toLowerCase();
  const tags = Array.isArray(asset?.tags) ? asset.tags.map((tag) => String(tag).toLowerCase()) : [];
  return symbol === "AU" || provider === "autody-admin" || status === "admin controlled" || tags.includes("admin controlled");
}

async function fetchAdminControlledChartSeries(asset, requestedRange = "1d") {
  const selectedRange = normalizeChartRange(requestedRange);
  const symbol = controlledMarketSymbol(asset?.symbol || "AU");
  const control = await advanceAdminControlledMarket(symbol).catch((err) => {
    console.error(`Admin controlled market advance failed for ${symbol}:`, err.message || err);
    return null;
  });
  const liveChart = await buildAdminControlledChart(symbol, selectedRange).catch((err) => {
    console.error(`Admin controlled chart failed for ${symbol} ${selectedRange}:`, err.message || err);
    return null;
  });
  if (!liveChart?.points?.length) return null;

  const marketAsset = control
    ? adminMarketAssetFromControl(control, await adminMarketStats(symbol).catch(() => ({})))
    : asset;
  await saveMarketChartSnapshot("autody-admin", marketAsset, liveChart);
  return { ...liveChart, source: "database", refreshed: true };
}

async function fetchAssetChartSeries(asset, requestedRange = "1d") {
  const selectedRange = normalizeChartRange(requestedRange);

  if (isAdminControlledMarketAsset(asset)) {
    const liveChart = await fetchAdminControlledChartSeries(asset, selectedRange);
    if (liveChart) return liveChart;
  }

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

function isBlockedNewsRegion(article = {}) {
  const text = [
    article.title,
    article.source,
    article.summary,
    article.subject,
    article.url
  ].filter(Boolean).join(" ");
  return NEWS_BLOCKED_TERMS.some((pattern) => pattern.test(text));
}

function stableNewsImageIndex(seed = "", length = 1) {
  if (!length) return 0;
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = ((hash * 31) + seed.charCodeAt(index)) >>> 0;
  }
  return hash % length;
}

function newsImageSubject(article = {}) {
  const subject = String(article.subject || inferNewsSubject(article.title, "Markets") || "Markets").toLowerCase();
  const text = `${subject} ${article.title || ""} ${article.summary || ""}`.toLowerCase();
  if (/(bitcoin|crypto|ethereum|token|blockchain|stablecoin|wallet)/.test(text)) return "Crypto";
  if (/(stock|stocks|shares|nasdaq|s&p|dow|earnings|nvidia|apple|tesla|market)/.test(text)) return "Stocks";
  if (/(inflation|fed|rates|jobs|economy|tariff|gdp|dollar|treasury|central bank)/.test(text)) return "Economy";
  if (/(company|business|ceo|startup|profit|revenue|deal|merger|partnership|enterprise)/.test(text)) return "Business";
  return "Markets";
}

function curatedNewsImage(article = {}) {
  const bucket = newsImageSubject(article);
  const pool = NEWS_IMAGE_LIBRARY[bucket] || NEWS_IMAGE_LIBRARY.Markets;
  const seed = `${article.title || ""}|${article.source || ""}|${bucket}`;
  return pool[stableNewsImageIndex(seed, pool.length)];
}

function subjectImage(subject = "Markets") {
  return curatedNewsImage({ subject });
}

function ensureArticleImage(article) {
  const subject = article.subject || inferNewsSubject(article.title, "Markets");
  const normalizedArticle = { ...article, subject };
  return {
    ...normalizedArticle,
    image: curatedNewsImage(normalizedArticle) || article.image || subjectImage(subject),
    summary: normalizedArticle.summary || "Open the source for the full story and market context."
  };
}

function uniqueArticles(articles) {
  const seen = new Set();
  return articles.filter((article) => {
    if (isCompetitorPromo(article) || isBlockedNewsRegion(article)) return false;
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
    const cachedArticles = (await readLatestNewsSnapshots(30))
      .filter((article) => !isBlockedNewsRegion(article))
      .slice(0, 9)
      .map(ensureArticleImage);
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

function startDepositMonitorLoop() {
  if (!databaseConfigured()) return;
  if (!DEPOSIT_MONITOR_ENABLED) return;
  if (depositMonitorTimer) return;

  const runMonitor = (reason = "deposit-monitor") => {
    if (depositMonitorInFlight) return depositMonitorInFlight;
    depositMonitorInFlight = scanDatabaseCryptoDeposits({ reason })
      .then((result) => {
        if (result?.credited?.length) {
          console.log(`Deposit monitor credited ${result.credited.length} deposit(s).`);
        }
        return result;
      })
      .catch((err) => {
        console.error("Deposit monitor failed:", err);
      })
      .finally(() => {
        depositMonitorInFlight = null;
      });
    return depositMonitorInFlight;
  };

  const startupTimer = setTimeout(() => runMonitor("startup-deposit-monitor"), 15 * 1000);
  startupTimer.unref?.();

  depositMonitorTimer = setInterval(() => runMonitor("deposit-monitor-interval"), DEPOSIT_MONITOR_INTERVAL_MS);
  depositMonitorTimer.unref?.();
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

    const articles = result.rows
      .map((row) => ({
        title: row.title,
        source: row.source,
        subject: row.subject,
        image: row.image,
        url: row.url,
        publishedAt: row.published_at,
        capturedAt: row.captured_at,
        provider: row.provider
      }))
      .filter((article) => !isBlockedNewsRegion(article))
      .map(ensureArticleImage);

    return res.json({ success: true, configured: true, articles });
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

  const controlledLookup = lookup === "AUTODY-AU" || lookup === "AUTODY" ? "AU" : lookup;
  const controlledAsset = await controlledMarketAssetForLookup(controlledLookup);
  if (controlledAsset) return controlledAsset;

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
    const accountMode = normalizeWatchlistMode(req.query.mode || "demo");
    const asset = await findMarketAssetBySymbol(symbol);

    if (!asset) {
      return res.status(404).json({ success: false, error: "Asset not found" });
    }

    const [chartResult, accountResult] = await Promise.allSettled([
      fetchAssetChartSeries(asset, range),
      getAuthenticatedAccount(req, accountMode)
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
        buyingPower: account?.user?.cashBalance ?? (accountMode === "demo" ? 50000 : 0),
        startingBalance: account?.user?.startingBalance ?? (accountMode === "demo" ? 50000 : 0),
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

app.get("/api/auth/captcha-config", (req, res) => {
  return res.json({
    success: true,
    provider: "google-recaptcha-v2",
    configured: Boolean(RECAPTCHA_SITE_KEY),
    siteKey: RECAPTCHA_SITE_KEY
  });
});

app.get("/api/auth/verification-status", async (req, res) => {
  try {
    const email = normalizeEmail(req.query.email);
    if (!email) return res.status(400).json({ success: false, error: "Email is required." });

    const databaseProfile = await databaseProfileVerification(email).catch(() => null);
    if (databaseProfile) {
      return res.json({
        success: true,
        email: databaseProfile.email,
        phone: databaseProfile.phone,
        verification: {
          email: databaseProfile.email_status || "pending",
          phone: databaseProfile.phone_status || "pending",
          identity: databaseProfile.identity_status || "pending"
        }
      });
    }

    const db = loadDemoDb();
    const user = jsonUserByEmail(db, email);
    if (!user) return res.status(404).json({ success: false, error: "Account not found." });
    return res.json({
      success: true,
      email: user.email,
      phone: user.verification?.phone || "",
      verification: {
        email: user.verification?.emailStatus || "pending",
        phone: user.verification?.phoneStatus || "pending",
        identity: user.verification?.identityStatus || "pending"
      }
    });
  } catch (err) {
    console.error("Verification status failed:", err);
    return res.status(500).json({ success: false, error: "Verification status unavailable." });
  }
});

app.post("/api/ops/session", async (req, res) => {
  try {
    let body = {};
    try {
      body = parseJsonBody(req);
    } catch (err) {
      return res.status(400).json({ success: false, error: "Invalid JSON payload." });
    }

    if (!adminAuthConfigured()) {
      return res.status(503).json({ success: false, error: "Admin account access is not configured." });
    }

    const email = normalizeEmail(body.email);
    const password = String(body.password || "");
    if (email !== ADMIN_ACCOUNT_EMAIL || !adminPasswordMatches(password)) {
      await recordAdminAccessEvent("admin_password", "rejected_credentials", req, { email });
      return res.status(401).json({ success: false, error: "Admin email or password is incorrect." });
    }

    const challenge = await createAdminLoginChallenge(email, body.label || "Autody admin", req);
    return res.json({
      success: true,
      requiresCode: true,
      challengeId: challenge.challengeId,
      maskedEmail: challenge.maskedEmail,
      expiresAt: challenge.expiresAt,
      delivery: challenge.delivery?.delivered ? "Admin code sent." : "Admin code created. Email delivery provider is not fully connected yet."
    });
  } catch (err) {
    console.error("Admin session challenge failed:", err);
    return res.status(err.status || 500).json({ success: false, error: err.message || "Could not start admin sign in." });
  }
});

app.post("/api/ops/session/verify", async (req, res) => {
  try {
    let body = {};
    try {
      body = parseJsonBody(req);
    } catch (err) {
      return res.status(400).json({ success: false, error: "Invalid JSON payload." });
    }

    const admin = await verifyAdminLoginChallenge(body.challengeId, body.code, req);
    const session = createAdminSessionToken(admin.label || "Autody admin", admin.email);
    return res.json({
      success: true,
      session,
      expiresAt: session.expiresAt,
      controls: ["market", "deposits", "kyc", "support"],
      issuedAt: new Date().toISOString()
    });
  } catch (err) {
    console.error("Admin session verification failed:", err);
    return res.status(err.status || 500).json({ success: false, error: err.message || "Could not verify admin code." });
  }
});

app.post("/api/ops/session/check", async (req, res) => {
  try {
    let body = {};
    try {
      body = parseJsonBody(req);
    } catch (err) {
      return res.status(400).json({ success: false, error: "Invalid JSON payload." });
    }
    const session = verifyAdminSessionToken(requestAdminSessionToken(req, body));
    if (!session) return res.status(401).json({ success: false, error: "Admin session expired or invalid." });
    return res.json({ success: true, session, expiresAt: new Date(session.exp).toISOString() });
  } catch (err) {
    return res.status(500).json({ success: false, error: "Admin session check failed." });
  }
});

app.post("/api/admin/markets/overview", async (req, res) => {
  try {
    let body = {};
    try {
      body = parseJsonBody(req);
    } catch (err) {
      return res.status(400).json({ success: false, error: "Invalid JSON payload." });
    }
    if (!adminRequestAuthorized(req, body)) {
      return res.status(403).json({ success: false, error: "Admin market overview is not authorized." });
    }
    const result = await getAdminMarketOverview(body);
    return res.json(result);
  } catch (err) {
    console.error("Admin market overview failed:", err);
    return res.status(err.status || 500).json({ success: false, error: err.message || "Market overview failed." });
  }
});

app.post("/api/admin/markets/list", async (req, res) => {
  try {
    let body = {};
    try {
      body = parseJsonBody(req);
    } catch (err) {
      return res.status(400).json({ success: false, error: "Invalid JSON payload." });
    }
    if (!adminRequestAuthorized(req, body)) {
      return res.status(403).json({ success: false, error: "Admin market list is not authorized." });
    }
    const controls = await listAdminMarketControls();
    return res.json({
      success: true,
      configured: true,
      controls,
      generatedAt: new Date().toISOString()
    });
  } catch (err) {
    console.error("Admin market list failed:", err);
    return res.status(err.status || 500).json({ success: false, error: err.message || "Market control list failed." });
  }
});

app.post("/api/admin/markets/create", async (req, res) => {
  try {
    let body = {};
    try {
      body = parseJsonBody(req);
    } catch (err) {
      return res.status(400).json({ success: false, error: "Invalid JSON payload." });
    }
    if (!adminRequestAuthorized(req, body)) {
      return res.status(403).json({ success: false, error: "Admin market create is not authorized." });
    }
    const result = await createAdminMarketControl(body);
    return res.json(result);
  } catch (err) {
    console.error("Admin market create failed:", err);
    return res.status(err.status || 500).json({ success: false, error: err.message || "Market control create failed." });
  }
});

app.post("/api/admin/markets/control", async (req, res) => {
  try {
    let body = {};
    try {
      body = parseJsonBody(req);
    } catch (err) {
      return res.status(400).json({ success: false, error: "Invalid JSON payload." });
    }
    if (!adminRequestAuthorized(req, body)) {
      return res.status(403).json({ success: false, error: "Admin market control is not authorized." });
    }
    const result = await updateAdminMarketControl(body);
    return res.json(result);
  } catch (err) {
    console.error("Admin market control failed:", err);
    return res.status(err.status || 500).json({ success: false, error: err.message || "Market control failed." });
  }
});

app.post("/api/admin/markets/reset", async (req, res) => {
  try {
    let body = {};
    try {
      body = parseJsonBody(req);
    } catch (err) {
      return res.status(400).json({ success: false, error: "Invalid JSON payload." });
    }
    if (!adminRequestAuthorized(req, body)) {
      return res.status(403).json({ success: false, error: "Admin market reset is not authorized." });
    }
    const result = await resetAdminMarketControl(body);
    return res.json(result);
  } catch (err) {
    console.error("Admin market reset failed:", err);
    return res.status(err.status || 500).json({ success: false, error: err.message || "Market reset failed." });
  }
});

app.post("/api/admin/markets/delete", async (req, res) => {
  try {
    let body = {};
    try {
      body = parseJsonBody(req);
    } catch (err) {
      return res.status(400).json({ success: false, error: "Invalid JSON payload." });
    }
    if (!adminRequestAuthorized(req, body)) {
      return res.status(403).json({ success: false, error: "Admin market delete is not authorized." });
    }
    const result = await deleteAdminMarketControl(body);
    return res.json(result);
  } catch (err) {
    console.error("Admin market delete failed:", err);
    return res.status(err.status || 500).json({ success: false, error: err.message || "Market delete failed." });
  }
});

app.post("/api/admin/markets/tick", async (req, res) => {
  try {
    let body = {};
    try {
      body = parseJsonBody(req);
    } catch (err) {
      return res.status(400).json({ success: false, error: "Invalid JSON payload." });
    }
    if (!adminRequestAuthorized(req, body)) {
      return res.status(403).json({ success: false, error: "Admin market tick is not authorized." });
    }
    const result = await getAdminMarketOverview({ ...body, forceTick: true });
    return res.json(result);
  } catch (err) {
    console.error("Admin market tick failed:", err);
    return res.status(err.status || 500).json({ success: false, error: err.message || "Market tick failed." });
  }
});

app.post("/api/admin/reset-accounts", async (req, res) => {
  try {
    if (!ADMIN_RESET_KEY) {
      return res.status(503).json({ success: false, error: "Admin reset is not configured." });
    }
    let body = {};
    try {
      body = parseJsonBody(req);
    } catch (err) {
      return res.status(400).json({ success: false, error: "Invalid JSON payload." });
    }
    const providedKey = normalizeText(req.get("x-admin-reset-key") || body.adminKey);
    if (!providedKey || providedKey !== ADMIN_RESET_KEY) {
      return res.status(403).json({ success: false, error: "Admin reset is not authorized." });
    }
    const keepEmail = normalizeEmail(body.keepEmail || PRACTICE_USER_EMAIL);
    const database = await resetDatabaseAccountsToEmail(keepEmail);
    const json = resetJsonAccountsToEmail(keepEmail);
    return res.json({
      success: true,
      keepEmail,
      database,
      json
    });
  } catch (err) {
    console.error("Admin account reset failed:", err);
    return res.status(500).json({ success: false, error: "Could not reset accounts.", details: err.message || String(err) });
  }
});

app.post("/api/admin/deposits/scan", async (req, res) => {
  try {
    let body = {};
    try {
      body = parseJsonBody(req);
    } catch (err) {
      return res.status(400).json({ success: false, error: "Invalid JSON payload." });
    }
    if (!adminRequestAuthorized(req, body)) {
      return res.status(403).json({ success: false, error: "Admin deposit scan is not authorized." });
    }
    const result = await scanDatabaseCryptoDeposits({
      limit: body.limit,
      address: body.address,
      asset: body.asset || body.symbol,
      network: body.network,
      fromBlock: body.fromBlock,
      toBlock: body.toBlock
    });
    return res.json(result);
  } catch (err) {
    console.error("Admin deposit scan failed:", err);
    return res.status(err.status || 500).json({ success: false, error: err.message || "Deposit scan failed." });
  }
});

app.post("/api/admin/deposits/overview", async (req, res) => {
  try {
    let body = {};
    try {
      body = parseJsonBody(req);
    } catch (err) {
      return res.status(400).json({ success: false, error: "Invalid JSON payload." });
    }
    if (!adminRequestAuthorized(req, body)) {
      return res.status(403).json({ success: false, error: "Admin deposit overview is not authorized." });
    }
    const result = await getAdminDepositOverview(body);
    return res.json(result);
  } catch (err) {
    console.error("Admin deposit overview failed:", err);
    return res.status(err.status || 500).json({ success: false, error: err.message || "Deposit overview failed." });
  }
});

app.post("/api/admin/deposits/sweep", async (req, res) => {
  try {
    let body = {};
    try {
      body = parseJsonBody(req);
    } catch (err) {
      return res.status(400).json({ success: false, error: "Invalid JSON payload." });
    }
    if (!adminRequestAuthorized(req, body)) {
      return res.status(403).json({ success: false, error: "Admin deposit sweep is not authorized." });
    }
    const result = await sweepDatabaseDepositAddress(body);
    return res.json(result);
  } catch (err) {
    console.error("Admin deposit sweep failed:", err);
    return res.status(err.status || 500).json({ success: false, error: err.message || "Deposit sweep failed." });
  }
});

app.post("/api/admin/deposits/credit", async (req, res) => {
  try {
    let body = {};
    try {
      body = parseJsonBody(req);
    } catch (err) {
      return res.status(400).json({ success: false, error: "Invalid JSON payload." });
    }
    if (!adminRequestAuthorized(req, body)) {
      return res.status(403).json({ success: false, error: "Admin deposit credit is not authorized." });
    }
    const result = await manuallyCreditDatabaseDeposit(body);
    return res.json(result);
  } catch (err) {
    console.error("Admin deposit credit failed:", err);
    return res.status(err.status || 500).json({ success: false, error: err.message || "Deposit credit failed." });
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
      source: account.source
    });
  } catch (err) {
    console.error("Live orders API error:", err);
    return sendDemoError(res, err, "Live orders unavailable");
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
    startDepositMonitorLoop();
  });
}

startServer().catch((err) => {
  console.error("Autody startup failed:", err);
  process.exit(1);
});
