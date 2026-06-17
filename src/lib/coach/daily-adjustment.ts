/**
 * Daily Workout-Adjustment — adaptiert geplante Sessions an aktuellen Tageszustand.
 *
 * Sportwissenschaftliche Quellen:
 *  - Sickness-Detection: HRV-Drop > 25% + Sleep < 5h + niedrige BB = Übertraining/Krankheit
 *    (Plews/Laursen, "HRV Monitoring in Athletes").
 *  - Post-Sickness-Ramp-Up: 3-5 Tage Z1/Z2 nach akuter Krankheit (American College of Sports
 *    Medicine, Return-to-Activity-Guidelines).
 *  - Volume- vs Intensity-Modifier: bei niedriger Bereitschaft erst Intensität raus,
 *    dann Volume (Seiler, Polarized Training).
 */

export type AdjustmentLevel = "sickness" | "critical" | "low" | "mid" | "good" | "peak";

export interface SicknessIndicators {
  hrvDropPct: number | null;           // % vs 14d-Baseline (negativ = Drop)
  sleepHoursLastNight: number | null;
  bodyBatteryMaxToday: number | null;
  rhrZ: number | null;                  // RHR z-score vs Baseline (positiv = erhöht)
}

export interface DayState {
  readinessScore: number | null;        // 0-100, oder null wenn waiting
  indicators: SicknessIndicators;
  /** Days seit letzter erkannten Krankheit (null = nicht erkannt in den letzten 7d). */
  daysSinceSickness: number | null;
}

export interface PlanSessionInput {
  type: "strength" | "cardio" | "long_cardio" | "mobility" | "rest";
  title: string;
  intensityStrength?: number | null;    // 1-10
  intensityCardio?: number | null;      // 1-10
  exercises?: Array<{ name: string; sets: number; reps: string; intensity?: string; notes?: string }>;
  cardio?: { subType?: string; distanceKm?: number; durationMin?: number; zone?: string; hrTarget?: number } | null;
  reasoning?: string;
}

export interface AdjustedSession extends PlanSessionInput {
  /** True wenn Adjustment angewendet wurde. */
  wasAdjusted: boolean;
  /** Originale Session als Backup. */
  original?: PlanSessionInput;
  /** Begründung für die Anpassung. */
  adjustmentReason?: string;
}

export interface DailyAdjustmentResult {
  level: AdjustmentLevel;
  isSickness: boolean;
  isRecoveryRamp: boolean;
  sessions: AdjustedSession[];
  globalReason: string;
  recommendations: string[];
}

// ============================================================
// Sickness-Detection (Multi-Marker)
// ============================================================

export function detectSickness(ind: SicknessIndicators): { isSick: boolean; markers: string[] } {
  const markers: string[] = [];
  if (ind.hrvDropPct !== null && ind.hrvDropPct < -20) {
    markers.push(`HRV ${ind.hrvDropPct.toFixed(0)}% unter Baseline`);
  }
  if (ind.sleepHoursLastNight !== null && ind.sleepHoursLastNight < 5) {
    markers.push(`nur ${ind.sleepHoursLastNight.toFixed(1)}h Schlaf`);
  }
  if (ind.bodyBatteryMaxToday !== null && ind.bodyBatteryMaxToday < 30) {
    markers.push(`Body Battery max ${ind.bodyBatteryMaxToday} (erschöpft)`);
  }
  if (ind.rhrZ !== null && ind.rhrZ > 1.5) {
    markers.push(`Ruhepuls deutlich erhöht (z=${ind.rhrZ.toFixed(1)})`);
  }
  // Sickness ab 2 von 4 Indikatoren ODER HRV-Drop > 30% alleine
  const isSick = markers.length >= 2 || (ind.hrvDropPct !== null && ind.hrvDropPct < -30);
  return { isSick, markers };
}

// ============================================================
// Level-Klassifikation
// ============================================================

