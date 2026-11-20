// ============================================
// Agraris: unduh avatar GitHub untuk listing yang memintanya
// ============================================
// Jalan di workflow "Generate feeds" (punya akses jaringan penuh).
// Untuk setiap listing approved dengan use_avatar = true: unduh avatar
// pemilik repo (https://github.com/<owner>.png?size=160), periksa (hanya
// png/jpg, maks 150 KB, dicek dari byte awal), simpan di logos/avatars/,
// lalu tulis ulang avatar-logos.js. Gagal untuk satu listing tidak
// menghentikan yang lain; listing tanpa file tidak masuk peta, jadi situs
// tetap memakai ikon robot Agraris.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Jangan mencetak isi env var atau header.

const fs = require("fs");
const path = require("path");
const { rest, filter, requireEnv } = require("./review-lib.js");
const lib = require("./avatar-lib.js");

const ROOT = path.join(__dirname, "..");
const AVATAR_DIR = path.join(ROOT, "logos", "avatars");
const OUT_FILE = path.join(ROOT, "avatar-logos.js");

// Kunci repo_url dari AGENT_LOGOS di app.js (logo manual menang).
function manualLogoKeys() {
  const src = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
  const block = src.match(/const AGENT_LOGOS = \{([\s\S]*?)\n\};/);
  const keys = new Set();
  if (!block) return keys;
  for (const m of block[1].matchAll(/"(https:\/\/[^"]+)":/g)) keys.add(m[1].toLowerCase().replace(/\/+$/, ""));
  return keys;
}

function existingFile(owner) {
  for (const kind of ["png", "jpg"]) {
    const rel = lib.avatarFile(owner, kind);
    if (fs.existsSync(path.join(ROOT, rel))) return rel;
  }
  return null;
}

async function download(owner) {
  const res = await fetch(`https://github.com/${owner}.png?size=160`, { redirect: "follow" });
  if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
  const buf = Buffer.from(await res.arrayBuffer());
  return lib.checkAvatar(buf).ok ? { ok: true, buf, kind: lib.checkAvatar(buf).kind } : lib.checkAvatar(buf);
}

async function main() {
  requireEnv(["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]);
  const query = [
    "select=id,repo_url",
    filter("approved", "eq", "true"),
    filter("use_avatar", "eq", "true"),
    "order=created_at.asc",
    "limit=500",
  ].join("&");
  const { data } = await rest("GET", "agents", query);
  const rows = Array.isArray(data) ? data : [];

  fs.mkdirSync(AVATAR_DIR, { recursive: true });
  const owners = [...new Set(rows.map((r) => lib.githubOwner(r.repo_url)).filter(Boolean))];
  for (const owner of owners) {
    if (existingFile(owner)) continue; // sudah ada: tidak diunduh ulang
    try {
      const got = await download(owner);
      if (!got.ok) {
        console.log(`[fetch-avatars] skip ${owner}: ${got.reason}`);
        continue;
      }
      fs.writeFileSync(path.join(ROOT, lib.avatarFile(owner, got.kind)), got.buf);
      console.log(`[fetch-avatars] saved ${owner}.${got.kind} (${got.buf.length} bytes)`);
    } catch {
      console.log(`[fetch-avatars] skip ${owner}: network error`);
    }
  }

  const map = lib.buildAvatarMap(rows, existingFile, manualLogoKeys());
  const next = lib.renderAvatarLogosJs(map);
  const prev = fs.existsSync(OUT_FILE) ? fs.readFileSync(OUT_FILE, "utf8") : "";
  if (next !== prev) {
    fs.writeFileSync(OUT_FILE, next);
    console.log(`[fetch-avatars] avatar-logos.js updated (${Object.keys(map).length} entries)`);
  } else {
    console.log("[fetch-avatars] no changes");
  }
}

if (require.main === module) {
  main().catch((err) => {
    // Non-fatal untuk workflow: cetak pesan saja.
    console.log(`[fetch-avatars] failed: ${err && err.message ? err.message : "unknown error"}`);
  });
}

module.exports = { manualLogoKeys };
