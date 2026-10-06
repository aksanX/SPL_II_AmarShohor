#!/usr/bin/env bash
# Runs the migrations + end-to-end scenarios against a LOCAL Postgres with PostGIS.
# Creates/drops throwaway databases amarshohor_test (v1 only) and amarshohor_test_v3 (all migrations).
# Storage (0004) and pg_cron (0005) need Supabase, so they are skipped here.
set -euo pipefail
cd "$(dirname "$0")"

setup() {  # $1 = database, rest = migration files
  local db=$1; shift
  psql -h localhost -d postgres -qc "drop database if exists $db" -c "create database $db"
  psql -h localhost -d "$db" -q -v ON_ERROR_STOP=1 -f supabase_stub.sql
  for f in "$@"; do
    psql -h localhost -d "$db" -q -v ON_ERROR_STOP=1 -f "$f" 2>&1 | grep -v NOTICE || true
  done
  psql -h localhost -d "$db" -q -v ON_ERROR_STOP=1 -f ../seed.sql 2>&1 | grep -v NOTICE || true
}

echo "=== v1 behaviour (migrations 0001-0003, 0006)"
setup amarshohor_test ../migrations/2026100300000{1,2,3}_*.sql ../migrations/20261005000006_*.sql
psql -h localhost -d amarshohor_test -q -f scenario.sql 2>&1 | grep -E "^---|ok  |FAIL|ERROR"

# Every migration except storage (needs Supabase Storage). New files are picked up automatically.
ALL=$(ls ../migrations/*.sql | grep -v '_storage.sql')

echo "=== All migrations: the v2 scenario still passes"
setup amarshohor_test_v3 $ALL
v2_problems=$(psql -h localhost -d amarshohor_test_v3 -q -f scenario_v2.sql 2>&1 | grep -E "FAIL|ERROR" || true)
if [ -n "$v2_problems" ]; then echo "$v2_problems"; else echo "v2 scenario: all ok"; fi

echo "=== All migrations: loops, stale issues, safety, spam and appeals (0011, 0022, 0025)"
setup amarshohor_test_v3 $ALL
psql -h localhost -d amarshohor_test_v3 -q -f scenario_v3.sql 2>&1 | grep -E "^---|ok  |FAIL|ERROR"
echo "Done. Any line with FAIL or ERROR above is a problem."
