// ============================================
// Agraris — agent detail page logic
// ============================================

function setMetaDescription(content) {
  let meta = document.querySelector('meta[name="description"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute("name", "description");
    document.head.appendChild(meta);
  }
  meta.setAttribute("content", content);
}

function setMetaProperty(property, content) {
  let meta = document.querySelector(`meta[property="${property}"]`);
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute("property", property);
    document.head.appendChild(meta);
  }
  meta.setAttribute("content", content);
}

function initCopyLinkButton(root) {
  const btn = root.querySelector("#copy-link-btn");
  if (!btn) return;

  // The label lives in its own span so the icon next to it survives.
  const labelEl = btn.querySelector("#copy-link-label") || btn;
  const defaultLabel = labelEl.textContent;

  btn.addEventListener("click", () => {
    if (!navigator.clipboard?.writeText) return;

    navigator.clipboard
      .writeText(window.location.href)
      .then(() => {
        labelEl.textContent = "Copied!";
        setTimeout(() => {
          labelEl.textContent = defaultLabel;
        }, 2000);
      })
      .catch(() => {
        // clipboard write failed (permissions, insecure context, etc.) —
        // fail silently, no error shown to the user
      });
  });
}

function initCopyBadgeButton(root) {
  const btn = root.querySelector("#copy-badge-btn");
  const codeEl = root.querySelector("#badge-markdown");
  if (!btn || !codeEl) return;

  // A new listing has no badges/<id>.svg until the next daily feed run:
  // show and copy the generic badge instead of a broken image.
  const preview = root.querySelector("#badge-preview");
  if (preview) {
    preview.addEventListener(
      "error",
      () => {
        preview.src = "badge.svg";
        preview.removeAttribute("height");
        preview.width = 150;
        preview.height = 24;
        codeEl.textContent = codeEl.textContent.replace(/badges\/[^)]+\.svg/, "badge.svg");
      },
      { once: true }
    );
  }

  const defaultLabel = btn.textContent;

  btn.addEventListener("click", () => {
    if (!navigator.clipboard?.writeText) return;

    navigator.clipboard
      .writeText(codeEl.textContent)
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

// iframe snippet for embed.html. Light is the embed's default, so the
// light snippet leaves out the theme parameter.
function buildEmbedSnippet(agentId, theme) {
  const themeParam = theme === "dark" ? "&theme=dark" : "";
  return `<iframe src="https://agraris.xyz/embed.html?id=${encodeURIComponent(agentId)}${themeParam}" width="420" height="180" style="border:0" loading="lazy"></iframe>`;
}

// ---------- On-chain address (optional, builder-provided) ----------
//
// agents.contract_address is empty for most agents and may hold
// anything an admin typed in the Dashboard, so the block renders only
// for a well-formed 0x address and is omitted entirely otherwise.
// Inside it, the "On-chain activity" counts are fetched from Blockscout
// after the page renders (see loadOnchainActivity below).

// builder-lib.js is loaded before this file (agent.html). Used for safe URLs.
const B = window.AgrarisBuilder;

const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const EXPLORER_ADDRESS_URL = "https://robinhoodchain.blockscout.com/address/";

// Note under the address. Without a contract owner signature it says, as
// before, that ownership is not checked. With one (owner_signed_at, see
// app.js / supabase/migration-owner-proof.sql) it states what was shown:
// the owner() wallet signed a message. Never an endorsement either way.
function onchainNote(agent) {
  const date = agent.owner_signed_at ? formatSignedDate(agent.owner_signed_at) : "";
  if (!date) {
    return "Address provided by the builder. Agraris does not verify ownership, and a listing does not imply volume, traction, or safety.";
  }
  return escapeHtml(
    `Address provided by the builder. The wallet returned by this contract's owner() signed a message for Agraris on ${date}, and owner() is checked again every 6 hours. This only means the owner wallet signed a message. It is not an endorsement, and a listing does not imply volume, traction, or safety.`
  );
}

// Listings without a contract address get a short, neutral invitation
// instead of nothing. Many listings have no on-chain contract at all, so
// it is worded as optional and points builders at status.html, where the
// address can be added with the status code from publishing.
function renderOnchainInvite() {
  return `
    <div class="detail-row onchain-block onchain-invite reveal">
      <div class="detail-row-label">On-chain</div>
      <p class="onchain-invite-text">No contract address listed yet. If this has a contract on Robinhood Chain, the builder can add it from <a href="status.html">the status page</a> to show live on-chain activity here.</p>
    </div>
  `;
}

function renderOnchainBlock(agent) {
  const address =
    typeof agent.contract_address === "string" ? agent.contract_address.trim() : "";
  if (!ADDRESS_PATTERN.test(address)) return renderOnchainInvite();

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
      <p class="onchain-note">${onchainNote(agent)}</p>
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

// "More from <owner> (N)" under the listing, linking to builder.html, when
// the GitHub owner of this listing's repo URL has more than one approved
// listing. N is that owner's total number of listings (the count shown on
// the profile). The owner comes from builder-lib.js, so it is always a
// lowercase [a-z0-9-] handle before it is used in the query or the DOM.
// The query narrows by repo_url; builder-lib.js then applies the exact
// rules. Any failure leaves the line hidden.
async function loadBuilderMore(root, agent) {
  const el = root.querySelector("#builder-more");
  if (!el || !B) return;
  const handle = B.builderFromRepoUrl(agent.repo_url);
  if (!handle) return;

  let rows;
  try {
    const { data, error } = await supabaseClient
      .from("agents")
      .select("id, repo_url, kind")
      .ilike("repo_url", `%github.com/${handle}/%`);
    if (error || !Array.isArray(data)) return;
    rows = data;
  } catch {
    return;
  }

  const group = B.groupByBuilder(rows).get(handle);
  const total = group ? group.listings.length : 0;
  if (total < 2) return;

  const a = document.createElement("a");
  a.href = B.builderPageUrl(handle);
  a.textContent = `More from ${handle} (${total})`;
  el.textContent = "";
  el.appendChild(a);
  el.hidden = false;
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

// Light/Dark toggle rewrites the snippet; Copy uses the same pattern as
// the badge's "Copy markdown" button.
function initEmbedSnippet(root, agentId) {
  const codeEl = root.querySelector("#embed-snippet");
  const copyBtn = root.querySelector("#copy-embed-btn");
  const themeBtns = root.querySelectorAll("[data-embed-theme]");
  if (!codeEl || !copyBtn) return;

  themeBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      themeBtns.forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
      codeEl.textContent = buildEmbedSnippet(agentId, btn.dataset.embedTheme);
    });
  });

  const defaultLabel = copyBtn.textContent;

  copyBtn.addEventListener("click", () => {
    if (!navigator.clipboard?.writeText) return;

    navigator.clipboard
      .writeText(codeEl.textContent)
      .then(() => {
        copyBtn.textContent = "Copied!";
        setTimeout(() => {
          copyBtn.textContent = defaultLabel;
        }, 2000);
      })
      .catch(() => {
        // clipboard write failed (permissions, insecure context, etc.) —
        // fail silently, no error shown to the user
      });
  });
}

