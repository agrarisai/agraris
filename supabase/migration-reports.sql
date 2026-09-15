-- ============================================
-- Agraris — migration untuk tabel `agent_reports`
-- Jalankan ini di Supabase Dashboard → SQL Editor
-- ============================================
--
-- Tabel ini menampung report/flag dari publik untuk agent yang
-- dianggap spam, menyesatkan, atau melanggar hukum (lihat section
-- Terms di index.html). Fitur report ini publik dan tanpa login,
-- jadi kita pakai Supabase anon key langsung dari client — sama
-- seperti form publish.

create table if not exists public.agent_reports (
  id         uuid primary key default gen_random_uuid(),
  agent_id   uuid not null references public.agents (id) on delete cascade,
  reason     text not null
               check (reason in ('spam', 'misleading', 'illegal', 'other')),
  details    text,
  created_at timestamptz not null default now(),
  status     text not null default 'pending'
               check (status in ('pending', 'reviewed', 'dismissed'))
);

-- Index untuk query moderasi nanti (lewat dashboard/service role),
-- misalnya "report terbaru untuk agent X".
create index if not exists agent_reports_agent_id_idx
  on public.agent_reports (agent_id);

create index if not exists agent_reports_created_at_idx
  on public.agent_reports (created_at desc);

-- ---------------------------------------------
-- Row Level Security
-- ---------------------------------------------
-- Siapa saja boleh INSERT (submit report), tapi TIDAK ADA policy
-- select/update/delete untuk anon/public sama sekali — supaya orang
-- tidak bisa lihat siapa yang sudah report atau report apa saja yang
-- masuk lewat client-side. Review dilakukan manual lewat Supabase
-- Table Editor / SQL Editor, yang mengakses tabel lewat privilege
-- berbeda (bypass RLS), bukan lewat anon key.

alter table public.agent_reports enable row level security;

create policy "Public can submit agent reports"
  on public.agent_reports
  for insert
  with check (
    reason in ('spam', 'misleading', 'illegal', 'other')
    and (details is null or char_length(details) <= 1000)
  );

-- Catatan: jangan tambah policy select/update/delete untuk
-- anon/public di tabel ini. Review dan moderasi dilakukan manual
-- lewat Supabase Dashboard (service role selalu bypass RLS).
