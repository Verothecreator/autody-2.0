
console.log("✅ main.js loaded at", new Date().toISOString());

window.addEventListener("load", () => {
  console.log("✅ Window loaded");

  console.log("🔍 Looking for Transak globals...");
  console.log("window.Transak =", window.Transak);
  console.log("window.transakSDK =", window.transakSDK);
  console.log("window.TransakSDK =", window.TransakSDK);

  const scripts = [...document.scripts].map(s => s.src);
  console.log("📜 Loaded script tags:", scripts);

  if (!window.Transak && !window.transakSDK && !window.TransakSDK) {
    console.warn("Transak SDK globals not found; buy flow will use the hosted Transak URL fallback.");
  } else {
    console.log("✅ TRANSAK SDK FOUND");
  }
});




// ===== Join Community (Google Sheets via JSONP, with status messages) =====
document.addEventListener("DOMContentLoaded", () => {
  const APPS_SCRIPT_URL =
    "https://script.google.com/macros/s/AKfycbz4OoId6YfogVy_VSoMWM7HR84amjlGb0NZZ9l6lmU1EIjeMw6D7fnbKDBEmvuVF89UYQ/exec";

  const joinBtn    = document.getElementById("join-community-btn");
  const joinPopup  = document.getElementById("join-popup");
  const joinClose  = document.getElementById("join-close");
  const joinForm   = document.getElementById("join-form");
  const joinEmail  = document.getElementById("join-email");
  const joinMsg    = document.getElementById("join-msg");
  const joinSubmit = document.getElementById("join-submit");

  if (!joinBtn) return;

  // Open / close
  joinBtn.addEventListener("click", (e) => {
    e.preventDefault();
    joinPopup.style.display = "flex";
    joinMsg.style.display = "none";
    joinForm.reset();
    joinEmail.focus();
  });
  joinClose.addEventListener("click", () => (joinPopup.style.display = "none"));
  joinPopup.addEventListener("click", (e) => {
    if (e.target === joinPopup) joinPopup.style.display = "none";
  });

  // JSONP helper
  function sendJSONP(url, params, cbName, onComplete) {
    const qs = new URLSearchParams({ ...params, callback: cbName, ts: String(Date.now()) });
    const script = document.createElement("script");
    script.src = `${url}?${qs.toString()}`;
    script.async = true;
    script.onerror = () => {
      onComplete({ status: "error", message: "Network error" });
      cleanup();
    };
    function cleanup() {
      try { script.remove(); } catch {}
      try { delete window[cbName]; } catch {}
    }
    window[cbName] = (data) => {
      onComplete(data || { status: "error" });
      cleanup();
    };
    document.body.appendChild(script);
  }

  // Submit handler
  joinForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const email = joinEmail.value.trim();
    const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (!isValid) {
      joinMsg.textContent = "Please enter a valid email address.";
      joinMsg.style.display = "block";
      return;
    }

    joinSubmit.disabled = true;
    joinMsg.textContent = "Submitting…";
    joinMsg.style.display = "block";

    // unique callback name per request
    const cbName = `joinCb_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    sendJSONP(APPS_SCRIPT_URL, { email }, cbName, (res) => {
      let text = "Something went wrong. Please try again.";
      switch (res.status) {
        case "success":
          text = "Thanks! You’re in. Check your inbox soon.";
          joinForm.reset();
          setTimeout(() => {
            joinPopup.style.display = "none";
            joinMsg.style.display = "none";
          }, 1200);
          break;
        case "duplicate":
          text = "You’re already on the list 👏";
          break;
        case "invalid":
          text = "Invalid email — please check and try again.";
          break;
        case "too_fast":
          text = "Easy there! Please try again in a few seconds.";
          break;
        case "error":
          text = res.message || text;
          break;
      }
      joinMsg.textContent = text;
      joinMsg.style.display = "block";
      joinSubmit.disabled = false;
    });
  });
});

/* ===== Buy popup, wallet connect & Transak (unchanged) ===== */
document.addEventListener("DOMContentLoaded", () => {
  const openBtn  = document.getElementById("open-buy-card-btn");
  const popup    = document.getElementById("buy-card-popup");
  const closeBtn = document.getElementById("close-popup");
  const buyBtn   = document.getElementById("buy-autody-btn");

  // Step containers
  const buyStep      = document.getElementById("buy-step");
  const walletStep   = document.getElementById("wallet-step");
  const openWallets  = document.getElementById("open-wallets");
  const walletDisplay= document.getElementById("walletAddressDisplay");

  const usdInput   = document.getElementById("usdAmount");
  const tokenInput = document.getElementById("tokenAmount");

  // --- EIP-6963 Provider Discovery ---
  const discoveredProviders = [];
  window.addEventListener("eip6963:announceProvider", (event) => {
    const { info, provider } = event.detail;
    discoveredProviders.push({ info, provider });
  });
  window.dispatchEvent(new Event("eip6963:requestProvider"));

  // --- Helper: Enable/disable Buy button ---
  function updateBuyButtonState() {
    const usdRaw = (usdInput.value || "").toString().replace(/,/g, "");
    const usdValue = parseFloat(usdRaw);
    const wallet   = window.localStorage.getItem("autodyWallet");

    const validUsd = isFinite(usdValue) && usdValue > 0;
    const validWallet = wallet && wallet.length > 0;

    if (validUsd && validWallet) {
      buyBtn.disabled = false;
    } else {
      buyBtn.disabled = true;
    }
  }

  // Initially disabled
  buyBtn.disabled = true;

  // Watch USD input
  usdInput.addEventListener("input", updateBuyButtonState);

  // Also re-check when wallet connects
  document.addEventListener("walletConnected", updateBuyButtonState);

  // Open popup
  openBtn.addEventListener("click", (e) => {
    e.preventDefault();
    popup.style.display = "flex";
    warmPriceCache().catch(console.error);
  });

  // Close popup
  closeBtn.addEventListener("click", () => {
    popup.style.display = "none";
  });

  // Switch to wallet step
  openWallets.addEventListener("click", () => {
    buyStep.style.display = "none";
    walletStep.style.display = "block";
  });

  // Buy button launches Transak (new logic)
  buyBtn.addEventListener("click", async (e) => {
    console.log("🟢 BUY CLICKED");
    e.preventDefault();
    try {
      await openTransakIframe();
    } catch (err) {
      console.error("Transak widget failed:", err);
      alert("Something went wrong launching the payment widget. Please try again.");
    }
  });

  // Wallet connect logic (per-button)
  document.querySelectorAll(".wallet-option").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const type = btn.dataset.wallet; 
      try {
        const address = await connectWallet(type, discoveredProviders);
        if (address) {
          walletDisplay.innerText = `Connected: ${address}`;
          window.localStorage.setItem("autodyWallet", address);

          // ✅ trigger custom event for Buy button state
          document.dispatchEvent(new Event("walletConnected"));

          walletStep.style.display = "none";
          buyStep.style.display = "block";
        }
      } catch (err) {
        console.error(`${type} connection failed:`, err);
        alert("Connection failed: " + (err?.message || err));
      }
    });
  });
});

/* ---------------------------
   Wallet helpers, WalletConnect, Transak (unchanged)
--------------------------- */

/* ===== PRICE CACHE ===== */
let cachedPriceUSD = null;
let lastPriceTs = 0;
const PRICE_TTL_MS = 10_000;


function findInjectedFor(type, discoveredProviders) {
  const NAME_MAP = {
    metamask:   ["MetaMask"],
    coinbase:   ["Coinbase Wallet", "Coinbase"],
    blockchain: ["Blockchain.com", "Blockchain Wallet"],
    trust:      ["Trust Wallet", "Trust"],
    ledger:     ["Ledger", "Ledger Live"]
  };

  const FLAG_CHECK = {
    metamask:   (p) => p.isMetaMask,
    coinbase:   (p) => p.isCoinbaseWallet,
    blockchain: (p) => p.isBlockchain || p.isBlockchainWallet,
    trust:      (p) => p.isTrust || p.isTrustWallet,
    ledger:     (p) => p.isLedger || p.isLedgerLive
  };

  const wantedNames = NAME_MAP[type] || [];
  for (const { info, provider } of discoveredProviders) {
    if (info?.name && wantedNames.some(n => info.name.toLowerCase().includes(n.toLowerCase()))) {
      return provider;
    }
  }

  const eth = window.ethereum;
  if (!eth) return null;
  const candidates = Array.isArray(eth.providers) && eth.providers.length ? eth.providers : [eth];
  const checker = FLAG_CHECK[type];
  if (!checker) return null;
  return candidates.find(checker) || null;
}

async function connectViaInjected(injectedProvider) {
  await injectedProvider.request({ method: "eth_requestAccounts" });
  const provider = new ethers.BrowserProvider(injectedProvider);
  const signer = await provider.getSigner();
  return await signer.getAddress();
}

/* ---------------------------
   WalletConnect (QR) setup
--------------------------- */
let wcUniversalProvider = null;
let wcModal = null;

async function ensureWalletConnectReady() {
  const Universal = window.WalletConnectUniversalProvider;
  const ModalLib  = window.WalletConnectModal?.default || window.WalletConnectModal;
  if (!Universal || !ModalLib) {
    throw new Error("WalletConnect scripts not loaded. Make sure universal-provider and modal are included.");
  }

  if (!wcUniversalProvider) {
    wcUniversalProvider = await Universal.init({
      projectId: "69e2560c7b637bd282fec177545d8036", // ✅ your real projectId
      metadata: {
        name: "Autody",
        description: "Autody Token Sale",
        url: window.location.origin,
        icons: ["https://autody-online.onrender.com/favicon.ico"]
      }
    });
  }

  if (!wcModal) {
    wcModal = new ModalLib({
      projectId: "69e2560c7b637bd282fec177545d8036",
      themeMode: "light",
      themeVariables: { "--wcm-z-index": "3000" }
    });
  }
}

async function connectViaWalletConnect() {
  await ensureWalletConnectReady();

  return new Promise(async (resolve, reject) => {
    try {
      wcUniversalProvider.once("display_uri", (uri) => {
        setTimeout(() => wcModal.openModal({ uri }), 100);
      });

      const session = await wcUniversalProvider.connect({
        namespaces: {
          eip155: {
            methods: ["eth_sendTransaction", "personal_sign", "eth_signTypedData"],
            chains: ["eip155:1"],
            events: ["chainChanged", "accountsChanged"]
          }
        }
      });

      wcModal.closeModal();

      const caip = session?.namespaces?.eip155?.accounts?.[0];
      const address = caip ? caip.split(":")[2] : null;
      if (!address) throw new Error("No account returned from WalletConnect.");
      resolve(address);
    } catch (e) {
      try { wcModal.closeModal(); } catch (_) {}
      reject(e);
    }
  });
}

/* ---------------------------
   Main connect dispatcher
--------------------------- */
async function connectWallet(type, discoveredProviders) {
  if (type === "walletconnect") {
    return await connectViaWalletConnect();
  }

  const injected = findInjectedFor(type, discoveredProviders);
  if (injected) {
    try {
      return await connectViaInjected(injected);
    } catch (err) {
      console.warn(`${type} extension failed, falling back to QR…`, err);
      return await connectViaWalletConnect();
    }
  }

  return await connectViaWalletConnect();
}

/* ---------------------------
   Live USD → AUTODY converter (unchanged)
--------------------------- */
const usdInput   = document.getElementById("usdAmount");
const tokenInput = document.getElementById("tokenAmount");

function openTransakIframe() {

  const usdRaw = (usdInput.value || "").replace(/,/g, "");
  const usdValue = parseFloat(usdRaw);

  if (!isFinite(usdValue) || usdValue <= 0) {
    alert("Enter a valid USD amount");
    return;
  }

  const wallet = localStorage.getItem("autodyWallet");
  if (!wallet) {
    alert("Please connect your wallet first.");
    return;
  }

  const auAmount = tokenInput.value;

  const params = new URLSearchParams({

    // ✅ YOUR TRANSAK KEY
    apiKey: "abb84712-113f-4bc5-9e4a-53495a966676",

    // ✅ LIVE MODE
    environment: "STAGING",

    // ✅ FORCE VAULT WALLET
    payoutAddress: "0xE07DFB3f6eD64bAD34466E23E484d37C00b5E972",

    // ✅ PAYMENT ROUTING
    fiatCurrency: "USD",
    fiatAmount: usdValue,

    // ✅ CRYPTO OUTPUT
    cryptoCurrency: "USDT",
    network: "polygon",

    // ✅ USER WALLET (for identity & validation)
    walletAddress: wallet,
    disableWalletAddressForm: "true",

    // ✅ REDIRECT AFTER PAYMENT
    redirectURL: window.location.origin,

    // ✅ DATA YOU WILL RECEIVE IN WEBHOOK
    metaData_wallet: wallet,
    metaData_au_amount: auAmount,
    metaData_usd: usdValue
  });

  const transakURL = `https://global.transak.com?${params.toString()}`;

  console.log("🚀 Opening Transak:", transakURL);

  window.open(transakURL, "_blank", "width=420,height=720,resizable=yes,scrollbars=yes");
}



const AUTODY_ADDRESS = "0xa2746a48211cd3cb0fc6356deb10d79feb792c57".toLowerCase(); // new Polygon contract (lowercased)
const NETWORK_SLUG   = "polygon_pos";   // legacy slug (kept for compatibility)
const POOL_ADDRESS   = "0x30dA748C76D1c87b2893035b60fDc50a31439d8D"; // pair identifier used by Dexscreener proxy

const POLYGON_RPC = "https://polygon-rpc.com"; // read-only JSON-RPC endpoint

const ABI_V3 = [
  "function slot0() view returns (uint160 sqrtPriceX96,int24 tick,uint16 obsIndex,uint16 obsCardinality,uint16 obsCardinalityNext,uint8 feeProtocol,bool unlocked)",
  "function token0() view returns (address)",
  "function token1() view returns (address)"
];
const ABI_V2 = [
  "function getReserves() view returns (uint112 reserve0,uint112 reserve1,uint32 blockTimestampLast)",
  "function token0() view returns (address)",
  "function token1() view returns (address)"
];
const ABI_ERC20 = [
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)"
];

