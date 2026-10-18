// Tes browser untuk "Recently updated" (bagian di home + urutan di
// search.html).
//
// Tidak ikut `node --test` (butuh Playwright + Chromium). Jalankan dari
// root repo:
//   NODE_PATH="$(npm root -g)" node tests/browser/recently-updated.e2e.js
//
// Supabase diganti tiruan (skrip supabase-js dari CDN dicegat). RPC
// get_recently_updated mengembalikan baris yang ditentukan tiap skenario;
// aturan 30 hari / approved / satu baris per listing diuji di sisi SQL
// (tests/sql/run-recently-updated.sh).

const http = require("http");
const fs = require("fs");
const path = require("path");
const assert = require("assert/strict");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..", "..");
const FORBIDDEN = /\b(trending|hot|best|verified|undefined|null|NaN)\b/i;
const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const LISTINGS = [1, 2, 3, 4, 5, 6, 7].map((n) => ({
  id: id(n), name: `Listing ${n}`, kind: n % 3 === 0 ? "tool" : "agent",
  description: "d", version: "1", repo_url: "https://github.com/x/y", category: ["t"],
  demo_url: null, created_at: hoursAgo(n * 24), verified: false, github_stars: null,
  github_updated_at: null, contract_address: null, live_status: null, live_checked_at: null,
}));

function mockSupabase(rpc) {
  return `(function () {
  const ROWS = ${JSON.stringify(LISTINGS)};
  const RPC = ${JSON.stringify(rpc)};
  function builder() {
    const f = []; let head = false, limit = null;
    const q = {
      select(c, o) { head = !!(o && o.head); return q; },
      eq(k, v) { f.push((r) => r[k] === v); return q; },
      neq() { return q; }, in() { return q; }, overlaps() { return q; }, contains() { return q; },
      ilike() { return q; }, or() { return q; }, order() { return q; }, not() { return q; },
      limit(n) { limit = n; return q; }, single() { return q; }, maybeSingle() { return q; },
      then(res, rej) {
        let d = ROWS.filter((r) => f.every((fn) => fn(r)));
        const count = d.length;
        if (limit) d = d.slice(0, limit);
        return Promise.resolve({ data: head ? null : d, count, error: null }).then(res, rej);
      },
    };
    return q;
  }
  window.__rpcCalls = [];
  window.supabase = { createClient() { return {
    from() { return builder(); },
    rpc(name, args) {
      window.__rpcCalls.push([name, args]);
      if (name !== "get_recently_updated") return Promise.resolve({ data: [], error: null });
      if (RPC.mode === "error") return Promise.resolve({ data: null, error: { message: "function not found", code: "PGRST202" } });
      if (RPC.mode === "throw") return Promise.reject(new TypeError("Failed to fetch"));
      return Promise.resolve({ data: RPC.rows, error: null });
    },
  }; } };
})();`;
}

function serve() {
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };
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

