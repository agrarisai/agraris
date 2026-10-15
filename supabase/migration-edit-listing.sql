-- ============================================
-- Agraris — builder bisa mengedit listing lewat token status
-- Jalankan ini di Supabase Dashboard → SQL Editor
-- ============================================
--
-- Builder sudah memegang token status (dibuat publish.js, disimpan di
-- tabel hanya sebagai hash; lihat migration-submission-status.sql).
-- Token yang sama sekarang juga dipakai untuk mengedit sebagian field
-- listing. Tidak ada akun/login baru dan TIDAK ada policy UPDATE di
-- tabel agents: perubahan hanya lewat RPC update_submission() di
-- bawah, yang SECURITY DEFINER dan hanya menyentuh:
--   description, demo_url, contract_address, version, category
-- name, repo_url, verified, approved, status_token, notified_at,
-- approved_at dan created_at tidak pernah diubah oleh RPC ini.
--
-- Isi migrasi:
--   1. Kolom updated_at + trigger yang mengisinya setiap INSERT/UPDATE.
--   2. agents_status_token_hash(): satu-satunya definisi hash token.
--      Ekspresinya dipindahkan apa adanya dari trigger insert yang
--      sudah ada; trigger itu dan get_submission_status() sekarang
--      memanggil fungsi ini, jadi insert dan semua RPC memakai hash
--      yang sama persis.
--   3. Tabel privat agent_edits: log setiap edit (field yang berubah +
--      nilai lamanya). Dibaca scripts/review-notify.js (service role)
--      untuk email ringkasan edit. Tidak bisa dibaca/ditulis publik.
--   4. RPC get_submission_editable(token) untuk mengisi form.
--   5. RPC update_submission(token, ...) untuk menyimpan.
--
-- Token salah / tidak dikenal → kedua RPC mengembalikan 0 baris.
-- Validasi input dijalankan SEBELUM token dicari, jadi pesan error
-- validasi sama persis untuk token yang ada maupun tidak.
-- Tidak ada RPC yang mengembalikan status_token atau hash-nya.
--
-- Prasyarat: semua migrasi sebelumnya, termasuk
-- migration-submission-status.sql dan migration-review-notify.sql.
-- Langkah 0 memeriksanya dan membatalkan migrasi kalau ada yang kurang.
--
-- Idempoten: aman dijalankan lebih dari sekali.
--
-- Urutan deploy: jalankan migrasi ini DULU, baru merge kode. Halaman
-- status dan workflow "Review queue notify" memanggil objek baru ini.

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
    'approved', 'status_token', 'notified_at', 'approved_at'
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

  if to_regprocedure('public.agents_hash_status_token()') is null then
    raise exception 'Fungsi public.agents_hash_status_token() belum ada. Jalankan migration-submission-status.sql dulu.';
  end if;
end
$$;

-- ---------------------------------------------
-- 1. updated_at
-- ---------------------------------------------
-- Diisi trigger pada setiap INSERT dan UPDATE (termasuk update dari
-- service role, mis. refresh GitHub stats harian). Nilai yang dikirim
-- client diabaikan. Baris lama tetap NULL sampai pertama kali diubah.
alter table public.agents
  add column if not exists updated_at timestamptz;

create or replace function public.agents_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

revoke all on function public.agents_set_updated_at() from public;

drop trigger if exists agents_set_updated_at on public.agents;
create trigger agents_set_updated_at
  before insert or update on public.agents
  for each row
  execute function public.agents_set_updated_at();

-- ---------------------------------------------
-- 2. Satu definisi hash token
-- ---------------------------------------------
-- Ekspresi persis dari agents_hash_status_token() di
-- migration-submission-status.sql:
--   32 karakter hex pertama dari SHA-256(token), sebagai uuid.
create or replace function public.agents_status_token_hash(p_token uuid)
returns uuid
language sql
immutable
strict
set search_path = ''
as $$
  select substr(
    encode(sha256(convert_to(p_token::text, 'UTF8')), 'hex'),
    1, 32
  )::uuid;
$$;

-- Trigger insert berjalan sebagai role pemanggil (anon saat publish),
-- jadi role itu butuh EXECUTE pada fungsi ini. Fungsinya hanya SHA-256
-- dari input sendiri (algoritmanya publik di repo ini), tidak membaca
-- tabel apa pun.
revoke all on function public.agents_status_token_hash(uuid) from public;
grant execute on function public.agents_status_token_hash(uuid) to anon, authenticated, service_role;

-- Trigger insert: perilaku sama, sekarang memanggil fungsi di atas.
create or replace function public.agents_hash_status_token()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status_token is not null then
    new.status_token := public.agents_status_token_hash(new.status_token);
  end if;
  return new;
end
$$;

revoke all on function public.agents_hash_status_token() from public;

-- Cek status: signature, hasil, dan grant sama seperti sebelumnya.
--
-- "drop function if exists" (di sini dan di dua fungsi RPC di bawah)
-- supaya file ini tetap bisa dijalankan ulang setelah
-- migration-listing-kind.sql: fungsi-fungsi itu mengembalikan kolom
-- `kind` tambahan, dan Postgres menolak create or replace kalau kolom
-- kembaliannya berbeda. Setelah dijalankan ulang, jalankan
-- migration-listing-kind.sql lagi untuk mengembalikan kolom kind.
drop function if exists public.get_submission_status(uuid);

