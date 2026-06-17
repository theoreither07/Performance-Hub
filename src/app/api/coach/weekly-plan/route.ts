import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getCurrentUser } from "@/lib/api/get-user";
import { toDbDateNoon } from "@/lib/utils/vienna-tz";
import { subDays, addDays, startOfDay, startOfWeek, endOfWeek, format } from "date-fns";
import { analyzeCoach, type CoachContext } from "@/lib/health/coach-analysis";
import { getPlannedTrainings, groupByDay, filterUnfulfilledPlans } from "@/lib/health/planned-trainings";
import { completeWithFallback } from "@/lib/ai/client";
import { buildWeeklyPlanSystemPrompt, buildWeeklyPlanUserPrompt, parseWeeklyPlanResponse, type WeeklyPlanCtx } from "@/lib/ai/weekly-plan-prompt";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

/**
 * POST /api/coach/weekly-plan — generiert Plan fuer KOMMENDE Woche.
 * GET — gibt den neuesten Plan fuer kommende Woche zurueck (oder fuer aktuelle Woche wenn keiner da).
 */
export async function POST() {
  const user = await getCurrentUser();
  const result = await generateWeeklyPlanForUser(user.id);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 502 });
  return NextResponse.json(result);
}

export async function GET() {
  const user = await getCurrentUser();
  const now = new Date();
  // Suche zuerst den Plan fuer die kommende Woche (Mo naechste Woche)
  const nextMonday = startOfWeek(addDays(now, 7), { weekStartsOn: 1 });
  const thisMonday = startOfWeek(now, { weekStartsOn: 1 });
  const planNext = await prisma.weeklyPlan.findUnique({
    where: { userId_weekStart: { userId: user.id, weekStart: toDbDateNoon(nextMonday) } },
  });
  const planThis = !planNext
    ? await prisma.weeklyPlan.findUnique({
        where: { userId_weekStart: { userId: user.id, weekStart: toDbDateNoon(thisMonday) } },
      })
    : null;
  const plan = planNext ?? planThis;
  if (!plan) return NextResponse.json({ plan: null });
  return NextResponse.json({
    plan: {
      id: plan.id,
      weekStart: format(plan.weekStart, "yyyy-MM-dd"),
      generatedAt: plan.generatedAt.toISOString(),
      provider: plan.provider,
      model: plan.model,
      weekOverview: plan.weekOverview,
      schedule: plan.schedule,
      watchouts: plan.watchouts,
      errorMessage: plan.errorMessage,
      isForCurrentWeek: !planNext,
    },
  });
}

