-- ============================================
-- Agraris — Unmet needs: pencarian yang tidak menemukan apa pun
-- Jalankan ini di Supabase Dashboard → SQL Editor
-- ============================================
--
-- Saat pencarian di search.html tidak menemukan listing, browser mengirim
-- frasa pencarian itu (maks 60 karakter) lewat log_search_miss(). Papan
-- "Unmet needs this week" di wanted.html menampilkan frasa yang dicari
-- oleh minimal 5 pengunjung berbeda dalam 7 hari terakhir.
--
-- Yang disimpan: frasa (huruf kecil), id acak dari browser (bukan IP,
-- bukan akun), waktu. Frasa yang memuat URL, alamat 0x, email, angka
-- panjang, atau karakter kontrol ditolak diam-diam.
--
-- Tabel tertutup untuk publik (tanpa kebijakan RLS, hak akses dicabut).
-- Satu-satunya jalan: log_search_miss() (tulis) dan get_unmet_needs()
-- (baca, hanya agregat). Untuk menyembunyikan frasa yang tidak pantas:
--   update public.search_misses set hidden = true where term = '...';
--
-- Idempoten. Tidak menyentuh tabel lain.

begin;

create table if not exists public.search_misses (
  id         bigint generated always as identity primary key,
  term       text not null,
  visitor    text not null,
  hidden     boolean not null default false,
  created_at timestamptz not null default now(),
  constraint search_misses_term_length check (char_length(term) between 3 and 60),
  constraint search_misses_visitor_length check (char_length(visitor) between 8 and 64)
);

create index if not exists search_misses_recent_idx
  on public.search_misses (created_at desc);
create index if not exists search_misses_term_idx
  on public.search_misses (term, created_at desc);

alter table public.search_misses enable row level security;
revoke all on table public.search_misses from anon, authenticated;

create or replace function public.log_search_miss(p_term text, p_visitor text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_term text;
begin
  if p_term is null or p_visitor is null then return; end if;
  if char_length(p_visitor) not between 8 and 64 then return; end if;

  v_term := lower(btrim(regexp_replace(p_term, '\s+', ' ', 'g')));
  if char_length(v_term) not between 3 and 60 then return; end if;

  -- Tolak diam-diam: karakter kontrol, URL / domain, email, alamat 0x,
  -- angka panjang.
  if v_term ~ '[[:cntrl:]]' then return; end if;
  if v_term ~ '(https?:|www\.|[a-z0-9-]+\.(com|io|xyz|org|net|app|ai|dev|co|me|gg|fi|eth)\b)' then return; end if;
  if v_term ~ '@' then return; end if;
  if v_term ~ '0x[0-9a-f]{6,}' then return; end if;
  if v_term ~ '[0-9]{6,}' then return; end if;

  -- Batas per pengunjung: 30 per hari, dan frasa yang sama sekali per hari.
  if (select count(*) from public.search_misses
        where visitor = p_visitor and created_at > now() - interval '1 day') >= 30 then
    return;
  end if;
  if exists (select 1 from public.search_misses
               where visitor = p_visitor and term = v_term
                 and created_at > now() - interval '1 day') then
    return;
  end if;

  -- Batas global harian supaya tabel tidak bisa dibanjiri.
  if (select count(*) from public.search_misses
        where created_at > now() - interval '1 day') >= 5000 then
    return;
  end if;

  insert into public.search_misses (term, visitor) values (v_term, p_visitor);
end;
$$;

revoke all on function public.log_search_miss(text, text) from public;
grant execute on function public.log_search_miss(text, text) to anon, authenticated;

create or replace function public.get_unmet_needs(p_limit integer default 10)
returns table (term text, searches bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select m.term, count(distinct m.visitor) as searches
  from public.search_misses m
  where m.created_at > now() - interval '7 days'
    and m.hidden = false
  group by m.term
  having count(distinct m.visitor) >= 5
  order by searches desc, m.term
  limit least(greatest(coalesce(p_limit, 10), 1), 20);
$$;

revoke all on function public.get_unmet_needs(integer) from public;
grant execute on function public.get_unmet_needs(integer) to anon, authenticated;

commit;
