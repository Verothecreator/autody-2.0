const liveCryptoAssets = {
  AU: {
    name: "Autody AU",
    networks: ["Polygon PoS"],
    addressPrefix: "0x"
  },
  BTC: {
    name: "Bitcoin",
    networks: ["Bitcoin"],
    addressPrefix: "bc1"
  },
  ETH: {
    name: "Ethereum",
    networks: ["Ethereum ERC-20", "Base", "Arbitrum One", "Optimism"],
    addressPrefix: "0x"
  },
  USDT: {
    name: "Tether USDt",
    networks: ["Ethereum ERC-20", "BNB Smart Chain BEP-20", "Polygon PoS", "Arbitrum One", "Optimism", "Avalanche C-Chain", "Tron TRC-20"],
    addressPrefix: "0x"
  },
  USDC: {
    name: "USD Coin",
    networks: ["Ethereum ERC-20", "Base", "Polygon PoS", "Arbitrum One", "Optimism", "Avalanche C-Chain"],
    addressPrefix: "0x"
  },
  BNB: {
    name: "BNB",
    networks: ["BNB Smart Chain BEP-20"],
    addressPrefix: "0x"
  },
  SOL: { name: "Solana", networks: ["Solana"], addressPrefix: "" },
  XRP: { name: "XRP", networks: ["XRP Ledger"], addressPrefix: "r" },
  DOGE: { name: "Dogecoin", networks: ["Dogecoin"], addressPrefix: "D" },
  LTC: { name: "Litecoin", networks: ["Litecoin"], addressPrefix: "ltc1" },
  BCH: { name: "Bitcoin Cash", networks: ["Bitcoin Cash"], addressPrefix: "bitcoincash:" },
  XLM: { name: "Stellar", networks: ["Stellar"], addressPrefix: "G" },
  TRX: { name: "TRON", networks: ["Tron TRC-20"], addressPrefix: "T" },
  AVAX: { name: "Avalanche", networks: ["Avalanche C-Chain"], addressPrefix: "0x" },
  LINK: { name: "Chainlink", networks: ["Ethereum ERC-20", "Polygon PoS", "Arbitrum One"], addressPrefix: "0x" },
  POL: { name: "Polygon", networks: ["Polygon PoS", "Ethereum ERC-20"], addressPrefix: "0x" },
  UNI: { name: "Uniswap", networks: ["Ethereum ERC-20", "Polygon PoS", "Arbitrum One"], addressPrefix: "0x" },
  AAVE: { name: "Aave", networks: ["Ethereum ERC-20", "Polygon PoS", "Arbitrum One"], addressPrefix: "0x" },
  ARB: { name: "Arbitrum", networks: ["Arbitrum One"], addressPrefix: "0x" },
  OP: { name: "Optimism", networks: ["Optimism"], addressPrefix: "0x" },
  SHIB: { name: "Shiba Inu", networks: ["Ethereum ERC-20"], addressPrefix: "0x" },
  FET: { name: "Artificial Superintelligence Alliance", networks: ["Ethereum ERC-20"], addressPrefix: "0x" },
  RENDER: { name: "Render", networks: ["Ethereum ERC-20"], addressPrefix: "0x" },
  PEPE: { name: "Pepe", networks: ["Ethereum ERC-20"], addressPrefix: "0x" },
  DAI: { name: "Dai", networks: ["Ethereum ERC-20", "Polygon PoS", "Arbitrum One", "Optimism"], addressPrefix: "0x" },
  PYUSD: { name: "PayPal USD", networks: ["Ethereum ERC-20"], addressPrefix: "0x" },
  FDUSD: { name: "First Digital USD", networks: ["Ethereum ERC-20", "BNB Smart Chain BEP-20"], addressPrefix: "0x" },
  TUSD: { name: "TrueUSD", networks: ["Ethereum ERC-20", "BNB Smart Chain BEP-20"], addressPrefix: "0x" },
  MKR: { name: "Maker", networks: ["Ethereum ERC-20"], addressPrefix: "0x" },
  LDO: { name: "Lido DAO", networks: ["Ethereum ERC-20", "Arbitrum One"], addressPrefix: "0x" },
  QNT: { name: "Quant", networks: ["Ethereum ERC-20"], addressPrefix: "0x" },
  GRT: { name: "The Graph", networks: ["Ethereum ERC-20", "Arbitrum One"], addressPrefix: "0x" },
  CRV: { name: "Curve DAO", networks: ["Ethereum ERC-20", "Arbitrum One"], addressPrefix: "0x" },
  MANA: { name: "Decentraland", networks: ["Ethereum ERC-20", "Polygon PoS"], addressPrefix: "0x" }
};

