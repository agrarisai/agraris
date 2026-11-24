-- ============================================
-- Agraris: kolom erc8004_agent_id (identitas ERC-8004, opsional)
-- ============================================
-- ERC-8004 ("Trustless Agents", masih berstatus draf) memberi tiap agent
-- sebuah ID angka (tokenId ERC-721) di sebuah Identity Registry. Builder
-- boleh mengisi ID itu di form Publish. Situs hanya menampilkannya sebagai
-- teks "Agent #<id> on Robinhood Chain" dengan catatan bahwa ini diisi
-- builder dan TIDAK diverifikasi Agraris. Tidak ada link keluar dan tidak
-- ada data onchain yang diambil.
--
-- Hanya angka desimal 1-20 digit tanpa nol di depan (cukup untuk ID nyata;
-- cek ini juga dijaga di database karena insert publik bisa memanggil API
-- langsung).
--
-- Tidak ada perubahan policy: INSERT publik tidak membatasi kolom ini
-- (dibatasi constraint di bawah). Tetap tidak ada UPDATE publik; admin
-- mengubahnya lewat workflow Review queue, action set-erc8004.
-- Kolom ini dibaca terpisah di halaman listing (bukan lewat AGENT_COLUMNS),
-- jadi situs tetap jalan walau migrasi ini belum dijalankan.
--
-- URUTAN: jalankan SQL ini SEBELUM merge PR-nya: workflow "Generate feeds"
-- membaca kolom ini.
--
-- Aman dijalankan berulang.

alter table public.agents
  add column if not exists erc8004_agent_id text;

alter table public.agents
  drop constraint if exists agents_erc8004_agent_id_format;

alter table public.agents
  add constraint agents_erc8004_agent_id_format
  check (
    erc8004_agent_id is null
    or erc8004_agent_id ~ '^[1-9][0-9]{0,19}$'
  );

-- Cek (hasil yang diharapkan: kolom ada, semua baris lama null):
--   select count(id) from public.agents where erc8004_agent_id is not null;
