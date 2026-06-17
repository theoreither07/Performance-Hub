/**
 * Holt geplante Trainings aus dem Google-Calendar fuer einen Zeitraum.
 * Nutzt fetchEventsForRange() und filtert via parseTrainingFromTitle().
 */
import { fetchEventsForRange } from "@/lib/api/google-calendar";
import { parseTrainingFromTitle, type PlannedTraining } from "@/lib/health/parse-training";
import { format } from "date-fns";

export async function getPlannedTrainings(from: Date, to: Date): Promise<PlannedTraining[]> {
  let events: Awaited<ReturnType<typeof fetchEventsForRange>>;
  try {
    events = await fetchEventsForRange(from, to);
  } catch {
    return [];
  }
  const out: PlannedTraining[] = [];
  for (const e of events) {
    const parsed = parseTrainingFromTitle(e.title);
    if (!parsed) continue;
    out.push({
      ...parsed,
      rawTitle: e.title,
      start: e.start,
      end: e.end,
      allDay: e.allDay,
    });
  }
  return out;
}

/**
 * Gruppiert geplante Trainings nach YYYY-MM-DD (Start-Tag, lokale TZ).
 */
export function groupByDay(plans: PlannedTraining[]): Map<string, PlannedTraining[]> {
  const map = new Map<string, PlannedTraining[]>();
  for (const p of plans) {
    const key = format(new Date(p.start), "yyyy-MM-dd");
    const arr = map.get(key) ?? [];
    arr.push(p);
    map.set(key, arr);
  }
  return map;
}

/**
 * Filtert geplante Trainings, die heute schon erfuellt wurden.
 *
 * Logik: fuer jeden Trainings-Type werden geplante mit bereits absolvierten matched.
 * Wenn 2x strength geplant und 1x strength gemacht -> 1 strength noch offen.
 * Garmin liefert generische Types (strength, running, cycling, ...) — wir matchen also nur per Type,
 * nicht per Spezifikum (z.B. "Legday 2" vs "Push-Workout" kann nicht unterschieden werden).
 */
export function filterUnfulfilledPlans<T extends { type: string }>(
  planned: T[],
  doneWorkouts: { type: string }[],
): T[] {
  // Zaehle absolvierte pro Type
  const doneCount: Record<string, number> = {};
  for (const w of doneWorkouts) {
    doneCount[w.type] = (doneCount[w.type] ?? 0) + 1;
  }
  const unfulfilled: T[] = [];
  for (const p of planned) {
    // "cardio" generisch matched gegen running/cycling/swimming/hiking/rowing
    const matchTypes = p.type === "cardio"
      ? ["cardio", "running", "cycling", "swimming", "hiking", "rowing"]
      : [p.type];
    let remainingForThis = true;
    for (const t of matchTypes) {
      if ((doneCount[t] ?? 0) > 0) {
        doneCount[t]--;
        remainingForThis = false;
        break;
      }
    }
    if (remainingForThis) unfulfilled.push(p);
  }
  return unfulfilled;
}

/**
 * Vergleicht den Wochenplan (TrainingProfile) mit dem was bereits diese Woche absolviert wurde.
 * Liefert Zaehler: wie viele Kraft, Laeufe, etc. sind noch fuer die Woche offen.
 */
export interface WeeklyProgress {
  strengthDone: number;
  strengthTarget: number;
  runsDone: number;
  runsTarget: number;
  hasLongRun: boolean;
}

export function computeWeeklyProgress(
  workouts: { date: string; type: string; distanceM?: number | null }[],
  monday: Date,
  profile: { strengthPerWeek: number; runsPerWeek: number; longRunKm?: number | null } | null,
): WeeklyProgress {
  const mondayKey = format(monday, "yyyy-MM-dd");
  const weekWorkouts = workouts.filter((w) => w.date >= mondayKey);
  const strengthDone = weekWorkouts.filter((w) => w.type === "strength").length;
  const runs = weekWorkouts.filter((w) => w.type === "running");
  const runsDone = runs.length;
  const longRunKm = profile?.longRunKm ?? 18;
  const hasLongRun = runs.some((r) => (r.distanceM ?? 0) >= longRunKm * 1000 * 0.85);
  return {
    strengthDone,
    strengthTarget: profile?.strengthPerWeek ?? 0,
    runsDone,
    runsTarget: profile?.runsPerWeek ?? 0,
    hasLongRun,
  };
}