async function fetchOnchainPoolPrice(poolAddress, targetTokenAddress) {
  // returns { price: Number, unit: string } where price is decimal number in unit (e.g. "USD" or "USDC" or "MATIC")
  try {
    const provider = new ethers.JsonRpcProvider(POLYGON_RPC);
    const poolV3 = new ethers.Contract(poolAddress, ABI_V3, provider);

    // try v3 first
    let token0, token1;
    try {
      token0 = (await poolV3.token0()).toLowerCase();
      token1 = (await poolV3.token1()).toLowerCase();
      const slot0 = await poolV3.slot0();
      const sqrtPriceX96 = BigInt(slot0[0].toString()); // BigInt
      // decimals
      const token0c = Number(await (new ethers.Contract(token0, ABI_ERC20, provider)).decimals());
      const token1c = Number(await (new ethers.Contract(token1, ABI_ERC20, provider)).decimals());

      // price = (sqrtPriceX96 ** 2) / 2**192 * (10**(token0c - token1c))
      const numerator = sqrtPriceX96 * sqrtPriceX96; // BigInt
      const denom = BigInt(1) << BigInt(192);
      // compute fractional with Number (may lose tiny precision but fine for UI)
      const raw = Number(numerator) / Number(denom); // token1 per token0 (before decimals adj)
      const price = raw * Math.pow(10, token0c - token1c);

      // determine which side is AUTODY: if target == token0, then price is token1 per 1 token0 → that's quote/token
      const target = targetTokenAddress.toLowerCase();
      const isTargetToken0 = (target === token0);

      let priceInQuote = isTargetToken0 ? price : (1 / price);

      // figure out quote token symbol to return unit
      const quoteTokenAddr = isTargetToken0 ? token1 : token0;
      const quoteToken = new ethers.Contract(quoteTokenAddr, ABI_ERC20, provider);
      let quoteSymbol = "TOKEN";
      try { quoteSymbol = (await quoteToken.symbol()).toUpperCase(); } catch (e) { /* ignore */ }

      // if quoteSymbol is a USD stablecoin, return USD
      if (["USDC","USDT","DAI"].includes(quoteSymbol)) {
        return { price: Number(priceInQuote), unit: "USD" };
      }
      // if quote is WMATIC/WETH -> return price in that asset
      if (["WMATIC","MATIC","WETH","ETH"].includes(quoteSymbol)) {
        return { price: Number(priceInQuote), unit: quoteSymbol };
      }

      // otherwise return raw in quote token units
      return { price: Number(priceInQuote), unit: quoteSymbol };
    } catch (v3Err) {
      // not a v3 pool or v3 read failed; try v2 style
      const poolV2 = new ethers.Contract(poolAddress, ABI_V2, provider);
      token0 = (await poolV2.token0()).toLowerCase();
      token1 = (await poolV2.token1()).toLowerCase();
      const res = await poolV2.getReserves();
      const reserve0 = BigInt(res[0].toString());
      const reserve1 = BigInt(res[1].toString());

      const token0c = Number(await (new ethers.Contract(token0, ABI_ERC20, provider)).decimals());
      const token1c = Number(await (new ethers.Contract(token1, ABI_ERC20, provider)).decimals());

      // price token1 per token0 = (reserve1 / reserve0) * 10^(token0c - token1c)
      const rawRatio = Number(reserve1) / Number(reserve0);
      const price = rawRatio * Math.pow(10, token0c - token1c);

      const target = targetTokenAddress.toLowerCase();
      const isTargetToken0 = (target === token0);
      const priceInQuote = isTargetToken0 ? price : (1 / price);

      const quoteTokenAddr = isTargetToken0 ? token1 : token0;
      const quoteToken = new ethers.Contract(quoteTokenAddr, ABI_ERC20, provider);
      let quoteSymbol = "TOKEN";
      try { quoteSymbol = (await quoteToken.symbol()).toUpperCase(); } catch (e) {}

      if (["USDC","USDT","DAI"].includes(quoteSymbol)) {
        return { price: Number(priceInQuote), unit: "USD" };
      }
      if (["WMATIC","MATIC","WETH","ETH"].includes(quoteSymbol)) {
        return { price: Number(priceInQuote), unit: quoteSymbol };
      }
      return { price: Number(priceInQuote), unit: quoteSymbol };
    }
  } catch (err) {
    console.warn("fetchOnchainPoolPrice failed:", err);
    throw err;
  }
}

