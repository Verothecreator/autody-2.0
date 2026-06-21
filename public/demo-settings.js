const settingsMoney = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0
});

function settingsText(value, fallback = "On") {
  if (typeof value === "boolean") return value ? "On" : "Off";
  return value || fallback;
}

async function getSettingsJson(url) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: window.AutodyAuth?.headers?.() || {}
  });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

async function loadSettingsPage() {
  try {
    const [walletData, settingsData, dbData] = await Promise.all([
      getSettingsJson("/api/demo/wallet"),
      getSettingsJson("/api/demo/settings").catch(() => ({ settings: {} })),
      getSettingsJson("/api/db/status").catch(() => ({ configured: false, provider: "local" }))
    ]);
    const wallet = walletData.wallet || {};
    const user = walletData.user || {};
    const settings = settingsData.settings || {};

    document.getElementById("settings-status").textContent = "Demo active";
    document.getElementById("settings-current-mode").textContent = settings.defaultMode === "live" ? "Live account" : "Demo trading";
    document.getElementById("settings-buying-power").textContent = `${settingsMoney.format(Number(wallet.cashBalance || user.cashBalance || 0))} USD`;
    document.getElementById("settings-order-confirmation").textContent = settingsText(settings.orderConfirmation);
    document.getElementById("settings-risk-level").textContent = settings.riskLevel || "Practice";
    document.getElementById("settings-market-alerts").textContent = settingsText(settings.marketAlerts);
    document.getElementById("settings-news-alerts").textContent = settingsText(settings.newsAlerts);
    document.getElementById("settings-currency").textContent = settings.currency || wallet.currency || user.currency || "USD";
    document.getElementById("settings-email").textContent = user.email || "ontold7@gmail.com";
    document.getElementById("settings-database").textContent = dbData.configured ? dbData.provider || "Supabase Postgres" : "Local fallback";
  } catch (err) {
    console.warn("Settings page failed:", err);
    document.getElementById("settings-status").textContent = "Warming up";
  }
}

loadSettingsPage();
