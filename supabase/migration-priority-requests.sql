-- ============================================
-- Agraris — migration untuk tabel `priority_requests`
-- Jalankan ini di Supabase Dashboard → SQL Editor
-- ============================================
--
-- Tabel ini menampung permintaan "Priority review for $AGRARIS
-- holders" dari form di token.html#priority. Saldo wallet dicek
-- MANUAL lewat block explorer — tidak ada integrasi on-chain dan
-- tidak ada koneksi wallet. Form ini publik dan tanpa login, jadi
-- client memakai Supabase anon key — sama seperti form report.
--
-- Wallet address dan handle X bersifat privat: tabel ini tidak
-- boleh bisa dibaca dari sisi publik, dan tidak dipakai di API
-- docs, RSS, maupun sitemap. Tabel agents tidak diubah.

create table if not exists public.priority_requests (
  id             uuid primary key default gen_random_uuid(),
  agent_id       uuid not null references public.agents (id) on delete cascade,
  wallet_address text not null
                   check (wallet_address ~ '^0x[a-fA-F0-9]{40}$'),
  x_handle       text not null
                   check (x_handle ~ '^[A-Za-z0-9_]{1,15}$'),
  created_at     timestamptz not null default now(),
  -- Nilai lain yang dipakai saat review manual: 'approved', 'rejected'.
  status         text not null default 'pending'
                   check (status in ('pending', 'approved', 'rejected')),
  constraint priority_requests_agent_wallet_key unique (agent_id, wallet_address)
);

create index if not exists priority_requests_created_at_idx
  on public.priority_requests (created_at desc);

-- ---------------------------------------------
-- Row Level Security
-- ---------------------------------------------
-- Siapa saja boleh INSERT (submit request), tapi TIDAK ADA policy
-- select/update/delete untuk anon/public sama sekali — wallet dan
-- handle X tidak bisa dibaca lewat client-side. Review dilakukan
-- manual lewat Supabase Table Editor / SQL Editor (service role
-- selalu bypass RLS).
--
-- Karena tidak ada policy select, client TIDAK BOLEH memanggil
-- .select() setelah .insert() — query itu akan gagal.

alter table public.priority_requests enable row level security;

create policy "Public can submit priority requests"
  on public.priority_requests
  for insert
  with check (status = 'pending');

-- Catatan: jangan tambah policy select/update/delete untuk
-- anon/public di tabel ini.
