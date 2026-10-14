// ============================================
// Agraris — pilih "Agent of the week" dari GitHub Actions
// ============================================
// Dijalankan oleh .github/workflows/feature-agent.yml (workflow_dispatch).
// Pola dan pengamanannya sama dengan scripts/review-action.js.
//
// Input (diteruskan workflow lewat env, TIDAK lewat perintah shell):
//   FEATURE_ACTION     — feature | unfeature | list
//   FEATURE_NAME       — nama agent persis (opsional)
//   FEATURE_ID         — uuid agent (opsional; wajib kalau nama dipakai
//                        lebih dari satu agent approved)
//   FEATURE_NOTE       — catatan singkat, maks. 280 karakter (opsional)
//   FEATURE_WEEK_START — YYYY-MM-DD, harus hari Senin (opsional; default
//                        Senin minggu ini, UTC)
//
// Aturan:
//   feature   — hanya untuk agent approved = true yang cocok dengan id,
//               atau name persis (kalau keduanya diisi, keduanya harus
//               cocok). 0 cocok → gagal. Lebih dari 1 cocok tanpa id →
//               gagal dan tampilkan daftar id. Lalu upsert baris untuk
//               week_start itu (mengganti pilihan minggu itu), dan tulis
//               draf postingan X ke GITHUB_STEP_SUMMARY.
//   unfeature — hapus pilihan untuk week_start itu.
//   list      — 10 pilihan terakhir ke GITHUB_STEP_SUMMARY.
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
  cleanText,
  safeMd,
  appendSummary,
} = require("./review-lib");

const ACTIONS = ["feature", "unfeature", "list"];
const MAX_NOTE_LENGTH = 280; // sama dengan constraint featured_agents_note_length
const LIST_LIMIT = 10;

const SITE_URL = "https://agraris.xyz/";
const FEATURED_LABEL = "agraris.xyz/featured";
const DRAFT_SENTENCE_MAX = 140;
// Panjang maksimum postingan X; setiap URL dihitung 23 karakter oleh X.
const X_MAX_LENGTH = 280;
const X_URL_LENGTH = 23;

// Draf tidak boleh menyebut token, harga, atau "terbaik". Kalimat dari
// deskripsi atau catatan yang mengandung kata-kata ini dibuang dari draf.
const FORBIDDEN_IN_DRAFT =
  /\b(tokens?|tokenomics|price[sd]?|pricing|best|terbaik|harga|airdrop|pump)\b|\$[A-Za-z]{2,}|\$\s?\d/i;

class UsageError extends Error {}

function log(message) {
  console.log(`[feature-agent] ${message}`);
}

function logError(message) {
  console.error(`[feature-agent] ${message}`);
}

function summary(markdown) {
  if (!appendSummary(markdown)) console.log(markdown);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ---------- tanggal ----------

function toIsoDate(d) {
  return d.toISOString().slice(0, 10);
}

// Senin minggu ISO yang memuat `d` (UTC).
function mondayOf(d) {
  const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const isoDay = day.getUTCDay() === 0 ? 7 : day.getUTCDay();
  day.setUTCDate(day.getUTCDate() - (isoDay - 1));
  return day;
}

function parseWeekStart(raw, now = new Date()) {
  const value = String(raw || "").trim();
  if (!value) return toIsoDate(mondayOf(now));

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new UsageError("week_start harus berformat YYYY-MM-DD, misalnya 2026-10-12.");
  }
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || toIsoDate(d) !== value) {
    throw new UsageError(`week_start ${value} bukan tanggal yang valid.`);
  }
  if (d.getUTCDay() !== 1) {
    throw new UsageError(
      `week_start harus hari Senin. Senin untuk minggu itu adalah ${toIsoDate(mondayOf(d))}.`
    );
  }
  return value;
}

// ---------- validasi input ----------

function checkText(label, value, max) {
  if ([...value].length > max) {
    throw new UsageError(`${label} terlalu panjang (maksimal ${max} karakter).`);
  }
  if (CONTROL_CHARS.test(value) || INVISIBLE_CHARS.test(value)) {
    throw new UsageError(`${label} berisi karakter kontrol atau karakter tak terlihat.`);
  }
}

function parseInput(env, now = new Date()) {
  const action = String(env.FEATURE_ACTION || "").trim().toLowerCase();
  if (!ACTIONS.includes(action)) {
    throw new UsageError(`action harus salah satu dari: ${ACTIONS.join(", ")}.`);
  }

  const id = String(env.FEATURE_ID || "").trim().toLowerCase();
  if (id && !UUID_PATTERN.test(id)) {
    throw new UsageError("id harus berupa uuid, misalnya 2f1c9a7e-1b2c-4d3e-8f90-123456789abc.");
  }

  const name = String(env.FEATURE_NAME || "").trim();
  if (name) checkText("name", name, MAX_NAME_LENGTH);

  const note = String(env.FEATURE_NOTE || "").trim();
  if (note) checkText("note", note, MAX_NOTE_LENGTH);

  const weekStart = parseWeekStart(env.FEATURE_WEEK_START, now);

  if (action === "feature" && !id && !name) {
    throw new UsageError("feature butuh id atau name.");
  }

  return { action, id, name, note, weekStart };
}

