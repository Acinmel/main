#!/usr/bin/env bash
# Deploy an artifact-only release package on the production server.
# Usage inside extracted release directory: bash deploy-runtime.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

RUNTIME_DIR="${SHUZIREN_RUNTIME_DIR:-/opt/shuziren-runtime}"
ENV_FILE="${SHUZIREN_ENV_FILE:-$RUNTIME_DIR/.env}"
BACKEND_ENV_FILE="${SHUZIREN_BACKEND_ENV_FILE:-$RUNTIME_DIR/backend.env}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-shuziren}"
COMPOSE_FILE=""
COMPOSE_ENV_FILE=""

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "[X] Missing required command: $cmd" >&2
    exit 1
  fi
}

compose() {
  if [[ -z "${COMPOSE_ENV_FILE:-}" || ! -f "$COMPOSE_ENV_FILE" ]]; then
    echo "[X] Missing compose env file: ${COMPOSE_ENV_FILE:-<empty>}" >&2
    exit 1
  fi
  if [[ -z "${COMPOSE_FILE:-}" || ! -f "$COMPOSE_FILE" ]]; then
    echo "[X] Missing compose file: ${COMPOSE_FILE:-<empty>}" >&2
    exit 1
  fi
  if docker compose version >/dev/null 2>&1; then
    docker compose --env-file "$COMPOSE_ENV_FILE" -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" "$@"
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose --env-file "$COMPOSE_ENV_FILE" -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" "$@"
  else
    echo "[X] Missing docker compose plugin or docker-compose binary" >&2
    exit 1
  fi
}

read_version_value() {
  local key="$1"
  local file="$2"
  awk -F= -v key="$key" '$1 == key { print $2; exit }' "$file"
}

read_env_value() {
  local key="$1"
  local file="$2"
  if [[ -f "$file" ]]; then
    awk -F= -v key="$key" '$1 == key { print $2; exit }' "$file" | tr -d '\r'
  fi
}

write_deploy_env() {
  local output="$1"
  local version_file="$2"
  local runtime_env="$3"
  local backend_env="$4"

  : > "$output"
  if [[ -f "$runtime_env" ]]; then
    awk -F= '
      BEGIN {
        split("APP_VERSION GIT_COMMIT BUILD_TIME_UTC VITE_API_BASE_URL SHUZIREN_ENV_FILE SHUZIREN_BACKEND_ENV_FILE COMPOSE_PROJECT_NAME COMPOSE_FILE COMPOSE_ENV_FILE", keys, " ")
        for (i in keys) skip[keys[i]] = 1
      }
      /^[[:space:]]*$/ || /^[[:space:]]*#/ { print; next }
      {
        key = $1
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", key)
        if (!(key in skip)) print
      }
    ' "$runtime_env" >> "$output"
  fi

  {
    echo
    echo "APP_VERSION=$(read_version_value APP_VERSION "$version_file")"
    echo "GIT_COMMIT=$(read_version_value GIT_COMMIT "$version_file")"
    echo "BUILD_TIME_UTC=$(read_version_value BUILD_TIME_UTC "$version_file")"
    echo "VITE_API_BASE_URL=$(read_version_value VITE_API_BASE_URL "$version_file")"
    echo "SHUZIREN_ENV_FILE=$runtime_env"
    echo "SHUZIREN_BACKEND_ENV_FILE=$backend_env"
    echo "COMPOSE_PROJECT_NAME=$COMPOSE_PROJECT_NAME"
    echo "COMPOSE_FILE=$COMPOSE_FILE"
    echo "COMPOSE_ENV_FILE=$output"
  } >> "$output"
  chmod 600 "$output"
}

print_deploy_env_summary() {
  local file="$1"
  echo ">>> Deploy env"
  for key in APP_VERSION GIT_COMMIT BUILD_TIME_UTC VITE_API_BASE_URL; do
    echo "$key=$(read_env_value "$key" "$file")"
  done
}

