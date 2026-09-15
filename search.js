// ============================================
// Agraris — search page logic
// ============================================

(async function () {
  const listEl = document.getElementById("agent-list");
  const countEl = document.getElementById("agent-count");
  const searchInput = document.getElementById("search-input");
  const categoryInput = document.getElementById("category-input");

  let allAgents = [];
  let debounceTimer = null;

  function populateCategoryOptions(agents) {
    const seen = new Set();
    agents.forEach((a) => {
      normalizeCategories(a.category).forEach((c) => seen.add(c));
    });
    const sorted = Array.from(seen).sort((a, b) => a.localeCompare(b));
    sorted.forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c;
      opt.textContent = c;
      categoryInput.appendChild(opt);
    });
  }

  function applyFilters() {
    const search = searchInput.value.trim().toLowerCase();
    const category = categoryInput.value;

    const filtered = allAgents.filter((a) => {
      const matchesSearch =
        !search ||
        a.name.toLowerCase().includes(search) ||
        a.description.toLowerCase().includes(search);

      const matchesCategory =
        !category || normalizeCategories(a.category).includes(category);

      return matchesSearch && matchesCategory;
    });

    renderResults(filtered);
  }

  function renderResults(agents) {
    countEl.textContent = agents.length
      ? `${agents.length} result${agents.length === 1 ? "" : "s"}`
      : "";

    if (agents.length === 0) {
      listEl.innerHTML = renderEmptyState(
        "No agents match your search",
        "Try a different keyword, or clear the category filter to see more results."
      );
      return;
    }

    listEl.innerHTML = agents.map(renderAgentRow).join("");
    observeReveal(listEl);
  }

  try {
    allAgents = await fetchAgents();
    populateCategoryOptions(allAgents);
    renderResults(allAgents);
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

  categoryInput.addEventListener("change", applyFilters);
})();
