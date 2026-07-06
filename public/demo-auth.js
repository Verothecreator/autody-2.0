(function guardDemoAccount() {
  const theme = localStorage.getItem("autodyAccountTheme") || "dark";
  document.body?.classList?.toggle("theme-light", theme === "light");

  const sessionKey = "autodyDemoSession";
  let redirectingToSignIn = false;

  function currentAccountNextPage() {
    const page = (location.pathname.split("/").pop() || "account").replace(/\.html$/i, "");
    return page === "account" || page.startsWith("account-") ? encodeURIComponent(page) : "account";
  }

  function redirectToSignIn() {
    if (redirectingToSignIn) return;
    redirectingToSignIn = true;
    localStorage.removeItem(sessionKey);
    location.replace(`sign-in?next=${currentAccountNextPage()}`);
  }

  function protectedApiRequest(input) {
    const rawUrl = typeof input === "string" ? input : input?.url || "";
    if (!rawUrl) return false;
    let pathname = rawUrl;
    try {
      pathname = new URL(rawUrl, location.origin).pathname;
    } catch (err) {
      pathname = rawUrl;
    }
    return pathname.startsWith("/api/account")
      || pathname.startsWith("/api/demo")
      || pathname.startsWith("/api/kyc");
  }

  async function responseRequiresSignIn(response) {
    if (response.status === 401) return true;
    if (response.status !== 403) return false;

    const data = await response.clone().json().catch(() => ({}));
    const message = String(data.error || data.message || "").toLowerCase();
    return /sign in|session|token|unauthori[sz]ed|expired|invalid/.test(message);
  }

  const rawSession = localStorage.getItem(sessionKey);
  let session = null;

  try {
    session = rawSession ? JSON.parse(rawSession) : null;
  } catch (err) {
    localStorage.removeItem(sessionKey);
  }

  const expiresAt = Date.parse(session?.expiresAt || "");
  if (!session?.token || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    redirectToSignIn();
    return;
  }

  window.AutodyAuth = {
    session() {
      return session;
    },
    headers(extra = {}) {
      return session?.token
        ? { ...extra, Authorization: `Bearer ${session.token}` }
        : { ...extra };
    }
  };

  if (window.fetch && !window.__autodyAuthFetchGuard) {
    const nativeFetch = window.fetch.bind(window);
    window.__autodyAuthFetchGuard = true;
    window.fetch = async (...args) => {
      const response = await nativeFetch(...args);
      if (protectedApiRequest(args[0]) && await responseRequiresSignIn(response)) {
        redirectToSignIn();
      }
      return response;
    };
  }
})();
