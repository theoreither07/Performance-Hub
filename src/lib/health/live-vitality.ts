import { recoveryHalfLife, heatCompensation, alcoholCarryOver, analyzeHrv, type HrvSeries } from "./score-science";

/**
 * Live-Vitality-Score — der "aktuelle Zustand" über den Tag.
 *
 * Idee: ähnlich Garmin Body Battery, aber präziser, weil wir Plan-Workouts,
 * Pacing und subjektive Journal-Marker zusätzlich kennen. Score 0-100 mit
 * transparenter Faktor-Aufschlüsselung.
 *
 * Tagesablauf:
 *   - 06:00 Start = Morning Recovery (HRV-z + Sleep-z + RHR-z + gestern End-Vitality)
 *   - Tagsüber: drain durch Workouts (Training Load, time-decay) + Activity (Steps, Active Min) + Stress
 *               regen durch ruhige Phasen (langsamer rebuild)
 *   - 23:00 End-of-Day Snapshot → fließt in morgige Bereitschaft (siehe score.ts)
 *
 * Pure function, kein DB-Access. Konsumiert vom /api/health/vitality Endpoint.
 */

export interface VitalityInput {
  /** Zeitpunkt der Berechnung (ISO oder Date). Steuert Time-Decay und Rebuild. */
  now: Date;
  /** Heutiges Datum YYYY-MM-DD (Vienna-TZ). */
  todayKey: string;

  /** Heute nachts gemessen — Morgen-Anker. */
  hrvOvernight: number | null;
  hrvBaseline14d: { mean: number; std: number } | null;
  sleepMinutes: number | null;
  sleepScore: number | null;
  rhrToday: number | null;
  rhrBaseline14d: { mean: number; std: number } | null;
  bodyBatteryHigh: number | null; // Garmin Body Battery Max heute (0-100)
  bodyBatteryLow: number | null;
  stressAvgToday: number | null; // 0-100
  stressBaseline14d: { mean: number; std: number } | null;
  vo2max: number | null;

  /** Subjektives Journal heute. */
  journalEnergy: number | null; // 1-5
  journalMood: number | null; // 1-5
  journalSoreness: number | null; // 1-5 (höher = wunder)

  /** Workouts heute mit Zeit + Load (für Drain-Berechnung). */
  todayWorkouts: Array<{
    startTime: Date;
    durationMin: number;
    type: string;
    trainingLoad: number | null;
    rpe: number | null;
    feeling: number | null; // 1-5
    /** Intensität aus Plan (1-10) — für Type-spez Decay-Auswahl. */
    plannedIntensity?: number | null;
  }>;

  /** Aktivität heute (kumulativ bis jetzt). */
  stepsToday: number | null;
  activeMinutesToday: number | null;

  /** Gestriger End-of-Day Vitality (falls vorhanden — als Anker für Carry-Over). */
  yesterdayEndVitality: number | null;

  /** Aktuelle Außentemperatur in Wien (°C). */
  outdoorTempC?: number | null;

  /** Alkohol-Drinks gestern + vorgestern (aus Journal). */
  yesterdayAlcoholDrinks?: number | null;
  twoDaysAgoAlcoholDrinks?: number | null;

  /** HRV-Reihe der letzten 28 Tage (für Plews-Trend statt 14d-Snapshot). */
  hrvSeries?: HrvSeries;
}

export type FactorTone = "positive" | "negative" | "neutral";

export interface VitalityFactor {
  key: string;
  label: string;
  delta: number; // beitrag zum Score (signed, gerundet)
  tone: FactorTone;
  detail: string;
}

export interface VitalityResult {
  score: number; // 0-100 final
  startScore: number; // morning recovery base
  factors: VitalityFactor[];
  headline: string;
  /** Stundenverlauf seit 06:00 bis now — für Sparkline. */
  hourly: Array<{ hour: number; score: number }>;
}

function clamp(x: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, x));
}

function zScore(value: number, baseline: { mean: number; std: number } | null): number | null {
  if (!baseline) return null;
  return (value - baseline.mean) / (baseline.std || 1);
}

function zTo100(z: number, invert = false): number {
  const adj = invert ? -z : z;
  return clamp(50 + adj * 25);
}

