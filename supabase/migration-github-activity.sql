-- ============================================
-- Agraris — aktivitas GitHub per listing
-- Jalankan ini di Supabase Dashboard → SQL Editor SEBELUM merge PR.
-- ============================================
--
-- github_activity diisi oleh workflow harian "Generate feeds"
-- (scripts/update-github-stats.js), bukan oleh browser. Bentuk isinya:
--   { "c7": 14, "d": [0,2,3,1,4,2,2], "last": "2026-10-29T03:12:54Z" }
--   c7   = jumlah commit 7 hari terakhir di branch default
--   d    = commit per hari, 7 angka, hari tertua dulu, hari ini terakhir (UTC)
--   last = waktu commit terakhir (bila ada di 7 hari itu)
-- null = belum diproses; frontend menyembunyikan lencana, bukan menampilkan 0.
--
-- Tabel agents tidak punya policy UPDATE untuk anon, jadi kolom ini hanya
-- bisa diubah lewat service role di GitHub Actions. Aktivitas kode saja,
-- bukan bukti pemakaian dan bukan endorsement.

alter table public.agents
  add column if not exists github_activity jsonb default null;
