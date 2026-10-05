#!/usr/bin/env bash
# Runs the migrations + end-to-end scenarios against a LOCAL Postgres with PostGIS.
# Creates/drops throwaway databases amarshohor_test (v1) and amarshohor_test_v2.
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

echo "=== v1 behaviour (migrations 0001-0003)"
setup amarshohor_test ../migrations/2026100300000{1,2,3}_*.sql
psql -h localhost -d amarshohor_test -q -f scenario.sql 2>&1 | grep -E "^---|ok  |FAIL|ERROR"

echo "=== v2 (all migrations)"
setup amarshohor_test_v2 ../migrations/2026100300000{1,2,3}_*.sql ../migrations/20261005*.sql
psql -h localhost -d amarshohor_test_v2 -q -f scenario_v2.sql 2>&1 | grep -E "^---|ok  |FAIL|ERROR"
DB=amarshohor_test
psql -h localhost -d postgres -qc "drop database if exists $DB" -c "create database $DB"
psql -h localhost -d $DB -q -v ON_ERROR_STOP=1 -f supabase_stub.sql
for f in ../migrations/20261003000001_*.sql ../migrations/20261003000002_*.sql ../migrations/20261003000003_*.sql ../migrations/20261005000006_*.sql; do
  psql -h localhost -d $DB -q -v ON_ERROR_STOP=1 -f "$f" 2>&1 | grep -v NOTICE || true
done
psql -h localhost -d $DB -q -f scenario.sql 2>&1 | grep -E "^---|ok  |FAIL|ERROR"
echo "Done. Any line with FAIL or ERROR above is a problem."
