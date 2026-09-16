const test = require("node:test");
const assert = require("node:assert/strict");
const { registerSupportAgentRoutes } = require("./support-agents");

function makeHarness() {
  const handlers = new Map();
  const app = { post: (path, handler) => handlers.set(path, handler) };
  const ticketId = "b2a946dc-cf19-466c-9317-fd4f0d985d3a";
  let data = { supportTickets: [{
    id: ticketId, name: "Customer", email: "customer@example.com",
    category: "Access", topic: "Watchlist question", message: "Please help with my watchlist",
    status: "open", priority: "Normal", createdAt: new Date().toISOString()
  }], supportAgents: [], supportMessages: [], supportAgentChallenges: [], supportInboundEmails: [] };
  const sent = [];
  const received = [];
  const receivedDetails = new Map();
  registerSupportAgentRoutes(app, {
    dbPool: null, databaseConfigured: () => false,
    loadDemoDb: () => structuredClone(data), saveDemoDb: (next) => { data = next; },
    ensureSupportTicketTables: async () => {}, parseJsonBody: (req) => req.body,
    normalizeEmail: (value) => String(value || "").trim().toLowerCase(),
    normalizeText: (value) => String(value || "").trim(),
    adminRequestAuthorized: (req) => req.owner === true,
    requestAdminSessionToken: (req) => req.owner ? "owner" : "",
    verifyAdminSessionToken: (token) => token === "owner" ? { email: "owner@example.com" } : null,
    adminSessionSecret: "test-secret", resendApiKey: "test-api-key",
    adminEmail: "owner@example.com", supportFrom: "Autody Support <support@autodytraded.com>",
    appBaseUrl: () => "https://autodytraded.com",
    fetch: async (url, options) => {
      if (url.includes("/emails/receiving?")) return { ok: true, json: async () => ({ object: "list", data: received, has_more: false }) };
      if (url.includes("/emails/receiving/")) return { ok: true, json: async () => receivedDetails.get(url.split("/").at(-1)) };
      sent.push({ body: JSON.parse(options.body), headers: options.headers });
      return { ok: true, json: async () => ({ id: "email-" + sent.length }) };
    }
  });
  async function call(path, body = {}, auth = {}) {
    const req = { body, owner: Boolean(auth.owner), get: (name) => name === "authorization" && auth.token ? "Bearer " + auth.token : "" };
    const res = { statusCode: 200, status(value) { this.statusCode = value; return this; },
      json(payload) { this.payload = payload; return this; } };
    assert.ok(handlers.has(path), "route exists: " + path);
    await handlers.get(path)(req, res);
    return { status: res.statusCode, ...res.payload };
  }
  return { call, ticketId, sent, received, receivedDetails, data: () => data };
}

test("agent access remains scoped and its replies stay in the case email thread", async () => {
  const h = makeHarness();
  const created = await h.call("/api/support-team/agents/save", {
    name: "Stella Ray", senderEmail: "stella.ray@autodytraded.com", loginEmail: "stella@example.com"
  }, { owner: true });
  assert.equal(created.success, true);
  const agentId = created.agent.id;
  const assigned = await h.call("/api/support-team/assign", { ticketId: h.ticketId, agentId }, { owner: true });
  assert.equal(assigned.ticket.assignedAgentId, agentId);
  const start = await h.call("/api/support-team/login/start", { email: "stella@example.com" });
  assert.equal(start.success, true);
  const code = h.sent.at(-1).body.text.match(/\d{6}/)[0];
  const verified = await h.call("/api/support-team/login/verify", { challengeId: start.challengeId, code });
  assert.ok(verified.token);
  const queue = await h.call("/api/support-team/tickets", {}, { token: verified.token });
  assert.deepEqual(queue.tickets.map((ticket) => ticket.id), [h.ticketId]);
  const requestId = "5f90ffaf-6b49-402e-85ca-ac18b6973c9c";
  const reply = await h.call("/api/support-team/reply", {
    ticketId: h.ticketId, requestId, message: "I can help you set this up."
  }, { token: verified.token });
  assert.equal(reply.success, true);
  assert.match(h.sent.at(-1).body.from, /stella\.ray@autodytraded\.com/);
  const repeat = await h.call("/api/support-team/reply", {
    ticketId: h.ticketId, requestId, message: "I can help you set this up."
  }, { token: verified.token });
  assert.equal(repeat.alreadySent, true);
  assert.equal(h.sent.filter((mail) => mail.body.to === "customer@example.com").length, 1);
  assert.doesNotMatch(h.sent.at(-1).body.text, /support-reply|Reply to this ticket/);
  assert.match(h.sent.at(-1).body.subject, /\[Case b2a946dc\]/);
  const thread = await h.call("/api/support-team/thread", { ticketId: h.ticketId }, { token: verified.token });
  assert.deepEqual(thread.messages.map((message) => message.role), ["agent"]);
  const invalid = await h.call("/api/support/thread", { ticketId: h.ticketId, token: "wrong" });
  assert.equal(invalid.status, 403);
});

