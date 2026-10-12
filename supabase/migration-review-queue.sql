-- ============================================
-- Agraris — review queue untuk agent baru (kolom `approved`)
-- Jalankan ini di Supabase Dashboard → SQL Editor
-- ============================================
--
-- Entri baru dari form publish tidak langsung tampil publik: masuk
-- dengan approved = false dan menunggu disetujui pemilik. Semua agent
-- yang SUDAH ADA saat migrasi ini pertama kali dijalankan otomatis
-- approved = true, jadi tetap tampil.
--
-- Prasyarat: migration.sql dan supabase/migration-verified.sql sudah
-- dijalankan (kebijakan insert di bawah memakai kolom `verified`).
--
-- Idempoten: aman dijalankan lebih dari sekali. Backfill HANYA jalan
-- saat kolom `approved` baru dibuat, jadi menjalankan ulang file ini
-- tidak akan ikut menyetujui entri yang sedang menunggu review.
--
-- Urutan deploy: jalankan migrasi ini DULU, baru merge/deploy kode.
-- Script GitHub Actions (RSS, sitemap, digest) memfilter
-- approved = true dan akan gagal kalau kolomnya belum ada.

begin;

-- ---------------------------------------------
-- 1 + 2. Tambah kolom, lalu backfill baris yang sudah ada
-- ---------------------------------------------
-- Keduanya di satu blok: kalau kolom sudah ada (migrasi pernah
-- dijalankan), blok ini dilewati seluruhnya.
do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'agents'
      and column_name  = 'approved'
  ) then
    alter table public.agents
      add column approved boolean not null default false;

    -- Semua agent yang sudah ada sebelum review queue tetap tampil.
    update public.agents set approved = true;
  end if;
end
$$;

-- Index untuk query publik yang selalu memfilter approved = true.
create index if not exists agents_approved_created_at_idx
  on public.agents (approved, created_at desc);

-- ---------------------------------------------
-- 3. Hapus kebijakan lama yang relevan
-- ---------------------------------------------
-- Nama persis dari migration.sql. Dua nama baru di bawah juga di-drop
-- dulu supaya file ini bisa dijalankan ulang.
drop policy if exists "Public can read agents" on public.agents;
drop policy if exists "Public can publish agents" on public.agents;
drop policy if exists "Public can read approved agents" on public.agents;
drop policy if exists "Public can submit agents for review" on public.agents;

-- ---------------------------------------------
-- 4. Buat kebijakan baru
-- ---------------------------------------------
-- RLS sudah aktif sejak migration.sql; diulang di sini supaya aman.
alter table public.agents enable row level security;

-- Publik (anon key) hanya bisa membaca agent yang sudah disetujui.
-- Berlaku untuk situs, embed, stats, dan API publik di docs.html.
-- Entri yang belum disetujui tidak terlihat sama sekali, termasuk
-- lewat ?id=eq.<id>, sehingga halaman agent menampilkan "not found".
create policy "Public can read approved agents"
  on public.agents
  for select
  to anon, authenticated
  using (approved = true);

-- Publik boleh mengirim agent baru, tapi:
--   - approved harus false (tidak bisa menyetujui diri sendiri),
--   - verified harus false (sebelumnya tidak dibatasi, jadi badge
--     Verified bisa dipasang sendiri lewat API),
--   - batas panjang sama persis dengan kebijakan lama.
-- Catatan: karena baris baru approved = false dan tidak lolos
-- kebijakan SELECT di atas, client TIDAK BOLEH memanggil .select()
-- setelah .insert() (RETURNING akan ditolak RLS). publish.js sudah
-- disesuaikan.
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

-- Tidak ada kebijakan UPDATE/DELETE untuk publik (sama seperti
-- sebelumnya), jadi anon tidak bisa mengubah approved. Sebagai lapis
-- kedua, hak UPDATE dicabut langsung dari role publik: situs tidak
-- pernah meng-update tabel ini dari browser. service_role (GitHub
-- Actions, Dashboard) tidak terpengaruh.
revoke update on public.agents from anon, authenticated;

commit;

-- ============================================
-- Menyetujui agent (jalankan manual, terpisah dari migrasi)
-- ============================================
-- Lihat antrean dulu:
--   select id, name, repo_url, created_at
--   from public.agents
--   where approved = false
--   order by created_at;
--
-- Setujui berdasarkan nama (ganti teks di dalam kutip). Nama tidak
-- unik, jadi cek antrean di atas dulu; kalau ada dua dengan nama sama,
-- pakai id: ... where id = '<uuid>';
--
-- update public.agents set approved = true where name = 'Nama Agent' and approved = false;
