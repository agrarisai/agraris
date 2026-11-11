// Pure helpers for scripts/fetch-agent-suggestions.js (no network, no
// database) so the selection rules can be tested.

const SEARCH_TOPIC = "robinhood-chain";
const SEARCH_TERMS = ["agent", "mcp"];
const ACTIVE_WITHIN_DAYS = 90;
const MAX_NEW_PER_RUN = 25;

const BLACKLIST_KEYWORDS = [
  "sniper",
  "bundler",
  "volume-bot",
  "volumebot",
  "pump",
  "honeypot",
  "memecoin sniper",
];

// One query per term. GitHub's search does not handle the old
// `"robinhood-chain" AND (...) in:...` form (it returned 0 results).
function buildQueries(now = new Date()) {
  const since = new Date(now.getTime() - ACTIVE_WITHIN_DAYS * 86400000)
    .toISOString()
    .slice(0, 10);
  return SEARCH_TERMS.map(
    (term) => `topic:${SEARCH_TOPIC} ${term} fork:false archived:false pushed:>=${since}`
  );
}

function isBlacklisted(repo) {
  const haystack = `${repo.full_name} ${repo.description ?? ""}`.toLowerCase();
  return BLACKLIST_KEYWORDS.some((keyword) => haystack.includes(keyword));
}

function normalizeUrl(url) {
  return String(url || "").trim().toLowerCase().replace(/\/+$/, "");
}

// repos: search results (may repeat across queries); existingUrls: Set of
// urls already listed or suggested. Returns the rows to insert (most
// starred first, at most `cap`) and counts for the log.
function pickCandidates(repos, existingUrls, cap = MAX_NEW_PER_RUN) {
  const seen = new Set([...existingUrls].map(normalizeUrl));
  let skippedBlacklist = 0;
  let skippedDuplicate = 0;
  const fresh = [];
  for (const repo of repos) {
    const key = normalizeUrl(repo.html_url);
    if (seen.has(key)) {
      skippedDuplicate += 1;
      continue;
    }
    seen.add(key);
    if (isBlacklisted(repo)) {
      skippedBlacklist += 1;
      continue;
    }
    fresh.push(repo);
  }
  fresh.sort((a, b) => (b.stargazers_count ?? 0) - (a.stargazers_count ?? 0));
  const picked = fresh.slice(0, cap);
  return {
    toInsert: picked.map((repo) => ({
      name: repo.full_name,
      description: repo.description ?? null,
      repo_url: repo.html_url,
      stars: repo.stargazers_count ?? 0,
    })),
    skippedBlacklist,
    skippedDuplicate,
    leftOver: fresh.length - picked.length,
  };
}

module.exports = {
  buildQueries,
  isBlacklisted,
  pickCandidates,
  MAX_NEW_PER_RUN,
  ACTIVE_WITHIN_DAYS,
};
