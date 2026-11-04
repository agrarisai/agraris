const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

// Regression: agent.js used `B.safeHttpsUrl` in the main render while `B`
// was only declared inside another function, so every listing page showed
// "Agent not found". `B` must be defined at top level.
test("agent.js defines B at top level and agent.html loads builder-lib.js first", () => {
  const js = fs.readFileSync(path.join(__dirname, "..", "agent.js"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "..", "agent.html"), "utf8");
  assert.match(js, /^const B = window\.AgrarisBuilder;/m);
  assert.ok(html.indexOf("builder-lib.js") !== -1);
  assert.ok(html.indexOf("builder-lib.js") < html.indexOf("agent.js"));
});
