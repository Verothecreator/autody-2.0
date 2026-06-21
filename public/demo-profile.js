const profileMoney = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2
});

const profileWholeMoney = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0
});

const isLiveProfile = document.body?.dataset?.profileMode === "live" || location.pathname.endsWith("account-profile.html");
const profileModeLabel = isLiveProfile ? "Live account" : "Demo trading";
const profileWalletEndpoint = isLiveProfile ? "/api/account/wallet" : "/api/demo/wallet";
const profileOrdersEndpoint = isLiveProfile ? "/api/account/orders" : "/api/demo/orders";
const profileWatchlistEndpoint = isLiveProfile ? "/api/account/watchlist" : "/api/demo/watchlist";

function formatProfileMoney(value, whole = false) {
  const number = Number(value);
  if (!Number.isFinite(number)) return whole ? "$0" : "$0.00";
  return whole ? profileWholeMoney.format(number) : profileMoney.format(number);
}

function formatProfileMove(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "+0.00%";
  const sign = number > 0 ? "+" : "";
  return `${sign}${number.toFixed(2)}%`;
}

function profileTone(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number === 0) return "flat";
  return number > 0 ? "gain" : "loss";
}

function formatProfileDate(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "Not available";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

async function getProfileJson(url) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: window.AutodyAuth?.headers?.() || {}
  });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

function setProfileText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = value;
}

function titleFromEmail(email = "") {
  const local = String(email || "").split("@")[0] || "";
  return local
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .trim();
}

function profileDisplayName(user = {}) {
  const profile = user.profile || {};
  const fullName = `${profile.firstName || ""} ${profile.lastName || ""}`.trim();
  const candidates = [
    fullName,
    profile.legalName,
    user.displayName,
    user.name,
    titleFromEmail(user.email),
    "Autody account"
  ];
  return candidates.find((name) => name && String(name).trim().toLowerCase() !== "vero demo") || "Autody account";
}

function readableStatus(value = "") {
  const text = String(value || "pending").replace(/[_-]+/g, " ");
  return text.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function countWatchlistAssets(watchlist = {}) {
  return ["crypto", "stocks", "etfs", "commodities"]
    .reduce((sum, key) => sum + (Array.isArray(watchlist[key]) ? watchlist[key].length : 0), 0);
}

async function loadProfilePage() {
  try {
    const [walletData, ordersData, watchlistData, dbData] = await Promise.all([
      getProfileJson(profileWalletEndpoint),
      getProfileJson(profileOrdersEndpoint).catch(() => ({ orders: [] })),
      getProfileJson(profileWatchlistEndpoint).catch(() => ({ watchlist: {} })),
      getProfileJson("/api/db/status").catch(() => ({ configured: false, provider: "local" }))
    ]);
    const wallet = walletData.wallet || {};
    const user = walletData.user || {};
    const profile = user.profile || {};
    const verification = user.verification || {};
    const starting = Number(wallet.startingBalance || user.startingBalance || (isLiveProfile ? 0 : 50000));
    const total = Number(wallet.totalValue || starting);
    const profitLoss = total - starting;
    const profitLossPct = starting > 0 ? (profitLoss / starting) * 100 : 0;
    const tone = profileTone(profitLoss);
    const orderCount = Array.isArray(ordersData.orders) ? ordersData.orders.length : 0;
    const watchlistCount = countWatchlistAssets(watchlistData.watchlist || {});
    const accountEmail = user.email || "Not available";
    const legalName = profile.legalName || profileDisplayName(user);
    const country = profile.country || "Not available";
    const emailStatus = readableStatus(verification.email);
    const phoneStatus = readableStatus(verification.phone);
    const identityStatus = readableStatus(verification.identity);

    setProfileText("profile-status", walletData.source || (isLiveProfile ? "Live ready" : "Demo active"));
    setProfileText("profile-name", profileDisplayName(user));
    setProfileText("profile-email", accountEmail);
    setProfileText("profile-detail-email", accountEmail);
    setProfileText("profile-legal-name", legalName);
    setProfileText("profile-country", country);
    setProfileText("profile-mode-badge", profileModeLabel);
    setProfileText("profile-verification-badge", `Email ${emailStatus}`);
    setProfileText("profile-cash", formatProfileMoney(wallet.cashBalance, true));
    setProfileText("profile-total", formatProfileMoney(total, true));
    setProfileText("profile-positions", String(wallet.positionsCount || 0));
    setProfileText("profile-profit-loss", formatProfileMoney(profitLoss));
    const profitLossNode = document.getElementById("profile-profit-loss");
    if (profitLossNode) profitLossNode.className = tone;
    setProfileText("profile-return", `${formatProfileMove(profitLossPct)} total return`);
    setProfileText("profile-currency", wallet.currency || user.currency || "USD");
    setProfileText("profile-created", formatProfileDate(user.createdAt));
    setProfileText("profile-email-status", emailStatus);
    setProfileText("profile-phone-status", phoneStatus);
    setProfileText("profile-identity-status", identityStatus);
    setProfileText("profile-source", dbData.configured ? dbData.provider || "Supabase Postgres" : "Local fallback");
    setProfileText("profile-order-count", `${orderCount} ${orderCount === 1 ? "order" : "orders"}`);
    setProfileText("profile-watchlist-count", `${watchlistCount} saved`);

    if (isLiveProfile) {
      const balanceText = `${profileWholeMoney.format(Number(wallet.cashBalance || 0))} USD`;
      document.querySelectorAll("[data-live-balance]").forEach((node) => {
        node.textContent = balanceText;
      });
    }
  } catch (err) {
    console.warn("Profile page failed:", err);
    setProfileText("profile-status", "Warming up");
  }
}

loadProfilePage();
