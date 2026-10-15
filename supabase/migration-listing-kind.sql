-- ============================================
-- Agraris — jenis listing: agent atau tool (kolom `kind`)
-- Jalankan ini di Supabase Dashboard → SQL Editor
-- ============================================
--
-- Registry sekarang memuat dua jenis listing di tabel yang sama:
--   'agent' — AI agent (semua listing yang sudah ada)
--   'tool'  — tool / MCP server / API / SDK / skill / dataset / library
-- Tidak ada tabel atau sistem baru: form publish, antrean review, halaman
-- status, dan edit listing memakai tabel `agents` yang sama.
--
-- Isi migrasi:
--   1. Kolom kind text not null default 'agent' + check (agent | tool).
--      Semua baris lama otomatis 'agent'. Insert dari kode lama yang tidak
--      mengirim `kind` juga tetap jadi 'agent'.
--   2. Kebijakan INSERT dibuat ulang: kind boleh 'agent' atau 'tool'.
--      Semua syarat lama tetap (approved = false, verified = false,
--      notified_at is null, approved_at is null, batas panjang).
--   3. get_submission_status, get_submission_editable, dan
--      update_submission sekarang ikut mengembalikan `kind`.
--      update_submission TIDAK menerima kind dan TIDAK mengubahnya: jenis
--      listing ditentukan saat submit dan hanya admin (service role) yang
--      bisa mengubahnya.
--
-- TIDAK disentuh: agents_status_token_hash(), agents_hash_status_token()
-- dan triggernya, trigger approved_at, tabel agent_edits, kebijakan SELECT
-- "Public can read approved agents", dan pencabutan hak UPDATE.
--
-- Catatan RPC: menambah kolom ke RETURNS TABLE mengubah tipe kembalian,
-- dan Postgres menolak "create or replace" untuk itu. Karena itu ketiga
-- fungsi di-drop lalu dibuat ulang, dan grant-nya diberikan lagi persis
-- seperti di migration-submission-status.sql / migration-edit-listing.sql.
-- Kedua file itu sudah diberi "drop function if exists" supaya tetap bisa
-- dijalankan ulang setelah file ini.
--
-- Catatan API publik: /rest/v1/agents sekarang juga mengembalikan baris
-- kind = 'tool' (kalau sudah approved). Konsumen yang hanya mau agent
-- memakai ?kind=eq.agent. Lihat docs.html.
--
-- Prasyarat: semua migrasi sebelumnya, termasuk migration-edit-listing.sql.
-- Langkah 0 memeriksanya dan membatalkan migrasi kalau ada yang kurang.
--
-- Idempoten: aman dijalankan lebih dari sekali.
--
-- Urutan deploy: jalankan migrasi ini DULU, baru merge/deploy kode.
-- Situs dan skrip Actions memilih kolom `kind` secara eksplisit dan akan
-- gagal kalau kolomnya belum ada.

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
    'approved', 'status_token', 'notified_at', 'approved_at', 'updated_at'
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

  if to_regprocedure('public.agents_status_token_hash(uuid)') is null
     or to_regprocedure('public.get_submission_status(uuid)') is null
     or to_regprocedure('public.get_submission_editable(uuid)') is null
     or to_regprocedure('public.update_submission(uuid, text, text, text, text, text[])') is null
  then
    raise exception 'Fungsi status/edit listing belum ada. Jalankan migration-submission-status.sql dan migration-edit-listing.sql dulu.';
  end if;
end
$$;

-- ---------------------------------------------
-- 1. Kolom kind
-- ---------------------------------------------
-- not null + default 'agent': baris yang sudah ada langsung 'agent'
-- (Postgres mengisi default tanpa menulis ulang tabel).
alter table public.agents
  add column if not exists kind text not null default 'agent';

-- Check dibuat sekali saja (dicek lewat katalog), jadi menjalankan ulang
-- file ini tidak memvalidasi ulang seluruh tabel.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.agents'::regclass
      and conname  = 'agents_kind_check'
  ) then
    alter table public.agents
      add constraint agents_kind_check
      check (kind in ('agent', 'tool'));
  end if;
end
$$;

comment on column public.agents.kind is
  'Jenis listing: agent (default) atau tool. Diisi saat submit, tidak bisa diubah lewat update_submission().';

