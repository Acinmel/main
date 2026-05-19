#!/usr/bin/env bash

set -euo pipefail

FRONTEND_URL="${FRONTEND_URL:-http://127.0.0.1:${WEB_PORT:-8080}}"
API_BASE_URL="${API_BASE_URL:-${FRONTEND_URL%/}/api}"
SMOKE_TIMEOUT_SECONDS="${SMOKE_TIMEOUT_SECONDS:-10}"
HEALTH_DEEP_TOKEN="${HEALTH_DEEP_TOKEN:-}"
REQUIRE_HTTPS="${REQUIRE_HTTPS:-0}"

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

require_cmd curl
require_cmd node

echo ">>> smoke target"
echo "FRONTEND_URL=$FRONTEND_URL"
echo "API_BASE_URL=$API_BASE_URL"
echo "REQUIRE_HTTPS=$REQUIRE_HTTPS"

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

echo
echo "[OK] smoke-test completed"
