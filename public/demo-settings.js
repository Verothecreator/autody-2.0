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

async function syncSettingsPref(id, value) {
  return settingsApi("/api/account/settings", {
    method: "POST",
    body: JSON.stringify({
      mode: isLiveSettings ? "live" : "demo",
      key: id,
      value: Boolean(value)
    })
  });
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

function setRawSwitch(node, enabled) {
  if (!node) return;
  node.classList.toggle("is-on", Boolean(enabled));
  node.setAttribute("aria-checked", enabled ? "true" : "false");
}

function setSecurityView(name = "menu") {
  const target = name || "menu";
  document.querySelectorAll("[data-security-view]").forEach((view) => {
    const active = view.dataset.securityView === target;
    view.classList.toggle("active", active);
    view.hidden = !active;
  });
  if (target === "devices") loadRememberedDevices();
  if (target === "authenticator") loadAuthenticatorStatus();
}

function setBrowserNotificationState(value) {
  const toggle = document.getElementById("settings-browser-notifications");
  setRawSwitch(toggle, value);
  saveSettingsPref("settings-browser-notifications", value);
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
    setBrowserNotificationState(storedSettingsPrefs()["settings-browser-notifications"] || ("Notification" in window && Notification.permission === "granted"));

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

  const jumpButton = event.target.closest("[data-settings-jump]");
  if (jumpButton) {
    setActiveSettingsSection(jumpButton.dataset.settingsJump);
    if (jumpButton.dataset.settingsJump === "privacy") setSecurityView("menu");
    return;
  }

  const toggle = event.target.closest("[data-settings-toggle]");
  if (toggle) {
    const enabled = !toggle.classList.contains("is-on");
    toggle.classList.toggle("is-on", enabled);
    toggle.setAttribute("aria-checked", enabled ? "true" : "false");
    saveSettingsPref(toggle.id, enabled);
    syncSettingsPref(toggle.id, enabled)
      .then(() => showSettingsNotice("Notification preference saved.", "success"))
      .catch(() => showSettingsNotice("Preference saved on this device. Account sync will retry when the connection is available.", "error"));
    return;
  }

  const browserToggle = event.target.closest("[data-browser-notifications]");
  if (browserToggle) {
    const enabled = !browserToggle.classList.contains("is-on");
    if (enabled && !("Notification" in window)) {
      setBrowserNotificationState(false);
      showSettingsNotice("This browser does not support website notifications.", "error");
      return;
    }
    if (enabled && Notification.permission !== "granted") {
      Notification.requestPermission().then((permission) => {
        const allowed = permission === "granted";
        setBrowserNotificationState(allowed);
        showSettingsNotice(allowed ? "Website notifications are enabled on this device." : "Browser notifications are blocked. Enable them in your browser settings to receive website alerts.", allowed ? "success" : "error");
      });
      return;
    }
    setBrowserNotificationState(enabled);
    showSettingsNotice(enabled ? "Website notifications are enabled on this device." : "Website notifications are off on this device.", "success");
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

  const securityButton = event.target.closest("[data-security-action]");
  if (securityButton) {
    setSecurityView(securityButton.dataset.securityAction || "menu");
    return;
  }

  const deleteDevice = event.target.closest("[data-delete-device]");
  if (deleteDevice) {
    removeRememberedDevice(deleteDevice.dataset.deleteDevice);
    return;
  }
});

document.getElementById("settings-search")?.addEventListener("input", (event) => {
  filterSettingsRows(event.target.value || "");
});

document.addEventListener("submit", async (event) => {
  const form = event.target.closest("#settings-ticket-form");
  if (!form) return;
  event.preventDefault();
  const message = document.getElementById("settings-ticket-message")?.value?.trim();
  const topic = document.getElementById("settings-ticket-topic")?.value?.trim();
  const category = document.getElementById("settings-ticket-type")?.value?.trim();
  if (!message) {
    showSettingsNotice("Write your message before submitting the ticket.", "error");
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
        category: category || "Support request",
        topic: topic || "Support request",
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
        <span><strong>${escapeSettingsHtml(device.label || `Remembered device ${index + 1}`)}</strong><small>Saved ${device.createdAt ? escapeSettingsHtml(new Date(device.createdAt).toLocaleString()) : "recently"}${device.expiresAt ? ` - Expires ${escapeSettingsHtml(new Date(device.expiresAt).toLocaleDateString())}` : ""}</small></span>
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

async function loadAuthenticatorStatus() {
  const startButton = document.getElementById("settings-start-authenticator");
  const setupPanel = document.getElementById("settings-auth-setup");
  const confirmForm = document.getElementById("settings-authenticator-confirm");
  const keyNode = document.getElementById("settings-auth-key");
  const qrNode = document.getElementById("settings-auth-qr");
  if (setupPanel) setupPanel.hidden = true;
  if (confirmForm) confirmForm.hidden = true;
  if (keyNode) keyNode.textContent = "Generate a QR code first";
  if (qrNode) qrNode.textContent = "QR";
  try {
    const data = await settingsApi("/api/account/security/authenticator");
    if (startButton) startButton.textContent = "Continue";
    if (data.enabled) showSettingsNotice("Authenticator is already enabled for this account.", "success");
  } catch (err) {
    if (startButton) startButton.textContent = "Continue";
  }
}

document.getElementById("settings-send-password-code")?.addEventListener("click", async () => {
  try {
    await settingsApi("/api/account/security/password/request", {
      method: "POST",
      body: JSON.stringify({})
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
    setSecurityView("menu");
    showSettingsNotice("Password changed successfully.", "success");
  } catch (err) {
    showSettingsNotice(err.message || "Could not change password.", "error");
  }
});

document.getElementById("settings-start-authenticator")?.addEventListener("click", async () => {
  const currentPassword = document.getElementById("settings-auth-password")?.value || "";
  if (!currentPassword) {
    showSettingsNotice("Enter your current password first.", "error");
    return;
  }
  const button = document.getElementById("settings-start-authenticator");
  if (button) {
    button.disabled = true;
    button.textContent = "Generating";
  }
  try {
    const data = await settingsApi("/api/account/security/authenticator/setup", {
      method: "POST",
      body: JSON.stringify({ currentPassword })
    });
    const setupPanel = document.getElementById("settings-auth-setup");
    const confirmForm = document.getElementById("settings-authenticator-confirm");
    const keyNode = document.getElementById("settings-auth-key");
    const qrNode = document.getElementById("settings-auth-qr");
    if (keyNode) keyNode.textContent = data.secret || "Key unavailable";
    if (qrNode) {
      qrNode.textContent = "";
      if (data.qrDataUrl) {
        const img = document.createElement("img");
        img.src = data.qrDataUrl;
        img.alt = "Authenticator QR code";
        qrNode.appendChild(img);
      } else {
        qrNode.textContent = "Use manual key";
      }
    }
    if (setupPanel) setupPanel.hidden = false;
    if (confirmForm) confirmForm.hidden = false;
    showSettingsNotice("Scan the QR code, then enter the code from your authenticator app.", "success");
  } catch (err) {
    showSettingsNotice(err.message || "Could not generate authenticator setup.", "error");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "Continue";
    }
  }
});

document.getElementById("settings-authenticator-confirm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const currentPassword = document.getElementById("settings-auth-password")?.value || "";
  const code = document.getElementById("settings-auth-code")?.value || "";
  if (!currentPassword || !/^\d{6}$/.test(code.replace(/\s+/g, ""))) {
    showSettingsNotice("Enter your current password and the 6-digit authenticator code.", "error");
    return;
  }
  try {
    await settingsApi("/api/account/security/authenticator/confirm", {
      method: "POST",
      body: JSON.stringify({ currentPassword, code })
    });
    event.target.reset();
    document.getElementById("settings-authenticator-form")?.reset();
    setSecurityView("menu");
    showSettingsNotice("Authenticator app enabled.", "success");
  } catch (err) {
    showSettingsNotice(err.message || "Could not enable authenticator.", "error");
  }
});

setActiveSettingsSection("account");
setSecurityView("menu");
applySettingsTheme();
loadSettingsPage();
