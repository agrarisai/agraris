// ============================================
// Agraris — publish page logic
// ============================================

(function () {
  const form = document.getElementById("publish-form");
  const submitBtn = document.getElementById("submit-btn");
  const msgEl = document.getElementById("form-msg");

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

    const category = categoryRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    submitBtn.disabled = true;
    setMessage("Publishing…", "");

    try {
      const { data, error } = await supabaseClient
        .from("agents")
        .insert([
          {
            name,
            description,
            version,
            repo_url: repoUrl,
            category,
            demo_url: demoUrl || null,
          },
        ])
        .select()
        .single();

      if (error) throw error;

      setMessage("Published! Redirecting…", "success");
      window.location.href = `agent.html?id=${encodeURIComponent(data.id)}`;
    } catch (err) {
      console.error("Gagal publish agent:", err);
      setMessage("Something went wrong. Please try again.", "error");
      submitBtn.disabled = false;
    }
  });
})();
