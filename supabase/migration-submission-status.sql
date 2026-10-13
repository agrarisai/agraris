-- ============================================
-- Agraris — status submission untuk builder (kolom `status_token`)
-- Jalankan ini di Supabase Dashboard → SQL Editor
-- ============================================
--
-- Builder bisa mengecek apakah agent yang dikirim lewat form publish
-- masih menunggu review atau sudah disetujui, TANPA melonggarkan
-- kebijakan SELECT: baris pending tetap tidak bisa dibaca publik.
--
-- Cara kerja:
--   1. publish.js membuat token acak (crypto.randomUUID()) di browser
--      dan mengirimnya sebagai status_token saat insert.
--   2. Trigger di bawah mengganti nilai itu dengan hash SHA-256-nya
--      sebelum disimpan. Yang tersimpan di tabel hanya hash, jadi
--      walaupun kolom ini terbaca lewat API publik (misalnya
--      ?select=* pada agent yang sudah approved), nilainya tidak bisa
--      dipakai untuk mengecek status.
--   3. status.html memanggil get_submission_status(token) lewat RPC.
--      Fungsi ini SECURITY DEFINER (melewati RLS), meng-hash token yang
--      diberikan, dan hanya mengembalikan status, name, dan id.
--
-- Prasyarat: migration.sql, migration-verified.sql,
-- migration-github-stats.sql, migration-contract-address.sql, dan
-- migration-review-queue.sql sudah dijalankan. Langkah 0 di bawah
-- memeriksanya dan membatalkan migrasi kalau ada kolom yang kurang.
--
-- Idempoten: aman dijalankan lebih dari sekali.

begin;

-- ---------------------------------------------
-- 0. Cek prasyarat
-- ---------------------------------------------
-- Situs sekarang memilih kolom secara eksplisit (bukan select("*")),
-- jadi semua kolom ini harus ada sebelum kode baru di-deploy.
do $$
declare
  missing text;
begin
  select string_agg(c, ', ')
  into missing
  from unnest(array[
    'id', 'name', 'description', 'version', 'repo_url', 'category',
    'demo_url', 'created_at', 'verified', 'github_stars',
    'github_updated_at', 'contract_address', 'approved'
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
-- 1. Kolom status_token + unique index
-- ---------------------------------------------
alter table public.agents
  add column if not exists status_token uuid;

-- Unique hanya untuk nilai yang terisi; agent lama (NULL) tidak bentrok.
create unique index if not exists agents_status_token_key
  on public.agents (status_token);

-- ---------------------------------------------
-- 2. Simpan hash token, bukan token aslinya
-- ---------------------------------------------
-- hash = 32 karakter hex pertama dari SHA-256(token), disimpan sebagai uuid.
create or replace function public.agents_hash_status_token()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status_token is not null then
    new.status_token := substr(
      encode(sha256(convert_to(new.status_token::text, 'UTF8')), 'hex'),
      1, 32
    )::uuid;
  end if;
  return new;
end
$$;

revoke all on function public.agents_hash_status_token() from public;

drop trigger if exists agents_hash_status_token on public.agents;
create trigger agents_hash_status_token
  before insert on public.agents
  for each row
  execute function public.agents_hash_status_token();

-- ---------------------------------------------
-- 3. Kebijakan INSERT (dibuat ulang, isi sama)
-- ---------------------------------------------
-- Tetap mewajibkan approved = false dan verified = false plus batas
-- panjang yang sama. status_token tidak dibatasi (boleh diisi atau
-- kosong), jadi insert dari publish.js yang membawa status_token lolos.
drop policy if exists "Public can submit agents for review" on public.agents;
create policy "Public can submit agents for review"
  on public.agents
  for insert
  to anon, authenticated
  with check (
    approved = false
    and verified = false
    and char_length(name) > 0
    and char_length(name) <= 120
    and char_length(description) > 0
    and char_length(description) <= 600
    and char_length(version) > 0
    and char_length(repo_url) > 0
  );

-- Kebijakan SELECT "Public can read approved agents" TIDAK diubah.

-- ---------------------------------------------
-- 4. Fungsi cek status
-- ---------------------------------------------
-- Hanya mengembalikan status ('pending' / 'approved'), name, dan id.
-- Token tidak cocok atau NULL → hasil kosong (0 baris).
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
    and a.status_token = substr(
      encode(sha256(convert_to(p_token::text, 'UTF8')), 'hex'),
      1, 32
    )::uuid
  limit 1;
$$;

revoke all on function public.get_submission_status(uuid) from public;
grant execute on function public.get_submission_status(uuid) to anon, authenticated;

commit;

-- ============================================
-- Cek setelah migrasi (opsional, jalankan manual)
-- ============================================
--   select * from public.get_submission_status('00000000-0000-4000-8000-000000000000');
--   -- → 0 baris (token tidak dikenal)
