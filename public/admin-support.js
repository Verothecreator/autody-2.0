const supportState = { tickets: [] };
function supportNode(tag, text = "", className = "") {
  const node = document.createElement(tag);
  node.textContent = text; node.className = className;
  return node;
}
function supportNotice(message, type = "") {
  const node = document.getElementById("support-notice");
  node.textContent = message; node.dataset.type = type;
}
async function loadThreadMessages(ticket, container) {
  const data = await opsPost("/api/support-team/thread", { ticketId: ticket.id });
  container.replaceChildren();
  if (!data.messages.length) { container.append(supportNode("p", "No replies yet.", "admin-empty")); return; }
  data.messages.forEach((message) => {
    const entry = supportNode("article", "", "support-thread-entry " + (message.role === "customer" ? "from-customer" : "from-agent"));
    entry.append(supportNode("strong", (message.role === "customer" ? "Customer" : message.agentName || "Autody Support") + " · " + new Date(message.createdAt).toLocaleString()),
      supportNode("p", message.body, "support-inbox-message"));
    container.append(entry);
  });
}
function renderThread(ticket, container) {
  const thread = supportNode("div", "", "support-thread");
  thread.append(supportNode("p", ticket.message, "support-message support-customer-message"));
  const messages = supportNode("div", "Loading replies..."); thread.append(messages);
  const label = supportNode("label", "Reply as Autody Support <support@autodytraded.com>");
  const textarea = document.createElement("textarea");
  textarea.rows = 5; textarea.maxLength = 4000; textarea.placeholder = "Write a clear, helpful response for the customer.";
  label.append(textarea); thread.append(label);
  const preview = supportNode("div", "", "support-reply-preview"); preview.hidden = true; thread.append(preview);
  let pendingRequestId = null;
  textarea.addEventListener("input", () => { preview.hidden = true; pendingRequestId = null; });
  const actions = supportNode("div", "", "support-inbox-actions");
  const previewButton = supportNode("button", "Preview reply", "btn btn-ghost"); previewButton.type = "button";
  previewButton.addEventListener("click", () => {
    if (!textarea.value.trim()) return supportNotice("Write a reply first.", "error");
    preview.replaceChildren(supportNode("strong", "Customer email preview"),
      supportNode("p", "From: Autody Support <support@autodytraded.com>"),
      supportNode("p", "Subject: Re: " + (ticket.topic || ticket.category || "Your request") + " | Autody Support"),
      supportNode("p", "Hello,"), supportNode("p", textarea.value.trim(), "support-inbox-message"),
      supportNode("p", "Reply to this ticket: [customer's secure link]"),
      supportNode("p", "Autody Support", "support-inbox-message"));
    preview.hidden = false;
  });
  const send = supportNode("button", "Send reply", "btn"); send.type = "button";
  send.addEventListener("click", async () => {
    if (!textarea.value.trim()) return supportNotice("Write a reply first.", "error");
    if (preview.hidden) return supportNotice("Preview the customer email before sending.", "error");
    pendingRequestId ||= crypto.randomUUID();
    try {
      send.disabled = true; send.textContent = "Sending...";
      await opsPost("/api/support-team/reply", { ticketId: ticket.id, requestId: pendingRequestId, message: textarea.value.trim() });
      textarea.value = ""; preview.hidden = true; pendingRequestId = null;
      supportNotice("Reply emailed and saved in this ticket.", "success");
      await loadThreadMessages(ticket, messages);
    } catch (error) { supportNotice(error.message, "error"); }
    finally { send.disabled = false; send.textContent = "Send reply"; }
  });
  actions.append(previewButton, send); thread.append(actions); container.append(thread);
  loadThreadMessages(ticket, messages).catch((error) => { messages.textContent = error.message; });
}
function ticketCard(ticket) {
  const card = supportNode("article", "", "admin-record support-inbox-record");
  const heading = supportNode("div", "", "support-inbox-heading");
  heading.append(supportNode("strong", ticket.topic || ticket.category || "Support request"),
    supportNode("small", new Date(ticket.createdAt).toLocaleString()));
  card.append(heading, supportNode("p", (ticket.name || "Customer") + " · " + (ticket.email || "No email") + " · " + (ticket.priority || "Normal")),
    supportNode("p", ticket.message, "support-inbox-message"));
  const actions = supportNode("div", "", "support-inbox-actions");
  const statusLabel = supportNode("label", "Status ");
  const status = document.createElement("select");
  [["open", "Open"], ["in_progress", "In progress"], ["resolved", "Resolved"]].forEach(([value, label]) => status.append(new Option(label, value)));
  status.value = ticket.status || "open";
  status.addEventListener("change", async () => {
    try { await opsPost("/api/support-team/status", { ticketId: ticket.id, status: status.value }); ticket.status = status.value; supportNotice("Ticket status saved.", "success"); }
    catch (error) { status.value = ticket.status; supportNotice(error.message, "error"); }
  });
  statusLabel.append(status); actions.append(statusLabel);
  const button = supportNode("button", "Open conversation", "btn btn-ghost"); button.type = "button";
  const thread = supportNode("div"); thread.hidden = true;
  button.addEventListener("click", () => {
    thread.hidden = !thread.hidden;
    if (!thread.hidden && !thread.childElementCount) renderThread(ticket, thread);
    button.textContent = thread.hidden ? "Open conversation" : "Close conversation";
  });
  actions.append(button); card.append(actions, thread); return card;
}
async function loadSupportInbox() {
  const inbox = await opsPost("/api/support-team/tickets", { status: document.getElementById("support-status").value,
    search: document.getElementById("support-search").value.trim(), limit: 500 });
  supportState.tickets = inbox.tickets || [];
  document.getElementById("support-summary").textContent = supportState.tickets.length + " ticket" + (supportState.tickets.length === 1 ? "" : "s");
  const list = document.getElementById("support-tickets"); list.replaceChildren();
  if (supportState.tickets.length) supportState.tickets.forEach((ticket) => list.append(ticketCard(ticket)));
  else list.append(supportNode("p", "No support tickets match these filters.", "admin-empty"));
  supportNotice("Support inbox updated.", "success");
}
(async () => {
  if (!await opsRequireSession()) return;
  const emailForm = document.getElementById("support-email-import");
  let emailRequestId = null;
  emailForm.addEventListener("input", () => { emailRequestId = null; });
  emailForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = emailForm.querySelector("button[type='submit']");
    emailRequestId ||= crypto.randomUUID();
    try {
      button.disabled = true;
      await opsPost("/api/support-team/import-email", {
        requestId: emailRequestId, email: emailForm.elements.email.value.trim(),
        name: emailForm.elements.name.value.trim(), subject: emailForm.elements.subject.value.trim(),
        message: emailForm.elements.message.value.trim()
      });
      emailForm.reset(); emailRequestId = null;
      await loadSupportInbox(); supportNotice("Email saved as a ticket. Open its conversation to reply.", "success");
    } catch (error) { supportNotice(error.message, "error"); }
    finally { button.disabled = false; }
  });
  document.getElementById("support-refresh").addEventListener("click", () => loadSupportInbox().catch((error) => supportNotice(error.message, "error")));
  document.getElementById("support-status").addEventListener("change", () => loadSupportInbox().catch((error) => supportNotice(error.message, "error")));
  document.getElementById("support-search").addEventListener("keydown", (event) => { if (event.key === "Enter") loadSupportInbox().catch((error) => supportNotice(error.message, "error")); });
  loadSupportInbox().catch((error) => supportNotice(error.message, "error"));
})();
