import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getCurrentUser } from "@/lib/api/get-user";
import { subDays, addDays, startOfDay, startOfWeek, format } from "date-fns";
import { viennaHhMm } from "@/lib/utils/vienna-tz";
import { analyzeCoach, type CoachContext } from "@/lib/health/coach-analysis";
import { getPlannedTrainings, groupByDay, filterUnfulfilledPlans } from "@/lib/health/planned-trainings";
import { completeWithFallback, type AiMessage } from "@/lib/ai/client";
import { buildChatContext, type ChatContextInput, type ChatWeekPlanDay } from "@/lib/ai/chat-context";
import { buildChatSystemPrompt, parseChatResponse, type ChatAction } from "@/lib/ai/chat-prompt";
import { refineWeekPlanForUser } from "@/lib/coach/week-plan-refine";

function findWeekPlanDay(rawSlots: unknown, dateKey: string): ChatWeekPlanDay | null {
  if (!rawSlots || typeof rawSlots !== "object") return null;
  const days = (rawSlots as { days?: ChatWeekPlanDay[] }).days;
  if (!Array.isArray(days)) return null;
  return days.find((d) => d.date === dateKey) ?? null;
}

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const HISTORY_LIMIT = 24; // letzte N Nachrichten als Konversations-Kontext

/** GET — Chat-Verlauf */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  const url = new URL(req.url);
  const topicParam = url.searchParams.get("topic"); // null = general thread, "week-plan" etc.
  const topicFilter = topicParam === null ? null : topicParam;
  const messages = await prisma.coachChatMessage.findMany({
    where: { userId: user.id, topic: topicFilter },
    orderBy: { createdAt: "asc" },
    take: 200,
  });
  return NextResponse.json({
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      actions: m.actions,
      topic: m.topic,
      createdAt: m.createdAt.toISOString(),
    })),
  });
}

const postSchema = z.object({
  message: z.string().min(1).max(4000),
  topic: z.string().max(40).optional(),
});

