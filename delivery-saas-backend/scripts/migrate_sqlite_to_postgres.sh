#!/usr/bin/env bash
set -euo pipefail

# Migrate SQLite (dev) to Postgres using pgloader.
# Usage:
#   ./migrate_sqlite_to_postgres.sh --sqlite ./prisma/dev.db --pg "postgres://user:pass@host:port/dbname?sslmode=disable"
# If --pg is not provided, the script will try to read DATABASE_URL env var.

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
TEMPLATE_FILE="$SCRIPT_DIR/../../prisma/pgloader_exclude_migrations.load"

function usage() {
  cat <<EOF
Usage: $0 --sqlite PATH --pg POSTGRES_URL

Generates a pgloader .load file from template and runs pgloader to migrate
the SQLite dev DB into the target Postgres database.

Options:
  --sqlite PATH         Path to the SQLite file (default: prisma/dev.db)
  --pg URL              Target Postgres URL (or set DATABASE_URL env var)
  --dry-run             Print generated .load file and exit
  --help                Show this help
EOF
}

SQLITE_PATH="prisma/dev.db"
PG_URL=""
DRY_RUN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --sqlite) SQLITE_PATH="$2"; shift 2;;
    --pg) PG_URL="$2"; shift 2;;
    --dry-run) DRY_RUN=1; shift;;
    --help) usage; exit 0;;
    *) echo "Unknown arg: $1" >&2; usage; exit 2;;
  esac
done

if [[ -z "$PG_URL" ]]; then
  if [[ -n "${DATABASE_URL-}" ]]; then
    PG_URL="$DATABASE_URL"
  else
    echo "Error: target Postgres URL not provided. Use --pg or set DATABASE_URL." >&2
    exit 2
  fi
fi

if [[ ! -f "$TEMPLATE_FILE" ]]; then
  echo "Template file not found: $TEMPLATE_FILE" >&2
  exit 2
fi

if [[ ! -f "$SQLITE_PATH" ]]; then
  echo "SQLite file not found: $SQLITE_PATH" >&2
  exit 2
fi

TMP_LOAD=$(mktemp /tmp/pgloader-XXXX.load)
trap 'rm -f "$TMP_LOAD"' EXIT

# Read template and replace placeholder paths (simple replacement of sqlite path and pg url)
sed \
  -e "s|FROM sqlite:///data/dev.db|FROM sqlite:///${SQLITE_PATH}|g" \
  -e "s|INTO postgres://tomgomes:03t01F007TF@72.60.7.28:5555/tomgomes_migrated_clean?sslmode=disable|INTO ${PG_URL}|g" \
  "$TEMPLATE_FILE" > "$TMP_LOAD"

echo "Generated pgloader file: $TMP_LOAD"
echo "-----"
cat "$TMP_LOAD"
echo "-----"

if [[ $DRY_RUN -eq 1 ]]; then
  echo "Dry run complete. Not executing pgloader.";
  exit 0
fi

# Check for pgloader
if ! command -v pgloader >/dev/null 2>&1; then
  echo "pgloader is not installed. You can install it with your package manager, or run via docker:" >&2
  echo "  sudo apt install -y pgloader || see https://pgloader.io/ for install options" >&2
  echo "Or run via docker:" >&2
  echo "  docker run --rm --network host --volume $(pwd):/data dimitri/pgloader pgloader $TMP_LOAD" >&2
  exit 2
fi

echo "Running pgloader..."
pgloader "$TMP_LOAD"

echo "pgloader finished. Verify target DB contents." 
