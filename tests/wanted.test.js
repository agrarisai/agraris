// Tes untuk scripts/wanted-action.js dan bagian Wanted di
// scripts/review-notify.js. Jalankan dari root repo: node --test
// Tanpa jaringan: fetch global diganti tiruan (Supabase REST + Resend).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const wanted = require("../scripts/wanted-action.js");
const notify = require("../scripts/review-notify.js");

const ID = "2f1c9a7e-1b2c-4d3e-8f90-123456789abc";

// handler(method, table, query, body) → { status, data, contentRange }
function mockFetch(handler) {
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    const u = new URL(url);
    const isResend = u.hostname === "api.resend.com";
    const table = isResend ? "resend" : u.pathname.replace("/rest/v1/", "");
    const query = decodeURIComponent(u.search.slice(1));
    const body = opts.body ? JSON.parse(opts.body) : undefined;
    calls.push({ method: opts.method || "GET", table, query, body });
    const r = handler(opts.method || "GET", table, query, body) || {};
    const status = r.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (h) => (h.toLowerCase() === "content-range" ? r.contentRange || "" : null) },
      text: async () => (r.data === undefined ? "" : JSON.stringify(r.data)),
      json: async () => r.data,
    };
  };
  return calls;
}

function withEnv(extra, fn) {
  const saved = { ...process.env };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agraris-wanted-"));
  const summaryFile = path.join(dir, "summary.md");
  fs.writeFileSync(summaryFile, "");
  Object.assign(process.env, {
    SUPABASE_URL: "https://proj.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    RESEND_API_KEY: "resend-key",
    NOTIFY_EMAIL: "owner@example.com",
    GITHUB_STEP_SUMMARY: summaryFile,
    ...extra,
  });
  const restore = () => {
    process.env = saved;
    fs.rmSync(dir, { recursive: true, force: true });
  };
  return Promise.resolve()
    .then(() => fn(() => fs.readFileSync(summaryFile, "utf8")))
    .finally(restore);
}

// ---------- parseInput ----------

test("parseInput: only list/approve/reject/close", () => {
  assert.throws(() => wanted.parseInput({ WANTED_ACTION: "delete" }), wanted.UsageError);
  assert.throws(() => wanted.parseInput({}), wanted.UsageError);
  assert.deepEqual(wanted.parseInput({ WANTED_ACTION: "list" }), { action: "list", id: "" });
});

test("parseInput: approve/reject/close need a valid uuid", () => {
  for (const action of ["approve", "reject", "close"]) {
    assert.throws(() => wanted.parseInput({ WANTED_ACTION: action }), /butuh id/);
    assert.throws(() => wanted.parseInput({ WANTED_ACTION: action, WANTED_ID: "1; drop table" }), /uuid/);
    assert.deepEqual(wanted.parseInput({ WANTED_ACTION: action, WANTED_ID: ` ${ID.toUpperCase()} ` }), { action, id: ID });
  }
});

test("kind labels are mapped, never echoed", () => {
  assert.equal(wanted.wantedKindLabel("agent"), "Agent");
  assert.equal(wanted.wantedKindLabel("tool"), "Tool");
  assert.equal(wanted.wantedKindLabel("any"), "Any");
  assert.equal(wanted.wantedKindLabel("<script>"), "Any");
});

// ---------- actions ----------

test("approve only touches a pending row", () =>
  withEnv({}, async (readSummary) => {
    const calls = mockFetch((method) =>
      method === "PATCH" ? { data: [{ id: ID, title: "Order book MCP", kind: "tool" }] } : { data: [] }
    );
    await wanted.main({ WANTED_ACTION: "approve", WANTED_ID: ID });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, "PATCH");
    assert.equal(calls[0].table, "wanted");
    assert.match(calls[0].query, new RegExp(`id=eq\\.${ID}`));
    assert.match(calls[0].query, /approved=eq\.false/);
    assert.deepEqual(calls[0].body, { approved: true });
    assert.match(readSummary(), /Wanted queue: approved/);
  }));

test("reject deletes only a pending row", () =>
  withEnv({}, async () => {
    const calls = mockFetch((method) => (method === "DELETE" ? { data: [{ id: ID, title: "x", kind: "any" }] } : { data: [] }));
    await wanted.main({ WANTED_ACTION: "reject", WANTED_ID: ID });
    assert.equal(calls[0].method, "DELETE");
    assert.match(calls[0].query, /approved=eq\.false/);
  }));