/** POST — neue User-Nachricht, Coach antwortet + fuehrt ggf. Actions aus */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  const { message, topic } = postSchema.parse(await req.json());
  const topicValue = topic ?? null;
  const now = new Date();
  const todayKey = format(now, "yyyy-MM-dd");

  // User-Nachricht speichern
  await prisma.coachChatMessage.create({
    data: { userId: user.id, role: "user", content: message, topic: topicValue },
  });

  // Kontext laden (14d Daten + Analyse + Memos + heutige Empfehlung + Wochenplan)
  const since = startOfDay(subDays(now, 60));
  const [metrics, journal, workouts, profile, plannedRange, keyLifts, memories, todayReco, history, recentPlans] = await Promise.all([
    prisma.healthMetric.findMany({ where: { date: { gte: since } }, orderBy: [{ kind: "asc" }, { date: "asc" }] }),
    prisma.dailyJournal.findMany({ where: { userId: user.id, date: { gte: since } }, orderBy: { date: "asc" } }),
    prisma.workoutSession.findMany({ where: { date: { gte: since } }, orderBy: { startTime: "asc" } }),
    prisma.trainingProfile.findUnique({ where: { userId: user.id } }),
    getPlannedTrainings(startOfDay(subDays(now, 1)), startOfDay(subDays(now, -2))),
    prisma.keyLift.findMany({ where: { userId: user.id, archived: false }, orderBy: { sortOrder: "asc" } }),
    prisma.coachMemory.findMany({ where: { userId: user.id } }),
    prisma.coachRecommendation.findUnique({ where: { userId_date: { userId: user.id, date: startOfDay(now) } } }),
    prisma.coachChatMessage.findMany({ where: { userId: user.id, topic: topicValue }, orderBy: { createdAt: "desc" }, take: HISTORY_LIMIT }),
    // TZ-tolerant: alle Plaene laden, danach per Datum scannen
    prisma.weeklyPlan.findMany({
      where: { userId: user.id, weekStart: { gte: startOfDay(subDays(now, 14)) } },
      orderBy: { weekStart: "desc" },
    }),
  ]);

  // Wochenplan-Auszug — scanne alle Plaene nach Datum
  const todayKey2 = format(now, "yyyy-MM-dd");
  const tomorrowKey = format(addDays(now, 1), "yyyy-MM-dd");
  const upcomingKeys = [2, 3, 4].map((d) => format(addDays(now, d), "yyyy-MM-dd"));
  const findDayInAny = (key: string): ChatWeekPlanDay | null => {
    for (const p of recentPlans) {
      const d = findWeekPlanDay(p.proposedSlots, key);
      if (d) return d;
    }
    return null;
  };
  const planToday = findDayInAny(todayKey2);
  const planTomorrow = findDayInAny(tomorrowKey);
  const planUpcoming = upcomingKeys.map(findDayInAny).filter((d): d is ChatWeekPlanDay => d !== null);
  const planContainingHorizon = recentPlans.find((p) =>
    findWeekPlanDay(p.proposedSlots, todayKey2) ?? findWeekPlanDay(p.proposedSlots, tomorrowKey),
  );
  const weekPlanForChat = (planToday || planTomorrow || planUpcoming.length > 0 || planContainingHorizon)
    ? {
        focus: planContainingHorizon?.weekOverview ?? null,
        today: planToday,
        tomorrow: planTomorrow,
        upcoming: planUpcoming,
      }
    : null;

  // metricsByKind + byDate
  const metricsByKind: Record<string, { date: string; value: number }[]> = {};
  const metricsByDate: Record<string, Record<string, number>> = {};
  for (const m of metrics) {
    const k = format(m.date, "yyyy-MM-dd");
    metricsByKind[m.kind] = metricsByKind[m.kind] ?? [];
    metricsByKind[m.kind].push({ date: k, value: m.value });
    metricsByDate[k] = metricsByDate[k] ?? {};
    metricsByDate[k][m.kind] = m.value;
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
  const minutesToday = todayWorkouts.reduce((sum, w) => sum + Math.round(w.durationSec / 60), 0);

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
    plannedTomorrow: [],
    profile: profile ? {
      strengthPerWeek: profile.strengthPerWeek, runsPerWeek: profile.runsPerWeek,
      longRunKm: profile.longRunKm, shortRunKm: profile.shortRunKm,
      restDays: profile.restDays, goals: profile.goals, maxHr: profile.maxHr,
    } : null,
  };
  const analysis = analyzeCoach(coachCtx, workoutsToday, minutesToday);

  const chatCtxInput: ChatContextInput = {
    today: todayKey,
    analysis,
    profile: profile ? {
      strengthPerWeek: profile.strengthPerWeek, runsPerWeek: profile.runsPerWeek,
      longRunKm: profile.longRunKm, shortRunKm: profile.shortRunKm, goals: profile.goals,
      restDays: profile.restDays, maxHr: profile.maxHr,
      dailyStepsGoal: profile.dailyStepsGoal, dailyCaloriesGoal: profile.dailyCaloriesGoal,
      weeklySlotPrefs: profile.weeklySlotPrefs as Record<string, unknown> | null,
      weeklyTemplateMarkdown: profile.weeklyTemplateMarkdown,
    } : null,
    keyLifts: keyLifts.map((k) => ({ name: k.name, unit: k.unit, current: k.current, currentReps: k.currentReps, notes: k.notes })),
    metricsByDate,
    workouts: workouts
      .filter((w) => format(w.date, "yyyy-MM-dd") >= format(subDays(now, 13), "yyyy-MM-dd"))
      .map((w) => ({
        date: format(w.date, "yyyy-MM-dd"), startTime: viennaHhMm(w.startTime),
        type: w.type, name: w.name, durationMin: Math.round(w.durationSec / 60),
        distanceKm: w.distanceM ? +(w.distanceM / 1000).toFixed(2) : null,
        avgHr: w.avgHr, maxHr: w.maxHr, trainingLoad: w.trainingLoad,
        rpe: w.rpe, feeling: w.feeling, notes: w.notes,
      })),
    journal: journal
      .filter((j) => format(j.date, "yyyy-MM-dd") >= format(subDays(now, 13), "yyyy-MM-dd"))
      .map((j) => ({
        date: format(j.date, "yyyy-MM-dd"),
        filledAt: j.updatedAt ? format(j.updatedAt, "HH:mm") : null,
        mood: j.mood, energy: j.energy, motivation: j.motivation, soreness: j.soreness,
        sleepQuality: j.sleepQuality, workoutFelt: j.workoutFelt, ateWell: j.ateWell,
        alcoholDrinks: j.alcoholDrinks, notes: j.notes,
      })),
    memories: memories.map((m) => ({ key: m.key, content: m.content })),
    todayRecommendation: todayReco ? {
      statusFocus: todayReco.statusFocus, actionsNow: todayReco.actionsNow,
      strengthIntensity: todayReco.strengthIntensity, cardioIntensity: todayReco.cardioIntensity,
      adjustedScore: todayReco.adjustedScore,
    } : null,
    weekPlan: weekPlanForChat,
  };

  const dataSnapshot = buildChatContext(chatCtxInput);

  // Konversation aufbauen: system + snapshot + history (chronologisch) + neue Nachricht
  const chronological = [...history].reverse(); // war desc → asc
  const aiMessages: AiMessage[] = [
    { role: "system", content: `${buildChatSystemPrompt()}\n\n---\n${dataSnapshot}` },
    ...chronological.map((m) => ({
      role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant",
      content: m.content,
    })),
    { role: "user", content: message },
  ];

  let result;
  try {
    result = await completeWithFallback(aiMessages, 1800);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: errMsg }, { status: 502 });
  }

  const parsed = parseChatResponse(result.text);

  // Actions ausfuehren
  const executed: { type: string; label: string }[] = [];
  for (const a of parsed.actions as ChatAction[]) {
    if (a.type === "memory" && a.key) {
      await prisma.coachMemory.upsert({
        where: { userId_key: { userId: user.id, key: a.key } },
        update: { content: a.content },
        create: { userId: user.id, key: a.key, content: a.content },
      });
      executed.push({ type: "memory", label: `Gemerkt: ${a.key}` });
    } else if (a.type === "adjust_score" && a.score !== undefined) {
      await prisma.coachRecommendation.upsert({
        where: { userId_date: { userId: user.id, date: startOfDay(now) } },
        update: { adjustedScore: a.score, adjustedLevel: a.level ?? null },
        create: {
          userId: user.id, date: startOfDay(now), provider: "chat", model: "chat-adjust",
          adjustedScore: a.score, adjustedLevel: a.level ?? null,
        },
      });
      executed.push({ type: "adjust_score", label: `Day-Score angepasst auf ${a.score}` });
    } else if (a.type === "adjust_tomorrow") {
      await prisma.coachMemory.upsert({
        where: { userId_key: { userId: user.id, key: "chat-override-tomorrow" } },
        update: { content: `[${todayKey}] ${a.content}` },
        create: { userId: user.id, key: "chat-override-tomorrow", content: `[${todayKey}] ${a.content}` },
      });
      executed.push({ type: "adjust_tomorrow", label: "Morgen-Empfehlung beeinflusst" });
    } else if (a.type === "refine_week_plan") {
      try {
        const r = await refineWeekPlanForUser(user.id, a.content);
        if ("error" in r) {
          executed.push({ type: "refine_week_plan", label: `Wochenplan-Anpassung fehlgeschlagen: ${r.error}` });
        } else {
          executed.push({ type: "refine_week_plan", label: "Wochenplan angepasst — siehe /health/wochenplan" });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        executed.push({ type: "refine_week_plan", label: `Wochenplan-Anpassung fehlgeschlagen: ${msg}` });
      }
    }
  }

  // Coach-Antwort speichern
  const assistantMsg = await prisma.coachChatMessage.create({
    data: {
      userId: user.id, role: "assistant", content: parsed.text || "(keine Antwort)",
      actions: executed.length > 0 ? (executed as never) : undefined,
      topic: topicValue,
    },
  });

  return NextResponse.json({
    id: assistantMsg.id,
    role: "assistant",
    content: parsed.text,
    actions: executed,
    provider: result.provider,
    createdAt: assistantMsg.createdAt.toISOString(),
  });
}

/**
 * DELETE — Chat-Verlauf loeschen.
 * Default: nur den allgemeinen Thread (topic IS NULL).
 * ?topic=week-plan → nur diesen Thread.
 * ?topic=all       → wirklich alle Threads.
 */
export async function DELETE(req: Request) {
  const user = await getCurrentUser();
  const url = new URL(req.url);
  const topicParam = url.searchParams.get("topic");
  let where: { userId: string; topic?: string | null };
  if (topicParam === "all") {
    where = { userId: user.id };
  } else if (topicParam) {
    where = { userId: user.id, topic: topicParam };
  } else {
    where = { userId: user.id, topic: null };
  }
  await prisma.coachChatMessage.deleteMany({ where });
  return NextResponse.json({ ok: true });
}
