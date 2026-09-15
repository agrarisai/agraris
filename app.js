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
// index.html, search.html and category.html.
//
// The row itself is no longer an <a> — a tag needs to be a real,
// crawlable <a href="category.html?..."> too, and nesting an <a>
// inside an <a> gets silently un-nested by the HTML parser (the
// browser closes the outer anchor early, pulling everything after
// the nested one outside of it). Instead, an invisible full-cover
// "stretched link" (.agent-row-link) supplies the card-wide click
// target, while the tags sit above it (z-index) as their own real
// links — event.stopPropagation() on a tag click just keeps that
// click from also reaching the stretched link underneath it. The
// watchlist button sits above it the same way (z-index), but its
// click handling is delegated (see toggleWatchlist's listener below).
function renderAgentRow(agent) {
  const categories = normalizeCategories(agent.category);
  const tags = categories
    .map(
      (c) =>
        `<a class="tag" href="category.html?slug=${encodeURIComponent(c)}" onclick="event.stopPropagation()">${escapeHtml(c)}</a>`
    )
    .join("");

  return `
    <div class="agent-row reveal" data-reveal-stagger>
      <a class="agent-row-link" href="agent.html?id=${encodeURIComponent(agent.id)}" aria-label="${escapeHtml(agent.name)}"></a>
      ${renderWatchlistButton(agent.id)}
      <div class="agent-row-top">
        <span class="agent-name">${escapeHtml(agent.name)}</span>
      </div>
      <div class="agent-meta-row">
        <span class="agent-version">v${escapeHtml(agent.version)}</span>
        ${renderGithubBadgePlaceholder(agent)}
      </div>
      <p class="agent-desc">${escapeHtml(agent.description)}</p>
      <div class="agent-meta">${tags}</div>
    </div>
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

// Fetch every agent whose category array contains an exact match for
// `category` (used by category.html?slug=...). Uses Postgres array
// containment instead of fetchAgents()'s ilike substring match, since
// a category page needs an exact tag match rather than a loose search.
async function fetchAgentsByCategory(category) {
  const { data, error } = await supabaseClient
    .from("agents")
    .select("*")
    .contains("category", [category])
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Gagal mengambil data agent berdasarkan kategori:", error);
    throw error;
  }

  return data || [];
}

// Fetch up to `limit` other agents that share at least one category
// with `categories` (used for the "Similar agents" section on the
// agent detail page). Newest first — simpler than randomizing and
// good enough for a handful of suggestions.
async function fetchSimilarAgents(categories, excludeId, limit = 3) {
  if (!categories || categories.length === 0) return [];

  const { data, error } = await supabaseClient
    .from("agents")
    .select("*")
    .overlaps("category", categories)
    .neq("id", excludeId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("Gagal mengambil agent serupa:", error);
    return [];
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

// Fetch every agent whose id is in the given list, in one round trip
// (used by watchlist.html instead of calling fetchAgentById per id).
async function fetchAgentsByIds(ids) {
  if (!ids || ids.length === 0) return [];

  const { data, error } = await supabaseClient
    .from("agents")
    .select("*")
    .in("id", ids);

  if (error) {
    console.error("Gagal mengambil data watchlist:", error);
    throw error;
  }

  return data || [];
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
// Watchlist (local bookmarks, no login)
// ============================================
//
// Stored as a plain array of agent id strings in localStorage. Every
// access is wrapped in try/catch so a blocked/unavailable
// localStorage (private browsing, browser settings, etc.) just makes
// the watchlist a no-op instead of breaking the page.

const WATCHLIST_STORAGE_KEY = "agraris_watchlist";

function getWatchlist() {
  try {
    const raw = localStorage.getItem(WATCHLIST_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function isInWatchlist(agentId) {
  return getWatchlist().includes(String(agentId));
}

function toggleWatchlist(agentId) {
  const id = String(agentId);

  try {
    const list = getWatchlist();
    const idx = list.indexOf(id);

    if (idx === -1) {
      list.push(id);
    } else {
      list.splice(idx, 1);
    }

    localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(list));
  } catch {
    // localStorage unavailable/blocked — fail silently
  }
}

function renderWatchlistIcon(active) {
  return active
    ? `<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M2 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v13.5a.5.5 0 0 1-.74.44L8 13.06l-5.26 2.88A.5.5 0 0 1 2 15.5V2z"/></svg>`
    : `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="M4 1a1 1 0 0 0-1 1v12.566l4.723-2.482a.5.5 0 0 1 .554 0L13 14.566V2a1 1 0 0 0-1-1H4z"/></svg>`;
}

// Small icon-only button (used on agent-row cards) or a larger
// labeled button (used on the agent detail page). Either way it
// renders the current watchlist state for `agent.id` and is wired up
// by the delegated click handler below.
function renderWatchlistButton(agentId, { variant = "sm" } = {}) {
  const active = isInWatchlist(agentId);
  const label = active ? "In watchlist" : "Add to watchlist";

  if (variant === "lg") {
    return `
      <button type="button" class="btn watchlist-btn-lg${active ? " is-active" : ""}" data-watchlist-btn data-agent-id="${escapeHtml(agentId)}" aria-pressed="${active}">
        ${renderWatchlistIcon(active)}<span class="watchlist-btn-label">${label}</span>
      </button>
    `;
  }

  return `
    <button type="button" class="watchlist-btn${active ? " is-active" : ""}" data-watchlist-btn data-agent-id="${escapeHtml(agentId)}" aria-pressed="${active}" aria-label="${label}" title="${label}">
      ${renderWatchlistIcon(active)}
    </button>
  `;
}

// Delegated click handler so watchlist buttons keep working after any
// page re-renders its list (search filters, sort, etc.) without
// needing to rebind listeners every time.
document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-watchlist-btn]");
  if (!btn) return;

  e.preventDefault();
  e.stopPropagation();

  const agentId = btn.dataset.agentId;
  toggleWatchlist(agentId);
  const active = isInWatchlist(agentId);
  const label = active ? "In watchlist" : "Add to watchlist";

  btn.classList.toggle("is-active", active);
  btn.setAttribute("aria-pressed", String(active));

  const icon = btn.querySelector("svg");
  if (icon) icon.outerHTML = renderWatchlistIcon(active);

  const labelEl = btn.querySelector(".watchlist-btn-label");
  if (labelEl) {
    labelEl.textContent = label;
  } else {
    btn.setAttribute("aria-label", label);
    btn.setAttribute("title", label);
  }
});

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