function describeTarget({ id, name }) {
  const parts = [];
  if (id) parts.push(`id \`${id}\``);
  if (name) parts.push(`name "${safeMd(name, MAX_NAME_LENGTH)}"`);
  return parts.join(" dan ");
}

// ---------- query ----------

async function findAgents(target, approved) {
  const query = [
    "select=id,name,description,version",
    filter("approved", "eq", approved ? "true" : "false"),
    ...(target.id ? [filter("id", "eq", target.id)] : []),
    ...(target.name ? [filter("name", "eq", target.name)] : []),
    "order=created_at.asc",
    "limit=50",
  ].join("&");
  const { data } = await rest("GET", "agents", query);
  return Array.isArray(data) ? data : [];
}

async function agentNamesById(ids) {
  const clean = [...new Set(ids.map(String))].filter((x) => UUID_PATTERN.test(x));
  if (clean.length === 0) return new Map();
  const { data } = await rest("GET", "agents", `select=id,name,approved&id=in.(${clean.join(",")})`);
  return new Map((Array.isArray(data) ? data : []).map((a) => [String(a.id), a]));
}

async function pickForWeek(weekStart) {
  const { data } = await rest(
    "GET",
    "featured_agents",
    ["select=week_start,agent_id,note", filter("week_start", "eq", weekStart), "limit=1"].join("&")
  );
  return Array.isArray(data) && data[0] ? data[0] : null;
}

// ---------- draf postingan X ----------

function firstSentence(text) {
  const clean = cleanText(text, 600);
  const match = /^(.+?[.!?])(\s|$)/.exec(clean);
  const sentence = match ? match[1] : clean;
  return cleanText(sentence, DRAFT_SENTENCE_MAX);
}

function xLength(text) {
  // X menghitung setiap URL sebagai 23 karakter.
  return text.replace(/https?:\/\/\S+|agraris\.xyz\/\S*/g, "x".repeat(X_URL_LENGTH)).length;
}

