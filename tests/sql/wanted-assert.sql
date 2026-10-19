-- ============================================================
-- PERINGATAN: file ini MEMBUAT DATA TEST (permintaan wanted dan listing
-- bernama "TEST ..."). Hanya untuk database lokal yang dibuat oleh
-- tests/sql/run-wanted.sh. JANGAN jalankan di Supabase asli.
-- ============================================================
\set ON_ERROR_STOP 1

create or replace function pg_temp.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FAILED: %', label; end if;
  raise notice 'OK: %', label;
end $$;

-- Gagal kalau sql TIDAK error, atau kalau pesan error tidak memuat `expect`.
create or replace function pg_temp.rejects(sql text, expect text, label text) returns void language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    if expect is not null and position(lower(expect) in lower(sqlerrm)) = 0 then
      raise exception 'FAILED: % — wrong error: %', label, sqlerrm;
    end if;
    raise notice 'OK (rejected): % — %', label, sqlerrm;
    return;
  end;
  raise exception 'EXPECTED FAILURE BUT SUCCEEDED: %', label;
end $$;

create or replace function pg_temp.accepts(sql text, label text) returns void language plpgsql as $$
begin
  execute sql;
  raise notice 'OK (accepted): %', label;
end $$;

-- ---------- submit_wanted: validasi ----------
set role anon;
select pg_temp.accepts($q$select public.submit_wanted('TEST MCP server for order books', 'Read-only order book data for Robinhood Chain pairs.', 'tool')$q$, 'valid tool request');
select pg_temp.accepts($q$select public.submit_wanted('TEST agent', E'Line one\nLine two with Node.js and web3.py and e.g. examples.', null)$q$, 'newline in description, Node.js / web3.py / e.g. allowed, null kind → any');
select pg_temp.accepts($q$select public.submit_wanted(repeat('t', 100), repeat('d', 500), 'AGENT')$q$, 'title 100 / description 500 chars (max), kind case-insensitive');
select pg_temp.rejects($q$select public.submit_wanted(repeat('t', 101), 'd', 'any')$q$, 'Title is required', 'title 101 chars');
select pg_temp.rejects($q$select public.submit_wanted('   ', 'd', 'any')$q$, 'Title is required', 'blank title');
select pg_temp.rejects($q$select public.submit_wanted('t', repeat('d', 501), 'any')$q$, 'Description is required', 'description 501 chars');
select pg_temp.rejects($q$select public.submit_wanted('t', '', 'any')$q$, 'Description is required', 'empty description');
select pg_temp.rejects($q$select public.submit_wanted('t', 'd', 'bot')$q$, 'Type must be', 'invalid kind');
select pg_temp.rejects($q$select public.submit_wanted('t', 'see https://evil.example/x', 'any')$q$, 'links', 'https URL');
select pg_temp.rejects($q$select public.submit_wanted('t', 'see http://evil', 'any')$q$, 'links', 'http URL');
select pg_temp.rejects($q$select public.submit_wanted('visit www.evil', 'd', 'any')$q$, 'links', 'www.');
select pg_temp.rejects($q$select public.submit_wanted('t', 'go to evil.com now', 'any')$q$, 'links', 'bare domain .com');
select pg_temp.rejects($q$select public.submit_wanted('t', 'Join t.me/group', 'any')$q$, 'links', 'bare domain t.me');
select pg_temp.rejects($q$select public.submit_wanted('t', 'like EXAMPLE.IO', 'any')$q$, 'links', 'uppercase domain');
select pg_temp.rejects($q$select public.submit_wanted('t', 'ip 10.0.0.1 here', 'any')$q$, 'links', 'IP address');
select pg_temp.rejects($q$select public.submit_wanted('t', 'ftp://x', 'any')$q$, 'links', 'other scheme ://');
select pg_temp.rejects($q$select public.submit_wanted(E'ti\ttle', 'd', 'any')$q$, 'control', 'tab in title');
select pg_temp.rejects($q$select public.submit_wanted(E'ti\ntle', 'd', 'any')$q$, 'control', 'newline in title');
select pg_temp.rejects($q$select public.submit_wanted('t', E'bell \x07', 'any')$q$, 'control', 'control char in description');
select pg_temp.rejects($q$select public.submit_wanted('t', E'zero​width', 'any')$q$, 'invisible', 'zero-width char');
select pg_temp.rejects($q$select public.submit_wanted('t', E'bidi ‮ text', 'any')$q$, 'invisible', 'bidi override');
reset role;

