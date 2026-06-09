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

warn() {
  echo "[!] $*"
}

check_cmd() {
  local cmd="$1"
  command -v "$cmd" >/dev/null 2>&1 && ok "command available: $cmd" || fail "missing command: $cmd"
}

check_file() {
  local file="$1"
  [[ -f "$file" ]] && ok "file exists: $file" || fail "missing file: $file"
}

check_writable_dir() {
  local dir="$1"
  if [[ -z "$dir" ]]; then
    fail "empty writable directory path"
    return
  fi
  if mkdir -p "$dir" >/dev/null 2>&1 && touch "$dir/.preflight-write-test" >/dev/null 2>&1; then
    rm -f "$dir/.preflight-write-test"
    ok "writable directory: $dir"
  else
    fail "directory is not writable: $dir"
  fi
}

check_file_contains() {
  local file="$1"
  local pattern="$2"
  local label="$3"
  if [[ ! -f "$file" ]]; then
    fail "missing file for check: $file"
    return
  fi
  if grep -q "$pattern" "$file"; then
    ok "$label"
  else
    fail "$label missing in $file"
  fi
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
export PREVIEW_VIDEO_SAVE_DIR="${PREVIEW_VIDEO_SAVE_DIR:-/workspace/data/preview-videos}"
export PREVIEW_AUDIO_SAVE_DIR="${PREVIEW_AUDIO_SAVE_DIR:-/workspace/data/preview-audios}"
export LIP_SYNC_PUBLIC_MEDIA_DIR="${LIP_SYNC_PUBLIC_MEDIA_DIR:-/workspace/data/lip-sync-public}"
export FFMPEG_BIN="${FFMPEG_BIN:-/usr/bin/ffmpeg}"
export FFPROBE_BIN="${FFPROBE_BIN:-/usr/bin/ffprobe}"
export YTDLP_BIN="${YTDLP_BIN:-/usr/local/bin/yt-dlp}"
export ASR_PYTHON_BIN="${ASR_PYTHON_BIN:-python3}"
export ASR_FUNASR_SCRIPT="${ASR_FUNASR_SCRIPT:-/workspace/scripts/dashscope_funasr_transcribe.py}"
export WEB_BIND_HOST="${WEB_BIND_HOST:-0.0.0.0}"
export ENABLE_LEGACY_TOOLS_ENDPOINTS="${ENABLE_LEGACY_TOOLS_ENDPOINTS:-false}"
export ENABLE_LEGACY_TASKS_ENDPOINTS="${ENABLE_LEGACY_TASKS_ENDPOINTS:-false}"

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
  REGISTRATION_DEFAULT_ACCOUNT_STATUS
  PUBLIC_BASE_URL
  PUBLIC_UPLOAD_BASE_URL
  UPLOAD_DIR
  TEMP_DIR
  VIDEO_SAVE_DIR
  PREVIEW_VIDEO_SAVE_DIR
  PREVIEW_AUDIO_SAVE_DIR
  LIP_SYNC_PUBLIC_MEDIA_DIR
  FFMPEG_BIN
  FFPROBE_BIN
  YTDLP_BIN
  ASR_PYTHON_BIN
  ASR_FUNASR_SCRIPT
  ENABLE_LEGACY_TOOLS_ENDPOINTS
  ENABLE_LEGACY_TASKS_ENDPOINTS
)

for key in "${required_env[@]}"; do
  if [[ -z "${!key:-}" ]]; then
    fail "missing env: $key"
  else
    ok "env configured: $key"
  fi
  check_no_local_path "$key"
done

case "${ENABLE_LEGACY_TOOLS_ENDPOINTS,,}" in
  false|0|no|off) ok "legacy tools endpoints disabled" ;;
  *) fail "ENABLE_LEGACY_TOOLS_ENDPOINTS must stay false for core-flow local/staging gates" ;;
esac

case "${ENABLE_LEGACY_TASKS_ENDPOINTS,,}" in
  false|0|no|off) ok "legacy tasks endpoints disabled" ;;
  *) fail "ENABLE_LEGACY_TASKS_ENDPOINTS must stay false for core-flow local/staging gates" ;;
esac

