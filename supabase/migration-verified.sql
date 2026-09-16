-- ============================================
-- Agraris — migration untuk kolom `verified` di tabel `agents`
-- Jalankan ini di Supabase Dashboard → SQL Editor
-- ============================================
--
-- Verified badge adalah penanda manual (bukan otomatis) yang
-- menunjukkan agent tersebut sudah dicek keasliannya oleh tim
-- Agraris. Kolom ini defaultnya false untuk semua agent, termasuk
-- yang sudah ada.

alter table public.agents
  add column if not exists verified boolean not null default false;

-- ---------------------------------------------
-- Row Level Security
-- ---------------------------------------------
-- migration.sql (tabel agents) sudah TIDAK punya policy UPDATE untuk
-- role anon/public sama sekali, jadi kolom verified ini otomatis
-- tidak bisa diubah lewat client-side — tidak perlu policy tambahan.
-- Satu-satunya cara mengubah status verified adalah lewat Supabase
-- Dashboard (Table Editor / SQL Editor) memakai service role, yang
-- selalu bypass RLS, dilakukan manual oleh admin.
