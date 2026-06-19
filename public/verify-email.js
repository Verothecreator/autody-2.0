const verifyEmailAddress = document.getElementById("verify-email-address");
const verifyEmailCopy = document.getElementById("verify-email-copy");
const verifyEmailError = document.getElementById("verify-email-error");
const verifyEmailSuccess = document.getElementById("verify-email-success");
const resendEmailButton = document.getElementById("resend-email-button");

const verifyEmailParams = new URLSearchParams(location.search);
const verifyEmail = verifyEmailParams.get("email") || sessionStorage.getItem("autodyPendingEmail") || "";
const verifyEmailToken = verifyEmailParams.get("token") || "";

function setVerifyEmailMessage(type, message) {
  const target = type === "success" ? verifyEmailSuccess : verifyEmailError;
  const other = type === "success" ? verifyEmailError : verifyEmailSuccess;
  if (other) {
    other.textContent = "";
    other.hidden = true;
  }
  if (!target) return;
  target.textContent = message || "";
  target.hidden = !message;
}

async function verifyEmailLink() {
  if (!verifyEmail || !verifyEmailToken) return;
  if (resendEmailButton) resendEmailButton.disabled = true;
  setVerifyEmailMessage("success", "Verifying your email.");

  try {
    const response = await fetch("/api/auth/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: verifyEmail, token: verifyEmailToken })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) throw new Error(data.error || "Email verification failed.");

    if (data.session) localStorage.setItem("autodyDemoSession", JSON.stringify(data.session));
    if (data.user) localStorage.setItem("autodyDemoUser", JSON.stringify(data.user));
    sessionStorage.removeItem("autodyPendingEmail");
    setVerifyEmailMessage("success", "Email verified. Opening your Autody account.");
    setTimeout(() => {
      location.href = data.next || "account.html";
    }, 900);
  } catch (err) {
    setVerifyEmailMessage("error", err.message || "Email verification failed.");
    if (resendEmailButton) resendEmailButton.disabled = false;
  }
}

resendEmailButton?.addEventListener("click", async () => {
  if (!verifyEmail) {
    setVerifyEmailMessage("error", "Enter your email again from the sign-up page.");
    return;
  }

  resendEmailButton.disabled = true;
  setVerifyEmailMessage("success", "Sending a new verification email.");
  try {
    const response = await fetch("/api/auth/resend-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: verifyEmail })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) throw new Error(data.error || "Could not resend email.");
    setVerifyEmailMessage("success", "Verification email sent. Check your inbox.");
  } catch (err) {
    setVerifyEmailMessage("error", err.message || "Could not resend email.");
  } finally {
    resendEmailButton.disabled = false;
  }
});

if (verifyEmailAddress) verifyEmailAddress.textContent = verifyEmail || "Email missing";
if (verifyEmailCopy && verifyEmail) {
  verifyEmailCopy.textContent = `We sent an Autody verification link to ${verifyEmail}. Open that message and click the link to continue.`;
}

verifyEmailLink();
