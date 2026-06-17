/**
 * Coach-Analyse-Modul
 *
 * Inspiriert von Sport-Science-Praxis fuer ambitionierte Hobby-/Profisportler.
 * Berechnet aus Garmin-Metriken, Workout-Log und Journal-Eintraegen einen
 * mehrdimensionalen "Coach-Snapshot":
 *
 *   - Wellness-Signale ueber mehrere Zeitfenster (7d, 14d, 28d)
 *   - Fatigue-Flag-System (Banister/Foster-inspiriert)
 *   - Status-Klassifikation (ready/building/fatigued/overreached/burnout/undertrained)
 *   - Wochen-Strategie (build/maintain/deload/recovery/ramp-up)
 *   - Performance-Trajektorien (VO2max, Z2-Effizienz, Strength-Volumen)
 *   - Tomorrow-Empfehlung mit konkreter Begruendung
 *
 * Die Empfehlung ist NICHT "wenn dann" sondern ein gewichtetes Modell:
 * mehrere Signale gleichzeitig werden betrachtet bevor ein Verdict steht.
 */

import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";

// ============ Types ============

export interface MetricPoint {
  date: string; // YYYY-MM-DD
  value: number;
}

export interface WorkoutPoint {
  date: string;
  type: string;
  durationSec: number;
  distanceM: number | null;
  avgHr: number | null;
  maxHr: number | null;
  trainingLoad: number | null;
  rpe: number | null;
  feeling: number | null;
}

export interface JournalPoint {
  date: string;
  mood: number | null;
  energy: number | null;
  motivation: number | null;
  soreness: number | null;
  sleepQuality: number | null;
  workoutFelt: number | null;
  ateWell: boolean | null;
  alcoholDrinks: number | null;
}

export interface PlannedSlim {
  type: string;
  name: string;
  distanceKm?: number;
}

export interface CoachContext {
  today: string; // YYYY-MM-DD
  // Metrics keyed by kind: hrv_overnight, sleep_minutes, sleep_score, rhr, body_battery_high,
  // body_battery_low, training_readiness, stress_avg, steps, vo2max
  metrics: Record<string, MetricPoint[]>;
  workouts: WorkoutPoint[]; // Ascending by date, last 60+ days
  journal: JournalPoint[]; // Ascending by date
  plannedToday: PlannedSlim[];
  plannedTomorrow: PlannedSlim[];
  profile: {
    strengthPerWeek: number;
    runsPerWeek: number;
    longRunKm: number | null;
    shortRunKm: number | null;
    restDays: number[]; // 1=Mo, 7=So
    goals: string | null;
    maxHr: number | null;
  } | null;
}

export type Status =
  | "ready"
  | "building"
  | "fatigued"
  | "overreached"
  | "burnout"
  | "undertrained";

export type WeekStrategyType =
  | "build"
  | "maintain"
  | "deload"
  | "recovery"
  | "ramp-up";

export type Level = "recover" | "easy" | "moderate" | "hard";

export type Trend = "up" | "down" | "stable" | "unknown";

export interface FatigueFlag {
  key: string;
  severity: number; // 1=hint, 2=warning, 3=strong
  description: string;
}

export interface Signals {
  // Wellness / Recovery
  wellness7d: number | null;       // 0-100 composite
  wellness28d: number | null;
  wellnessTrend: Trend;

  hrv7d: number | null;
  hrv28d: number | null;
  hrvDeviationPct: number | null;  // (current - baseline) / baseline * 100
  hrvTrend: Trend;

  rhr7d: number | null;
  rhr28d: number | null;
  rhrDeltaBpm: number | null;      // current - baseline
  rhrTrend: Trend;

  sleepMin7d: number | null;
  sleepMin28d: number | null;
  sleepTrend: Trend;

  bodyBatteryHigh7d: number | null;
  bodyBatteryHigh14dTrend: number | null; // slope (points/day) over 14d
  bodyBatteryLow7d: number | null;

  daysSinceFullyRecovered: number | null; // Tage seit letztem "Green-Day" + Energy>=7
  consecutiveLowEnergyDays: number;       // letzte konsek. Tage mit energy<=4
  lowEnergyDaysLast7: number;
  highSorenessDaysLast7: number;
  badSleepDaysLast7: number;

  // Load
  load7d: number;          // sum trainingLoad
  load28dAvg: number;      // mean per week over 28d
  acwr: number | null;
  monotony: number | null; // Foster: mean(dailyLoad) / SD(dailyLoad) over 7d
  strain: number | null;   // weeklyLoad * monotony

  // Performance
  vo2max: number | null;
  vo2maxDelta14d: number | null;
  vo2maxDelta30d: number | null;
  vo2maxTrend: Trend;

  // Z2 Aerobic Decoupling — runs at Z2 pace, lower HR for given pace = improving
  z2HrTrend14d: number | null; // slope of avg HR over 14d for runs at Z2 (per day)
  z2EfficiencyTrend: Trend;

  // Strength volume
  strengthSessions7d: number;
  strengthSessions28d: number;
  strengthMinutes7d: number;
  strengthMinutes28d: number;

  // Plan compliance
  weeklyCompliance: {
    strength: { planned: number; actual: number };
    runs: { planned: number; actual: number };
    hasLongRun: boolean;
  };
}

export interface WeekStrategy {
  type: WeekStrategyType;
  headline: string;
  rationale: string[];
  hardSessionsTarget: number;
  totalSessionsTarget: number;
  volumeAdjustmentPct: number; // -50 .. +20
}

export interface TomorrowReco {
  level: Level;
  headline: string;
  focus: string;
  rationale: string[];
  reminders: string[];
}

