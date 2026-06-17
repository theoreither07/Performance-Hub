/**
 * Vienna-TZ-Utilities (post Phase-4 Migration).
 *
 * Nach der Schema-Migration zu `timestamptz` (Juni 2026):
 *   - Python-Sync schreibt mit expliziter Europe/Vienna TZ
 *   - Postgres speichert echte UTC in `timestamp with time zone`
 *   - Prisma + pg-Driver lesen das als JS Date mit korrekter UTC
 *   - Container-TZ ist Vienna → `new Date()` liefert UTC
 *   - Vergleiche `workout.startTime > now` sind jetzt PRÄZISE
 *
 * `naiveViennaToUtc` ist jetzt Identity (Backward-Compat — keine Code-Änderungen nötig).
 *
 * Display-Helper `viennaHhMm`/`viennaYmd` rendert Date in Europe/Vienna-Wall-Time
 * über getHours/getMinutes (die in Container-TZ=Vienna die lokal-Stunden geben).
 */

/**
 * Identity-Function — Datum bleibt unverändert. Nach Phase-4 Migration brauchen
 * wir keine TZ-Korrektur mehr. Behalten als Wrapper, damit Code keine Änderung braucht.
 */
export function naiveViennaToUtc(d: Date): Date {
  return d;
}

/**
 * Vienna-Wall-Time HH:mm aus einem timestamptz-Date.
 * In Vienna-Container: getHours liefert lokal-Stunden = Vienna.
 */
export function viennaHhMm(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * YYYY-MM-DD in Vienna-Wall-Time. Für `@db.Date`-Felder ist getUTCDate ok
 * (Date Spalte hat keine Zeit), für startTime-Komponenten nutzen wir lokal.
 */
export function viennaYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Konvertiert ein Container-lokales (Vienna) Date in ein UTC-noon Date — damit
 * Prisma @db.Date-Columns korrekt das Datum speichern statt durch UTC-slice einen
 * Tag zurückzufallen (klassisch bei startOfWeek/startOfDay in Vienna-TZ).
 *
 * Beispiel: input = Mo 08.06 00:00 Vienna = 07.06 22:00 UTC
 *           output = 08.06 12:00 UTC → @db.Date speichert '2026-06-08' korrekt.
 */
export function toDbDateNoon(d: Date): Date {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0));
}