select pg_temp.ok((select count(*) from public.wanted) = 3, '3 valid requests stored');
select pg_temp.ok((select bool_and(approved = false and closed = false and notified_at is null and approved_at is null) from public.wanted), 'new requests are pending');
select pg_temp.ok((select kind from public.wanted where title = 'TEST agent') = 'any', 'null kind stored as any');
select pg_temp.ok((select kind from public.wanted where title = repeat('t', 100)) = 'agent', 'kind lowercased');

-- ---------- tidak ada INSERT / UPDATE / DELETE langsung ----------
set role anon;
select pg_temp.rejects($q$insert into public.wanted (title, description) values ('x', 'y')$q$, 'permission denied', 'anon direct insert');
select pg_temp.rejects($q$update public.wanted set approved = true$q$, 'permission denied', 'anon update');
select pg_temp.rejects($q$delete from public.wanted$q$, 'permission denied', 'anon delete');
reset role;
set role authenticated;
select pg_temp.rejects($q$insert into public.wanted (title, description) values ('x', 'y')$q$, 'permission denied', 'authenticated direct insert');
reset role;

-- ---------- RLS: pending tidak terlihat ----------
set role anon;
select pg_temp.ok((select count(*) from public.wanted) = 0, 'anon sees no pending requests');
select pg_temp.ok((select count(*) from public.get_wanted(50)) = 0, 'get_wanted hides pending');
select pg_temp.rejects($q$select approved from public.wanted$q$, 'permission denied', 'anon cannot read approved column');
select pg_temp.rejects($q$select notified_at from public.wanted$q$, 'permission denied', 'anon cannot read notified_at');
reset role;

-- approve satu, close satu, satu kedaluwarsa (service role, seperti workflow)
update public.wanted set approved = true where title = 'TEST MCP server for order books';
insert into public.wanted (id, title, description, kind, approved, created_at)
values
  ('c0000000-0000-4000-8000-000000000001', 'TEST closed', 'd', 'any', true, now() - interval '1 day'),
  ('c0000000-0000-4000-8000-000000000002', 'TEST expired', 'd', 'any', true, now() - interval '61 days'),
  ('c0000000-0000-4000-8000-000000000003', 'TEST open agent', 'd', 'agent', true, now() - interval '2 days');
update public.wanted set closed = true where title = 'TEST closed';
select pg_temp.ok((select approved_at is not null from public.wanted where title = 'TEST MCP server for order books'), 'approved_at set by trigger');

set role anon;
select pg_temp.ok((select string_agg(title, ',' order by title) from public.wanted) = 'TEST MCP server for order books,TEST open agent', 'anon sees only approved, open, < 60 days');
select pg_temp.ok((select string_agg(title, ',' order by created_at desc) from public.get_wanted(50)) = 'TEST MCP server for order books,TEST open agent', 'get_wanted: same rows, newest first');
select pg_temp.ok(
  pg_get_function_result('public.get_wanted(integer)'::regprocedure)
    = 'TABLE(id uuid, title text, description text, kind text, created_at timestamp with time zone, answers_count integer)',
  'get_wanted result columns');
select pg_temp.ok((select count(*) from public.get_wanted(1)) = 1, 'get_wanted limit');
reset role;

