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
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

async function loadProfilePage() {
  try {
    const [walletData, dbData] = await Promise.all([
      getProfileJson("/api/demo/wallet"),
      getProfileJson("/api/db/status").catch(() => ({ configured: false, provider: "local" }))
    ]);
    const wallet = walletData.wallet || {};
    const user = walletData.user || {};
    const starting = Number(wallet.startingBalance || user.startingBalance || 50000);
    const total = Number(wallet.totalValue || starting);
    const profitLoss = total - starting;
    const profitLossPct = starting > 0 ? (profitLoss / starting) * 100 : 0;
    const tone = profileTone(profitLoss);

    document.getElementById("profile-status").textContent = walletData.source || "Demo active";
    document.getElementById("profile-name").textContent = user.name || "Vero Demo";
    document.getElementById("profile-email").textContent = user.email || "ontold7@gmail.com";
    document.getElementById("profile-detail-email").textContent = user.email || "ontold7@gmail.com";
    document.getElementById("profile-cash").textContent = formatProfileMoney(wallet.cashBalance, true);
    document.getElementById("profile-total").textContent = formatProfileMoney(total, true);
    document.getElementById("profile-positions").textContent = String(wallet.positionsCount || 0);
    document.getElementById("profile-profit-loss").textContent = formatProfileMoney(profitLoss);
    document.getElementById("profile-profit-loss").className = tone;
    document.getElementById("profile-return").textContent = `${formatProfileMove(profitLossPct)} total return`;
    document.getElementById("profile-currency").textContent = wallet.currency || user.currency || "USD";
    document.getElementById("profile-created").textContent = formatProfileDate(user.createdAt);
    document.getElementById("profile-source").textContent = dbData.configured ? dbData.provider || "Supabase Postgres" : "Local fallback";
  } catch (err) {
    console.warn("Profile page failed:", err);
    document.getElementById("profile-status").textContent = "Warming up";
  }
}

loadProfilePage();
