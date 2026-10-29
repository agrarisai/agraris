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

// "Most active this week": listings with commits in the last 7 days, most
// commits first (top 5). GitHub activity is filled daily by the "Generate
// feeds" workflow. Hidden when nothing qualifies or the column is missing.
// Code activity only: it does not show usage and is not an endorsement.
async function loadMostActive() {
  const sectionEl = document.getElementById("most-active");
  const listEl = document.getElementById("ma-list");
  if (!sectionEl || !listEl) return;

  try {
    const agents = await fetchAgents();
    const ranked = agents
      .map((agent) => ({ agent, activity: getActivity(agent) }))
      .filter((x) => x.activity && x.activity.c7 > 0)
      .sort((a, b) => b.activity.c7 - a.activity.c7 || a.agent.name.localeCompare(b.agent.name))
      .slice(0, 5);

    if (ranked.length === 0) {
      sectionEl.hidden = true;
      return;
    }

    const max = ranked[0].activity.c7;
    listEl.innerHTML = ranked
      .map(({ agent, activity }, i) => {
        const pct = Math.max(6, Math.round((100 * activity.c7) / max));
        const n = activity.c7;
        return `
          <a class="ma-row reveal" data-reveal-stagger href="agent.html?id=${encodeURIComponent(agent.id)}">
            <span class="ma-rank" aria-hidden="true">${String(i + 1).padStart(2, "0")}</span>
            <span class="ma-name">${escapeHtml(agent.name)}<small>${n}${n >= 100 ? "+" : ""} commit${n === 1 ? "" : "s"} this week</small></span>
            <span class="ma-bar" aria-hidden="true"><b style="width:${pct}%"></b></span>
          </a>`;
      })
      .join("");
    sectionEl.hidden = false;
    observeReveal(listEl);
  } catch {
    sectionEl.hidden = true;
  }
}

// "What's new": newly published listings and builder edits merged into one
// newest-first timeline, grouped Today / This week / Earlier. A listing that
// was both published and edited keeps only its (newer) newest event.
const WN_LIMIT = 8;

function wnAgo(iso) {
  const sec = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  const units = [["w", 604800], ["d", 86400], ["h", 3600], ["m", 60]];
  for (const [u, n] of units) {
    if (sec >= n) return `${Math.floor(sec / n)}${u} ago`;
  }
  return "just now";
}

function wnGroup(iso) {
  const days = (Date.now() - new Date(iso).getTime()) / 86400000;
  if (days < 1) return "Today";
  if (days < 7) return "This week";
  return "Earlier";
}

function renderWnItem(ev) {
  const href = `agent.html?id=${encodeURIComponent(ev.id)}`;
  const kind = ev.kind === "tool" ? '<span class="kind-badge">Tool</span>' : "";
  const badge = ev.type === "new" ? '<span class="wn-new">NEW</span>' : "";
  const tags = (ev.categories || [])
    .slice(0, 2)
    .map((c) => `<span class="tag">${escapeHtml(c)}</span>`)
    .join("");
  const meta =
    ev.type === "updated"
      ? `<div class="wn-updated">↻ Updated ${wnAgo(ev.at)}</div>`
      : `${ev.description ? `<p class="wn-desc">${escapeHtml(ev.description)}</p>` : ""}${tags ? `<div class="wn-tags">${tags}</div>` : ""}`;
  return `
    <a class="wn-item" href="${href}">
      <div class="wn-head"><span class="wn-name">${escapeHtml(ev.name)}</span>${kind}${badge}<span class="wn-time">${wnAgo(ev.at)}</span></div>
      ${meta}
    </a>`;
}

async function loadWhatsNew(published) {
  const listEl = document.getElementById("wn-list");
  const sectionEl = document.getElementById("whats-new");
  if (!listEl || !sectionEl) return;

  const updated = await fetchRecentlyUpdated(WN_LIMIT);
  const byId = new Map();

  published.forEach((a) =>
    byId.set(a.id, {
      id: a.id,
      name: a.name,
      kind: a.kind,
      description: a.description,
      categories: normalizeCategories(a.category),
      type: "new",
      at: a.created_at,
    })
  );
  updated.forEach((u) => {
    const prev = byId.get(u.id);
    const at = u.last_edited_at;
    if (prev && new Date(prev.at) >= new Date(at)) return;
    if (prev) {
      // Edited after publishing: show as one updated event, keep its tags.
      byId.set(u.id, { ...prev, type: "updated", at });
    } else {
      byId.set(u.id, { id: u.id, name: u.name, kind: u.kind, type: "updated", at });
    }
  });

  const events = Array.from(byId.values())
    .filter((ev) => !Number.isNaN(new Date(ev.at).getTime()))
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .slice(0, WN_LIMIT);

  if (events.length === 0) {
    listEl.innerHTML = renderEmptyState(
      "No listings yet",
      "The registry is empty right now — be the first to publish.",
      { href: "publish.html", label: "Publish an agent" }
    );
    listEl.removeAttribute("aria-busy");
    return;
  }

  let html = "";
  let last = "";
  events.forEach((ev) => {
    const group = wnGroup(ev.at);
    if (group !== last) {
      html += `<div class="wn-day">${group}</div>`;
      last = group;
    }
    html += renderWnItem(ev);
  });
  listEl.innerHTML = html;
  listEl.removeAttribute("aria-busy");
}

// Turns a .carousel list into a swipeable strip with progress dots.
function initCarousel(listEl) {
  if (!listEl || listEl.dataset.carousel) return;
  listEl.dataset.carousel = "1";
  const dots = document.createElement("div");
  dots.className = "carousel-dots";
  dots.setAttribute("aria-hidden", "true");
  listEl.insertAdjacentElement("afterend", dots);
  const update = () => {
    const cards = Array.from(listEl.querySelectorAll(".agent-row"));
    if (cards.length < 2) { dots.innerHTML = ""; return; }
    const max = listEl.scrollWidth - listEl.clientWidth;
    const idx = max <= 4 ? 0 : Math.round((listEl.scrollLeft / max) * (cards.length - 1));
    dots.innerHTML = cards.map((_, i) => `<i${i === idx ? ' class="on"' : ""}></i>`).join("");
  };
  listEl.addEventListener("scroll", () => requestAnimationFrame(update), { passive: true });
  new MutationObserver(update).observe(listEl, { childList: true });
  window.addEventListener("resize", update);
  update();
}

(async function () {
  const listEl = document.getElementById("wn-list");
  initCarousel(document.getElementById("trending-list"));
  enableCompareSelection();

  try {
    // totalCount is the number of AGENTS (tools are not counted in it); a
    // failed tool count becomes null and only leaves the stats bar at "—".
    const [published, totalCount, toolCount] = await Promise.all([
      fetchAgents({ limit: WN_LIMIT }),
      fetchAgentCount(),
      fetchAgentCount({ kind: "tool" }).catch(() => null),
    ]);

    loadStatsBar(totalCount, toolCount);
    loadTrending();
    loadMostActive();
    await loadWhatsNew(published);
  } catch (err) {
    if (listEl) {
      listEl.innerHTML = renderEmptyState(
        "Couldn't load listings",
        "Check your connection and try again."
      );
      listEl.removeAttribute("aria-busy");
    }
  }
})();