-- ---------------------------------------------
-- 2. Kebijakan INSERT (dibuat ulang)
-- ---------------------------------------------
-- Isi sama dengan migration-review-notify.sql, ditambah kind. status_token
-- tetap tidak dibatasi (boleh diisi atau kosong). Kalau client tidak
-- mengirim kind, default 'agent' sudah terisi sebelum syarat ini dicek.
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
    and char_length(name) > 0
    and char_length(name) <= 120
    and char_length(description) > 0
    and char_length(description) <= 600
    and char_length(version) > 0
    and char_length(repo_url) > 0
  );

-- Kebijakan SELECT "Public can read approved agents" TIDAK diubah, dan
-- tidak ada policy UPDATE/DELETE untuk publik (hak UPDATE tetap dicabut
-- dari anon/authenticated, lihat migration-review-queue.sql).

-- ---------------------------------------------
-- 3a. RPC: cek status
-- ---------------------------------------------
-- Sama seperti sebelumnya, plus kind. Token tidak cocok / NULL → 0 baris.
drop function if exists public.get_submission_status(uuid);

create function public.get_submission_status(p_token uuid)
returns table (status text, name text, id uuid, kind text)
language sql
stable
security definer
set search_path = public
as $$
  select
    case when a.approved then 'approved' else 'pending' end,
    a.name,
    a.id,
    a.kind
  from public.agents a
  where p_token is not null
    and a.status_token = public.agents_status_token_hash(p_token)
  limit 1;
$$;

revoke all on function public.get_submission_status(uuid) from public;
grant execute on function public.get_submission_status(uuid) to anon, authenticated;

-- ---------------------------------------------
-- 3b. RPC: isi form edit
-- ---------------------------------------------
drop function if exists public.get_submission_editable(uuid);

