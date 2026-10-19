-- ============================================
-- Agraris — Wanted board: permintaan agent/tool dari publik
-- Jalankan ini di Supabase Dashboard → SQL Editor
-- ============================================
--
-- Orang menulis agent/tool yang mereka butuhkan; builder menjawab dengan
-- menerbitkan listing yang ditautkan ke permintaan itu (agents.wanted_id).
-- Tanpa login dan tanpa wallet. Permintaan baru selalu pending dan baru
-- tampil publik setelah disetujui lewat workflow "Wanted queue"
-- (scripts/wanted-action.js), pola yang sama dengan Review queue.
-- Tidak ada akun pemohon dan tidak ada kontak yang disimpan.
--
-- Isi migrasi:
--   1. Tabel public.wanted + constraint + trigger approved_at.
--   2. RLS: publik hanya bisa SELECT permintaan yang approved, belum
--      closed, dan dibuat kurang dari 60 hari lalu. SELECT publik dibatasi
--      ke kolom id, title, description, kind, created_at (approved,
--      closed, approved_at, notified_at tidak terbaca). Tidak ada INSERT /
--      UPDATE / DELETE publik.
--   3. RPC submit_wanted(p_title, p_description, p_kind): satu-satunya
--      jalan publik untuk mengirim permintaan. Validasi panjang, tolak
--      URL / domain, tolak karakter kontrol, maksimal 20 pending.
--   4. agents.wanted_id (FK ke wanted.id, on delete set null) + kebijakan
--      INSERT "Public can submit agents for review" dibuat ulang: semua
--      syarat lama tetap, ditambah wanted_id harus null ATAU menunjuk
--      permintaan yang sedang tampil. update_submission() TIDAK diubah,
--      jadi builder tidak bisa mengubah wanted_id setelah submit (hak
--      UPDATE tabel agents tetap dicabut dari anon/authenticated).
--   5. RPC get_wanted(p_limit): permintaan yang tampil + answers_count
--      (jumlah listing approved yang tertaut). Maks 50 baris.
--
-- TIDAK disentuh: kebijakan SELECT agents, update_submission(),
-- get_submission_status(), get_submission_editable(), agent_edits,
-- trigger agents yang sudah ada.
--
-- Prasyarat: semua migrasi agents sebelumnya, termasuk
-- migration-listing-kind.sql dan migration-live-check.sql (kebijakan
-- INSERT di bawah memuat syarat keduanya). Langkah 0 memeriksanya.
--
-- Idempoten: aman dijalankan lebih dari sekali. Tidak ada data yang
-- ditulis.
--
-- Urutan deploy: jalankan migrasi ini DULU, baru merge kode (workflow
-- "Wanted queue" dan notifikasi wanted membaca tabel baru ini).

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
    'id', 'name', 'description', 'version', 'repo_url', 'approved',
    'verified', 'notified_at', 'approved_at', 'kind',
    'live_status', 'live_checked_at', 'live_fail_count'
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
-- 1. Tabel wanted
-- ---------------------------------------------
create table if not exists public.wanted (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  description text not null,
  kind        text not null default 'any',
  created_at  timestamptz not null default now(),
  approved    boolean not null default false,
  approved_at timestamptz,
  closed      boolean not null default false,
  -- Diisi scripts/review-notify.js setelah email ke pemilik terkirim.
  notified_at timestamptz
);

-- Constraint dibuat sekali saja (dicek lewat katalog), sama seperti
-- agents_kind_check di migration-listing-kind.sql. Batas yang sama juga
-- dicek submit_wanted() dengan pesan yang lebih jelas.
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.wanted'::regclass and conname = 'wanted_title_length') then
    alter table public.wanted add constraint wanted_title_length
      check (char_length(title) between 1 and 100);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.wanted'::regclass and conname = 'wanted_description_length') then
    alter table public.wanted add constraint wanted_description_length
      check (char_length(description) between 1 and 500);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.wanted'::regclass and conname = 'wanted_kind_check') then
    alter table public.wanted add constraint wanted_kind_check
      check (kind in ('agent', 'tool', 'any'));
  end if;
end
$$;

-- Permintaan yang tampil publik (dipakai SELECT publik dan get_wanted).
create index if not exists wanted_visible_idx
  on public.wanted (created_at desc)
  where approved = true and closed = false;

