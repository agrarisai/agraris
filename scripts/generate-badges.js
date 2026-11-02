// ============================================
// Agraris — generate badges/<id>.svg (lencana README per listing)
// ============================================
// Dijalankan oleh .github/workflows/generate-rss.yml setelah
// update-github-stats.js. Menulis satu SVG per listing yang approved;
// bagian kanan berisi "active this week · N commits" bila ada commit 7 hari,
// selain itu "listed · Robinhood Chain". File listing yang sudah tidak ada
// dihapus. Ditulis hanya bila isinya berubah, jadi tidak membuat commit
// sia-sia. github_activity dibaca terpisah: bila kolom belum ada, semua
// lencana memakai teks netral.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const { normalizeActivity } = require("./activity-lib");
const { renderBadge } = require("./badge-lib");

const OUT_DIR = path.join(__dirname, "..", "badges");
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(url, key);

  const base = await supabase.from("agents").select("id").eq("approved", true);
  if (base.error) throw new Error(`Supabase query failed: ${base.error.message}`);
  const ids = (base.data || []).map((r) => r.id).filter((id) => UUID_RE.test(String(id)));

  const activityById = new Map();
  const act = await supabase.from("agents").select("id, github_activity").eq("approved", true);
  if (act.error) console.log(`[generate-badges] github_activity unavailable, using neutral badges: ${act.error.message}`);
  else for (const r of act.data || []) activityById.set(r.id, normalizeActivity(r.github_activity));

  fs.mkdirSync(OUT_DIR, { recursive: true });
  let written = 0;
  for (const id of ids) {
    const svg = renderBadge(activityById.get(id));
    const file = path.join(OUT_DIR, `${id}.svg`);
    if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === svg) continue;
    fs.writeFileSync(file, svg);
    written += 1;
  }

  const keep = new Set(ids.map((id) => `${id}.svg`));
  let removed = 0;
  for (const f of fs.readdirSync(OUT_DIR)) {
    if (f.endsWith(".svg") && !keep.has(f)) {
      fs.unlinkSync(path.join(OUT_DIR, f));
      removed += 1;
    }
  }
  console.log(`[generate-badges] ${ids.length} listings, ${written} written, ${removed} removed.`);
}

main().catch((err) => {
  console.error(`[generate-badges] failed: ${err && err.message ? err.message : String(err)}`);
  process.exitCode = 1;
});
