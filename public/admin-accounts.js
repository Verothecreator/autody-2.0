const accountMoney = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2
});

const accountDate = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short"
});

let accountsCache = [];

function accountEscape(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function accountNotice(message, state = "neutral") {
  const notice = document.getElementById("accounts-notice");
  if (!notice) return;
  notice.textContent = message;
  notice.dataset.state = state;
}

function accountFormatMoney(value) {
  const number = Number(value);
  return accountMoney.format(Number.isFinite(number) ? number : 0);
}

function accountFormatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : accountDate.format(date);
}

function accountStatusClass(status = "") {
  const value = String(status || "").toLowerCase();
  if (["verified", "approved", "active", "standard"].includes(value)) return "positive";
  if (["rejected", "restricted", "frozen", "banned", "deleted"].includes(value)) return "negative";
  return "";
}

function accountLimitValue(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number.toFixed(2) : "";
}

function renderAccountKpis(data = {}) {
  const totals = data.totals || {};
  const values = {
    accounts: Number(totals.accounts || 0).toLocaleString("en-US"),
    liveValue: accountFormatMoney(totals.liveValue),
    verified: Number(totals.verified || 0).toLocaleString("en-US"),
    pendingIdentity: Number(totals.pendingIdentity || 0).toLocaleString("en-US")
  };
  Object.entries(values).forEach(([key, value]) => {
    const node = document.querySelector(`[data-account-kpi="${key}"]`);
    if (node) node.textContent = value;
  });
}

function renderAccountsTable(accounts = []) {
  const target = document.getElementById("accounts-table");
  const count = document.querySelector("[data-account-count]");
  if (count) count.textContent = String(accounts.length);
  if (!target) return;
  if (!accounts.length) {
    target.innerHTML = `<div class="admin-empty">No customer accounts found yet.</div>`;
    return;
  }

  target.innerHTML = accounts.map((account) => `
    <div class="admin-record admin-account-record" data-account-profile-id="${accountEscape(account.id)}">
      <span>
        <strong>${accountEscape(account.displayName || account.email)}</strong>
        <small>${accountEscape(account.email || "-")}</small>
      </span>
      <span>
        <strong>${accountFormatMoney(account.liveValue)}</strong>
        <small>${Number(account.livePositions || 0).toLocaleString("en-US")} live positions</small>
      </span>
      <span>
        <strong>${accountFormatMoney(account.liveCash)}</strong>
        <small>Available USD</small>
      </span>
      <span>
        <strong class="admin-status ${accountStatusClass(account.identityStatus)}">${accountEscape(account.identityStatus || "pending")}</strong>
        <small>Identity</small>
      </span>
      <span>
        <strong class="admin-status ${accountStatusClass(account.liveStatus)}">${accountEscape(account.liveStatus || "inactive")}</strong>
        <small>Live account</small>
      </span>
      <span>
        <strong>${accountFormatDate(account.createdAt)}</strong>
        <small>Created</small>
      </span>
      <span class="admin-account-limits">
        <label>Order cap
          <input data-account-limit="order" type="number" min="0" step="0.01" placeholder="No cap" value="${accountEscape(accountLimitValue(account.maxOrderUsd))}" />
        </label>
        <label>Withdrawal cap
          <input data-account-limit="withdrawal" type="number" min="0" step="0.01" placeholder="No cap" value="${accountEscape(accountLimitValue(account.maxWithdrawalUsd))}" />
        </label>
      </span>
      <span class="admin-record-actions">
        <button type="button" class="btn btn-ghost" data-account-command="impersonate">Open</button>
        <button type="button" class="btn btn-ghost" data-account-command="limit">Save limits</button>
        <button type="button" class="btn btn-ghost" data-account-command="restricted">Restrict</button>
        <button type="button" class="btn btn-ghost" data-account-command="banned">Ban</button>
        <button type="button" class="btn btn-ghost" data-account-command="deleted">Soft delete</button>
        <button type="button" class="btn btn-ghost" data-account-command="active">Restore</button>
        <button type="button" class="btn btn-danger" data-account-command="permanent-delete">Permanent delete</button>
      </span>
    </div>
  `).join("");
}

