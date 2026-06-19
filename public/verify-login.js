const verifyLoginForm = document.getElementById("verify-login-form");
const verifyLoginEmail = document.getElementById("verify-login-email");
const verifyLoginCopy = document.getElementById("verify-login-copy");
const verifyLoginError = document.getElementById("verify-login-error");
const verifyLoginButton = document.getElementById("verify-login-button");
const verifyLoginRemember = document.getElementById("verify-login-remember");

const verifyLoginParams = new URLSearchParams(location.search);
const loginEmail = verifyLoginParams.get("email") || sessionStorage.getItem("autodyPendingEmail") || "";
const rememberFromUrl = verifyLoginParams.get("remember") === "1";
const rememberFromSession = sessionStorage.getItem("autodyRememberDevice") === "true";

function setVerifyLoginError(message) {
  if (!verifyLoginError) return;
  verifyLoginError.textContent = message || "";
  verifyLoginError.hidden = !message;
}

if (verifyLoginEmail) verifyLoginEmail.textContent = loginEmail || "Email missing";
if (verifyLoginCopy && loginEmail) {
  verifyLoginCopy.textContent = `We sent a 6-digit Autody sign-in code to ${loginEmail}. Enter it to open your account.`;
}
if (verifyLoginRemember) verifyLoginRemember.checked = rememberFromUrl || rememberFromSession;

verifyLoginForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  setVerifyLoginError("");

  const form = new FormData(verifyLoginForm);
  const code = String(form.get("code") || "").replace(/\s+/g, "");
  if (!loginEmail || !/^\d{6}$/.test(code)) {
    setVerifyLoginError("Enter the 6-digit sign-in code.");
    return;
  }

  if (verifyLoginButton) {
    verifyLoginButton.disabled = true;
    verifyLoginButton.textContent = "Verifying";
  }

  try {
    const response = await fetch("/api/auth/verify-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: loginEmail,
        code,
        rememberDevice: form.get("rememberDevice") === "on"
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) throw new Error(data.error || "Could not verify the sign-in code.");

    localStorage.setItem("autodyDemoSession", JSON.stringify(data.session));
    localStorage.setItem("autodyDemoUser", JSON.stringify(data.user));
    sessionStorage.removeItem("autodyPendingEmail");
    sessionStorage.removeItem("autodyRememberDevice");
    location.href = data.next || "account.html";
  } catch (err) {
    setVerifyLoginError(err.message || "Could not verify the sign-in code.");
  } finally {
    if (verifyLoginButton) {
      verifyLoginButton.disabled = false;
      verifyLoginButton.textContent = "Verify Sign In";
    }
  }
});
