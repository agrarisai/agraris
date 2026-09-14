// ============================================
// Agraris — home page logic
// ============================================

(async function () {
  const listEl = document.getElementById("agent-list");
  const countEl = document.getElementById("agent-count");

  try {
    const agents = await fetchAgents();

    countEl.textContent = agents.length
      ? `${agents.length} agent${agents.length === 1 ? "" : "s"}`
      : "";

    if (agents.length === 0) {
      listEl.innerHTML = renderEmptyState(
        "No agents yet",
        "Be the first to publish one."
      );
      return;
    }

    listEl.innerHTML = agents.map(renderAgentRow).join("");
  } catch (err) {
    listEl.innerHTML = renderEmptyState(
      "Couldn't load agents",
      "Check your Supabase connection and try again."
    );
  }
})();
