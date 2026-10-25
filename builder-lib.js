// ============================================
// Agraris — builder (GitHub owner) dari repo_url
// ============================================
//
// "Builder" = pemilik GitHub dari repo_url sebuah listing. Hanya URL
// github.com/<owner>/<repo> yang punya builder; selain itu null.
//
// Dipakai di dua tempat dengan aturan yang sama persis:
//   - browser: <script src="builder-lib.js"> → window.AgrarisBuilder
//     (builder.html, builders.html, halaman detail listing)
//   - Node: require("../builder-lib.js") (scripts/generate-api.js →
//     field builder_github di api/agents.json)
//
// Aturan builderFromRepoUrl(url):
//   - http: atau https: saja, tanpa user:pass@ dan tanpa port;
//   - host persis github.com atau www.github.com (jadi github.com.evil.com,
//     evil.com/github.com, gist.github.com, dsb. tidak lolos);
//   - path punya minimal dua bagian: /<owner>/<repo>;
//   - owner dijadikan huruf kecil dan harus cocok ^[a-z0-9-]{1,39}$
//     (karakter %, _, ., spasi, dsb. membuatnya tidak lolos; tidak ada
//     decode);
//   - beberapa path GitHub yang bukan akun (orgs, settings, topics, ...)
//     tidak dianggap owner.
//
// isBuilderHandle(handle): handle (sudah huruf kecil) cocok dengan regex
// yang sama. Handle dari URL halaman HARUS lewat sini sebelum dipakai di
// DOM, URL, atau query.

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.AgrarisBuilder = api;
})(typeof self !== "undefined" ? self : this, function () {
  const HANDLE_PATTERN = /^[a-z0-9-]{1,39}$/;
  const MAX_URL_LENGTH = 2048;
  const GITHUB_HOSTS = ["github.com", "www.github.com"];

  // Bagian pertama path github.com yang adalah halaman GitHub sendiri,
  // bukan akun pengguna / organisasi.
  const RESERVED = new Set([
    "about", "apps", "collections", "contact", "customer-stories", "enterprise",
    "events", "explore", "features", "issues", "login", "marketplace",
    "new", "notifications", "organizations", "orgs", "pulls", "search",
    "security", "settings", "site", "sponsors", "topics", "users",
  ]);

  function isBuilderHandle(handle) {
    return typeof handle === "string" && HANDLE_PATTERN.test(handle) && !RESERVED.has(handle);
  }

  // Teks dari ?u= → handle huruf kecil yang sah, atau null.
  function normalizeHandle(raw) {
    if (typeof raw !== "string") return null;
    const handle = raw.trim().toLowerCase();
    return isBuilderHandle(handle) ? handle : null;
  }

  function builderFromRepoUrl(raw) {
    if (typeof raw !== "string") return null;
    const text = raw.trim();
    if (!text || text.length > MAX_URL_LENGTH) return null;

    let url;
    try {
      url = new URL(text);
    } catch {
      return null;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password || url.port) return null;
    if (!GITHUB_HOSTS.includes(url.hostname)) return null;

    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    const handle = parts[0].toLowerCase();
    return isBuilderHandle(handle) ? handle : null;
  }

  function githubProfileUrl(handle) {
    return isBuilderHandle(handle) ? `https://github.com/${handle}` : null;
  }

  function builderPageUrl(handle) {
    return isBuilderHandle(handle) ? `builder.html?u=${handle}` : null;
  }

  // listings → Map handle → { handle, agents, tools, listings[] }.
  // Listing tanpa builder dilewati.
  function groupByBuilder(listings) {
    const groups = new Map();
    for (const listing of Array.isArray(listings) ? listings : []) {
      const handle = builderFromRepoUrl(listing && listing.repo_url);
      if (!handle) continue;
      let g = groups.get(handle);
      if (!g) {
        g = { handle, agents: 0, tools: 0, listings: [] };
        groups.set(handle, g);
      }
      g.listings.push(listing);
      if (listing.kind === "tool") g.tools += 1;
      else g.agents += 1;
    }
    return groups;
  }

  // "2 agents · 1 tool", "1 agent", "3 tools". Bagian yang nol dilewati.
  function countText(agents, tools) {
    const parts = [];
    if (agents > 0) parts.push(`${agents} agent${agents === 1 ? "" : "s"}`);
    if (tools > 0) parts.push(`${tools} tool${tools === 1 ? "" : "s"}`);
    return parts.join(" · ");
  }

  return {
    HANDLE_PATTERN,
    isBuilderHandle,
    normalizeHandle,
    builderFromRepoUrl,
    githubProfileUrl,
    builderPageUrl,
    groupByBuilder,
    countText,
  };
});
