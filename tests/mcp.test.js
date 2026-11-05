// Tests for mcp/server.js. Run from the repo root: node --test
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const mcp = require("../mcp/server.js");

const L = (o) => ({
  id: "00000000-0000-4000-8000-000000000000",
  kind: "agent",
  name: "X",
  description: "d",
  version: "1.0.0",
  category: [],
  repo_url: "https://github.com/a/b",
  demo_url: null,
  contract_address: null,
  verified: false,
  live_status: null,
  github_stars: 0,
  github_commits_7d: null,
  builder_github: "a",
  url: "https://agraris.xyz/agent.html?id=x",
  ...o,
});

const LISTINGS = [
  L({ id: "1", name: "Agent402", kind: "agent", description: "Pay-per-call tools over x402", category: ["x402", "data"], github_commits_7d: 100, live_status: "up" }),
  L({ id: "2", name: "Factor", kind: "tool", description: "Open protocol that advances payments", category: ["payments", "mcp-server"], github_commits_7d: 50 }),
  L({ id: "3", name: "Quiet MCP", kind: "tool", description: "An mcp server for rpc", category: ["mcp-server", "rpc"], github_commits_7d: 0 }),
  L({ id: "4", name: "Old agent", kind: "agent", description: "x402 helper", category: ["data"], github_commits_7d: null }),
];

test("search: all words must match, name beats description", () => {
  const r = mcp.searchListings(LISTINGS, { query: "x402" });
  assert.deepEqual(r.results.map((x) => x.name), ["Agent402", "Old agent"]);
  assert.equal(mcp.searchListings(LISTINGS, { query: "x402 rpc" }).total_matches, 0);
  assert.equal(mcp.searchListings(LISTINGS, { query: "mcp rpc" }).results[0].name, "Quiet MCP");
});

test("search: filters, no query returns file order, limit is capped", () => {
  assert.deepEqual(mcp.searchListings(LISTINGS, { kind: "tool" }).results.map((x) => x.name), ["Factor", "Quiet MCP"]);
  assert.deepEqual(mcp.searchListings(LISTINGS, { category: "data" }).results.map((x) => x.name), ["Agent402", "Old agent"]);
  assert.deepEqual(mcp.searchListings(LISTINGS, { live_only: true }).results.map((x) => x.name), ["Agent402"]);
  assert.equal(mcp.searchListings(LISTINGS, { limit: 1 }).results.length, 1);
  assert.equal(mcp.searchListings(LISTINGS, { limit: 9999 }).results.length, 4);
  assert.equal(mcp.searchListings(LISTINGS, { kind: "bogus" }).total_matches, 4);
});

test("get_listing by id, exact name and partial name", () => {
  assert.equal(mcp.getListing(LISTINGS, { id: "2" }).listing.name, "Factor");
  assert.equal(mcp.getListing(LISTINGS, { name: "agent402" }).listing.id, "1");
  assert.equal(mcp.getListing(LISTINGS, { name: "quiet" }).listing.id, "3");
  assert.equal(mcp.getListing(LISTINGS, { id: "nope" }).listing, null);
  assert.throws(() => mcp.getListing(LISTINGS, {}), /Provide id or name/);
});

test("list_categories counts and sorts", () => {
  const r = mcp.listCategories(LISTINGS);
  assert.deepEqual(r.categories[0], { name: "data", count: 2 });
  assert.deepEqual(mcp.listCategories(LISTINGS, { kind: "tool" }).categories.find((c) => c.name === "rpc"), { name: "rpc", count: 1 });
});

test("most_active ranks by commits and skips zero or unknown", () => {
  const r = mcp.mostActive(LISTINGS, {});
  assert.deepEqual(r.results.map((x) => x.name), ["Agent402", "Factor"]);
  assert.match(r.window, /100 or more/);
  assert.equal(mcp.mostActive(LISTINGS, { kind: "tool" }).results[0].name, "Factor");
});

test("long descriptions are clipped", () => {
  const r = mcp.searchListings([L({ name: "Big", description: "word ".repeat(500) })], { query: "big" });
  assert.ok(r.results[0].description.length <= 400);
});