/**
 * Morning-Recovery 0-100 — KORRIGIERT: echter gewichteter Durchschnitt (Σ w·v / Σ w).
 * Frühere Version hatte `score * (1-w) + v * w * 2` was bei allen-50-Komponenten
 * den Score auf ~84 push'te (positive bias). Jetzt: alle 50 = 50, alle 100 = 100.
 *
 * Gewichtungs-Begründung (sportwissenschaftlich):
 *  - HRV 0.40: Plews-Konsens, stärkster autonomic-Marker
 *  - Sleep 0.30: Walker, performance-prädiktiv
 *  - RHR 0.15: HRV-Cousin
 *  - YesterdayVitality 0.15: Carry-Over (Tag war hart/leicht)
 */
function computeMorningRecovery(input: VitalityInput): { score: number; parts: VitalityFactor[] } {
  const parts: VitalityFactor[] = [];
  let weightedSum = 0;
  let totalWeight = 0;

  // HRV
  if (input.hrvOvernight !== null && input.hrvBaseline14d) {
    const z = zScore(input.hrvOvernight, input.hrvBaseline14d) ?? 0;
    const hrvScore = zTo100(z);
    const w = 0.40;
    weightedSum += hrvScore * w;
    totalWeight += w;
    parts.push({
      key: "hrv",
      label: "HRV",
      delta: Math.round(hrvScore - 50),
      tone: z > 0.3 ? "positive" : z < -0.5 ? "negative" : "neutral",
      detail: `${Math.round(input.hrvOvernight)} ms (z=${z.toFixed(1)} vs 14d)`,
    });
  }

  // Sleep — 7.5h = 100, 6h = 50, 5h = 0
  if (input.sleepMinutes !== null) {
    const sleepScore = clamp(((input.sleepMinutes - 300) / 150) * 100);
    const w = 0.30;
    weightedSum += sleepScore * w;
    totalWeight += w;
    const h = (input.sleepMinutes / 60).toFixed(1);
    parts.push({
      key: "sleep",
      label: "Schlaf",
      delta: Math.round(sleepScore - 50),
      tone: sleepScore >= 70 ? "positive" : sleepScore < 40 ? "negative" : "neutral",
      detail: `${h} h${input.sleepScore != null ? ` · Score ${input.sleepScore}` : ""}`,
    });
  }

  // RHR
  if (input.rhrToday !== null && input.rhrBaseline14d) {
    const z = zScore(input.rhrToday, input.rhrBaseline14d) ?? 0;
    const rhrScore = zTo100(z, true);
    const w = 0.15;
    weightedSum += rhrScore * w;
    totalWeight += w;
    parts.push({
      key: "rhr",
      label: "Ruhepuls",
      delta: Math.round(rhrScore - 50),
      tone: z < -0.3 ? "positive" : z > 0.5 ? "negative" : "neutral",
      detail: `${input.rhrToday} bpm`,
    });
  }

  // Carry-Over yesterday-Vitality
  if (input.yesterdayEndVitality !== null) {
    const w = 0.15;
    weightedSum += input.yesterdayEndVitality * w;
    totalWeight += w;
    parts.push({
      key: "yesterday-vitality",
      label: "Gestern Abend",
      delta: Math.round(input.yesterdayEndVitality - 50),
      tone: input.yesterdayEndVitality >= 65 ? "positive" : input.yesterdayEndVitality < 35 ? "negative" : "neutral",
      detail: `End-Vitality gestern ${input.yesterdayEndVitality}/100`,
    });
  }

  const score = totalWeight > 0 ? weightedSum / totalWeight : 50;
  return { score: Math.round(clamp(score)), parts };
}

/**
 * Realistischer TL-Fallback wenn Garmin keine Training-Load liefert (häufig bei Strength).
 *
 * Foster's sRPE = duration_min × RPE → 30-330 (zu groß für TSS-Skala).
 * Normalisiert für TrainingPeaks-TSS-Range (60min Threshold = ~100 TL):
 *   - Cardio: duration × RPE × 0.1   (60min RPE 7 → 42 TL — realistisch tempo run)
 *   - Strength: duration × RPE × 0.08 (55min RPE 6 → 26 TL — moderat strength)
 *   - Mobility: duration × RPE × 0.05 (30min RPE 3 → 5 TL)
 *   - Long Cardio: duration × RPE × 0.12 (90min RPE 5 → 54 TL)
 *
 * Default RPE = 5 (medium effort) wenn null.
 */
