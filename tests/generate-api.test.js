// Tes untuk scripts/generate-api.js. Jalankan dari root repo: node --test
// Tanpa dependensi: Supabase diganti klien tiruan di bawah.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const api = require("../scripts/generate-api.js");

const EXPECTED_FIELDS = [
  "id",
  "kind",
  "name",
  "description",
  "version",
  "repo_url",
  "category",
  "demo_url",
  "contract_address",
  "created_at",
  "approved_at",
  "github_stars",
  "github_updated_at",
  "verified",
  "live_status",
  "live_checked_at",
  "url",
];

// Kolom yang tidak boleh pernah keluar, walaupun ada di baris database.
const SECRET_COLUMNS = {
  approved: true,
  status_token: "5f2b1c9e-0000-4000-8000-000000000001",
  notified_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-02T00:00:00Z",
  live_fail_count: 2,
  agent_edits: [{ changed_fields: ["description"], previous: { description: "old" } }],
};

function row(overrides) {
  return {
    id: "00000000-0000-4000-8000-000000000000",
    kind: "agent",
    name: "Agent",
    description: "Does things",
    version: "1.0.0",
    repo_url: "https://github.com/example/agent",
    category: ["trading"],
    demo_url: null,
    contract_address: null,
    created_at: "2026-09-01T00:00:00Z",
    approved_at: "2026-09-02T00:00:00Z",
    github_stars: 3,
    github_updated_at: "2026-09-03T00:00:00Z",
    verified: false,
    live_status: "up",
    live_checked_at: "2026-10-15T00:00:00Z",
    ...SECRET_COLUMNS,
    ...overrides,
  };
}

