#!/usr/bin/env bash
# Nightly backup: database (custom-format dump) + uploaded files. Keep copies off the server.
# Usage: DATABASE_URL=... STORAGE_DIR=/data/storage BACKUP_DIR=/backups ./scripts/backup.sh
set -euo pipefail
: "${DATABASE_URL:?}" "${BACKUP_DIR:?}"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "$BACKUP_DIR"
pg_dump --format=custom --no-owner --file "$BACKUP_DIR/forgehse-db-$STAMP.dump" "$DATABASE_URL"
if [ -n "${STORAGE_DIR:-}" ] && [ -d "$STORAGE_DIR" ]; then
  tar -C "$STORAGE_DIR" -czf "$BACKUP_DIR/forgehse-files-$STAMP.tar.gz" .
fi
# Retention: keep 30 days locally.
find "$BACKUP_DIR" -name 'forgehse-*' -mtime +30 -delete
echo "Backup written: $BACKUP_DIR/*-$STAMP.*"
