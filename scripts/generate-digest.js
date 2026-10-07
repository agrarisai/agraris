// ============================================
// Agraris — draf weekly digest (untuk admin, bukan diposting otomatis)
// ============================================
// Dijalankan oleh .github/workflows/weekly-digest.yml (cron tiap Minggu
// 02:00 UTC = 09:00 WIB, + manual trigger).
//
// Alur:
//   1. Ambil dari Supabase: agent yang dibuat 7 hari terakhir, top 3
//      agent berdasarkan github_stars, dan total jumlah agent.
//   2. Susun draf singkat berbahasa Inggris (lihat buildDraft()).
//   3. Tulis draf ke GitHub job summary (halaman run di tab Actions).
//   4. Kirim draf ke NOTIFY_EMAIL lewat Resend.
//
// Skrip ini HANYA membuat draf. Tidak ada yang diposting ke X atau
// tempat lain — admin yang memutuskan mau dipakai atau tidak.
//
// Isi draf sengaja tidak menyebut token atau harga.
//
// Kalau gagal (Supabase / Resend), skrip keluar dengan kode 1 supaya
// run di Actions terlihat merah. Job summary ditulis SEBELUM email
// dikirim, jadi draf tetap bisa dibaca walaupun email gagal.
//
// Env vars (dari GitHub Actions secrets):
//   SUPABASE_URL              — Project URL Supabase
//   SUPABASE_SERVICE_ROLE_KEY — service_role key (JANGAN dipakai di client-side!)
//   RESEND_API_KEY            — API key Resend
//   NOTIFY_EMAIL              — alamat tujuan draf
// Disediakan otomatis oleh GitHub Actions:
//   GITHUB_STEP_SUMMARY       — file job summary (kalau tidak ada, dilewati)
//
// Keamanan: jangan console.log isi env var, header request, atau objek
// error mentah. Log di sini hanya mencetak pesan dan status code.

const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");

// ---------- pengaturan yang mudah diubah ----------

const LOOKBACK_DAYS = 7;
const TOP_STARRED_COUNT = 3;
const SITE_LABEL = "agraris.xyz";
const SITE_URL = "https://agraris.xyz/";

// Pengirim default Resend (tidak perlu verifikasi domain). Di paket
// gratis Resend hanya bisa mengirim ke email pemilik akun Resend.
const FROM_ADDRESS = "Agraris <onboarding@resend.dev>";
const EMAIL_SUBJECT = "Agraris weekly digest draft";
const RESEND_ENDPOINT = "https://api.resend.com/emails";

// Ditaruh di awal email/summary (bukan di dalam draf) kalau minggu ini
// tidak ada agent baru.
const NO_NEW_AGENTS_NOTICE =
  "No new agents this week. Consider skipping this digest.";

// ---------- helper ----------

function log(message) {
  console.log(`[generate-digest] ${message}`);
}

function logError(message) {
  console.error(`[generate-digest] ${message}`);
}

// Ganti alamat email di teks dengan "[email]" sebelum masuk log (error
// 403 Resend menyebut email pemilik akun, dan log Actions bisa publik).
function redactEmails(text) {
  return String(text).replace(/[^\s@()<>"']+@[^\s@()<>"']+\.[^\s@()<>"']+/g, "[email]");
}

function escapeHtml(value) {
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
      default:
        return "&#39;";
    }
  });
}

// "Sep 30 – Oct 7, 2026" (UTC). Tahun hanya ditulis sekali kecuali
// rentangnya melewati pergantian tahun.
function formatRange(start, end) {
  const fmt = (d, withYear) =>
    d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      ...(withYear ? { year: "numeric" } : {}),
      timeZone: "UTC",
    });
  const sameYear = start.getUTCFullYear() === end.getUTCFullYear();
  return `${fmt(start, !sameYear)} – ${fmt(end, true)}`;
}

// ---------- data ----------

async function fetchDigestData(supabase, since) {
  const [newRes, topRes, countRes] = await Promise.all([
    supabase
      .from("agents")
      .select("id, name, created_at")
      .gte("created_at", since.toISOString())
      .order("created_at", { ascending: true }),
    supabase
      .from("agents")
      .select("id, name, github_stars")
      .not("github_stars", "is", null)
      .order("github_stars", { ascending: false })
      .limit(TOP_STARRED_COUNT),
    supabase.from("agents").select("id", { count: "exact", head: true }),
  ]);

  for (const res of [newRes, topRes, countRes]) {
    if (res.error) throw new Error(`Supabase query failed: ${res.error.message}`);
  }

  return {
    newAgents: newRes.data ?? [],
    topStarred: topRes.data ?? [],
    total: countRes.count ?? 0,
  };
}

