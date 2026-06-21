(function guardDemoAccount() {
  const sessionKey = "autodyDemoSession";
  const rawSession = localStorage.getItem(sessionKey);
  let session = null;

  try {
    session = rawSession ? JSON.parse(rawSession) : null;
  } catch (err) {
    localStorage.removeItem(sessionKey);
  }

  const expiresAt = Date.parse(session?.expiresAt || "");
  if (!session?.token || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    localStorage.removeItem(sessionKey);
    const page = location.pathname.split("/").pop() || "account.html";
    const next = page === "account.html" || page.startsWith("account-") ? encodeURIComponent(page) : "account.html";
    location.replace(`sign-in.html?next=${next}`);
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
})();
