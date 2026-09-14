-- ============================================
-- Agraris — migration untuk tabel `agents`
-- Jalankan ini di Supabase Dashboard → SQL Editor
-- ============================================

create table if not exists public.agents (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text not null,
  version     text not null,
  repo_url    text not null,
  category    text[] not null default '{}',
  demo_url    text,
  created_at  timestamptz not null default now()
);

-- Index untuk sort by terbaru (dipakai di halaman utama)
create index if not exists agents_created_at_idx
  on public.agents (created_at desc);

-- ---------------------------------------------
-- Row Level Security
-- ---------------------------------------------
-- Form publish dibuat TERBUKA tanpa login, jadi kita pakai
-- Supabase anon key langsung dari client. Supaya tetap aman:
--   - siapa saja boleh SELECT (baca listing/search/detail)
--   - siapa saja boleh INSERT (submit agent baru)
--   - TIDAK ADA policy untuk UPDATE / DELETE, jadi data yang
--     sudah masuk tidak bisa diubah/dihapus lewat client-side.

alter table public.agents enable row level security;

create policy "Public can read agents"
  on public.agents
  for select
  using (true);

create policy "Public can publish agents"
  on public.agents
  for insert
  with check (
    char_length(name) > 0
    and char_length(name) <= 120
    and char_length(description) > 0
    and char_length(description) <= 600
    and char_length(version) > 0
    and char_length(repo_url) > 0
  );

-- Catatan: kalau nanti mau moderasi/hapus agent spam, lakukan lewat
-- Supabase Dashboard (service role), bukan lewat client-side app ini.
