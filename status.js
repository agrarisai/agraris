// ============================================
// Agraris — submission status page (status.html)
// ============================================
//
// Reads the status code from ?t=<uuid> (falling back to the newest code
// publish.js saved in this browser) and asks Supabase for its status
// through the get_submission_status RPC with the publishable key. The
// function only returns status, name and id; pending rows stay
// unreadable through the normal agents API.
// See supabase/migration-submission-status.sql.

(function () {
  const root = document.getElementById("status-root");

  const SUBMISSIONS_STORAGE_KEY = "agraris_submissions";
  const TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  const NOT_FOUND_TEXT = "Not found. It may still be in review or may have been removed.";

  function readToken() {
    const fromUrl = new URLSearchParams(window.location.search).get("t");
    if (fromUrl) return fromUrl.trim();
    try {
      const list = JSON.parse(localStorage.getItem(SUBMISSIONS_STORAGE_KEY) || "[]");
      if (Array.isArray(list) && typeof list[0] === "string") return list[0];
    } catch {
      // localStorage unavailable/blocked or unreadable — no fallback
    }
    return "";
  }

  function render({ label, name = "", link = null, state }) {
    root.textContent = "";
    root.dataset.state = state;

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

    if (link) {
      const actions = document.createElement("div");
      actions.className = "status-actions";
      const a = document.createElement("a");
      a.className = "btn btn-solid";
      a.href = link.href;
      a.textContent = link.text;
      actions.appendChild(a);
      root.appendChild(actions);
    }
  }

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

    if (row.status === "approved") {
      render({
        label: "Approved",
        name: row.name,
        state: "approved",
        link: row.id ? { href: `agent.html?id=${encodeURIComponent(row.id)}`, text: "View agent" } : null,
      });
      return;
    }

    render({ label: "Pending review", name: row.name, state: "pending" });
  }

  load();
})();
