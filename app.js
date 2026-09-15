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
    <a class="agent-row reveal" data-reveal-stagger href="agent.html?id=${encodeURIComponent(agent.id)}">
      <div class="agent-row-top">
        <span class="agent-name">${escapeHtml(agent.name)}</span>
      </div>
      <div class="agent-meta-row">
        <span class="agent-version">v${escapeHtml(agent.version)}</span>
        ${renderGithubBadgePlaceholder(agent)}
      </div>
      <p class="agent-desc">${escapeHtml(agent.description)}</p>
      <div class="agent-meta">${tags}</div>
    </a>
  `;
}

function renderEmptyState(title, body, cta = null) {
  const ctaClass = cta?.variant === "outline" ? "btn" : "btn btn-solid";
  const ctaHtml = cta
    ? `<a class="${ctaClass} empty-state-cta" href="${escapeHtml(cta.href)}">${escapeHtml(cta.label)}</a>`
    : "";

  return `
    <div class="empty-state">
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(body)}</span>
      ${ctaHtml}
    </div>
  `;
}

// Fetch agents from Supabase, newest first.
async function fetchAgents({ search = "", category = "", limit = null } = {}) {
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

  if (limit) {
    query = query.limit(limit);
  }

  const { data, error } = await query;

  if (error) {
    console.error("Gagal mengambil data agent:", error);
    throw error;
  }

  return data || [];
}

// Fetch the total number of agents in the registry without
// downloading any rows.
async function fetchAgentCount() {
  const { count, error } = await supabaseClient
    .from("agents")
    .select("*", { count: "exact", head: true });

  if (error) {
    console.error("Gagal mengambil jumlah agent:", error);
    throw error;
  }

  return count || 0;
}

// Fetch just the columns needed for registry-wide stats (unique
// categories, total GitHub stars) — lighter than fetchAgents() since it
// skips description/version/etc for every row.
async function fetchAgentsLite() {
  const { data, error } = await supabaseClient
    .from("agents")
    .select("id, category, repo_url");

  if (error) {
    console.error("Gagal mengambil data ringkas agent:", error);
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
// GitHub stats (stars + last updated) — best effort
// ============================================
//
// Pulled from the public, unauthenticated GitHub API
// (60 req/hour/IP), so results are cached in sessionStorage for an
// hour and only fetched for agents actually rendered on the page.
// Any failure (bad URL, network error, rate limit) just leaves the
// badge hidden — it never blocks or breaks the rest of the card.

const GITHUB_CACHE_TTL_MS = 60 * 60 * 1000;

function parseGithubRepo(repoUrl) {
  if (typeof repoUrl !== "string") return null;
  try {
    const url = new URL(repoUrl);
    if (!/(^|\.)github\.com$/i.test(url.hostname)) return null;
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    const owner = parts[0];
    const repo = parts[1].replace(/\.git$/i, "");
    if (!owner || !repo) return null;
    return { owner, repo };
  } catch {
    return null;
  }
}

function formatRelativeTime(isoString) {
  const then = new Date(isoString).getTime();
  if (Number.isNaN(then)) return "";

  const diffSec = Math.round((Date.now() - then) / 1000);
  const units = [
    ["year", 60 * 60 * 24 * 365],
    ["month", 60 * 60 * 24 * 30],
    ["week", 60 * 60 * 24 * 7],
    ["day", 60 * 60 * 24],
    ["hour", 60 * 60],
    ["minute", 60],
  ];

  for (const [unit, secInUnit] of units) {
    const value = Math.floor(diffSec / secInUnit);
    if (value >= 1) {
      return `Updated ${value} ${unit}${value === 1 ? "" : "s"} ago`;
    }
  }
  return "Updated just now";
}

async function fetchGithubRepoInfo(owner, repo) {
  const cacheKey = `agraris:gh:${owner}/${repo}`;

  try {
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Date.now() - parsed.fetchedAt < GITHUB_CACHE_TTL_MS) {
        return parsed.data;
      }
    }
  } catch {
    // corrupt/inaccessible sessionStorage — fall through to a fetch
  }

  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`);
  if (!res.ok) throw new Error(`GitHub API responded ${res.status}`);
  const json = await res.json();

  const data = {
    stars: json.stargazers_count,
    pushedAt: json.pushed_at,
  };

  try {
    sessionStorage.setItem(
      cacheKey,
      JSON.stringify({ fetchedAt: Date.now(), data })
    );
  } catch {
    // storage full/unavailable — caching is only a nice-to-have
  }

  return data;
}

// Empty, hidden placeholder emitted at render time so the badge has
// somewhere to land once (if) its GitHub data comes back.
function renderGithubBadgePlaceholder(agent) {
  return `<span class="github-badge" data-github-badge data-agent-id="${escapeHtml(agent.id)}" hidden></span>`;
}

function renderGithubBadgeContent(data) {
  if (!data || typeof data.stars !== "number") return "";
  const relative = data.pushedAt ? formatRelativeTime(data.pushedAt) : "";

  return `
    <span class="github-stat" title="GitHub stars">
      <svg class="github-star-icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.75.75 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25z"/></svg>${data.stars.toLocaleString("en-US")}
    </span>${relative ? `<span class="github-updated">${escapeHtml(relative)}</span>` : ""}
  `;
}

// Fetches GitHub stats for exactly the agents passed in (i.e. only
// what's currently on screen), in parallel, and fills in the badge
// placeholders rendered by renderAgentRow / agent.js. Silently
// leaves a badge hidden on any failure.
function loadGithubBadges(agents, root = document) {
  const tasks = agents.map(async (agent) => {
    const parsed = parseGithubRepo(agent.repo_url);
    if (!parsed) return;

    try {
      const data = await fetchGithubRepoInfo(parsed.owner, parsed.repo);
      const html = renderGithubBadgeContent(data);
      if (!html) return;

      const el = root.querySelector(
        `[data-github-badge][data-agent-id="${CSS.escape(String(agent.id))}"]`
      );
      if (!el) return;

      el.innerHTML = html;
      el.hidden = false;
    } catch {
      // network error, rate limit, 404 — leave the badge hidden
    }
  });

  return Promise.all(tasks);
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
