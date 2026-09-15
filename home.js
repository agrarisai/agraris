// ============================================
// Agraris — home page logic
// ============================================

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
