#!/usr/bin/env bash
# Restore a backup INTO AN EMPTY DATABASE. Stop the app first.
# Usage: DATABASE_URL=... ./scripts/restore.sh /backups/forgehse-db-<stamp>.dump [/backups/forgehse-files-<stamp>.tar.gz] [STORAGE_DIR]
set -euo pipefail
: "${DATABASE_URL:?}"
DUMP="${1:?path to .dump}"
pg_restore --no-owner --exit-on-error --dbname "$DATABASE_URL" "$DUMP"
if [ -n "${2:-}" ]; then
  : "${3:?STORAGE_DIR required when restoring files}"
  mkdir -p "$3" && tar -C "$3" -xzf "$2"
fi
echo "Restore complete. Start the app and check /api/ready."