const liveNotice = document.getElementById("live-notice");
let liveNoticeTimer = null;
const receiveRouteCache = new Map();
let liveSendWalletCache = null;
let liveWithdrawalAccessLoading = false;

function liveCryptoOptionMarkup() {
  return Object.entries(liveCryptoAssets)
    .sort(([symbolA], [symbolB]) => symbolA.localeCompare(symbolB))
    .map(([symbol, asset]) => `<option value="${symbol}">${symbol} / ${asset.name}</option>`)
    .join("");
}

function populateLiveCryptoSelects() {
  const options = liveCryptoOptionMarkup();
  document.querySelectorAll("#receive-asset, #send-asset").forEach((select) => {
    if (!select) return;
    const currentValue = select.value;
    select.innerHTML = options;
    if (liveCryptoAssets[currentValue]) select.value = currentValue;
  });
}

function defaultLiveCryptoSymbol() {
  return Object.keys(liveCryptoAssets)[0] || "ETH";
}

function supportedLiveCryptoSymbol(symbol) {
  const value = String(symbol || "").trim().toUpperCase();
  return liveCryptoAssets[value] ? value : "";
}

function showLiveNotice(message, type = "info") {
  if (!liveNotice) return;
  clearTimeout(liveNoticeTimer);
  liveNotice.textContent = message;
  liveNotice.dataset.type = type;
  liveNotice.hidden = false;
  liveNoticeTimer = setTimeout(() => {
    liveNotice.hidden = true;
  }, 5200);
}

async function postLiveAccountJson(url, body) {
  if (typeof postLiveWalletJson === "function") {
    return postLiveWalletJson(url, body);
  }

  const response = await fetch(url, {
    method: "POST",
    headers: window.AutodyAuth?.headers?.({ "Content-Type": "application/json" }) || { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success) throw new Error(data.error || `${url} returned ${response.status}`);
  return data;
}

async function getLiveAccountJson(url) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: window.AutodyAuth?.headers?.() || {}
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success) throw new Error(data.error || `${url} returned ${response.status}`);
  return data;
}

function formatLiveSendAmount(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "";
  return number.toFixed(8).replace(/\.?0+$/, "");
}

function formatLiveSendUsd(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "";
  return number.toFixed(2);
}

async function liveSendWallet() {
  const data = await getLiveAccountJson("/api/account/wallet");
  liveSendWalletCache = data.wallet || null;
  window.AutodyLiveWithdrawalAccess = liveSendWalletCache?.withdrawalAccess || null;
  return liveSendWalletCache;
}

function currentWithdrawalAccess() {
  return liveSendWalletCache?.withdrawalAccess || window.AutodyLiveWithdrawalAccess || null;
}

function activeWithdrawalGate() {
  const access = currentWithdrawalAccess();
  return access?.gated ? access : null;
}

