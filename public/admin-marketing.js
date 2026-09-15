const leadState = { leads: [], drafts: [] };

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
  clearFollowupDrafts();
  document.getElementById("lead-summary").innerHTML = `<strong>${Number(data.total || 0).toLocaleString()} consent record${Number(data.total || 0) === 1 ? "" : "s"}</strong>`;
  document.getElementById("lead-table").innerHTML = leadState.leads.length ? leadState.leads.map((lead) => `<div class="admin-record" style="grid-template-columns:auto 2fr 1fr 2fr 1fr;align-items:center"><input class="lead-select" type="checkbox" value="${leadEscape(lead.id)}"><span><strong>${leadEscape(lead.email)}</strong><small>${leadEscape(new Date(lead.created_at || lead.createdAt).toLocaleString())}</small></span><span><strong>${leadEscape(lead.status)}</strong><small>${leadEscape((lead.interests || []).join(", "))}</small></span><span><strong>${leadEscape(lead.campaign || "direct")}</strong><small>${leadEscape(`${lead.source || "direct"} / ${lead.medium || "none"}`)}</small></span><span><strong>${Number(lead.briefing_count ?? lead.briefingCount ?? 0)}</strong><small>briefings sent · ${leadEscape(lead.watchlist_offer_status || lead.watchlistOfferStatus || "no offer")}</small></span></div>`).join("") : '<p class="admin-empty">No leads match these filters.</p>';
}

function clearFollowupDrafts() {
  leadState.drafts = [];
  document.getElementById("lead-draft-section").hidden = true;
  document.getElementById("lead-drafts").innerHTML = "";
  document.getElementById("lead-send").disabled = true;
}

function selectedLeadIds() {
  return [...document.querySelectorAll(".lead-select:checked")].map((node) => node.value);
}

async function previewFollowups() {
  const ids = selectedLeadIds();
  if (!ids.length) throw new Error("Select at least one subscribed lead.");
  leadNotice("Recovering original sent briefings...");
  const result = await opsPost("/api/admin/marketing/preview-followup", { ids });
  leadState.drafts = result.drafts || [];
  document.getElementById("lead-draft-section").hidden = false;
  document.getElementById("lead-drafts").innerHTML = leadState.drafts.map((draft) => `<div class="admin-record" style="display:block;margin:12px 0">
    <p><strong>${leadEscape(draft.email)}</strong> · ${draft.error ? `<span style="color:#ff697d">${leadEscape(draft.error)}</span>` : `Original: ${leadEscape(draft.sourceSubject || "")} (${leadEscape(new Date(draft.sourceSentAt).toLocaleString())})`}</p>
    ${draft.error ? "" : `<p><strong>Subject:</strong> ${leadEscape(draft.subject)}</p><p><strong>Watchlist assets:</strong> ${leadEscape((draft.symbols || []).join(", "))}</p><details><summary>Read complete email</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;line-height:1.5">${leadEscape(draft.text)}</pre></details>`}
  </div>`).join("");
  const ready = leadState.drafts.length === ids.length && leadState.drafts.every((draft) => draft.text && !draft.error);
  document.getElementById("lead-send").disabled = !ready;
  leadNotice(ready ? `${ids.length} original briefing follow-up draft${ids.length === 1 ? "" : "s"} ready for review.` : "Some original briefings could not be recovered. Nothing was sent.", ready ? "success" : "error");
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
  const ids = selectedLeadIds();
  if (!ids.length || leadState.drafts.length !== ids.length || !leadState.drafts.every((draft) => ids.includes(draft.id) && draft.text)) throw new Error("Preview the selected original briefing follow-ups first.");
  if (!confirm(`Send the ${ids.length} reviewed original briefing follow-up${ids.length === 1 ? "" : "s"}?`)) return;
  leadNotice("Sending reviewed follow-ups...");
  const result = await opsPost("/api/admin/marketing/send-briefing", { ids, reviewed: true });
  leadNotice(`${result.sent} of ${result.requested} follow-ups sent.`, result.sent ? "success" : "error");
  await loadLeads();
}

async function deleteSelectedLeads() {
  const ids = [...document.querySelectorAll(".lead-select:checked")].map((node) => node.value);
  if (!ids.length) throw new Error("Select at least one lead to delete.");
  if (!confirm(`Permanently delete ${ids.length} selected marketing lead record${ids.length === 1 ? "" : "s"}?`)) return;
  const result = await opsPost("/api/admin/marketing/delete", { ids });
  await loadLeads();
  leadNotice(`${result.deleted.length} lead record${result.deleted.length === 1 ? "" : "s"} deleted.`, "success");
}

(async () => {
  if (!await opsRequireSession()) return;
  document.getElementById("lead-refresh").addEventListener("click", () => loadLeads().catch((err) => leadNotice(err.message, "error")));
  document.getElementById("lead-export").addEventListener("click", () => exportLeads().catch((err) => leadNotice(err.message, "error")));
  document.getElementById("lead-preview").addEventListener("click", () => previewFollowups().catch((err) => leadNotice(err.message, "error")));
  document.getElementById("lead-send").addEventListener("click", () => sendBriefings().catch((err) => leadNotice(err.message, "error")));
  document.getElementById("lead-delete").addEventListener("click", () => deleteSelectedLeads().catch((err) => leadNotice(err.message, "error")));
  ["lead-status", "lead-interest"].forEach((id) => document.getElementById(id).addEventListener("change", () => loadLeads().catch((err) => leadNotice(err.message, "error"))));
  document.getElementById("lead-search").addEventListener("keydown", (event) => { if (event.key === "Enter") loadLeads().catch((err) => leadNotice(err.message, "error")); });
  document.getElementById("lead-table").addEventListener("change", (event) => { if (event.target.matches(".lead-select")) clearFollowupDrafts(); });
  loadLeads().catch((err) => leadNotice(err.message, "error"));
})();
