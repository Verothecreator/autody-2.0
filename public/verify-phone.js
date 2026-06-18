const verifyPhoneForm = document.getElementById("verify-phone-form");
const verifyPhoneEmail = document.getElementById("verify-phone-email");
const verifyPhoneError = document.getElementById("verify-phone-error");
const verifyPhoneSuccess = document.getElementById("verify-phone-success");
const verifyPhoneButton = document.getElementById("verify-phone-button");
const resendPhoneButton = document.getElementById("resend-phone-button");

const verifyPhoneParams = new URLSearchParams(location.search);
const verifyPhoneAccountEmail = verifyPhoneParams.get("email") || sessionStorage.getItem("autodyPendingEmail") || "";

function setVerifyPhoneMessage(type, message) {
  const target = type === "success" ? verifyPhoneSuccess : verifyPhoneError;
  const other = type === "success" ? verifyPhoneError : verifyPhoneSuccess;
  if (other) {
    other.textContent = "";
    other.hidden = true;
  }
  if (!target) return;
  target.textContent = message || "";
  target.hidden = !message;
}

async function loadVerificationStatus() {
  if (!verifyPhoneAccountEmail) return;
  try {
    const response = await fetch(`/api/auth/verification-status?email=${encodeURIComponent(verifyPhoneAccountEmail)}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) return;
    if (data.verification?.email !== "verified") {
      location.href = `verify-email.html?email=${encodeURIComponent(verifyPhoneAccountEmail)}`;
      return;
    }
    if (data.verification?.phone === "verified") {
      setVerifyPhoneMessage("success", "Phone already verified. You can sign in.");
    }
  } catch (err) {
    setVerifyPhoneMessage("error", "Could not load verification status.");
  }
}

verifyPhoneForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!verifyPhoneAccountEmail) {
    setVerifyPhoneMessage("error", "Account email is missing.");
    return;
  }

  const form = new FormData(verifyPhoneForm);
  const code = String(form.get("code") || "").replace(/\D/g, "");
  if (code.length < 4) {
    setVerifyPhoneMessage("error", "Enter the code sent to your phone.");
    return;
  }

  if (verifyPhoneButton) {
    verifyPhoneButton.disabled = true;
    verifyPhoneButton.textContent = "Verifying";
  }

  try {
    const response = await fetch("/api/auth/verify-phone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: verifyPhoneAccountEmail, code })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) throw new Error(data.error || "Phone verification failed.");

    localStorage.setItem("autodyDemoSession", JSON.stringify(data.session));
    localStorage.setItem("autodyDemoUser", JSON.stringify(data.user));
    sessionStorage.removeItem("autodyPendingEmail");
    setVerifyPhoneMessage("success", "Phone verified. Opening your Autody account.");
    setTimeout(() => {
      location.href = data.next || "account.html";
    }, 800);
  } catch (err) {
    setVerifyPhoneMessage("error", err.message || "Phone verification failed.");
  } finally {
    if (verifyPhoneButton) {
      verifyPhoneButton.disabled = false;
      verifyPhoneButton.textContent = "Verify Phone";
    }
  }
});

resendPhoneButton?.addEventListener("click", async () => {
  if (!verifyPhoneAccountEmail) {
    setVerifyPhoneMessage("error", "Account email is missing.");
    return;
  }

  resendPhoneButton.disabled = true;
  setVerifyPhoneMessage("success", "Sending a new phone code.");
  try {
    const response = await fetch("/api/auth/resend-phone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: verifyPhoneAccountEmail })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) throw new Error(data.error || "Could not send phone code.");
    setVerifyPhoneMessage("success", "Phone code sent.");
  } catch (err) {
    setVerifyPhoneMessage("error", err.message || "Could not send phone code.");
  } finally {
    resendPhoneButton.disabled = false;
  }
});

if (verifyPhoneEmail) verifyPhoneEmail.textContent = verifyPhoneAccountEmail || "Email missing";
loadVerificationStatus();
