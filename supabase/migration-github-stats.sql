-- ============================================
-- Agraris — migration untuk kolom GitHub stats di tabel `agents`
-- Jalankan ini di Supabase Dashboard → SQL Editor
-- ============================================
--
-- github_stars dan github_updated_at diisi oleh workflow GitHub
-- Actions harian (lihat scripts/update-github-stats.js), BUKAN oleh
-- browser client. Browser tinggal membaca kedua kolom ini bersama
-- data agent lainnya — tidak ada lagi fetch ke GitHub API dari sisi
-- client.
--
-- Nilai null berarti agent tersebut belum sempat diproses oleh
-- workflow (misalnya agent yang baru saja dipublish) — frontend harus
-- menyembunyikan badge stars/last-updated untuk kasus ini, bukan
-- menampilkan 0.

alter table public.agents
  add column if not exists github_stars integer default null,
  add column if not exists github_updated_at timestamptz default null;

-- ---------------------------------------------
-- Row Level Security
-- ---------------------------------------------
-- migration.sql (tabel agents) sudah TIDAK punya policy UPDATE untuk
-- role anon/public sama sekali, jadi kedua kolom ini otomatis tidak
-- bisa diubah lewat client-side — tidak perlu policy tambahan. Satu-
-- satunya cara mengubah nilainya adalah lewat service role key, yang
-- dipakai oleh scripts/update-github-stats.js di GitHub Actions dan
-- selalu bypass RLS.