// helper to convert non-USD quote to USD using CoinGecko (used only if onchain quote is MATIC/ETH)
async function convertQuoteToUSD(amount, unitSymbol) {
  try {
    const map = { "WMATIC": "matic", "MATIC": "matic", "WETH": "weth", "ETH": "ethereum" };
    const slug = map[unitSymbol] || null;
    if (!slug) return null;
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${slug}&vs_currencies=usd`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const j = await r.json();
    const priceUsd = j[slug]?.usd;
    if (!isFinite(priceUsd)) return null;
    return Number(amount) * Number(priceUsd);
  } catch (e) {
    return null;
  }
}


async function fetchPriceFromGeckoSimple() {
  const url = `https://api.geckoterminal.com/api/v2/simple/networks/${NETWORK_SLUG}/token_price/${AUTODY_ADDRESS}`;
  const res = await fetch(url, { headers: { "Accept": "application/json" } });
  if (!res.ok) throw new Error(`Gecko simple price HTTP ${res.status}`);
  const json = await res.json();
  const priceStr = json?.data?.attributes?.token_prices?.[AUTODY_ADDRESS];
  const price = priceStr ? parseFloat(priceStr) : null;
  if (!price || !isFinite(price)) throw new Error("No valid price in simple endpoint");
  return price;
}

async function fetchPriceFromPool() {
  const url = `https://api.geckoterminal.com/api/v2/networks/${NETWORK_SLUG}/pools/${POOL_ADDRESS}`;
  const res = await fetch(url, { headers: { "Accept": "application/json" } });
  if (!res.ok) throw new Error(`Gecko pool price HTTP ${res.status}`);
  const json = await res.json();
  const attrs = json?.data?.attributes || {};
  const candidate =
    Number(attrs.base_token_price_usd) ||
    Number(attrs.quote_token_price_usd) ||
    Number(attrs.token_price_usd);
  if (!candidate || !isFinite(candidate)) throw new Error("No valid price in pool endpoint");
  return candidate;
}

async function getAutodyPriceUSD() {
  const now = Date.now();
  if (cachedPriceUSD && now - lastPriceTs < PRICE_TTL_MS) return cachedPriceUSD;

  // 1) Try on-chain pool direct read (fastest, most live)
  try {
    const onchain = await fetchOnchainPoolPrice(POOL_ADDRESS, AUTODY_ADDRESS);
    if (onchain && isFinite(onchain.price)) {
      if (onchain.unit === "USD") {
        cachedPriceUSD = onchain.price;
        lastPriceTs = now;
        return cachedPriceUSD;
      }
      // if unit is MATIC/WETH/etc convert to USD via CoinGecko
      if (["WMATIC","MATIC","WETH","ETH"].includes(onchain.unit)) {
        const conv = await convertQuoteToUSD(onchain.price, onchain.unit);
        if (conv && isFinite(conv)) {
          cachedPriceUSD = conv;
          lastPriceTs = now;
          return cachedPriceUSD;
        }
      }
      // otherwise we don't have a USD valuation for the quote token — fall back
      console.warn("Onchain returned non-USD quote:", onchain);
    }
  } catch (e) {
    console.warn("Onchain pool price failed, falling back to GT/CoinGecko:", e?.message || e);
  }

  // 2) Fallback: original approach (GeckoTerminal simple -> pool)
  try {
    const p = await fetchPriceFromGeckoSimple();
    cachedPriceUSD = p; lastPriceTs = now; return p;
  } catch (e1) {
    console.warn("Simple price failed:", e1?.message || e1);
    try {
      const p2 = await fetchPriceFromPool();
      cachedPriceUSD = p2; lastPriceTs = now; return p2;
    } catch (e2) {
      console.error("Pool price failed:", e2?.message || e2);
      return null;
    }
  }
}

/* ===== debounce helper and USD->token live update (unchanged) ===== */
let debounceTimer = null;
function debounce(fn, wait = 250) {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(fn, wait);
}

usdInput.addEventListener("input", () => {
  debounce(async () => {
    const usdRaw = (usdInput.value || "").toString().replace(/,/g, "");
    const usdValue = parseFloat(usdRaw);
    if (!isFinite(usdValue) || usdValue <= 0) {
      tokenInput.value = "";
      return;
    }
    const price = await getAutodyPriceUSD();
    if (!price) {
      tokenInput.value = "";
      tokenInput.placeholder = "Price unavailable";
      return;
    }
    const autodyAmount = usdValue / price;
    tokenInput.value = autodyAmount.toFixed(6);
  });
});

setInterval(async () => {
  const usdRaw = (usdInput.value || "").toString().replace(/,/g, "");
  const usdValue = parseFloat(usdRaw);
  if (!isFinite(usdValue) || usdValue <= 0) return;
  const price = await getAutodyPriceUSD();
  if (!price) return;
  const autodyAmount = usdValue / price;
  tokenInput.value = autodyAmount.toFixed(6);
}, PRICE_TTL_MS);

async function warmPriceCache() {
  await getAutodyPriceUSD();
}

/* -----------------------
   Small format helpers
----------------------- */
const fmtUSD  = (n, fd=0)=> (n==null||!isFinite(n)) ? "—"
  : new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:fd}).format(n);
