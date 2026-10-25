// ============================================
// Agraris — generate api/agents.json (JSON API statis untuk agent AI)
// ============================================
// Dijalankan oleh .github/workflows/generate-rss.yml (cron harian +
// manual trigger), sebagai step terpisah setelah generate-sitemap.js.
// Mengambil SEMUA listing yang sudah approved (agent dan tool) dari tabel
// `agents` di Supabase dan menulis api/agents.json. File itu ikut
// di-commit ke main oleh workflow, lalu disajikan GitHub Pages di
// https://agraris.xyz/api/agents.json.
//
// Hanya field di PUBLIC_FIELDS yang pernah ditulis. Kolom internal
// (status_token, notified_at, approved, updated_at, ...) dan isi
// agent_edits tidak pernah diminta ke Supabase dan tidak pernah disalin.
// tests/generate-api.test.js gagal kalau ada field lain yang muncul.
//
// Idempoten: kalau isi listing sama dengan file yang sudah ada, file
// tidak ditulis ulang (generated_at lama dipertahankan), jadi workflow
// tidak membuat commit baru.
//
// Env vars yang dibutuhkan:
//   SUPABASE_URL              — Project URL Supabase
//   SUPABASE_SERVICE_ROLE_KEY — service_role key (JANGAN dipakai di client-side!)

const fs = require("fs");
const path = require("path");
const { builderFromRepoUrl } = require("../builder-lib.js");

// Naik hanya untuk perubahan yang merusak (field dihapus / diganti nama /
// berubah arti). Menambah field (mis. live_status, live_checked_at,
// wanted_id, owner_signed, owner_signed_at, builder_github) tidak.
const SCHEMA_VERSION = 1;
// Sama dengan CNAME. Halaman detail mengikuti skema sitemap.xml:
// agent.html?id=<uuid>.
const SITE_URL = "https://agraris.xyz/";
const OUTPUT_PATH = path.join(__dirname, "..", "api", "agents.json");
// PostgREST membatasi jumlah baris per request (default 1000), jadi
// semua listing diambil per halaman.
const PAGE_SIZE = 1000;

// Kolom yang diambil dari tabel `agents`. Semuanya sudah bisa dibaca
// publik lewat REST API (lihat docs.html). `approved` tidak diambil:
// filternya dilakukan di query.
const DB_COLUMNS = [
  "id",
  "kind",
  "name",
  "description",
  "version",
  "repo_url",
  "category",
  "demo_url",
  "contract_address",
  "created_at",
  "approved_at",
  "github_stars",
  "github_updated_at",
  "verified",
  // Hasil live check demo_url (supabase/migration-live-check.sql).
  // live_fail_count sengaja tidak ikut.
  "live_status",
  "live_checked_at",
  // Permintaan Wanted board yang dijawab listing ini
  // (supabase/migration-wanted.sql); null kalau tidak ada.
  "wanted_id",
];

// Daftar putih field per listing di api/agents.json, sesuai urutan di
// file. `url` dibuat di sini, bukan kolom database.
// owner_signed / owner_signed_at berasal dari tabel owner_proofs
// (supabase/migration-owner-proof.sql), bukan kolom agents.
// builder_github dihitung dari repo_url (builder-lib.js): pemilik GitHub
// huruf kecil, atau null kalau repo_url bukan github.com/<owner>/<repo>.
const PUBLIC_FIELDS = [...DB_COLUMNS, "owner_signed", "owner_signed_at", "builder_github", "url"];

// category column may be stored as text or as a Postgres text[] array.
// Normalize to a plain array of strings either way (sama dengan
// generate-sitemap.js).
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

// When a listing appeared in the registry: coalesce(approved_at, created_at),
// sama dengan RSS dan sitemap.
function publishedAt(row) {
  return row.approved_at || row.created_at;
}

function byPublishedDesc(a, b) {
  const diff = new Date(publishedAt(b)) - new Date(publishedAt(a));
  if (diff !== 0 && !Number.isNaN(diff)) return diff;
  // Urutan stabil untuk waktu yang sama, supaya file tidak berubah-ubah.
  return String(a.id).localeCompare(String(b.id));
}

function nullable(value) {
  return value === undefined || value === null ? null : value;
}

