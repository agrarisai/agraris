-- ============================================
-- Agraris — migration untuk tabel `agent_suggestions`
-- Jalankan ini di Supabase Dashboard → SQL Editor
-- ============================================
--
-- Tabel ini menampung kandidat agent yang ditemukan otomatis dari
-- GitHub (lihat scripts/fetch-agent-suggestions.js dan
-- .github/workflows/find-agents.yml). Kandidat di sini BUKAN listing
-- publik — harus direview manual dulu sebelum datanya dipindahkan
-- ke tabel `agents`.

create table if not exists public.agent_suggestions (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  description    text,
  repo_url       text not null unique,
  stars          integer,
  category_guess text,
  found_at       timestamptz not null default now(),
  status         text not null default 'pending'
                   check (status in ('pending', 'approved', 'rejected'))
);

create index if not exists agent_suggestions_status_idx
  on public.agent_suggestions (status);

-- ---------------------------------------------
-- Row Level Security
-- ---------------------------------------------
-- Tabel ini HANYA boleh diakses lewat service_role key (dipakai oleh
-- GitHub Actions untuk insert kandidat baru, dan oleh kita sendiri
-- lewat Supabase Table Editor / SQL Editor untuk review manual).
-- RLS diaktifkan tapi SENGAJA tidak ada satupun policy untuk role
-- anon/authenticated, jadi tabel ini tidak bisa dibaca atau ditulis
-- sama sekali dari situs publik (anon key). service_role key selalu
-- bypass RLS, jadi GitHub Actions tetap bisa insert tanpa policy.

alter table public.agent_suggestions enable row level security;

-- Catatan: jangan tambah policy select/insert/update/delete untuk
-- anon/public di tabel ini. Review dan pemindahan data ke tabel
-- `agents` dilakukan manual lewat Supabase Dashboard.
