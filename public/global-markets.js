const form = document.getElementById("market-lead-form");
const statusNode = document.getElementById("market-lead-status");
const query = new URLSearchParams(window.location.search);

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
  setStatus("Saving your preferencesâ€¦");
  try {
    const response = await fetch("/api/marketing/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: data.get("email"),
        currency: data.get("currency"),
        interests,
        consent: data.get("consent") === "on",
        company: data.get("company"),
        ...attributionPayload()
      })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.success) throw new Error(result.error || "Your briefing could not be saved.");
    setStatus("Your briefing is ready. Check your inbox or continue to your free account.", "success");
    submit.textContent = "Continue to Autody";
    submit.disabled = false;
    submit.onclick = () => { window.location.href = result.next || "/sign-up"; };
  } catch (error) {
    setStatus(error.message || "Your briefing could not be saved.", "error");
    submit.disabled = false;
  }
});

