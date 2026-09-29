// ============================================
// Agraris — compare page logic (compare.html?ids=id1,id2,id3)
// ============================================

const COMPARE_DESC_LIMIT = 180;

// Agent ids are Postgres uuids. Checking the shape up front turns a
// hand-edited or truncated link into a clear "not found" message
// instead of a Supabase "invalid input syntax for type uuid" error.
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isHttpUrl(url) {
  return typeof url === "string" && /^https?:\/\//i.test(url.trim());
}

function truncateText(text, limit) {
  const str = String(text || "").trim();
  if (str.length <= limit) return { text: str, truncated: false };

  const cut = str.slice(0, limit);
  const lastSpace = cut.lastIndexOf(" ");
  const trimmed = (lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s.,;:—-]+$/, "");
  return { text: `${trimmed}…`, truncated: true };
}

function renderCompareBackState(title, body) {
  return renderEmptyState(title, body, {
    href: "search.html",
    label: "Back to search",
    variant: "outline",
  });
}

function renderCompareTable(agents) {
  const muted = `<span class="compare-muted">—</span>`;
  const detailHref = (agent) => `agent.html?id=${encodeURIComponent(agent.id)}`;

  const rows = [
    [
      "Name",
      (a) => `<a class="compare-name" href="${detailHref(a)}">${escapeHtml(a.name)}</a>`,
    ],
    ["Verified", (a) => renderVerifiedBadge(a) || muted],
    ["Version", (a) => (a.version ? `v${escapeHtml(a.version)}` : muted)],
    [
      "Category",
      (a) => {
        const categories = normalizeCategories(a.category);
        if (categories.length === 0) return muted;
        const tags = categories
          .map(
            (c) =>
              `<a class="tag" href="category.html?slug=${encodeURIComponent(c)}">${escapeHtml(c)}</a>`
          )
          .join("");
        return `<div class="agent-meta">${tags}</div>`;
      },
    ],
    [
      "GitHub stars",
      (a) => (typeof a.github_stars === "number" ? formatGithubStars(a.github_stars) : muted),
    ],
    [
      "Last updated",
      (a) => (a.github_updated_at ? escapeHtml(formatRelativeTime(a.github_updated_at)) : muted),
    ],
    [
      "Description",
      (a) => {
        if (!a.description) return muted;
        const { text, truncated } = truncateText(a.description, COMPARE_DESC_LIMIT);
        const more = truncated
          ? ` <a class="compare-read-more" href="${detailHref(a)}">Read more</a>`
          : "";
        return `${escapeHtml(text)}${more}`;
      },
    ],
    [
      "Repo",
      (a) =>
        isHttpUrl(a.repo_url)
          ? `<a class="btn btn-sm" href="${escapeHtml(a.repo_url)}" target="_blank" rel="noopener noreferrer">View repo</a>`
          : muted,
    ],
  ];

  const body = rows
    .map(
      ([label, cell]) => `
        <tr>
          <th scope="row">${label}</th>
          ${agents.map((a) => `<td>${cell(a)}</td>`).join("")}
        </tr>`
    )
    .join("");

  return `
    <div class="compare-toolbar reveal">
      <button type="button" class="btn btn-sm" id="copy-compare-link-btn">Copy comparison link</button>
    </div>
    <div class="compare-table-wrap reveal">
      <table class="compare-table">
        <caption class="sr-only">Side-by-side comparison of ${agents.length} agents</caption>
        <tbody>${body}
        </tbody>
      </table>
    </div>
  `;
}

// Same copy-to-clipboard pattern as the agent page's "Copy link" button.
function initCopyCompareLinkButton(root) {
  const btn = root.querySelector("#copy-compare-link-btn");
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
  const root = document.getElementById("compare-root");
  const countEl = document.getElementById("compare-count");

  const raw = new URLSearchParams(window.location.search).get("ids") || "";
  const ids = [
    ...new Set(
      raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    ),
  ];

  function finish(html) {
    root.removeAttribute("aria-busy");
    root.innerHTML = html;
    observeReveal(root);
  }

  if (ids.length < COMPARE_MIN || ids.length > COMPARE_MAX) {
    finish(
      renderCompareBackState(
        ids.length > COMPARE_MAX ? "Too many agents to compare" : "Pick at least 2 agents",
        `A comparison needs ${COMPARE_MIN} to ${COMPARE_MAX} agents. Tick the checkbox on 2 or 3 agent cards, then press Compare.`
      )
    );
    return;
  }

  const notFoundState = () =>
    renderCompareBackState(
      "Some agents couldn't be found",
      "This comparison link points to an agent that doesn't exist or was removed. Pick the agents again to build a new comparison."
    );

  if (!ids.every((id) => UUID_PATTERN.test(id))) {
    finish(notFoundState());
    return;
  }

  try {
    const fetched = await fetchAgentsByIds(ids);
    const byId = new Map(fetched.map((a) => [String(a.id), a]));
    // Keep the column order from the URL, not the database's order.
    const agents = ids.map((id) => byId.get(id)).filter(Boolean);

    if (agents.length !== ids.length) {
      finish(notFoundState());
      return;
    }

    document.title = `Compare ${agents.map((a) => a.name).join(" vs ")} — Agraris`;
    countEl.textContent = `${agents.length} agents`;
    finish(renderCompareTable(agents));
    initCopyCompareLinkButton(root);
  } catch (err) {
    finish(
      renderCompareBackState(
        "Couldn't load agents",
        "Check your Supabase connection and try again."
      )
    );
  }
})();
