// ============================================
// Agraris — on-chain address block + Blockscout activity
// ============================================
//
// Shared by agent.html (agent.js) and the "Agent of the week" section on
// index.html (featured.js). Load after app.js (uses escapeHtml) and
// before the page script.
//
// Usage: insert renderOnchainBlock(agent) into the page, then call
// initCopyAddressButton(root) and loadOnchainActivity(root) on the
// element that contains it.

// ---------- On-chain address (optional, builder-provided) ----------
//
// agents.contract_address is empty for most agents and may hold
// anything an admin typed in the Dashboard, so the block renders only
// for a well-formed 0x address and is omitted entirely otherwise.
// Inside it, the "On-chain activity" counts are fetched from Blockscout
// after the page renders (see loadOnchainActivity below).

const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const EXPLORER_ADDRESS_URL = "https://robinhoodchain.blockscout.com/address/";

function renderOnchainBlock(agent) {
  const address =
    typeof agent.contract_address === "string" ? agent.contract_address.trim() : "";
  if (!ADDRESS_PATTERN.test(address)) return "";

  const safe = escapeHtml(address);
  const short = escapeHtml(`${address.slice(0, 6)}…${address.slice(-4)}`);

  return `
    <div class="detail-row onchain-block reveal">
      <div class="detail-row-label">On-chain</div>
      <div class="onchain-row">
        <code class="onchain-address" title="${safe}">
          <span class="onchain-address-full">${safe}</span>
          <span class="onchain-address-short" aria-hidden="true">${short}</span>
        </code>
        <button type="button" class="btn btn-sm" id="copy-address-btn" data-address="${safe}">Copy</button>
        <a class="btn btn-sm" href="${EXPLORER_ADDRESS_URL}${safe}" target="_blank" rel="noopener">View on explorer</a>
      </div>
      <div class="onchain-activity" data-address="${safe}" hidden></div>
      <p class="onchain-note">Address provided by the builder. Agraris does not verify ownership, and a listing does not imply volume, traction, or safety.</p>
    </div>
  `;
}

// Same copy-to-clipboard pattern as the badge / embed buttons.
function initCopyAddressButton(root) {
  const btn = root.querySelector("#copy-address-btn");
  if (!btn) return;

  const defaultLabel = btn.textContent;

  btn.addEventListener("click", () => {
    if (!navigator.clipboard?.writeText) return;

    navigator.clipboard
      .writeText(btn.dataset.address)
      .then(() => {
        btn.textContent = "Copied!";
        setTimeout(() => {
          btn.textContent = defaultLabel;
        }, 2000);
      })
      .catch(() => {
        // clipboard write failed (permissions, insecure context, etc.) —
        // fail silently, no error shown to the user
      });
  });
}

// ---------- On-chain activity (Blockscout, fetched in the browser) ----------
//
// Two public Blockscout API calls for the agent's address:
//   /api/v2/addresses/{address}           -> uses `hash`, `is_contract`,
//                                            `name`, `is_verified`
//   /api/v2/addresses/{address}/counters  -> uses `transactions_count`,
//                                            `token_transfers_count`
// Field names are exactly as Blockscout returns them; the counts arrive
// as strings (e.g. "1164"). Neither response carries a last-activity
// date, so none is shown.
//
// Rendered as a ledger "receipt": a status line, label …… value rows,
// the shortened address with a copy button, and "View on explorer" as
// the closing line. When it renders, it takes the place of the plain
// address row above it (hidden, not removed); when it doesn't, that row
// stays as it was, so the address and explorer link are always there.
//
// Everything here is best-effort: on a CORS block, timeout, HTTP error,
// bad JSON, an address mismatch or no usable count, the section simply
// stays hidden — no empty numbers, no "undefined", no error text, and
// the rest of the page is unaffected. A single missing or wrongly typed
// field (name, is_verified, is_contract, one count) only drops its own
// row. Values are written with textContent, never innerHTML.

const BLOCKSCOUT_API_ADDRESS_URL = "https://robinhoodchain.blockscout.com/api/v2/addresses/";
const BLOCKSCOUT_TIMEOUT_MS = 6000;

// "1164" -> "1,164". Accepts a digit string (Blockscout's format) or a
// safe non-negative integer; anything else is treated as unavailable.
function formatBlockscoutCount(value) {
  let digits = "";
  if (typeof value === "string") digits = value.trim();
  else if (Number.isSafeInteger(value) && value >= 0) digits = String(value);
  if (!/^\d+$/.test(digits)) return null;
  try {
    return BigInt(digits).toLocaleString("en-US");
  } catch {
    return null;
  }
}