function estimateTrainingLoad(durationMin: number, rpe: number | null, type: string): number {
  const r = rpe ?? 5;
  const t = type.toLowerCase();
  let factor = 0.1; // default cardio
  if (t.includes("strength") || t.includes("weight")) factor = 0.08;
  else if (t === "long_cardio" || t.includes("long")) factor = 0.12;
  else if (t.includes("mobility") || t.includes("yoga") || t.includes("stretch")) factor = 0.05;
  return durationMin * r * factor;
}

/**
 * Workout-Drain: ALLE Workouts der letzten 48-72h drainen die Vitality, mit type-spez
 * Halbwertszeit (Strength 24h, Threshold 18h, Z2 6h, Mobility 2h). DOMS-Peak nach
 * Krafttraining 24-48h nach der Session, Glykogen-Refill 24-48h, Cortisol 12-36h.
 *
 * Heutiger workout: voll im Drain.
 * Gestriger Strength: ~50% Drain noch übrig (HL 24h, age 24h → 0.5).
 * Z2 von gestern: nur ~5% übrig (HL 6h, age 24h → 0.06).
 *
 * Tagesvolumen-Bonus zählt nur Workouts mit heutigem Datum.
 */
function computeWorkoutDrain(input: VitalityInput): { drain: number; parts: VitalityFactor[] } {
  const parts: VitalityFactor[] = [];
  let totalDrain = 0;
  // Nur Workouts die VOR jetzt waren (nicht "future" durch falschen TZ-Read).
  const workoutsDone = input.todayWorkouts.filter((w) => w.startTime.getTime() <= input.now.getTime());

  // Workouts mit heutigem Datum für Tagesvolumen-Bonus zählen (UTC-Date des korrigierten Timestamps)
  const todayUtc = input.todayKey;
  let todayWorkoutCount = 0;

  for (const w of workoutsDone) {
    const ageH = (input.now.getTime() - w.startTime.getTime()) / 3600_000;
    if (ageH > 60) continue;
    // Realistischer TL-Fallback wenn Garmin keine Load liefert (siehe estimateTrainingLoad)
    const load = w.trainingLoad ?? estimateTrainingLoad(w.durationMin, w.rpe, w.type);
    const halfLife = recoveryHalfLife(w.type, w.plannedIntensity ?? undefined);
    const ageDecay = Math.pow(0.5, ageH / halfLife);
    // Drain-Konversion: TL → drain pts. TL 100 ≈ 30pts initial, max 45pts pro Workout.
    const initial = Math.min(45, load * 0.30);
    const drain = initial * ageDecay;

    // Skip wenn drain unter 1pt (irrelevant für Score, aber zeigen wenn relevant)
    totalDrain += drain;

    // Workout-Datum aus korrigierter startTime
    const workoutDayKey = `${w.startTime.getFullYear()}-${String(w.startTime.getMonth() + 1).padStart(2, "0")}-${String(w.startTime.getDate()).padStart(2, "0")}`;
    if (workoutDayKey === todayUtc) todayWorkoutCount++;

    // Day-Label per Tages-Differenz (NICHT "gestern" für alles non-heute).
    const dayDiff = (() => {
      const t = new Date(todayUtc + "T12:00:00Z");
      const w0 = new Date(workoutDayKey + "T12:00:00Z");
      return Math.round((t.getTime() - w0.getTime()) / 86400_000);
    })();
    const dayLabel = dayDiff === 0 ? "" : dayDiff === 1 ? " (gestern)"
      : dayDiff === 2 ? " (vorgestern)"
      : ` (vor ${dayDiff}d)`;

    // Alle Workouts der letzten 72h ANZEIGEN (auch low-drain für Transparenz).
    // Mind. 1 pt Drain wird gerundet auf 1, sonst zeigen wir "≈0" für Sichtbarkeit.
    const shouldShow = drain >= 0.5 || workoutDayKey === todayUtc || dayDiff === 1;
    if (shouldShow) {
      const ageLabel = ageH < 1 ? `${Math.round(ageH * 60)} min her`
        : ageH < 24 ? `${ageH.toFixed(1)} h her`
        : `${(ageH / 24).toFixed(1)} d her`;
      const drainRounded = drain < 1 ? Math.round(drain * 10) / 10 : Math.round(drain);
      parts.push({
        key: `workout-${w.startTime.toISOString()}`,
        label: `Workout ${w.type}${dayLabel}`,
        delta: -drainRounded,
        tone: drain >= 1 ? "negative" : "neutral",
        detail: `${w.durationMin} min, TL ${Math.round(load)} · HL ${halfLife}h · ${ageLabel}`,
      });
    }
  }

  // Tagesvolumen-Bonus — nur heutige Workouts.
  if (todayWorkoutCount >= 2) {
    const volumeBonus = Math.min(15, (todayWorkoutCount - 1) * 6);
    totalDrain += volumeBonus;
    parts.push({
      key: "volume-bonus",
      label: "Tagesvolumen",
      delta: -volumeBonus,
      tone: "negative",
      detail: `${todayWorkoutCount} Workouts heute — kumulative Last`,
    });
  }

  return { drain: totalDrain, parts };
}

