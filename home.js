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
        "No agents yet",
        "Be the first to publish one."
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
  }
})();
