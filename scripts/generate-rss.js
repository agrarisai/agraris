// ============================================
// Agraris — generate RSS feed dari agent terbaru
// ============================================
// Dijalankan oleh .github/workflows/generate-rss.yml (cron harian +
// manual trigger). Mengambil 50 agent terbaru dari tabel `agents` di
// Supabase dan menulis feed RSS 2.0 ke rss.xml di root project.
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
const OUTPUT_PATH = path.join(__dirname, "..", "rss.xml");
const MAX_ITEMS = 50;

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

// When an agent appeared in the registry: coalesce(approved_at, created_at).
// approved_at is set when an entry leaves the review queue
// (supabase/migration-review-notify.sql); older rows fall back to created_at.
function publishedAt(agent) {
  return agent.approved_at || agent.created_at;
}

function byPublishedDesc(a, b) {
  return new Date(publishedAt(b)) - new Date(publishedAt(a));
}

function buildItem(agent) {
  const link = `${SITE_URL}agent.html?id=${encodeURIComponent(agent.id)}`;
  const pubDate = new Date(publishedAt(agent)).toUTCString();

  return [
    "    <item>",
    `      <title>${escapeXml(agent.name)}</title>`,
    `      <link>${escapeXml(link)}</link>`,
    `      <description>${escapeXml(agent.description)}</description>`,
    `      <pubDate>${pubDate}</pubDate>`,
    `      <guid isPermaLink="true">${escapeXml(link)}</guid>`,
    "    </item>",
  ].join("\n");
}

function buildRss(agents) {
  const items = agents.map(buildItem).join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0">',
    "  <channel>",
    "    <title>Agraris — Recently published agents</title>",
    `    <link>${SITE_URL}</link>`,
    "    <description>New AI agents published to the Agraris registry for Robinhood Chain</description>",
    items,
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");
}

async function main() {
  // PostgREST can't order by coalesce(approved_at, created_at), so fetch
  // the newest MAX_ITEMS of each kind (with and without approved_at),
  // then merge and sort here. Service role bypasses RLS, so pending
  // entries must be filtered out explicitly
  // (supabase/migration-review-queue.sql).
  const columns = "id, name, description, created_at, approved_at";
  const [withApproval, withoutApproval] = await Promise.all([
    supabase
      .from("agents")
      .select(columns)
      .eq("approved", true)
      .not("approved_at", "is", null)
      .order("approved_at", { ascending: false })
      .limit(MAX_ITEMS),
    supabase
      .from("agents")
      .select(columns)
      .eq("approved", true)
      .is("approved_at", null)
      .order("created_at", { ascending: false })
      .limit(MAX_ITEMS),
  ]);

  for (const res of [withApproval, withoutApproval]) {
    if (res.error) {
      throw new Error(`Failed to read agents table: ${res.error.message}`);
    }
  }

  const agents = [...(withApproval.data ?? []), ...(withoutApproval.data ?? [])]
    .sort(byPublishedDesc)
    .slice(0, MAX_ITEMS);

  const rss = buildRss(agents);
  fs.writeFileSync(OUTPUT_PATH, rss, "utf8");

  console.log(`Generated ${agents.length} RSS item(s) at ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
