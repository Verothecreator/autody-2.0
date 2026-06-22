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

function liveCryptoOptionMarkup() {
  return Object.entries(liveCryptoAssets)
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

function setFundingTab(tabName) {
  document.querySelectorAll("[data-funding-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.fundingTab === tabName);
  });

  document.querySelectorAll("[data-funding-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.fundingPanel !== tabName;
  });
}

function updateReceiveNetworks() {
  const assetSelect = document.getElementById("receive-asset");
  const networkSelect = document.getElementById("receive-network");
  if (!assetSelect || !networkSelect) return;

  const asset = liveCryptoAssets[assetSelect.value] || liveCryptoAssets[defaultLiveCryptoSymbol()];
  networkSelect.innerHTML = asset.networks.map((network) => `<option value="${network}">${network}</option>`).join("");
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
      ? "Prepare a withdrawal preview for the selected crypto asset. Production sends will require security approval."
      : "If this address is not accepted by your sending platform, generate a new address and try again.";
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
      button.textContent = originalText;
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

function reviewLiveSend() {
  const asset = document.getElementById("send-asset")?.value || defaultLiveCryptoSymbol();
  const amount = Number(document.getElementById("send-amount")?.value || 0);
  const destination = document.getElementById("send-address")?.value?.trim();

  if (!destination || !amount) {
    showLiveNotice("Enter a destination address and amount to preview a send.", "warning");
    return;
  }

  showLiveNotice(`Live ${asset} withdrawals are not enabled yet. Production sends will require custody checks, 2FA, approval rules, and network fees.`, "warning");
}

document.addEventListener("click", (event) => {
  const fundingTab = event.target.closest("[data-funding-tab]");
  if (fundingTab) {
    setFundingTab(fundingTab.dataset.fundingTab);
    return;
  }

  const liveMessage = event.target.closest("[data-live-message]");
  if (liveMessage) {
    showLiveNotice(liveMessage.dataset.liveMessage, "info");
    return;
  }

  const liveFocus = event.target.closest("[data-live-focus]");
  if (liveFocus) {
    const targetId = liveFocus.dataset.liveFocus === "crypto" ? "live-crypto" : "live-funding";
    const target = document.getElementById(targetId);
    if (!target) {
      window.location.href = `account-wallet.html#${targetId}`;
      return;
    }
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    if (liveFocus.dataset.liveFocus === "funding") setFundingTab("card");
    if (liveFocus.dataset.liveFocus === "crypto") setFundingTab("crypto");
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
    window.location.href = signOut.getAttribute("href") || "sign-in.html";
  }
});

document.getElementById("receive-asset")?.addEventListener("change", () => {
  updateReceiveNetworks();
  requestReceiveAddress({ fresh: false, showNotice: false });
});

document.getElementById("receive-network")?.addEventListener("change", () => {
  requestReceiveAddress({ fresh: false, showNotice: false });
});

document.getElementById("generate-receive-address")?.addEventListener("click", generateReceiveAddress);
document.getElementById("copy-receive-address")?.addEventListener("click", copyReceiveAddress);
document.getElementById("review-send")?.addEventListener("click", reviewLiveSend);

populateLiveCryptoSelects();
setLiveTransferAsset(new URLSearchParams(location.search).get("asset") || defaultLiveCryptoSymbol());
updateReceiveNetworks();

window.ensureLiveReceiveAddress = () => requestReceiveAddress({ fresh: false, showNotice: false });
window.openAutodyLiveTransferModal = openAutodyLiveTransferModal;
window.closeAutodyLiveTransferModal = closeAutodyLiveTransferModal;

if (location.hash === "#live-crypto") {
  setFundingTab("crypto");
  openAutodyLiveTransferModal(
    new URLSearchParams(location.search).get("transfer") === "send" ? "send" : "receive",
    new URLSearchParams(location.search).get("asset") || defaultLiveCryptoSymbol()
  );
}

if (location.hash === "#live-funding") {
  setFundingTab("card");
}
