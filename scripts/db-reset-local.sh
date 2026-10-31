#!/usr/bin/env bash
# Recreates a local PostgreSQL database with the Supabase shim + all migrations (+ optional seed).
# Usage: scripts/db-reset-local.sh [dbname] [--seed]
set -euo pipefail
DB="${1:-leadpilot_test}"
SEED="${2:-}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PSQL=(psql -v ON_ERROR_STOP=1 -q -X)

"${PSQL[@]}" -d postgres -c "drop database if exists \"$DB\" with (force);" -c "create database \"$DB\";"
"${PSQL[@]}" -d "$DB" -f "$ROOT/supabase/tests/supabase_shim.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d "$DB" -f "$f"
done
# service_role needs explicit grants on objects created before default privileges applied to it (mirrors Supabase).
"${PSQL[@]}" -d "$DB" -c "grant all on all tables in schema public to service_role; grant all on all sequences in schema public to service_role;"
if [[ "$SEED" == "--seed" && -f "$ROOT/supabase/seed.sql" ]]; then
  "${PSQL[@]}" -d "$DB" -f "$ROOT/supabase/seed.sql"
fi
echo "Database $DB ready."
