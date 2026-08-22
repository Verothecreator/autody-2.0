const form = document.getElementById("market-lead-form");
const statusNode = document.getElementById("market-lead-status");
const query = new URLSearchParams(window.location.search);
const VISITOR_KEY = "autodyMarketingVisitor";

function marketingVisitorId() {
  let id = localStorage.getItem(VISITOR_KEY);
  if (!id) {
    id = globalThis.crypto?.randomUUID?.() || `visitor-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    localStorage.setItem(VISITOR_KEY, id);
  }
  return id;
}

function attributionPayload() {
  return {
    utmSource: query.get("utm_source") || "",
    utmMedium: query.get("utm_medium") || "",
    utmCampaign: query.get("utm_campaign") || "",
    utmContent: query.get("utm_content") || "",
    utmTerm: query.get("utm_term") || "",
    landingPath: `${window.location.pathname}${window.location.search}`.slice(0, 240),
    referrer: document.referrer.slice(0, 500)
  };
}

function trackMarketingEvent(eventName, extra = {}) {
  const payload = JSON.stringify({ eventName, visitorId: marketingVisitorId(), ...attributionPayload(), ...extra });
  if (navigator.sendBeacon) {
    navigator.sendBeacon("/api/marketing/events", new Blob([payload], { type: "application/json" }));
    return;
  }
  fetch("/api/marketing/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: payload, keepalive: true }).catch(() => {});
}

trackMarketingEvent("page_view");

function setStatus(message, type = "") {
  statusNode.textContent = message;
  statusNode.dataset.type = type;
}

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = form.querySelector('button[type="submit"]');
  const data = new FormData(form);
  const interests = data.getAll("interests");
  if (!interests.length) {
    setStatus("Choose at least one market.", "error");
    return;
  }

  submit.disabled = true;
  setStatus("Saving your preferences...");
  trackMarketingEvent("briefing_submit", { metadata: { interests } });
  const metaLead = window.AutodyMeta?.conversionContext?.() || { metaConsent: false };
  try {
    const response = await fetch("/api/marketing/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: data.get("email"),
        currency: "USD",
        interests,
        consent: data.get("consent") === "on",
        company: data.get("company"),
        ...metaLead,
        ...attributionPayload()
      })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.success) throw new Error(result.error || "Your briefing could not be saved.");
    window.AutodyMeta?.track?.("Lead", { content_name: "Autody market briefing", currency: "USD" }, metaLead.eventId);
    setStatus("Your briefing is ready. Check your inbox or continue to your free account.", "success");
    submit.textContent = "Continue to Autody";
    submit.disabled = false;
    submit.onclick = () => {
      trackMarketingEvent("signup_click", { leadId: result.leadId });
      window.location.href = result.next || "/sign-up";
    };
  } catch (error) {
    setStatus(error.message || "Your briefing could not be saved.", "error");
    submit.disabled = false;
  }
});

