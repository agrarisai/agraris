// ============================================
// Agraris — builders index (builders.html)
// ============================================
//
// Every GitHub owner with at least one approved listing, in alphabetical
// order, with how many agents and tools they have. Grouping comes from
// builder-lib.js (the same rules as builder_github in api/agents.json).
// No ranking and no star totals. Everything is written with textContent.

(async function () {
  const listEl = document.getElementById("builders-list");
  const countEl = document.getElementById("builders-count");
  const otherEl = document.getElementById("builders-other");
  const B = window.AgrarisBuilder;

  function message(text) {
    listEl.textContent = "";
    const li = document.createElement("li");
    li.className = "builders-empty";
    li.textContent = text;
    listEl.appendChild(li);
  }

  let listings;
  try {
    listings = await fetchAgents();
  } catch {
    message("Couldn't load builders right now. Please try again later.");
    listEl.removeAttribute("aria-busy");
    return;
  }
  listEl.removeAttribute("aria-busy");

  const groups = [...B.groupByBuilder(listings).values()].sort((a, b) => a.handle.localeCompare(b.handle));
  const withoutGithub = listings.length - groups.reduce((n, g) => n + g.listings.length, 0);

  if (withoutGithub > 0) {
    otherEl.textContent = `${withoutGithub} listing${withoutGithub === 1 ? " has" : "s have"} a repo link outside GitHub and ${withoutGithub === 1 ? "is" : "are"} not shown here.`;
    otherEl.hidden = false;
  }

  if (groups.length === 0) {
    message("No builders to show yet.");
    return;
  }

  countEl.textContent = `${groups.length} builder${groups.length === 1 ? "" : "s"}`;
  listEl.textContent = "";
  for (const g of groups) {
    const li = document.createElement("li");
    li.className = "builders-row";
    const a = document.createElement("a");
    a.className = "builders-handle";
    a.href = B.builderPageUrl(g.handle);
    a.textContent = g.handle;
    const count = document.createElement("span");
    count.className = "builders-count-text";
    count.textContent = B.countText(g.agents, g.tools);
    li.append(a, count);
    listEl.appendChild(li);
  }
})();
