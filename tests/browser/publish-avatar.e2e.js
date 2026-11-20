// Browser test: the optional GitHub avatar checkbox on publish.html.
//   NODE_PATH="$(npm root -g)" node tests/browser/publish-avatar.e2e.js   (SHOT=<path>, W=<width>)
const http = require("http"), fs = require("fs"), path = require("path");
const assert = require("assert/strict");
const { chromium } = require("playwright");
const ROOT = path.join(__dirname, "..", "..");
const mock = `window.__inserts=[];(function(){function q(t){const o={select(){return o},eq(){return o},order(){return o},limit(){return o},insert(rows){window.__inserts.push(rows[0]);return Promise.resolve({error:null})},then(r,j){return Promise.resolve({data:[],error:null}).then(r,j)}};return o}
window.supabase={createClient(){return{from:q,rpc(){return Promise.resolve({data:[],error:null})}}}}})();`;
(async () => {
  const server = http.createServer((req, res) => {
    const p = path.join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
    const t = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".webp": "image/webp", ".svg": "image/svg+xml" };
    res.writeHead(200, { "Content-Type": t[path.extname(p)] || "application/octet-stream" });
    fs.createReadStream(p).pipe(res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  async function submit(tick) {
    const page = await browser.newPage({ viewport: { width: +(process.env.W || 390), height: 900 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/*", (route) => {
      const u = route.request().url();
      if (u.startsWith(base)) return route.continue();
      if (u.includes("supabase-js")) return route.fulfill({ status: 200, contentType: "text/javascript", body: mock });
      return route.abort();
    });
    await page.goto(base + "publish.html");
    await page.fill("#name", "Avatar Test");
    await page.fill("#description", "A listing used by the avatar e2e test.");
    await page.fill("#version", "1.0.0");
    await page.fill("#category", "testing");
    await page.fill("#repo_url", "https://github.com/someone/avatar-test");
    if (tick) await page.check("#use_avatar");
    if (process.env.SHOT && tick) {
      await (await page.$("#use_avatar")).scrollIntoViewIfNeeded();
      await page.screenshot({ path: process.env.SHOT });
    }
    await page.click("#submit-btn");
    await page.waitForTimeout(500);
    const inserts = await page.evaluate(() => window.__inserts);
    assert.deepEqual(errors, []);
    await page.close();
    return inserts;
  }
  const off = await submit(false);
  assert.equal(off.length, 1);
  assert.equal("use_avatar" in off[0], false, "unticked: field must not be sent");
  const on = await submit(true);
  assert.equal(on.length, 1);
  assert.equal(on[0].use_avatar, true);
  assert.equal(on[0].approved, undefined);
  await browser.close(); server.close();
  console.log("publish-avatar e2e: ok");
})().catch((e) => { console.error(e); process.exit(1); });
