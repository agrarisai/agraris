-- ============================================
-- Agraris — contract owner signature (bukti tanda tangan pemilik kontrak)
-- Jalankan ini di Supabase Dashboard → SQL Editor
-- ============================================
--
-- Builder yang listing-nya punya contract_address bisa membuktikan bahwa
-- wallet owner() kontrak itu menandatangani sebuah pesan (personal_sign,
-- EIP-191), dari status.html memakai link status yang sudah ada.
--
-- Alur (semua pemeriksaan kriptografi dan on-chain di SERVER):
--   1. status.html → request_owner_proof(token): database membuat pesan
--      (domain agraris.xyz, listing id, alamat kontrak, chain ID 4663,
--      nonce acak sekali pakai, kedaluwarsa 10 menit) dan menyimpannya di
--      owner_proof_challenges. Pesan dibuat di sini, bukan di browser.
--   2. Wallet builder menandatangani pesan itu (window.ethereum,
--      personal_sign).
--   3. status.html → submit_owner_proof(token, nonce, signature): hanya
--      diterima sebelum kedaluwarsa dan hanya sekali per nonce.
--   4. Workflow "Owner signature" (scripts/owner-proof.js, tiap 15 menit,
--      service role) memulihkan alamat penanda tangan, membaca owner()
--      kontrak lewat RPC Robinhood Chain (chain ID 4663), dan menulis
--      owner_proofs HANYA kalau penanda tangan = owner() saat itu.
--   5. Workflow "Live check" memeriksa ulang owner() tiap 6 jam dan
--      menghapus bukti kalau owner berubah.
--
-- Isi migrasi:
--   1. Tabel privat owner_proof_challenges (pesan, nonce, tanda tangan).
--   2. Tabel owner_proofs (satu baris per listing). Publik hanya bisa
--      membaca agent_id, signer, signed_at, dan hanya untuk listing yang
--      approved. owner_at_check, nonce, contract_address, checked_at tidak
--      terbaca publik.
--   3. Trigger: kalau contract_address listing berubah, bukti dihapus dan
--      permintaan yang masih terbuka ditolak (contract_changed).
--   4. RPC request_owner_proof, submit_owner_proof, get_owner_proof_status
--      (SECURITY DEFINER, lewat hash token status seperti RPC edit listing).
--
-- TIDAK disentuh: kebijakan agents, update_submission(),
-- get_submission_status(), get_submission_editable(), kolom verified.
--
-- Prasyarat: migration-submission-status.sql, migration-edit-listing.sql
-- (agents_status_token_hash), migration-contract-address.sql. Langkah 0
-- memeriksanya.
--
-- Idempoten: aman dijalankan lebih dari sekali. Tidak ada data yang
-- ditulis.
--
-- Urutan deploy: jalankan migrasi ini DULU, lalu isi secret
-- ROBINHOOD_CHAIN_RPC_URL di GitHub Actions, baru merge kode.

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
  from unnest(array['id', 'name', 'approved', 'contract_address', 'status_token']) as c
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

  if to_regprocedure('public.agents_status_token_hash(uuid)') is null then
    raise exception 'Fungsi public.agents_status_token_hash(uuid) belum ada. Jalankan migration-edit-listing.sql dulu.';
  end if;
end
$$;

-- ---------------------------------------------
-- 1. Permintaan tanda tangan (privat)
-- ---------------------------------------------
-- status:
--   open      — pesan dibuat, menunggu tanda tangan (maks. 10 menit)
--   submitted — tanda tangan diterima, menunggu workflow
--   accepted  — penanda tangan = owner(); bukti ditulis ke owner_proofs
--   rejected  — ditolak (reason menjelaskan sebabnya)
--   expired   — tidak ditandatangani sebelum kedaluwarsa / diganti yang baru
--   revoked   — dulu accepted, lalu owner() berubah (pemeriksaan ulang)
create table if not exists public.owner_proof_challenges (
  id               bigint generated always as identity primary key,
  agent_id         uuid not null references public.agents (id) on delete cascade,
  contract_address text not null check (contract_address ~ '^0x[0-9a-f]{40}$'),
  nonce            text not null unique check (nonce ~ '^[0-9a-f]{32}$'),
  message          text not null,
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null,
  signature        text check (signature is null or signature ~ '^0x[0-9a-f]{130}$'),
  submitted_at     timestamptz,
  status           text not null default 'open'
                   check (status in ('open', 'submitted', 'accepted', 'rejected', 'expired', 'revoked')),
  reason           text,
  checked_at       timestamptz
);

create index if not exists owner_proof_challenges_agent_idx
  on public.owner_proof_challenges (agent_id, created_at desc);

create index if not exists owner_proof_challenges_submitted_idx
  on public.owner_proof_challenges (submitted_at)
  where status = 'submitted';

alter table public.owner_proof_challenges enable row level security;
revoke all on table public.owner_proof_challenges from anon, authenticated;

