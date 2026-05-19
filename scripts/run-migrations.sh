#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-shuziren}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
COMPOSE_ENV_FILE="${COMPOSE_ENV_FILE:-.deploy.env}"
MYSQL_SERVICE="${MYSQL_SERVICE:-mysql}"
MIGRATIONS_DIR="${MIGRATIONS_DIR:-$ROOT/database/migrations}"

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

if [[ ! -d "$MIGRATIONS_DIR" ]]; then
  echo "[X] Migration directory not found: $MIGRATIONS_DIR" >&2
  exit 1
fi

mapfile -t migrations < <(find "$MIGRATIONS_DIR" -maxdepth 1 -type f -name '*.sql' | sort)
if [[ "${#migrations[@]}" -eq 0 ]]; then
  echo "[OK] No SQL migrations found in $MIGRATIONS_DIR"
  exit 0
fi

echo ">>> Waiting for MySQL service: $MYSQL_SERVICE"
for attempt in $(seq 1 60); do
  if compose exec -T "$MYSQL_SERVICE" sh -lc 'mysqladmin ping -h localhost -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" --silent' >/dev/null 2>&1; then
    break
  fi
  if [[ "$attempt" -eq 60 ]]; then
    echo "[X] MySQL service is not ready after 120 seconds" >&2
    exit 1
  fi
  sleep 2
done

for migration in "${migrations[@]}"; do
  echo ">>> Applying migration: $(basename "$migration")"
  compose exec -T "$MYSQL_SERVICE" sh -lc 'mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"' < "$migration"
done

echo "[OK] Database migrations completed"
