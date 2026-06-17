#!/bin/sh
# Run-Loop mit 3 Sync-Modi (User-spuerbar schneller als sequenziell):
#
#  - QUICK (manueller Trigger via Refresh-Button)
#      → letzte 2 Tage, 6 parallel workers, ohne VO2max-Block (das ist tägl. eh stabil)
#      → typisch ~2-4 Sek (vorher: ~50 Sek)
#
#  - AUTO (alle 30 Min Daytime 06:00-23:00)
#      → letzte 3 Tage, 6 parallel workers, ohne VO2max
#
#  - DAILY (06:30-07:00 einmal pro Tag)
#      → volle 30 Tage Backfill, 8 parallel workers, inkl. VO2max + alle Activities
#
# Die 30 Tage Historie liegen in UNSERER Postgres-DB — Garmin liefert nur Deltas.
# Quick-Trigger holt also nur "was neu ist", nicht jedes Mal alles.
#
# Wenn GARMIN_EMAIL fehlt, schlaeft der Container nur (kein Fehler).

set -e

AUTO_INTERVAL=${GARMIN_AUTO_INTERVAL_SEC:-1800}
DAY_START=${GARMIN_AUTO_START_HOUR:-6}
DAY_END=${GARMIN_AUTO_END_HOUR:-23}

QUICK_DAYS=${GARMIN_QUICK_DAYS:-2}
AUTO_DAYS=${GARMIN_AUTO_DAYS:-3}
DAILY_DAYS=${GARMIN_DAILY_DAYS:-30}
WORKERS=${GARMIN_WORKERS:-6}
DAILY_WORKERS=${GARMIN_DAILY_WORKERS:-8}

if [ -z "${GARMIN_EMAIL}" ] || [ -z "${GARMIN_PASSWORD}" ]; then
  echo "[garmin] GARMIN_EMAIL/PASSWORD nicht gesetzt — Sidecar laeuft idle"
  while true; do sleep 3600; done
fi

chmod 0777 /data || true

# Initial-Sync nach Container-Start: 7 Tage (genug fuer typische Score-Berechnung,
# fuller Backfill kommt mit naechstem Daily um 06:30).
echo "[garmin] Initial sync (7 Tage, ${WORKERS} workers)..."
python /app/sync.py --days 7 --workers "$WORKERS" --skip-vo2max || echo "[garmin] initial sync failed"

SYNC_FLAG=/tmp/last-garmin-sync
DAILY_FLAG=/tmp/last-garmin-daily
echo $(date +%s) > $SYNC_FLAG

while true; do
  hour_int=$(date +%-H)
  hour_str=$(date +%H%M)
  last_sync=0
  last_daily=0
  [ -f "$SYNC_FLAG" ] && last_sync=$(cat "$SYNC_FLAG")
  [ -f "$DAILY_FLAG" ] && last_daily=$(cat "$DAILY_FLAG")
  now=$(date +%s)
  since_last=$((now - last_sync))

  # 1) Manueller Trigger (Refresh-Button) → QUICK Mode
  if [ -f /data/trigger-sync ]; then
    echo "[garmin] manueller Trigger → QUICK (${QUICK_DAYS}d, ${WORKERS}w)"
    rm -f /data/trigger-sync
    python /app/sync.py --days "$QUICK_DAYS" --workers "$WORKERS" --skip-vo2max || echo "[garmin] quick sync failed"
    echo $(date +%s) > $SYNC_FLAG
    sleep 5
    continue
  fi

  # 2) Daily Backfill: einmal pro Tag zwischen 06:30 und 07:00
  today_start=$(date -d 'today 00:00' +%s 2>/dev/null || date -v0H -v0M -v0S +%s)
  if [ "$hour_str" -ge "0630" ] && [ "$hour_str" -lt "0700" ] && [ "$last_daily" -lt "$today_start" ]; then
    echo "[garmin] daily backfill → DAILY (${DAILY_DAYS}d, ${DAILY_WORKERS}w, inkl. VO2max)"
    python /app/sync.py --days "$DAILY_DAYS" --workers "$DAILY_WORKERS" || echo "[garmin] daily sync failed"
    echo $(date +%s) > $DAILY_FLAG
    echo $(date +%s) > $SYNC_FLAG
    sleep 30
    continue
  fi

  # 3) Auto-Sync alle AUTO_INTERVAL Sek im Daytime → AUTO Mode
  if [ "$hour_int" -ge "$DAY_START" ] && [ "$hour_int" -lt "$DAY_END" ]; then
    if [ "$since_last" -ge "$AUTO_INTERVAL" ]; then
      echo "[garmin] Auto-Sync → AUTO (${AUTO_DAYS}d, ${WORKERS}w, ${since_last}s seit letztem)"
      python /app/sync.py --days "$AUTO_DAYS" --workers "$WORKERS" --skip-vo2max || echo "[garmin] auto sync failed"
      echo $(date +%s) > $SYNC_FLAG
    fi
  fi

  sleep 15   # alle 15s pruefen — schneller Pickup bei Refresh-Button
done