function classifyLevel(state: DayState): { level: AdjustmentLevel; isSickness: boolean; isRecoveryRamp: boolean } {
  const sickCheck = detectSickness(state.indicators);
  if (sickCheck.isSick) return { level: "sickness", isSickness: true, isRecoveryRamp: false };

  // Recovery-Ramp: in den letzten 1-4 Tagen war Krankheit
  const isRecoveryRamp = state.daysSinceSickness !== null && state.daysSinceSickness <= 4;
  if (isRecoveryRamp && state.daysSinceSickness !== null) {
    // Tag 1-2 nach Krankheit: critical, Tag 3: low, Tag 4: mid
    const lvl: AdjustmentLevel = state.daysSinceSickness <= 1 ? "critical"
      : state.daysSinceSickness === 2 ? "low"
      : state.daysSinceSickness === 3 ? "low"
      : "mid";
    return { level: lvl, isSickness: false, isRecoveryRamp: true };
  }

  const s = state.readinessScore;
  if (s === null) return { level: "mid", isSickness: false, isRecoveryRamp: false };
  if (s < 35) return { level: "critical", isSickness: false, isRecoveryRamp: false };
  if (s < 50) return { level: "low", isSickness: false, isRecoveryRamp: false };
  if (s < 65) return { level: "mid", isSickness: false, isRecoveryRamp: false };
  if (s < 80) return { level: "good", isSickness: false, isRecoveryRamp: false };
  return { level: "peak", isSickness: false, isRecoveryRamp: false };
}

// ============================================================
// Session-Adjustment per Level
// ============================================================

function buildRestSession(reason: string): AdjustedSession {
  return {
    type: "rest",
    title: "Rest / Recovery",
    cardio: null,
    reasoning: "Heute Rest — Erholung priorisieren.",
    wasAdjusted: true,
    adjustmentReason: reason,
  };
}

function buildRecoveryWalk(reason: string): AdjustedSession {
  return {
    type: "mobility",
    title: "Recovery-Walk (Z1)",
    cardio: { subType: "walk", distanceKm: 3, durationMin: 30, zone: "Z1", hrTarget: 110 },
    reasoning: "30 min Z1-Walk — Bewegung ohne Belastung, Lymphfluss + Vagus-Tonus.",
    wasAdjusted: true,
    adjustmentReason: reason,
  };
}

function reduceCardio(s: PlanSessionInput, volumePct: number, capZone?: string, capHr?: number): AdjustedSession {
  const c = s.cardio ?? {};
  const newDist = c.distanceKm ? +(c.distanceKm * volumePct).toFixed(1) : undefined;
  const newDur = c.durationMin ? Math.round(c.durationMin * volumePct) : undefined;
  return {
    ...s,
    title: `${s.title} (angepasst −${Math.round((1 - volumePct) * 100)}%)`,
    cardio: {
      ...c,
      distanceKm: newDist,
      durationMin: newDur,
      zone: capZone ?? c.zone,
      hrTarget: capHr ?? c.hrTarget,
    },
    wasAdjusted: true,
    original: s,
  };
}

function reduceStrength(s: PlanSessionInput, repsPct: number, maxIntensity: number): AdjustedSession {
  const newExercises = s.exercises?.map((ex) => {
    // Reps können wie "10-12" oder "8" sein — nimm den unteren Bound + reduce
    const repsLow = parseInt(ex.reps.split(/[-x×]/)[0] ?? "10", 10) || 10;
    const targetReps = Math.max(5, Math.round(repsLow * repsPct));
    return {
      ...ex,
      sets: Math.max(2, Math.round(ex.sets * 0.8)),
      reps: `${targetReps}`,
      intensity: `RPE ${maxIntensity} (cap)`,
    };
  });
  return {
    ...s,
    title: `${s.title} (Light)`,
    exercises: newExercises,
    intensityStrength: Math.min(s.intensityStrength ?? 5, maxIntensity),
    wasAdjusted: true,
    original: s,
  };
}

// ============================================================
// Haupt-Adjustment-Funktion
// ============================================================

