const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");

// Load only the logo helpers from app.js (it is a browser script).
function loadHelpers() {
  const a = app.indexOf("const DEFAULT_LOGO_AGENT");
  const b = app.indexOf("function renderAgentRow(");
  assert.ok(a > 0 && b > a);
  const ctx = {};
  vm.runInNewContext(app.slice(a, b) + "\nthis.AGENT_LOGOS = AGENT_LOGOS; this.agentLogoPath = agentLogoPath; this.renderTitleWithLogo = renderTitleWithLogo;", ctx);
  return ctx;
}

test("every logo entry is a lowercase github url and its file exists and is small", () => {
  const { AGENT_LOGOS } = loadHelpers();
  const entries = Object.entries(AGENT_LOGOS);
  assert.ok(entries.length >= 9);
  for (const [url, file] of entries) {
    assert.match(url, /^https:\/\/github\.com\/[a-z0-9._-]+\/[a-z0-9._-]+$/, url);
    assert.match(file, /^logos\/[a-z0-9-]+\.webp$/, file);
    const full = path.join(root, file);
    assert.ok(fs.existsSync(full), `${file} missing`);
    assert.ok(fs.statSync(full).size < 30000, `${file} too large`);
  }
});

test("agentLogoPath matches case-insensitively and ignores trailing slash", () => {
  const { agentLogoPath } = loadHelpers();
  assert.strictEqual(agentLogoPath({ repo_url: "https://github.com/MikeyPetrillo/Agent402/" }), "logos/agent402.webp");
  assert.strictEqual(agentLogoPath({ repo_url: "https://github.com/someone/else" }), null);
  assert.strictEqual(agentLogoPath({}), null);
  assert.strictEqual(agentLogoPath(null), null);
  assert.strictEqual(agentLogoPath({ repo_url: "https://github.com/x/constructor" }), null);
});

test("without a logo the Agraris default is used (agent vs tool); with one it adds its own img", () => {
  const { renderTitleWithLogo } = loadHelpers();
  const none = renderTitleWithLogo({ repo_url: "https://github.com/a/b" }, "<b>x</b>");
  assert.match(none.html, /src="logos\/placeholder-agent\.webp"/);
  const tool = renderTitleWithLogo({ kind: "tool", repo_url: "https://github.com/a/b" }, "<b>x</b>");
  assert.match(tool.html, /src="logos\/placeholder-tool\.webp"/);
  assert.ok(fs.existsSync(path.join(root, "logos/placeholder-agent.webp")));
  assert.ok(fs.existsSync(path.join(root, "logos/placeholder-tool.webp")));
  const yes = renderTitleWithLogo({ repo_url: "https://github.com/millw14/merrymen" }, "<b>x</b>", { lg: true });
  assert.match(yes.cls, /has-logo-lg/);
  assert.match(yes.html, /<img class="agent-logo" src="logos\/merrymen\.webp" width="76" height="76" alt=""/);
  assert.match(yes.html, /<span class="agent-row-title"><b>x<\/b><\/span>/);
});

test("rows and the detail page use the helper; docs mention logos", () => {
  assert.match(app, /renderTitleWithLogo\(\s*agent,/);
  const agentJs = fs.readFileSync(path.join(root, "agent.js"), "utf8");
  assert.match(agentJs, /renderTitleWithLogo\(/);
  const docs = fs.readFileSync(path.join(root, "docs.html"), "utf8");
  assert.match(docs, /id="logos"/);
});

test("home trending cards use the logo helper too", () => {
  const home = fs.readFileSync(path.join(root, "home.js"), "utf8");
  assert.match(home, /renderTitleWithLogo\(/);
});