test("owner can reply as support@ without an agent or ticket assignment", async () => {
  const h = makeHarness();
  const requestId = "7a83286d-e0b2-4b86-8a88-08926998714e";
  const rejected = await h.call("/api/support-team/reply", {
    ticketId: h.ticketId, requestId, message: "Thanks for contacting us."
  });
  assert.equal(rejected.status, 403);
  const replied = await h.call("/api/support-team/reply", {
    ticketId: h.ticketId, requestId, message: "Thanks for contacting us."
  }, { owner: true });
  assert.equal(replied.success, true);
  assert.equal(replied.message.role, "support");
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].body.from, "The Autody Support Team <support@autodytraded.com>");
  assert.equal(h.sent[0].body.reply_to, "support@autodytraded.com");
  assert.doesNotMatch(h.sent[0].body.text, /^Hello,/);
  assert.match(h.sent[0].body.text, /\n\nThe Autody Support Team$/);
  assert.doesNotMatch(h.sent[0].body.text, /support-reply|Reply to this ticket/);
  const repeated = await h.call("/api/support-team/reply", {
    ticketId: h.ticketId, requestId, message: "Thanks for contacting us."
  }, { owner: true });
  assert.equal(repeated.alreadySent, true);
  assert.equal(h.sent.length, 1);
});

test("owner can save a received email as a ticket and answer it once", async () => {
  const h = makeHarness();
  const emailId = "63f41789-51e7-428e-b266-893190d8d8ed";
  const body = { requestId: emailId, email: "new@example.com", name: "New Customer",
    subject: "Account help", message: "I wrote to support@ with an account question." };
  const denied = await h.call("/api/support-team/import-email", body);
  assert.equal(denied.status, 403);
  const added = await h.call("/api/support-team/import-email", body, { owner: true });
  assert.equal(added.ticket.email, "new@example.com");
  const retry = await h.call("/api/support-team/import-email", body, { owner: true });
  assert.equal(retry.ticket.id, emailId);
  assert.equal(h.data().supportTickets.filter((ticket) => ticket.id === emailId).length, 1);
  const answered = await h.call("/api/support-team/reply", {
    ticketId: emailId, requestId: "13946b9a-51b5-4ee5-9da5-86bb46b76b75",
    message: "We can help with your account question."
  }, { owner: true });
  assert.equal(answered.success, true);
  assert.equal(h.sent[0].body.to, "new@example.com");
});

