-- ============================================================
-- PERINGATAN: file ini MEMBUAT DATA TEST (listing "TEST ...", permintaan
-- tanda tangan, dan bukti palsu). Hanya untuk database lokal yang dibuat
-- oleh tests/sql/run-owner-proof.sh. JANGAN jalankan di Supabase asli.
-- ============================================================
\set ON_ERROR_STOP 1

create or replace function pg_temp.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FAILED: %', label; end if;
  raise notice 'OK: %', label;
end $$;

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

-- Listing TEST (service role / postgres). status_token di-hash oleh trigger.
insert into public.agents (id, name, description, version, repo_url, category, approved, contract_address, status_token)
values
  ('a0000000-0000-4000-8000-000000000001', 'TEST Approved with contract', 'd', '1', 'https://github.com/x/1', '{t}', true,  '0x467B7A85F55BD716CB16D59F63B8CCAC08852A6D', 'f0000000-0000-4000-8000-000000000001'),
  ('a0000000-0000-4000-8000-000000000002', 'TEST Pending with contract',  'd', '1', 'https://github.com/x/2', '{t}', false, '0x1111111111111111111111111111111111111111', 'f0000000-0000-4000-8000-000000000002'),
  ('a0000000-0000-4000-8000-000000000003', 'TEST Approved no contract',   'd', '1', 'https://github.com/x/3', '{t}', true,  null,                                          'f0000000-0000-4000-8000-000000000003');

-- ---------- request_owner_proof ----------
set role anon;
select pg_temp.ok((select count(*) from public.request_owner_proof('00000000-0000-4000-8000-0000000000ff')) = 0, 'unknown token → 0 rows');
select pg_temp.ok((select count(*) from public.request_owner_proof(null)) = 0, 'null token → 0 rows');
select pg_temp.rejects($q$select * from public.request_owner_proof('f0000000-0000-4000-8000-000000000002')$q$, 'once the listing is approved', 'pending listing');
select pg_temp.rejects($q$select * from public.request_owner_proof('f0000000-0000-4000-8000-000000000003')$q$, 'Add a contract address', 'listing without contract');
create temp table first_req as select * from public.request_owner_proof('f0000000-0000-4000-8000-000000000001');
select pg_temp.ok((select count(*) from first_req) = 1, 'approved listing with contract → challenge');
select pg_temp.ok((select nonce ~ '^[0-9a-f]{32}$' from first_req), 'nonce is 32 hex chars');
select pg_temp.ok((select expires_at between now() + interval '9 minutes' and now() + interval '10 minutes 1 second' from first_req), 'expires in about 10 minutes');
select pg_temp.ok((select message like '%Domain: agraris.xyz%' and message like '%Listing ID: a0000000-0000-4000-8000-000000000001%'
                   and message like '%Contract: 0x467b7a85f55bd716cb16d59f63b8ccac08852a6d%' and message like '%Chain ID: 4663%'
                   and message like '%Nonce: ' || nonce || '%' and message ~ 'Expires at: \d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ' from first_req),
                  'message has domain, listing id, lowercase contract, chain ID, nonce, expiry');
select pg_temp.ok((select message !~* '(token|price|verified|trusted|recommended)' from first_req), 'message wording is neutral');
create temp table second_req as select * from public.request_owner_proof('f0000000-0000-4000-8000-000000000001');
select pg_temp.ok((select a.nonce <> b.nonce from first_req a, second_req b), 'every request gets a new nonce');
reset role;
select pg_temp.ok((select status from public.owner_proof_challenges where nonce = (select nonce from first_req)) = 'expired', 'older open request is replaced');

-- ---------- tables are private ----------
set role anon;
select pg_temp.rejects($q$select * from public.owner_proof_challenges$q$, 'permission denied', 'anon cannot read challenges');
select pg_temp.rejects($q$insert into public.owner_proof_challenges (agent_id, contract_address, nonce, message, expires_at) values ('a0000000-0000-4000-8000-000000000001', '0x467b7a85f55bd716cb16d59f63b8ccac08852a6d', '00000000000000000000000000000000', 'm', now())$q$, 'permission denied', 'anon cannot insert challenges');
select pg_temp.rejects($q$insert into public.owner_proofs (agent_id, signer, signed_at, owner_at_check, nonce, contract_address) values ('a0000000-0000-4000-8000-000000000001', '0x1111111111111111111111111111111111111111', now(), '0x1111111111111111111111111111111111111111', 'x', '0x467b7a85f55bd716cb16d59f63b8ccac08852a6d')$q$, 'permission denied', 'anon cannot insert proofs');
select pg_temp.rejects($q$update public.owner_proofs set signer = '0x1111111111111111111111111111111111111111'$q$, 'permission denied', 'anon cannot update proofs');
select pg_temp.rejects($q$delete from public.owner_proofs$q$, 'permission denied', 'anon cannot delete proofs');
reset role;
set role authenticated;
select pg_temp.rejects($q$select * from public.owner_proof_challenges$q$, 'permission denied', 'authenticated cannot read challenges');
reset role;

