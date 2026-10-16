// Tes browser untuk lencana live check (kartu, halaman detail, status.html,
// filter "Demo responding" di search.html).
//
// Tidak ikut `node --test` (butuh Playwright + Chromium). Jalankan dari
// root repo:
//   NODE_PATH="$(npm root -g)" node tests/browser/live-badge.e2e.js
//
// Supabase diganti tiruan: skrip supabase-js dari CDN dicegat dan diganti
// klien palsu yang membaca data di bawah. Semua request keluar lainnya
// diblokir.

const http = require("http");
const fs = require("fs");
const path = require("path");
const assert = require("assert/strict");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..", "..");
const FORBIDDEN = /\b(verified|safe|trusted|audited)\b/i;
const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();

const ROWS = [
  {
    id: "00000000-0000-4000-8000-0000000000a1", name: "Live Up", kind: "agent",
    description: "up", version: "1.0.0", repo_url: "https://github.com/x/up", category: ["test"],
    demo_url: "https://example.com", created_at: hoursAgo(100), verified: false,
    github_stars: null, github_updated_at: null, contract_address: null,
    live_status: "up", live_checked_at: hoursAgo(3),
  },
  {
    id: "00000000-0000-4000-8000-0000000000a2", name: "Live Down", kind: "tool",
    description: "down", version: "1.0.0", repo_url: "https://github.com/x/down", category: ["test"],
    demo_url: "https://tidak-ada-domain-ini.example", created_at: hoursAgo(90), verified: true,
    github_stars: 5, github_updated_at: hoursAgo(30), contract_address: null,
    live_status: "down", live_checked_at: hoursAgo(5),
  },
  {
    id: "00000000-0000-4000-8000-0000000000a3", name: "Never Checked", kind: "agent",
    description: "null", version: "1.0.0", repo_url: "https://github.com/x/null", category: ["test"],
    demo_url: "https://example.org", created_at: hoursAgo(80), verified: false,
    github_stars: null, github_updated_at: null, contract_address: null,
    live_status: null, live_checked_at: null,
  },
  {
    id: "00000000-0000-4000-8000-0000000000a4", name: "No Demo", kind: "agent",
    description: "nodemo", version: "1.0.0", repo_url: "https://github.com/x/nodemo", category: ["test"],
    // Status left over from an old demo: must still show nothing.
    demo_url: null, created_at: hoursAgo(70), verified: false,
    github_stars: null, github_updated_at: null, contract_address: null,
    live_status: "up", live_checked_at: hoursAgo(1),
  },
];

// Minimal stand-in for window.supabase (supabase-js v2 query builder).
const MOCK_SUPABASE = `
(function () {
  const ROWS = ${JSON.stringify(ROWS)};
  const RPC = {
    get_submission_status: [{ status: "approved", name: "Live Down", id: "${ROWS[1].id}", kind: "tool" }],
  };
  function builder() {
    const filters = [];
    let mode = "many", cols = null, head = false, limit = null;
    const b = {
      select(c, opts) { cols = c; head = !!(opts && opts.head); return b; },
      eq(k, v) { filters.push((r) => r[k] === v); return b; },
      neq(k, v) { filters.push((r) => r[k] !== v); return b; },
      in(k, vs) { filters.push((r) => vs.includes(r[k])); return b; },
      overlaps(k, vs) { filters.push((r) => (r[k] || []).some((x) => vs.includes(x))); return b; },
      contains(k, vs) { filters.push((r) => vs.every((x) => (r[k] || []).includes(x))); return b; },
      ilike() { return b; }, or() { return b; }, order() { return b; }, not() { return b; },
      limit(n) { limit = n; return b; },
      single() { mode = "single"; return b; },
      maybeSingle() { mode = "maybe"; return b; },
      insert() { return Promise.resolve({ error: null }); },
      then(res, rej) {
        let data = ROWS.filter((r) => filters.every((f) => f(r)));
        if (limit) data = data.slice(0, limit);
        if (cols && cols !== "*") {
          const keys = cols.split(",").map((s) => s.trim());
          data = data.map((r) => Object.fromEntries(keys.map((k) => [k, r[k]])));
        }
        let out = { data, error: null, count: data.length };
        if (head) out.data = null;
        if (mode !== "many") {
          out = data[0] || mode === "maybe"
            ? { data: data[0] || null, error: null }
            : { data: null, error: { message: "not found" } };
        }
        return Promise.resolve(out).then(res, rej);
      },
    };
    return b;
  }
  window.supabase = {
    createClient() {
      return {
        from() { return builder(); },
        rpc(name) { return Promise.resolve({ data: RPC[name] || [], error: null }); },
      };
    },
  };
})();
`;

