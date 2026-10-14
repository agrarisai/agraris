// ============================================
// Agraris — email notifikasi antrean review (untuk pemilik)
// ============================================
// Dijalankan oleh .github/workflows/review-notify.yml (cron tiap 15
// menit + manual trigger).
//
// Alur:
//   1. Ambil submission yang approved = false dan notified_at is null,
//      urut created_at, maksimal MAX_PER_EMAIL baris (plus jumlah total).
//   2. Kalau tidak ada → selesai, tidak kirim email.
//   3. Kalau ada → kirim SATU email teks biasa lewat Resend.
//   4. HANYA kalau Resend sukses → isi notified_at = now() untuk baris
//      yang tercantum di email saja. Sisanya ("dan N lainnya") ikut di
//      email berikutnya.
//
// Kalau langkah 4 gagal setelah email terkirim, run ini merah dan run
// berikutnya akan mengirim ulang baris yang sama (lebih baik dobel
// daripada terlewat).
//
// Ringkasan edit (terpisah, email kedua):
//   Builder bisa mengedit listing lewat status.html (RPC update_submission,
//   lihat supabase/migration-edit-listing.sql). Setiap edit dicatat di
//   tabel privat agent_edits. Run ini mengambil baris agent_edits yang
//   notified_at-nya masih kosong (praktis: edit sejak run sebelumnya,
//   jadi ±15 menit terakhir; tidak ada yang terlewat kalau cron telat),
//   mengelompokkannya per listing, mengirim SATU email ringkas (nama,
//   field yang berubah, demo link lama → baru, link), lalu mengisi
//   notified_at hanya untuk baris yang tercantum. Aturan "kirim dulu,
//   tandai setelah sukses" sama dengan notifikasi antrean.
//
// Isi submission diperlakukan sebagai teks tak tepercaya: email hanya
// berupa teks biasa, dan URL / domain / alamat email dari pengirim
// ditulis dengan [.] / [:] / [at] supaya tidak bisa diklik.
//
// Env vars (dari GitHub Actions secrets, sama dengan weekly digest):
//   SUPABASE_URL              — Project URL Supabase
//   SUPABASE_SERVICE_ROLE_KEY — service_role key (JANGAN dipakai di client-side!)
//   RESEND_API_KEY            — API key Resend
//   NOTIFY_EMAIL              — alamat tujuan email
// Disediakan otomatis oleh GitHub Actions:
//   GITHUB_SERVER_URL, GITHUB_REPOSITORY — untuk link ke tab Actions
//
// Keamanan: jangan console.log isi env var, header request, isi email,
// atau objek error mentah. Log di sini hanya mencetak jumlah, status
// code, dan pesan error.

const {
  UUID_PATTERN,
  requireEnv,
  rest,
  filter,
  totalFromContentRange,
  safeText,
  redactEmails,
  formatUtc,
} = require("./review-lib");

// ---------- pengaturan yang mudah diubah ----------

const MAX_PER_EMAIL = 20;
// Baris agent_edits per run (beberapa baris bisa milik satu listing).
const MAX_EDITS_PER_EMAIL = 100;
const SITE_URL = "https://agraris.xyz";
const DESCRIPTION_MAX = 200;

// Pengirim default Resend, sama dengan scripts/generate-digest.js.
const FROM_ADDRESS = "Agraris <onboarding@resend.dev>";
const RESEND_ENDPOINT = "https://api.resend.com/emails";
const DEFAULT_REPO_URL = "https://github.com/agrarisai/agraris";

function log(message) {
  console.log(`[review-notify] ${message}`);
}

function logError(message) {
  console.error(`[review-notify] ${message}`);
}

function reviewWorkflowUrl() {
  const server = process.env.GITHUB_SERVER_URL;
  const repo = process.env.GITHUB_REPOSITORY;
  const base = server && repo ? `${server}/${repo}` : DEFAULT_REPO_URL;
  return `${base}/actions/workflows/review-queue.yml`;
}

// ---------- data ----------

async function fetchPending() {
  const query = [
    "select=id,name,repo_url,description,created_at",
    filter("approved", "eq", "false"),
    "notified_at=is.null",
    "order=created_at.asc",
    `limit=${MAX_PER_EMAIL}`,
  ].join("&");

  const { data, contentRange } = await rest("GET", "agents", query, { prefer: "count=exact" });
  const rows = Array.isArray(data) ? data : [];
  const total = totalFromContentRange(contentRange) ?? rows.length;
  return { rows, total };
}

// Isi notified_at hanya untuk id yang tercantum di email, dan hanya
// kalau baris itu masih pending dan belum pernah diberi tahu.
async function markNotified(ids) {
  const query = [
    `id=in.(${ids.map(encodeURIComponent).join(",")})`,
    filter("approved", "eq", "false"),
    "notified_at=is.null",
    "select=id",
  ].join("&");

  const { data } = await rest("PATCH", "agents", query, {
    body: { notified_at: new Date().toISOString() },
    prefer: "return=representation",
  });
  return Array.isArray(data) ? data.length : 0;
}

