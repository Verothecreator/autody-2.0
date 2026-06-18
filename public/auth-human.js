(function () {
  const widgetSelector = "[data-human-challenge]";

  function selectedAnswers(widget) {
    return Array.from(widget.querySelectorAll("[data-challenge-item][aria-pressed='true']"))
      .map((button) => button.dataset.challengeItem)
      .filter(Boolean);
  }

  function setWidgetMessage(widget, message) {
    const prompt = widget.querySelector("[data-challenge-prompt]");
    if (prompt) prompt.textContent = message;
  }

  function renderChallenge(widget, challenge) {
    const grid = widget.querySelector("[data-challenge-grid]");
    if (!grid) return;

    widget.dataset.challengeId = challenge.id;
    setWidgetMessage(widget, challenge.prompt);
    grid.innerHTML = challenge.items.map((item) => `
      <button class="auth-challenge-tile" type="button" data-challenge-item="${item.id}" aria-pressed="false">
        <span>${item.mark}</span>
        <strong>${item.label}</strong>
      </button>
    `).join("");

    grid.querySelectorAll("[data-challenge-item]").forEach((button) => {
      button.addEventListener("click", () => {
        const active = button.getAttribute("aria-pressed") === "true";
        button.setAttribute("aria-pressed", active ? "false" : "true");
      });
    });
  }

  async function loadChallenge(widget) {
    if (!widget) return;
    widget.dataset.challengeId = "";
    setWidgetMessage(widget, "Loading verification challenge.");
    const grid = widget.querySelector("[data-challenge-grid]");
    if (grid) grid.innerHTML = "";

    try {
      const response = await fetch("/api/auth/human-challenge", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success || !data.challenge) throw new Error(data.error || "Verification unavailable.");
      renderChallenge(widget, data.challenge);
    } catch (err) {
      setWidgetMessage(widget, err.message || "Verification unavailable.");
    }
  }

  function widgetFor(target) {
    return target?.querySelector?.(widgetSelector) || document.querySelector(widgetSelector);
  }

  function payload(target) {
    const widget = widgetFor(target);
    if (!widget) return {};
    return {
      humanChallengeId: widget.dataset.challengeId || "",
      humanChallengeAnswers: selectedAnswers(widget)
    };
  }

  function isComplete(target) {
    const widget = widgetFor(target);
    return Boolean(widget?.dataset.challengeId) && selectedAnswers(widget).length > 0;
  }

  function refresh(target) {
    const widget = widgetFor(target);
    if (widget) loadChallenge(widget);
  }

  function init() {
    document.querySelectorAll(widgetSelector).forEach((widget) => {
      widget.querySelector("[data-refresh-challenge]")?.addEventListener("click", () => loadChallenge(widget));
      loadChallenge(widget);
    });
  }

  window.AutodyHumanChallenge = {
    init,
    payload,
    isComplete,
    refresh
  };

  init();
})();
