const test = require("node:test");
const assert = require("node:assert");
const { buildQueries, isBlacklisted, pickCandidates } = require("../scripts/suggestion-lib.js");

test("queries use topic search, skip forks/archived, and an activity cutoff", () => {
  const q = buildQueries(new Date("2026-11-12T00:00:00Z"));
  assert.deepStrictEqual(q, [
    "topic:robinhood-chain agent fork:false archived:false pushed:>=2026-08-14",
    "topic:robinhood-chain mcp fork:false archived:false pushed:>=2026-08-14",
  ]);
});

test("blacklist matches name or description", () => {
  assert.ok(isBlacklisted({ full_name: "a/sniper-x", description: null }));
  assert.ok(isBlacklisted({ full_name: "a/b", description: "A Pump launcher" }));
  assert.ok(!isBlacklisted({ full_name: "a/b", description: "Reads the chain" }));
});

test("pickCandidates dedupes, filters, sorts by stars and caps", () => {
  const repo = (n, stars, d = "x") => ({ full_name: `o/${n}`, html_url: `https://github.com/o/${n}`, description: d, stargazers_count: stars });
  const repos = [repo("a", 1), repo("b", 9), repo("b", 9), repo("c", 5, "volume-bot"), repo("old", 3), repo("d", 4)];
  const r = pickCandidates(repos, new Set(["https://github.com/O/old/"]), 2);
  assert.deepStrictEqual(r.toInsert.map((x) => x.name), ["o/b", "o/d"]);
  assert.strictEqual(r.skippedDuplicate, 2);
  assert.strictEqual(r.skippedBlacklist, 1);
  assert.strictEqual(r.leftOver, 1);
});