export interface CoachAnalysis {
  status: Status;
  flags: FatigueFlag[];
  signals: Signals;
  weekStrategy: WeekStrategy;
  tomorrow: TomorrowReco;
  observations: string[]; // 5-8 narrative bullets fuer das Dashboard
  trajectory: {
    fitness: Trend;       // ist die Form besser als vor 30 Tagen?
    wellness: Trend;      // subjektiv + HRV/RHR
    vo2max: Trend;
    z2Efficiency: Trend;
  };
  deloadRecommended: boolean;
}

// ============ Helpers ============

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function stdDev(values: number[]): number | null {
  if (values.length < 2) return null;
  const m = avg(values)!;
  return Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / values.length);
}

function slidingAvg(points: MetricPoint[] | undefined, fromDate: string, toDate: string): number | null {
  if (!points || points.length === 0) return null;
  const vals = points.filter((p) => p.date >= fromDate && p.date <= toDate).map((p) => p.value);
  return avg(vals);
}

function linearSlope(points: { x: number; y: number }[]): number | null {
  if (points.length < 3) return null;
  const meanX = avg(points.map((p) => p.x))!;
  const meanY = avg(points.map((p) => p.y))!;
  let num = 0;
  let den = 0;
  for (const p of points) {
    num += (p.x - meanX) * (p.y - meanY);
    den += (p.x - meanX) ** 2;
  }
  return den === 0 ? null : num / den;
}

function classifyTrend(delta: number | null, threshold: number, invert = false): Trend {
  if (delta === null) return "unknown";
  const adj = invert ? -delta : delta;
  if (adj > threshold) return "up";
  if (adj < -threshold) return "down";
  return "stable";
}

function lastN<T extends { date: string }>(arr: T[], todayKey: string, n: number): T[] {
  // Items mit date <= todayKey, sortiert asc, dann die letzten n
  return arr
    .filter((p) => p.date <= todayKey)
    .slice(-n);
}

function daysSpan(fromKey: string, toKey: string): number {
  return differenceInCalendarDays(parseISO(toKey), parseISO(fromKey));
}

// ============ Signal-Berechnung ============

