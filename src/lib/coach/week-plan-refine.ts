import { prisma } from "@/lib/db/prisma";
import { toDbDateNoon } from "@/lib/utils/vienna-tz";
import { subDays, addDays, startOfDay, startOfWeek, endOfWeek, format } from "date-fns";
import { analyzeCoach, type CoachContext } from "@/lib/health/coach-analysis";
import { completeWithAnthropicFirst } from "@/lib/ai/client";
import { fetchEventsForRange } from "@/lib/api/google-calendar";
import { computeSicknessTimeline } from "@/lib/coach/sickness-timeline";
import {
  buildWeekDraftSystemPrompt,
  buildWeekDraftUserPrompt,
  parseWeekDraftResponse,
  type WeekDraftCtx,
  type WeekDraftPlan,
} from "@/lib/ai/week-plan-draft-prompt";

const DOW_DE = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];


/**
 * Kern-Logik fuer Plan-Refinement — von der Seite UND vom Chat-Coach (REFINE_WEEK_PLAN-Action) genutzt.
 */
export async function refineWeekPlanForUser(
  userId: string,
  feedback: string,
  explicitWeekStart?: string,
): Promise<{ ok: true; provider: string; model: string; plan: WeekDraftPlan } | { error: string; status?: number }> {
  const now = new Date();
  const nextMonday = startOfWeek(addDays(now, 7), { weekStartsOn: 1 });
  const thisMonday = startOfWeek(now, { weekStartsOn: 1 });

  // Welcher Plan? Wenn explizit angegeben (UI weiss welche Woche aktiv ist), den nehmen.
  // Sonst Legacy-Fallback: bevorzugt naechste Woche, sonst aktuelle.
  let targetWeekStart: Date;
  let existing;
  if (explicitWeekStart && /^\d{4}-\d{2}-\d{2}$/.test(explicitWeekStart)) {
    // TZ-safe: parse als UTC-noon, dann startOfWeek (Vienna-TZ-shift unkritisch durch noon-Mitte).
    const [y, m, d] = explicitWeekStart.split("-").map(Number);
    const parsed = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    targetWeekStart = startOfWeek(parsed, { weekStartsOn: 1 });
    existing = await prisma.weeklyPlan.findUnique({
      where: { userId_weekStart: { userId, weekStart: toDbDateNoon(targetWeekStart) } },
    });
  } else {
    existing = await prisma.weeklyPlan.findUnique({
      where: { userId_weekStart: { userId, weekStart: toDbDateNoon(nextMonday) } },
    });
    targetWeekStart = nextMonday;
    if (!existing?.proposedSlots) {
      existing = await prisma.weeklyPlan.findUnique({
        where: { userId_weekStart: { userId, weekStart: toDbDateNoon(thisMonday) } },
      });
      if (existing?.proposedSlots) targetWeekStart = thisMonday;
    }
  }
  const nextSunday = endOfWeek(targetWeekStart, { weekStartsOn: 1 });
  const previousPlan = existing?.proposedSlots as WeekDraftPlan | null | undefined;
  if (!previousPlan) {
    return { error: "Kein vorhandener Plan zum Anpassen. Erst 'Trainings-Woche planen'.", status: 400 };
  }

  const since = startOfDay(subDays(now, 14));
  const [metrics, journal, workouts, profile, memories] = await Promise.all([
    prisma.healthMetric.findMany({ where: { date: { gte: since } }, orderBy: [{ kind: "asc" }, { date: "asc" }] }),
    prisma.dailyJournal.findMany({ where: { userId, date: { gte: since } }, orderBy: { date: "asc" } }),
    prisma.workoutSession.findMany({ where: { date: { gte: since } }, orderBy: { startTime: "asc" } }),
    prisma.trainingProfile.findUnique({ where: { userId } }),
    prisma.coachMemory.findMany({ where: { userId }, orderBy: { updatedAt: "desc" }, take: 12 }),
  ]);

  // Metriken nach Datum gruppieren
  const metricsByDate: Record<string, Record<string, number>> = {};
  for (const m of metrics) {
    const k = format(m.date, "yyyy-MM-dd");
    (metricsByDate[k] ??= {})[m.kind] = m.value;
  }

  const todayKey = format(now, "yyyy-MM-dd");
  const workoutsToday = workouts.filter((w) => format(w.date, "yyyy-MM-dd") === todayKey);
  const minutesToday = workoutsToday.reduce((s, w) => s + Math.round(w.durationSec / 60), 0);

  const coachCtx: CoachContext = {
    today: todayKey,
    metrics: ((): CoachContext["metrics"] => {
      const out: CoachContext["metrics"] = {};
      for (const m of metrics) {
        const k = format(m.date, "yyyy-MM-dd");
        (out[m.kind] ??= []).push({ date: k, value: m.value });
      }
      return out;
    })(),
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
    plannedToday: [],
    plannedTomorrow: [],
    profile: profile ? {
      strengthPerWeek: profile.strengthPerWeek, runsPerWeek: profile.runsPerWeek,
      longRunKm: profile.longRunKm, shortRunKm: profile.shortRunKm,
      restDays: profile.restDays, goals: profile.goals, maxHr: profile.maxHr,
    } : null,
  };
  const analysis = analyzeCoach(coachCtx, workoutsToday.length, minutesToday);

  // last14
  const workoutsByDate: Record<string, typeof workouts> = {};
  for (const w of workouts) {
    const k = format(w.date, "yyyy-MM-dd");
    (workoutsByDate[k] ??= []).push(w);
  }
  const journalByDate: Record<string, (typeof journal)[number]> = {};
  for (const j of journal) journalByDate[format(j.date, "yyyy-MM-dd")] = j;

  const last14: WeekDraftCtx["last14"] = [];
  for (let i = 13; i >= 0; i--) {
    const d = subDays(now, i);
    const key = format(d, "yyyy-MM-dd");
    const dowIdx = (d.getDay() + 6) % 7;
    const m = metricsByDate[key] ?? {};
    last14.push({
      date: key,
      dow: DOW_DE[dowIdx],
      hrv: m.hrv_overnight ?? null,
      rhr: m.rhr ?? null,
      sleepMin: m.sleep_minutes ?? null,
      bodyBatteryLow: m.body_battery_low ?? null,
      stress: m.stress_avg ?? null,
      workouts: (workoutsByDate[key] ?? []).map((w) => ({
        type: w.type, durationMin: Math.round(w.durationSec / 60),
        distanceKm: w.distanceM ? +(w.distanceM / 1000).toFixed(2) : null,
        rpe: w.rpe, feeling: w.feeling, trainingLoad: w.trainingLoad,
      })),
      journal: journalByDate[key] ? {
        mood: journalByDate[key].mood, energy: journalByDate[key].energy,
        soreness: journalByDate[key].soreness, sleepQuality: journalByDate[key].sleepQuality,
        ateWell: journalByDate[key].ateWell, alcoholDrinks: journalByDate[key].alcoholDrinks,
        notes: journalByDate[key].notes,
      } : null,
    });
  }

  // Kalender-Events
  let nextWeekEvents: WeekDraftCtx["nextWeekEvents"] = [];
  try {
    const events = await fetchEventsForRange(targetWeekStart, addDays(nextSunday, 1));
    const byDate: Record<string, typeof events> = {};
    for (const e of events) {
      const key = e.start.slice(0, 10);
      (byDate[key] ??= []).push(e);
    }
    for (let i = 0; i < 7; i++) {
      const d = addDays(targetWeekStart, i);
      const key = format(d, "yyyy-MM-dd");
      nextWeekEvents.push({
        date: key,
        dow: DOW_DE[i],
        events: (byDate[key] ?? []).map((e) => ({
          title: e.title, start: e.start, end: e.end, allDay: e.allDay,
          accountKind: e.accountKind, location: e.location, description: e.description,
        })),
      });
    }
  } catch (err) {
    console.warn("[week-plan/refine] calendar fetch failed:", err);
    nextWeekEvents = Array.from({ length: 7 }, (_, i) => ({
      date: format(addDays(targetWeekStart, i), "yyyy-MM-dd"),
      dow: DOW_DE[i],
      events: [],
    }));
  }

  // Sickness-Timeline auch beim Refine — Coach soll Krankheitsverlauf weiter beachten
  const sicknessTimeline = computeSicknessTimeline(metricsByDate, targetWeekStart);

  const promptCtx: WeekDraftCtx = {
    nextWeekStart: format(targetWeekStart, "yyyy-MM-dd"),
    nextWeekEnd: format(nextSunday, "yyyy-MM-dd"),
    profile: profile ? {
      strengthPerWeek: profile.strengthPerWeek, runsPerWeek: profile.runsPerWeek,
      longRunKm: profile.longRunKm, shortRunKm: profile.shortRunKm,
      goals: profile.goals, restDays: profile.restDays, maxHr: profile.maxHr,
      weeklySlotPrefs: profile.weeklySlotPrefs as Record<string, unknown> | null,
      weeklyTemplateMarkdown: profile.weeklyTemplateMarkdown,
    } : null,
    analysis,
    last14,
    nextWeekEvents,
    memories: memories.map((m) => ({ key: m.key, content: m.content })),
    sicknessTimeline: {
      daysSinceSickness: sicknessTimeline.daysSinceSickness,
      hadRecentSickness: sicknessTimeline.hadRecentSickness,
      days: sicknessTimeline.days,
      rampUpStage: sicknessTimeline.rampUpStage,
      rampUpRationale: sicknessTimeline.rampUpRationale,
    },
  };

  let aiResult;
  try {
    aiResult = await completeWithAnthropicFirst(
      [
        { role: "system", content: buildWeekDraftSystemPrompt() },
        { role: "user", content: buildWeekDraftUserPrompt(promptCtx, { previousPlan, feedback: feedback }) },
      ],
      6000,
    );
  } catch (err) {
    // Robuste Message-Extraction — AI-Client wirft plain Objects
    const msg = (() => {
      if (err instanceof Error) return err.message;
      if (err && typeof err === "object") {
        const obj = err as Record<string, unknown>;
        if (typeof obj.message === "string") {
          try {
            const parsed = JSON.parse(obj.message) as { error?: { message?: string } };
            if (parsed?.error?.message) return `[${obj.provider ?? "ai"}] ${parsed.error.message}`;
          } catch { /* ignore */ }
          return `[${obj.provider ?? "ai"}] ${obj.message}`;
        }
        try { return JSON.stringify(obj); } catch { return String(obj); }
      }
      return String(err);
    })();
    console.error("[week-plan/refine] AI-call failed:", err);
    return { error: msg };
  }

  const parsed = parseWeekDraftResponse(aiResult.text);
  if (!parsed) {
    console.error("[week-plan/refine] parse failed. Raw response head:", aiResult.text.slice(0, 800));
    // RawResponse trotzdem in DB persistieren damit Coach-Folge-Anpassung den Text sieht.
    try {
      await prisma.weeklyPlan.update({
        where: { userId_weekStart: { userId, weekStart: toDbDateNoon(targetWeekStart) } },
        data: { rawResponse: aiResult.text, errorMessage: "refine_parse_failed", generatedAt: now },
      });
    } catch { /* nicht kritisch */ }
    return { error: "Antwort war kein gueltiges JSON (Coach-Antwort wurde gespeichert — versuch nochmal mit konkreterem Feedback)" };
  }

  await prisma.weeklyPlan.update({
    where: { userId_weekStart: { userId, weekStart: toDbDateNoon(targetWeekStart) } },
    data: {
      provider: aiResult.provider, model: aiResult.model, generatedAt: now,
      weekOverview: parsed.weekFocus,
      proposedSlots: parsed as unknown as object,
      rawResponse: aiResult.text, errorMessage: null, status: "draft",
    },
  });

  return {
    ok: true,
    provider: aiResult.provider,
    model: aiResult.model,
    plan: parsed,
  };
}
