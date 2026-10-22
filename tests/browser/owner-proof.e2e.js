// Tes browser untuk "contract owner signature": badge di kartu pencarian
// dan halaman detail, filter "Owner signed", dan alur tanda tangan di
// status.html dengan window.ethereum tiruan (tanpa wallet asli).
//
// Tidak ikut `node --test` (butuh Playwright + Chromium). Jalankan dari
// root repo:
//   NODE_PATH="$(npm root -g)" node tests/browser/owner-proof.e2e.js
//
// Supabase diganti tiruan. Verifikasi tanda tangan dan owner() terjadi di
// server (scripts/owner-proof.js) dan diuji di tests/owner-proof.test.js
// serta tests/sql/run-owner-proof.sh; di sini yang diuji tampilannya.

const http = require("http");
const fs = require("fs");
const path = require("path");
const assert = require("assert/strict");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..", "..");
const FORBIDDEN = /\b(verified|trusted|recommended|token|tokens|price|prices|undefined|NaN|null)\b/i;
const A1 = "a0000000-0000-4000-8000-000000000001";
const A2 = "a0000000-0000-4000-8000-000000000002";
const SIGNER = "0x2b5ad5c4795c026514f8317c7a215e218dccd6cf";
const CONTRACT = "0x467b7a85f55bd716cb16d59f63b8ccac08852a6d";
const TOKEN = "11111111-1111-4111-8111-111111111111";
const FAKE_SIG = `0x${"ab".repeat(65)}`;
const MESSAGE = [
  "agraris.xyz asks you to sign this message to show that this wallet is the owner() of the contract below.",
  "",
  "Domain: agraris.xyz",
  `Listing ID: ${A1}`,
  `Contract: ${CONTRACT}`,
  "Chain ID: 4663",
  "Nonce: 0123456789abcdef0123456789abcdef",
  "Expires at: 2026-10-22T10:10:00Z",
  "",
  "Signing does not send a transaction.",
].join("\n");

function listing(id, name, extra = {}) {
  return {
    id, name, kind: "agent", description: "d", version: "1", repo_url: "https://github.com/x/y",
    category: ["t"], demo_url: null, created_at: "2026-10-01T00:00:00Z", verified: false,
    github_stars: null, github_updated_at: null, contract_address: CONTRACT, live_status: null,
    live_checked_at: null, ...extra,
  };
}

const AGENTS = [listing(A1, "Signed Agent"), listing(A2, "Plain Agent", { contract_address: null })];
const PROOFS = [{ agent_id: A1, signer: SIGNER, signed_at: "2026-10-20T08:00:00Z" }];

// opts: proofs, proofsError, status (rows for get_owner_proof_status, a
// list used one by one), request ("ok"|"invalid"), submitStatus
function mockSupabase(opts) {
  return `(function () {
  const O = ${JSON.stringify(opts)};
  const TABLES = { agents: ${JSON.stringify(AGENTS)}, owner_proofs: O.proofs || [] };
  window.__calls = [];
  let statusCall = 0;
  function builder(table) {
    const f = []; let mode = "many", cols = null, head = false, limit = null;
    const q = {
      select(c, o) { cols = c; head = !!(o && o.head); return q; },
      eq(k, v) { f.push((r) => r[k] === v); return q; },
      neq(k, v) { f.push((r) => r[k] !== v); return q; },
      in() { return q; }, overlaps() { return q; }, contains() { return q; }, ilike() { return q; },
      or() { return q; }, order() { return q; }, not() { return q; },
      limit(n) { limit = n; return q; },
      single() { mode = "single"; return q; }, maybeSingle() { mode = "maybe"; return q; },
      insert() { return Promise.resolve({ error: null }); },
      then(res, rej) {
        window.__calls.push(["select", table, cols]);
        if (table === "owner_proofs" && O.proofsError) return Promise.resolve({ data: null, error: { message: "x" } }).then(res, rej);
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
      if (name === "get_submission_status") return Promise.resolve({ data: [{ status: O.pending ? "pending" : "approved", name: "Signed Agent", id: "${A1}", kind: "agent" }], error: null });
      if (name === "get_owner_proof_status") {
        const list = O.status || [];
        const row = list[Math.min(statusCall++, list.length - 1)];
        return Promise.resolve({ data: row ? [row] : [], error: null });
      }
      if (name === "request_owner_proof") {
        if (O.request === "invalid") return Promise.resolve({ data: null, error: { code: "22023", message: "Too many signing requests for this listing in the last hour. Please try again later." } });
        return Promise.resolve({ data: [{ nonce: "0123456789abcdef0123456789abcdef", message: ${JSON.stringify(MESSAGE)}, expires_at: "2026-10-22T10:10:00Z" }], error: null });
      }
      if (name === "submit_owner_proof") return Promise.resolve({ data: [{ status: "submitted" }], error: null });
      return Promise.resolve({ data: [], error: null });
    },
  }; } };
})();`;
}

