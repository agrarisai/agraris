-- Dijalankan oleh tests/sql/run-insert-hardening.sh setelah semua migrasi
-- (termasuk migration-harden-insert.sql). Meniru role anon Supabase.
create function pg_temp.ok(c boolean, msg text) returns void language plpgsql as $$
begin if c is not true then raise exception 'FAIL: %', msg; end if; raise notice 'OK: %', msg; end $$;
create function pg_temp.rejects(q text, frag text, msg text) returns void language plpgsql as $$
begin
  begin execute q; exception when others then
    if frag is null or sqlerrm ilike '%' || frag || '%' then raise notice 'OK: %', msg; return; end if;
    raise exception 'FAIL (wrong error: %): %', sqlerrm, msg;
  end;
  raise exception 'FAIL (accepted): %', msg;
end $$;
grant execute on all functions in schema pg_temp to anon, authenticated;

set role anon;
-- baris normal tetap diterima
insert into public.agents (name, description, version, repo_url, category, demo_url, status_token)
values ('TEST normal', 'd', '1', 'https://github.com/x/a', '{t}', 'https://demo.example.com', 'f0000000-0000-4000-8000-000000000001');
select pg_temp.ok(true, 'normal submission accepted');
insert into public.agents (name, description, version, repo_url, status_token)
values ('TEST no demo', 'd', '1', 'https://gitlab.com/x/a', 'f0000000-0000-4000-8000-000000000002');
select pg_temp.ok(true, 'submission without demo accepted');

-- statistik palsu ditolak
select pg_temp.rejects($q$insert into public.agents (name, description, version, repo_url, github_stars) values ('x','d','1','https://github.com/x/a', 250000)$q$, 'row-level security', 'github_stars');
select pg_temp.rejects($q$insert into public.agents (name, description, version, repo_url, github_stars) values ('x','d','1','https://github.com/x/a', 0)$q$, 'row-level security', 'github_stars = 0');
select pg_temp.rejects($q$insert into public.agents (name, description, version, repo_url, github_activity) values ('x','d','1','https://github.com/x/a', '{"c7":99,"d":[14,14,14,14,14,14,15]}')$q$, 'row-level security', 'github_activity');
select pg_temp.rejects($q$insert into public.agents (name, description, version, repo_url, github_updated_at) values ('x','d','1','https://github.com/x/a', now())$q$, 'row-level security', 'github_updated_at');
select pg_temp.rejects($q$insert into public.agents (name, description, version, repo_url, created_at) values ('x','d','1','https://github.com/x/a', '2099-01-01T00:00:00Z')$q$, 'row-level security', 'created_at in the future');
select pg_temp.rejects($q$insert into public.agents (name, description, version, repo_url, created_at) values ('x','d','1','https://github.com/x/a', now() - interval '3 days')$q$, 'row-level security', 'created_at in the past');
-- skema URL
select pg_temp.rejects($q$insert into public.agents (name, description, version, repo_url) values ('x','d','1','javascript:alert(1)')$q$, 'row-level security', 'javascript: repo_url');
select pg_temp.rejects($q$insert into public.agents (name, description, version, repo_url) values ('x','d','1','gitlab.com/a/b')$q$, 'row-level security', 'repo_url without scheme');
select pg_temp.rejects($q$insert into public.agents (name, description, version, repo_url) values ('x','d','1','http://github.com/x/a')$q$, 'row-level security', 'http repo_url');
select pg_temp.rejects($q$insert into public.agents (name, description, version, repo_url, demo_url) values ('x','d','1','https://github.com/x/a','javascript:alert(1)')$q$, 'row-level security', 'javascript: demo_url');
select pg_temp.rejects($q$insert into public.agents (name, description, version, repo_url, demo_url) values ('x','d','1','https://github.com/x/a','data:text/html,hi')$q$, 'row-level security', 'data: demo_url');
select pg_temp.rejects($q$insert into public.agents (name, description, version, repo_url, demo_url) values ('x','d','1','https://github.com/x/a','https://a b.com')$q$, 'row-level security', 'demo_url with space');
-- aturan lama tetap
select pg_temp.rejects($q$insert into public.agents (name, description, version, repo_url, approved) values ('x','d','1','https://github.com/x/a', true)$q$, 'row-level security', 'approved = true');
select pg_temp.rejects($q$insert into public.agents (name, description, version, repo_url, verified) values ('x','d','1','https://github.com/x/a', true)$q$, 'row-level security', 'verified = true');
reset role;
select pg_temp.ok((select count(*) from public.agents where name like 'TEST%') = 2, 'only the two valid rows were stored');