export async function generateWeeklyPlanForUser(userId: string) {
  const now = new Date();
  const thisMonday = startOfWeek(now, { weekStartsOn: 1 });
  const thisSunday = endOfWeek(now, { weekStartsOn: 1 });
  const nextMonday = startOfWeek(addDays(now, 7), { weekStartsOn: 1 });
  const nextSunday = endOfWeek(addDays(now, 7), { weekStartsOn: 1 });

  const since = startOfDay(subDays(now, 60));
  const [metrics, journal, workouts, profile, plannedRange, keyLifts] = await Promise.all([
    prisma.healthMetric.findMany({ where: { date: { gte: since } }, orderBy: [{ kind: "asc" }, { date: "asc" }] }),
    prisma.dailyJournal.findMany({ where: { userId, date: { gte: since } }, orderBy: { date: "asc" } }),
    prisma.workoutSession.findMany({ where: { date: { gte: since } }, orderBy: { startTime: "asc" } }),
    prisma.trainingProfile.findUnique({ where: { userId } }),
    getPlannedTrainings(thisMonday, addDays(nextSunday, 1)),
    prisma.keyLift.findMany({ where: { userId, archived: false }, orderBy: { sortOrder: "asc" } }),
  ]);

  const metricsByKind: Record<string, { date: string; value: number }[]> = {};
  for (const m of metrics) {
    const k = format(m.date, "yyyy-MM-dd");
    metricsByKind[m.kind] = metricsByKind[m.kind] ?? [];
    metricsByKind[m.kind].push({ date: k, value: m.value });
  }
  const plannedByDay = groupByDay(plannedRange);
  const typesByDate = new Map<string, { type: string }[]>();
  for (const w of workouts) {
    const k = format(w.date, "yyyy-MM-dd");
    const arr = typesByDate.get(k) ?? [];
    arr.push({ type: w.type });
    typesByDate.set(k, arr);
  }

  const todayKey = format(now, "yyyy-MM-dd");
  const todayWorkouts = workouts.filter((w) => format(w.date, "yyyy-MM-dd") === todayKey);
  const workoutsToday = todayWorkouts.length;
  const minutesToday = todayWorkouts.reduce((s, w) => s + Math.round(w.durationSec / 60), 0);

  const coachCtx: CoachContext = {
    today: todayKey,
    metrics: metricsByKind,
    workouts: workouts.map((w) => ({
      date: format(w.date, "yyyy-MM-dd"),
      type: w.type, durationSec: w.durationSec, distanceM: w.distanceM,
      avgHr: w.avgHr, maxHr: w.maxHr, trainingLoad: w.trainingLoad, rpe: w.rpe, feeling: w.feeling,
    })),
    journal: journal.map((j) => ({
      date: format(j.date, "yyyy-MM-dd"),
      mood: j.mood, energy: j.energy, motivation: j.motivation, soreness: j.soreness,
      sleepQuality: j.sleepQuality, workoutFelt: j.workoutFelt, ateWell: j.ateWell, alcoholDrinks: j.alcoholDrinks,
    })),
    plannedToday: filterUnfulfilledPlans(plannedByDay.get(todayKey) ?? [], typesByDate.get(todayKey) ?? []),
    plannedTomorrow: filterUnfulfilledPlans(
      plannedByDay.get(format(addDays(now, 1), "yyyy-MM-dd")) ?? [],
      typesByDate.get(format(addDays(now, 1), "yyyy-MM-dd")) ?? [],
    ),
    profile: profile ? {
      strengthPerWeek: profile.strengthPerWeek, runsPerWeek: profile.runsPerWeek,
      longRunKm: profile.longRunKm, shortRunKm: profile.shortRunKm,
      restDays: profile.restDays, goals: profile.goals, maxHr: profile.maxHr,
    } : null,
  };
  const analysis = analyzeCoach(coachCtx, workoutsToday, minutesToday);

  // Diese Woche absolviert
  const thisMondayKey = format(thisMonday, "yyyy-MM-dd");
  const thisWeekWorkouts = workouts.filter((w) => format(w.date, "yyyy-MM-dd") >= thisMondayKey);
  const longRunTarget = (profile?.longRunKm ?? 18) * 0.85 * 1000;
  const thisWeekTotals = {
    strengthSessions: thisWeekWorkouts.filter((w) => w.type === "strength").length,
    runSessions: thisWeekWorkouts.filter((w) => w.type === "running").length,
    longRunDone: thisWeekWorkouts.some((w) => w.type === "running" && (w.distanceM ?? 0) >= longRunTarget),
    totalMinutes: thisWeekWorkouts.reduce((s, w) => s + Math.round(w.durationSec / 60), 0),
    totalLoad: thisWeekWorkouts.reduce((s, w) => s + (w.trainingLoad ?? 0), 0),
  };

  // Last 7 Workouts + Journal
  const sevenDaysAgo = format(subDays(now, 6), "yyyy-MM-dd");
  const last7Workouts = workouts
    .filter((w) => format(w.date, "yyyy-MM-dd") >= sevenDaysAgo)
    .map((w) => ({
      date: format(w.date, "yyyy-MM-dd"), type: w.type,
      durationMin: Math.round(w.durationSec / 60),
      distanceKm: w.distanceM ? +(w.distanceM / 1000).toFixed(2) : null,
      avgHr: w.avgHr, trainingLoad: w.trainingLoad,
      rpe: w.rpe, feeling: w.feeling,
    }));
  const last7Journal = journal
    .filter((j) => format(j.date, "yyyy-MM-dd") >= sevenDaysAgo)
    .map((j) => ({
      date: format(j.date, "yyyy-MM-dd"),
      mood: j.mood, energy: j.energy, motivation: j.motivation,
      soreness: j.soreness, sleepQuality: j.sleepQuality, workoutFelt: j.workoutFelt,
    }));

  // Kalender naechste Woche
  const dowDe = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
  const nextWeekCalendarPlan: WeeklyPlanCtx["nextWeekCalendarPlan"] = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(nextMonday, i);
    const key = format(d, "yyyy-MM-dd");
    const items = plannedByDay.get(key) ?? [];
    nextWeekCalendarPlan.push({
      date: key,
      dow: dowDe[i],
      items: items.map((p) => ({ type: p.type, name: p.name, distanceKm: p.distanceKm })),
    });
  }

  const promptCtx: WeeklyPlanCtx = {
    thisWeekEnd: format(thisSunday, "yyyy-MM-dd"),
    nextWeekStart: format(nextMonday, "yyyy-MM-dd"),
    nextWeekEnd: format(nextSunday, "yyyy-MM-dd"),
    profile: profile ? {
      strengthPerWeek: profile.strengthPerWeek, runsPerWeek: profile.runsPerWeek,
      longRunKm: profile.longRunKm, shortRunKm: profile.shortRunKm,
      goals: profile.goals, restDays: profile.restDays, maxHr: profile.maxHr,
      weeklySlotPrefs: profile.weeklySlotPrefs as Record<string, unknown> | null,
      weeklyTemplateMarkdown: profile.weeklyTemplateMarkdown,
    } : null,
    keyLifts: keyLifts.map((k) => ({ name: k.name, unit: k.unit, current: k.current, currentReps: k.currentReps, notes: k.notes })),
    analysis,
    last7Workouts,
    last7Journal,
    nextWeekCalendarPlan,
    thisWeekTotals,
  };

  let result;
  try {
    result = await completeWithFallback(
      [
        { role: "system", content: buildWeeklyPlanSystemPrompt() },
        { role: "user", content: buildWeeklyPlanUserPrompt(promptCtx) },
      ],
      3500,
    );
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await prisma.weeklyPlan.upsert({
      where: { userId_weekStart: { userId, weekStart: toDbDateNoon(nextMonday) } },
      update: { provider: "error", model: "n/a", errorMessage: errMsg, generatedAt: new Date() },
      create: { userId, weekStart: toDbDateNoon(nextMonday), provider: "error", model: "n/a", errorMessage: errMsg },
    });
    return { error: errMsg };
  }

  const parsed = parseWeeklyPlanResponse(result.text);
  const plan = await prisma.weeklyPlan.upsert({
    where: { userId_weekStart: { userId, weekStart: toDbDateNoon(nextMonday) } },
    update: {
      provider: result.provider, model: result.model,
      weekOverview: parsed.weekOverview, schedule: parsed.schedule, watchouts: parsed.watchouts,
      rawResponse: result.text, generatedAt: new Date(), errorMessage: null,
    },
    create: {
      userId, weekStart: toDbDateNoon(nextMonday),
      provider: result.provider, model: result.model,
      weekOverview: parsed.weekOverview, schedule: parsed.schedule, watchouts: parsed.watchouts,
      rawResponse: result.text,
    },
  });

  return {
    id: plan.id,
    weekStart: format(plan.weekStart, "yyyy-MM-dd"),
    generatedAt: plan.generatedAt.toISOString(),
    provider: plan.provider, model: plan.model,
    weekOverview: plan.weekOverview, schedule: plan.schedule, watchouts: plan.watchouts,
  };
}
