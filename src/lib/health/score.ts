/**
 * Trainer-Scoring: berechnet Day-Score, Recovery-Status und Trainings-Empfehlung
 * aus Garmin-Metriken + subjektivem Journal.
 *
 * Day-Score (0-100) gewichtet:
 *   30% Sleep (score wenn vorhanden, sonst minutes vs 7h)
 *   25% HRV-Abweichung von 14d Baseline (z-score)
 *   20% RHR-Abweichung von 14d Baseline (negativ = besser)
 *   15% Body Battery High (oder Training Readiness wenn vorhanden)
 *   10% Subjektive Energie + Mood (falls Journal vorhanden)
 *
 * Recovery: ableitung aus HRV/RHR/Sleep combined.
 * Suggestion: Regelbasiert, basierend auf Recovery + Acute:Chronic Workload Ratio (ACWR).
 */

export interface MetricSeries {
  // sortiert nach Datum asc
  values: { date: string; value: number }[];
}

export type MetricMap = Record<string, MetricSeries>;

export interface PlannedTrainingSlim {
  type: string;
  name: string;
  distanceKm?: number;
}

export interface WeeklyProgressSlim {
  strengthDone: number;
  strengthTarget: number;
  runsDone: number;
  runsTarget: number;
  hasLongRun: boolean;
}

import { analyzeHrv, analyzeTsb, type HrvSeries, type LoadPoint, type HrvAnalysis, type TsbAnalysis, heatCompensation, alcoholCarryOver, analyzeSleep, type SleepInput } from "./score-science";

export interface DayContext {
  date: string; // YYYY-MM-DD
  metrics: MetricMap;
  journal?: {
    mood?: number | null;
    energy?: number | null;
    motivation?: number | null;
    soreness?: number | null;
    sleepQuality?: number | null;
    workoutFelt?: number | null;
    ateWell?: boolean | null;
    alcoholDrinks?: number | null;
  } | null;
  // Fallback wenn heute noch kein Journal vorliegt — juengster Eintrag der letzten 2 Tage
  previousJournal?: {
    mood?: number | null;
    energy?: number | null;
    motivation?: number | null;
    soreness?: number | null;
    sleepQuality?: number | null;
    workoutFelt?: number | null;
    ateWell?: boolean | null;
    alcoholDrinks?: number | null;
  } | null;
  workoutLoadLast7: number; // sum of trainingLoad
  workoutLoadLast28: number;
  workoutsToday?: number; // Anzahl Trainings heute
  workoutMinutesToday?: number;
  plannedToday?: PlannedTrainingSlim[];
  plannedTomorrow?: PlannedTrainingSlim[];
  restDays?: number[]; // 1=Mo, 7=So
  weeklyProgress?: WeeklyProgressSlim;
  goals?: string | null;
  /** End-Vitality vom Vortag (0-100, eingefroren) — Carry-Over in heutige Bereitschaft. */
  yesterdayEndVitality?: number | null;
  /** Außentemperatur Wien für Heat-Compensation. */
  outdoorTempC?: number | null;
  /** Sleep-Stages (wenn Garmin liefert). */
  sleepDeepMin?: number | null;
  sleepRemMin?: number | null;
  /** Tages-Loads für TSB (alle letzten 56 Tage idealerweise). */
  loadHistory?: LoadPoint[];
}

export interface DayScore {
  total: number; // 0-100
  components: {
    subjective: number | null;
    hrv: number | null;
    sleep: number | null;
    rhr: number | null;
    load: number | null;
    bodyBattery: number | null;
    yesterdayVitality?: number | null;
    /** TSB-Komponente (CTL/ATL/TSB). */
    tsb?: number | null;
  };
  /** HRV-Plews-Analyse für UI-Headlines. */
  hrvAnalysis?: HrvAnalysis | null;
  /** TSB-Analyse für UI-Insight. */
  tsbAnalysis?: TsbAnalysis | null;
  /** Kontextuelle Faktoren die Score nach oben/unten verschoben haben. */
  contextFactors?: Array<{ label: string; delta: number; insight: string }>;
  recovery: "green" | "yellow" | "red" | "unknown";
  acwr: number | null; // Acute:Chronic Workload Ratio
  suggestion: TrainingSuggestion;
  tomorrow: TomorrowOutlook;
  // true wenn die wichtigsten Garmin-Daten (Sleep + HRV) fuer diesen Tag noch fehlen.
  // UI sollte dann "Warte auf Garmin-Sync" zeigen statt eines bedeutungslosen Scores.
  waitingForGarmin: boolean;
}