function updateLiveWithdrawalGate() {
  const gate = document.getElementById("live-withdrawal-gate");
  const fields = document.getElementById("live-send-form-fields");
  if (!gate || !fields) return;

  if (typeof window.AutodyLiveWithdrawalAccess === "undefined" && !liveSendWalletCache && !liveWithdrawalAccessLoading) {
    liveWithdrawalAccessLoading = true;
    liveSendWallet()
      .catch(() => null)
      .finally(() => {
        liveWithdrawalAccessLoading = false;
        updateLiveWithdrawalGate();
      });
  }

  const gateState = activeWithdrawalGate();
  const shouldGate = Boolean(gateState);
  gate.hidden = !shouldGate;
  fields.hidden = shouldGate;

  if (!shouldGate) return;

  const title = document.getElementById("withdrawal-gate-title");
  const message = document.getElementById("withdrawal-gate-message");
  const eyebrow = document.getElementById("withdrawal-gate-eyebrow");
  const action = document.getElementById("withdrawal-gate-action");
  if (eyebrow) {
    eyebrow.textContent = gateState.stage === "identity_required"
      ? "Identity check"
      : "Withdrawal hold";
  }
  if (title) title.textContent = gateState.title || "Withdrawal access";
  if (message) message.textContent = gateState.message || "Withdrawal access is not available for this account yet.";
  if (action) action.textContent = gateState.actionLabel || "Close";
}

function handleWithdrawalGateAction() {
  const gateState = activeWithdrawalGate();
  if (gateState?.stage === "identity_required") {
    window.location.href = "account-settings";
    return;
  }
  closeAutodyLiveTransferModal();
}

function liveSendHoldingForSymbol(wallet = {}, symbol = "") {
  const lookup = String(symbol || "").trim().toUpperCase();
  return (wallet.holdings || []).find((item) => String(item.symbol || "").toUpperCase() === lookup) || null;
}

function liveSendBalanceForSymbol(wallet = {}, symbol = "") {
  const lookup = String(symbol || "").trim().toUpperCase();
  if (lookup === "USD") return Number(wallet.cashBalance || 0);
  return Number(liveSendHoldingForSymbol(wallet, lookup)?.balance || 0);
}

function liveSendValueForSymbol(wallet = {}, symbol = "") {
  const lookup = String(symbol || "").trim().toUpperCase();
  if (lookup === "USD") return Number(wallet.cashBalance || 0);
  const holding = liveSendHoldingForSymbol(wallet, lookup);
  const direct = Number(holding?.valueUsd);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const balance = Number(holding?.balance || 0);
  const price = Number(holding?.lastPrice || holding?.price || 0);
  return Number.isFinite(balance) && Number.isFinite(price) ? balance * price : 0;
}

function currentSendAmountMode() {
  return document.getElementById("send-amount-mode")?.value === "asset" ? "asset" : "usd";
}

function updateSendAmountPlaceholder() {
  const amountInput = document.getElementById("send-amount");
  const mode = currentSendAmountMode();
  const asset = document.getElementById("send-asset")?.value || defaultLiveCryptoSymbol();
  if (amountInput) amountInput.placeholder = mode === "asset" ? `0 ${asset}` : "0.00";
}

function setFundingTab(tabName) {
  document.querySelectorAll("[data-funding-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.fundingTab === tabName);
  });

  document.querySelectorAll("[data-funding-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.fundingPanel !== tabName;
  });
}

function openAutodyLiveFundingModal(tabName = "card") {
  const modal = document.getElementById("live-funding-modal");
  if (!modal) return false;
  setFundingTab(tabName || "card");
  modal.hidden = false;
  document.body.classList.add("modal-open");
  return true;
}

function closeAutodyLiveFundingModal() {
  const modal = document.getElementById("live-funding-modal");
  if (!modal) return;
  modal.hidden = true;
  if (document.getElementById("live-crypto")?.hidden !== false) {
    document.body.classList.remove("modal-open");
  }
}

function fundingMethodLabel(method) {
  return {
    card: "Card",
    ach: "ACH",
    wire: "Wire"
  }[method] || "Funding";
}

function fundingAmountValue(method) {
  return document.querySelector(`[data-funding-amount="${method}"]`)?.value?.trim() || "";
}

function fundingSourceValue(method) {
  return document.querySelector(`[data-funding-source="${method}"]`)?.value?.trim() || "";
}

async function createFundingRequest(method, button) {
  const normalized = String(method || "").trim().toLowerCase();
  showLiveNotice(`${fundingMethodLabel(normalized)} funding is coming soon.`, "info");
}