const fmtUSDc = (n)=>fmtUSD(n,6);


/* -----------------------
   Dexscreener integration
   (proxy endpoint: /api/dex/pair?pair=<POOL_ADDRESS>)
----------------------- */
const DEX_CACHE_TTL = 30_000; // ms
let cachedDex = null, cachedDexTs = 0;

async function fetchDexPair() {
  const now = Date.now();
  if (cachedDex && (now - cachedDexTs) < DEX_CACHE_TTL) return cachedDex;

  const url = `/api/dex/pair?pair=${encodeURIComponent(POOL_ADDRESS)}`;
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' }});
    if (!res.ok) {
      const text = await res.text().catch(()=>"<no body>");
      throw new Error(`Dex proxy HTTP ${res.status} : ${text}`);
    }
    const json = await res.json();
    if (!json || !json.success) throw new Error("Invalid dex proxy response");
    cachedDex = json;
    cachedDexTs = Date.now();
    return cachedDex;
  } catch (err) {
    console.warn("[Dex] fetch failed:", err?.message || err);
    return null;
  }
}

/* -----------------------
   Elements references for the TF and KPI blocks
----------------------- */
const elTF = {
  txn:   document.getElementById("tf-txn"),
  vol:   document.getElementById("tf-vol"),
  buys:  document.getElementById("tf-buys"),
  sells: document.getElementById("tf-sells"),
};
const elKPI = {
  vol24: document.getElementById("kpi-vol24"),
  liq:   document.getElementById("kpi-liq"),
  fdv:   document.getElementById("kpi-fdv"),
  mcap:  document.getElementById("kpi-mcap"),
};

