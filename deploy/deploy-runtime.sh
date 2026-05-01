#!/usr/bin/env bash
# Deploy an artifact-only release package on the production server.
# Usage inside extracted release directory: bash deploy-runtime.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

RUNTIME_DIR="${SHUZIREN_RUNTIME_DIR:-/opt/shuziren-runtime}"
ENV_FILE="${SHUZIREN_ENV_FILE:-$RUNTIME_DIR/.env}"
BACKEND_ENV_FILE="${SHUZIREN_BACKEND_ENV_FILE:-$RUNTIME_DIR/backend.env}"

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "[X] Missing required command: $cmd" >&2
    exit 1
  fi
}

compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose "$@"
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
export SHUZIREN_ENV_FILE="$ENV_FILE"
export SHUZIREN_BACKEND_ENV_FILE="$BACKEND_ENV_FILE"

echo ">>> Building images on server and starting services"
compose -p shuziren --env-file "$ENV_FILE" -f "$TARGET_RELEASE/compose.runtime.yml" up -d --build

echo ">>> Compose status"
compose -p shuziren --env-file "$ENV_FILE" -f "$TARGET_RELEASE/compose.runtime.yml" ps

WEB_PORT="$(read_env_value WEB_PORT "$ENV_FILE")"
WEB_PORT="${WEB_PORT:-8080}"

echo ">>> Running health checks"
wait_for_http "http://127.0.0.1:${WEB_PORT}/" "web"
wait_for_http "http://127.0.0.1:${WEB_PORT}/api" "api"

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
