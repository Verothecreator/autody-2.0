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

function settingsText(value, fallback = "On") {
  if (typeof value === "boolean") return value ? "On" : "Off";
  return value || fallback;
}

function setSettingsToggle(id, value) {
  const node = document.getElementById(id);
  if (!node) return;
  const enabled = value !== false && String(value).toLowerCase() !== "off";
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
    const modeLabel = isLiveSettings ? "Live account" : "Demo trading";
    const statusLabel = isLiveSettings ? "Live active" : "Demo active";

    setSettingsText("settings-status", statusLabel);
    setSettingsText("settings-current-mode", modeLabel);
    setSettingsText("settings-buying-power", `${settingsMoney.format(cash)} USD`);
    setSettingsText("settings-currency", settings.currency || wallet.currency || user.currency || "USD");
    setSettingsText("settings-email", user.email || "Not available");
    setSettingsText("settings-email-status", String(verification.email || user.emailStatus || "verified").replace(/[_-]+/g, " "));
    setSettingsText("settings-database", dbData.configured ? dbData.provider || "Supabase Postgres" : "Local fallback");

    setSettingsToggle("settings-order-confirmation", settings.orderConfirmation);
    setSettingsToggle("settings-market-alerts", settings.marketAlerts);
    setSettingsToggle("settings-news-alerts", settings.newsAlerts);

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

loadSettingsPage();
