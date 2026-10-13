-- ============================================
-- Agraris — notifikasi antrean review + kolom approved_at
-- Jalankan ini di Supabase Dashboard → SQL Editor
-- ============================================
--
-- - notified_at: kapan pemilik sudah diberi tahu lewat email tentang
--   submission ini (diisi scripts/review-notify.js lewat service role).
-- - approved_at: kapan agent disetujui. Diisi otomatis oleh trigger,
--   termasuk kalau persetujuan dilakukan manual lewat SQL. Dipakai RSS,
--   sitemap, dan weekly digest sebagai coalesce(approved_at, created_at).
--
-- Prasyarat: migration.sql, migration-verified.sql,
-- migration-github-stats.sql, migration-contract-address.sql,
-- migration-review-queue.sql, dan migration-submission-status.sql sudah
-- dijalankan. Langkah 0 memeriksanya dan membatalkan migrasi kalau ada
-- kolom yang kurang.
--
-- Kebijakan SELECT "Public can read approved agents" TIDAK diubah.
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
    'id', 'name', 'description', 'version', 'repo_url', 'category',
    'demo_url', 'created_at', 'verified', 'github_stars',
    'github_updated_at', 'contract_address', 'approved', 'status_token'
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
-- 1. Kolom baru
-- ---------------------------------------------
alter table public.agents
  add column if not exists notified_at timestamptz;

alter table public.agents
  add column if not exists approved_at timestamptz;

-- ---------------------------------------------
-- 2. Backfill approved_at untuk agent yang sudah disetujui
-- ---------------------------------------------
-- Hanya baris approved yang approved_at-nya masih kosong, jadi aman
-- dijalankan ulang (nilai yang sudah ada tidak ditimpa).
update public.agents
set approved_at = created_at
where approved = true
  and approved_at is null;

-- ---------------------------------------------
-- 3. Trigger approved_at
-- ---------------------------------------------
-- UPDATE: approved false → true  ⇒ approved_at = now()
--         approved → false        ⇒ approved_at = null
--         approved tidak berubah  ⇒ approved_at dibiarkan
-- INSERT: kalau baris langsung masuk dengan approved = true (hanya
--         mungkin lewat service role / Dashboard) dan approved_at
--         kosong ⇒ approved_at = now(). Insert dari publik selalu
--         approved = false, jadi tidak tersentuh.
create or replace function public.agents_set_approved_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.approved = true and new.approved_at is null then
      new.approved_at := now();
    end if;
  elsif new.approved = false then
    new.approved_at := null;
  elsif old.approved = false and new.approved = true then
    new.approved_at := now();
  end if;
  return new;
end
$$;

revoke all on function public.agents_set_approved_at() from public;

drop trigger if exists agents_set_approved_at on public.agents;
create trigger agents_set_approved_at
  before insert or update on public.agents
  for each row
  execute function public.agents_set_approved_at();

-- ---------------------------------------------
-- 4. Kebijakan INSERT (dibuat ulang)
-- ---------------------------------------------
-- Isi sama dengan migration-submission-status.sql, ditambah
-- notified_at is null dan approved_at is null. status_token tetap
-- tidak dibatasi (boleh diisi atau kosong).
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
    and char_length(name) > 0
    and char_length(name) <= 120
    and char_length(description) > 0
    and char_length(description) <= 600
    and char_length(version) > 0
    and char_length(repo_url) > 0
  );

-- ---------------------------------------------
-- 5. Index parsial untuk antrean yang belum diberi tahu
-- ---------------------------------------------
create index if not exists agents_pending_unnotified_idx
  on public.agents (created_at)
  where approved = false and notified_at is null;

commit;
