const isLiveSettings = document.body?.dataset?.settingsMode === "live" || location.pathname.endsWith("account-settings.html");

const settingsMoney = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2
});

function setSettingsText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = value;
}

function setSettingsToggle(id, value) {
  const node = document.getElementById(id);
  if (!node) return;
  const normalized = String(value ?? "").toLowerCase();
  const enabled = value === true || normalized === "true" || normalized === "on" || normalized === "1";
  node.textContent = enabled ? "On" : "Off";
  node.classList.toggle("is-on", enabled);
}

function showSettingsNotice(message, tone = "info") {
  const notice = document.getElementById("settings-notice");
  if (!notice) return;
  notice.textContent = message;
  notice.dataset.tone = tone;
  notice.hidden = false;
  setTimeout(() => {
    notice.hidden = true;
  }, 5200);
}

function setActiveSettingsSection(section = "account") {
  const target = section || "account";
  document.querySelectorAll("[data-settings-section]").forEach((row) => {
    const active = row.dataset.settingsSection === target;
    row.classList.toggle("active", active);
    row.setAttribute("aria-current", active ? "true" : "false");
  });
  document.querySelectorAll("[data-settings-panel]").forEach((panel) => {
    const active = panel.dataset.settingsPanel === target;
    panel.classList.toggle("active", active);
    panel.hidden = !active;
  });
}

function filterSettingsRows(query = "") {
  const needle = query.trim().toLowerCase();
  let firstVisible = null;
  document.querySelectorAll("[data-settings-section]").forEach((row) => {
    const haystack = `${row.textContent || ""} ${row.dataset.settingsSearchText || ""}`.toLowerCase();
    const visible = !needle || haystack.includes(needle);
    row.hidden = !visible;
    if (visible && !firstVisible) firstVisible = row;
  });
  const activeRow = document.querySelector("[data-settings-section].active:not([hidden])");
  if (!activeRow && firstVisible) setActiveSettingsSection(firstVisible.dataset.settingsSection);
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
    const walletUrl = isLiveSettings ? "/api/account/wallet" : "/api/demo/wallet";
    const [walletData, settingsData, dbData] = await Promise.all([
      getSettingsJson(walletUrl),
      isLiveSettings
        ? Promise.resolve({ settings: {} })
        : getSettingsJson("/api/demo/settings").catch(() => ({ settings: {} })),
      getSettingsJson("/api/db/status").catch(() => ({ configured: false, provider: "local" }))
    ]);

    const wallet = walletData.wallet || {};
    const user = walletData.user || {};
    const verification = user.verification || {};
    const settings = walletData.settings || settingsData.settings || {};
    const cash = Number(wallet.cashBalance || user.cashBalance || 0);
    const statusLabel = isLiveSettings ? "Live active" : "Demo active";

    setSettingsText("settings-status", statusLabel);

    setSettingsToggle("settings-order-confirmation", settings.orderConfirmation);
    setSettingsToggle("settings-market-alerts", settings.marketAlerts);
    setSettingsToggle("settings-news-alerts", settings.newsAlerts);
    setSettingsToggle("settings-deposit-alerts", settings.depositAlerts);
    setSettingsToggle("settings-withdrawal-alerts", settings.withdrawalAlerts);
    setSettingsToggle("settings-price-alerts", settings.priceAlerts);
    setSettingsToggle("settings-research-brief", settings.researchBrief);

    if (isLiveSettings) {
      document.querySelectorAll("[data-live-balance]").forEach((node) => {
        node.textContent = `${settingsMoney.format(cash)} USD`;
      });
    }
  } catch (err) {
    console.warn("Settings page failed:", err);
    setSettingsText("settings-status", "Warming up");
  }
}

document.addEventListener("click", (event) => {
  const settingsRow = event.target.closest("[data-settings-section]");
  if (settingsRow) {
    setActiveSettingsSection(settingsRow.dataset.settingsSection);
    return;
  }

  const toggle = event.target.closest("[data-settings-toggle]");
  if (toggle) {
    const enabled = !toggle.classList.contains("is-on");
    toggle.classList.toggle("is-on", enabled);
    toggle.textContent = enabled ? "On" : "Off";
    showSettingsNotice("Preference saved for this browser preview. Database saving comes next.", "success");
    return;
  }

  const messageButton = event.target.closest("[data-settings-message]");
  if (!messageButton) return;
  showSettingsNotice(messageButton.dataset.settingsMessage || "This setting is being prepared.");
});

document.getElementById("settings-search")?.addEventListener("input", (event) => {
  filterSettingsRows(event.target.value || "");
});

document.addEventListener("submit", async (event) => {
  const form = event.target.closest("#settings-ticket-form");
  if (!form) return;
  event.preventDefault();
  const message = document.getElementById("settings-ticket-message")?.value?.trim();
  if (!message) {
    showSettingsNotice("Type the issue before submitting the ticket.", "error");
    return;
  }

  const submitButton = form.querySelector("button[type='submit']");
  const originalText = submitButton?.textContent || "Submit Ticket";
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = "Submitting";
  }

  try {
    const response = await fetch("/api/support/tickets", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(window.AutodyAuth?.headers?.() || {})
      },
      body: JSON.stringify({
        mode: isLiveSettings ? "live" : "demo",
        category: document.getElementById("settings-ticket-type")?.value || "Other",
        priority: document.getElementById("settings-ticket-priority")?.value || "Normal",
        message
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) throw new Error(data.error || "Ticket could not be submitted.");
    form.reset();
    showSettingsNotice("Ticket submitted. Autody can review it from the support queue.", "success");
  } catch (err) {
    showSettingsNotice(err.message || "Ticket could not be submitted. Sign in again and retry.", "error");
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = originalText;
    }
  }
});

setActiveSettingsSection("account");
loadSettingsPage();
