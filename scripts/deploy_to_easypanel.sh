#!/usr/bin/env bash
set -euo pipefail

# Usage:
# ./scripts/deploy_to_easypanel.sh <ssh_target> <remote_dir> <backend_image> <frontend_image> [local_env_file]
# Example:
# ./scripts/deploy_to_easypanel.sh user@server.com /home/user/deploy ghcr.io/OWNER/projetodelivery-backend:develop ghcr.io/OWNER/projetodelivery-frontend:develop ./prod.env

SSH_TARGET="$1"
REMOTE_DIR="$2"
BACKEND_IMAGE="$3"
FRONTEND_IMAGE="$4"
LOCAL_ENV_FILE="${5:-}"

if [ -z "$SSH_TARGET" ] || [ -z "$REMOTE_DIR" ] || [ -z "$BACKEND_IMAGE" ] || [ -z "$FRONTEND_IMAGE" ]; then
  echo "Usage: $0 <ssh_target> <remote_dir> <backend_image> <frontend_image> [local_env_file]"
  exit 2
fi

ROOT_DIR=$(dirname "$(realpath "$0")")/..   # repo root (scripts dir is inside repo)
COMPOSE_LOCAL="$ROOT_DIR/docker-compose.prod.yml"
TMP_COMPOSE="/tmp/docker-compose.deploy.yml"

echo "Preparing docker-compose with provided image tags..."
sed "s|\${BACKEND_IMAGE}|${BACKEND_IMAGE}|g; s|\${FRONTEND_IMAGE}|${FRONTEND_IMAGE}|g" "$COMPOSE_LOCAL" > "$TMP_COMPOSE"

echo "Uploading compose file to remote: $SSH_TARGET:$REMOTE_DIR/docker-compose.yml"
ssh "$SSH_TARGET" "mkdir -p '$REMOTE_DIR'"
scp "$TMP_COMPOSE" "$SSH_TARGET:$REMOTE_DIR/docker-compose.yml"

if [ -n "$LOCAL_ENV_FILE" ] && [ -f "$LOCAL_ENV_FILE" ]; then
  echo "Uploading env file to remote: $LOCAL_ENV_FILE -> $REMOTE_DIR/.env"
  scp "$LOCAL_ENV_FILE" "$SSH_TARGET:$REMOTE_DIR/.env"
fi

echo "Preparing remote environment, running migrations and restarting stack..."
ssh "$SSH_TARGET" bash -lc "set -e
cd '$REMOTE_DIR'
# ensure db is up so migrations can run
docker compose -f docker-compose.yml up -d db
# pull latest images (don't fail the deploy on pull error)
docker compose -f docker-compose.yml pull || true
# run prisma migrations in a one-off container using the backend service
echo 'Running Prisma migrations...'
docker compose -f docker-compose.yml run --rm backend sh -lc 'npx prisma migrate deploy'
# finally bring the whole stack up
docker compose -f docker-compose.yml up -d --no-build
"

echo "Deploy complete."
