/**
 * Workout-Templates: Polarized vs Pyramidal Cardio + Hypertrophy/Strength/Power Strength.
 *
 * Polarized (Seiler 2010, Stöggl 2014):
 *   - 80% Z1-Z2 + 20% Z4-Z5, NIE im Z3 "Sweetspot" verharren.
 *   - Gold-Standard für Ausdauer-Eliten.
 *
 * Pyramidal:
 *   - 70% Z1-Z2, 20% Z3, 10% Z4-Z5.
 *   - Klassiker, für Nicht-Eliten oft besser als Polarized (weniger Verletzungs-Risiko).
 *
 * Strength-Periodisierung (Linear Bompa):
 *   - Hypertrophy: 8-12 reps @ 70-75% 1RM, 3-4 sets, Pause 60-90s
 *   - Strength: 4-6 reps @ 80-87% 1RM, 4-5 sets, Pause 2-3min
 *   - Power: 3-5 reps @ 75-85% 1RM + explosive, 3-5 sets, Pause 3-5min
 */

import type { Phase } from "./periodization";

export interface CardioTemplate {
  type: "z2" | "threshold" | "intervals" | "long" | "tempo" | "recovery";
  name: string;
  description: string;
  /** HR-Zone-Bereich. */
  hrZoneTarget: string;
  /** Typische Dauer in min. */
  durationMin: { min: number; max: number };
  /** Wofür dieser Block in Periodisierung sinnvoll? */
  phases: Phase[];
}

export const CARDIO_TEMPLATES: CardioTemplate[] = [
  {
    type: "z2",
    name: "Z2 Aerobic Base",
    description: "Lockerer Lauf in Z2, Nasen-Atmung möglich, Sprechen mit kurzen Sätzen.",
    hrZoneTarget: "Z2 (60-70% MaxHR)",
    durationMin: { min: 40, max: 75 },
    phases: ["base", "build", "peak", "sharpen"],
  },
  {
    type: "threshold",
    name: "Threshold Tempo",
    description: "30-40min im Z3 (88-92% MaxHR). Comfortably hard. Kein Sprechen mehr.",
    hrZoneTarget: "Z3-Z4 (84-92% MaxHR)",
    durationMin: { min: 45, max: 75 },
    phases: ["build", "peak"],
  },
  {
    type: "intervals",
    name: "VO2max Intervalle",
    description: "4-6× 4min @ 95% MaxHR, 3min easy zwischen. Klassisch Billat-Style.",
    hrZoneTarget: "Z4-Z5 (93-100% MaxHR)",
    durationMin: { min: 50, max: 70 },
    phases: ["build", "peak"],
  },
  {
    type: "long",
    name: "Long Run",
    description: "Langer Z2-Lauf, letzte 5km optional Pickup auf Z3. Aerobic-Fundament.",
    hrZoneTarget: "Z2 + letzte 5km Z3",
    durationMin: { min: 90, max: 150 },
    phases: ["base", "build", "peak"],
  },
  {
    type: "tempo",
    name: "Tempo Continuous",
    description: "60-70min im Z3-low (85-88% MaxHR). Race-Pace-Simulation.",
    hrZoneTarget: "Z3 (85-88% MaxHR)",
    durationMin: { min: 50, max: 80 },
    phases: ["peak", "sharpen"],
  },
  {
    type: "recovery",
    name: "Active Recovery",
    description: "30-40min Z1, sehr locker. Nasen-Atmung durchgehend. Bewegung statt Sitzen.",
    hrZoneTarget: "Z1 (50-60% MaxHR)",
    durationMin: { min: 30, max: 45 },
    phases: ["base", "build", "peak", "sharpen", "taper", "race-week", "post-race"],
  },
];

export type DistributionType = "polarized" | "pyramidal" | "threshold" | "race-prep";

export interface WeeklyDistribution {
  type: DistributionType;
  zoneSplit: { z1z2: number; z3: number; z4z5: number };
  description: string;
  recommended: string[]; // template-types
}

