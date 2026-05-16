const state = {
  bill: null,
  config: null,
  wallet: null,
  scanStream: null,
  scanTimer: null,
};

const $ = (id) => document.getElementById(id);

function preferredTheme() {
  const saved = localStorage.getItem("arc-split-theme");
  if (saved === "dark" || saved === "light") return saved;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function setTheme(theme) {
  const nextTheme = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = nextTheme;
  localStorage.setItem("arc-split-theme", nextTheme);
  if ($("theme-label")) $("theme-label").textContent = nextTheme === "dark" ? "Light" : "Dark";
  if ($("theme-toggle")) $("theme-toggle").setAttribute("aria-label", `Switch to ${nextTheme === "dark" ? "light" : "dark"} mode`);
  if (document.querySelector(".theme-icon")) document.querySelector(".theme-icon").textContent = nextTheme === "dark" ? "☀" : "☾";
}

setTheme(preferredTheme());

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

function billUrl(participantId = "") {
  if (!state.bill) return location.href;
  const url = new URL(location.href);
  url.searchParams.set("bill", state.bill.bill.id);
  if (participantId) url.searchParams.set("pay", participantId);
  else url.searchParams.delete("pay");
  return url.toString();
}

function setQr(title, url) {
  $("qr-title").textContent = title;
  $("qr-url").textContent = url;
  $("qr-image").src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=12&data=${encodeURIComponent(url)}`;
  $("qr-card").classList.remove("hidden");
}

function sameAppLink(value) {
  try {
    const url = new URL(value);
    return url.origin === location.origin && url.searchParams.has("bill") ? url : null;
  } catch {
    return null;
  }
}

function participantRow(name = "", wallet = "", amount = "") {
  const row = document.createElement("div");
  row.className = "person-row";
  row.innerHTML = `
    <div class="person-top">
      <input class="person-name" required maxlength="80" placeholder="Name" value="${escapeHtml(name)}">
      <input class="person-amount" type="number" min="0.01" step="0.01" placeholder="Auto" value="${escapeHtml(amount)}">
      <input class="person-percent hidden" type="number" min="0" step="0.01" placeholder="%">
      <button class="icon-btn remove-person" type="button" title="Remove person">×</button>
    </div>
    <input class="person-wallet" maxlength="120" placeholder="Wallet address optional" value="${escapeHtml(wallet)}">
  `;
  row.querySelector(".remove-person").addEventListener("click", () => {
    row.remove();
    if ($("participants").children.length === 0) addParticipant();
    updateSplitMode();
  });
  row.querySelectorAll("input").forEach((input) => input.addEventListener("input", updatePreview));
  $("participants").appendChild(row);
  updateSplitMode();
}

function addParticipant() {
  participantRow();
}

function resetForm() {
  $("bill-form").reset();
  $("participants").innerHTML = "";
  participantRow("Me");
  participantRow("Friend");
  updateSplitMode();
}

function cents(value) {
  return Math.round(Number(value || 0) * 100);
}

function moneyFromCents(value) {
  return (value / 100).toFixed(2);
}

function currentParticipants() {
  return [...document.querySelectorAll(".person-row")].map((row) => ({
    row,
    name: row.querySelector(".person-name").value.trim(),
    wallet: row.querySelector(".person-wallet").value.trim(),
    amountInput: row.querySelector(".person-amount"),
    percentInput: row.querySelector(".person-percent"),
  }));
}

function previewAmounts() {
  const mode = $("split-mode").value;
  const totalCents = cents($("total").value);
  const participants = currentParticipants();
  if (!participants.length || totalCents <= 0) return { amounts: [], errors: ["Enter a total and at least one person."] };

  if (mode === "equal") {
    const base = Math.floor(totalCents / participants.length);
    const amounts = participants.map(() => base);
    amounts[amounts.length - 1] += totalCents - amounts.reduce((sum, amount) => sum + amount, 0);
    return { amounts, errors: [] };
  }

  if (mode === "custom") {
    const amounts = participants.map((person) => cents(person.amountInput.value));
    const drift = totalCents - amounts.reduce((sum, amount) => sum + amount, 0);
    return {
      amounts,
      errors: drift === 0 ? [] : [`Custom amounts differ from total by ${moneyFromCents(Math.abs(drift))} USDC.`],
    };
  }

  const percents = participants.map((person) => Number(person.percentInput.value || 0));
  const percentTotal = percents.reduce((sum, percent) => sum + percent, 0);
  const amounts = percents.map((percent) => Math.round(totalCents * (percent / 100)));
  amounts[amounts.length - 1] += totalCents - amounts.reduce((sum, amount) => sum + amount, 0);
  return {
    amounts,
    errors: Math.abs(percentTotal - 100) < 0.001 ? [] : [`Percentages total ${percentTotal.toFixed(2)}%, not 100%.`],
  };
}

function updateSplitMode() {
  const mode = $("split-mode").value;
  document.querySelectorAll("[data-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === mode);
  });
  currentParticipants().forEach((person) => {
    person.row.querySelector(".person-top").classList.toggle("has-split-input", mode !== "equal");
    person.amountInput.classList.toggle("hidden", mode !== "custom");
    person.percentInput.classList.toggle("hidden", mode !== "percent");
  });
  updatePreview();
}

function updatePreview() {
  const preview = $("split-preview");
  const participants = currentParticipants();
  const { amounts, errors } = previewAmounts();
  if (!participants.length) {
    preview.innerHTML = "";
    return;
  }

  const rows = participants.map((person, index) => `
    <div>
      <span>${escapeHtml(person.name || `Person ${index + 1}`)}</span>
      <strong>${moneyFromCents(amounts[index] || 0)} USDC</strong>
    </div>
  `).join("");
  const errorHtml = errors.map((error) => `<p class="preview-error">${escapeHtml(error)}</p>`).join("");
  preview.innerHTML = `${errorHtml}<div class="preview-grid">${rows}</div>`;
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
  const text = await resp.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!resp.ok) {
    const detail = Array.isArray(data?.detail)
      ? data.detail.map((item) => item.msg || JSON.stringify(item)).join("; ")
      : data?.detail;
    throw new Error(detail || data?.error || text || `Request failed: ${resp.status}`);
  }
  return data;
}

async function loadConfig() {
  state.config = await api("/api/config");
}

async function createBill(event) {
  event.preventDefault();
  if (!$("title").value.trim()) {
    toast("Enter a bill title first");
    $("title").focus();
    return;
  }
  if (!$("total").value || Number($("total").value) <= 0) {
    toast("Enter the total USDC amount");
    $("total").focus();
    return;
  }
  if (!$("organizer-name").value.trim()) {
    toast("Enter your name");
    $("organizer-name").focus();
    return;
  }
  if (!$("organizer-wallet").value.trim()) {
    toast("Enter your wallet address");
    $("organizer-wallet").focus();
    return;
  }
  const preview = previewAmounts();
  if (preview.errors.length) {
    toast(preview.errors[0]);
    return;
  }

  const participants = currentParticipants().map((person, index) => {
    return {
      name: person.name,
      wallet: person.wallet,
      amount: Number(moneyFromCents(preview.amounts[index] || 0)),
    };
  });
  const missingPerson = participants.find((participant) => !participant.name.trim());
  if (missingPerson) {
    toast("Enter a name for each person");
    return;
  }

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
    loadRecentBills();
    toast("Share link created");
  } catch (err) {
    toast(err.message);
  }
}

async function loadBillFromUrl() {
  const id = new URLSearchParams(location.search).get("bill");
  if (!id) return;
  try {
    const data = await api(`/api/bills/${id}`);
    renderBill(data);
    const payId = new URLSearchParams(location.search).get("pay");
    if (payId) {
      const participant = data.participants.find((p) => p.id === payId);
      if (participant) setQr(`${participant.name} payment link`, billUrl(payId));
    }
  } catch (err) {
    toast(err.message);
  }
}

async function loadRecentBills() {
  try {
    const data = await api("/api/bills");
    $("recent-bills").innerHTML = data.bills.length ? data.bills.map((bill) => `
      <div class="recent-bill">
        <button type="button" data-bill="${escapeHtml(bill.id)}">
          <span>${escapeHtml(bill.title)}</span>
          <strong>${escapeHtml(bill.total_amount)} USDC</strong>
          <small>${bill.paid_count || 0}/${bill.participant_count || 0} paid</small>
        </button>
        <button class="delete-bill" type="button" data-delete-bill="${escapeHtml(bill.id)}">Remove</button>
      </div>
    `).join("") : `<div class="empty-mini">No bills yet.</div>`;
  } catch (err) {
    toast(err.message);
  }
}

async function removeBill(id) {
  try {
    await api(`/api/bills/${id}`, { method: "DELETE" });
    if (state.bill?.bill?.id === id) {
      state.bill = null;
      history.pushState(null, "", location.pathname);
      $("bill-view").classList.add("hidden");
      $("empty-state").classList.remove("hidden");
      $("qr-card").classList.add("hidden");
    }
    await loadRecentBills();
    toast("Bill removed");
  } catch (err) {
    toast(err.message);
  }
}

async function openQrScanner() {
  if (!("BarcodeDetector" in window)) {
    toast("QR scanning is not supported in this browser yet");
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    toast("Camera access is not available in this browser");
    return;
  }

  try {
    const detector = new BarcodeDetector({ formats: ["qr_code"] });
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
    state.scanStream = stream;
    const video = $("scan-video");
    video.srcObject = stream;
    $("scan-modal").classList.remove("hidden");
    await video.play();

    const scan = async () => {
      if (!$("scan-modal").classList.contains("hidden")) {
        try {
          const codes = await detector.detect(video);
          const link = codes.length ? sameAppLink(codes[0].rawValue) : null;
          if (link) {
            closeQrScanner();
            history.pushState(null, "", link.pathname + link.search);
            await loadBillFromUrl();
            toast("Payment link opened");
            return;
          }
        } catch {
          // Keep the scanner running; camera frames can fail while focusing.
        }
        state.scanTimer = window.setTimeout(scan, 450);
      }
    };
    scan();
  } catch (err) {
    closeQrScanner();
    toast(err.message || "Could not open camera");
  }
}

function closeQrScanner() {
  if (state.scanTimer) {
    window.clearTimeout(state.scanTimer);
    state.scanTimer = null;
  }
  if (state.scanStream) {
    state.scanStream.getTracks().forEach((track) => track.stop());
    state.scanStream = null;
  }
  $("scan-video").srcObject = null;
  $("scan-modal").classList.add("hidden");
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
          <button class="btn secondary" type="button" onclick="showParticipantQr('${p.id}')">QR</button>
          ${paid ? "" : `<button class="btn secondary" type="button" onclick="payWithWallet('${p.id}')">Pay USDC</button>`}
          <button class="btn ${paid ? "secondary" : "primary"}" type="button" onclick="markPaid('${p.id}', ${!paid})">${paid ? "Undo" : "Mark paid"}</button>
        </div>
      </div>
    `;
  }).join("");
}