// -----------------------
// --- CHANGED ---
// Helper: derive buys/sells/vol object for a given key,
// normalize shapes, and synthesize 15m/30m from m5 when needed.
// -----------------------
function multiplyTxnsObj(obj, factor) {
  if (!obj) return null;
  const out = {};
  if (obj.buys != null) out.buys = Math.round(Number(obj.buys) * factor);
  if (obj.sells != null) out.sells = Math.round(Number(obj.sells) * factor);
  const volRaw = (obj.usd != null) ? Number(obj.usd)
                : (obj.volume_usd != null) ? Number(obj.volume_usd)
                : (obj.volume != null) ? Number(obj.volume)
                : null;
  out.volume = (volRaw != null && isFinite(volRaw)) ? (volRaw * factor) : null;
  return out;
}

function normalizeWindowObj(rawObj) {
  if (rawObj == null) return null;
  if (typeof rawObj === 'number') return { volume: rawObj };
  if (typeof rawObj === 'string') {
    const n = Number(rawObj.replace(/[^0-9.-]+/g,''));
    if (isFinite(n)) return { volume: n };
    return null;
  }
  if (typeof rawObj === 'object') {
    const o = {};
    // sometimes rawObj = { buys: N, sells: N } (counts)
    if (rawObj.buys != null) o.buys = Math.round(Number(rawObj.buys));
    if (rawObj.sells != null) o.sells = Math.round(Number(rawObj.sells));
    // sometimes rawObj contains USD numbers under usd / volume_usd / volume
    if (rawObj.usd != null && isFinite(Number(rawObj.usd))) o.volume = Number(rawObj.usd);
    else if (rawObj.volume_usd != null && isFinite(Number(rawObj.volume_usd))) o.volume = Number(rawObj.volume_usd);
    else if (rawObj.volume != null && isFinite(Number(rawObj.volume))) o.volume = Number(rawObj.volume);
    // sometimes rawObj contains buysUsd/sellsUsd fields:
    if (rawObj.buys_usd != null && isFinite(Number(rawObj.buys_usd))) o.buysUsd = Number(rawObj.buys_usd);
    if (rawObj.sells_usd != null && isFinite(Number(rawObj.sells_usd))) o.sellsUsd = Number(rawObj.sells_usd);
    // some shapes: s.buys[k] may be a number (USD) — caller should handle
    if (rawObj.usd_buys != null && isFinite(Number(rawObj.usd_buys))) o.buysUsd = Number(rawObj.usd_buys);
    if (rawObj.usd_sells != null && isFinite(Number(rawObj.usd_sells))) o.sellsUsd = Number(rawObj.usd_sells);
    return o;
  }
  return null;
}

function normalizePctValue(raw) {
  if (raw == null) return null;

  const n = Number(raw);
  if (!isFinite(n)) return null;
  return n;
}

// --- CHANGED END ---



