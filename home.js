// ============================================
// Agraris — home page logic
// ============================================

// Populates the small stats bar under the hero (total agents, unique
// categories, total GitHub stars). The agent count is passed in since
// it's already been fetched for the "Recently published" heading;
// categories and stars need a lightweight fetch of every agent's
// category/repo_url. Star totals fill in incrementally as each
// GitHub API call resolves, reusing the same cache as the agent
// list's GitHub badges.
async function loadStatsBar(agentCount) {
  const agentsEl = document.getElementById("stat-agents");
  const categoriesEl = document.getElementById("stat-categories");
  const starsEl = document.getElementById("stat-stars");

  if (agentsEl) {
    agentsEl.textContent = agentCount.toLocaleString("en-US");
  }

  let liteAgents;
  try {
    liteAgents = await fetchAgentsLite();
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
    const repos = liteAgents
      .map((agent) => parseGithubRepo(agent.repo_url))
      .filter(Boolean);

    if (repos.length === 0) {
      starsEl.textContent = "0";
      return;
    }

    let totalStars = 0;
    let gotAny = false;

    await Promise.all(
      repos.map(async ({ owner, repo }) => {
        try {
          const data = await fetchGithubRepoInfo(owner, repo);
          if (typeof data.stars === "number") {
            totalStars += data.stars;
            gotAny = true;
            starsEl.textContent = totalStars.toLocaleString("en-US");
          }
        } catch {
          // network error, rate limit, 404 — skip this repo's stars
        }
      })
    );

    if (!gotAny) {
      starsEl.textContent = "0";
    }
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

// Populates the "Trending" section: fetches every agent, resolves each
// one's GitHub star count (reusing the same cached GitHub fetch used for
// the agent-row badges), sorts by stars descending, and renders the top 3
// using the .agent-row card style with a ranking badge.
//
// An agent whose stars fail to resolve (no repo_url, network error, GitHub
// rate limit, ...) must never outrank one whose star count is known — so
// resolved and unresolved agents are ranked as two separate groups instead
// of treating "unresolved" and "confirmed 0 stars" as the same value. That
// distinction matters because fetchGithubRepoInfo() is called for every agent
// on every page load: once the number of agents exceeds GitHub's unauthenticated
// rate limit (60 req/hour/IP), most/all of those calls fail together, which
// would otherwise make every agent tie at a fallback of 0 and fall back to
// insertion order (newest-created first) instead of an unknown-stars agent
// simply sorting to the bottom.
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

    const starsById = new Map();

    await Promise.all(
      agents.map(async (agent) => {
        const parsed = parseGithubRepo(agent.repo_url);
        if (!parsed) return; // no repo — leave unresolved

        try {
          const data = await fetchGithubRepoInfo(parsed.owner, parsed.repo);
          if (typeof data.stars === "number") {
            starsById.set(agent.id, data.stars);
          }
        } catch {
          // network error, rate limit, 404 — leave unresolved rather than
          // assuming 0, so it can't tie with (and lose to) another agent
          // that also failed to resolve but happens to be newer
        }
      })
    );

    const resolved = agents
      .filter((agent) => starsById.has(agent.id))
      .sort((a, b) => starsById.get(b.id) - starsById.get(a.id));
    const unresolved = agents.filter((agent) => !starsById.has(agent.id));

    const topAgents = [...resolved, ...unresolved].slice(0, TRENDING_COUNT);

    listEl.innerHTML = topAgents
      .map((agent, i) => renderTrendingCard(agent, i + 1))
      .join("");
    observeReveal(listEl);
    loadGithubBadges(topAgents, listEl);
  } catch (err) {
    sectionEl.hidden = true;
  } finally {
    listEl.removeAttribute("aria-busy");
  }
}

(async function () {
  const listEl = document.getElementById("agent-list");
  const countEl = document.getElementById("agent-count");

  const RECENT_LIMIT = 4;

  try {
    const [agents, totalCount] = await Promise.all([
      fetchAgents({ limit: RECENT_LIMIT }),
      fetchAgentCount(),
    ]);

    countEl.textContent = totalCount
      ? `${totalCount} agent${totalCount === 1 ? "" : "s"}`
      : "";

    loadStatsBar(totalCount);
    loadTrending();

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
    loadGithubBadges(agents, listEl);
  } catch (err) {
    listEl.innerHTML = renderEmptyState(
      "Couldn't load agents",
      "Check your Supabase connection and try again."
    );
  } finally {
    listEl.removeAttribute("aria-busy");
  }
})();
