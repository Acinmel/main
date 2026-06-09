#!/usr/bin/env bash

set -euo pipefail

FRONTEND_URL="${FRONTEND_URL:-http://127.0.0.1:${WEB_PORT:-8080}}"
API_BASE_URL="${API_BASE_URL:-${FRONTEND_URL%/}/api}"
SMOKE_TIMEOUT_SECONDS="${SMOKE_TIMEOUT_SECONDS:-10}"
HEALTH_DEEP_TOKEN="${HEALTH_DEEP_TOKEN:-}"
REQUIRE_HTTPS="${REQUIRE_HTTPS:-0}"
SMOKE_CHECK_PENDING_REGISTRATION="${SMOKE_CHECK_PENDING_REGISTRATION:-0}"
SMOKE_PENDING_EMAIL="${SMOKE_PENDING_EMAIL:-smoke-pending-$(date +%s)-$$@test.local}"
SMOKE_PENDING_PASSWORD="${SMOKE_PENDING_PASSWORD:-SmokePass12}"
SMOKE_PREVIEW_AUDIO_STREAM_URL="${SMOKE_PREVIEW_AUDIO_STREAM_URL:-}"
SMOKE_OSS_CDN_URL="${SMOKE_OSS_CDN_URL:-}"
SMOKE_OSS_CDN_REQUIRE_HTTPS="${SMOKE_OSS_CDN_REQUIRE_HTTPS:-0}"
SMOKE_PUBLIC_TEMPLATE_IMAGE_URL="${SMOKE_PUBLIC_TEMPLATE_IMAGE_URL:-}"
SMOKE_PUBLIC_TEMPLATE_REQUIRED="${SMOKE_PUBLIC_TEMPLATE_REQUIRED:-0}"
SMOKE_PUBLIC_TEMPLATE_REQUIRE_HTTPS="${SMOKE_PUBLIC_TEMPLATE_REQUIRE_HTTPS:-0}"

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "[X] Missing required command: $cmd" >&2
    exit 1
  fi
}

check_http() {
  local label="$1"
  local url="$2"
  local extra_header="${3:-}"
  local code

  if [[ -n "$extra_header" ]]; then
    code="$(curl -sS -o /tmp/shuziren-smoke-body.txt -w '%{http_code}' \
      --connect-timeout 3 --max-time "$SMOKE_TIMEOUT_SECONDS" \
      -H "$extra_header" "$url" || true)"
  else
    code="$(curl -sS -o /tmp/shuziren-smoke-body.txt -w '%{http_code}' \
      --connect-timeout 3 --max-time "$SMOKE_TIMEOUT_SECONDS" \
      "$url" || true)"
  fi

  case "$code" in
    2*|3*)
      echo "[OK] $label $code $url"
      ;;
    *)
      echo "[X] $label failed: HTTP $code $url" >&2
      if [[ -s /tmp/shuziren-smoke-body.txt ]]; then
        sed -n '1,20p' /tmp/shuziren-smoke-body.txt >&2
      fi
      exit 1
      ;;
  esac
}

check_json() {
  local label="$1"
  local url="$2"
  local extra_header="${3:-}"

  if [[ -n "$extra_header" ]]; then
    curl -fsS --connect-timeout 3 --max-time "$SMOKE_TIMEOUT_SECONDS" \
      -H "$extra_header" "$url" \
      | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{JSON.parse(s);})" >/dev/null
  else
    curl -fsS --connect-timeout 3 --max-time "$SMOKE_TIMEOUT_SECONDS" \
      "$url" \
      | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{JSON.parse(s);})" >/dev/null
  fi

  echo "[OK] $label JSON $url"
}

check_cache_header() {
  local label="$1"
  local url="$2"
  local expected_pattern="$3"
  local headers

  headers="$(curl -fsS -I --connect-timeout 3 --max-time "$SMOKE_TIMEOUT_SECONDS" "$url")"
  if ! printf '%s\n' "$headers" | grep -Ei '^cache-control:' | grep -Eiq "$expected_pattern"; then
    echo "[X] $label Cache-Control mismatch: $url" >&2
    printf '%s\n' "$headers" >&2
    exit 1
  fi
  echo "[OK] $label Cache-Control $url"
}