export interface TrainingSuggestion {
  level: "recover" | "easy" | "moderate" | "hard";
  headline: string;
  reason: string[];
}

export interface TomorrowOutlook {
  level: "recover" | "easy" | "moderate" | "hard";
  headline: string;
  focus: string; // konkreter Trainingsvorschlag
  reminders: string[]; // Was heute Abend / vor dem Schlafengehen zu beachten
}

function latestFor(metrics: MetricMap, kind: string, onOrBefore: string): number | null {
  const s = metrics[kind];
  if (!s || s.values.length === 0) return null;
  // letzter Wert <= onOrBefore
  for (let i = s.values.length - 1; i >= 0; i--) {
    if (s.values[i].date <= onOrBefore) return s.values[i].value;
  }
  return null;
}

/**
 * Strikter Today-Check: nur HEUTE's Wert zurueck, kein Fallback auf gestern.
 * Verwendet fuer das waitingForGarmin-Gate — Bereitschaft darf morgens NICHT
 * mit gestrigen Sleep/HRV-Daten berechnet werden (User-Anforderung).
 */
function exactlyOn(metrics: MetricMap, kind: string, date: string): number | null {
  const s = metrics[kind];
  if (!s || s.values.length === 0) return null;
  for (const v of s.values) if (v.date === date) return v.value;
  return null;
}

function baselineFor(
  metrics: MetricMap,
  kind: string,
  before: string,
  days = 14,
): { mean: number; std: number } | null {
  const s = metrics[kind];
  if (!s || s.values.length === 0) return null;
  const vals = s.values
    .filter((v) => v.date < before)
    .slice(-days)
    .map((v) => v.value);
  if (vals.length < 3) return null;
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
  return { mean, std: Math.sqrt(variance) || 1 };
}

// Linear remap z-score -> 0..100 (gut bei z=+1.5, schlecht bei z=-1.5)
function zTo100(z: number, invert = false): number {
  const adj = invert ? -z : z;
  return Math.max(0, Math.min(100, 50 + adj * 33));
}