export function adjustTodaySessions(
  sessions: PlanSessionInput[],
  state: DayState,
): DailyAdjustmentResult {
  const { level, isSickness, isRecoveryRamp } = classifyLevel(state);
  const sickCheck = detectSickness(state.indicators);
  const recommendations: string[] = [];

  let globalReason = "";

  // ─── SICKNESS: alles auf Rest oder Walk ───
  if (level === "sickness") {
    globalReason = `Sickness-Detection aktiv: ${sickCheck.markers.join(", ")}. Heute kein Training — Recovery priorisieren.`;
    recommendations.push("Viel Wasser, 30+ min mehr Schlaf heute Nacht.");
    recommendations.push("Bei Fieber: 3 Tage Pause + Arzt-Check.");
    recommendations.push("Wenn morgen besser: leichter Walk vor Plan-Return.");
    const adjusted = sessions.map((s) =>
      s.type === "mobility" ? { ...s, wasAdjusted: false } : buildRestSession(globalReason),
    );
    // Wenn keine sessions, biete einen Recovery-Walk
    if (sessions.length === 0) adjusted.push(buildRecoveryWalk(globalReason));
    return { level, isSickness, isRecoveryRamp, sessions: adjusted, globalReason, recommendations };
  }

  // ─── CRITICAL (Score < 35 oder Tag 1-2 nach Sickness) ───
  if (level === "critical") {
    globalReason = isRecoveryRamp
      ? `Tag ${state.daysSinceSickness} nach Krankheit — nur sehr leicht, kein Tempo, kein Volumen.`
      : `Bereitschaft kritisch (${state.readinessScore}) — Volumen halbieren, alles Z1/Z2.`;
    recommendations.push("Wenn sich Session schwer anfühlt: Abbrechen ist die richtige Wahl.");
    const adjusted = sessions.map((s) => {
      if (s.type === "rest" || s.type === "mobility") return { ...s, wasAdjusted: false };
      if (s.type === "strength") return buildRecoveryWalk(globalReason); // Strength → Walk
      // Cardio: −50% Volume, Z1
      return reduceCardio(s, 0.5, "Z1", 130);
    });
    return { level, isSickness, isRecoveryRamp, sessions: adjusted, globalReason, recommendations };
  }

  // ─── LOW (Score 35-50 oder Tag 2-3 nach Sickness) ───
  if (level === "low") {
    globalReason = isRecoveryRamp
      ? `Tag ${state.daysSinceSickness} nach Krankheit — Z2 ok, kein Tempo, Volumen −30%.`
      : `Bereitschaft niedrig (${state.readinessScore}) — Volumen −30%, max Z2.`;
    recommendations.push("Bei Wohlgefühl OK weiterzumachen — bei Schwere stoppen.");
    const adjusted = sessions.map((s) => {
      if (s.type === "rest" || s.type === "mobility") return { ...s, wasAdjusted: false };
      if (s.type === "strength") return reduceStrength(s, 0.85, 6);
      // Cardio: −30% Volume, cap Z2
      return reduceCardio(s, 0.7, "Z2", 145);
    });
    return { level, isSickness, isRecoveryRamp, sessions: adjusted, globalReason, recommendations };
  }

  // ─── MID (Score 50-65) ───
  if (level === "mid") {
    globalReason = isRecoveryRamp
      ? `Tag ${state.daysSinceSickness} nach Krankheit — Plan halten, Intensität cap RPE 7.`
      : `Bereitschaft moderat (${state.readinessScore}) — Plan halten, Intensität cap RPE 7.`;
    const adjusted = sessions.map((s) => {
      if (s.type === "rest" || s.type === "mobility") return { ...s, wasAdjusted: false };
      if (s.type === "strength") {
        const planInt = s.intensityStrength ?? 5;
        if (planInt > 7) return reduceStrength(s, 1.0, 7);
        return { ...s, wasAdjusted: false };
      }
      // Cardio: nur Intensitäts-Cap wenn Plan-Zone > Z3
      const z = s.cardio?.zone?.toLowerCase() ?? "";
      if (z.includes("z4") || z.includes("z5") || z.includes("threshold") || z.includes("vo2")) {
        return reduceCardio(s, 1.0, "Z3", 165);
      }
      return { ...s, wasAdjusted: false };
    });
    return { level, isSickness, isRecoveryRamp, sessions: adjusted, globalReason, recommendations };
  }

  // ─── GOOD (65-80) ───
  if (level === "good") {
    globalReason = `Bereitschaft gut (${state.readinessScore}) — Plan 1:1 durchziehen.`;
    return {
      level, isSickness, isRecoveryRamp,
      sessions: sessions.map((s) => ({ ...s, wasAdjusted: false })),
      globalReason, recommendations,
    };
  }

  // ─── PEAK (80+) ───
  globalReason = `Bereitschaft top (${state.readinessScore}) — Plan 1:1, ggf. Push-Set/Sprint ok.`;
  recommendations.push("Heute ist gutes Window für PR/Push wenn geplant.");
  return {
    level, isSickness, isRecoveryRamp,
    sessions: sessions.map((s) => ({ ...s, wasAdjusted: false })),
    globalReason, recommendations,
  };
}