create function public.get_submission_editable(p_token uuid)
returns table (
  description      text,
  demo_url         text,
  contract_address text,
  version          text,
  category         text[],
  name             text,
  status           text,
  kind             text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    a.description,
    a.demo_url,
    a.contract_address,
    a.version,
    a.category,
    a.name,
    case when a.approved then 'approved' else 'pending' end,
    a.kind
  from public.agents a
  where p_token is not null
    and a.status_token = public.agents_status_token_hash(p_token)
  limit 1;
$$;

-- ---------------------------------------------
-- 3c. RPC: simpan edit
-- ---------------------------------------------
-- Isi fungsi sama persis dengan migration-edit-listing.sql. Satu-satunya
-- perbedaan: kolom `kind` ikut dikembalikan di akhir hasil. Tidak ada
-- parameter kind, dan UPDATE di bawah hanya menyentuh lima kolom yang
-- boleh diedit, jadi kind tidak pernah berubah lewat fungsi ini.
drop function if exists public.update_submission(uuid, text, text, text, text, text[]);

create function public.update_submission(
  p_token            uuid,
  p_description      text,
  p_demo_url         text,
  p_contract_address text,
  p_version          text,
  p_category         text[]
)
returns table (
  description      text,
  demo_url         text,
  contract_address text,
  version          text,
  category         text[],
  name             text,
  status           text,
  updated_at       timestamptz,
  kind             text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_description text := btrim(coalesce(p_description, ''));
  v_version     text := btrim(coalesce(p_version, ''));
  v_demo        text := nullif(btrim(coalesce(p_demo_url, '')), '');
  v_contract    text := nullif(btrim(coalesce(p_contract_address, '')), '');
  v_category    text[];
  v_old         public.agents%rowtype;
  v_changed     text[] := '{}';
  v_previous    jsonb := '{}'::jsonb;
begin
  -- Validasi (sebelum token dicari).
  if char_length(v_description) = 0 or char_length(v_description) > 600 then
    raise exception 'Description is required and must be at most 600 characters.'
      using errcode = '22023';
  end if;

  if char_length(v_version) = 0 or char_length(v_version) > 40 then
    raise exception 'Version is required and must be at most 40 characters.'
      using errcode = '22023';
  end if;

  if v_demo is not null and (
       char_length(v_demo) > 500
       or v_demo !~* '^https://[^/?#[:space:]]+'
       or v_demo ~ '[[:space:][:cntrl:]]'
     ) then
    raise exception 'Demo link must start with https://, contain no spaces, and be at most 500 characters. Leave it empty to remove it.'
      using errcode = '22023';
  end if;

  if v_contract is not null and v_contract !~ '^0x[0-9a-fA-F]{40}$' then
    raise exception 'Contract address must be 0x followed by 40 hex characters (0-9, a-f). Leave it empty to remove it.'
      using errcode = '22023';
  end if;

  select coalesce(array_agg(t.tag order by t.first_pos), '{}')
  into v_category
  from (
    select btrim(u.raw) as tag, min(u.pos) as first_pos
    from unnest(coalesce(p_category, '{}'::text[])) with ordinality as u(raw, pos)
    where btrim(u.raw) <> ''
    group by btrim(u.raw)
  ) t;

  if cardinality(v_category) = 0 then
    raise exception 'Add at least one category.' using errcode = '22023';
  end if;

  if cardinality(v_category) > 10 then
    raise exception 'Use at most 10 categories.' using errcode = '22023';
  end if;

  if exists (select 1 from unnest(v_category) as c(tag) where char_length(c.tag) > 40) then
    raise exception 'Each category must be at most 40 characters.' using errcode = '22023';
  end if;

  -- Cari baris lewat hash token. Tidak ketemu → 0 baris.
  if p_token is null then
    return;
  end if;

  select a.*
  into v_old
  from public.agents a
  where a.status_token = public.agents_status_token_hash(p_token)
  for update;

  if not found then
    return;
  end if;

  -- Field yang berubah + nilai lamanya.
  if v_old.description is distinct from v_description then
    v_changed := v_changed || 'description'::text;
    v_previous := v_previous || jsonb_build_object('description', v_old.description);
  end if;
  if v_old.demo_url is distinct from v_demo then
    v_changed := v_changed || 'demo_url'::text;
    v_previous := v_previous || jsonb_build_object('demo_url', v_old.demo_url);
  end if;
  if v_old.contract_address is distinct from v_contract then
    v_changed := v_changed || 'contract_address'::text;
    v_previous := v_previous || jsonb_build_object('contract_address', v_old.contract_address);
  end if;
  if v_old.version is distinct from v_version then
    v_changed := v_changed || 'version'::text;
    v_previous := v_previous || jsonb_build_object('version', v_old.version);
  end if;
  if v_old.category is distinct from v_category then
    v_changed := v_changed || 'category'::text;
    v_previous := v_previous || jsonb_build_object('category', to_jsonb(v_old.category));
  end if;

  if cardinality(v_changed) > 0 then
    -- Rem sederhana terhadap spam edit (dan spam email ringkasan).
    if (
      select count(*)
      from public.agent_edits e
      where e.agent_id = v_old.id
        and e.edited_at > now() - interval '1 hour'
    ) >= 20 then
      raise exception 'Too many edits to this listing in the last hour. Please try again later.'
        using errcode = '22023';
    end if;

    -- Hanya kolom yang boleh diedit. kind TIDAK ada di daftar ini.
    -- updated_at diisi trigger.
    update public.agents a
    set description      = v_description,
        demo_url         = v_demo,
        contract_address = v_contract,
        version          = v_version,
        category         = v_category
    where a.id = v_old.id;

    insert into public.agent_edits (agent_id, changed_fields, previous)
    values (v_old.id, v_changed, v_previous);
  end if;

  return query
  select
    a.description,
    a.demo_url,
    a.contract_address,
    a.version,
    a.category,
    a.name,
    case when a.approved then 'approved' else 'pending' end,
    a.updated_at,
    a.kind
  from public.agents a
  where a.id = v_old.id;
end
$$;

-- ---------------------------------------------
-- 3d. Grant: sama seperti migration-edit-listing.sql
-- ---------------------------------------------
-- Fungsi yang baru dibuat mendapat EXECUTE default dari Supabase; semuanya
-- dicabut lalu diberikan lagi hanya ke anon dan authenticated.
revoke all on function public.get_submission_editable(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_submission_editable(uuid)
  to anon, authenticated;

revoke all on function public.update_submission(uuid, text, text, text, text, text[])
  from public, anon, authenticated, service_role;
grant execute on function public.update_submission(uuid, text, text, text, text, text[])
  to anon, authenticated;

commit;

-- ============================================
-- Cek setelah migrasi (opsional, jalankan manual)
-- ============================================
--   select kind, count(*) from public.agents group by kind;
--   -- → semua listing lama 'agent'; 'tool' = 0 sampai ada yang disetujui
--
--   select * from public.get_submission_status('00000000-0000-4000-8000-000000000000');
--   -- → 0 baris (token tidak dikenal)
--
--   select policyname, with_check from pg_policies
--   where tablename = 'agents' and cmd = 'INSERT';
--   -- → with_check memuat kind = ANY (ARRAY['agent', 'tool'])
