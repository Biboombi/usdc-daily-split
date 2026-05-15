const state = {
  bill: null,
  config: null,
  wallet: null,
};

const $ = (id) => document.getElementById(id);

function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 3600);
}

function formatAddress(address) {
  if (!address) return "";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function participantRow(name = "", wallet = "", amount = "") {
  const row = document.createElement("div");
  row.className = "person-row";
  row.innerHTML = `
    <input class="person-name" required maxlength="80" placeholder="Name" value="${escapeHtml(name)}">
    <input class="person-wallet" maxlength="80" placeholder="Wallet optional" value="${escapeHtml(wallet)}">
    <input class="person-amount" type="number" min="0.01" step="0.01" placeholder="Auto" value="${escapeHtml(amount)}">
    <button class="icon-btn remove-person" type="button" title="Remove person">x</button>
  `;
  row.querySelector(".remove-person").addEventListener("click", () => {
    row.remove();
    if ($("participants").children.length === 0) addParticipant();
  });
  $("participants").appendChild(row);
}

function addParticipant() {
  participantRow();
}

function resetForm() {
  $("bill-form").reset();
  $("participants").innerHTML = "";
  participantRow("Me");
  participantRow("Friend");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function api(path, options = {}) {
  const resp = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.detail || data.error || `Request failed: ${resp.status}`);
  return data;
}

async function loadConfig() {
  state.config = await api("/api/config");
}

async function createBill(event) {
  event.preventDefault();
  const participants = [...document.querySelectorAll(".person-row")].map((row) => {
    const amount = row.querySelector(".person-amount").value;
    return {
      name: row.querySelector(".person-name").value.trim(),
      wallet: row.querySelector(".person-wallet").value.trim(),
      amount: amount ? Number(amount) : null,
    };
  });

  const payload = {
    title: $("title").value.trim(),
    total_amount: Number($("total").value),
    organizer_name: $("organizer-name").value.trim(),
    organizer_wallet: $("organizer-wallet").value.trim(),
    note: $("note").value.trim(),
    participants,
  };

  try {
    const data = await api("/api/bills", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    history.pushState(null, "", `?bill=${data.bill.id}`);
    renderBill(data);
    toast("Share link created");
  } catch (err) {
    toast(err.message);
  }
}

async function loadBillFromUrl() {
  const id = new URLSearchParams(location.search).get("bill");
  if (!id) return;
  try {
    renderBill(await api(`/api/bills/${id}`));
  } catch (err) {
    toast(err.message);
  }
}

function renderBill(data) {
  state.bill = data;
  $("empty-state").classList.add("hidden");
  $("bill-view").classList.remove("hidden");

  const { bill, participants, summary } = data;
  $("bill-title").textContent = bill.title;
  $("bill-total").textContent = `${bill.total_amount} USDC`;
  $("bill-paid").textContent = `${summary.total_paid} USDC`;
  $("bill-outstanding").textContent = `${summary.outstanding} USDC`;
  $("organizer").textContent = bill.organizer_name;
  $("organizer-address").textContent = bill.organizer_wallet;

  if (bill.note) {
    $("bill-note").textContent = bill.note;
    $("bill-note").classList.remove("hidden");
  } else {
    $("bill-note").classList.add("hidden");
  }

  $("people-list").innerHTML = participants.map((p) => {
    const paid = Boolean(p.paid);
    return `
      <div class="person-card">
        <div class="person-main">
          <strong>${escapeHtml(p.name)} owes ${escapeHtml(p.amount_due)} USDC</strong>
          <span>${escapeHtml(p.wallet ? formatAddress(p.wallet) : "No wallet saved")} - <b class="${paid ? "status-paid" : "status-unpaid"}">${paid ? "Paid" : "Unpaid"}</b></span>
          ${p.paid_tx ? `<code>${escapeHtml(p.paid_tx)}</code>` : ""}
        </div>
        <div class="person-actions">
          ${paid ? "" : `<button class="btn secondary" type="button" onclick="payWithWallet('${p.id}')">Pay USDC</button>`}
          <button class="btn ${paid ? "secondary" : "primary"}" type="button" onclick="markPaid('${p.id}', ${!paid})">${paid ? "Undo" : "Demo mark paid"}</button>
        </div>
      </div>
    `;
  }).join("");
}

async function markPaid(participantId, paid, txHash = "") {
  try {
    const data = await api(`/api/participants/${participantId}/paid`, {
      method: "PATCH",
      body: JSON.stringify({ paid, tx_hash: txHash }),
    });
    renderBill(data);
    toast(paid ? "Marked paid" : "Payment status undone");
  } catch (err) {
    toast(err.message);
  }
}

async function connectWallet() {
  if (!window.ethereum) {
    toast("Install a browser wallet first");
    return;
  }
  const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
  state.wallet = accounts[0];
  $("wallet-pill").textContent = formatAddress(state.wallet);
  $("connect-wallet").textContent = "Connected";
  if (!$("organizer-wallet").value) $("organizer-wallet").value = state.wallet;
}

async function ensureArcNetwork() {
  const chainHex = `0x${state.config.chainId.toString(16)}`;
  try {
    await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainHex }] });
  } catch (err) {
    if (err.code !== 4902) throw err;
    await window.ethereum.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: chainHex,
        chainName: state.config.chainName,
        nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
        rpcUrls: [state.config.rpcUrl],
      }],
    });
  }
}

async function payWithWallet(participantId) {
  if (!state.bill) return;
  if (!window.ethers) {
    toast("Wallet library did not load");
    return;
  }
  if (!state.wallet) await connectWallet();
  await ensureArcNetwork();

  const intent = await api(`/api/participants/${participantId}/payment-intent`);
  const to = intent.transfer.to;
  const amount = BigInt(intent.transfer.amount_units);
  const provider = new ethers.BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();
  const token = new ethers.Contract(
    intent.token.address,
    ["function transfer(address to,uint256 amount) returns (bool)"],
    signer,
  );

  try {
    toast(`Confirm ${intent.transfer.amount} USDC on ${intent.network}`);
    const tx = await token.transfer(to, amount);
    toast("Transaction submitted. Waiting for confirmation...");
    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) throw new Error("Transaction was not confirmed");
    await markPaid(participantId, true, tx.hash);
    toast("Payment confirmed and marked paid");
  } catch (err) {
    toast(err.shortMessage || err.message || "Payment failed");
  }
}

$("add-person").addEventListener("click", addParticipant);
$("reset-form").addEventListener("click", resetForm);
$("bill-form").addEventListener("submit", createBill);
$("connect-wallet").addEventListener("click", connectWallet);
$("copy-link").addEventListener("click", async () => {
  await navigator.clipboard.writeText(location.href);
  toast("Link copied");
});

loadConfig().then(() => {
  resetForm();
  loadBillFromUrl();
}).catch((err) => toast(err.message));
