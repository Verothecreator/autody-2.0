const feeMoney = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2
});

const feeDate = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short"
});

function feeEscape(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function feeNotice(message, state = "neutral") {
  const notice = document.getElementById("fee-notice");
  if (!notice) return;
  notice.textContent = message;
  notice.dataset.state = state;
}

function feeOutput(value) {
  const output = document.getElementById("fee-output");
  if (!output) return;
  output.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function feeFormatMoney(value) {
  const number = Number(value);
  return feeMoney.format(Number.isFinite(number) ? number : 0);
}

function feeFormatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : feeDate.format(date);
}

function feeRenderEmpty(target, message) {
  target.innerHTML = `<div class="admin-empty">${feeEscape(message)}</div>`;
}

function feeRenderKpis(data = {}) {
  const totals = data.totals || {};
  const tradingFee = data.tradingFee || {};
  const values = {
    collected: feeFormatMoney(totals.collectedUsd),
    count: `${Number(totals.count || 0).toLocaleString("en-US")} events`,
    buy: feeFormatMoney(totals.buyUsd),
    sell: feeFormatMoney(totals.sellUsd),
    swap: feeFormatMoney(totals.swapUsd),
    rate: `${Number(tradingFee.percent || 0).toFixed(2)}% rate`
  };
  Object.entries(values).forEach(([key, value]) => {
    const node = document.querySelector(`[data-fee-kpi="${key}"]`);
    if (node) node.textContent = value;
  });
}

function feeRenderTable(fees = []) {
  const target = document.getElementById("fee-table");
  if (!target) return;
  const countNode = document.querySelector("[data-fee-count]");
  if (countNode) countNode.textContent = String(fees.length);
  if (!fees.length) {
    feeRenderEmpty(target, "No platform fees have been collected yet.");
    return;
  }

  target.innerHTML = fees.map((row) => `
    <div class="admin-record">
      <span>
        <strong>${feeEscape(String(row.side || "trade").toUpperCase())} ${feeEscape(row.asset || "-")}</strong>
        <small>${feeEscape(row.profileName || "Autody customer")} - ${feeEscape(row.email || "-")}</small>
      </span>
      <span>
        <strong>${feeFormatMoney(row.feeUsd)}</strong>
        <small>${Number(row.rateBps || 0).toFixed(2)} bps</small>
      </span>
      <span>
        <strong>${feeFormatMoney(row.notionalUsd)}</strong>
        <small>Notional</small>
      </span>
      <span>
        <strong>${feeEscape(row.status || "collected")}</strong>
        <small>${feeFormatDate(row.createdAt)}</small>
      </span>
      <span>
        <strong class="admin-mono">${feeEscape(String(row.orderId || row.id || "-").slice(0, 18))}</strong>
        <small>Order / event</small>
      </span>
    </div>
  `).join("");
}

function feeRenderSummary(data = {}) {
  feeOutput({
    tradingFee: data.tradingFee || {},
    totals: data.totals || {},
    generatedAt: data.generatedAt || new Date().toISOString()
  });
}

async function loadFeeData() {
  feeNotice("Loading fee data...", "neutral");
  const data = await opsPost("/api/admin/fees/overview", { limit: 100 });
  feeRenderKpis(data);
  feeRenderTable(Array.isArray(data.fees) ? data.fees : []);
  feeRenderSummary(data);
  const generated = data.generatedAt ? feeFormatDate(data.generatedAt) : "now";
  feeNotice(`Fee data loaded. Last refresh ${generated}.`, "success");
}

async function bootFeePortal() {
  const status = document.getElementById("fee-session-status");
  const session = await opsRequireSession();
  if (!session) return;
  if (status) {
    status.textContent = session.expiresAt
      ? `Active until ${feeFormatDate(session.expiresAt)}`
      : "Active session";
  }
  document.getElementById("fee-refresh")?.addEventListener("click", () => {
    loadFeeData().catch((err) => {
      feeOutput(err.message || String(err));
      feeNotice(err.message || "Refresh failed.", "error");
    });
  });
  loadFeeData().catch((err) => {
    feeOutput(err.message || String(err));
    feeNotice(err.message || "Could not load fee data.", "error");
  });
}

bootFeePortal();
