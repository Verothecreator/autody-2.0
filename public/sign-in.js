const signInForm = document.getElementById("sign-in-form");
const signInError = document.getElementById("sign-in-error");
const signInButton = document.getElementById("sign-in-button");

function setError(message) {
  if (!signInError) return;
  signInError.textContent = message || "";
  signInError.hidden = !message;
}

function nextPage() {
  const params = new URLSearchParams(location.search);
  const next = params.get("next") || "demo-wallet.html";
  return next.startsWith("demo-") ? next : "demo-wallet.html";
}

signInForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  setError("");

  const form = new FormData(signInForm);
  const payload = {
    email: form.get("email"),
    password: form.get("password")
  };

  if (signInButton) {
    signInButton.disabled = true;
    signInButton.textContent = "Signing In";
  }

  try {
    const response = await fetch("/api/auth/sign-in", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data.success) {
      throw new Error(data.error || "Sign in failed.");
    }

    localStorage.setItem("autodyDemoSession", JSON.stringify(data.session));
    localStorage.setItem("autodyDemoUser", JSON.stringify(data.user));
    location.href = nextPage();
  } catch (err) {
    setError(err.message || "Sign in failed.");
  } finally {
    if (signInButton) {
      signInButton.disabled = false;
      signInButton.textContent = "Sign In";
    }
  }
});