function updateReceiveNetworks() {
  const assetSelect = document.getElementById("receive-asset");
  const networkSelect = document.getElementById("receive-network");
  if (!assetSelect || !networkSelect) return;

  const asset = liveCryptoAssets[assetSelect.value] || liveCryptoAssets[defaultLiveCryptoSymbol()];
  networkSelect.innerHTML = asset.networks
    .slice()
    .sort((networkA, networkB) => networkA.localeCompare(networkB))
    .map((network) => `<option value="${network}">${network}</option>`)
    .join("");
}

function updateSendNetworks() {
  const assetSelect = document.getElementById("send-asset");
  const networkSelect = document.getElementById("send-network");
  if (!assetSelect || !networkSelect) return;

  const asset = liveCryptoAssets[assetSelect.value] || liveCryptoAssets[defaultLiveCryptoSymbol()];
  networkSelect.innerHTML = asset.networks
    .slice()
    .sort((networkA, networkB) => networkA.localeCompare(networkB))
    .map((network) => `<option value="${network}">${network}</option>`)
    .join("");
  updateSendAmountPlaceholder();
}

function updateWithdrawalTypeFields() {
  const type = document.getElementById("send-type")?.value === "external" ? "external" : "internal";
  document.querySelectorAll("[data-send-network-field], [data-send-destination-field]").forEach((node) => {
    node.hidden = type !== "external";
  });
  document.querySelectorAll("[data-send-recipient-field]").forEach((node) => {
    node.hidden = type !== "internal";
  });
  const reviewCopy = document.getElementById("send-review-copy");
  if (reviewCopy) {
    reviewCopy.textContent = type === "external"
      ? "External wallet withdrawals are reviewed before release for account protection."
      : "Internal transfers are processed inside Autody.";
  }
  const reviewButton = document.getElementById("review-send");
  if (reviewButton) {
    reviewButton.textContent = type === "external" ? "Submit Request" : "Send Now";
  }
  updateLiveWithdrawalGate();
}

function setLiveTransferAsset(symbol) {
  const assetSymbol = supportedLiveCryptoSymbol(symbol) || defaultLiveCryptoSymbol();
  const receiveSelect = document.getElementById("receive-asset");
  const sendSelect = document.getElementById("send-asset");

  if (receiveSelect) {
    receiveSelect.value = assetSymbol;
    updateReceiveNetworks();
  }

  if (sendSelect) {
    sendSelect.value = assetSymbol;
    updateSendNetworks();
  }

  return assetSymbol;
}

function setAutodyLiveTransferMode(mode = "receive") {
  const normalized = mode === "send" ? "send" : "receive";
  document.querySelectorAll("[data-live-transfer-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.liveTransferPanel !== normalized;
  });
  document.getElementById("live-crypto")?.setAttribute("data-transfer-mode", normalized);

  const eyebrow = document.getElementById("live-transfer-eyebrow");
  const title = document.getElementById("live-transfer-title");
  const intro = document.getElementById("live-transfer-intro");
  if (eyebrow) eyebrow.textContent = normalized === "send" ? "Crypto withdrawal" : "Crypto deposit";
  if (title) title.textContent = normalized === "send" ? "Send crypto" : "Receive crypto";
  if (intro) {
    intro.textContent = normalized === "send"
      ? "Choose an internal transfer or external wallet withdrawal."
      : "If this address is not accepted by your sending platform, generate a new address and try again.";
  }
  if (normalized === "send") {
    updateWithdrawalTypeFields();
  } else {
    updateLiveWithdrawalGate();
  }
}