wait_for_http() {
  local url="$1"
  local label="$2"
  local attempt
  for attempt in $(seq 1 30); do
    if curl -fsS --connect-timeout 3 --max-time 10 "$url" >/dev/null; then
      echo "[OK] $label: $url"
      return 0
    fi
    sleep 2
  done
  echo "[X] $label health check failed: $url" >&2
  return 1
}

require_cmd docker
require_cmd sha256sum
require_cmd awk
require_cmd curl

if [[ ! -f VERSION ]]; then
  echo "[X] VERSION file not found in release directory: $SCRIPT_DIR" >&2
  exit 1
fi

APP_VERSION="$(read_version_value APP_VERSION VERSION)"
if [[ -z "$APP_VERSION" ]]; then
  echo "[X] APP_VERSION missing in VERSION" >&2
  exit 1
fi

for file in compose.runtime.yml rollback.sh SHA256SUMS frontend/Dockerfile frontend/dist/index.html backend/Dockerfile backend/dist/main.js; do
  if [[ ! -f "$file" ]]; then
    echo "[X] Missing release file: $file" >&2
    exit 1
  fi
done
for file in scripts/preflight-check.sh scripts/run-migrations.sh scripts/smoke-test.sh database/migrations/20260517_001_widen_runtime_text_columns.sql backend/scripts/dashscope_funasr_transcribe.py backend/BUILD_INFO.json; do
  if [[ ! -f "$file" ]]; then
    echo "[X] Missing release file: $file" >&2
    exit 1
  fi
done
if [[ ! -f "scripts/verify-runtime.sh" ]]; then
  echo "[X] Missing release file: scripts/verify-runtime.sh" >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "[X] Missing production env file: $ENV_FILE" >&2
  echo "    Create it from deploy/docker.env.example and keep secrets only on the server." >&2
  exit 1
fi

echo ">>> Verifying release checksums"
sha256sum -c SHA256SUMS

mkdir -p "$RUNTIME_DIR/releases" "$RUNTIME_DIR/incoming"

TARGET_RELEASE="$RUNTIME_DIR/releases/$APP_VERSION"
mkdir -p "$TARGET_RELEASE"
if [[ "$SCRIPT_DIR" != "$TARGET_RELEASE" ]]; then
  rm -rf "$TARGET_RELEASE"
  mkdir -p "$TARGET_RELEASE"
  cp -a . "$TARGET_RELEASE/"
fi

CURRENT_LINK="$RUNTIME_DIR/current"
CURRENT_VERSION=""
if [[ -L "$CURRENT_LINK" && -f "$CURRENT_LINK/VERSION" ]]; then
  CURRENT_VERSION="$(read_version_value APP_VERSION "$CURRENT_LINK/VERSION")"
fi

if [[ -n "$CURRENT_VERSION" && "$CURRENT_VERSION" != "$APP_VERSION" ]]; then
  echo "$CURRENT_VERSION" > "$RUNTIME_DIR/previous-version"
fi

ln -sfn "$TARGET_RELEASE" "$CURRENT_LINK"

export APP_VERSION
export GIT_COMMIT="$(read_version_value GIT_COMMIT "$TARGET_RELEASE/VERSION")"
export BUILD_TIME_UTC="$(read_version_value BUILD_TIME_UTC "$TARGET_RELEASE/VERSION")"
export SHUZIREN_ENV_FILE="$ENV_FILE"
export SHUZIREN_BACKEND_ENV_FILE="$BACKEND_ENV_FILE"

COMPOSE_FILE="$TARGET_RELEASE/compose.runtime.yml"
COMPOSE_ENV_FILE="$TARGET_RELEASE/.deploy.env"
write_deploy_env "$COMPOSE_ENV_FILE" "$TARGET_RELEASE/VERSION" "$ENV_FILE" "$BACKEND_ENV_FILE"
print_deploy_env_summary "$COMPOSE_ENV_FILE"

