/**
 * Zentraler Re-Export der deutschen Locale fuer date-fns.
 * Verhindert dass jede einzelne Komponente `{ de } from "date-fns/locale"` importiert
 * (war 19x im Code) — spart Bundle-Duplication.
 *
 * Usage:
 *   import { de } from "@/lib/i18n/date-locale";
 *   format(date, "EEE d.M.", { locale: de });
 */
export { de } from "date-fns/locale";
