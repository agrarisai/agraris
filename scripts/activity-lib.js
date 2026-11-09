// Menghitung ringkasan aktivitas commit 7 hari dari daftar commit GitHub.
// Dipakai scripts/update-github-stats.js dan dites di tests/activity-lib.test.js.
// Hanya kode: bukan bukti pemakaian, bukan endorsement.

const DAY_MS = 86400000;

// Tanggal UTC (YYYY-MM-DD) dari timestamp ms.
function utcDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

// commits: array respons GET /repos/{o}/{r}/commits (urut terbaru dulu).
// now: ms epoch. Hasil: { c7, d: [7 angka, hari tertua dulu], last } atau
// c7 = 0 dan semua d = 0 bila tidak ada commit di jendela itu.
function summarizeCommits(commits, now = Date.now()) {
  const days = [];
  for (let i = 6; i >= 0; i--) days.push(utcDay(now - i * DAY_MS));
  const counts = days.map(() => 0);
  // The 7 days before that (days 8-14 ago), to compare with this week.
  const prevDays = [];
  for (let i = 13; i >= 7; i--) prevDays.push(utcDay(now - i * DAY_MS));
  let last = null;
  let c7 = 0;
  let p7 = 0;

  for (const item of Array.isArray(commits) ? commits : []) {
    const iso = item && item.commit && (item.commit.committer?.date || item.commit.author?.date);
    const t = iso ? new Date(iso).getTime() : NaN;
    if (Number.isNaN(t)) continue;
    const idx = days.indexOf(utcDay(t));
    if (idx === -1) {
      if (prevDays.includes(utcDay(t))) p7 += 1;
      continue;
    }
    counts[idx] += 1;
    c7 += 1;
    if (!last || t > new Date(last).getTime()) last = new Date(t).toISOString();
  }

  // The commits API returns at most 100 per page. A full page means the
  // previous week may be cut off, so it is unknown (null), never guessed.
  const capped = Array.isArray(commits) && commits.length >= 100;
  return { c7, d: counts, last, p7: capped ? null : p7 };
}

// "Rising": this week has at least 5 commits and at least double the
// previous 7 days (p7 known). Code activity only; not usage, not an
// endorsement.
function isRising(a) {
  if (!a || a.p7 === null || a.p7 === undefined) return false;
  return a.c7 >= 5 && a.c7 >= 2 * a.p7 && a.c7 > a.p7;
}

// Memvalidasi nilai github_activity dari database/browser sebelum dipakai.
function normalizeActivity(value) {
  if (!value || typeof value !== "object") return null;
  const c7 = Number(value.c7);
  if (!Number.isFinite(c7) || c7 < 0) return null;
  const d = Array.isArray(value.d) ? value.d.slice(0, 7).map((n) => Math.max(0, Number(n) || 0)) : [];
  while (d.length < 7) d.unshift(0);
  const last = typeof value.last === "string" && !Number.isNaN(new Date(value.last).getTime()) ? value.last : null;
  const p = value.p7 === null || value.p7 === undefined ? NaN : Number(value.p7);
  const p7 = Number.isFinite(p) && p >= 0 ? Math.floor(p) : null;
  return { c7: Math.floor(c7), d, last, p7 };
}

module.exports = { summarizeCommits, normalizeActivity, isRising, utcDay };
