// ============================================
// Agraris — publish page logic
// ============================================

(function () {
  const form = document.getElementById("publish-form");
  const submitBtn = document.getElementById("submit-btn");
  const msgEl = document.getElementById("form-msg");
  const successBlock = document.getElementById("publish-success");
  const checkStatusBtn = document.getElementById("check-status-btn");
  const statusLinkBlock = document.getElementById("status-link-block");
  const statusLinkInput = document.getElementById("status-link");
  const copyStatusLinkBtn = document.getElementById("copy-status-link-btn");
  const kindInputs = form.querySelectorAll('input[name="kind"]');
  const categoryInput = document.getElementById("category");
  const suggestBlock = document.getElementById("category-suggest");
  const suggestChipsEl = document.getElementById("category-suggest-chips");
  const answeringNote = document.getElementById("answering-note");

  // Tag ideas for tools. They are ordinary category tags (same text[]
  // column, same lowercase-with-hyphens style as "data-analysis") and the
  // chips only save typing: they add no limit of their own.
  const TOOL_TAG_SUGGESTIONS = ["mcp-server", "api", "sdk", "skill", "dataset", "library"];

  // Status codes from this browser's submissions, newest first, so
  // status.html can fall back to the latest one when opened without ?t=.
  const SUBMISSIONS_STORAGE_KEY = "agraris_submissions";
  const MAX_STORED_SUBMISSIONS = 20;

  function rememberStatusToken(token) {
    try {
      const raw = localStorage.getItem(SUBMISSIONS_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      const list = Array.isArray(parsed) ? parsed.filter((t) => typeof t === "string" && t !== token) : [];
      list.unshift(token);
      localStorage.setItem(SUBMISSIONS_STORAGE_KEY, JSON.stringify(list.slice(0, MAX_STORED_SUBMISSIONS)));
    } catch {
      // localStorage unavailable/blocked — the Check status link still works
    }
  }

  function setMessage(text, type) {
    msgEl.textContent = text;
    msgEl.className = `form-msg${type ? " " + type : ""}`;
  }

  // https:// only, same rule as the database (supabase/migration-harden-insert.sql).
  function isValidUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && url.hostname !== "" && !/\s/.test(value);
    } catch {
      return false;
    }
  }

  // ---------- answering a Wanted request ----------

  // publish.html?wanted=<id> comes from "I built this" on wanted.html.
  // The id is only used when it is a uuid AND the public SELECT on wanted
  // returns it (approved, open, younger than 60 days; see
  // supabase/migration-wanted.sql). Anything else is ignored and the form
  // works exactly as without the parameter. The database checks the link
  // again on insert.
  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  let answeringWantedId = null;

  async function loadAnswering() {
    const raw = (new URLSearchParams(window.location.search).get("wanted") || "").trim().toLowerCase();
    if (!UUID_PATTERN.test(raw)) return;
    try {
      const { data, error } = await supabaseClient
        .from("wanted")
        .select("id, title")
        .eq("id", raw)
        .maybeSingle();
      if (error || !data || typeof data.title !== "string" || !data.title) return;
      answeringWantedId = raw;
      answeringNote.textContent = `Answering: ${data.title}`;
      answeringNote.hidden = false;
    } catch {
      // Not reachable / not open — publish normally.
    }
  }

  loadAnswering();

  // Open requests (max 3, unanswered, newest first) above the form, so a
  // builder can see what is wanted. Skipped when the page is opened to
  // answer one request (?wanted=). Text goes in with textContent only;
  // the block stays hidden when nothing loads.
  async function loadOpenRequests() {
    const sectionEl = document.getElementById("publish-wanted");
    const listEl = document.getElementById("publish-wanted-list");
    if (!sectionEl || !listEl) return;
    if (new URLSearchParams(window.location.search).has("wanted")) return;
    try {
      const { data, error } = await supabaseClient.rpc("get_wanted", { p_limit: 30 });
      if (error || !Array.isArray(data)) return;
      const rows = data
        .filter((r) => r && typeof r.title === "string" && r.title && UUID_PATTERN.test(String(r.id)) && !(r.answers_count > 0))
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
        .slice(0, 3);
      if (rows.length === 0) return;
      listEl.textContent = "";
      for (const r of rows) {
        const card = document.createElement("a");
        card.className = "wanted-home-card";
        card.href = `wanted.html?id=${encodeURIComponent(r.id)}`;
        const dot = document.createElement("span");
        dot.className = "wanted-home-dot";
        dot.setAttribute("aria-hidden", "true");
        const title = document.createElement("strong");
        title.className = "wanted-home-title";
        title.textContent = r.title;
        const kind = document.createElement("span");
        kind.className = "kind-badge";
        kind.textContent = r.kind === "tool" ? "Tool" : "Agent";
        const arrow = document.createElement("span");
        arrow.className = "wanted-home-arrow";
        arrow.setAttribute("aria-hidden", "true");
        arrow.textContent = "\u203a";
        card.append(dot, title, kind, arrow);
        listEl.appendChild(card);
      }
      sectionEl.hidden = false;
    } catch {
      // Not reachable: the form works without it.
    }
  }

  loadOpenRequests();

  // ---------- agent / tool ----------

  function selectedKind() {
    const checked = form.querySelector('input[name="kind"]:checked');
    return checked && checked.value === "tool" ? "tool" : "agent";
  }

  function parseTags(raw) {
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  // Chips mirror the tag field (case-insensitive): active = tag is present.
  function syncSuggestionChips() {
    const have = new Set(parseTags(categoryInput.value).map((t) => t.toLowerCase()));
    suggestChipsEl.querySelectorAll(".category-chip").forEach((chip) => {
      const on = have.has(chip.dataset.tag);
      chip.classList.toggle("is-active", on);
      chip.setAttribute("aria-pressed", String(on));
    });
  }

  // The page ships with the agent wording, so the default state is exactly
  // what it was before tools existed. Picking "Tool" swaps the few strings
  // that say "agent" (data-text-agent / data-text-tool pairs in
  // publish.html) and shows the tag suggestions.
  function applyKind() {
    const kind = selectedKind();
    const suffix = kind === "tool" ? "Tool" : "Agent";
    document.querySelectorAll("[data-text-agent]").forEach((el) => {
      el.textContent = el.dataset[`text${suffix}`];
    });
    categoryInput.placeholder = categoryInput.dataset[`placeholder${suffix}`];
    form.querySelectorAll(".kind-option").forEach((label) => {
      label.classList.toggle("is-selected", label.querySelector("input").checked);
    });
    suggestBlock.hidden = kind !== "tool";
    syncSuggestionChips();
  }

  suggestChipsEl.innerHTML = TOOL_TAG_SUGGESTIONS.map(
    (tag) =>
      `<button type="button" class="category-chip" data-tag="${tag}" aria-pressed="false">${tag}</button>`
  ).join("");

  suggestChipsEl.addEventListener("click", (e) => {
    const chip = e.target.closest(".category-chip");
    if (!chip) return;
    const tags = parseTags(categoryInput.value);
    const at = tags.findIndex((t) => t.toLowerCase() === chip.dataset.tag);
    if (at === -1) tags.push(chip.dataset.tag);
    else tags.splice(at, 1);
    categoryInput.value = tags.join(", ");
    syncSuggestionChips();
  });

  categoryInput.addEventListener("input", syncSuggestionChips);
  kindInputs.forEach((input) => input.addEventListener("change", applyKind));
  // Also covers a browser restoring the form (back/forward) with "Tool" checked.
  applyKind();

  statusLinkInput.addEventListener("focus", () => statusLinkInput.select());

  copyStatusLinkBtn.addEventListener("click", () => {
    const done = () => {
      copyStatusLinkBtn.textContent = "Copied";
      setTimeout(() => {
        copyStatusLinkBtn.textContent = "Copy";
      }, 2000);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(statusLinkInput.value).then(done, () => statusLinkInput.select());
    } else {
      // No clipboard API: select the text so it can be copied by hand.
      statusLinkInput.focus();
    }
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    setMessage("", "");

    const name = form.name.value.trim();
    const description = form.description.value.trim();
    const version = form.version.value.trim();
    const repoUrl = form.repo_url.value.trim();
    const categoryRaw = form.category.value.trim();
    const demoUrl = form.demo_url.value.trim();

    if (!name || !description || !version || !repoUrl || !categoryRaw) {
      setMessage("Please fill in all required fields.", "error");
      return;
    }

    if (!isValidUrl(repoUrl)) {
      setMessage("Repo link must be a valid URL starting with https://.", "error");
      return;
    }

    if (demoUrl && !isValidUrl(demoUrl)) {
      setMessage("Demo link must be a valid URL starting with https://.", "error");
      return;
    }

    // Optional. Same pattern as the database check constraint in
    // supabase/migration-contract-address.sql.
    const contractAddress = form.contract_address.value.trim();
    if (contractAddress && !/^0x[a-fA-F0-9]{40}$/.test(contractAddress)) {
      setMessage(
        "Contract or wallet address must start with 0x followed by 40 hex characters (0-9, a-f), e.g. 0x467b…2a6c. Leave it empty if you don't have one.",
        "error"
      );
      return;
    }

    // Optional. Same pattern as the database check constraint in
    // supabase/migration-erc8004.sql.
    const erc8004Id = form.erc8004_agent_id ? form.erc8004_agent_id.value.trim() : "";
    if (erc8004Id && !/^[1-9][0-9]{0,19}$/.test(erc8004Id)) {
      setMessage(
        "ERC-8004 agent ID must be a whole number without leading zeros (up to 20 digits), e.g. 20805. Leave it empty if you don't have one.",
        "error"
      );
      return;
    }

    const category = categoryRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    submitBtn.disabled = true;
    setMessage("Publishing…", "");

    const payload = {
      name,
      description,
      version,
      repo_url: repoUrl,
      category,
      demo_url: demoUrl || null,
    };

    // Random status code so the builder can check the review status and
    // edit the listing on status.html. The database stores only a hash
    // of it (supabase/migration-submission-status.sql). It goes in the
    // URL fragment (#t=), which browsers never send to servers.
    const statusToken =
      window.crypto && typeof window.crypto.randomUUID === "function"
        ? window.crypto.randomUUID()
        : null;
    if (statusToken) {
      payload.status_token = statusToken;
    }

    // Only sent when filled in, so publishing keeps working even if the
    // contract_address column hasn't been added to the database yet.
    if (contractAddress) {
      payload.contract_address = contractAddress;
    }

    // Only sent when filled in, so publishing keeps working even if the
    // erc8004_agent_id column hasn't been added yet (supabase/migration-erc8004.sql).
    if (erc8004Id) {
      payload.erc8004_agent_id = erc8004Id;
    }

    // Only sent when ticked, so publishing keeps working even if the
    // use_avatar column hasn't been added yet (supabase/migration-avatar-optin.sql).
    // It only asks for the repo owner's GitHub avatar; it is shown after review.
    if (form.use_avatar && form.use_avatar.checked) {
      payload.use_avatar = true;
    }

    // Agents are sent exactly as before (no kind): the column defaults to
    // 'agent'. Only tools say so (supabase/migration-listing-kind.sql).
    if (selectedKind() === "tool") {
      payload.kind = "tool";
    }

    // Only sent when answering an open Wanted request (see loadAnswering).
    if (answeringWantedId) {
      payload.wanted_id = answeringWantedId;
    }

    try {
      // No .select() after the insert: new entries are saved with
      // approved = false and RLS only lets the public read approved rows,
      // so asking for the inserted row back would make the insert fail.
      // See supabase/migration-review-queue.sql.
      const { error } = await supabaseClient
        .from("agents")
        .insert([payload]);

      if (error) throw error;

      form.hidden = true;
      setMessage("", "");
      if (statusToken) {
        rememberStatusToken(statusToken);
        const statusPath = `status.html#t=${encodeURIComponent(statusToken)}`;
        checkStatusBtn.href = statusPath;
        checkStatusBtn.hidden = false;
        statusLinkInput.value = new URL(statusPath, window.location.href).href;
        statusLinkBlock.hidden = false;
      }
      successBlock.hidden = false;
    } catch (err) {
      console.error("Gagal publish agent:", err);
      setMessage(
        answeringWantedId
          ? "Something went wrong. If the request you are answering was closed in the meantime, open the publish page again without it."
          : "Something went wrong. Please try again.",
        "error"
      );
      submitBtn.disabled = false;
    }
  });
})();
