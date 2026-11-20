// ============================================
// Agraris: helper murni untuk logo avatar GitHub (opsional)
// ============================================
// Dipakai oleh scripts/fetch-avatars.js. Tanpa dependensi dan tanpa
// jaringan di file ini, supaya mudah diuji.
//
// Keamanan: nama pemilik diambil dari repo_url (teks dari pengirim) dan
// dipakai sebagai nama file. Karena itu hanya pola nama pengguna GitHub
// yang sah yang diterima; selain itu ditolak, bukan dibersihkan.

const MAX_AVATAR_BYTES = 150 * 1024;
const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;

// "https://github.com/Owner/repo(.git)(/...)" → "owner" (huruf kecil), atau null.
function githubOwner(repoUrl) {
  let url;
  try {
    url = new URL(String(repoUrl || "").trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com") return null;
  const owner = url.pathname.split("/").filter(Boolean)[0] || "";
  if (!OWNER_PATTERN.test(owner)) return null;
  return owner.toLowerCase();
}

// Jenis gambar dari byte awal (bukan dari header server): "png", "jpg" atau null.
// WebP, GIF dan SVG sengaja tidak diterima.
function imageKind(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  return null;
}

// Tolak yang bukan png/jpg atau terlalu besar. Mengembalikan { ok, kind, reason }.
function checkAvatar(buf) {
  if (!buf || buf.length === 0) return { ok: false, reason: "kosong" };
  if (buf.length > MAX_AVATAR_BYTES) return { ok: false, reason: "terlalu besar" };
  const kind = imageKind(buf);
  if (!kind) return { ok: false, reason: "bukan png/jpg" };
  return { ok: true, kind };
}

function avatarFile(owner, kind) {
  return `logos/avatars/${owner}.${kind}`;
}

// rows: [{ repo_url }] dari listing approved dengan use_avatar = true.
// fileFor(owner) → path relatif bila file avatar ada, selain itu null.
// manualKeys: Set repo_url (huruf kecil) yang sudah punya logo manual;
// dilewati supaya logo manual tetap menang.
function buildAvatarMap(rows, fileFor, manualKeys = new Set()) {
  const map = {};
  for (const row of rows) {
    const key = String(row.repo_url || "").trim().toLowerCase().replace(/\/+$/, "");
    if (!key || manualKeys.has(key)) continue;
    const owner = githubOwner(row.repo_url);
    if (!owner) continue;
    const file = fileFor(owner);
    if (file) map[key] = file;
  }
  return map;
}

// Isi avatar-logos.js: satu objek global, diurutkan agar diff stabil.
function renderAvatarLogosJs(map) {
  const keys = Object.keys(map).sort();
  const lines = keys.map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(map[k])},`);
  return [
    "// Dibuat otomatis oleh scripts/fetch-avatars.js (workflow Generate feeds).",
    "// Jangan diedit manual. Logo manual ada di AGENT_LOGOS (app.js) dan menang.",
    "const AVATAR_LOGOS = {",
    ...lines,
    "};",
    "",
  ].join("\n");
}

module.exports = {
  MAX_AVATAR_BYTES,
  githubOwner,
  imageKind,
  checkAvatar,
  avatarFile,
  buildAvatarMap,
  renderAvatarLogosJs,
};