function initReportAgent(root, agentId) {
  const link = root.querySelector("#report-link");
  const form = root.querySelector("#report-form");
  if (!link || !form) return;

  const msgEl = form.querySelector("#report-msg");
  const submitBtn = form.querySelector("#report-submit-btn");

  link.addEventListener("click", (e) => {
    e.preventDefault();
    const expanded = !form.hidden;
    form.hidden = expanded;
    link.setAttribute("aria-expanded", String(!expanded));
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const reason = form.reason.value;
    const details = form.details.value.trim();

    submitBtn.disabled = true;
    msgEl.textContent = "";
    msgEl.className = "form-msg";

    try {
      const { error } = await supabaseClient.from("agent_reports").insert([
        {
          agent_id: agentId,
          reason,
          details: details || null,
        },
      ]);

      if (error) throw error;

      form.hidden = true;
      link.hidden = true;
      const confirm = document.createElement("p");
      confirm.className = "report-confirm";
      confirm.textContent = "Thanks — we'll take a look.";
      form.insertAdjacentElement("afterend", confirm);
    } catch (err) {
      console.error("Gagal mengirim report:", err);
      msgEl.textContent = "Something went wrong. Please try again.";
      msgEl.className = "form-msg error";
      submitBtn.disabled = false;
    }
  });
}