function openAutodyLiveTransferModal(mode = "receive", symbol = "") {
  const modal = document.getElementById("live-crypto");
  if (!modal) return false;

  const requestedSymbol = String(symbol || "").trim().toUpperCase();
  if (requestedSymbol && !supportedLiveCryptoSymbol(requestedSymbol)) {
    showLiveNotice(`${requestedSymbol} receive and send are not connected yet.`, "warning");
    return false;
  }

  const assetSymbol = setLiveTransferAsset(requestedSymbol || defaultLiveCryptoSymbol());
  setAutodyLiveTransferMode(mode);
  modal.hidden = false;
  document.body.classList.add("modal-open");

  if (mode !== "send") {
    requestReceiveAddress({ fresh: false, showNotice: false });
  }

  return Boolean(assetSymbol);
}

function closeAutodyLiveTransferModal() {
  const modal = document.getElementById("live-crypto");
  if (!modal) return;
  modal.hidden = true;
  document.body.classList.remove("modal-open");
}

function receiveRouteKey(asset, network) {
  return `${asset || ""}:${network || ""}`;
}

function setReceiveQr(address) {
  const qrCard = document.getElementById("receive-qr-card");
  const qrImage = document.getElementById("receive-qr-code");
  if (!qrCard || !qrImage) return;

  if (!address) {
    qrCard.hidden = true;
    qrImage.removeAttribute("src");
    return;
  }

  qrImage.src = `/api/qr?text=${encodeURIComponent(address)}`;
  qrCard.hidden = false;
}

function resetReceiveAddress(message = "Loading receive address...") {
  const addressNode = document.getElementById("receive-address");
  if (!addressNode) return;
  addressNode.textContent = message;
  delete addressNode.dataset.address;
  delete addressNode.dataset.depositId;
  setReceiveQr("");
}

function receiveAddressButtonText(deposit) {
  return deposit?.directTreasury || deposit?.uniqueAddress === false ? "Refresh address" : "Generate new address";
}

function displayReceiveDeposit(deposit) {
  const addressNode = document.getElementById("receive-address");
  if (!addressNode) return false;

  if (!deposit?.address) {
    const warnings = Array.isArray(deposit?.warnings) ? deposit.warnings : [];
    resetReceiveAddress(warnings[1] || warnings[0] || "Receive address is not connected yet.");
    return false;
  }

  addressNode.textContent = deposit.address;
  addressNode.dataset.address = deposit.address;
  addressNode.dataset.depositId = deposit.id || "";
  setReceiveQr(deposit.address);
  const button = document.getElementById("generate-receive-address");
  if (button) button.textContent = receiveAddressButtonText(deposit);
  return true;
}

async function requestReceiveAddress({ fresh = false, force = false, showNotice = false } = {}) {
  const assetSelect = document.getElementById("receive-asset");
  const networkSelect = document.getElementById("receive-network");
  const addressNode = document.getElementById("receive-address");
  if (!assetSelect || !networkSelect || !addressNode) return;

  const button = document.getElementById("generate-receive-address");
  const key = receiveRouteKey(assetSelect.value, networkSelect.value);
  const cached = receiveRouteCache.get(key);
  if (cached && !force) {
    displayReceiveDeposit(cached);
    return;
  }

  const originalText = button?.textContent || "Generate new address";
  let finalButtonText = originalText;
  if (button) {
    button.disabled = true;
    button.textContent = "Requesting...";
  }
  resetReceiveAddress("Loading receive address...");

  try {
    const data = await postLiveAccountJson("/api/account/deposits/address", {
      asset: assetSelect.value,
      network: networkSelect.value,
      fresh
    });
    const deposit = data.deposit || {};
    const warnings = Array.isArray(deposit.warnings) ? deposit.warnings : [];

    receiveRouteCache.set(key, deposit);
    if (displayReceiveDeposit(deposit)) {
      finalButtonText = receiveAddressButtonText(deposit);
      if (showNotice) showLiveNotice(`${deposit.asset} receive address is ready.`, "success");
      return;
    }

    if (showNotice) showLiveNotice(warnings[0] || "Receive address is not connected yet.", "warning");
  } catch (err) {
    resetReceiveAddress("Receive address could not be loaded.");
    showLiveNotice(err.message || "Deposit route could not be created.", "warning");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = finalButtonText;
    }
  }
}

function generateReceiveAddress() {
  return requestReceiveAddress({ fresh: true, force: true, showNotice: true });
}