// Klien Supabase tiruan: berperilaku seperti service role (melewati RLS,
// jadi baris belum approved ikut terbaca kalau tidak difilter) dan
// mendukung from().select().eq().order().range().
function mockSupabase(rows, { error } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      const q = { table, filters: [], select: null, range: null };
      calls.push(q);
      const builder = {
        select(cols) {
          q.select = cols;
          return builder;
        },
        eq(col, value) {
          q.filters.push([col, value]);
          return builder;
        },
        order() {
          return builder;
        },
        range(from, to) {
          q.range = [from, to];
          return builder;
        },
        then(resolve, reject) {
          if (error) return Promise.resolve({ data: null, error }).then(resolve, reject);
          let data = rows.filter((r) => q.filters.every(([c, v]) => r[c] === v));
          data = data.slice().sort((a, b) => a.id.localeCompare(b.id));
          if (q.range) data = data.slice(q.range[0], q.range[1] + 1);
          // Supabase hanya mengembalikan kolom yang diminta.
          const cols = q.select.split(",").map((s) => s.trim());
          data = data.map((r) => Object.fromEntries(cols.map((c) => [c, r[c]])));
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

async function generate(rows) {
  return api.buildListings(await api.fetchApprovedRows(mockSupabase(rows)));
}

test("PUBLIC_FIELDS is exactly the documented whitelist", () => {
  assert.deepEqual(api.PUBLIC_FIELDS, EXPECTED_FIELDS);
});

test("only whitelisted columns are requested from Supabase", async () => {
  const client = mockSupabase([row({})]);
  await api.fetchApprovedRows(client);
  const requested = client.calls[0].select.split(",").map((s) => s.trim());
  for (const col of requested) {
    assert.ok(EXPECTED_FIELDS.includes(col), `unexpected column requested: ${col}`);
  }
  assert.deepEqual(client.calls[0].filters, [["approved", true]]);
});

test("every listing has exactly the whitelisted fields, even if the row has more", async () => {
  // Baris lengkap (seperti select("*")), termasuk kolom internal.
  const listings = api.buildListings([row({}), row({ id: "00000000-0000-4000-8000-000000000001", kind: "tool" })]);
  for (const listing of listings) {
    assert.deepEqual(Object.keys(listing), EXPECTED_FIELDS);
    for (const secret of Object.keys(SECRET_COLUMNS)) {
      assert.ok(!(secret in listing), `${secret} leaked`);
    }
  }
  const text = api.serialize(api.buildDocument(listings, "2026-10-16T00:00:00.000Z"));
  assert.ok(!text.includes("status_token"));
  assert.ok(!text.includes(SECRET_COLUMNS.status_token));
  assert.ok(!text.includes("notified_at"));
  assert.ok(!text.includes("agent_edits"));
});

test("listings that are not approved are left out", async () => {
  const listings = await generate([
    row({ id: "00000000-0000-4000-8000-00000000000a", name: "Live" }),
    row({ id: "00000000-0000-4000-8000-00000000000b", name: "Pending", approved: false, approved_at: null }),
  ]);
  assert.deepEqual(listings.map((l) => l.name), ["Live"]);
});

test("agents and tools are both included with kind", async () => {
  const listings = await generate([
    row({ id: "00000000-0000-4000-8000-00000000000a", kind: "agent" }),
    row({ id: "00000000-0000-4000-8000-00000000000b", kind: "tool" }),
  ]);
  assert.deepEqual(listings.map((l) => l.kind).sort(), ["agent", "tool"]);
});

test("sorted newest first by coalesce(approved_at, created_at)", async () => {
  const listings = await generate([
    row({ id: "00000000-0000-4000-8000-00000000000a", name: "Old", approved_at: "2026-01-01T00:00:00Z" }),
    row({ id: "00000000-0000-4000-8000-00000000000b", name: "Legacy", approved_at: null, created_at: "2026-05-01T00:00:00Z" }),
    row({ id: "00000000-0000-4000-8000-00000000000c", name: "New", approved_at: "2026-10-01T00:00:00Z" }),
  ]);
  assert.deepEqual(listings.map((l) => l.name), ["New", "Legacy", "Old"]);
});

test("all pages are fetched", async () => {
  const rows = Array.from({ length: 2500 }, (_, i) =>
    row({ id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}` })
  );
  const client = mockSupabase(rows);
  const fetched = await api.fetchApprovedRows(client);
  assert.equal(fetched.length, 2500);
  assert.equal(client.calls.length, 3);
});

test("Supabase errors are thrown", async () => {
  await assert.rejects(
    api.fetchApprovedRows(mockSupabase([], { error: { message: "boom" } })),
    /Failed to read agents table: boom/
  );
});

test("live_status is passed through only as 'up', 'down' or null", () => {
  assert.equal(api.buildListing(row({ live_status: "up" })).live_status, "up");
  assert.equal(api.buildListing(row({ live_status: "down" })).live_status, "down");
  assert.equal(api.buildListing(row({ live_status: null, live_checked_at: null })).live_status, null);
  assert.equal(api.buildListing(row({ live_status: "weird" })).live_status, null);
});

test("url follows the sitemap scheme on agraris.xyz", async () => {
  const [listing] = await generate([row({})]);
  assert.equal(listing.url, "https://agraris.xyz/agent.html?id=00000000-0000-4000-8000-000000000000");
});

test("document shape: schema_version, generated_at, count, listings", async () => {
  const listings = await generate([row({})]);
  const doc = JSON.parse(api.serialize(api.buildDocument(listings, "2026-10-16T00:00:00.000Z")));
  assert.deepEqual(Object.keys(doc), ["schema_version", "generated_at", "count", "listings"]);
  assert.equal(doc.schema_version, 1);
  assert.equal(doc.count, 1);
  assert.ok(!Number.isNaN(Date.parse(doc.generated_at)));
});

test("file is only rewritten when the data changes", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agraris-api-"));
  const out = path.join(dir, "api", "agents.json");
  const listings = await generate([row({})]);

  assert.equal(api.writeIfChanged(out, listings, new Date("2026-10-16T00:00:00Z")), true);
  const first = fs.readFileSync(out, "utf8");
  JSON.parse(first);

  // Data sama, waktu berbeda → file tidak disentuh.
  assert.equal(api.writeIfChanged(out, listings, new Date("2026-10-17T00:00:00Z")), false);
  assert.equal(fs.readFileSync(out, "utf8"), first);

  // Data berubah → ditulis ulang dengan generated_at baru.
  const changed = await generate([row({ github_stars: 4 })]);
  assert.equal(api.writeIfChanged(out, changed, new Date("2026-10-18T00:00:00Z")), true);
  const doc = JSON.parse(fs.readFileSync(out, "utf8"));
  assert.equal(doc.generated_at, "2026-10-18T00:00:00.000Z");
  assert.equal(doc.listings[0].github_stars, 4);

  fs.rmSync(dir, { recursive: true, force: true });
});
