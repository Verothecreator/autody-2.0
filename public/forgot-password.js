const resetRequestForm = document.getElementById("password-reset-request-form");
const resetConfirmForm = document.getElementById("password-reset-confirm-form");
const resetEmailInput = document.getElementById("password-reset-email");
const resetRequestMessage = document.getElementById("password-reset-request-message");
const resetConfirmMessage = document.getElementById("password-reset-confirm-message");
const resetRequestButton = document.getElementById("password-reset-request-button");
const resetConfirmButton = document.getElementById("password-reset-confirm-button");

function setResetMessage(node, message, state = "error") {
  if (!node) return;
  node.textContent = message || "";
  node.hidden = !message;
  node.dataset.state = state;
  node.classList.toggle("auth-success", state === "success");
  node.classList.toggle("auth-error", state !== "success");
}

async function postResetJson(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success) {
    throw new Error(data.error || "Request failed.");
  }
  return data;
}

resetRequestForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  setResetMessage(resetRequestMessage, "");
  setResetMessage(resetConfirmMessage, "");

  const form = new FormData(resetRequestForm);
  const email = String(form.get("email") || "").trim();
  if (!email) {
    setResetMessage(resetRequestMessage, "Enter the email address on your Autody account.");
    return;
  }

  if (resetRequestButton) {
    resetRequestButton.disabled = true;
    resetRequestButton.textContent = "Sending Code";
  }

  try {
    const data = await postResetJson("/api/auth/password-reset/request", { email });
    resetConfirmForm.hidden = false;
    setResetMessage(resetRequestMessage, data.delivery || "Password reset code sent.", "success");
  } catch (err) {
    setResetMessage(resetRequestMessage, err.message || "Could not send password reset code.");
  } finally {
    if (resetRequestButton) {
      resetRequestButton.disabled = false;
      resetRequestButton.textContent = "Send Reset Code";
    }
  }
});

resetConfirmForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  setResetMessage(resetConfirmMessage, "");

  const form = new FormData(resetConfirmForm);
  const email = String(resetEmailInput?.value || "").trim();
  const newPassword = String(form.get("newPassword") || "");
  const confirmPassword = String(form.get("confirmPassword") || "");
  const code = String(form.get("code") || "").replace(/\s+/g, "");

  if (newPassword !== confirmPassword) {
    setResetMessage(resetConfirmMessage, "Passwords do not match.");
    return;
  }

  if (resetConfirmButton) {
    resetConfirmButton.disabled = true;
    resetConfirmButton.textContent = "Resetting";
  }

  try {
    await postResetJson("/api/auth/password-reset/confirm", { email, code, newPassword });
    setResetMessage(resetConfirmMessage, "Password reset complete. You can sign in with your new password.", "success");
    resetConfirmForm.reset();
  } catch (err) {
    setResetMessage(resetConfirmMessage, err.message || "Could not reset password.");
  } finally {
    if (resetConfirmButton) {
      resetConfirmButton.disabled = false;
      resetConfirmButton.textContent = "Reset Password";
    }
  }
});