export function computeDayScore(ctx: DayContext): DayScore {
  const components: DayScore["components"] = {
    subjective: null,
    hrv: null,
    sleep: null,
    rhr: null,
    load: null,
    bodyBattery: null,
    yesterdayVitality: ctx.yesterdayEndVitality ?? null,
  };

  // GARMIN-SYNC-GATE (strikt): Bereitschaft darf nur berechnet werden wenn HEUTE's HRV+Sleep
  // bereits in der DB sind. Sonst zeigt UI "Warte auf Garmin-Sync" — keine Fallback-Werte
  // von gestern, weil das den Score-Wert irrefuehrend macht (User-Anforderung 2026-06-02).
  // Frueher Exit: alle Komponenten null, Score 0, waitingForGarmin = true.
  const todayHrv = exactlyOn(ctx.metrics, "hrv_overnight", ctx.date);
  const todaySleepMin = exactlyOn(ctx.metrics, "sleep_minutes", ctx.date);
  const todaySleepScore = exactlyOn(ctx.metrics, "sleep_score", ctx.date);
  const todayHasGarmin = todayHrv !== null && (todaySleepMin !== null || todaySleepScore !== null);
  if (!todayHasGarmin) {
    return {
      total: 0,
      components,
      recovery: "unknown",
      acwr: null,
      suggestion: { level: "easy", headline: "Warte auf Garmin-Sync", reason: ["HRV/Sleep fuer heute noch nicht da — Bereitschaft erscheint nach dem naechsten Watch-Sync."] },
      tomorrow: { level: "easy", headline: "Setup folgt", focus: "Sobald Garmin-Daten da sind, erscheint hier der Plan.", reminders: [] },
      waitingForGarmin: true,
    };
  }

  // Sleep — neuer COMPOSITE: Dauer + Deep+REM-Anteil + Sleep-Debt aus 7d
  const sleepMin = latestFor(ctx.metrics, "sleep_minutes", ctx.date);
  const sleepScore = latestFor(ctx.metrics, "sleep_score", ctx.date);
  const sleepRecent7d: number[] = [];
  for (let i = 0; i < 7; i++) {
    const dayKey = new Date(ctx.date + "T12:00:00Z");
    dayKey.setUTCDate(dayKey.getUTCDate() - i);
    const dKey = `${dayKey.getUTCFullYear()}-${String(dayKey.getUTCMonth() + 1).padStart(2, "0")}-${String(dayKey.getUTCDate()).padStart(2, "0")}`;
    const v = exactlyOn(ctx.metrics, "sleep_minutes", dKey);
    if (v !== null) sleepRecent7d.push(v);
  }
  if (sleepMin !== null) {
    const sleepInput: SleepInput = {
      totalMin: sleepMin,
      deepMin: ctx.sleepDeepMin ?? null,
      remMin: ctx.sleepRemMin ?? null,
      sleepScore,
      recent7d: sleepRecent7d.length > 0 ? sleepRecent7d : undefined,
    };
    const sleepAna = analyzeSleep(sleepInput);
    components.sleep = sleepAna.score;
  } else if (sleepScore !== null) {
    components.sleep = sleepScore;
  }

  // HRV — Plews-Methode: 7d-Rolling-Mean RMSSD + CV statt Single-Day-Snapshot
  const hrvSeriesValues: { date: string; value: number }[] = [];
  const hrvKind = ctx.metrics["hrv_overnight"];
  if (hrvKind) {
    for (const v of hrvKind.values) {
      if (v.date <= ctx.date) hrvSeriesValues.push({ date: v.date, value: v.value });
    }
  }
  const hrvAnalysis = hrvSeriesValues.length >= 4
    ? analyzeHrv({ values: hrvSeriesValues }, ctx.date)
    : null;

  if (hrvAnalysis && hrvAnalysis.trendZ !== null) {
    // Plews Status → Score-Komponente:
    //   balanced 75, coping 55, sympathetic 30, parasympathetic 65 (cautious)
    if (hrvAnalysis.status === "balanced") components.hrv = zTo100(hrvAnalysis.trendZ);
    else if (hrvAnalysis.status === "coping") components.hrv = Math.max(40, zTo100(hrvAnalysis.trendZ) - 10);
    else if (hrvAnalysis.status === "sympathetic") components.hrv = Math.max(15, zTo100(hrvAnalysis.trendZ) - 25);
    else if (hrvAnalysis.status === "parasympathetic") components.hrv = Math.min(80, zTo100(hrvAnalysis.trendZ) - 5);
    else components.hrv = zTo100(hrvAnalysis.trendZ);
  } else {
    // Fallback auf Single-Day-Z (alte Logik)
    const hrv = latestFor(ctx.metrics, "hrv_overnight", ctx.date);
    const hrvBase = baselineFor(ctx.metrics, "hrv_overnight", ctx.date);
    if (hrv !== null && hrvBase) {
      const z = (hrv - hrvBase.mean) / hrvBase.std;
      components.hrv = zTo100(z);
    }
  }

  // RHR vs Baseline (niedriger = besser)
  const rhr = latestFor(ctx.metrics, "rhr", ctx.date);
  const rhrBase = baselineFor(ctx.metrics, "rhr", ctx.date);
  if (rhr !== null && rhrBase) {
    const z = (rhr - rhrBase.mean) / rhrBase.std;
    components.rhr = zTo100(z, true);
  }

  // Body Battery / Training Readiness — NICHT mehr in der Gewichtung (Garmin-Black-Box).
  // Wert wird trotzdem gespeichert als Sekundaer-Info fuer "Mehr"-Bereich.
  const trainReady = latestFor(ctx.metrics, "training_readiness", ctx.date);
  const bbLow = latestFor(ctx.metrics, "body_battery_low", ctx.date);
  components.bodyBattery = trainReady ?? bbLow;

  // Subjektiv: Mittel aus energy + mood + (10-soreness) + sleepQuality, jeweils 0-10 -> 0-100.
  // Fallback: wenn heute KEIN Journal-Eintrag MIT INHALT existiert, nimm den juengsten der letzten 2 Tage.
  // Fix: leeres Journal-Objekt (alle null) wird wie kein Eintrag behandelt — sonst überschreibt es
  // previousJournal und subjective bleibt null trotz Vortags-Daten.
  const hasValues = (j: typeof ctx.journal): boolean => {
    if (!j) return false;
    return j.energy != null || j.mood != null || j.soreness != null
      || j.sleepQuality != null || j.workoutFelt != null
      || j.ateWell !== null || j.alcoholDrinks != null;
  };
  const journalSource = hasValues(ctx.journal) ? ctx.journal : (ctx.previousJournal ?? null);
  if (journalSource) {
    const j = journalSource;
    const parts: number[] = [];
    if (j.energy != null) parts.push(j.energy * 10);
    if (j.mood != null) parts.push(j.mood * 10);
    if (j.sleepQuality != null) parts.push(j.sleepQuality * 10);
    if (j.soreness != null) parts.push((10 - j.soreness) * 10);
    if (parts.length > 0) {
      components.subjective = parts.reduce((a, b) => a + b, 0) / parts.length;
    }
  }

  // Load-Komponente — NEU: TSB-Modell (Coggan), ersetzt simples ACWR.
  // CTL/ATL/TSB ist State-of-the-Art bei Profi-Coaches.
  // Fallback auf ACWR wenn keine load history übergeben.
  let tsbAnalysis: TsbAnalysis | null = null;
  // TSB nur wenn ECHTE Loads vorhanden (sonst Bias bei Neuanmeldung — alles 0 → TSB=0 → 70pts gratis).
  const hasRealLoad = (ctx.loadHistory ?? []).some((p) => p.load > 0);
  if (ctx.loadHistory && ctx.loadHistory.length > 0 && hasRealLoad) {
    tsbAnalysis = analyzeTsb(ctx.loadHistory, ctx.date);
    components.load = Math.round(tsbAnalysis.scoreComponent);
    components.tsb = Math.round(tsbAnalysis.tsb);
  } else {
    // Fallback: ACWR
    const acwr = ctx.workoutLoadLast28 > 0
      ? ctx.workoutLoadLast7 / (ctx.workoutLoadLast28 / 4)
      : null;
    if (acwr !== null) {
      if (acwr >= 0.8 && acwr <= 1.3) components.load = 100;
      else if (acwr >= 0.6 && acwr <= 1.5) {
        const dist = acwr < 0.8 ? 0.8 - acwr : acwr - 1.3;
        components.load = Math.round(100 - (dist / 0.2) * 35);
      } else if (acwr >= 0.4 && acwr <= 1.8) components.load = 40;
      else components.load = Math.max(0, acwr < 0.4 ? Math.round(acwr * 100) : 10);
    } else if (ctx.workoutLoadLast7 === 0 && ctx.workoutLoadLast28 === 0) {
      components.load = 50;
    }
  }

  // ACWR weiterhin gespeichert (für Backward-Compat im Output).
  const acwr = ctx.workoutLoadLast28 > 0
    ? ctx.workoutLoadLast7 / (ctx.workoutLoadLast28 / 4)
    : null;

  // Context-Faktoren (Heat + Alkohol) — adjustieren Final-Score nach unten/oben
  const contextFactors: NonNullable<DayScore["contextFactors"]> = [];
  let contextDelta = 0;

  // Heat-Compensation NUR wenn HRV-Komponente aktiv ist (Heat verschiebt HRV).
  // Wenn HRV null/missing, gibt es nichts zu kompensieren.
  const heat = heatCompensation(ctx.outdoorTempC ?? null);
  if (heat.bonusPoints > 0 && heat.insight && components.hrv !== null) {
    contextDelta += heat.bonusPoints;
    contextFactors.push({ label: "Hitze-Kompensation", delta: heat.bonusPoints, insight: heat.insight });
  }

  // Alkohol-Carry-Over: gestern + vorgestern aus Journal-Series
  const yesterdayKey = (() => {
    const d = new Date(ctx.date + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() - 1);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  })();
  void yesterdayKey; // tracked by previousJournal — wir nehmen direkten Wert wenn vorhanden
  const yAlc = ctx.previousJournal?.alcoholDrinks ?? null;
  const alc = alcoholCarryOver(yAlc, null);
  if (alc.penalty > 0 && alc.insight) {
    contextDelta -= alc.penalty;
    contextFactors.push({ label: "Alkohol-Carry-Over", delta: -alc.penalty, insight: alc.insight });
  }

  // Gewichteter Score (sport-wissenschaftlich nach Plews/Saw/Foster):
  // Subjektiv 30 (Saw et al.: staerkster Performance-Predictor)
  // HRV       25 (Plews/Laursen: ANS-Status)
  // Schlaf    25 (Walker: bedingt direkt Performance)
  // RHR       10 (HRV-Cousin, kleiner Effekt)
  // Load      10 (Foster ACWR: Belastungs-Status)
  // Vitality  15 (Gestern Abend End-Vitality — Carry-Over, integriert "Tag war leicht/hart")
  // Fehlende Komponenten werden weg-gewichtet (Restliche teilen den Pool).
  const weights = { subjective: 30, hrv: 25, sleep: 25, rhr: 10, load: 10, yesterdayVitality: 15 };
  let weightedSum = 0;
  let totalWeight = 0;
  for (const k of Object.keys(weights) as (keyof typeof weights)[]) {
    const v = components[k];
    if (v !== null && v !== undefined) {
      weightedSum += v * weights[k];
      totalWeight += weights[k];
    }
  }
  const rawTotal = totalWeight > 0 ? weightedSum / totalWeight : 0;
  // Context-Adjusts (Heat-Plus, Alkohol-Minus) ON TOP des weighted Composites.
  const total = Math.max(0, Math.min(100, Math.round(rawTotal + contextDelta)));

  // Recovery-Ampel: aus HRV + Sleep + Subjektiv (die drei "Recovery-Pillars")
  const recoveryParts = [components.hrv, components.sleep, components.subjective].filter(
    (x): x is number => x !== null,
  );
  let recovery: DayScore["recovery"] = "unknown";
  if (recoveryParts.length > 0) {
    const avg = recoveryParts.reduce((a, b) => a + b, 0) / recoveryParts.length;
    recovery = avg >= 65 ? "green" : avg >= 45 ? "yellow" : "red";
  }

  const suggestion = buildSuggestion(
    total,
    recovery,
    acwr,
    ctx.journal,
    ctx.workoutsToday ?? 0,
    ctx.workoutMinutesToday ?? 0,
    ctx.plannedToday ?? [],
    ctx.weeklyProgress ?? null,
  );
  const tomorrow = buildTomorrow(
    ctx.date,
    total,
    recovery,
    acwr,
    ctx.journal,
    ctx.workoutsToday ?? 0,
    ctx.workoutMinutesToday ?? 0,
    ctx.plannedTomorrow ?? [],
    ctx.weeklyProgress ?? null,
    ctx.restDays ?? [],
  );

  // Garmin-Sync-Gate: Wenn sowohl Sleep als auch HRV fuer heute fehlen, ist der Score nicht
  // aussagekraeftig (die zwei zentralen Recovery-Signale fehlen). UI zeigt dann "Warte auf Garmin".
  const waitingForGarmin = components.sleep === null && components.hrv === null;

  // Erweitere reason mit kontextualisierten Insights (HRV-Plews + TSB)
  if (hrvAnalysis && hrvAnalysis.insight && !suggestion.reason.includes(hrvAnalysis.insight)) {
    suggestion.reason.push(hrvAnalysis.insight);
  }
  if (tsbAnalysis && tsbAnalysis.insight && (tsbAnalysis.zone === "overload" || tsbAnalysis.zone === "fresh" || tsbAnalysis.zone === "race-ready")) {
    suggestion.reason.push(tsbAnalysis.insight);
  }
  for (const cf of contextFactors) {
    suggestion.reason.push(cf.insight);
  }

  return {
    total, components, recovery, acwr, suggestion, tomorrow, waitingForGarmin,
    hrvAnalysis, tsbAnalysis,
    contextFactors: contextFactors.length > 0 ? contextFactors : undefined,
  };
}

