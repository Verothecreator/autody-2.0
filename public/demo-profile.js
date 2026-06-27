const isLiveProfile = document.body?.dataset?.profileMode === "live" || location.pathname.endsWith("account-profile.html");
const profileWalletEndpoint = isLiveProfile ? "/api/account/wallet" : "/api/demo/wallet";
const PROFILE_PLACEHOLDER_VALUES = new Set(["not_required", "not required", "pending", "unknown", "none", "null", "undefined", "-"]);
const KYC_MAX_DOCUMENT_FILES = 2;
let kycFaceStream = null;
let kycCapturedFaceDataUrl = "";
let currentKycIdentityStatus = "pending";
let currentKycReviewNote = "";
let kycReviewLocked = false;

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

function normalizeKycStatus(value = "") {
  return String(value || "").toLowerCase().replace(/[\s-]+/g, "_");
}

function isKycInReview(value = "") {
  return ["in_review", "reviewing", "submitted"].includes(normalizeKycStatus(value));
}

function isKycVerified(value = "") {
  return ["verified", "approved"].includes(normalizeKycStatus(value));
}

function isKycRejected(value = "") {
  return ["rejected", "declined", "failed"].includes(normalizeKycStatus(value));
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
  const email = String(verification.email || verification.emailStatus || "").toLowerCase();
  const identity = String(verification.identity || verification.identityStatus || "").toLowerCase();
  if (identity === "verified" || identity === "approved") return "Verified";
  if (identity === "reviewing" || identity === "in_review") return "In review";
  if (email === "verified") return "Ready to start";
  return "Email required";
}

function kycReasonLabel(value = "") {
  const labels = {
    invalid_document: "Invalid document",
    invalid_id: "Invalid ID",
    inadequate_selfie: "Inadequate selfie",
    document_selfie_mismatch: "Document and selfie mismatch",
    expired_document: "Expired document",
    unclear_document: "Unclear document",
    unsupported_document: "Unsupported document",
    other: "Other"
  };
  return labels[String(value || "").toLowerCase()] || "";
}

function setKycButtonState(identityStatus = currentKycIdentityStatus) {
  const button = document.getElementById("profile-kyc-button") || document.querySelector("[data-profile-kyc-open]");
  if (!button) return;
  const normalized = normalizeKycStatus(identityStatus);
  button.disabled = false;
  button.classList.remove("profile-kyc-button-verified", "profile-kyc-button-rejected", "profile-kyc-button-reviewing");

  if (isKycVerified(normalized)) {
    button.textContent = "Verified";
    button.disabled = true;
    button.classList.add("profile-kyc-button-verified");
    return;
  }
  if (isKycRejected(normalized)) {
    button.textContent = "Rejected";
    button.classList.add("profile-kyc-button-rejected");
    return;
  }
  if (isKycInReview(normalized)) {
    button.textContent = "In Review";
    button.classList.add("profile-kyc-button-reviewing");
    return;
  }
  button.textContent = "Verify Identity";
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
  if (open) {
    setKycReviewState(currentKycIdentityStatus);
    if (!kycReviewLocked) setKycStep("document");
  }
  if (!open) stopKycCamera();
}

function kycNode(id) {
  return document.getElementById(id);
}

function setKycStep(step = "document") {
  if (kycReviewLocked) return;
  const normalized = step === "face" ? "face" : "document";
  const modal = document.getElementById("profile-kyc-modal");
  if (modal) modal.dataset.kycActiveStep = normalized;
  document.querySelectorAll("[data-kyc-step-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.kycStepPanel !== normalized;
  });
  if (normalized !== "face") stopKycCamera();
}

