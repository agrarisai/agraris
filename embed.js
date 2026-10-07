// ============================================
// Agraris — embeddable agent card (embed.html?id=<agent_id>&theme=light|dark)
// ============================================
//
// Rendered inside an <iframe> on a builder's own site. Reads one agent
// with the public (publishable, read-only) Supabase key from
// supabase-client.js and draws a compact card.
//
// Deliberately does NOT load app.js: that file also boots the site
// header, menu and theme toggle, none of which exist on this page, so
// the few helpers needed here are kept local instead.
//
// Auto-resize: after every layout change the card height is posted to
// the parent as { type: "agraris-embed-height", height } so the host
// page can size the iframe to fit (see docs.html#embed-widget).

const SITE_URL = "https://agraris.xyz/";

// Agent ids are Postgres uuids; checking the shape first turns a
// mistyped id into the "not found" card instead of a Supabase error.
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// Same tolerant parsing as app.js: category may be a text[] or a string.
function normalizeCategories(raw) {
  if (Array.isArray(raw)) return raw.filter(Boolean);
  if (typeof raw === "string" && raw.trim() !== "") {
    return raw
      .replace(/^{|}$/g, "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

function isVerified(agent) {
  const v = agent?.verified;
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v.trim().toLowerCase() === "true";
  if (typeof v === "number") return v === 1;
  return false;
}

function agentPageUrl(id) {
  return `${SITE_URL}agent.html?id=${encodeURIComponent(id)}`;
}

const STAR_ICON =
  '<svg class="github-star-icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.75.75 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25z"/></svg>';

function renderCard(agent) {
  const tags = normalizeCategories(agent.category)
    .map((c) => `<span class="tag">${escapeHtml(c)}</span>`)
    .join("");

  const stars =
    typeof agent.github_stars === "number"
      ? `<span class="embed-stars" title="GitHub stars">${STAR_ICON}${agent.github_stars.toLocaleString("en-US")}</span>`
      : "";

  const verified = isVerified(agent)
    ? `<span class="verified-badge">✓ Verified</span>`
    : "";

  return `
    <article class="embed-card">
      <div class="embed-head">
        <span class="embed-name">${escapeHtml(agent.name)}</span>
        ${verified}
        ${stars}
      </div>
      ${agent.description ? `<p class="embed-desc">${escapeHtml(agent.description)}</p>` : ""}
      ${tags ? `<div class="embed-tags">${tags}</div>` : ""}
      <a class="embed-link" href="${escapeHtml(agentPageUrl(agent.id))}" target="_blank" rel="noopener">View on Agraris →</a>
    </article>
  `;
}

function renderError(title, body) {
  return `
    <div class="embed-card embed-card--error" role="alert">
      <span class="embed-name">${escapeHtml(title)}</span>
      <p class="embed-desc">${escapeHtml(body)}</p>
      <a class="embed-link" href="${SITE_URL}" target="_blank" rel="noopener">Agraris registry →</a>
    </div>
  `;
}

// ---------- height reporting for iframe auto-resize ----------

let lastHeight = 0;

function postHeight() {
  const height = Math.ceil(document.documentElement.getBoundingClientRect().height);
  if (height === lastHeight) return;
  lastHeight = height;
  // "*" is fine here: the message only carries a pixel height, and the
  // card can be embedded on any origin.
  window.parent?.postMessage({ type: "agraris-embed-height", height }, "*");
}

if ("ResizeObserver" in window) {
  new ResizeObserver(postHeight).observe(document.documentElement);
}
window.addEventListener("load", postHeight);
document.fonts?.ready.then(postHeight);

// ---------- load + render ----------

(async function () {
  const root = document.getElementById("embed-root");
  const id = (new URLSearchParams(window.location.search).get("id") || "").trim();

  function show(html) {
    root.innerHTML = html;
    postHeight();
  }

  if (!UUID_PATTERN.test(id)) {
    show(renderError("Agent not found", "This embed link is missing a valid agent id."));
    return;
  }

  try {
    // supabase-client.js defines supabaseClient; if the Supabase CDN
    // script failed to load it won't exist, which is handled below.
    const { data, error } = await supabaseClient
      .from("agents")
      .select("id, name, description, category, github_stars, verified")
      .eq("id", id)
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      show(renderError("Agent not found", "This agent may have been removed from the registry."));
      return;
    }

    show(renderCard(data));
  } catch (err) {
    show(renderError("Couldn't load agent", "Please try again later."));
  }
})();