echo ">>> runtime directories"
for dir in \
  "$UPLOAD_DIR" \
  "$UPLOAD_DIR/tmp" \
  "$TEMP_DIR" \
  "$VIDEO_SAVE_DIR" \
  "$PREVIEW_VIDEO_SAVE_DIR" \
  "$PREVIEW_AUDIO_SAVE_DIR" \
  "$LIP_SYNC_PUBLIC_MEDIA_DIR"; do
  check_writable_dir "$dir"
done

echo ">>> reverse proxy media headers"
check_file_contains "frontend/deploy/nginx-web.conf" "proxy_set_header Range" "web nginx forwards Range"
check_file_contains "frontend/deploy/nginx-web.conf" "proxy_set_header If-Range" "web nginx forwards If-Range"
if [[ -f "deploy/nginx-host-reverse-proxy.conf" ]]; then
  check_file_contains "deploy/nginx-host-reverse-proxy.conf" "proxy_set_header Range" "host nginx forwards Range"
  check_file_contains "deploy/nginx-host-reverse-proxy.conf" "proxy_set_header If-Range" "host nginx forwards If-Range"
fi

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

core_flow_real_provider="${CORE_FLOW_REAL_PROVIDER:-0}"
case "${core_flow_real_provider,,}" in
  1|true|yes|on)
    echo ">>> real provider config check"
    provider_required_env=(
      DASHSCOPE_API_KEY
      DASHSCOPE_ASR_BASE_URL
      DASHSCOPE_TTS_BASE_URL
      TTS_API_URL
      LIP_SYNC_PROVIDER
      VIDEO_RETALK_API_URL
      ALI_VIDEORETALK_BASE_URL
      ALI_VIDEORETALK_MODEL
      ALI_VIDEORETALK_POLL_MAX_MS
      ALI_VIDEORETALK_POLL_INTERVAL_MS
      ALI_VIDEORETALK_INPUT_MAX_BYTES
      ALI_VIDEORETALK_MEDIA_MAX_AUDIO_SIZE_BYTES
    )
    for key in "${provider_required_env[@]}"; do
      if [[ -z "${!key:-}" ]]; then
        fail "missing real provider env: $key"
      else
        ok "env configured: $key"
      fi
      check_no_local_path "$key"
    done
    ;;
  *)
    warn "CORE_FLOW_REAL_PROVIDER is not enabled; paid ASR/TTS/VideoRetalk keys are not enforced by preflight"
    ;;
esac

voice_sample_storage="${VOICE_SAMPLE_STORAGE:-local}"
media_storage_provider="${MEDIA_STORAGE_PROVIDER:-local}"
render_output_storage="${RENDER_OUTPUT_STORAGE:-local}"
oss_direct_upload_enabled="${OSS_DIRECT_UPLOAD_ENABLED:-${VITE_OSS_DIRECT_UPLOAD_ENABLED:-0}}"
voice_sample_storage_lc="${voice_sample_storage,,}"
media_storage_provider_lc="${media_storage_provider,,}"
render_output_storage_lc="${render_output_storage,,}"
oss_direct_upload_enabled_lc="${oss_direct_upload_enabled,,}"
oss_config_required=0
oss_browser_direct_upload=0

case "$voice_sample_storage_lc" in
  oss) oss_config_required=1 ;;
esac
case "$media_storage_provider_lc" in
  oss) oss_config_required=1 ;;
esac
case "$render_output_storage_lc" in
  oss) oss_config_required=1 ;;
esac
case "$oss_direct_upload_enabled_lc" in
  1|true|yes|on)
    oss_config_required=1
    oss_browser_direct_upload=1
    ;;
esac

