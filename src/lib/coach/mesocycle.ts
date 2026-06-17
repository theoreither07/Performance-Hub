/**
 * Mesozyklus-System (4-Wochen-Block-Periodisierung).
 *
 * Sport-wissenschaftlich nach Issurin (Block-Periodisierung) + Bompa (Akkumulation→
 * Realisation→Recovery):
 *  - Woche 1: Build (Volume hoch, Intensität moderat)
 *  - Woche 2: Build (+10% Volume oder +10% Intensität)
 *  - Woche 3: Peak (+5-10% — höchste Belastung im Mesozyklus)
 *  - Woche 4: Deload (Volume −30 bis −40%, Intensität bleibt)
 *
 * Der Mesozyklus wiederholt sich, baut über Monate hin zum Race-Peak auf.
 * In Build/Peak-Phasen der Saison (siehe periodization.ts): jeder Mesozyklus steigert
 * die Baseline-Last gegenüber dem vorherigen ("progressive overload").
 */

import { differenceInDays, startOfWeek, addWeeks, format } from "date-fns";

export type MesoWeekType = "build" | "peak" | "deload";

export interface MesocycleState {
  /** Welche Woche im aktuellen 4-Wochen-Block (1-4). */
  weekInCycle: number;
  /** Welcher Block überhaupt (zählt vom Start). */
  cycleIndex: number;
  /** Typ dieser Woche. */
  type: MesoWeekType;
  /** Volume-Modifier vs Baseline (z.B. 1.0 = normal, 0.65 = deload). */
  volumeModifier: number;
  /** Intensitäts-Modifier (0.8-1.1). */
  intensityModifier: number;
  /** Headline für UI. */
  headline: string;
  /** Coach-Insight für Prompt. */
  coachInsight: string;
}

/**
 * Berechnet die Mesozyklus-Position für eine gegebene Woche.
 *
 * `anchorDate` = optional Startpunkt der Periodisierung (z.B. erstes Tracking-Datum
 * oder Race-Datum rückwärts). Default = Mo der KW1 vor 12 Wochen.
 */
export function computeMesocycle(now: Date, anchorDate?: Date): MesocycleState {
  const anchor = anchorDate ?? addWeeks(now, -12);
  const thisMonday = startOfWeek(now, { weekStartsOn: 1 });
  const anchorMonday = startOfWeek(anchor, { weekStartsOn: 1 });
  const weeksSinceAnchor = Math.floor(differenceInDays(thisMonday, anchorMonday) / 7);

  // Schutz gegen negative Werte
  const absWeek = Math.max(0, weeksSinceAnchor);

  const weekInCycle = (absWeek % 4) + 1; // 1, 2, 3, 4
  const cycleIndex = Math.floor(absWeek / 4) + 1;

  let type: MesoWeekType;
  let volumeModifier: number;
  let intensityModifier: number;
  let headline: string;
  let coachInsight: string;

  if (weekInCycle === 1) {
    type = "build";
    volumeModifier = 0.95;
    intensityModifier = 0.95;
    headline = `Woche ${weekInCycle}/4 — Build-Start (Mesozyklus ${cycleIndex})`;
    coachInsight = "Build-Start: Wiedereinstieg nach Deload. Volumen knapp unter Baseline, Intensität moderat. Pacing über die Woche.";
  } else if (weekInCycle === 2) {
    type = "build";
    volumeModifier = 1.05;
    intensityModifier = 1.0;
    headline = `Woche ${weekInCycle}/4 — Build-Steigerung`;
    coachInsight = "Build-Woche 2: Volume +10% gegenüber Woche 1. Klassischer Coggan-Progress. Eine harte Cardio-Einheit + 2 Strength.";
  } else if (weekInCycle === 3) {
    type = "peak";
    volumeModifier = 1.10;
    intensityModifier = 1.1;
    headline = `Woche ${weekInCycle}/4 — Peak (höchste Last im Block)`;
    coachInsight = "Peak-Woche: höchste Last des Blocks. Threshold + Long Run + 3 Strength. Recovery zwischen Hard-Days strikt 48h.";
  } else {
    type = "deload";
    volumeModifier = 0.65;
    intensityModifier = 0.85;
    headline = `Woche ${weekInCycle}/4 — Deload (Volumen runter)`;
    coachInsight = "Deload: −35% Volumen, Intensität bleibt teilweise drin (1 kurze Hard-Einheit). Nutzt Super-Kompensation für nächsten Block.";
  }

  return {
    weekInCycle,
    cycleIndex,
    type,
    volumeModifier,
    intensityModifier,
    headline,
    coachInsight,
  };
}

/**
 * Berechnet den Volumen-Modifier mit Plateau-Cut-back:
 *  - Build-Weeks: +10% bis Plateau
 *  - Plateau erkannt = 3 Wochen ohne Performance-Steigerung
 *  - Bei Plateau: Cut-back week (-30%) → dann nochmal Build mit höherer Last
 *
 * Vereinfachter heuristischer Ansatz (kein echtes Performance-Tracking nötig).
 */
export function volumeProgression(currentWeekTotal: number, lastFourWeekAvg: number): {
  recommended: number;
  reason: string;
} {
  if (lastFourWeekAvg === 0) {
    return { recommended: currentWeekTotal, reason: "Keine Historie — beibehalten." };
  }
  const ratio = currentWeekTotal / lastFourWeekAvg;
  if (ratio > 1.3) {
    // Akute Überlast — Cut-back
    return {
      recommended: lastFourWeekAvg * 0.7,
      reason: `Akute Last ${(ratio * 100).toFixed(0)}% der 4w-Avg → Cut-back auf 70%.`,
    };
  }
  if (ratio < 0.6) {
    // Untertrainiert oder Verletzungsphase — sanft hochfahren
    return {
      recommended: lastFourWeekAvg * 0.85,
      reason: `Aktuell nur ${(ratio * 100).toFixed(0)}% der Baseline → sanfter Wiedereinstieg.`,
    };
  }
  // Normaler Build: +10% on top
  return {
    recommended: currentWeekTotal * 1.1,
    reason: `+10% Volume-Build (Coggan-Progress, ${ratio.toFixed(2)} ACWR).`,
  };
}