function plannedLabel(p: PlannedTrainingSlim[]): string {
  return p
    .map((x) => (x.distanceKm ? `${x.name} (${x.distanceKm}km)` : x.name))
    .join(" + ");
}

function buildSuggestion(
  total: number,
  recovery: DayScore["recovery"],
  acwr: number | null,
  journal: DayContext["journal"],
  workoutsToday: number,
  minutesToday: number,
  plannedToday: PlannedTrainingSlim[],
  weekly: WeeklyProgressSlim | null,
): TrainingSuggestion {
  const reason: string[] = [];
  const hasPlan = plannedToday.length > 0;
  const planLabel = hasPlan ? plannedLabel(plannedToday) : "";

  // Falls heute schon trainiert: nicht nochmal hartes Training empfehlen
  if (workoutsToday >= 2 || minutesToday >= 90) {
    return {
      level: "recover",
      headline: `${workoutsToday} Trainings heute — jetzt regenerieren`,
      reason: [
        `${minutesToday}min Belastung heute`,
        "Mobility, Dehnung, Schlaf priorisieren. Kein weiteres Training.",
      ],
    };
  }
  if (workoutsToday >= 1) {
    reason.push(`Heute schon ${workoutsToday} Training (${minutesToday}min)`);
    if (hasPlan) {
      // Bereits trainiert UND noch was geplant -> hinweisen
      reason.push(`Laut Plan noch offen: ${planLabel}`);
    }
    if (recovery === "red") {
      return {
        level: "recover",
        headline: "Genug fuer heute",
        reason: [...reason, "Recovery rot — kein zweites Training."],
      };
    }
    return {
      level: "easy",
      headline: hasPlan ? `Optional ${planLabel}` : "Optional Easy / Mobility",
      reason: [...reason, "Wenn noch was geht: Z1 Spaziergang oder Stretching."],
    };
  }

  if (hasPlan) {
    reason.push(`Plan: ${planLabel}`);
  }
  if (weekly && weekly.strengthTarget > 0) {
    const open = weekly.strengthTarget - weekly.strengthDone;
    if (open > 0) reason.push(`Kraft Woche: ${weekly.strengthDone}/${weekly.strengthTarget}`);
  }
  if (weekly && weekly.runsTarget > 0) {
    const open = weekly.runsTarget - weekly.runsDone;
    if (open > 0) reason.push(`Laeufe Woche: ${weekly.runsDone}/${weekly.runsTarget}`);
  }

  if (recovery === "red") {
    reason.push("Recovery rot — HRV/RHR/Schlaf unter Baseline");
    return {
      level: "recover",
      headline: "Heute Recovery oder Pause",
      reason: [
        ...reason,
        "Spaziergang, Mobility, Atemuebungen. Kein hartes Training.",
      ],
    };
  }
  if (acwr !== null && acwr > 1.5) {
    reason.push(`ACWR ${acwr.toFixed(2)} — akute Last weit ueber chronischem Schnitt`);
    return {
      level: "easy",
      headline: "Leicht trainieren",
      reason: [
        ...reason,
        "Easy Run / Z2 Cardio max 45min, kein hartes Intervall.",
      ],
    };
  }
  if (journal?.soreness && journal.soreness >= 7) {
    reason.push(`Muskelkater ${journal.soreness}/10`);
    return {
      level: "easy",
      headline: "Leichte Mobility oder Z2",
      reason,
    };
  }

  if (recovery === "green" && (acwr === null || acwr < 1.3) && total >= 70) {
    if (acwr !== null && acwr < 0.8) {
      reason.push(`ACWR ${acwr.toFixed(2)} — du bist unterfordert`);
    } else {
      reason.push("Recovery gruen, Score hoch — gute Bedingungen");
    }
    return {
      level: "hard",
      headline: hasPlan ? `${planLabel} — voll durchziehen` : "Heute kannst du voll trainieren",
      reason: [
        ...reason,
        hasPlan ? "Intensitaet hoch fahren, kein Sandbagging." : "Intervalle, Krafttraining mit Last, oder langer Tempo-Lauf.",
      ],
    };
  }

  reason.push(recovery === "yellow" ? "Recovery gelb" : "Recovery ok");
  if (acwr !== null) reason.push(`ACWR ${acwr.toFixed(2)}`);
  return {
    level: "moderate",
    headline: hasPlan ? `${planLabel} (moderat halten)` : "Moderates Training",
    reason: [...reason, hasPlan ? "Plan durchziehen, aber Intensitaet nicht ueberreizen." : "Z2/Z3 Cardio, leichtes Krafttraining oder Sport-Skill."],
  };
}

