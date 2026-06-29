const auMoney = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 8 });
const auCompactMoney = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2 });
let auOverview = null;

function auNotice(message, tone = "neutral") {
  const node = document.getElementById("ops-market-notice");
  if (!node) return;
  node.textContent = message;
  node.dataset.state = tone;
}

function auFormatPrice(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "$0.00";
  return auMoney.format(number);
}

function auNumberInput(form, name, value) {
  const input = form.elements[name];
  if (input) input.value = value ?? "";
}

function calculateDerivedAuMetrics(form) {
  const currentPrice = Number(form.elements.currentPrice?.value || 0);
  const circulatingSupply = Number(form.elements.circulatingSupply?.value || 0);
  const totalSupply = Number(form.elements.totalSupply?.value || 0);
  return {
    marketCap: Number.isFinite(currentPrice) && Number.isFinite(circulatingSupply) && circulatingSupply > 0
      ? currentPrice * circulatingSupply
      : 0,
    fdv: Number.isFinite(currentPrice) && Number.isFinite(totalSupply) && totalSupply > 0
      ? currentPrice * totalSupply
      : 0
  };
}

function renderDerivedAuMetrics() {
  const form = document.getElementById("ops-market-form");
  if (!form) return;
  const derived = calculateDerivedAuMetrics(form);
  auNumberInput(form, "marketCap", derived.marketCap ? derived.marketCap.toFixed(2) : "");
  auNumberInput(form, "fdv", derived.fdv ? derived.fdv.toFixed(2) : "");
}

function fillControlForm(control = {}) {
  const form = document.getElementById("ops-market-form");
  if (!form) return;
  form.elements.enabled.checked = control.enabled !== false;
  auNumberInput(form, "currentPrice", control.currentPrice);
  auNumberInput(form, "minPrice", control.minPrice);
  auNumberInput(form, "maxPrice", control.maxPrice);
  auNumberInput(form, "updateIntervalSeconds", control.updateIntervalSeconds);
  auNumberInput(form, "stepPercent", control.stepPercent);
  auNumberInput(form, "trendBias", control.trendBias);
  auNumberInput(form, "liquidityUsd", control.liquidityUsd);
  auNumberInput(form, "marketCap", control.marketCap);
  auNumberInput(form, "fdv", control.fdv);
  auNumberInput(form, "totalVolume", control.totalVolume);
  auNumberInput(form, "volumeMinUsd", control.volumeMinUsd);
  auNumberInput(form, "volumeMaxUsd", control.volumeMaxUsd);
  auNumberInput(form, "circulatingSupply", control.circulatingSupply);
  auNumberInput(form, "totalSupply", control.totalSupply);
  if (form.elements.status) form.elements.status.value = control.status || "admin controlled";
  renderDerivedAuMetrics();
}

function renderKpis(overview = {}) {
  const control = overview.control || {};
  const stats = overview.stats || {};
  const price = document.querySelector('[data-au-kpi="price"]');
  const change = document.querySelector('[data-au-kpi="change"]');
  const range = document.querySelector('[data-au-kpi="range"]');
  const ticks = document.querySelector('[data-au-kpi="ticks"]');
  const retention = document.querySelector('[data-au-kpi="retention"]');
  const status = document.querySelector('[data-au-kpi="status"]');
  const interval = document.querySelector('[data-au-kpi="interval"]');
  if (price) price.textContent = auFormatPrice(control.currentPrice);
  if (change) {
    const value = Number(control.changePct || 0);
    change.textContent = `${value > 0 ? "+" : ""}${value.toFixed(4)}%`;
    change.className = value > 0 ? "positive" : value < 0 ? "negative" : "";
  }
  if (range) range.textContent = `${auFormatPrice(control.minPrice)} - ${auFormatPrice(control.maxPrice)}`;
  if (ticks) ticks.textContent = stats.tickCount || 0;
  if (retention) retention.textContent = `${overview.retention?.days || 0} days / ${overview.retention?.maxRows || 0} max`;
  if (status) status.textContent = control.enabled === false ? "Paused" : "Active";
  if (interval) interval.textContent = `${control.updateIntervalSeconds || 30}s updates`;
}