-- Antrean pending yang belum diberi tahu (review-notify.js).
create index if not exists wanted_pending_unnotified_idx
  on public.wanted (created_at)
  where approved = false and notified_at is null;

-- approved_at: logika sama dengan agents_set_approved_at()
-- (migration-review-notify.sql), fungsi terpisah supaya kedua tabel tidak
-- saling bergantung.
create or replace function public.wanted_set_approved_at()
returns trigger
language plpgsql
set search_path = ''
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

revoke all on function public.wanted_set_approved_at() from public;

drop trigger if exists wanted_set_approved_at on public.wanted;
create trigger wanted_set_approved_at
  before insert or update on public.wanted
  for each row
  execute function public.wanted_set_approved_at();

-- ---------------------------------------------
-- 2. RLS dan hak akses
-- ---------------------------------------------
alter table public.wanted enable row level security;

drop policy if exists "Public can read open wanted requests" on public.wanted;
create policy "Public can read open wanted requests"
  on public.wanted
  for select
  to anon, authenticated
  using (
    approved = true
    and closed = false
    and created_at > now() - interval '60 days'
  );

-- Tidak ada policy INSERT/UPDATE/DELETE. Sebagai lapis kedua, hak
-- tabelnya dicabut, lalu SELECT diberikan hanya untuk kolom publik.
-- service_role (GitHub Actions, Dashboard) tidak terpengaruh.
revoke all on table public.wanted from anon, authenticated;
grant select (id, title, description, kind, created_at)
  on public.wanted to anon, authenticated;

-- ---------------------------------------------
-- 3. RPC: kirim permintaan
-- ---------------------------------------------
-- Aturan teks (title dan description):
--   - spasi di awal/akhir dibuang; title 1–100 karakter, description
--     1–500 karakter;
--   - karakter kontrol ditolak. Pengecualian: baris baru (\n) di
--     description, karena form memakai textarea (\r\n dijadikan \n);
--   - karakter tak terlihat / pembalik arah teks (zero-width, bidi, BOM)
--     ditolak, sama seperti review-lib.js;
--   - URL dan domain ditolak: "://", "http:", "https:", "www.", alamat IP,
--     dan kata berbentuk nama.domain dengan akhiran domain umum (.com,
--     .io, .xyz, .ai, ...). Akhiran yang juga lazim di nama teknologi
--     (Node.js, web3.py) tidak ada di daftar, jadi tetap boleh.
-- kind: 'agent' | 'tool' | 'any' (kosong / null → 'any').
-- Maksimal 20 permintaan pending sekaligus (seluruh situs, karena tidak
-- ada akun). Di atas itu: error yang jelas, coba lagi nanti.
-- Error validasi memakai SQLSTATE 22023 (sama dengan update_submission),
-- jadi situs boleh menampilkan pesannya apa adanya.
drop function if exists public.submit_wanted(text, text, text);

