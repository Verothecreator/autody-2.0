const DEMO_SIDEBAR_REFRESH_MS = 10000;
const DEMO_SIDEBAR_COLLAPSED_KEY = "autodyDemoSidebarCollapsed";

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

const demoNavIcons = {
  Overview: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 13h6V4H4v9Z"/><path d="M14 20h6V4h-6v16Z"/><path d="M4 20h6v-3H4v3Z"/></svg>`,
  Wallet: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H19a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H6.5A2.5 2.5 0 0 1 4 16.5v-9Z"/><path d="M16 12h4"/><path d="M7 5v14"/></svg>`,
  Markets: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 17 9 12l4 4 7-9"/><path d="M14 7h6v6"/></svg>`,
  Orders: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h10v16l-2-1.2-2 1.2-2-1.2-2 1.2-2-1.2V4Z"/><path d="M9 8h6"/><path d="M9 12h6"/><path d="M9 16h4"/></svg>`,
  Watchlist: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z"/></svg>`,
  Research: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 5 5"/><path d="M8 11h5"/><path d="M10.5 8.5v5"/></svg>`
};

const demoActionIcons = {
  "Live Account": `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H4V5Z"/><path d="M8 20h8"/><path d="M12 16v4"/><path d="m9 11 2 2 4-5"/></svg>`,
  "Open Demo": `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14v16H5V4Z"/><path d="M9 9h6"/><path d="M9 13h4"/><path d="m14 16 3 2-3 2v-4Z"/></svg>`,
  "Sign Out": `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 6H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h4"/><path d="M14 16l4-4-4-4"/><path d="M18 12H9"/></svg>`
};

function getSidebarCollapsedPreference() {
  try {
    return localStorage.getItem(DEMO_SIDEBAR_COLLAPSED_KEY) === "true";
  } catch (err) {
    return false;
  }
}

function saveSidebarCollapsedPreference(collapsed) {
  try {
    localStorage.setItem(DEMO_SIDEBAR_COLLAPSED_KEY, collapsed ? "true" : "false");
  } catch (err) {
    // Storage can be blocked in private browsing; the control still works for the current page.
  }
}

function setSidebarCollapsed(collapsed) {
  const layout = document.querySelector(".app-layout");
  if (!layout) return;

  layout.classList.toggle("sidebar-collapsed", collapsed);
  const toggle = document.querySelector("[data-sidebar-toggle]");
  if (!toggle) return;

  toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
  toggle.setAttribute("aria-label", collapsed ? "Expand sidebar" : "Collapse sidebar");
  toggle.setAttribute("title", collapsed ? "Expand sidebar" : "Collapse sidebar");
  toggle.innerHTML = `<span aria-hidden="true">${collapsed ? "&rsaquo;&rsaquo;" : "&lsaquo;&lsaquo;"}</span>`;
}

function prepareDemoNavLabels(sidebar) {
  sidebar.querySelectorAll(".app-nav a").forEach((link) => {
    const label = link.textContent.trim();
    if (!label) return;
    link.dataset.short = label.slice(0, 1).toUpperCase();
    link.setAttribute("title", label);
    if (link.dataset.sidebarDecorated === "true") return;
    link.dataset.sidebarDecorated = "true";
    link.innerHTML = `
      <span class="app-nav-icon">${demoNavIcons[label] || demoNavIcons.Overview}</span>
      <span class="app-nav-label">${label}</span>
    `;
  });
}

function prepareDemoActionLabels(sidebar) {
  sidebar.querySelectorAll(".sidebar-actions a").forEach((link) => {
    const label = link.textContent.trim();
    if (!label) return;
    link.setAttribute("title", label);
    link.setAttribute("aria-label", label);
    if (link.dataset.sidebarActionDecorated === "true") return;
    link.dataset.sidebarActionDecorated = "true";
    link.innerHTML = `
      <span class="sidebar-action-icon">${demoActionIcons[label] || demoActionIcons["Live Account"]}</span>
      <span class="sidebar-action-label">${label}</span>
    `;
  });
}

function ensureDemoSidebarTools() {
  const sidebar = document.querySelector(".app-sidebar");
  if (!sidebar) return;

  sidebar.querySelector('.app-nav a[href="demo-settings.html"]')?.remove();
  prepareDemoNavLabels(sidebar);
  prepareDemoActionLabels(sidebar);

  if (sidebar.querySelector(".sidebar-header")) {
    setSidebarCollapsed(getSidebarCollapsedPreference());
    return;
  }

  const page = location.pathname.split("/").pop() || "";
  const isLivePage = page === "account.html" || page.startsWith("account-");
  const profileHref = isLivePage ? "account-profile.html" : "demo-profile.html";
  const profileActive = page === "account-profile.html" || page === "demo-profile.html";
  const profileIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="7" r="4"/></svg>`;
  const settingsIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.36 1.1V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.36H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .36-1.1V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 .6 1 1.7 1.7 0 0 0 1.1.36H21a2 2 0 1 1 0 4h-.09A1.7 1.7 0 0 0 19.4 15Z"/></svg>`;
  const brand = sidebar.querySelector(".app-brand");
  if (!brand) return;

  const header = document.createElement("div");
  header.className = "sidebar-header";

  const tools = document.createElement("div");
  tools.className = "sidebar-top-actions";
  tools.setAttribute("aria-label", "Account tools");
  tools.innerHTML = `
    <div class="sidebar-icon-row">
      ${sidebarIconMarkup(profileHref, "Profile", profileIcon, profileActive)}
    </div>
    <button type="button" class="sidebar-collapse-toggle" data-sidebar-toggle aria-label="Collapse sidebar" aria-expanded="true" title="Collapse sidebar">
      <span aria-hidden="true">&lsaquo;&lsaquo;</span>
    </button>
  `;

  brand.insertAdjacentElement("beforebegin", header);
  header.append(brand, tools);

  const actions = sidebar.querySelector(".sidebar-actions");
  if (actions && !sidebar.querySelector(".sidebar-bottom-tools")) {
    const bottomTools = document.createElement("div");
    bottomTools.className = "sidebar-bottom-tools";
    bottomTools.setAttribute("aria-label", "Settings");
    bottomTools.innerHTML = sidebarIconMarkup("demo-settings.html", "Settings", settingsIcon, page === "demo-settings.html");
    actions.insertAdjacentElement("beforebegin", bottomTools);
  }

  setSidebarCollapsed(getSidebarCollapsedPreference());
}

function updateDemoSidebarBalance(wallet = {}) {
  const cash = Number(wallet.cashBalance);
  if (!Number.isFinite(cash)) return;
  const value = `${demoSidebarMoney.format(cash)} USD`;
  document.querySelectorAll(".sidebar-profile strong:not([data-static-profile]):not([data-live-balance])").forEach((node) => {
    node.textContent = value;
  });
}

async function loadDemoSidebarBalance() {
  if (!document.querySelector(".sidebar-profile strong:not([data-static-profile]):not([data-live-balance])")) return;

  try {
    const response = await fetch("/api/demo/wallet", {
      cache: "no-store",
      headers: window.AutodyAuth?.headers?.() || {}
    });
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
  const sidebarToggle = event.target.closest("[data-sidebar-toggle]");
  if (sidebarToggle) {
    event.preventDefault();
    const collapsed = !document.querySelector(".app-layout")?.classList.contains("sidebar-collapsed");
    saveSidebarCollapsedPreference(collapsed);
    setSidebarCollapsed(collapsed);
    return;
  }

  const signOut = event.target.closest("[data-demo-sign-out], [data-live-sign-out]");
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