test("received mail becomes a case and ordinary email replies reopen it", async () => {
  const h = makeHarness();
  const firstId = "b99b5dad-383e-41ca-b4f9-62d9bb62fe1b";
  h.received.push({ id: firstId, to: ["support@autodytraded.com"],
    from: "Client <client@example.com>", subject: "Account access" });
  h.receivedDetails.set(firstId, { id: firstId, from: "Client <client@example.com>",
    to: ["support@autodytraded.com"], subject: "Account access",
    text: "I cannot access my account.", message_id: "<initial@example.com>", headers: { from: "Client <client@example.com>" } });
  const denied = await h.call("/api/support-team/sync-email");
  assert.equal(denied.status, 403);
  const synced = await h.call("/api/support-team/sync-email", {}, { owner: true });
  assert.equal(synced.imported, 1);
  assert.equal(h.data().supportTickets.find((ticket) => ticket.id === firstId).email, "client@example.com");
  const repeat = await h.call("/api/support-team/sync-email", {}, { owner: true });
  assert.equal(repeat.imported, 0);
  await h.call("/api/support-team/reply", { ticketId: firstId,
    requestId: "e3898727-d985-42c3-8718-f1a4fe20210d", message: "We can help you regain access." }, { owner: true });
  const customerEmail = h.sent.find((item) => item.body.to === "client@example.com").body;
  assert.equal(customerEmail.headers["In-Reply-To"], "<initial@example.com>");
  assert.match(customerEmail.subject, /\[Case b99b5dad\]/);
  assert.equal(customerEmail.reply_to, "support@autodytraded.com");
  await h.call("/api/support-team/status", { ticketId: firstId,
    status: "resolved", requestId: "89a2807b-5082-4482-8b42-5856b7d96512" }, { owner: true });
  const replyId = "e94e9a8c-b62d-4d43-bb0a-316bed846095";
  h.received.unshift({ id: replyId, to: ["support@autodytraded.com"],
    from: "client@example.com", subject: "Re: Account access [Case b99b5dad]" });
  h.receivedDetails.set(replyId, { id: replyId, to: ["support@autodytraded.com"],
    from: "client@example.com", subject: "Re: Account access [Case b99b5dad]",
    text: "I still need help.\nOn Monday Autody Support wrote:\n> old response",
    message_id: "<reply@example.com>", headers: { "in-reply-to": "<initial@example.com>" } });
  const ingested = await h.call("/api/support-team/sync-email", {}, { owner: true });
  assert.equal(ingested.imported, 1);
  assert.equal(h.data().supportTickets.filter((ticket) => ticket.email === "client@example.com").length, 1);
  assert.equal(h.data().supportTickets.find((ticket) => ticket.id === firstId).status, "open");
  const thread = await h.call("/api/support-team/thread", { ticketId: firstId }, { owner: true });
  assert.equal(thread.messages.at(-1).body, "I still need help.");
});

test("reply without the case tag stays in the same box, while a new subject starts a new case", async () => {
  const h = makeHarness();
  const replyId = "418fdf2b-4eb7-41b1-90fc-c449d0c8ad7e";
  h.received.push({ id: replyId, to: ["support@autodytraded.com"],
    from: "customer@example.com", subject: "Re: Watchlist question" });
  h.receivedDetails.set(replyId, { id: replyId, from: "customer@example.com",
    to: ["support@autodytraded.com"], subject: "Re: Watchlist question",
    text: "The watchlist still shows the old symbols.",
    message_id: "<watchlist-reply@example.com>", headers: { "in-reply-to": "<outbound@example.com>" } });
  const synced = await h.call("/api/support-team/sync-email", {}, { owner: true });
  assert.equal(synced.imported, 1);
  assert.equal(h.data().supportTickets.length, 1);
  const thread = await h.call("/api/support-team/thread", { ticketId: h.ticketId }, { owner: true });
  assert.equal(thread.messages.at(-1).body, "The watchlist still shows the old symbols.");
  const newId = "1e03f59c-e842-43d1-a80b-d99c86b42dba";
  h.received.unshift({ id: newId, to: ["support@autodytraded.com"],
    from: "customer@example.com", subject: "Billing question" });
  h.receivedDetails.set(newId, { id: newId, from: "customer@example.com",
    to: ["support@autodytraded.com"], subject: "Billing question",
    text: "I have a different billing question.", message_id: "<billing@example.com>", headers: {} });
  await h.call("/api/support-team/sync-email", {}, { owner: true });
  assert.equal(h.data().supportTickets.length, 2);
});