function buildDraft(agent, note) {
  const warnings = [];
  const name = cleanText(agent.name, MAX_NAME_LENGTH);

  let sentence = firstSentence(agent.description);
  if (sentence && FORBIDDEN_IN_DRAFT.test(sentence)) {
    warnings.push("Kalimat dari deskripsi menyebut token/harga/\"best\", jadi tidak dimasukkan ke draf.");
    sentence = "";
  }

  let cleanNote = note ? cleanText(note, MAX_NOTE_LENGTH) : "";
  if (cleanNote && FORBIDDEN_IN_DRAFT.test(cleanNote)) {
    warnings.push("Catatan menyebut token/harga/\"best\", jadi tidak dimasukkan ke draf.");
    cleanNote = "";
  }

  const agentUrl = `${SITE_URL}agent.html?id=${encodeURIComponent(agent.id)}`;
  const lines = [`Agent of the week on Agraris: ${name}`, ""];
  if (sentence) lines.push(sentence, "");
  if (cleanNote) lines.push(cleanNote, "");
  lines.push(agentUrl, `More picks: ${FEATURED_LABEL}`);
  const draft = lines.join("\n");

  if (/[@#]/.test(`${name} ${sentence} ${cleanNote}`)) {
    warnings.push("Draf berisi @ atau # dari teks agent/catatan; periksa sebelum diposting supaya tidak menandai akun lain.");
  }
  const length = xLength(draft);
  if (length > X_MAX_LENGTH) {
    warnings.push(`Draf sekitar ${length} karakter (batas X ${X_MAX_LENGTH}); pendekkan sebelum diposting.`);
  }

  return { draft, length, warnings };
}

// ---------- actions ----------

async function feature(input) {
  const matches = await findAgents(input, true);

  if (matches.length === 0) {
    const pending = await findAgents(input, false);
    const hint =
      pending.length > 0
        ? " Agent yang cocok belum approved, jadi tidak bisa dipilih."
        : " Periksa ejaan nama persis, atau pakai id.";
    throw new UsageError(`Tidak ada agent approved yang cocok dengan ${describeTarget(input)}.${hint}`);
  }

  if (matches.length > 1 && !input.id) {
    summary(
      [
        "## Feature agent: dibatalkan",
        "",
        `${matches.length} agent approved memakai nama yang sama. Jalankan lagi dengan mengisi id salah satu baris berikut:`,
        "",
        "| Name | ID |",
        "| --- | --- |",
        ...matches.map((a) => `| ${safeMd(a.name, MAX_NAME_LENGTH)} | \`${a.id}\` |`),
      ].join("\n")
    );
    throw new UsageError(
      `${matches.length} agent approved cocok dengan nama itu. Isi id: ${matches.map((a) => a.id).join(", ")}`
    );
  }

  const agent = matches[0];
  const previous = await pickForWeek(input.weekStart);

  const { data } = await rest(
    "POST",
    "featured_agents",
    "on_conflict=week_start&select=week_start,agent_id,note",
    {
      body: [{ agent_id: agent.id, week_start: input.weekStart, note: input.note || null }],
      prefer: "resolution=merge-duplicates,return=representation",
    }
  );
  const saved = Array.isArray(data) ? data : [];
  if (saved.length !== 1 || String(saved[0].agent_id) !== String(agent.id)) {
    throw new Error("Upsert featured_agents tidak mengembalikan baris yang diharapkan.");
  }

  let replaced = "";
  if (previous && String(previous.agent_id) !== String(agent.id)) {
    const names = await agentNamesById([previous.agent_id]);
    const prev = names.get(String(previous.agent_id));
    replaced = `Menggantikan pilihan sebelumnya: ${prev ? safeMd(prev.name, MAX_NAME_LENGTH) : "(agent tidak ditemukan)"} (\`${previous.agent_id}\`).`;
  } else if (previous) {
    replaced = "Agent yang sama sudah dipilih untuk minggu ini; catatan diperbarui.";
  }

  const { draft, length, warnings } = buildDraft(agent, input.note);

  summary(
    [
      "## Feature agent: featured",
      "",
      `- Minggu: \`${input.weekStart}\``,
      `- Agent: ${safeMd(agent.name, MAX_NAME_LENGTH)} (\`${agent.id}\`)`,
      `- Catatan: ${input.note ? safeMd(input.note, MAX_NOTE_LENGTH) : "-"}`,
      ...(replaced ? [`- ${replaced}`] : []),
      "",
      "Baris disimpan: 1",
      "",
      "### Draf postingan X",
      "",
      "Belum diposting ke mana pun. Salin kalau mau dipakai:",
      "",
      `<pre>${escapeHtml(draft)}</pre>`,
      "",
      `Perkiraan panjang di X: ${length} karakter.`,
      ...(warnings.length ? ["", ...warnings.map((w) => `> **Periksa:** ${w}`)] : []),
    ].join("\n")
  );
  log(`Featured ${agent.id} for week ${input.weekStart}.`);
}

async function unfeature(input) {
  const { data } = await rest(
    "DELETE",
    "featured_agents",
    [filter("week_start", "eq", input.weekStart), "select=week_start,agent_id"].join("&"),
    { prefer: "return=representation" }
  );
  const deleted = Array.isArray(data) ? data : [];
  if (deleted.length === 0) {
    throw new UsageError(`Tidak ada pilihan untuk minggu ${input.weekStart}.`);
  }
  const names = await agentNamesById(deleted.map((d) => d.agent_id));
  const agent = names.get(String(deleted[0].agent_id));
  summary(
    [
      "## Feature agent: unfeatured",
      "",
      `- Minggu: \`${input.weekStart}\``,
      `- Agent: ${agent ? safeMd(agent.name, MAX_NAME_LENGTH) : "-"} (\`${deleted[0].agent_id}\`)`,
      "",
      `Baris dihapus: ${deleted.length}`,
    ].join("\n")
  );
  log(`Unfeatured week ${input.weekStart} (${deleted.length} row).`);
}

async function list() {
  const { data } = await rest(
    "GET",
    "featured_agents",
    `select=week_start,agent_id,note&order=week_start.desc&limit=${LIST_LIMIT}`
  );
  const rows = Array.isArray(data) ? data : [];
  const names = await agentNamesById(rows.map((r) => r.agent_id));

  const parts = ["## Feature agent: 10 pilihan terakhir", ""];
  if (rows.length === 0) {
    parts.push("Belum ada pilihan.");
  } else {
    parts.push("| Minggu | Agent | ID | Tampil publik | Catatan |", "| --- | --- | --- | --- | --- |");
    for (const r of rows) {
      const a = names.get(String(r.agent_id));
      parts.push(
        `| \`${r.week_start}\` | ${a ? safeMd(a.name, MAX_NAME_LENGTH) : "-"} | \`${r.agent_id}\` | ${a && a.approved ? "ya" : "tidak (agent tidak approved)"} | ${r.note ? safeMd(r.note, MAX_NOTE_LENGTH) : "-"} |`
      );
    }
  }
  summary(parts.join("\n"));
  log(`Listed ${rows.length} pick(s).`);
}

// ---------- main ----------

async function main() {
  const input = parseInput(process.env);
  requireEnv(["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]);

  if (input.action === "feature") return feature(input);
  if (input.action === "unfeature") return unfeature(input);
  return list();
}

if (require.main === module) {
  main().catch((err) => {
    const message = err && err.message ? err.message : String(err);
    if (err instanceof UsageError) {
      summary(`## Feature agent: gagal\n\n${message.replace(/[<>]/g, "")}`);
    }
    logError(message);
    process.exitCode = 1;
  });
}

module.exports = { parseInput, parseWeekStart, mondayOf, buildDraft, firstSentence, xLength };
