// ============================================
// Agraris — home page logic
// ============================================

// Populates the small stats bar under the hero (agents, tools, unique
// categories, total GitHub stars). The agent and tool counts are passed
// in since they've already been fetched for the "Recently published"
// heading; a tool count of null (its fetch failed) leaves "—". Categories
// and stars cover every approved listing, agents and tools alike, and
// need a lightweight fetch of each listing's category/github_stars. Stars are populated daily by GitHub Actions
// (see scripts/update-github-stats.js), so this is just a sum over
// already-fetched data — no GitHub API calls happen here.
async function loadStatsBar(agentCount, toolCount) {
  const agentsEl = document.getElementById("stat-agents");
  const toolsEl = document.getElementById("stat-tools");
  const categoriesEl = document.getElementById("stat-categories");
  const starsEl = document.getElementById("stat-stars");

  if (agentsEl) {
    agentsEl.textContent = agentCount.toLocaleString("en-US");
  }

  if (toolsEl && typeof toolCount === "number") {
    toolsEl.textContent = toolCount.toLocaleString("en-US");
  }

  let liteAgents;
  try {
    liteAgents = await fetchAgentsLite({ kind: null });
  } catch {
    return; // leave categories/stars as "—"
  }

  if (categoriesEl) {
    const categories = new Set();
    liteAgents.forEach((agent) => {
      normalizeCategories(agent.category).forEach((c) => categories.add(c));
    });
    categoriesEl.textContent = categories.size.toLocaleString("en-US");
  }

  if (starsEl) {
    const totalStars = liteAgents.reduce(
      (sum, agent) =>
        typeof agent.github_stars === "number" ? sum + agent.github_stars : sum,
      0
    );
    starsEl.textContent = totalStars.toLocaleString("en-US");
  }
}

// Renders one "Trending" card — same shape/markup as renderAgentRow()
// (and reuses its .agent-row styling) plus a small "#1"/"#2"/"#3"
// ranking badge pinned to the card's top-right corner.
function renderTrendingCard(agent, rank) {
  const categories = normalizeCategories(agent.category);
  const tags = categories
    .map(
      (c) =>
        `<a class="tag" href="category.html?slug=${encodeURIComponent(c)}" onclick="event.stopPropagation()">${escapeHtml(c)}</a>`
    )
    .join("");

  return `
    <div class="agent-row trending-card reveal" data-reveal-stagger>
      <span class="trending-rank" aria-hidden="true">#${rank}</span>
      <a class="agent-row-link" href="agent.html?id=${encodeURIComponent(agent.id)}" aria-label="${escapeHtml(agent.name)}"></a>
      ${renderWatchlistButton(agent.id)}
      <div class="agent-row-top">
        <span class="agent-name">${escapeHtml(agent.name)}</span>
        ${renderKindBadge(agent)}
        ${renderVerifiedBadge(agent)}
      </div>
      <div class="agent-meta-row">
        <span class="agent-version">v${escapeHtml(agent.version)}</span>
        ${renderGithubBadge(agent)}
      </div>
      <p class="agent-desc">${escapeHtml(agent.description)}</p>
      <div class="agent-meta">${tags}</div>
    </div>
  `;
}

// Populates the "Trending" section: sorts agents by GitHub stars
// (descending) and renders the top 3 using the .agent-row card style
// with a ranking badge. github_stars comes back as part of
// fetchAgents() itself — populated daily by GitHub Actions (see
// scripts/update-github-stats.js) — so no extra fetch is needed here.
//
// An agent whose github_stars is still null (not yet processed by the
// daily job) must never outrank one whose star count is known, so it
// always sorts to the bottom rather than tying at 0.
async function loadTrending() {
  const sectionEl = document.getElementById("trending-section");
  const listEl = document.getElementById("trending-list");
  if (!sectionEl || !listEl) return;

  const TRENDING_COUNT = 3;

  try {
    const agents = await fetchAgents();

    if (agents.length === 0) {
      sectionEl.hidden = true;
      return;
    }

    const sorted = agents.slice().sort((a, b) => {
      const av = typeof a.github_stars === "number" ? a.github_stars : null;
      const bv = typeof b.github_stars === "number" ? b.github_stars : null;
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return bv - av;
    });

    const topAgents = sorted.slice(0, TRENDING_COUNT);

    listEl.innerHTML = topAgents
      .map((agent, i) => renderTrendingCard(agent, i + 1))
      .join("");
    observeReveal(listEl);
  } catch (err) {
    sectionEl.hidden = true;
  } finally {
    listEl.removeAttribute("aria-busy");
  }
}

