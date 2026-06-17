/**
 * Streak-Engine.
 *
 * Berechnet pro Behaviour-Track die letzten 30/60 Tage als Daily-Buckets.
 * Pro Tag: hit (true/false) — daraus current-streak + best-streak + heatmap-cells.
 *
 * Tracks:
 *  - garmin-sync (hat heute eine HRV oder Sleep-Metric?)
 *  - sleep-7h (sleep_minutes >= 420?)
 *  - journal (DailyJournal-Eintrag mit mind. mood/energy?)
 *  - long-run (Sa/So Lauf-Workout mit Dist >= longRunKm * 0.85?)
 *  - strength-3w (3 strength-Workouts in der jeweiligen Kalenderwoche?)
 *  - z2-discipline (Cardio-Workouts der letzten 7d alle in Z2 = avgHr < 0.81 * maxHr?)
 */
import { format, subDays, getDay } from "date-fns";

export interface StreakDay {
  date: string; // YYYY-MM-DD
  hit: boolean;
}

export interface StreakSummary {
  key: string;
  label: string;
  description: string;
  days: StreakDay[]; // chronologisch
  current: number;
  best: number;
  rate30d: number; // 0..1
}

interface MetricRow { date: string; value: number; kind: string }
interface JournalRow { date: string; mood: number | null; energy: number | null }
interface WorkoutRow { date: string; type: string; distanceM: number | null; avgHr: number | null; maxHr: number | null }

/** Hilfsfunktion: erstellt eine Map date → hit aus einer Bedingung. */
function buildDays(start: Date, daysCount: number, predicate: (dateKey: string) => boolean): StreakDay[] {
  const days: StreakDay[] = [];
  for (let i = daysCount - 1; i >= 0; i--) {
    const d = subDays(start, i);
    const key = format(d, "yyyy-MM-dd");
    days.push({ date: key, hit: predicate(key) });
  }
  return days;
}

function currentStreak(days: StreakDay[]): number {
  // Zählt von hinten rückwärts. Heute MUSS hit sein damit > 0.
  let s = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].hit) s++;
    else break;
  }
  return s;
}

function bestStreak(days: StreakDay[]): number {
  let best = 0;
  let cur = 0;
  for (const d of days) {
    if (d.hit) {
      cur++;
      if (cur > best) best = cur;
    } else {
      cur = 0;
    }
  }
  return best;
}

function rate(days: StreakDay[]): number {
  if (days.length === 0) return 0;
  return days.filter((d) => d.hit).length / days.length;
}

function summarize(key: string, label: string, description: string, days: StreakDay[]): StreakSummary {
  return {
    key,
    label,
    description,
    days,
    current: currentStreak(days),
    best: bestStreak(days),
    rate30d: rate(days.slice(-30)),
  };
}

export interface StreakInputs {
  today: Date;
  metrics: MetricRow[];
  journal: JournalRow[];
  workouts: WorkoutRow[];
  profile: { longRunKm: number | null; maxHr: number | null } | null;
}