// Edit yang belum dilaporkan, beserta data listing saat ini.
async function fetchUnnotifiedEdits() {
  const query = [
    "select=id,agent_id,edited_at,changed_fields,previous,agents(name,approved,demo_url,contract_address)",
    "notified_at=is.null",
    "order=edited_at.asc",
    `limit=${MAX_EDITS_PER_EMAIL}`,
  ].join("&");

  const { data, contentRange } = await rest("GET", "agent_edits", query, { prefer: "count=exact" });
  const rows = Array.isArray(data) ? data : [];
  const total = totalFromContentRange(contentRange) ?? rows.length;
  return { rows, total };
}

async function markEditsNotified(ids) {
  const query = [`id=in.(${ids.join(",")})`, "notified_at=is.null", "select=id"].join("&");
  const { data } = await rest("PATCH", "agent_edits", query, {
    body: { notified_at: new Date().toISOString() },
    prefer: "return=representation",
  });
  return Array.isArray(data) ? data.length : 0;
}

// ---------- email ----------

function buildSubject(count) {
  return `Agraris: ${count} submission baru menunggu review`;
}

function buildText(rows, total) {
  const lines = [
    `Ada ${total} submission baru di antrean review Agraris.`,
    "",
  ];

  rows.forEach((row, i) => {
    lines.push(`${i + 1}. ${safeText(row.name, 120)}`);
    lines.push(`   ID: ${row.id}`);
    lines.push(`   Repo: ${safeText(row.repo_url, 200)}`);
    lines.push(`   Dikirim: ${formatUtc(row.created_at)}`);
    lines.push(`   Deskripsi: ${safeText(row.description, DESCRIPTION_MAX)}`);
    lines.push("");
  });

  const remaining = total - rows.length;
  if (remaining > 0) {
    lines.push(`... dan ${remaining} lainnya.`, "");
  }

  lines.push(
    "Cara menyetujui atau menolak:",
    `1. Buka tab Actions di GitHub: ${reviewWorkflowUrl()}`,
    '2. Pilih workflow "Review queue", lalu tekan "Run workflow".',
    "3. Pilih action approve (atau reject), lalu isi id dari daftar di atas.",
    "   Bisa juga mengisi name dengan nama agent persis; kalau ada dua agent",
    "   dengan nama yang sama, id wajib diisi.",
    "4. Action list menampilkan semua submission yang masih menunggu.",
    "",
    "Isi submission ditulis oleh pengirim dan belum diperiksa. Tautan, domain,",
    "dan alamat email dari pengirim ditulis dengan [.] [:] [at] supaya tidak",
    "bisa diklik; jangan membukanya tanpa memeriksa dulu.",
    "",
    "Dikirim oleh workflow \"Review queue notify\" (scripts/review-notify.js)."
  );

  return lines.join("\n");
}

// Satu entri per listing: field yang berubah digabung, demo link yang
// paling awal sebelum edit dibandingkan dengan yang sekarang.
function groupEdits(rows) {
  const byAgent = new Map();
  for (const row of rows) {
    const id = String(row.agent_id);
    let entry = byAgent.get(id);
    if (!entry) {
      entry = { agentId: id, agent: row.agents || null, fields: new Set(), count: 0, last: row.edited_at, firstPrevious: {} };
      byAgent.set(id, entry);
    }
    entry.count += 1;
    entry.last = row.edited_at;
    if (row.agents) entry.agent = row.agents;
    const previous = row.previous && typeof row.previous === "object" ? row.previous : {};
    for (const field of Array.isArray(row.changed_fields) ? row.changed_fields : []) {
      if (!entry.fields.has(field) && Object.prototype.hasOwnProperty.call(previous, field)) {
        entry.firstPrevious[field] = previous[field];
      }
      entry.fields.add(String(field));
    }
  }
  return [...byAgent.values()];
}

function buildEditsSubject(count) {
  return `Agraris: ${count} listing diedit oleh builder`;
}

