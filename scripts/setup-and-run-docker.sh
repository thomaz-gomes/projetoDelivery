#!/usr/bin/env bash
set -euo pipefail

# Simple bootstrap script to clone a GitHub repo and run Docker Compose.
# Defaults are set for the current project: thomaz-gomes/projetoDelivery, branch digjan12.
# Usage examples:
#   ./scripts/setup-and-run-docker.sh
#   GIT_URL=https://github.com/user/repo.git BRANCH=main ./scripts/setup-and-run-docker.sh
#   ./scripts/setup-and-run-docker.sh --compose docker-compose.dev.yml --no-build

REPO_URL="${GIT_URL:-https://github.com/thomaz-gomes/projetoDelivery.git}"
BRANCH="${BRANCH:-digjan12}"
TARGET_DIR="${TARGET_DIR:-projetoDelivery}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
NO_BUILD=0
PULL=0

usage() {
  cat <<EOF
Usage: $0 [options]

Options:
  --branch BRANCH        Checkout this branch (env BRANCH overrides)
  --compose FILE         Use this compose file (default: $COMPOSE_FILE)
  --target DIR           Clone into this dir (default: $TARGET_DIR)
  --no-build             Do not rebuild images, run 'up -d' only
  --pull                 If clone exists, run git pull instead of error
  -h, --help             Show this help

You can also set environment variables: GIT_URL, BRANCH, TARGET_DIR, COMPOSE_FILE
EOF
}

# simple arg parsing
while [[ $# -gt 0 ]]; do
  case "$1" in
    --branch)
      BRANCH="$2"; shift 2;;
    --compose)
      COMPOSE_FILE="$2"; shift 2;;
    --target)
      TARGET_DIR="$2"; shift 2;;
    --no-build)
      NO_BUILD=1; shift;;
    --pull)
      PULL=1; shift;;
    -h|--help)
      usage; exit 0;;
    *)
      echo "Unknown arg: $1"; usage; exit 1;;
  esac
done

echo "Repo: $REPO_URL"
echo "Branch: $BRANCH"
echo "Target directory: $TARGET_DIR"
echo "Compose file: $COMPOSE_FILE"

# checks
if ! command -v git >/dev/null 2>&1; then
  echo "Error: git not found. Please install git." >&2; exit 2
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Error: docker not found. Please install Docker." >&2; exit 3
fi

# detect docker compose CLI
if docker compose version >/dev/null 2>&1; then
  DOCKER_COMPOSE=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  DOCKER_COMPOSE=(docker-compose)
else
  echo "Error: docker compose not found (neither 'docker compose' nor 'docker-compose')." >&2; exit 4
fi

# clone or update
if [ -d "$TARGET_DIR/.git" ]; then
  echo "Target directory exists and is a git repo: $TARGET_DIR"
  if [ "$PULL" -eq 1 ]; then
    echo "Fetching and pulling latest on $BRANCH"
    git -C "$TARGET_DIR" fetch --all --prune
    git -C "$TARGET_DIR" checkout "$BRANCH"
    git -C "$TARGET_DIR" pull origin "$BRANCH"
  else
    echo "Directory exists. Use --pull to update, or remove the directory to re-clone." >&2
    exit 5
  fi
else
  echo "Cloning $REPO_URL (branch: $BRANCH) into $TARGET_DIR"
  git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$TARGET_DIR"
fi

cd "$TARGET_DIR"

# if compose file is a dev compose and .env missing, try to copy env.dev
if [ ! -f "$COMPOSE_FILE" ]; then
  echo "Compose file '$COMPOSE_FILE' not found in $TARGET_DIR" >&2
  ls -la
  exit 6
fi

if [ ! -f .env ]; then
  if [ -f env.dev ] && [[ "$COMPOSE_FILE" == *dev* ]]; then
    echo "No .env found — copying env.dev -> .env"
    cp env.dev .env
  elif [ -f prod.env.example ] && [[ "$COMPOSE_FILE" == *prod* || "$COMPOSE_FILE" == "docker-compose.yml" ]]; then
    echo "No .env found — copying prod.env.example -> .env"
    cp prod.env.example .env
  else
    echo "No .env file found; Docker Compose may fail if required variables are missing. Continuing anyway."
  fi
fi

# run docker compose
echo "Using compose command: ${DOCKER_COMPOSE[*]} -f $COMPOSE_FILE up -d${NO_BUILD==1 && echo ' (no build)'}"
if [ "$NO_BUILD" -eq 1 ]; then
  "${DOCKER_COMPOSE[@]}" -f "$COMPOSE_FILE" up -d
else
  "${DOCKER_COMPOSE[@]}" -f "$COMPOSE_FILE" up -d --build
fi

echo "Done. To view logs: ${DOCKER_COMPOSE[*]} -f $COMPOSE_FILE logs -f"