if [[ -z "$(read_env_value APP_VERSION "$COMPOSE_ENV_FILE")" ]]; then
  echo "[X] APP_VERSION is empty in $COMPOSE_ENV_FILE" >&2
  exit 1
fi

echo ">>> Running preflight checks"
COMPOSE_PROJECT_NAME=shuziren \
COMPOSE_FILE="$COMPOSE_FILE" \
COMPOSE_ENV_FILE="$COMPOSE_ENV_FILE" \
SHUZIREN_BACKEND_ENV_FILE="$BACKEND_ENV_FILE" \
PREFLIGHT_SKIP_DB=1 \
  bash "$TARGET_RELEASE/scripts/preflight-check.sh"

echo ">>> Starting database service"
compose up -d mysql

echo ">>> Running database migrations"
COMPOSE_PROJECT_NAME=shuziren \
COMPOSE_FILE="$COMPOSE_FILE" \
COMPOSE_ENV_FILE="$COMPOSE_ENV_FILE" \
MIGRATIONS_DIR="$TARGET_RELEASE/database/migrations" \
  bash "$TARGET_RELEASE/scripts/run-migrations.sh"

echo ">>> Running database preflight checks"
COMPOSE_PROJECT_NAME=shuziren \
COMPOSE_FILE="$COMPOSE_FILE" \
COMPOSE_ENV_FILE="$COMPOSE_ENV_FILE" \
SHUZIREN_BACKEND_ENV_FILE="$BACKEND_ENV_FILE" \
  bash "$TARGET_RELEASE/scripts/preflight-check.sh"

echo ">>> Building images on server and starting services"
compose up -d --build

echo ">>> Compose status"
compose ps

WEB_PORT="$(read_env_value WEB_PORT "$ENV_FILE")"
WEB_PORT="${WEB_PORT:-8080}"

echo ">>> Running health checks"
wait_for_http "http://127.0.0.1:${WEB_PORT}/" "web"
wait_for_http "http://127.0.0.1:${WEB_PORT}/api" "api"
FRONTEND_URL="http://127.0.0.1:${WEB_PORT}" \
API_BASE_URL="http://127.0.0.1:${WEB_PORT}/api" \
  bash "$TARGET_RELEASE/scripts/smoke-test.sh"

COMPOSE_PROJECT_NAME=shuziren \
COMPOSE_FILE="$COMPOSE_FILE" \
COMPOSE_ENV_FILE="$COMPOSE_ENV_FILE" \
FRONTEND_URL="http://127.0.0.1:${WEB_PORT}" \
API_BASE_URL="http://127.0.0.1:${WEB_PORT}/api" \
  bash "$TARGET_RELEASE/scripts/verify-runtime.sh"

PUBLIC_BASE_URL="$(read_env_value PUBLIC_BASE_URL "$ENV_FILE")"
if [[ "$PUBLIC_BASE_URL" == https://* ]]; then
  echo ">>> Running public HTTPS smoke checks"
  FRONTEND_URL="$PUBLIC_BASE_URL" \
  API_BASE_URL="${PUBLIC_BASE_URL%/}/api" \
  REQUIRE_HTTPS=1 \
    bash "$TARGET_RELEASE/scripts/smoke-test.sh"
fi

{
  echo "版本号：$APP_VERSION"
  echo "发布时间：$(date '+%Y-%m-%d %H:%M:%S %z')"
  echo "Git Commit：$(read_version_value GIT_COMMIT "$TARGET_RELEASE/VERSION")"
  echo "发布目录 SHA256：$(sha256sum "$TARGET_RELEASE/SHA256SUMS" | awk '{print $1}')"
  echo "验证结果：通过"
  echo "是否回滚：否"
  echo "---"
} >> "$RUNTIME_DIR/releases.log"

echo ">>> Deployment completed: ${APP_VERSION}"
