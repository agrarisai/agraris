// Tes browser untuk Wanted board: wanted.html (daftar, form, detail) dan
// publish.html?wanted=<id>, plus item "Wanted" di menu semua halaman.
//
// Tidak ikut `node --test` (butuh Playwright + Chromium). Jalankan dari
// root repo:
//   NODE_PATH="$(npm root -g)" node tests/browser/wanted.e2e.js
//
// Supabase diganti tiruan (skrip supabase-js dari CDN dicegat). Aturan
// database (pending tidak tampil, 60 hari, batas 20, URL ditolak) diuji
// di tests/sql/run-wanted.sh; di sini yang diuji tampilannya.

const http = require("http");
const fs = require("fs");
const path = require("path");
const assert = require("assert/strict");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..", "..");
const FORBIDDEN = /\b(price|prices|token|tokens|trending|hot|best|verified|undefined|NaN|null)\b/i;
const W1 = "c0000000-0000-4000-8000-000000000001";
const W2 = "c0000000-0000-4000-8000-000000000002";
const W3 = "c0000000-0000-4000-8000-000000000003";
const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();

const REQUESTS = [
  { id: W1, title: "Order book MCP server", description: "Read-only order book data.\nPairs on Robinhood Chain.", kind: "tool", created_at: hoursAgo(2), answers_count: 2 },
  { id: W2, title: "Portfolio rebalancing agent", description: "Suggests rebalancing steps; no trading.", kind: "agent", created_at: hoursAgo(20), answers_count: 1 },
  { id: W3, title: "Anything for gas estimates", description: "Averylongwordwithoutanyspacesthatmustwrapinsteadofoverflowingthephonescreenwidth", kind: "any", created_at: hoursAgo(40), answers_count: 0 },
];

const AGENTS = [
  { id: "a0000000-0000-4000-8000-000000000001", name: "Book Reader", kind: "tool", wanted_id: W1, description: "d", version: "1", repo_url: "https://github.com/x/1", category: ["data"], demo_url: null, created_at: hoursAgo(1), verified: false, github_stars: null, github_updated_at: null, contract_address: null, live_status: null, live_checked_at: null },
  { id: "a0000000-0000-4000-8000-000000000002", name: "Depth Feed", kind: "tool", wanted_id: W1, description: "d", version: "1", repo_url: "https://github.com/x/2", category: ["data"], demo_url: null, created_at: hoursAgo(3), verified: false, github_stars: null, github_updated_at: null, contract_address: null, live_status: null, live_checked_at: null },
  { id: "a0000000-0000-4000-8000-000000000003", name: "Unrelated", kind: "agent", wanted_id: null, description: "d", version: "1", repo_url: "https://github.com/x/3", category: ["x"], demo_url: null, created_at: hoursAgo(5), verified: false, github_stars: null, github_updated_at: null, contract_address: null, live_status: null, live_checked_at: null },
];

