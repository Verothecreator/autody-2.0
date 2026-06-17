const signUpForm = document.getElementById("sign-up-form");
const signUpError = document.getElementById("sign-up-error");
const signUpSuccess = document.getElementById("sign-up-success");
const signUpButton = document.getElementById("sign-up-button");
const countryCodeSelect = document.getElementById("country-code");

const countryCallingCodes = [
  ["US", "+1", "United States"],
  ["CA", "+1", "Canada"],
  ["GB", "+44", "United Kingdom"],
  ["AU", "+61", "Australia"],
  ["NZ", "+64", "New Zealand"],
  ["IE", "+353", "Ireland"],
  ["FR", "+33", "France"],
  ["DE", "+49", "Germany"],
  ["IT", "+39", "Italy"],
  ["ES", "+34", "Spain"],
  ["NL", "+31", "Netherlands"],
  ["BE", "+32", "Belgium"],
  ["CH", "+41", "Switzerland"],
  ["SE", "+46", "Sweden"],
  ["NO", "+47", "Norway"],
  ["DK", "+45", "Denmark"],
  ["FI", "+358", "Finland"],
  ["PL", "+48", "Poland"],
  ["PT", "+351", "Portugal"],
  ["AT", "+43", "Austria"],
  ["AE", "+971", "United Arab Emirates"],
  ["SA", "+966", "Saudi Arabia"],
  ["QA", "+974", "Qatar"],
  ["KW", "+965", "Kuwait"],
  ["IN", "+91", "India"],
  ["SG", "+65", "Singapore"],
  ["JP", "+81", "Japan"],
  ["KR", "+82", "South Korea"],
  ["CN", "+86", "China"],
  ["HK", "+852", "Hong Kong"],
  ["MY", "+60", "Malaysia"],
  ["PH", "+63", "Philippines"],
  ["TH", "+66", "Thailand"],
  ["ID", "+62", "Indonesia"],
  ["VN", "+84", "Vietnam"],
  ["BR", "+55", "Brazil"],
  ["MX", "+52", "Mexico"],
  ["AR", "+54", "Argentina"],
  ["CL", "+56", "Chile"],
  ["CO", "+57", "Colombia"],
  ["ZA", "+27", "South Africa"],
  ["GH", "+233", "Ghana"],
  ["KE", "+254", "Kenya"],
  ["RW", "+250", "Rwanda"],
  ["MA", "+212", "Morocco"],
  ["EG", "+20", "Egypt"]
];

function populateCountryCodes() {
  if (!countryCodeSelect) return;
  countryCodeSelect.innerHTML = countryCallingCodes
    .map(([iso, code, country]) => `<option value="${code}" title="${country}">${iso} ${code}</option>`)
    .join("");
  countryCodeSelect.value = "+1";
}

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
  const firstName = String(form.get("firstName") || "").trim();
  const lastName = String(form.get("lastName") || "").trim();
  return {
    firstName,
    lastName,
    legalName: `${firstName} ${lastName}`.trim(),
    email: form.get("email"),
    countryCode: form.get("countryCode"),
    phone: form.get("phone"),
    country: form.get("country"),
    dateOfBirth: form.get("dateOfBirth"),
    password: form.get("password"),
    acceptedAccuracy: form.get("acceptedAccuracy") === "on",
    acceptedServiceTerms: form.get("acceptedServiceTerms") === "on"
  };
}

populateCountryCodes();

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
