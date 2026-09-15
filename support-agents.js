const crypto = require("crypto");

function registerSupportAgentRoutes(app, deps) {
  const {
    dbPool, databaseConfigured, loadDemoDb, saveDemoDb,
    ensureSupportTicketTables, parseJsonBody, normalizeEmail, normalizeText,
    adminRequestAuthorized, requestAdminSessionToken, verifyAdminSessionToken,
    adminSessionSecret, resendApiKey, adminEmail, supportFrom, appBaseUrl, fetch: sendFetch
  } = deps;
  const agentDomain = "autodytraded.com";
  const codeMinutes = 5;
  const sessionHours = 8;

  function fail(status, message) {
    const error = new Error(message);
    error.status = status;
    throw error;
  }
  function sendError(res, error) {
    if (error.status >= 400 && error.status < 504) return res.status(error.status).json({ success: false, error: error.message });
    console.error("Support team error:", error);
    return res.status(500).json({ success: false, error: "Support request could not be completed." });
  }
  const safe = (value) => String(value || "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
  const validId = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ""));
  const displayAgent = (agent) => agent && ({
    id: agent.id, name: agent.name, senderEmail: agent.sender_email ?? agent.senderEmail,
    loginEmail: agent.login_email ?? agent.loginEmail,
    active: agent.active !== false, createdAt: agent.created_at ?? agent.createdAt
  });
  const displayMessage = (message) => ({
    id: message.id, role: message.author_role ?? message.role,
    agentName: message.agent_name ?? message.agentName ?? "",
    body: message.body, createdAt: message.created_at ?? message.createdAt,
    delivered: Boolean(message.resend_id ?? message.resendId)
  });
  const displayTicket = (ticket) => ({
    id: ticket.id, name: ticket.contact_name ?? ticket.name, email: ticket.contact_email ?? ticket.email,
    accountMode: ticket.account_mode ?? ticket.accountMode,
    category: ticket.category, topic: ticket.topic, priority: ticket.priority,
    message: ticket.message, status: ticket.status,
    assignedAgentId: ticket.assigned_agent_id ?? ticket.assignedAgentId ?? null,
    assignedAgentName: ticket.agent_name ?? ticket.assignedAgentName ?? "",
    createdAt: ticket.created_at ?? ticket.createdAt, updatedAt: ticket.updated_at ?? ticket.updatedAt
  });

  let tablesReady = null;
  async function ensureTables() {
    if (!databaseConfigured()) return;
    if (!tablesReady) tablesReady = (async () => {
      await ensureSupportTicketTables();
      await dbPool.query(`
      create table if not exists support_agents (
        id uuid primary key,
        name text not null,
        sender_email text not null unique,
        login_email text not null unique,
        active boolean not null default true,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
      alter table support_tickets add column if not exists assigned_agent_id uuid references support_agents(id) on delete set null;
      create index if not exists support_tickets_agent_idx on support_tickets (assigned_agent_id, created_at desc);
      create table if not exists support_agent_challenges (
        id uuid primary key,
        agent_id uuid not null references support_agents(id) on delete cascade,
        code_salt text not null,
        code_hash text not null,
        attempts integer not null default 0,
        status text not null default 'pending',
        expires_at timestamptz not null,
        created_at timestamptz not null default now()
      );
      create index if not exists support_agent_challenges_recent_idx on support_agent_challenges (agent_id, created_at desc);
      create table if not exists support_messages (
        id uuid primary key,
        ticket_id uuid not null references support_tickets(id) on delete cascade,
        author_role text not null,
        author_agent_id uuid references support_agents(id) on delete set null,
        agent_name text not null default '',
        body text not null,
        resend_id text,
        created_at timestamptz not null default now()
      );
      create index if not exists support_messages_ticket_idx on support_messages (ticket_id, created_at asc);
      `);
    })().catch((error) => { tablesReady = null; throw error; });
    await tablesReady;
  }
  function jsonData() {
    const data = loadDemoDb();
    data.supportAgents = Array.isArray(data.supportAgents) ? data.supportAgents : [];
    data.supportAgentChallenges = Array.isArray(data.supportAgentChallenges) ? data.supportAgentChallenges : [];
    data.supportMessages = Array.isArray(data.supportMessages) ? data.supportMessages : [];
    data.supportTickets = Array.isArray(data.supportTickets) ? data.supportTickets : [];
    return data;
  }
  async function agents() {
    if (databaseConfigured()) {
      await ensureTables();
      return (await dbPool.query("select * from support_agents order by created_at asc")).rows;
    }
    return jsonData().supportAgents;
  }
  async function agentById(id) {
    if (!validId(id)) return null;
    return (await agents()).find((row) => row.id === id) || null;
  }
  async function ticketById(id) {
    if (!validId(id)) fail(400, "Choose a valid support ticket.");
    if (databaseConfigured()) {
      await ensureTables();
      const result = await dbPool.query(`select t.*, a.name as agent_name
        from support_tickets t left join support_agents a on a.id = t.assigned_agent_id
        where t.id = $1`, [id]);
      return result.rows[0] || null;
    }
    const data = jsonData();
    const ticket = data.supportTickets.find((row) => row.id === id);
    if (!ticket) return null;
    const agent = data.supportAgents.find((row) => row.id === ticket.assignedAgentId);
    return { ...ticket, agentName: agent?.name || "" };
  }
  async function messagesFor(id) {
    if (databaseConfigured()) {
      await ensureTables();
      return (await dbPool.query("select * from support_messages where ticket_id = $1 order by created_at asc", [id])).rows;
    }
    return jsonData().supportMessages.filter((row) => row.ticketId === id)
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  }
  function signedAgentToken(agent) {
    if (!adminSessionSecret) fail(503, "Support agent sign-in is not configured.");
    const payload = Buffer.from(JSON.stringify({
      scope: "autody-support-agent", id: agent.id,
      email: agent.login_email ?? agent.loginEmail,
      exp: Date.now() + sessionHours * 3600000
    })).toString("base64url");
    const signature = crypto.createHmac("sha256", adminSessionSecret).update("support:" + payload).digest("base64url");
    return payload + "." + signature;
  }
  function verifiedAgentToken(token) {
    const [payload, signature] = String(token || "").split(".");
    if (!payload || !signature || !adminSessionSecret) return null;
    const expected = crypto.createHmac("sha256", adminSessionSecret).update("support:" + payload).digest("base64url");
    const a = Buffer.from(expected), b = Buffer.from(signature);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    try {
      const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
      return data.scope === "autody-support-agent" && data.exp > Date.now() ? data : null;
    } catch { return null; }
  }
  async function actor(req, body) {
    const ownerSession = verifyAdminSessionToken(requestAdminSessionToken(req, body));
    if (ownerSession && adminRequestAuthorized(req, body)) return { role: "admin", email: ownerSession.email };
    const token = String(req.get("authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1];
    const payload = verifiedAgentToken(token);
    if (!payload) fail(403, "Support access is not authorized.");
    const agent = await agentById(payload.id);
    if (!agent || agent.active === false || (agent.login_email ?? agent.loginEmail) !== payload.email) fail(403, "Support agent access is no longer active.");
    return { role: "agent", agent };
  }
  function requireOwner(req, body) {
    if (!adminRequestAuthorized(req, body)) fail(403, "Owner access is required.");
  }
  function canWorkTicket(user, ticket) {
    if (!ticket) fail(404, "Support ticket was not found.");
    if (user.role === "agent" && (ticket.assigned_agent_id ?? ticket.assignedAgentId) !== user.agent.id) fail(403, "This ticket is assigned to another agent.");
  }
  function customerToken(ticket) {
    if (!adminSessionSecret) fail(503, "Customer reply links are unavailable.");
    const email = normalizeEmail(ticket.contact_email ?? ticket.email);
    return crypto.createHmac("sha256", adminSessionSecret).update("customer:" + ticket.id + ":" + email).digest("base64url");
  }
  function checkCustomerToken(ticket, token) {
    if (!ticket || !token) fail(403, "This support reply link is invalid.");
    const expected = Buffer.from(customerToken(ticket));
    const supplied = Buffer.from(String(token));
    if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) fail(403, "This support reply link is invalid.");
  }
  function customerUrl(req, ticket) {
    const query = new URLSearchParams({ ticket: ticket.id, token: customerToken(ticket) });
    return appBaseUrl(req) + "/support-reply?" + query;
  }
  async function sendEmail(message, requestId) {
    if (!resendApiKey) fail(503, "Support email delivery is not connected.");
    const response = await sendFetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + resendApiKey,
        "Content-Type": "application/json",
        ...(requestId ? { "Idempotency-Key": "autody-support-" + requestId } : {})
      },
      body: JSON.stringify(message)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.id) fail(502, result.message || "Support email was not accepted.");
    return result.id;
  }
  async function saveMessage(message) {
    if (databaseConfigured()) {
      await ensureTables();
      await dbPool.query(`insert into support_messages
        (id, ticket_id, author_role, author_agent_id, agent_name, body, resend_id)
        values ($1, $2, $3, $4, $5, $6, $7) on conflict (id) do nothing`,
      [message.id, message.ticketId, message.role, message.agentId, message.agentName, message.body, message.resendId]);
      return;
    }
    const data = jsonData();
    if (!data.supportMessages.some((row) => row.id === message.id)) data.supportMessages.push(message);
    saveDemoDb(data);
  }
  async function existingMessage(id, ticketId) {
    if (databaseConfigured()) {
      await ensureTables();
      return (await dbPool.query("select * from support_messages where id = $1 and ticket_id = $2", [id, ticketId])).rows[0] || null;
    }
    return jsonData().supportMessages.find((row) => row.id === id && row.ticketId === ticketId) || null;
  }

  app.post("/api/support-team/agents", async (req, res) => {
    try {
      const body = parseJsonBody(req); requireOwner(req, body);
      return res.json({ success: true, agents: (await agents()).map(displayAgent) });
    } catch (error) { return sendError(res, error); }
  });
  app.post("/api/support-team/agents/save", async (req, res) => {
    try {
      const body = parseJsonBody(req); requireOwner(req, body);
      const id = body.id ? String(body.id) : crypto.randomUUID();
      if (!validId(id)) fail(400, "Choose a valid agent.");
      const name = normalizeText(body.name).slice(0, 80);
      const senderEmail = normalizeEmail(body.senderEmail);
      const loginEmail = normalizeEmail(body.loginEmail);
      const active = body.active !== false;
      if (name.length < 2 || !/^[a-z0-9][a-z0-9._+-]*@autodytraded\.com$/.test(senderEmail) || !loginEmail) {
        fail(400, "Enter an agent name, an @autodytraded.com sender, and a reachable sign-in email.");
      }
      let agent;
      if (databaseConfigured()) {
        await ensureTables();
        const result = await dbPool.query(`insert into support_agents (id, name, sender_email, login_email, active)
          values ($1, $2, $3, $4, $5)
          on conflict (id) do update set name = excluded.name, sender_email = excluded.sender_email,
          login_email = excluded.login_email, active = excluded.active, updated_at = now()
          returning *`, [id, name, senderEmail, loginEmail, active]);
        agent = result.rows[0];
      } else {
        const data = jsonData();
        if (data.supportAgents.some((row) => row.id !== id && (row.senderEmail === senderEmail || row.loginEmail === loginEmail))) fail(409, "That agent email is already in use.");
        agent = data.supportAgents.find((row) => row.id === id);
        if (agent) Object.assign(agent, { name, senderEmail, loginEmail, active, updatedAt: new Date().toISOString() });
        else { agent = { id, name, senderEmail, loginEmail, active, createdAt: new Date().toISOString() }; data.supportAgents.push(agent); }
        saveDemoDb(data);
      }
      return res.json({ success: true, agent: displayAgent(agent) });
    } catch (error) {
      if (error.code === "23505") return res.status(409).json({ success: false, error: "That agent email is already in use." });
      return sendError(res, error);
    }
  });
  app.post("/api/support-team/login/start", async (req, res) => {
    try {
      const body = parseJsonBody(req);
      const loginEmail = normalizeEmail(body.email);
      const agent = (await agents()).find((row) => (row.login_email ?? row.loginEmail) === loginEmail && row.active !== false);
      if (!agent) fail(401, "No active support agent uses that sign-in email.");
      if (!resendApiKey || !adminSessionSecret) fail(503, "Agent email sign-in is not configured.");
      const code = String(crypto.randomInt(100000, 1000000));
      const salt = crypto.randomBytes(16).toString("hex");
      const item = { id: crypto.randomUUID(), agentId: agent.id, codeSalt: salt,
        codeHash: crypto.createHash("sha256").update(salt + ":" + code).digest("hex"),
        expiresAt: new Date(Date.now() + codeMinutes * 60000).toISOString(), attempts: 0, status: "pending", createdAt: new Date().toISOString() };
      if (databaseConfigured()) {
        await ensureTables();
        const recent = await dbPool.query("select count(*)::int as n from support_agent_challenges where agent_id = $1 and created_at > now() - interval '15 minutes'", [agent.id]);
        if (recent.rows[0].n >= 3) fail(429, "Too many codes requested. Try again in 15 minutes.");
        await dbPool.query("update support_agent_challenges set status = 'replaced' where agent_id = $1 and status = 'pending'", [agent.id]);
        await dbPool.query(`insert into support_agent_challenges (id, agent_id, code_salt, code_hash, expires_at)
          values ($1, $2, $3, $4, $5)`, [item.id, agent.id, item.codeSalt, item.codeHash, item.expiresAt]);
      } else {
        const data = jsonData();
        const recent = data.supportAgentChallenges.filter((row) => row.agentId === agent.id && Date.parse(row.createdAt) > Date.now() - 15 * 60000);
        if (recent.length >= 3) fail(429, "Too many codes requested. Try again in 15 minutes.");
        data.supportAgentChallenges.forEach((row) => { if (row.agentId === agent.id && row.status === "pending") row.status = "replaced"; });
        data.supportAgentChallenges.push(item);
        data.supportAgentChallenges = data.supportAgentChallenges.slice(-200);
        saveDemoDb(data);
      }
      try {
        await sendEmail({ from: supportFrom, to: loginEmail,
          subject: "Your Autody support agent access code",
          text: "Your Autody support agent access code is " + code + ". It expires in 5 minutes.",
          html: "<p>Your Autody support agent access code is <strong>" + code + "</strong>. It expires in 5 minutes.</p>"
        }, item.id);
      } catch (error) {
        if (databaseConfigured()) await dbPool.query("update support_agent_challenges set status = 'delivery_failed' where id = $1", [item.id]);
        else { const data = jsonData(); const row = data.supportAgentChallenges.find((x) => x.id === item.id); if (row) row.status = "delivery_failed"; saveDemoDb(data); }
        throw error;
      }
      return res.json({ success: true, challengeId: item.id, expiresAt: item.expiresAt });
    } catch (error) { return sendError(res, error); }
  });
  app.post("/api/support-team/login/verify", async (req, res) => {
    try {
      const body = parseJsonBody(req);
      const id = String(body.challengeId || ""), code = String(body.code || "").trim();
      if (!validId(id) || !/^\d{6}$/.test(code)) fail(400, "Enter the six-digit agent code.");
      let item;
      if (databaseConfigured()) {
        await ensureTables();
        item = (await dbPool.query("select * from support_agent_challenges where id = $1", [id])).rows[0];
      } else item = jsonData().supportAgentChallenges.find((row) => row.id === id);
      if (!item || item.status !== "pending" || Date.parse(item.expires_at ?? item.expiresAt) <= Date.now() || item.attempts >= 5) fail(401, "Agent code expired or unavailable.");
      const salt = item.code_salt ?? item.codeSalt;
      const expected = Buffer.from(item.code_hash ?? item.codeHash, "hex");
      const actual = Buffer.from(crypto.createHash("sha256").update(salt + ":" + code).digest("hex"), "hex");
      if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
        if (databaseConfigured()) await dbPool.query("update support_agent_challenges set attempts = attempts + 1 where id = $1", [id]);
        else { const data = jsonData(); const row = data.supportAgentChallenges.find((x) => x.id === id); row.attempts += 1; saveDemoDb(data); }
        fail(401, "Agent code is incorrect.");
      }
      const agent = await agentById(item.agent_id ?? item.agentId);
      if (!agent || agent.active === false) fail(403, "This support agent is inactive.");
      if (databaseConfigured()) {
        const claimed = await dbPool.query("update support_agent_challenges set status = 'verified' where id = $1 and status = 'pending' returning id", [id]);
        if (!claimed.rows.length) fail(401, "Agent code was already used.");
      } else {
        const data = jsonData(), row = data.supportAgentChallenges.find((x) => x.id === id);
        if (row.status !== "pending") fail(401, "Agent code was already used.");
        row.status = "verified"; saveDemoDb(data);
      }
      return res.json({ success: true, token: signedAgentToken(agent), agent: displayAgent(agent) });
    } catch (error) { return sendError(res, error); }
  });
  app.post("/api/support-team/session", async (req, res) => {
    try {
      const user = await actor(req, parseJsonBody(req));
      return res.json({ success: true, role: user.role, agent: user.agent ? displayAgent(user.agent) : null });
    } catch (error) { return sendError(res, error); }
  });
  app.post("/api/support-team/tickets", async (req, res) => {
    try {
      const body = parseJsonBody(req), user = await actor(req, body);
      const status = ["open", "in_progress", "resolved"].includes(body.status) ? body.status : "";
      const search = normalizeText(body.search).toLowerCase().slice(0, 120);
      const limit = Math.min(500, Math.max(1, Number(body.limit) || 100));
      let tickets;
      if (databaseConfigured()) {
        await ensureTables();
        tickets = (await dbPool.query(`select t.*, a.name as agent_name from support_tickets t
          left join support_agents a on a.id = t.assigned_agent_id
          where ($1::uuid is null or t.assigned_agent_id = $1::uuid)
            and ($2::text = '' or t.status = $2)
            and ($3::text = '' or lower(t.contact_email || ' ' || t.topic || ' ' || t.message) like $3)
          order by t.created_at desc limit $4`,
          [user.role === "agent" ? user.agent.id : null, status, search ? "%" + search + "%" : "", limit])).rows;
      } else {
        const data = jsonData();
        tickets = data.supportTickets.filter((row) =>
          (user.role !== "agent" || row.assignedAgentId === user.agent.id) &&
          (!status || row.status === status) &&
          (!search || (row.email + " " + row.topic + " " + row.message).toLowerCase().includes(search))).slice(0, limit)
          .map((row) => ({ ...row, agentName: data.supportAgents.find((agent) => agent.id === row.assignedAgentId)?.name || "" }));
      }
      return res.json({ success: true, tickets: tickets.map(displayTicket), role: user.role });
    } catch (error) { return sendError(res, error); }
  });
  app.post("/api/support-team/assign", async (req, res) => {
    try {
      const body = parseJsonBody(req); requireOwner(req, body);
      const ticket = await ticketById(body.ticketId);
      if (!ticket) fail(404, "Support ticket was not found.");
      const agentId = body.agentId || null;
      const agent = agentId ? await agentById(agentId) : null;
      if (agentId && (!agent || agent.active === false)) fail(400, "Choose an active agent.");
      if (databaseConfigured()) await dbPool.query("update support_tickets set assigned_agent_id = $2, updated_at = now() where id = $1", [ticket.id, agentId]);
      else { const data = jsonData(); const row = data.supportTickets.find((x) => x.id === ticket.id); row.assignedAgentId = agentId; row.updatedAt = new Date().toISOString(); saveDemoDb(data); }
      if (agent && agentId !== (ticket.assigned_agent_id ?? ticket.assignedAgentId) && resendApiKey) {
        const loginEmail = agent.login_email ?? agent.loginEmail;
        await sendEmail({ from: supportFrom, to: loginEmail,
          subject: "Autody support ticket assigned",
          text: "A customer support ticket has been assigned to you.\n\nTopic: " + (ticket.topic || ticket.category) +
            "\n\nOpen your support queue: " + appBaseUrl(req) + "/support-agent",
          html: "<p>A customer support ticket has been assigned to you.</p><p>Topic: " + safe(ticket.topic || ticket.category) + "</p><p><a href='" + safe(appBaseUrl(req) + "/support-agent") + "'>Open your support queue</a></p>"
        }, crypto.randomUUID()).catch((error) => console.error("Agent assignment alert failed:", error.message));
      }
      return res.json({ success: true, ticket: displayTicket(await ticketById(ticket.id)) });
    } catch (error) { return sendError(res, error); }
  });
  app.post("/api/support-team/status", async (req, res) => {
    try {
      const body = parseJsonBody(req), user = await actor(req, body);
      const ticket = await ticketById(body.ticketId); canWorkTicket(user, ticket);
      const status = String(body.status || "");
      if (!["open", "in_progress", "resolved"].includes(status)) fail(400, "Choose a valid ticket status.");
      if (databaseConfigured()) await dbPool.query("update support_tickets set status = $2, updated_at = now(), resolved_at = case when $2 = 'resolved' then now() else null end where id = $1", [ticket.id, status]);
      else { const data = jsonData(); const row = data.supportTickets.find((x) => x.id === ticket.id); row.status = status; row.updatedAt = new Date().toISOString(); saveDemoDb(data); }
      return res.json({ success: true, ticket: displayTicket(await ticketById(ticket.id)) });
    } catch (error) { return sendError(res, error); }
  });
  app.post("/api/support-team/thread", async (req, res) => {
    try {
      const body = parseJsonBody(req), user = await actor(req, body);
      const ticket = await ticketById(body.ticketId); canWorkTicket(user, ticket);
      return res.json({ success: true, ticket: displayTicket(ticket), messages: (await messagesFor(ticket.id)).map(displayMessage) });
    } catch (error) { return sendError(res, error); }
  });
  app.post("/api/support-team/reply", async (req, res) => {
    try {
      const body = parseJsonBody(req), user = await actor(req, body);
      const ticket = await ticketById(body.ticketId); canWorkTicket(user, ticket);
      const sender = user.role === "agent" ? user.agent : await agentById(body.agentId);
      if (!sender || sender.active === false) fail(400, "Choose an active agent to send this reply.");
      if (user.role === "admin" && (ticket.assigned_agent_id ?? ticket.assignedAgentId) !== sender.id) fail(400, "Assign this ticket to the sending agent first.");
      const text = normalizeText(body.message).slice(0, 4000);
      const id = String(body.requestId || "");
      if (!validId(id) || text.length < 2) fail(400, "Write a reply and try again.");
      const prior = await existingMessage(id, ticket.id);
      if (prior) return res.json({ success: true, message: displayMessage(prior), alreadySent: true });
      const to = normalizeEmail(ticket.contact_email ?? ticket.email);
      if (!to) fail(400, "This ticket has no customer email.");
      const name = normalizeText(sender.name).replace(/[<>\r\n]/g, "").slice(0, 80);
      const from = name + " <" + (sender.sender_email ?? sender.senderEmail) + ">";
      const link = customerUrl(req, ticket);
      const subject = "Re: " + (ticket.topic || ticket.category || "Your request").slice(0, 120) + " | Autody Support";
      const emailText = "Hello,\n\n" + text + "\n\nReply to this ticket: " + link + "\n\n" + name + "\nAutody Support";
      const html = "<div style='font-family:Arial,sans-serif;line-height:1.55;color:#111827'>" +
        "<p>Hello,</p><p style='white-space:pre-wrap'>" + safe(text) + "</p>" +
        "<p><a href='" + safe(link) + "'>Reply to this ticket</a></p><p>" + safe(name) + "<br>Autody Support</p></div>";
      const replyTo = normalizeEmail(process.env.EMAIL_SUPPORT_REPLY_TO || process.env.EMAIL_SUPPORT_INBOX_TO || adminEmail);
      const resendId = await sendEmail({ from, to, subject, text: emailText, html,
        ...(replyTo ? { reply_to: replyTo } : {}) }, id);
      await saveMessage({ id, ticketId: ticket.id, role: "agent", agentId: sender.id,
        agentName: name, body: text, resendId, createdAt: new Date().toISOString() });
      return res.json({ success: true, message: displayMessage(await existingMessage(id, ticket.id)) });
    } catch (error) { return sendError(res, error); }
  });
  app.post("/api/support/thread", async (req, res) => {
    try {
      const body = parseJsonBody(req), ticket = await ticketById(body.ticketId);
      checkCustomerToken(ticket, body.token);
      return res.json({ success: true, ticket: { id: ticket.id, topic: ticket.topic, status: ticket.status, message: ticket.message },
        messages: (await messagesFor(ticket.id)).map(displayMessage) });
    } catch (error) { return sendError(res, error); }
  });
  app.post("/api/support/reply", async (req, res) => {
    try {
      const body = parseJsonBody(req), ticket = await ticketById(body.ticketId);
      checkCustomerToken(ticket, body.token);
      const text = normalizeText(body.message).slice(0, 4000);
      if (text.length < 6) fail(400, "Write a short reply before sending.");
      const recent = (await messagesFor(ticket.id)).filter((row) => (row.author_role ?? row.role) === "customer" &&
        Date.parse(row.created_at ?? row.createdAt) > Date.now() - 3600000);
      if (recent.length >= 6) fail(429, "Please wait before sending another reply.");
      const message = { id: crypto.randomUUID(), ticketId: ticket.id, role: "customer",
        agentId: null, agentName: "", body: text, resendId: null, createdAt: new Date().toISOString() };
      await saveMessage(message);
      if (databaseConfigured()) await dbPool.query("update support_tickets set status = 'open', resolved_at = null, updated_at = now() where id = $1", [ticket.id]);
      else { const data = jsonData(); const row = data.supportTickets.find((x) => x.id === ticket.id); row.status = "open"; row.updatedAt = new Date().toISOString(); saveDemoDb(data); }
      const agent = await agentById(ticket.assigned_agent_id ?? ticket.assignedAgentId);
      const alertTo = normalizeEmail(agent?.login_email ?? agent?.loginEmail ?? process.env.EMAIL_SUPPORT_INBOX_TO ?? adminEmail);
      const queueUrl = appBaseUrl(req) + (agent ? "/support-agent" : "/admin-support");
      if (resendApiKey && alertTo) {
        await sendEmail({ from: supportFrom, to: alertTo, subject: "Customer replied to an Autody support ticket",
          text: "A customer replied to ticket " + ticket.id + ".\n\n" + text + "\n\nOpen the support queue: " + queueUrl,
          html: "<p>A customer replied to ticket " + safe(ticket.id) + ".</p><p style='white-space:pre-wrap'>" + safe(text) +
            "</p><p><a href='" + safe(queueUrl) + "'>Open the support queue</a></p>"
        }, message.id).catch((error) => console.error("Customer support reply alert failed:", error.message));
      }
      return res.json({ success: true, message: displayMessage(message) });
    } catch (error) { return sendError(res, error); }
  });
}

module.exports = { registerSupportAgentRoutes };
