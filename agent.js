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

  const defaultLabel = btn.textContent;

  btn.addEventListener("click", () => {
    if (!navigator.clipboard?.writeText) return;

    navigator.clipboard
      .writeText(window.location.href)
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

function initCopyBadgeButton(root) {
  const btn = root.querySelector("#copy-badge-btn");
  const codeEl = root.querySelector("#badge-markdown");
  if (!btn || !codeEl) return;

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
  const B = window.AgrarisBuilder;
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
      .map((c) => `<span class="tag">${escapeHtml(c)}</span>`)
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
      <div class="detail-head reveal">
        <div class="agent-row-top">
          <span class="agent-name">${escapeHtml(agent.name)}</span>
          ${renderKindBadge(agent, { lg: true })}
          ${renderVerifiedBadge(agent, { lg: true })}
        </div>
        <div class="agent-meta-row">
          <span class="agent-version">v${escapeHtml(agent.version)}</span>
          ${renderGithubBadge(agent)}
          ${renderLiveBadge(agent)}
        </div>
        ${liveCheckInfo(agent) ? `<p class="live-note">Demo check: ${escapeHtml(LIVE_CHECK_NOTE)}</p>` : ""}
        ${
          ownerSignedText(agent)
            ? `<p class="owner-note"><span class="owner-badge owner-badge-lg">${escapeHtml(ownerSignedText(agent))}</span><span class="owner-signer">Signed by <code>${escapeHtml(ownerProof.signer)}</code>, the wallet returned by the contract's owner().</span> ${escapeHtml(OWNER_SIGNED_NOTE)}</p>`
            : ""
        }
        <div class="agent-meta">${tags}</div>
        <p class="detail-desc">${escapeHtml(agent.description)}</p>
        <div class="detail-links">
          <a class="btn btn-solid" href="${escapeHtml(agent.repo_url)}" target="_blank" rel="noopener noreferrer">View repo</a>
          ${
            agent.demo_url
              ? `<a class="btn" href="${escapeHtml(agent.demo_url)}" target="_blank" rel="noopener noreferrer">View demo</a>`
              : ""
          }
          <button type="button" class="btn" id="copy-link-btn">Copy link</button>
          ${renderWatchlistButton(agent.id, { variant: "lg" })}
        </div>
      </div>

      <div class="detail-row reveal">
        <div class="detail-row-label">Published</div>
        <div>${escapeHtml(formatDate(agent.created_at))}</div>
      </div>

      <p class="builder-more" id="builder-more" hidden></p>

      ${renderOnchainBlock(agent)}

      <div class="badge-section reveal">
        <div class="detail-row-label">Add this badge to your README</div>
        <div class="badge-block">
          <img class="badge-preview" src="badge.svg" width="150" height="24" alt="Listed on Agraris badge" />
          <div class="badge-code-row">
            <code class="badge-code" id="badge-markdown">[![Listed on Agraris](https://agraris.xyz/badge.svg)](https://agraris.xyz/agent.html?id=${escapeHtml(agent.id)})</code>
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
