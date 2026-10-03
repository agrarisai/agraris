// ============================================
// Agraris — email notifikasi agent baru (untuk admin)
// ============================================
// Dijalankan oleh .github/workflows/generate-rss.yml (cron harian
// 00:00 UTC + manual trigger), SEBELUM langkah GitHub stats / RSS /
// sitemap.
//
// Alur:
//   1. Ambil semua agent yang created_at-nya dalam 24 jam terakhir.
//   2. Kalau tidak ada → selesai, tidak kirim email apa pun.
//   3. Kalau ada → kirim SATU email ringkasan lewat Resend berisi
//      nama tiap agent + link ke halaman agent + link repo, supaya
//      bisa langsung dibuka untuk review Verified.
//
// Notifikasi ini tidak penting untuk situs, jadi skrip ini TIDAK
// PERNAH membuat workflow gagal: setiap error (env kosong, Supabase,
// Resend, jaringan) hanya di-log lalu skrip keluar dengan kode 0,
// supaya langkah RSS/sitemap setelahnya tetap jalan.
//
// Env vars yang dibutuhkan (dari GitHub Secrets):
//   SUPABASE_URL              — Project URL Supabase
//   SUPABASE_SERVICE_ROLE_KEY — service_role key (JANGAN dipakai di client-side!)
//   RESEND_API_KEY            — API key Resend
//   NOTIFY_EMAIL              — alamat tujuan email notifikasi
//
// Keamanan: jangan pernah console.log isi env var di atas, header
// request, atau objek error mentah yang bisa memuat header. Log di
// skrip ini sengaja hanya mencetak pesan error dan status code.

const { createClient } = require("@supabase/supabase-js");

// ---------- pengaturan yang mudah diubah ----------

// Jendela waktu "agent baru". Workflow jalan sekali sehari, jadi 24 jam.
const LOOKBACK_HOURS = 24;

// Base URL situs untuk link ke halaman agent (domain dari file CNAME).
const SITE_URL = "https://agraris.xyz/";

// Pengirim default Resend — tidak perlu verifikasi domain sendiri.
const FROM_ADDRESS = "Agraris <onboarding@resend.dev>";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

// ---------- helper ----------

// Log error tanpa pernah mencetak objek mentah (yang bisa saja
// membawa header/secret). Hanya message string yang ditampilkan.
function logError(context, err) {
  const message = err && err.message ? err.message : String(err);
  console.error(`[notify-new-agents] ${context}: ${message}`);
}

// Ganti setiap alamat email di sebuah teks dengan "[email]" sebelum
// teks itu masuk ke log.
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

function agentPageUrl(agent) {
  return `${SITE_URL}agent.html?id=${encodeURIComponent(agent.id)}`;
}

// ---------- isi email ----------
// Ubah dua fungsi di bawah ini kalau mau mengganti format email.

function buildSubject(agents) {
  const count = agents.length;
  return `Agraris: ${count} new agent${count === 1 ? "" : "s"} to review`;
}

// Versi HTML: daftar bernomor, tiap agent berisi nama (link ke halaman
// agent), waktu publish, dan link repo.
function buildHtml(agents) {
  const items = agents
    .map((agent) => {
      const name = escapeHtml(agent.name || "(no name)");
      const page = escapeHtml(agentPageUrl(agent));
      const repo = agent.repo_url ? escapeHtml(agent.repo_url) : "";
      const published = escapeHtml(new Date(agent.created_at).toUTCString());

      return `
        <li style="margin-bottom:14px">
          <a href="${page}" style="font-weight:600;color:#1f4a2c">${name}</a><br />
          <span style="color:#666;font-size:12px">Published ${published}</span><br />
          ${
            repo
              ? `Repo: <a href="${repo}">${repo}</a>`
              : `<span style="color:#8a3324">No repo link</span>`
          }
        </li>`;
    })
    .join("");

  return `
    <div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;color:#222;line-height:1.5">
      <p>${agents.length} new agent${agents.length === 1 ? " was" : "s were"} published on Agraris in the last ${LOOKBACK_HOURS} hours:</p>
      <ol style="padding-left:20px">${items}</ol>
      <p style="color:#666;font-size:12px">Sent by the daily "Generate feeds" GitHub Action (scripts/notify-new-agents.js).</p>
    </div>`;
}

// Versi teks polos untuk email client yang tidak menampilkan HTML.
function buildText(agents) {
  const lines = agents.map((agent, i) =>
    [
      `${i + 1}. ${agent.name || "(no name)"}`,
      `   Page: ${agentPageUrl(agent)}`,
      `   Repo: ${agent.repo_url || "(no repo link)"}`,
    ].join("\n")
  );

  return [
    `${agents.length} new agent(s) published on Agraris in the last ${LOOKBACK_HOURS} hours:`,
    "",
    lines.join("\n\n"),
  ].join("\n");
}

// ---------- langkah utama ----------

async function fetchNewAgents(supabase) {
  const since = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000);

  const { data, error } = await supabase
    .from("agents")
    .select("id, name, repo_url, created_at")
    .gte("created_at", since.toISOString())
    .order("created_at", { ascending: true });

  if (error) throw new Error(`Supabase query failed: ${error.message}`);
  return data ?? [];
}

async function sendEmail(agents) {
  const res = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM_ADDRESS,
      to: [process.env.NOTIFY_EMAIL],
      subject: buildSubject(agents),
      html: buildHtml(agents),
      text: buildText(agents),
    }),
  });

  if (res.ok) {
    console.log(`[notify-new-agents] Email sent for ${agents.length} new agent(s).`);
    return;
  }

  // Resend membalas error dalam bentuk JSON { name, message, statusCode }.
  // Yang di-log hanya status + message, bukan body/headers mentah.
  // Alamat email di dalam message disensor: error 403 Resend menyebut
  // email pemilik akun, dan log Actions bisa dibaca publik.
  let detail = "";
  try {
    const body = await res.json();
    detail = body && body.message ? redactEmails(body.message) : "";
  } catch {
    // body bukan JSON — cukup pakai status code saja
  }

  console.error(
    `[notify-new-agents] Resend rejected the email (HTTP ${res.status})${detail ? `: ${detail}` : ""}`
  );

  // Paket gratis Resend dengan pengirim onboarding@resend.dev hanya
  // boleh mengirim ke email pemilik akun Resend. Errornya 403.
  if (res.status === 403) {
    console.error(
      "[notify-new-agents] Hint: on Resend's free plan, onboarding@resend.dev can only send to the email address of the Resend account itself. Set the NOTIFY_EMAIL secret to that address, or verify your own domain in Resend."
    );
  }
}

async function main() {
  const missing = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "RESEND_API_KEY",
    "NOTIFY_EMAIL",
  ].filter((name) => !process.env[name]);

  // Hanya NAMA env var yang dicetak, tidak pernah nilainya.
  if (missing.length > 0) {
    console.error(
      `[notify-new-agents] Skipping: missing environment variable(s): ${missing.join(", ")}`
    );
    return;
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const agents = await fetchNewAgents(supabase);

  if (agents.length === 0) {
    console.log(
      `[notify-new-agents] No new agents in the last ${LOOKBACK_HOURS} hours — no email sent.`
    );
    return;
  }

  console.log(`[notify-new-agents] Found ${agents.length} new agent(s); sending summary email.`);
  await sendEmail(agents);
}

main()
  .catch((err) => logError("Notification failed (continuing workflow)", err))
  .finally(() => {
    // Selalu keluar dengan kode 0: notifikasi gagal tidak boleh
    // menghentikan langkah RSS/sitemap di workflow.
    process.exitCode = 0;
  });
