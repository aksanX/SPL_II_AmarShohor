#!/usr/bin/env bash
# Runs the migrations + end-to-end scenarios against a LOCAL Postgres with PostGIS.
# Creates/drops throwaway databases amarshohor_test (v1 only) and amarshohor_test_v3 (all migrations).
# Storage (0004) and pg_cron (0005) need Supabase, so they are skipped here.
# Exits with 1 when any check fails, so GitHub Actions (.github/workflows/ci.yml) marks the run red.
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

run_all() {
echo "=== v1 behaviour (migrations 0001-0003, 0006)"
setup amarshohor_test ../migrations/2026100300000{1,2,3}_*.sql ../migrations/20261005000006_*.sql
psql -h localhost -d amarshohor_test -q -f scenario.sql 2>&1 | grep -E "^---|ok  |FAIL|ERROR|psql:.*error"

# Every migration except storage (needs Supabase Storage). New files are picked up automatically.
ALL=$(ls ../migrations/*.sql | grep -v '_storage.sql')

echo "=== All migrations: the v2 scenario still passes"
setup amarshohor_test_v3 $ALL
v2_problems=$(psql -h localhost -d amarshohor_test_v3 -q -f scenario_v2.sql 2>&1 | grep -E "FAIL|ERROR|psql:.*error" || true)
if [ -n "$v2_problems" ]; then echo "$v2_problems"; else echo "v2 scenario: all ok"; fi

echo "=== All migrations: loops, stale issues, safety, spam, appeals, votes, hexagons and role rules, emergencies (0011, 0022, 0025, 0028-0033)"
setup amarshohor_test_v3 $ALL
psql -h localhost -d amarshohor_test_v3 -q -f scenario_v3.sql 2>&1 | grep -E "^---|ok  |FAIL|ERROR|psql:.*error"

echo "=== All migrations: city admins (0045)"
setup amarshohor_test_v3 $ALL
psql -h localhost -d amarshohor_test_v3 -q -f scenario_v4.sql 2>&1 | grep -E "^---|ok  |FAIL|ERROR|psql:.*error"
}

log=$(mktemp)
run_all 2>&1 | tee "$log"
# "FAIL:" is a failed check; ERROR is a migration or scenario that stopped.
if grep -qE "FAIL:|ERROR|psql:.*error" "$log"; then
  echo "Done, with problems: see the FAIL / ERROR lines above."
  exit 1
fi
echo "Done. All checks passed."
