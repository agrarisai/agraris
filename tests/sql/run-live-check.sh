#!/bin/bash
# Tes migrasi live check di Postgres lokal (bukan Supabase).
# Membuat database baru, meniru role Supabase (anon, authenticated,
# service_role) dan default grant-nya, menjalankan semua migrasi agents
# berurutan, lalu supabase/migration-live-check.sql DUA KALI (idempoten),
# lalu tests/sql/live-check-assert.sql.
#
# Pakai: PGHOST=... PGPORT=... PGUSER=postgres tests/sql/run-live-check.sh
# (database "agraris_live_check_test" dibuat ulang setiap kali).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DB=agraris_live_check_test
P="psql -v ON_ERROR_STOP=1 -q"
$P -d postgres -c "drop database if exists $DB" -c "create database $DB"
P="$P -d $DB"
$P <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
SQL
for f in migration.sql supabase/migration-verified.sql supabase/migration-github-stats.sql \
  supabase/migration-contract-address.sql supabase/migration-review-queue.sql \
  supabase/migration-submission-status.sql supabase/migration-review-notify.sql \
  supabase/migration-edit-listing.sql supabase/migration-listing-kind.sql \
  supabase/migration-live-check.sql supabase/migration-live-check.sql; do
  echo "== $f"
  $P -f "$ROOT/$f"
done
$P -f "$ROOT/tests/sql/live-check-assert.sql" 2>&1 | grep -E "OK \(rejected\)|ERROR" | sed 's/.*NOTICE: *//'
echo "ALL DB ASSERTIONS PASSED"
