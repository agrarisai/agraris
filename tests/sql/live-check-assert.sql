-- Dipanggil oleh tests/sql/run-live-check.sh setelah semua migrasi jalan.
-- Gagal (ON_ERROR_STOP) kalau anon/authenticated bisa menulis kolom live_*,
-- kalau constraint tidak bekerja, atau kalau demo_url baru tidak mereset hasil.
\set ON_ERROR_STOP 1
-- seed as service role
set role service_role;
insert into public.agents (id, name, description, version, repo_url, category, demo_url, approved, status_token)
values ('11111111-1111-4111-8111-111111111111','TEST LIVE OK','d','1','https://github.com/x/y','{a}','https://example.com', true, '22222222-2222-4222-8222-222222222222');
update public.agents set live_status='up', live_checked_at=now(), live_fail_count=0 where id='11111111-1111-4111-8111-111111111111';
reset role;

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

set role anon;
select pg_temp.expect_fail($q$insert into public.agents (name, description, version, repo_url, live_status) values ('x','d','1','r','up')$q$, 'anon insert live_status=up');
select pg_temp.expect_fail($q$insert into public.agents (name, description, version, repo_url, live_checked_at) values ('x','d','1','r',now())$q$, 'anon insert live_checked_at');
select pg_temp.expect_fail($q$insert into public.agents (name, description, version, repo_url, live_fail_count) values ('x','d','1','r',5)$q$, 'anon insert live_fail_count=5');
select pg_temp.expect_fail($q$update public.agents set live_status='down'$q$, 'anon update live_status');
select pg_temp.expect_fail($q$update public.agents set live_fail_count=0$q$, 'anon update live_fail_count');
-- default insert still works
insert into public.agents (name, description, version, repo_url, category) values ('TEST anon ok','d','1','https://github.com/x/z','{a}');
-- public select sees live columns of approved rows only
do $$ begin
  if (select count(*) from public.agents) <> 1 then raise exception 'anon should see exactly 1 approved row'; end if;
  if (select live_status from public.agents) <> 'up' then raise exception 'anon should read live_status'; end if;
end $$;
reset role;

set role authenticated;
select pg_temp.expect_fail($q$insert into public.agents (name, description, version, repo_url, live_status) values ('x','d','1','r','down')$q$, 'authenticated insert live_status');
select pg_temp.expect_fail($q$update public.agents set live_status='down'$q$, 'authenticated update');
reset role;

-- check constraint
set role service_role;
select pg_temp.expect_fail($q$update public.agents set live_status='maybe'$q$, 'invalid live_status value');
select pg_temp.expect_fail($q$update public.agents set live_fail_count=-1$q$, 'negative fail count');
reset role;

-- update_submission with same demo_url keeps live_*; changing demo_url resets
set role anon;
select name from public.update_submission('22222222-2222-4222-8222-222222222222','new desc','https://example.com',null,'1',array['a']);
reset role;
do $$ begin
  if (select live_status from public.agents where id='11111111-1111-4111-8111-111111111111') is distinct from 'up' then
    raise exception 'update_submission without demo change must keep live_status';
  end if;
end $$;
set role anon;
select name from public.update_submission('22222222-2222-4222-8222-222222222222','new desc','https://example.org',null,'1',array['a']);
reset role;
do $$ declare r record; begin
  select live_status, live_checked_at, live_fail_count into r from public.agents where id='11111111-1111-4111-8111-111111111111';
  if r.live_status is not null or r.live_checked_at is not null or r.live_fail_count <> 0 then
    raise exception 'demo_url change must reset live_* (got %, %, %)', r.live_status, r.live_checked_at, r.live_fail_count;
  end if;
end $$;
-- update_submission function body never mentions live_
do $$ begin
  if (select prosrc from pg_proc where proname='update_submission') ~ 'live_' then
    raise exception 'update_submission must not touch live_*';
  end if;
end $$;
-- exactly one INSERT policy, contains live conditions
do $$ begin
  if (select count(*) from pg_policies where tablename='agents' and cmd='INSERT') <> 1 then raise exception 'expected one insert policy'; end if;
  if (select with_check from pg_policies where tablename='agents' and cmd='INSERT') !~ 'live_fail_count = 0' then raise exception 'policy lacks live check'; end if;
end $$;
