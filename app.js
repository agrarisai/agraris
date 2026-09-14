// ============================================
// Agraris — shared helpers
// ============================================

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// category column may be stored as text or as a Postgres text[] array.
// Normalize to a plain array of strings either way.
function normalizeCategories(raw) {
  if (Array.isArray(raw)) return raw.filter(Boolean);
  if (typeof raw === "string" && raw.trim() !== "") {
    // handle "{tag1,tag2}" postgres array literal just in case,
    // otherwise treat as a single comma-separated string
    const cleaned = raw.replace(/^{|}$/g, "");
    return cleaned
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

function formatDate(isoString) {
  try {
    const d = new Date(isoString);
    return d.toLocaleDateString("id-ID", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

// Renders one row for the ledger-style agent list used on
// index.html and search.html
function renderAgentRow(agent) {
  const categories = normalizeCategories(agent.category);
  const tags = categories
    .map((c) => `<span class="tag">${escapeHtml(c)}</span>`)
    .join("");

  return `
    <a class="agent-row" href="agent.html?id=${encodeURIComponent(agent.id)}">
      <div class="agent-row-top">
        <span class="agent-name">${escapeHtml(agent.name)}</span>
        <span class="agent-version">v${escapeHtml(agent.version)}</span>
      </div>
      <p class="agent-desc">${escapeHtml(agent.description)}</p>
      <div class="agent-meta">${tags}</div>
    </a>
  `;
}

function renderEmptyState(title, body) {
  return `
    <div class="empty-state">
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(body)}</span>
    </div>
  `;
}

// Fetch agents from Supabase, newest first.
async function fetchAgents({ search = "", category = "" } = {}) {
  let query = supabaseClient
    .from("agents")
    .select("*")
    .order("created_at", { ascending: false });

  if (search) {
    // matches against name OR description
    query = query.or(
      `name.ilike.%${search}%,description.ilike.%${search}%`
    );
  }

  if (category) {
    query = query.ilike("category", `%${category}%`);
  }

  const { data, error } = await query;

  if (error) {
    console.error("Gagal mengambil data agent:", error);
    throw error;
  }

  return data || [];
}

async function fetchAgentById(id) {
  const { data, error } = await supabaseClient
    .from("agents")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    console.error("Gagal mengambil detail agent:", error);
    throw error;
  }

  return data;
}

// ============================================
// Hamburger menu (shared header, all pages)
// ============================================

(function initMenu() {
  const toggle = document.getElementById("menu-toggle");
  const panel = document.getElementById("menu-panel");
  const overlay = document.getElementById("menu-overlay");
  const closeBtn = document.getElementById("menu-close");

  if (!toggle || !panel || !overlay) return;

  function openMenu() {
    panel.classList.add("is-open");
    overlay.classList.add("is-open");
    document.body.classList.add("menu-open");
    toggle.setAttribute("aria-expanded", "true");
    panel.setAttribute("aria-hidden", "false");
  }

  function closeMenu() {
    panel.classList.remove("is-open");
    overlay.classList.remove("is-open");
    document.body.classList.remove("menu-open");
    toggle.setAttribute("aria-expanded", "false");
    panel.setAttribute("aria-hidden", "true");
  }

  toggle.addEventListener("click", () => {
    if (panel.classList.contains("is-open")) {
      closeMenu();
    } else {
      openMenu();
    }
  });

  closeBtn?.addEventListener("click", closeMenu);
  overlay.addEventListener("click", closeMenu);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && panel.classList.contains("is-open")) {
      closeMenu();
    }
  });

  // About/Privacy/Terms links only carry a URL hash (they all point
  // at index.html), so highlight them by matching the current hash
  // instead of a static "active" class in the markup. When one of
  // them matches, it takes over from the page-level active link
  // (e.g. "Home") so only one item is ever highlighted at a time.
  const pageActiveLink = panel.querySelector("a.active");
  const hashLinks = panel.querySelectorAll("a[data-hash]");

  function highlightHashLinks() {
    const hash = window.location.hash;
    let matched = false;
    hashLinks.forEach((a) => {
      const isMatch = hash !== "" && hash === a.getAttribute("data-hash");
      a.classList.toggle("active", isMatch);
      if (isMatch) matched = true;
    });
    pageActiveLink?.classList.toggle("active", !matched);
  }

  highlightHashLinks();
  window.addEventListener("hashchange", highlightHashLinks);
})();
