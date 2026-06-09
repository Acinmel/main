#!/usr/bin/env bash
set -euo pipefail

MODE="dry-run"
RUNTIME_DIR="${SHUZIREN_RUNTIME_DIR:-/opt/shuziren-runtime/current}"
BACKUP_ROOT="${OPS022_BACKUP_ROOT:-/opt/shuziren-runtime/backups}"
PROJECT_NAME="${COMPOSE_PROJECT_NAME:-shuziren}"

usage() {
  cat <<'EOF'
Usage:
  bash scripts/ops-022-cleanup-builtin-voices.sh [--runtime-dir DIR] [--backup-root DIR] [--execute]

Default mode is dry-run. It only exports backup files and deletion manifests.

What it targets:
  voice_resources rows where user_id IS NULL AND is_recommended = 1

Safety:
  - Does not touch user-owned voices.
  - Always writes SQL/TSV backups before any delete.
  - Deletes database rows only with --execute.
  - Local sample files are moved into the backup directory only with --execute.
  - OSS objects are never deleted automatically; a manifest is written for manual review.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --execute)
      MODE="execute"
      shift
      ;;
    --runtime-dir)
      RUNTIME_DIR="${2:-}"
      shift 2
      ;;
    --backup-root)
      BACKUP_ROOT="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[ERR] Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ ! -d "$RUNTIME_DIR" ]]; then
  echo "[ERR] Runtime dir not found: $RUNTIME_DIR" >&2
  exit 1
fi

cd "$RUNTIME_DIR"

if [[ ! -f ".deploy.env" ]]; then
  echo "[ERR] .deploy.env not found in $RUNTIME_DIR" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
source ".deploy.env"
set +a

: "${MYSQL_DATABASE:?MYSQL_DATABASE is required}"
: "${MYSQL_USER:?MYSQL_USER is required}"
: "${MYSQL_PASSWORD:?MYSQL_PASSWORD is required}"

TS="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_DIR="$BACKUP_ROOT/ops-022-builtin-voices-$TS"
mkdir -p "$BACKUP_DIR"