// -----------------------
// --- CHANGED ---
// updateKpis() rewritten to avoid blanking UI while fetching,
// and to use FDV as a fallback for Market Cap.
// -----------------------
async function updateKpis() {
  try {
    // show loading placeholders (non-destructive)
    if (elKPI.vol24) elKPI.vol24.textContent = "Loading…";
    if (elKPI.liq)   elKPI.liq.textContent   = "Loading…";
    if (elKPI.fdv)   elKPI.fdv.textContent   = "Loading…";
    if (elKPI.mcap)  elKPI.mcap.textContent  = "Loading…";

    const dex = await fetchDexPair();
    if (!dex) {
      // leave current UI intact if fetch fails
      if (elKPI.vol24) elKPI.vol24.textContent = elKPI.vol24.textContent || "—";
      if (elKPI.liq)   elKPI.liq.textContent   = elKPI.liq.textContent || "—";
      if (elKPI.fdv)   elKPI.fdv.textContent   = elKPI.fdv.textContent || "—";
      if (elKPI.mcap)  elKPI.mcap.textContent  = elKPI.mcap.textContent || "—";
      return;
    }

    const s = dex.summary || {};
    const raw = dex.raw?.pair || dex.raw?.pairs?.[0] || {};

    // prefer summary fields, fall back to raw if needed
    const finalVol24 = (s.volume && (s.volume['24h'] ?? s.volume['24H'] ?? s.volume.h24)) 
                        ?? raw?.volume?.h24 ?? raw?.volume?.['24h'] ?? null;
    const finalLiq   = s.liquidityUsd ?? raw?.liquidity?.usd ?? raw?.liquidityUsd ?? null;
    const finalFDV   = s.fdv ?? raw?.fdv ?? raw?.pair?.fdv ?? null;
    const finalMarketCap = raw?.marketCap ?? raw?.market_cap ?? s.marketCap ?? null;
    const finalPrice = raw?.priceUsd ?? s.priceUsd ?? null;

    if (elKPI.vol24) elKPI.vol24.textContent = finalVol24 ? fmtUSD(finalVol24,0) : (elKPI.vol24.textContent || "—");
    if (elKPI.liq)   elKPI.liq.textContent   = finalLiq   ? fmtUSD(finalLiq,0)   : (elKPI.liq.textContent || "—");
    if (elKPI.fdv)   elKPI.fdv.textContent   = finalFDV   ? fmtUSD(finalFDV,0)   : (elKPI.fdv.textContent || "—");

    // Market cap fallback: raw market cap -> FDV -> keep existing
    const mcapVal = (isFinite(Number(finalMarketCap)) ? Number(finalMarketCap) : (isFinite(Number(finalFDV)) ? Number(finalFDV) : null));
    if (elKPI.mcap) elKPI.mcap.textContent = mcapVal ? fmtUSD(mcapVal,0) : (elKPI.mcap.textContent || "—");

    // update price element if available
    const priceEl = document.getElementById("kpi-price");
    if (priceEl) priceEl.textContent = finalPrice ? Number(finalPrice).toFixed(6) : (priceEl.textContent || "—");

    // price-change percent
    const pctEl = document.getElementById("pct-h24");
    const pcpCandidate = raw?.priceChange ?? raw?.price_change ?? raw?.priceChangePercent ?? raw?.price_change_percent ?? s.priceChange ?? null;
    const pctVal = normalizePctValue(pcpCandidate?.h24 ?? pcpCandidate?.['24h'] ?? pcpCandidate);
    if (pctEl) {
      if (pctVal != null) {
        const n = pctVal;
        const sign = n > 0 ? "+" : (n < 0 ? "" : "");
        pctEl.textContent = `${sign}${n.toFixed(2)}%`;
        pctEl.classList.toggle("pct-pos", n > 0);
        pctEl.classList.toggle("pct-neg", n < 0);
      } else {
        pctEl.textContent = pctEl.textContent || "0%";
        pctEl.classList.remove("pct-pos","pct-neg");
      }
    }
  } catch (err) {
    console.error("[updateKpis] fatal error:", err);
    // keep current UI intact on error
    if (elKPI.vol24) elKPI.vol24.textContent = elKPI.vol24.textContent || "—";
    if (elKPI.liq)   elKPI.liq.textContent   = elKPI.liq.textContent || "—";
    if (elKPI.fdv)   elKPI.fdv.textContent   = elKPI.fdv.textContent || "—";
    if (elKPI.mcap)  elKPI.mcap.textContent  = elKPI.mcap.textContent || "—";
  }
}
// --- CHANGED END ---

