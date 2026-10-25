// ============================================
// Agraris — builder profile (builder.html?u=<github owner>)
// ============================================
//
// Approved listings whose repo URL is github.com/<owner>/…, grouped with
// builder-lib.js (same rules as builder_github in api/agents.json). The
// ?u= value is lowercased and checked against ^[a-z0-9-]{1,39}$ before it
// is used in the DOM, a URL or a query; an invalid value is never shown.
// The handle, counts and messages are written with textContent. Listing
// cards come from the shared renderAgentRow() (which escapes its data),
// with the Live check and owner signature labels.

(async function () {
  const headingEl = document.getElementById("builder-heading");
  const countEl = document.getElementById("builder-count");
  const leadEl = document.getElementById("builder-lead");
  const listEl = document.getElementById("builder-list");
  const B = window.AgrarisBuilder;

  function message(text, withSearchLink) {
    listEl.textContent = "";
    const p = document.createElement("p");
    p.className = "wanted-empty";
    p.textContent = text;
    if (withSearchLink) {
      const a = document.createElement("a");
      a.href = "search.html";
      a.textContent = "Browse all listings";
      p.append(" ", a, ".");
    }
    listEl.appendChild(p);
    listEl.removeAttribute("aria-busy");
  }

  const handle = B.normalizeHandle(new URLSearchParams(window.location.search).get("u"));
  if (!handle) {
    headingEl.textContent = "Builder not found";
    leadEl.textContent = "This link does not contain a valid GitHub account name.";
    message("Nothing to show here.", true);
    return;
  }

  document.title = `${handle} — Builders — Agraris`;
  headingEl.textContent = handle;
  const gh = document.createElement("a");
  gh.href = B.githubProfileUrl(handle);
  gh.target = "_blank";
  gh.rel = "noopener noreferrer";
  gh.textContent = `github.com/${handle}`;
  leadEl.textContent = "";
  leadEl.append("GitHub: ", gh);

  let listings;
  let proofs;
  try {
    [listings, proofs] = await Promise.all([fetchAgents(), fetchOwnerProofs()]);
  } catch {
    message("Couldn't load listings right now. Please try again later.", false);
    return;
  }

  const group = B.groupByBuilder(listings).get(handle);
  if (!group) {
    message(`No approved listings from ${handle} yet.`, true);
    return;
  }

  countEl.textContent = B.countText(group.agents, group.tools);
  const cards = group.listings.map((a) => {
    const proof = proofs.get(String(a.id));
    return proof ? { ...a, owner_signed_at: proof.signed_at } : a;
  });
  listEl.innerHTML = cards.map(renderAgentRow).join("");
  listEl.removeAttribute("aria-busy");
  observeReveal(listEl);
})();
