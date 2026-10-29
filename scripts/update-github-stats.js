// ============================================
// Agraris — update github_stars/github_updated_at dari GitHub API
// ============================================
// Dijalankan oleh .github/workflows/generate-rss.yml (cron harian +
// manual trigger), SEBELUM generate-rss.js dan generate-sitemap.js.
//
// Sebelumnya, browser tiap pengunjung yang fetch GitHub API langsung
// (60 request/jam/IP tanpa auth) untuk menampilkan stars/last-updated
// tiap agent — boros kuota dan gampang kena rate limit. Sekarang
// proses fetch itu dipindah ke sini: berjalan sekali sehari, hasilnya
// disimpan di kolom github_stars/github_updated_at pada tabel
// `agents`, dan frontend tinggal membaca kolom itu bersama data agent
// lainnya.
//
// Kegagalan pada satu repo (URL tidak valid, 404, rate limit, dll)
// hanya men-skip agent itu — nilai lama di database dibiarkan apa
// adanya, tidak ditimpa jadi null — lalu lanjut ke agent berikutnya.
//
// Env vars yang dibutuhkan:
//   SUPABASE_URL              — Project URL Supabase
//   SUPABASE_SERVICE_ROLE_KEY — service_role key (JANGAN dipakai di client-side!)
//   GITHUB_TOKEN              — opsional, dipakai untuk menaikkan rate
//                                limit GitHub API (5000/jam vs 60/jam
//                                tanpa auth). GitHub Actions otomatis
//                                menyediakan token ini lewat secrets.GITHUB_TOKEN.

const { createClient } = require("@supabase/supabase-js");
const { summarizeCommits } = require("./activity-lib");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variable."
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const REQUEST_DELAY_MS = 400;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseGithubRepo(repoUrl) {
  if (typeof repoUrl !== "string") return null;
  try {
    const url = new URL(repoUrl);
    if (!/(^|\.)github\.com$/i.test(url.hostname)) return null;
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    const owner = parts[0];
    const repo = parts[1].replace(/\.git$/i, "");
    if (!owner || !repo) return null;
    return { owner, repo };
  } catch {
    return null;
  }
}

async function fetchGithubRepoInfo(owner, repo) {
  const headers = { Accept: "application/vnd.github+json" };
  if (GITHUB_TOKEN) headers.Authorization = `Bearer ${GITHUB_TOKEN}`;

  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers,
  });

  if (!res.ok) {
    throw new Error(`GitHub API responded ${res.status} for ${owner}/${repo}`);
  }

  const json = await res.json();
  return {
    stars: json.stargazers_count,
    pushedAt: json.pushed_at,
  };
}

// Commit 7 hari terakhir di branch default. Repo kosong (409) atau gagal
// membaca = null: aktivitas dilewati, bintang tetap diperbarui.
async function fetchGithubActivity(owner, repo) {
  const headers = { Accept: "application/vnd.github+json" };
  if (GITHUB_TOKEN) headers.Authorization = `Bearer ${GITHUB_TOKEN}`;
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/commits?since=${encodeURIComponent(since)}&per_page=100`,
    { headers }
  );
  if (res.status === 409) return summarizeCommits([]);
  if (!res.ok) throw new Error(`GitHub commits API responded ${res.status} for ${owner}/${repo}`);
  return summarizeCommits(await res.json());
}

async function main() {
  const { data: agents, error } = await supabase
    .from("agents")
    .select("id, repo_url");

  if (error) {
    throw new Error(`Failed to read agents table: ${error.message}`);
  }

  let updated = 0;
  let skipped = 0;

  for (const agent of agents ?? []) {
    const parsed = parseGithubRepo(agent.repo_url);

    if (!parsed) {
      console.warn(`Skipping agent ${agent.id}: invalid repo_url "${agent.repo_url}"`);
      skipped++;
      continue;
    }

    try {
      const { stars, pushedAt } = await fetchGithubRepoInfo(
        parsed.owner,
        parsed.repo
      );

      const { error: updateError } = await supabase
        .from("agents")
        .update({ github_stars: stars, github_updated_at: pushedAt })
        .eq("id", agent.id);

      if (updateError) {
        throw new Error(`Supabase update failed: ${updateError.message}`);
      }

      // Aktivitas terpisah dan tidak fatal: kolom github_activity mungkin
      // belum ada (migrasi belum dijalankan) atau commit gagal dibaca.
      try {
        const activity = await fetchGithubActivity(parsed.owner, parsed.repo);
        const { error: actError } = await supabase
          .from("agents")
          .update({ github_activity: activity })
          .eq("id", agent.id);
        if (actError) throw new Error(actError.message);
      } catch (actErr) {
        console.warn(`Activity skipped for ${parsed.owner}/${parsed.repo}: ${actErr.message}`);
      }

      updated++;
    } catch (err) {
      console.warn(
        `Skipping agent ${agent.id} (${parsed.owner}/${parsed.repo}): ${err.message}`
      );
      skipped++;
    }

    await sleep(REQUEST_DELAY_MS);
  }

  console.log(
    `GitHub stats update done: ${updated} updated, ${skipped} skipped/failed.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
