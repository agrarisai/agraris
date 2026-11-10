const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { buildCardSpec, CARD_NOTE } = require("../weekly-card.js");

const agent = { id: "abc", name: "Example Agent", version: "1.0.0", kind: "agent", category: ["infrastructure", "payments"] };

test("no card when there is no activity or no commits", () => {
  assert.strictEqual(buildCardSpec(agent, null, false), null);
  assert.strictEqual(buildCardSpec(agent, { c7: 0, d: [0, 0, 0, 0, 0, 0, 0], p7: 0 }, false), null);
  assert.strictEqual(buildCardSpec(null, { c7: 3, d: [], p7: 0 }, false), null);
});

test("card text for a rising listing", () => {
  const s = buildCardSpec(agent, { c7: 12, d: [1, 0, 2, 3, 1, 2, 3], p7: 4 }, true);
  assert.strictEqual(s.bigNumber, "12");
  assert.strictEqual(s.unit, "commits this week");
  assert.strictEqual(s.rising, true);
  assert.strictEqual(s.upFrom, "up from 4");
  assert.strictEqual(s.meta, "Agent  ·  v1.0.0  ·  infrastructure");
  assert.match(s.tweet, /12 commits this week \(up from 4\)\. Code activity only\./);
  assert.strictEqual(s.url, "https://agraris.xyz/agent.html?id=abc");
  assert.strictEqual(s.filename, "agraris-example-agent-weekly.png");
});

test("not rising: no chip text; singular; 100+ at the counter cap", () => {
  const a = buildCardSpec(agent, { c7: 1, d: [0, 0, 0, 0, 0, 0, 1], p7: 5 }, false);
  assert.strictEqual(a.unit, "commit this week");
  assert.strictEqual(a.upFrom, null);
  const b = buildCardSpec({ ...agent, kind: "tool" }, { c7: 100, d: [14, 14, 14, 14, 14, 15, 15], p7: null }, false);
  assert.strictEqual(b.bigNumber, "100+");
  assert.deepStrictEqual(b.bars, []);
  assert.strictEqual(b.upFrom, null);
  assert.strictEqual(b.rising, false);
  assert.match(b.meta, /^Tool/);
});

test("the card always carries the code-activity-only note", () => {
  assert.match(CARD_NOTE, /Code activity only/);
  assert.match(CARD_NOTE, /not an endorsement/);
});

test("agent page loads weekly-card.js before agent.js and renders the section", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "agent.html"), "utf8");
  assert.ok(html.indexOf("weekly-card.js") > -1 && html.indexOf("weekly-card.js") < html.indexOf('src="agent.js"'));
  const js = fs.readFileSync(path.join(__dirname, "..", "agent.js"), "utf8");
  assert.match(js, /\$\{renderWeeklyCardSection\(agent\)\}/);
  assert.match(js, /initWeeklyCard\(container, agent\);/);
});
