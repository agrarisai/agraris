// ============================================
// Agraris — search by need (pure helpers)
// ============================================
//
// Plain text matching, no AI: the query is split into words and a listing
// matches when enough of those words appear in its name, description or
// category. Used by search.js; kept free of DOM code so it can be tested.

const NEED_STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into", "your", "you",
  "can", "any", "all", "get", "make", "build", "need", "want", "find", "help",
  "agent", "agents", "tool", "tools", "bot", "bots", "app", "apps", "ai",
  "something", "thing", "stuff", "using", "use", "new",
]);

function needTokens(query) {
  const words = String(query || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .map((w) => (w.length > 4 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w))
    .filter((w) => w.length >= 3 && !NEED_STOPWORDS.has(w));
  return [...new Set(words)];
}

// Returns { score, matched } or null. At least half of the words (rounded
// up) must match, so one stray common word does not count as an answer.
function matchNeed(listing, tokens) {
  if (!listing || tokens.length === 0) return null;
  const categories = Array.isArray(listing.category)
    ? listing.category.join(" ")
    : String(listing.category || "");
  const haystack = `${listing.name || ""} ${listing.description || ""} ${categories}`.toLowerCase();
  const matched = tokens.filter((t) => haystack.includes(t));
  if (matched.length < Math.ceil(tokens.length / 2)) return null;
  return { score: matched.length, matched };
}

// Same rules the database applies in log_search_miss(); checking here too
// avoids sending phrases that would be dropped anyway.
function isLoggableTerm(term) {
  const t = String(term || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (t.length < 3 || t.length > 60) return false;
  if (/[\u0000-\u001f\u007f]/.test(t)) return false;
  if (/(https?:|www\.|[a-z0-9-]+\.(com|io|xyz|org|net|app|ai|dev|co|me|gg|fi|eth)\b)/.test(t)) return false;
  if (t.includes("@")) return false;
  if (/0x[0-9a-f]{6,}/.test(t)) return false;
  if (/[0-9]{6,}/.test(t)) return false;
  return true;
}

if (typeof module !== "undefined") module.exports = { needTokens, matchNeed, isLoggableTerm };
