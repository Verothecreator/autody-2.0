function marketingEscape(value = "") {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function marketingNotice(message, state = "neutral") {
  const node = document.getElementById("marketing-notice");
  node.textContent = message;
  node.dataset.state = state;
}

function renderMarketing(data) {
  const values = { views: data.views, leads: data.leads, conversions: data.conversions,
    "lead-rate": `${data.leadRate || 0}%`, "conversion-rate": `${data.conversionRate || 0}%` };
  Object.entries(values).forEach(([key, value]) => { document.getElementById(`marketing-${key}`).textContent = value || 0; });
  const table = document.getElementById("marketing-table");
  const rows = Array.isArray(data.campaigns) ? data.campaigns : [];
  table.innerHTML = rows.length ? rows.map((row) => {
    const rate = Number(row.leads) ? ((Number(row.conversions) / Number(row.leads)) * 100).toFixed(1) : "0.0";
    return `<div class="admin-record"><span><strong>${marketingEscape(row.campaign)}</strong><small>Campaign</small></span><span><strong>${marketingEscape(row.source)}</strong><small>${marketingEscape(row.medium)}</small></span><span><strong>${row.leads}</strong><small>Leads</small></span><span><strong>${row.conversions} (${rate}%)</strong><small>Registered</small></span></div>`;
  }).join("") : '<div class="admin-empty">No attributed campaign leads in this reporting window.</div>';
}

async function loadMarketing() {
  marketingNotice("Loading campaign performance...");
  const data = await opsPost("/api/admin/marketing/overview", { days: Number(document.getElementById("marketing-days").value) });
  renderMarketing(data);
  marketingNotice(`Campaign data updated ${new Date(data.generatedAt).toLocaleString()}.`, "success");
}

(async () => {
  if (!await opsRequireSession()) return;
  document.getElementById("marketing-refresh").addEventListener("click", () => loadMarketing().catch((err) => marketingNotice(err.message, "error")));
  document.getElementById("marketing-days").addEventListener("change", () => loadMarketing().catch((err) => marketingNotice(err.message, "error")));
  loadMarketing().catch((err) => marketingNotice(err.message, "error"));
})();

