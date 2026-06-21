const liveCryptoAssets = {
  AU: {
    name: "Autody AU",
    networks: ["Autody custody", "Polygon PoS"],
    addressPrefix: "au1"
  },
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

  const asset = liveCryptoAssets[assetSelect.value] || liveCryptoAssets.BTC;
  networkSelect.innerHTML = asset.networks.map((network) => `<option value="${network}">${network}</option>`).join("");
}

async function generateReceiveAddress() {
  const assetSelect = document.getElementById("receive-asset");
  const networkSelect = document.getElementById("receive-network");
  const addressNode = document.getElementById("receive-address");
  if (!assetSelect || !networkSelect || !addressNode) return;

  const button = document.getElementById("generate-receive-address");
  const originalText = button?.textContent || "Generate Address";
  if (button) {
    button.disabled = true;
    button.textContent = "Requesting...";
  }
  addressNode.textContent = "Requesting a server-tracked deposit route...";
  delete addressNode.dataset.address;
  delete addressNode.dataset.depositId;

  try {
    const data = await postLiveAccountJson("/api/account/deposits/address", {
      asset: assetSelect.value,
      network: networkSelect.value,
      fresh: true
    });
    const deposit = data.deposit || {};
    const warnings = Array.isArray(deposit.warnings) ? deposit.warnings : [];

    if (deposit.address) {
      addressNode.textContent = deposit.address;
      addressNode.dataset.address = deposit.address;
      addressNode.dataset.depositId = deposit.id || "";
      showLiveNotice(
        deposit.uniqueAddress
          ? `${deposit.asset} deposit address created and tracked.`
          : `${deposit.asset} treasury test route created. ${warnings[0] || "Manual reconciliation required."}`,
        deposit.uniqueAddress ? "success" : "warning"
      );
      return;
    }

    addressNode.textContent = warnings[1] || warnings[0] || "Treasury route is not connected yet.";
    showLiveNotice(warnings[0] || "Treasury route is not connected yet.", "warning");
  } catch (err) {
    addressNode.textContent = "Deposit route could not be created.";
    showLiveNotice(err.message || "Deposit route could not be created.", "warning");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalText;
    }
  }
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
    addressNode.textContent = "Generate a server-tracked deposit route.";
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
