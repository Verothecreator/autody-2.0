const captchaWidgets = new WeakMap();
let captchaConfigPromise = null;

function captchaMessage(widget, message, type = "muted") {
  const target = widget?.querySelector("[data-captcha-message]");
  if (!target) return;
  target.textContent = message || "";
  target.dataset.status = type;
  target.hidden = !message;
}

function captchaConfig() {
  if (!captchaConfigPromise) {
    captchaConfigPromise = fetch("/api/auth/captcha-config")
      .then((response) => response.json())
      .catch(() => ({ success: false, configured: false }));
  }
  return captchaConfigPromise;
}

function waitForRecaptcha(timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (window.grecaptcha?.render) {
        clearInterval(timer);
        resolve(window.grecaptcha);
        return;
      }
      if (Date.now() - startedAt > timeoutMs) {
        clearInterval(timer);
        reject(new Error("Human verification could not load."));
      }
    }, 100);
  });
}

async function renderCaptcha(widget) {
  if (!widget || captchaWidgets.has(widget)) return;

  const container = widget.querySelector("[data-recaptcha-container]");
  if (!container) return;

  const config = await captchaConfig();
  if (!config?.configured || !config.siteKey) {
    captchaMessage(widget, "Human verification is not configured yet.", "error");
    widget.dataset.captchaReady = "false";
    return;
  }

  try {
    const recaptcha = await waitForRecaptcha();
    const widgetId = recaptcha.render(container, {
      sitekey: config.siteKey,
      theme: "dark",
      callback(token) {
        widget.dataset.captchaToken = token || "";
        captchaMessage(widget, "");
      },
      "expired-callback"() {
        widget.dataset.captchaToken = "";
        captchaMessage(widget, "Verification expired. Please verify again.", "error");
      },
      "error-callback"() {
        widget.dataset.captchaToken = "";
        captchaMessage(widget, "Verification failed to load. Please try again.", "error");
      }
    });
    captchaWidgets.set(widget, widgetId);
    widget.dataset.captchaReady = "true";
    captchaMessage(widget, "");
  } catch (err) {
    widget.dataset.captchaToken = "";
    widget.dataset.captchaReady = "false";
    captchaMessage(widget, err.message || "Human verification could not load.", "error");
  }
}

function formCaptchaWidget(form) {
  return form?.querySelector("[data-recaptcha-widget]") || document.querySelector("[data-recaptcha-widget]");
}

function captchaPayload(form) {
  const widget = formCaptchaWidget(form);
  const widgetId = widget ? captchaWidgets.get(widget) : null;
  const token = widgetId !== null && widgetId !== undefined && window.grecaptcha?.getResponse
    ? window.grecaptcha.getResponse(widgetId)
    : widget?.dataset.captchaToken || "";
  return {
    recaptchaToken: token
  };
}

function captchaIsComplete(form) {
  return Boolean(captchaPayload(form).recaptchaToken);
}

function refreshCaptcha(form) {
  const widget = formCaptchaWidget(form);
  const widgetId = widget ? captchaWidgets.get(widget) : null;
  widget?.removeAttribute("data-captcha-token");
  if (widgetId !== null && widgetId !== undefined && window.grecaptcha?.reset) {
    window.grecaptcha.reset(widgetId);
  }
  if (widget) captchaMessage(widget, "");
}

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("[data-recaptcha-widget]").forEach((widget) => {
    renderCaptcha(widget);
  });
});

window.AutodyCaptcha = {
  payload: captchaPayload,
  isComplete: captchaIsComplete,
  refresh: refreshCaptcha
};