// -----------------------
// --- CHANGED ---
// updateTimeframe: show buys/sells as plain counts, net = buys - sells,
// volume as USD, compute 15m/30m from m5 properly.
// -----------------------
async function updateTimeframe(winKey){
  try {
    const map = {
      "m5": ['5m','m5'],
      "h1": ['1h','h1'],
      "h6": ['6h','h6'],
      "h24": ['24h','h24']
    };
    const canonical = {
      "5m":"m5","m5":"m5","M5":"m5",
      "1h":"h1","h1":"h1","H1":"h1",
      "6h":"h6","h6":"h6","H6":"h6",
      "24h":"h24","h24":"h24","H24":"h24"
    }[winKey] || winKey;
    const candidates = map[canonical] || map['h24'];

    const dex = await fetchDexPair();
    if (!dex) {
      // keep UI intact
      return;
    }

    const s = dex.summary || {};
    const raw = dex.raw?.pair || dex.raw?.pairs?.[0] || {};

    // helper: try to build a stats object for a window key
    function getWindowObj(k) {
      if (!k) return null;

      // Summary-level fields (preferred)
      // summary might contain: s.buys[k] (USD), s.sells[k] (USD), s.txns[k] (number), s.volume[k] (USD)
      if (s) {
        // case: buys/sells summary with USD amounts
        if (s.buys && s.buys[k] != null) {
          const buysUsd = (typeof s.buys[k] === 'object' && s.buys[k].usd!=null) ? Number(s.buys[k].usd) : Number(s.buys[k]);
          const sellsUsd = (s.sells && s.sells[k] != null) ? ((typeof s.sells[k] === 'object' && s.sells[k].usd!=null) ? Number(s.sells[k].usd) : Number(s.sells[k])) : null;
          const vol = (s.volume && s.volume[k] != null) ? (typeof s.volume[k] === 'object' ? Number(s.volume[k].usd ?? s.volume[k].volume_usd ?? s.volume[k].volume ?? 0) : Number(s.volume[k])) : null;
          const txns = (s.txns && s.txns[k] != null) ? s.txns[k] : null;
          const out = {};
          if (isFinite(buysUsd)) out.buysUsd = buysUsd;
          if (isFinite(sellsUsd)) out.sellsUsd = sellsUsd;
          if (isFinite(vol)) out.volume = vol;
          if (isFinite(Number(txns))) out.txnCount = Number(txns);
          return out;
        }
        // case: s.txns[k] exists and may be a number or object with buys/sells counts
        if (s.txns && s.txns[k] != null) {
          const v = s.txns[k];
          if (typeof v === 'number') return { txnCount: v };
          if (typeof v === 'object') {
            // try to extract counts
            const out = {};
            if (v.buys != null) out.buys = Math.round(Number(v.buys));
            if (v.sells != null) out.sells = Math.round(Number(v.sells));
            // maybe they include usd fields
            if (v.buys_usd != null && isFinite(Number(v.buys_usd))) out.buysUsd = Number(v.buys_usd);
            if (v.sells_usd != null && isFinite(Number(v.sells_usd))) out.sellsUsd = Number(v.sells_usd);
            if (v.volume_usd != null && isFinite(Number(v.volume_usd))) out.volume = Number(v.volume_usd);
            return out;
          }
        }
        // case: s.volume contains usd directly
        if (s.volume && s.volume[k] != null) {
          const volVal = s.volume[k];
          if (typeof volVal === 'number') return { volume: volVal };
          if (typeof volVal === 'object' && volVal.usd != null) return { volume: Number(volVal.usd) };
          if (typeof volVal === 'string') {
            const n = Number(volVal.replace(/[^0-9.-]+/g,'')); if (isFinite(n)) return { volume: n };
          }
        }
      }

      // raw-level fallbacks
      if (raw) {
        // raw.txns[k] often contains { buys: N, sells: N, buys_usd?, sells_usd? }
        if (raw.txns && raw.txns[k] != null) {
          const v = raw.txns[k];
          const normalized = normalizeWindowObj(v);
          // normalized may include buys/sells counts and buysUsd/sellsUsd/volume
          return normalized;
        }
        // raw.volume[k] often contains { usd: N } or number
        if (raw.volume && raw.volume[k] != null) {
          const v = raw.volume[k];
          if (typeof v === 'number') return { volume: v };
          if (typeof v === 'object' && v.usd != null) return { volume: Number(v.usd) };
          if (typeof v === 'string') {
            const n = Number(v.replace(/[^0-9.-]+/g,'')); if (isFinite(n)) return { volume: n };
          }
        }
        // sometimes raw.priceChange or raw.stats
        if (raw.stats && raw.stats[k]) {
          const norm = normalizeWindowObj(raw.stats[k]);
          if (norm) return norm;
        }
      }

      return null;
    }

    // Primary try
    let windowObj = getWindowObj(candidates[0]) || getWindowObj(candidates[1]);


    // If still missing, try other fallbacks
    if (!windowObj) {
      windowObj = getWindowObj('1h') || getWindowObj('h1') || getWindowObj('6h') || getWindowObj('h6') || getWindowObj('24h') || getWindowObj('h24');
    }

    if (!windowObj) {
      // nothing reliable — keep UI unchanged
      return;
    }

    // Extract counts and USD values:
    const buysCount = (windowObj.buys != null && isFinite(Number(windowObj.buys))) ? Math.round(Number(windowObj.buys)) : null;
    const sellsCount = (windowObj.sells != null && isFinite(Number(windowObj.sells))) ? Math.round(Number(windowObj.sells)) : null;
    // try find buysUsd/sellsUsd from several possible locations
    let buysUsd = null, sellsUsd = null;
    if (windowObj.buysUsd != null && isFinite(Number(windowObj.buysUsd))) buysUsd = Number(windowObj.buysUsd);
    if (windowObj.sellsUsd != null && isFinite(Number(windowObj.sellsUsd))) sellsUsd = Number(windowObj.sellsUsd);

    // some sources use s.buys[k] as USD directly (we handled above) or raw shapes — attempt to pick from summary as fallback
    if (buysUsd == null && s && s.buys && s.buys[candidates[0]] != null) {
      const v = s.buys[candidates[0]]; buysUsd = (typeof v === 'object' && v.usd!=null) ? Number(v.usd) : (isFinite(Number(v)) ? Number(v) : null);
    }
    if (sellsUsd == null && s && s.sells && s.sells[candidates[0]] != null) {
      const v = s.sells[candidates[0]]; sellsUsd = (typeof v === 'object' && v.usd!=null) ? Number(v.usd) : (isFinite(Number(v)) ? Number(v) : null);
    }

    // volume
    let volUsd = null;
    if (windowObj.volume != null && isFinite(Number(windowObj.volume))) volUsd = Number(windowObj.volume);
    // fallback to summary
    if (volUsd == null && s && s.volume && (s.volume[candidates[0]] != null)) {
      const v = s.volume[candidates[0]];
      volUsd = (typeof v === 'object' && v.usd!=null) ? Number(v.usd) : (isFinite(Number(v)) ? Number(v) : null);
    }
    if (volUsd == null && raw && raw.volume && raw.volume[candidates[0]] != null) {
      const v = raw.volume[candidates[0]];
      volUsd = (typeof v === 'object' && v.usd!=null) ? Number(v.usd) : (isFinite(Number(v)) ? Number(v) : null);
    }

    // txn count: prefer explicit txnCount, else sum buys/sells counts
    let txnCount = null;
    if (windowObj.txnCount != null && isFinite(Number(windowObj.txnCount))) txnCount = Number(windowObj.txnCount);
    if (txnCount == null && (buysCount != null || sellsCount != null)) txnCount = (buysCount||0) + (sellsCount||0);


    // write to DOM:
    if (elTF.txn)   elTF.txn.textContent   = (txnCount != null) ? txnCount.toString() : (elTF.txn.textContent || "—");
    if (elTF.vol)   elTF.vol.textContent   = (volUsd != null) ? fmtUSD(volUsd,0) : (elTF.vol.textContent || "—");
    if (elTF.buys)  elTF.buys.textContent  = (buysCount != null) ? buysCount.toString() : (elTF.buys.textContent || "—");
    if (elTF.sells) elTF.sells.textContent = (sellsCount != null) ? sellsCount.toString() : (elTF.sells.textContent || "—");

  } catch (e) {
    console.error("updateTimeframe failed:", e);
    // keep UI unchanged on errors
  }
}
// --- CHANGED END ---