// window.ethereum tiruan: mencatat permintaan; mode "ok" | "cancel".
function walletScript(mode) {
  return `window.__wallet = [];
window.ethereum = {
  request: async ({ method, params }) => {
    window.__wallet.push([method, params]);
    if (method === "eth_requestAccounts") return ["${SIGNER}"];
    if (method === "personal_sign") {
      if (${JSON.stringify(mode)} === "cancel") { const e = new Error("User rejected"); e.code = 4001; throw e; }
      return "${FAKE_SIG}";
    }
    throw new Error("unexpected " + method);
  },
};`;
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

  async function open(file, opts = {}, { width = 1100, wallet = null } = {}) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    if (wallet) await context.addInitScript(walletScript(wallet));
    const page = await context.newPage();
    const problems = [];
    page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error" && !/Failed to load resource|ERR_FAILED/.test(m.text())) problems.push(`console: ${m.text()}`);
    });
    await page.route("**/*", (route) => {
      const url = route.request().url();
      if (url.startsWith(base)) return route.continue();
      if (url.includes("@supabase/supabase-js")) return route.fulfill({ status: 200, contentType: "text/javascript", body: mockSupabase({ proofs: PROOFS, ...opts }) });
      return route.abort();
    });
    await page.goto(base + file);
    await page.waitForTimeout(600);
    return { page, context, problems };
  }

  const ownerTexts = (page) =>
    page.$$eval(".owner-badge, .owner-note, #owner-proof-root:not([hidden])", (els) => els.map((e) => `${e.textContent} ${e.getAttribute("title") || ""}`));

  // --- search cards + filter
  let { page, context, problems } = await open("search.html");
  await page.waitForSelector(".agent-row");
  const cards = await page.$$eval(".agent-row", (rows) =>
    rows.map((r) => ({ name: r.querySelector(".agent-name").textContent, badge: r.querySelector(".owner-badge")?.childNodes[0].textContent ?? null, title: r.querySelector(".owner-badge")?.getAttribute("title") ?? null }))
  );
  const byName = Object.fromEntries(cards.map((c) => [c.name, c]));
  assert.equal(byName["Signed Agent"].badge, "Contract owner signed a message · Oct 20, 2026");
  assert.equal(byName["Signed Agent"].title, "Only means the owner wallet signed a message. Not an endorsement.");
  assert.equal(byName["Plain Agent"].badge, null);
  for (const t of await ownerTexts(page)) assert.doesNotMatch(t, FORBIDDEN, t);
  await page.check("#owner-filter-input");
  assert.deepEqual(await page.$$eval(".agent-row .agent-name", (els) => els.map((e) => e.textContent)), ["Signed Agent"]);
  await page.uncheck("#owner-filter-input");
  assert.equal((await page.$$(".agent-row")).length, 2);
  assert.deepEqual(problems, []);
  await context.close();

  // --- owner_proofs unavailable → listings still load, no badges, quiet
  ({ page, context, problems } = await open("search.html", { proofsError: true }));
  await page.waitForSelector(".agent-row");
  assert.equal((await page.$$(".agent-row")).length, 2);
  assert.equal(await page.$(".owner-badge"), null);
  assert.deepEqual(problems, []);
  await context.close();

  // --- detail pages
  ({ page, context, problems } = await open(`agent.html?id=${A1}`));
  await page.waitForSelector(".detail-head");
  const note = await page.textContent(".owner-note");
  assert.match(note, /Contract owner signed a message · Oct 20, 2026/);
  assert.match(note, new RegExp(`Signed by ${SIGNER}`));
  assert.match(note, /Only means the owner wallet signed a message\. Not an endorsement\./);
  for (const t of await ownerTexts(page)) assert.doesNotMatch(t, FORBIDDEN, t);
  assert.deepEqual(problems, []);
  await context.close();
  ({ page, context, problems } = await open(`agent.html?id=${A2}`));
  await page.waitForSelector(".detail-head");
  assert.equal(await page.$(".owner-note"), null);
  assert.equal(await page.$(".owner-badge"), null);
  await context.close();

  // --- status.html: no wallet → hint, button disabled
  const none = { contract_address: CONTRACT, signer: null, signed_at: null, checked_at: null, last_status: null, last_reason: null, last_at: null };
  ({ page, context, problems } = await open(`status.html#t=${TOKEN}`, { status: [none] }));
  await page.waitForSelector("#owner-proof-root:not([hidden])");
  assert.equal(await page.textContent("#owner-proof-state"), "No owner signature yet.");
  assert.match(await page.textContent("#owner-proof-msg"), /No browser wallet found/);
  assert.equal(await page.isDisabled("#owner-proof-btn"), true);
  for (const t of await ownerTexts(page)) assert.doesNotMatch(t, FORBIDDEN, t);
  assert.deepEqual(problems, []);
  await context.close();

  // --- status.html: sign with a wallet
  ({ page, context, problems } = await open(`status.html#t=${TOKEN}`, { status: [none, { ...none, last_status: "submitted", last_at: "2026-10-22T10:01:00Z" }] }, { wallet: "ok" }));
  await page.waitForSelector("#owner-proof-root:not([hidden])");
  assert.equal(await page.isDisabled("#owner-proof-btn"), false);
  await page.click("#owner-proof-btn");
  await page.waitForFunction(() => document.getElementById("owner-proof-state").textContent.startsWith("Signature received"));
  assert.equal(await page.textContent("#owner-proof-message"), MESSAGE, "the exact server message is shown before signing");
  const calls = await page.evaluate(() => window.__calls.filter((c) => c[0] === "rpc").map((c) => [c[1], c[2]]));
  assert.deepEqual(calls.map((c) => c[0]), ["get_submission_status", "get_owner_proof_status", "request_owner_proof", "submit_owner_proof", "get_owner_proof_status"]);
  assert.deepEqual(calls[2][1], { p_token: TOKEN });
  assert.deepEqual(calls[3][1], { p_token: TOKEN, p_nonce: "0123456789abcdef0123456789abcdef", p_signature: FAKE_SIG });
  const walletCalls = await page.evaluate(() => window.__wallet);
  assert.equal(walletCalls[0][0], "eth_requestAccounts");
  assert.equal(walletCalls[1][0], "personal_sign");
  assert.equal(walletCalls[1][1][0], `0x${Buffer.from(MESSAGE, "utf8").toString("hex")}`, "personal_sign gets the UTF-8 hex of the message");
  assert.equal(walletCalls[1][1][1], SIGNER);
  assert.equal(await page.isDisabled("#owner-proof-btn"), true, "no second submit while one is being checked");
  assert.deepEqual(problems, []);
  await context.close();

  // --- status.html: user cancels in the wallet
  ({ page, context, problems } = await open(`status.html#t=${TOKEN}`, { status: [none] }, { wallet: "cancel" }));
  await page.waitForSelector("#owner-proof-root:not([hidden])");
  await page.click("#owner-proof-btn");
  await page.waitForFunction(() => document.getElementById("owner-proof-msg").textContent !== "Confirm in your wallet…" && document.getElementById("owner-proof-msg").textContent !== "Preparing the message…");
  assert.equal(await page.textContent("#owner-proof-msg"), "Signing was cancelled.");
  assert.equal(await page.isDisabled("#owner-proof-btn"), false);
  assert.equal((await page.evaluate(() => window.__calls)).some((c) => c[1] === "submit_owner_proof"), false);
  assert.deepEqual(problems, []);
  await context.close();

  // --- status.html: server refuses (rate limit) → message shown
  ({ page, context, problems } = await open(`status.html#t=${TOKEN}`, { status: [none], request: "invalid" }, { wallet: "ok" }));
  await page.waitForSelector("#owner-proof-root:not([hidden])");
  await page.click("#owner-proof-btn");
  await page.waitForTimeout(300);
  assert.match(await page.textContent("#owner-proof-msg"), /Too many signing requests/);
  assert.equal((await page.evaluate(() => window.__wallet)).length, 0, "wallet not asked when the server refused");
  await context.close();

  // --- status.html: outcomes
  const outcomes = [
    [{ ...none, signer: SIGNER, signed_at: "2026-10-20T08:00:00Z", last_status: "accepted", last_reason: "accepted" }, /^Contract owner signed a message · Oct 20, 2026\. Signed by 0x2b5a/, "Sign again"],
    [{ ...none, last_status: "rejected", last_reason: "not_owner" }, /not the contract's current owner\(\)/, "Sign with wallet"],
    [{ ...none, last_status: "rejected", last_reason: "no_owner" }, /no owner\(\) we can read.*can't be shown with this feature yet/, null],
    [{ ...none, last_status: "rejected", last_reason: "owner_is_contract" }, /another contract \(for example a multisig\)/, null],
    [{ ...none, last_status: "rejected", last_reason: "not_a_contract" }, /no contract at this address/, null],
    [{ ...none, last_status: "revoked", last_reason: "owner_changed" }, /owner\(\) changed after you signed/, null],
    [{ ...none, last_status: "expired", last_reason: "expired" }, /expired before it was signed/, null],
    [{ ...none, last_status: "rejected", last_reason: "something_new" }, /^The last signature was not accepted\. Start again\.$/, null],
  ];
  for (const [row, expected, button] of outcomes) {
    ({ page, context, problems } = await open(`status.html#t=${TOKEN}`, { status: [row] }, { wallet: "ok" }));
    await page.waitForSelector("#owner-proof-root:not([hidden])");
    assert.match(await page.textContent("#owner-proof-state"), expected);
    if (button) assert.equal(await page.textContent("#owner-proof-btn"), button);
    for (const t of await ownerTexts(page)) assert.doesNotMatch(t, FORBIDDEN, t);
    assert.deepEqual(problems, []);
    await context.close();
  }

  // --- status.html: hidden without contract address, and for pending listings
  for (const opts of [{ status: [{ ...none, contract_address: null }] }, { status: [none], pending: true }]) {
    ({ page, context, problems } = await open(`status.html#t=${TOKEN}`, opts, { wallet: "ok" }));
    await page.waitForSelector(".status-card[data-state]");
    await page.waitForTimeout(300);
    assert.equal(await page.isHidden("#owner-proof-root"), true);
    assert.deepEqual(problems, []);
    await context.close();
  }

  // --- phone widths
  for (const width of [320, 375]) {
    for (const [file, opts, label] of [
      ["search.html", {}, "search"],
      [`agent.html?id=${A1}`, {}, "detail"],
      [`status.html#t=${TOKEN}`, { status: [{ ...none, signer: SIGNER, signed_at: "2026-10-20T08:00:00Z", last_status: "accepted" }] }, "status"],
    ]) {
      ({ page, context } = await open(file, opts, { width, wallet: "ok" }));
      if (label === "status") {
        await page.waitForSelector("#owner-proof-root:not([hidden])");
        await page.click("#owner-proof-btn");
        await page.waitForTimeout(300);
      }
      const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
      assert.ok(r.sw <= r.iw, `${label}: horizontal scroll at ${width}px (${r.sw} > ${r.iw})`);
      if (process.env.SHOT_DIR) {
        await page.waitForTimeout(800);
        await page.screenshot({ path: path.join(process.env.SHOT_DIR, `owner-${label}-${width}.png`), fullPage: true });
      }
      await context.close();
    }
  }

  await browser.close();
  server.close();
  console.log("owner signature browser tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