function serve() {
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };
  const server = http.createServer((req, res) => {
    const p = path.join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { "Content-Type": types[path.extname(p)] || "application/octet-stream" });
    fs.createReadStream(p).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

async function liveTexts(page) {
  return page.$$eval(".live-badge, .live-note, .status-live", (els) =>
    els.map((e) => `${e.textContent} ${e.getAttribute("title") || ""}`)
  );
}

async function main() {
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const page = await browser.newPage();
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith(base)) return route.continue();
    if (url.includes("@supabase/supabase-js")) {
      return route.fulfill({ status: 200, contentType: "text/javascript", body: MOCK_SUPABASE });
    }
    return route.abort();
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  // --- cards on search.html
  await page.goto(`${base}search.html`);
  await page.waitForSelector(".agent-row");
  const cardBadges = await page.$$eval(".agent-row", (rows) =>
    rows.map((r) => ({
      name: r.querySelector(".agent-name").textContent,
      badge: r.querySelector(".live-badge")?.textContent.trim() || null,
      state: r.querySelector(".live-badge")?.className || null,
    }))
  );
  const byName = Object.fromEntries(cardBadges.map((c) => [c.name, c]));
  assert.match(byName["Live Up"].badge, /^Responding · checked 3h ago/);
  assert.match(byName["Live Up"].state, /live-badge--up/);
  assert.match(byName["Live Down"].badge, /^Not responding · checked 5h ago/);
  assert.match(byName["Live Down"].state, /live-badge--down/);
  assert.equal(byName["Never Checked"].badge, null, "null status shows nothing");
  assert.equal(byName["No Demo"].badge, null, "no demo_url shows nothing");
  const title = await page.getAttribute(".live-badge--up", "title");
  assert.equal(title, "Only means the demo URL responded. Not an endorsement.");
  for (const t of await liveTexts(page)) assert.doesNotMatch(t, FORBIDDEN, t);

  // "down" is muted amber, not red.
  const downColor = await page.$eval(".live-badge--down", (e) => getComputedStyle(e).color);
  const [r, g, b] = downColor.match(/\d+/g).map(Number);
  assert.ok(!(r > 180 && g < 80 && b < 80), `down badge looks red: ${downColor}`);

  // --- "Demo responding" filter
  await page.check("#live-filter-input");
  const filtered = await page.$$eval(".agent-row .agent-name", (els) => els.map((e) => e.textContent));
  assert.deepEqual(filtered, ["Live Up"]);
  if (process.env.SHOT_DIR) await page.waitForTimeout(1500), await page.screenshot({ path: path.join(process.env.SHOT_DIR, "search.png") });
  await page.uncheck("#live-filter-input");

  // --- detail pages
  for (const [row, expected] of [
    [ROWS[0], /^Responding · checked 3h ago/],
    [ROWS[1], /^Not responding · checked 5h ago/],
    [ROWS[2], null],
    [ROWS[3], null],
  ]) {
    await page.goto(`${base}agent.html?id=${row.id}`);
    await page.waitForSelector(".detail-head");
    const badge = await page.$(".detail-head .live-badge");
    if (expected) {
      assert.match((await badge.textContent()).trim(), expected);
      const note = await page.textContent(".live-note");
      assert.match(note, /Only means the demo URL responded\. Not an endorsement\./);
    } else {
      assert.equal(badge, null, `${row.name}: no badge expected`);
      assert.equal(await page.$(".live-note"), null);
    }
    for (const t of await liveTexts(page)) assert.doesNotMatch(t, FORBIDDEN, t);
    if (row === ROWS[1] && process.env.SHOT_DIR) await page.waitForTimeout(1500), await page.screenshot({ path: path.join(process.env.SHOT_DIR, "detail-down.png") });
  }

  // --- status.html (builder's own listing, approved, demo down)
  await page.goto(`${base}status.html#t=11111111-1111-4111-8111-111111111111`);
  await page.waitForSelector(".status-live");
  const statusText = await page.textContent(".status-live");
  assert.match(statusText, /Demo link: Not responding · checked 5h ago/);
  assert.match(statusText, /did not respond to 3 or more checks in a row/);
  assert.match(statusText, /Not an endorsement/);
  for (const t of await liveTexts(page)) assert.doesNotMatch(t, FORBIDDEN, t);
  if (process.env.SHOT_DIR) await page.waitForTimeout(1500), await page.screenshot({ path: path.join(process.env.SHOT_DIR, "status.png") });

  assert.deepEqual(errors, [], `page errors: ${errors.join("; ")}`);
  await browser.close();
  server.close();
  console.log("live badge browser tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