// Satu baris database → satu objek listing. Objek dibangun dari nol
// dengan field daftar putih saja; field lain di `row` diabaikan.
// proof: { signed_at } dari owner_proofs, atau null.
function buildListing(row, proof = null) {
  const signedAt = proof && proof.signed_at ? proof.signed_at : null;
  return {
    id: row.id,
    kind: row.kind === "tool" ? "tool" : "agent",
    name: row.name,
    description: row.description,
    version: nullable(row.version),
    repo_url: nullable(row.repo_url),
    category: normalizeCategories(row.category),
    demo_url: nullable(row.demo_url),
    contract_address: nullable(row.contract_address),
    created_at: nullable(row.created_at),
    approved_at: nullable(row.approved_at),
    github_stars: nullable(row.github_stars),
    github_updated_at: nullable(row.github_updated_at),
    verified: row.verified === true,
    live_status: row.live_status === "up" || row.live_status === "down" ? row.live_status : null,
    live_checked_at: nullable(row.live_checked_at),
    wanted_id: nullable(row.wanted_id),
    // Wallet owner() kontrak menandatangani pesan (dicek di server, dicek
    // ulang tiap 6 jam). Bukan endorsement.
    owner_signed: Boolean(signedAt),
    owner_signed_at: signedAt,
    builder_github: builderFromRepoUrl(row.repo_url),
    url: `${SITE_URL}agent.html?id=${encodeURIComponent(row.id)}`,
  };
}

// proofs: Map agent_id → { signed_at } (fetchOwnerProofs).
function buildListings(rows, proofs = new Map()) {
  return rows
    .filter((row) => row && row.approved !== false)
    .slice()
    .sort(byPublishedDesc)
    .map((row) => buildListing(row, proofs.get(String(row.id)) || null));
}

function buildDocument(listings, generatedAt) {
  return {
    schema_version: SCHEMA_VERSION,
    generated_at: generatedAt,
    count: listings.length,
    listings,
  };
}

function serialize(doc) {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

// Bagian dokumen yang dibandingkan untuk idempotensi: semuanya kecuali
// generated_at.
function contentKey(doc) {
  return JSON.stringify({
    schema_version: doc.schema_version,
    count: doc.count,
    listings: doc.listings,
  });
}

function readExisting(outputPath) {
  try {
    return JSON.parse(fs.readFileSync(outputPath, "utf8"));
  } catch {
    return null;
  }
}

// Tulis file hanya kalau isinya berubah. Mengembalikan true kalau ditulis.
function writeIfChanged(outputPath, listings, now = new Date()) {
  const next = buildDocument(listings, now.toISOString());
  const existing = readExisting(outputPath);

  if (existing && contentKey(existing) === contentKey(next)) {
    return false;
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, serialize(next), "utf8");
  return true;
}

async function fetchApprovedRows(supabase) {
  const rows = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("agents")
      .select(DB_COLUMNS.join(", "))
      // Service role bypasses RLS, so pending entries must be filtered out
      // explicitly (supabase/migration-review-queue.sql).
      .eq("approved", true)
      // Urutan halaman harus stabil; urutan akhir disusun di buildListings().
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      throw new Error(`Failed to read agents table: ${error.message}`);
    }

    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }

  return rows;
}

// Bukti tanda tangan pemilik kontrak yang berlaku saat ini. Hanya
// agent_id dan signed_at yang diambil; listing yang belum approved
// tersaring di buildListings().
async function fetchOwnerProofs(supabase) {
  const proofs = new Map();
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("owner_proofs")
      .select("agent_id, signed_at")
      .order("agent_id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      throw new Error(`Failed to read owner_proofs table: ${error.message}`);
    }

    const page = data ?? [];
    page.forEach((row) => {
      if (row && row.agent_id && row.signed_at) proofs.set(String(row.agent_id), { signed_at: row.signed_at });
    });
    if (page.length < PAGE_SIZE) break;
  }
  return proofs;
}

async function main() {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variable."
    );
    process.exit(1);
  }

  // Di-require di sini (bukan di atas) supaya tes bisa memuat modul ini
  // tanpa @supabase/supabase-js terpasang.
  const { createClient } = require("@supabase/supabase-js");
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const [rows, proofs] = await Promise.all([fetchApprovedRows(supabase), fetchOwnerProofs(supabase)]);
  const listings = buildListings(rows, proofs);
  const written = writeIfChanged(OUTPUT_PATH, listings);

  const toolCount = listings.filter((entry) => entry.kind === "tool").length;
  const agentCount = listings.length - toolCount;

  console.log(
    written
      ? `Generated api/agents.json with ${agentCount} agent(s) and ${toolCount} tool(s) at ${OUTPUT_PATH}`
      : `api/agents.json unchanged (${agentCount} agent(s), ${toolCount} tool(s)); not rewritten`
  );
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = {
  SCHEMA_VERSION,
  SITE_URL,
  DB_COLUMNS,
  PUBLIC_FIELDS,
  buildListing,
  buildListings,
  buildDocument,
  serialize,
  writeIfChanged,
  fetchApprovedRows,
  fetchOwnerProofs,
};
