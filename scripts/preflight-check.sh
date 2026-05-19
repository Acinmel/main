#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-shuziren}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
COMPOSE_ENV_FILE="${COMPOSE_ENV_FILE:-.deploy.env}"
MYSQL_SERVICE="${MYSQL_SERVICE:-mysql}"
PREFLIGHT_SKIP_DB="${PREFLIGHT_SKIP_DB:-0}"

compose_base_args=()
if [[ ! -f "$COMPOSE_ENV_FILE" ]]; then
  echo "[X] Compose env file not found: $COMPOSE_ENV_FILE" >&2
  exit 1
fi
compose_base_args+=(--env-file "$COMPOSE_ENV_FILE")
compose_base_args+=(-p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE")

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

read_env_file() {
  local file="$1"
  [[ -f "$file" ]] || return 0
  while IFS='=' read -r key value; do
    [[ -z "${key:-}" || "$key" =~ ^[[:space:]]*# ]] && continue
    key="$(echo "$key" | tr -d '[:space:]')"
    value="${value%%#*}"
    value="${value%$'\r'}"
    value="${value%\"}"
    value="${value#\"}"
    if [[ -n "$key" && -z "${!key:-}" ]]; then
      export "$key=$value"
    fi
  done < "$file"
}

failures=0

fail() {
  echo "[X] $*" >&2
  failures=$((failures + 1))
}

ok() {
  echo "[OK] $*"
}

check_cmd() {
  local cmd="$1"
  command -v "$cmd" >/dev/null 2>&1 && ok "command available: $cmd" || fail "missing command: $cmd"
}

check_file() {
  local file="$1"
  [[ -f "$file" ]] && ok "file exists: $file" || fail "missing file: $file"
}

check_no_local_path() {
  local name="$1"
  local value="${!name:-}"
  [[ -z "$value" ]] && return 0
  if [[ "$value" =~ ^[A-Za-z]:\\ || "$value" == *"/Users/"* || "$value" == *"Desktop"* ]]; then
    fail "$name contains local desktop path: $value"
  fi
}

read_env_file "$COMPOSE_ENV_FILE"
read_env_file "${SHUZIREN_BACKEND_ENV_FILE:-backend/.env}"

export UPLOAD_DIR="${UPLOAD_DIR:-/workspace/uploads}"
export TEMP_DIR="${TEMP_DIR:-/workspace/tmp}"
export VIDEO_SAVE_DIR="${VIDEO_SAVE_DIR:-/workspace/data/download-video}"
export FFMPEG_BIN="${FFMPEG_BIN:-/usr/bin/ffmpeg}"
export YTDLP_BIN="${YTDLP_BIN:-/usr/local/bin/yt-dlp}"
export ASR_PYTHON_BIN="${ASR_PYTHON_BIN:-python3}"
export ASR_FUNASR_SCRIPT="${ASR_FUNASR_SCRIPT:-/workspace/scripts/dashscope_funasr_transcribe.py}"
export WEB_BIND_HOST="${WEB_BIND_HOST:-0.0.0.0}"

echo ">>> Preflight target"
echo "root=$ROOT"
echo "compose_file=$COMPOSE_FILE"
echo "compose_env_file=$COMPOSE_ENV_FILE"

check_cmd docker
check_cmd curl
check_cmd awk

for required_file in \
  "$COMPOSE_FILE" \
  "backend/scripts/dashscope_funasr_transcribe.py" \
  "database/migrations/20260517_001_widen_runtime_text_columns.sql"; do
  check_file "$required_file"
done

required_env=(
  MYSQL_DATABASE
  MYSQL_USER
  MYSQL_PASSWORD
  JWT_SECRET
  PUBLIC_BASE_URL
  PUBLIC_UPLOAD_BASE_URL
  UPLOAD_DIR
  TEMP_DIR
  VIDEO_SAVE_DIR
  FFMPEG_BIN
  YTDLP_BIN
  ASR_PYTHON_BIN
  ASR_FUNASR_SCRIPT
)

for key in "${required_env[@]}"; do
  if [[ -z "${!key:-}" ]]; then
    fail "missing env: $key"
  else
    ok "env configured: $key"
  fi
  check_no_local_path "$key"
done

if [[ "${PUBLIC_BASE_URL:-}" == https://* ]]; then
  case "$WEB_BIND_HOST" in
    127.0.0.1|localhost|::1)
      ok "web bind is loopback for HTTPS production: $WEB_BIND_HOST"
      ;;
    *)
      fail "PUBLIC_BASE_URL is HTTPS but WEB_BIND_HOST is not loopback ($WEB_BIND_HOST). Set WEB_BIND_HOST=127.0.0.1 so public traffic cannot bypass HTTPS on WEB_PORT."
      ;;
  esac
fi

voice_sample_storage="${VOICE_SAMPLE_STORAGE:-local}"
if [[ "$voice_sample_storage" == "oss" ]]; then
  echo ">>> OSS config check"
  oss_required_env=(
    ALI_OSS_ACCESS_KEY_ID
    ALI_OSS_ACCESS_KEY_SECRET
    ALI_OSS_BUCKET
  )
  for key in "${oss_required_env[@]}"; do
    if [[ -z "${!key:-}" ]]; then
      fail "missing OSS env: $key (required when VOICE_SAMPLE_STORAGE=oss)"
    else
      ok "env configured: $key"
    fi
    check_no_local_path "$key"
  done
  if [[ -z "${ALI_OSS_REGION:-}" && -z "${ALI_OSS_ENDPOINT:-}" ]]; then
    fail "missing OSS env: set ALI_OSS_REGION or ALI_OSS_ENDPOINT"
  else
    ok "env configured: OSS region/endpoint"
  fi
fi

echo ">>> docker compose config"
compose config >/dev/null && ok "docker compose config" || fail "docker compose config failed"

if [[ "$PREFLIGHT_SKIP_DB" != "1" ]]; then
  echo ">>> database schema check"
  if compose exec -T "$MYSQL_SERVICE" sh -lc 'mysqladmin ping -h localhost -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" --silent' >/dev/null 2>&1; then
    ok "mysql reachable"
    schema_sql='SELECT CONCAT(TABLE_NAME,".",COLUMN_NAME,"=",DATA_TYPE) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND CONCAT(TABLE_NAME,".",COLUMN_NAME) IN ("digital_human_templates.output_relative_path","digital_human_templates.selfie_relative_path","user_works.content","user_works.source_video_url","user_works.output_video_url","task_statuses.error","avatar_resources.cover_url","avatar_resources.source_video_url","voice_resources.audio_url","voice_resources.clone_error","subtitle_template_resources.cover_url","subtitle_template_resources.preview_url","subtitle_template_resources.style_json","audit_logs.detail") AND DATA_TYPE <> "longtext";'
    non_compliant="$(compose exec -T "$MYSQL_SERVICE" sh -lc "mysql -u\"\$MYSQL_USER\" -p\"\$MYSQL_PASSWORD\" \"\$MYSQL_DATABASE\" -N -e '$schema_sql'" 2>/dev/null || true)"
    if [[ -n "$non_compliant" ]]; then
      fail "database text columns not migrated: $non_compliant"
    else
      ok "database text columns"
    fi
  else
    fail "mysql is not reachable"
  fi
else
  echo "[!] PREFLIGHT_SKIP_DB=1; skipping database reachability/schema checks"
fi

if [[ "$failures" -gt 0 ]]; then
  echo "[X] preflight failed: $failures issue(s)" >&2
  exit 1
fi

echo "[OK] preflight completed"
