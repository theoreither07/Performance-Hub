"""
Garmin Sync Sidecar.

Holt die letzten N Tage an Health-Daten von Garmin Connect (inoffizielle API
via python-garminconnect) und schreibt sie als HealthMetric-Eintraege in
unsere Postgres-DB.

Idempotent: nutzt UPSERT auf (date, kind).
"""
import argparse
import json
import os
import sys
import time
import traceback
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, timedelta
from typing import Any, Iterable

from urllib.parse import urlparse, urlunparse, parse_qsl, urlencode

import psycopg2
import psycopg2.extras
from garminconnect import Garmin

GARMIN_EMAIL = os.environ.get("GARMIN_EMAIL")
GARMIN_PASSWORD = os.environ.get("GARMIN_PASSWORD")
DAYS_BACK_DEFAULT = int(os.environ.get("GARMIN_DAYS_BACK", "30"))
TOKEN_STORE = os.environ.get("GARMIN_TOKEN_STORE", "/data/garth")


def _clean_db_url(url: str) -> str:
    # Prisma's "?schema=public" mag psycopg2 nicht.
    parsed = urlparse(url)
    qs = [(k, v) for k, v in parse_qsl(parsed.query) if k != "schema"]
    cleaned = parsed._replace(query=urlencode(qs))
    return urlunparse(cleaned)


DB_URL = _clean_db_url(os.environ["DATABASE_URL"])


def conn():
    return psycopg2.connect(DB_URL)


def start_run(c) -> int:
    cur = c.cursor()
    cur.execute(
        'INSERT INTO "GarminSyncRun" ("startedAt") VALUES (NOW()) RETURNING id'
    )
    run_id = cur.fetchone()[0]
    c.commit()
    return run_id


def finish_run(c, run_id: int, success: bool, written: int, error: str | None):
    # Falls die Connection in einem aborted state ist (vorheriger SQL-Fehler ohne rollback),
    # erst rollback, dann fresh transaction für das UPDATE.
    try:
        c.rollback()
    except Exception:
        pass
    try:
        cur = c.cursor()
        cur.execute(
            'UPDATE "GarminSyncRun" SET "finishedAt" = NOW(), success = %s, "metricsWritten" = %s, error = %s WHERE id = %s',
            (success, written, error, run_id),
        )
        c.commit()
    except Exception as e:
        print(f"[garmin] finish_run failed: {e}", file=sys.stderr)
        try: c.rollback()
        except Exception: pass


def upsert_metrics(c, rows: Iterable[tuple[date, str, float, dict[str, Any] | None]]) -> int:
    cur = c.cursor()
    written = 0
    for d, kind, value, meta in rows:
        if value is None:
            continue
        cur.execute(
            'INSERT INTO "HealthMetric" (date, kind, value, meta, "createdAt") VALUES (%s, %s, %s, %s, NOW()) '
            'ON CONFLICT (date, kind) DO UPDATE SET value = EXCLUDED.value, meta = EXCLUDED.meta',
            (d, kind, float(value), json.dumps(meta) if meta else None),
        )
        written += 1
    c.commit()
    return written


def safe(d: dict | None, *keys, default=None):
    cur = d
    for k in keys:
        if not isinstance(cur, dict):
            return default
        cur = cur.get(k)
    return default if cur is None else cur


# Garmin activityType -> unser type Mapping
def map_activity_type(garmin_type: str | None) -> str:
    if not garmin_type:
        return "other"
    t = garmin_type.lower()
    if "run" in t:
        return "running"
    if "cycl" in t or "bike" in t or "ride" in t:
        return "cycling"
    if "strength" in t or "weight" in t or "fitness_equipment" in t:
        return "strength"
    if "yoga" in t or "stretch" in t or "flexibility" in t:
        return "yoga"
    if "swim" in t:
        return "swimming"
    if "hike" in t or "walk" in t:
        return "hiking"
    if "row" in t:
        return "rowing"
    return t.split("_")[0] if "_" in t else t


