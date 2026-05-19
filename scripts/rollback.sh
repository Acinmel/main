#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ROLLBACK_SCRIPT="${ROLLBACK_SCRIPT:-deploy/rollback.sh}"

if [[ ! -f "$ROLLBACK_SCRIPT" ]]; then
  echo "[X] Rollback script not found: $ROLLBACK_SCRIPT" >&2
  exit 1
fi

echo ">>> Delegating rollback to $ROLLBACK_SCRIPT"
echo "Runtime dir: ${SHUZIREN_RUNTIME_DIR:-/opt/shuziren-runtime}"
echo "Env file: ${SHUZIREN_ENV_FILE:-/opt/shuziren-runtime/.env}"
echo "Backend env file: ${SHUZIREN_BACKEND_ENV_FILE:-/opt/shuziren-runtime/backend.env}"

bash "$ROLLBACK_SCRIPT"