// ---------- draf ----------
// Ubah fungsi ini kalau mau mengganti format/kalimat draf.

function buildDraft({ rangeLabel, newAgents, topStarred, total }) {
  const lines = [`Agraris weekly, ${rangeLabel}`, ""];

  // Bagian "New this week" dihilangkan kalau tidak ada agent baru.
  if (newAgents.length > 0) {
    lines.push("New this week");
    newAgents.forEach((a) => lines.push(`- ${a.name}`));
    lines.push("");
  }

  if (topStarred.length > 0) {
    lines.push("Most starred right now");
    topStarred.forEach((a) =>
      lines.push(`- ${a.name} (${a.github_stars.toLocaleString("en-US")} stars)`)
    );
    lines.push("");
  }

  lines.push(`${total.toLocaleString("en-US")} agent${total === 1 ? "" : "s"} listed in total.`);
  lines.push("");
  lines.push(SITE_LABEL);

  return lines.join("\n");
}

// ---------- output: job summary + email ----------

function writeJobSummary(draft, notice) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) {
    log("GITHUB_STEP_SUMMARY not set (not running in Actions); skipping job summary.");
    return;
  }

  const parts = ["## Agraris weekly digest draft", ""];
  if (notice) parts.push(`> **${notice}**`, "");
  parts.push(
    "Copy the draft below if you want to post it. Nothing has been posted automatically.",
    "",
    "```text",
    draft,
    "```",
    "",
    `Draft length: ${draft.length} characters.`,
    ""
  );
  fs.appendFileSync(file, parts.join("\n"));
  log("Wrote draft to the job summary.");
}

function buildEmailHtml(draft, notice) {
  return `
    <div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;color:#222;line-height:1.5">
      ${
        notice
          ? `<p style="padding:10px 12px;background:#fff4e5;border-left:3px solid #c77700;margin:0 0 16px"><strong>${escapeHtml(notice)}</strong></p>`
          : ""
      }
      <p style="margin:0 0 8px">Draft for this week's digest. Nothing has been posted — copy it if you want to use it:</p>
      <pre style="font-family:Menlo,Consolas,monospace;font-size:13px;white-space:pre-wrap;background:#f6f3ee;border:1px solid #ddd3c2;padding:12px;margin:0 0 12px">${escapeHtml(draft)}</pre>
      <p style="color:#666;font-size:12px;margin:0">${draft.length} characters · sent by the "Weekly digest" GitHub Action (scripts/generate-digest.js) · <a href="${SITE_URL}">${SITE_LABEL}</a></p>
    </div>`;
}

function buildEmailText(draft, notice) {
  return [
    ...(notice ? [notice, ""] : []),
    "Draft for this week's digest (nothing has been posted):",
    "",
    draft,
  ].join("\n");
}

// Mengembalikan true kalau terkirim, false kalau Resend menolak.
async function sendEmail(draft, notice) {
  const res = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM_ADDRESS,
      to: [process.env.NOTIFY_EMAIL],
      subject: EMAIL_SUBJECT,
      html: buildEmailHtml(draft, notice),
      text: buildEmailText(draft, notice),
    }),
  });

  if (res.ok) {
    log("Draft emailed.");
    return true;
  }

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

async function main() {
  const missing = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "RESEND_API_KEY",
    "NOTIFY_EMAIL",
  ].filter((name) => !process.env[name]);

  // Hanya NAMA env var yang dicetak, tidak pernah nilainya.
  if (missing.length > 0) {
    throw new Error(`Missing environment variable(s): ${missing.join(", ")}`);
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const now = new Date();
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  const data = await fetchDigestData(supabase, since);
  log(
    `New this week: ${data.newAgents.length}, top starred: ${data.topStarred.length}, total: ${data.total}.`
  );

  const draft = buildDraft({ rangeLabel: formatRange(since, now), ...data });
  const notice = data.newAgents.length === 0 ? NO_NEW_AGENTS_NOTICE : "";

  // Summary dulu, supaya draf tetap tersimpan kalau email gagal.
  writeJobSummary(draft, notice);

  const sent = await sendEmail(draft, notice);
  if (!sent) process.exitCode = 1;
}

main().catch((err) => {
  logError(`Digest failed: ${redactEmails(err && err.message ? err.message : String(err))}`);
  process.exitCode = 1;
});
