-- ============================================================
-- PERINGATAN: file ini MEMBUAT DATA TEST (listing "TEST ...", baris
-- agent_edits palsu). Hanya untuk database lokal yang dibuat oleh
-- tests/sql/run-recently-updated.sh. JANGAN jalankan di Supabase asli.
-- ============================================================
\set ON_ERROR_STOP 1

create or replace function pg_temp.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FAILED: %', label; end if;
  raise notice 'OK: %', label;
end $$;

create or replace function pg_temp.expect_fail(sql text, label text) returns void language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    raise notice 'OK (rejected): % — %', label, sqlerrm;
    return;
  end;
  raise exception 'EXPECTED FAILURE BUT SUCCEEDED: %', label;
end $$;

-- 0 edit → 0 baris
insert into public.agents (id, name, description, version, repo_url, category, approved, approved_at, kind, status_token)
values
  ('a0000000-0000-4000-8000-000000000001', 'TEST One',     'd', '1', 'https://github.com/x/1', '{t}', true,  now() - interval '60 days', 'agent', 'f0000000-0000-4000-8000-000000000001'),
  ('a0000000-0000-4000-8000-000000000002', 'TEST Many',    'd', '1', 'https://github.com/x/2', '{t}', true,  now() - interval '60 days', 'tool',  'f0000000-0000-4000-8000-000000000002'),
  ('a0000000-0000-4000-8000-000000000003', 'TEST Pending', 'd', '1', 'https://github.com/x/3', '{t}', false, null,                       'agent', 'f0000000-0000-4000-8000-000000000003'),
  ('a0000000-0000-4000-8000-000000000004', 'TEST Old',     'd', '1', 'https://github.com/x/4', '{t}', true,  now() - interval '90 days', 'agent', 'f0000000-0000-4000-8000-000000000004'),
  ('a0000000-0000-4000-8000-000000000005', 'TEST PreApproval', 'd', '1', 'https://github.com/x/5', '{t}', true, now() - interval '1 day', 'agent', 'f0000000-0000-4000-8000-000000000005');

set role anon;
select pg_temp.ok((select count(*) from public.get_recently_updated(20)) = 0, '0 edits → 0 rows');
reset role;

-- 1 edit lewat RPC asli update_submission (sebagai anon, pakai token)
set role anon;
select 1 from public.update_submission('f0000000-0000-4000-8000-000000000001', 'new description', null, null, '1', array['t']);
select pg_temp.ok((select count(*) from public.get_recently_updated(20)) = 1, '1 edit → 1 row');
select pg_temp.ok((select name from public.get_recently_updated(20)) = 'TEST One', '1 edit → correct listing');
reset role;

-- banyak edit pada listing yang sama → muncul sekali, dengan waktu terbaru
insert into public.agent_edits (agent_id, edited_at, changed_fields, previous) values
  ('a0000000-0000-4000-8000-000000000002', now() - interval '5 days', '{description}', '{"description":"secret old 1"}'),
  ('a0000000-0000-4000-8000-000000000002', now() - interval '2 hours', '{description}', '{"description":"secret old 2"}'),
  ('a0000000-0000-4000-8000-000000000002', now() - interval '3 days', '{version}', '{"version":"0.9"}');
-- listing belum approved, edit lama, dan edit sebelum approval
insert into public.agent_edits (agent_id, edited_at, changed_fields, previous) values
  ('a0000000-0000-4000-8000-000000000003', now() - interval '1 hour', '{description}', '{}'),
  ('a0000000-0000-4000-8000-000000000004', now() - interval '31 days', '{description}', '{}'),
  ('a0000000-0000-4000-8000-000000000005', now() - interval '2 days', '{description}', '{}');

set role anon;
select pg_temp.ok((select count(*) from public.get_recently_updated(20) where name = 'TEST Many') = 1, 'many edits on one listing → appears once');
select pg_temp.ok(
  (select last_edited_at from public.get_recently_updated(20) where name = 'TEST Many')
    between now() - interval '2 hours 1 minute' and now() - interval '1 hour 59 minutes',
  'many edits → latest edit time');
select pg_temp.ok((select kind from public.get_recently_updated(20) where name = 'TEST Many') = 'tool', 'kind returned');
select pg_temp.ok(not exists (select 1 from public.get_recently_updated(20) where name = 'TEST Pending'), 'unapproved listing not shown');
select pg_temp.ok(not exists (select 1 from public.get_recently_updated(20) where name = 'TEST Old'), 'edit older than 30 days not shown');
select pg_temp.ok(not exists (select 1 from public.get_recently_updated(20) where name = 'TEST PreApproval'), 'edit made before approval not shown');
select pg_temp.ok((select string_agg(name, ',') from public.get_recently_updated(20)) = 'TEST One,TEST Many', 'newest edit first');
reset role;

-- hanya 4 kolom, tidak bisa mengembalikan kolom lain
select pg_temp.ok(
  pg_get_function_result('public.get_recently_updated(integer)'::regprocedure)
    = 'TABLE(id uuid, name text, kind text, last_edited_at timestamp with time zone)',
  'result type is exactly (id, name, kind, last_edited_at)');
set role anon;
select pg_temp.ok(
  (select string_agg(key, ',' order by key) from (select jsonb_object_keys(to_jsonb(r)) as key from public.get_recently_updated(1) r) k)
    = 'id,kind,last_edited_at,name',
  'returned row has only id, kind, last_edited_at, name');
select pg_temp.ok(
  not exists (select 1 from public.get_recently_updated(20) r where to_jsonb(r)::text ~ 'secret old'),
  'edit contents never returned');
select pg_temp.expect_fail($q$select * from public.agent_edits$q$, 'anon cannot read agent_edits directly');
select pg_temp.expect_fail($q$select * from public.get_recently_updated(20) r join public.agent_edits e on true$q$, 'anon cannot join agent_edits');
reset role;

-- batas limit: maks 20, null → 5, negatif → 0
insert into public.agents (id, name, description, version, repo_url, category, approved, approved_at)
select ('b0000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, 'TEST Bulk ' || g, 'd', '1', 'https://github.com/x/b', '{t}', true, now() - interval '60 days'
from generate_series(1, 25) g;
insert into public.agent_edits (agent_id, edited_at, changed_fields)
select ('b0000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, now() - (g || ' minutes')::interval, '{description}'
from generate_series(1, 25) g;
set role anon;
select pg_temp.ok((select count(*) from public.get_recently_updated(100)) = 20, 'limit capped at 20');
select pg_temp.ok((select count(*) from public.get_recently_updated(null)) = 5, 'null limit → 5');
select pg_temp.ok((select count(*) from public.get_recently_updated()) = 5, 'default limit → 5');
select pg_temp.ok((select count(*) from public.get_recently_updated(-3)) = 0, 'negative limit → 0');
reset role;

-- grant: anon dan authenticated boleh, PUBLIC tidak
select pg_temp.ok(has_function_privilege('anon', 'public.get_recently_updated(integer)', 'execute'), 'anon can execute');
select pg_temp.ok(has_function_privilege('authenticated', 'public.get_recently_updated(integer)', 'execute'), 'authenticated can execute');
select pg_temp.ok(
  not exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.proname = 'get_recently_updated' and a.grantee = 0),
  'no EXECUTE for PUBLIC');
select pg_temp.ok((select provolatile from pg_proc where proname = 'get_recently_updated') = 's', 'function is STABLE (read-only)');
