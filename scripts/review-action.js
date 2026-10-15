// ============================================
// Agraris — kelola antrean review dari GitHub Actions
// ============================================
// Dijalankan oleh .github/workflows/review-queue.yml (workflow_dispatch),
// jadi pemilik bisa menyetujui / menolak submission dari HP tanpa SQL.
//
// Input (diteruskan workflow lewat env, TIDAK lewat perintah shell):
//   REVIEW_ACTION — list | approve | reject | set-contract | set-demo
//   REVIEW_NAME   — nama agent persis (opsional)
//   REVIEW_ID     — uuid agent (opsional; wajib kalau nama dipakai lebih
//                   dari satu submission pending)
//   REVIEW_VALUE  — nilai baru untuk set-contract / set-demo, atau
//                   "clear" untuk mengosongkan
//
// Aturan:
//   list    — tulis daftar pending (name, id, repo_url, created_at) ke
//             GITHUB_STEP_SUMMARY.
//   approve — set approved = true pada SATU baris pending yang cocok.
//   reject  — hapus SATU baris pending yang cocok.
//   Cocok = id sama, atau name sama persis (kalau keduanya diisi, keduanya
//   harus cocok). 0 baris cocok → gagal. Lebih dari 1 baris cocok tanpa
//   id → gagal dan tampilkan daftar id. Baris approved = true tidak
//   pernah diubah atau dihapus: setiap perubahan memakai filter
//   approved=eq.false.
//
//   set-contract / set-demo — jalur manual untuk agent lama yang tidak
//             punya token status (builder mengirim alamat kontrak / demo
//             link ke kami). Berlaku untuk agent approved maupun pending,
//             cocok lewat id atau name persis (nama dobel → wajib id).
//             Hanya contract_address ATAU demo_url yang diubah; validasi
//             sama dengan RPC update_submission():
//               contract: ^0x[0-9a-fA-F]{40}$
//               demo:     https://…, tanpa spasi, maks. 500 karakter
//             Nilai "clear" mengosongkan kolomnya.
//
// Env vars lain (dari GitHub Actions secrets):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// Keamanan: jangan console.log isi env var atau objek error mentah.
// Repo ini publik, jadi log dan job summary bisa dibaca siapa saja.

const {
  UUID_PATTERN,
  MAX_NAME_LENGTH,
  CONTROL_CHARS,
  INVISIBLE_CHARS,
  requireEnv,
  rest,
  filter,
  safeMd,
  kindLabel,
  formatUtc,
  appendSummary,
} = require("./review-lib");

const ACTIONS = ["list", "approve", "reject", "set-contract", "set-demo"];
const SET_ACTIONS = {
  "set-contract": { column: "contract_address", label: "contract address" },
  "set-demo": { column: "demo_url", label: "demo link" },
};
const CLEAR_VALUE = "clear";

// Sama dengan update_submission() di supabase/migration-edit-listing.sql.
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const MAX_DEMO_URL = 500;
const LIST_LIMIT = 100;

class UsageError extends Error {}

function log(message) {
  console.log(`[review-action] ${message}`);
}

function logError(message) {
  console.error(`[review-action] ${message}`);
}

// Tulis ke job summary; kalau tidak jalan di Actions, cetak ke stdout.
function summary(markdown) {
  if (!appendSummary(markdown)) console.log(markdown);
}

// ---------- validasi input ----------

function parseInput(env) {
  const action = String(env.REVIEW_ACTION || "").trim().toLowerCase();
  if (!ACTIONS.includes(action)) {
    throw new UsageError(`action harus salah satu dari: ${ACTIONS.join(", ")}.`);
  }

  const id = String(env.REVIEW_ID || "").trim().toLowerCase();
  if (id && !UUID_PATTERN.test(id)) {
    throw new UsageError("id harus berupa uuid, misalnya 2f1c9a7e-1b2c-4d3e-8f90-123456789abc.");
  }

  const name = String(env.REVIEW_NAME || "").trim();
  if (name) {
    if ([...name].length > MAX_NAME_LENGTH) {
      throw new UsageError(`name terlalu panjang (maksimal ${MAX_NAME_LENGTH} karakter).`);
    }
    if (CONTROL_CHARS.test(name) || INVISIBLE_CHARS.test(name)) {
      throw new UsageError("name berisi karakter kontrol atau karakter tak terlihat.");
    }
  }

  if (action !== "list" && !id && !name) {
    throw new UsageError(`${action} butuh id atau name.`);
  }

  let value;
  if (SET_ACTIONS[action]) {
    value = parseSetValue(action, String(env.REVIEW_VALUE || "").trim());
  }

  return { action, id, name, value };
}

