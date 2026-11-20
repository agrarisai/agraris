// Tes untuk scripts/avatar-lib.js, scripts/fetch-avatars.js (manualLogoKeys),
// logika set-avatar di review-action, dan jalur avatar di app.js.
// Jalankan dari root repo: node --test tests/avatar-lib.test.js

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const lib = require("../scripts/avatar-lib.js");

const ROOT = path.join(__dirname, "..");

test("githubOwner: hanya github.com https dengan nama pengguna sah", () => {
  assert.equal(lib.githubOwner("https://github.com/Noisyxl/brier"), "noisyxl");
  assert.equal(lib.githubOwner("https://github.com/a-b/c.git"), "a-b");
  assert.equal(lib.githubOwner("https://github.com/OwNeR"), "owner");
  assert.equal(lib.githubOwner("http://github.com/x/y"), null);
  assert.equal(lib.githubOwner("https://gitlab.com/x/y"), null);
  assert.equal(lib.githubOwner("https://github.com.evil.com/x/y"), null);
  assert.equal(lib.githubOwner("https://github.com/"), null);
  // "/../" is normalised away by URL (no traversal possible); encoded forms are rejected.
  assert.equal(lib.githubOwner("https://github.com/..%2F..%2Fx/y"), null);
  assert.equal(lib.githubOwner("https://github.com/a%20b/y"), null);
  assert.equal(lib.githubOwner("https://github.com/-bad/repo"), null);
  assert.equal(lib.githubOwner("https://github.com/bad-/repo"), null);
  assert.equal(lib.githubOwner("https://github.com/" + "a".repeat(40) + "/r"), null);
  assert.equal(lib.githubOwner("not a url"), null);
  assert.equal(lib.githubOwner(null), null);
});

test("imageKind / checkAvatar: png dan jpg saja, dari byte awal", () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]);
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40)]);
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  const gif = Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(40)]);
  const webp = Buffer.concat([Buffer.from("RIFF\0\0\0\0WEBP"), Buffer.alloc(40)]);
  assert.deepEqual(lib.checkAvatar(png), { ok: true, kind: "png" });
  assert.deepEqual(lib.checkAvatar(jpg), { ok: true, kind: "jpg" });
  assert.equal(lib.checkAvatar(svg).ok, false);
  assert.equal(lib.checkAvatar(gif).ok, false);
  assert.equal(lib.checkAvatar(webp).ok, false);
  assert.equal(lib.checkAvatar(Buffer.alloc(0)).ok, false);
  const big = Buffer.concat([png, Buffer.alloc(lib.MAX_AVATAR_BYTES)]);
  assert.equal(lib.checkAvatar(big).ok, false);
  assert.equal(lib.checkAvatar(big).reason, "terlalu besar");
});

test("buildAvatarMap: lewati logo manual, repo non-GitHub dan file yang tidak ada", () => {
  const rows = [
    { repo_url: "https://github.com/Alpha/one" },
    { repo_url: "https://github.com/beta/two/" },
    { repo_url: "https://github.com/manual/owner" },
    { repo_url: "https://example.com/x/y" },
    { repo_url: "https://github.com/nofile/repo" },
  ];
  const files = { alpha: "logos/avatars/alpha.png", beta: "logos/avatars/beta.jpg", manual: "logos/avatars/manual.png" };
  const map = lib.buildAvatarMap(rows, (o) => files[o] || null, new Set(["https://github.com/manual/owner"]));
  assert.deepEqual(map, {
    "https://github.com/alpha/one": "logos/avatars/alpha.png",
    "https://github.com/beta/two": "logos/avatars/beta.jpg",
  });
});

test("renderAvatarLogosJs: JS valid, terurut, dan aman terhadap kutip", () => {
  const out = lib.renderAvatarLogosJs({
    "https://github.com/z/z": "logos/avatars/z.png",
    "https://github.com/a/a": "logos/avatars/a.png",
  });
  assert.ok(out.indexOf("/a/a") < out.indexOf("/z/z"));
  const AVATAR_LOGOS = new Function(`${out}; return AVATAR_LOGOS;`)();
  assert.equal(AVATAR_LOGOS["https://github.com/a/a"], "logos/avatars/a.png");
  assert.equal(lib.renderAvatarLogosJs({}).includes("const AVATAR_LOGOS = {"), true);
  new Function(`${lib.renderAvatarLogosJs({})}; return AVATAR_LOGOS;`)();
});

test("avatar-logos.js di repo valid dan dimuat di semua halaman yang memuat app.js", () => {
  const src = fs.readFileSync(path.join(ROOT, "avatar-logos.js"), "utf8");
  new Function(`${src}; return AVATAR_LOGOS;`)();
  for (const f of fs.readdirSync(ROOT).filter((n) => n.endsWith(".html"))) {
    const html = fs.readFileSync(path.join(ROOT, f), "utf8");
    if (/<script src="app\.js/.test(html)) {
      assert.ok(html.includes('<script src="avatar-logos.js"></script>'), `${f} tidak memuat avatar-logos.js`);
    }
  }
});

test("app.js: logo manual menang atas avatar, avatar menang atas ikon bawaan", () => {
  const src = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
  const start = src.indexOf("function agentLogoPath");
  const end = src.indexOf("\n}\n", start) + 3;
  const AGENT_LOGOS = { "https://github.com/m/m": "logos/manual.webp" };
  const AVATAR_LOGOS = { "https://github.com/m/m": "logos/avatars/m.png", "https://github.com/a/a": "logos/avatars/a.png" };
  const fn = new Function("AGENT_LOGOS", "AVATAR_LOGOS", `${src.slice(start, end)}; return agentLogoPath;`)(AGENT_LOGOS, AVATAR_LOGOS);
  assert.equal(fn({ repo_url: "https://github.com/M/m/" }), "logos/manual.webp");
  assert.equal(fn({ repo_url: "https://github.com/a/a" }), "logos/avatars/a.png");
  assert.equal(fn({ repo_url: "https://github.com/none/none" }), null);
  // Tanpa avatar-logos.js (AVATAR_LOGOS tidak terdefinisi) tidak boleh error.
  const fn2 = new Function("AGENT_LOGOS", `${src.slice(start, end)}; return agentLogoPath;`)(AGENT_LOGOS);
  assert.equal(fn2({ repo_url: "https://github.com/a/a" }), null);
});

test("publish: kotak centang dikirim hanya bila dicentang; workflow dan migrasi ada", () => {
  const js = fs.readFileSync(path.join(ROOT, "publish.js"), "utf8");
  assert.match(js, /form\.use_avatar && form\.use_avatar\.checked/);
  assert.match(js, /payload\.use_avatar = true/);
  const html = fs.readFileSync(path.join(ROOT, "publish.html"), "utf8");
  assert.match(html, /id="use_avatar"/);
  const wf = fs.readFileSync(path.join(ROOT, ".github/workflows/generate-rss.yml"), "utf8");
  assert.match(wf, /node scripts\/fetch-avatars\.js/);
  assert.match(wf, /git add -A [^\n]*avatar-logos\.js logos\/avatars/);
  assert.ok(fs.existsSync(path.join(ROOT, "logos/avatars/.gitkeep")));
  assert.ok(fs.existsSync(path.join(ROOT, "supabase/migration-avatar-optin.sql")));
});

test("fetch-avatars: manualLogoKeys membaca AGENT_LOGOS dari app.js", () => {
  const { manualLogoKeys } = require("../scripts/fetch-avatars.js");
  const keys = manualLogoKeys();
  assert.ok(keys.has("https://github.com/noisyxl/brier"));
  assert.ok(keys.size >= 5);
});
