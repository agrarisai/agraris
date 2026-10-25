// Tes untuk builder-lib.js (builder = pemilik GitHub dari repo_url).
// Jalankan dari root repo: node --test

const test = require("node:test");
const assert = require("node:assert/strict");

const b = require("../builder-lib.js");

test("plain GitHub repo URLs give the lowercase owner", () => {
  const cases = [
    ["https://github.com/agrarisai/agraris", "agrarisai"],
    ["https://github.com/AgrarisAI/Agraris", "agrarisai"],
    ["https://GITHUB.COM/Some-Org/repo", "some-org"],
    ["http://github.com/x/y", "x"],
    ["https://www.github.com/owner/repo", "owner"],
    ["https://github.com/owner/repo.git", "owner"],
    ["https://github.com/owner/repo/", "owner"],
    ["https://github.com/owner/repo/tree/main/packages/a", "owner"],
    ["https://github.com/owner/repo?tab=readme#install", "owner"],
    ["  https://github.com/owner/repo  ", "owner"],
    ["https://github.com//owner//repo", "owner"],
    [`https://github.com/${"a".repeat(39)}/repo`, "a".repeat(39)],
    ["https://github.com/123/repo", "123"],
  ];
  for (const [url, owner] of cases) assert.equal(b.builderFromRepoUrl(url), owner, url);
});

test("non-GitHub and look-alike hosts have no builder", () => {
  for (const url of [
    "https://gitlab.com/owner/repo",
    "https://bitbucket.org/owner/repo",
    "https://github.com.evil.com/owner/repo",
    "https://evil.com/github.com/owner/repo",
    "https://evilgithub.com/owner/repo",
    "https://gist.github.com/owner/abc123",
    "https://raw.githubusercontent.com/owner/repo/main/README.md",
    "https://api.github.com/repos/owner/repo",
    "https://owner.github.io/repo",
    "https://github.com@evil.com/owner/repo",
    "https://user:pass@github.com/owner/repo",
    "https://github.com:8443/owner/repo",
    "https://github.com./owner/repo",
    "https://xn--github-xyz.com/owner/repo",
    "https://ɡithub.com/owner/repo",
  ]) {
    assert.equal(b.builderFromRepoUrl(url), null, url);
  }
});

test("wrong schemes and odd strings have no builder", () => {
  for (const url of [
    null,
    undefined,
    42,
    {},
    "",
    "   ",
    "github.com/owner/repo",
    "git@github.com:owner/repo.git",
    "ssh://git@github.com/owner/repo",
    "git://github.com/owner/repo",
    "ftp://github.com/owner/repo",
    "javascript:alert(1)//github.com/owner/repo",
    "data:text/html,https://github.com/owner/repo",
    "file:///github.com/owner/repo",
    "https://github.com",
    "https://github.com/",
    "https://github.com/owner",
    "https://github.com/owner/",
    `https://github.com/owner/${"r".repeat(3000)}`,
  ]) {
    assert.equal(b.builderFromRepoUrl(url), null, String(url).slice(0, 40));
  }
});

test("owners with characters outside [a-z0-9-] or too long are refused", () => {
  for (const url of [
    "https://github.com/own_er/repo",
    "https://github.com/own.er/repo",
    "https://github.com/own%20er/repo",
    "https://github.com/own%2Fer/repo",
    "https://github.com/%3Cscript%3E/repo",
    "https://github.com/<script>/repo",
    "https://github.com/\"onmouseover=alert(1)/repo",
    "https://github.com/o'wner/repo",
    "https://github.com/ownér/repo",
    "https://github.com/own​er/repo",
    `https://github.com/${"a".repeat(40)}/repo`,
    "https://github.com/~owner/repo",
    "https://github.com/..%2F..%2Fadmin/repo",
  ]) {
    assert.equal(b.builderFromRepoUrl(url), null, url);
  }
});

test("GitHub's own pages are not owners", () => {
  for (const url of [
    "https://github.com/orgs/agrarisai/repositories",
    "https://github.com/users/someone/projects",
    "https://github.com/topics/ai-agents",
    "https://github.com/marketplace/actions",
    "https://github.com/sponsors/someone",
    "https://github.com/settings/profile",
  ]) {
    assert.equal(b.builderFromRepoUrl(url), null, url);
  }
});

test("normalizeHandle validates ?u= values", () => {
  assert.equal(b.normalizeHandle("AgrarisAI"), "agrarisai");
  assert.equal(b.normalizeHandle("  some-org "), "some-org");
  for (const bad of [null, undefined, "", " ", "a b", "a_b", "a.b", "<img src=x onerror=alert(1)>", "../x", "x/y", "x?y=1", "x#y", "%61", "a".repeat(40), "orgs", "javascript:alert(1)", "ownér"]) {
    assert.equal(b.normalizeHandle(bad), null, String(bad));
  }
  assert.equal(b.isBuilderHandle("Upper"), false, "isBuilderHandle expects an already lowercased handle");
});

test("profile and GitHub links are only built from valid handles", () => {
  assert.equal(b.githubProfileUrl("agrarisai"), "https://github.com/agrarisai");
  assert.equal(b.builderPageUrl("agrarisai"), "builder.html?u=agrarisai");
  for (const bad of ["", "a b", "x/y", "<x>", "orgs", null]) {
    assert.equal(b.githubProfileUrl(bad), null);
    assert.equal(b.builderPageUrl(bad), null);
  }
});

test("groupByBuilder groups by owner, counts agents and tools, skips non-GitHub", () => {
  const groups = b.groupByBuilder([
    { id: "1", kind: "agent", repo_url: "https://github.com/Alpha/one" },
    { id: "2", kind: "tool", repo_url: "https://github.com/alpha/two" },
    { id: "3", kind: "agent", repo_url: "https://github.com/beta/x" },
    { id: "4", kind: "agent", repo_url: "https://gitlab.com/alpha/three" },
    { id: "5", kind: "tool", repo_url: "https://github.com.evil.com/alpha/x" },
    null,
  ]);
  assert.deepEqual([...groups.keys()].sort(), ["alpha", "beta"]);
  assert.deepEqual({ agents: groups.get("alpha").agents, tools: groups.get("alpha").tools }, { agents: 1, tools: 1 });
  assert.deepEqual(groups.get("alpha").listings.map((l) => l.id), ["1", "2"]);
  assert.equal(b.groupByBuilder(null).size, 0);
});

test("countText", () => {
  assert.equal(b.countText(2, 1), "2 agents · 1 tool");
  assert.equal(b.countText(1, 0), "1 agent");
  assert.equal(b.countText(0, 3), "3 tools");
  assert.equal(b.countText(0, 0), "");
});