// Mengembalikan nilai yang akan disimpan (null = dikosongkan).
function parseSetValue(action, raw) {
  if (!raw) {
    throw new UsageError(`${action} butuh value (atau "${CLEAR_VALUE}" untuk mengosongkan).`);
  }
  if (raw.toLowerCase() === CLEAR_VALUE) return null;

  if (action === "set-contract") {
    if (!ADDRESS_PATTERN.test(raw)) {
      throw new UsageError("value harus 0x diikuti 40 karakter hex (0-9, a-f).");
    }
    return raw;
  }

  let ok = raw.length <= MAX_DEMO_URL && /^https:\/\/[^/?#\s]+/i.test(raw) && !/[\s\u0000-\u001F\u007F]/.test(raw);
  if (ok) {
    try {
      ok = new URL(raw).protocol === "https:";
    } catch {
      ok = false;
    }
  }
  if (!ok) {
    throw new UsageError(`value harus diawali https://, tanpa spasi, maksimal ${MAX_DEMO_URL} karakter.`);
  }
  return raw;
}

function describeTarget({ id, name }) {
  const parts = [];
  if (id) parts.push(`id \`${id}\``);
  if (name) parts.push(`name "${safeMd(name, MAX_NAME_LENGTH)}"`);
  return parts.join(" dan ");
}

// ---------- query ----------

function matchFilters({ id, name }) {
  const filters = [];
  if (id) filters.push(filter("id", "eq", id));
  if (name) filters.push(filter("name", "eq", name));
  return filters;
}

async function findRows(target, approved) {
  const query = [
    "select=id,name,repo_url,created_at,kind",
    filter("approved", "eq", approved ? "true" : "false"),
    ...matchFilters(target),
    "order=created_at.asc",
    "limit=50",
  ].join("&");
  const { data } = await rest("GET", "agents", query);
  return Array.isArray(data) ? data : [];
}

function pendingTable(rows) {
  const lines = ["| Name | Jenis | ID | Repo | Dikirim |", "| --- | --- | --- | --- | --- |"];
  for (const row of rows) {
    lines.push(
      `| ${safeMd(row.name, MAX_NAME_LENGTH)} | ${kindLabel(row.kind)} | \`${String(row.id)}\` | ${safeMd(row.repo_url, 200)} | ${formatUtc(row.created_at)} |`
    );
  }
  return lines.join("\n");
}

// ---------- actions ----------

async function listPending() {
  const query = [
    "select=id,name,repo_url,created_at,kind",
    filter("approved", "eq", "false"),
    "order=created_at.asc",
    `limit=${LIST_LIMIT}`,
  ].join("&");
  const { data } = await rest("GET", "agents", query);
  const rows = Array.isArray(data) ? data : [];

  const parts = ["## Review queue: pending", ""];
  if (rows.length === 0) {
    parts.push("Tidak ada submission yang menunggu review.");
  } else {
    parts.push(`${rows.length} submission menunggu review${rows.length === LIST_LIMIT ? ` (ditampilkan ${LIST_LIMIT} yang paling lama)` : ""}.`, "");
    parts.push(pendingTable(rows));
    parts.push("", "Teks dari pengirim ditampilkan apa adanya dengan [.] [:] [at] supaya tidak bisa diklik.");
  }
  summary(parts.join("\n"));
  log(`Listed ${rows.length} pending submission(s).`);
}

// Cari tepat satu baris pending; kalau tidak bisa, lempar UsageError
// dengan pesan yang jelas (dan daftar id kalau namanya dobel).
async function resolveOne(action, target) {
  const rows = await findRows(target, false);

  if (rows.length === 0) {
    const approvedMatches = await findRows(target, true);
    const hint =
      approvedMatches.length > 0
        ? " Agent yang cocok sudah approved, jadi tidak diubah."
        : " Jalankan action list untuk melihat antrean.";
    throw new UsageError(`Tidak ada submission pending yang cocok dengan ${describeTarget(target)}.${hint}`);
  }

  if (rows.length > 1 && !target.id) {
    summary(
      [
        `## Review queue: ${action} dibatalkan`,
        "",
        `${rows.length} submission pending memakai nama yang sama. Jalankan lagi dengan mengisi id salah satu baris berikut:`,
        "",
        pendingTable(rows),
      ].join("\n")
    );
    throw new UsageError(
      `${rows.length} submission pending cocok dengan nama itu. Isi id: ${rows.map((r) => r.id).join(", ")}`
    );
  }

  return rows[0];
}

async function approve(target) {
  const row = await resolveOne("approve", target);
  const query = [filter("id", "eq", row.id), filter("approved", "eq", "false"), "select=id,name,kind"].join("&");
  const { data } = await rest("PATCH", "agents", query, {
    body: { approved: true },
    prefer: "return=representation",
  });
  const changed = Array.isArray(data) ? data : [];
  if (changed.length !== 1) {
    throw new UsageError(`Tidak ada baris yang diubah (submission ${row.id} mungkin baru saja diproses).`);
  }
  summary(
    [
      "## Review queue: approved",
      "",
      `- ${safeMd(changed[0].name, MAX_NAME_LENGTH)} (\`${changed[0].id}\`, ${kindLabel(changed[0].kind)})`,
      "",
      `Baris diubah: ${changed.length}`,
    ].join("\n")
  );
  log(`Approved ${changed.length} row(s): ${changed[0].id}`);
}

async function reject(target) {
  const row = await resolveOne("reject", target);
  const query = [filter("id", "eq", row.id), filter("approved", "eq", "false"), "select=id,name,kind"].join("&");
  const { data } = await rest("DELETE", "agents", query, { prefer: "return=representation" });
  const deleted = Array.isArray(data) ? data : [];
  if (deleted.length !== 1) {
    throw new UsageError(`Tidak ada baris yang dihapus (submission ${row.id} mungkin baru saja diproses).`);
  }
  summary(
    [
      "## Review queue: rejected",
      "",
      `- ${safeMd(deleted[0].name, MAX_NAME_LENGTH)} (\`${deleted[0].id}\`, ${kindLabel(deleted[0].kind)})`,
      "",
      `Baris dihapus: ${deleted.length}`,
    ].join("\n")
  );
  log(`Rejected (deleted) ${deleted.length} row(s): ${deleted[0].id}`);
}

// Cari tepat satu agent (approved atau pending) untuk set-contract /
// set-demo.
async function resolveAny(action, target, column) {
  const query = [
    `select=id,name,approved,${column}`,
    ...matchFilters(target),
    "order=created_at.asc",
    "limit=50",
  ].join("&");
  const { data } = await rest("GET", "agents", query);
  const rows = Array.isArray(data) ? data : [];

  if (rows.length === 0) {
    throw new UsageError(`Tidak ada agent yang cocok dengan ${describeTarget(target)}.`);
  }
  if (rows.length > 1 && !target.id) {
    throw new UsageError(
      `${rows.length} agent memakai nama yang sama. Isi id: ${rows.map((r) => r.id).join(", ")}`
    );
  }
  return rows[0];
}

async function setField(action, target) {
  const { column, label } = SET_ACTIONS[action];
  const row = await resolveAny(action, target, column);
  const before = row[column] ?? null;

  if (before === target.value) {
    summary(`## Review queue: ${action}\n\nTidak ada perubahan: ${label} untuk ${safeMd(row.name, MAX_NAME_LENGTH)} sudah sama.`);
    log(`${action}: no change for ${row.id}`);
    return;
  }

  const query = [filter("id", "eq", row.id), `select=id,name,${column}`].join("&");
  const { data } = await rest("PATCH", "agents", query, {
    body: { [column]: target.value },
    prefer: "return=representation",
  });
  const changed = Array.isArray(data) ? data : [];
  if (changed.length !== 1) {
    throw new UsageError(`Tidak ada baris yang diubah (agent ${row.id} mungkin baru saja dihapus).`);
  }

  const show = (v) => (v ? safeMd(v, MAX_DEMO_URL) : "_(kosong)_");
  summary(
    [
      `## Review queue: ${action}`,
      "",
      `- ${safeMd(changed[0].name, MAX_NAME_LENGTH)} (\`${changed[0].id}\`, ${row.approved ? "approved" : "pending"})`,
      `- ${label} lama: ${show(before)}`,
      `- ${label} baru: ${show(changed[0][column])}`,
    ].join("\n")
  );
  log(`${action}: updated ${changed[0].id}`);
}

// ---------- main ----------

async function main() {
  const input = parseInput(process.env);
  requireEnv(["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]);

  if (input.action === "list") return listPending();
  if (input.action === "approve") return approve(input);
  if (input.action === "reject") return reject(input);
  return setField(input.action, input);
}

main().catch((err) => {
  const message = err && err.message ? err.message : String(err);
  if (err instanceof UsageError) {
    summary(`## Review queue: gagal\n\n${message.replace(/[<>]/g, "")}`);
  }
  logError(message);
  process.exitCode = 1;
});
