const withdrawalMoney = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2
});

const withdrawalDate = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit"
});

function withdrawalEscape(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function withdrawalNotice(message, state = "neutral") {
  const notice = document.getElementById("withdrawal-notice");
  if (!notice) return;
  notice.textContent = message;
  notice.dataset.state = state;
}

function withdrawalOutput(value) {
  const output = document.getElementById("withdrawal-output");
  if (!output) return;
  output.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function withdrawalFormatDate(value) {
  if (!value) return "Not yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not yet";
  return withdrawalDate.format(date);
}

function withdrawalFormatMoney(value) {
  const number = Number(value);
  return withdrawalMoney.format(Number.isFinite(number) ? number : 0);
}

function withdrawalFormatAmount(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return number.toLocaleString("en-US", { maximumFractionDigits: 10 });
}

function withdrawalTruncate(value = "", start = 10, end = 8) {
  const text = String(value || "");
  if (text.length <= start + end + 4) return text || "-";
  return `${text.slice(0, start)}...${text.slice(-end)}`;
}

function withdrawalStatusClass(status = "") {
  const text = String(status).toLowerCase();
  if (["completed", "approved", "released"].includes(text)) return "positive";
  if (["rejected", "failed", "cancelled"].includes(text)) return "negative";
  return "neutral";
}

function withdrawalCopyButton(value, label = "Copy") {
  if (!value) return "";
  return `<button type="button" class="admin-copy" data-copy="${withdrawalEscape(value)}" data-copy-label="${withdrawalEscape(label)}">${withdrawalEscape(label)}</button>`;
}

function withdrawalFormBody(form) {
  const body = {};
  const formData = new FormData(form);
  for (const [key, rawValue] of formData.entries()) {
    const value = String(rawValue || "").trim();
    if (!value) continue;
    body[key] = value;
  }
  return body;
}

function renderWithdrawalEmpty(target, message) {
  target.innerHTML = `<div class="admin-empty">${withdrawalEscape(message)}</div>`;
}

function renderWithdrawalKpis(rows = []) {
  const external = rows.filter((row) => row.type === "external");
  const internal = rows.filter((row) => row.type === "internal");
  const pending = external.filter((row) => row.status === "pending_review");
  const reviewed = external.filter((row) => ["approved", "rejected"].includes(row.status));
  const values = {
    pending: pending.length,
    external: external.length,
    internal: internal.length,
    reviewed: reviewed.length
  };
  Object.entries(values).forEach(([key, value]) => {
    const node = document.querySelector(`[data-withdrawal-kpi="${key}"]`);
    if (node) node.textContent = value;
  });
}

function renderWithdrawalRows(targetId, countName, rows = [], emptyMessage) {
  const target = document.getElementById(targetId);
  const count = document.querySelector(`[data-withdrawal-count="${countName}"]`);
  if (count) count.textContent = rows.length;
  if (!target) return;
  if (!rows.length) return renderWithdrawalEmpty(target, emptyMessage);
  target.innerHTML = rows.map((row) => {
    const isInternal = row.type === "internal";
    const destinationLabel = isInternal ? "Recipient" : "Destination";
    const destinationValue = isInternal ? row.recipientEmail : row.destination;
    return `
      <article class="admin-record">
        <div>
          <strong>${withdrawalEscape(row.asset)} / ${withdrawalEscape(row.network || "-")}</strong>
          <span>${withdrawalEscape(row.profileName)} - ${withdrawalEscape(row.email)}</span>
        </div>
        <div>
          <span>${withdrawalFormatAmount(row.amount)} ${withdrawalEscape(row.asset)}</span>
          <small>${row.amountUsd == null ? "-" : withdrawalFormatMoney(row.amountUsd)}</small>
        </div>
        <div>
          <span class="admin-status ${withdrawalStatusClass(row.status)}">${withdrawalEscape(row.status)}</span>
          <small>${withdrawalFormatDate(row.reviewedAt || row.updatedAt || row.createdAt)}</small>
        </div>
        <div>
          <span>${withdrawalEscape(destinationLabel)}</span>
          <small class="admin-mono">${withdrawalEscape(withdrawalTruncate(destinationValue, 14, 10))}</small>
          ${withdrawalCopyButton(destinationValue, destinationLabel)}
        </div>
        <div>
          <span class="admin-mono">${withdrawalEscape(withdrawalTruncate(row.id, 12, 8))}</span>
          <small>Request ID</small>
          ${withdrawalCopyButton(row.id, "ID")}
        </div>
        <div>
          <span class="admin-mono">${withdrawalEscape(row.txHash ? withdrawalTruncate(row.txHash, 12, 8) : "No tx")}</span>
          <small>${withdrawalEscape(row.note || row.reviewedBy || "No note")}</small>
          ${withdrawalCopyButton(row.txHash, "Tx")}
        </div>
      </article>
    `;
  }).join("");
}

function renderWithdrawalPortal(data = {}) {
  const rows = Array.isArray(data.withdrawals) ? data.withdrawals : [];
  renderWithdrawalKpis(rows);
  renderWithdrawalRows(
    "withdrawal-external-table",
    "external",
    rows.filter((row) => row.type === "external"),
    "No external withdrawal requests yet."
  );
  renderWithdrawalRows(
    "withdrawal-internal-table",
    "internal",
    rows.filter((row) => row.type === "internal"),
    "No internal sends yet."
  );
  const generated = data.generatedAt ? withdrawalFormatDate(data.generatedAt) : "now";
  withdrawalNotice(`Withdrawal data loaded. Last refresh ${generated}.`, "success");
}

async function loadWithdrawalPortal() {
  withdrawalNotice("Loading withdrawal data...", "neutral");
  const data = await opsPost("/api/admin/withdrawals/overview", { limit: 100 });
  renderWithdrawalPortal(data);
  return data;
}

async function runWithdrawalDecision(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('button[type="submit"]');
  const original = submit?.textContent || "Submit";
  try {
    if (submit) {
      submit.disabled = true;
      submit.textContent = "Saving...";
    }
    const result = await opsPost("/api/admin/withdrawals/decision", withdrawalFormBody(form));
    withdrawalOutput(result);
    withdrawalNotice("Withdrawal review saved.", "success");
    await loadWithdrawalPortal();
  } catch (err) {
    withdrawalOutput(err.message || String(err));
    withdrawalNotice(err.message || "Withdrawal review failed.", "error");
  } finally {
    if (submit) {
      submit.disabled = false;
      submit.textContent = original;
    }
  }
}

async function wireWithdrawalPortal() {
  const session = await opsRequireSession();
  const status = document.getElementById("withdrawal-session-status");
  if (status) {
    status.textContent = session?.expiresAt
      ? `Active until ${withdrawalFormatDate(session.expiresAt)}`
      : "No active session";
  }
  if (!session) return;

  document.getElementById("withdrawal-refresh")?.addEventListener("click", () => {
    loadWithdrawalPortal().catch((err) => {
      withdrawalOutput(err.message || String(err));
      withdrawalNotice(err.message || "Refresh failed.", "error");
    });
  });

  document.getElementById("withdrawal-clear-output")?.addEventListener("click", () => {
    withdrawalOutput("No action run yet.");
  });

  document.getElementById("withdrawal-decision-form")?.addEventListener("submit", runWithdrawalDecision);

  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-copy]");
    if (!button) return;
    const value = button.getAttribute("data-copy") || "";
    try {
      await navigator.clipboard.writeText(value);
      button.textContent = "Copied";
      setTimeout(() => {
        button.textContent = button.dataset.copyLabel || "Copy";
      }, 1000);
    } catch (err) {
      withdrawalNotice("Could not copy to clipboard.", "error");
    }
  });

  loadWithdrawalPortal().catch((err) => {
    withdrawalOutput(err.message || String(err));
    withdrawalNotice(err.message || "Could not load withdrawal data.", "error");
  });
}

wireWithdrawalPortal();
