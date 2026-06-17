#!/bin/bash
# Coach-Cron: prueft alle 5min:
#  1. Daily Briefing — taeglich um TARGET_HOUR (default 07)
#  2. Weekly Plan — Sonntag um WEEKLY_HOUR (default 09)
# POSTet an /api/coach/auto-generate bzw. /api/coach/weekly-plan/auto-generate.

set -u

APP_URL="${APP_URL:-http://app:3000}"
TARGET_HOUR="${COACH_HOUR:-07}"
WEEKLY_HOUR="${WEEKLY_PLAN_HOUR:-09}"
LAST_RUN_FILE="/tmp/last-coach-run"
LAST_WEEKLY_FILE="/tmp/last-weekly-run"

if [ -z "${COACH_CRON_TOKEN:-}" ]; then
  echo "[coach-cron] COACH_CRON_TOKEN nicht gesetzt — laufe idle"
  while true; do sleep 3600; done
fi

echo "[coach-cron] gestartet — daily=${TARGET_HOUR}:00, weekly=Sonntag ${WEEKLY_HOUR}:00, app=${APP_URL}"

while true; do
  # Base-10 forcen damit Stunden mit fuehrender Null (z.B. "09") nicht als oktal interpretiert werden.
  now_hour=$((10#$(date +%H)))
  target_hour=$((10#$TARGET_HOUR))
  weekly_hour=$((10#$WEEKLY_HOUR))
  today=$(date +%Y-%m-%d)
  dow=$(date +%u)  # 1=Mo .. 7=So
  this_week=$(date +%G-W%V)  # ISO Jahr+Wochennummer
  last_run=""
  last_weekly=""
  if [ -f "$LAST_RUN_FILE" ]; then last_run=$(cat "$LAST_RUN_FILE"); fi
  if [ -f "$LAST_WEEKLY_FILE" ]; then last_weekly=$(cat "$LAST_WEEKLY_FILE"); fi

  # Daily Briefing
  if [ "$now_hour" -ge "$target_hour" ] && [ "$now_hour" -lt "$((target_hour + 1))" ] && [ "$last_run" != "$today" ]; then
    echo "[coach-cron] $(date) — daily briefing..."
    response=$(curl -sS -X POST \
      -H "X-Cron-Token: $COACH_CRON_TOKEN" \
      -H "Content-Type: application/json" \
      --max-time 180 \
      "${APP_URL}/api/coach/auto-generate" || echo "ERROR")
    echo "[coach-cron] daily response: $response"
    echo "$today" > "$LAST_RUN_FILE"
  fi

  # Weekly Plan — Sonntag (dow=7) zur WEEKLY_HOUR
  if [ "$dow" = "7" ] && [ "$now_hour" -ge "$weekly_hour" ] && [ "$now_hour" -lt "$((weekly_hour + 1))" ] && [ "$last_weekly" != "$this_week" ]; then
    echo "[coach-cron] $(date) — weekly plan..."
    response=$(curl -sS -X POST \
      -H "X-Cron-Token: $COACH_CRON_TOKEN" \
      -H "Content-Type: application/json" \
      --max-time 180 \
      "${APP_URL}/api/coach/weekly-plan/auto-generate" || echo "ERROR")
    echo "[coach-cron] weekly response: $response"
    echo "$this_week" > "$LAST_WEEKLY_FILE"
  fi

  sleep 300   # 5min
done
