#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-shuziren}"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT/compose.runtime.yml}"
COMPOSE_ENV_FILE="${COMPOSE_ENV_FILE:-$ROOT/.deploy.env}"
FRONTEND_URL="${FRONTEND_URL:-http://127.0.0.1:${WEB_PORT:-8080}}"
API_BASE_URL="${API_BASE_URL:-${FRONTEND_URL%/}/api}"
VERIFY_TIMEOUT_SECONDS="${VERIFY_TIMEOUT_SECONDS:-10}"
HEALTH_DEEP_TOKEN="${HEALTH_DEEP_TOKEN:-}"

read_env_value() {
  local key="$1"
  local file="$2"
  awk -F= -v key="$key" '
    $1 == key {
      value = substr($0, index($0, "=") + 1)
      gsub(/\r$/, "", value)
      print value
      exit
    }
  ' "$file"
}

require_file() {
  local file="$1"
  if [[ ! -f "$file" ]]; then
    echo "[X] Missing required file: $file" >&2
    exit 1
  fi
}

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "[X] Missing required command: $cmd" >&2
    exit 1
  fi
}

compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose --env-file "$COMPOSE_ENV_FILE" -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" "$@"
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose --env-file "$COMPOSE_ENV_FILE" -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" "$@"
  else
    echo "[X] Missing docker compose plugin or docker-compose binary" >&2
    exit 1
  fi
}

require_cmd docker
require_cmd curl
require_file "$COMPOSE_FILE"
require_file "$COMPOSE_ENV_FILE"

APP_VERSION="$(read_env_value APP_VERSION "$COMPOSE_ENV_FILE")"
GIT_COMMIT="$(read_env_value GIT_COMMIT "$COMPOSE_ENV_FILE")"
BUILD_TIME_UTC="$(read_env_value BUILD_TIME_UTC "$COMPOSE_ENV_FILE")"
VITE_API_BASE_URL="$(read_env_value VITE_API_BASE_URL "$COMPOSE_ENV_FILE")"

echo ">>> Runtime verify env"
echo "APP_VERSION=$APP_VERSION"
echo "GIT_COMMIT=$GIT_COMMIT"
echo "BUILD_TIME_UTC=$BUILD_TIME_UTC"
echo "VITE_API_BASE_URL=$VITE_API_BASE_URL"

if [[ -z "$APP_VERSION" ]]; then
  echo "[X] APP_VERSION is empty in $COMPOSE_ENV_FILE" >&2
  exit 1
fi

echo ">>> docker compose config"
compose config >/dev/null

echo ">>> docker compose ps"
compose ps

echo ">>> verify API health"
curl -fsS --connect-timeout 3 --max-time "$VERIFY_TIMEOUT_SECONDS" "${API_BASE_URL%/}/health" >/dev/null
if [[ -n "$HEALTH_DEEP_TOKEN" ]]; then
  curl -fsS --connect-timeout 3 --max-time "$VERIFY_TIMEOUT_SECONDS" \
    -H "X-Health-Token: ${HEALTH_DEEP_TOKEN}" \
    "${API_BASE_URL%/}/health/deep" >/dev/null
else
  curl -fsS --connect-timeout 3 --max-time "$VERIFY_TIMEOUT_SECONDS" "${API_BASE_URL%/}/health/deep" >/dev/null
fi

echo "[OK] runtime verify completed"
