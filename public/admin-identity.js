const adminDate = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit"
});

const ADMIN_OPS_SESSION_KEY = "autodyOpsSession";

function adminEscape(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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
  if (!session?.token) throw new Error("Open a session first.");
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

function statusClass(status = "") {
  const text = String(status).toLowerCase();
  if (["credited", "active", "submitted", "approved", "verified"].includes(text)) return "positive";
  if (["failed", "expired", "cancelled", "error", "rejected"].includes(text)) return "negative";
  return "neutral";
}

function renderEmpty(target, message) {
  target.innerHTML = `<div class="admin-empty">${adminEscape(message)}</div>`;
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

async function loadAdminKycOverview() {
  setAdminNotice("Loading identity submissions...", "neutral");
  const status = document.getElementById("admin-kyc-status")?.value || "all";
  const overview = await adminPost("/api/admin/kyc/overview", { limit: 40, status });
  renderKycSubmissions(overview.submissions || []);
  setAdminNotice(`Identity submissions loaded. Last refresh ${formatAdminDate(overview.generatedAt)}.`, "success");
  return overview;
}

async function reviewKycSubmission(submissionId, status) {
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
  setAdminNotice(`KYC submission ${status === "approved" ? "approved" : "rejected"}.`, "success");
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

function wireAdminIdentityPortal() {
  const session = adminOpsSession();
  const sessionStatus = document.getElementById("admin-session-status");
  if (sessionStatus) {
    sessionStatus.textContent = session?.expiresAt
      ? `Active until ${formatAdminDate(session.expiresAt)}`
      : "No active session";
  }

  if (!session) {
    setAdminNotice("Session required. Redirecting to the gateway.", "error");
    setTimeout(() => {
      window.location.href = "ops-gateway.html";
    }, 700);
    return;
  }

  document.getElementById("admin-refresh")?.addEventListener("click", async () => {
    try {
      const overview = await loadAdminKycOverview();
      setAdminOutput({ success: true, message: "Identity review refreshed.", count: overview.submissions?.length || 0 });
    } catch (err) {
      setAdminOutput(err.message || String(err));
      setAdminNotice(err.message || "Refresh failed.", "error");
    }
  });

  document.getElementById("admin-kyc-refresh")?.addEventListener("click", async () => {
    try {
      await loadAdminKycOverview();
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

  document.addEventListener("click", async (event) => {
    const kycDownload = event.target.closest("[data-kyc-download]");
    const kycDelete = event.target.closest("[data-kyc-delete]");
    const kycButton = event.target.closest("[data-kyc-review]");

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
    }
  });

  loadAdminKycOverview().catch((err) => {
    setAdminNotice(err.message || "Could not load identity data.", "error");
  });
}

document.addEventListener("DOMContentLoaded", wireAdminIdentityPortal);
