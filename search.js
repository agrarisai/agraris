// ============================================
// Agraris — search page logic
// ============================================

(async function () {
  const listEl = document.getElementById("agent-list");
  const countEl = document.getElementById("agent-count");
  const searchInput = document.getElementById("search-input");
  const sortInput = document.getElementById("sort-input");
  const verifiedFilterInput = document.getElementById("verified-filter-input");
  const liveFilterInput = document.getElementById("live-filter-input");
  const categoryChipsEl = document.getElementById("category-chips");
  const kindTabsEl = document.getElementById("kind-tabs");

  let allAgents = [];
  let debounceTimer = null;
  const activeCategories = new Set();

  // "" = All, otherwise "agent" or "tool". Comes from ?kind= so a filtered
  // view can be shared; anything else in the URL means All.
  const KINDS = ["agent", "tool"];
  function readKindFromUrl() {
    const value = new URLSearchParams(window.location.search).get("kind");
    return KINDS.includes(value) ? value : "";
  }
  let activeKind = readKindFromUrl();

  enableCompareSelection();

  // Everything that follows works on the listings of the active kind. An
  // "agent" is anything that is not a tool, same rule as isTool() in app.js.
  function listingsForKind() {
    if (!activeKind) return allAgents;
    return allAgents.filter((a) => isTool(a) === (activeKind === "tool"));
  }

  function syncKindTabs() {
    kindTabsEl.querySelectorAll(".kind-tab").forEach((btn) => {
      const on = btn.dataset.kind === activeKind;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-pressed", String(on));
    });
  }

  // Keep the address bar in step with the tab (without piling up history
  // entries), so copying the URL shares the filtered view.
  function writeKindToUrl() {
    const url = new URL(window.location.href);
    if (activeKind) url.searchParams.set("kind", activeKind);
    else url.searchParams.delete("kind");
    history.replaceState(history.state, "", url);
    syncNavActive();
  }

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
        // Agents whose star count is known sort by stars (descending);
        // agents the daily GitHub Actions job hasn't processed yet
        // (github_stars is null) stay below them, in their existing
        // order.
        sorted.sort((a, b) => {
          const av = typeof a.github_stars === "number" ? a.github_stars : null;
          const bv = typeof b.github_stars === "number" ? b.github_stars : null;
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

    const filtered = listingsForKind().filter((a) => {
      const matchesSearch =
        !search ||
        a.name.toLowerCase().includes(search) ||
        a.description.toLowerCase().includes(search);

      const matchesCategory =
        activeCategories.size === 0 ||
        normalizeCategories(a.category).some((c) => activeCategories.has(c));

      const matchesVerified = !verifiedFilterInput.checked || a.verified === true;

      // Same rule as the badge: a demo_url whose last live check said 'up'.
      const matchesLive = !liveFilterInput.checked || liveCheckInfo(a)?.state === "up";

      return matchesSearch && matchesCategory && matchesVerified && matchesLive;
    });

    renderResults(sortAgents(filtered));
  }

  function renderResults(agents) {
    countEl.textContent = agents.length
      ? `${agents.length} result${agents.length === 1 ? "" : "s"}`
      : "";

    if (agents.length === 0) {
      listEl.innerHTML = renderEmptyState(
        activeKind === "tool" ? "No tools match your search" : "No agents match your search",
        "Try a different keyword, or clear a category filter to see more results."
      );
      return;
    }

    listEl.innerHTML = agents.map(renderAgentRow).join("");
    observeReveal(listEl);
  }

  try {
    allAgents = await fetchAgents();
    syncKindTabs();
    populateCategoryChips(listingsForKind());

    const initialQuery = new URLSearchParams(window.location.search).get("q");
    if (initialQuery) searchInput.value = initialQuery;
    applyFilters();
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

  liveFilterInput.addEventListener("change", applyFilters);

  kindTabsEl.addEventListener("click", (e) => {
    const tab = e.target.closest(".kind-tab");
    if (!tab || tab.dataset.kind === activeKind) return;

    activeKind = tab.dataset.kind;
    syncKindTabs();
    writeKindToUrl();

    // The category chips follow the tab: tags that no listing of this
    // kind uses disappear, and a selected tag that vanished is dropped so
    // it can't silently filter everything out.
    populateCategoryChips(listingsForKind());
    const stillThere = new Set(
      Array.from(categoryChipsEl.querySelectorAll(".category-chip")).map((c) => c.dataset.category)
    );
    [...activeCategories].forEach((c) => {
      if (!stillThere.has(c)) activeCategories.delete(c);
    });
    categoryChipsEl.querySelectorAll(".category-chip").forEach((chip) => {
      if (activeCategories.has(chip.dataset.category)) {
        chip.classList.add("is-active");
        chip.setAttribute("aria-pressed", "true");
      }
    });

    applyFilters();
  });

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