async function main() {
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

  async function open(file, rpc, width = 1100) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const problems = [];
    page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      // Requests to outside hosts are aborted on purpose; only console
      // output from our own code matters here.
      if (m.type() === "error" && !/Failed to load resource|ERR_FAILED/.test(m.text())) {
        problems.push(`console: ${m.text()}`);
      }
    });
    await page.route("**/*", (route) => {
      const url = route.request().url();
      if (url.startsWith(base)) return route.continue();
      if (url.includes("@supabase/supabase-js")) {
        return route.fulfill({ status: 200, contentType: "text/javascript", body: mockSupabase(rpc) });
      }
      return route.abort();
    });
    await page.goto(base + file);
    await page.waitForTimeout(700);
    return { page, problems };
  }

  async function homeSection(rpc, width) {
    const { page, problems } = await open("index.html", rpc, width);
    const hidden = await page.$eval("#recent-updates-section", (e) => e.hidden);
    const rows = await page.$$eval("#recent-updates-list li", (lis) =>
      lis.map((li) => ({
        name: li.querySelector(".recent-update-name").textContent,
        kind: li.querySelector(".kind-badge").textContent,
        time: li.querySelector(".recent-update-time").textContent,
        href: li.querySelector("a").getAttribute("href"),
      }))
    );
    const text = await page.$eval("#recent-updates-section", (e) => e.textContent);
    const calls = await page.evaluate(() => window.__rpcCalls);
    return { page, problems, hidden, rows, text, calls };
  }

  // 0 edits → hidden
  let r = await homeSection({ rows: [] });
  assert.equal(r.hidden, true, "hidden with 0 rows");
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.calls.find((c) => c[0] === "get_recently_updated")[1], { p_limit: 5 });
  await r.page.close();

  // 1 edit
  r = await homeSection({ rows: [{ id: id(2), name: "Listing 2", kind: "agent", last_edited_at: hoursAgo(3) }] });
  assert.equal(r.hidden, false);
  assert.deepEqual(r.rows, [{ name: "Listing 2", kind: "Agent", time: "Updated 3 hours ago", href: `agent.html?id=${id(2)}` }]);
  assert.deepEqual(r.problems, []);
  await r.page.close();

  // several listings (incl. a tool), more than 5 returned → only 5 shown,
  // in the order given, no rank numbers, neutral words only
  const many = [
    { id: id(3), name: "Listing 3", kind: "tool", last_edited_at: hoursAgo(1) },
    { id: id(1), name: "Listing 1", kind: "agent", last_edited_at: hoursAgo(5) },
    { id: id(4), name: "Listing 4", kind: "agent", last_edited_at: hoursAgo(30) },
    { id: id(5), name: "Listing 5", kind: "agent", last_edited_at: hoursAgo(80) },
    { id: id(6), name: "Listing 6", kind: "tool", last_edited_at: hoursAgo(200) },
    { id: id(7), name: "Listing 7", kind: "agent", last_edited_at: hoursAgo(300) },
  ];
  r = await homeSection({ rows: many });
  assert.deepEqual(r.rows.map((x) => x.name), ["Listing 3", "Listing 1", "Listing 4", "Listing 5", "Listing 6"]);
  assert.deepEqual(r.rows.map((x) => x.kind), ["Tool", "Agent", "Agent", "Agent", "Tool"]);
  assert.equal(r.rows[2].time, "Updated 1 day ago");
  assert.doesNotMatch(r.text, FORBIDDEN);
  assert.doesNotMatch(r.text, /#\d/, "no rank numbers");
  assert.deepEqual(r.problems, []);
  await r.page.close();

  // bad rows are dropped instead of printing "undefined"
  r = await homeSection({ rows: [{ id: id(1), name: "Listing 1", kind: "agent", last_edited_at: "nope" }, { id: null, name: "x", last_edited_at: hoursAgo(1) }] });
  assert.equal(r.hidden, true);
  assert.deepEqual(r.problems, []);
  await r.page.close();

  // RPC returns an error (e.g. migration not run) / network failure → hidden, quiet
  for (const mode of ["error", "throw"]) {
    r = await homeSection({ mode });
    assert.equal(r.hidden, true, `hidden on ${mode}`);
    assert.deepEqual(r.problems, [], `no console errors on ${mode}`);
    assert.doesNotMatch(await r.page.textContent("body"), /\bundefined\b/);
    await r.page.close();
  }

  // phone widths: no horizontal scroll, rows inside the viewport
  for (const width of [320, 375]) {
    r = await homeSection({ rows: [{ id: id(1), name: "A rather long listing name that has to wrap on a phone", kind: "tool", last_edited_at: hoursAgo(2) }, ...many.slice(0, 4)] }, width);
    const layout = await r.page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      iw: window.innerWidth,
      rights: [...document.querySelectorAll("#recent-updates-list li, #recent-updates-list li *")].map((e) => e.getBoundingClientRect().right),
    }));
    assert.ok(layout.sw <= layout.iw, `horizontal scroll at ${width}px`);
    assert.ok(layout.rights.every((x) => x <= width), `element outside viewport at ${width}px`);
    if (process.env.SHOT_DIR) {
      await r.page.locator("#recent-updates-section").scrollIntoViewIfNeeded();
      await r.page.waitForTimeout(400);
      await r.page.screenshot({ path: path.join(process.env.SHOT_DIR, `recently-updated-${width}.png`) });
    }
    await r.page.close();
  }

  // search.html: "Recently updated" sort
  const searchRpc = { rows: [
    { id: id(5), name: "Listing 5", kind: "agent", last_edited_at: hoursAgo(1) },
    { id: id(2), name: "Listing 2", kind: "agent", last_edited_at: hoursAgo(10) },
  ] };
  let { page, problems } = await open("search.html", searchRpc);
  await page.waitForSelector(".agent-row");
  let calls = await page.evaluate(() => window.__rpcCalls);
  assert.equal(calls.length, 0, "no RPC until the sort is picked");
  await page.selectOption("#sort-input", "updated");
  await page.waitForTimeout(300);
  let names = await page.$$eval(".agent-row .agent-name", (els) => els.map((e) => e.textContent));
  // edited first (latest edit on top), then the rest newest first
  assert.deepEqual(names, ["Listing 5", "Listing 2", "Listing 1", "Listing 3", "Listing 4", "Listing 6", "Listing 7"]);
  calls = await page.evaluate(() => window.__rpcCalls);
  assert.deepEqual(calls, [["get_recently_updated", { p_limit: 20 }]]);
  // switching away and back does not call again
  await page.selectOption("#sort-input", "newest");
  await page.selectOption("#sort-input", "updated");
  assert.equal((await page.evaluate(() => window.__rpcCalls)).length, 1);
  assert.deepEqual(problems, []);
  await page.close();

  // search sort when the RPC fails → plain newest order, no errors
  ({ page, problems } = await open("search.html", { mode: "error" }));
  await page.waitForSelector(".agent-row");
  await page.selectOption("#sort-input", "updated");
  await page.waitForTimeout(300);
  names = await page.$$eval(".agent-row .agent-name", (els) => els.map((e) => e.textContent));
  assert.deepEqual(names, LISTINGS.map((l) => l.name));
  assert.deepEqual(problems, []);
  await page.close();

  await browser.close();
  server.close();
  console.log("recently updated browser tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
