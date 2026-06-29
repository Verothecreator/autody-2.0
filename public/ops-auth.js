const OPS_SESSION_KEY = "autodyOpsSession";

function opsStoredSession() {
  try {
    const raw = sessionStorage.getItem(OPS_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null;
  }
}

function opsToken() {
  const session = opsStoredSession();
  if (!session?.token || (session.expiresAt && Date.parse(session.expiresAt) <= Date.now())) {
    sessionStorage.removeItem(OPS_SESSION_KEY);
    return "";
  }
  return session.token;
}

function opsHeaders(extra = {}) {
  const token = opsToken();
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra
  };
}

async function opsPost(path, body = {}) {
  const response = await fetch(path, {
    method: "POST",
    headers: opsHeaders(),
    body: JSON.stringify(body)
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.success === false) {
    throw new Error(json.error || `${path} returned ${response.status}`);
  }
  return json;
}

async function opsRequireSession() {
  if (!opsToken()) {
    location.href = "ops-gateway.html";
    return null;
  }

  try {
    return await opsPost("/api/ops/session/check");
  } catch (err) {
    sessionStorage.removeItem(OPS_SESSION_KEY);
    location.href = "ops-gateway.html";
    return null;
  }
}

function opsSignOut() {
  sessionStorage.removeItem(OPS_SESSION_KEY);
  location.href = "ops-gateway.html";
}
