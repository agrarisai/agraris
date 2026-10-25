// Tes browser untuk profil builder: builders.html (indeks A–Z),
// builder.html?u=<owner> (profil, kosong, handle tidak sah), baris
// "More from <owner> (N)" di halaman detail, menu "Builders", dan lebar
// 320/375px.
//
// Tidak ikut `node --test` (butuh Playwright + Chromium). Jalankan dari
// root repo:
//   NODE_PATH="$(npm root -g)" node tests/browser/builders.e2e.js
//
// Supabase diganti tiruan. Aturan normalisasi owner diuji di
// tests/builder-lib.test.js.

const http = require("http");
const fs = require("fs");
const path = require("path");
const assert = require("assert/strict");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..", "..");
const FORBIDDEN = /\b(verified|trusted|recommended|top|best|token|tokens|price|prices|stars?|rank|ranking|undefined|NaN|null)\b/i;
const NOTE = "Grouped by the GitHub owner in each listing's repo URL. Anyone can list a repo, so this does not show who submitted it. Not an endorsement.";
const id = (n) => `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function listing(n, name, repo_url, extra = {}) {
  return {
    id: id(n), name, kind: "agent", description: "d", version: "1", repo_url, category: ["t"],
    demo_url: null, created_at: `2026-10-${String(10 + n).padStart(2, "0")}T00:00:00Z`, verified: false,
    github_stars: 7, github_updated_at: null, contract_address: null, live_status: null, live_checked_at: null,
    ...extra,
  };
}

const AGENTS = [
  listing(1, "Alpha One", "https://github.com/Alpha/one", { demo_url: "https://example.com", live_status: "up", live_checked_at: "2026-10-25T00:00:00Z" }),
  listing(2, "Alpha Tool", "https://github.com/alpha/two", { kind: "tool" }),
  listing(3, "Alpha Three", "https://www.github.com/ALPHA/three/tree/main"),
  listing(4, "Beta Solo", "https://github.com/beta-labs/solo"),
  listing(5, "Zeta Tool", "https://github.com/zeta/z", { kind: "tool" }),
  listing(6, "Gitlab Thing", "https://gitlab.com/alpha/elsewhere"),
  listing(7, "Lookalike", "https://github.com.evil.com/alpha/fake"),
];
const PROOFS = [{ agent_id: id(2), signer: "0x2b5ad5c4795c026514f8317c7a215e218dccd6cf", signed_at: "2026-10-20T08:00:00Z" }];

function mockSupabase(opts) {
  return `(function () {
  const O = ${JSON.stringify(opts)};
  const TABLES = { agents: ${JSON.stringify(AGENTS)}, owner_proofs: ${JSON.stringify(PROOFS)} };
  window.__calls = [];
  function like(pattern) {
    const re = pattern.replace(/[.*+?^\${}()|[\\]\\\\]/g, "\\\\$&").replace(/%/g, ".*").replace(/_/g, ".");
    return new RegExp("^" + re + "$", "i");
  }
  function builder(table) {
    const f = []; let mode = "many", cols = null, head = false, limit = null;
    const q = {
      select(c, o) { cols = c; head = !!(o && o.head); return q; },
      eq(k, v) { f.push((r) => r[k] === v); return q; },
      neq(k, v) { f.push((r) => r[k] !== v); return q; },
      ilike(k, p) { window.__calls.push(["ilike", table, k, p]); const re = like(p); f.push((r) => re.test(String(r[k]))); return q; },
      in() { return q; }, overlaps() { return q; }, contains() { return q; }, or() { return q; }, order() { return q; }, not() { return q; },
      limit(n) { limit = n; return q; },
      single() { mode = "single"; return q; }, maybeSingle() { mode = "maybe"; return q; },
      then(res, rej) {
        window.__calls.push(["select", table, cols]);
        if (O.fail && table === "agents" && mode === "many") return Promise.resolve({ data: null, error: { message: "down" } }).then(res, rej);
        let d = (TABLES[table] || []).filter((r) => f.every((fn) => fn(r)));
        if (limit) d = d.slice(0, limit);
        if (cols && cols !== "*") {
          const keys = cols.split(",").map((s) => s.trim());
          d = d.map((r) => Object.fromEntries(keys.map((k) => [k, r[k]])));
        }
        let out = { data: head ? null : d, error: null, count: d.length };
        if (mode !== "many") out = { data: d[0] || null, error: d[0] || mode === "maybe" ? null : { message: "not found" } };
        return Promise.resolve(out).then(res, rej);
      },
    };
    return q;
  }
  window.supabase = { createClient() { return { from: builder, rpc() { return Promise.resolve({ data: [], error: null }); } }; } };
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
  // --- static: menu, sitemap
  const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
  const menuPages = fs.readdirSync(ROOT).filter((f) => f.endsWith(".html") && read(f).includes('id="menu-panel"'));
  assert.ok(menuPages.includes("builders.html") && menuPages.includes("builder.html"));
  for (const f of menuPages) assert.match(read(f), /<a href="builders\.html"( class="active")?>Builders<\/a>/, `${f}: Builders menu item`);
  assert.match(read("builders.html"), /<a href="builders\.html" class="active">Builders<\/a>/);
  assert.match(read("scripts/generate-sitemap.js"), /file: "builders\.html"/);
  assert.doesNotMatch(read("scripts/generate-sitemap.js"), /builder\.html/, "profile pages are not in the sitemap");

  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

  async function open(file, opts = {}, width = 1100) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    const problems = [];
    page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error" && !/Failed to load resource|ERR_FAILED|Gagal mengambil/.test(m.text())) problems.push(`console: ${m.text()}`);
    });
    page.on("dialog", (d) => {
      problems.push(`dialog: ${d.message()}`);
      d.dismiss();
    });
    await page.route("**/*", (route) => {
      const url = route.request().url();
      if (url.startsWith(base)) return route.continue();
      if (url.includes("@supabase/supabase-js")) return route.fulfill({ status: 200, contentType: "text/javascript", body: mockSupabase(opts) });
      return route.abort();
    });
    await page.goto(base + file);
    await page.waitForTimeout(600);
    return { page, context, problems };
  }

  const mainText = (page) =>
    page.$$eval(".section-head, .page-lead, .builder-note, #builders-list, #builders-other:not([hidden]), #builder-list .wanted-empty, .builder-more:not([hidden])", (els) => els.map((e) => e.textContent).join(" "));

  // --- builders.html
  let { page, context, problems } = await open("builders.html");
  const rows = await page.$$eval(".builders-row", (els) =>
    els.map((li) => ({ handle: li.querySelector(".builders-handle").textContent, href: li.querySelector(".builders-handle").getAttribute("href"), count: li.querySelector(".builders-count-text").textContent }))
  );
  assert.deepEqual(rows, [
    { handle: "alpha", href: "builder.html?u=alpha", count: "2 agents · 1 tool" },
    { handle: "beta-labs", href: "builder.html?u=beta-labs", count: "1 agent" },
    { handle: "zeta", href: "builder.html?u=zeta", count: "1 tool" },
  ]);
  assert.equal(await page.textContent("#builders-count"), "3 builders");
  assert.equal(await page.textContent("#builders-other"), "2 listings have a repo link outside GitHub and are not shown here.");
  assert.equal(await page.textContent(".builder-note"), NOTE);
  assert.doesNotMatch(await mainText(page), FORBIDDEN);
  assert.deepEqual(problems, []);
  await context.close();

  // --- builders.html when loading fails
  ({ page, context, problems } = await open("builders.html", { fail: true }));
  assert.match(await page.textContent("#builders-list"), /Couldn't load builders right now/);
  assert.doesNotMatch(await page.textContent("body"), /\bundefined\b|\bNaN\b/);
  assert.deepEqual(problems, []);
  await context.close();

  // --- builder.html?u=Alpha (mixed case in the link)
  ({ page, context, problems } = await open("builder.html?u=Alpha"));
  assert.equal(await page.textContent("#builder-heading"), "alpha");
  assert.equal(await page.title(), "alpha — Builders — Agraris");
  const gh = await page.$eval("#builder-lead a", (a) => ({ href: a.getAttribute("href"), text: a.textContent, target: a.target, rel: a.rel }));
  assert.deepEqual(gh, { href: "https://github.com/alpha", text: "github.com/alpha", target: "_blank", rel: "noopener noreferrer" });
  assert.equal(await page.textContent("#builder-count"), "2 agents · 1 tool");
  assert.deepEqual(
    (await page.$$eval("#builder-list .agent-row .agent-name", (els) => els.map((e) => e.textContent))).sort(),
    ["Alpha One", "Alpha Three", "Alpha Tool"]
  );
  assert.equal(await page.textContent(".builder-note"), NOTE);
  // Existing card labels: Live check and owner signature.
  const cardBadges = await page.$$eval("#builder-list .agent-row", (els) =>
    els.map((r) => ({
      name: r.querySelector(".agent-name").textContent,
      live: r.querySelector(".live-badge")?.textContent.trim() || null,
      owner: r.querySelector(".owner-badge")?.childNodes[0].textContent || null,
      kind: r.querySelector(".kind-badge")?.textContent || null,
    }))
  );
  const byName = Object.fromEntries(cardBadges.map((c) => [c.name, c]));
  assert.match(byName["Alpha One"].live, /^Responding/);
  assert.equal(byName["Alpha Tool"].owner, "Contract owner signed a message · Oct 20, 2026");
  assert.equal(byName["Alpha Tool"].kind, "Tool");
  assert.equal(byName["Alpha Three"].live, null);
  // Lookalike / GitLab listings never land on the profile.
  assert.doesNotMatch(await page.textContent("#builder-list"), /Gitlab Thing|Lookalike/);
  assert.doesNotMatch(await mainText(page), FORBIDDEN);
  assert.deepEqual(problems, []);
  await context.close();

  // --- empty profile
  ({ page, context, problems } = await open("builder.html?u=nobody-here"));
  assert.equal(await page.textContent("#builder-heading"), "nobody-here");
  assert.equal(await page.textContent("#builder-list .wanted-empty"), "No approved listings from nobody-here yet. Browse all listings.");
  assert.equal(await page.getAttribute("#builder-list .wanted-empty a", "href"), "search.html");
  assert.equal(await page.textContent("#builder-count"), "");
  assert.doesNotMatch(await mainText(page), FORBIDDEN);
  assert.deepEqual(problems, []);
  await context.close();

  // --- invalid handles are never used
  for (const q of [
    "?u=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E",
    "?u=a_b",
    "?u=orgs",
    "?u=%22onmouseover%3Dalert(1)",
    "?u=javascript:alert(1)",
    `?u=${"a".repeat(40)}`,
    "",
  ]) {
    ({ page, context, problems } = await open(`builder.html${q}`));
    assert.equal(await page.textContent("#builder-heading"), "Builder not found", q);
    assert.equal(await page.$("#builder-lead a"), null, `${q}: no GitHub link`);
    assert.equal(await page.$("#builder-list img"), null, `${q}: nothing injected`);
    const html = await page.content();
    assert.doesNotMatch(html, /onerror=alert|onmouseover=alert|a_b|javascript:alert/, `${q}: input not echoed`);
    const queried = (await page.evaluate(() => window.__calls)).filter((c) => c[0] === "select");
    assert.equal(queried.length, 0, `${q}: no query made`);
    assert.deepEqual(problems, [], q);
    await context.close();
  }

  // --- detail page: "More from <owner> (N)"
  ({ page, context, problems } = await open(`agent.html?id=${id(1)}`));
  await page.waitForSelector("#builder-more:not([hidden])");
  assert.equal(await page.textContent("#builder-more"), "More from alpha (3)");
  assert.equal(await page.getAttribute("#builder-more a", "href"), "builder.html?u=alpha");
  const ilike = (await page.evaluate(() => window.__calls)).find((c) => c[0] === "ilike");
  assert.deepEqual(ilike.slice(1), ["agents", "repo_url", "%github.com/alpha/%"]);
  assert.deepEqual(problems, []);
  await context.close();

  for (const [n, why] of [[4, "single listing"], [6, "not on GitHub"], [7, "look-alike host"]]) {
    ({ page, context, problems } = await open(`agent.html?id=${id(n)}`));
    await page.waitForSelector(".detail-head");
    await page.waitForTimeout(300);
    assert.equal(await page.isHidden("#builder-more"), true, why);
    assert.deepEqual(problems, [], why);
    await context.close();
  }

  // --- phone widths
  for (const width of [320, 375]) {
    for (const [file, label] of [["builders.html", "index"], ["builder.html?u=alpha", "profile"], ["builder.html?u=nobody-here", "empty"], [`agent.html?id=${id(1)}`, "detail"]]) {
      ({ page, context } = await open(file, {}, width));
      const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
      assert.ok(r.sw <= r.iw, `${label}: horizontal scroll at ${width}px (${r.sw} > ${r.iw})`);
      if (process.env.SHOT_DIR) {
        await page.waitForTimeout(800);
        await page.screenshot({ path: path.join(process.env.SHOT_DIR, `builders-${label}-${width}.png`), fullPage: true });
      }
      await context.close();
    }
  }

  await browser.close();
  server.close();
  console.log("builders browser tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
