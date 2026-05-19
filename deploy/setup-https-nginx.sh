#!/usr/bin/env bash

set -euo pipefail

APP_DOMAIN="${APP_DOMAIN:-}"
ACME_EMAIL="${ACME_EMAIL:-}"
UPSTREAM_URL="${UPSTREAM_URL:-http://127.0.0.1:8080}"
NGINX_CONF_PATH="${NGINX_CONF_PATH:-/etc/nginx/conf.d/shuziren.conf}"
CERTBOT_WEBROOT="${CERTBOT_WEBROOT:-/var/www/certbot}"
TEMPLATE_PATH="${TEMPLATE_PATH:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/nginx-host-reverse-proxy.conf}"

if [[ -z "$APP_DOMAIN" ]]; then
  echo "[X] APP_DOMAIN is required, for example: APP_DOMAIN=app.example.com" >&2
  exit 1
fi
if [[ -z "$ACME_EMAIL" ]]; then
  echo "[X] ACME_EMAIL is required for Let's Encrypt registration" >&2
  exit 1
fi
if [[ "$APP_DOMAIN" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "[X] A public domain is required. Browser-trusted HTTPS cannot be issued for a raw IP: $APP_DOMAIN" >&2
  exit 1
fi
if [[ "$UPSTREAM_URL" != http://* ]]; then
  echo "[X] UPSTREAM_URL must be an internal HTTP URL, for example http://127.0.0.1:8080" >&2
  exit 1
fi
if [[ ! -f "$TEMPLATE_PATH" ]]; then
  echo "[X] Missing nginx template: $TEMPLATE_PATH" >&2
  exit 1
fi

for cmd in nginx certbot curl sed; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "[X] Missing required command: $cmd" >&2
    exit 1
  fi
done

mkdir -p "$CERTBOT_WEBROOT"
UPSTREAM_ADDR="${UPSTREAM_URL#http://}"
UPSTREAM_ADDR="${UPSTREAM_ADDR%%/*}"

echo ">>> Checking local upstream: $UPSTREAM_URL"
curl -fsS -I --connect-timeout 3 --max-time 10 "$UPSTREAM_URL/" >/dev/null

echo ">>> Writing temporary HTTP-only nginx config for ACME challenge"
cat > "$NGINX_CONF_PATH" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $APP_DOMAIN;

    location ^~ /.well-known/acme-challenge/ {
        root $CERTBOT_WEBROOT;
        default_type "text/plain";
    }

    location / {
        proxy_pass $UPSTREAM_URL;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto http;
    }
}
EOF

nginx -t
systemctl reload nginx

echo ">>> Requesting or renewing certificate"
certbot certonly --webroot \
  -w "$CERTBOT_WEBROOT" \
  -d "$APP_DOMAIN" \
  --email "$ACME_EMAIL" \
  --agree-tos \
  --non-interactive \
  --keep-until-expiring

echo ">>> Installing HTTPS nginx config"
sed \
  -e "s/APP_DOMAIN/$APP_DOMAIN/g" \
  -e "s/server 127.0.0.1:8080;/server $UPSTREAM_ADDR;/" \
  "$TEMPLATE_PATH" > "$NGINX_CONF_PATH"
nginx -t
systemctl reload nginx

echo ">>> HTTPS verification"
curl -fsS -I --connect-timeout 3 --max-time 10 "https://$APP_DOMAIN/" | grep -i '^strict-transport-security:' >/dev/null
curl -sS -I --connect-timeout 3 --max-time 10 "http://$APP_DOMAIN/" | grep -E '^HTTP/.* (301|302|307|308)' >/dev/null

echo "[OK] HTTPS nginx is configured for $APP_DOMAIN"