// Populates the small "Recently updated" section: listings whose builder
// edited them in the last 30 days (fetchRecentlyUpdated in app.js). The
// section stays hidden when there is nothing to show or the call fails.
// Built with the DOM, so names never go through innerHTML.
async function loadRecentlyUpdated() {
  const sectionEl = document.getElementById("recent-updates-section");
  const listEl = document.getElementById("recent-updates-list");
  if (!sectionEl || !listEl) return;

  const RECENT_UPDATES_COUNT = 5;
  const rows = (await fetchRecentlyUpdated(RECENT_UPDATES_COUNT)).slice(0, RECENT_UPDATES_COUNT);

  listEl.textContent = "";
  rows.forEach((row) => {
    const when = formatRelativeTime(row.last_edited_at);
    if (!when) return;

    const item = document.createElement("li");
    item.className = "recent-update-row";

    const link = document.createElement("a");
    link.className = "recent-update-link";
    link.href = `agent.html?id=${encodeURIComponent(row.id)}`;

    const name = document.createElement("span");
    name.className = "recent-update-name";
    name.textContent = row.name;

    const kind = document.createElement("span");
    kind.className = "kind-badge";
    kind.textContent = row.kind === "tool" ? "Tool" : "Agent";

    link.append(name, " ", kind);

    const time = document.createElement("span");
    time.className = "recent-update-time";
    time.textContent = when;

    item.append(link, time);
    listEl.appendChild(item);
  });

  sectionEl.hidden = listEl.children.length === 0;
}

(async function () {
  const listEl = document.getElementById("agent-list");
  const countEl = document.getElementById("agent-count");

  const RECENT_LIMIT = 4;

  enableCompareSelection();

  try {
    // totalCount is the number of AGENTS (tools are not counted in it).
    // The tool count only decorates the heading and the stats bar, and
    // must never take the list down with it, so a failed count becomes
    // null: the heading leaves tools out and the stats bar keeps "—".
    const [agents, totalCount, toolCount] = await Promise.all([
      fetchAgents({ limit: RECENT_LIMIT }),
      fetchAgentCount(),
      fetchAgentCount({ kind: "tool" }).catch(() => null),
    ]);

    const countParts = [];
    if (totalCount) countParts.push(`${totalCount} agent${totalCount === 1 ? "" : "s"}`);
    if (toolCount) countParts.push(`${toolCount} tool${toolCount === 1 ? "" : "s"}`);
    countEl.textContent = countParts.join(" · ");

    loadStatsBar(totalCount, toolCount);
    loadTrending();
    loadRecentlyUpdated();

    if (agents.length === 0) {
      listEl.innerHTML = renderEmptyState(
        "No agents published yet",
        "The registry is empty right now — be the first to publish an agent and put it in front of builders on Robinhood Chain.",
        { href: "publish.html", label: "Publish an agent" }
      );
      return;
    }

    listEl.innerHTML = agents.map(renderAgentRow).join("");
    observeReveal(listEl);
  } catch (err) {
    listEl.innerHTML = renderEmptyState(
      "Couldn't load agents",
      "Check your Supabase connection and try again."
    );
  } finally {
    listEl.removeAttribute("aria-busy");
  }
})();