function renderChart(chart = {}) {
  const target = document.getElementById("ops-chart-stage");
  if (!target) return;
  const points = (chart.points || []).map((point) => ({ ...point, close: Number(point.close) })).filter((point) => Number.isFinite(point.close));
  if (points.length < 2) {
    target.innerHTML = `<div class="admin-empty">AU chart history is warming up.</div>`;
    return;
  }
  const width = 760;
  const height = 330;
  const padding = 26;
  const values = points.map((point) => point.close);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = Math.max(0.00000001, max - min);
  const path = points.map((point, index) => {
    const x = padding + (index / Math.max(1, points.length - 1)) * (width - padding * 2);
    const y = height - padding - ((point.close - min) / spread) * (height - padding * 2);
    return `${index ? "L" : "M"} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(" ");
  const area = `${path} L ${width - padding} ${height - padding} L ${padding} ${height - padding} Z`;
  target.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="AU controlled price chart">
      <defs>
        <linearGradient id="auOpsFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="#2de18b" stop-opacity="0.4" />
          <stop offset="100%" stop-color="#2de18b" stop-opacity="0" />
        </linearGradient>
      </defs>
      <path d="${area}" fill="url(#auOpsFill)"></path>
      <path d="${path}" fill="none" stroke="#2de18b" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"></path>
    </svg>
  `;
}

function renderTicks(ticks = []) {
  const target = document.getElementById("ops-tick-list");
  if (!target) return;
  if (!ticks.length) {
    target.innerHTML = `<div class="admin-empty">No AU ticks yet.</div>`;
    return;
  }
  target.innerHTML = ticks.slice(0, 12).map((tick) => `
    <article class="admin-record ops-tick-record">
      <div>
        <strong>${auFormatPrice(tick.price)}</strong>
        <span>${tick.source || "admin-control"}</span>
      </div>
      <div>
        <span>${Number(tick.changePct || 0).toFixed(4)}%</span>
        <small>${new Date(tick.createdAt).toLocaleString()}</small>
      </div>
    </article>
  `).join("");
}

async function loadAuOverview(forceTick = false) {
  await opsRequireSession();
  const range = document.getElementById("ops-chart-range")?.value || "1d";
  auNotice(forceTick ? "Advancing AU price..." : "Loading AU control...", "neutral");
  auOverview = await opsPost("/api/admin/markets/overview", { symbol: "AU", range, forceTick });
  fillControlForm(auOverview.control);
  renderKpis(auOverview);
  renderChart(auOverview.chart);
  renderTicks(auOverview.ticks || []);
  auNotice(`AU market loaded. Last tick ${auOverview.stats?.lastTickAt ? new Date(auOverview.stats.lastTickAt).toLocaleTimeString() : "not yet"}.`, "success");
}

function formControlBody(form) {
  const body = { symbol: "AU", range: document.getElementById("ops-chart-range")?.value || "1d" };
  for (const [key, rawValue] of new FormData(form).entries()) {
    if (key === "enabled") {
      body.enabled = true;
      continue;
    }
    const value = String(rawValue || "").trim();
    if (!value) continue;
    if (["marketCap", "fdv"].includes(key)) continue;
    body[key] = ["status"].includes(key) ? value : Number(value);
  }
  if (!new FormData(form).has("enabled")) body.enabled = false;
  return body;
}

function wireAuOps() {
  document.getElementById("ops-market-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = event.currentTarget.querySelector('button[type="submit"]');
    try {
      submit.disabled = true;
      submit.textContent = "Saving...";
      auOverview = await opsPost("/api/admin/markets/control", formControlBody(event.currentTarget));
      fillControlForm(auOverview.control);
      renderKpis(auOverview);
      renderChart(auOverview.chart);
      renderTicks(auOverview.ticks || []);
      auNotice("AU control saved.", "success");
    } catch (err) {
      auNotice(err.message || "Could not save AU control.", "error");
    } finally {
      submit.disabled = false;
      submit.textContent = "Save AU Control";
    }
  });

  document.getElementById("ops-force-tick")?.addEventListener("click", () => loadAuOverview(true).catch((err) => auNotice(err.message, "error")));
  document.getElementById("ops-chart-range")?.addEventListener("change", () => loadAuOverview(false).catch((err) => auNotice(err.message, "error")));
  document.getElementById("ops-market-form")?.addEventListener("input", (event) => {
    if (["currentPrice", "circulatingSupply", "totalSupply"].includes(event.target?.name)) renderDerivedAuMetrics();
  });
  loadAuOverview(false).catch((err) => auNotice(err.message || "Could not load AU control.", "error"));
}

document.addEventListener("DOMContentLoaded", wireAuOps);
