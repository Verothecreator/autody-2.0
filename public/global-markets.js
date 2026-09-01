const form = document.getElementById("market-lead-form");
const statusNode = document.getElementById("market-lead-status");
const query = new URLSearchParams(window.location.search);
const VISITOR_KEY = "autodyMarketingVisitor";
function marketingVisitorId() { let id = localStorage.getItem(VISITOR_KEY); if (!id) { id = globalThis.crypto?.randomUUID?.() || `visitor-${Date.now()}-${Math.random().toString(16).slice(2)}`; localStorage.setItem(VISITOR_KEY, id); } return id; }
function attributionPayload() { return { utmSource: query.get("utm_source") || "", utmMedium: query.get("utm_medium") || "", utmCampaign: query.get("utm_campaign") || "", utmContent: query.get("utm_content") || "", utmTerm: query.get("utm_term") || "", landingPath: `${window.location.pathname}${window.location.search}`.slice(0, 240), referrer: document.referrer.slice(0, 500) }; }
function trackMarketingEvent(eventName, extra = {}) { const payload = JSON.stringify({ eventName, visitorId: marketingVisitorId(), ...attributionPayload(), ...extra }); if (navigator.sendBeacon) { navigator.sendBeacon("/api/marketing/events", new Blob([payload], { type: "application/json" })); return; } fetch("/api/marketing/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: payload, keepalive: true }).catch(() => {}); }
trackMarketingEvent("page_view");
function setStatus(message, type = "") { statusNode.textContent = message; statusNode.dataset.type = type; }

const once = new Set();
function trackOnce(eventName, extra = {}) {
  if (once.has(eventName)) return;
  once.add(eventName);
  trackMarketingEvent(eventName, extra);
}

const inAppBrowser = /FBAN|FBAV|Instagram/i.test(navigator.userAgent || "");
const browserNote = document.querySelector("[data-in-app-browser-note]");
if (inAppBrowser && browserNote) {
  browserNote.hidden = false;
  trackOnce("in_app_browser");
  browserNote.querySelector("[data-in-app-browser-continue]")?.addEventListener("click", () => {
    trackMarketingEvent("external_browser_prompt_continue");
    browserNote.hidden = true;
  });
  browserNote.querySelector("[data-in-app-browser-copy]")?.addEventListener("click", async () => {
    const copyStatus = browserNote.querySelector("[data-in-app-browser-copy-status]");
    try {
      await navigator.clipboard.writeText(window.location.href);
      if (copyStatus) copyStatus.textContent = "Link copied. Open Safari, Chrome or your preferred browser and paste it there.";
      trackMarketingEvent("external_browser_copy");
    } catch {
      if (copyStatus) copyStatus.textContent = "Use the app menu and choose “Open in external browser.”";
    }
  });
}

document.querySelectorAll("[data-briefing-cta]").forEach((cta) => cta.addEventListener("click", () => {
  trackMarketingEvent("form_cta_click", { metadata: { placement: cta.classList.contains("mobile-sticky-briefing-cta") ? "sticky" : "inline" } });
}));

if (form) {
  const markFormStart = () => trackOnce("form_start");
  new IntersectionObserver((entries, observer) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    trackOnce("form_view");
    observer.disconnect();
  }, { threshold: 0.35 }).observe(form);
  form.querySelector('input[type="email"]')?.addEventListener("focus", () => {
    trackOnce("email_focus");
    markFormStart();
  });
  form.querySelectorAll('input[name="interests"]').forEach((input) => input.addEventListener("change", () => {
    markFormStart();
    trackMarketingEvent("interests_changed", { metadata: { interests: new FormData(form).getAll("interests") } });
  }));
  form.querySelector('input[name="consent"]')?.addEventListener("change", (event) => {
    markFormStart();
    trackMarketingEvent("consent_changed", { metadata: { checked: Boolean(event.currentTarget.checked) } });
  });
}

form?.addEventListener("submit", async (event) => {
  event.preventDefault(); const submit = form.querySelector('button[type="submit"]'); const data = new FormData(form); const interests = data.getAll("interests");
  if (!interests.length) { setStatus("Choose at least one market.", "error"); return; }
  submit.disabled = true; setStatus("Preparing your briefing..."); trackMarketingEvent("briefing_submit", { metadata: { interests } });
  const metaLead = window.AutodyMeta?.conversionContext?.() || { metaConsent: false };
  try {
    const response = await fetch("/api/marketing/leads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: data.get("email"), currency: "USD", interests, consent: data.get("consent") === "on", company: data.get("company"), ...metaLead, ...attributionPayload() }) });
    const result = await response.json().catch(() => ({})); if (!response.ok || !result.success) throw new Error(result.error || "Your briefing could not be prepared.");
    window.AutodyMeta?.track?.("Lead", { content_name: "Autody market briefing", currency: "USD" }, metaLead.eventId);
    setStatus("Your snapshot was sent. Check your inbox or build your free watchlist.", "success"); submit.textContent = "Build My Free Watchlist"; submit.disabled = false;
    submit.onclick = () => { trackMarketingEvent("signup_click", { leadId: result.leadId }); window.location.href = result.next || "/sign-up"; };
  } catch (error) { setStatus(error.message || "Your briefing could not be prepared.", "error"); submit.disabled = false; }
});

