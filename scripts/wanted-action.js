// ============================================
// Agraris — kelola Wanted board dari GitHub Actions
// ============================================
// Dijalankan oleh .github/workflows/wanted-queue.yml (workflow_dispatch),
// pola yang sama dengan scripts/review-action.js (Review queue), jadi
// pemilik bisa menyetujui / menolak / menutup permintaan dari HP tanpa SQL.
//
// Input (diteruskan workflow lewat env, TIDAK lewat perintah shell):
//   WANTED_ACTION — list | approve | reject | close
//   WANTED_ID     — uuid permintaan (wajib kecuali untuk list)
//
// Aturan:
//   list    — tulis ke GITHUB_STEP_SUMMARY: permintaan pending, lalu
//             permintaan yang sedang tampil (approved, belum closed).
//   approve — set approved = true pada permintaan PENDING dengan id itu.
//   reject  — hapus permintaan PENDING dengan id itu.
//   close   — set closed = true pada permintaan APPROVED yang belum
//             closed. Tidak tampil lagi di publik; listing yang sudah
//             menjawabnya tetap tertaut.
//   Setiap perubahan memakai filter status (approved / closed), jadi
//   approve/reject tidak pernah menyentuh permintaan yang sudah tampil,
//   dan close tidak pernah menyentuh yang masih pending.
//   Permintaan dicocokkan lewat id saja: judul tidak unik dan panjang.
//
// Env vars lain (dari GitHub Actions secrets):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// Keamanan: judul/deskripsi adalah teks dari publik yang belum diperiksa.
// Selalu lewat safeMd() sebelum masuk job summary. Jangan console.log isi
// env var atau objek error mentah; repo ini publik.

const { UUID_PATTERN, requireEnv, rest, filter, safeMd, formatUtc, appendSummary } = require("./review-lib");

const ACTIONS = ["list", "approve", "reject", "close"];
const LIST_LIMIT = 100;
const TITLE_MAX = 100;
const DESCRIPTION_MAX = 200;

class UsageError extends Error {}

function log(message) {
  console.log(`[wanted-action] ${message}`);
}

function logError(message) {
  console.error(`[wanted-action] ${message}`);
}

function summary(markdown) {
  if (!appendSummary(markdown)) console.log(markdown);
}

// 'agent' → Agent, 'tool' → Tool, lainnya → Any. Nilai dipetakan, tidak
// dicetak apa adanya (sama seperti kindLabel di review-lib.js).
function wantedKindLabel(kind) {
  if (kind === "agent") return "Agent";
  if (kind === "tool") return "Tool";
  return "Any";
}

// ---------- input ----------

function parseInput(env) {
  const action = String(env.WANTED_ACTION || "").trim().toLowerCase();
  if (!ACTIONS.includes(action)) {
    throw new UsageError(`action harus salah satu dari: ${ACTIONS.join(", ")}.`);
  }

  const id = String(env.WANTED_ID || "").trim().toLowerCase();
  if (id && !UUID_PATTERN.test(id)) {
    throw new UsageError("id harus berupa uuid, misalnya 2f1c9a7e-1b2c-4d3e-8f90-123456789abc.");
  }
  if (action !== "list" && !id) {
    throw new UsageError(`${action} butuh id. Jalankan action list untuk melihat id.`);
  }

  return { action, id };
}

// ---------- tampilan ----------

function wantedTable(rows) {
  const lines = ["| Judul | Jenis | ID | Dikirim | Deskripsi |", "| --- | --- | --- | --- | --- |"];
  for (const row of rows) {
    lines.push(
      `| ${safeMd(row.title, TITLE_MAX)} | ${wantedKindLabel(row.kind)} | \`${String(row.id)}\` | ${formatUtc(row.created_at)} | ${safeMd(row.description, DESCRIPTION_MAX)} |`
    );
  }
  return lines.join("\n");
}

// ---------- query ----------

const COLUMNS = "id,title,description,kind,created_at,approved,closed";

