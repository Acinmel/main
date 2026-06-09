#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-shuziren-staging}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
COMPOSE_ENV_FILE="${COMPOSE_ENV_FILE:-.deploy.env}"
WEB_PORT="${WEB_PORT:-18080}"
MYSQL_HOST_PORT="${MYSQL_HOST_PORT:-13306}"
PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-http://127.0.0.1:${WEB_PORT}}"
PUBLIC_UPLOAD_BASE_URL="${PUBLIC_UPLOAD_BASE_URL:-${PUBLIC_BASE_URL}/uploads}"
CORS_ORIGINS="${CORS_ORIGINS:-${PUBLIC_BASE_URL},http://127.0.0.1:${WEB_PORT},http://localhost:${WEB_PORT}}"
JWT_SECRET="${JWT_SECRET:-staging-local-change-me}"
APP_VERSION="${APP_VERSION:-staging-$(date +%Y%m%d%H%M%S)}"
MYSQL_DATABASE="${MYSQL_DATABASE:-koubo}"
MYSQL_USER="${MYSQL_USER:-koubo}"
MYSQL_PASSWORD="${MYSQL_PASSWORD:-koubo}"
REGISTRATION_DEFAULT_ACCOUNT_STATUS="${REGISTRATION_DEFAULT_ACCOUNT_STATUS:-pending}"
SMOKE_CHECK_PENDING_REGISTRATION="${SMOKE_CHECK_PENDING_REGISTRATION:-1}"

export COMPOSE_PROJECT_NAME
export WEB_PORT
export MYSQL_HOST_PORT
export PUBLIC_BASE_URL
export PUBLIC_UPLOAD_BASE_URL
export CORS_ORIGINS
export JWT_SECRET
export APP_VERSION
export MYSQL_DATABASE
export MYSQL_USER
export MYSQL_PASSWORD
export REGISTRATION_DEFAULT_ACCOUNT_STATUS
export SMOKE_CHECK_PENDING_REGISTRATION

write_deploy_env() {
  local output="$1"
  {
    echo "APP_VERSION=$APP_VERSION"
    echo "GIT_COMMIT=$(git rev-parse HEAD 2>/dev/null || echo unknown)"
    echo "BUILD_TIME_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "VITE_API_BASE_URL=${VITE_API_BASE_URL:-/api}"
    echo "COMPOSE_PROJECT_NAME=$COMPOSE_PROJECT_NAME"
    echo "COMPOSE_FILE=$COMPOSE_FILE"
    echo "COMPOSE_ENV_FILE=$COMPOSE_ENV_FILE"
    echo "WEB_PORT=$WEB_PORT"
    echo "MYSQL_HOST_PORT=$MYSQL_HOST_PORT"
    echo "PUBLIC_BASE_URL=$PUBLIC_BASE_URL"
    echo "PUBLIC_UPLOAD_BASE_URL=$PUBLIC_UPLOAD_BASE_URL"
    echo "CORS_ORIGINS=$CORS_ORIGINS"
    echo "JWT_SECRET=$JWT_SECRET"
    echo "MYSQL_DATABASE=$MYSQL_DATABASE"
    echo "MYSQL_USER=$MYSQL_USER"
    echo "MYSQL_PASSWORD=$MYSQL_PASSWORD"
    echo "REGISTRATION_DEFAULT_ACCOUNT_STATUS=$REGISTRATION_DEFAULT_ACCOUNT_STATUS"
  } > "$output"
  chmod 600 "$output"
}

compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose --env-file "$COMPOSE_ENV_FILE" "$@"
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose --env-file "$COMPOSE_ENV_FILE" "$@"
  else
    echo "[X] Missing docker compose plugin or docker-compose binary" >&2
    exit 1
  fi
}

write_deploy_env "$COMPOSE_ENV_FILE"
if [[ -z "$(awk -F= '$1=="APP_VERSION"{print $2; exit}' "$COMPOSE_ENV_FILE")" ]]; then
  echo "[X] APP_VERSION is empty in $COMPOSE_ENV_FILE" >&2
  exit 1
fi

echo ">>> staging deployment"
echo "project=$COMPOSE_PROJECT_NAME"
echo "compose_file=$COMPOSE_FILE"
echo "compose_env_file=$COMPOSE_ENV_FILE"
echo "web_port=$WEB_PORT"
echo "mysql_host_port=$MYSQL_HOST_PORT"
echo "public_base_url=$PUBLIC_BASE_URL"
echo "APP_VERSION=$APP_VERSION"

compose -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" config >/dev/null
COMPOSE_PROJECT_NAME="$COMPOSE_PROJECT_NAME" COMPOSE_FILE="$COMPOSE_FILE" COMPOSE_ENV_FILE="$COMPOSE_ENV_FILE" PREFLIGHT_SKIP_DB=1 bash "$ROOT/scripts/preflight-check.sh"
compose -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" up -d mysql
COMPOSE_PROJECT_NAME="$COMPOSE_PROJECT_NAME" COMPOSE_FILE="$COMPOSE_FILE" COMPOSE_ENV_FILE="$COMPOSE_ENV_FILE" bash "$ROOT/scripts/run-migrations.sh"
COMPOSE_PROJECT_NAME="$COMPOSE_PROJECT_NAME" COMPOSE_FILE="$COMPOSE_FILE" COMPOSE_ENV_FILE="$COMPOSE_ENV_FILE" bash "$ROOT/scripts/preflight-check.sh"
compose -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" up -d --build
compose -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" ps

FRONTEND_URL="$PUBLIC_BASE_URL" API_BASE_URL="${PUBLIC_BASE_URL%/}/api" SMOKE_CHECK_PENDING_REGISTRATION="$SMOKE_CHECK_PENDING_REGISTRATION" bash "$ROOT/scripts/smoke-test.sh"

echo
echo "[OK] staging deployed: $PUBLIC_BASE_URL"
