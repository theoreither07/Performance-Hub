"""
MyFitnessPal Sync Sidecar.

Holt die letzten N Tage Ernaehrungs-Tagebuch von MyFitnessPal (inoffizielle
Scraper-API via myfitnesspal — MFP hat keine oeffentliche Dritt-API mehr)
und schreibt sie als NutritionLog-Eintraege in unsere Postgres-DB.

WICHTIG — zwei Huerden, die MFP inzwischen aufgebaut hat:

1. Kein Username/Passwort-Login mehr. Die Lib braucht Session-Cookies aus
   einem eingeloggten Browser (per Extension "Get cookies.txt LOCALLY" nach
   mfp-sync/cookies.txt exportieren, siehe README-Kommentar unten).
2. Cloudflare Bot-Management blockt den Request selbst mit gueltigen Cookies,
   wenn der TLS-Fingerprint nicht wie ein echter Browser aussieht (cloudscraper
   allein reicht nicht mehr). Wir ersetzen deshalb myfitnesspal's interne
   requests/cloudscraper-Session per Monkeypatch durch eine curl_cffi-Session
   mit Chrome-Impersonation.
3. Der Legacy-Metadata-Endpoint (api.myfitnesspal.com/v2/users/{id}), den die
   Lib fuer effective_username nutzt, antwortet aktuell serverseitig mit 500
   ("Something went wrong 0xr1") — unabhaengig von Cookies/TLS. Wir umgehen
   das, indem wir MFP_USERNAME direkt aus der Umgebung als effective_username
   setzen statt ihn von MFP abzufragen.

Idempotent: nutzt UPSERT auf (date). Sequenziell (kein ThreadPool wie bei
Garmin) und mit kleiner Pause zwischen Tagen, da MFPs Scraping-Schutz
aggressiver reagiert als Garmins Connect-API.
"""
import argparse
import json
import os
import sys
import time
import traceback
from datetime import date, timedelta
from urllib.parse import urlparse, urlunparse, parse_qsl, urlencode

import psycopg2
import myfitnesspal
import myfitnesspal.client as mfp_client
import browser_cookie3
from curl_cffi import requests as cf_requests

# Cloudflare Bot-Management erkennt cloudscraper/requests am TLS-Fingerprint und
# blockt mit 403 "Blocked" — selbst mit gueltigen Session-Cookies. curl_cffi mit
# Chrome-Impersonation repliziert den echten Browser-TLS-Stack und kommt durch.
mfp_client.cloudscraper.create_scraper = lambda sess=None: cf_requests.Session(impersonate="chrome")

MFP_USERNAME = os.environ.get("MFP_USERNAME")
DAYS_BACK_DEFAULT = int(os.environ.get("MFP_DAYS_BACK", "14"))
# browser_cookie3.load() probiert auch exotische Browser (z.B. lynx) durch und wirft
# dabei Exceptions, die nicht als BrowserCookieError getyped sind -> bricht die ganze
# Auto-Erkennung ab. Wir loopen deshalb selbst, nur ueber die relevanten Browser.
COOKIE_LOADERS = [
    ("edge", browser_cookie3.edge),
    ("chrome", browser_cookie3.chrome),
    ("firefox", browser_cookie3.firefox),
]
# Manuell exportierte Cookies (Netscape-Format, z.B. via "Get cookies.txt LOCALLY"
# Browser-Extension) — Fallback/primärer Weg, seit Chrome/Edge "App-Bound Encryption"
# den direkten Cookie-DB-Zugriff via browser_cookie3 unmoeglich macht.
COOKIES_TXT_PATH = os.environ.get(
    "MFP_COOKIES_FILE", os.path.join(os.path.dirname(__file__), "cookies.txt")
)
REQUEST_DELAY_SEC = float(os.environ.get("MFP_REQUEST_DELAY_SEC", "1.5"))


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
    cur.execute('INSERT INTO "MfpSyncRun" ("startedAt") VALUES (NOW()) RETURNING id')
    run_id = cur.fetchone()[0]
    c.commit()
    return run_id


