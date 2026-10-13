// ============================================
// Agraris — publish page logic
// ============================================

(function () {
  const form = document.getElementById("publish-form");
  const submitBtn = document.getElementById("submit-btn");
  const msgEl = document.getElementById("form-msg");
  const successBlock = document.getElementById("publish-success");
  const checkStatusBtn = document.getElementById("check-status-btn");

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

  function isValidUrl(value) {
    try {
      new URL(value);
      return true;
    } catch {
      return false;
    }
  }

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
      setMessage("Repo link must be a valid URL.", "error");
      return;
    }

    if (demoUrl && !isValidUrl(demoUrl)) {
      setMessage("Demo link must be a valid URL.", "error");
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

    // Random status code so the builder can check the review status on
    // status.html. The database stores only a hash of it
    // (supabase/migration-submission-status.sql).
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
        checkStatusBtn.href = `status.html?t=${encodeURIComponent(statusToken)}`;
        checkStatusBtn.hidden = false;
      }
      successBlock.hidden = false;
    } catch (err) {
      console.error("Gagal publish agent:", err);
      setMessage("Something went wrong. Please try again.", "error");
      submitBtn.disabled = false;
    }
  });
})();