-- ---------- submit_owner_proof ----------
set role anon;
select pg_temp.rejects(format($q$select * from public.submit_owner_proof('f0000000-0000-4000-8000-000000000001', %L, '0x1234')$q$, (select nonce from second_req)), 'unexpected format', 'short signature');
select pg_temp.rejects(format($q$select * from public.submit_owner_proof('f0000000-0000-4000-8000-000000000001', %L, %L)$q$, (select nonce from first_req), '0x' || repeat('ab', 65)), 'already used', 'replaced (expired) nonce');
select pg_temp.rejects(format($q$select * from public.submit_owner_proof('f0000000-0000-4000-8000-000000000001', %L, %L)$q$, 'fedcba9876543210fedcba9876543210', '0x' || repeat('ab', 65)), 'not found', 'unknown nonce');
select pg_temp.rejects(format($q$select * from public.submit_owner_proof('f0000000-0000-4000-8000-000000000003', %L, %L)$q$, (select nonce from second_req), '0x' || repeat('ab', 65)), 'not found', 'nonce of another listing');
select pg_temp.ok((select count(*) from public.submit_owner_proof('00000000-0000-4000-8000-0000000000ff', (select nonce from second_req), '0x' || repeat('ab', 65))) = 0, 'unknown token → 0 rows');
select pg_temp.ok((select status from public.submit_owner_proof('f0000000-0000-4000-8000-000000000001', (select nonce from second_req), '0x' || repeat('AB', 65))) = 'submitted', 'valid submit');
select pg_temp.rejects(format($q$select * from public.submit_owner_proof('f0000000-0000-4000-8000-000000000001', %L, %L)$q$, (select nonce from second_req), '0x' || repeat('cd', 65)), 'already used', 'replay: same nonce twice');
reset role;
select pg_temp.ok((select signature = '0x' || repeat('ab', 65) and submitted_at is not null and status = 'submitted' from public.owner_proof_challenges where nonce = (select nonce from second_req)), 'signature stored lowercase, first one wins');

-- expired request (simulated by moving expires_at into the past)
set role anon;
create temp table third_req as select * from public.request_owner_proof('f0000000-0000-4000-8000-000000000001');
reset role;
update public.owner_proof_challenges set expires_at = now() - interval '1 second' where nonce = (select nonce from third_req);
set role anon;
select pg_temp.rejects(format($q$select * from public.submit_owner_proof('f0000000-0000-4000-8000-000000000001', %L, %L)$q$, (select nonce from third_req), '0x' || repeat('ab', 65)), 'expired', 'expired request');
reset role;

-- ---------- owner_proofs RLS ----------
insert into public.owner_proofs (agent_id, signer, signed_at, owner_at_check, nonce, contract_address)
values
  ('a0000000-0000-4000-8000-000000000001', '0x2b5ad5c4795c026514f8317c7a215e218dccd6cf', now() - interval '1 day', '0x2b5ad5c4795c026514f8317c7a215e218dccd6cf', 'secretnonce1', '0x467b7a85f55bd716cb16d59f63b8ccac08852a6d'),
  ('a0000000-0000-4000-8000-000000000002', '0x2b5ad5c4795c026514f8317c7a215e218dccd6cf', now(), '0x2b5ad5c4795c026514f8317c7a215e218dccd6cf', 'secretnonce2', '0x1111111111111111111111111111111111111111');