function computeSignals(ctx: CoachContext): Signals {
  const today = ctx.today;
  const day7Back = format(addDays(parseISO(today), -6), "yyyy-MM-dd");
  const day14Back = format(addDays(parseISO(today), -13), "yyyy-MM-dd");
  const day28Back = format(addDays(parseISO(today), -27), "yyyy-MM-dd");
  const day8To28 = format(addDays(parseISO(today), -27), "yyyy-MM-dd");

  const hrv7 = slidingAvg(ctx.metrics.hrv_overnight, day7Back, today);
  const hrv28 = slidingAvg(ctx.metrics.hrv_overnight, day28Back, today);
  const rhr7 = slidingAvg(ctx.metrics.rhr, day7Back, today);
  const rhr28 = slidingAvg(ctx.metrics.rhr, day28Back, today);
  const sleep7 = slidingAvg(ctx.metrics.sleep_minutes, day7Back, today);
  const sleep28 = slidingAvg(ctx.metrics.sleep_minutes, day28Back, today);
  const bbHigh7 = slidingAvg(ctx.metrics.body_battery_high, day7Back, today);
  const bbLow7 = slidingAvg(ctx.metrics.body_battery_low, day7Back, today);

  // Body Battery High Slope ueber 14d
  const bbPoints = (ctx.metrics.body_battery_high ?? [])
    .filter((p) => p.date >= day14Back && p.date <= today)
    .map((p) => ({ x: daysSpan(day14Back, p.date), y: p.value }));
  const bbSlope = linearSlope(bbPoints);

  // Wellness composite (0-100): sleep + bbHigh + (anti)stress + journal-subjective
  const wellnessParts7: number[] = [];
  if (sleep7 !== null) wellnessParts7.push(Math.max(0, Math.min(100, ((sleep7 - 300) / 180) * 100)));
  if (bbHigh7 !== null) wellnessParts7.push(bbHigh7);
  const stress7 = slidingAvg(ctx.metrics.stress_avg, day7Back, today);
  if (stress7 !== null) wellnessParts7.push(100 - stress7);
  // Journal subjective avg 7d
  const journal7 = ctx.journal.filter((j) => j.date >= day7Back && j.date <= today);
  const journalScores7d: number[] = [];
  for (const j of journal7) {
    const parts: number[] = [];
    if (j.energy != null) parts.push(j.energy * 10);
    if (j.mood != null) parts.push(j.mood * 10);
    if (j.sleepQuality != null) parts.push(j.sleepQuality * 10);
    if (j.soreness != null) parts.push((10 - j.soreness) * 10);
    if (parts.length > 0) journalScores7d.push(avg(parts)!);
  }
  if (journalScores7d.length > 0) wellnessParts7.push(avg(journalScores7d)!);
  const wellness7d = wellnessParts7.length > 0 ? Math.round(avg(wellnessParts7)!) : null;

  const wellnessParts28: number[] = [];
  if (sleep28 !== null) wellnessParts28.push(Math.max(0, Math.min(100, ((sleep28 - 300) / 180) * 100)));
  const bbHigh28 = slidingAvg(ctx.metrics.body_battery_high, day28Back, today);
  if (bbHigh28 !== null) wellnessParts28.push(bbHigh28);
  const stress28 = slidingAvg(ctx.metrics.stress_avg, day28Back, today);
  if (stress28 !== null) wellnessParts28.push(100 - stress28);
  const journal28 = ctx.journal.filter((j) => j.date >= day28Back && j.date <= today);
  const journalScores28d: number[] = [];
  for (const j of journal28) {
    const parts: number[] = [];
    if (j.energy != null) parts.push(j.energy * 10);
    if (j.mood != null) parts.push(j.mood * 10);
    if (j.sleepQuality != null) parts.push(j.sleepQuality * 10);
    if (j.soreness != null) parts.push((10 - j.soreness) * 10);
    if (parts.length > 0) journalScores28d.push(avg(parts)!);
  }
  if (journalScores28d.length > 0) wellnessParts28.push(avg(journalScores28d)!);
  const wellness28d = wellnessParts28.length > 0 ? Math.round(avg(wellnessParts28)!) : null;

  // Days since fully recovered: letzter Tag mit (hrv >= baseline*0.95 UND rhr <= baseline*1.05 UND journal.energy>=7 wenn vorhanden)
  let daysSinceFullyRecovered: number | null = null;
  if (hrv28 !== null && rhr28 !== null) {
    const journalByDate = new Map(ctx.journal.map((j) => [j.date, j]));
    const allDates: string[] = [];
    for (let i = 0; i < 28; i++) allDates.push(format(addDays(parseISO(today), -i), "yyyy-MM-dd"));
    for (const dKey of allDates) {
      const hrvV = (ctx.metrics.hrv_overnight ?? []).find((p) => p.date === dKey)?.value;
      const rhrV = (ctx.metrics.rhr ?? []).find((p) => p.date === dKey)?.value;
      if (hrvV === undefined || rhrV === undefined) continue;
      const hrvOk = hrvV >= hrv28 * 0.95;
      const rhrOk = rhrV <= rhr28 * 1.05;
      const j = journalByDate.get(dKey);
      const energyOk = !j || j.energy === null || j.energy >= 7;
      if (hrvOk && rhrOk && energyOk) {
        daysSinceFullyRecovered = daysSpan(dKey, today);
        break;
      }
    }
    // wenn nichts gefunden in 28d:
    if (daysSinceFullyRecovered === null) daysSinceFullyRecovered = 28;
  }

  // Consecutive low energy days
  let consecutiveLowEnergyDays = 0;
  const recentJournals = [...ctx.journal].sort((a, b) => b.date.localeCompare(a.date));
  for (const j of recentJournals) {
    if (j.date > today) continue;
    if (j.energy !== null && j.energy <= 4) consecutiveLowEnergyDays++;
    else break;
  }
  const lowEnergyDaysLast7 = journal7.filter((j) => j.energy !== null && j.energy <= 4).length;
  const highSorenessDaysLast7 = journal7.filter((j) => j.soreness !== null && j.soreness >= 7).length;
  const badSleepDaysLast7 = journal7.filter((j) => j.sleepQuality !== null && j.sleepQuality <= 5).length;

  // Workout-Load aggregation
  const workouts7 = ctx.workouts.filter((w) => w.date >= day7Back && w.date <= today);
  const workouts28 = ctx.workouts.filter((w) => w.date >= day28Back && w.date <= today);
  const load7 = workouts7.reduce((s, w) => s + (w.trainingLoad ?? 0), 0);
  const load28 = workouts28.reduce((s, w) => s + (w.trainingLoad ?? 0), 0);
  const load28Weekly = load28 / 4;

  // ACWR — falls keine TrainingLoad-Daten, Fallback auf Minuten
  let acwr: number | null = null;
  if (load28Weekly > 0) {
    acwr = load7 / load28Weekly;
  } else {
    const min7 = workouts7.reduce((s, w) => s + w.durationSec, 0) / 60;
    const min28 = workouts28.reduce((s, w) => s + w.durationSec, 0) / 60;
    if (min28 / 4 > 0) acwr = min7 / (min28 / 4);
  }

  // Daily load fuer Monotony
  const dailyLoad: number[] = [];
  for (let i = 0; i < 7; i++) {
    const d = format(addDays(parseISO(today), -i), "yyyy-MM-dd");
    const sum = workouts7
      .filter((w) => w.date === d)
      .reduce((s, w) => s + (w.trainingLoad ?? Math.round(w.durationSec / 60)), 0);
    dailyLoad.push(sum);
  }
  const meanLoad = avg(dailyLoad);
  const sdLoad = stdDev(dailyLoad);
  const monotony = meanLoad !== null && sdLoad !== null && sdLoad > 0 ? meanLoad / sdLoad : null;
  const strain = monotony !== null && meanLoad !== null ? meanLoad * 7 * monotony : null;

  // VO2max
  const vo2maxSeries = ctx.metrics.vo2max ?? [];
  const vo2max = vo2maxSeries.length > 0 ? vo2maxSeries[vo2maxSeries.length - 1].value : null;
  const vo2max14d = vo2maxSeries.find((p) => p.date <= format(addDays(parseISO(today), -14), "yyyy-MM-dd"))?.value
    ?? null;
  const vo2max30d = vo2maxSeries.find((p) => p.date <= format(addDays(parseISO(today), -30), "yyyy-MM-dd"))?.value
    ?? null;
  const vo2maxDelta14d = vo2max !== null && vo2max14d !== null ? vo2max - vo2max14d : null;
  const vo2maxDelta30d = vo2max !== null && vo2max30d !== null ? vo2max - vo2max30d : null;

  // Z2 Aerobic Decoupling: avg HR ueber Z2-Laufeinheiten, Slope ueber 14d
  const maxHr = ctx.profile?.maxHr ?? 190;
  const z2Threshold = maxHr * 0.78;
  const z2Runs = ctx.workouts
    .filter((w) => w.type === "running" && w.avgHr !== null && w.avgHr <= z2Threshold && w.distanceM !== null && w.distanceM >= 3000)
    .filter((w) => w.date >= day14Back && w.date <= today)
    .map((w) => ({ x: daysSpan(day14Back, w.date), y: w.avgHr! }));
  const z2HrSlope = linearSlope(z2Runs);
  // negativ = HR sinkt fuer gleiches Niveau = besser
  const z2EfficiencyTrend = classifyTrend(z2HrSlope, 0.2, true);

  // Strength volume
  const strengthSessions7d = workouts7.filter((w) => w.type === "strength").length;
  const strengthSessions28d = workouts28.filter((w) => w.type === "strength").length;
  const strengthMinutes7d = Math.round(
    workouts7.filter((w) => w.type === "strength").reduce((s, w) => s + w.durationSec / 60, 0),
  );
  const strengthMinutes28d = Math.round(
    workouts28.filter((w) => w.type === "strength").reduce((s, w) => s + w.durationSec / 60, 0),
  );

  // Weekly compliance
  const monday = format(
    addDays(parseISO(today), -((parseISO(today).getDay() + 6) % 7)),
    "yyyy-MM-dd",
  );
  const thisWeek = ctx.workouts.filter((w) => w.date >= monday && w.date <= today);
  const strengthThisWeek = thisWeek.filter((w) => w.type === "strength").length;
  const runsThisWeek = thisWeek.filter((w) => w.type === "running").length;
  const longRunKmTarget = (ctx.profile?.longRunKm ?? 18) * 0.85 * 1000;
  const hasLongRun = thisWeek.some((w) => w.type === "running" && (w.distanceM ?? 0) >= longRunKmTarget);

  return {
    wellness7d,
    wellness28d,
    wellnessTrend:
      wellness7d !== null && wellness28d !== null
        ? classifyTrend(wellness7d - wellness28d, 5)
        : "unknown",

    hrv7d: hrv7,
    hrv28d: hrv28,
    hrvDeviationPct: hrv7 !== null && hrv28 !== null && hrv28 > 0 ? ((hrv7 - hrv28) / hrv28) * 100 : null,
    hrvTrend:
      hrv7 !== null && hrv28 !== null
        ? classifyTrend(hrv7 - hrv28, hrv28 * 0.05)
        : "unknown",

    rhr7d: rhr7,
    rhr28d: rhr28,
    rhrDeltaBpm: rhr7 !== null && rhr28 !== null ? rhr7 - rhr28 : null,
    rhrTrend:
      rhr7 !== null && rhr28 !== null
        ? classifyTrend(rhr7 - rhr28, 1.5, true) // niedriger = besser
        : "unknown",

    sleepMin7d: sleep7,
    sleepMin28d: sleep28,
    sleepTrend:
      sleep7 !== null && sleep28 !== null ? classifyTrend(sleep7 - sleep28, 15) : "unknown",

    bodyBatteryHigh7d: bbHigh7,
    bodyBatteryHigh14dTrend: bbSlope,
    bodyBatteryLow7d: bbLow7,

    daysSinceFullyRecovered,
    consecutiveLowEnergyDays,
    lowEnergyDaysLast7,
    highSorenessDaysLast7,
    badSleepDaysLast7,

    load7d: load7,
    load28dAvg: load28Weekly,
    acwr,
    monotony,
    strain,

    vo2max,
    vo2maxDelta14d,
    vo2maxDelta30d,
    vo2maxTrend: classifyTrend(vo2maxDelta30d, 0.5),

    z2HrTrend14d: z2HrSlope,
    z2EfficiencyTrend,

    strengthSessions7d,
    strengthSessions28d,
    strengthMinutes7d,
    strengthMinutes28d,

    weeklyCompliance: {
      strength: { planned: ctx.profile?.strengthPerWeek ?? 0, actual: strengthThisWeek },
      runs: { planned: ctx.profile?.runsPerWeek ?? 0, actual: runsThisWeek },
      hasLongRun,
    },
  };
}

