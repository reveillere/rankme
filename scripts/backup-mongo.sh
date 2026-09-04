#!/bin/sh
# Dumps the mongo container's data and keeps the last $KEEP archives locally.
#
# This only covers "take a local snapshot on a schedule" — it does NOT copy
# the archive off this box, which is the part that actually protects against
# losing the machine. Point the OFFSITE_* variables below at wherever
# backups should really live (another host, S3, a NAS...) once you have one,
# or add your own step after this script runs.
#
# Usage (from the repo root):
#   ./scripts/backup-mongo.sh [docker-compose.prod.yml|docker-compose.dev.yml]
#
# Cron example (daily at 03:00, prod):
#   0 3 * * * cd /path/to/rankme && ./scripts/backup-mongo.sh docker-compose.prod.yml >> backups/backup.log 2>&1

set -eu

COMPOSE_FILE="${1:-docker-compose.prod.yml}"
BACKUP_DIR="$(cd "$(dirname "$0")/.." && pwd)/backups"
KEEP=14
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ARCHIVE="$BACKUP_DIR/mongo-$TIMESTAMP.archive.gz"

# OFFSITE_HOST="user@backup-host"
# OFFSITE_PATH="/srv/backups/rankme/"

mkdir -p "$BACKUP_DIR"

echo "[backup-mongo] dumping to $ARCHIVE"
docker compose -f "$COMPOSE_FILE" exec -T mongo \
  mongodump --archive --gzip > "$ARCHIVE"

# if [ -n "${OFFSITE_HOST:-}" ]; then
#   echo "[backup-mongo] copying to $OFFSITE_HOST:$OFFSITE_PATH"
#   rsync -a "$ARCHIVE" "$OFFSITE_HOST:$OFFSITE_PATH"
# fi

echo "[backup-mongo] pruning archives older than the last $KEEP"
ls -1t "$BACKUP_DIR"/mongo-*.archive.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm --

echo "[backup-mongo] done: $(du -h "$ARCHIVE" | cut -f1)"