set role anon;
select pg_temp.ok((select count(*) from public.owner_proofs) = 1, 'anon sees proofs of approved listings only');
select pg_temp.ok((select signer from public.owner_proofs where agent_id = 'a0000000-0000-4000-8000-000000000001') = '0x2b5ad5c4795c026514f8317c7a215e218dccd6cf', 'anon reads signer');
select pg_temp.ok((select signed_at is not null from public.owner_proofs), 'anon reads signed_at');
select pg_temp.rejects($q$select nonce from public.owner_proofs$q$, 'permission denied', 'anon cannot read nonce');
select pg_temp.rejects($q$select owner_at_check from public.owner_proofs$q$, 'permission denied', 'anon cannot read owner_at_check');
select pg_temp.rejects($q$select * from public.owner_proofs$q$, 'permission denied', 'anon cannot select * (only public columns)');
reset role;

-- ---------- get_owner_proof_status ----------
set role anon;
select pg_temp.ok((select count(*) from public.get_owner_proof_status('00000000-0000-4000-8000-0000000000ff')) = 0, 'status: unknown token → 0 rows');
select pg_temp.ok((select signer = '0x2b5ad5c4795c026514f8317c7a215e218dccd6cf' and last_status = 'expired' from public.get_owner_proof_status('f0000000-0000-4000-8000-000000000001')), 'status: proof + latest request');
select pg_temp.ok(
  pg_get_function_result('public.get_owner_proof_status(uuid)'::regprocedure)
    = 'TABLE(contract_address text, signer text, signed_at timestamp with time zone, checked_at timestamp with time zone, last_status text, last_reason text, last_at timestamp with time zone)',
  'status RPC returns no nonce, message or signature');
reset role;

-- ---------- contract change removes the proof ----------
set role anon;
select 1 from public.update_submission('f0000000-0000-4000-8000-000000000001', 'd', null, '0x467b7a85f55bd716cb16d59f63b8ccac08852a6d', '1', array['t']);
reset role;
select pg_temp.ok((select count(*) from public.owner_proofs where agent_id = 'a0000000-0000-4000-8000-000000000001') = 1, 'same contract (only case changed) keeps the proof');
select pg_temp.ok((select status = 'submitted' from public.owner_proof_challenges where nonce = (select nonce from second_req)), 'same contract keeps the submitted request');
set role anon;
select 1 from public.update_submission('f0000000-0000-4000-8000-000000000001', 'd', null, '0x9999999999999999999999999999999999999999', '1', array['t']);
reset role;
select pg_temp.ok((select count(*) from public.owner_proofs where agent_id = 'a0000000-0000-4000-8000-000000000001') = 0, 'new contract address → proof removed');
select pg_temp.ok((select status = 'rejected' and reason = 'contract_changed' from public.owner_proof_challenges where nonce = (select nonce from second_req)), 'new contract address → submitted request rejected');
select pg_temp.ok((select prosrc from pg_proc where proname = 'update_submission') !~ 'owner_proof', 'update_submission is unchanged (no owner proof logic)');

-- ---------- rate limit ----------
set role anon;
-- 3 requests already made above; 7 more are fine, the 11th is refused.
do $$ begin for i in 1..7 loop perform public.request_owner_proof('f0000000-0000-4000-8000-000000000001'); end loop; end $$;
select pg_temp.ok(true, '10 requests within an hour accepted');
select pg_temp.rejects($q$select * from public.request_owner_proof('f0000000-0000-4000-8000-000000000001')$q$, 'Too many signing requests', '11th request in an hour');
reset role;

-- ---------- grants ----------
select pg_temp.ok(has_function_privilege('anon', 'public.request_owner_proof(uuid)', 'execute'), 'anon can execute request_owner_proof');
select pg_temp.ok(has_function_privilege('anon', 'public.submit_owner_proof(uuid, text, text)', 'execute'), 'anon can execute submit_owner_proof');
select pg_temp.ok(has_function_privilege('anon', 'public.get_owner_proof_status(uuid)', 'execute'), 'anon can execute get_owner_proof_status');
select pg_temp.ok(not has_function_privilege('anon', 'public.agents_reset_owner_proof()', 'execute'), 'anon cannot execute the trigger function');
select pg_temp.ok(
  not exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.proname in ('request_owner_proof', 'submit_owner_proof', 'get_owner_proof_status') and a.grantee = 0),
  'no EXECUTE for PUBLIC');
select pg_temp.ok((select relrowsecurity from pg_class where oid = 'public.owner_proofs'::regclass) and (select relrowsecurity from pg_class where oid = 'public.owner_proof_challenges'::regclass), 'RLS enabled on both tables');