function buildTomorrow(
  date: string,
  todayScore: number,
  todayRecovery: DayScore["recovery"],
  acwr: number | null,
  journal: DayContext["journal"],
  workoutsToday: number,
  minutesToday: number,
  plannedTomorrow: PlannedTrainingSlim[],
  weekly: WeeklyProgressSlim | null,
  restDays: number[],
): TomorrowOutlook {
  const reminders: string[] = [];

  // Lifestyle-Erinnerungen aus heutigen Daten ableiten
  if (workoutsToday >= 1) {
    reminders.push("Protein + Carbs in den nächsten 90min nach Training");
  }
  if (minutesToday >= 60) {
    reminders.push("Mindestens 0.5L Wasser + Elektrolyte vor dem Schlaf");
  }
  if (journal?.alcoholDrinks && journal.alcoholDrinks >= 1) {
    reminders.push("Kein Alkohol heute Abend — verkürzt REM-Schlaf");
  }
  if (journal?.sleepQuality !== null && journal?.sleepQuality !== undefined && journal.sleepQuality <= 5) {
    reminders.push("Heute früher ins Bett (vor 22:30), keine Screens 30min davor");
  }
  if (journal?.soreness && journal.soreness >= 7) {
    reminders.push("10min Foam Rolling + Mobility vor dem Schlaf");
  }
  if (todayRecovery === "red") {
    reminders.push("8h+ Schlaf priorisieren, kein Stress-Doomscrolling am Abend");
  }
  if (reminders.length === 0) {
    reminders.push("Schlaf-Zeit halten + 2L Wasser über den Tag verteilt");
  }

  // Wochentag von morgen (1=Mo .. 7=So)
  const d = new Date(date + "T00:00:00");
  d.setDate(d.getDate() + 1);
  const dow = ((d.getDay() + 6) % 7) + 1;
  const isWeekend = dow === 6 || dow === 7;
  const isRestDay = restDays.includes(dow);

  // Restday im Plan: wenn der User Sonntag (oder andere Tage) als Pause markiert hat,
  // und kein Plan-Training ueberlagert -> bewusst Pausetag empfehlen.
  if (isRestDay && plannedTomorrow.length === 0) {
    const dayName = ["", "Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"][dow];
    return {
      level: "recover",
      headline: `Morgen ${dayName}: Restday`,
      focus: "Bewusst Pause. Optional: Mobility, Spaziergang, Recovery-Aktivitaeten.",
      reminders,
    };
  }

  const planLabel = plannedTomorrow.length > 0 ? plannedLabel(plannedTomorrow) : "";
  const planFocus = (suffix: string) =>
    planLabel ? `${planLabel} — ${suffix}` : suffix;

  // Wochenfortschritts-Lueckenanalyse: falls Plan vorhanden und Tomorrow leer im Kalender,
  // proaktiv eine fehlende Einheit vorschlagen.
  let backfill = "";
  if (weekly && !planLabel) {
    const openStrength = weekly.strengthTarget - weekly.strengthDone;
    const openRuns = weekly.runsTarget - weekly.runsDone;
    if (openStrength > 0 && openRuns > 0) {
      backfill = `Plan offen: ${openStrength}x Kraft + ${openRuns}x Lauf`;
    } else if (openStrength > 0) {
      backfill = `Plan offen: ${openStrength}x Kraft`;
    } else if (openRuns > 0) {
      backfill = `Plan offen: ${openRuns}x Lauf`;
    }
  }
  if (backfill) reminders.unshift(backfill);

  // Journal-getriebene Signale: Soreness/Energy/Motivation/Mood beeinflussen den Vorschlag direkt.
  const soreness = journal?.soreness ?? null;
  const energy = journal?.energy ?? null;
  const motivation = journal?.motivation ?? null;
  const mood = journal?.mood ?? null;
  const workoutFelt = journal?.workoutFelt ?? null;

  // Subjektiver Bereitschafts-Score aus Journal: hoch = bereit, niedrig = ueberlastet
  const subjReadyParts: number[] = [];
  if (energy !== null) subjReadyParts.push(energy);
  if (motivation !== null) subjReadyParts.push(motivation);
  if (mood !== null) subjReadyParts.push(mood);
  const subjReady = subjReadyParts.length > 0
    ? subjReadyParts.reduce((s, v) => s + v, 0) / subjReadyParts.length
    : null;

  const journalReasons: string[] = [];
  if (soreness !== null && soreness >= 7) journalReasons.push(`Kater ${soreness}/10`);
  if (energy !== null && energy <= 3) journalReasons.push(`Energy ${energy}/10`);
  if (workoutFelt !== null && workoutFelt <= 3) journalReasons.push(`Workout-Gefuehl ${workoutFelt}/10`);
  if (mood !== null && mood <= 3) journalReasons.push(`Stimmung ${mood}/10`);

  // Trainings-Level fuer morgen ableiten — gewichtete Logik nach Prioritaet:
  // 1) Heute massiv ueberlastet (2x oder >=120min) → Recovery zwingend
  // 2) Journal signalisiert Ueberlastung (Kater>=7 ODER Energy<=3 ODER WorkoutFelt<=3) → easy/recover
  // 3) Recovery rot → vorsichtig
  // 4) ACWR > 1.5 → easy/deload
  // 5) Heute schon trainiert + Recovery nicht gruen → easy
  // 6) Recovery gruen + Plan heute erfuellt + ACWR ok + subjReady gut → HART
  // 7) Sonst moderate
  if (workoutsToday >= 2 || minutesToday >= 120) {
    return {
      level: "recover",
      headline: planLabel ? `Morgen: ${planLabel} (vorsichtig)` : "Morgen: Recovery-Tag",
      focus: planLabel
        ? `${planLabel}, aber bewusst leicht — heute war hart`
        : isWeekend
          ? "Lockerer Spaziergang 30-45min, Mobility, gemütlich"
          : "Bewusst Pause oder leichte Mobility — kein Training",
      reminders,
    };
  }

  // Journal-Ueberlastungs-Signal: Soreness sehr hoch → eher Pause
  if (soreness !== null && soreness >= 8) {
    return {
      level: "recover",
      headline: "Morgen: Pause oder Mobility",
      focus: `Muskelkater ${soreness}/10 — Foam Rolling, Stretching, max Spaziergang.`,
      reminders,
    };
  }
  // Mehrere Schwaeche-Signale gleichzeitig → easy
  if (journalReasons.length >= 2 || (soreness !== null && soreness >= 7)) {
    return {
      level: "easy",
      headline: planLabel ? `Morgen: ${planLabel} (easy)` : "Morgen: Leicht",
      focus: planFocus(`${journalReasons.join(" + ")} → max Z2, kein hartes Intervall`),
      reminders,
    };
  }
  // Einzelnes schwaches Signal + nicht-gruen Recovery
  if (journalReasons.length === 1 && todayRecovery !== "green") {
    return {
      level: "easy",
      headline: planLabel ? `Morgen: ${planLabel} (easy)` : "Morgen: Leicht",
      focus: planFocus(`${journalReasons[0]} — bewusst niedrige Intensitaet`),
      reminders,
    };
  }

  if (minutesToday >= 60 && todayRecovery !== "green") {
    return {
      level: "easy",
      headline: planLabel ? `Morgen: ${planLabel} (easy)` : "Morgen: Leicht",
      focus: planFocus("Z2 Cardio 30-45min (Puls unter 75% Max) oder Mobility/Yoga"),
      reminders,
    };
  }
  if (todayRecovery === "red") {
    return {
      level: "recover",
      headline: "Morgen: weiterhin erholen",
      focus: planLabel
        ? `${planLabel} wenn HRV sich erholt — sonst Spaziergang/Stretching`
        : "Spaziergang, Stretching, kein hartes Training bis HRV/RHR wieder normal",
      reminders,
    };
  }
  if (acwr !== null && acwr > 1.5) {
    return {
      level: "easy",
      headline: "Morgen: Deload",
      focus: planFocus("Easy Z2 max 45min — ACWR zu hoch für Intensität"),
      reminders,
    };
  }

  // HART-Bedingungen — relaxed: Recovery >= yellow + (Plan heute erfuellt ODER keine Plan-Pflicht)
  // + ACWR ok + subjReady >=6 (oder fehlt). "Heute alle Pflicht-Trainings erfuellt" zaehlt als Pause.
  const todayDoneOrFlexible = workoutsToday >= 1 && minutesToday < 90; // moderates Tagesvolumen
  const acwrOk = acwr === null || acwr < 1.4;
  const subjOk = subjReady === null || subjReady >= 6;
  const recoveryOk = todayRecovery === "green" || (todayRecovery === "yellow" && subjReady !== null && subjReady >= 7);

  if (recoveryOk && acwrOk && subjOk && todayScore >= 60 && (workoutsToday === 0 || todayDoneOrFlexible)) {
    const motivationBoost = motivation !== null && motivation >= 8 ? " — Motivation hoch, nutze sie." : "";
    const hardReason = workoutsToday > 0
      ? "Pflicht heute erledigt, Recovery passt — voll geben."
      : "Recovery gut, ACWR ok — beste Bedingungen zum Limit gehen.";
    return {
      level: "hard",
      headline: planLabel ? `Morgen: ${planLabel} — voll geben` : "Morgen: Hart trainieren",
      focus: (planLabel
        ? `${planLabel}, Intensitaet hoch — ${hardReason}${motivationBoost}`
        : isWeekend
          ? `Langer Lauf (Z2-Z3 60-90min) oder schweres Krafttraining — ${hardReason}${motivationBoost}`
          : `Intervalle (5x4min Z4) oder Krafttraining mit Last — ${hardReason}${motivationBoost}`),
      reminders,
    };
  }

  return {
    level: "moderate",
    headline: planLabel ? `Morgen: ${planLabel}` : "Morgen: Moderates Training",
    focus: planFocus(
      isWeekend
        ? "Z2-Lauf 60min oder Krafttraining + leichtes Cardio"
        : "Z2/Z3 Cardio 45min oder Krafttraining (8-10 Reps)",
    ),
    reminders,
  };
}