/**
 * Heat- und Alkohol-Anpassungen — addieren zu Final-Score.
 */
function computeContextualAdjust(input: VitalityInput): { delta: number; parts: VitalityFactor[] } {
  const parts: VitalityFactor[] = [];
  let delta = 0;

  // Heat-Compensation: bei Hitze HRV-Bias kompensieren = effektiv +N Vitality
  const heat = heatCompensation(input.outdoorTempC ?? null);
  if (heat.bonusPoints > 0 && heat.insight) {
    delta += heat.bonusPoints;
    parts.push({
      key: "heat-comp",
      label: "Hitze-Kompensation",
      delta: heat.bonusPoints,
      tone: "neutral",
      detail: heat.insight,
    });
  }

  // Alkohol-Carry-Over (gestern + vorgestern)
  const alc = alcoholCarryOver(input.yesterdayAlcoholDrinks ?? null, input.twoDaysAgoAlcoholDrinks ?? null);
  if (alc.penalty > 0 && alc.insight) {
    delta -= alc.penalty;
    parts.push({
      key: "alcohol",
      label: "Alkohol-Carry-Over",
      delta: -alc.penalty,
      tone: "negative",
      detail: alc.insight,
    });
  }

  return { delta, parts };
}

/**
 * Activity-Drain: Steps + Active Minutes. Klein im Vergleich zu Workouts,
 * aber kumulativ relevant.
 */
function computeActivityDrain(input: VitalityInput): { drain: number; parts: VitalityFactor[] } {
  const parts: VitalityFactor[] = [];
  let drain = 0;

  if (input.stepsToday !== null) {
    // Drain ab 8000 Schritten linear bis -10 bei 20000
    if (input.stepsToday > 8000) {
      const extraSteps = input.stepsToday - 8000;
      drain += Math.min(10, extraSteps / 1200);
    }
  }
  if (drain >= 1.5) {
    parts.push({
      key: "activity",
      label: "Alltagsaktivität",
      delta: -Math.round(drain),
      tone: "negative",
      detail: `${input.stepsToday?.toLocaleString("de-DE")} Schritte`,
    });
  }
  return { drain, parts };
}

/**
 * Stress-Adjust: Stress avg vs Baseline. Hoher Stress = drain.
 */
function computeStressAdjust(input: VitalityInput): { delta: number; parts: VitalityFactor[] } {
  const parts: VitalityFactor[] = [];
  if (input.stressAvgToday === null || !input.stressBaseline14d) return { delta: 0, parts };
  const z = zScore(input.stressAvgToday, input.stressBaseline14d) ?? 0;
  // negative z (niedriger Stress als baseline) = bonus, positive z = drain
  const delta = clamp(-z * 6, -10, 6);
  if (Math.abs(delta) >= 1.5) {
    parts.push({
      key: "stress",
      label: "Stress-Level",
      delta: Math.round(delta),
      tone: delta > 1 ? "positive" : delta < -1 ? "negative" : "neutral",
      detail: `avg ${input.stressAvgToday}/100${z > 0.5 ? " — über Baseline" : z < -0.3 ? " — unter Baseline" : ""}`,
    });
  }
  return { delta: Math.round(delta), parts };
}

/**
 * Subjektives Journal-Anpassung. WICHTIG: Journal-Skala ist 1-10 (laut Form + Schema),
 * NICHT 1-5. Neutral = 5.5. Vorher rechnete Code mit Anker 3 (für 1-5-Scale) — bug.
 */
