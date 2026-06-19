const verifyEmailAddress = document.getElementById("verify-email-address");
const verifyEmailCopy = document.getElementById("verify-email-copy");
const verifyEmailError = document.getElementById("verify-email-error");
const verifyEmailSuccess = document.getElementById("verify-email-success");
const resendEmailButton = document.getElementById("resend-email-button");

const verifyEmailParams = new URLSearchParams(location.search);
const verifyEmail = verifyEmailParams.get("email") || sessionStorage.getItem("autodyPendingEmail") || "";
const verifyEmailToken = verifyEmailParams.get("token") || "";

function storedSessionMatchesEmail(email) {
  try {
    const user = JSON.parse(localStorage.getItem("autodyDemoUser") || "null");
    const session = JSON.parse(localStorage.getItem("autodyDemoSession") || "null");
    return Boolean(
      email &&
      session?.token &&
      String(user?.email || "").toLowerCase() === String(email).toLowerCase()
    );
  } catch {
    return false;
  }
}

function verifiedRedirectTarget() {
  return storedSessionMatchesEmail(verifyEmail) ? "account.html" : "sign-in.html?next=account.html";
}

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

function lockResendButton() {
  if (!resendEmailButton) return;
  resendEmailButton.disabled = true;
  resendEmailButton.hidden = true;
}

function redirectVerifiedAccount(message = "Email already verified. Opening your Autody account.") {
  lockResendButton();
  setVerifyEmailMessage("success", message);
  setTimeout(() => {
    location.href = verifiedRedirectTarget();
  }, 800);
}

async function checkVerificationStatus() {
  if (!verifyEmail || verifyEmailToken) return;
  try {
    const response = await fetch(`/api/auth/verification-status?email=${encodeURIComponent(verifyEmail)}`);
    const data = await response.json().catch(() => ({}));
    if (response.ok && data?.verification?.email === "verified") {
      redirectVerifiedAccount();
    }
  } catch {
    // Keep the resend flow available if status cannot be checked.
  }
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
    if (data?.verified) {
      redirectVerifiedAccount();
      return;
    }
    if (!response.ok || !data.success) throw new Error(data.error || "Email verification failed.");

    if (data.session) localStorage.setItem("autodyDemoSession", JSON.stringify(data.session));
    if (data.user) localStorage.setItem("autodyDemoUser", JSON.stringify(data.user));
    sessionStorage.removeItem("autodyPendingEmail");
    lockResendButton();
    setVerifyEmailMessage("success", "Email verified. Opening your Autody account.");
    setTimeout(() => {
      location.href = data.next || "account.html";
    }, 900);
  } catch (err) {
    setVerifyEmailMessage("error", err.message || "Email verification failed.");
    if (resendEmailButton && !resendEmailButton.hidden) resendEmailButton.disabled = false;
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
    if (data?.verified) {
      redirectVerifiedAccount();
      return;
    }
    if (!response.ok || !data.success) throw new Error(data.error || "Could not resend email.");
    setVerifyEmailMessage("success", "Verification email sent. Check your inbox.");
  } catch (err) {
    setVerifyEmailMessage("error", err.message || "Could not resend email.");
  } finally {
    if (!resendEmailButton.hidden) resendEmailButton.disabled = false;
  }
});

if (verifyEmailAddress) verifyEmailAddress.textContent = verifyEmail || "Email missing";
if (verifyEmailCopy && verifyEmail) {
  verifyEmailCopy.textContent = `We sent an Autody verification link to ${verifyEmail}. Open that message and click the link to continue.`;
}

checkVerificationStatus();
verifyEmailLink();
