// ============================================
// Agraris — category page logic
// ============================================

// "developer-tools" -> "Developer tools"
function formatCategoryLabel(slug) {
  const words = slug.replace(/-/g, " ").trim();
  if (!words) return "";
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

function setMetaDescription(content) {
  let meta = document.querySelector('meta[name="description"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute("name", "description");
    document.head.appendChild(meta);
  }
  meta.setAttribute("content", content);
}

function setMetaProperty(property, content) {
  let meta = document.querySelector(`meta[property="${property}"]`);
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute("property", property);
    document.head.appendChild(meta);
  }
  meta.setAttribute("content", content);
}

(async function () {
  const headingEl = document.getElementById("category-heading");
  const countEl = document.getElementById("agent-count");
  const listEl = document.getElementById("agent-list");

  const params = new URLSearchParams(window.location.search);
  const slug = (params.get("slug") || "").trim();
  const label = formatCategoryLabel(slug);

  if (!slug) {
    document.title = "Category — Agraris";
    setMetaDescription(
      "Browse AI agents by category in the Agraris registry for Robinhood Chain."
    );
    setMetaProperty("og:title", "Category — Agraris");
    setMetaProperty(
      "og:description",
      "Browse AI agents by category in the Agraris registry for Robinhood Chain."
    );
    headingEl.textContent = "Category not found";
    countEl.textContent = "";
    listEl.removeAttribute("aria-busy");
    listEl.innerHTML = renderEmptyState(
      "No category specified",
      "Pick a category from an agent's tags, or browse the full registry.",
      { href: "search.html", label: "Browse all agents", variant: "outline" }
    );
    return;
  }

  document.title = `${label} agents — Agraris`;
  setMetaProperty("og:title", `${label} agents — Agraris`);
  headingEl.textContent = `${label} agents on Robinhood Chain`;

  try {
    const agents = await fetchAgentsByCategory(slug);

    const description = `Browse ${agents.length} AI agents tagged '${label}' in the Agraris registry for Robinhood Chain.`;
    setMetaDescription(description);
    setMetaProperty("og:description", description);

    countEl.textContent = agents.length
      ? `${agents.length} agent${agents.length === 1 ? "" : "s"} found`
      : "";

    if (agents.length === 0) {
      listEl.innerHTML = renderEmptyState(
        `No agents in "${label}" yet`,
        "This category doesn't have any agents yet. Check back later, or browse the full registry.",
        { href: "search.html", label: "Browse all agents", variant: "outline" }
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
