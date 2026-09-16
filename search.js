// ============================================
// Agraris — search page logic
// ============================================

(async function () {
  const listEl = document.getElementById("agent-list");
  const countEl = document.getElementById("agent-count");
  const searchInput = document.getElementById("search-input");
  const sortInput = document.getElementById("sort-input");
  const verifiedFilterInput = document.getElementById("verified-filter-input");
  const categoryChipsEl = document.getElementById("category-chips");

  let allAgents = [];
  let debounceTimer = null;
  const activeCategories = new Set();

  function populateCategoryChips(agents) {
    const seen = new Set();
    agents.forEach((a) => {
      normalizeCategories(a.category).forEach((c) => seen.add(c));
    });
    const sorted = Array.from(seen).sort((a, b) => a.localeCompare(b));

    categoryChipsEl.innerHTML = sorted
      .map(
        (c) =>
          `<button type="button" class="category-chip" data-category="${escapeHtml(c)}" aria-pressed="false">${escapeHtml(c)}</button>`
      )
      .join("");
  }

  // Reads whatever GitHub star count is already cached in sessionStorage
  // (populated by loadGithubBadges as agent cards are rendered) without
  // triggering a new network fetch. Returns null if not known yet.
  function getCachedStars(agent) {
    const parsed = parseGithubRepo(agent.repo_url);
    if (!parsed) return null;

    try {
      const cached = sessionStorage.getItem(
        `agraris:gh:${parsed.owner}/${parsed.repo}`
      );
      if (!cached) return null;

      const entry = JSON.parse(cached);
      if (Date.now() - entry.fetchedAt >= GITHUB_CACHE_TTL_MS) return null;

      const stars = entry?.data?.stars;
      return typeof stars === "number" ? stars : null;
    } catch {
      return null;
    }
  }

  function sortAgents(agents) {
    const sorted = agents.slice();

    switch (sortInput.value) {
      case "oldest":
        sorted.sort(
          (a, b) => new Date(a.created_at) - new Date(b.created_at)
        );
        break;
      case "name-asc":
        sorted.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case "name-desc":
        sorted.sort((a, b) => b.name.localeCompare(a.name));
        break;
      case "stars":
        // Agents whose star count is already known sort by stars
        // (descending); agents still waiting on GitHub data stay below
        // them, in their existing order.
        sorted.sort((a, b) => {
          const av = getCachedStars(a);
          const bv = getCachedStars(b);
          if (av === null && bv === null) return 0;
          if (av === null) return 1;
          if (bv === null) return -1;
          return bv - av;
        });
        break;
      case "newest":
      default:
        sorted.sort(
          (a, b) => new Date(b.created_at) - new Date(a.created_at)
        );
        break;
    }

    return sorted;
  }

  function applyFilters() {
    const search = searchInput.value.trim().toLowerCase();

    const filtered = allAgents.filter((a) => {
      const matchesSearch =
        !search ||
        a.name.toLowerCase().includes(search) ||
        a.description.toLowerCase().includes(search);

      const matchesCategory =
        activeCategories.size === 0 ||
        normalizeCategories(a.category).some((c) => activeCategories.has(c));

      const matchesVerified = !verifiedFilterInput.checked || a.verified === true;

      return matchesSearch && matchesCategory && matchesVerified;
    });

    renderResults(sortAgents(filtered));
  }

  function renderResults(agents) {
    countEl.textContent = agents.length
      ? `${agents.length} result${agents.length === 1 ? "" : "s"}`
      : "";

    if (agents.length === 0) {
      listEl.innerHTML = renderEmptyState(
        "No agents match your search",
        "Try a different keyword, or clear a category filter to see more results."
      );
      return;
    }

    listEl.innerHTML = agents.map(renderAgentRow).join("");
    observeReveal(listEl);
    loadGithubBadges(agents, listEl);
  }

  try {
    allAgents = await fetchAgents();
    populateCategoryChips(allAgents);

    const initialQuery = new URLSearchParams(window.location.search).get("q");
    if (initialQuery) {
      searchInput.value = initialQuery;
      applyFilters();
    } else {
      renderResults(sortAgents(allAgents));
    }
  } catch (err) {
    listEl.innerHTML = renderEmptyState(
      "Couldn't load agents",
      "Check your Supabase connection and try again."
    );
  } finally {
    listEl.removeAttribute("aria-busy");
  }

  searchInput.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(applyFilters, 200);
  });

  sortInput.addEventListener("change", applyFilters);

  verifiedFilterInput.addEventListener("change", applyFilters);

  categoryChipsEl.addEventListener("click", (e) => {
    const chip = e.target.closest(".category-chip");
    if (!chip) return;

    const category = chip.dataset.category;
    if (activeCategories.has(category)) {
      activeCategories.delete(category);
      chip.classList.remove("is-active");
      chip.setAttribute("aria-pressed", "false");
    } else {
      activeCategories.add(category);
      chip.classList.add("is-active");
      chip.setAttribute("aria-pressed", "true");
    }

    applyFilters();
  });
})();