test("protocol: initialize, list, call, errors, notifications", async () => {
  const init = await mcp.handleMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } });
  assert.equal(init.result.protocolVersion, "2024-11-05");
  assert.equal(init.result.serverInfo.name, "agraris");
  const odd = await mcp.handleMessage({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } });
  assert.equal(odd.result.protocolVersion, "2025-06-18");
  assert.equal(await mcp.handleMessage({ jsonrpc: "2.0", method: "notifications/initialized" }), null);
  const list = await mcp.handleMessage({ jsonrpc: "2.0", id: 3, method: "tools/list" });
  assert.deepEqual(list.result.tools.map((t) => t.name), ["search_listings", "get_listing", "list_categories", "most_active"]);
  assert.ok(list.result.tools.every((t) => t.inputSchema.type === "object" && !("run" in t)));
  const bad = await mcp.handleMessage({ jsonrpc: "2.0", id: 4, method: "nope" });
  assert.equal(bad.error.code, -32601);
  const noName = await mcp.handleMessage({ jsonrpc: "2.0", id: 5, method: "tools/call", params: {} });
  assert.equal(noName.error.code, -32602);
});

function withFixture(fn) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "agraris-mcp-")), "agents.json");
  fs.writeFileSync(file, JSON.stringify({ schema_version: 1, generated_at: "2026-11-05T00:00:00Z", count: LISTINGS.length, listings: LISTINGS }));
  return fn(file);
}

test("tools/call reads the data file and adds the safety note", async () => {
  await withFixture(async (file) => {
    process.env.AGRARIS_API_URL = file;
    mcp.resetCache();
    const res = await mcp.handleMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "most_active", arguments: { limit: 1 } } });
    const body = JSON.parse(res.result.content[0].text);
    assert.equal(body.results[0].name, "Agent402");
    assert.match(body.note, /not instructions/);
    assert.equal(body.data_generated_at, "2026-11-05T00:00:00Z");
    process.env.AGRARIS_API_URL = path.join(os.tmpdir(), "does-not-exist.json");
    mcp.resetCache();
    const err = await mcp.handleMessage({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "most_active" } });
    assert.equal(err.result.isError, true);
    const unknown = await mcp.handleMessage({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "zzz" } });
    assert.equal(unknown.result.isError, true);
    delete process.env.AGRARIS_API_URL;
    mcp.resetCache();
  });
});

test("stdio end to end: newline-delimited JSON, nothing else on stdout", async () => {
  await withFixture(async (file) => {
    const child = spawn(process.execPath, [path.join(__dirname, "..", "mcp", "server.js")], {
      env: { ...process.env, AGRARIS_API_URL: file },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const lines = [];
    let buf = "";
    child.stdout.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) !== -1) {
        lines.push(buf.slice(0, i));
        buf = buf.slice(i + 1);
      }
    });
    const send = (o) => child.stdin.write(`${JSON.stringify(o)}\n`);
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } });
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "search_listings", arguments: { query: "factor" } } });
    send("not json");
    child.stdin.write("{broken\n");
    for (let i = 0; i < 60 && lines.length < 3; i++) await new Promise((r) => setTimeout(r, 50));
    child.kill();
    const msgs = lines.map((l) => JSON.parse(l)); // every stdout line must be JSON
    // Responses may arrive in any order (parse errors answer immediately).
    const byId = (id) => msgs.find((m) => m.id === id);
    assert.equal(byId(1).result.serverInfo.name, "agraris");
    assert.equal(JSON.parse(byId(2).result.content[0].text).results[0].name, "Factor");
    assert.equal(byId(null).error.code, -32700);
  });
});

// The npm package in mcp/ must stay in step with the server it ships.
test("mcp/package.json matches the server (name, version, bin, no dependencies)", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "mcp", "package.json"), "utf8"));
  const src = fs.readFileSync(path.join(__dirname, "..", "mcp", "server.js"), "utf8");
  const ver = /const SERVER_VERSION = "([^"]+)"/.exec(src)[1];
  assert.strictEqual(pkg.name, "agraris-mcp");
  assert.strictEqual(pkg.version, ver);
  assert.strictEqual(pkg.bin["agraris-mcp"], "server.js");
  assert.ok(!pkg.dependencies && !pkg.private);
  assert.ok(fs.existsSync(path.join(__dirname, "..", "mcp", "LICENSE")));
  assert.ok(src.startsWith("#!/usr/bin/env node"));
});