// ============ Fatigue-Flags ============

function detectFatigueFlags(s: Signals): FatigueFlag[] {
  const flags: FatigueFlag[] = [];

  if (s.hrvDeviationPct !== null && s.hrvDeviationPct <= -10) {
    flags.push({
      key: "hrv-suppression",
      severity: s.hrvDeviationPct <= -15 ? 3 : 2,
      description: `HRV 7d ${s.hrvDeviationPct.toFixed(0)}% unter 28d-Baseline`,
    });
  }
  if (s.rhrDeltaBpm !== null && s.rhrDeltaBpm >= 3) {
    flags.push({
      key: "rhr-elevated",
      severity: s.rhrDeltaBpm >= 5 ? 3 : 2,
      description: `RHR 7d +${s.rhrDeltaBpm.toFixed(0)}bpm ueber Baseline`,
    });
  }
  if (s.bodyBatteryHigh14dTrend !== null && s.bodyBatteryHigh14dTrend <= -1) {
    flags.push({
      key: "bb-declining",
      severity: s.bodyBatteryHigh14dTrend <= -2 ? 3 : 2,
      description: `Body Battery (Max) sinkt ${(s.bodyBatteryHigh14dTrend * 14).toFixed(0)} Pkt in 14d`,
    });
  }
  if (s.sleepMin7d !== null && s.sleepMin7d < 7 * 60) {
    flags.push({
      key: "sleep-deficit",
      severity: s.sleepMin7d < 6.5 * 60 ? 3 : 1,
      description: `Schlaf 7d-avg ${Math.floor(s.sleepMin7d / 60)}h${Math.round(s.sleepMin7d % 60)}m`,
    });
  }
  if (s.lowEnergyDaysLast7 >= 3) {
    flags.push({
      key: "low-energy",
      severity: s.lowEnergyDaysLast7 >= 5 ? 3 : 2,
      description: `${s.lowEnergyDaysLast7}/7 Tage low Energy (<=4/10)`,
    });
  }
  if (s.highSorenessDaysLast7 >= 2) {
    flags.push({
      key: "soreness-pattern",
      severity: s.highSorenessDaysLast7 >= 4 ? 3 : 2,
      description: `${s.highSorenessDaysLast7}/7 Tage Soreness >=7/10`,
    });
  }
  if (s.acwr !== null && s.acwr >= 1.5) {
    flags.push({
      key: "acwr-high",
      severity: s.acwr >= 1.7 ? 3 : 2,
      description: `ACWR ${s.acwr.toFixed(2)} — Belastungsspike`,
    });
  }
  if (s.monotony !== null && s.monotony >= 2.0) {
    flags.push({
      key: "monotony-high",
      severity: 1,
      description: `Monotony ${s.monotony.toFixed(2)} — zu wenig Variation`,
    });
  }
  if (s.strain !== null && s.strain >= 5500) {
    flags.push({
      key: "strain-extreme",
      severity: 2,
      description: `Strain ${Math.round(s.strain)} — sehr hohe Wochen-Belastung`,
    });
  }
  if (s.daysSinceFullyRecovered !== null && s.daysSinceFullyRecovered >= 10) {
    flags.push({
      key: "no-recovery",
      severity: s.daysSinceFullyRecovered >= 14 ? 3 : 2,
      description: `${s.daysSinceFullyRecovered} Tage seit letzter voller Erholung`,
    });
  }
  return flags;
}

