const test = require("node:test");
const assert = require("node:assert");
const { renderBadge, statusText } = require("../scripts/badge-lib");

test("active badge shows commit count and green dot", () => {
  const svg = renderBadge({ c7: 25 });
  assert.match(svg, /active this week · 25 commits/);
  assert.match(svg, /<circle/);
});

test("singular commit", () => {
  assert.match(renderBadge({ c7: 1 }), /1 commit</);
});

test("no activity or bad data gives neutral badge", () => {
  for (const v of [null, undefined, { c7: 0 }, { c7: "x" }]) {
    const svg = renderBadge(v);
    assert.match(svg, /listed · Robinhood Chain/);
    assert.doesNotMatch(svg, /<circle/);
  }
  assert.equal(statusText(null).active, false);
});

test("svg is well-formed enough: one root, balanced tags, no raw ampersands", () => {
  const svg = renderBadge({ c7: 3 });
  assert.equal((svg.match(/<svg/g) || []).length, 1);
  assert.equal((svg.match(/<\/svg>/g) || []).length, 1);
  assert.doesNotMatch(svg, /&(?!amp;|lt;|gt;|quot;|#39;)/);
});

test("100 commits is shown as 100+ because the counter stops at 100", () => {
  assert.match(renderBadge({ c7: 100 }), /100\+ commits/);
  assert.doesNotMatch(renderBadge({ c7: 99 }), /99\+/);
});
