-- ============================================
-- Agraris — live check demo_url (kolom live_status, live_checked_at,
-- live_fail_count)
-- Jalankan ini di Supabase Dashboard → SQL Editor
-- ============================================
--
-- Workflow "Live check" (.github/workflows/live-check.yml,
-- scripts/live-check.js) memeriksa tiap 6 jam apakah demo_url listing yang
-- sudah approved masih merespons, lalu menyimpan hasilnya di sini:
--   live_status      'up' | 'down' | null (belum pernah / belum cukup
--                    dicek). 'down' baru diisi setelah 3 kegagalan
--                    berturut-turut; satu sukses langsung 'up'.
--   live_checked_at  kapan terakhir dicek.
--   live_fail_count  jumlah kegagalan berturut-turut (0 setelah sukses).
-- Isi respons server demo TIDAK disimpan; hanya status dan waktu.
--
-- Hanya service role (GitHub Actions) yang menulis kolom ini:
--   - Tidak ada policy UPDATE untuk publik, dan hak UPDATE sudah dicabut
--     dari anon/authenticated (migration-review-queue.sql). Diulang di
--     bawah sebagai lapis kedua.
--   - Kebijakan INSERT publik dibuat ulang: live_status dan
--     live_checked_at harus null, live_fail_count harus 0.
--   - update_submission() TIDAK diubah dan tidak menyentuh kolom ini.
--   - Satu trigger baru: kalau demo_url berubah (mis. builder mengedit
--     listing), ketiga kolom dikosongkan lagi (null / null / 0), supaya
--     hasil cek URL lama tidak tampil untuk URL baru. Trigger hanya bisa
--     MENGOSONGKAN, tidak pernah mengisi 'up' atau 'down'.
--
-- Kebijakan SELECT "Public can read approved agents" TIDAK diubah: situs
-- membaca kolom ini lewat SELECT yang sama (approved = true saja).
--
-- TIDAK disentuh: get_submission_status, get_submission_editable,
-- update_submission, trigger token/approved_at/updated_at, agent_edits.
--
-- Prasyarat: semua migrasi sebelumnya, termasuk migration-listing-kind.sql.
-- Langkah 0 memeriksanya dan membatalkan migrasi kalau ada yang kurang.
--
-- Idempoten: aman dijalankan lebih dari sekali.
--
-- Urutan deploy: jalankan migrasi ini DULU, baru merge/deploy kode. Situs
-- memilih kolom live_* secara eksplisit dan akan gagal kalau kolomnya
-- belum ada.

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
    'demo_url', 'created_at', 'verified', 'contract_address',
    'approved', 'status_token', 'notified_at', 'approved_at', 'updated_at',
    'kind'
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
  add column if not exists live_status text;

alter table public.agents
  add column if not exists live_checked_at timestamptz;

alter table public.agents
  add column if not exists live_fail_count integer not null default 0;

-- Check dibuat sekali saja (dicek lewat katalog), sama seperti
-- agents_kind_check di migration-listing-kind.sql.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.agents'::regclass
      and conname  = 'agents_live_status_check'
  ) then
    alter table public.agents
      add constraint agents_live_status_check
      check (live_status in ('up', 'down'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.agents'::regclass
      and conname  = 'agents_live_fail_count_check'
  ) then
    alter table public.agents
      add constraint agents_live_fail_count_check
      check (live_fail_count >= 0);
  end if;
end
$$;

comment on column public.agents.live_status is
  'Live check demo_url: up | down | null. Ditulis hanya oleh scripts/live-check.js (service role). Bukan tanda keamanan atau endorsement.';
comment on column public.agents.live_checked_at is
  'Kapan demo_url terakhir dicek oleh scripts/live-check.js.';
comment on column public.agents.live_fail_count is
  'Jumlah kegagalan live check berturut-turut; 3 → live_status = down.';

-- Untuk query live check: listing approved dengan demo, yang paling lama
-- belum dicek lebih dulu.
create index if not exists agents_live_check_queue_idx
  on public.agents (live_checked_at asc nulls first)
  where approved = true and demo_url is not null;

-- ---------------------------------------------
-- 2. Reset saat demo_url berubah
-- ---------------------------------------------
-- Berjalan untuk UPDATE dari siapa pun (update_submission, Dashboard,
-- service role). Hanya mengosongkan, jadi tidak bisa dipakai untuk
-- memasang status 'up'.
create or replace function public.agents_reset_live_check()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.demo_url is distinct from old.demo_url then
    new.live_status := null;
    new.live_checked_at := null;
    new.live_fail_count := 0;
  end if;
  return new;
end
$$;

revoke all on function public.agents_reset_live_check() from public;

drop trigger if exists agents_reset_live_check on public.agents;
create trigger agents_reset_live_check
  before update on public.agents
  for each row
  execute function public.agents_reset_live_check();

-- ---------------------------------------------
-- 3. Kebijakan INSERT (dibuat ulang)
-- ---------------------------------------------
-- Isi sama dengan migration-listing-kind.sql, ditambah tiga syarat live_*.
-- Kalau client tidak mengirim kolom ini, default (null / null / 0) sudah
-- terisi sebelum syarat dicek.
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
    and char_length(name) > 0
    and char_length(name) <= 120
    and char_length(description) > 0
    and char_length(description) <= 600
    and char_length(version) > 0
    and char_length(repo_url) > 0
  );

-- ---------------------------------------------
-- 4. Hak UPDATE (lapis kedua, sama seperti migration-review-queue.sql)
-- ---------------------------------------------
revoke update on public.agents from anon, authenticated;

commit;

-- ============================================
-- Cek setelah migrasi (opsional, jalankan manual)
-- ============================================
--   select live_status, count(*) from public.agents group by live_status;
--   -- → semua null sampai workflow "Live check" pertama kali jalan
--
--   select policyname, with_check from pg_policies
--   where tablename = 'agents' and cmd = 'INSERT';
--   -- → with_check memuat live_status IS NULL dan live_fail_count = 0