async function fetchBlockscoutJson(url, signal) {
  const res = await fetch(url, {
    signal,
    credentials: "omit",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Blockscout HTTP ${res.status}`);
  return res.json();
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// One "Label ........ value" line. `valueNode` lets the address row put
// a code element and a button on the right-hand side.
function receiptRow(label, value, { mono = false, valueNode = null } = {}) {
  const row = el("div", "receipt-row");
  const dt = el("dt", "receipt-label", label);
  const leader = el("span", "receipt-leader");
  leader.setAttribute("aria-hidden", "true");
  const dd = el("dd", `receipt-value${mono ? " is-mono" : ""}`);
  if (valueNode) dd.appendChild(valueNode);
  else dd.textContent = value;
  row.append(dt, leader, dd);
  return row;
}

function buildReceipt(address, info, counters) {
  const rows = [];

  if (typeof info.is_contract === "boolean") {
    rows.push(receiptRow("Address type", info.is_contract ? "Contract" : "Not a contract"));
  }
  if (typeof info.name === "string" && info.name.trim() !== "") {
    rows.push(receiptRow("Contract name", info.name.trim(), { mono: true }));
  }
  if (typeof info.is_verified === "boolean") {
    rows.push(receiptRow("Source verified", info.is_verified ? "Yes" : "No"));
  }

  const txCount = formatBlockscoutCount(counters?.transactions_count);
  const transferCount = formatBlockscoutCount(counters?.token_transfers_count);
  if (!txCount && !transferCount) return null; // no usable count -> hide all
  if (txCount) rows.push(receiptRow("Transactions", txCount, { mono: true }));
  if (transferCount) rows.push(receiptRow("Token transfers", transferCount, { mono: true }));

  // Address: shortened, monospace, with a small copy button (full value).
  const addrWrap = el("span", "receipt-address");
  const code = el("code", "", `${address.slice(0, 6)}…${address.slice(-4)}`);
  code.title = address;
  const copyBtn = el("button", "receipt-copy", "Copy");
  copyBtn.type = "button";
  copyBtn.setAttribute("aria-label", "Copy full address");
  copyBtn.addEventListener("click", () => {
    if (!navigator.clipboard?.writeText) return;
    navigator.clipboard
      .writeText(address)
      .then(() => {
        copyBtn.textContent = "Copied";
        setTimeout(() => {
          copyBtn.textContent = "Copy";
        }, 2000);
      })
      .catch(() => {
        // clipboard write failed — fail silently, like the other copy buttons
      });
  });
  addrWrap.append(code, copyBtn);
  rows.push(receiptRow("Address", "", { valueNode: addrWrap }));

  const status = el("p", "receipt-status");
  status.append(el("span", "receipt-dot"), document.createTextNode("Read live from Blockscout"));
  status.firstChild.setAttribute("aria-hidden", "true");

  const list = el("dl", "receipt-rows");
  list.append(...rows);

  const footer = el("p", "receipt-footer");
  const link = el("a", "", "View on explorer →");
  link.href = EXPLORER_ADDRESS_URL + encodeURIComponent(address);
  link.target = "_blank";
  link.rel = "noopener";
  footer.appendChild(link);

  const receipt = el("section", "onchain-receipt");
  receipt.setAttribute("aria-label", "On-chain activity, read live from Blockscout");
  receipt.append(status, list, footer);
  return receipt;
}

async function loadOnchainActivity(root) {
  const box = root.querySelector(".onchain-activity");
  if (!box) return; // no valid address -> no block, no request

  const address = box.dataset.address;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BLOCKSCOUT_TIMEOUT_MS);

  try {
    const base = BLOCKSCOUT_API_ADDRESS_URL + encodeURIComponent(address);
    const [info, counters] = await Promise.all([
      fetchBlockscoutJson(base, controller.signal),
      fetchBlockscoutJson(`${base}/counters`, controller.signal),
    ]);

    // Blockscout returns the checksummed form (0x467B7a…) while the
    // stored address may be lowercase, so compare case-insensitively.
    if (
      !info ||
      typeof info.hash !== "string" ||
      info.hash.toLowerCase() !== address.toLowerCase()
    ) {
      return;
    }

    const receipt = buildReceipt(address, info, counters);
    if (!receipt) return;

    box.replaceChildren(receipt);
    box.hidden = false;
    // The receipt carries the address, copy and explorer link itself.
    const plainRow = box.closest(".onchain-block")?.querySelector(".onchain-row");
    if (plainRow) plainRow.hidden = true;
  } catch {
    // CORS block, timeout (abort), network or JSON error — keep hidden.
  } finally {
    clearTimeout(timer);
  }
}
