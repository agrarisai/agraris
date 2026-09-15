// ============================================
// Agraris — agent detail page logic
// ============================================

function initCopyLinkButton(root) {
  const btn = root.querySelector("#copy-link-btn");
  if (!btn) return;

  const defaultLabel = btn.textContent;

  btn.addEventListener("click", () => {
    if (!navigator.clipboard?.writeText) return;

    navigator.clipboard
      .writeText(window.location.href)
      .then(() => {
        btn.textContent = "Copied!";
        setTimeout(() => {
          btn.textContent = defaultLabel;
        }, 2000);
      })
      .catch(() => {
        // clipboard write failed (permissions, insecure context, etc.) —
        // fail silently, no error shown to the user
      });
  });
}

(async function () {
  const container = document.getElementById("agent-detail");
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");

  if (!id) {
    container.removeAttribute("aria-busy");
    container.innerHTML = renderEmptyState(
      "No agent specified",
      "Go back to the registry and pick an agent to view."
    );
    return;
  }

  try {
    const agent = await fetchAgentById(id);
    const categories = normalizeCategories(agent.category);
    const tags = categories
      .map((c) => `<span class="tag">${escapeHtml(c)}</span>`)
      .join("");

    container.innerHTML = `
      <div class="detail-head reveal">
        <div class="agent-row-top">
          <span class="agent-name">${escapeHtml(agent.name)}</span>
        </div>
        <div class="agent-meta-row">
          <span class="agent-version">v${escapeHtml(agent.version)}</span>
          ${renderGithubBadgePlaceholder(agent)}
        </div>
        <div class="agent-meta">${tags}</div>
        <p class="detail-desc">${escapeHtml(agent.description)}</p>
        <div class="detail-links">
          <a class="btn btn-solid" href="${escapeHtml(agent.repo_url)}" target="_blank" rel="noopener noreferrer">View repo</a>
          ${
            agent.demo_url
              ? `<a class="btn" href="${escapeHtml(agent.demo_url)}" target="_blank" rel="noopener noreferrer">View demo</a>`
              : ""
          }
          <button type="button" class="btn" id="copy-link-btn">Copy link</button>
        </div>
      </div>

      <div class="detail-row reveal">
        <div class="detail-row-label">Published</div>
        <div>${escapeHtml(formatDate(agent.created_at))}</div>
      </div>
    `;
    observeReveal(container);
    loadGithubBadges([agent], container);
    initCopyLinkButton(container);
  } catch (err) {
    container.innerHTML = renderEmptyState(
      "Agent not found",
      "This agent may have been removed, or the link is incorrect.",
      { href: "index.html", label: "Back to registry", variant: "outline" }
    );
  } finally {
    container.removeAttribute("aria-busy");
  }
})();
