// ============================================
// Agraris — cari kandidat agent baru dari GitHub
// ============================================
// Dijalankan oleh .github/workflows/find-agents.yml (cron mingguan +
// manual trigger). Mencari repo publik bertopik/menyebut
// "robinhood-chain" yang juga menyebut "agent" atau "mcp", lalu
// menyimpan kandidat yang lolos filter ke tabel `agent_suggestions`
// di Supabase (service_role key, bukan tabel publik `agents`).
//
// Env vars yang dibutuhkan:
//   SUPABASE_URL              — Project URL Supabase
//   SUPABASE_SERVICE_ROLE_KEY — service_role key (JANGAN dipakai di client-side!)

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variable."
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const GITHUB_SEARCH_QUERY =
  '"robinhood-chain" AND ("agent" OR "mcp") in:name,description,topics';

const BLACKLIST_KEYWORDS = [
  "sniper",
  "bundler",
  "volume-bot",
  "volumebot",
  "pump",
  "honeypot",
  "memecoin sniper",
];

function isBlacklisted(repo) {
  const haystack = `${repo.full_name} ${repo.description ?? ""}`.toLowerCase();
  return BLACKLIST_KEYWORDS.some((keyword) => haystack.includes(keyword));
}

async function searchGithubRepos(query) {
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(
    query
  )}&per_page=100`;

  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "agraris-find-agents-bot",
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(
      `GitHub search API error: ${res.status} ${res.statusText} — ${await res.text()}`
    );
  }
  const data = await res.json();
  return data.items ?? [];
}

async function fetchExistingRepoUrls() {
  const urls = new Set();

  const { data: agents, error: agentsError } = await supabase
    .from("agents")
    .select("repo_url");
  if (agentsError) {
    throw new Error(`Failed to read agents table: ${agentsError.message}`);
  }
  for (const row of agents ?? []) {
    if (row.repo_url) urls.add(row.repo_url);
  }

  const { data: suggestions, error: suggestionsError } = await supabase
    .from("agent_suggestions")
    .select("repo_url");
  if (suggestionsError) {
    throw new Error(
      `Failed to read agent_suggestions table: ${suggestionsError.message}`
    );
  }
  for (const row of suggestions ?? []) {
    if (row.repo_url) urls.add(row.repo_url);
  }

  return urls;
}

async function main() {
  console.log(`Searching GitHub: ${GITHUB_SEARCH_QUERY}`);
  const repos = await searchGithubRepos(GITHUB_SEARCH_QUERY);
  console.log(`Found ${repos.length} candidate(s) from GitHub search.`);

  const existingRepoUrls = await fetchExistingRepoUrls();

  let skippedBlacklist = 0;
  let skippedDuplicate = 0;
  const toInsert = [];

  for (const repo of repos) {
    if (isBlacklisted(repo)) {
      skippedBlacklist += 1;
      continue;
    }
    if (existingRepoUrls.has(repo.html_url)) {
      skippedDuplicate += 1;
      continue;
    }

    toInsert.push({
      name: repo.full_name,
      description: repo.description ?? null,
      repo_url: repo.html_url,
      stars: repo.stargazers_count ?? 0,
    });
    // Avoid inserting the same repo twice within this same run.
    existingRepoUrls.add(repo.html_url);
  }

  let insertedCount = 0;
  if (toInsert.length > 0) {
    const { data, error } = await supabase
      .from("agent_suggestions")
      .insert(toInsert)
      .select("id");
    if (error) {
      throw new Error(`Failed to insert agent_suggestions: ${error.message}`);
    }
    insertedCount = data?.length ?? 0;
  }

  console.log("---");
  console.log(`Candidates found:   ${repos.length}`);
  console.log(`Skipped (blacklist): ${skippedBlacklist}`);
  console.log(`Skipped (duplicate): ${skippedDuplicate}`);
  console.log(`Inserted:            ${insertedCount}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
