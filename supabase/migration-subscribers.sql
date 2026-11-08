-- ============================================
-- Agraris — Follow by email: pelanggan digest mingguan
-- Jalankan ini di Supabase Dashboard → SQL Editor
-- ============================================
--
-- Pengunjung memasukkan email di beranda dan menerima satu email
-- konfirmasi (double opt-in). Hanya yang sudah konfirmasi menerima digest
-- mingguan. Setiap email punya tautan berhenti berlangganan.
--
-- Isi migrasi:
--   1. Tabel public.subscribers (email, token acak, status konfirmasi).
--      RLS aktif dan TIDAK ADA kebijakan publik: anon/authenticated tidak
--      bisa membaca atau menulis tabel ini langsung. Hanya service_role
--      (workflow GitHub Actions) yang bisa membaca daftar.
--   2. RPC subscribe_email(p_email): satu-satunya jalan publik untuk
--      mendaftar. Selalu mengembalikan hasil yang sama (tidak membocorkan
--      apakah email sudah terdaftar), membatasi pendaftaran massal, dan
--      tidak mengirim konfirmasi berulang ke email yang sama dalam 24 jam.
--   3. RPC confirm_subscription(p_token) dan unsubscribe_email(p_token):
--      dipakai halaman follow.html dari tautan di email.
--
-- Hanya email yang disimpan. Tidak ada nama, IP, atau pelacak.
-- Idempoten: aman dijalankan lebih dari sekali.

create table if not exists public.subscribers (
  id              uuid primary key default gen_random_uuid(),
  email           text not null,
  token           uuid not null default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  confirm_sent_at timestamptz,
  confirmed_at    timestamptz,
  unsubscribed_at timestamptz,
  last_sent_at    timestamptz,
  constraint subscribers_email_len check (char_length(email) between 5 and 254),
  constraint subscribers_email_fmt check (email = lower(email) and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
);

create unique index if not exists subscribers_email_key on public.subscribers (email);
create unique index if not exists subscribers_token_key on public.subscribers (token);

alter table public.subscribers enable row level security;
revoke all on public.subscribers from anon, authenticated;

-- ---------- subscribe_email ----------
create or replace function public.subscribe_email(p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if char_length(v_email) < 5 or char_length(v_email) > 254
     or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'invalid_email';
  end if;

  -- Batas pendaftaran massal: maksimal 200 konfirmasi menunggu dikirim.
  if (select count(*) from public.subscribers
        where confirmed_at is null and confirm_sent_at is null) >= 200 then
    raise exception 'busy';
  end if;

  insert into public.subscribers (email) values (v_email)
  on conflict (email) do update
    set confirmed_at = null,
        unsubscribed_at = null,
        confirm_sent_at = null,
        token = gen_random_uuid()
    -- Hanya yang belum aktif dan belum dikirimi konfirmasi dalam 24 jam
    -- terakhir. Email yang sudah aktif tidak diubah sama sekali.
    where (public.subscribers.confirmed_at is null
           or public.subscribers.unsubscribed_at is not null)
      and (public.subscribers.confirm_sent_at is null
           or public.subscribers.confirm_sent_at < now() - interval '24 hours');
end;
$$;

-- ---------- confirm_subscription ----------
create or replace function public.confirm_subscription(p_token uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  update public.subscribers
     set confirmed_at = coalesce(confirmed_at, now())
   where token = p_token
     and confirm_sent_at is not null
     and unsubscribed_at is null
  returning id into v_id;
  return v_id is not null;
end;
$$;

-- ---------- unsubscribe_email ----------
create or replace function public.unsubscribe_email(p_token uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  update public.subscribers
     set unsubscribed_at = coalesce(unsubscribed_at, now())
   where token = p_token
  returning id into v_id;
  return v_id is not null;
end;
$$;

revoke all on function public.subscribe_email(text) from public;
revoke all on function public.confirm_subscription(uuid) from public;
revoke all on function public.unsubscribe_email(uuid) from public;
grant execute on function public.subscribe_email(text) to anon, authenticated;
grant execute on function public.confirm_subscription(uuid) to anon, authenticated;
grant execute on function public.unsubscribe_email(uuid) to anon, authenticated;