def fetch_activity_details(api, activity_id: int) -> dict | None:
    """
    Holt detaillierte Activity-Daten von Garmin: Splits/Laps, HR-Curve, Cadence.
    Garmin liefert via /activity-service/activity/{id}/splits + /details.
    """
    try:
        splits = api.connectapi(f"/activity-service/activity/{activity_id}/splits")
    except Exception as e:
        print(f"[garmin] splits {activity_id} failed: {e}", file=sys.stderr)
        splits = None
    try:
        details = api.connectapi(f"/activity-service/activity/{activity_id}/details")
    except Exception as e:
        print(f"[garmin] details {activity_id} failed: {e}", file=sys.stderr)
        details = None
    if splits is None and details is None:
        return None
    return {"splits": splits, "details": details}


def compute_drifts(details: dict | None) -> dict:
    """
    Berechnet Pace- und Cadence-Drift aus Activity-Details.
    Drift = (letztes Quartil avg / erstes Quartil avg - 1) * 100

    WICHTIG: Garmin's directTimestamp ist Unix-Millis (sehr große Zahlen).
    Wir normalisieren auf SECONDS RELATIV zum Activity-Start (small int).
    """
    out = {"paceDriftPct": None, "cadenceDriftPct": None, "hrMaxAt": None,
           "hrCurve": None, "cadenceCurve": None, "timeInZone": None}
    if not details or "activityDetailMetrics" not in details:
        return out
    metrics = details.get("activityDetailMetrics", [])
    metric_keys = details.get("metricDescriptors", [])
    if not metrics or not metric_keys:
        return out

    idx_hr = None
    idx_pace = None
    idx_cad = None
    idx_time = None
    for i, k in enumerate(metric_keys):
        key = k.get("key", "")
        if "heartRate" in key.lower() or key == "directHeartRate":
            idx_hr = i
        elif "speed" in key.lower() or "pace" in key.lower():
            idx_pace = i
        elif "cadence" in key.lower() or "runCadence" in key.lower():
            idx_cad = i
        elif "timestamp" in key.lower() or key == "directTimestamp":
            idx_time = i

    # Sammle Roh-Punkte
    hr_pts = []
    pace_pts = []
    cad_pts = []
    for n, m in enumerate(metrics):
        vals = m.get("metrics", [])
        if not vals: continue
        if idx_time is not None and len(vals) > idx_time and vals[idx_time] is not None:
            t = vals[idx_time]
        else:
            t = n * 5
        if idx_hr is not None and len(vals) > idx_hr and vals[idx_hr] is not None:
            hr_pts.append((t, vals[idx_hr]))
        if idx_pace is not None and len(vals) > idx_pace and vals[idx_pace] is not None:
            pace_pts.append((t, vals[idx_pace]))
        if idx_cad is not None and len(vals) > idx_cad and vals[idx_cad] is not None:
            cad_pts.append((t, vals[idx_cad]))

    # Normalize Timestamps: subtract t0 + ms→sec wenn nötig.
    # Garmin's directTimestamp = unix ms (z.B. 1.7e12). Diff zum t0 in ms.
    # Wir clampen auf int32-Sicher (< 2.1e9), max activity = 24h = 86400s.
    def norm_t(pts):
        if not pts: return pts
        t0 = pts[0][0]
        # Wenn t0 > 1e10, sind die Timestamps in Unix-Millis (echte Dates > 2001).
        # Sonst ist es bereits in Sekunden.
        is_ms = t0 > 1e10
        out_pts = []
        for t, v in pts:
            diff = t - t0
            if is_ms:
                sec = int(diff / 1000)
            else:
                sec = int(diff)
            sec = max(0, min(sec, 86400))
            out_pts.append((sec, v))
        return out_pts

    hr_pts = norm_t(hr_pts)
    pace_pts = norm_t(pace_pts)
    cad_pts = norm_t(cad_pts)

    if hr_pts:
        max_pt = max(hr_pts, key=lambda x: x[1])
        out["hrMaxAt"] = max_pt[0]  # already int + capped
        # Vereinfacht: alle 5min-Buckets als curve
        bucket_sec = 300
        buckets = {}
        for t, v in hr_pts:
            bk = int(t // bucket_sec)
            if bk not in buckets: buckets[bk] = []
            buckets[bk].append(v)
        out["hrCurve"] = [{"tSec": bk * bucket_sec, "hr": round(sum(vs) / len(vs))} for bk, vs in sorted(buckets.items())]

    if cad_pts:
        buckets = {}
        for t, v in cad_pts:
            bk = int(t // 300)
            if bk not in buckets: buckets[bk] = []
            buckets[bk].append(v)
        out["cadenceCurve"] = [{"tSec": bk * 300, "cadence": round(sum(vs) / len(vs))} for bk, vs in sorted(buckets.items())]

    # Pace-Drift — filter Outliers (Speed=0 = Pause/Stop)
    if pace_pts and len(pace_pts) >= 8:
        q = len(pace_pts) // 4
        first = [v for _, v in pace_pts[:q] if v and v > 0.5]
        last = [v for _, v in pace_pts[-q:] if v and v > 0.5]
        if len(first) >= 3 and len(last) >= 3:
            avg_first = sum(first) / len(first)
            avg_last = sum(last) / len(last)
            if avg_first > 0:
                drift = round((avg_last / avg_first - 1) * 100, 1)
                # Cap auf realistic range [-40, +40] % — alles drüber ist Outlier-Noise
                if -40 <= drift <= 40:
                    out["paceDriftPct"] = drift

    # Cadence-Drift — gleiche Outlier-Behandlung
    if cad_pts and len(cad_pts) >= 8:
        q = len(cad_pts) // 4
        first = [v for _, v in cad_pts[:q] if v and v > 50]
        last = [v for _, v in cad_pts[-q:] if v and v > 50]
        if len(first) >= 3 and len(last) >= 3:
            avg_first = sum(first) / len(first)
            avg_last = sum(last) / len(last)
            if avg_first > 0:
                drift = round((avg_last / avg_first - 1) * 100, 1)
                if -30 <= drift <= 30:
                    out["cadenceDriftPct"] = drift

    return out


def upsert_workout_detail(c, workout_id: str, detail_data: dict) -> bool:
    """Speichert WorkoutDetail in DB. Idempotent per workoutId."""
    cur = c.cursor()
    splits = detail_data.get("splits")
    details = detail_data.get("details")
    drifts = compute_drifts(details)

    laps_json = json.dumps(splits.get("lapDTOs") if splits else None) if splits else None

    cur.execute(
        '''INSERT INTO "WorkoutDetail"
           (id, "workoutId", laps, "hrCurve", "cadenceCurve", "hrMaxAt",
            "paceDriftPct", "cadenceDriftPct", "timeInZone", "rawGarminData", "fetchedAt")
           VALUES (gen_random_uuid()::text, %s, %s::jsonb, %s::jsonb, %s::jsonb, %s,
                   %s, %s, %s::jsonb, %s::jsonb, NOW())
           ON CONFLICT ("workoutId") DO UPDATE SET
             laps = EXCLUDED.laps,
             "hrCurve" = EXCLUDED."hrCurve",
             "cadenceCurve" = EXCLUDED."cadenceCurve",
             "hrMaxAt" = EXCLUDED."hrMaxAt",
             "paceDriftPct" = EXCLUDED."paceDriftPct",
             "cadenceDriftPct" = EXCLUDED."cadenceDriftPct",
             "timeInZone" = EXCLUDED."timeInZone",
             "rawGarminData" = EXCLUDED."rawGarminData",
             "fetchedAt" = NOW()''',
        (
            workout_id,
            laps_json,
            json.dumps(drifts.get("hrCurve")) if drifts.get("hrCurve") else None,
            json.dumps(drifts.get("cadenceCurve")) if drifts.get("cadenceCurve") else None,
            drifts.get("hrMaxAt"),
            drifts.get("paceDriftPct"),
            drifts.get("cadenceDriftPct"),
            None,  # timeInZone — already in WorkoutSession.hrZones
            None,  # rawGarminData — Skip um Disk zu schonen, on-demand neu fetchbar
        ),
    )
    c.commit()
    return True


def upsert_workouts(c, activities: list[dict]) -> int:
    """Speichert Garmin-Activities als WorkoutSession-Eintraege."""
    cur = c.cursor()
    count = 0
    for a in activities:
        gid = a.get("activityId")
        if not gid:
            continue
        start_str = a.get("startTimeLocal") or a.get("startTimeGMT")
        if not start_str:
            continue
        # Garmin liefert "2026-05-14 06:45:00" als naive Vienna-local-time.
        # Wir geben dem datetime explizit Europe/Vienna TZ → Postgres timestamptz
        # speichert das als echte UTC. Damit kein TZ-Drift mehr beim Lesen.
        try:
            from dateutil import parser as dt_parser
            from dateutil import tz
            naive_dt = dt_parser.parse(start_str)
            if naive_dt.tzinfo is None:
                start_dt = naive_dt.replace(tzinfo=tz.gettz("Europe/Vienna"))
            else:
                start_dt = naive_dt
            date_only = start_dt.date()
        except Exception:
            continue

        activity_type = safe(a, "activityType", "typeKey") or a.get("activityName") or "other"
        mapped = map_activity_type(activity_type)
        duration = int(a.get("duration") or 0)
        distance = a.get("distance")
        calories = a.get("calories")
        avg_hr = a.get("averageHR")
        max_hr = a.get("maxHR")
        avg_power = a.get("avgPower") or a.get("averagePower")
        training_load = a.get("activityTrainingLoad") or a.get("trainingLoad")
        aerobic = a.get("aerobicTrainingEffect")
        anaerobic = a.get("anaerobicTrainingEffect")

        # HR-Zonen falls vorhanden
        hr_zones = a.get("hrTimeInZone") or None
        hr_zones_json = json.dumps(hr_zones) if hr_zones else None

        cur.execute(
            '''INSERT INTO "WorkoutSession"
               (id, "garminActivityId", date, "startTime", type, name, "durationSec",
                "distanceM", calories, "avgHr", "maxHr", "avgPower", "trainingLoad",
                "aerobicEffect", "anaerobicEffect", "hrZones", source, "createdAt")
               VALUES (gen_random_uuid()::text, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, 'garmin', NOW())
               ON CONFLICT ("garminActivityId") DO UPDATE SET
                 date = EXCLUDED.date,
                 "startTime" = EXCLUDED."startTime",
                 type = EXCLUDED.type,
                 name = EXCLUDED.name,
                 "durationSec" = EXCLUDED."durationSec",
                 "distanceM" = EXCLUDED."distanceM",
                 calories = EXCLUDED.calories,
                 "avgHr" = EXCLUDED."avgHr",
                 "maxHr" = EXCLUDED."maxHr",
                 "avgPower" = EXCLUDED."avgPower",
                 "trainingLoad" = EXCLUDED."trainingLoad",
                 "aerobicEffect" = EXCLUDED."aerobicEffect",
                 "anaerobicEffect" = EXCLUDED."anaerobicEffect",
                 "hrZones" = EXCLUDED."hrZones"''',
            (
                gid, date_only, start_dt, mapped, a.get("activityName"),
                duration, distance, calories, avg_hr, max_hr, avg_power,
                training_load, aerobic, anaerobic, hr_zones_json,
            ),
        )
        count += 1
    c.commit()
    return count


def fetch_day(api: Garmin, target: date) -> list[tuple[date, str, float, dict | None]]:
    """Holt alle relevanten Metriken fuer einen Tag."""
    rows: list[tuple[date, str, float, dict | None]] = []
    ds = target.isoformat()

    # Steps + Calories
    try:
        stats = api.get_stats(ds) or {}
        if stats.get("totalSteps") is not None:
            rows.append((target, "steps", float(stats["totalSteps"]), None))
        if stats.get("totalKilocalories") is not None:
            rows.append((target, "calories", float(stats["totalKilocalories"]), None))
        if stats.get("activeKilocalories") is not None:
            rows.append((target, "calories_active", float(stats["activeKilocalories"]), None))
        if stats.get("bmrKilocalories") is not None:
            rows.append((target, "calories_bmr", float(stats["bmrKilocalories"]), None))
        if stats.get("restingHeartRate") is not None:
            rows.append((target, "rhr", float(stats["restingHeartRate"]), None))
        if stats.get("averageStressLevel") is not None and stats["averageStressLevel"] > 0:
            rows.append((target, "stress_avg", float(stats["averageStressLevel"]), None))
        if stats.get("bodyBatteryHighestValue") is not None:
            rows.append((target, "body_battery_high", float(stats["bodyBatteryHighestValue"]), None))
        if stats.get("bodyBatteryLowestValue") is not None:
            rows.append((target, "body_battery_low", float(stats["bodyBatteryLowestValue"]), None))
    except Exception as e:
        print(f"[garmin] stats {ds} failed: {e}", file=sys.stderr)

    # Sleep — inkl. Sleep-Stages (Deep/REM/Light) für Sleep-Composite-Score
    try:
        sleep = api.get_sleep_data(ds) or {}
        sleep_dto = sleep.get("dailySleepDTO") or {}
        total = sleep_dto.get("sleepTimeSeconds")
        if total:
            rows.append((target, "sleep_minutes", total / 60.0, None))
        score = safe(sleep_dto, "sleepScores", "overall", "value")
        if score is not None:
            rows.append((target, "sleep_score", float(score), None))
        # NEU: Sleep-Stages für Sleep-Composite
        deep_sec = sleep_dto.get("deepSleepSeconds")
        if deep_sec:
            rows.append((target, "sleep_deep_min", deep_sec / 60.0, None))
        rem_sec = sleep_dto.get("remSleepSeconds")
        if rem_sec:
            rows.append((target, "sleep_rem_min", rem_sec / 60.0, None))
        light_sec = sleep_dto.get("lightSleepSeconds")
        if light_sec:
            rows.append((target, "sleep_light_min", light_sec / 60.0, None))
        awake_sec = sleep_dto.get("awakeSleepSeconds")
        if awake_sec is not None:
            rows.append((target, "sleep_awake_min", awake_sec / 60.0, None))
        # Sleep-Onset = Zeit zum Einschlafen
        onset = safe(sleep_dto, "sleepScores", "onset", "value")
        if onset is not None:
            rows.append((target, "sleep_onset_min", float(onset), None))
    except Exception as e:
        print(f"[garmin] sleep {ds} failed: {e}", file=sys.stderr)

    # HRV (overnight)
    try:
        hrv = api.get_hrv_data(ds) or {}
        summary = hrv.get("hrvSummary") or {}
        last_overnight = summary.get("lastNightAvg")
        if last_overnight:
            rows.append((target, "hrv_overnight", float(last_overnight), {"status": summary.get("status")}))
    except Exception as e:
        print(f"[garmin] hrv {ds} failed: {e}", file=sys.stderr)

    # Training readiness (Score 0-100)
    try:
        readiness_arr = api.get_training_readiness(ds)
        if readiness_arr and isinstance(readiness_arr, list):
            r = readiness_arr[0]
            score = r.get("score")
            if score is not None:
                rows.append((target, "training_readiness", float(score), {"level": r.get("level")}))
    except Exception as e:
        # nicht jeder Tag hat training readiness
        pass

    return rows


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--days", type=int, default=DAYS_BACK_DEFAULT,
                        help="Wie viele Tage zurueck syncen (default %(default)s, env GARMIN_DAYS_BACK).")
    parser.add_argument("--workers", type=int, default=int(os.environ.get("GARMIN_WORKERS", "6")),
                        help="Parallel-Threads fuer fetch_day (default 6).")
    parser.add_argument("--skip-vo2max", action="store_true", help="Ueberspringt VO2max-Block (nur fuer Quick-Trigger).")
    parser.add_argument("--skip-activities", action="store_true", help="Ueberspringt Activities-Block.")
    args = parser.parse_args()

    days_back = max(1, args.days)
    workers = max(1, args.workers)

    if not GARMIN_EMAIL or not GARMIN_PASSWORD:
        print("[garmin] GARMIN_EMAIL/PASSWORD fehlt", file=sys.stderr)
        sys.exit(1)

    t_start = time.monotonic()
    c = conn()
    run_id = start_run(c)
    written = 0
    try:
        # Token-Store persistiert OAuth-Tokens im Volume.
        os.makedirs(TOKEN_STORE, exist_ok=True)
        api = Garmin(email=GARMIN_EMAIL, password=GARMIN_PASSWORD)
        t_login = time.monotonic()
        try:
            api.login(TOKEN_STORE)
            print(f"[garmin] eingeloggt via Token-Cache ({TOKEN_STORE}) in {time.monotonic() - t_login:.1f}s")
        except Exception as token_err:
            print(f"[garmin] Token-Login fehlgeschlagen ({token_err}), versuche fresh login...")
            api = Garmin(email=GARMIN_EMAIL, password=GARMIN_PASSWORD)
            api.login()
            try:
                api.garth.dump(TOKEN_STORE)
                print(f"[garmin] eingeloggt + Token gespeichert nach {TOKEN_STORE}")
            except Exception as dump_err:
                print(f"[garmin] Token-Save failed: {dump_err}")

        today = date.today()
        targets = [today - timedelta(days=offset) for offset in range(days_back)]

        # PARALLEL fetch_day: ThreadPool mit `workers` Threads — ueberlappt API-Latenzen.
        t_days = time.monotonic()
        results: dict[date, list] = {}
        with ThreadPoolExecutor(max_workers=workers) as ex:
            futs = {ex.submit(fetch_day, api, t): t for t in targets}
            for fut in as_completed(futs):
                t = futs[fut]
                try:
                    rows = fut.result()
                    results[t] = rows
                except Exception as e:
                    print(f"[garmin] fetch_day({t}) failed: {e}", file=sys.stderr)
                    results[t] = []
        # Sequenziell upserten (DB-Connection ist single-thread)
        for t in targets:
            rows = results.get(t, [])
            n = upsert_metrics(c, rows)
            written += n
        print(f"[garmin] {days_back} Tage parallel ({workers} workers) in {time.monotonic() - t_days:.1f}s — {written} Metriken")

        # VO2max — nur bei Full-Sync (>= 7 Tage) oder explizit angefragt
        if not args.skip_vo2max and days_back >= 7:
            t_v = time.monotonic()
            try:
                profile = api.connectapi("/userprofile-service/userprofile/personal-information")
                if profile and isinstance(profile, dict):
                    bio = profile.get("biometricProfile") or {}
                    rows_v = []
                    vo2_run = bio.get("vo2Max")
                    vo2_cyc = bio.get("vo2MaxCycling")
                    vo2_row = bio.get("vo2MaxRowing")
                    if vo2_run is not None:
                        rows_v.append((today, "vo2max", float(vo2_run), None))
                    if vo2_cyc is not None:
                        rows_v.append((today, "vo2max_cycling", float(vo2_cyc), None))
                    if vo2_row is not None:
                        rows_v.append((today, "vo2max_rowing", float(vo2_row), None))
                    lthr = bio.get("lactateThresholdHeartRate")
                    if lthr is not None:
                        rows_v.append((today, "lthr", float(lthr), None))
                    ftp = bio.get("functionalThresholdPower")
                    if ftp is not None:
                        rows_v.append((today, "ftp", float(ftp), None))
                    if rows_v:
                        upsert_metrics(c, rows_v)
                        print(f"[garmin] VO2max/Threshold ({len(rows_v)} Werte) in {time.monotonic() - t_v:.1f}s")
                        written += len(rows_v)
            except Exception as e:
                print(f"[garmin] vo2max via biometricProfile fehlgeschlagen: {e}", file=sys.stderr)

        # Activities/Workouts: nur letzte N Tage (statt immer 30).
        if not args.skip_activities:
            t_a = time.monotonic()
            try:
                activities = api.get_activities_by_date(
                    (today - timedelta(days=days_back)).isoformat(),
                    today.isoformat(),
                ) or []
                workouts_written = upsert_workouts(c, activities)
                print(f"[garmin] {workouts_written} Workouts in {time.monotonic() - t_a:.1f}s")

                # Activity-Details (Splits, HR-Curve) NUR für die letzten N Tage holen.
                # Pro Workout 2 zusaetzliche API-Calls — beschraenken auf 7 Tage zurueck,
                # max 10 Workouts pro Run, um Garmin-Rate-Limit zu schonen.
                detail_days_back = min(days_back, 7)
                cutoff_iso = (today - timedelta(days=detail_days_back)).isoformat()
                recent_acts = [a for a in activities if (a.get("startTimeLocal") or "")[:10] >= cutoff_iso][:10]
                # Activity-Details nur wenn enabled + Tabelle existiert.
                # Per ENV deaktivierbar (GARMIN_SKIP_DETAILS=1) falls weiter Probleme.
                if os.environ.get("GARMIN_SKIP_DETAILS") == "1":
                    print("[garmin] Activity-Details skipped (GARMIN_SKIP_DETAILS=1)")
                else:
                    t_d = time.monotonic()
                    details_written = 0
                    # Pruefen ob Tabelle existiert in eigener Transaktion
                    detail_table_exists = False
                    try:
                        cur_check = c.cursor()
                        cur_check.execute("SELECT to_regclass('public.\"WorkoutDetail\"')")
                        detail_table_exists = cur_check.fetchone()[0] is not None
                        cur_check.close()
                    except Exception as e:
                        print(f"[garmin] WorkoutDetail-Tabelle-Check failed: {e}", file=sys.stderr)
                        c.rollback()

                    if detail_table_exists:
                        for a in recent_acts:
                            gid = a.get("activityId")
                            if not gid: continue
                            # Jeden Detail-Workout in eigener Transaktion isolieren
                            try:
                                cur_detail = c.cursor()
                                cur_detail.execute('SELECT id FROM "WorkoutSession" WHERE "garminActivityId" = %s', (gid,))
                                row = cur_detail.fetchone()
                                if not row:
                                    cur_detail.close()
                                    continue
                                workout_id = row[0]
                                cur_detail.execute('SELECT "fetchedAt" FROM "WorkoutDetail" WHERE "workoutId" = %s', (workout_id,))
                                existing = cur_detail.fetchone()
                                cur_detail.close()
                                if existing:
                                    from datetime import datetime as _dt
                                    age = _dt.now() - existing[0]
                                    if age.total_seconds() < 86400:
                                        continue
                                detail_data = fetch_activity_details(api, gid)
                                if detail_data:
                                    upsert_workout_detail(c, workout_id, detail_data)
                                    details_written += 1
                            except Exception as detail_err:
                                print(f"[garmin] detail {gid} skipped: {detail_err}", file=sys.stderr)
                                try: c.rollback()
                                except Exception: pass
                    print(f"[garmin] {details_written} Activity-Details in {time.monotonic() - t_d:.1f}s")
            except Exception as e:
                print(f"[garmin] activities failed: {e}", file=sys.stderr)

        finish_run(c, run_id, True, written, None)
        total = time.monotonic() - t_start
        print(f"[garmin] fertig: {written} Metriken in {total:.1f}s (mode: {days_back}d, {workers}w)")
    except Exception as e:
        tb = traceback.format_exc()
        print(f"[garmin] ERROR: {e}\n{tb}", file=sys.stderr)
        finish_run(c, run_id, False, written, f"{e}\n{tb}")
        sys.exit(2)
    finally:
        c.close()


if __name__ == "__main__":
    main()