create or replace function public.get_submission_status(p_token uuid)
returns table (status text, name text, id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select
    case when a.approved then 'approved' else 'pending' end,
    a.name,
    a.id
  from public.agents a
  where p_token is not null
    and a.status_token = public.agents_status_token_hash(p_token)
  limit 1;
$$;

-- Grant diberikan lagi (drop di atas menghapusnya), sama seperti
-- migration-submission-status.sql.
revoke all on function public.get_submission_status(uuid) from public;
grant execute on function public.get_submission_status(uuid) to anon, authenticated;

-- ---------------------------------------------
-- 3. Log edit (privat)
-- ---------------------------------------------
create table if not exists public.agent_edits (
  id             bigint generated always as identity primary key,
  agent_id       uuid not null references public.agents (id) on delete cascade,
  edited_at      timestamptz not null default now(),
  changed_fields text[] not null,
  -- Nilai SEBELUM edit, hanya untuk field yang berubah.
  previous       jsonb not null default '{}'::jsonb,
  -- Diisi scripts/review-notify.js setelah email ringkasan terkirim.
  notified_at    timestamptz
);

-- RLS aktif tanpa policy + grant dicabut: anon/authenticated tidak bisa
-- membaca atau menulis. Hanya fungsi SECURITY DEFINER di bawah dan
-- service role (GitHub Actions) yang memakainya.
alter table public.agent_edits enable row level security;
revoke all on table public.agent_edits from anon, authenticated;

create index if not exists agent_edits_unnotified_idx
  on public.agent_edits (edited_at)
  where notified_at is null;

create index if not exists agent_edits_agent_recent_idx
  on public.agent_edits (agent_id, edited_at desc);

-- ---------------------------------------------
-- 4. RPC: isi form edit
-- ---------------------------------------------
drop function if exists public.get_submission_editable(uuid);

create or replace function public.get_submission_editable(p_token uuid)
returns table (
  description      text,
  demo_url         text,
  contract_address text,
  version          text,
  category         text[],
  name             text,
  status           text
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
    case when a.approved then 'approved' else 'pending' end
  from public.agents a
  where p_token is not null
    and a.status_token = public.agents_status_token_hash(p_token)
  limit 1;
$$;

-- ---------------------------------------------
-- 5. RPC: simpan edit
-- ---------------------------------------------
-- Semua field dikirim lengkap (form mengirim nilai saat ini untuk yang
-- tidak diubah). Batas:
--   description  1–600 karakter (sama dengan policy INSERT)
--   version      1–40 karakter (policy INSERT: > 0; 40 = maxlength form)
--   demo_url     kosong, atau https://… tanpa spasi, maks. 500 karakter
--   contract     kosong, atau ^0x[0-9a-fA-F]{40}$ (sama dengan constraint)
--   category     1–10 tag, tiap tag 1–40 karakter (spasi di tepi dibuang,
--                tag kosong & duplikat dibuang)
-- Error validasi memakai SQLSTATE 22023 (invalid_parameter_value);
-- status.js hanya menampilkan pesan error dengan kode itu.
drop function if exists public.update_submission(uuid, text, text, text, text, text[]);

create or replace function public.update_submission(
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
  updated_at       timestamptz
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
  -- 5a. Validasi (sebelum token dicari).
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

  -- 5b. Cari baris lewat hash token. Tidak ketemu → 0 baris.
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

  -- 5c. Field yang berubah + nilai lamanya.
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

    -- Hanya kolom yang boleh diedit. updated_at diisi trigger.
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
    a.updated_at
  from public.agents a
  where a.id = v_old.id;
end
$$;

-- ---------------------------------------------
-- 6. Grant: hanya anon dan authenticated
-- ---------------------------------------------
-- Supabase memberi EXECUTE ke anon/authenticated/service_role secara
-- default untuk fungsi baru; semuanya dicabut dulu lalu diberikan lagi
-- hanya ke anon dan authenticated.
revoke all on function public.get_submission_editable(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_submission_editable(uuid)
  to anon, authenticated;

revoke all on function public.update_submission(uuid, text, text, text, text, text[])
  from public, anon, authenticated, service_role;
grant execute on function public.update_submission(uuid, text, text, text, text, text[])
  to anon, authenticated;

-- Tidak ada policy UPDATE baru di public.agents, dan hak UPDATE tetap
-- dicabut dari anon/authenticated (migration-review-queue.sql).

commit;

-- ============================================
-- Cek setelah migrasi (opsional, jalankan manual)
-- ============================================
--   select * from public.get_submission_editable('00000000-0000-4000-8000-000000000000');
--   -- → 0 baris (token tidak dikenal)
--
--   select * from public.update_submission(
--     '00000000-0000-4000-8000-000000000000', 'desc', null, null, '1.0', array['test']);
--   -- → 0 baris (token tidak dikenal)
--
--   select * from public.agent_edits order by edited_at desc limit 20;
--   -- → log edit terbaru