check_static_cache_headers() {
  local html asset_path asset_url
  html="$(curl -fsS --connect-timeout 3 --max-time "$SMOKE_TIMEOUT_SECONDS" "${FRONTEND_URL%/}/")"
  asset_path="$(printf '%s' "$html" | grep -Eo '/assets/[^"'\''<> ]+\.(js|css)' | head -n 1 || true)"
  if [[ -z "$asset_path" ]]; then
    echo "[!] no /assets/*.js or /assets/*.css reference found; skipping immutable asset cache check"
    return 0
  fi
  asset_url="${FRONTEND_URL%/}${asset_path}"
  check_cache_header "index" "${FRONTEND_URL%/}/index.html" 'no-cache'
  check_cache_header "hashed asset" "$asset_url" 'public.*max-age=31536000.*immutable'
}

check_preview_audio_range_stream() {
  if [[ -z "$SMOKE_PREVIEW_AUDIO_STREAM_URL" ]]; then
    echo "[!] SMOKE_PREVIEW_AUDIO_STREAM_URL not set; skipping preview audio Range/proxy check"
    return 0
  fi

  local code headers
  echo ">>> preview audio Range/proxy check"
  code="$(curl -sS -o /tmp/shuziren-smoke-preview-audio.bin \
    -D /tmp/shuziren-smoke-preview-audio-headers.txt \
    -w '%{http_code}' \
    --connect-timeout 3 --max-time "$SMOKE_TIMEOUT_SECONDS" \
    -H 'Range: bytes=0-0' \
    "$SMOKE_PREVIEW_AUDIO_STREAM_URL" || true)"

  if [[ "$code" != "206" ]]; then
    echo "[X] preview audio stream must return 206 for Range bytes=0-0, got HTTP $code" >&2
    sed -n '1,40p' /tmp/shuziren-smoke-preview-audio-headers.txt >&2 || true
    exit 1
  fi

  headers="$(tr -d '\r' < /tmp/shuziren-smoke-preview-audio-headers.txt)"
  if ! printf '%s\n' "$headers" | grep -Eiq '^Accept-Ranges:[[:space:]]*bytes'; then
    echo "[X] preview audio stream missing Accept-Ranges: bytes" >&2
    printf '%s\n' "$headers" >&2
    exit 1
  fi
  if ! printf '%s\n' "$headers" | grep -Eiq '^Content-Range:[[:space:]]*bytes[[:space:]]+0-0/'; then
    echo "[X] preview audio stream missing expected Content-Range bytes 0-0/<size>" >&2
    printf '%s\n' "$headers" >&2
    exit 1
  fi
  if ! printf '%s\n' "$headers" | grep -Eiq '^Cache-Control:.*private'; then
    echo "[X] preview audio stream must use private Cache-Control" >&2
    printf '%s\n' "$headers" >&2
    exit 1
  fi
  echo "[OK] preview audio Range/proxy headers"
}

