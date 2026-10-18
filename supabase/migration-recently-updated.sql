-- ============================================
-- Agraris — "Recently updated": listing yang baru diedit builder-nya
-- Jalankan ini di Supabase Dashboard → SQL Editor
-- ============================================
--
-- Sumber data: tabel privat agent_edits (migration-edit-listing.sql).
-- Satu baris ditulis update_submission() setiap kali builder menyimpan
-- edit yang benar-benar mengubah sesuatu. updated_at di agents TIDAK
-- dipakai, karena ikut berubah saat refresh GitHub stats harian dan live
-- check; github_updated_at juga tidak (itu push ke repo, bukan edit
-- listing).
--
-- Isi migrasi: satu fungsi read-only
--   get_recently_updated(p_limit integer default 5)
--   → (id uuid, name text, kind text, last_edited_at timestamptz)
--
-- Privasi: agent_edits tetap privat (RLS tanpa policy, grant dicabut).
-- Fungsi ini SECURITY DEFINER dan hanya mengembalikan empat kolom di atas.
-- Tidak pernah keluar: changed_fields, previous (nilai lama), notified_at,
-- id baris log, status_token / hash-nya, atau kolom agents lain.
--
-- Aturan:
--   - hanya listing approved = true;
--   - hanya edit dalam 30 hari terakhir;
--   - hanya edit SETELAH listing tampil publik
--     (edited_at >= coalesce(approved_at, created_at)): edit saat masih di
--     antrean review bukan pembaruan yang pernah dilihat publik;
--   - satu listing satu baris, dengan waktu edit terbarunya;
--   - urut terbaru dulu; p_limit dibatasi 0..20 (null → 5).
--
-- Tidak disentuh: tabel agents dan policy-nya, agent_edits dan grant-nya,
-- update_submission(), get_submission_status(), get_submission_editable().
--
-- Prasyarat: migration-edit-listing.sql, migration-review-notify.sql
-- (approved_at) dan migration-listing-kind.sql (kind). Langkah 0
-- memeriksanya.
--
-- Idempoten: aman dijalankan lebih dari sekali. Tidak ada data yang
-- ditulis.
--
-- Urutan deploy: jalankan migrasi ini DULU, baru merge kode. Kalau
-- fungsinya belum ada, situs hanya menyembunyikan bagian "Recently
-- updated" (tidak rusak), tapi fiturnya tidak akan tampil.

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
  from unnest(array['id', 'name', 'kind', 'approved', 'approved_at', 'created_at']) as c
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

  if to_regclass('public.agent_edits') is null then
    raise exception 'Tabel public.agent_edits belum ada. Jalankan migration-edit-listing.sql dulu.';
  end if;
end
$$;

-- ---------------------------------------------
-- 1. Index untuk "edit terbaru"
-- ---------------------------------------------
create index if not exists agent_edits_edited_at_idx
  on public.agent_edits (edited_at desc);

-- ---------------------------------------------
-- 2. Fungsi
-- ---------------------------------------------
-- drop dulu: kalau suatu saat kolom kembaliannya berubah, create or
-- replace akan ditolak Postgres (sama seperti migration-listing-kind.sql).
drop function if exists public.get_recently_updated(integer);

create function public.get_recently_updated(p_limit integer default 5)
returns table (
  id             uuid,
  name           text,
  kind           text,
  last_edited_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    a.id,
    a.name,
    a.kind,
    max(e.edited_at) as last_edited_at
  from public.agent_edits e
  join public.agents a on a.id = e.agent_id
  where a.approved = true
    and e.edited_at >= now() - interval '30 days'
    and e.edited_at >= coalesce(a.approved_at, a.created_at)
  group by a.id, a.name, a.kind
  order by max(e.edited_at) desc, a.id
  limit least(greatest(coalesce(p_limit, 5), 0), 20);
$$;

comment on function public.get_recently_updated(integer) is
  'Listing approved yang diedit builder dalam 30 hari terakhir: id, name, kind, waktu edit terakhir. Maks 20 baris. Tidak mengembalikan isi edit.';

-- ---------------------------------------------
-- 3. Grant: sama seperti migration-edit-listing.sql
-- ---------------------------------------------
-- Fungsi baru mendapat EXECUTE default dari Supabase; semuanya dicabut
-- lalu diberikan lagi hanya ke anon dan authenticated.
revoke all on function public.get_recently_updated(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.get_recently_updated(integer)
  to anon, authenticated;

commit;

-- ============================================
-- Cek setelah migrasi (opsional, jalankan manual)
-- ============================================
--   select * from public.get_recently_updated(20);
--   -- → listing approved yang diedit dalam 30 hari terakhir (bisa 0 baris)
--
--   select pg_get_function_result('public.get_recently_updated(integer)'::regprocedure);
--   -- → TABLE(id uuid, name text, kind text, last_edited_at timestamp with time zone)
