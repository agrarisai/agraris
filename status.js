// ============================================
// Agraris — submission status page (status.html)
// ============================================
//
// Reads the status code from #t=<uuid> (older links used ?t=<uuid>;
// those still work and are moved into the fragment), falling back to the
// newest code publish.js saved in this browser. Status comes from the
// get_submission_status RPC with the publishable key; pending rows stay
// unreadable through the normal agents API.
// See supabase/migration-submission-status.sql.
//
// The same code unlocks "Edit listing": get_submission_editable fills
// the form and update_submission saves it. Only description, version,
// category, demo link and contract address can be changed; the RPC
// enforces that and validates everything again.
// See supabase/migration-edit-listing.sql.
//
// The status code is the only credential for a listing: it is kept in
// the URL fragment (never sent to servers or in Referer headers), never
// logged, and never written into the page. Everything from the database
// is shown with textContent / .value, never innerHTML.

(function () {
  const root = document.getElementById("status-root");
  const editRoot = document.getElementById("edit-root");
  const editForm = document.getElementById("edit-form");
  const editName = document.getElementById("edit-name");
  const editNameLabel = document.getElementById("edit-name-label");
  const editContractHint = document.getElementById("edit-contract-hint");
  const editMsg = document.getElementById("edit-msg");
  const saveBtn = document.getElementById("edit-save-btn");
  const cancelBtn = document.getElementById("edit-cancel-btn");

  const SUBMISSIONS_STORAGE_KEY = "agraris_submissions";
  const TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  // Same limits as update_submission() in migration-edit-listing.sql.
  const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
  const MAX_DESCRIPTION = 600;
  const MAX_VERSION = 40;
  const MAX_DEMO_URL = 500;
  const MAX_CATEGORIES = 10;
  const MAX_CATEGORY_LENGTH = 40;

  // SQLSTATE the RPC uses for its own validation messages (written by
  // us, safe to show). Any other error gets a generic message.
  const VALIDATION_ERROR_CODE = "22023";

  const NOT_FOUND_TEXT = "Not found. It may still be in review or may have been removed.";

  let editButton = null;

  const ownerRoot = document.getElementById("owner-proof-root");
  const ownerState = document.getElementById("owner-proof-state");
  const ownerMessage = document.getElementById("owner-proof-message");
  const ownerBtn = document.getElementById("owner-proof-btn");
  const ownerMsg = document.getElementById("owner-proof-msg");

  function readToken() {
    const fromHash = new URLSearchParams(window.location.hash.slice(1)).get("t");
    if (fromHash) return fromHash.trim();

    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get("t");
    if (fromQuery) {
      // Older links carried the code in the query string. Move it to the
      // fragment so it doesn't stay in the address/history as ?t=.
      const token = fromQuery.trim();
      if (TOKEN_PATTERN.test(token)) {
        params.delete("t");
        const rest = params.toString();
        history.replaceState(
          history.state,
          "",
          `${window.location.pathname}${rest ? `?${rest}` : ""}#t=${encodeURIComponent(token)}`
        );
      }
      return token;
    }

    try {
      const list = JSON.parse(localStorage.getItem(SUBMISSIONS_STORAGE_KEY) || "[]");
      if (Array.isArray(list) && typeof list[0] === "string") return list[0];
    } catch {
      // localStorage unavailable/blocked or unreadable — no fallback
    }
    return "";
  }

  function render({ label, name = "", link = null, state, editable = false, kind = "agent" }) {
    root.textContent = "";
    root.dataset.state = state;
    editButton = null;

    const labelEl = document.createElement("p");
    labelEl.className = "status-label";
    labelEl.textContent = label;
    root.appendChild(labelEl);

    if (name) {
      const nameEl = document.createElement("p");
      nameEl.className = "status-name";
      nameEl.textContent = name;
      // Tools get the same small "Tool" label as on the cards. Built with
      // the DOM (never innerHTML), like everything else on this page.
      if (kind === "tool") {
        const badge = document.createElement("span");
        badge.className = "kind-badge";
        badge.textContent = "Tool";
        nameEl.append(" ", badge);
      }
      root.appendChild(nameEl);
    }

    if (link || editable) {
      const actions = document.createElement("div");
      actions.className = "status-actions";

      if (link) {
        const a = document.createElement("a");
        a.className = "btn btn-solid";
        a.href = link.href;
        a.textContent = link.text;
        actions.appendChild(a);
      }

      if (editable) {
        editButton = document.createElement("button");
        editButton.type = "button";
        editButton.className = link ? "btn" : "btn btn-solid";
        editButton.textContent = "Edit listing";
        editButton.setAttribute("aria-controls", "edit-root");
        editButton.setAttribute("aria-expanded", "false");
        actions.appendChild(editButton);
      }

      root.appendChild(actions);
    }
  }

  function renderRow(row) {
    // kind comes from get_submission_status; a missing value means agent.
    const kind = row.kind === "tool" ? "tool" : "agent";
    if (row.status === "approved") {
      render({
        label: "Approved",
        name: row.name,
        state: "approved",
        link: row.id
          ? { href: `agent.html?id=${encodeURIComponent(row.id)}`, text: kind === "tool" ? "View tool" : "View agent" }
          : null,
        editable: true,
        kind,
      });
      if (row.id) showLiveCheck(row.id);
      if (currentToken) loadOwnerProof(currentToken);
    } else {
      render({ label: "Pending review", name: row.name, state: "pending", editable: true, kind });
    }
  }

  // ---------- live check of the demo URL ----------

  // Approved listings are readable through the normal agents API, so the
  // live check columns come from the same public SELECT as on the cards
  // (supabase/migration-live-check.sql). Pending listings are never
  // checked. Built with the DOM like the rest of this page; any failure
  // just leaves the block out.
  async function showLiveCheck(id) {
    let listing;
    try {
      const { data, error } = await supabaseClient
        .from("agents")
        .select("id, demo_url, live_status, live_checked_at")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      listing = data;
    } catch {
      return;
    }
    if (!listing || typeof listing.demo_url !== "string" || !listing.demo_url.trim()) return;
    // The page may have been re-rendered meanwhile (e.g. an error).
    if (root.dataset.state !== "approved" || root.querySelector(".status-live")) return;

    const block = document.createElement("div");
    block.className = "status-live";

    const info = liveCheckInfo(listing);
    const line = document.createElement("p");
    line.className = "status-live-line";
    if (info) {
      const badge = document.createElement("span");
      badge.className = `live-badge live-badge--${info.state}`;
      badge.title = LIVE_CHECK_NOTE;
      const dot = document.createElement("span");
      dot.className = "live-badge-dot";
      dot.setAttribute("aria-hidden", "true");
      badge.append(dot, info.text);
      line.append("Demo link: ", badge);
    } else {
      line.textContent = "Demo link: not checked yet. Checks run every 6 hours.";
    }
    block.appendChild(line);

    const note = document.createElement("p");
    note.className = "live-note";
    note.textContent =
      info && info.state === "down"
        ? `Your demo link did not respond to 3 or more checks in a row. Make sure it opens over https. ${LIVE_CHECK_NOTE}`
        : LIVE_CHECK_NOTE;
    block.appendChild(note);

    const actions = root.querySelector(".status-actions");
    root.insertBefore(block, actions || null);
  }

  // ---------- contract owner signature ----------

  // Sentences for the reason codes written by scripts/owner-proof.js.
  const OWNER_REASONS = {
    expired: "The last signing request expired before it was signed. Start again.",
    replaced: "The last signing request was replaced by a newer one.",
    listing_unavailable: "The listing was not available when the signature was checked.",
    contract_changed: "The contract address changed after signing. Sign again for the new address.",
    message_mismatch: "The signed message could not be matched. Start again.",
    bad_signature: "The signature could not be read. Start again.",
    not_a_contract: "There is no contract at this address on Robinhood Chain (chain ID 4663), so it can't be shown with this feature.",
    no_owner: "This contract has no owner() we can read (or it is the zero address), so it can't be shown with this feature yet.",
    owner_is_contract: "This contract's owner() is another contract (for example a multisig), so it can't be shown with this feature yet.",
    not_owner: "The wallet that signed is not the contract's current owner(). Sign with the owner wallet.",
    check_failed: "The signature could not be checked for a day. Please sign again.",
    owner_changed: "The contract's owner() changed after you signed, so the signature no longer applies. The new owner can sign again.",
  };

  const NO_WALLET_TEXT =
    "No browser wallet found. Open this status link in a browser that has the owner wallet (for example a wallet extension). Keep the link private.";

  let currentToken = "";
  let ownerBusy = false;

  function setOwnerMsg(text, type) {
    ownerMsg.textContent = text;
    ownerMsg.className = `form-msg${type ? ` ${type}` : ""}`;
  }

  function ownerStateText(row) {
    if (row.signer && row.signed_at) {
      return `Contract owner signed a message · ${formatSignedDate(row.signed_at)}. Signed by ${row.signer}. Checked again every 6 hours.`;
    }
    if (row.last_status === "submitted") {
      return "Signature received. It is checked on our server within about 15 minutes; reload this page later.";
    }
    if (row.last_status === "rejected" || row.last_status === "revoked" || row.last_status === "expired") {
      return OWNER_REASONS[row.last_reason] || "The last signature was not accepted. Start again.";
    }
    return "No owner signature yet.";
  }

  async function loadOwnerProof(token) {
    let row;
    try {
      const { data, error } = await supabaseClient.rpc("get_owner_proof_status", { p_token: token });
      if (error || !Array.isArray(data)) return;
      row = data[0];
    } catch {
      return;
    }
    if (!row || typeof row.contract_address !== "string" || !row.contract_address) {
      ownerRoot.hidden = true;
      return;
    }

    ownerRoot.hidden = false;
    ownerState.textContent = ownerStateText(row);
    ownerBtn.textContent = row.signer ? "Sign again" : "Sign with wallet";
    const hasWallet = Boolean(window.ethereum && typeof window.ethereum.request === "function");
    ownerBtn.disabled = !hasWallet || row.last_status === "submitted";
    setOwnerMsg(hasWallet ? "" : NO_WALLET_TEXT, "");
  }

  function utf8Hex(text) {
    return `0x${Array.from(new TextEncoder().encode(text), (b) => b.toString(16).padStart(2, "0")).join("")}`;
  }

  async function signOwnerProof() {
    if (ownerBusy || !currentToken) return;
    const wallet = window.ethereum;
    if (!wallet || typeof wallet.request !== "function") {
      setOwnerMsg(NO_WALLET_TEXT, "error");
      return;
    }

    ownerBusy = true;
    ownerBtn.disabled = true;
    setOwnerMsg("Preparing the message…", "");
    try {
      const { data, error } = await supabaseClient.rpc("request_owner_proof", { p_token: currentToken });
      if (error) {
        setOwnerMsg(error.code === VALIDATION_ERROR_CODE && typeof error.message === "string" ? error.message : "Could not start right now. Please try again later.", "error");
        return;
      }
      const req = Array.isArray(data) ? data[0] : null;
      if (!req || typeof req.message !== "string" || typeof req.nonce !== "string") {
        setOwnerMsg(NOT_FOUND_TEXT, "error");
        return;
      }
      ownerMessage.textContent = req.message;
      ownerMessage.hidden = false;

      setOwnerMsg("Confirm in your wallet…", "");
      let signature;
      try {
        const accounts = await wallet.request({ method: "eth_requestAccounts" });
        const account = Array.isArray(accounts) ? accounts[0] : null;
        if (typeof account !== "string") throw new Error("no account");
        signature = await wallet.request({ method: "personal_sign", params: [utf8Hex(req.message), account] });
      } catch (err) {
        setOwnerMsg(err && err.code === 4001 ? "Signing was cancelled." : "The wallet did not return a signature.", "error");
        return;
      }

      const sub = await supabaseClient.rpc("submit_owner_proof", {
        p_token: currentToken,
        p_nonce: req.nonce,
        p_signature: String(signature || ""),
      });
      if (sub.error) {
        setOwnerMsg(sub.error.code === VALIDATION_ERROR_CODE && typeof sub.error.message === "string" ? sub.error.message : "Could not send the signature right now. Please try again later.", "error");
        return;
      }
      setOwnerMsg("", "");
      await loadOwnerProof(currentToken);
    } catch {
      setOwnerMsg("Something went wrong. Please try again later.", "error");
    } finally {
      ownerBusy = false;
      if (ownerMsg.classList.contains("error")) ownerBtn.disabled = false;
    }
  }

  ownerBtn.addEventListener("click", signOwnerProof);

  // ---------- edit listing ----------

  function setEditMessage(text, type) {
    editMsg.textContent = text;
    editMsg.className = `form-msg${type ? ` ${type}` : ""}`;
  }

  function fillForm(row) {
    // The two strings in the form that say "agent" follow the listing's
    // kind (the kind itself can't be changed here).
    const noun = row.kind === "tool" ? "tool" : "agent";
    editNameLabel.textContent = `${noun === "tool" ? "Tool" : "Agent"} name`;
    editContractHint.textContent = `Optional. Address of your ${noun}'s contract on Robinhood Chain (0x...)`;
    editName.textContent = row.name || "";
    editForm.description.value = row.description || "";
    editForm.version.value = row.version || "";
    editForm.category.value = Array.isArray(row.category) ? row.category.join(", ") : "";
    editForm.demo_url.value = row.demo_url || "";
    editForm.contract_address.value = row.contract_address || "";
  }

  function readForm() {
    const seen = new Set();
    const category = [];
    editForm.category.value.split(",").forEach((raw) => {
      const tag = raw.trim();
      if (tag && !seen.has(tag)) {
        seen.add(tag);
        category.push(tag);
      }
    });

    return {
      description: editForm.description.value.trim(),
      version: editForm.version.value.trim(),
      category,
      demoUrl: editForm.demo_url.value.trim(),
      contractAddress: editForm.contract_address.value.trim(),
    };
  }

  // Returns an error message, or "" when the values look valid. The
  // database checks all of this again.
  function validate(v) {
    if (!v.description || v.description.length > MAX_DESCRIPTION) {
      return `Description is required and must be at most ${MAX_DESCRIPTION} characters.`;
    }
    if (!v.version || v.version.length > MAX_VERSION) {
      return `Version is required and must be at most ${MAX_VERSION} characters.`;
    }
    if (v.category.length === 0) return "Add at least one category.";
    if (v.category.length > MAX_CATEGORIES) return `Use at most ${MAX_CATEGORIES} categories.`;
    if (v.category.some((c) => c.length > MAX_CATEGORY_LENGTH)) {
      return `Each category must be at most ${MAX_CATEGORY_LENGTH} characters.`;
    }
    if (v.demoUrl) {
      let ok = v.demoUrl.length <= MAX_DEMO_URL && /^https:\/\/[^/?#\s]+/i.test(v.demoUrl) && !/\s/.test(v.demoUrl);
      if (ok) {
        try {
          ok = new URL(v.demoUrl).protocol === "https:";
        } catch {
          ok = false;
        }
      }
      if (!ok) {
        return `Demo link must start with https://, contain no spaces, and be at most ${MAX_DEMO_URL} characters. Leave it empty to remove it.`;
      }
    }
    if (v.contractAddress && !ADDRESS_PATTERN.test(v.contractAddress)) {
      return "Contract address must be 0x followed by 40 hex characters (0-9, a-f). Leave it empty to remove it.";
    }
    return "";
  }

  function rpcErrorText(error) {
    if (error && error.code === VALIDATION_ERROR_CODE && typeof error.message === "string") {
      return error.message;
    }
    return "Could not save right now. Please try again later.";
  }

  function closeEditor() {
    editRoot.hidden = true;
    if (editButton) {
      editButton.setAttribute("aria-expanded", "false");
      editButton.focus();
    }
  }

  async function openEditor(token) {
    if (!editButton) return;
    if (!editRoot.hidden) {
      closeEditor();
      return;
    }

    editButton.disabled = true;
    let row;
    try {
      const { data, error } = await supabaseClient.rpc("get_submission_editable", { p_token: token });
      if (error) throw error;
      row = Array.isArray(data) ? data[0] : null;
    } catch {
      editButton.disabled = false;
      render({ label: "Could not load the listing right now. Please try again later.", state: "error" });
      return;
    }
    editButton.disabled = false;

    if (!row) {
      editRoot.hidden = true;
      render({ label: NOT_FOUND_TEXT, state: "not-found" });
      return;
    }

    fillForm(row);
    setEditMessage("", "");
    editRoot.hidden = false;
    editButton.setAttribute("aria-expanded", "true");
    editForm.description.focus();
  }

  function initEditor(token) {
    root.addEventListener("click", (e) => {
      if (editButton && e.target === editButton) openEditor(token);
    });

    cancelBtn.addEventListener("click", closeEditor);

    // Clear "Saved" as soon as something changes again.
    editForm.addEventListener("input", () => {
      if (editMsg.classList.contains("success")) setEditMessage("", "");
    });

    editForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const values = readForm();
      const problem = validate(values);
      if (problem) {
        setEditMessage(problem, "error");
        return;
      }

      saveBtn.disabled = true;
      setEditMessage("Saving…", "");

      try {
        const { data, error } = await supabaseClient.rpc("update_submission", {
          p_token: token,
          p_description: values.description,
          p_demo_url: values.demoUrl || null,
          p_contract_address: values.contractAddress || null,
          p_version: values.version,
          p_category: values.category,
        });

        if (error) {
          setEditMessage(rpcErrorText(error), "error");
          return;
        }

        const row = Array.isArray(data) ? data[0] : null;
        if (!row) {
          editRoot.hidden = true;
          render({ label: NOT_FOUND_TEXT, state: "not-found" });
          return;
        }

        fillForm(row);
        setEditMessage("Saved", "success");
      } catch {
        setEditMessage("Could not save right now. Please try again later.", "error");
      } finally {
        saveBtn.disabled = false;
      }
    });
  }

  // ---------- load ----------

  async function load() {
    const token = readToken();
    if (!TOKEN_PATTERN.test(token)) {
      render({ label: NOT_FOUND_TEXT, state: "not-found" });
      return;
    }

    let rows;
    try {
      const { data, error } = await supabaseClient.rpc("get_submission_status", { p_token: token });
      if (error) throw error;
      rows = Array.isArray(data) ? data : [];
    } catch (err) {
      console.error("Gagal mengecek status submission:", err && err.message ? err.message : err);
      render({ label: "Could not check the status right now. Please try again later.", state: "error" });
      return;
    }

    const row = rows[0];
    if (!row || (row.status !== "pending" && row.status !== "approved")) {
      render({ label: NOT_FOUND_TEXT, state: "not-found" });
      return;
    }

    currentToken = token;
    renderRow(row);
    initEditor(token);
  }

  load();
})();
