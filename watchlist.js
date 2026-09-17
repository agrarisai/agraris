// ============================================
// Agraris — watchlist page logic
// ============================================
//
// Reads bookmarked agent ids from localStorage (see getWatchlist() in
// app.js) and fetches their details from Supabase in one query. Since
// this is purely a local, per-device bookmark list (no login, no
// sync), an id that no longer resolves to an agent (removed from the
// registry) is just silently dropped from the results.

(async function () {
  const listEl = document.getElementById("agent-list");
  const countEl = document.getElementById("agent-count");

  const ids = getWatchlist();

  if (ids.length === 0) {
    listEl.removeAttribute("aria-busy");
    listEl.innerHTML = renderEmptyState(
      "Your watchlist is empty",
      "Bookmark agents you want to revisit — tap the star icon on any agent."
    );
    return;
  }

  try {
    const agents = await fetchAgentsByIds(ids);

    // Most recently bookmarked first (toggleWatchlist appends new ids
    // to the end of the stored array).
    const order = new Map(ids.map((id, i) => [String(id), i]));
    agents.sort(
      (a, b) =>
        (order.get(String(b.id)) ?? -1) - (order.get(String(a.id)) ?? -1)
    );

    if (agents.length === 0) {
      countEl.textContent = "";
      listEl.innerHTML = renderEmptyState(
        "Your watchlist is empty",
        "Bookmark agents you want to revisit — tap the star icon on any agent."
      );
      return;
    }

    countEl.textContent = `${agents.length} agent${agents.length === 1 ? "" : "s"}`;

    listEl.innerHTML = agents.map(renderAgentRow).join("");
    observeReveal(listEl);
  } catch (err) {
    listEl.innerHTML = renderEmptyState(
      "Couldn't load your watchlist",
      "Check your Supabase connection and try again."
    );
  } finally {
    listEl.removeAttribute("aria-busy");
  }
})();
