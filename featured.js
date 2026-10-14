// ============================================
// Agraris — "Agent of the week"
// ============================================
//
// Used on two pages:
//   index.html    — #featured-section: this week's pick, above the
//                   registry list. Stays hidden when there is no pick for
//                   the current week or the query fails.
//   featured.html — #featured-archive: every pick, newest week first.
//
// Picks live in public.featured_agents (supabase/migration-featured.sql)
// and are written only by the "Feature agent" GitHub Action. The agent is
// read with an inner embed, agents!inner(...), using the publishable key,
// so the agents table's own RLS still applies: an agent that isn't
// approved is never returned, and a pick pointing at one is dropped.
//
// Load after app.js (escapeHtml, normalizeCategories) and onchain.js
// (renderOnchainBlock, initCopyAddressButton, loadOnchainActivity).

const FEATURED_COLUMNS =
  "week_start, note, agents!inner(id, name, description, category, version, contract_address)";
const FEATURED_ARCHIVE_LIMIT = 200;

// Monday of the current ISO week in UTC, as YYYY-MM-DD (same rule as
// scripts/feature-agent.js).
function currentWeekStartUtc(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const isoDay = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - (isoDay - 1));
  return d.toISOString().slice(0, 10);
}

// "2026-10-12" -> "Week of Oct 12, 2026"
function formatWeekLabel(weekStart) {
  const d = new Date(`${weekStart}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  return `Week of ${d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  })}`;
}

// The embed comes back as an object; be lenient about an array too.
function featuredAgentOf(row) {
  const a = Array.isArray(row?.agents) ? row.agents[0] : row?.agents;
  return a && a.id ? a : null;
}

function renderFeaturedTags(agent) {
  return normalizeCategories(agent.category)
    .map(
      (c) =>
        `<a class="tag" href="category.html?slug=${encodeURIComponent(c)}">${escapeHtml(c)}</a>`
    )
    .join("");
}

function renderFeaturedNote(row) {
  const note = typeof row.note === "string" ? row.note.trim() : "";
  if (!note) return "";
  return `<p class="featured-note"><span class="featured-note-label">Note</span>${escapeHtml(note)}</p>`;
}

// One pick as a card. `withOnchain` adds the shared on-chain block
// (index.html only; the archive stays a light list).
function renderFeaturedCard(row, { withOnchain = false, headingTag = "h3" } = {}) {
  const agent = featuredAgentOf(row);
  if (!agent) return "";
  const href = `agent.html?id=${encodeURIComponent(agent.id)}`;
  const tags = renderFeaturedTags(agent);

  return `
    <article class="featured-card reveal">
      <p class="featured-week">${escapeHtml(formatWeekLabel(row.week_start))}</p>
      <${headingTag} class="featured-name"><a href="${href}">${escapeHtml(agent.name)}</a></${headingTag}>
      <p class="featured-version">v${escapeHtml(agent.version)}</p>
      <p class="featured-desc">${escapeHtml(agent.description)}</p>
      ${tags ? `<div class="agent-meta">${tags}</div>` : ""}
      ${renderFeaturedNote(row)}
      ${withOnchain ? renderOnchainBlock(agent) : ""}
      <div class="featured-actions">
        <a class="btn btn-solid" href="${href}">View agent</a>
        ${withOnchain ? '<a class="btn" href="featured.html">Past picks</a>' : ""}
      </div>
    </article>
  `;
}

// ---------- index.html: this week's pick ----------

async function loadFeaturedSection() {
  const section = document.getElementById("featured-section");
  const body = document.getElementById("featured-body");
  if (!section || !body) return;

  try {
    const { data, error } = await supabaseClient
      .from("featured_agents")
      .select(FEATURED_COLUMNS)
      .eq("week_start", currentWeekStartUtc())
      .maybeSingle();
    if (error) throw error;
    if (!data || !featuredAgentOf(data)) return; // no pick this week — stay hidden

    body.innerHTML = renderFeaturedCard(data, { withOnchain: true });
    section.hidden = false;
    observeReveal(section);
    initCopyAddressButton(body);
    loadOnchainActivity(body);
  } catch (err) {
    // Table missing, network error, etc. — the section simply stays hidden.
    console.error("Gagal mengambil agent of the week:", err && err.message ? err.message : err);
  }
}

// ---------- featured.html: archive ----------

async function loadFeaturedArchive() {
  const list = document.getElementById("featured-archive");
  if (!list) return;

  try {
    const { data, error } = await supabaseClient
      .from("featured_agents")
      .select(FEATURED_COLUMNS)
      .order("week_start", { ascending: false })
      .limit(FEATURED_ARCHIVE_LIMIT);
    if (error) throw error;

    const rows = (data || []).filter(featuredAgentOf);
    list.innerHTML =
      rows.length > 0
        ? rows.map((row) => renderFeaturedCard(row, { headingTag: "h2" })).join("")
        : renderEmptyState("No picks yet", "Check back soon for the first Agent of the week.");
  } catch (err) {
    console.error("Gagal mengambil arsip agent of the week:", err && err.message ? err.message : err);
    list.innerHTML = renderEmptyState("Could not load picks", "Please try again later.");
  } finally {
    list.removeAttribute("aria-busy");
    observeReveal(list);
  }
}

loadFeaturedSection();
loadFeaturedArchive();