// ============ Status ============

function classifyStatus(signals: Signals, flags: FatigueFlag[]): Status {
  const score = flags.reduce((s, f) => s + f.severity, 0);
  // Detrained-Check: low load + 0 schweres Fatigue-Signal
  const lowLoad = (signals.acwr !== null && signals.acwr < 0.7) || signals.load7d < 100;
  if (lowLoad && score <= 1) return "undertrained";
  if (score >= 9) return "burnout";
  if (score >= 6) return "overreached";
  if (score >= 4) return "fatigued";
  if (score >= 2) return "building";
  return "ready";
}

// ============ Wochenstrategie ============

function pickWeekStrategy(status: Status, signals: Signals): WeekStrategy {
  const acwr = signals.acwr ?? 1.0;

  if (status === "burnout") {
    return {
      type: "recovery",
      headline: "Recovery-Woche zwingend",
      rationale: [
        "Mehrere starke Fatigue-Signale parallel",
        "Hauptziel: HRV/Schlaf/Energy zurueck auf Baseline bringen",
      ],
      hardSessionsTarget: 0,
      totalSessionsTarget: 2,
      volumeAdjustmentPct: -60,
    };
  }
  if (status === "overreached") {
    return {
      type: "deload",
      headline: "Deload-Woche",
      rationale: [
        "Akute Belastung > chronisch oder anhaltende Erschoepfungs-Signale",
        "50% Volumen, kein hartes Intervall, keine PR-Versuche",
      ],
      hardSessionsTarget: 0,
      totalSessionsTarget: 4,
      volumeAdjustmentPct: -50,
    };
  }
  if (status === "fatigued") {
    return {
      type: "maintain",
      headline: "Volumen halten, Intensitaet runter",
      rationale: [
        "Fatigue-Signale haeufen sich",
        "Aerobe Basis weiter aufbauen, aber kein hartes Krafttraining + kein Intervalltraining",
      ],
      hardSessionsTarget: 1,
      totalSessionsTarget: 5,
      volumeAdjustmentPct: -10,
    };
  }
  if (status === "undertrained") {
    return {
      type: "ramp-up",
      headline: "Volumen hochfahren",
      rationale: [
        "Belastung weit unter chronischem Schnitt",
        "+10-15% Volumen pro Woche bis ACWR 1.0-1.2",
      ],
      hardSessionsTarget: 2,
      totalSessionsTarget: 6,
      volumeAdjustmentPct: 15,
    };
  }
  if (status === "building") {
    return {
      type: "build",
      headline: "Build-Woche",
      rationale: [
        "Recovery passt, Belastung im Build-Bereich",
        "Plan voll durchziehen, 2-3 harte Einheiten",
      ],
      hardSessionsTarget: 2,
      totalSessionsTarget: 6,
      volumeAdjustmentPct: 5,
    };
  }
  // ready
  if (acwr < 0.9) {
    return {
      type: "ramp-up",
      headline: "Ramp-up: Volumen leicht erhoehen",
      rationale: [
        "Recovery top, Belastung niedrig — gute Phase zum Aufbauen",
        "+10-15% Wochenvolumen, gerne 1 Hochintensitaets-Einheit zusaetzlich",
      ],
      hardSessionsTarget: 3,
      totalSessionsTarget: 7,
      volumeAdjustmentPct: 12,
    };
  }
  if (acwr > 1.3) {
    return {
      type: "maintain",
      headline: "Volumen halten",
      rationale: [
        "Recovery passt, aber ACWR schon hoch",
        "Nicht draufpacken — Plan halten, qualitativ trainieren",
      ],
      hardSessionsTarget: 2,
      totalSessionsTarget: 6,
      volumeAdjustmentPct: 0,
    };
  }
  return {
    type: "build",
    headline: "Build-Woche",
    rationale: [
      "Recovery + Belastung im optimalen Bereich",
      "Plan voll durchziehen + 1-2 Akzente setzen (Intervalle, PR-Versuch)",
    ],
    hardSessionsTarget: 3,
    totalSessionsTarget: 6,
    volumeAdjustmentPct: 5,
  };
}

// ============ Tomorrow ============