// opts: { requests, getWanted: "ok"|"error"|"throw", submit: "ok"|"invalid"|"error", answers: "ok"|"error" }
function mockSupabase(opts) {
  return `(function () {
  const O = ${JSON.stringify(opts)};
  const TABLES = { wanted: O.requests, agents: ${JSON.stringify(AGENTS)} };
  window.__calls = [];
  function builder(table) {
    const f = []; let mode = "many", cols = null, head = false, limit = null;
    const q = {
      select(c, o) { cols = c; head = !!(o && o.head); return q; },
      eq(k, v) { f.push((r) => r[k] === v); return q; },
      neq() { return q; }, in() { return q; }, overlaps() { return q; }, contains() { return q; },
      ilike() { return q; }, or() { return q; }, order() { return q; }, not() { return q; },
      limit(n) { limit = n; return q; },
      single() { mode = "single"; return q; },
      maybeSingle() { mode = "maybe"; return q; },
      insert(rows) { window.__calls.push(["insert", table, rows]); return Promise.resolve({ error: null }); },
      then(res, rej) {
        window.__calls.push(["select", table, cols]);
        if (table === "agents" && O.answers === "error" && cols && f.length) {
          return Promise.resolve({ data: null, error: { message: "permission denied for column wanted_id" } }).then(res, rej);
        }
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
  window.supabase = { createClient() { return {
    from(table) { return builder(table); },
    rpc(name, args) {
      window.__calls.push(["rpc", name, args]);
      if (name === "get_wanted") {
        if (O.getWanted === "error") return Promise.resolve({ data: null, error: { message: "x" } });
        if (O.getWanted === "throw") return Promise.reject(new TypeError("Failed to fetch"));
        return Promise.resolve({ data: O.requests, error: null });
      }
      if (name === "submit_wanted") {
        if (O.submit === "invalid") return Promise.resolve({ data: null, error: { code: "22023", message: "Please leave out links and web addresses. Describe what you need in words." } });
        if (O.submit === "error") return Promise.resolve({ data: null, error: { code: "PGRST301", message: "internal detail" } });
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: [], error: null });
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
  // Menu: every page with the hamburger menu links to wanted.html.
  const menuPages = fs.readdirSync(ROOT).filter((f) => f.endsWith(".html") && fs.readFileSync(path.join(ROOT, f), "utf8").includes('id="menu-panel"'));
  assert.ok(menuPages.length >= 14, `expected 14+ pages with the menu, got ${menuPages.length}`);
  for (const f of menuPages) {
    assert.match(fs.readFileSync(path.join(ROOT, f), "utf8"), /<a href="wanted\.html"( class="active")?>Wanted<\/a>/, `${f}: Wanted menu item`);
  }

  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

  async function open(file, opts, width = 1100) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const problems = [];
    page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error" && !/Failed to load resource|ERR_FAILED/.test(m.text())) problems.push(`console: ${m.text()}`);
    });
    await page.route("**/*", (route) => {
      const url = route.request().url();
      if (url.startsWith(base)) return route.continue();
      if (url.includes("@supabase/supabase-js")) {
        return route.fulfill({ status: 200, contentType: "text/javascript", body: mockSupabase({ requests: REQUESTS, getWanted: "ok", submit: "ok", answers: "ok", ...opts }) });
      }
      return route.abort();
    });
    await page.goto(base + file);
    await page.waitForTimeout(600);
    return { page, problems };
  }

  async function noOverflow(page, width, label) {
    const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    assert.ok(r.sw <= r.iw, `${label}: horizontal scroll at ${width}px (${r.sw} > ${r.iw})`);
  }

  async function mainText(page) {
    return page.evaluate(() =>
      ["#wanted-heading", "#wanted-count", "#wanted-lead", "#wanted-list", "#wanted-detail", "#wanted-form-section"]
        .map((s) => document.querySelector(s))
        .filter((e) => e && !e.hidden)
        .map((e) => e.textContent)
        .join(" ")
    );
  }

  // --- board with requests
  let { page, problems } = await open("wanted.html", {});
  const cards = await page.$$eval(".wanted-card", (els) =>
    els.map((c) => ({
      title: c.querySelector(".wanted-title").textContent,
      href: c.querySelector(".wanted-title").getAttribute("href"),
      kind: c.querySelector(".kind-badge").textContent,
      answers: c.querySelector(".wanted-answers")?.textContent ?? null,
      built: c.querySelector(".btn").getAttribute("href"),
      builtText: c.querySelector(".btn").textContent,
      desc: c.querySelector(".wanted-desc").textContent,
    }))
  );
  assert.deepEqual(cards.map((c) => c.title), REQUESTS.map((r) => r.title));
  assert.deepEqual(cards.map((c) => c.kind), ["Tool", "Agent", "Any"]);
  assert.deepEqual(cards.map((c) => c.answers), ["2 answers", "1 answer", "0 answers"]);
  assert.equal(cards[0].href, `wanted.html?id=${W1}`);
  assert.equal(cards[0].built, `publish.html?wanted=${W1}`);
  assert.equal(cards[0].builtText, "I built this");
  assert.equal(cards[0].desc, REQUESTS[0].description);
  assert.equal(await page.textContent("#wanted-count"), "3 requests");
  assert.equal(await page.isVisible("#wanted-form"), true);
  assert.doesNotMatch(await mainText(page), FORBIDDEN);
  assert.deepEqual((await page.evaluate(() => window.__calls)).find((c) => c[1] === "get_wanted")[2], { p_limit: 50 });
  assert.deepEqual(problems, []);

  // --- form: client check, success
  await page.click("#wanted-submit-btn");
  assert.match(await page.textContent("#wanted-msg"), /Title is required/);
  await page.fill("#wanted-title", "Gas estimate API");
  await page.click("#wanted-submit-btn");
  assert.match(await page.textContent("#wanted-msg"), /Description is required/);
  await page.fill("#wanted-description", "Estimates for common actions.");
  await page.selectOption("#wanted-kind", "tool");
  await page.click("#wanted-submit-btn");
  await page.waitForSelector("#wanted-submitted:not([hidden])");
  assert.equal((await page.textContent("#wanted-submitted")).trim(), "Submitted. It appears after review.");
  assert.equal(await page.isHidden("#wanted-form"), true);
  const submit = (await page.evaluate(() => window.__calls)).find((c) => c[1] === "submit_wanted");
  assert.deepEqual(submit[2], { p_title: "Gas estimate API", p_description: "Estimates for common actions.", p_kind: "tool" });
  assert.equal(await page.$('a[href^="status.html"]'), null, "no status link");
  assert.deepEqual(problems, []);
  await page.close();

  // --- form: database validation message is shown, other errors are generic
  for (const [mode, expected] of [["invalid", /Please leave out links/], ["error", /Could not send right now/]]) {
    ({ page, problems } = await open("wanted.html", { submit: mode }));
    await page.fill("#wanted-title", "t");
    await page.fill("#wanted-description", "d");
    await page.click("#wanted-submit-btn");
    await page.waitForTimeout(200);
    const msg = await page.textContent("#wanted-msg");
    assert.match(msg, expected);
    assert.doesNotMatch(msg, /internal detail/);
    assert.equal(await page.isVisible("#wanted-form"), true);
    assert.deepEqual(problems, []);
    await page.close();
  }

  // --- empty board → neutral message + form
  ({ page, problems } = await open("wanted.html", { requests: [] }));
  assert.match(await page.textContent("#wanted-list"), /No open requests right now/);
  assert.equal(await page.isVisible("#wanted-form"), true);
  assert.equal(await page.textContent("#wanted-count"), "");
  assert.deepEqual(problems, []);
  await page.close();

  // --- failed load → message + form, no undefined/NaN
  for (const mode of ["error", "throw"]) {
    ({ page, problems } = await open("wanted.html", { getWanted: mode }));
    assert.match(await page.textContent("#wanted-list"), /Couldn't load requests right now/);
    assert.equal(await page.isVisible("#wanted-form"), true);
    assert.doesNotMatch(await page.textContent("body"), /\bundefined\b|\bNaN\b/);
    assert.deepEqual(problems, []);
    await page.close();
  }

  // --- odd rows are dropped, odd counts are not printed
  ({ page, problems } = await open("wanted.html", {
    requests: [
      { id: W1, title: "Fine", description: "ok", kind: "weird", answers_count: null },
      { id: "nope", title: "Bad id", description: "x", kind: "agent", answers_count: 1 },
      { id: W2, title: null, description: "x", kind: "agent", answers_count: 1 },
    ],
  }));
  assert.deepEqual(await page.$$eval(".wanted-title", (els) => els.map((e) => e.textContent)), ["Fine"]);
  assert.equal(await page.textContent(".wanted-card .kind-badge"), "Any");
  assert.equal(await page.$(".wanted-answers"), null);
  assert.doesNotMatch(await page.textContent("body"), /\bundefined\b|\bNaN\b|\bnull\b/);
  await page.close();

  // --- detail view with answers
  ({ page, problems } = await open(`wanted.html?id=${W1}`, {}));
  assert.equal(await page.textContent("#wanted-heading"), "Order book MCP server");
  assert.match(await page.textContent("#wanted-lead"), /Tool.*Read-only order book data/s);
  assert.deepEqual(await page.$$eval("#wanted-answers .agent-name", (els) => els.map((e) => e.textContent)), ["Book Reader", "Depth Feed"]);
  assert.equal(await page.textContent("#wanted-answers-count"), "2 answers");
  assert.equal(await page.getAttribute("#wanted-list .btn", "href"), `publish.html?wanted=${W1}`);
  assert.equal(await page.isHidden("#wanted-form-section"), true);
  assert.equal(await page.title(), "Order book MCP server — Wanted — Agraris");
  assert.doesNotMatch(await mainText(page), FORBIDDEN);
  assert.deepEqual(problems, []);
  await page.close();

  // --- detail: no answers yet / answers fail to load / not found / bad id
  ({ page, problems } = await open(`wanted.html?id=${W3}`, {}));
  assert.match(await page.textContent("#wanted-answers"), /No answers yet/);
  assert.equal(await page.textContent("#wanted-answers-count"), "0 answers");
  await page.close();
  ({ page, problems } = await open(`wanted.html?id=${W1}`, { answers: "error" }));
  assert.match(await page.textContent("#wanted-answers"), /Couldn't load answers right now/);
  assert.equal(await page.textContent("#wanted-answers-count"), "");
  assert.deepEqual(problems, []);
  await page.close();
  for (const q of ["c0000000-0000-4000-8000-0000000000ff", "not-a-uuid", ""]) {
    ({ page, problems } = await open(`wanted.html?id=${q}`, {}));
    assert.equal(await page.textContent("#wanted-heading"), "Request not found");
    assert.equal(await page.isHidden("#wanted-detail"), true);
    assert.doesNotMatch(await page.textContent("body"), /\bundefined\b|\bNaN\b/);
    assert.deepEqual(problems, []);
    await page.close();
  }

  // --- publish.html?wanted=
  async function publishWith(query) {
    const r = await open(`publish.html${query}`, {});
    await r.page.fill("#name", "My listing");
    await r.page.fill("#description", "Does a thing.");
    await r.page.fill("#version", "1.0.0");
    await r.page.fill("#repo_url", "https://github.com/x/y");
    await r.page.fill("#category", "data");
    await r.page.click("#submit-btn");
    await r.page.waitForTimeout(300);
    const insert = (await r.page.evaluate(() => window.__calls)).find((c) => c[0] === "insert");
    return { ...r, payload: insert ? insert[2][0] : null };
  }

  let r = await publishWith(`?wanted=${W1}`);
  assert.equal(await r.page.textContent("#answering-note"), "Answering: Order book MCP server");
  assert.equal(r.payload.wanted_id, W1);
  assert.deepEqual(r.problems, []);
  await r.page.close();

  for (const q of ["?wanted=not-a-uuid", "?wanted=c0000000-0000-4000-8000-0000000000ff", ""]) {
    r = await publishWith(q);
    assert.equal(await r.page.isHidden("#answering-note"), true, `note hidden for ${q || "(none)"}`);
    assert.ok(r.payload, "listing still submitted");
    assert.equal("wanted_id" in r.payload, false, `no wanted_id for ${q || "(none)"}`);
    assert.deepEqual(r.problems, []);
    await r.page.close();
  }

  // --- phone widths
  for (const width of [320, 375]) {
    for (const [file, label] of [["wanted.html", "board"], [`wanted.html?id=${W1}`, "detail"], [`publish.html?wanted=${W1}`, "publish"]]) {
      ({ page } = await open(file, {}, width));
      await noOverflow(page, width, label);
      if (process.env.SHOT_DIR) {
        await page.waitForTimeout(900);
        await page.screenshot({ path: path.join(process.env.SHOT_DIR, `wanted-${label}-${width}.png`), fullPage: true });
      }
      await page.close();
    }
  }

  await browser.close();
  server.close();
  console.log("wanted browser tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