export const WEEKLY_DISTRIBUTIONS: Record<DistributionType, WeeklyDistribution> = {
  polarized: {
    type: "polarized",
    zoneSplit: { z1z2: 80, z3: 0, z4z5: 20 },
    description: "80% Z1-Z2 + 20% Z4-Z5. NIE Z3. Seiler-Standard für Elite-Ausdauer.",
    recommended: ["z2", "z2", "long", "intervals"],
  },
  pyramidal: {
    type: "pyramidal",
    zoneSplit: { z1z2: 70, z3: 20, z4z5: 10 },
    description: "70/20/10 Mix. Für Nicht-Eliten oft besser balanciert.",
    recommended: ["z2", "long", "threshold", "intervals"],
  },
  threshold: {
    type: "threshold",
    zoneSplit: { z1z2: 60, z3: 30, z4z5: 10 },
    description: "Threshold-fokus. Build-Phase HM-Vorbereitung.",
    recommended: ["z2", "threshold", "tempo", "long"],
  },
  "race-prep": {
    type: "race-prep",
    zoneSplit: { z1z2: 65, z3: 25, z4z5: 10 },
    description: "Race-Pace-Simulation + Tapering. 2-3 Wochen vor Race.",
    recommended: ["z2", "tempo", "tempo", "long"],
  },
};

/**
 * Wählt die optimale Distribution basierend auf Phase + Race-Type.
 */
export function pickDistribution(phase: Phase, raceType: string | null): DistributionType {
  if (phase === "taper" || phase === "race-week") return "race-prep";
  if (phase === "sharpen") return "race-prep";
  if (phase === "peak") return "threshold";
  if (phase === "build") {
    if (raceType === "half_marathon" || raceType === "marathon") return "pyramidal";
    return "polarized";
  }
  // Base + post-race + out-of-range
  return "polarized";
}

// ============================================================
// Strength-Periodisierung
// ============================================================

export type StrengthBlock = "hypertrophy" | "strength" | "power" | "endurance";

export interface StrengthTemplate {
  block: StrengthBlock;
  name: string;
  reps: string; // "8-12"
  sets: { min: number; max: number };
  intensity: string; // "70-75% 1RM"
  restSec: { min: number; max: number };
  rpe: string; // "RPE 7-8" or "RIR 2-3"
  focus: string;
  /** Wofür gut in Periodisierung. */
  phases: Phase[];
}

export const STRENGTH_TEMPLATES: Record<StrengthBlock, StrengthTemplate> = {
  hypertrophy: {
    block: "hypertrophy",
    name: "Hypertrophy Block",
    reps: "8-12",
    sets: { min: 3, max: 4 },
    intensity: "70-75% 1RM",
    restSec: { min: 60, max: 90 },
    rpe: "RPE 7-8 / RIR 2-3",
    focus: "Muskelvolumen, metabolischer Stress, Mechanical Tension.",
    phases: ["base", "build"],
  },
  strength: {
    block: "strength",
    name: "Max Strength Block",
    reps: "4-6",
    sets: { min: 4, max: 5 },
    intensity: "80-87% 1RM",
    restSec: { min: 120, max: 180 },
    rpe: "RPE 8-9 / RIR 1-2",
    focus: "Maximalkraft, neurale Adaptation, Bewegungsökonomie.",
    phases: ["build", "peak"],
  },
  power: {
    block: "power",
    name: "Power Block",
    reps: "3-5",
    sets: { min: 3, max: 5 },
    intensity: "75-85% 1RM + explosive Konzentrik",
    restSec: { min: 180, max: 300 },
    rpe: "RPE 7-8, max Speed",
    focus: "Rate-of-Force-Development, Sportliche Power.",
    phases: ["peak", "sharpen"],
  },
  endurance: {
    block: "endurance",
    name: "Strength-Endurance Block",
    reps: "12-20",
    sets: { min: 3, max: 4 },
    intensity: "55-65% 1RM",
    restSec: { min: 30, max: 60 },
    rpe: "RPE 7-8",
    focus: "Lokale Muskelausdauer, ideal für HM-/M-Vorbereitung (Lauf-Spezifik).",
    phases: ["base", "build"],
  },
};

/**
 * Wählt den optimalen Strength-Block basierend auf Phase + Goal.
 * Lauf-Athletes (HM/Marathon): bevorzugt Endurance + Strength, nicht Hypertrophy/Power.
 */
export function pickStrengthBlock(phase: Phase, raceType: string | null, mesoWeek: number): StrengthBlock {
  const isRunFocus = raceType === "half_marathon" || raceType === "marathon" || raceType === "5km_tt" || raceType === "10km_tt";

  // In Deload-Wochen immer Endurance (lockere Last)
  if (mesoWeek === 4) return "endurance";

  if (phase === "taper" || phase === "race-week") return "endurance";
  if (phase === "peak") return isRunFocus ? "strength" : "power";
  if (phase === "sharpen") return isRunFocus ? "endurance" : "power";
  if (phase === "build") return isRunFocus ? "strength" : "hypertrophy";
  return isRunFocus ? "endurance" : "hypertrophy";
}
