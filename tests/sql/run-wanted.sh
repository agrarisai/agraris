#!/bin/bash
# ============================================================
# PERINGATAN: skrip ini MEMBUAT DATA TEST (listing dan permintaan wanted
# bernama "TEST ...")
# dan MENGHAPUS LALU MEMBUAT ULANG database "agraris_wanted_test".
# Jalankan HANYA terhadap Postgres lokal / sekali pakai. JANGAN arahkan ke
# database Supabase asli.
# ============================================================
#
# Tes supabase/migration-wanted.sql: meniru role Supabase (anon,
# authenticated, service_role), menjalankan semua migrasi agents
# berurutan, lalu migration-wanted.sql DUA KALI (idempoten),
# lalu tests/sql/wanted-assert.sql.
#
# Pakai: PGHOST=... PGPORT=... PGUSER=postgres tests/sql/run-wanted.sh
set -euo pipefail

case "${PGHOST:-}" in
  *supabase*) echo "Menolak: PGHOST terlihat seperti Supabase. Pakai Postgres lokal." >&2; exit 1 ;;
esac

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DB=agraris_wanted_test
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
  supabase/migration-live-check.sql \
  supabase/migration-recently-updated.sql \
  supabase/migration-wanted.sql supabase/migration-wanted.sql; do
  echo "== $f"
  $P -f "$ROOT/$f" 2>&1 | { grep -v NOTICE || true; }
done
$P -f "$ROOT/tests/sql/wanted-assert.sql" 2>&1 | grep -E "^psql:.*(OK|ERROR)" | sed 's/.*NOTICE: *//; s/.*ERROR: */ERROR: /'
echo "ALL DB ASSERTIONS PASSED"