function setKycReviewState(identityStatus = currentKycIdentityStatus) {
  const normalized = normalizeKycStatus(identityStatus);
  currentKycIdentityStatus = normalized || "pending";
  const modal = document.getElementById("profile-kyc-modal");
  const form = document.querySelector("[data-kyc-form]");
  const reviewState = document.querySelector("[data-kyc-review-state]");
  const label = kycNode("kyc-review-state-label");
  const title = kycNode("kyc-review-state-title");
  const copy = kycNode("kyc-review-state-copy");
  const retryButton = document.querySelector("[data-kyc-retry]");
  const locked = isKycInReview(normalized) || isKycVerified(normalized) || isKycRejected(normalized);

  kycReviewLocked = locked;
  if (modal) modal.dataset.kycLocked = locked ? "true" : "false";
  if (form) form.hidden = locked;
  if (reviewState) reviewState.hidden = !locked;
  if (retryButton) retryButton.hidden = true;
  setKycButtonState(normalized);

  if (!locked) return;

  stopKycCamera();
  if (isKycVerified(normalized)) {
    if (label) label.textContent = "Review complete";
    if (title) title.textContent = "Identity verified";
    if (copy) copy.textContent = "Your identity review is complete. No additional upload is needed right now.";
    return;
  }
  if (isKycRejected(normalized)) {
    if (label) label.textContent = "Review decision";
    if (title) title.textContent = "Identity review was rejected";
    if (copy) copy.textContent = currentKycReviewNote
      ? `Reason: ${currentKycReviewNote}`
      : "Autody could not approve this submission. Upload a clearer document and face scan to try again.";
    if (retryButton) retryButton.hidden = false;
    return;
  }
  if (label) label.textContent = "Review submitted";
  if (title) title.textContent = "Verification is in review";
  if (copy) copy.textContent = "We received your identity document and face scan. Reviews usually take 2-3 business days. You do not need to upload anything else unless Autody asks for a clearer document.";
}

function beginKycRetryUpload() {
  const modal = document.getElementById("profile-kyc-modal");
  const form = document.querySelector("[data-kyc-form]");
  const reviewState = document.querySelector("[data-kyc-review-state]");
  const retryButton = document.querySelector("[data-kyc-retry]");
  kycReviewLocked = false;
  if (modal) modal.dataset.kycLocked = "false";
  if (form) {
    form.hidden = false;
    form.reset();
  }
  if (reviewState) reviewState.hidden = true;
  if (retryButton) retryButton.hidden = true;
  kycCapturedFaceDataUrl = "";
  const preview = kycNode("kyc-face-preview");
  if (preview) preview.removeAttribute("src");
  setKycFaceState("idle");
  setKycStep("document");
  setProfileNotice("Upload a clearer document and fresh face scan for another review.");
}

function goToKycFaceStep() {
  const documentFiles = Array.from(kycNode("kyc-document-file")?.files || []);
  if (!documentFiles.length) {
    setProfileNotice("Upload an identity document before moving to the face scan.");
    return;
  }
  if (documentFiles.length > KYC_MAX_DOCUMENT_FILES) {
    setProfileNotice("Upload no more than 2 identity document files.");
    return;
  }
  setKycStep("face");
}

function setKycFaceState(state = "idle") {
  const video = kycNode("kyc-face-video");
  const preview = kycNode("kyc-face-preview");
  const startButton = document.querySelector("[data-kyc-camera-start]");
  const captureButton = document.querySelector("[data-kyc-camera-capture]");
  const retakeButton = document.querySelector("[data-kyc-camera-retake]");
  const hasPreview = state === "captured";
  const hasCamera = state === "camera";

  if (video) video.hidden = !hasCamera;
  if (preview) preview.hidden = !hasPreview;
  if (startButton) startButton.hidden = hasCamera;
  if (captureButton) {
    captureButton.hidden = !hasCamera;
    captureButton.disabled = !hasCamera;
  }
  if (retakeButton) retakeButton.hidden = !hasPreview;
}

function stopKycCamera() {
  if (kycFaceStream) {
    kycFaceStream.getTracks().forEach((track) => track.stop());
    kycFaceStream = null;
  }
  const video = kycNode("kyc-face-video");
  if (video) video.srcObject = null;
  if (!kycCapturedFaceDataUrl) setKycFaceState("idle");
}

