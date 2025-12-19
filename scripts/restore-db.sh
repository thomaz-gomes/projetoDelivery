#!/usr/bin/env bash
# Restore DB dump into the delivery_db service created by docker-compose
# Usage: ./scripts/restore-db.sh /path/to/tomgomes.dump
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DUMP_PATH="${1:-/home/deploy/pgdump/tomgomes.dump}"

echo "Repo dir: $REPO_DIR"
echo "Dump path: $DUMP_PATH"

if [ ! -f "$DUMP_PATH" ]; then
  echo "ERROR: dump not found at $DUMP_PATH"
  exit 1
fi

cd "$REPO_DIR"

echo "(Re)creating delivery_db service..."
docker compose -f "$REPO_DIR/docker-compose.yml" up -d --force-recreate --remove-orphans delivery_db

echo "Waiting a few seconds for container to initialize..."
sleep 4

# try get container id via compose
CID=$(docker compose -f "$REPO_DIR/docker-compose.yml" ps -q delivery_db 2>/dev/null || true)

# fallback searches
if [ -z "$CID" ]; then
  CID=$(docker ps --filter "name=deliverywl-delivery_db" -q | head -n1 || true)
fi
if [ -z "$CID" ]; then
  CID=$(docker ps --filter "name=delivery_db" --format '{{.ID}}' | head -n1 || true)
fi

if [ -z "$CID" ]; then
  echo "ERROR: could not find delivery_db container. Listing containers for diagnostics:" >&2
  docker ps -a --format 'table {{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}' | sed -n '1,200p'
  exit 1
fi

echo "Using container: $CID"

echo "Copying dump into container..."
docker cp "$DUMP_PATH" ${CID}:/tmp/tomgomes.dump

echo "Checking file inside container:"
docker exec -it ${CID} ls -lh /tmp/tomgomes.dump || true

echo "Ensuring database exists (CREATE DATABASE if needed)"
# try create DB (ignore failure)
docker exec -i ${CID} psql -U tomgomes -c "CREATE DATABASE tomgomes OWNER tomgomes;" || true

echo "Running pg_restore (may take a while)..."
docker exec -i ${CID} pg_restore -U tomgomes -d tomgomes /tmp/tomgomes.dump --jobs=2 --verbose

echo "Post-restore: listing tables (first lines)"
docker exec -i ${CID} psql -U tomgomes -d tomgomes -c "\dt" || true

echo "Done. If the app needs restarting, run: docker compose up -d --build"
