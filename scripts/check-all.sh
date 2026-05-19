#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

log() {
  printf '\n>>> %s\n' "$1"
}

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "[X] Missing required command: $cmd" >&2
    exit 1
  fi
}

npm_install() {
  local dir="$1"
  if [[ -f "$dir/package-lock.json" ]]; then
    npm --prefix "$dir" ci
  else
    npm --prefix "$dir" install
  fi
}

has_npm_script() {
  local dir="$1"
  local script="$2"
  node -e "const p=require('./${dir}/package.json'); process.exit(p.scripts && p.scripts['${script}'] ? 0 : 1)"
}

npm_script_value() {
  local dir="$1"
  local script="$2"
  node -e "const p=require('./${dir}/package.json'); console.log((p.scripts && p.scripts['${script}']) || '')"
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

run_frontend_lint() {
  if has_npm_script frontend lint; then
    npm --prefix frontend run lint
    return
  fi
  if has_npm_script frontend typecheck; then
    echo "[!] frontend has no lint script; running typecheck as lint gate"
    npm --prefix frontend run typecheck
    return
  fi
  echo "[X] frontend has no lint or typecheck script" >&2
  exit 1
}

run_backend_lint() {
  local lint_script
  lint_script="$(npm_script_value backend lint)"
  if [[ -z "$lint_script" ]]; then
    echo "[X] backend has no lint script" >&2
    exit 1
  fi
  if [[ "$lint_script" == *"--fix"* ]]; then
    echo "[!] backend lint script contains --fix; running non-mutating eslint"
    (cd backend && npx eslint "{src,apps,libs,test}/**/*.ts")
    return
  fi
  npm --prefix backend run lint
}

require_cmd node
require_cmd npm
require_cmd docker

log "frontend install"
npm_install frontend

log "frontend lint"
run_frontend_lint

log "frontend build"
npm --prefix frontend run build

if [[ -f backend/DY-DOWNLOADER/package.json ]]; then
  log "backend dy-downloader install"
  npm_install backend/DY-DOWNLOADER

  if has_npm_script backend/DY-DOWNLOADER build; then
    log "backend dy-downloader build"
    npm --prefix backend/DY-DOWNLOADER run build
  fi
fi

log "backend install"
npm_install backend

log "backend lint"
run_backend_lint

log "backend test"
npm --prefix backend run test

log "backend build"
npm --prefix backend run build

log "docker compose config"
compose config >/dev/null

echo
echo "[OK] check-all completed"
