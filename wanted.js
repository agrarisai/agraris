// ============================================
// Agraris — Wanted board (wanted.html)
// ============================================
//
// Two views:
//   wanted.html          — open requests (get_wanted RPC) + the request form
//   wanted.html?id=<id>  — one request and the approved listings that
//                          answer it (agents.wanted_id)
// See supabase/migration-wanted.sql. Requests are sent with the
// submit_wanted RPC; they stay pending until approved in the "Wanted
// queue" workflow, so nothing new shows up here right away.
//
// Requests are written by the public without accounts: everything from
// the database is shown with textContent, never innerHTML. A failed or
// odd response never prints "undefined" / NaN: rows without the expected
// fields are dropped and counts are only shown when they are numbers.

(function () {
  const headingEl = document.getElementById("wanted-heading");
  const countEl = document.getElementById("wanted-count");
  const leadEl = document.getElementById("wanted-lead");
  const listEl = document.getElementById("wanted-list");
  const detailEl = document.getElementById("wanted-detail");
  const answersEl = document.getElementById("wanted-answers");
  const answersCountEl = document.getElementById("wanted-answers-count");
  const formSection = document.getElementById("wanted-form-section");
  const form = document.getElementById("wanted-form");
  const submitBtn = document.getElementById("wanted-submit-btn");
  const msgEl = document.getElementById("wanted-msg");
  const submittedEl = document.getElementById("wanted-submitted");

  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const LIST_LIMIT = 50;
  // Same limits as submit_wanted() in supabase/migration-wanted.sql.
  const MAX_TITLE = 100;
  const MAX_DESCRIPTION = 500;
  // SQLSTATE submit_wanted() uses for its own messages (written by us,
  // safe to show). Any other error gets a generic message.
  const VALIDATION_ERROR_CODE = "22023";

  function kindLabel(kind) {
    if (kind === "agent") return "Agent";
    if (kind === "tool") return "Tool";
    return "Any";
  }

  function answersText(count) {
    if (typeof count !== "number" || !Number.isFinite(count) || count < 0) return "";
    return `${count} answer${count === 1 ? "" : "s"}`;
  }

  function isRequest(row) {
    return (
      row &&
      UUID_PATTERN.test(String(row.id)) &&
      typeof row.title === "string" &&
      row.title !== "" &&
      typeof row.description === "string"
    );
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function kindBadge(kind) {
    return el("span", "kind-badge", kindLabel(kind));
  }

  function builtThisLink(id) {
    const a = el("a", "btn btn-sm", "I built this");
    a.href = `publish.html?wanted=${encodeURIComponent(id)}`;
    return a;
  }

  function showListMessage(text) {
    listEl.textContent = "";
    listEl.appendChild(el("p", "wanted-empty", text));
  }

  // ---------- board ----------

  function renderCard(row) {
    const card = el("article", "wanted-card");

    const top = el("div", "wanted-card-top");
    const title = el("a", "wanted-title", row.title);
    title.href = `wanted.html?id=${encodeURIComponent(row.id)}`;
    top.append(title, " ", kindBadge(row.kind));

    const meta = el("div", "wanted-card-meta");
    const answers = answersText(row.answers_count);
    if (answers) meta.appendChild(el("span", "wanted-answers", answers));
    meta.appendChild(builtThisLink(row.id));

    card.append(top, el("p", "wanted-desc", row.description), meta);
    return card;
  }

  async function loadBoard() {
    let rows;
    try {
      const { data, error } = await supabaseClient.rpc("get_wanted", { p_limit: LIST_LIMIT });
      if (error || !Array.isArray(data)) throw new Error("bad response");
      rows = data.filter(isRequest);
    } catch {
      showListMessage("Couldn't load requests right now. You can still send one below.");
      return;
    } finally {
      listEl.removeAttribute("aria-busy");
    }

    if (rows.length === 0) {
      showListMessage("No open requests right now. Ask for an agent or tool below.");
      return;
    }

    countEl.textContent = `${rows.length} request${rows.length === 1 ? "" : "s"}`;
    listEl.textContent = "";
    rows.forEach((row) => listEl.appendChild(renderCard(row)));
  }

  // ---------- one request ----------

  async function loadDetail(id) {
    formSection.hidden = true;
    document.title = "Request — Agraris";

    let request = null;
    if (UUID_PATTERN.test(id)) {
      try {
        // Public SELECT on wanted only returns approved, open requests
        // younger than 60 days, and only these columns.
        const { data, error } = await supabaseClient
          .from("wanted")
          .select("id, title, description, kind, created_at")
          .eq("id", id)
          .maybeSingle();
        if (!error && isRequest(data)) request = data;
      } catch {
        request = null;
      }
    }
    listEl.removeAttribute("aria-busy");

    if (!request) {
      headingEl.textContent = "Request not found";
      leadEl.textContent = "It may still be in review, closed, or older than 60 days.";
      listEl.textContent = "";
      const back = el("p", "wanted-back");
      const a = el("a", "", "All requests");
      a.href = "wanted.html";
      back.appendChild(a);
      listEl.appendChild(back);
      return;
    }

    document.title = `${request.title} — Wanted — Agraris`;
    headingEl.textContent = request.title;
    leadEl.textContent = "";
    leadEl.append(kindBadge(request.kind), " ");
    leadEl.appendChild(el("span", "wanted-desc", request.description));

    listEl.textContent = "";
    const actions = el("div", "wanted-card-meta");
    actions.appendChild(builtThisLink(request.id));
    listEl.appendChild(actions);

    detailEl.hidden = false;
    let answers;
    try {
      const { data, error } = await supabaseClient
        .from("agents")
        .select(AGENT_COLUMNS)
        .eq("wanted_id", request.id)
        .order("created_at", { ascending: false });
      if (error || !Array.isArray(data)) throw new Error("bad response");
      answers = data;
    } catch {
      answersEl.textContent = "";
      answersEl.appendChild(el("p", "wanted-empty", "Couldn't load answers right now."));
      return;
    }

    answersCountEl.textContent = answersText(answers.length);
    if (answers.length === 0) {
      answersEl.textContent = "";
      answersEl.appendChild(el("p", "wanted-empty", "No answers yet."));
      return;
    }
    answersEl.innerHTML = answers.map(renderAgentRow).join("");
    observeReveal(answersEl);
  }

  // ---------- request form ----------

  function setMessage(text, type) {
    msgEl.textContent = text;
    msgEl.className = `form-msg${type ? ` ${type}` : ""}`;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = form.title.value.trim();
    const description = form.description.value.trim();
    const kind = ["agent", "tool", "any"].includes(form.kind.value) ? form.kind.value : "any";

    if (!title || [...title].length > MAX_TITLE) {
      setMessage(`Title is required and must be at most ${MAX_TITLE} characters.`, "error");
      return;
    }
    if (!description || [...description].length > MAX_DESCRIPTION) {
      setMessage(`Description is required and must be at most ${MAX_DESCRIPTION} characters.`, "error");
      return;
    }

    submitBtn.disabled = true;
    setMessage("Sending…", "");
    try {
      const { error } = await supabaseClient.rpc("submit_wanted", {
        p_title: title,
        p_description: description,
        p_kind: kind,
      });
      if (error) {
        setMessage(
          error.code === VALIDATION_ERROR_CODE && typeof error.message === "string"
            ? error.message
            : "Could not send right now. Please try again later.",
          "error"
        );
        submitBtn.disabled = false;
        return;
      }
      form.hidden = true;
      setMessage("", "");
      submittedEl.hidden = false;
    } catch {
      setMessage("Could not send right now. Please try again later.", "error");
      submitBtn.disabled = false;
    }
  });

  // ---------- start ----------

  const id = new URLSearchParams(window.location.search).get("id");
  if (id !== null) loadDetail(id.trim().toLowerCase());
  else loadBoard();
})();
