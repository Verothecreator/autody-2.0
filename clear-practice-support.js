const fs = require("fs");
const path = require("path");

// Only cases that existed when the owner requested the practice inbox reset.
const cutoff = new Date("2026-09-16T01:11:11.000Z");

function clearJsonTickets(data) {
  const tickets = Array.isArray(data.supportTickets) ? data.supportTickets : [];
  const removed = new Set(tickets.filter((ticket) => {
    const date = new Date(ticket.createdAt ?? ticket.created_at ?? 0);
    return Number.isFinite(date.getTime()) && date <= cutoff;
  }).map((ticket) => ticket.id));
  const cleared = new Set(data.supportClearedInboundEmails || []);
  for (const row of data.supportInboundEmails || []) if (removed.has(row.ticketId)) cleared.add(row.id);
  return { count: removed.size, data: {
    ...data,
    supportTickets: tickets.filter((row) => !removed.has(row.id)),
    supportMessages: (data.supportMessages || []).filter((row) => !removed.has(row.ticketId)),
    supportInboundEmails: (data.supportInboundEmails || []).filter((row) => !removed.has(row.ticketId)),
    supportTicketMerges: (data.supportTicketMerges || []).filter((row) => !removed.has(row.canonicalTicketId)),
    supportClearedInboundEmails: [...cleared]
  } };
}

async function clearDatabase(connectionString) {
  const { Pool } = require("pg");
  const pool = new Pool({ connectionString,
    ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000 });
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`create table if not exists support_cleared_inbound_emails (
      id uuid primary key, cleared_at timestamptz not null default now()
    )`);
    const table = (await client.query("select to_regclass('support_tickets') as name")).rows[0]?.name;
    if (!table) { await client.query("commit"); return 0; }
    const inbound = (await client.query("select to_regclass('support_inbound_emails') as name")).rows[0]?.name;
    if (inbound) await client.query(`insert into support_cleared_inbound_emails (id)
      select i.id from support_inbound_emails i join support_tickets t on t.id = i.ticket_id
      where t.created_at <= $1 on conflict (id) do nothing`, [cutoff]);
    const deleted = await client.query("delete from support_tickets where created_at <= $1", [cutoff]);
    await client.query("commit");
    return deleted.rowCount;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

async function main() {
  require("dotenv").config();
  const connectionString = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || process.env.POSTGRES_URL;
  if (connectionString) {
    console.log("Cleared " + await clearDatabase(connectionString) + " existing practice support tickets.");
    return;
  }
  const file = path.join(__dirname, "data", "demo-db.json");
  if (!fs.existsSync(file)) { console.log("Cleared 0 existing practice support tickets."); return; }
  const { count, data } = clearJsonTickets(JSON.parse(fs.readFileSync(file, "utf8")));
  if (count) {
    const temporary = file + ".practice-clear-tmp";
    fs.writeFileSync(temporary, JSON.stringify(data, null, 2));
    fs.renameSync(temporary, file);
  }
  console.log("Cleared " + count + " existing practice support tickets.");
}

if (require.main === module) main().catch((error) => {
  console.error("Practice support ticket cleanup failed:", error.message);
  process.exitCode = 1;
});

module.exports = { clearJsonTickets, cutoff };