function pickTomorrow(
  status: Status,
  weekStrategy: WeekStrategy,
  signals: Signals,
  ctx: CoachContext,
  workoutsToday: number,
  minutesToday: number,
  todayJournal: JournalPoint | null,
): TomorrowReco {
  const reminders: string[] = [];
  const rationale: string[] = [];

  // Reminders
  if (workoutsToday >= 1) reminders.push("Protein + Carbs in 90min nach Training");
  if (minutesToday >= 60) reminders.push("Mind. 0.5L Wasser + Elektrolyte vor dem Schlaf");
  if (todayJournal?.alcoholDrinks && todayJournal.alcoholDrinks >= 1)
    reminders.push("Kein Alkohol — HRV-Hit, REM-Schlaf reduziert");
  if (todayJournal?.sleepQuality !== null && todayJournal?.sleepQuality !== undefined && todayJournal.sleepQuality <= 5)
    reminders.push("Frueh ins Bett (vor 22:30), Screens 30min davor weg");
  if (todayJournal?.soreness && todayJournal.soreness >= 7)
    reminders.push("10min Foam Rolling + Mobility vor dem Schlaf");
  if (signals.sleepMin7d !== null && signals.sleepMin7d < 7 * 60)
    reminders.push(`Schlaf 7d-avg nur ${Math.floor(signals.sleepMin7d / 60)}h${Math.round(signals.sleepMin7d % 60)}m — Schlaffenster vergroessern`);
  if (reminders.length === 0) reminders.push("Schlaf halten + 2L Wasser ueber den Tag");

  // Wochentag von morgen
  const tomorrow = addDays(parseISO(ctx.today), 1);
  const dow = ((tomorrow.getDay() + 6) % 7) + 1;
  const isWeekend = dow === 6 || dow === 7;
  const isRestDay = (ctx.profile?.restDays ?? []).includes(dow);
  const plannedLabel = ctx.plannedTomorrow.length > 0
    ? ctx.plannedTomorrow.map((p) => (p.distanceKm ? `${p.name} (${p.distanceKm}km)` : p.name)).join(" + ")
    : "";

  // Restday: respektieren ausser explizit Plan-Eintrag im Kalender
  if (isRestDay && ctx.plannedTomorrow.length === 0) {
    const dayName = ["", "Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"][dow];
    return {
      level: "recover",
      headline: `Morgen ${dayName}: Restday`,
      focus: "Bewusst Pause. Optional: Mobility, Spaziergang, Recovery.",
      rationale: ["Im Plan als Restday gesetzt"],
      reminders,
    };
  }

  // Status-driven
  if (status === "burnout" || weekStrategy.type === "recovery") {
    return {
      level: "recover",
      headline: "Morgen: Pause / Recovery",
      focus: "Spaziergang, Mobility, Atemuebungen. Kein strukturiertes Training.",
      rationale: [
        "Cumulative Fatigue zu hoch — Erholung ist die Priorität #1",
        `${signals.daysSinceFullyRecovered ?? "?"} Tage seit letzter voller Erholung`,
      ],
      reminders,
    };
  }
  if (status === "overreached" || weekStrategy.type === "deload") {
    return {
      level: "easy",
      headline: plannedLabel ? `Morgen: ${plannedLabel} — Deload-Variante` : "Morgen: Deload-Easy",
      focus: plannedLabel
        ? `${plannedLabel}, Volumen ~50%, kein Tempo, Puls Z1-Z2`
        : "Easy Z2 max 40min ODER 20min Mobility/Yoga",
      rationale: [
        "Deload-Woche aktiv — Volumen ist um 50% reduziert",
        signals.acwr !== null ? `ACWR ${signals.acwr.toFixed(2)}` : null,
      ].filter(Boolean) as string[],
      reminders,
    };
  }

  // Heute schon hart gewesen
  if (workoutsToday >= 2 || minutesToday >= 120) {
    return {
      level: "recover",
      headline: plannedLabel ? `Morgen: ${plannedLabel} (vorsichtig)` : "Morgen: Recovery",
      focus: plannedLabel ? `${plannedLabel}, bewusst leicht` : "Mobility, Spaziergang, oder Pause",
      rationale: [`Heute ${workoutsToday}x ${minutesToday}min — Body braucht 24h zur Resynthese`],
      reminders,
    };
  }

  // Journal-Override: starke Ueberlastungs-Signale
  if (todayJournal?.soreness !== null && todayJournal?.soreness !== undefined && todayJournal.soreness >= 8) {
    return {
      level: "recover",
      headline: "Morgen: Pause/Mobility",
      focus: "Kein hartes Training. Foam Rolling, Stretching, Spaziergang.",
      rationale: [`Soreness ${todayJournal.soreness}/10 — Geweberegeneration noetig`],
      reminders,
    };
  }
  const journalNeg: string[] = [];
  if (todayJournal?.energy !== null && todayJournal?.energy !== undefined && todayJournal.energy <= 3)
    journalNeg.push(`Energy ${todayJournal.energy}/10`);
  if (todayJournal?.workoutFelt !== null && todayJournal?.workoutFelt !== undefined && todayJournal.workoutFelt <= 3)
    journalNeg.push(`Workout-Gefuehl ${todayJournal.workoutFelt}/10`);
  if (todayJournal?.mood !== null && todayJournal?.mood !== undefined && todayJournal.mood <= 3)
    journalNeg.push(`Stimmung ${todayJournal.mood}/10`);
  if (todayJournal?.soreness !== null && todayJournal?.soreness !== undefined && todayJournal.soreness >= 7)
    journalNeg.push(`Soreness ${todayJournal.soreness}/10`);

  // 2+ negative subj. Signale → easy
  if (journalNeg.length >= 2) {
    return {
      level: "easy",
      headline: plannedLabel ? `Morgen: ${plannedLabel} (easy)` : "Morgen: Leicht",
      focus: plannedLabel ? `${plannedLabel}, Z2 Cardio Intensitaet, kein Tempo` : "Z2 Cardio 30-45min oder Mobility",
      rationale: [`Subjektive Schwaeche-Signale: ${journalNeg.join(", ")}`],
      reminders,
    };
  }
  if (journalNeg.length === 1 && status === "fatigued") {
    return {
      level: "easy",
      headline: plannedLabel ? `Morgen: ${plannedLabel} (easy)` : "Morgen: Leicht",
      focus: plannedLabel ? `${plannedLabel}, bewusst easy` : "Z2 Cardio 30-45min",
      rationale: [`${journalNeg[0]} + fatigued`],
      reminders,
    };
  }

  if (status === "fatigued") {
    return {
      level: "easy",
      headline: plannedLabel ? `Morgen: ${plannedLabel} (easy)` : "Morgen: Easy",
      focus: plannedLabel ? `${plannedLabel}, Volumen halten aber Intensitaet runter` : "Z2 Cardio 45min oder leichtes Krafttraining",
      rationale: [
        "Mehrere Fatigue-Signale haeufen sich — keine harte Einheit jetzt",
        signals.daysSinceFullyRecovered !== null ? `${signals.daysSinceFullyRecovered}d seit voller Erholung` : null,
      ].filter(Boolean) as string[],
      reminders,
    };
  }

  // Build / ready — HART moeglich wenn Bedingungen passen
  const subjScore = (() => {
    const parts: number[] = [];
    if (todayJournal?.energy != null) parts.push(todayJournal.energy);
    if (todayJournal?.motivation != null) parts.push(todayJournal.motivation);
    if (todayJournal?.mood != null) parts.push(todayJournal.mood);
    return parts.length > 0 ? avg(parts) : null;
  })();

  const hardOk = (status === "ready" || status === "building" || status === "undertrained")
    && (signals.acwr === null || signals.acwr < 1.3)
    && (subjScore === null || subjScore >= 6)
    && workoutsToday === 0;

  if (hardOk) {
    // Build the rationale
    rationale.push(`Status: ${status}`);
    if (signals.hrvDeviationPct !== null && signals.hrvDeviationPct > 0)
      rationale.push(`HRV +${signals.hrvDeviationPct.toFixed(0)}% ueber Baseline`);
    if (signals.daysSinceFullyRecovered !== null && signals.daysSinceFullyRecovered <= 2)
      rationale.push("Heute/gestern voll erholt");
    if (subjScore !== null && subjScore >= 8)
      rationale.push(`Subjektiv ${subjScore.toFixed(0)}/10 — beste Voraussetzung`);
    if (signals.weeklyCompliance.runs.actual < signals.weeklyCompliance.runs.planned && plannedLabel.toLowerCase().includes("lauf"))
      rationale.push(`Wochenplan offen: ${signals.weeklyCompliance.runs.planned - signals.weeklyCompliance.runs.actual} Lauf`);

    return {
      level: "hard",
      headline: plannedLabel ? `Morgen: ${plannedLabel} — volle Intensitaet` : "Morgen: Hart trainieren",
      focus: plannedLabel
        ? `${plannedLabel}, an die Komfortgrenze. Wenn Lauf: Tempo-Block oder Intervalle. Wenn Kraft: Top-Sets mit Last.`
        : isWeekend
          ? "Langer Lauf Z2-Z3 60-90min ODER schweres Krafttraining mit Top-Sets"
          : "Intervalle (5x4min Z4) ODER Krafttraining-PR-Versuch",
      rationale,
      reminders,
    };
  }

  // Default: moderate
  rationale.push(`Status: ${status}`);
  if (signals.acwr !== null) rationale.push(`ACWR ${signals.acwr.toFixed(2)}`);
  return {
    level: "moderate",
    headline: plannedLabel ? `Morgen: ${plannedLabel}` : "Morgen: Moderates Training",
    focus: plannedLabel
      ? `${plannedLabel}, kontrolliert. Kein Maximum, aber Plan durchziehen.`
      : "Z2/Z3 Cardio 45min ODER 6-8 Reps Krafttraining",
    rationale,
    reminders,
  };
}