test("close only touches an approved, open row", () =>
  withEnv({}, async () => {
    const calls = mockFetch((method) => (method === "PATCH" ? { data: [{ id: ID, title: "x", kind: "agent" }] } : { data: [] }));
    await wanted.main({ WANTED_ACTION: "close", WANTED_ID: ID });
    assert.equal(calls[0].method, "PATCH");
    assert.match(calls[0].query, /approved=eq\.true/);
    assert.match(calls[0].query, /closed=eq\.false/);
    assert.deepEqual(calls[0].body, { closed: true });
  }));

test("an action that changes nothing fails with the current state", () =>
  withEnv({}, async () => {
    mockFetch((method) =>
      method === "GET" ? { data: [{ id: ID, title: "x", kind: "any", approved: true, closed: false }] } : { data: [] }
    );
    await assert.rejects(wanted.main({ WANTED_ACTION: "approve", WANTED_ID: ID }), /berstatus approved/);
    mockFetch(() => ({ data: [] }));
    await assert.rejects(wanted.main({ WANTED_ACTION: "close", WANTED_ID: ID }), /Tidak ada permintaan dengan id itu/);
  }));

test("list writes pending and open requests, with sender text defanged", () =>
  withEnv({}, async (readSummary) => {
    mockFetch((method, table, query) => {
      if (query.includes("approved=eq.false")) {
        return { data: [{ id: ID, title: "Need bot for evil.com | [x](y)", description: "desc", kind: "tool", created_at: "2026-10-19T00:00:00Z" }] };
      }
      return { data: [] };
    });
    await wanted.main({ WANTED_ACTION: "list" });
    const md = readSummary();
    assert.match(md, /1 permintaan menunggu review/);
    assert.ok(md.includes("evil\\[\\.\\]com"), "domain is defanged");
    assert.doesNotMatch(md, /evil\.com/);
    assert.doesNotMatch(md, /\[x\]\(y\)/);
    assert.match(md, /\| Tool \|/);
  }));

// ---------- review-notify: wanted email ----------

test("notifyWanted: nothing pending → no email", () =>
  withEnv({}, async () => {
    const calls = mockFetch(() => ({ data: [], contentRange: "*/0" }));
    assert.equal(await notify.notifyWanted(), true);
    assert.equal(calls.filter((c) => c.table === "resend").length, 0);
  }));

test("notifyWanted: email first, then mark only the listed rows", () =>
  withEnv({}, async () => {
    const row = { id: ID, title: "Wallet tracker agent", description: "Watch t.me/x for changes", kind: "agent", created_at: "2026-10-19T01:02:00Z" };
    const calls = mockFetch((method, table) => {
      if (table === "resend") return { data: { id: "email-1" } };
      if (method === "GET") return { data: [row], contentRange: "0-0/1" };
      return { data: [{ id: ID }] };
    });
    assert.equal(await notify.notifyWanted(), true);
    const order = calls.map((c) => `${c.method} ${c.table}`);
    assert.deepEqual(order, ["GET wanted", "POST resend", "PATCH wanted"]);
    assert.match(calls[0].query, /approved=eq\.false/);
    assert.match(calls[0].query, /notified_at=is\.null/);
    assert.match(calls[2].query, new RegExp(`id=in\\.\\(${ID}\\)`));
    assert.match(calls[2].query, /approved=eq\.false/);
    assert.ok(calls[2].body.notified_at);
    const email = calls[1].body;
    assert.deepEqual(email.to, ["owner@example.com"]);
    assert.match(email.subject, /1 permintaan Wanted/);
    assert.match(email.text, /Wallet tracker agent/);
    assert.match(email.text, /Jenis: Agent/);
    assert.match(email.text, /t\[\.\]me/);
    assert.match(email.text, /wanted-queue\.yml/);
  }));

test("notifyWanted: Resend failure → rows are not marked", () =>
  withEnv({}, async () => {
    const calls = mockFetch((method, table) => {
      if (table === "resend") return { status: 500, data: { message: "down" } };
      return { data: [{ id: ID, title: "t", description: "d", kind: "any", created_at: "2026-10-19T00:00:00Z" }], contentRange: "0-0/1" };
    });
    const origError = console.error;
    console.error = () => {};
    try {
      assert.equal(await notify.notifyWanted(), false);
    } finally {
      console.error = origError;
    }
    assert.equal(calls.filter((c) => c.method === "PATCH").length, 0);
  }));

test("wanted email text never contains words the board avoids", () => {
  const text = notify.buildWantedText([{ id: ID, title: "t", description: "d", kind: "tool", created_at: "2026-10-19T00:00:00Z" }], 1);
  assert.doesNotMatch(text, /\b(price|token|trending|hot|best|verified)\b/i);
});