create function public.submit_wanted(
  p_title       text,
  p_description text,
  p_kind        text default 'any'
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_title       text := btrim(coalesce(p_title, ''));
  v_description text := btrim(replace(coalesce(p_description, ''), E'\r\n', E'\n'));
  v_kind        text := lower(btrim(coalesce(p_kind, '')));
  v_pending     integer;
  -- Karakter kontrol C0/DEL/C1 kecuali \n (dicek terpisah untuk title).
  c_control     constant text := '[\x01-\x09\x0b-\x1f\x7f-\x9f]';
  c_invisible   constant text := '[​-‏‪-‮⁠-⁩﻿]';
  c_url         constant text :=
    '(://|https?:|www\.|[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}'
    || '|[a-z0-9-]\.(com|net|org|io|xyz|ai|app|dev|co|me|gg|so|sh|ly|to|tv|cc|info|biz|link|site|online|tech|top|club|fun|live|store|shop|blog|page|cloud|network|finance|exchange|money|trade|market|win|vip|pro|id|uk|us|ru|cn|de|fr|jp|kr|in|br|eu|tk|ml|ga|cf|gq)([^a-z0-9-]|$))';
begin
  if v_kind = '' then
    v_kind := 'any';
  end if;
  if v_kind not in ('agent', 'tool', 'any') then
    raise exception 'Type must be agent, tool or any.' using errcode = '22023';
  end if;

  if char_length(v_title) = 0 or char_length(v_title) > 100 then
    raise exception 'Title is required and must be at most 100 characters.' using errcode = '22023';
  end if;
  if char_length(v_description) = 0 or char_length(v_description) > 500 then
    raise exception 'Description is required and must be at most 500 characters.' using errcode = '22023';
  end if;

  if v_title ~ '[\x01-\x1f\x7f-\x9f]' or v_description ~ c_control
     or v_title ~ c_invisible or v_description ~ c_invisible then
    raise exception 'Title and description cannot contain control or invisible characters.' using errcode = '22023';
  end if;

  if v_title ~* c_url or v_description ~* c_url then
    raise exception 'Please leave out links and web addresses. Describe what you need in words.' using errcode = '22023';
  end if;

  -- Hitung dan insert dalam satu kunci, supaya dua kiriman bersamaan
  -- tidak bisa sama-sama lolos di batas 20.
  perform pg_advisory_xact_lock(hashtext('public.submit_wanted'));

  select count(*) into v_pending from public.wanted w where w.approved = false;
  if v_pending >= 20 then
    raise exception 'Too many requests are waiting for review right now. Please try again later.' using errcode = '22023';
  end if;

  insert into public.wanted (title, description, kind)
  values (v_title, v_description, v_kind);
end
$$;

revoke all on function public.submit_wanted(text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.submit_wanted(text, text, text)
  to anon, authenticated;

-- ---------------------------------------------
-- 4. agents.wanted_id + kebijakan INSERT
-- ---------------------------------------------
alter table public.agents
  add column if not exists wanted_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.agents'::regclass
      and conname  = 'agents_wanted_id_fkey'
  ) then
    alter table public.agents
      add constraint agents_wanted_id_fkey
      foreign key (wanted_id) references public.wanted (id) on delete set null;
  end if;
end
$$;

create index if not exists agents_wanted_id_idx
  on public.agents (wanted_id)
  where wanted_id is not null;

comment on column public.agents.wanted_id is
  'Permintaan di Wanted board yang dijawab listing ini. Hanya diisi saat submit; tidak bisa diubah lewat update_submission().';

-- Isi sama dengan migration-live-check.sql, ditambah syarat wanted_id.
-- Subquery berjalan sebagai role pengirim (anon), jadi RLS tabel wanted
-- ikut berlaku: hanya permintaan yang sedang tampil (approved, belum
-- closed, < 60 hari) yang bisa dijawab. Pending/closed/kedaluwarsa
-- → insert ditolak.
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
    and (
      wanted_id is null
      or exists (select 1 from public.wanted w where w.id = agents.wanted_id)
    )
    and char_length(name) > 0
    and char_length(name) <= 120
    and char_length(description) > 0
    and char_length(description) <= 600
    and char_length(version) > 0
    and char_length(repo_url) > 0
  );

-- Hak UPDATE agents tetap dicabut (lapis kedua, sama seperti
-- migration-review-queue.sql): wanted_id tidak bisa diubah publik.
revoke update on public.agents from anon, authenticated;

-- ---------------------------------------------
-- 5. RPC: permintaan yang tampil
-- ---------------------------------------------
-- Aturan tampil sama dengan policy SELECT di atas. answers_count hanya
-- menghitung listing approved. Urut terbaru dulu; p_limit dibatasi
-- 0..50 (null → 50).
drop function if exists public.get_wanted(integer);

create function public.get_wanted(p_limit integer default 50)
returns table (
  id            uuid,
  title         text,
  description   text,
  kind          text,
  created_at    timestamptz,
  answers_count integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    w.id,
    w.title,
    w.description,
    w.kind,
    w.created_at,
    (
      select count(*)::integer
      from public.agents a
      where a.wanted_id = w.id
        and a.approved = true
    ) as answers_count
  from public.wanted w
  where w.approved = true
    and w.closed = false
    and w.created_at > now() - interval '60 days'
  order by w.created_at desc, w.id
  limit least(greatest(coalesce(p_limit, 50), 0), 50);
$$;

revoke all on function public.get_wanted(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.get_wanted(integer)
  to anon, authenticated;

commit;

-- ============================================
-- Cek setelah migrasi (opsional, jalankan manual)
-- ============================================
--   select * from public.get_wanted(50);
--   -- → 0 baris sampai ada permintaan yang disetujui
--
--   select policyname, with_check from pg_policies
--   where tablename = 'agents' and cmd = 'INSERT';
--   -- → with_check memuat wanted_id IS NULL OR (EXISTS ...)