async function copyReceiveAddress() {
  const addressNode = document.getElementById("receive-address");
  const address = addressNode?.dataset.address || "";
  if (!address) {
    showLiveNotice("Receive address is still loading.", "warning");
    return;
  }

  try {
    await navigator.clipboard.writeText(address);
    showLiveNotice("Receive address copied.", "success");
  } catch (err) {
    showLiveNotice("Copy was blocked by the browser. Select the address manually.", "warning");
  }
}

async function reviewLiveSend() {
  const gateState = activeWithdrawalGate();
  if (gateState) {
    updateLiveWithdrawalGate();
    showLiveNotice(gateState.message || "Withdrawal access is not available for this account yet.", "warning");
    return;
  }

  const button = document.getElementById("review-send");
  const type = document.getElementById("send-type")?.value === "external" ? "external" : "internal";
  const asset = document.getElementById("send-asset")?.value || defaultLiveCryptoSymbol();
  const amount = Number(document.getElementById("send-amount")?.value || 0);
  const amountMode = currentSendAmountMode();
  const destination = document.getElementById("send-address")?.value?.trim();
  const recipientEmail = document.getElementById("send-recipient-email")?.value?.trim();
  const network = document.getElementById("send-network")?.value || "";

  if (!amount) {
    showLiveNotice("Enter a withdrawal amount.", "warning");
    return;
  }
  if (type === "internal" && !recipientEmail) {
    showLiveNotice("Enter the recipient's Autody email.", "warning");
    return;
  }
  if (type === "external" && !destination) {
    showLiveNotice("Enter the external wallet address.", "warning");
    return;
  }

  const originalText = button?.textContent || "Submit Withdrawal";
  if (button) {
    button.disabled = true;
    button.textContent = "Submitting...";
  }

  try {
    const data = await postLiveAccountJson("/api/account/withdrawals/request", {
      type,
      asset,
      network,
      amount,
      amountMode,
      destination,
      recipientEmail
    });
    showLiveNotice(data.nextStep || "Withdrawal request submitted.", "success");
    document.getElementById("send-amount").value = "";
    document.getElementById("send-address").value = "";
    document.getElementById("send-recipient-email").value = "";
    if (typeof window.loadLiveWallet === "function") window.loadLiveWallet();
  } catch (err) {
    showLiveNotice(err.message || "Withdrawal request could not be created.", "warning");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalText;
    }
  }
}

async function setMaxLiveSendAmount() {
  const button = document.getElementById("send-max");
  const amountInput = document.getElementById("send-amount");
  const asset = document.getElementById("send-asset")?.value || defaultLiveCryptoSymbol();
  if (!amountInput) return;

  const originalText = button?.textContent || "Max";
  if (button) {
    button.disabled = true;
    button.textContent = "...";
  }

  try {
    const wallet = await liveSendWallet();
    const mode = currentSendAmountMode();
    const max = mode === "usd" ? liveSendValueForSymbol(wallet, asset) : liveSendBalanceForSymbol(wallet, asset);
    amountInput.value = mode === "usd" ? formatLiveSendUsd(max) : formatLiveSendAmount(max);
    if (!max) showLiveNotice(`No ${asset} balance is available to send.`, "warning");
  } catch (err) {
    showLiveNotice(err.message || "Could not load the available balance.", "warning");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalText;
    }
  }
}

