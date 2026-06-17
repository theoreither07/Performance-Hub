import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getCurrentUser } from "@/lib/api/get-user";
import { subDays, addDays, startOfDay, startOfWeek, format } from "date-fns";
import { computeDayScore, type MetricMap } from "@/lib/health/score";
import { getPlannedTrainings, groupByDay, computeWeeklyProgress, filterUnfulfilledPlans } from "@/lib/health/planned-trainings";
import { analyzeCoach, type CoachContext } from "@/lib/health/coach-analysis";
import { getHealthContext } from "@/lib/health/metrics-cache";

export const dynamic = "force-dynamic";

/**
 * GET /api/health/score?days=7
 * Liefert pro Tag der letzten N Tage: Day-Score, Recovery, ACWR, Training-Empfehlung,
 * plus geplante Trainings (aus Kalender) und Wochenfortschritt vs TrainingProfile.
 * Zusaetzlich: `coach` — die tiefere Analyse mit Status, Wochenstrategie, Trajektorie.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  const { searchParams } = new URL(req.url);
  const days = Math.min(30, Math.max(1, Number(searchParams.get("days") ?? "7")));
  const now = new Date();
  const todayKey = format(now, "yyyy-MM-dd");
  // Wir laden 60d historie damit Coach-Analyse 28d-Baselines + 30d VO2max trends machen kann
  const histSince = startOfDay(subDays(now, 60));
  const monday = startOfWeek(now, { weekStartsOn: 1 });

  // 60d-Window aus Memory-Cache (5min TTL, gemeinsam mit Coach-Routen) statt eigener DB-Query.
  // Spart 3 DB-Roundtrips pro Score-Request → /health-Page rendert spuerbar schneller.
  const ctxCached = await getHealthContext(user.id);
  const { metrics, journal, workouts, profile } = ctxCached;
  const plannedRange = await getPlannedTrainings(startOfDay(subDays(now, days - 1)), startOfDay(addDays(now, 2)));

  // Pivot metrics
  const metricMap: MetricMap = {};
  const metricsByKind: Record<string, { date: string; value: number }[]> = {};
  for (const m of metrics) {
    const dateKey = format(m.date, "yyyy-MM-dd");
    metricMap[m.kind] = metricMap[m.kind] ?? { values: [] };
    metricMap[m.kind].values.push({ date: dateKey, value: m.value });
    metricsByKind[m.kind] = metricsByKind[m.kind] ?? [];
    metricsByKind[m.kind].push({ date: dateKey, value: m.value });
  }
  const journalByDate = new Map(journal.map((j) => [format(j.date, "yyyy-MM-dd"), j]));
  const plannedByDay = groupByDay(plannedRange);

  // Workouts aggregation + per-day type-list fuer Plan-Abgleich
  // Load: Garmin trainingLoad bevorzugt, sonst sRPE = RPE x Min (Foster session-RPE Methode).
  // Dadurch bekommen reine Strength-Sessions ohne Garmin-Load auch ein Load-Signal ins ACWR.
  const loadByDate = new Map<string, number>();
  const countByDate = new Map<string, number>();
  const minutesByDate = new Map<string, number>();
  const typesByDate = new Map<string, { type: string }[]>();
  for (const w of workouts) {
    const key = format(w.date, "yyyy-MM-dd");
    const durationMin = Math.round(w.durationSec / 60);
    // Foster session-RPE: rpe (1-10) * duration min. Wenn kein RPE: assume RPE 5 als neutraler Fallback.
    const srpe = durationMin * (w.rpe ?? 5);
    const load = w.trainingLoad ?? srpe;
    loadByDate.set(key, (loadByDate.get(key) ?? 0) + load);
    countByDate.set(key, (countByDate.get(key) ?? 0) + 1);
    minutesByDate.set(key, (minutesByDate.get(key) ?? 0) + durationMin);
    const arr = typesByDate.get(key) ?? [];
    arr.push({ type: w.type });
    typesByDate.set(key, arr);
  }
  function sumLoad(endDate: Date, daysBack: number): number {
    let sum = 0;
    for (let i = 0; i < daysBack; i++) {
      const d = format(subDays(endDate, i), "yyyy-MM-dd");
      sum += loadByDate.get(d) ?? 0;
    }
    return sum;
  }

  // Wochenfortschritt
  const weekly = computeWeeklyProgress(
    workouts.map((w) => ({
      date: format(w.date, "yyyy-MM-dd"),
      type: w.type,
      distanceM: w.distanceM,
    })),
    monday,
    profile,
  );

  // === Coach-Analyse fuer heute ===
  const coachCtx: CoachContext = {
    today: todayKey,
    metrics: metricsByKind,
    workouts: workouts.map((w) => ({
      date: format(w.date, "yyyy-MM-dd"),
      type: w.type,
      durationSec: w.durationSec,
      distanceM: w.distanceM,
      avgHr: w.avgHr,
      maxHr: w.maxHr,
      trainingLoad: w.trainingLoad,
      rpe: w.rpe,
      feeling: w.feeling,
    })),
    journal: journal.map((j) => ({
      date: format(j.date, "yyyy-MM-dd"),
      mood: j.mood,
      energy: j.energy,
      motivation: j.motivation,
      soreness: j.soreness,
      sleepQuality: j.sleepQuality,
      workoutFelt: j.workoutFelt,
      ateWell: j.ateWell,
      alcoholDrinks: j.alcoholDrinks,
    })),
    plannedToday: filterUnfulfilledPlans(plannedByDay.get(todayKey) ?? [], typesByDate.get(todayKey) ?? []),
    plannedTomorrow: filterUnfulfilledPlans(
      plannedByDay.get(format(addDays(now, 1), "yyyy-MM-dd")) ?? [],
      typesByDate.get(format(addDays(now, 1), "yyyy-MM-dd")) ?? [],
    ),
    profile: profile
      ? {
          strengthPerWeek: profile.strengthPerWeek,
          runsPerWeek: profile.runsPerWeek,
          longRunKm: profile.longRunKm,
          shortRunKm: profile.shortRunKm,
          restDays: profile.restDays,
          goals: profile.goals,
          maxHr: profile.maxHr,
        }
      : null,
  };
  const coach = analyzeCoach(coachCtx, countByDate.get(todayKey) ?? 0, minutesByDate.get(todayKey) ?? 0);

  // Vitality-Snapshots der relevanten Tage laden (für Carry-Over in Bereitschaft)
  const vitalitySnaps = await prisma.dailyVitalitySnapshot.findMany({
    where: {
      userId: user.id,
      date: { gte: startOfDay(subDays(now, days + 1)), lte: startOfDay(now) },
    },
  }).catch(() => []);
  const vitalityByDate = new Map<string, number>(
    vitalitySnaps.map((s) => [format(s.date, "yyyy-MM-dd"), s.endScore]),
  );

  // Für Outcomes-Loop: erkennen ob heute mind. 1 Workout absolviert wurde.
  const todayKey2 = format(now, "yyyy-MM-dd");

  // Aktuelle Außentemperatur (Wien) für Heat-Compensation in Bereitschaft.
  let outdoorTempC: number | null = null;
  try {
    const wRes = await fetch("http://localhost:3000/api/weather", { cache: "no-store" }).catch(() => null);
    if (wRes && wRes.ok) {
      const w = await wRes.json();
      outdoorTempC = typeof w?.current?.temp === "number" ? w.current.temp : null;
    }
  } catch {
    outdoorTempC = null;
  }

  // Per-day-Scores fuer Heatmap (vereinfacht — nutzt computeDayScore aus altem score.ts)
  const result = [];
  for (let i = 0; i < days; i++) {
    const target = subDays(now, i);
    const dateKey = format(target, "yyyy-MM-dd");
    const tomorrowKey = format(addDays(target, 1), "yyyy-MM-dd");
    const allPlannedToday = plannedByDay.get(dateKey) ?? [];
    const allPlannedTomorrow = plannedByDay.get(tomorrowKey) ?? [];
    const openPlannedToday = filterUnfulfilledPlans(allPlannedToday, typesByDate.get(dateKey) ?? []);
    const openPlannedTomorrow = filterUnfulfilledPlans(allPlannedTomorrow, typesByDate.get(tomorrowKey) ?? []);

    // Fallback fuer Subjektiv-Score: wenn fuer dieses Datum kein Journal-Eintrag existiert,
    // nimm den juengsten Eintrag der letzten 2 Tage davor.
    const dayJournal = journalByDate.get(dateKey) ?? null;
    let previousJournal = null;
    if (!dayJournal) {
      const d1 = format(subDays(target, 1), "yyyy-MM-dd");
      const d2 = format(subDays(target, 2), "yyyy-MM-dd");
      previousJournal = journalByDate.get(d1) ?? journalByDate.get(d2) ?? null;
    }

    const yesterdayKey = format(subDays(target, 1), "yyyy-MM-dd");
    // Load-History für TSB-Modell: täglicher TL der letzten 56 Tage.
    const loadHistory: { date: string; load: number }[] = [];
    for (let j = 0; j < 56; j++) {
      const t = format(subDays(target, j), "yyyy-MM-dd");
      const tl = loadByDate.get(t) ?? 0;
      loadHistory.push({ date: t, load: tl });
    }
    const score = computeDayScore({
      date: dateKey,
      metrics: metricMap,
      journal: dayJournal,
      previousJournal,
      workoutLoadLast7: sumLoad(target, 7),
      workoutLoadLast28: sumLoad(target, 28),
      workoutsToday: countByDate.get(dateKey) ?? 0,
      workoutMinutesToday: minutesByDate.get(dateKey) ?? 0,
      plannedToday: openPlannedToday,
      plannedTomorrow: openPlannedTomorrow,
      restDays: profile?.restDays ?? [],
      weeklyProgress: weekly,
      goals: profile?.goals ?? null,
      yesterdayEndVitality: vitalityByDate.get(yesterdayKey) ?? null,
      loadHistory,
      outdoorTempC: dateKey === todayKey2 ? outdoorTempC : null,
      sleepDeepMin: metricMap["sleep_deep_min"]?.values.find((v) => v.date === dateKey)?.value ?? null,
      sleepRemMin: metricMap["sleep_rem_min"]?.values.find((v) => v.date === dateKey)?.value ?? null,
    });
    // Outcomes-Loop: persistiere die heutige Prediction (nur einmal pro Tag).
    if (dateKey === todayKey2 && !score.waitingForGarmin) {
      try {
        const todayWorkoutsArr = workouts.filter((w) => format(w.date, "yyyy-MM-dd") === todayKey2);
        const avgRpe = todayWorkoutsArr.length > 0
          ? todayWorkoutsArr.reduce((a, w) => a + (w.rpe ?? 0), 0) / todayWorkoutsArr.length
          : null;
        const totalLoad = todayWorkoutsArr.reduce((a, w) => a + (w.trainingLoad ?? 0), 0);
        const totalMin = todayWorkoutsArr.reduce((a, w) => a + Math.round(w.durationSec / 60), 0);
        await prisma.scorePrediction.upsert({
          where: { userId_date: { userId: user.id, date: startOfDay(target) } },
          update: {
            predictedReadiness: score.total,
            predictedLevel: score.suggestion.level,
            actualRpe: avgRpe,
            actualFeeling: dayJournal?.energy ?? null,
            workoutCount: todayWorkoutsArr.length,
            workoutMinutes: totalMin,
            workoutLoad: totalLoad,
            factors: score.components as unknown as object,
          },
          create: {
            userId: user.id,
            date: startOfDay(target),
            predictedReadiness: score.total,
            predictedLevel: score.suggestion.level,
            actualRpe: avgRpe,
            actualFeeling: dayJournal?.energy ?? null,
            workoutCount: todayWorkoutsArr.length,
            workoutMinutes: totalMin,
            workoutLoad: totalLoad,
            factors: score.components as unknown as object,
          },
        });
      } catch (e) {
        console.warn("[score] persist prediction failed:", e);
      }
    }

    result.push({
      date: dateKey,
      ...score,
      workoutsToday: countByDate.get(dateKey) ?? 0,
      workoutMinutesToday: minutesByDate.get(dateKey) ?? 0,
      plannedToday: openPlannedToday,
      plannedTodayAll: allPlannedToday,
      plannedTomorrow: openPlannedTomorrow,
      plannedTomorrowAll: allPlannedTomorrow,
      hasJournal: journalByDate.has(dateKey),
    });
  }

  // Heute-Tag uebernimmt Tomorrow + Suggestion aus Coach-Analyse (anstelle der naiven Variante)
  // Wir patchen das per Cast — die Felder rationale ist neu vs alten Type.
  if (result.length > 0) {
    (result[0] as unknown as { tomorrow: typeof coach.tomorrow }).tomorrow = coach.tomorrow;
  }

  // Today's daily progress (steps, kcal) fuer Home-Widget
  const todayMetrics = metrics.filter((m) => format(m.date, "yyyy-MM-dd") === todayKey);
  const todayMap: Record<string, number> = {};
  for (const m of todayMetrics) todayMap[m.kind] = m.value;
  const daily = {
    steps: todayMap.steps ?? null,
    stepsGoal: profile?.dailyStepsGoal ?? null,
    calories: todayMap.calories ?? null,
    caloriesGoal: profile?.dailyCaloriesGoal ?? null,
    caloriesActive: todayMap.calories_active ?? null,
    caloriesBmr: todayMap.calories_bmr ?? null,
  };

  // KI-Empfehlung (heute) fuer 1-Zeiler im Widget — falls vorhanden.
  const reco = await prisma.coachRecommendation.findUnique({
    where: { userId_date: { userId: user.id, date: startOfDay(now) } },
    select: { morningText: true, trainingPlan: true, adjustedLevel: true, generatedAt: true },
  });
  const aiHint = reco?.morningText
    ? { text: extractFirstSentence(reco.morningText), level: reco.adjustedLevel, at: reco.generatedAt.toISOString() }
    : null;

  // Roh-Werte fuer Heute (fuer CoachHero — kein Back-Computing aus normalisierten Scores).
  // Fallback auf letzten verfuegbaren Wert <= heute (typischerweise gestern), markiert mit isFallback.
  const latestMetric = (kind: string): { value: number | null; date: string | null; isFallback: boolean } => {
    if (todayMap[kind] !== undefined) {
      return { value: todayMap[kind], date: todayKey, isFallback: false };
    }
    const arr = metricsByKind[kind];
    if (!arr || arr.length === 0) return { value: null, date: null, isFallback: false };
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i].date <= todayKey) return { value: arr[i].value, date: arr[i].date, isFallback: true };
    }
    return { value: null, date: null, isFallback: false };
  };
  const sleepMin = latestMetric("sleep_minutes");
  const sleepSc = latestMetric("sleep_score");
  const hrvL = latestMetric("hrv_overnight");
  const rhrL = latestMetric("rhr");
  const todayRaw = {
    sleepMinutes: sleepMin.value,
    sleepMinutesDate: sleepMin.date,
    sleepMinutesFallback: sleepMin.isFallback,
    sleepScore: sleepSc.value,
    hrvMs: hrvL.value,
    hrvDate: hrvL.date,
    hrvFallback: hrvL.isFallback,
    rhrBpm: rhrL.value,
    rhrDate: rhrL.date,
    rhrFallback: rhrL.isFallback,
  };

  return NextResponse.json({ days: result, weekly, profile, coach, daily, aiHint, todayRaw });
}

function extractFirstSentence(text: string): string {
  // Markdown entschaerfen, damit im Widget kein rohes ###/** landet.
  const stripped = text
    .replace(/`+/g, "")
    .replace(/\*+/g, "")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^>\s*/gm, "")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  let cleaned = stripped.replace(/\s+/g, " ").trim();
  // Fuehrendes Label wie "Day-Score Kontext - " / "Status: " entfernen — sagt nichts aus.
  cleaned = cleaned.replace(/^[A-Za-zÄÖÜäöüß0-9 /-]{3,30}?(?: [-–—] |: )/, "").trim();
  // Erste 1-2 Saetze, damit der Hinweis ein vollstaendiger Gedanke ist.
  const sentences = cleaned.match(/[^.!?]+[.!?]+/g)?.map((s) => s.trim()) ?? [cleaned];
  let out = sentences[0] ?? cleaned;
  if (out.length < 35 && sentences[1]) out += " " + sentences[1];
  return out.length > 180 ? out.slice(0, 177) + "..." : out;
}
