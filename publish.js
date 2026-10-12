// ============================================
// Agraris — publish page logic
// ============================================

(function () {
  const form = document.getElementById("publish-form");
  const submitBtn = document.getElementById("submit-btn");
  const msgEl = document.getElementById("form-msg");
  const successBlock = document.getElementById("publish-success");

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
      successBlock.hidden = false;
    } catch (err) {
      console.error("Gagal publish agent:", err);
      setMessage("Something went wrong. Please try again.", "error");
      submitBtn.disabled = false;
    }
  });
})();