document.addEventListener("click", (event) => {
  const fundingTab = event.target.closest("[data-funding-tab]");
  if (fundingTab) {
    setFundingTab(fundingTab.dataset.fundingTab);
    return;
  }

  const fundingRequest = event.target.closest("[data-funding-request]");
  if (fundingRequest) {
    event.preventDefault();
    createFundingRequest(fundingRequest.dataset.fundingRequest, fundingRequest);
    return;
  }

  if (event.target.closest("[data-live-funding-close]")) {
    event.preventDefault();
    closeAutodyLiveFundingModal();
    return;
  }

  const liveMessage = event.target.closest("[data-live-message]");
  if (liveMessage) {
    showLiveNotice(liveMessage.dataset.liveMessage, "info");
    return;
  }

  const liveFocus = event.target.closest("[data-live-focus]");
  if (liveFocus) {
    if (liveFocus.dataset.liveFocus === "crypto") {
      event.preventDefault();
      openAutodyLiveTransferModal("receive");
      return;
    }
    if (liveFocus.dataset.liveFocus === "funding") {
      event.preventDefault();
      if (!openAutodyLiveFundingModal("card")) window.location.href = "account-wallet#live-funding";
    }
    return;
  }

  const assetTransfer = event.target.closest("[data-live-asset-transfer]");
  if (assetTransfer) {
    event.preventDefault();
    openAutodyLiveTransferModal(
      assetTransfer.dataset.liveAssetTransfer || "receive",
      assetTransfer.dataset.liveAssetSymbol || ""
    );
    return;
  }

  if (event.target.closest("[data-live-transfer-close]")) {
    event.preventDefault();
    closeAutodyLiveTransferModal();
    return;
  }

  const signOut = event.target.closest("[data-live-sign-out]");
  if (signOut) {
    event.preventDefault();
    localStorage.removeItem("autodyDemoSession");
    localStorage.removeItem("autodyDemoUser");
    window.location.href = signOut.getAttribute("href") || "sign-in";
  }
});

document.getElementById("receive-asset")?.addEventListener("change", () => {
  updateReceiveNetworks();
  requestReceiveAddress({ fresh: false, showNotice: false });
});

document.getElementById("receive-network")?.addEventListener("change", () => {
  requestReceiveAddress({ fresh: false, showNotice: false });
});

document.getElementById("send-asset")?.addEventListener("change", () => {
  updateSendNetworks();
  liveSendWalletCache = null;
});
document.getElementById("send-amount-mode")?.addEventListener("change", updateSendAmountPlaceholder);
document.getElementById("send-type")?.addEventListener("change", updateWithdrawalTypeFields);
document.getElementById("generate-receive-address")?.addEventListener("click", generateReceiveAddress);
document.getElementById("copy-receive-address")?.addEventListener("click", copyReceiveAddress);
document.getElementById("review-send")?.addEventListener("click", reviewLiveSend);
document.getElementById("send-max")?.addEventListener("click", setMaxLiveSendAmount);
document.getElementById("withdrawal-gate-action")?.addEventListener("click", handleWithdrawalGateAction);

window.addEventListener("autody-live-wallet-updated", (event) => {
  if (event.detail?.wallet) {
    liveSendWalletCache = event.detail.wallet;
    window.AutodyLiveWithdrawalAccess = event.detail.wallet.withdrawalAccess || null;
  }
  updateLiveWithdrawalGate();
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  closeAutodyLiveFundingModal();
});

populateLiveCryptoSelects();
setLiveTransferAsset(new URLSearchParams(location.search).get("asset") || defaultLiveCryptoSymbol());
updateReceiveNetworks();
updateSendNetworks();
updateWithdrawalTypeFields();
updateSendAmountPlaceholder();
updateLiveWithdrawalGate();

window.ensureLiveReceiveAddress = () => requestReceiveAddress({ fresh: false, showNotice: false });
window.openAutodyLiveTransferModal = openAutodyLiveTransferModal;
window.closeAutodyLiveTransferModal = closeAutodyLiveTransferModal;
window.updateLiveWithdrawalGate = updateLiveWithdrawalGate;
window.openAutodyLiveFundingModal = openAutodyLiveFundingModal;
window.closeAutodyLiveFundingModal = closeAutodyLiveFundingModal;

if (location.hash === "#live-crypto") {
  openAutodyLiveTransferModal(
    new URLSearchParams(location.search).get("transfer") === "send" ? "send" : "receive",
    new URLSearchParams(location.search).get("asset") || defaultLiveCryptoSymbol()
  );
}

if (location.hash === "#live-funding") {
  openAutodyLiveFundingModal("card");
}
