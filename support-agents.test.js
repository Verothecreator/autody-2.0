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
  }], supportAgents: [], supportMessages: [], supportAgentChallenges: [] };
  const sent = [];
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
    fetch: async (_url, options) => {
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
  return { call, ticketId, sent, data: () => data };
}

test("owner creates an agent, assigns a ticket, and the agent replies while customers can continue the thread", async () => {
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
  const link = h.sent.find((mail) => mail.body.to === "customer@example.com").body.text.match(/https:\/\/autodytraded\.com\/support-reply\?\S+/)[0];
  const token = new URL(link).searchParams.get("token");
  const customer = await h.call("/api/support/reply", { ticketId: h.ticketId, token, message: "Thank you. I still need help." });
  assert.equal(customer.success, true);
  const thread = await h.call("/api/support-team/thread", { ticketId: h.ticketId }, { token: verified.token });
  assert.deepEqual(thread.messages.map((message) => message.role), ["agent", "customer"]);
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
  assert.equal(h.sent[0].body.from, "Autody Support <support@autodytraded.com>");
  assert.equal(h.sent[0].body.reply_to, "support@autodytraded.com");
  assert.match(h.sent[0].body.text, /support-reply\?/);
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
