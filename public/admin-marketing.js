const leadState = { leads: [] };

function leadEscape(value = "") {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function leadFilters() {
  return { search: document.getElementById("lead-search").value.trim(), status: document.getElementById("lead-status").value, interest: document.getElementById("lead-interest").value, limit: 500 };
}

function leadNotice(message, state = "") {
  const node = document.getElementById("lead-notice"); node.textContent = message; node.dataset.type = state;
}

function renderLeads(data) {
  leadState.leads = data.leads || [];
  document.getElementById("lead-summary").innerHTML = `<strong>${Number(data.total || 0).toLocaleString()} consent record${Number(data.total || 0) === 1 ? "" : "s"}</strong>`;
  document.getElementById("lead-table").innerHTML = leadState.leads.length ? leadState.leads.map((lead) => `<div class="admin-record" style="grid-template-columns:auto 2fr 1fr 2fr 1fr;align-items:center"><input class="lead-select" type="checkbox" value="${leadEscape(lead.id)}" ${lead.status === "unsubscribed" ? "disabled" : ""}><span><strong>${leadEscape(lead.email)}</strong><small>${leadEscape(new Date(lead.created_at || lead.createdAt).toLocaleString())}</small></span><span><strong>${leadEscape(lead.status)}</strong><small>${leadEscape((lead.interests || []).join(", "))}</small></span><span><strong>${leadEscape(lead.campaign || "direct")}</strong><small>${leadEscape(`${lead.source || "direct"} / ${lead.medium || "none"}`)}</small></span><span><strong>${Number(lead.briefing_count ?? lead.briefingCount ?? 0)}</strong><small>briefings sent</small></span></div>`).join("") : '<p class="admin-empty">No leads match these filters.</p>';
}

async function loadLeads() {
  leadNotice("Loading leads...");
  const data = await opsPost("/api/admin/marketing/leads", leadFilters());
  renderLeads(data); leadNotice("Lead records updated.", "success");
}

async function exportLeads() {
  leadNotice("Preparing export...");
  const response = await fetch("/api/admin/marketing/export", { method: "POST", headers: opsHeaders(), body: JSON.stringify(leadFilters()) });
  if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || "Export failed."); }
  const blob = await response.blob(); const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `autody-marketing-leads-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); URL.revokeObjectURL(link.href);
  leadNotice("CSV exported.", "success");
}

async function sendBriefings() {
  const ids = [...document.querySelectorAll(".lead-select:checked")].map((node) => node.value);
  if (!ids.length) throw new Error("Select at least one subscribed lead.");
  if (!confirm(`Send a fresh market briefing to ${ids.length} selected lead${ids.length === 1 ? "" : "s"}?`)) return;
  leadNotice("Sending briefings...");
  const result = await opsPost("/api/admin/marketing/send-briefing", { ids });
  leadNotice(`${result.sent} of ${result.requested} briefings sent.`, result.sent ? "success" : "error");
  await loadLeads();
}

(async () => {
  if (!await opsRequireSession()) return;
  document.getElementById("lead-refresh").addEventListener("click", () => loadLeads().catch((err) => leadNotice(err.message, "error")));
  document.getElementById("lead-export").addEventListener("click", () => exportLeads().catch((err) => leadNotice(err.message, "error")));
  document.getElementById("lead-send").addEventListener("click", () => sendBriefings().catch((err) => leadNotice(err.message, "error")));
  ["lead-status", "lead-interest"].forEach((id) => document.getElementById(id).addEventListener("change", () => loadLeads().catch((err) => leadNotice(err.message, "error"))));
  document.getElementById("lead-search").addEventListener("keydown", (event) => { if (event.key === "Enter") loadLeads().catch((err) => leadNotice(err.message, "error")); });
  loadLeads().catch((err) => leadNotice(err.message, "error"));
})();