// ============ Observations ============

function generateObservations(signals: Signals, status: Status, weekStrategy: WeekStrategy): string[] {
  const out: string[] = [];

  // Recovery state
  if (signals.daysSinceFullyRecovered !== null) {
    if (signals.daysSinceFullyRecovered <= 1) out.push("Du bist aktuell voll erholt.");
    else if (signals.daysSinceFullyRecovered <= 4) out.push(`${signals.daysSinceFullyRecovered}d seit letzter voller Erholung — noch im Normalbereich.`);
    else if (signals.daysSinceFullyRecovered <= 9) out.push(`${signals.daysSinceFullyRecovered}d seit letzter voller Erholung — beobachten.`);
    else out.push(`Achtung: ${signals.daysSinceFullyRecovered}d seit letzter voller Erholung. Recovery-Tag bald einplanen.`);
  }

  // HRV
  if (signals.hrvDeviationPct !== null) {
    const tag = signals.hrvDeviationPct > 5 ? "stark erholt" : signals.hrvDeviationPct < -5 ? "unter Baseline" : "auf Baseline";
    out.push(`HRV 7d: ${signals.hrv7d?.toFixed(0)}ms (${signals.hrvDeviationPct > 0 ? "+" : ""}${signals.hrvDeviationPct.toFixed(1)}% vs 28d) — ${tag}.`);
  }
  // RHR
  if (signals.rhrDeltaBpm !== null && Math.abs(signals.rhrDeltaBpm) >= 1) {
    if (signals.rhrDeltaBpm >= 2) out.push(`RHR ${signals.rhr7d?.toFixed(0)} bpm — ${signals.rhrDeltaBpm.toFixed(0)}bpm ueber Baseline (Fatigue-Hinweis).`);
    else if (signals.rhrDeltaBpm <= -2) out.push(`RHR ${signals.rhr7d?.toFixed(0)} bpm — gut erholt unter Baseline.`);
  }
  // Subjektiv-Pattern
  if (signals.lowEnergyDaysLast7 >= 3) {
    out.push(`${signals.lowEnergyDaysLast7}/7 Tage Low-Energy im Journal — klares Signal fuer Volumen-Reduktion.`);
  } else if (signals.consecutiveLowEnergyDays >= 2) {
    out.push(`${signals.consecutiveLowEnergyDays} Tage in Folge Low-Energy — aufpassen.`);
  }
  if (signals.highSorenessDaysLast7 >= 2) {
    out.push(`${signals.highSorenessDaysLast7}/7 Tage Soreness >=7 — eventuell zu viel exzentrisches Training.`);
  }

  // Load
  if (signals.acwr !== null) {
    if (signals.acwr < 0.7) out.push(`ACWR ${signals.acwr.toFixed(2)} — unterfordert, Volumen hochfahren.`);
    else if (signals.acwr > 1.5) out.push(`ACWR ${signals.acwr.toFixed(2)} — akute Last weit ueber Schnitt. Risikobereich.`);
    else if (signals.acwr >= 1.0 && signals.acwr <= 1.3) out.push(`ACWR ${signals.acwr.toFixed(2)} — optimaler Bereich.`);
  }
  if (signals.monotony !== null && signals.monotony >= 2.0) {
    out.push(`Monotony ${signals.monotony.toFixed(2)} — zu wenig Variation, hartes/leichtes klarer trennen.`);
  }

  // VO2max
  if (signals.vo2maxDelta30d !== null) {
    if (signals.vo2maxDelta30d >= 0.5) out.push(`VO2max ${signals.vo2max} (+${signals.vo2maxDelta30d.toFixed(1)} in 30d) — Aerobe Form steigt. Weiter Z2-Basis + 1x Intervalle/Woche.`);
    else if (signals.vo2maxDelta30d <= -0.5) out.push(`VO2max ${signals.vo2max} (${signals.vo2maxDelta30d.toFixed(1)} in 30d) — sinkt. Zu wenig Hochintensitaet ODER chronische Fatigue.`);
    else out.push(`VO2max ${signals.vo2max} stabil ueber 30d. Fuer Steigerung braucht es regelmaessig 1-2 Intervalleinheiten/Woche.`);
  }

  // Z2 Effizienz
  if (signals.z2EfficiencyTrend === "up") out.push("Z2-Effizienz steigt: HR sinkt fuer gleiches Pace-Niveau. Aerobe Basis verbessert.");
  else if (signals.z2EfficiencyTrend === "down") out.push("Z2-Effizienz faellt: gleiche Pace, hoeherer HR — Fatigue oder Form-Verlust.");

  // Strength
  if (signals.strengthSessions7d > 0) {
    const target = signals.weeklyCompliance.strength.planned;
    const open = target - signals.weeklyCompliance.strength.actual;
    if (open <= 0) out.push(`Kraft diese Woche ${signals.strengthSessions7d}/${target} — Plan erfuellt.`);
    else out.push(`Kraft diese Woche ${signals.weeklyCompliance.strength.actual}/${target} — ${open} offen.`);
  }
  // Runs
  const runsPlan = signals.weeklyCompliance.runs;
  if (runsPlan.planned > 0) {
    const longTag = signals.weeklyCompliance.hasLongRun ? "Long Run ✓" : "Long Run offen";
    out.push(`Laeufe ${runsPlan.actual}/${runsPlan.planned} — ${longTag}.`);
  }

  // Deload-Hinweis
  if (weekStrategy.type === "deload" || weekStrategy.type === "recovery") {
    out.push(`Empfehlung: ${weekStrategy.headline}. ${weekStrategy.rationale[0]}.`);
  }

  return out;
}