if [[ "$oss_config_required" == "1" ]]; then
  echo ">>> OSS config check"
  oss_required_env=(
    ALI_OSS_ACCESS_KEY_ID
    ALI_OSS_ACCESS_KEY_SECRET
    ALI_OSS_BUCKET
  )
  for key in "${oss_required_env[@]}"; do
    if [[ -z "${!key:-}" ]]; then
      fail "missing OSS env: $key (required when any OSS storage mode is enabled)"
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
  if [[ "$media_storage_provider_lc" == "oss" || "$oss_browser_direct_upload" == "1" ]]; then
    if [[ -z "${ALI_OSS_UPLOAD_PREFIX:-}" ]]; then
      fail "missing OSS env: ALI_OSS_UPLOAD_PREFIX (required for media direct upload isolation)"
    else
      ok "env configured: ALI_OSS_UPLOAD_PREFIX"
    fi
  fi
  if [[ "$voice_sample_storage_lc" == "oss" ]]; then
    if [[ -z "${VOICE_SAMPLE_OSS_PREFIX:-}" ]]; then
      fail "missing OSS env: VOICE_SAMPLE_OSS_PREFIX (required for voice sample isolation)"
    else
      ok "env configured: VOICE_SAMPLE_OSS_PREFIX"
    fi
  fi
  if [[ "$render_output_storage_lc" == "oss" ]]; then
    if [[ -z "${RENDER_OUTPUT_OSS_PREFIX:-}" ]]; then
      fail "missing OSS env: RENDER_OUTPUT_OSS_PREFIX (required for render output isolation)"
    else
      ok "env configured: RENDER_OUTPUT_OSS_PREFIX"
    fi
  fi
  if [[ "$oss_browser_direct_upload" == "1" && "${ALI_OSS_ENDPOINT:-}" == *"-internal.aliyuncs.com"* ]]; then
    fail "ALI_OSS_ENDPOINT uses an internal OSS endpoint but browser direct upload is enabled. Use a public endpoint or upload CNAME for signed PUT URLs."
  fi
fi

echo ">>> docker compose config"
compose config >/dev/null && ok "docker compose config" || fail "docker compose config failed"

echo ">>> api container runtime tools"
api_container_id="$(compose ps -q api 2>/dev/null || true)"
if [[ -n "$api_container_id" ]]; then
  compose exec -T api sh -lc '"$FFMPEG_BIN" -version >/dev/null' && ok "api ffmpeg executable" || fail "api ffmpeg is not executable"
  compose exec -T api sh -lc '"$FFPROBE_BIN" -version >/dev/null' && ok "api ffprobe executable" || fail "api ffprobe is not executable"
  compose exec -T api sh -lc '"$ASR_PYTHON_BIN" -c "import dashscope; print(\"ok\")" >/dev/null' && ok "api python dashscope import" || fail "api python dashscope import failed"
  compose exec -T api sh -lc 'test -f "$ASR_FUNASR_SCRIPT"' && ok "api ASR script exists" || fail "api ASR script missing"
else
  warn "api container is not running; skipping in-container ffmpeg/ffprobe/python checks"
fi