COMPOSE=(docker compose --env-file .deploy.env -p "$PROJECT_NAME" -f compose.runtime.yml)
MYSQL=(mysql -N -B -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE")
MYSQL_TABLE=(mysql -t -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE")

WHERE_CLAUSE="user_id IS NULL AND is_recommended = 1"

echo ">>> OPS-022 builtin voice cleanup"
echo "mode=$MODE"
echo "runtime=$RUNTIME_DIR"
echo "backup_dir=$BACKUP_DIR"

echo ">>> Matching rows"
"${COMPOSE[@]}" exec -T mysql "${MYSQL_TABLE[@]}" \
  -e "SELECT id, name, audio_url, clone_status, provider, provider_voice, provider_model, created_at, updated_at FROM voice_resources WHERE $WHERE_CLAUSE ORDER BY updated_at DESC, id;"

COUNT="$("${COMPOSE[@]}" exec -T mysql "${MYSQL[@]}" \
  -e "SELECT COUNT(1) FROM voice_resources WHERE $WHERE_CLAUSE;" | tr -d '\r' | tail -n 1)"

echo "$COUNT" > "$BACKUP_DIR/count.txt"
echo "matched_count=$COUNT"

echo ">>> Exporting row backup"
"${COMPOSE[@]}" exec -T mysql mysqldump \
  -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" voice_resources \
  --where="$WHERE_CLAUSE" \
  --no-create-info \
  --skip-triggers \
  --single-transaction \
  > "$BACKUP_DIR/voice_resources_builtin_backup.sql"

"${COMPOSE[@]}" exec -T mysql "${MYSQL[@]}" \
  -e "SELECT id, name, audio_url, clone_status, provider, provider_voice, provider_model, sample_duration_ms, clone_error, created_at, updated_at FROM voice_resources WHERE $WHERE_CLAUSE ORDER BY updated_at DESC, id;" \
  > "$BACKUP_DIR/voice_resources_builtin_backup.tsv"

"${COMPOSE[@]}" exec -T mysql "${MYSQL[@]}" \
  -e "SELECT audio_url FROM voice_resources WHERE $WHERE_CLAUSE AND audio_url IS NOT NULL AND audio_url <> '' ORDER BY updated_at DESC, id;" \
  > "$BACKUP_DIR/audio_urls.txt"

LOCAL_FILES_MANIFEST="$BACKUP_DIR/local-files.tsv"
OSS_OBJECTS_MANIFEST="$BACKUP_DIR/oss-objects.txt"
: > "$LOCAL_FILES_MANIFEST"
: > "$OSS_OBJECTS_MANIFEST"

VOICE_SAMPLE_DIR="${VOICE_SAMPLE_DIR:-/workspace/data/voice-samples}"
VOICE_SAMPLE_OSS_PREFIX="${VOICE_SAMPLE_OSS_PREFIX:-voice-samples}"

echo ">>> Building file manifests"
while IFS= read -r audio_url; do
  [[ -z "$audio_url" ]] && continue

  decoded="$audio_url"
  if command -v python3 >/dev/null 2>&1; then
    decoded="$(python3 - "$audio_url" <<'PY'
import sys
from urllib.parse import unquote
print(unquote(sys.argv[1]))
PY
)"
  fi

  if [[ "$decoded" =~ /voice-files/([^/]+)/stream ]]; then
    file_name="${BASH_REMATCH[1]}"
    host_path="$VOICE_SAMPLE_DIR/$file_name"
    echo -e "$audio_url\t$host_path" >> "$LOCAL_FILES_MANIFEST"
  elif [[ "$decoded" == "$VOICE_SAMPLE_OSS_PREFIX/"* ]]; then
    echo "$decoded" >> "$OSS_OBJECTS_MANIFEST"
  elif [[ "$decoded" == oss://* ]]; then
    echo "$decoded" >> "$OSS_OBJECTS_MANIFEST"
  else
    echo -e "$audio_url\tUNKNOWN" >> "$LOCAL_FILES_MANIFEST"
  fi
done < "$BACKUP_DIR/audio_urls.txt"

cat > "$BACKUP_DIR/ROLLBACK.md" <<EOF
# OPS-022 Rollback

Created at: $TS

## Restore database rows

\`\`\`bash
cd $RUNTIME_DIR
set -a
source .deploy.env
set +a
docker compose --env-file .deploy.env -p $PROJECT_NAME -f compose.runtime.yml exec -T mysql \\
  mysql -u"\$MYSQL_USER" -p"\$MYSQL_PASSWORD" "\$MYSQL_DATABASE" \\
  < $BACKUP_DIR/voice_resources_builtin_backup.sql
\`\`\`

## Restore local files

Files moved by this script, if any, are stored under:

\`\`\`text
$BACKUP_DIR/local-files/
\`\`\`

Move them back to the original path listed in:

\`\`\`text
$LOCAL_FILES_MANIFEST
\`\`\`

If local sample files are stored in a Docker volume rather than a host directory,
set VOICE_SAMPLE_DIR to the host-mounted sample directory before running cleanup.

## OSS files

This script does not delete OSS objects automatically. If OSS cleanup was done manually,
restore those objects from OSS versioning or the manual backup used during deletion.
Review manifest:

\`\`\`text
$OSS_OBJECTS_MANIFEST
\`\`\`
EOF

if [[ "$MODE" != "execute" ]]; then
  echo ">>> Dry-run completed. No database rows or files were deleted."
  echo "backup_dir=$BACKUP_DIR"
  exit 0
fi

echo ">>> EXECUTE mode enabled"
echo ">>> Moving local files into backup directory when they exist on host"
mkdir -p "$BACKUP_DIR/local-files"

while IFS=$'\t' read -r audio_url host_path; do
  [[ -z "${host_path:-}" || "$host_path" == "UNKNOWN" ]] && continue
  if [[ -f "$host_path" ]]; then
    safe_name="$(basename "$host_path")"
    mv -- "$host_path" "$BACKUP_DIR/local-files/$safe_name"
    echo -e "$audio_url\t$host_path\t$BACKUP_DIR/local-files/$safe_name" >> "$BACKUP_DIR/moved-local-files.tsv"
  fi
done < "$LOCAL_FILES_MANIFEST"

echo ">>> Deleting builtin voice rows"
"${COMPOSE[@]}" exec -T mysql "${MYSQL[@]}" \
  -e "DELETE FROM voice_resources WHERE $WHERE_CLAUSE;"

REMAINING="$("${COMPOSE[@]}" exec -T mysql "${MYSQL[@]}" \
  -e "SELECT COUNT(1) FROM voice_resources WHERE $WHERE_CLAUSE;" | tr -d '\r' | tail -n 1)"

echo "$REMAINING" > "$BACKUP_DIR/remaining-count.txt"
echo "remaining_count=$REMAINING"

if [[ "$REMAINING" != "0" ]]; then
  echo "[ERR] Cleanup did not remove all builtin voice rows. See $BACKUP_DIR" >&2
  exit 1
fi

echo "[OK] OPS-022 cleanup completed"
echo "backup_dir=$BACKUP_DIR"