// ============ Trajektorie ============

function computeTrajectory(signals: Signals): CoachAnalysis["trajectory"] {
  const wellness: Trend = signals.wellnessTrend;
  const fitness: Trend = (() => {
    // gesamtfitness: VO2max + Z2-Effizienz + Strength-Volumen
    const ups = [signals.vo2maxTrend, signals.z2EfficiencyTrend].filter((t) => t === "up").length;
    const downs = [signals.vo2maxTrend, signals.z2EfficiencyTrend].filter((t) => t === "down").length;
    if (ups - downs >= 1) return "up";
    if (downs - ups >= 1) return "down";
    if (signals.vo2maxTrend === "stable" || signals.z2EfficiencyTrend === "stable") return "stable";
    return "unknown";
  })();
  return {
    fitness,
    wellness,
    vo2max: signals.vo2maxTrend,
    z2Efficiency: signals.z2EfficiencyTrend,
  };
}

// ============ Public Entry ============

export function analyzeCoach(ctx: CoachContext, workoutsToday: number, minutesToday: number): CoachAnalysis {
  const signals = computeSignals(ctx);
  const flags = detectFatigueFlags(signals);
  const status = classifyStatus(signals, flags);
  const weekStrategy = pickWeekStrategy(status, signals);
  const todayJournal = ctx.journal.find((j) => j.date === ctx.today) ?? null;
  const tomorrow = pickTomorrow(status, weekStrategy, signals, ctx, workoutsToday, minutesToday, todayJournal);
  const observations = generateObservations(signals, status, weekStrategy);
  const trajectory = computeTrajectory(signals);
  const deloadRecommended = weekStrategy.type === "deload" || weekStrategy.type === "recovery";

  return {
    status,
    flags,
    signals,
    weekStrategy,
    tomorrow,
    observations,
    trajectory,
    deloadRecommended,
  };
}
