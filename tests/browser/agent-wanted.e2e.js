// Browser test: "Answers a Wanted request" box on the listing page.
//   NODE_PATH="$(npm root -g)" node tests/browser/agent-wanted.e2e.js   (SHOT=<path>, W=<width>)
// Supabase is replaced by a mock; other outside requests are blocked.
const http = require("http"), fs = require("fs"), path = require("path");
const assert = require("assert/strict");
const { chromium } = require("playwright");
const ROOT = path.join(__dirname, "..", "..");
const WID = "11111111-2222-4333-8444-555555555555";
const AID = "00000000-0000-4000-8000-0000000000b1";
const agent = { id: AID, name: "Contract change watcher", kind: "tool", version: "1.0.0", repo_url: "https://github.com/nebulamji/rh-tx-explain", demo_url: null, description: "Watches a contract and reports changes.", category: ["security"], created_at: "2026-11-19T08:43:00Z", verified: false, github_stars: null, github_updated_at: null, contract_address: null, live_status: null, live_checked_at: null, approved: true };
const CASES = {
  linked: { wanted_id: WID, wanted: { id: WID, title: "Contract change watcher", created_at: "2026-10-20T08:43:00Z" } },
  noLink: { wanted_id: null, wanted: null },
  gone: { wanted_id: WID, wanted: null },
  evil: { wanted_id: WID, wanted: { id: WID, title: "<img src=x onerror=window.__pwn=1>Watcher", created_at: "2026-11-19T01:00:00Z" } },
  badId: { wanted_id: "not-a-uuid", wanted: { id: WID, title: "x", created_at: "2026-10-20T08:43:00Z" } },
};
const mockFor = (c) => `(function(){const A=${JSON.stringify(agent)};const C=${JSON.stringify(c)};
function b(t){const o={_t:t,_cols:"",select(c){o._cols=c;return o},eq(){return o},order(){return o},limit(){return o},in(){return o},neq(){return o},not(){return o},overlaps(){return o},ilike(){return o},
 single(){o._1=1;return o},maybeSingle(){o._1=1;return o},
 then(r,j){let d;if(o._t==="wanted")d=C.wanted;else if(o._cols.trim()==="wanted_id")d={wanted_id:C.wanted_id};else d=o._1?A:[A];return Promise.resolve({data:d,error:null}).then(r,j)}};return o}
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
  async function open(name) {
    const page = await browser.newPage({ viewport: { width: +(process.env.W || 430), height: 900 }, deviceScaleFactor: 2 });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/*", (r) => {
      const u = r.request().url();
      if (u.startsWith(base)) return r.continue();
      if (u.includes("supabase-js")) return r.fulfill({ status: 200, contentType: "text/javascript", body: mockFor(CASES[name]) });
      return r.abort();
    });
    await page.goto(`${base}agent.html?id=${AID}`);
    await page.waitForSelector(".detail-card");
    await page.waitForTimeout(500);
    return { page, errors };
  }
  // linked: visible box, right text, right href
  let { page, errors } = await open("linked");
  const box = await page.$("#wanted-answer");
  assert.equal(await box.isVisible(), true);
  assert.equal(await page.textContent("#wanted-answer .wanted-answer-title"), "Contract change watcher");
  assert.match(await page.textContent("#wanted-answer .wanted-answer-eyebrow"), /Answers a Wanted request/);
  assert.equal(await page.textContent("#wanted-answer .wanted-answer-sub"), "Open for 30 days · See the request →");
  assert.equal(await box.getAttribute("href"), `wanted.html?id=${WID}`);
  assert.deepEqual(errors, []);
  if (process.env.SHOT) { await (await page.$(".detail-card")).screenshot({ path: process.env.SHOT }); }
  await page.close();
  // no link / request gone / bad id: stays hidden
  for (const n of ["noLink", "gone", "badId"]) {
    ({ page, errors } = await open(n));
    assert.equal(await (await page.$("#wanted-answer")).isVisible(), false, n);
    assert.deepEqual(errors, [], n);
    await page.close();
  }
  // hostile title: shown as plain text, nothing runs; same-day answer text
  ({ page, errors } = await open("evil"));
  assert.equal(await page.evaluate(() => window.__pwn), undefined);
  assert.equal(await page.$("#wanted-answer img"), null);
  assert.match(await page.textContent("#wanted-answer .wanted-answer-title"), /^<img src=x onerror/);
  assert.match(await page.textContent("#wanted-answer .wanted-answer-sub"), /^Answered within a day · /);
  await page.close();
  await browser.close(); server.close();
  console.log("agent-wanted e2e: ok");
})().catch((e) => { console.error(e); process.exit(1); });
