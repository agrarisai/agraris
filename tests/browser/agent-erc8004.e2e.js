// Browser test: "ERC-8004 identity" row on the listing page.
//   NODE_PATH="$(npm root -g)" node tests/browser/agent-erc8004.e2e.js   (SHOT=<path>, W=<width>)
// Supabase is replaced by a mock; other outside requests are blocked.
const http = require("http"), fs = require("fs"), path = require("path");
const assert = require("assert/strict");
const { chromium } = require("playwright");
const ROOT = path.join(__dirname, "..", "..");
const AID = "00000000-0000-4000-8000-0000000000b1";
const agent = { id: AID, name: "Contract change watcher", kind: "tool", version: "1.0.0", repo_url: "https://github.com/nebulamji/rh-tx-explain", demo_url: null, description: "Watches a contract and reports changes.", category: ["security"], created_at: "2026-11-19T08:43:00Z", verified: false, github_stars: null, github_updated_at: null, contract_address: null, live_status: null, live_checked_at: null, approved: true };
const mockFor = (id, fail) => `(function(){const A=${JSON.stringify(agent)};const ID=${JSON.stringify(id)};const FAIL=${fail};
function b(t){const o={_cols:"",select(c){o._cols=c;return o},eq(){return o},order(){return o},limit(){return o},in(){return o},neq(){return o},not(){return o},overlaps(){return o},ilike(){return o},or(){return o},gte(){return o},
 single(){o._1=1;return o},maybeSingle(){o._1=1;return o},
 then(r,j){let d,e=null;const c=o._cols.trim();if(c==="erc8004_agent_id"){if(FAIL){d=null;e={message:"column does not exist"}}else d={erc8004_agent_id:ID}}else if(c==="wanted_id")d={wanted_id:null};else d=o._1?A:[A];return Promise.resolve({data:d,error:e}).then(r,j)}};return o}
window.supabase={createClient(){return{from:b,rpc(){return Promise.resolve({data:[],error:null})}}}}})();`;
(async () => {
  const server = http.createServer((q, s) => {
    const p = path.join(ROOT, decodeURIComponent(new URL(q.url, "http://x").pathname));
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { s.writeHead(404); return s.end(); }
    const t = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".webp": "image/webp", ".svg": "image/svg+xml", ".png": "image/png" };
    s.writeHead(200, { "Content-Type": t[path.extname(p)] || "application/octet-stream" });
    fs.createReadStream(p).pipe(s);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  async function open(id, fail = false) {
    const page = await browser.newPage({ viewport: { width: +(process.env.W || 430), height: 900 }, deviceScaleFactor: 2 });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/*", (r) => {
      const u = r.request().url();
      if (u.startsWith(base)) return r.continue();
      if (u.includes("supabase-js")) return r.fulfill({ status: 200, contentType: "text/javascript", body: mockFor(id, fail) });
      return r.abort();
    });
    await page.goto(`${base}agent.html?id=${AID}`);
    await page.waitForSelector(".detail-card");
    await page.waitForTimeout(500);
    return { page, errors };
  }
  const hidden = (page) => page.$eval("#erc8004-row", (e) => e.hidden || getComputedStyle(e).display === "none");

  // valid id: row visible, plain text, no link
  let { page, errors } = await open("20805");
  assert.equal(await hidden(page), false);
  assert.equal(await page.$eval("#erc8004-row .erc8004-value", (e) => e.textContent), "Agent #20805 on Robinhood Chain");
  assert.equal(await page.$$eval("#erc8004-row a", (a) => a.length), 0, "no link");
  assert.match(await page.$eval("#erc8004-row .erc8004-note", (e) => e.textContent), /Not verified by Agraris/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "no horizontal scroll");
  assert.deepEqual(errors, []);
  if (process.env.SHOT) { await (await page.$("#erc8004-row")).scrollIntoViewIfNeeded(); await page.screenshot({ path: process.env.SHOT }); }
  await page.close();

  // missing, malformed, evil, and failing column: row stays hidden
  for (const [label, id, fail] of [["none", null, false], ["leading zero", "0123", false], ["html", "<img src=x onerror=window.__pwn=1>", false], ["too long", "1".repeat(21), false], ["column missing", "20805", true]]) {
    ({ page, errors } = await open(id, fail));
    assert.equal(await hidden(page), true, label);
    assert.equal(await page.evaluate(() => window.__pwn === undefined), true, label);
    assert.deepEqual(errors, [], label);
    await page.close();
  }
  await browser.close();
  server.close();
  console.log("agent-erc8004 e2e: ok");
})().catch((e) => { console.error(e); process.exit(1); });