// ---- detail card icons (inline SVG, currentColor, decorative) ----
const ICON_EXTERNAL =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>';
const ICON_LINK =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2"/></svg>';

// Category icons. Categories are free text, so known words get a fitting
// icon and everything else gets the generic tag icon.
const CATEGORY_ICONS = {
  layers:
    '<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/>',
  bars: '<path d="M5 20V11"/><path d="M12 20V5"/><path d="M19 20v-7"/>',
  trend: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  shield: '<path d="M12 3l8 3v6c0 4.5-3.2 7.7-8 9-4.8-1.3-8-4.5-8-9V6l8-3z"/>',
  globe:
    '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/>',
  code: '<path d="M8 8l-5 4 5 4"/><path d="M16 8l5 4-5 4"/>',
  tag: '<path d="M3 12V4h8l10 10-8 8L3 12z"/><circle cx="7.5" cy="8.5" r="1"/>',
};
const CATEGORY_ICON_MAP = [
  [/infra|server|mcp|api|platform/, "layers"],
  [/data|analy|research|insight|dashboard|monitor/, "bars"],
  [/trad|market|price|defi|swap|yield|invest|finance/, "trend"],
  [/secur|audit|safe|risk|verif/, "shield"],
  [/brows|web|social|news|search/, "globe"],
  [/dev|code|sdk|tool|agent-kit|framework/, "code"],
];
function categoryIcon(name) {
  const key = String(name || "").toLowerCase();
  let id = "tag";
  for (const [re, icon] of CATEGORY_ICON_MAP) {
    if (re.test(key)) {
      id = icon;
      break;
    }
  }
  return `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${CATEGORY_ICONS[id]}</svg>`;
}

