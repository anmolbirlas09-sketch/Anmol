#!/usr/bin/env bash
# Starts a local Postgres for the DB test suite (Debian/Ubuntu package layout).
# The tests only need a superuser connection; set DATABASE_URL to use any
# other Postgres 15+ (e.g. `supabase start` → postgres://postgres:postgres@127.0.0.1:54322/postgres).
set -euo pipefail
if pg_isready -h 127.0.0.1 -p 5432 >/dev/null 2>&1; then
  echo "Postgres already running"; exit 0
fi
if [ "$(id -u)" -eq 0 ]; then
  service postgresql start
  su postgres -c "psql -qc \"alter user postgres password 'postgres'\""
else
  sudo service postgresql start
  sudo -u postgres psql -qc "alter user postgres password 'postgres'"
fi
echo "Postgres ready at postgres://postgres:postgres@127.0.0.1:5432/postgres"