def finish_run(c, run_id: int, success: bool, written: int, error: str | None):
    try:
        c.rollback()
    except Exception:
        pass
    try:
        cur = c.cursor()
        cur.execute(
            'UPDATE "MfpSyncRun" SET "finishedAt" = NOW(), success = %s, "entriesWritten" = %s, error = %s WHERE id = %s',
            (success, written, error, run_id),
        )
        c.commit()
    except Exception as e:
        print(f"[mfp] finish_run failed: {e}", file=sys.stderr)
        try: c.rollback()
        except Exception: pass


def build_meals_json(day) -> list | None:
    """Kompakter Meal-Breakdown (Name + Kalorien pro Eintrag) fuer die Detail-Ansicht."""
    try:
        meals = []
        for meal in day.meals:
            if not meal.entries:
                continue
            entries = []
            for e in meal.entries:
                cals = (e.totals or {}).get("calories")
                entries.append({"name": e.name, "calories": cals})
            meals.append({"name": meal.name, "entries": entries})
        return meals or None
    except Exception as e:
        print(f"[mfp] meals-breakdown failed: {e}", file=sys.stderr)
        return None


def fetch_day(client: "myfitnesspal.Client", target: date) -> dict | None:
    """Holt Tages-Totals + Meal-Breakdown fuer einen Tag. None wenn Tag leer/kein Log."""
    try:
        day = client.get_date(target.year, target.month, target.day)
    except Exception as e:
        print(f"[mfp] get_date({target.isoformat()}) failed: {e}", file=sys.stderr)
        return None

    totals = day.totals or {}
    if not totals:
        return None

    water = None
    try:
        water = day.water
    except Exception:
        pass

    return {
        "date": target,
        "calories": totals.get("calories"),
        "protein": totals.get("protein"),
        "carbs": totals.get("carbohydrates"),
        "fat": totals.get("fat"),
        "sodium": totals.get("sodium"),
        "sugar": totals.get("sugar"),
        "fiber": totals.get("fiber"),
        "water": float(water) if water else None,
        "meals": build_meals_json(day),
    }


def load_mfp_cookies() -> "http.cookiejar.CookieJar":
    import http.cookiejar

    # 1) cookies.txt (Netscape-Format) — zuverlaessigster Weg, da unabhaengig von
    # Chrome/Edge's App-Bound Encryption. Export via z.B. "Get cookies.txt LOCALLY"-Extension.
    if os.path.exists(COOKIES_TXT_PATH):
        cj = http.cookiejar.MozillaCookieJar(COOKIES_TXT_PATH)
        try:
            cj.load(ignore_discard=True, ignore_expires=True)
            n = sum(1 for _ in cj)
            if n:
                print(f"[mfp] {n} Cookies aus {COOKIES_TXT_PATH} geladen")
                return cj
            print(f"[mfp] {COOKIES_TXT_PATH} ist leer, versuche Browser-DB...", file=sys.stderr)
        except Exception as e:
            print(f"[mfp] {COOKIES_TXT_PATH} konnte nicht gelesen werden ({e}), versuche Browser-DB...", file=sys.stderr)

    # 2) Direkter Zugriff auf die Browser-Cookie-DB (funktioniert nur bei aelteren
    # Chrome/Edge-Versionen ohne App-Bound Encryption).
    cj = http.cookiejar.CookieJar()
    found_any = False
    for name, loader in COOKIE_LOADERS:
        try:
            browser_cj = loader(domain_name="myfitnesspal.com")
            n = 0
            for cookie in browser_cj:
                cj.set_cookie(cookie)
                n += 1
            if n:
                print(f"[mfp] {n} Cookies aus {name} geladen")
                found_any = True
        except Exception as e:
            print(f"[mfp] Cookie-Read aus {name} uebersprungen: {e}", file=sys.stderr)
    if not found_any:
        raise RuntimeError(
            f"Keine MyFitnessPal-Cookies gefunden (weder {COOKIES_TXT_PATH} noch "
            "Edge/Chrome/Firefox-DB). Empfohlen: Browser-Extension \"Get cookies.txt "
            "LOCALLY\" installieren, auf myfitnesspal.com einloggen, Cookies fuer die "
            f"Domain exportieren und als {COOKIES_TXT_PATH} speichern."
        )
    return cj


