/**
 * Cron-Endpoint: wird vom coach-cron Container taeglich um ~07:00 angesprochen.
 * Geschuetzt ueber COACH_CRON_TOKEN (X-Cron-Token Header) — keine User-Session noetig.
 * Generiert die Empfehlung fuer den Primary-User (der User).
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { subDays, addDays, startOfDay, startOfWeek, format } from "date-fns";
import { viennaHhMm } from "@/lib/utils/vienna-tz";
import { analyzeCoach, type CoachContext } from "@/lib/health/coach-analysis";
import { getPlannedTrainings, groupByDay, filterUnfulfilledPlans } from "@/lib/health/planned-trainings";
import { completeWithFallback } from "@/lib/ai/client";
import { buildSystemPrompt, buildUserPrompt, parseAiResponse, detectPhase, type PromptCtx, type WeekPlanDayDigest } from "@/lib/ai/coach-prompt";
import { pickLeadGoal, computePeriodization } from "@/lib/coach/periodization";
import { getHealthContext } from "@/lib/health/metrics-cache";

function pickCurrentValueForGoal(
  type: string,
  metricsByKind: Record<string, { date: string; value: number }[]>,
  todayKey: string,
): number | null {
  const latest = (kind: string): number | null => {
    const arr = metricsByKind[kind];
    if (!arr || arr.length === 0) return null;
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i].date <= todayKey) return arr[i].value;
    }
    return null;
  };
  if (type === "vo2max") return latest("vo2max");
  if (type === "weight") return latest("weight");
  return null;
}

function findWeekPlanDay(rawSlots: unknown, dateKey: string): WeekPlanDayDigest | null {
  if (!rawSlots || typeof rawSlots !== "object") return null;
  const days = (rawSlots as { days?: WeekPlanDayDigest[] }).days;
  if (!Array.isArray(days)) return null;
  return days.find((d) => d.date === dateKey) ?? null;
}

export const dynamic = "force-dynamic";
export const maxDuration = 180;

const PRIMARY_EMAIL = process.env.PRIMARY_EMAIL ?? "";

export async function POST(req: Request) {
  const expected = process.env.COACH_CRON_TOKEN;
  const provided = req.headers.get("x-cron-token");
  if (!expected || expected.length < 16) {
    return NextResponse.json({ error: "COACH_CRON_TOKEN not configured" }, { status: 503 });
  }
  if (provided !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({ where: { email: PRIMARY_EMAIL } });
  if (!user) return NextResponse.json({ error: "primary user not found" }, { status: 404 });

  const now = new Date();
  const todayKey = format(now, "yyyy-MM-dd");
  const since = startOfDay(subDays(now, 60));
  const thisMonday = startOfDay(startOfWeek(now, { weekStartsOn: 1 }));
  const nextMonday = startOfDay(startOfWeek(addDays(now, 7), { weekStartsOn: 1 }));

  const ctx = await getHealthContext(user.id);
  const { metrics, journal, workouts, profile, keyLifts, memories } = ctx;
  const [plannedRange, recentPlans, longTermGoals] = await Promise.all([
    getPlannedTrainings(startOfDay(subDays(now, 1)), startOfDay(addDays(now, 4))),
    prisma.weeklyPlan.findMany({
      where: { userId: user.id, weekStart: { gte: startOfDay(subDays(now, 14)) } },
      orderBy: { weekStart: "desc" },
    }),
    prisma.longTermGoal.findMany({ where: { userId: user.id, active: true }, orderBy: { targetDate: "asc" } }),
  ]);

  const tomorrowKey = format(addDays(now, 1), "yyyy-MM-dd");
  const findDayInAny = (key: string) => {
    for (const p of recentPlans) {
      const d = findWeekPlanDay(p.proposedSlots, key);
      if (d) return d;
    }
    return null;
  };
  const weekPlanToday = findDayInAny(todayKey);
  const weekPlanTomorrow = findDayInAny(tomorrowKey);
  const planContainingHorizon = recentPlans.find((p) =>
    findWeekPlanDay(p.proposedSlots, todayKey) ?? findWeekPlanDay(p.proposedSlots, tomorrowKey),
  );
  const weekPlanFocus = planContainingHorizon?.weekOverview ?? null;

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

  const todayWorkouts = workouts.filter((w) => format(w.date, "yyyy-MM-dd") === todayKey);
  const workoutsToday = todayWorkouts.length;
  const minutesToday = todayWorkouts.reduce((s, w) => s + Math.round(w.durationSec / 60), 0);
  const todayMetrics = metrics.filter((m) => format(m.date, "yyyy-MM-dd") === todayKey);
  const todayMetricMap: Record<string, number> = {};
  for (const m of todayMetrics) todayMetricMap[m.kind] = m.value;

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

  const dowDe = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
  const plannedNextDays = [1, 2, 3].map((offset) => {
    const d = addDays(now, offset);
    const key = format(d, "yyyy-MM-dd");
    const items = plannedByDay.get(key) ?? [];
    return {
      date: key,
      dow: dowDe[((d.getDay() + 6) % 7)],
      items: items.map((p) => ({ type: p.type, name: p.name, distanceKm: p.distanceKm })),
    };
  });

  const phase = detectPhase(now, workoutsToday);
  const sevenDaysAgo = format(subDays(now, 6), "yyyy-MM-dd");
  const promptCtx: PromptCtx = {
    today: todayKey,
    nowIsoLocal: now.toISOString(),
    phase,
    profile: profile ? {
      strengthPerWeek: profile.strengthPerWeek, runsPerWeek: profile.runsPerWeek,
      longRunKm: profile.longRunKm, shortRunKm: profile.shortRunKm,
      goals: profile.goals, restDays: profile.restDays, maxHr: profile.maxHr,
      dailyCaloriesGoal: profile.dailyCaloriesGoal, dailyStepsGoal: profile.dailyStepsGoal,
      weeklySlotPrefs: profile.weeklySlotPrefs as Record<string, unknown> | null,
      weeklyTemplateMarkdown: profile.weeklyTemplateMarkdown,
    } : null,
    keyLifts: keyLifts.map((k) => ({ name: k.name, unit: k.unit, current: k.current, currentReps: k.currentReps, bestEver: k.bestEver, notes: k.notes })),
    analysis,
    workoutsToday,
    minutesToday,
    todayWorkouts: todayWorkouts.map((w) => ({
      startTime: viennaHhMm(w.startTime),
      type: w.type, name: w.name, durationMin: Math.round(w.durationSec / 60),
      distanceKm: w.distanceM ? +(w.distanceM / 1000).toFixed(2) : null,
      avgHr: w.avgHr, maxHr: w.maxHr, trainingLoad: w.trainingLoad,
      rpe: w.rpe, feeling: w.feeling, notes: w.notes,
    })),
    todayMetrics: {
      steps: todayMetricMap.steps ?? null,
      stepsGoal: profile?.dailyStepsGoal ?? null,
      calories: todayMetricMap.calories ?? null,
      caloriesGoal: profile?.dailyCaloriesGoal ?? null,
      caloriesActive: todayMetricMap.calories_active ?? null,
    },
    recentWorkouts: workouts.slice(-10).map((w) => ({
      date: format(w.date, "yyyy-MM-dd"),
      startTime: viennaHhMm(w.startTime),
      type: w.type, name: w.name,
      durationMin: Math.round(w.durationSec / 60),
      distanceKm: w.distanceM ? +(w.distanceM / 1000).toFixed(2) : null,
      avgHr: w.avgHr, maxHr: w.maxHr, trainingLoad: w.trainingLoad,
      rpe: w.rpe, feeling: w.feeling, notes: w.notes,
    })),
    recentJournal: journal
      .filter((j) => format(j.date, "yyyy-MM-dd") >= sevenDaysAgo)
      .map((j) => ({
        date: format(j.date, "yyyy-MM-dd"),
        filledAt: j.updatedAt ? format(j.updatedAt, "HH:mm") : null,
        mood: j.mood, energy: j.energy, motivation: j.motivation, soreness: j.soreness,
        sleepQuality: j.sleepQuality, workoutFelt: j.workoutFelt, ateWell: j.ateWell, alcoholDrinks: j.alcoholDrinks,
        notes: j.notes,
      })),
    plannedToday: coachCtx.plannedToday,
    plannedNextDays,
    memories: memories.map((m) => ({ key: m.key, content: m.content })),
    weekPlanToday,
    weekPlanTomorrow,
    weekPlanFocus,
    longTermGoals: longTermGoals.map((g) => ({
      type: g.type,
      name: g.name,
      targetValue: g.targetValue,
      targetUnit: g.targetUnit,
      targetDate: format(g.targetDate, "yyyy-MM-dd"),
      weeksUntilTarget: Math.round((g.targetDate.getTime() - now.getTime()) / (7 * 24 * 60 * 60 * 1000)),
      startValue: g.startValue,
      currentValue: pickCurrentValueForGoal(g.type, metricsByKind, todayKey),
    })),
    periodization: (() => {
      const leadGoal = pickLeadGoal(longTermGoals.map((g) => ({
        type: g.type,
        name: g.name,
        targetValue: g.targetValue,
        targetUnit: g.targetUnit,
        targetDate: g.targetDate,
        startValue: g.startValue,
      })));
      const state = computePeriodization(now, leadGoal);
      if (!state) return null;
      return {
        phase: state.phase,
        shortLabel: state.shortLabel,
        longLabel: state.longLabel,
        focusKeywords: state.focusKeywords,
        weeksUntilTarget: state.weeksUntilTarget,
      };
    })(),
  };

  let result;
  try {
    result = await completeWithFallback(
      [
        { role: "system", content: buildSystemPrompt(phase) },
        { role: "user", content: buildUserPrompt(promptCtx) },
      ],
      3500,
    );
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await prisma.coachRecommendation.upsert({
      where: { userId_date: { userId: user.id, date: startOfDay(now) } },
      update: { provider: "error", model: "n/a", errorMessage: errMsg, generatedAt: now, phase },
      create: { userId: user.id, date: startOfDay(now), provider: "error", model: "n/a", errorMessage: errMsg, phase },
    });
    return NextResponse.json({ error: errMsg }, { status: 502 });
  }

  const parsed = parseAiResponse(result.text);
  await prisma.coachRecommendation.upsert({
    where: { userId_date: { userId: user.id, date: startOfDay(now) } },
    update: {
      provider: result.provider, model: result.model,
      statusFocus: parsed.statusFocus,
      actionsNow: parsed.actionsNow,
      eveningPrep: parsed.eveningPrep,
      tomorrowSetup: parsed.tomorrowSetup,
      morningText: parsed.morningText, trainingPlan: parsed.trainingPlan, watchOuts: parsed.watchOuts,
      adjustedScore: parsed.adjustedScore, adjustedLevel: parsed.adjustedLevel,
      strengthIntensity: parsed.strengthIntensity,
      cardioIntensity: parsed.cardioIntensity,
      intensityReason: parsed.intensityReason,
      phase,
      rawContext: { workoutsToday, minutesToday, status: analysis.status, weekStrategy: analysis.weekStrategy.type, phase } as never,
      rawResponse: result.text, generatedAt: now, errorMessage: null,
    },
    create: {
      userId: user.id, date: startOfDay(now),
      provider: result.provider, model: result.model,
      statusFocus: parsed.statusFocus,
      actionsNow: parsed.actionsNow,
      eveningPrep: parsed.eveningPrep,
      tomorrowSetup: parsed.tomorrowSetup,
      morningText: parsed.morningText, trainingPlan: parsed.trainingPlan, watchOuts: parsed.watchOuts,
      adjustedScore: parsed.adjustedScore, adjustedLevel: parsed.adjustedLevel,
      strengthIntensity: parsed.strengthIntensity,
      cardioIntensity: parsed.cardioIntensity,
      intensityReason: parsed.intensityReason,
      phase,
      rawContext: { workoutsToday, minutesToday, status: analysis.status, weekStrategy: analysis.weekStrategy.type, phase } as never,
      rawResponse: result.text,
    },
  });

  return NextResponse.json({ ok: true, provider: result.provider, model: result.model, phase });
}
