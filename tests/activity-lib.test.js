const test = require("node:test");
const assert = require("node:assert");
const { summarizeCommits, normalizeActivity } = require("../scripts/activity-lib");

const NOW = Date.parse("2026-10-29T12:00:00Z");
const commit = (iso) => ({ commit: { committer: { date: iso } } });

test("counts commits per UTC day, oldest day first, today last", () => {
  const r = summarizeCommits(
    [commit("2026-10-29T10:00:00Z"), commit("2026-10-29T01:00:00Z"), commit("2026-10-27T05:00:00Z"), commit("2026-10-23T23:00:00Z")],
    NOW
  );
  assert.strictEqual(r.c7, 4);
  assert.deepStrictEqual(r.d, [1, 0, 0, 0, 1, 0, 2]);
  assert.strictEqual(r.last, "2026-10-29T10:00:00.000Z");
});

test("ignores commits outside the 7-day window and invalid dates", () => {
  const r = summarizeCommits([commit("2026-10-01T00:00:00Z"), { commit: {} }, null], NOW);
  assert.strictEqual(r.c7, 0);
  assert.deepStrictEqual(r.d, [0, 0, 0, 0, 0, 0, 0]);
  assert.strictEqual(r.last, null);
});

test("non-array input gives an empty summary", () => {
  assert.strictEqual(summarizeCommits(undefined, NOW).c7, 0);
});

test("normalizeActivity validates and pads", () => {
  assert.strictEqual(normalizeActivity(null), null);
  assert.strictEqual(normalizeActivity({ c7: -1 }), null);
  assert.deepStrictEqual(normalizeActivity({ c7: 2, d: [1, 1], last: "bad" }), { c7: 2, d: [0, 0, 0, 0, 0, 1, 1], last: null });
});