async function startKycCamera() {
  const video = kycNode("kyc-face-video");
  if (!video) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    setKycFaceState("unsupported");
    setProfileNotice("Camera access is required to complete the face scan.");
    return;
  }
  try {
    kycCapturedFaceDataUrl = "";
    const preview = kycNode("kyc-face-preview");
    if (preview) preview.removeAttribute("src");
    stopKycCamera();
    kycFaceStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 960 }, height: { ideal: 720 } },
      audio: false
    });
    video.srcObject = kycFaceStream;
    await video.play();
    setKycFaceState("camera");
  } catch (err) {
    console.warn("KYC camera failed:", err);
    setKycFaceState("unsupported");
    setProfileNotice("Camera permission is required to complete the face scan.");
  }
}

async function kycFaceGuideCheck(canvas) {
  if (!("FaceDetector" in window)) return { ok: true };
  let bitmap = null;
  try {
    const detector = new FaceDetector({ fastMode: true, maxDetectedFaces: 2 });
    const source = window.createImageBitmap ? await createImageBitmap(canvas) : canvas;
    bitmap = source !== canvas ? source : null;
    const faces = await detector.detect(source);
    if (!faces.length) {
      return { ok: false, message: "No face detected. Center your face inside the guide and capture again." };
    }
    if (faces.length > 1) {
      return { ok: false, message: "Only one face should be visible in the scan." };
    }
    const box = faces[0].boundingBox;
    const centerX = box.x + (box.width / 2);
    const centerY = box.y + (box.height / 2);
    const width = canvas.width || 1;
    const height = canvas.height || 1;
    const faceWidthRatio = box.width / width;
    const faceHeightRatio = box.height / height;
    const centered = centerX > width * 0.33
      && centerX < width * 0.67
      && centerY > height * 0.22
      && centerY < height * 0.62;
    const sized = faceWidthRatio > 0.18
      && faceWidthRatio < 0.55
      && faceHeightRatio > 0.18
      && faceHeightRatio < 0.62;
    if (!centered || !sized) {
      return { ok: false, message: "Move your face into the center of the guide, then capture again." };
    }
    return { ok: true };
  } catch (err) {
    console.warn("KYC face guide check unavailable:", err);
    return { ok: true };
  } finally {
    bitmap?.close?.();
  }
}

async function captureKycFace() {
  const video = kycNode("kyc-face-video");
  const canvas = kycNode("kyc-face-canvas");
  const preview = kycNode("kyc-face-preview");
  if (!video || !canvas || !preview || !video.videoWidth) {
    setProfileNotice("Start the camera before capturing the face scan.");
    return;
  }
  const squareSize = Math.min(video.videoWidth, video.videoHeight, 960);
  const sourceX = Math.max(0, Math.round((video.videoWidth - squareSize) / 2));
  const sourceY = Math.max(0, Math.round((video.videoHeight - squareSize) / 2));
  canvas.width = squareSize;
  canvas.height = squareSize;
  const context = canvas.getContext("2d");
  context.save();
  context.translate(squareSize, 0);
  context.scale(-1, 1);
  context.drawImage(video, sourceX, sourceY, squareSize, squareSize, 0, 0, squareSize, squareSize);
  context.restore();
  const guideCheck = await kycFaceGuideCheck(canvas);
  if (!guideCheck.ok) {
    setProfileNotice(guideCheck.message || "Center your face inside the guide and capture again.");
    return;
  }
  kycCapturedFaceDataUrl = canvas.toDataURL("image/jpeg", 0.9);
  preview.src = kycCapturedFaceDataUrl;
  stopKycCamera();
  setKycFaceState("captured");
}

function retakeKycFace() {
  kycCapturedFaceDataUrl = "";
  const preview = kycNode("kyc-face-preview");
  if (preview) preview.removeAttribute("src");
  startKycCamera();
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Could not read file."));
    reader.readAsDataURL(file);
  });
}

async function fileToKycPayload(file, fallbackName) {
  return {
    name: file.name || fallbackName,
    type: file.type || "application/octet-stream",
    data: await fileToDataUrl(file)
  };
}

