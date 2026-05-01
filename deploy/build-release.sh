#!/usr/bin/env bash
# Build an artifact-only zip package on a development machine or CI runner.
# Usage: APP_VERSION=20260501-001 bash deploy/build-release.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

APP_VERSION="${APP_VERSION:-}"
if [[ -z "$APP_VERSION" ]]; then
  echo "[X] APP_VERSION is required, for example: APP_VERSION=20260501-001 bash deploy/build-release.sh" >&2
  exit 1
fi

if [[ ! "$APP_VERSION" =~ ^[0-9]{8}-[0-9]{3}$ ]]; then
  echo "[X] APP_VERSION must match YYYYMMDD-NNN, got: $APP_VERSION" >&2
  exit 1
fi

require_file() {
  local file="$1"
  if [[ ! -f "$file" ]]; then
    echo "[X] Missing required file: $file" >&2
    exit 1
  fi
}

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "[X] Missing required command: $cmd" >&2
    exit 1
  fi
}

require_cmd npm
require_cmd sha256sum
require_cmd python3

require_file "compose.runtime.yml"
require_file "frontend/Dockerfile"
require_file "backend/Dockerfile"
require_file "deploy/deploy-runtime.sh"
require_file "deploy/rollback.sh"
require_file "deploy/artifact-frontend.Dockerfile"
require_file "deploy/artifact-backend.Dockerfile"

if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  GIT_COMMIT="$(git rev-parse HEAD)"
  if [[ "${ALLOW_DIRTY_RELEASE:-0}" != "1" ]] && [[ -n "$(git status --short)" ]]; then
    echo "[X] Working tree is not clean. Commit/stash changes or set ALLOW_DIRTY_RELEASE=1 for an explicit test package." >&2
    git status --short >&2
    exit 1
  fi
else
  GIT_COMMIT="unknown"
fi

echo ">>> Running build verification"
npm --prefix frontend ci
npm --prefix frontend run build
npm --prefix backend/DY-DOWNLOADER ci
npm --prefix backend/DY-DOWNLOADER run build
npm --prefix backend ci
npm --prefix backend run build

if [[ "${RUN_BACKEND_TESTS:-0}" == "1" ]]; then
  npm --prefix backend run test
fi

VITE_API_BASE_URL="${VITE_API_BASE_URL:-/api}"

OUT_DIR="$ROOT/dist-release"
PKG_NAME="shuziren-release-${APP_VERSION}"
PKG_DIR="$OUT_DIR/$PKG_NAME"

rm -rf "$PKG_DIR"
rm -f "$OUT_DIR/${PKG_NAME}.zip" "$OUT_DIR/${PKG_NAME}.zip.sha256"
mkdir -p "$PKG_DIR"

echo ">>> Packaging build artifacts"
mkdir -p \
  "$PKG_DIR/frontend/dist" \
  "$PKG_DIR/backend/dist" \
  "$PKG_DIR/backend/DY-DOWNLOADER/dist"

cp -R frontend/dist/. "$PKG_DIR/frontend/dist/"
cp frontend/deploy/nginx-web.conf "$PKG_DIR/frontend/nginx-web.conf"
cp deploy/artifact-frontend.Dockerfile "$PKG_DIR/frontend/Dockerfile"

cp -R backend/dist/. "$PKG_DIR/backend/dist/"
cp backend/package.json backend/package-lock.json "$PKG_DIR/backend/"
cp backend/DY-DOWNLOADER/package.json backend/DY-DOWNLOADER/package-lock.json "$PKG_DIR/backend/DY-DOWNLOADER/"
cp -R backend/DY-DOWNLOADER/dist/. "$PKG_DIR/backend/DY-DOWNLOADER/dist/"
if [[ -f backend/DY-DOWNLOADER/README.md ]]; then
  cp backend/DY-DOWNLOADER/README.md "$PKG_DIR/backend/DY-DOWNLOADER/"
fi
if [[ -f backend/DY-DOWNLOADER/LICENSE ]]; then
  cp backend/DY-DOWNLOADER/LICENSE "$PKG_DIR/backend/DY-DOWNLOADER/"
fi
cp deploy/artifact-backend.Dockerfile "$PKG_DIR/backend/Dockerfile"

cp compose.runtime.yml "$PKG_DIR/compose.runtime.yml"
cp deploy/deploy-runtime.sh "$PKG_DIR/deploy-runtime.sh"
cp deploy/rollback.sh "$PKG_DIR/rollback.sh"

cat > "$PKG_DIR/VERSION" <<EOF
APP_VERSION=${APP_VERSION}
GIT_COMMIT=${GIT_COMMIT}
BUILD_TIME_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)
VITE_API_BASE_URL=${VITE_API_BASE_URL}
EOF

(
  cd "$PKG_DIR"
  find . -type f -not -name SHA256SUMS -print0 \
    | sort -z \
    | xargs -0 sha256sum > SHA256SUMS
)

python3 - "$OUT_DIR" "$PKG_NAME" <<'PY'
import os
import sys
import zipfile

out_dir, pkg_name = sys.argv[1], sys.argv[2]
pkg_dir = os.path.join(out_dir, pkg_name)
zip_path = os.path.join(out_dir, f"{pkg_name}.zip")

with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
    for root, _, files in os.walk(pkg_dir):
        for name in files:
            path = os.path.join(root, name)
            arcname = os.path.relpath(path, out_dir)
            zf.write(path, arcname)
PY
sha256sum "$OUT_DIR/${PKG_NAME}.zip" > "$OUT_DIR/${PKG_NAME}.zip.sha256"

echo ">>> Release package created:"
echo "    $OUT_DIR/${PKG_NAME}.zip"
echo "    $OUT_DIR/${PKG_NAME}.zip.sha256"
echo ">>> Upload only the .zip file to the server; Docker images are built on the server from these artifacts."
