#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-shuziren}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
SOURCE_ENV_FILE="${SOURCE_ENV_FILE:-.env}"
COMPOSE_ENV_FILE="${COMPOSE_ENV_FILE:-.deploy.env}"
WEB_PORT="${WEB_PORT:-8080}"
WEB_BIND_HOST="${WEB_BIND_HOST:-127.0.0.1}"
PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-http://127.0.0.1:${WEB_PORT}}"
API_BASE_URL="${API_BASE_URL:-${PUBLIC_BASE_URL%/}/api}"
ALLOW_INSECURE_PROD="${ALLOW_INSECURE_PROD:-0}"

export COMPOSE_PROJECT_NAME
export WEB_PORT
export WEB_BIND_HOST
export PUBLIC_BASE_URL
export API_BASE_URL

write_deploy_env() {
  local output="$1"
  local source_env="$2"
  : > "$output"
  if [[ -f "$source_env" ]]; then
    awk -F= '
      BEGIN {
        split("APP_VERSION GIT_COMMIT BUILD_TIME_UTC VITE_API_BASE_URL COMPOSE_PROJECT_NAME COMPOSE_FILE COMPOSE_ENV_FILE", keys, " ")
        for (i in keys) skip[keys[i]] = 1
      }
      /^[[:space:]]*$/ || /^[[:space:]]*#/ { print; next }
      {
        key = $1
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", key)
        if (!(key in skip)) print
      }
    ' "$source_env" >> "$output"
  fi
  {
    echo
    echo "APP_VERSION=$APP_VERSION"
    echo "GIT_COMMIT=$GIT_COMMIT"
    echo "BUILD_TIME_UTC=$BUILD_TIME_UTC"
    echo "VITE_API_BASE_URL=${VITE_API_BASE_URL:-/api}"
    echo "COMPOSE_PROJECT_NAME=$COMPOSE_PROJECT_NAME"
    echo "COMPOSE_FILE=$COMPOSE_FILE"
    echo "COMPOSE_ENV_FILE=$COMPOSE_ENV_FILE"
    echo "WEB_PORT=$WEB_PORT"
    echo "WEB_BIND_HOST=$WEB_BIND_HOST"
    echo "PUBLIC_BASE_URL=$PUBLIC_BASE_URL"
    echo "PUBLIC_UPLOAD_BASE_URL=${PUBLIC_UPLOAD_BASE_URL:-${PUBLIC_BASE_URL%/}/uploads}"
    echo "API_BASE_URL=$API_BASE_URL"
  } >> "$output"
  chmod 600 "$output"
}

compose_base_args=(--env-file "$COMPOSE_ENV_FILE" -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE")

compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "${compose_base_args[@]}" "$@"
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose "${compose_base_args[@]}" "$@"
  else
    echo "[X] Missing docker compose plugin or docker-compose binary" >&2
    exit 1
  fi
}

rollback_on_failure() {
  local exit_code=$?
  echo "[X] deploy-prod failed with exit code $exit_code" >&2
  if [[ "${AUTO_ROLLBACK_ON_FAIL:-1}" == "1" ]]; then
    echo ">>> Running rollback"
    bash "$ROOT/scripts/rollback.sh" || true
  fi
  exit "$exit_code"
}

trap rollback_on_failure ERR

if [[ ! -f "$SOURCE_ENV_FILE" ]]; then
  echo "[X] Env file not found: $SOURCE_ENV_FILE" >&2
  echo "    Copy .env.example to .env and fill secrets on the server. This script never overwrites .env." >&2
  exit 1
fi

if [[ "$ALLOW_INSECURE_PROD" != "1" && "$PUBLIC_BASE_URL" != https://* ]]; then
  echo "[X] Production PUBLIC_BASE_URL must be HTTPS: $PUBLIC_BASE_URL" >&2
  echo "    Set PUBLIC_BASE_URL=https://your-domain and CORS_ORIGINS=https://your-domain." >&2
  echo "    For isolated local production drills only, set ALLOW_INSECURE_PROD=1." >&2
  exit 1
fi

echo ">>> Pulling latest code"
git pull --ff-only

export GIT_COMMIT="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
export APP_VERSION="${APP_VERSION:-prod-$(date +%Y%m%d%H%M%S)}"
export BUILD_TIME_UTC="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
write_deploy_env "$COMPOSE_ENV_FILE" "$SOURCE_ENV_FILE"

if [[ -z "$(awk -F= '$1=="APP_VERSION"{print $2; exit}' "$COMPOSE_ENV_FILE")" ]]; then
  echo "[X] APP_VERSION is empty in $COMPOSE_ENV_FILE" >&2
  exit 1
fi

echo ">>> Production deployment"
echo "project=$COMPOSE_PROJECT_NAME"
echo "compose_file=$COMPOSE_FILE"
echo "compose_env_file=$COMPOSE_ENV_FILE"
echo "APP_VERSION=$APP_VERSION"
echo "GIT_COMMIT=$GIT_COMMIT"
echo "BUILD_TIME_UTC=$BUILD_TIME_UTC"
echo "VITE_API_BASE_URL=${VITE_API_BASE_URL:-/api}"

COMPOSE_PROJECT_NAME="$COMPOSE_PROJECT_NAME" \
COMPOSE_FILE="$COMPOSE_FILE" \
COMPOSE_ENV_FILE="$COMPOSE_ENV_FILE" \
PREFLIGHT_SKIP_DB=1 \
  bash "$ROOT/scripts/preflight-check.sh"

compose config >/dev/null
compose build
compose up -d mysql

COMPOSE_PROJECT_NAME="$COMPOSE_PROJECT_NAME" \
COMPOSE_FILE="$COMPOSE_FILE" \
COMPOSE_ENV_FILE="$COMPOSE_ENV_FILE" \
  bash "$ROOT/scripts/run-migrations.sh"

COMPOSE_PROJECT_NAME="$COMPOSE_PROJECT_NAME" \
COMPOSE_FILE="$COMPOSE_FILE" \
COMPOSE_ENV_FILE="$COMPOSE_ENV_FILE" \
  bash "$ROOT/scripts/preflight-check.sh"

compose up -d
compose ps

if [[ "$PUBLIC_BASE_URL" == https://* ]]; then
  FRONTEND_URL="$PUBLIC_BASE_URL" API_BASE_URL="$API_BASE_URL" REQUIRE_HTTPS=1 bash "$ROOT/scripts/smoke-test.sh"
else
  FRONTEND_URL="$PUBLIC_BASE_URL" API_BASE_URL="$API_BASE_URL" bash "$ROOT/scripts/smoke-test.sh"
fi

trap - ERR
echo "[OK] production deployed: $PUBLIC_BASE_URL"
