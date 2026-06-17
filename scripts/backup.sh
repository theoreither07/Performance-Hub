#!/bin/sh
# Daily Postgres-Dump (lauft im backup-Container per cron 03:00).
# Behaelt die letzten 14 Tage + jeweils 1. des Monats fuer 12 Monate.

set -eu

TS=$(date +%Y%m%d_%H%M%S)
DAY=$(date +%d)
FILE="/backups/dashboard_${TS}.sql.gz"

echo "[backup] starting at ${TS}"
pg_dump -h postgres -U dashboard -d dashboard | gzip > "$FILE"
echo "[backup] wrote ${FILE}"

# Daily retention: 14 Tage
find /backups -name "dashboard_*.sql.gz" -type f -mtime +14 -delete

# Monatlich: am 1. eines Monats umkopieren in monthly/
if [ "$DAY" = "01" ]; then
  mkdir -p /backups/monthly
  cp "$FILE" "/backups/monthly/dashboard_$(date +%Y%m).sql.gz"
  find /backups/monthly -name "dashboard_*.sql.gz" -type f -mtime +400 -delete
fi

echo "[backup] done"
