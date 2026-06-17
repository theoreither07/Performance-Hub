/**
 * Periodisierung fuer langfristige Ziele.
 *
 * Halbmarathon-Standard-Periodisierung (12 Wochen vor Race):
 *   - Base   : 12-9 Wochen vor Race (Z2-Volume, Aerobic, Krafterhalt)
 *   - Build  : 8-5 Wochen vor Race (Threshold + Tempo + Long Runs)
 *   - Peak   : 4-3 Wochen vor Race (VO2max + Race-Pace-Intervalle)
 *   - Sharpen: 2 Wochen vor Race (kurze Race-Pace, Volume runter)
 *   - Taper  : 1 Woche vor Race (50% Volume, 1 Tune-Up)
 *
 * Weight-Drop / VO2max / 5km-TT: weniger formell — Trend-Tracking + Build/Maintain Modus.
 */

import { differenceInDays, differenceInWeeks } from "date-fns";

export type Phase = "base" | "build" | "peak" | "sharpen" | "taper" | "race-week" | "post-race" | "out-of-range";

export interface PeriodizationState {
  phase: Phase;
  weeksUntilTarget: number;
  daysUntilTarget: number;
  shortLabel: string; // "Build (3w left in block)"
  longLabel: string; // "Build Block — 4-8w vor HM, Fokus Threshold + Long Run"
  focusKeywords: string[]; // ["Threshold", "Long Run", "Tempo"]
  intensityHints: { strength: number; cardio: number }; // recommended weekly average (0-10)
}

/**
 * Plant eine Halbmarathon-Periodisierung rueckwaerts vom Race-Datum.
 */
export function planHalfMarathon(today: Date, raceDate: Date): PeriodizationState {
  const days = differenceInDays(raceDate, today);
  const weeks = Math.round(days / 7);

  if (days < 0) {
    return {
      phase: "post-race",
      weeksUntilTarget: weeks,
      daysUntilTarget: days,
      shortLabel: "Post-Race",
      longLabel: "Nach dem Race: Recovery 7-10 Tage, dann lockere Base.",
      focusKeywords: ["Recovery", "Z1", "Mobility"],
      intensityHints: { strength: 3, cardio: 3 },
    };
  }
  if (days === 0) {
    return {
      phase: "race-week",
      weeksUntilTarget: 0,
      daysUntilTarget: 0,
      shortLabel: "RACE DAY",
      longLabel: "Heute ist Race Day. Carbs, Hydration, Pacing-Plan.",
      focusKeywords: ["Race-Pace", "Mental"],
      intensityHints: { strength: 0, cardio: 10 },
    };
  }
  if (days <= 7) {
    return {
      phase: "taper",
      weeksUntilTarget: 1,
      daysUntilTarget: days,
      shortLabel: `Taper (${days}T)`,
      longLabel: "Taper-Woche: Volumen -50%, 1 Tune-Up-Lauf (3-4km mit 2-3km Race-Pace), Carb-Loading 3 Tage vor Race.",
      focusKeywords: ["Race-Pace kurz", "Carbs", "Schlaf"],
      intensityHints: { strength: 2, cardio: 5 },
    };
  }
  if (weeks <= 2) {
    return {
      phase: "sharpen",
      weeksUntilTarget: weeks,
      daysUntilTarget: days,
      shortLabel: `Sharpen (${weeks}w)`,
      longLabel: "Sharpen: Volume -20%, harte Sessions kurz halten, Race-Pace 5-8km Intervalle.",
      focusKeywords: ["Race-Pace", "Threshold kurz"],
      intensityHints: { strength: 4, cardio: 7 },
    };
  }
  if (weeks <= 4) {
    return {
      phase: "peak",
      weeksUntilTarget: weeks,
      daysUntilTarget: days,
      shortLabel: `Peak (${weeks}w)`,
      longLabel: "Peak: VO2max-Intervalle (4×4 Norwegian, 6×3min Z5) + 1 Race-Pace-LongRun pro Woche.",
      focusKeywords: ["VO2max", "4×4", "Race-Pace LongRun"],
      intensityHints: { strength: 5, cardio: 8 },
    };
  }
  if (weeks <= 8) {
    return {
      phase: "build",
      weeksUntilTarget: weeks,
      daysUntilTarget: days,
      shortLabel: `Build (${weeks}w)`,
      longLabel: "Build: Threshold-Lauf (20-30min Z4) + Tempo (8-12km Z3) + LongRun (18-22km) + 2 Z2-Easy + 2 Kraft.",
      focusKeywords: ["Threshold", "Tempo", "Long Run"],
      intensityHints: { strength: 6, cardio: 7 },
    };
  }
  if (weeks <= 12) {
    return {
      phase: "base",
      weeksUntilTarget: weeks,
      daysUntilTarget: days,
      shortLabel: `Base (${weeks}w)`,
      longLabel: "Base: 80% Z2-Volume, 1 Stride-Session, LongRun 16-20km, 2-3 Kraft fuer Krafterhalt.",
      focusKeywords: ["Z2 Volume", "Strides", "Krafterhalt"],
      intensityHints: { strength: 6, cardio: 5 },
    };
  }
  // > 12 Wochen — General-Prep
  return {
    phase: "out-of-range",
    weeksUntilTarget: weeks,
    daysUntilTarget: days,
    shortLabel: `General Prep (${weeks}w)`,
    longLabel: "Mehr als 12w bis Race — General Prep: Aerobic-Base aufbauen, Kraft-Fundament, kein spezifisches Race-Training noetig.",
    focusKeywords: ["Z2", "Krafterhalt", "Aerobic"],
    intensityHints: { strength: 6, cardio: 5 },
  };
}