check_oss_cdn_range_stream() {
  if [[ -z "$SMOKE_OSS_CDN_URL" ]]; then
    echo "[!] SMOKE_OSS_CDN_URL not set; skipping OSS/CDN Range check"
    return 0
  fi

  if [[ "$SMOKE_OSS_CDN_REQUIRE_HTTPS" == "1" && "$SMOKE_OSS_CDN_URL" != https://* ]]; then
    echo "[X] SMOKE_OSS_CDN_REQUIRE_HTTPS=1 but SMOKE_OSS_CDN_URL is not https: $SMOKE_OSS_CDN_URL" >&2
    exit 1
  fi

  local code headers
  echo ">>> OSS/CDN media Range check"
  code="$(curl -sS -o /tmp/shuziren-smoke-oss-cdn.bin \
    -D /tmp/shuziren-smoke-oss-cdn-headers.txt \
    -w '%{http_code}' \
    --connect-timeout 3 --max-time "$SMOKE_TIMEOUT_SECONDS" \
    -H 'Range: bytes=0-0' \
    "$SMOKE_OSS_CDN_URL" || true)"

  if [[ "$code" != "206" ]]; then
    echo "[X] OSS/CDN media URL must return 206 for Range bytes=0-0, got HTTP $code" >&2
    sed -n '1,40p' /tmp/shuziren-smoke-oss-cdn-headers.txt >&2 || true
    exit 1
  fi

  headers="$(tr -d '\r' < /tmp/shuziren-smoke-oss-cdn-headers.txt)"
  if ! printf '%s\n' "$headers" | grep -Eiq '^Accept-Ranges:[[:space:]]*bytes'; then
    echo "[X] OSS/CDN media URL missing Accept-Ranges: bytes" >&2
    printf '%s\n' "$headers" >&2
    exit 1
  fi
  if ! printf '%s\n' "$headers" | grep -Eiq '^Content-Range:[[:space:]]*bytes[[:space:]]+0-0/'; then
    echo "[X] OSS/CDN media URL missing expected Content-Range bytes 0-0/<size>" >&2
    printf '%s\n' "$headers" >&2
    exit 1
  fi
  echo "[OK] OSS/CDN Range headers"
}

resolve_frontend_url() {
  local url="$1"
  if [[ "$url" == /* ]]; then
    printf '%s%s' "${FRONTEND_URL%/}" "$url"
    return 0
  fi
  printf '%s' "$url"
}

check_no_signed_or_secret_url() {
  local label="$1"
  local url="$2"
  if [[ "$url" == data:* ]]; then
    echo "[X] $label must use a controlled static/OSS/CDN URL, not data: URL" >&2
    exit 1
  fi
  if printf '%s' "$url" | grep -Eiq '(accesskey|access_key|access-key|accesskeyid|ossaccesskeyid|signature=|expires=|x-oss-signature|x-oss-credential|security-token|x-amz-signature|x-amz-credential|secret=|accesskeysecret)'; then
    echo "[X] $label URL appears to contain a signed token or credential material: $url" >&2
    exit 1
  fi
}

check_public_template_image() {
  if [[ -z "$SMOKE_PUBLIC_TEMPLATE_IMAGE_URL" ]]; then
    if [[ "$SMOKE_PUBLIC_TEMPLATE_REQUIRED" == "1" ]]; then
      echo "[X] SMOKE_PUBLIC_TEMPLATE_REQUIRED=1 but SMOKE_PUBLIC_TEMPLATE_IMAGE_URL is not set" >&2
      exit 1
    fi
    echo "[!] SMOKE_PUBLIC_TEMPLATE_IMAGE_URL not set; skipping public template image check"
    return 0
  fi

  local url code headers
  url="$(resolve_frontend_url "$SMOKE_PUBLIC_TEMPLATE_IMAGE_URL")"
  check_no_signed_or_secret_url "public template image" "$url"

  if [[ "$SMOKE_PUBLIC_TEMPLATE_REQUIRE_HTTPS" == "1" && "$url" != https://* ]]; then
    echo "[X] SMOKE_PUBLIC_TEMPLATE_REQUIRE_HTTPS=1 but image URL is not https: $url" >&2
    exit 1
  fi
  if [[ "$url" != http://* && "$url" != https://* ]]; then
    echo "[X] public template image URL must be absolute http(s) or root-relative: $SMOKE_PUBLIC_TEMPLATE_IMAGE_URL" >&2
    exit 1
  fi

  echo ">>> public template image check"
  code="$(curl -sS -o /tmp/shuziren-smoke-template-image.bin \
    -D /tmp/shuziren-smoke-template-image-headers.txt \
    -w '%{http_code}' \
    -L \
    --connect-timeout 3 --max-time "$SMOKE_TIMEOUT_SECONDS" \
    "$url" || true)"

  case "$code" in
    2*|3*)
      ;;
    *)
      echo "[X] public template image failed: HTTP $code $url" >&2
      sed -n '1,40p' /tmp/shuziren-smoke-template-image-headers.txt >&2 || true
      exit 1
      ;;
  esac

  headers="$(tr -d '\r' < /tmp/shuziren-smoke-template-image-headers.txt)"
  if ! printf '%s\n' "$headers" | grep -Eiq '^Content-Type:[[:space:]]*image/'; then
    echo "[X] public template image must return image/* Content-Type" >&2
    printf '%s\n' "$headers" >&2
    exit 1
  fi
  if ! printf '%s\n' "$headers" | grep -Eiq '^Cache-Control:.*public.*max-age='; then
    echo "[X] public template image must return public Cache-Control with max-age" >&2
    printf '%s\n' "$headers" >&2
    exit 1
  fi
  if printf '%s\n' "$headers" | grep -Eiq '^Set-Cookie:'; then
    echo "[X] public template image must not set cookies" >&2
    printf '%s\n' "$headers" >&2
    exit 1
  fi

  echo "[OK] public template image reachable with safe cache headers"
}

url_host() {
  node -e "const u=new URL(process.argv[1]); process.stdout.write(u.host)" "$1"
}

check_https_entrypoint() {
  if [[ "$REQUIRE_HTTPS" != "1" ]]; then
    return 0
  fi
  if [[ "$FRONTEND_URL" != https://* ]]; then
    echo "[X] REQUIRE_HTTPS=1 but FRONTEND_URL is not https: $FRONTEND_URL" >&2
    exit 1
  fi

  local host http_url code hsts_http hsts_https
  host="$(url_host "$FRONTEND_URL")"
  http_url="${HTTP_REDIRECT_URL:-http://${host}/}"
  code="$(curl -sS -o /tmp/shuziren-smoke-headers.txt -w '%{http_code}' \
    --connect-timeout 3 --max-time "$SMOKE_TIMEOUT_SECONDS" \
    -I "$http_url" || true)"
  case "$code" in
    301|302|307|308)
      echo "[OK] HTTP redirects to HTTPS: $code $http_url"
      ;;
    *)
      echo "[X] HTTP entrypoint must redirect to HTTPS, got HTTP $code: $http_url" >&2
      sed -n '1,20p' /tmp/shuziren-smoke-headers.txt >&2 || true
      exit 1
      ;;
  esac

  hsts_http="$(grep -i '^strict-transport-security:' /tmp/shuziren-smoke-headers.txt || true)"
  if [[ -n "$hsts_http" ]]; then
    echo "[X] HTTP redirect response must not include HSTS; HSTS only protects HTTPS responses" >&2
    echo "$hsts_http" >&2
    exit 1
  fi

  curl -fsS -I --connect-timeout 3 --max-time "$SMOKE_TIMEOUT_SECONDS" \
    "${FRONTEND_URL%/}/" > /tmp/shuziren-smoke-headers.txt
  hsts_https="$(grep -i '^strict-transport-security:' /tmp/shuziren-smoke-headers.txt || true)"
  if [[ -z "$hsts_https" ]]; then
    echo "[X] HTTPS response is missing Strict-Transport-Security" >&2
    sed -n '1,20p' /tmp/shuziren-smoke-headers.txt >&2 || true
    exit 1
  fi
  echo "[OK] HTTPS HSTS enabled"
}

json_value() {
  local key_path="$1"
  node -e "
const path = process.argv[1].split('.');
let s = '';
process.stdin.on('data', d => s += d);
process.stdin.on('end', () => {
  const root = JSON.parse(s);
  let current = root;
  for (const key of path) current = current && current[key];
  if (typeof current === 'string') process.stdout.write(current);
});
" "$key_path"
}

check_pending_registration_gate() {
  if [[ "$SMOKE_CHECK_PENDING_REGISTRATION" != "1" ]]; then
    echo "[!] SMOKE_CHECK_PENDING_REGISTRATION!=1; skipping pending registration gate check"
    return 0
  fi

  local register_url token account_status code
  register_url="${API_BASE_URL%/}/v1/auth/register"
  echo ">>> pending registration gate"
  echo "SMOKE_PENDING_EMAIL=$SMOKE_PENDING_EMAIL"

  code="$(curl -sS -o /tmp/shuziren-smoke-register.json -w '%{http_code}' \
    --connect-timeout 3 --max-time "$SMOKE_TIMEOUT_SECONDS" \
    -X POST "$register_url" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"${SMOKE_PENDING_EMAIL}\",\"password\":\"${SMOKE_PENDING_PASSWORD}\"}" || true)"
  case "$code" in
    200|201)
      ;;
    *)
      echo "[X] pending registration check failed at register: HTTP $code" >&2
      sed -n '1,20p' /tmp/shuziren-smoke-register.json >&2 || true
      exit 1
      ;;
  esac

  token="$(json_value token < /tmp/shuziren-smoke-register.json)"
  account_status="$(json_value user.accountStatus < /tmp/shuziren-smoke-register.json)"
  if [[ -z "$token" ]]; then
    echo "[X] pending registration check failed: missing token in register response" >&2
    sed -n '1,20p' /tmp/shuziren-smoke-register.json >&2 || true
    exit 1
  fi
  if [[ "$account_status" != "pending" ]]; then
    echo "[X] new registered user must be pending, got: ${account_status:-<empty>}" >&2
    sed -n '1,20p' /tmp/shuziren-smoke-register.json >&2 || true
    exit 1
  fi

  code="$(curl -sS -o /tmp/shuziren-smoke-body.txt -w '%{http_code}' \
    --connect-timeout 3 --max-time "$SMOKE_TIMEOUT_SECONDS" \
    -H "Authorization: Bearer ${token}" \
    "${API_BASE_URL%/}/v1/resources/avatars?scope=all&limit=1" || true)"
  if [[ "$code" != "403" ]]; then
    echo "[X] pending user business API must return 403, got HTTP $code" >&2
    sed -n '1,20p' /tmp/shuziren-smoke-body.txt >&2 || true
    exit 1
  fi
  echo "[OK] pending user business API blocked with HTTP 403"
}

require_cmd curl
require_cmd node

echo ">>> smoke target"
echo "FRONTEND_URL=$FRONTEND_URL"
echo "API_BASE_URL=$API_BASE_URL"
echo "REQUIRE_HTTPS=$REQUIRE_HTTPS"
echo "SMOKE_CHECK_PENDING_REGISTRATION=$SMOKE_CHECK_PENDING_REGISTRATION"
echo "SMOKE_PREVIEW_AUDIO_STREAM_URL=${SMOKE_PREVIEW_AUDIO_STREAM_URL:+<set>}"
echo "SMOKE_OSS_CDN_URL=${SMOKE_OSS_CDN_URL:+<set>}"
echo "SMOKE_PUBLIC_TEMPLATE_IMAGE_URL=${SMOKE_PUBLIC_TEMPLATE_IMAGE_URL:+<set>}"
echo "SMOKE_PUBLIC_TEMPLATE_REQUIRED=$SMOKE_PUBLIC_TEMPLATE_REQUIRED"

check_https_entrypoint
check_http "frontend page" "${FRONTEND_URL%/}/"
check_static_cache_headers
check_http "backend health" "${API_BASE_URL%/}"
check_json "health" "${API_BASE_URL%/}/health"
if [[ -n "$HEALTH_DEEP_TOKEN" ]]; then
  check_json "deep health" "${API_BASE_URL%/}/health/deep" "X-Health-Token: ${HEALTH_DEEP_TOKEN}"
else
  check_json "deep health" "${API_BASE_URL%/}/health/deep"
fi
check_json "core public api" "${API_BASE_URL%/}/v1/tools/digital-human-env"
check_preview_audio_range_stream
check_oss_cdn_range_stream
check_public_template_image

if [[ -n "${SMOKE_TOKEN:-}" ]]; then
  check_json "auth me" "${API_BASE_URL%/}/v1/auth/me" "Authorization: Bearer ${SMOKE_TOKEN}"
  if [[ "${SMOKE_CREATE_TASK:-1}" == "1" ]]; then
    code="$(curl -sS -o /tmp/shuziren-smoke-body.txt -w '%{http_code}' \
      --connect-timeout 3 --max-time "$SMOKE_TIMEOUT_SECONDS" \
      -X POST "${API_BASE_URL%/}/v1/tasks" \
      -H "Authorization: Bearer ${SMOKE_TOKEN}" \
      -H 'Content-Type: application/json' \
      -d '{"sourceVideoUrl":"https://www.douyin.com/video/0000000000000000000","initialTranscript":"smoke test"}' || true)"
    case "$code" in
      2*|3*|400)
        echo "[OK] minimal task endpoint reachable HTTP $code"
        ;;
      *)
        echo "[X] minimal task endpoint failed: HTTP $code" >&2
        sed -n '1,20p' /tmp/shuziren-smoke-body.txt >&2 || true
        exit 1
        ;;
    esac
  fi
else
  echo "[!] SMOKE_TOKEN not set; skipping authenticated /v1/auth/me check"
  echo "[!] SMOKE_TOKEN not set; skipping minimal task creation check"
fi

check_pending_registration_gate

echo
echo "[OK] smoke-test completed"
