const test = require("node:test");
const assert = require("node:assert/strict");
const { clearJsonTickets, cutoff } = require("./clear-practice-support");

test("practice cleanup removes existing cases and prevents old inbound email reimport", () => {
  const old = "b2a946dc-cf19-466c-9317-fd4f0d985d3a";
  const later = "99a946dc-cf19-466c-9317-fd4f0d985d3a";
  const data = { supportTickets: [
    { id: old, createdAt: new Date(cutoff.getTime() - 1000).toISOString() },
    { id: later, createdAt: new Date(cutoff.getTime() + 1000).toISOString() }
  ], supportMessages: [{ ticketId: old }, { ticketId: later }],
    supportInboundEmails: [{ id: "a2a946dc-cf19-466c-9317-fd4f0d985d3a", ticketId: old }],
    supportTicketMerges: [{ canonicalTicketId: old }], supportClearedInboundEmails: [],
    supportAgents: [{ id: "agent" }] };
  const result = clearJsonTickets(data);
  assert.equal(result.count, 1);
  assert.deepEqual(result.data.supportTickets.map((row) => row.id), [later]);
  assert.deepEqual(result.data.supportMessages.map((row) => row.ticketId), [later]);
  assert.deepEqual(result.data.supportInboundEmails, []);
  assert.deepEqual(result.data.supportClearedInboundEmails, ["a2a946dc-cf19-466c-9317-fd4f0d985d3a"]);
  assert.deepEqual(result.data.supportAgents, [{ id: "agent" }]);
});
