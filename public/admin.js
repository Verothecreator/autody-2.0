const adminMoney = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2
});

const adminDate = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit"
});

const numericFields = new Set([
  "fromBlock",
  "toBlock",
  "limit",
  "amount",
  "amountUsd",
  "confirmations",
  "logIndex",
  "blockNumber"
]);

let adminOverview = null;

const ADMIN_OPS_SESSION_KEY = "autodyOpsSession";

function adminEscape(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function adminKey() {
  return document.getElementById("admin-key")?.value.trim() || "";
}

function adminOpsSession() {
  try {
    const raw = sessionStorage.getItem(ADMIN_OPS_SESSION_KEY);
    const session = raw ? JSON.parse(raw) : null;
    if (!session?.token) return null;
    if (session.expiresAt && Date.parse(session.expiresAt) <= Date.now()) {
      sessionStorage.removeItem(ADMIN_OPS_SESSION_KEY);
      return null;
    }
    return session;
  } catch (err) {
    return null;
  }
}

function adminAuthHeaders() {
  const session = adminOpsSession();
  if (!session?.token) {
    throw new Error("Open an ops session first.");
  }
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${session.token}`
  };
}

function setAdminNotice(message, state = "neutral") {
  const notice = document.getElementById("admin-notice");
  if (!notice) return;
  notice.textContent = message;
  notice.dataset.state = state;
}

function setAdminOutput(value) {
  const output = document.getElementById("admin-output");
  if (!output) return;
  output.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function formatAdminDate(value) {
  if (!value) return "Not yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not yet";
  return adminDate.format(date);
}

function formatAdminMoney(value) {
  const number = Number(value);
  return adminMoney.format(Number.isFinite(number) ? number : 0);
}

function formatAdminAmount(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return number.toLocaleString("en-US", { maximumFractionDigits: 10 });
}

function truncateMiddle(value = "", start = 10, end = 8) {
  const text = String(value || "");
  if (text.length <= start + end + 4) return text || "-";
  return `${text.slice(0, start)}...${text.slice(-end)}`;
}

function formBody(form) {
  const body = {};
  const formData = new FormData(form);
  for (const [key, rawValue] of formData.entries()) {
    if (key === "execute") {
      body.execute = true;
      continue;
    }
    const value = String(rawValue || "").trim();
    if (!value) continue;
    body[key] = numericFields.has(key) ? Number(value) : value;
  }
  return body;
}

async function adminPost(path, body = {}) {
  const response = await fetch(path, {
    method: "POST",
    headers: adminAuthHeaders(),
    body: JSON.stringify(body)
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.success === false) {
    throw new Error(json.error || `${path} returned ${response.status}`);
  }
  return json;
}

function fileNameFromDisposition(disposition = "") {
  const utfMatch = String(disposition).match(/filename\*=UTF-8''([^;]+)/i);
  if (utfMatch) return decodeURIComponent(utfMatch[1].replace(/"/g, ""));
  const match = String(disposition).match(/filename="?([^";]+)"?/i);
  return match ? match[1] : "";
}

async function adminDownload(path, body = {}, fallbackName = "autody-download") {
  const response = await fetch(path, {
    method: "POST",
    headers: adminAuthHeaders(),
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const json = await response.json().catch(() => ({}));
    throw new Error(json.error || `${path} returned ${response.status}`);
  }
  const blob = await response.blob();
  const fileName = fileNameFromDisposition(response.headers.get("Content-Disposition") || "") || fallbackName;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { success: true, fileName };
}

function populateDatalists(assets = []) {
  const assetList = document.getElementById("admin-asset-options");
  const networkList = document.getElementById("admin-network-options");
  if (assetList) {
    assetList.innerHTML = assets
      .map((asset) => `<option value="${adminEscape(asset.symbol)}">${adminEscape(asset.name || asset.symbol)}</option>`)
      .join("");
  }
  if (networkList) {
    const networks = [...new Set(assets.flatMap((asset) => asset.networks || []))].sort((a, b) => a.localeCompare(b));
    networkList.innerHTML = networks
      .map((network) => `<option value="${adminEscape(network)}"></option>`)
      .join("");
  }
}

function renderKpis(overview) {
  const totals = overview?.totals || {};
  const capabilities = overview?.capabilities || {};
  document.querySelector('[data-kpi="activeAddresses"]').textContent = totals.activeAddresses || 0;
  document.querySelector('[data-kpi="openRequests"]').textContent = totals.openRequests || 0;
  document.querySelector('[data-kpi="creditedEvents"]').textContent = totals.creditedEvents || 0;
  document.querySelector('[data-kpi="creditedUsd"]').textContent = `${formatAdminMoney(totals.creditedUsd)} credited`;
  document.querySelector('[data-kpi="monitorStatus"]').textContent = capabilities.automaticMonitor ? "On" : "Off";
  document.querySelector('[data-kpi="scanStates"]').textContent = `${totals.scanStates || 0} scan states`;
}

function statusClass(status = "") {
  const text = String(status).toLowerCase();
  if (["credited", "active", "submitted", "approved", "verified"].includes(text)) return "positive";
  if (["failed", "expired", "cancelled", "error", "rejected"].includes(text)) return "negative";
  return "neutral";
}

function renderEmpty(target, message) {
  target.innerHTML = `<div class="admin-empty">${adminEscape(message)}</div>`;
}

function copyButton(value, label = "Copy") {
  if (!value) return "";
  return `<button type="button" class="admin-copy" data-copy="${adminEscape(value)}" data-copy-label="${adminEscape(label)}">${adminEscape(label)}</button>`;
}

function kycDownloadButton(row = {}, kind = "document", label = "Download") {
  const fileName = kind === "selfie"
    ? row.selfieFileName
    : kind === "document_back"
      ? row.documentBackFileName
      : row.documentFileName;
  return `<button type="button" class="admin-download" data-kyc-download="${adminEscape(row.id)}" data-kyc-file-kind="${adminEscape(kind)}" data-kyc-file-name="${adminEscape(fileName || label)}">${adminEscape(label)}</button>`;
}

function kycDeleteButton(row = {}) {
  return `<button type="button" class="btn btn-ghost admin-danger" data-kyc-delete="${adminEscape(row.id)}">Delete files</button>`;
}

function renderAddresses(rows = []) {
  const target = document.getElementById("admin-addresses");
  const count = document.querySelector('[data-count="addresses"]');
  if (count) count.textContent = rows.length;
  if (!target) return;
  if (!rows.length) return renderEmpty(target, "No generated addresses yet.");
  target.innerHTML = rows.map((row) => `
    <article class="admin-record">
      <div>
        <strong>${adminEscape(row.symbol)} / ${adminEscape(row.network)}</strong>
        <span>${adminEscape(row.profileName)} - ${adminEscape(row.email)}</span>
      </div>
      <div>
        <span class="admin-mono">${adminEscape(truncateMiddle(row.address, 14, 10))}</span>
        ${copyButton(row.address)}
      </div>
      <div>
        <span class="admin-status ${statusClass(row.status)}">${adminEscape(row.status)}</span>
        <small>${adminEscape(row.routeType)} - ${adminEscape(row.provider)}</small>
      </div>
      <div>
        <span>Index ${row.derivationIndex ?? "-"}</span>
        <small>${adminEscape(row.derivationPath || "No derivation path")}</small>
      </div>
      <div>
        <span>${formatAdminDate(row.lastIssuedAt)}</span>
        <small>Last issued</small>
      </div>
    </article>
  `).join("");
}

function renderRequests(rows = []) {
  const target = document.getElementById("admin-requests");
  const count = document.querySelector('[data-count="requests"]');
  if (count) count.textContent = rows.length;
  if (!target) return;
  if (!rows.length) return renderEmpty(target, "No deposit requests yet.");
  target.innerHTML = rows.map((row) => `
    <article class="admin-record">
      <div>
        <strong>${adminEscape(row.symbol)} / ${adminEscape(row.network)}</strong>
        <span>${adminEscape(row.profileName)} - ${adminEscape(row.email)}</span>
      </div>
      <div>
        <span class="admin-mono">${adminEscape(truncateMiddle(row.address, 14, 10))}</span>
        ${copyButton(row.address)}
      </div>
      <div>
        <span class="admin-status ${statusClass(row.status)}">${adminEscape(row.status)}</span>
        <small>${row.requestedFresh ? "fresh address" : "saved address"}</small>
      </div>
      <div>
        <span>${formatAdminAmount(row.amount)} ${adminEscape(row.symbol)}</span>
        <small>${formatAdminMoney(row.amountUsd)}</small>
      </div>
      <div>
        <span>${formatAdminDate(row.createdAt)}</span>
        <small>${adminEscape(row.txHash ? truncateMiddle(row.txHash) : "No tx yet")}</small>
      </div>
    </article>
  `).join("");
}

function renderEvents(rows = []) {
  const target = document.getElementById("admin-events");
  const count = document.querySelector('[data-count="events"]');
  if (count) count.textContent = rows.length;
  if (!target) return;
  if (!rows.length) return renderEmpty(target, "No deposit events yet.");
  target.innerHTML = rows.map((row) => `
    <article class="admin-record">
      <div>
        <strong>${adminEscape(row.symbol)} / ${adminEscape(row.network)}</strong>
        <span>${adminEscape(row.profileName)} - ${adminEscape(row.email)}</span>
      </div>
      <div>
        <span class="admin-mono">${adminEscape(truncateMiddle(row.txHash, 14, 10))}</span>
        ${copyButton(row.txHash, "Tx")}
      </div>
      <div>
        <span class="admin-status ${statusClass(row.status)}">${adminEscape(row.status)}</span>
        <small>${row.confirmations} confirmations</small>
      </div>
      <div>
        <span>${formatAdminAmount(row.amount)} ${adminEscape(row.symbol)}</span>
        <small>${formatAdminMoney(row.amountUsd)}</small>
      </div>
      <div>
        <span>${formatAdminDate(row.creditedAt || row.createdAt)}</span>
        <small>Block ${row.blockNumber ?? "-"}</small>
      </div>
    </article>
  `).join("");
}

function renderScanStates(rows = []) {
  const target = document.getElementById("admin-scan-states");
  const count = document.querySelector('[data-count="scanStates"]');
  if (count) count.textContent = rows.length;
  if (!target) return;
  if (!rows.length) return renderEmpty(target, "No scan state yet.");
  target.innerHTML = rows.map((row) => `
    <article class="admin-record admin-record-scan">
      <div>
        <strong>${adminEscape(row.symbol || "All")} / ${adminEscape(row.network)}</strong>
        <span>${adminEscape(row.scanner)}</span>
      </div>
      <div>
        <span>${row.lastScannedBlock ?? "-"}</span>
        <small>Last scanned block</small>
      </div>
      <div>
        <span>${formatAdminDate(row.updatedAt)}</span>
        <small>${adminEscape(row.scanKey)}</small>
      </div>
    </article>
  `).join("");
}

function formatKycDocumentType(value = "") {
  return String(value || "government_id")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

const kycRejectionReasons = [
  ["invalid_document", "Invalid document"],
  ["invalid_id", "Invalid ID"],
  ["inadequate_selfie", "Inadequate selfie"],
  ["document_selfie_mismatch", "Document and selfie mismatch"],
  ["expired_document", "Expired document"],
  ["unclear_document", "Unclear document"],
  ["unsupported_document", "Unsupported document"],
  ["other", "Other"]
];

function kycReasonLabel(value = "") {
  const match = kycRejectionReasons.find(([key]) => key === value);
  return match ? match[1] : "Other";
}

function kycRejectionReasonControls(row = {}) {
  const currentReason = row.reviewReason || "invalid_document";
  const options = kycRejectionReasons.map(([value, label]) => (
    `<option value="${adminEscape(value)}"${value === currentReason ? " selected" : ""}>${adminEscape(label)}</option>`
  )).join("");
  return `
    <label class="admin-kyc-reason">
      <span>Reject reason</span>
      <select data-kyc-reason="${adminEscape(row.id)}">${options}</select>
    </label>
    <label class="admin-kyc-reason">
      <span>Optional user note</span>
      <input type="text" data-kyc-note="${adminEscape(row.id)}" value="${adminEscape(row.reviewNote || "")}" placeholder="Add a short note if needed" />
    </label>
  `;
}

function findKycControl(selector, submissionId) {
  return Array.from(document.querySelectorAll(selector)).find((node) => node.dataset.kycReason === submissionId || node.dataset.kycNote === submissionId);
}

function renderKycPreview(url = "", type = "", label = "Preview") {
  if (!url) return `<div class="admin-kyc-preview admin-empty-preview">${adminEscape(label)} unavailable</div>`;
  const safeUrl = adminEscape(url);
  if (String(type || "").toLowerCase().startsWith("image/")) {
    return `
      <a class="admin-kyc-preview" href="${safeUrl}" target="_blank" rel="noopener">
        <img src="${safeUrl}" alt="${adminEscape(label)}" loading="lazy" />
      </a>
    `;
  }
  return `
    <a class="admin-kyc-preview admin-file-preview" href="${safeUrl}" target="_blank" rel="noopener">
      Open ${adminEscape(label)}
    </a>
  `;
}

function renderKycSubmissions(rows = []) {
  const target = document.getElementById("admin-kyc-submissions");
  const count = document.querySelector('[data-count="kyc"]');
  if (count) count.textContent = rows.length;
  if (!target) return;
  if (!rows.length) return renderEmpty(target, "No KYC submissions yet.");
  target.innerHTML = rows.map((row) => `
    <article class="admin-kyc-record">
      <div class="admin-kyc-person">
        <strong>${adminEscape(row.displayName || row.email)}</strong>
        <span>${adminEscape(row.email)}</span>
        <small>${adminEscape(row.country || "Country unavailable")} - ${formatAdminDate(row.createdAt)}</small>
        <span class="admin-status ${statusClass(row.status)}">${adminEscape(row.status)}</span>
      </div>
      <div class="admin-kyc-files">
        <div>
          <small>${adminEscape(formatKycDocumentType(row.documentType))}</small>
          ${renderKycPreview(row.documentUrl, row.documentContentType, "Identity document")}
          ${kycDownloadButton(row, "document", "Download ID")}
        </div>
        ${row.documentBackUrl ? `
          <div>
            <small>Document back</small>
            ${renderKycPreview(row.documentBackUrl, row.documentBackContentType, "Identity document back")}
            ${kycDownloadButton(row, "document_back", "Download back")}
          </div>
        ` : ""}
        <div>
          <small>Face scan</small>
          ${renderKycPreview(row.selfieUrl, row.selfieContentType, "Face scan")}
          ${kycDownloadButton(row, "selfie", "Download face scan")}
        </div>
      </div>
      <div class="admin-kyc-actions">
        ${kycRejectionReasonControls(row)}
        <button type="button" class="btn" data-kyc-review="${adminEscape(row.id)}" data-kyc-status="approved">Approve</button>
        <button type="button" class="btn btn-ghost" data-kyc-review="${adminEscape(row.id)}" data-kyc-status="rejected">Reject</button>
        ${kycDeleteButton(row)}
        <small>${adminEscape(row.reviewReason ? kycReasonLabel(row.reviewReason) : row.reviewNote || row.reviewer || "Waiting for manual review")}</small>
      </div>
    </article>
  `).join("");
}

function renderOverview(overview) {
  adminOverview = overview;
  populateDatalists(overview.supportedAssets || []);
  renderKpis(overview);
  renderAddresses(overview.addresses || []);
  renderRequests(overview.requests || []);
  renderEvents(overview.events || []);
  renderScanStates(overview.scanStates || []);
  const generated = overview.generatedAt ? formatAdminDate(overview.generatedAt) : "now";
  setAdminNotice(`Deposit admin data loaded. Last refresh ${generated}.`, "success");
}

async function loadAdminOverview() {
  setAdminNotice("Loading deposit admin data...", "neutral");
  const overview = await adminPost("/api/admin/deposits/overview", { limit: 50 });
  renderOverview(overview);
  return overview;
}

async function loadAdminKycOverview() {
  const status = document.getElementById("admin-kyc-status")?.value || "all";
  const overview = await adminPost("/api/admin/kyc/overview", { limit: 40, status });
  renderKycSubmissions(overview.submissions || []);
  return overview;
}

async function reviewKycSubmission(submissionId, status) {
  const action = status === "approved" ? "approve" : "reject";
  const reasonSelect = findKycControl("[data-kyc-reason]", submissionId);
  const noteInput = findKycControl("[data-kyc-note]", submissionId);
  const reviewReason = status === "rejected" ? reasonSelect?.value || "other" : "";
  const reviewNote = status === "rejected"
    ? noteInput?.value?.trim() || kycReasonLabel(reviewReason)
    : "Identity review approved.";
  const result = await adminPost("/api/admin/kyc/review", {
    submissionId,
    status,
    reviewReason,
    reviewNote
  });
  setAdminOutput(result);
  setAdminNotice(`KYC submission ${action === "approve" ? "approved" : "rejected"}.`, "success");
  await loadAdminKycOverview();
}

async function deleteKycSubmission(submissionId) {
  if (!submissionId) return;
  const confirmed = window.confirm("Delete this KYC submission and its private files? This cannot be undone.");
  if (!confirmed) return;
  const result = await adminPost("/api/admin/kyc/delete", { submissionId });
  setAdminOutput(result);
  setAdminNotice("KYC submission files deleted.", "success");
  await loadAdminKycOverview();
}

async function runAdminAction(event, path) {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('button[type="submit"]');
  const original = submit?.textContent || "Submit";
  try {
    if (submit) {
      submit.disabled = true;
      submit.textContent = "Working...";
    }
    const result = await adminPost(path, formBody(form));
    setAdminOutput(result);
    setAdminNotice("Action completed.", "success");
    await loadAdminOverview();
  } catch (err) {
    setAdminOutput(err.message || String(err));
    setAdminNotice(err.message || "Action failed.", "error");
  } finally {
    if (submit) {
      submit.disabled = false;
      submit.textContent = original;
    }
  }
}

function wireAdminPortal() {
  const session = adminOpsSession();
  const sessionStatus = document.getElementById("admin-session-status");
  if (sessionStatus) {
    sessionStatus.textContent = session?.expiresAt
      ? `Active until ${formatAdminDate(session.expiresAt)}`
      : "No active ops session";
  }

  if (!session) {
    setAdminNotice("Ops session required. Redirecting to the gateway.", "error");
    setTimeout(() => {
      window.location.href = "ops-gateway.html";
    }, 700);
    return;
  }

  document.getElementById("admin-connect")?.addEventListener("click", async () => {
    try {
      const overview = await loadAdminOverview();
      await loadAdminKycOverview();
      setAdminOutput({
        success: true,
        message: "Admin portal connected.",
        capabilities: overview.capabilities
      });
    } catch (err) {
      setAdminOutput(err.message || String(err));
      setAdminNotice(err.message || "Could not connect.", "error");
    }
  });

  document.getElementById("admin-refresh")?.addEventListener("click", async () => {
    try {
      await loadAdminOverview();
      await loadAdminKycOverview();
    } catch (err) {
      setAdminOutput(err.message || String(err));
      setAdminNotice(err.message || "Refresh failed.", "error");
    }
  });

  document.getElementById("admin-kyc-refresh")?.addEventListener("click", async () => {
    try {
      await loadAdminKycOverview();
      setAdminNotice("KYC submissions refreshed.", "success");
    } catch (err) {
      setAdminOutput(err.message || String(err));
      setAdminNotice(err.message || "KYC refresh failed.", "error");
    }
  });

  document.getElementById("admin-kyc-status")?.addEventListener("change", async () => {
    try {
      await loadAdminKycOverview();
    } catch (err) {
      setAdminOutput(err.message || String(err));
      setAdminNotice(err.message || "KYC filter failed.", "error");
    }
  });

  document.getElementById("admin-clear-output")?.addEventListener("click", () => {
    setAdminOutput("No action run yet.");
  });

  document.getElementById("admin-scan-form")?.addEventListener("submit", (event) => {
    runAdminAction(event, "/api/admin/deposits/scan");
  });
  document.getElementById("admin-sweep-form")?.addEventListener("submit", (event) => {
    runAdminAction(event, "/api/admin/deposits/sweep");
  });
  document.getElementById("admin-credit-form")?.addEventListener("submit", (event) => {
    runAdminAction(event, "/api/admin/deposits/credit");
  });

  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-copy]");
    const kycButton = event.target.closest("[data-kyc-review]");
    const kycDownload = event.target.closest("[data-kyc-download]");
    const kycDelete = event.target.closest("[data-kyc-delete]");
    if (kycDownload) {
      const original = kycDownload.textContent;
      try {
        kycDownload.disabled = true;
        kycDownload.textContent = "Downloading...";
        const result = await adminDownload("/api/admin/kyc/download", {
          submissionId: kycDownload.dataset.kycDownload,
          kind: kycDownload.dataset.kycFileKind
        }, kycDownload.dataset.kycFileName || "autody-kyc-file");
        setAdminOutput(result);
        setAdminNotice("KYC file downloaded.", "success");
      } catch (err) {
        setAdminOutput(err.message || String(err));
        setAdminNotice(err.message || "KYC download failed.", "error");
      } finally {
        kycDownload.disabled = false;
        kycDownload.textContent = original;
      }
      return;
    }
    if (kycDelete) {
      try {
        await deleteKycSubmission(kycDelete.dataset.kycDelete);
      } catch (err) {
        setAdminOutput(err.message || String(err));
        setAdminNotice(err.message || "KYC delete failed.", "error");
      }
      return;
    }
    if (kycButton) {
      try {
        await reviewKycSubmission(kycButton.dataset.kycReview, kycButton.dataset.kycStatus);
      } catch (err) {
        setAdminOutput(err.message || String(err));
        setAdminNotice(err.message || "KYC review failed.", "error");
      }
      return;
    }
    if (!button) return;
    const value = button.getAttribute("data-copy") || "";
    try {
      await navigator.clipboard.writeText(value);
      button.textContent = "Copied";
      setTimeout(() => {
        button.textContent = button.dataset.copyLabel || "Copy";
      }, 1000);
    } catch (err) {
      setAdminNotice("Could not copy to clipboard.", "error");
    }
  });

  loadAdminOverview().catch((err) => {
    setAdminNotice(err.message || "Could not load admin data.", "error");
  });
}

document.addEventListener("DOMContentLoaded", wireAdminPortal);
