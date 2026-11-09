// Tes untuk scripts/subscriber-mail.js dan scripts/send-subscriber-emails.js.
// Tanpa jaringan: fetch global diganti tiruan (Supabase REST + Resend).

const test = require("node:test");
const assert = require("node:assert/strict");

const mail = require("../scripts/subscriber-mail.js");
const send = require("../scripts/send-subscriber-emails.js");

const TOKEN = "2f1c9a7e-1b2c-4d3e-8f90-123456789abc";
const ID1 = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";

function mockFetch(handler) {
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    const u = new URL(url);
    const isResend = u.hostname === "api.resend.com";
    const table = isResend ? "resend" + u.pathname.replace("/emails", "") : u.pathname.replace("/rest/v1/", "");
    const query = decodeURIComponent(u.search.slice(1));
    const body = opts.body ? JSON.parse(opts.body) : undefined;
    calls.push({ method: opts.method || "GET", table, query, body });
    const r = handler(opts.method || "GET", table, query, body) || {};
    const status = r.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      text: async () => (r.data === undefined ? "" : JSON.stringify(r.data)),
      json: async () => r.data,
    };
  };
  return calls;
}

function withEnv(fn) {
  const saved = { ...process.env };
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  process.env.RESEND_API_KEY = "resend";
  delete process.env.DRY_RUN;
  const savedCode = process.exitCode;
  return fn().finally(() => {
    process.env = saved;
    process.exitCode = savedCode;
  });
}

test("confirm email links to follow.html with the token", () => {
  const m = mail.buildConfirmEmail(TOKEN);
  assert.ok(m.text.includes(`follow.html?a=confirm&t=${TOKEN}`));
  assert.ok(m.html.includes(`follow.html?a=confirm&amp;t=${TOKEN}`));
  assert.throws(() => mail.buildConfirmEmail("not-a-token"));
});

test("digest email escapes listing text and has unsubscribe, no token/price words", () => {
  const m = mail.buildDigestEmail({
    token: TOKEN,
    newListings: [{ id: ID1, name: "<b>Bad</b>", kind: "tool", description: "x & y" }],
    mostActive: [{ id: ID2, name: "Busy", c7: 12 }],
  });
  assert.ok(!m.html.includes("<b>Bad</b>"));
  assert.ok(m.html.includes("&lt;b&gt;Bad&lt;/b&gt;"));
  assert.ok(m.text.includes(`follow.html?a=unsub&t=${TOKEN}`));
  assert.ok(m.text.includes("12 commits"));
  assert.ok(m.text.includes("not an endorsement"));
  assert.ok(!/price|token|\$/i.test(m.text.replace(/follow\.html\?a=unsub&t=[0-9a-f-]+/, "")));
});

test("confirm run marks confirm_sent_at only for emails that were sent", () =>
  withEnv(async () => {
    const calls = mockFetch((method, table, query, body) => {
      if (table === "subscribers" && method === "GET")
        return { data: [{ id: ID1, email: "a@example.com", token: TOKEN }, { id: ID2, email: "b@example.com", token: TOKEN }] };
      if (table === "resend") return body.to[0] === "b@example.com" ? { status: 500, data: { message: "boom" } } : { data: {} };
      return { data: [] };
    });
    await send.runConfirm(false);
    const patches = calls.filter((c) => c.method === "PATCH");
    assert.equal(patches.length, 1);
    assert.ok(patches[0].query.includes(ID1));
    assert.ok(patches[0].body.confirm_sent_at);
    assert.equal(process.exitCode, 1);
  }));

test("digest run skips when nothing to report", () =>
  withEnv(async () => {
    const calls = mockFetch(() => ({ data: [] }));
    await send.runDigest(false);
    assert.equal(calls.filter((c) => c.table.startsWith("resend")).length, 0);
    assert.equal(calls.filter((c) => c.table === "subscribers").length, 0);
  }));

test("digest run sends one batch with per-recipient unsubscribe and marks last_sent_at", () =>
  withEnv(async () => {
    const calls = mockFetch((method, table, query, body) => {
      if (table === "agents" && /approved_at=gte/.test(query))
        return { data: [{ id: ID1, name: "New one", kind: "agent", description: "d" }] };
      if (table === "agents") return { data: [{ id: ID2, name: "Busy", github_activity: { c7: 9, d: [0, 0, 0, 0, 0, 0, 9], last: null } }] };
      if (table === "subscribers" && method === "GET")
        return { data: [{ id: ID1, email: "a@example.com", token: TOKEN }] };
      return { data: {} };
    });
    await send.runDigest(false);
    const batch = calls.find((c) => c.table === "resend/batch");
    assert.equal(batch.body.length, 1);
    assert.ok(batch.body[0].headers["List-Unsubscribe"].includes(`a=unsub&t=${TOKEN}`));
    const patch = calls.find((c) => c.method === "PATCH");
    assert.ok(patch.body.last_sent_at);
  }));

test("dry run sends nothing and changes nothing", () =>
  withEnv(async () => {
    const calls = mockFetch((method, table) => {
      if (table === "agents") return { data: [] };
      return { data: [{ id: ID1, email: "a@example.com", token: TOKEN }] };
    });
    await send.runConfirm(true);
    assert.equal(calls.filter((c) => c.table.startsWith("resend") || c.method === "PATCH").length, 0);
  }));

test("digest descriptions are cut at a word boundary", () => {
  const long = "Read-only MCP server that lets AI agents search the Agraris registry of agents and tools on Robinhood Chain. Tools: search_listings, get_listing, list_categories, most_active.";
  const m = mail.buildDigestEmail({
    token: TOKEN,
    newListings: [{ id: ID1, name: "x", kind: "tool", description: long }],
    mostActive: [],
  });
  const line = m.text.split("\n").find((l) => l.includes("Read-only"));
  assert.ok(line.endsWith("…"));
  assert.ok(!line.includes("list_categori…"));
});

test("digest shows 100+ for a repo at the 100-commit counter cap", () => {
  const m = mail.buildDigestEmail({
    token: TOKEN,
    newListings: [],
    mostActive: [{ id: ID2, name: "Capped", c7: 100 }, { id: ID1, name: "Under", c7: 99 }],
  });
  assert.ok(m.text.includes("100+ commits"));
  assert.ok(m.html.includes("100+ commits"));
  assert.ok(m.text.includes("99 commits"));
});
