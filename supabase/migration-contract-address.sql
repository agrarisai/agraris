-- ============================================
-- Agraris — migration untuk kolom `contract_address` di tabel `agents`
-- Jalankan ini di Supabase Dashboard → SQL Editor
-- ============================================
--
-- Alamat kontrak atau wallet (EVM, Robinhood Chain) yang opsional,
-- diisi sendiri oleh builder lewat form publish. Dipakai untuk link
-- ke explorer (robinhoodchain.blockscout.com) di halaman agent.
-- Agraris TIDAK memverifikasi kepemilikan alamat ini, dan tidak ada
-- data on-chain yang diambil darinya.

alter table public.agents
  add column if not exists contract_address text;

-- Format dijaga juga di database, bukan cuma di form: policy INSERT
-- di migration.sql terbuka untuk publik, jadi validasi di browser
-- bisa dilewati dengan memanggil API langsung. Constraint ini
-- menolak apa pun selain NULL atau alamat 0x + 40 karakter hex
-- (pola yang sama dengan validasi di publish.js).
alter table public.agents
  drop constraint if exists agents_contract_address_format;

alter table public.agents
  add constraint agents_contract_address_format
  check (
    contract_address is null
    or contract_address ~ '^0x[a-fA-F0-9]{40}$'
  );

-- ---------------------------------------------
-- Row Level Security
-- ---------------------------------------------
-- Tidak perlu policy baru:
--   - SELECT publik sudah ada ("Public can read agents").
--   - INSERT publik sudah ada ("Public can publish agents"); kolom
--     baru ikut boleh diisi saat insert, dibatasi constraint di atas.
--   - Tetap TIDAK ADA policy UPDATE/DELETE untuk publik, jadi alamat
--     yang sudah tersimpan hanya bisa diubah admin lewat Dashboard.
