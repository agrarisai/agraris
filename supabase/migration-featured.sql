-- ============================================
-- Agraris — "Agent of the week" (tabel featured_agents)
-- Jalankan ini di Supabase Dashboard → SQL Editor
-- ============================================
--
-- Satu agent yang disorot per minggu, dipilih manual oleh pemilik lewat
-- workflow "Feature agent" (scripts/feature-agent.js, service role).
--
-- - Publik (anon/authenticated) hanya bisa MEMBACA tabel ini. Tidak ada
--   policy INSERT/UPDATE/DELETE, dan hak tulis dicabut dari role publik,
--   jadi penulisan hanya lewat service role.
-- - Kebijakan tabel agents TIDAK diubah. Situs membaca pilihan dengan
--   embed agents!inner(...) memakai anon key, jadi RLS agents tetap
--   berlaku: agent yang tidak approved tidak pernah ikut terbaca, dan
--   baris featured yang menunjuk ke agent seperti itu ikut tersaring.
-- - week_start selalu hari Senin (ISO week, UTC), unik per minggu.
--
-- Prasyarat: migration.sql dan migration-review-queue.sql (kolom
-- approved) sudah dijalankan. Langkah 0 memeriksanya.
--
-- Idempoten: aman dijalankan lebih dari sekali.

begin;

-- ---------------------------------------------
-- 0. Cek prasyarat
-- ---------------------------------------------
do $$
declare
  missing text;
begin
  select string_agg(c, ', ')
  into missing
  from unnest(array[
    'id', 'name', 'description', 'version', 'category', 'created_at',
    'contract_address', 'approved'
  ]) as c
  where not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'agents'
      and column_name  = c
  );

  if missing is not null then
    raise exception 'Kolom berikut belum ada di public.agents: %. Jalankan migrasi prasyaratnya dulu.', missing;
  end if;
end
$$;

-- ---------------------------------------------
-- 1. Tabel
-- ---------------------------------------------
create table if not exists public.featured_agents (
  id          uuid primary key default gen_random_uuid(),
  agent_id    uuid not null references public.agents(id) on delete cascade,
  week_start  date not null unique,
  note        text,
  created_at  timestamptz default now(),
  constraint featured_agents_note_length
    check (note is null or char_length(note) <= 280),
  constraint featured_agents_week_start_monday
    check (extract(isodow from week_start) = 1)
);

-- Untuk mencari pilihan sebuah agent (dan untuk on delete cascade).
create index if not exists featured_agents_agent_id_idx
  on public.featured_agents (agent_id);

-- ---------------------------------------------
-- 2. RLS: baca saja untuk publik
-- ---------------------------------------------
alter table public.featured_agents enable row level security;

drop policy if exists "Public can read featured agents" on public.featured_agents;
create policy "Public can read featured agents"
  on public.featured_agents
  for select
  to anon, authenticated
  using (true);

-- Tidak ada policy INSERT / UPDATE / DELETE. Lapis kedua: cabut hak
-- tulis dari role publik (Supabase memberinya secara default untuk
-- tabel baru). service_role tidak terpengaruh.
revoke insert, update, delete, truncate on public.featured_agents from anon, authenticated;
grant select on public.featured_agents to anon, authenticated;

commit;

-- ============================================
-- Cek setelah migrasi (opsional, jalankan manual)
-- ============================================
-- Pilihan per minggu, terbaru dulu:
--   select f.week_start, a.name, a.approved, f.note
--   from public.featured_agents f
--   join public.agents a on a.id = f.agent_id
--   order by f.week_start desc;
