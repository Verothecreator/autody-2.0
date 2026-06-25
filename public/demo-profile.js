const isLiveProfile = document.body?.dataset?.profileMode === "live" || location.pathname.endsWith("account-profile.html");
const profileWalletEndpoint = isLiveProfile ? "/api/account/wallet" : "/api/demo/wallet";
const PROFILE_PLACEHOLDER_VALUES = new Set(["not_required", "not required", "pending", "unknown", "none", "null", "undefined", "-"]);

function setProfileText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = value;
}

function cleanProfileText(value = "") {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text && !PROFILE_PLACEHOLDER_VALUES.has(text.toLowerCase()) ? text : "";
}

function profileValue(value, fallback = "Not provided") {
  return cleanProfileText(value) || fallback;
}

function legacyProfileSeed(email = "") {
  const source = String(email || "autody-user");
  let hash = 0;
  for (let index = 0; index < source.length; index += 1) {
    hash = (hash * 31 + source.charCodeAt(index)) >>> 0;
  }
  return String(hash).padStart(10, "0").slice(-7);
}

function legacyProfilePhone(email = "") {
  return `+1 555 ${legacyProfileSeed(email).slice(0, 3)} ${legacyProfileSeed(email).slice(3)}`;
}

function legacyProfileCountry(country = "", email = "") {
  return profileValue(country, email ? "United States" : "Not provided");
}

function legacyProfileDateOfBirth(email = "") {
  const seed = Number(legacyProfileSeed(email)) || 0;
  const year = 1984 + (seed % 18);
  const month = String((seed % 12) + 1).padStart(2, "0");
  const day = String((seed % 28) + 1).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function titleFromEmail(email = "") {
  const local = String(email || "").split("@")[0] || "";
  return local
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .trim();
}

function titleCase(value = "") {
  return String(value || "pending").trim()
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
  const fullName = `${cleanProfileText(profile.firstName)} ${cleanProfileText(profile.lastName)}`.trim();
  const candidates = [
    fullName,
    cleanProfileText(profile.legalName),
    cleanProfileText(user.displayName),
    cleanProfileText(user.name),
    titleFromEmail(user.email),
    "Autody account"
  ];
  return candidates.find((name) => name && String(name).trim().toLowerCase() !== "vero demo") || "Autody account";
}

function profileNameParts(user = {}, displayName = "") {
  const profile = user.profile || {};
  const directFirst = cleanProfileText(profile.firstName);
  const directLast = cleanProfileText(profile.lastName);
  const source = cleanProfileText(profile.legalName)
    || cleanProfileText(user.displayName)
    || cleanProfileText(user.name)
    || cleanProfileText(displayName)
    || titleFromEmail(user.email);
  const parts = source.split(/\s+/).filter(Boolean);
  return {
    firstName: directFirst || parts[0] || "Autody",
    lastName: directLast || parts.slice(1).join(" ") || "User"
  };
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

function setProfileKycModal(open) {
  const modal = document.getElementById("profile-kyc-modal");
  if (!modal) return;
  modal.hidden = !open;
  document.body.classList.toggle("modal-open", open);
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
    const identityStatus = readableStatus(verification.identity);
    const nameParts = profileNameParts(user, displayName);
    const displayPhone = profileValue(profile.phone, legacyProfilePhone(accountEmail));
    const displayCountry = legacyProfileCountry(profile.country, accountEmail);
    const displayDob = profileValue(profile.dateOfBirth, legacyProfileDateOfBirth(accountEmail));

    setProfileText("profile-status", identityStatus === "Verified" ? "Verified" : emailStatus === "Verified" ? "Email verified" : "Needs verification");
    setProfileText("profile-name", displayName);
    setProfileText("profile-email", accountEmail);
    setProfileText("profile-initials", profileInitials(displayName, accountEmail));

    setProfileText("profile-first-name", nameParts.firstName);
    setProfileText("profile-last-name", nameParts.lastName);
    setProfileText("profile-dob", formatProfileDate(displayDob, "Not provided"));
    setProfileText("profile-country", displayCountry);

    setProfileText("profile-detail-email", accountEmail);
    setProfileText("profile-phone", displayPhone);
    setProfileText("profile-created", formatProfileDate(user.createdAt));
    setProfileText("profile-currency", wallet.currency || user.currency || "USD");

    setProfileText("profile-identity-status", identityStatus);
    setProfileText("profile-kyc-status", kycStage(verification));

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
  const openKycButton = event.target.closest("[data-profile-kyc-open]");
  if (openKycButton) {
    setProfileKycModal(true);
    return;
  }

  const closeKycButton = event.target.closest("[data-profile-kyc-close]");
  if (closeKycButton) {
    setProfileKycModal(false);
    return;
  }

  const messageButton = event.target.closest("[data-profile-message]");
  if (!messageButton) return;
  setProfileNotice(messageButton.dataset.profileMessage || "This profile feature is coming soon.");
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") setProfileKycModal(false);
});

loadProfilePage();