function buildEditsText(entries, totalRows, shownRows) {
  const lines = [`${entries.length} listing diedit lewat halaman status sejak email sebelumnya.`, ""];

  entries.forEach((entry, i) => {
    const agent = entry.agent || {};
    const fields = [...entry.fields].map((f) => safeText(f, 40)).join(", ") || "-";
    lines.push(`${i + 1}. ${safeText(agent.name || "(listing sudah dihapus)", 120)}`);
    lines.push(`   Field: ${fields}${entry.count > 1 ? ` (${entry.count} kali edit)` : ""}`);
    lines.push(`   Terakhir: ${formatUtc(entry.last)}`);
    if (entry.fields.has("demo_url")) {
      const before = entry.firstPrevious.demo_url;
      lines.push(`   Demo lama: ${before ? safeText(before, 200) : "(kosong)"}`);
      lines.push(`   Demo baru: ${agent.demo_url ? safeText(agent.demo_url, 200) : "(kosong)"}`);
    }
    if (entry.fields.has("contract_address")) {
      lines.push(`   Contract: ${agent.contract_address ? safeText(agent.contract_address, 60) : "(kosong)"}`);
    }
    if (agent.approved) {
      lines.push(`   Link: ${SITE_URL}/agent.html?id=${entry.agentId}`);
    } else {
      lines.push(`   Status: pending (belum tampil publik). ID: ${entry.agentId}`);
    }
    lines.push("");
  });

  if (totalRows > shownRows) {
    lines.push(`... dan ${totalRows - shownRows} edit lainnya di email berikutnya.`, "");
  }

  lines.push(
    "Edit pada listing approved langsung tampil tanpa review ulang.",
    "Kalau demo link disalahgunakan, kosongkan atau ganti lewat workflow",
    `"Review queue" (action set-demo, value clear): ${reviewWorkflowUrl()}`,
    "Riwayat lengkap ada di tabel agent_edits (kolom previous berisi nilai lama).",
    "",
    "Teks dari builder ditulis dengan [.] [:] [at] supaya tidak bisa diklik.",
    "",
    "Dikirim oleh workflow \"Review queue notify\" (scripts/review-notify.js)."
  );

  return lines.join("\n");
}

// Mengembalikan true kalau terkirim, false kalau Resend menolak.
async function sendEmail(subject, text) {
  const res = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM_ADDRESS,
      to: [process.env.NOTIFY_EMAIL],
      subject,
      text,
    }),
  });

  if (res.ok) return true;

  let detail = "";
  try {
    const body = await res.json();
    detail = body && body.message ? redactEmails(body.message) : "";
  } catch {
    // body bukan JSON — cukup status code
  }
  logError(`Resend rejected the email (HTTP ${res.status})${detail ? `: ${detail}` : ""}`);
  if (res.status === 403) {
    logError(
      "Hint: on Resend's free plan, onboarding@resend.dev can only send to the email address of the Resend account itself. Set NOTIFY_EMAIL to that address, or verify your own domain in Resend."
    );
  }
  return false;
}

// ---------- main ----------

async function notifyPending() {
  const { rows: fetched, total } = await fetchPending();
  // id selalu uuid dari database; disaring lagi supaya filter in.(...)
  // tidak pernah berisi nilai lain.
  const rows = fetched.filter((row) => UUID_PATTERN.test(String(row.id)));

  if (rows.length === 0) {
    log("No new submissions to notify.");
    return true;
  }

  const text = buildText(rows, Math.max(total, rows.length));
  const sent = await sendEmail(buildSubject(Math.max(total, rows.length)), text);
  if (!sent) {
    // notified_at TIDAK diisi, jadi run berikutnya mencoba lagi.
    return false;
  }

  log(`Emailed ${rows.length} submission(s)${total > rows.length ? ` (${total - rows.length} more left for later runs)` : ""}.`);

  const marked = await markNotified(rows.map((row) => String(row.id)));
  log(`Marked ${marked} row(s) as notified.`);
  return true;
}

async function notifyEdits() {
  const { rows: fetched, total } = await fetchUnnotifiedEdits();
  // id log = bigint, agent_id = uuid; disaring supaya filter in.(...)
  // hanya berisi angka.
  const rows = fetched.filter((row) => /^\d+$/.test(String(row.id)) && UUID_PATTERN.test(String(row.agent_id)));

  if (rows.length === 0) {
    log("No listing edits to notify.");
    return true;
  }

  const entries = groupEdits(rows);
  const sent = await sendEmail(buildEditsSubject(entries.length), buildEditsText(entries, Math.max(total, rows.length), rows.length));
  if (!sent) return false;

  log(`Emailed ${rows.length} listing edit(s) across ${entries.length} listing(s).`);
  const marked = await markEditsNotified(rows.map((row) => String(row.id)));
  log(`Marked ${marked} edit(s) as notified.`);
  return true;
}

async function main() {
  requireEnv(["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "RESEND_API_KEY", "NOTIFY_EMAIL"]);

  // Dua email independen: kegagalan satu tidak menghalangi yang lain,
  // tapi run tetap merah supaya terlihat di tab Actions.
  let ok = true;
  for (const [label, task] of [["Review notify", notifyPending], ["Edit notify", notifyEdits]]) {
    try {
      if (!(await task())) ok = false;
    } catch (err) {
      logError(`${label} failed: ${redactEmails(err && err.message ? err.message : String(err))}`);
      ok = false;
    }
  }
  if (!ok) process.exitCode = 1;
}

main().catch((err) => {
  logError(`Review notify failed: ${redactEmails(err && err.message ? err.message : String(err))}`);
  process.exitCode = 1;
});
