// Tes browser: logo listing (hanya yang punya logo) di daftar dan halaman detail.
// Jalankan dari root repo: NODE_PATH="$(npm root -g)" node tests/browser/listing-logos.e2e.js
// Supabase diganti tiruan; request keluar lainnya diblokir.

const http = require("http");
const fs = require("fs");
const path = require("path");
const assert = require("assert/strict");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..", "..");
const base = { kind: "agent", version: "1.0.0", demo_url: null, created_at: new Date().toISOString(), verified: false, github_stars: null, github_updated_at: null, contract_address: null, live_status: null, live_checked_at: null, approved: true };
const ROWS = [
  { ...base, id: "00000000-0000-4000-8000-0000000000a1", name: "Agent402", repo_url: "https://github.com/MikeyPetrillo/Agent402", description: "500+ pay-per-call tools, metered models, and finished reports for AI agents.", category: ["infrastructure", "payments"] },
  { ...base, id: "00000000-0000-4000-8000-0000000000a2", name: "ScanHood", kind: "tool", repo_url: "https://github.com/scanhood/scanhood", description: "Token safety scanner for Robinhood Chain.", category: ["analytics"] },
];
const MOCK = `
(function () {
  const ROWS = ${JSON.stringify(ROWS)};
  window.__rpc = [];
  function builder() {
    const b = { select() { return b; }, eq() { return b; }, neq() { return b; }, in() { return b; }, order() { return b; }, limit() { return b; }, not() { return b; }, overlaps() { return b; },
      maybeSingle() { b._one = true; return b; }, single() { b._one = true; return b; },
      then(res, rej) { return Promise.resolve({ data: b._one ? ROWS[0] : ROWS, error: null }).then(res, rej); } };
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
  const base_ = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const page = await browser.newPage({ viewport: { width: 430, height: 900 }, deviceScaleFactor: 2 });
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith(base_)) return route.continue();
    if (url.includes("@supabase/supabase-js")) return route.fulfill({ status: 200, contentType: "text/javascript", body: MOCK });
    return route.abort();
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base_}search.html`);
  await page.waitForSelector(".agent-row");
  await page.addStyleTag({ content: ".reveal{opacity:1!important;transform:none!important}" });
  assert.equal(await page.locator("img.agent-logo").count(), 1, "only the listing with a logo shows one");
  assert.equal(await page.locator(".agent-row", { hasText: "ScanHood" }).locator("img").count(), 0);
  await page.waitForFunction(() => [...document.images].every((i) => i.complete));
  assert.ok(await page.evaluate(() => document.querySelector("img.agent-logo").naturalWidth > 0), "logo loads");
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT + "-list.png" });
  await page.goto(`${base_}agent.html?id=00000000-0000-4000-8000-0000000000a1`);
  await page.waitForSelector(".detail-head");
  await page.addStyleTag({ content: ".reveal{opacity:1!important;transform:none!important}" });
  assert.equal(await page.locator(".detail-head img.agent-logo").count(), 1);
  await page.waitForFunction(() => [...document.images].every((i) => i.complete));
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT + "-detail.png" });
  assert.deepEqual(errors, []);
  await browser.close();
  server.close();
  console.log("listing-logos e2e: ok");
})().catch((e) => { console.error(e); process.exit(1); });