async function loadAccountsData() {
  accountNotice("Loading account data...", "neutral");
  const data = await opsPost("/api/admin/accounts/overview", { limit: 150 });
  accountsCache = Array.isArray(data.accounts) ? data.accounts : [];
  renderAccountKpis(data);
  renderAccountsTable(accountsCache);
  const generated = data.generatedAt ? accountFormatDate(data.generatedAt) : "now";
  accountNotice(`Account data loaded. Last refresh ${generated}.`, "success");
}

function rowProfileId(node) {
  return node?.closest("[data-account-profile-id]")?.dataset.accountProfileId || "";
}

async function runAccountCommand(button) {
  const command = button.dataset.accountCommand;
  const row = button.closest("[data-account-profile-id]");
  const profileId = rowProfileId(button);
  if (!profileId || !command) return;
  const account = accountsCache.find((item) => item.id === profileId);
  const accountEmail = (account?.email || "").trim().toLowerCase();

  if (command === "permanent-delete") {
    const typed = prompt(`Type ${account?.email || "the account email"} to permanently delete this account.`);
    if ((typed || "").trim().toLowerCase() !== accountEmail) {
      accountNotice("Permanent delete cancelled.", "neutral");
      return;
    }
  }

  if (["banned", "deleted"].includes(command) && !confirm(`${command === "deleted" ? "Soft delete" : "Ban"} ${account?.email || "this account"}?`)) {
    return;
  }

  const maxOrderUsd = row.querySelector('[data-account-limit="order"]')?.value || "";
  const maxWithdrawalUsd = row.querySelector('[data-account-limit="withdrawal"]')?.value || "";
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = command === "impersonate" ? "Opening..." : "Saving...";

  try {
    if (command === "impersonate") {
      const data = await opsPost("/api/admin/accounts/impersonate", { profileId });
      if (data.session?.token) {
        localStorage.setItem("autodyDemoSession", JSON.stringify(data.session));
        window.open(data.next || "account", "_blank", "noopener");
        accountNotice(`Support access opened for ${data.email || account?.email || "account"}.`, "success");
      } else {
        accountNotice("Could not create an account session.", "error");
      }
      return;
    }

    if (command === "permanent-delete") {
      await opsPost("/api/admin/accounts/permanent-delete", {
        profileId,
        note: "Admin permanently deleted account from Accounts portal"
      });
      accountNotice(`Account ${account?.email || ""} permanently deleted.`, "success");
      await loadAccountsData();
      return;
    }

    await opsPost("/api/admin/accounts/control", {
      profileId,
      action: command,
      maxOrderUsd,
      maxWithdrawalUsd,
      note: command === "limit" ? "Admin account limit update" : `Admin marked account ${command}`
    });
    accountNotice(`Account ${command === "active" ? "restored" : command} update saved.`, "success");
    await loadAccountsData();
  } catch (err) {
    accountNotice(err.message || "Account action failed.", "error");
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

async function bootAccountsPortal() {
  const status = document.getElementById("accounts-session-status");
  const session = await opsRequireSession();
  if (!session) return;
  if (status) {
    status.textContent = session.expiresAt
      ? `Active until ${accountFormatDate(session.expiresAt)}`
      : "Active session";
  }
  document.getElementById("accounts-refresh")?.addEventListener("click", () => {
    loadAccountsData().catch((err) => accountNotice(err.message || "Refresh failed.", "error"));
  });
  document.getElementById("accounts-table")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-account-command]");
    if (!button) return;
    runAccountCommand(button);
  });
  loadAccountsData().catch((err) => accountNotice(err.message || "Could not load account data.", "error"));
}

bootAccountsPortal();
