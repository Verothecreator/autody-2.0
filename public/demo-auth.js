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
    const next = encodeURIComponent(location.pathname.split("/").pop() || "demo-wallet.html");
    location.replace(`sign-in.html?next=${next}`);
  }
})();