-- ---------------------------------------------
-- 2. Bukti yang berlaku (satu per listing)
-- ---------------------------------------------
-- signed_at = waktu tanda tangan diterima (submitted_at).
-- owner_at_check = owner() pada pemeriksaan terakhir (sama dengan signer;
-- kalau berbeda, baris ini dihapus).
create table if not exists public.owner_proofs (
  agent_id         uuid primary key references public.agents (id) on delete cascade,
  signer           text not null check (signer ~ '^0x[0-9a-f]{40}$'),
  signed_at        timestamptz not null,
  owner_at_check   text not null check (owner_at_check ~ '^0x[0-9a-f]{40}$'),
  nonce            text not null unique,
  contract_address text not null check (contract_address ~ '^0x[0-9a-f]{40}$'),
  checked_at       timestamptz not null default now()
);

alter table public.owner_proofs enable row level security;

drop policy if exists "Public can read owner signatures of approved listings" on public.owner_proofs;
create policy "Public can read owner signatures of approved listings"
  on public.owner_proofs
  for select
  to anon, authenticated
  using (
    exists (
      select 1 from public.agents a
      where a.id = owner_proofs.agent_id
        and a.approved = true
    )
  );

-- Tidak ada INSERT/UPDATE/DELETE publik. SELECT publik hanya kolom ini.
revoke all on table public.owner_proofs from anon, authenticated;
grant select (agent_id, signer, signed_at) on public.owner_proofs to anon, authenticated;

-- ---------------------------------------------
-- 3. Alamat kontrak berubah → bukti tidak berlaku lagi
-- ---------------------------------------------
create or replace function public.agents_reset_owner_proof()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Alamat EVM tidak peka huruf besar/kecil: hanya perubahan alamat yang
  -- sebenarnya yang membatalkan bukti.
  if lower(new.contract_address) is distinct from lower(old.contract_address) then
    delete from public.owner_proofs p where p.agent_id = new.id;
    update public.owner_proof_challenges c
    set status = 'rejected', reason = 'contract_changed', checked_at = now()
    where c.agent_id = new.id
      and c.status in ('open', 'submitted');
  end if;
  return new;
end
$$;

revoke all on function public.agents_reset_owner_proof() from public, anon, authenticated;

drop trigger if exists agents_reset_owner_proof on public.agents;
create trigger agents_reset_owner_proof
  after update of contract_address on public.agents
  for each row
  execute function public.agents_reset_owner_proof();

-- ---------------------------------------------
-- 4a. RPC: buat pesan untuk ditandatangani
-- ---------------------------------------------
-- Token tidak dikenal / NULL → 0 baris (sama seperti RPC edit listing).
-- Hanya listing approved yang punya contract_address. Maks. 10 permintaan
-- per listing per jam. Permintaan lama yang masih terbuka diganti.
-- Format pesan HARUS sama persis dengan buildMessage() di
-- scripts/owner-proof.js (workflow menolak pesan yang berbeda).
drop function if exists public.request_owner_proof(uuid);

create function public.request_owner_proof(p_token uuid)
returns table (nonce text, message text, expires_at timestamptz)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_agent   public.agents%rowtype;
  v_nonce   text;
  v_expires timestamptz;
  v_message text;
