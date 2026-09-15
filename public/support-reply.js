const customerParams = new URLSearchParams(location.search);
const customerTicketId = customerParams.get("ticket") || "";
const customerToken = customerParams.get("token") || "";
function customerNotice(text, type = "") {
  const node = document.getElementById("customer-support-notice"); node.textContent = text; node.dataset.type = type;
}
function customerNode(tag, text = "", className = "") {
  const node = document.createElement(tag); node.textContent = text; node.className = className; return node;
}
async function customerPost(path, body) {
  const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.success === false) throw new Error(json.error || "Your support conversation is unavailable.");
  return json;
}
async function loadCustomerThread() {
  const data = await customerPost("/api/support/thread", { ticketId: customerTicketId, token: customerToken });
  document.getElementById("customer-support-topic").textContent = data.ticket.topic || "Support request";
  const thread = document.getElementById("customer-support-thread"); thread.replaceChildren();
  const original = customerNode("article", "", "support-thread-entry from-customer");
  original.append(customerNode("strong", "Your request"), customerNode("p", data.ticket.message, "support-inbox-message"));
  thread.append(original);
  data.messages.forEach((message) => {
    const card = customerNode("article", "", "support-thread-entry " + (message.role === "customer" ? "from-customer" : "from-agent"));
    card.append(customerNode("strong", (message.role === "customer" ? "You" : message.agentName || "Autody Support") + " · " + new Date(message.createdAt).toLocaleString()),
      customerNode("p", message.body, "support-inbox-message"));
    thread.append(card);
  });
  document.getElementById("customer-support-form").hidden = false;
}
document.getElementById("customer-support-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget, button = form.querySelector("button");
  try {
    button.disabled = true;
    await customerPost("/api/support/reply", { ticketId: customerTicketId, token: customerToken, message: form.elements.message.value.trim() });
    form.reset(); await loadCustomerThread();
    customerNotice("Your reply reached Autody Support.", "success");
  } catch (error) { customerNotice(error.message, "error"); }
  finally { button.disabled = false; }
});
loadCustomerThread().catch((error) => customerNotice(error.message, "error"));