if [[ "$PREFLIGHT_SKIP_DB" != "1" ]]; then
  echo ">>> database schema check"
  if compose exec -T "$MYSQL_SERVICE" sh -lc 'mysqladmin ping -h localhost -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" --silent' >/dev/null 2>&1; then
    ok "mysql reachable"
    schema_sql='SELECT CONCAT(TABLE_NAME,".",COLUMN_NAME,"=",DATA_TYPE) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND CONCAT(TABLE_NAME,".",COLUMN_NAME) IN ("digital_human_templates.output_relative_path","digital_human_templates.selfie_relative_path","user_works.content","user_works.source_video_url","user_works.output_video_url","task_statuses.error","avatar_resources.cover_url","avatar_resources.source_video_url","voice_resources.audio_url","voice_resources.clone_error","subtitle_template_resources.cover_url","subtitle_template_resources.preview_url","subtitle_template_resources.style_json","subtitle_template_resources.style_config_json","audit_logs.detail") AND DATA_TYPE <> "longtext";'
    non_compliant="$(compose exec -T "$MYSQL_SERVICE" sh -lc "mysql -u\"\$MYSQL_USER\" -p\"\$MYSQL_PASSWORD\" \"\$MYSQL_DATABASE\" -N -e '$schema_sql'" 2>/dev/null || true)"
    if [[ -n "$non_compliant" ]]; then
      fail "database text columns not migrated: $non_compliant"
    else
      ok "database text columns"
    fi
    staged_table_sql='SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ("audio_assets","subtitle_tracks","digital_human_video_assets");'
    staged_tables="$(compose exec -T "$MYSQL_SERVICE" sh -lc "mysql -u\"\$MYSQL_USER\" -p\"\$MYSQL_PASSWORD\" \"\$MYSQL_DATABASE\" -N -e '$staged_table_sql'" 2>/dev/null || true)"
    for table in audio_assets subtitle_tracks digital_human_video_assets; do
      if printf '%s\n' "$staged_tables" | grep -Fxq "$table"; then
        ok "database staged table: $table"
      else
        fail "missing database staged table: $table"
      fi
    done

    subtitle_template_column_sql='SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME="subtitle_template_resources" AND COLUMN_NAME IN ("style_config_json","base_template_id");'
    subtitle_template_columns="$(compose exec -T "$MYSQL_SERVICE" sh -lc "mysql -u\"\$MYSQL_USER\" -p\"\$MYSQL_PASSWORD\" \"\$MYSQL_DATABASE\" -N -e '$subtitle_template_column_sql'" 2>/dev/null || true)"
    for column in style_config_json base_template_id; do
      if printf '%s\n' "$subtitle_template_columns" | grep -Fxq "$column"; then
        ok "database subtitle template column: $column"
      else
        fail "missing database subtitle template column: subtitle_template_resources.$column"
      fi
    done

    subtitle_template_index_sql='SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME="subtitle_template_resources" AND INDEX_NAME IN ("idx_subtitle_template_resources_user_updated","idx_subtitle_template_resources_rec_updated");'
    subtitle_template_indexes="$(compose exec -T "$MYSQL_SERVICE" sh -lc "mysql -u\"\$MYSQL_USER\" -p\"\$MYSQL_PASSWORD\" \"\$MYSQL_DATABASE\" -N -e '$subtitle_template_index_sql'" 2>/dev/null || true)"
    for index in idx_subtitle_template_resources_user_updated idx_subtitle_template_resources_rec_updated; do
      if printf '%s\n' "$subtitle_template_indexes" | grep -Fxq "$index"; then
        ok "database subtitle template index: $index"
      else
        fail "missing database subtitle template index: subtitle_template_resources.$index"
      fi
    done

    subtitle_template_data_url_sql='SELECT COUNT(*) FROM subtitle_template_resources WHERE is_recommended = 1 AND (cover_url LIKE "data:%" OR preview_url LIKE "data:%");'
    subtitle_template_data_url_count="$(compose exec -T "$MYSQL_SERVICE" sh -lc "mysql -u\"\$MYSQL_USER\" -p\"\$MYSQL_PASSWORD\" \"\$MYSQL_DATABASE\" -N -e '$subtitle_template_data_url_sql'" 2>/dev/null || true)"
    subtitle_template_data_url_count="${subtitle_template_data_url_count//$'\r'/}"
    subtitle_template_data_url_count="${subtitle_template_data_url_count//$'\n'/}"
    if [[ "${subtitle_template_data_url_count:-0}" =~ ^[0-9]+$ && "$subtitle_template_data_url_count" -eq 0 ]]; then
      ok "database recommended subtitle template URLs are controlled"
    else
      fail "recommended subtitle templates still contain data:image URLs: ${subtitle_template_data_url_count:-unknown}"
    fi

    staged_index_sql='SELECT CONCAT(TABLE_NAME,".",INDEX_NAME) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND INDEX_NAME IN ("idx_audio_assets_user_project_updated","idx_audio_assets_user_updated","idx_subtitle_tracks_user_project","idx_subtitle_tracks_audio_asset","idx_dvh_assets_user_project_updated","idx_dvh_assets_source_task");'
    staged_indexes="$(compose exec -T "$MYSQL_SERVICE" sh -lc "mysql -u\"\$MYSQL_USER\" -p\"\$MYSQL_PASSWORD\" \"\$MYSQL_DATABASE\" -N -e '$staged_index_sql'" 2>/dev/null || true)"
    for index in \
      audio_assets.idx_audio_assets_user_project_updated \
      audio_assets.idx_audio_assets_user_updated \
      subtitle_tracks.idx_subtitle_tracks_user_project \
      subtitle_tracks.idx_subtitle_tracks_audio_asset \
      digital_human_video_assets.idx_dvh_assets_user_project_updated \
      digital_human_video_assets.idx_dvh_assets_source_task; do
      if printf '%s\n' "$staged_indexes" | grep -Fxq "$index"; then
        ok "database staged index: $index"
      else
        fail "missing database staged index: $index"
      fi
    done
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
