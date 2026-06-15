const DEMO_SIDEBAR_REFRESH_MS = 10000;

const demoSidebarMoney = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0
});

function sidebarIconMarkup(href, label, icon, active = false) {
  return `
    <a href="${href}" class="sidebar-icon-link ${active ? "active" : ""}" title="${label}" aria-label="${label}">
      ${icon}
    </a>
  `;
}

function ensureDemoSidebarTools() {
  const sidebar = document.querySelector(".app-sidebar");
  const profileCard = sidebar?.querySelector(".sidebar-profile");
  if (!sidebar || !profileCard || sidebar.querySelector(".sidebar-icon-row")) return;

  sidebar.querySelector('.app-nav a[href="demo-settings.html"]')?.remove();

  const page = location.pathname.split("/").pop() || "";
  const profileIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="7" r="4"/></svg>`;
  const settingsIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.36 1.1V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.36H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .36-1.1V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 .6 1 1.7 1.7 0 0 0 1.1.36H21a2 2 0 1 1 0 4h-.09A1.7 1.7 0 0 0 19.4 15Z"/></svg>`;
  const tools = document.createElement("div");
  tools.className = "sidebar-icon-row";
  tools.setAttribute("aria-label", "Account tools");
  tools.innerHTML = [
    sidebarIconMarkup("demo-profile.html", "Profile", profileIcon, page === "demo-profile.html"),
    sidebarIconMarkup("demo-settings.html", "Settings", settingsIcon, page === "demo-settings.html")
  ].join("");
  profileCard.insertAdjacentElement("afterend", tools);
}

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

document.addEventListener("click", (event) => {
  const signOut = event.target.closest("[data-demo-sign-out]");
  if (!signOut) return;
  event.preventDefault();
  localStorage.removeItem("autodyDemoSession");
  window.location.href = signOut.getAttribute("href") || "sign-in.html";
});

ensureDemoSidebarTools();
loadDemoSidebarBalance();
setInterval(refreshDemoSidebarWhenVisible, DEMO_SIDEBAR_REFRESH_MS);
window.addEventListener("focus", refreshDemoSidebarWhenVisible);
document.addEventListener("visibilitychange", refreshDemoSidebarWhenVisible);
