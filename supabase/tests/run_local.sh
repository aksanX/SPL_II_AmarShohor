#!/usr/bin/env bash
# Runs the migrations + the end-to-end scenario against a LOCAL Postgres with PostGIS
# (e.g. Postgres.app). Creates/drops a throwaway database called amarshohor_test.
set -euo pipefail
cd "$(dirname "$0")"
DB=amarshohor_test
psql -h localhost -d postgres -qc "drop database if exists $DB" -c "create database $DB"
psql -h localhost -d $DB -q -v ON_ERROR_STOP=1 -f supabase_stub.sql
for f in ../migrations/2026100300000{1,2,3}_*.sql; do
  psql -h localhost -d $DB -q -v ON_ERROR_STOP=1 -f "$f" 2>&1 | grep -v NOTICE || true
done
psql -h localhost -d $DB -q -f scenario.sql 2>&1 | grep -E "^---|ok  |FAIL|ERROR"
echo "Done. Any line with FAIL or ERROR above is a problem."
