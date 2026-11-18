// Browser test for the homepage "Wanted right now" block.
//   NODE_PATH="$(npm root -g)" node tests/browser/home-wanted.e2e.js   (SHOT=<path>, W=<width>)
const http = require("http"), fs = require("fs"), path = require("path");
const assert = require("assert/strict");
const { chromium } = require("playwright");
const ROOT = path.join(__dirname, "..", "..");
const day = (n) => new Date(Date.now() - n * 864e5).toISOString();
const ROWS = [
  { id: "a1", title: "Answered one <b>x</b>", description: "d", kind: "tool", created_at: day(1), answers_count: 1 },
  { id: "a2", title: "Agent for X", description: "Needs   an agent that does a long thing. ".repeat(6), kind: "agent", created_at: day(2), answers_count: 0 },
  { id: "a3", title: "Tool for <i>Y</i>", description: "short", kind: "tool", created_at: day(3), answers_count: 0 },
  { id: "a4", title: "Old request", description: "old", kind: "agent", created_at: day(9), answers_count: 0 },
  { id: "a5", title: "Oldest", description: "old", kind: "agent", created_at: day(20), answers_count: 0 },
];
const mock = (mode) => `(function(){const R=${JSON.stringify(ROWS)};const M=${JSON.stringify(mode)};
function b(){const q={select(){return q},eq(){return q},neq(){return q},in(){return q},overlaps(){return q},contains(){return q},ilike(){return q},or(){return q},order(){return q},not(){return q},limit(){return q},
then(r,j){return Promise.resolve({data:[],count:0,error:null}).then(r,j)}};return q}
window.supabase={createClient(){return{from:b,rpc(n){
if(n!=="get_wanted")return Promise.resolve({data:[],error:null});
if(M==="error")return Promise.resolve({data:null,error:{message:"x"}});
if(M==="empty")return Promise.resolve({data:[],error:null});
return Promise.resolve({data:R,error:null});}};}};})();`;
(async () => {
  const server = http.createServer((req, res) => {
    const p = path.join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
    const t = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".webp": "image/webp", ".svg": "image/svg+xml", ".json": "application/json" };
    res.writeHead(200, { "Content-Type": t[path.extname(p)] || "application/octet-stream" });
    fs.createReadStream(p).pipe(res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  async function run(mode, width = 1100) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const problems = [];
    page.on("pageerror", (e) => problems.push(e.message));
    await page.route("**/*", (route) => {
      const u = route.request().url();
      if (u.startsWith(base)) return route.continue();
      if (u.includes("@supabase/supabase-js")) return route.fulfill({ status: 200, contentType: "text/javascript", body: mock(mode) });
      return route.abort();
    });
    await page.goto(base + "index.html");
    await page.waitForTimeout(800);
    return { page, problems };
  }
  let { page, problems } = await run("ok");
  const cards = await page.$$eval("#wanted-home-list a", (a) => a.map((x) => ({ t: x.querySelector("strong").textContent, h: x.getAttribute("href"), d: x.querySelector(".wanted-home-desc").textContent, html: x.innerHTML })));
  assert.equal(await page.$eval("#wanted-home", (s) => s.hidden), false);
  assert.deepEqual(cards.map((c) => c.t), ["Agent for X", "Tool for <i>Y</i>", "Old request"]);
  assert.ok(cards.every((c) => !c.html.includes("<i>") && !c.html.includes("<b>")), "text must be escaped");
  assert.equal(cards[0].h, "wanted.html?id=a2");
  assert.ok(cards[0].d.length <= 110 && cards[0].d.endsWith("..."));
  assert.equal(await page.$eval(".wanted-home-ask", (a) => a.getAttribute("href")), "wanted.html#wanted-form-section");
  assert.deepEqual(problems, []);
  if (process.env.SHOT) { await page.setViewportSize({ width: +(process.env.W || 1100), height: 900 }); await (await page.$("#wanted-home")).screenshot({ path: process.env.SHOT }); }
  for (const m of ["empty", "error"]) {
    ({ page, problems } = await run(m));
    assert.equal(await page.$eval("#wanted-home", (s) => s.hidden), true, m);
    assert.deepEqual(problems, []);
  }
  ({ page } = await run("ok", 390));
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= 390), "no horizontal scroll at 390");
  await browser.close(); server.close();
  console.log("home-wanted e2e: ok");
})().catch((e) => { console.error(e); process.exit(1); });
