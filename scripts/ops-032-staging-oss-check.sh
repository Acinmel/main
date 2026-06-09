#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ENV_FILE="${OPS_032_ENV_FILE:-.deploy.env}"

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

read_env_file() {
  local file="$1"
  if [[ ! -f "$file" ]]; then
    fail "env file not found: $file"
    return 0
  fi

  set -a
  # shellcheck disable=SC1090
  source "$file"
  set +a
}

redacted() {
  local value="$1"
  if [[ -z "$value" ]]; then
    printf '<empty>'
  elif [[ "${#value}" -le 8 ]]; then
    printf '<set>'
  else
    printf '%s****%s' "${value:0:4}" "${value: -4}"
  fi
}

require_env() {
  local key="$1"
  if [[ -z "${!key:-}" ]]; then
    fail "missing env: $key"
  else
    ok "env configured: $key=$(redacted "${!key}")"
  fi
}

check_no_local_path() {
  local key="$1"
  local value="${!key:-}"
  [[ -z "$value" ]] && return 0
  if [[ "$value" =~ ^[A-Za-z]:\\ || "$value" == *"/Users/"* || "$value" == *"Desktop"* ]]; then
    fail "$key contains local desktop path: $value"
  fi
}

check_boolean_enabled() {
  local key="$1"
  local value="${!key:-}"
  case "${value,,}" in
    1|true|yes|on) ok "$key enabled" ;;
    *) fail "$key must be enabled for OPS-032 staging check, got: ${value:-<empty>}" ;;
  esac
}

check_oss_config() {
  echo ">>> OPS-032 OSS/CDN staging env check"
  echo "env_file=$ENV_FILE"

  require_env APP_ENV
  if [[ "${APP_ENV:-}" != "$EXPECTED_ENV" ]]; then
    fail "APP_ENV must be $EXPECTED_ENV for staging check, got: ${APP_ENV:-<empty>}"
  fi

  for key in \
    PUBLIC_BASE_URL \
    FRONTEND_URL \
    API_BASE_URL \
    CORS_ORIGINS \
    MEDIA_STORAGE_PROVIDER \
    VOICE_SAMPLE_STORAGE \
    RENDER_OUTPUT_STORAGE \
    ALI_OSS_ACCESS_KEY_ID \
    ALI_OSS_ACCESS_KEY_SECRET \
    ALI_OSS_BUCKET \
    ALI_OSS_UPLOAD_PREFIX \
    VOICE_SAMPLE_OSS_PREFIX \
    RENDER_OUTPUT_OSS_PREFIX \
    OSS_SIGNED_UPLOAD_TTL_SECONDS \
    RENDER_OUTPUT_OSS_SIGNED_URL_TTL_SECONDS; do
    require_env "$key"
    check_no_local_path "$key"
  done

  if [[ -z "${ALI_OSS_REGION:-}" && -z "${ALI_OSS_ENDPOINT:-}" ]]; then
    fail "missing env: set ALI_OSS_REGION or ALI_OSS_ENDPOINT"
  else
    ok "OSS region/endpoint configured"
  fi

  [[ "${MEDIA_STORAGE_PROVIDER:-}" == "oss" ]] || fail "MEDIA_STORAGE_PROVIDER must be oss"
  [[ "${VOICE_SAMPLE_STORAGE:-}" == "oss" ]] || fail "VOICE_SAMPLE_STORAGE must be oss"
  [[ "${RENDER_OUTPUT_STORAGE:-}" == "oss" ]] || fail "RENDER_OUTPUT_STORAGE must be oss"
  check_boolean_enabled OSS_DIRECT_UPLOAD_ENABLED
  check_boolean_enabled VITE_OSS_DIRECT_UPLOAD_ENABLED

  if [[ "${ALI_OSS_BUCKET:-}" == "shuziren-acc" && "$ALLOW_PROD_BUCKET" != "1" ]]; then
    fail "ALI_OSS_BUCKET looks like production bucket (shuziren-acc). Use a non-production bucket or set OPS_032_ALLOW_PROD_BUCKET=1 intentionally."
  fi

  if [[ "${ALI_OSS_ENDPOINT:-}" == *"-internal.aliyuncs.com"* ]]; then
    fail "ALI_OSS_ENDPOINT uses internal endpoint. Browser signed PUT requires public endpoint or CNAME when direct upload is enabled."
  fi

  for url_key in PUBLIC_BASE_URL FRONTEND_URL API_BASE_URL; do
    local url="${!url_key:-}"
    if [[ "$url" == *"localhost"* || "$url" == *"127.0.0.1"* ]]; then
      fail "$url_key must not point to localhost for staging: $url"
    fi
  done

  if [[ "${SMOKE_OSS_CDN_REQUIRE_HTTPS:-1}" == "1" && -n "${SMOKE_OSS_CDN_URL:-}" && "${SMOKE_OSS_CDN_URL}" != https://* ]]; then
    fail "SMOKE_OSS_CDN_REQUIRE_HTTPS=1 but SMOKE_OSS_CDN_URL is not https"
  fi
}

check_oss_live() {
  if [[ "$LIVE_CHECK" != "1" ]]; then
    warn "OPS_032_LIVE_CHECK!=1; skipping OSS write/read/delete check"
    return 0
  fi

  echo ">>> live OSS write/read/delete check"
  if ! command -v node >/dev/null 2>&1; then
    fail "node command not found; cannot run ali-oss live check"
    return 0
  fi
  if [[ ! -d backend/node_modules ]]; then
    fail "backend/node_modules not found; cannot run ali-oss live check locally"
    return 0
  fi

  node - <<'NODE'
const path = require('node:path');
const OSS = require(require.resolve('ali-oss', { paths: [path.join(process.cwd(), 'backend')] }));

const required = [
  'ALI_OSS_ACCESS_KEY_ID',
  'ALI_OSS_ACCESS_KEY_SECRET',
  'ALI_OSS_BUCKET',
];
for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`missing env: ${key}`);
  }
}

