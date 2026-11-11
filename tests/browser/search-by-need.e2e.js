// Tes browser: pencarian berdasarkan kebutuhan, log pencarian kosong, form
// Wanted yang terisi, dan papan "Unmet needs this week".
// Jalankan dari root repo: NODE_PATH="$(npm root -g)" node tests/browser/search-by-need.e2e.js
// Supabase diganti tiruan; request keluar lainnya diblokir.

const http = require("http");
const fs = require("fs");
const path = require("path");
const assert = require("assert/strict");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..", "..");
const ROWS = [
  { id: "00000000-0000-4000-8000-0000000000a1", name: "Wallet Watcher", kind: "agent", description: "Tracks wallet movements and sends alerts.", version: "1.0.0", repo_url: "https://github.com/x/w", category: ["monitoring"], demo_url: null, created_at: new Date().toISOString(), verified: false, github_stars: null, github_updated_at: null, contract_address: null, live_status: null, live_checked_at: null },
];
const MOCK = `
(function () {
  const ROWS = ${JSON.stringify(ROWS)};
  window.__rpc = [];
  function builder() {
    const b = { select() { return b; }, eq() { return b; }, neq() { return b; }, in() { return b; }, order() { return b; }, limit() { return b; }, not() { return b; }, overlaps() { return b; },
      maybeSingle() { return b; }, single() { return b; },
      then(res, rej) { return Promise.resolve({ data: ROWS, error: null }).then(res, rej); } };
    return b;
  }
  window.supabase = { createClient() { return {
    from() { return builder(); },
    rpc(name, args) {
      window.__rpc.push([name, args]);
      if (name === "get_unmet_needs") return Promise.resolve({ data: [{ term: "tax report generator", searches: 14 }, { term: "airdrop checker", searches: 7 }], error: null });
      return Promise.resolve({ data: [], error: null });
    } }; } };
})();`;

function serve() {
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };
  const server = http.createServer((req, res) => {
    const p = path.join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "Content-Type": types[path.extname(p)] || "application/octet-stream" });
    fs.createReadStream(p).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

(async () => {
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const page = await browser.newPage();
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith(base)) return route.continue();
    if (url.includes("@supabase/supabase-js")) return route.fulfill({ status: 200, contentType: "text/javascript", body: MOCK });
    return route.abort();
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto(`${base}search.html`);
  await page.waitForSelector(".agent-row");

  // Words, not an exact phrase: matches and says why.
  await page.fill("#search-input", "monitor wallet activity");
  await page.waitForSelector(".why");
  assert.match(await page.textContent(".why"), /Matches: “monitor”, “wallet”/);

  // Nothing found: Wanted CTA with the phrase, and one logged miss.
  await page.fill("#search-input", "tax report generator");
  await page.waitForSelector("a[href^='wanted.html?title=']");
  assert.match(await page.getAttribute("a[href^='wanted.html?title=']", "href"), /title=tax%20report%20generator#wanted-form-section/);
  await page.waitForTimeout(2300);
  const logs = await page.evaluate(() => window.__rpc.filter((c) => c[0] === "log_search_miss"));
  assert.equal(logs.length, 1);
  assert.equal(logs[0][1].p_term, "tax report generator");
  assert.match(logs[0][1].p_visitor, /^[0-9a-f]{24}$/);

  // A wallet address is never sent.
  await page.fill("#search-input", "0x467b7a85f55bd716cb16d59f63b8ccac08852a6c");
  await page.waitForTimeout(2300);
  assert.equal((await page.evaluate(() => window.__rpc.filter((c) => c[0] === "log_search_miss"))).length, 1);

  // Wanted: form prefilled and board shown.
  await page.goto(`${base}wanted.html?title=tax%20report%20generator`);
  await page.waitForSelector("#unmet-section:not([hidden])");
  assert.equal(await page.inputValue("#wanted-title"), "tax report generator");
  assert.equal(await page.locator("#unmet-list .agent-row").count(), 2);
  assert.match(await page.textContent("#unmet-list .agent-row"), /14 searches this week/);

  assert.deepEqual(errors, []);
  await browser.close();
  server.close();
  console.log("search-by-need e2e: ok");
})().catch((e) => { console.error(e); process.exit(1); });