export function computeStreaks(input: StreakInputs): StreakSummary[] {
  const { today, metrics, journal, workouts, profile } = input;
  const DAYS_BACK = 30;

  // Index Metrics nach (date, kind)
  const metricsByDateKind = new Map<string, Set<string>>();
  for (const m of metrics) {
    const set = metricsByDateKind.get(m.date) ?? new Set<string>();
    set.add(m.kind);
    metricsByDateKind.set(m.date, set);
  }

  // Index Journal nach date
  const journalByDate = new Map<string, JournalRow>();
  for (const j of journal) journalByDate.set(j.date, j);

  // Index Workouts nach date
  const workoutsByDate = new Map<string, WorkoutRow[]>();
  for (const w of workouts) {
    const list = workoutsByDate.get(w.date) ?? [];
    list.push(w);
    workoutsByDate.set(w.date, list);
  }

  // --- GARMIN-SYNC: für den Tag liegt mindestens HRV/Sleep vor ---
  const garminDays = buildDays(today, DAYS_BACK, (d) => {
    const kinds = metricsByDateKind.get(d);
    return !!(kinds && (kinds.has("hrv_overnight") || kinds.has("sleep_minutes")));
  });

  // --- SLEEP >= 7h ---
  const sleepDays = buildDays(today, DAYS_BACK, (d) => {
    const min = metrics.find((m) => m.date === d && m.kind === "sleep_minutes")?.value;
    return typeof min === "number" && min >= 7 * 60;
  });

  // --- JOURNAL: Eintrag mit mind. einem Wert ---
  const journalDays = buildDays(today, DAYS_BACK, (d) => {
    const j = journalByDate.get(d);
    return !!j && (j.mood !== null || j.energy !== null);
  });

  // --- LONG RUN: pro KALENDERWOCHE prüfen, ob in der Woche dieses Tages ein Long Run
  // (>=longRunKm*0.85) absolviert wurde. Hit zählt für JEDEN Tag der Woche wenn LR drin.
  // Vorher: Mo-Fr counten als "hit" obwohl LR gar nicht required war → Streak gelogen.
  const longRunTargetM = (profile?.longRunKm ?? 18) * 1000 * 0.85;
  const longRunDays = buildDays(today, DAYS_BACK, (d) => {
    const date = new Date(d + "T12:00:00");
    // KW dieses Datums durchgehen (Mo bis So)
    const dow = (date.getDay() + 6) % 7; // 0=Mo, 6=So
    const monday = subDays(date, dow);
    for (let i = 0; i < 7; i++) {
      const dayKey = format(subDays(monday, -i), "yyyy-MM-dd");
      const list = workoutsByDate.get(dayKey) ?? [];
      if (list.some((w) => w.type === "running" && (w.distanceM ?? 0) >= longRunTargetM)) return true;
    }
    return false;
  });

  // --- STRENGTH 3×/Woche ---
  // Wir bauen das pro Tag: hit = die KW dieses Tages hat 3+ strength-Workouts insgesamt
  const strengthDays = buildDays(today, DAYS_BACK, (d) => {
    const date = new Date(d + "T12:00:00");
    const dow = (date.getDay() + 6) % 7; // 0=Mo, 6=So
    const monday = subDays(date, dow);
    let count = 0;
    for (let i = 0; i < 7; i++) {
      const dayKey = format(subDays(monday, -i), "yyyy-MM-dd");
      const list = workoutsByDate.get(dayKey) ?? [];
      count += list.filter((w) => w.type === "strength").length;
    }
    return count >= 3;
  });

  // --- Z2-DISCIPLINE: rolling 7d, alle Cardio-Sessions in Z2 (avgHr < 0.81*maxHr) ---
  const maxHr = profile?.maxHr ?? 190;
  const z2Threshold = maxHr * 0.81;
  const z2Days = buildDays(today, DAYS_BACK, (d) => {
    const date = new Date(d + "T12:00:00");
    let allZ2 = true;
    let anyCardio = false;
    for (let i = 0; i < 7; i++) {
      const dayKey = format(subDays(date, i), "yyyy-MM-dd");
      const list = workoutsByDate.get(dayKey) ?? [];
      for (const w of list) {
        if (w.type === "running" || w.type === "cycling") {
          anyCardio = true;
          if (w.avgHr !== null && w.avgHr > z2Threshold) allZ2 = false;
        }
      }
    }
    return anyCardio && allZ2;
  });

  return [
    summarize("garmin", "Garmin täglich", "Sync (HRV oder Sleep) liegt vor.", garminDays),
    summarize("sleep", "Schlaf ≥7h", "Genug für Recovery.", sleepDays),
    summarize("journal", "Journal gefüllt", "Subjektives Befinden eingetragen.", journalDays),
    summarize("longrun", "Long Run am WE", "Sa oder So Lauf ≥85 % deiner LongRun-Distanz.", longRunDays),
    summarize("strength", "3× Kraft/Woche", "Mindestens 3 Strength-Sessions in der Kalenderwoche.", strengthDays),
    summarize("z2", "Z2-Disziplin (7d)", "Alle Cardio-Sessions der letzten Woche in Zone 2 (Aerobic-Base).", z2Days),
  ];
}
