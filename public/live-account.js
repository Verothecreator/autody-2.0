const liveCryptoAssets = {
  BTC: {
    name: "Bitcoin",
    networks: ["Bitcoin"],
    addressPrefix: "bc1qautody"
  },
  ETH: {
    name: "Ethereum",
    networks: ["Ethereum ERC-20", "Base", "Arbitrum One", "Optimism"],
    addressPrefix: "0x"
  },
  USDT: {
    name: "Tether USDt",
    networks: ["Ethereum ERC-20", "Tron TRC-20", "BNB Smart Chain BEP-20", "Polygon PoS", "Solana SPL"],
    addressPrefix: "0x"
  },
  USDC: {
    name: "USD Coin",
    networks: ["Ethereum ERC-20", "Base", "Solana SPL", "Polygon PoS", "Arbitrum One"],
    addressPrefix: "0x"
  },
  BNB: {
    name: "BNB",
    networks: ["BNB Smart Chain BEP-20", "BNB Beacon Chain"],
    addressPrefix: "0x"
  },
  BCH: {
    name: "Bitcoin Cash",
    networks: ["Bitcoin Cash"],
    addressPrefix: "bitcoincash:q"
  },
  DOGE: {
    name: "Dogecoin",
    networks: ["Dogecoin"],
    addressPrefix: "D"
  }
};

const liveNotice = document.getElementById("live-notice");
let liveNoticeTimer = null;

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

function simpleHash(seed) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) >>> 0;
  }
  return `${hash.toString(16)}${Date.now().toString(16)}`.padEnd(40, "0");
}

function mockAddress(asset, network) {
  const seed = `${asset}-${network}-${Date.now()}-${Math.random()}`;
  const hash = simpleHash(seed);
  const config = liveCryptoAssets[asset] || liveCryptoAssets.BTC;

  if (config.addressPrefix === "0x") {
    return `0x${hash.slice(0, 40)}`;
  }

  if (asset === "BCH") {
    return `${config.addressPrefix}${hash.slice(0, 38)}`;
  }

  if (asset === "DOGE") {
    return `${config.addressPrefix}${hash.slice(0, 33)}`;
  }

  return `${config.addressPrefix}${hash.slice(0, 28)}`;
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

  const asset = liveCryptoAssets[assetSelect.value] || liveCryptoAssets.BTC;
  networkSelect.innerHTML = asset.networks.map((network) => `<option value="${network}">${network}</option>`).join("");
}

function generateReceiveAddress() {
  const assetSelect = document.getElementById("receive-asset");
  const networkSelect = document.getElementById("receive-network");
  const addressNode = document.getElementById("receive-address");
  if (!assetSelect || !networkSelect || !addressNode) return;

  const address = mockAddress(assetSelect.value, networkSelect.value);
  addressNode.textContent = address;
  addressNode.dataset.address = address;
  showLiveNotice(`${assetSelect.value} receive address preview generated. Do not send real funds until production custody is connected.`, "success");
}

async function copyReceiveAddress() {
  const addressNode = document.getElementById("receive-address");
  const address = addressNode?.dataset.address || "";
  if (!address) {
    showLiveNotice("Generate a receive address first.", "warning");
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
  const asset = document.getElementById("send-asset")?.value || "BTC";
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
  const addressNode = document.getElementById("receive-address");
  if (addressNode) {
    addressNode.textContent = "Generate an address to preview the receive flow.";
    delete addressNode.dataset.address;
  }
});

document.getElementById("generate-receive-address")?.addEventListener("click", generateReceiveAddress);
document.getElementById("copy-receive-address")?.addEventListener("click", copyReceiveAddress);
document.getElementById("review-send")?.addEventListener("click", reviewLiveSend);

updateReceiveNetworks();

if (location.hash === "#live-crypto") {
  setFundingTab("crypto");
}

if (location.hash === "#live-funding") {
  setFundingTab("card");
}