function computeJournalAdjust(input: VitalityInput): { delta: number; parts: VitalityFactor[] } {
  const parts: VitalityFactor[] = [];
  let delta = 0;
  if (input.journalEnergy !== null) {
    // Energy 10 = +9 (clamped 8), 1 = -13.5 (clamped -12), 5 = -1.5, 6 = +0.5
    delta += (input.journalEnergy - 5.5) * 2;
  }
  if (input.journalMood !== null) {
    delta += (input.journalMood - 5.5) * 1.2;
  }
  if (input.journalSoreness !== null && input.journalSoreness >= 6) {
    // Soreness > 6/10 = signifikanter Drain (DOMS spürbar)
    delta -= (input.journalSoreness - 5.5) * 2.5;
  }
  delta = clamp(delta, -12, 8);
  if (Math.abs(delta) >= 2) {
    parts.push({
      key: "journal",
      label: "Subjektiv (Journal)",
      delta: Math.round(delta),
      tone: delta >= 2 ? "positive" : delta <= -2 ? "negative" : "neutral",
      detail: [
        input.journalEnergy != null ? `Energy ${input.journalEnergy}/10` : null,
        input.journalMood != null ? `Mood ${input.journalMood}/10` : null,
        input.journalSoreness != null && input.journalSoreness >= 6 ? `Soreness ${input.journalSoreness}/10` : null,
      ].filter(Boolean).join(" · "),
    });
  }
  return { delta: Math.round(delta), parts };
}

/**
 * Hauptfunktion: vereint alle Faktoren in einem 0-100 Score plus Faktorliste.
 */
export function computeLiveVitality(input: VitalityInput): VitalityResult {
  const morning = computeMorningRecovery(input);
  const workout = computeWorkoutDrain(input);
  const activity = computeActivityDrain(input);
  const stress = computeStressAdjust(input);
  const journal = computeJournalAdjust(input);
  const contextual = computeContextualAdjust(input);

  // Plews-HRV-Status für headline (optional, wenn series vorhanden)
  const hrvAnalysis = input.hrvSeries ? analyzeHrv(input.hrvSeries, input.todayKey) : null;

  const rawScore =
    morning.score - workout.drain - activity.drain
    + stress.delta + journal.delta + contextual.delta;
  const finalScore = Math.round(clamp(rawScore));

  // Headline-Generierung
  const headline = (() => {
    if (finalScore >= 80) return "Voll im Saft — perfekte Zeit für mehr Belastung.";
    if (finalScore >= 65) return "Solide drauf — Plan halten geht klar.";
    if (finalScore >= 45) return "Mittelfeld — auf Signale hören, nicht überziehen.";
    if (finalScore >= 25) return "Energieniveau ist niedrig — leicht halten, Pause einplanen.";
    return "Tank fast leer — Recovery priorisieren.";
  })();

  // Stundenverlauf 06:00 → now: re-compute pro hour (mit aktivem workout-drain bei der jew. Stunde)
  const hourly: Array<{ hour: number; score: number }> = [];
  const nowHour = input.now.getHours() + input.now.getMinutes() / 60;
  for (let h = 6; h <= Math.floor(nowHour); h++) {
    const t = new Date(input.now);
    t.setHours(h, 0, 0, 0);
    if (t > input.now) break;
    const subInput: VitalityInput = { ...input, now: t };
    const subWorkout = computeWorkoutDrain(subInput);
    const subActivity = computeActivityDrain(subInput);
    const subRaw = morning.score - subWorkout.drain - subActivity.drain + stress.delta + journal.delta;
    hourly.push({ hour: h, score: Math.round(clamp(subRaw)) });
  }

  // Context-Headline-Ergänzung: HRV-Status priorisiert wenn Trend negativ
  let contextualHeadline = headline;
  if (hrvAnalysis && hrvAnalysis.status === "sympathetic") {
    contextualHeadline = hrvAnalysis.insight;
  } else if (finalScore >= 65 && hrvAnalysis && hrvAnalysis.status === "balanced") {
    contextualHeadline = `${headline} HRV-Trend balanced.`;
  }

  return {
    score: finalScore,
    startScore: morning.score,
    factors: [
      ...morning.parts,
      ...workout.parts,
      ...activity.parts,
      ...stress.parts,
      ...journal.parts,
      ...contextual.parts,
    ],
    headline: contextualHeadline,
    hourly,
  };
}
