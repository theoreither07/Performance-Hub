/**
 * Haptic-Feedback fuer mobile PWA. Nutzt navigator.vibrate (Android/Chrome).
 * iOS-Safari ignoriert das — dort triggert es trotzdem keine Fehler, einfach no-op.
 */

function vibrate(pattern: number | number[]): void {
  if (typeof navigator === "undefined") return;
  if (typeof navigator.vibrate !== "function") return;
  try {
    navigator.vibrate(pattern);
  } catch {
    // some browsers throw on illegal patterns — safe to swallow
  }
}

export const haptics = {
  /** Kurzer Tap-Feedback (Button-Click, Selection). */
  tap(): void {
    vibrate(8);
  },
  /** Doppel-Tap — Aktion bestaetigt (Streak hit, Workout geloggt). */
  success(): void {
    vibrate([10, 40, 10]);
  },
  /** Warnung — destructive Action oder Fehler. */
  warn(): void {
    vibrate([30, 60, 30]);
  },
  /** Pull-to-Refresh threshold-erreicht-feedback (kurz, prominent). */
  pull(): void {
    vibrate(12);
  },
};
