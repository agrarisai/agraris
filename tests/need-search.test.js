const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const { needTokens, matchNeed, isLoggableTerm } = require("../need-search.js");

test("tokens drop filler words and plurals", () => {
  assert.deepStrictEqual(needTokens("an agent to monitor wallets for me"), ["monitor", "wallet"]);
  assert.deepStrictEqual(needTokens("  "), []);
});

test("a listing needs at least half of the words", () => {
  const l = { name: "Wallet Watcher", description: "Tracks wallet movements and sends alerts.", category: ["monitoring"] };
  assert.ok(matchNeed(l, needTokens("monitor wallet activity")));
  assert.deepStrictEqual(matchNeed(l, needTokens("wallet alerts")).matched, ["wallet", "alert"]);
  assert.strictEqual(matchNeed(l, needTokens("tax report generator")), null);
  assert.strictEqual(matchNeed(l, []), null);
});

test("loggable terms reject urls, addresses, emails and long numbers", () => {
  assert.ok(isLoggableTerm("tax report generator"));
  for (const bad of ["ab", "x".repeat(61), "visit scam.com now", "https://x", "a@b.co", "0x467b7a85f55bd716", "call 123456789", "bad\u0001term"]) {
    assert.strictEqual(isLoggableTerm(bad), false, bad);
  }
});

test("migration keeps the table closed and the board at 5+ visitors", () => {
  const sql = fs.readFileSync("supabase/migration-search-misses.sql", "utf8");
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on table public\.search_misses from anon, authenticated/);
  assert.match(sql, /having count\(distinct m\.visitor\) >= 5/);
  assert.match(sql, /security definer/);
});
