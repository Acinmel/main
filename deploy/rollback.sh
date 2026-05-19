#!/usr/bin/env bash
# Roll back to the previous artifact-only release without deleting any volumes.
# Usage on the production server: bash /opt/shuziren-runtime/current/rollback.sh

set -euo pipefail

RUNTIME_DIR="${SHUZIREN_RUNTIME_DIR:-/opt/shuziren-runtime}"
ENV_FILE="${SHUZIREN_ENV_FILE:-$RUNTIME_DIR/.env}"
BACKEND_ENV_FILE="${SHUZIREN_BACKEND_ENV_FILE:-$RUNTIME_DIR/backend.env}"
PREVIOUS_FILE="$RUNTIME_DIR/previous-version"
CURRENT_LINK="$RUNTIME_DIR/current"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-shuziren}"
COMPOSE_FILE=""
COMPOSE_ENV_FILE=""

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

if [[ ! -f "$PREVIOUS_FILE" ]]; then
  echo "[X] No previous version recorded at $PREVIOUS_FILE" >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "[X] Missing production env file: $ENV_FILE" >&2
  exit 1
fi

PREVIOUS_VERSION="$(tr -d '[:space:]' < "$PREVIOUS_FILE")"
ROLLBACK_RELEASE="$RUNTIME_DIR/releases/$PREVIOUS_VERSION"

if [[ -z "$PREVIOUS_VERSION" || ! -f "$ROLLBACK_RELEASE/compose.runtime.yml" || ! -f "$ROLLBACK_RELEASE/VERSION" ]]; then
  echo "[X] Previous release is incomplete: $ROLLBACK_RELEASE" >&2
  exit 1
fi

CURRENT_VERSION=""
if [[ -L "$CURRENT_LINK" && -f "$CURRENT_LINK/VERSION" ]]; then
  CURRENT_VERSION="$(read_version_value APP_VERSION "$CURRENT_LINK/VERSION")"
fi

ln -sfn "$ROLLBACK_RELEASE" "$CURRENT_LINK"
if [[ -n "$CURRENT_VERSION" && "$CURRENT_VERSION" != "$PREVIOUS_VERSION" ]]; then
  echo "$CURRENT_VERSION" > "$PREVIOUS_FILE"
fi

export APP_VERSION="$PREVIOUS_VERSION"
export SHUZIREN_ENV_FILE="$ENV_FILE"
export SHUZIREN_BACKEND_ENV_FILE="$BACKEND_ENV_FILE"
COMPOSE_FILE="$ROLLBACK_RELEASE/compose.runtime.yml"
COMPOSE_ENV_FILE="$ROLLBACK_RELEASE/.deploy.env"
write_deploy_env "$COMPOSE_ENV_FILE" "$ROLLBACK_RELEASE/VERSION" "$ENV_FILE" "$BACKEND_ENV_FILE"
print_deploy_env_summary "$COMPOSE_ENV_FILE"

if [[ -z "$(read_env_value APP_VERSION "$COMPOSE_ENV_FILE")" ]]; then
  echo "[X] APP_VERSION is empty in $COMPOSE_ENV_FILE" >&2
  exit 1
fi

echo ">>> Rolling back to ${PREVIOUS_VERSION}"
compose up -d --build
compose ps

WEB_PORT="$(read_env_value WEB_PORT "$ENV_FILE")"
WEB_PORT="${WEB_PORT:-8080}"

wait_for_http "http://127.0.0.1:${WEB_PORT}/" "web"
wait_for_http "http://127.0.0.1:${WEB_PORT}/api" "api"

{
  echo "版本号：$PREVIOUS_VERSION"
  echo "发布时间：$(date '+%Y-%m-%d %H:%M:%S %z')"
  echo "Git Commit：$(read_version_value GIT_COMMIT "$ROLLBACK_RELEASE/VERSION")"
  echo "发布目录 SHA256：$(sha256sum "$ROLLBACK_RELEASE/SHA256SUMS" | awk '{print $1}')"
  echo "验证结果：通过"
  echo "是否回滚：是"
  echo "---"
} >> "$RUNTIME_DIR/releases.log"

echo ">>> Rollback completed: ${PREVIOUS_VERSION}"
