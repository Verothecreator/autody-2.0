function supportNotice(message, type = "") {
  const node = document.getElementById("support-notice");
  node.textContent = message; node.dataset.type = type;
}

function supportTicketNode(ticket) {
  const card = document.createElement("article"); card.className = "admin-record support-inbox-record";
  const heading = document.createElement("div"); heading.className = "support-inbox-heading";
  const title = document.createElement("strong"); title.textContent = ticket.topic || ticket.category || "Support request";
  const date = document.createElement("small"); date.textContent = new Date(ticket.createdAt || ticket.created_at).toLocaleString();
  heading.append(title, date);
  const contact = document.createElement("p"); contact.textContent = `${ticket.name || "Customer"} · ${ticket.email || "No email"} · ${ticket.priority || "Normal"}`;
  const message = document.createElement("p"); message.className = "support-inbox-message"; message.textContent = ticket.message || "";
  const actions = document.createElement("div"); actions.className = "support-inbox-actions";
  if (ticket.email) {
    const reply = document.createElement("a"); reply.className = "btn btn-ghost"; reply.textContent = "Reply by email";
    reply.href = `mailto:${encodeURIComponent(ticket.email)}?subject=${encodeURIComponent(`Re: Autody support ${ticket.topic || ticket.id.slice(0, 8)}`)}`;
    actions.append(reply);
  }
  const label = document.createElement("label"); label.textContent = "Status ";
  const select = document.createElement("select"); select.dataset.ticketId = ticket.id;
  [["open", "Open"], ["in_progress", "In progress"], ["resolved", "Resolved"]].forEach(([value, text]) => {
    const option = document.createElement("option"); option.value = value; option.textContent = text; select.append(option);
  });
  select.value = ticket.status || "open"; label.append(select); actions.append(label);
  card.append(heading, contact, message, actions);
  return card;
}

async function loadSupportInbox() {
  supportNotice("Loading support tickets...");
  const data = await opsPost("/api/admin/support/tickets", { status: document.getElementById("support-status").value, search: document.getElementById("support-search").value.trim(), limit: 500 });
  const tickets = data.tickets || [];
  document.getElementById("support-summary").textContent = `${tickets.length} ticket${tickets.length === 1 ? "" : "s"}`;
  const list = document.getElementById("support-tickets"); list.replaceChildren();
  if (tickets.length) tickets.forEach((ticket) => list.append(supportTicketNode(ticket)));
  else { const empty = document.createElement("p"); empty.className = "admin-empty"; empty.textContent = "No support tickets match these filters."; list.append(empty); }
  supportNotice("Support inbox updated.", "success");
}

(async () => {
  if (!await opsRequireSession()) return;
  document.getElementById("support-refresh").addEventListener("click", () => loadSupportInbox().catch((err) => supportNotice(err.message, "error")));
  document.getElementById("support-status").addEventListener("change", () => loadSupportInbox().catch((err) => supportNotice(err.message, "error")));
  document.getElementById("support-search").addEventListener("keydown", (event) => { if (event.key === "Enter") loadSupportInbox().catch((err) => supportNotice(err.message, "error")); });
  document.getElementById("support-tickets").addEventListener("change", async (event) => {
    const select = event.target.closest("[data-ticket-id]"); if (!select) return;
    try {
      await opsPost("/api/admin/support/update", { id: select.dataset.ticketId, status: select.value });
      supportNotice("Ticket status saved.", "success");
    } catch (err) { supportNotice(err.message, "error"); await loadSupportInbox().catch(() => {}); }
  });
  loadSupportInbox().catch((err) => supportNotice(err.message, "error"));
})();
