const AGENT_SESSION_KEY = "autodySupportAgentSession";
const agentState = { token: "", agent: null, challengeId: "", tickets: [] };
function agentNode(tag, text = "", className = "") {
  const element = document.createElement(tag); element.textContent = text; element.className = className; return element;
}
function agentNotice(text, type = "") {
  const node = document.getElementById("agent-notice"); node.textContent = text; node.dataset.type = type;
}
function restoreAgentSession() {
  try { agentState.token = JSON.parse(sessionStorage.getItem(AGENT_SESSION_KEY) || "{}").token || ""; }
  catch { agentState.token = ""; }
}
async function agentPost(path, body = {}, auth = true) {
  const response = await fetch(path, { method: "POST",
    headers: { "Content-Type": "application/json", ...(auth && agentState.token ? { Authorization: "Bearer " + agentState.token } : {}) },
    body: JSON.stringify(body) });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.success === false) throw new Error(json.error || "Support request failed.");
  return json;
}
function showAgentWorkspace(agent) {
  agentState.agent = agent;
  document.getElementById("agent-login").hidden = true;
  document.getElementById("agent-code").hidden = true;
  document.getElementById("agent-workspace").hidden = false;
  document.getElementById("agent-sign-out").hidden = false;
  document.getElementById("agent-identity").textContent = agent.name + " · " + agent.senderEmail;
}
async function loadAgentThread(ticket, container) {
  const data = await agentPost("/api/support-team/thread", { ticketId: ticket.id });
  container.replaceChildren();
  container.append(agentNode("p", ticket.message, "support-thread-entry from-customer support-inbox-message"));
  data.messages.forEach((message) => {
    const entry = agentNode("article", "", "support-thread-entry " + (message.role === "customer" ? "from-customer" : "from-agent"));
    entry.append(agentNode("strong", (message.role === "customer" ? "Customer" : message.agentName || "Autody Support") + " · " + new Date(message.createdAt).toLocaleString()),
      agentNode("p", message.body, "support-inbox-message"));
    container.append(entry);
  });
}
function agentTicket(ticket) {
  const card = agentNode("article", "", "admin-record support-inbox-record");
  const heading = agentNode("div", "", "support-inbox-heading");
  heading.append(agentNode("strong", ticket.topic || ticket.category || "Support request"),
    agentNode("small", new Date(ticket.createdAt).toLocaleString()));
  card.append(heading, agentNode("p", (ticket.name || "Customer") + " · " + (ticket.email || "No email")),
    agentNode("p", ticket.message, "support-inbox-message"));
  const actions = agentNode("div", "", "support-inbox-actions");
  const statusLabel = agentNode("label", "Status ");
  const status = document.createElement("select");
  [["open", "Open"], ["in_progress", "In progress"], ["resolved", "Resolved"]].forEach(([value, label]) => status.append(new Option(label, value)));
  status.value = ticket.status || "open";
  status.addEventListener("change", async () => {
    try { await agentPost("/api/support-team/status", { ticketId: ticket.id, status: status.value }); ticket.status = status.value; agentNotice("Ticket status saved.", "success"); }
    catch (error) { status.value = ticket.status; agentNotice(error.message, "error"); }
  });
  statusLabel.append(status); actions.append(statusLabel);
  const toggle = agentNode("button", "Open conversation", "btn btn-ghost"); toggle.type = "button";
  const conversation = agentNode("div"); conversation.hidden = true;
  toggle.addEventListener("click", () => {
    conversation.hidden = !conversation.hidden;
    if (!conversation.hidden && !conversation.childElementCount) {
      const thread = agentNode("div", "Loading replies...", "support-thread");
      conversation.append(thread); loadAgentThread(ticket, thread).catch((error) => { thread.textContent = error.message; });
      const label = agentNode("label", "Your reply to " + (ticket.name || "the customer"));
      const textarea = document.createElement("textarea");
      textarea.rows = 5; textarea.maxLength = 4000; textarea.placeholder = "Write a clear response for the customer.";
      label.append(textarea); conversation.append(label);
      const preview = agentNode("div", "", "support-reply-preview"); preview.hidden = true;
      let pendingRequestId = null;
      textarea.addEventListener("input", () => { preview.hidden = true; pendingRequestId = null; });
      conversation.append(preview);
      const replyActions = agentNode("div", "", "support-inbox-actions");
      const previewButton = agentNode("button", "Preview email", "btn btn-ghost"); previewButton.type = "button";
      previewButton.addEventListener("click", () => {
        if (!textarea.value.trim()) return agentNotice("Write a reply first.", "error");
        preview.replaceChildren(agentNode("strong", "Email preview"),
          agentNode("p", "From: " + agentState.agent.name + " <" + agentState.agent.senderEmail + ">"),
          agentNode("p", "Subject: Re: " + (ticket.topic || ticket.category || "Your request") + " | Autody Support"),
          agentNode("p", "Hello,"), agentNode("p", textarea.value.trim(), "support-inbox-message"),
          agentNode("p", "Reply to this ticket: [customer's secure link]"),
          agentNode("p", agentState.agent.name + "\nAutody Support", "support-inbox-message"));
        preview.hidden = false;
      });
      const send = agentNode("button", "Send to customer", "btn"); send.type = "button";
      send.addEventListener("click", async () => {
        if (!textarea.value.trim() || preview.hidden) return agentNotice("Preview your reply before sending.", "error");
        pendingRequestId ||= crypto.randomUUID();
        try {
          send.disabled = true; send.textContent = "Sending...";
          await agentPost("/api/support-team/reply", { ticketId: ticket.id, requestId: pendingRequestId, message: textarea.value.trim() });
          textarea.value = ""; preview.hidden = true; pendingRequestId = null;
          await loadAgentThread(ticket, thread);
          agentNotice("Your reply was emailed and saved with this ticket.", "success");
        } catch (error) { agentNotice(error.message, "error"); }
        finally { send.disabled = false; send.textContent = "Send to customer"; }
      });
      replyActions.append(previewButton, send); conversation.append(replyActions);
    }
    toggle.textContent = conversation.hidden ? "Open conversation" : "Close conversation";
  });
  actions.append(toggle); card.append(actions, conversation); return card;
}
async function loadAgentTickets() {
  const result = await agentPost("/api/support-team/tickets", { status: document.getElementById("agent-status").value, limit: 500 });
  agentState.tickets = result.tickets || [];
  const list = document.getElementById("agent-tickets"); list.replaceChildren();
  if (agentState.tickets.length) agentState.tickets.forEach((ticket) => list.append(agentTicket(ticket)));
  else list.append(agentNode("p", "No tickets match these filters.", "admin-empty"));
  agentNotice("Your queue is up to date.", "success");
}
document.getElementById("agent-login").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget, button = form.querySelector("button");
  try {
    button.disabled = true;
    const result = await agentPost("/api/support-team/login/start", { email: form.elements.email.value.trim() }, false);
    agentState.challengeId = result.challengeId;
    form.hidden = true; document.getElementById("agent-code").hidden = false;
    document.querySelector("#agent-code input").focus();
    agentNotice("Access code sent. It expires in five minutes.", "success");
  } catch (error) { agentNotice(error.message, "error"); }
  finally { button.disabled = false; }
});
document.getElementById("agent-code").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget, button = form.querySelector("button");
  try {
    button.disabled = true;
    const result = await agentPost("/api/support-team/login/verify", { challengeId: agentState.challengeId, code: form.elements.code.value.trim() }, false);
    agentState.token = result.token; sessionStorage.setItem(AGENT_SESSION_KEY, JSON.stringify({ token: result.token }));
    showAgentWorkspace(result.agent); await loadAgentTickets();
  } catch (error) { agentNotice(error.message, "error"); }
  finally { button.disabled = false; }
});
document.getElementById("agent-code-back").addEventListener("click", () => {
  document.getElementById("agent-code").hidden = true; document.getElementById("agent-login").hidden = false;
});
document.getElementById("agent-sign-out").addEventListener("click", () => {
  sessionStorage.removeItem(AGENT_SESSION_KEY); agentState.token = "";
  document.getElementById("agent-workspace").hidden = true; document.getElementById("agent-login").hidden = false;
  document.getElementById("agent-sign-out").hidden = true;
});
document.getElementById("agent-refresh").addEventListener("click", () => loadAgentTickets().catch((error) => agentNotice(error.message, "error")));
document.getElementById("agent-status").addEventListener("change", () => loadAgentTickets().catch((error) => agentNotice(error.message, "error")));
restoreAgentSession();
if (agentState.token) agentPost("/api/support-team/session").then((result) => {
  if (result.role !== "agent") throw new Error("Agent session unavailable.");
  showAgentWorkspace(result.agent); return loadAgentTickets();
}).catch(() => { sessionStorage.removeItem(AGENT_SESSION_KEY); agentState.token = ""; });