/* -----------------------
   Tabs wiring (keeps original behavior, but now uses Dexscreener functions)
----------------------- */
function wireTabs(){
  const tabs = document.querySelectorAll("#gt-tabs .gt-tab");
  let current = "h24"; // default requested (use h24 key matching updateTimeframe mapping)

  const setActive = (key)=>{
    tabs.forEach(b=>b.classList.toggle("active", b.dataset.win===key));
  };

  tabs.forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const key = btn.dataset.win;
      current = key;
      setActive(current);
      updateTimeframe(current);
    });
  });

  // first paint
  setActive(current);
  updateTimeframe(current);
  updateKpis();

  // refresh every minute
  setInterval(()=>updateTimeframe(current), 60_000);
  setInterval(updateKpis, 60_000);
}

document.addEventListener("DOMContentLoaded", wireTabs);

/* -----------------------
   Enhanced tabs/menu (15m/30m in menu) — uses updateTimeframe()
----------------------- */
const WIN_DEFS = {
  m5:  { mins: 5,   pctKey: "m5",  label: "5M"  },
  h1:  { mins: 60,  pctKey: "h1",  label: "1H"  },
  h6:  { mins: 360, pctKey: "h6",  label: "6H"  },
  h24: { mins: 1440,pctKey: "h24", label: "24H" },
};

// -----------------------
// --- CHANGED ---
// updateTabPercents: normalize percent values (handle fraction or percent input)
// -----------------------
async function updateTabPercents(){
  try {
    const dex = await fetchDexPair();
    const raw = dex?.raw?.pair || dex?.raw?.pairs?.[0] || null;
    const pcp = raw?.priceChange || raw?.price_change || raw?.priceChangePercent || raw?.price_change_percent || raw?.price_changes || raw?.price_change || {};
    const pickRaw = (obj, key) => {
      if (!obj) return null;
      if (obj[key] != null) return obj[key];
      if (obj[key.toLowerCase()] != null) return obj[key.toLowerCase()];
      if (obj[key.toUpperCase()] != null) return obj[key.toUpperCase()];
      return null;
    };

    const setPctEl = (id, rawVal) => {
      const el = document.getElementById(id);
      if (!el) return;
      const n = normalizePctValue(rawVal);
      if (n == null || !isFinite(n)) {
        if (!el.textContent) el.textContent = "0%";
        el.classList.remove("pct-pos","pct-neg");
        return;
      }
      const sign = n > 0 ? "+" : (n < 0 ? "" : "");
      el.textContent = `${sign}${n.toFixed(2)}%`;
      el.classList.toggle("pct-pos", n > 0);
      el.classList.toggle("pct-neg", n < 0);
    };

    setPctEl("pct-m5",  pickRaw(pcp,'m5')  ?? pickRaw(raw,'m5') ?? pickRaw(raw,'5m'));
    setPctEl("pct-h1",  pickRaw(pcp,'h1')  ?? pickRaw(raw,'h1') ?? pickRaw(raw,'1h'));
    setPctEl("pct-h6",  pickRaw(pcp,'h6')  ?? pickRaw(raw,'h6') ?? pickRaw(raw,'6h'));
    setPctEl("pct-h24", pickRaw(pcp,'h24') ?? pickRaw(raw,'h24') ?? pickRaw(raw,'24h'));
  } catch (e){
    console.warn("updateTabPercents failed:", e);
  }
}
// --- CHANGED END ---


// Label helpers for Txn/Vol headings
const lblTxn = document.getElementById("lbl-txn");
const lblVol = document.getElementById("lbl-vol");

function setWindowLabels(key){
  const def = WIN_DEFS[key] || WIN_DEFS.h24;
  if (lblTxn) lblTxn.textContent = `${def.label} Txn`;
  if (lblVol) lblVol.textContent = `${def.label} Vol`;
}

// Wire the tabs + menu
function wireEnhancedTabs(){
  const tabsRow   = document.getElementById("gt-tabs");
  if (!tabsRow) return;

  const menuBtn   = document.getElementById("gt-more-btn");
  const menu      = document.getElementById("gt-more-menu");
  let currentKey  = "h24";

  // open/close menu
  if (menuBtn && menu){
    menuBtn.addEventListener("click", (e)=>{
      e.stopPropagation();
      menu.style.display = (menu.style.display === "none" || !menu.style.display) ? "block" : "none";
    });
    document.addEventListener("click", (e)=>{
      if (!menu.contains(e.target) && e.target !== menuBtn) menu.style.display = "none";
    });
  }

  function setActive(key){
    document.querySelectorAll("#gt-tabs .gt-tab").forEach(btn=>{
      if (btn.dataset?.win) btn.classList.toggle("active", btn.dataset.win === key);
    });
  }

  async function onSelect(key){
    currentKey = key;
    const def = WIN_DEFS[key] || WIN_DEFS.h24;
    setActive(key);
    setWindowLabels(key);
    // Use Dexscreener-based timeframe rendering
    try {
      await updateTimeframe(key);
    } catch (e){
      console.warn("trade agg failed:", e);
    }
  }

  // Clicks for visible tabs
  tabsRow.querySelectorAll(".gt-tab[data-win]").forEach(btn=>{
    btn.addEventListener("click", ()=> onSelect(btn.dataset.win));
  });
  // Clicks inside menu
  menu?.querySelectorAll(".gt-menu-item[data-win]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      onSelect(btn.dataset.win);
      menu.style.display = "none";
    });
  });

  // initial paint + periodic refresh
  setActive(currentKey);
  setWindowLabels(currentKey);
  onSelect(currentKey);
  updateTabPercents();
  setInterval(()=>onSelect(currentKey), 60_000);
  setInterval(updateTabPercents, 60_000);
}

// boot enhanced tabs
document.addEventListener("DOMContentLoaded", wireEnhancedTabs);

