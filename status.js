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

  function render({ label, name = "", link = null, state, editable = false }) {
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
    if (row.status === "approved") {
      render({
        label: "Approved",
        name: row.name,
        state: "approved",
        link: row.id ? { href: `agent.html?id=${encodeURIComponent(row.id)}`, text: "View agent" } : null,
        editable: true,
      });
    } else {
      render({ label: "Pending review", name: row.name, state: "pending", editable: true });
    }
  }

  // ---------- edit listing ----------

  function setEditMessage(text, type) {
    editMsg.textContent = text;
    editMsg.className = `form-msg${type ? ` ${type}` : ""}`;
  }

  function fillForm(row) {
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

    renderRow(row);
    initEditor(token);
  }

  load();
})();
