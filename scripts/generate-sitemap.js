// ============================================
// Agraris — generate sitemap.xml dari seluruh agent + kategori
// ============================================
// Dijalankan oleh .github/workflows/generate-rss.yml (cron harian +
// manual trigger), sebagai step terpisah setelah generate-rss.js.
// Mengambil SEMUA agent dari tabel `agents` di Supabase (bukan cuma
// yang terbaru seperti RSS, karena sitemap butuh cakupan penuh) dan
// menulis sitemap.xml ke root project.
//
// Env vars yang dibutuhkan:
//   SUPABASE_URL              — Project URL Supabase
//   SUPABASE_SERVICE_ROLE_KEY — service_role key (JANGAN dipakai di client-side!)

const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variable."
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const SITE_URL = "https://agrarisai.github.io/agraris/";
const OUTPUT_PATH = path.join(__dirname, "..", "sitemap.xml");

const STATIC_PAGES = [
  { file: "index.html", changefreq: "weekly", priority: "1.0" },
  { file: "search.html", changefreq: "weekly", priority: "0.8" },
  { file: "publish.html", changefreq: "weekly", priority: "0.8" },
  { file: "docs.html", changefreq: "weekly", priority: "0.8" },
];

function escapeXml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&apos;";
      default:
        return char;
    }
  });
}

// category column may be stored as text or as a Postgres text[] array.
// Normalize to a plain array of strings either way.
function normalizeCategories(raw) {
  if (Array.isArray(raw)) return raw.filter(Boolean);
  if (typeof raw === "string" && raw.trim() !== "") {
    const cleaned = raw.replace(/^{|}$/g, "");
    return cleaned
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

function formatDate(isoString) {
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function buildUrlEntry({ loc, lastmod, changefreq, priority }) {
  return [
    "  <url>",
    `    <loc>${escapeXml(loc)}</loc>`,
    lastmod ? `    <lastmod>${lastmod}</lastmod>` : null,
    `    <changefreq>${changefreq}</changefreq>`,
    `    <priority>${priority}</priority>`,
    "  </url>",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildSitemap(agents, categories) {
  const staticEntries = STATIC_PAGES.map((page) =>
    buildUrlEntry({
      loc: `${SITE_URL}${page.file}`,
      changefreq: page.changefreq,
      priority: page.priority,
    })
  );

  const agentEntries = agents.map((agent) =>
    buildUrlEntry({
      loc: `${SITE_URL}agent.html?id=${encodeURIComponent(agent.id)}`,
      lastmod: formatDate(agent.created_at),
      changefreq: "monthly",
      priority: "0.6",
    })
  );

  const categoryEntries = categories.map((slug) =>
    buildUrlEntry({
      loc: `${SITE_URL}category.html?slug=${encodeURIComponent(slug)}`,
      changefreq: "weekly",
      priority: "0.5",
    })
  );

  const urls = [...staticEntries, ...agentEntries, ...categoryEntries].join(
    "\n"
  );

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    urls,
    "</urlset>",
    "",
  ].join("\n");
}

async function main() {
  const { data: agents, error } = await supabase
    .from("agents")
    .select("id, category, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to read agents table: ${error.message}`);
  }

  const allAgents = agents ?? [];

  const categories = [
    ...new Set(allAgents.flatMap((agent) => normalizeCategories(agent.category))),
  ].sort();

  const sitemap = buildSitemap(allAgents, categories);
  fs.writeFileSync(OUTPUT_PATH, sitemap, "utf8");

  console.log(
    `Generated sitemap with ${allAgents.length} agent(s) and ${categories.length} categor${categories.length === 1 ? "y" : "ies"} at ${OUTPUT_PATH}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
