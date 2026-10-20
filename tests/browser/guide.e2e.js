// Tes browser untuk guide.html ("Build your first agent on Robinhood
// Chain"): tombol Copy checklist (clipboard dan cadangan pilih-teks),
// tautan, menu "Guide" di semua halaman, tautan dari docs.html dan
// wanted.html, sitemap, kata yang dihindari, dan lebar 320/375px.
//
// Tidak ikut `node --test` (butuh Playwright + Chromium). Jalankan dari
// root repo:
//   NODE_PATH="$(npm root -g)" node tests/browser/guide.e2e.js

const http = require("http");
const fs = require("fs");
const path = require("path");
const assert = require("assert/strict");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..", "..");
const FORBIDDEN = /\b(price|prices|token|tokens|trending|best|verified|recommended|guarantee|guaranteed)\b/i;

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

// Minimal window.supabase so app.js loads; the guide makes no queries.
const MOCK_SUPABASE = `window.supabase = { createClient() { const q = { select() { return q; }, eq() { return q; }, order() { return q; }, limit() { return q; }, then(r) { return Promise.resolve({ data: [], error: null, count: 0 }).then(r); } }; return { from() { return q; }, rpc() { return Promise.resolve({ data: [], error: null }); } }; } };`;

async function main() {
  // --- static checks
  const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
  const menuPages = fs.readdirSync(ROOT).filter((f) => f.endsWith(".html") && read(f).includes('id="menu-panel"'));
  assert.ok(menuPages.includes("guide.html"));
  assert.ok(menuPages.length >= 15, `expected 15+ pages with the menu, got ${menuPages.length}`);
  for (const f of menuPages) {
    assert.match(read(f), /<a href="guide\.html"( class="active")?>Guide<\/a>/, `${f}: Guide menu item`);
  }
  assert.match(read("guide.html"), /<a href="guide\.html" class="active">Guide<\/a>/);
  assert.match(read("docs.html"), /<a href="guide\.html">Read the guide<\/a>/);
  assert.match(read("wanted.html"), /New here\? <a href="guide\.html">Read the guide<\/a>/);
  assert.match(read("scripts/generate-sitemap.js"), /file: "guide\.html"/);
  assert.doesNotMatch(read("guide.html"), /\$AGRARIS|0x467b7a85/i, "guide never shows the token contract");

  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

  async function open(width = 1100, { noClipboard = false } = {}) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base.replace(/\/$/, "") });
    if (noClipboard) {
      await context.addInitScript(() => {
        Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
      });
    }
    const page = await context.newPage();
    const problems = [];
    page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error" && !/Failed to load resource|ERR_FAILED/.test(m.text())) problems.push(`console: ${m.text()}`);
    });
    await page.route("**/*", (route) => {
      const url = route.request().url();
      if (url.startsWith(base)) return route.continue();
      if (url.includes("@supabase/supabase-js")) return route.fulfill({ status: 200, contentType: "text/javascript", body: MOCK_SUPABASE });
      return route.abort();
    });
    await page.goto(`${base}guide.html`);
    await page.waitForTimeout(400);
    return { page, context, problems };
  }

  // --- structure and wording
  let { page, context, problems } = await open();
  assert.equal(await page.title(), "Build your first agent on Robinhood Chain — Agraris");
  assert.equal(await page.textContent(".section-head h2"), "Build your first agent on Robinhood Chain");
  const steps = await page.$$eval(".guide-section h3", (els) => els.map((e) => e.textContent));
  assert.deepEqual(steps, [
    "Step 1. Pick a small idea",
    "Step 2. Set up a public repo",
    "Step 3. Add a demo link (optional)",
    "Step 4. Publish on Agraris",
    "Step 5. After your listing appears",
    "Ready?",
  ]);
  const mainText = await page.$$eval(".section-head, .page-lead, .guide-section", (els) => els.map((e) => e.textContent).join(" "));
  assert.doesNotMatch(mainText, FORBIDDEN);
  assert.match(mainText, /free/i);
  assert.match(mainText, /account or a wallet/);
  assert.match(mainText, /see the official Robinhood Chain docs/);
  assert.match(mainText, /not an endorsement/i);
  assert.match(mainText, /A listing is not an endorsement\./);

  // links in the guide: pages of this site, the in-page TOC, and only the
  // official Robinhood Chain docs pages below (new tab, noopener noreferrer)
  const OFFICIAL_DOCS = [
    ["https://docs.robinhood.com/chain/connecting", "see the official Robinhood Chain docs"],
    ["https://docs.robinhood.com/chain/add-network-to-wallet", "adding the network to a wallet"],
    ["https://docs.robinhood.com/chain/gas-and-fees", "gas and fees"],
    ["https://docs.robinhood.com/chain/deploy-smart-contracts", "deploying smart contracts"],
    ["https://docs.robinhood.com/chain", "docs home page"],
  ];
  const external = await page.$$eval('.guide-section a[href^="http"]', (els) =>
    els.map((a) => ({ href: a.getAttribute("href"), text: a.textContent.trim(), target: a.getAttribute("target"), rel: a.getAttribute("rel") }))
  );
  assert.deepEqual(external.map((a) => [a.href, a.text]), OFFICIAL_DOCS);
  for (const a of external) {
    assert.equal(a.target, "_blank", `${a.href}: target`);
    assert.deepEqual((a.rel || "").split(/\s+/).sort(), ["noopener", "noreferrer"], `${a.href}: rel`);
  }
  assert.doesNotMatch(mainText, /faucet|test funds/i);
  // The docs links sit in Step 1, next to the chain ID sentence.
  assert.equal(await page.$$eval('#step-1 a[href^="https://docs.robinhood.com/"]', (els) => els.length), 5);

  const links = await page.$$eval(".guide-section a", (els) => els.map((a) => a.getAttribute("href")));
  for (const href of links) {
    if (/^https?:/.test(href)) {
      assert.ok(OFFICIAL_DOCS.some(([u]) => u === href), `unexpected external link in guide: ${href}`);
      continue;
    }
    if (href.startsWith("#")) {
      assert.ok(await page.$(href), `anchor ${href} exists`);
    } else {
      const file = href.split(/[?#]/)[0];
      assert.ok(fs.existsSync(path.join(ROOT, file)), `${href} exists`);
    }
  }
  assert.deepEqual(
    await page.$$eval("#next .btn", (els) => els.map((a) => [a.textContent, a.getAttribute("href")])),
    [["Publish a listing", "publish.html"], ["See the Wanted board", "wanted.html"]]
  );

  // --- Copy checklist (clipboard)
  const checklist = await page.textContent("#readme-checklist");
  for (const heading of ["## What it does", "## How to run it", "## License", "## Known limitations"]) {
    assert.ok(checklist.includes(heading), `checklist has ${heading}`);
  }
  await page.click("#copy-checklist-btn");
  await page.waitForTimeout(100);
  assert.equal(await page.textContent("#copy-checklist-btn"), "Copied");
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), checklist);
  await page.waitForTimeout(2100);
  assert.equal(await page.textContent("#copy-checklist-btn"), "Copy checklist");
  assert.deepEqual(problems, []);
  await context.close();

  // --- Copy checklist without a clipboard API → text gets selected
  ({ page, context, problems } = await open(1100, { noClipboard: true }));
  await page.click("#copy-checklist-btn");
  assert.match(await page.textContent("#copy-checklist-msg"), /Selected\. Press Ctrl\+C/);
  assert.equal(await page.evaluate(() => String(window.getSelection())), await page.textContent("#readme-checklist"));
  assert.deepEqual(problems, []);
  await context.close();

  // --- menu opens and lists Guide
  ({ page, context, problems } = await open(375));
  await page.click("#menu-toggle");
  await page.waitForTimeout(300);
  assert.equal(await page.isVisible('#menu-panel a[href="guide.html"]'), true);
  await context.close();

  // --- phone widths: no horizontal scroll (code blocks scroll inside themselves)
  for (const width of [320, 375]) {
    ({ page, context } = await open(width));
    const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    assert.ok(r.sw <= r.iw, `horizontal scroll at ${width}px (${r.sw} > ${r.iw})`);
    if (process.env.SHOT_DIR) {
      await page.waitForTimeout(800);
      await page.screenshot({ path: path.join(process.env.SHOT_DIR, `guide-${width}.png`), fullPage: true });
    }
    await context.close();
  }

  // --- docs.html and wanted.html render the guide link
  for (const file of ["docs.html", "wanted.html"]) {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await p.route("**/*", (route) => {
      const url = route.request().url();
      if (url.startsWith(base)) return route.continue();
      if (url.includes("@supabase/supabase-js")) return route.fulfill({ status: 200, contentType: "text/javascript", body: MOCK_SUPABASE });
      return route.abort();
    });
    await p.goto(base + file);
    assert.equal(await p.isVisible('.guide-link a[href="guide.html"]'), true, `${file}: guide link visible`);
    await ctx.close();
  }

  await browser.close();
  server.close();
  console.log("guide browser tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