export interface GoalLike {
  type: string;
  name: string;
  targetValue: number | null;
  targetUnit: string | null;
  targetDate: Date | string;
  startValue: number | null;
  startDate?: Date | string;
}

/**
 * Erkennt den "Lead-Goal" — das wichtigste aktive Ziel das die Periodisierung treibt.
 * Prio: race > 5km_tt > vo2max > weight.
 */
export function pickLeadGoal(goals: GoalLike[]): GoalLike | null {
  if (goals.length === 0) return null;
  const prio: Record<string, number> = { race: 0, "5km_tt": 1, "10km_tt": 2, vo2max: 3, weight: 4 };
  return [...goals].sort((a, b) => (prio[a.type] ?? 99) - (prio[b.type] ?? 99))[0];
}

/**
 * Berechnet Periodisierungs-State fuer das Lead-Goal.
 * Fuer race-type: Halbmarathon-Plan. Sonst null (= kein Race-Periodisierungs-Block).
 */
export function computePeriodization(today: Date, leadGoal: GoalLike | null): PeriodizationState | null {
  if (!leadGoal) return null;
  if (leadGoal.type === "race" || leadGoal.type === "5km_tt" || leadGoal.type === "10km_tt") {
    const target = typeof leadGoal.targetDate === "string" ? new Date(leadGoal.targetDate) : leadGoal.targetDate;
    return planHalfMarathon(today, target);
  }
  return null;
}

export interface GoalProgress {
  goal: GoalLike;
  currentValue: number | null;
  startValue: number | null;
  targetValue: number | null;
  delta: number | null; // current - start
  deltaToTarget: number | null; // current - target
  weeksElapsed: number;
  weeksTotal: number;
  pctElapsed: number; // 0-100
}

export function computeGoalProgress(today: Date, goal: GoalLike, currentValue: number | null): GoalProgress {
  const startD = goal.startDate
    ? typeof goal.startDate === "string"
      ? new Date(goal.startDate)
      : goal.startDate
    : today;
  const targetD = typeof goal.targetDate === "string" ? new Date(goal.targetDate) : goal.targetDate;
  const weeksTotal = Math.max(1, differenceInWeeks(targetD, startD));
  const weeksElapsed = Math.max(0, differenceInWeeks(today, startD));
  const pctElapsed = Math.min(100, Math.round((weeksElapsed / weeksTotal) * 100));
  const delta = currentValue !== null && goal.startValue !== null ? currentValue - goal.startValue : null;
  const deltaToTarget = currentValue !== null && goal.targetValue !== null ? currentValue - goal.targetValue : null;
  return {
    goal,
    currentValue,
    startValue: goal.startValue,
    targetValue: goal.targetValue,
    delta,
    deltaToTarget,
    weeksElapsed,
    weeksTotal,
    pctElapsed,
  };
}
