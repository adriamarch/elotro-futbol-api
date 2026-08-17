#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$(dirname "$0")/db/migrations/001_initial_schema.sql"

echo "PostgreSQL schema installed successfully."