async function fetchRows(filters, order = "created_at.asc") {
  const query = [`select=${COLUMNS}`, ...filters, `order=${order}`, `limit=${LIST_LIMIT}`].join("&");
  const { data } = await rest("GET", "wanted", query);
  return Array.isArray(data) ? data : [];
}

async function findById(id) {
  const rows = await fetchRows([filter("id", "eq", id)]);
  return rows[0] || null;
}

function stateOf(row) {
  if (!row.approved) return "pending";
  return row.closed ? "closed" : "approved";
}

// ---------- actions ----------

async function list() {
  const [pending, open] = await Promise.all([
    fetchRows([filter("approved", "eq", "false")]),
    fetchRows([filter("approved", "eq", "true"), filter("closed", "eq", "false")], "created_at.desc"),
  ]);

  const parts = ["## Wanted queue: pending", ""];
  if (pending.length === 0) {
    parts.push("Tidak ada permintaan yang menunggu review.");
  } else {
    parts.push(`${pending.length} permintaan menunggu review.`, "", wantedTable(pending));
  }
  parts.push("", "## Wanted board: sedang tampil (approved, belum closed)", "");
  if (open.length === 0) {
    parts.push("Tidak ada.");
  } else {
    parts.push(
      `${open.length} permintaan. Yang dibuat lebih dari 60 hari lalu otomatis tidak tampil lagi walaupun belum di-close.`,
      "",
      wantedTable(open)
    );
  }
  parts.push("", "Teks dari pengirim ditampilkan dengan [.] [:] [at] supaya tidak bisa diklik.");
  summary(parts.join("\n"));
  log(`Listed ${pending.length} pending and ${open.length} open request(s).`);
}

// Ubah / hapus satu baris yang cocok dengan id DAN status yang diharapkan.
async function change(action, id) {
  const spec = {
    approve: { method: "PATCH", filters: [filter("approved", "eq", "false")], body: { approved: true }, needs: "pending", verb: "approved", done: "Baris diubah" },
    reject: { method: "DELETE", filters: [filter("approved", "eq", "false")], needs: "pending", verb: "rejected (dihapus)", done: "Baris dihapus" },
    close: { method: "PATCH", filters: [filter("approved", "eq", "true"), filter("closed", "eq", "false")], body: { closed: true }, needs: "approved", verb: "closed", done: "Baris diubah" },
  }[action];

  const query = [filter("id", "eq", id), ...spec.filters, "select=id,title,kind"].join("&");
  const { data } = await rest(spec.method, "wanted", query, {
    body: spec.body,
    prefer: "return=representation",
  });
  const rows = Array.isArray(data) ? data : [];

  if (rows.length !== 1) {
    const current = await findById(id);
    const why = current
      ? `Permintaan ini berstatus ${stateOf(current)}; ${action} hanya untuk permintaan ${spec.needs}.`
      : "Tidak ada permintaan dengan id itu. Jalankan action list untuk melihat id.";
    throw new UsageError(`${action} tidak mengubah apa pun. ${why}`);
  }

  summary(
    [
      `## Wanted queue: ${spec.verb}`,
      "",
      `- ${safeMd(rows[0].title, TITLE_MAX)} (\`${rows[0].id}\`, ${wantedKindLabel(rows[0].kind)})`,
      "",
      `${spec.done}: ${rows.length}`,
    ].join("\n")
  );
  log(`${action}: ${rows.length} row(s): ${rows[0].id}`);
}

// ---------- main ----------

async function main(env = process.env) {
  const input = parseInput(env);
  requireEnv(["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]);
  if (input.action === "list") return list();
  return change(input.action, input.id);
}

if (require.main === module) {
  main().catch((err) => {
    const message = err && err.message ? err.message : String(err);
    if (err instanceof UsageError) {
      summary(`## Wanted queue: gagal\n\n${message.replace(/[<>]/g, "")}`);
    }
    logError(message);
    process.exitCode = 1;
  });
}

module.exports = { ACTIONS, UsageError, parseInput, wantedKindLabel, main };
