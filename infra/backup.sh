#!/usr/bin/env bash
# Daily pg_dump of the loyalty schema, shipped to the backups bucket.
# Wire into cron with: 0 3 * * * /opt/stampee/infra/backup.sh
#
# Retention: GCS lifecycle policy on the bucket (e.g. delete > 90 days).
# Local cache: keep 7 days, then prune.

set -euo pipefail

cd "$(dirname "$0")"

BACKUP_DIR="${BACKUP_DIR:-/var/backups/stampee}"
BUCKET="${BACKUP_BUCKET:-gs://stampee-backups}"

mkdir -p "$BACKUP_DIR"

STAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
FILE="$BACKUP_DIR/appdb-$STAMP.dump"

echo "==> dumping to $FILE"
docker compose --env-file .env exec -T postgres \
  pg_dump -Fc -n loyalty -U "${POSTGRES_USER:-loyalty_user}" "${POSTGRES_DB:-appdb}" \
  > "$FILE"

echo "==> uploading to $BUCKET/$(basename "$FILE")"
gsutil cp "$FILE" "$BUCKET/$(basename "$FILE")"

echo "==> pruning local dumps older than 7 days"
find "$BACKUP_DIR" -name 'appdb-*.dump' -mtime +7 -delete

echo "==> done"
