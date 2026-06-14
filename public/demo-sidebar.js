const DEMO_SIDEBAR_REFRESH_MS = 10000;

const demoSidebarMoney = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0
});

function updateDemoSidebarBalance(wallet = {}) {
  const cash = Number(wallet.cashBalance);
  if (!Number.isFinite(cash)) return;
  const value = `${demoSidebarMoney.format(cash)} USD`;
  document.querySelectorAll(".sidebar-profile strong").forEach((node) => {
    node.textContent = value;
  });
}

async function loadDemoSidebarBalance() {
  try {
    const response = await fetch("/api/demo/wallet", { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json();
    if (data?.success && data.wallet) updateDemoSidebarBalance(data.wallet);
  } catch (err) {
    console.warn("Demo sidebar balance failed:", err);
  }
}

function refreshDemoSidebarWhenVisible() {
  if (document.hidden) return;
  loadDemoSidebarBalance();
}

loadDemoSidebarBalance();
setInterval(refreshDemoSidebarWhenVisible, DEMO_SIDEBAR_REFRESH_MS);
window.addEventListener("focus", refreshDemoSidebarWhenVisible);
document.addEventListener("visibilitychange", refreshDemoSidebarWhenVisible);
