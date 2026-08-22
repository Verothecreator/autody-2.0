(function () {
  const CONSENT_KEY = "autodyAdConsent";
  let config = { enabled: false, pixelId: null };
  let loaded = false;

  function cookie(name) {
    return document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1) || "";
  }

  function consentGranted() {
    return localStorage.getItem(CONSENT_KEY) === "accepted";
  }

  function loadPixel() {
    if (loaded || !config.enabled || !config.pixelId || !consentGranted()) return;
    loaded = true;
    !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
    n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
    n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
    t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}
    (window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
    window.fbq("init", config.pixelId);
    window.fbq("track", "PageView");
  }

  function showConsent() {
    const banner = document.querySelector("[data-ad-consent]");
    if (!banner || localStorage.getItem(CONSENT_KEY)) return;
    banner.hidden = false;
    banner.querySelector("[data-ad-consent-accept]")?.addEventListener("click", () => {
      localStorage.setItem(CONSENT_KEY, "accepted");
      banner.hidden = true;
      loadPixel();
    });
    banner.querySelector("[data-ad-consent-decline]")?.addEventListener("click", () => {
      localStorage.setItem(CONSENT_KEY, "essential");
      banner.hidden = true;
    });
  }

  function conversionContext(eventId = "") {
    return { eventId: eventId || globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      metaConsent: consentGranted(), fbp: cookie("_fbp"), fbc: cookie("_fbc") };
  }

  function track(eventName, parameters = {}, eventId = "") {
    const context = conversionContext(eventId);
    if (loaded && window.fbq && context.metaConsent) window.fbq("track", eventName, parameters, { eventID: context.eventId });
    return context;
  }

  window.AutodyMeta = { track, conversionContext, consentGranted };
  fetch("/api/meta/config").then((response) => response.json()).then((data) => {
    config = data || config;
    showConsent();
    loadPixel();
  }).catch(showConsent);
})();