test("existing duplicate case boxes combine their messages into the first case", async () => {
  const h = makeHarness();
  const duplicateId = "2ec7a1f2-c917-40f7-b22e-4ae2d94360e7";
  const secondMessageId = "7048196a-e407-4b61-98eb-957b9b0304c4";
  h.data().supportTickets.push({ id: duplicateId, name: "Customer", email: "customer@example.com",
    category: "Email", topic: "Re: Watchlist question", message: "The issue is still there.",
    status: "open", priority: "normal", createdAt: new Date(Date.now() + 1000).toISOString() });
  h.data().supportMessages.push({ id: secondMessageId, ticketId: duplicateId,
    role: "support", agentId: null, agentName: "Autody Support", body: "We are investigating.",
    createdAt: new Date(Date.now() + 2000).toISOString() });
  h.data().supportInboundEmails.push({ id: duplicateId, ticketId: duplicateId,
    messageId: "<duplicate@example.com>" });
  const inbox = await h.call("/api/support-team/tickets", {}, { owner: true });
  assert.equal(inbox.tickets.length, 1);
  assert.equal(inbox.tickets[0].id, h.ticketId);
  const thread = await h.call("/api/support-team/thread", { ticketId: h.ticketId }, { owner: true });
  assert.deepEqual(thread.messages.map((message) => message.body), ["The issue is still there.", "We are investigating."]);
  assert.equal(h.data().supportInboundEmails[0].ticketId, h.ticketId);
  const nextId = "84cf38b6-1f81-4533-bda4-3a0214376378";
  h.received.push({ id: nextId, from: "customer@example.com",
    to: ["support@autodytraded.com"], subject: "Re: Watchlist question [Case 2ec7a1f2]" });
  h.receivedDetails.set(nextId, { id: nextId, from: "customer@example.com",
    to: ["support@autodytraded.com"], subject: "Re: Watchlist question [Case 2ec7a1f2]",
    text: "One more question on this issue.", message_id: "<later@example.com>", headers: {} });
  await h.call("/api/support-team/sync-email", {}, { owner: true });
  assert.equal(h.data().supportTickets.length, 1);
  assert.equal(h.data().supportMessages.at(-1).ticketId, h.ticketId);
});

test("closing a case sends one plain closure email for the chosen reason", async () => {
  const h = makeHarness();
  const id = "40eaf18d-8d4e-4d49-961d-61e1963ca22e";
  const resolved = await h.call("/api/support-team/status", {
    ticketId: h.ticketId, status: "resolved", requestId: id
  }, { owner: true });
  assert.equal(resolved.ticket.status, "resolved");
  assert.match(h.sent.at(-1).body.text, /resolved and closed/);
  assert.doesNotMatch(h.sent.at(-1).body.text, /^Hello,/);
  assert.match(h.sent.at(-1).body.text, /\n\nThe Autody Support Team$/);
  assert.doesNotMatch(h.sent.at(-1).body.text, /support-reply|secure link/);
  await h.call("/api/support-team/status", { ticketId: h.ticketId,
    status: "resolved", requestId: id }, { owner: true });
  assert.equal(h.sent.length, 1);
  await h.call("/api/support-team/status", { ticketId: h.ticketId, status: "open" }, { owner: true });
  await h.call("/api/support-team/status", { ticketId: h.ticketId,
    status: "closed_no_response", requestId: "e62a3fae-0acf-4da8-b1b2-870317d8c068" }, { owner: true });
  assert.match(h.sent.at(-1).body.text, /not heard back/);
  assert.equal(h.sent.at(-1).body.reply_to, "support@autodytraded.com");
  const filtered = await h.call("/api/support-team/tickets", { status: "closed_no_response" }, { owner: true });
  assert.deepEqual(filtered.tickets.map((ticket) => ticket.id), [h.ticketId]);
});

test("agent access stays limited to assigned tickets and stops when the owner deactivates the profile", async () => {
  const h = makeHarness();
  const created = await h.call("/api/support-team/agents/save", {
    name: "Johnny", senderEmail: "johnny@autodytraded.com", loginEmail: "johnny@example.com"
  }, { owner: true });
  const start = await h.call("/api/support-team/login/start", { email: "johnny@example.com" });
  const code = h.sent.at(-1).body.text.match(/\d{6}/)[0];
  const token = (await h.call("/api/support-team/login/verify", { challengeId: start.challengeId, code })).token;
  const roster = await h.call("/api/support-team/agents", {}, { token });
  assert.equal(roster.status, 403);
  const unassigned = await h.call("/api/support-team/thread", { ticketId: h.ticketId }, { token });
  assert.equal(unassigned.status, 403);
  await h.call("/api/support-team/agents/save", {
    id: created.agent.id, name: "Johnny", senderEmail: "johnny@autodytraded.com",
    loginEmail: "johnny@example.com", active: false
  }, { owner: true });
  const revoked = await h.call("/api/support-team/session", {}, { token });
  assert.equal(revoked.status, 403);
});