const client = new OSS({
  accessKeyId: process.env.ALI_OSS_ACCESS_KEY_ID,
  accessKeySecret: process.env.ALI_OSS_ACCESS_KEY_SECRET,
  bucket: process.env.ALI_OSS_BUCKET,
  region: process.env.ALI_OSS_REGION || undefined,
  endpoint: process.env.ALI_OSS_ENDPOINT || undefined,
});

const prefix = (process.env.ALI_OSS_UPLOAD_PREFIX || 'staging/runtime-assets').replace(/^\/+|\/+$/g, '');
const key = `${prefix}/ops-032-check/${Date.now()}-${Math.random().toString(16).slice(2)}.txt`;

(async () => {
  await client.put(key, Buffer.from('ops-032-ok'));
  const result = await client.get(key);
  const body = Buffer.isBuffer(result.content)
    ? result.content.toString('utf8')
    : String(result.content || '');
  if (body !== 'ops-032-ok') {
    throw new Error(`unexpected OSS content: ${body}`);
  }
  await client.delete(key);
  console.log(`[OK] OSS live check passed: bucket=${process.env.ALI_OSS_BUCKET} key=${key}`);
})().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
NODE
}

check_cdn_range() {
  if [[ -z "${SMOKE_OSS_CDN_URL:-}" ]]; then
    warn "SMOKE_OSS_CDN_URL not set; skipping CDN Range/HTTPS check"
    return 0
  fi

  echo ">>> CDN Range/HTTPS check"
  local code headers_file body_file
  headers_file="/tmp/shuziren-ops-032-cdn-headers.txt"
  body_file="/tmp/shuziren-ops-032-cdn.bin"
  code="$(curl -sS -o "$body_file" -D "$headers_file" -w '%{http_code}' \
    --connect-timeout 5 --max-time "${SMOKE_TIMEOUT_SECONDS:-15}" \
    -H 'Range: bytes=0-0' \
    "$SMOKE_OSS_CDN_URL" || true)"

  if [[ "$code" != "206" ]]; then
    fail "CDN media URL must return HTTP 206 for Range bytes=0-0, got HTTP $code"
    sed -n '1,40p' "$headers_file" >&2 || true
    return 0
  fi

  local headers
  headers="$(tr -d '\r' < "$headers_file")"
  if ! printf '%s\n' "$headers" | grep -Eiq '^Accept-Ranges:[[:space:]]*bytes'; then
    fail "CDN media URL missing Accept-Ranges: bytes"
  else
    ok "CDN Accept-Ranges header"
  fi
  if ! printf '%s\n' "$headers" | grep -Eiq '^Content-Range:[[:space:]]*bytes[[:space:]]+0-0/'; then
    fail "CDN media URL missing Content-Range bytes 0-0/<size>"
  else
    ok "CDN Content-Range header"
  fi
}

read_env_file "$ENV_FILE"
LIVE_CHECK="${OPS_032_LIVE_CHECK:-0}"
ALLOW_PROD_BUCKET="${OPS_032_ALLOW_PROD_BUCKET:-0}"
EXPECTED_ENV="${OPS_032_EXPECTED_ENV:-staging}"
check_oss_config
check_oss_live
check_cdn_range

if [[ "$failures" -gt 0 ]]; then
  echo "[X] OPS-032 staging OSS/CDN check failed: $failures issue(s)" >&2
  exit 1
fi

echo "[OK] OPS-032 staging OSS/CDN environment is ready"
