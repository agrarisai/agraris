-- ============================================
-- Agraris: perketat policy INSERT publik di public.agents
-- ============================================
-- Latar belakang: laporan keamanan dari Hey Research Lab (2 Nov 2026).
-- Policy "Public can submit agents for review" (migration-wanted.sql)
-- mengunci approved, verified, notified_at, approved_at, kind, live_* dan
-- wanted_id, tetapi tidak mengunci kolom statistik. Pengirim bisa mengisi
-- github_stars, github_updated_at, github_activity dan created_at sendiri;
-- nilainya tetap kalau refresh GitHub harian melewati barisnya (mis. repo_url
-- bukan github.com). Nilai itu menggerakkan Trending, Most active, daftar
-- terbaru, weekly digest dan lencana README. repo_url / demo_url juga
-- menerima skema apa pun, termasuk javascript:.
--
-- Perubahan (semua pada policy INSERT; isi lain sama dengan
-- migration-wanted.sql):
--   * github_stars, github_updated_at, github_activity harus null saat kirim
--     (hanya workflow yang mengisinya, lewat service role).
--   * created_at harus dekat sekarang (default now()); toleransi 10 menit.
--   * repo_url wajib https://..., demo_url kosong atau https://...
--     (aturan sama dengan update_submission()).
--
-- Aman dijalankan berulang. Hanya mengubah policy INSERT; tidak mengubah
-- data. Cek manual sebelum/sesudah (hasil yang diharapkan: 0 baris):
--   select id, name, repo_url, demo_url from public.agents
--   where repo_url !~* '^https://' or (demo_url is not null and demo_url !~* '^https://');
--   select id, name from public.agents
--   where approved = false and (github_stars is not null or github_activity is not null
--     or github_updated_at is not null or created_at > now() + interval '1 hour');
-- ============================================

drop policy if exists "Public can submit agents for review" on public.agents;
create policy "Public can submit agents for review"
  on public.agents
  for insert
  to anon, authenticated
  with check (
    approved = false
    and verified = false
    and notified_at is null
    and approved_at is null
    and kind in ('agent', 'tool')
    and live_status is null
    and live_checked_at is null
    and live_fail_count = 0
    and github_stars is null
    and github_updated_at is null
    and github_activity is null
    and created_at between now() - interval '10 minutes' and now() + interval '10 minutes'
    and (
      wanted_id is null
      or exists (select 1 from public.wanted w where w.id = agents.wanted_id)
    )
    and char_length(name) > 0
    and char_length(name) <= 120
    and char_length(description) > 0
    and char_length(description) <= 600
    and char_length(version) > 0
    and repo_url ~* '^https://[^/?#[:space:]]+[^[:space:]]*$'
    and char_length(repo_url) <= 500
    and (demo_url is null or (demo_url ~* '^https://[^/?#[:space:]]+[^[:space:]]*$' and char_length(demo_url) <= 500))
  );
