const isLiveSettings = document.body?.dataset?.settingsMode === "live" || location.pathname.endsWith("account-settings.html");

const settingsMoney = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2
});
const SETTINGS_PREF_KEY = isLiveSettings ? "autodyLiveSettingsPrefs" : "autodyDemoSettingsPrefs";
const SETTINGS_THEME_KEY = "autodyAccountTheme";

function setSettingsText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = value;
}

function escapeSettingsHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function storedSettingsPrefs() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_PREF_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveSettingsPref(id, value) {
  const prefs = storedSettingsPrefs();
  prefs[id] = Boolean(value);
  localStorage.setItem(SETTINGS_PREF_KEY, JSON.stringify(prefs));
}

function setSettingsToggle(id, value) {
  const node = document.getElementById(id);
  if (!node) return;
  const stored = storedSettingsPrefs();
  const nextValue = Object.prototype.hasOwnProperty.call(stored, id) ? stored[id] : value;
  const normalized = String(nextValue ?? "").toLowerCase();
  const enabled = nextValue === true || normalized === "true" || normalized === "on" || normalized === "1";
  node.classList.toggle("is-on", enabled);
  node.setAttribute("aria-checked", enabled ? "true" : "false");
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

function applySettingsTheme(theme = localStorage.getItem(SETTINGS_THEME_KEY) || "dark") {
  const dark = theme !== "light";
  document.body.classList.toggle("theme-light", !dark);
  const toggle = document.getElementById("settings-theme-toggle");
  const label = document.getElementById("settings-theme-label");
  if (toggle) {
    toggle.classList.toggle("is-on", dark);
    toggle.setAttribute("aria-checked", dark ? "true" : "false");
  }
  if (label) label.textContent = dark ? "Dark mode" : "Light mode";
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

async function settingsApi(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(window.AutodyAuth?.headers?.() || {}),
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) throw new Error(data.error || `${url} returned ${response.status}`);
  return data;
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
    toggle.setAttribute("aria-checked", enabled ? "true" : "false");
    saveSettingsPref(toggle.id, enabled);
    showSettingsNotice("Preference saved. Delivery channels will use this when notification sending is connected.", "success");
    return;
  }

  const themeToggle = event.target.closest("[data-theme-toggle]");
  if (themeToggle) {
    const switchToDark = !themeToggle.classList.contains("is-on");
    const theme = switchToDark ? "dark" : "light";
    localStorage.setItem(SETTINGS_THEME_KEY, theme);
    applySettingsTheme(theme);
    showSettingsNotice(switchToDark ? "Dark mode enabled." : "Light mode enabled.", "success");
    return;
  }

  const modalButton = event.target.closest("[data-settings-modal]");
  if (modalButton) {
    openSettingsModal(modalButton.dataset.settingsModal);
    return;
  }

  const closeButton = event.target.closest("[data-settings-close]");
  if (closeButton) {
    closeSettingsModals();
    return;
  }

  const modalBackdrop = event.target.closest(".settings-modal");
  if (modalBackdrop && event.target === modalBackdrop) {
    closeSettingsModals();
    return;
  }

  const deleteDevice = event.target.closest("[data-delete-device]");
  if (deleteDevice) {
    removeRememberedDevice(deleteDevice.dataset.deleteDevice);
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
        category: document.getElementById("settings-ticket-topic")?.value?.trim() || "Support request",
        priority: "Normal",
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

function openSettingsModal(name) {
  closeSettingsModals();
  const dialog = document.querySelector(`[data-settings-dialog="${name}"]`);
  if (!dialog) return;
  dialog.hidden = false;
  if (name === "devices") loadRememberedDevices();
}

function closeSettingsModals() {
  document.querySelectorAll("[data-settings-dialog]").forEach((dialog) => {
    dialog.hidden = true;
  });
}

async function loadRememberedDevices() {
  const list = document.getElementById("settings-device-list");
  if (!list) return;
  list.innerHTML = `<div class="settings-empty-state">Loading remembered devices...</div>`;
  try {
    const data = await settingsApi("/api/account/security/devices");
    const devices = Array.isArray(data.devices) ? data.devices : [];
    if (!devices.length) {
      list.innerHTML = `<div class="settings-empty-state">No remembered devices are saved for this account.</div>`;
      return;
    }
    list.innerHTML = devices.map((device, index) => `
      <div class="settings-device-row">
        <span><strong>${escapeSettingsHtml(device.label || `Remembered device ${index + 1}`)}</strong><small>Saved ${device.createdAt ? escapeSettingsHtml(new Date(device.createdAt).toLocaleString()) : "recently"}${device.expiresAt ? ` · Expires ${escapeSettingsHtml(new Date(device.expiresAt).toLocaleDateString())}` : ""}</small></span>
        <button class="settings-delete-device" type="button" data-delete-device="${escapeSettingsHtml(device.id)}" aria-label="Remove remembered device">x</button>
      </div>
    `).join("");
  } catch (err) {
    list.innerHTML = `<div class="settings-empty-state">Device list is not available yet. Sign in again and retry.</div>`;
  }
}

async function removeRememberedDevice(id) {
  if (!id) return;
  try {
    await settingsApi(`/api/account/security/devices/${encodeURIComponent(id)}`, { method: "DELETE" });
    showSettingsNotice("Remembered device removed.", "success");
    loadRememberedDevices();
  } catch (err) {
    showSettingsNotice(err.message || "Could not remove that remembered device.", "error");
  }
}

document.getElementById("settings-send-password-code")?.addEventListener("click", async () => {
  const currentPassword = document.getElementById("settings-current-password")?.value || "";
  if (!currentPassword) {
    showSettingsNotice("Enter your current password first.", "error");
    return;
  }
  try {
    await settingsApi("/api/account/security/password/request", {
      method: "POST",
      body: JSON.stringify({ currentPassword })
    });
    showSettingsNotice("Password change code sent to your email.", "success");
  } catch (err) {
    showSettingsNotice(err.message || "Could not send password code.", "error");
  }
});

document.getElementById("settings-password-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const currentPassword = document.getElementById("settings-current-password")?.value || "";
  const code = document.getElementById("settings-password-code")?.value || "";
  const newPassword = document.getElementById("settings-new-password")?.value || "";
  const confirmPassword = document.getElementById("settings-confirm-password")?.value || "";
  if (!currentPassword || !code || !newPassword || !confirmPassword) {
    showSettingsNotice("Complete every password field first.", "error");
    return;
  }
  if (newPassword !== confirmPassword) {
    showSettingsNotice("New passwords do not match.", "error");
    return;
  }
  try {
    await settingsApi("/api/account/security/password/confirm", {
      method: "POST",
      body: JSON.stringify({ currentPassword, code, newPassword })
    });
    event.target.reset();
    closeSettingsModals();
    showSettingsNotice("Password changed successfully.", "success");
  } catch (err) {
    showSettingsNotice(err.message || "Could not change password.", "error");
  }
});

setActiveSettingsSection("account");
applySettingsTheme();
loadSettingsPage();