function showParticipantQr(participantId) {
  if (!state.bill) return;
  const participant = state.bill.participants.find((p) => p.id === participantId);
  const title = participant ? `${participant.name} payment link` : "Payment link";
  setQr(title, billUrl(participantId));
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

function exportCurrentBill() {
  if (!state.bill) return;
  const { bill, participants } = state.bill;
  const rows = [["bill_id", "title", "participant", "wallet", "amount_due", "paid", "tx_hash"]];
  participants.forEach((participant) => {
    rows.push([
      bill.id,
      bill.title,
      participant.name,
      participant.wallet,
      participant.amount_due,
      participant.paid ? "yes" : "no",
      participant.paid_tx || "",
    ]);
  });
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${bill.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${bill.id}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function connectWallet() {
  if (state.wallet) {
    state.wallet = null;
    $("wallet-pill").textContent = "Wallet disconnected";
    $("connect-wallet").textContent = "Connect";
    toast("Wallet disconnected locally");
    return;
  }
  if (!window.ethereum) {
    toast("Install a browser wallet first");
    return;
  }
  const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
  state.wallet = accounts[0];
  $("wallet-pill").textContent = formatAddress(state.wallet);
  $("connect-wallet").textContent = "Disconnect";
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
$("theme-toggle").addEventListener("click", () => {
  setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
});
$("scan-qr").addEventListener("click", openQrScanner);
$("close-scan").addEventListener("click", closeQrScanner);
$("scan-modal").addEventListener("click", (event) => {
  if (event.target.id === "scan-modal") closeQrScanner();
});
$("split-mode").addEventListener("change", updateSplitMode);
document.querySelectorAll("[data-mode]").forEach((button) => {
  button.addEventListener("click", () => {
    $("split-mode").value = button.dataset.mode;
    updateSplitMode();
  });
});
$("total").addEventListener("input", updatePreview);
$("refresh-bills").addEventListener("click", loadRecentBills);
$("recent-bills").addEventListener("click", async (event) => {
  const deleteButton = event.target.closest("[data-delete-bill]");
  if (deleteButton) {
    event.preventDefault();
    event.stopPropagation();
    await removeBill(deleteButton.dataset.deleteBill);
    return;
  }

  const billButton = event.target.closest("[data-bill]");
  if (billButton) {
    const id = billButton.dataset.bill;
    history.pushState(null, "", `?bill=${id}`);
    renderBill(await api(`/api/bills/${id}`));
  }
});
$("export-bill").addEventListener("click", exportCurrentBill);
$("refresh-bill").addEventListener("click", async () => {
  if (!state.bill) return;
  renderBill(await api(`/api/bills/${state.bill.bill.id}`));
});
$("show-qr").addEventListener("click", () => {
  if (!state.bill) return;
  setQr("Bill share link", billUrl());
});
$("copy-link").addEventListener("click", async () => {
  await navigator.clipboard.writeText(billUrl());
  toast("Link copied");
});

loadConfig().then(() => {
  resetForm();
  loadBillFromUrl();
  loadRecentBills();
}).catch((err) => toast(err.message));
