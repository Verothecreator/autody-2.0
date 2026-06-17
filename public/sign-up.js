const signUpForm = document.getElementById("sign-up-form");
const signUpError = document.getElementById("sign-up-error");
const signUpSuccess = document.getElementById("sign-up-success");
const signUpButton = document.getElementById("sign-up-button");

function setSignUpMessage(type, message) {
  const target = type === "success" ? signUpSuccess : signUpError;
  const other = type === "success" ? signUpError : signUpSuccess;
  if (other) {
    other.textContent = "";
    other.hidden = true;
  }
  if (!target) return;
  target.textContent = message || "";
  target.hidden = !message;
}

function signUpNextPage() {
  const params = new URLSearchParams(location.search);
  const next = params.get("next") || "account.html";
  return next.startsWith("demo-") || next === "account.html" || next.startsWith("account-") ? next : "account.html";
}

function signUpPayload(form) {
  return {
    legalName: form.get("legalName"),
    email: form.get("email"),
    phone: form.get("phone"),
    country: form.get("country"),
    dateOfBirth: form.get("dateOfBirth"),
    accountType: form.get("accountType"),
    password: form.get("password"),
    acceptedTerms: form.get("acceptedTerms") === "on"
  };
}

signUpForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  setSignUpMessage("error", "");

  const form = new FormData(signUpForm);
  const password = String(form.get("password") || "");
  const confirmPassword = String(form.get("confirmPassword") || "");

  if (password !== confirmPassword) {
    setSignUpMessage("error", "Passwords do not match.");
    return;
  }

  if (signUpButton) {
    signUpButton.disabled = true;
    signUpButton.textContent = "Creating Account";
  }

  try {
    const response = await fetch("/api/auth/sign-up", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(signUpPayload(form))
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data.success) {
      throw new Error(data.error || "Sign up failed.");
    }

    localStorage.setItem("autodyDemoSession", JSON.stringify(data.session));
    localStorage.setItem("autodyDemoUser", JSON.stringify(data.user));
    setSignUpMessage("success", "Account created. Opening your Autody account.");
    setTimeout(() => {
      location.href = data.next || signUpNextPage();
    }, 800);
  } catch (err) {
    setSignUpMessage("error", err.message || "Sign up failed.");
  } finally {
    if (signUpButton) {
      signUpButton.disabled = false;
      signUpButton.textContent = "Create Account";
    }
  }
});
