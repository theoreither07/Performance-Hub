import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { checkMcpAuth } from "@/lib/api/mcp-auth";
import { subDays, addDays, startOfDay, startOfWeek, format } from "date-fns";
import { computeDayScore, type MetricMap } from "@/lib/health/score";
import { naiveViennaToUtc } from "@/lib/utils/vienna-tz";
import { getPlannedTrainings, groupByDay, computeWeeklyProgress, filterUnfulfilledPlans } from "@/lib/health/planned-trainings";
import { analyzeCoach, type CoachContext } from "@/lib/health/coach-analysis";

export const dynamic = "force-dynamic";

const PRIMARY_EMAIL = process.env.PRIMARY_EMAIL ?? "";

/**
 * GET /api/mcp/training-status?days=7
 * Kompletter Trainer-Snapshot fuer den KI-Coach in Claude Desktop.
 * Liefert pro Tag: Score, Recovery, ACWR, Empfehlung.
 * Plus: Workouts der letzten 14 Tage, Journal-Highlights.
 */
export async function GET(req: Request) {
  const denied = checkMcpAuth(req);
  if (denied) return denied;
  const { searchParams } = new URL(req.url);
  const days = Math.min(14, Math.max(1, Number(searchParams.get("days") ?? "7")));
  const now = new Date();

  const user = await prisma.user.findUnique({ where: { email: PRIMARY_EMAIL } });
  if (!user) return NextResponse.json({ error: "user not found" }, { status: 404 });

  const since = startOfDay(subDays(now, days + 28));
  const journalSince = startOfDay(subDays(now, days));
  const workoutsSince = startOfDay(subDays(now, 14));

  const monday = startOfWeek(now, { weekStartsOn: 1 });
  const [metrics, journal, workouts, allLoads, profile, plannedRange] = await Promise.all([
    prisma.healthMetric.findMany({
      where: { date: { gte: since } },
      orderBy: [{ kind: "asc" }, { date: "asc" }],
    }),
    prisma.dailyJournal.findMany({
      where: { userId: user.id, date: { gte: journalSince } },
      orderBy: { date: "desc" },
    }),
    prisma.workoutSession.findMany({
      where: { date: { gte: workoutsSince } },
      orderBy: { startTime: "desc" },
    }),
    prisma.workoutSession.findMany({
      where: { date: { gte: since } },
      select: { date: true, trainingLoad: true, durationSec: true, type: true, distanceM: true },
    }),
    prisma.trainingProfile.findUnique({ where: { userId: user.id } }),
    getPlannedTrainings(startOfDay(subDays(now, days - 1)), startOfDay(addDays(now, 2))),
  ]);

  // Pivot
  const metricMap: MetricMap = {};
  for (const m of metrics) {
    const k = m.kind;
    metricMap[k] = metricMap[k] ?? { values: [] };
    metricMap[k].values.push({ date: format(m.date, "yyyy-MM-dd"), value: m.value });
  }
  const journalByDate = new Map(journal.map((j) => [format(j.date, "yyyy-MM-dd"), j]));
  const plannedByDay = groupByDay(plannedRange);
  const loadByDate = new Map<string, number>();
  const countByDate = new Map<string, number>();
  const minutesByDate = new Map<string, number>();
  const typesByDate = new Map<string, { type: string }[]>();
  for (const w of allLoads) {
    const key = format(w.date, "yyyy-MM-dd");
    loadByDate.set(key, (loadByDate.get(key) ?? 0) + (w.trainingLoad ?? 0));
    countByDate.set(key, (countByDate.get(key) ?? 0) + 1);
    minutesByDate.set(key, (minutesByDate.get(key) ?? 0) + Math.round(w.durationSec / 60));
    const arr = typesByDate.get(key) ?? [];
    arr.push({ type: w.type });
    typesByDate.set(key, arr);
  }
  function sumLoad(endDate: Date, daysBack: number): number {
    let sum = 0;
    for (let i = 0; i < daysBack; i++) {
      sum += loadByDate.get(format(subDays(endDate, i), "yyyy-MM-dd")) ?? 0;
    }
    return sum;
  }

  const weekly = computeWeeklyProgress(
    allLoads.map((w) => ({ date: format(w.date, "yyyy-MM-dd"), type: w.type, distanceM: w.distanceM })),
    monday,
    profile,
  );

  const scores = [];
  for (let i = 0; i < days; i++) {
    const target = subDays(now, i);
    const key = format(target, "yyyy-MM-dd");
    const tomorrowKey = format(addDays(target, 1), "yyyy-MM-dd");
    const allPlannedToday = plannedByDay.get(key) ?? [];
    const allPlannedTomorrow = plannedByDay.get(tomorrowKey) ?? [];
    const openPlannedToday = filterUnfulfilledPlans(allPlannedToday, typesByDate.get(key) ?? []);
    const openPlannedTomorrow = filterUnfulfilledPlans(allPlannedTomorrow, typesByDate.get(tomorrowKey) ?? []);
    // Subjective fallback: wenn fuer dieses Datum kein Journal vorliegt → juengster der letzten 2 Tage
    const dayJournal = journalByDate.get(key) ?? null;
    let previousJournal = null;
    if (!dayJournal) {
      const d1 = format(subDays(target, 1), "yyyy-MM-dd");
      const d2 = format(subDays(target, 2), "yyyy-MM-dd");
      previousJournal = journalByDate.get(d1) ?? journalByDate.get(d2) ?? null;
    }
    const score = computeDayScore({
      date: key,
      metrics: metricMap,
      journal: dayJournal,
      previousJournal,
      workoutLoadLast7: sumLoad(target, 7),
      workoutLoadLast28: sumLoad(target, 28),
      workoutsToday: countByDate.get(key) ?? 0,
      workoutMinutesToday: minutesByDate.get(key) ?? 0,
      plannedToday: openPlannedToday,
      plannedTomorrow: openPlannedTomorrow,
      restDays: profile?.restDays ?? [],
      weeklyProgress: weekly,
      goals: profile?.goals ?? null,
    });
    scores.push({
      date: key,
      ...score,
      workoutsToday: countByDate.get(key) ?? 0,
      workoutMinutesToday: minutesByDate.get(key) ?? 0,
      plannedToday: openPlannedToday,
      plannedTodayAll: allPlannedToday,
      plannedTomorrow: openPlannedTomorrow,
      plannedTomorrowAll: allPlannedTomorrow,
      hasJournal: journalByDate.has(key),
    });
  }

  // Coach-Analyse fuer heute
  const todayKey2 = format(now, "yyyy-MM-dd");
  const metricsByKindForCoach: Record<string, { date: string; value: number }[]> = {};
  for (const m of metrics) {
    const dKey = format(m.date, "yyyy-MM-dd");
    metricsByKindForCoach[m.kind] = metricsByKindForCoach[m.kind] ?? [];
    metricsByKindForCoach[m.kind].push({ date: dKey, value: m.value });
  }
  const coachCtx: CoachContext = {
    today: todayKey2,
    metrics: metricsByKindForCoach,
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
    plannedToday: filterUnfulfilledPlans(plannedByDay.get(todayKey2) ?? [], typesByDate.get(todayKey2) ?? []),
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
  const coach = analyzeCoach(coachCtx, countByDate.get(todayKey2) ?? 0, minutesByDate.get(todayKey2) ?? 0);

  return NextResponse.json({
    today: scores[0],
    days: scores,
    weekly,
    profile,
    coach,
    workouts: workouts.map((w) => ({
      id: w.id,
      date: format(w.date, "yyyy-MM-dd"),
      startTime: naiveViennaToUtc(w.startTime).toISOString(),
      type: w.type,
      name: w.name,
      durationSec: w.durationSec,
      distanceM: w.distanceM,
      calories: w.calories,
      avgHr: w.avgHr,
      maxHr: w.maxHr,
      trainingLoad: w.trainingLoad,
      aerobicEffect: w.aerobicEffect,
      anaerobicEffect: w.anaerobicEffect,
      source: w.source,
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
      notes: j.notes,
    })),
  });
}