begin
  if p_token is null then
    return;
  end if;

  select a.* into v_agent
  from public.agents a
  where a.status_token = public.agents_status_token_hash(p_token)
  for update;

  if not found then
    return;
  end if;

  if v_agent.approved is not true then
    raise exception 'The owner signature can be added once the listing is approved.' using errcode = '22023';
  end if;
  if v_agent.contract_address is null then
    raise exception 'Add a contract address to the listing first.' using errcode = '22023';
  end if;

  if (
    select count(*) from public.owner_proof_challenges c
    where c.agent_id = v_agent.id
      and c.created_at > now() - interval '1 hour'
  ) >= 10 then
    raise exception 'Too many signing requests for this listing in the last hour. Please try again later.' using errcode = '22023';
  end if;

  update public.owner_proof_challenges c
  set status = 'expired', reason = 'replaced', checked_at = now()
  where c.agent_id = v_agent.id and c.status = 'open';

  v_nonce   := replace(gen_random_uuid()::text, '-', '');
  v_expires := date_trunc('second', now()) + interval '10 minutes';
  v_message :=
    'agraris.xyz asks you to sign this message to show that this wallet is the owner() of the contract below.' || E'\n\n'
    || 'Domain: agraris.xyz' || E'\n'
    || 'Listing ID: ' || v_agent.id::text || E'\n'
    || 'Contract: ' || lower(v_agent.contract_address) || E'\n'
    || 'Chain ID: 4663' || E'\n'
    || 'Nonce: ' || v_nonce || E'\n'
    || 'Expires at: ' || to_char(v_expires at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || E'\n\n'
    || 'Signing does not send a transaction.';

  insert into public.owner_proof_challenges (agent_id, contract_address, nonce, message, expires_at)
  values (v_agent.id, lower(v_agent.contract_address), v_nonce, v_message, v_expires);

  return query select v_nonce, v_message, v_expires;
end
$$;

-- ---------------------------------------------
-- 4b. RPC: kirim tanda tangan
-- ---------------------------------------------
-- Diterima hanya untuk nonce milik listing token ini, berstatus open, dan
-- belum kedaluwarsa. Setelah diterima status menjadi submitted, jadi nonce
-- yang sama tidak bisa dikirim lagi (replay). Keaslian tanda tangan
-- diperiksa workflow, bukan di sini.
drop function if exists public.submit_owner_proof(uuid, text, text);

create function public.submit_owner_proof(p_token uuid, p_nonce text, p_signature text)
returns table (status text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_agent_id  uuid;
  v_challenge public.owner_proof_challenges%rowtype;
  v_sig       text := lower(btrim(coalesce(p_signature, '')));
  v_nonce     text := lower(btrim(coalesce(p_nonce, '')));
begin
  if v_sig !~ '^0x[0-9a-f]{130}$' then
    raise exception 'The signature has an unexpected format. Please sign again.' using errcode = '22023';
  end if;
  if v_nonce !~ '^[0-9a-f]{32}$' then
    raise exception 'This signing request was not found. Please start again.' using errcode = '22023';
  end if;

  if p_token is null then
    return;
  end if;

  select a.id into v_agent_id
  from public.agents a
  where a.status_token = public.agents_status_token_hash(p_token);

  if v_agent_id is null then
    return;
  end if;

  select c.* into v_challenge
  from public.owner_proof_challenges c
  where c.nonce = v_nonce and c.agent_id = v_agent_id
  for update;

  if not found then
    raise exception 'This signing request was not found. Please start again.' using errcode = '22023';
  end if;
  if v_challenge.status <> 'open' then
    raise exception 'This signing request was already used. Please start again.' using errcode = '22023';
  end if;
  if now() > v_challenge.expires_at then
    raise exception 'This signing request expired. Please start again.' using errcode = '22023';
  end if;

  update public.owner_proof_challenges c
  set signature = v_sig, submitted_at = now(), status = 'submitted'
  where c.id = v_challenge.id;

  return query select 'submitted'::text;
end
$$;

-- ---------------------------------------------
-- 4c. RPC: status untuk halaman status builder
-- ---------------------------------------------
-- Satu baris untuk token yang dikenal (0 baris kalau tidak): bukti yang
-- berlaku (kalau ada) dan hasil permintaan terakhir. Tidak mengembalikan
-- nonce, pesan, atau tanda tangan.
drop function if exists public.get_owner_proof_status(uuid);

create function public.get_owner_proof_status(p_token uuid)
returns table (
  contract_address text,
  signer           text,
  signed_at        timestamptz,
  checked_at       timestamptz,
  last_status      text,
  last_reason      text,
  last_at          timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    a.contract_address,
    p.signer,
    p.signed_at,
    p.checked_at,
    -- Belum ditandatangani dan sudah lewat waktu = expired, walaupun
    -- workflow belum sempat menandainya.
    case when c.status = 'open' and c.expires_at < now() then 'expired' else c.status end,
    case when c.status = 'open' and c.expires_at < now() then 'expired' else c.reason end,
    coalesce(c.checked_at, c.submitted_at, c.created_at)
  from public.agents a
  left join public.owner_proofs p on p.agent_id = a.id
  left join lateral (
    select c2.status, c2.reason, c2.checked_at, c2.submitted_at, c2.created_at, c2.expires_at
    from public.owner_proof_challenges c2
    where c2.agent_id = a.id
    order by c2.created_at desc, c2.id desc
    limit 1
  ) c on true
  where p_token is not null
    and a.status_token = public.agents_status_token_hash(p_token)
  limit 1;
$$;

-- ---------------------------------------------
-- 4d. Grant: sama seperti migration-edit-listing.sql
-- ---------------------------------------------
revoke all on function public.request_owner_proof(uuid) from public, anon, authenticated, service_role;
grant execute on function public.request_owner_proof(uuid) to anon, authenticated;

revoke all on function public.submit_owner_proof(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.submit_owner_proof(uuid, text, text) to anon, authenticated;

revoke all on function public.get_owner_proof_status(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_owner_proof_status(uuid) to anon, authenticated;

commit;

-- ============================================
-- Cek setelah migrasi (opsional, jalankan manual)
-- ============================================
--   select * from public.owner_proofs;
--   -- → 0 baris sampai ada tanda tangan yang diterima workflow
--
--   select * from public.request_owner_proof('00000000-0000-4000-8000-000000000000');
--   -- → 0 baris (token tidak dikenal)
