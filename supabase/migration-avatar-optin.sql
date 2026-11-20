-- ============================================
-- Agraris: kolom use_avatar (logo dari avatar GitHub, opsional)
-- ============================================
-- Pengirim boleh mencentang "Use the repo owner's GitHub avatar" di form
-- Publish. Kolom ini hanya penanda niat. Gambar baru dipakai situs setelah
-- listing disetujui dan workflow "Generate feeds" mengunduh avatar pemilik
-- repo (scripts/fetch-avatars.js) lalu menyimpannya di logos/avatars/.
--
-- Tidak ada perubahan policy: policy INSERT publik tidak membatasi kolom
-- ini (nilai true hanya meminta avatar; admin tetap menyetujui listing),
-- dan situs tidak membaca kolom ini langsung (AGENT_COLUMNS tidak berubah).
-- Mematikan avatar untuk satu listing: workflow Review queue, action
-- set-avatar, value off.
--
-- Aman dijalankan berulang.

alter table public.agents
  add column if not exists use_avatar boolean not null default false;

-- Cek (hasil yang diharapkan: kolom ada, semua baris lama false):
--   select count(id) from public.agents where use_avatar;
