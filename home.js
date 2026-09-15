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
