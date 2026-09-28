// ============================================
// Agraris — priority review request form (token.html#priority)
// ============================================

// Stage-1 $AGRARIS utility: holders can ask for an agent to be moved
// to the front of the Verified review queue. Balances are checked by
// hand on the block explorer at review time — no on-chain calls and
// no wallet connection happen here. The request is just inserted into
// `priority_requests`, which has an INSERT-only RLS policy (see
// supabase/migration-priority-requests.sql).

(function () {
  const root = document.getElementById("priority-form");
  if (!root) return;

  const agentLinkInput = document.getElementById("priority-agent-link");
  const walletInput = document.getElementById("priority-wallet");
  const handleInput = document.getElementById("priority-x-handle");
  const honeypotInput = document.getElementById("priority-website");
  const submitBtn = document.getElementById("priority-submit-btn");
  const msgEl = document.getElementById("priority-msg");

  const WALLET_RE = /^0x[a-fA-F0-9]{40}$/;
  const X_HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const SUCCESS_TEXT = "Request received. We'll check your wallet balance and follow up on X.";

  function setMessage(text, type) {
    msgEl.textContent = text;
    msgEl.className = `form-msg${type ? " " + type : ""}`;
  }

  // Pulls the agent id out of an agent page link like
  // https://agraris.xyz/agent.html?id=<uuid>. Returns null if the link
  // isn't a valid agent page URL or has no usable id.
  function parseAgentId(value) {
    let url;
    try {
      url = new URL(value);
    } catch {
      return null;
    }
    if (!/agent\.html$/.test(url.pathname)) return null;
    const id = (url.searchParams.get("id") || "").trim();
    return UUID_RE.test(id) ? id : null;
  }

  function showSuccess() {
    root.hidden = true;
    const confirm = document.createElement("p");
    confirm.className = "form-msg success priority-confirm";
    confirm.textContent = SUCCESS_TEXT;
    root.after(confirm);
  }

  submitBtn.addEventListener("click", async () => {
    setMessage("", "");

    const agentLink = agentLinkInput.value.trim();
    const wallet = walletInput.value.trim();
    const handle = handleInput.value.trim().replace(/^@/, "");

    if (!agentLink || !wallet || !handle) {
      setMessage("Please fill in all fields.", "error");
      return;
    }

    const agentId = parseAgentId(agentLink);
    if (!agentId) {
      setMessage(
        "That doesn't look like an agent page link. Copy the full URL from the agent's page, e.g. https://agraris.xyz/agent.html?id=…",
        "error"
      );
      return;
    }

    if (!WALLET_RE.test(wallet)) {
      setMessage("Wallet address must be 0x followed by 40 hex characters.", "error");
      return;
    }

    if (!X_HANDLE_RE.test(handle)) {
      setMessage("X handle must be 1–15 letters, numbers, or underscores.", "error");
      return;
    }

    // Honeypot: real visitors never see this field. If a bot filled it
    // in, pretend it worked and skip the insert.
    if (honeypotInput.value) {
      showSuccess();
      return;
    }

    submitBtn.disabled = true;
    setMessage("Sending…", "");

    try {
      let agent = null;
      try {
        agent = await fetchAgentById(agentId);
      } catch (err) {
        // PGRST116 = .single() found no row.
        if (!err || err.code !== "PGRST116") throw err;
      }
      if (!agent) {
        setMessage("Agent not found.", "error");
        submitBtn.disabled = false;
        return;
      }

      // No .select() after .insert(): the table deliberately has no
      // SELECT policy, so asking for the row back would fail.
      const { error } = await supabaseClient.from("priority_requests").insert([
        {
          agent_id: agentId,
          wallet_address: wallet,
          x_handle: handle,
        },
      ]);

      if (error) {
        // 23505 = unique_violation on (agent_id, wallet_address).
        if (error.code === "23505") {
          setMessage("This wallet already has a request for this agent.", "error");
          submitBtn.disabled = false;
          return;
        }
        throw error;
      }

      setMessage("", "");
      showSuccess();
    } catch (err) {
      console.error("Gagal mengirim priority request:", err);
      setMessage("Something went wrong. Please try again.", "error");
      submitBtn.disabled = false;
    }
  });
})();