-- ---------- agents.wanted_id ----------
set role anon;
-- menjawab permintaan yang tampil → boleh
insert into public.agents (name, description, version, repo_url, category, wanted_id, status_token)
select 'TEST answer', 'd', '1', 'https://github.com/x/a', '{t}', id, 'e0000000-0000-4000-8000-000000000001'
from public.wanted where title = 'TEST open agent';
select pg_temp.ok(true, 'anon can submit a listing answering an open request');
-- tanpa wanted_id → tetap boleh
insert into public.agents (name, description, version, repo_url, category, status_token)
values ('TEST plain', 'd', '1', 'https://github.com/x/p', '{t}', 'e0000000-0000-4000-8000-000000000002');
select pg_temp.ok(true, 'anon can submit a listing without wanted_id');
select pg_temp.rejects($q$insert into public.agents (name, description, version, repo_url, wanted_id) values ('x', 'd', '1', 'r', 'c0000000-0000-4000-8000-000000000001')$q$, 'row-level security', 'answering a closed request');
select pg_temp.rejects($q$insert into public.agents (name, description, version, repo_url, wanted_id) values ('x', 'd', '1', 'r', 'c0000000-0000-4000-8000-000000000002')$q$, 'row-level security', 'answering an expired request');
select pg_temp.rejects($q$insert into public.agents (name, description, version, repo_url, wanted_id) select 'x', 'd', '1', 'r', '00000000-0000-4000-8000-0000000000ff'$q$, null, 'answering a non-existent request');
select pg_temp.rejects($q$insert into public.agents (name, description, version, repo_url, approved, wanted_id) values ('x', 'd', '1', 'r', true, null)$q$, 'row-level security', 'other INSERT conditions still apply (approved = true)');
select pg_temp.rejects($q$insert into public.agents (name, description, version, repo_url, live_status) values ('x', 'd', '1', 'r', 'up')$q$, 'row-level security', 'other INSERT conditions still apply (live_status)');
reset role;
-- pending request: sebagai service role buat dulu, lalu anon coba jawab
insert into public.wanted (id, title, description) values ('c0000000-0000-4000-8000-000000000004', 'TEST pending target', 'd');
set role anon;
select pg_temp.rejects($q$insert into public.agents (name, description, version, repo_url, wanted_id) values ('x', 'd', '1', 'r', 'c0000000-0000-4000-8000-000000000004')$q$, 'row-level security', 'answering a pending request');
reset role;

-- builder tidak bisa mengubah wanted_id
set role anon;
select pg_temp.rejects($q$update public.agents set wanted_id = null$q$, 'permission denied', 'anon update wanted_id');
select 1 from public.update_submission('e0000000-0000-4000-8000-000000000001', 'edited description', null, null, '2', array['t']);
reset role;
select pg_temp.ok(
  (select wanted_id = 'c0000000-0000-4000-8000-000000000003' and description = 'edited description' from public.agents where name = 'TEST answer'),
  'update_submission edits the listing but keeps wanted_id');
select pg_temp.ok((select prosrc from pg_proc where proname = 'update_submission') !~ 'wanted', 'update_submission never mentions wanted_id');
select pg_temp.ok((select pronargs from pg_proc where proname = 'update_submission') = 6, 'update_submission signature unchanged (no wanted parameter)');

-- answers_count hanya listing approved
set role anon;
select pg_temp.ok((select answers_count from public.get_wanted(50) where title = 'TEST open agent') = 0, 'pending answer not counted');
reset role;
update public.agents set approved = true where name = 'TEST answer';
set role anon;
select pg_temp.ok((select answers_count from public.get_wanted(50) where title = 'TEST open agent') = 1, 'approved answer counted');
reset role;

-- on delete set null
delete from public.wanted where id = 'c0000000-0000-4000-8000-000000000003';
select pg_temp.ok((select wanted_id is null from public.agents where name = 'TEST answer'), 'deleting a request sets wanted_id to null');

-- ---------- batas 20 pending ----------
delete from public.wanted where approved = false;
set role anon;
select public.submit_wanted('TEST pending ' || g, 'd', 'any') from generate_series(1, 20) g;
select pg_temp.ok(true, '20 pending requests accepted');
select pg_temp.rejects($q$select public.submit_wanted('TEST pending 21', 'd', 'any')$q$, 'Too many requests are waiting', '21st pending request');
reset role;
-- setelah satu disetujui, slot terbuka lagi
update public.wanted set approved = true where title = 'TEST pending 1';
set role anon;
select pg_temp.accepts($q$select public.submit_wanted('TEST pending 21', 'd', 'any')$q$, 'slot frees up after approval');
reset role;

-- ---------- grant ----------
select pg_temp.ok(has_function_privilege('anon', 'public.submit_wanted(text, text, text)', 'execute'), 'anon can execute submit_wanted');
select pg_temp.ok(has_function_privilege('anon', 'public.get_wanted(integer)', 'execute'), 'anon can execute get_wanted');
select pg_temp.ok(
  not exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.proname in ('submit_wanted', 'get_wanted') and a.grantee = 0),
  'no EXECUTE for PUBLIC');
select pg_temp.ok((select provolatile from pg_proc where proname = 'get_wanted') = 's', 'get_wanted is STABLE (read-only)');
select pg_temp.ok((select relrowsecurity from pg_class where oid = 'public.wanted'::regclass), 'RLS enabled on wanted');
