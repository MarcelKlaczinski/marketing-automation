#!/usr/bin/env bash
# Local development PostgreSQL setup for marketing-automation platform.
# Idempotent — safe to run multiple times.
#
# Prerequisites:
#   - PostgreSQL running (e.g. `brew services start postgresql@18`)
#   - psql available on PATH
#
# Reads DB name and credentials from .env at repo root.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
ENV_FILE="$REPO_ROOT/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE not found. Copy .env.example to .env first."
  exit 1
fi

# Source .env (basic parsing — assumes KEY=VALUE format, no spaces)
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERROR: DATABASE_URL not set in .env"
  exit 1
fi

# Parse DATABASE_URL: postgres://USER:PASS@HOST:PORT/DBNAME
if [[ "$DATABASE_URL" =~ postgres://([^:]+):([^@]+)@([^:/]+):?([0-9]*)/(.+) ]]; then
  DB_USER="${BASH_REMATCH[1]}"
  DB_PASS="${BASH_REMATCH[2]}"
  DB_HOST="${BASH_REMATCH[3]}"
  DB_PORT="${BASH_REMATCH[4]:-5432}"
  DB_NAME="${BASH_REMATCH[5]%%\?*}"  # strip query params
else
  echo "ERROR: Could not parse DATABASE_URL: $DATABASE_URL"
  exit 1
fi

echo "Setup target:"
echo "  User:     $DB_USER"
echo "  Database: $DB_NAME"
echo "  Host:     $DB_HOST:$DB_PORT"
echo ""

# Create role if missing
# Note: DB_PASS is interpolated directly into SQL. Passwords with single quotes or
# backslashes will break this command. Use a simple alphanumeric password in .env for local dev.
ROLE_EXISTS=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$(whoami)" postgres -tAc \
  "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" 2>/dev/null || echo "")

if [[ -z "$ROLE_EXISTS" ]]; then
  echo "Creating role $DB_USER..."
  psql -h "$DB_HOST" -p "$DB_PORT" -U "$(whoami)" postgres -c \
    "CREATE ROLE $DB_USER WITH LOGIN PASSWORD '$DB_PASS' CREATEDB"
else
  echo "Role $DB_USER already exists, skipping creation."
fi

# Create database if missing
DB_EXISTS=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$(whoami)" postgres -tAc \
  "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" 2>/dev/null || echo "")

if [[ -z "$DB_EXISTS" ]]; then
  echo "Creating database $DB_NAME owned by $DB_USER..."
  psql -h "$DB_HOST" -p "$DB_PORT" -U "$(whoami)" postgres -c \
    "CREATE DATABASE $DB_NAME OWNER $DB_USER"
else
  echo "Database $DB_NAME already exists, skipping creation."
fi

# Grant + extensions
psql "$DATABASE_URL" -c "CREATE EXTENSION IF NOT EXISTS pgcrypto;" || true
psql "$DATABASE_URL" -c "CREATE EXTENSION IF NOT EXISTS vector;" || \
  echo "WARNING: vector extension not available. Install pgvector for Spec 24 (internal linking) to work."

echo ""
echo "PostgreSQL setup complete."
echo ""
echo "Next steps:"
echo "  1. Run migrations:        bun run db:migrate"
echo "  2. Apply cost defaults:   bun --env-file .env apps/api/src/scripts/apply-cost-defaults.ts"
echo "  3. Backfill pillars:      bun --env-file .env apps/api/src/scripts/backfill-pillar-articles.ts"
echo "  4. Verify with tests:     bun test"
