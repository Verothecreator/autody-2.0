const isLiveProfile = document.body?.dataset?.profileMode === "live" || location.pathname.endsWith("account-profile.html");
const profileModeLabel = isLiveProfile ? "Live account" : "Demo trading";
const profileWalletEndpoint = isLiveProfile ? "/api/account/wallet" : "/api/demo/wallet";

function setProfileText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = value;
}

function profileValue(value, fallback = "Not provided") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function titleFromEmail(email = "") {
  const local = String(email || "").split("@")[0] || "";
  return local
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .trim();
}

function titleCase(value = "") {
  return profileValue(value)
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function readableStatus(value = "") {
  return titleCase(value || "pending");
}

function formatProfileDate(value, fallback = "Not recorded") {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

function formatProfileDateTime(value, fallback = "Not recorded") {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function profileDisplayName(user = {}) {
  const profile = user.profile || {};
  const fullName = `${profile.firstName || ""} ${profile.lastName || ""}`.trim();
  const candidates = [
    fullName,
    profile.legalName,
    user.displayName,
    user.name,
    titleFromEmail(user.email),
    "Autody account"
  ];
  return candidates.find((name) => name && String(name).trim().toLowerCase() !== "vero demo") || "Autody account";
}

function profileInitials(name = "", email = "") {
  const source = String(name || titleFromEmail(email) || "Autody User").trim();
  const parts = source.split(/\s+/).filter(Boolean);
  const initials = parts.length > 1
    ? `${parts[0][0] || ""}${parts[1][0] || ""}`
    : `${source[0] || "A"}${source[1] || "U"}`;
  return initials.toUpperCase();
}

function kycStage(verification = {}) {
  const email = String(verification.email || "").toLowerCase();
  const identity = String(verification.identity || "").toLowerCase();
  if (identity === "verified" || identity === "approved") return "Verified";
  if (identity === "reviewing" || identity === "in_review") return "In review";
  if (email === "verified") return "Ready to start";
  return "Email required";
}

async function getProfileJson(url) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: window.AutodyAuth?.headers?.() || {}
  });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

function setProfileNotice(message) {
  const notice = document.getElementById("profile-notice");
  if (!notice) return;
  notice.textContent = message;
  notice.hidden = false;
  setTimeout(() => {
    notice.hidden = true;
  }, 4800);
}

async function loadProfilePage() {
  try {
    const walletData = await getProfileJson(profileWalletEndpoint);
    const wallet = walletData.wallet || {};
    const user = walletData.user || {};
    const profile = user.profile || {};
    const verification = user.verification || {};
    const accountEmail = profileValue(user.email, "Not available");
    const displayName = profileDisplayName(user);
    const emailStatus = readableStatus(verification.email);
    const phoneStatus = readableStatus(verification.phone);
    const identityStatus = readableStatus(verification.identity);

    setProfileText("profile-status", identityStatus === "Verified" ? "Verified" : emailStatus === "Verified" ? "Email verified" : "Needs verification");
    setProfileText("profile-name", displayName);
    setProfileText("profile-email", accountEmail);
    setProfileText("profile-initials", profileInitials(displayName, accountEmail));
    setProfileText("profile-mode-badge", profileModeLabel);
    setProfileText("profile-verification-badge", `Email ${emailStatus}`);

    setProfileText("profile-first-name", profileValue(profile.firstName));
    setProfileText("profile-last-name", profileValue(profile.lastName));
    setProfileText("profile-legal-name", profileValue(profile.legalName || displayName));
    setProfileText("profile-dob", formatProfileDate(profile.dateOfBirth, "Not provided"));
    setProfileText("profile-country", profileValue(profile.country));
    setProfileText("profile-account-type", titleCase(profile.accountType || "personal"));

    setProfileText("profile-detail-email", accountEmail);
    setProfileText("profile-phone", profileValue(profile.phone));
    setProfileText("profile-email-status", emailStatus);
    setProfileText("profile-phone-status", phoneStatus);
    setProfileText("profile-created", formatProfileDate(user.createdAt));
    setProfileText("profile-currency", wallet.currency || user.currency || "USD");

    setProfileText("profile-identity-status", identityStatus);
    setProfileText("profile-kyc-status", kycStage(verification));
    setProfileText("profile-terms-version", profileValue(profile.termsVersion, "Current platform terms"));
    setProfileText("profile-terms-accepted", formatProfileDateTime(profile.termsAcceptedAt));
    setProfileText("profile-information-confirmed", formatProfileDateTime(profile.informationConfirmedAt));

    if (isLiveProfile) {
      const cash = Number(wallet.cashBalance || 0);
      const balanceText = `${new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 2
      }).format(cash)} USD`;
      document.querySelectorAll("[data-live-balance]").forEach((node) => {
        node.textContent = balanceText;
      });
    }
  } catch (err) {
    console.warn("Profile page failed:", err);
    setProfileText("profile-status", "Warming up");
    setProfileText("profile-name", "Autody account");
    setProfileText("profile-email", "Account details are loading");
  }
}

document.addEventListener("click", (event) => {
  const messageButton = event.target.closest("[data-profile-message]");
  if (!messageButton) return;
  setProfileNotice(messageButton.dataset.profileMessage || "This profile feature is coming soon.");
});

loadProfilePage();
