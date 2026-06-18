document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-toggle-password]");
  if (!button) return;

  const field = button.closest(".auth-password-field");
  const input = field?.querySelector("input");
  if (!input) return;

  const shouldShow = input.type === "password";
  input.type = shouldShow ? "text" : "password";
  button.setAttribute("aria-label", shouldShow ? "Hide password" : "Show password");
});