(async function () {
  const container = document.getElementById("agent-detail");
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");

  if (!id) {
    container.removeAttribute("aria-busy");
    container.innerHTML = renderEmptyState(
      "No agent specified",
      "Go back to the registry and pick an agent to view."
    );
    return;
  }

  try {
    const [agent, ownerProof] = await Promise.all([fetchAgentById(id), fetchOwnerProof(id)]);
    if (agent && ownerProof) agent.owner_signed_at = ownerProof.signed_at;
    const categories = normalizeCategories(agent.category);
    const tags = categories
      .map((c) => `<span class="tag tag-icon">${categoryIcon(c)}${escapeHtml(c)}</span>`)
      .join("");
    // Same template for both kinds. Only the noun changes for tools, and
    // "similar" means the same kind (agents see agents, tools see tools).
    const kind = isTool(agent) ? "tool" : "agent";
    const similarAgents = await fetchSimilarAgents(categories, agent.id, 3, kind);

    document.title = `${agent.name} — Agraris`;
    setMetaDescription(agent.description);
    setMetaProperty("og:title", `${agent.name} — Agraris`);
    setMetaProperty("og:description", agent.description);

    container.innerHTML = `
      <div class="detail-card reveal">
      <div class="detail-head">
        <div class="agent-row-top">
          <span class="agent-name">${escapeHtml(agent.name)}</span>
          ${renderKindBadge(agent, { lg: true })}
          ${renderVerifiedBadge(agent, { lg: true, icon: true })}
        </div>
        <div class="agent-meta-row">
          <span class="agent-version">v${escapeHtml(agent.version)}</span>
          ${renderGithubBadge(agent)}
          ${renderLiveBadge(agent)}
        </div>
        ${renderActivityStrip(agent)}
        ${liveCheckInfo(agent) ? `<p class="live-note">Demo check: ${escapeHtml(LIVE_CHECK_NOTE)}</p>` : ""}
        ${
          ownerSignedText(agent)
            ? `<p class="owner-note"><span class="owner-badge owner-badge-lg">${escapeHtml(ownerSignedText(agent))}</span><span class="owner-signer">Signed by <code>${escapeHtml(ownerProof.signer)}</code>, the wallet returned by the contract's owner().</span> ${escapeHtml(OWNER_SIGNED_NOTE)}</p>`
            : ""
        }
        <div class="agent-meta">${tags}</div>
        <p class="detail-desc">${escapeHtml(agent.description)}</p>
        <div class="detail-links">
          ${
            B.safeHttpsUrl(agent.repo_url)
              ? `<a class="btn btn-solid" href="${escapeHtml(B.safeHttpsUrl(agent.repo_url))}" target="_blank" rel="noopener noreferrer">View repo${ICON_EXTERNAL}</a>`
              : ""
          }
          ${
            B.safeHttpsUrl(agent.demo_url)
              ? `<a class="btn" href="${escapeHtml(B.safeHttpsUrl(agent.demo_url))}" target="_blank" rel="noopener noreferrer">View demo${ICON_EXTERNAL}</a>`
              : ""
          }
          <button type="button" class="btn" id="copy-link-btn">${ICON_LINK}<span id="copy-link-label">Copy link</span></button>
          ${renderWatchlistButton(agent.id, { variant: "lg" })}
        </div>
      </div>

      <div class="detail-row detail-published">
        <div class="detail-row-label">Published</div>
        <div>${escapeHtml(formatDate(agent.created_at))}</div>
      </div>

      <p class="builder-more" id="builder-more" hidden></p>
      </div>

      ${renderOnchainBlock(agent)}

      <div class="badge-section reveal">
        <div class="detail-row-label">Add this badge to your README</div>
        <div class="badge-block">
          <img class="badge-preview" id="badge-preview" src="badges/${escapeHtml(agent.id)}.svg" height="22" alt="Listed on Agraris badge" />
          <div class="badge-code-row">
            <code class="badge-code" id="badge-markdown">[![Listed on Agraris](https://agraris.xyz/badges/${escapeHtml(agent.id)}.svg)](https://agraris.xyz/agent.html?id=${escapeHtml(agent.id)})</code>
            <button type="button" class="btn btn-sm" id="copy-badge-btn">Copy markdown</button>
          </div>
        </div>
      </div>

      <div class="embed-section reveal">
        <div class="detail-row-label">Embed this ${kind}</div>
        <div class="embed-theme-toggle" role="group" aria-label="Embed theme">
          <button type="button" data-embed-theme="light" aria-pressed="true">Light</button>
          <button type="button" data-embed-theme="dark" aria-pressed="false">Dark</button>
        </div>
        <div class="badge-code-row">
          <code class="badge-code" id="embed-snippet">${escapeHtml(buildEmbedSnippet(agent.id, "light"))}</code>
          <button type="button" class="btn btn-sm" id="copy-embed-btn">Copy</button>
        </div>
      </div>

      <div class="report-agent-block reveal">
        <a href="#" class="report-link" id="report-link" aria-expanded="false">Report this ${kind}</a>
        <form class="report-form" id="report-form" hidden>
          <div class="field">
            <label for="report-reason">Reason</label>
            <select id="report-reason" name="reason" required>
              <option value="spam">Spam</option>
              <option value="misleading">Misleading information</option>
              <option value="illegal">Illegal content</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div class="field">
            <label for="report-details">Details</label>
            <textarea id="report-details" name="details" maxlength="1000" placeholder="Anything else we should know? (optional)"></textarea>
          </div>
          <div class="form-actions">
            <button type="submit" class="btn btn-sm" id="report-submit-btn">Submit report</button>
            <span class="form-msg" id="report-msg"></span>
          </div>
        </form>
      </div>

      ${
        similarAgents.length > 0
          ? `
            <div class="similar-agents-section reveal">
              <div class="section-head section-head--sub">
                <h2>Similar ${kind}s</h2>
              </div>
              <div class="agent-list">
                ${similarAgents.map(renderAgentRow).join("")}
              </div>
            </div>
          `
          : ""
      }
    `;
    observeReveal(container);
    initCopyLinkButton(container);
    initCopyAddressButton(container);
    loadOnchainActivity(container);
    loadBuilderMore(container, agent);
    initCopyBadgeButton(container);
    initEmbedSnippet(container, agent.id);
    initReportAgent(container, agent.id);
  } catch (err) {
    container.innerHTML = renderEmptyState(
      "Agent not found",
      "This agent may have been removed, or the link is incorrect.",
      { href: "index.html", label: "Back to registry", variant: "outline" }
    );
  } finally {
    container.removeAttribute("aria-busy");
  }
})();
