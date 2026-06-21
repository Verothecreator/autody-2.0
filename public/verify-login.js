const verifyLoginForm = document.getElementById("verify-login-form");
const verifyLoginCopy = document.getElementById("verify-login-copy");
const verifyLoginError = document.getElementById("verify-login-error");
const verifyLoginSuccess = document.getElementById("verify-login-success");
const verifyLoginButton = document.getElementById("verify-login-button");
const resendLoginCodeButton = document.getElementById("resend-login-code-button");

const verifyLoginParams = new URLSearchParams(location.search);
const loginEmail = verifyLoginParams.get("email") || sessionStorage.getItem("autodyPendingEmail") || "";
const rememberFromUrl = verifyLoginParams.get("remember") === "1";
const rememberFromSession = sessionStorage.getItem("autodyRememberDevice") === "true";

function setVerifyLoginError(message) {
  if (!verifyLoginError) return;
  verifyLoginError.textContent = message || "";
  verifyLoginError.hidden = !message;
  if (message && verifyLoginSuccess) {
    verifyLoginSuccess.textContent = "";
    verifyLoginSuccess.hidden = true;
  }
}

function setVerifyLoginSuccess(message) {
  if (!verifyLoginSuccess) return;
  verifyLoginSuccess.textContent = message || "";
  verifyLoginSuccess.hidden = !message;
  if (message && verifyLoginError) {
    verifyLoginError.textContent = "";
    verifyLoginError.hidden = true;
  }
}

if (verifyLoginCopy && loginEmail) {
  verifyLoginCopy.textContent = `We sent a 6-digit code to ${loginEmail}. Enter it below to continue. The code expires in 5 minutes.`;
}

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
        rememberDevice: rememberFromUrl || rememberFromSession
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) throw new Error(data.error || "Could not verify the sign-in code.");

    localStorage.setItem("autodyDemoSession", JSON.stringify(data.session));
    localStorage.setItem("autodyDemoUser", JSON.stringify(data.user));
    if (data.trustedDevice?.token) {
      localStorage.setItem("autodyTrustedDevice", JSON.stringify({
        token: data.trustedDevice.token,
        email: loginEmail,
        userId: data.trustedDevice.userId || data.user?.id || "",
        expiresAt: data.trustedDevice.expiresAt
      }));
    }
    sessionStorage.removeItem("autodyPendingEmail");
    sessionStorage.removeItem("autodyRememberDevice");
    location.href = data.next || "account.html";
  } catch (err) {
    setVerifyLoginError(err.message || "Could not verify the sign-in code.");
  } finally {
    if (verifyLoginButton) {
      verifyLoginButton.disabled = false;
      verifyLoginButton.textContent = "Confirm";
    }
  }
});

resendLoginCodeButton?.addEventListener("click", async () => {
  setVerifyLoginError("");
  setVerifyLoginSuccess("");

  if (!loginEmail) {
    setVerifyLoginError("Email is missing. Go back to sign in and try again.");
    return;
  }

  resendLoginCodeButton.disabled = true;
  resendLoginCodeButton.textContent = "Sending";

  try {
    const response = await fetch("/api/auth/resend-login-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: loginEmail })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) throw new Error(data.error || "Could not resend the sign-in code.");
    setVerifyLoginSuccess("A new code was sent. It expires in 5 minutes.");
  } catch (err) {
    setVerifyLoginError(err.message || "Could not resend the sign-in code.");
  } finally {
    resendLoginCodeButton.disabled = false;
    resendLoginCodeButton.textContent = "Resend code";
  }
});
