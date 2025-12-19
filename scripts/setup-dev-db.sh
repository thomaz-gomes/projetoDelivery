#!/usr/bin/env bash
set -euo pipefail

# scripts/setup-dev-db.sh
# Usage: ./scripts/setup-dev-db.sh [path-to-dump]
# Creates a local Postgres container named 'deliverywl-dev-db' and volume 'deliverywl_dev_db_data'
# Optionally restores a PostgreSQL dump (custom format) into the dev database.

CONTAINER_NAME=deliverywl-dev-db
VOLUME_NAME=deliverywl_dev_db_data
IMAGE=postgres:17
DB_USER=dev
DB_PASSWORD=dev
DB_NAME=delivery_dev
HOST_PORT=5433

echo "Stopping and removing existing container (if any)..."
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  docker rm -f ${CONTAINER_NAME} >/dev/null || true
fi

echo "Creating persistent volume (if missing)..."
docker volume create ${VOLUME_NAME} >/dev/null || true

echo "Starting Postgres container ${CONTAINER_NAME} (user=${DB_USER}, db=${DB_NAME})..."
docker run -d \
  --name ${CONTAINER_NAME} \
  -e POSTGRES_USER=${DB_USER} \
  -e POSTGRES_PASSWORD=${DB_PASSWORD} \
  -e POSTGRES_DB=${DB_NAME} \
  -v ${VOLUME_NAME}:/var/lib/postgresql/data \
  -p ${HOST_PORT}:5432 \
  ${IMAGE}

echo "Waiting for Postgres to accept connections..."
until docker exec ${CONTAINER_NAME} pg_isready -U ${DB_USER} >/dev/null 2>&1; do
  sleep 1
done

if [ "$#" -ge 1 ]; then
  DUMP_PATH="$1"
  if [ ! -f "$DUMP_PATH" ]; then
    echo "Dump file not found: $DUMP_PATH" >&2
    exit 2
  fi

  BASENAME=$(basename "$DUMP_PATH")
  echo "Copying dump into container..."
  docker cp "$DUMP_PATH" ${CONTAINER_NAME}:/tmp/${BASENAME}

  echo "Restoring dump into ${DB_NAME}..."
  # If file ends with .sql, use psql; otherwise try pg_restore
  if [[ "$BASENAME" == *.sql ]]; then
    docker exec -i ${CONTAINER_NAME} psql -U ${DB_USER} -d ${DB_NAME} -f /tmp/${BASENAME}
  else
    docker exec -i ${CONTAINER_NAME} pg_restore -U ${DB_USER} -d ${DB_NAME} /tmp/${BASENAME} || {
      echo "pg_restore failed; leaving container running."
    }
  fi

  echo "Cleaning up dump file inside container..."
  docker exec ${CONTAINER_NAME} rm -f /tmp/${BASENAME}
fi

echo "Development database is available at: postgres://$DB_USER:$DB_PASSWORD@127.0.0.1:$HOST_PORT/$DB_NAME"
echo "Add this URL to your .env.development or set DATABASE_URL accordingly."