def upsert_nutrition(c, row: dict) -> None:
    cur = c.cursor()
    cur.execute(
        '''INSERT INTO "NutritionLog"
           (id, date, calories, protein, carbs, fat, sodium, sugar, fiber, water, meals, source, "createdAt", "updatedAt")
           VALUES (gen_random_uuid()::text, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, 'myfitnesspal', NOW(), NOW())
           ON CONFLICT (date) DO UPDATE SET
             calories = EXCLUDED.calories,
             protein = EXCLUDED.protein,
             carbs = EXCLUDED.carbs,
             fat = EXCLUDED.fat,
             sodium = EXCLUDED.sodium,
             sugar = EXCLUDED.sugar,
             fiber = EXCLUDED.fiber,
             water = EXCLUDED.water,
             meals = EXCLUDED.meals,
             "updatedAt" = NOW()''',
        (
            row["date"], row["calories"], row["protein"], row["carbs"], row["fat"],
            row["sodium"], row["sugar"], row["fiber"], row["water"],
            json.dumps(row["meals"]) if row["meals"] else None,
        ),
    )
    c.commit()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--days", type=int, default=DAYS_BACK_DEFAULT,
                        help="Wie viele Tage zurueck syncen (default %(default)s, env MFP_DAYS_BACK).")
    args = parser.parse_args()

    days_back = max(1, args.days)

    if not MFP_USERNAME:
        print("[mfp] MFP_USERNAME fehlt in .env (wird als effective_username genutzt, "
              "da der MFP-Metadata-Endpoint aktuell serverseitig 500 wirft)", file=sys.stderr)
        sys.exit(1)

    t_start = time.monotonic()
    c = conn()
    run_id = start_run(c)
    written = 0
    try:
        cookiejar = load_mfp_cookies()
        # Bypass: api.myfitnesspal.com/v2/users/{id} (fuer effective_username) antwortet
        # aktuell mit 500, unabhaengig von Cookies/TLS. Wir setzen den Username direkt.
        myfitnesspal.Client._get_user_metadata = lambda self: {"username": MFP_USERNAME}
        try:
            client = myfitnesspal.Client(cookiejar=cookiejar)
        except Exception as login_err:
            print(
                "[mfp] Login mit gefundenen Cookies fehlgeschlagen — vermutlich "
                f"abgelaufene Session, bitte neu auf myfitnesspal.com einloggen. ({login_err})",
                file=sys.stderr,
            )
            raise
        print(f"[mfp] eingeloggt als {client.effective_username}")

        today = date.today()
        targets = [today - timedelta(days=offset) for offset in range(days_back)]

        for i, t in enumerate(targets):
            row = fetch_day(client, t)
            if row is not None:
                upsert_nutrition(c, row)
                written += 1
                print(f"[mfp] {t.isoformat()}: {row['calories']} kcal")
            if i < len(targets) - 1:
                time.sleep(REQUEST_DELAY_SEC)

        finish_run(c, run_id, True, written, None)
        total = time.monotonic() - t_start
        print(f"[mfp] fertig: {written} Tage in {total:.1f}s (mode: {days_back}d)")
    except Exception as e:
        tb = traceback.format_exc()
        print(f"[mfp] ERROR: {e}\n{tb}", file=sys.stderr)
        finish_run(c, run_id, False, written, f"{e}\n{tb}")
        sys.exit(2)
    finally:
        c.close()


if __name__ == "__main__":
    main()