async function submitKycReview(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submitButton = kycNode("kyc-submit-button");
  const documentInput = kycNode("kyc-document-file");
  const documentFiles = Array.from(documentInput?.files || []);

  if (!documentFiles.length) {
    setProfileNotice("Upload an identity document before submitting.");
    return;
  }
  if (documentFiles.length > KYC_MAX_DOCUMENT_FILES) {
    setProfileNotice("Upload no more than 2 identity document files.");
    return;
  }
  if (!kycCapturedFaceDataUrl) {
    setProfileNotice("Capture a live face scan before submitting.");
    return;
  }

  const originalText = submitButton?.textContent || "Submit Verification";
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = "Submitting review...";
  }

  try {
    const documentPayloads = await Promise.all(
      documentFiles.map((file, index) => fileToKycPayload(file, index ? "identity-document-back" : "identity-document"))
    );
    const selfiePayload = { name: "face-scan.jpg", type: "image/jpeg", data: kycCapturedFaceDataUrl };
    const body = {
      mode: isLiveProfile ? "live" : "demo",
      documentType: form.documentType?.value || "government_id",
      documentFile: documentPayloads[0],
      documentFiles: documentPayloads,
      selfieFile: selfiePayload
    };
    const response = await fetch("/api/kyc/submissions", {
      method: "POST",
      cache: "no-store",
      headers: window.AutodyAuth?.headers?.({ "Content-Type": "application/json" }) || { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) throw new Error(data.error || "Identity review could not be submitted.");
    currentKycIdentityStatus = "in_review";
    currentKycReviewNote = "";
    setProfileNotice("Identity review submitted. Reviews usually take 2-3 business days.");
    form.reset();
    kycCapturedFaceDataUrl = "";
    const preview = kycNode("kyc-face-preview");
    if (preview) preview.removeAttribute("src");
    setKycFaceState("idle");
    setKycReviewState("in_review");
  } catch (err) {
    console.warn("KYC submit failed:", err);
    setProfileNotice(err.message || "Identity review could not be submitted.");
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = originalText;
    }
  }
}

async function loadProfilePage() {
  try {
    const walletData = await getProfileJson(profileWalletEndpoint);
    const wallet = walletData.wallet || {};
    const user = walletData.user || {};
    const profile = user.profile || {};
    const verification = user.verification || {};
    currentKycIdentityStatus = normalizeKycStatus(verification.identity || verification.identityStatus || "pending");
    const reviewReasonLabel = kycReasonLabel(verification.reviewReason || verification.rejectionReason);
    const reviewNote = cleanProfileText(verification.reviewNote || "");
    currentKycReviewNote = reviewReasonLabel
      ? `${reviewReasonLabel}${reviewNote && reviewNote !== reviewReasonLabel ? `: ${reviewNote}` : ""}`
      : reviewNote;
    const accountEmail = profileValue(user.email, "Not available");
    const displayName = profileDisplayName(user);
    const emailStatus = readableStatus(verification.email || verification.emailStatus);
    const identityStatus = readableStatus(verification.identity || verification.identityStatus);
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

    setKycReviewState(currentKycIdentityStatus);

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

  const kycNextButton = event.target.closest("[data-kyc-next]");
  if (kycNextButton) {
    goToKycFaceStep();
    return;
  }

  const kycBackButton = event.target.closest("[data-kyc-back]");
  if (kycBackButton) {
    setKycStep("document");
    return;
  }

  const cameraStart = event.target.closest("[data-kyc-camera-start]");
  if (cameraStart) {
    startKycCamera();
    return;
  }

  const cameraCapture = event.target.closest("[data-kyc-camera-capture]");
  if (cameraCapture) {
    captureKycFace();
    return;
  }

  const kycRetryButton = event.target.closest("[data-kyc-retry]");
  if (kycRetryButton) {
    beginKycRetryUpload();
    return;
  }

  const cameraRetake = event.target.closest("[data-kyc-camera-retake]");
  if (cameraRetake) {
    retakeKycFace();
    return;
  }

  const messageButton = event.target.closest("[data-profile-message]");
  if (!messageButton) return;
  setProfileNotice(messageButton.dataset.profileMessage || "This profile feature is coming soon.");
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") setProfileKycModal(false);
});

document.querySelector("[data-kyc-form]")?.addEventListener("submit", submitKycReview);

loadProfilePage();
