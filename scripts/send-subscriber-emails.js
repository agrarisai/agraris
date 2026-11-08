// ============================================
// Agraris — kirim email ke pelanggan (konfirmasi + digest mingguan)
// ============================================
// Pemakaian: node scripts/send-subscriber-emails.js confirm|digest
//
//   confirm — kirim email konfirmasi ke pendaftar baru (confirm_sent_at
//             kosong). Dijalankan tiap 15 menit.
//   digest  — kirim digest mingguan ke pelanggan yang sudah konfirmasi
//             dan belum berhenti. Tidak mengirim apa-apa kalau minggu ini
//             tidak ada listing baru dan tidak ada yang aktif.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY,
//      FROM_ADDRESS (opsional), DRY_RUN=true (hanya hitung, tidak kirim).
//
// Aturan "kirim dulu, tandai setelah sukses": penanda (confirm_sent_at /
// last_sent_at) hanya diisi untuk email yang benar-benar terkirim.
// Keamanan: tidak pernah mencetak alamat email, token, atau env var.

const { requireEnv, rest, filter } = require("./review-lib");
const { normalizeActivity } = require("./activity-lib");
const { buildConfirmEmail, buildDigestEmail } = require("./subscriber-mail");

const RESEND_SINGLE = "https://api.resend.com/emails";
const RESEND_BATCH = "https://api.resend.com/emails/batch";
const DEFAULT_FROM = "Agraris <digest@agraris.xyz>";
const MAX_CONFIRM_PER_RUN = 30;
const BATCH_SIZE = 50;
const MAX_SUBSCRIBERS = 2000;
const NEW_DAYS = 7;
const TOP_ACTIVE = 5;
const MIN_DAYS_BETWEEN_DIGESTS = 5;

const log = (m) => console.log(`[subscriber-emails] ${m}`);

function from() {
  return process.env.FROM_ADDRESS || DEFAULT_FROM;
}

async function resend(url, payload) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let detail = "";
    try {
      const j = await res.json();
      if (j && typeof j.message === "string") detail = `: ${j.message}`;
    } catch {}
    throw new Error(`Resend failed (HTTP ${res.status})${detail}`);
  }
}

async function patchByIds(ids, body) {
  if (!ids.length) return;
  await rest("PATCH", "subscribers", `id=in.(${ids.join(",")})`, { body });
}

async function runConfirm(dry) {
  const { data } = await rest(
    "GET",
    "subscribers",
    [
      "select=id,email,token",
      "confirmed_at=is.null",
      "unsubscribed_at=is.null",
      "confirm_sent_at=is.null",
      "order=created_at.asc",
      `limit=${MAX_CONFIRM_PER_RUN}`,
    ].join("&")
  );
  const rows = Array.isArray(data) ? data : [];
  log(`${rows.length} confirmation(s) pending`);
  if (dry || !rows.length) return;

  let sent = 0;
  for (const row of rows) {
    const mail = buildConfirmEmail(row.token);
    try {
      await resend(RESEND_SINGLE, {
        from: from(),
        to: [row.email],
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
      });
    } catch (e) {
      console.error(`[subscriber-emails] ${e.message}`);
      continue;
    }
    await patchByIds([row.id], { confirm_sent_at: new Date().toISOString() });
    sent++;
  }
  log(`sent ${sent} confirmation(s)`);
  if (sent < rows.length) process.exitCode = 1;
}

async function loadDigestContent(now = Date.now()) {
  const since = new Date(now - NEW_DAYS * 86400000).toISOString();
  const fresh = await rest(
    "GET",
    "agents",
    [
      "select=id,name,kind,description,approved_at",
      "approved=eq.true",
      filter("approved_at", "gte", since),
      "order=approved_at.desc",
      "limit=10",
    ].join("&")
  );
  const all = await rest(
    "GET",
    "agents",
    "select=id,name,github_activity&approved=eq.true&github_activity=not.is.null&limit=1000"
  );
  const active = (Array.isArray(all.data) ? all.data : [])
    .map((r) => ({ id: r.id, name: r.name, c7: normalizeActivity(r.github_activity)?.c7 || 0 }))
    .filter((r) => r.c7 > 0)
    .sort((a, b) => b.c7 - a.c7)
    .slice(0, TOP_ACTIVE);
  return { newListings: Array.isArray(fresh.data) ? fresh.data : [], mostActive: active };
}

async function runDigest(dry) {
  const content = await loadDigestContent();
  if (!content.newListings.length && !content.mostActive.length) {
    log("nothing to report this week, skipping");
    return;
  }
  const cutoff = new Date(Date.now() - MIN_DAYS_BETWEEN_DIGESTS * 86400000).toISOString();
  const { data } = await rest(
    "GET",
    "subscribers",
    [
      "select=id,email,token,last_sent_at",
      "confirmed_at=not.is.null",
      "unsubscribed_at=is.null",
      `or=(last_sent_at.is.null,last_sent_at.lt.${encodeURIComponent(cutoff)})`,
      "order=created_at.asc",
      `limit=${MAX_SUBSCRIBERS}`,
    ].join("&")
  );
  const rows = Array.isArray(data) ? data : [];
  log(`${content.newListings.length} new, ${content.mostActive.length} active, ${rows.length} recipient(s)`);
  if (dry || !rows.length) return;

  let sent = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE);
    const payload = chunk.map((row) => {
      const mail = buildDigestEmail({ ...content, token: row.token });
      return {
        from: from(),
        to: [row.email],
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        headers: { "List-Unsubscribe": `<${mail.unsubscribeUrl}>` },
      };
    });
    try {
      await resend(RESEND_BATCH, payload);
    } catch (e) {
      console.error(`[subscriber-emails] ${e.message}`);
      process.exitCode = 1;
      continue;
    }
    await patchByIds(chunk.map((r) => r.id), { last_sent_at: new Date().toISOString() });
    sent += chunk.length;
  }
  log(`sent ${sent} digest(s)`);
}

async function main() {
  const mode = process.argv[2];
  if (mode !== "confirm" && mode !== "digest") {
    throw new Error("Usage: send-subscriber-emails.js confirm|digest");
  }
  requireEnv(["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "RESEND_API_KEY"]);
  const dry = process.env.DRY_RUN === "true";
  if (mode === "confirm") await runConfirm(dry);
  else await runDigest(dry);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(`[subscriber-emails] ${e.message}`);
    process.exit(1);
  });
}

module.exports = { loadDigestContent, runConfirm, runDigest };
