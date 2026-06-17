/**
 * Wochenplaner Phase 2 — POST generiert Plan-Vorschlag fuer KOMMENDE Woche via Anthropic.
 * GET liefert den aktuellsten Draft (kommende Woche, oder aktuelle Woche als Fallback).
 *
 * Persistiert in WeeklyPlan.proposedSlots als JSON. Status=draft.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getCurrentUser } from "@/lib/api/get-user";
import { subDays, addDays, startOfDay, startOfWeek, endOfWeek, format } from "date-fns";
import { toDbDateNoon } from "@/lib/utils/vienna-tz";
import { analyzeCoach, type CoachContext } from "@/lib/health/coach-analysis";
import { completeWithAnthropicFirst } from "@/lib/ai/client";
import { fetchEventsForRange } from "@/lib/api/google-calendar";
import {
  buildWeekDraftSystemPrompt,
  buildWeekDraftUserPrompt,
  parseWeekDraftResponse,
  type WeekDraftCtx,
} from "@/lib/ai/week-plan-draft-prompt";
import { pickLeadGoal, computePeriodization } from "@/lib/coach/periodization";
import { computeMesocycle } from "@/lib/coach/mesocycle";
import { WEEKLY_DISTRIBUTIONS, STRENGTH_TEMPLATES, pickDistribution, pickStrengthBlock } from "@/lib/coach/workout-templates";
import { computeSicknessTimeline } from "@/lib/coach/sickness-timeline";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const DOW_DE = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

/**
 * Robuste Error-Extraction — AI-Client wirft plain Objects {provider, status, message},
 * Node-Errors sind Error-Instanzen, manchmal nested JSON-Strings drin.
 */
function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const obj = err as Record<string, unknown>;
    // AI-Client-Object: {provider, status, message}
    const inner = typeof obj.message === "string" ? obj.message : null;
    if (inner) {
      // Manchmal ist obj.message ein JSON-String mit {error:{message:"..."}}, schoener machen.
      try {
        const parsed = JSON.parse(inner) as { error?: { message?: string } };
        const realMsg = parsed?.error?.message;
        if (typeof realMsg === "string" && realMsg.length > 0) {
          return obj.provider ? `[${obj.provider}] ${realMsg}` : realMsg;
        }
      } catch {
        // war kein JSON, einfach so zurueck
      }
      return obj.provider ? `[${obj.provider}] ${inner}` : inner;
    }
    try { return JSON.stringify(obj); } catch { return String(obj); }
  }
  return String(err);
}

function parseWeekStartParam(raw: string | null | undefined): Date | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  // TZ-safe: parse als UTC-noon → startOfWeek in Container-TZ → UTC-noon Mo zurueck.
  const [y, m, d] = raw.split("-").map(Number);
  const parsed = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  if (isNaN(parsed.getTime())) return null;
  const local = startOfWeek(parsed, { weekStartsOn: 1 });
  // Re-encode auf UTC-noon damit Prisma @db.Date korrektes Datum speichert/lookup'd.
  return new Date(Date.UTC(local.getFullYear(), local.getMonth(), local.getDate(), 12, 0, 0));
}

export async function GET(req: Request) {
  const user = await getCurrentUser();
  const now = new Date();
  const { searchParams } = new URL(req.url);
  const explicitMonday = parseWeekStartParam(searchParams.get("weekStart"));

  if (explicitMonday) {
    // Expliziter Request fuer EINE Woche. explicitMonday ist bereits UTC-noon → direkt nutzen.
    const plan = await prisma.weeklyPlan.findUnique({
      where: { userId_weekStart: { userId: user.id, weekStart: explicitMonday } },
    });
    if (!plan) return NextResponse.json({ plan: null });
    const thisMondayCheck = startOfWeek(now, { weekStartsOn: 1 });
    return NextResponse.json({
      plan: {
        id: plan.id,
        weekStart: format(plan.weekStart, "yyyy-MM-dd"),
        generatedAt: plan.generatedAt.toISOString(),
        provider: plan.provider,
        model: plan.model,
        status: plan.status,
        weekOverview: plan.weekOverview,
        schedule: plan.schedule,
        watchouts: plan.watchouts,
        proposedSlots: plan.proposedSlots,
        errorMessage: plan.errorMessage,
        isForCurrentWeek: format(plan.weekStart, "yyyy-MM-dd") === format(thisMondayCheck, "yyyy-MM-dd"),
      },
    });
  }

  // Legacy-Fallback: kein weekStart -> bevorzugt naechste Woche, sonst aktuelle.
  const nextMondayLocal = startOfWeek(addDays(now, 7), { weekStartsOn: 1 });
  const thisMondayLocal = startOfWeek(now, { weekStartsOn: 1 });
  const nextMonday = new Date(Date.UTC(nextMondayLocal.getFullYear(), nextMondayLocal.getMonth(), nextMondayLocal.getDate(), 12, 0, 0));
  const thisMonday = new Date(Date.UTC(thisMondayLocal.getFullYear(), thisMondayLocal.getMonth(), thisMondayLocal.getDate(), 12, 0, 0));
  const planNext = await prisma.weeklyPlan.findUnique({
    where: { userId_weekStart: { userId: user.id, weekStart: nextMonday } },
  });
  const planThis = !planNext
    ? await prisma.weeklyPlan.findUnique({
        where: { userId_weekStart: { userId: user.id, weekStart: thisMonday } },
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
      status: plan.status,
      weekOverview: plan.weekOverview,
      schedule: plan.schedule,
      watchouts: plan.watchouts,
      proposedSlots: plan.proposedSlots,
      errorMessage: plan.errorMessage,
      isForCurrentWeek: !planNext,
    },
  });
}

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser();
    let weekStartParam: Date | null = null;
    let modeOverride: "generate" | "refine" | undefined;
    let refineFeedback: string | undefined;
    try {
      const body = (await req.json().catch(() => ({}))) as {
        weekStart?: string;
        mode?: "generate" | "refine";
        feedback?: string;
      };
      weekStartParam = parseWeekStartParam(body.weekStart);
      modeOverride = body.mode;
      refineFeedback = body.feedback;
    } catch {
      weekStartParam = null;
    }

    // Auto-Mode-Wahl: existiert bereits ein gueltiger Draft fuer diese Woche?
    // -> Refine (nachschaerfen). Sonst -> Generate.
    let mode: "generate" | "refine" = modeOverride ?? "generate";
    if (!modeOverride && weekStartParam) {
      const existing = await prisma.weeklyPlan.findUnique({
        where: { userId_weekStart: { userId: user.id, weekStart: weekStartParam } },
        select: { proposedSlots: true, errorMessage: true },
      });
      if (existing?.proposedSlots && !existing.errorMessage) {
        mode = "refine";
      }
    }

    console.log("[week-plan/draft] POST start", {
      userId: user.id,
      weekStartParam: weekStartParam?.toISOString(),
      mode,
    });

    if (mode === "refine") {
      const { refineWeekPlanForUser } = await import("@/lib/coach/week-plan-refine");
      const weekStartStr = weekStartParam ? format(weekStartParam, "yyyy-MM-dd") : undefined;
      const feedback = refineFeedback?.trim() || "Plan basierend auf aktuellem Health- und Workout-Stand nachschaerfen — neue Daten der letzten Tage (HRV, Schlaf, gemachte Workouts, Feeling) beruecksichtigen. Struktur kann angepasst werden, nicht nur Details.";
      const refineResult = await refineWeekPlanForUser(user.id, feedback, weekStartStr);
      if ("error" in refineResult) {
        console.error("[week-plan/draft] refine returned error:", refineResult.error);
        return NextResponse.json({ error: refineResult.error, mode: "refine" }, { status: 502 });
      }
      console.log("[week-plan/draft] POST success (refine)");
      return NextResponse.json({ ...refineResult, mode: "refine" });
    }

    const result = await generateWeekDraftForUser(user.id, weekStartParam ?? undefined);
    if ("error" in result) {
      console.error("[week-plan/draft] generation returned error:", result.error);
      return NextResponse.json({ error: result.error, mode: "generate" }, { status: 502 });
    }
    console.log("[week-plan/draft] POST success");
    return NextResponse.json({ ...result, mode: "generate" });
  } catch (err) {
    // Top-level catch — ALLE Unhandled-Exceptions als JSON-Response statt nginx-502.
    const msg = err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err);
    console.error("[week-plan/draft] FATAL:", msg);
    return NextResponse.json(
      { error: `Server-Fehler: ${extractErrorMessage(err)}` },
      { status: 500 },
    );
  }
}

async function generateWeekDraftForUser(userId: string, targetWeekStart?: Date) {
  const now = new Date();
  // Default: kommende Woche. Bei expliziter targetWeekStart benutze diese.
  const planMondayLocal = targetWeekStart
    ? startOfWeek(targetWeekStart, { weekStartsOn: 1 })
    : startOfWeek(addDays(now, 7), { weekStartsOn: 1 });
  // TZ-FIX: für @db.Date column UTC-noon nutzen, sonst speichert Prisma den Vortag.
  // (Container-TZ Vienna → startOfWeek liefert 00:00 Vienna = 22:00 Vortag UTC,
  // Prisma UTC-slice → falsches Datum).
  const planMonday = new Date(Date.UTC(
    planMondayLocal.getFullYear(),
    planMondayLocal.getMonth(),
    planMondayLocal.getDate(),
    12, 0, 0,
  ));
  const planSunday = endOfWeek(planMondayLocal, { weekStartsOn: 1 });
  const nextMonday = planMonday;
  const nextSunday = planSunday;
  const since = startOfDay(subDays(now, 14));

  const [metrics, journal, workouts, profile, memories, longTermGoals] = await Promise.all([
    prisma.healthMetric.findMany({ where: { date: { gte: since } }, orderBy: [{ kind: "asc" }, { date: "asc" }] }),
    prisma.dailyJournal.findMany({ where: { userId, date: { gte: since } }, orderBy: { date: "asc" } }),
    prisma.workoutSession.findMany({ where: { date: { gte: since } }, orderBy: { startTime: "asc" } }),
    prisma.trainingProfile.findUnique({ where: { userId } }),
    prisma.coachMemory.findMany({ where: { userId }, orderBy: { updatedAt: "desc" }, take: 12 }),
    prisma.longTermGoal.findMany({
      where: { userId, active: true },
      orderBy: { targetDate: "asc" },
    }),
  ]);

  // Metriken nach Datum gruppieren
  const metricsByDate: Record<string, Record<string, number>> = {};
  for (const m of metrics) {
    const k = format(m.date, "yyyy-MM-dd");
    (metricsByDate[k] ??= {})[m.kind] = m.value;
  }

  // Today-Workouts/Mins fuer analyzeCoach
  const todayKey = format(now, "yyyy-MM-dd");
  const workoutsToday = workouts.filter((w) => format(w.date, "yyyy-MM-dd") === todayKey);
  const minutesToday = workoutsToday.reduce((s, w) => s + Math.round(w.durationSec / 60), 0);

  // analyzeCoach braucht den breiten Kontext
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

  // last14 zusammenbauen
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

  // Kalender-Events Mo-So naechste Woche
  let nextWeekEvents: WeekDraftCtx["nextWeekEvents"] = [];
  try {
    const events = await fetchEventsForRange(nextMonday, addDays(nextSunday, 1));
    const byDate: Record<string, typeof events> = {};
    for (const e of events) {
      const key = e.start.slice(0, 10);
      (byDate[key] ??= []).push(e);
    }
    for (let i = 0; i < 7; i++) {
      const d = addDays(nextMonday, i);
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
    console.warn("[week-plan/draft] calendar fetch failed (continuing without events):", err);
    nextWeekEvents = Array.from({ length: 7 }, (_, i) => ({
      date: format(addDays(nextMonday, i), "yyyy-MM-dd"),
      dow: DOW_DE[i],
      events: [],
    }));
  }

  // Periodisierung berechnen (Race-rückwärts) — Lead Goal = nächstes Race oder gewichtetes Top-Goal
  const leadGoal = pickLeadGoal(longTermGoals);
  const periodizationState = leadGoal ? computePeriodization(now, leadGoal) : null;
  const phase = periodizationState?.phase ?? "out-of-range";
  const raceType = leadGoal?.type ?? null;

  // Mesozyklus (anchored auf erstes Workout-Datum)
  const firstWorkout = workouts[0];
  const meso = computeMesocycle(now, firstWorkout?.date);

  // Cardio-Distribution + Strength-Block für DIESE Woche wählen
  const distributionType = pickDistribution(phase, raceType);
  const distribution = WEEKLY_DISTRIBUTIONS[distributionType];
  const strengthBlock = STRENGTH_TEMPLATES[pickStrengthBlock(phase, raceType, meso.weekInCycle)];

  // Sickness-Timeline der letzten 7 Tage relativ zum Plan-Mo
  const sicknessTimeline = computeSicknessTimeline(metricsByDate, nextMonday);

  const promptCtx: WeekDraftCtx = {
    nextWeekStart: format(nextMonday, "yyyy-MM-dd"),
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
    periodization: periodizationState ? {
      phase: periodizationState.phase,
      phaseLabel: periodizationState.shortLabel,
      weeksUntilRace: periodizationState.weeksUntilTarget,
      raceName: leadGoal?.name ?? null,
      raceDate: leadGoal ? format(leadGoal.targetDate, "yyyy-MM-dd") : null,
      focusKeywords: periodizationState.focusKeywords,
    } : null,
    mesocycle: {
      weekInCycle: meso.weekInCycle,
      cycleIndex: meso.cycleIndex,
      type: meso.type,
      headline: meso.headline,
      coachInsight: meso.coachInsight,
      volumeModifier: meso.volumeModifier,
      intensityModifier: meso.intensityModifier,
    },
    cardioDistribution: {
      type: distribution.type,
      zoneSplit: distribution.zoneSplit,
      description: distribution.description,
      recommendedTemplates: distribution.recommended,
    },
    sicknessTimeline: {
      daysSinceSickness: sicknessTimeline.daysSinceSickness,
      hadRecentSickness: sicknessTimeline.hadRecentSickness,
      days: sicknessTimeline.days,
      rampUpStage: sicknessTimeline.rampUpStage,
      rampUpRationale: sicknessTimeline.rampUpRationale,
    },
    strengthBlock: {
      block: strengthBlock.block,
      reps: strengthBlock.reps,
      sets: strengthBlock.sets,
      intensity: strengthBlock.intensity,
      restSec: strengthBlock.restSec,
      rpe: strengthBlock.rpe,
      focus: strengthBlock.focus,
    },
  };

  let aiResult;
  try {
    aiResult = await completeWithAnthropicFirst(
      [
        { role: "system", content: buildWeekDraftSystemPrompt() },
        { role: "user", content: buildWeekDraftUserPrompt(promptCtx) },
      ],
      6000,
    );
  } catch (err) {
    const msg = extractErrorMessage(err);
    console.error("[week-plan/draft] AI-call failed:", err);
    await prisma.weeklyPlan.upsert({
      where: { userId_weekStart: { userId, weekStart: nextMonday } },
      update: { provider: "error", model: "ai", errorMessage: msg, generatedAt: now, status: "draft" },
      create: { userId, weekStart: nextMonday, provider: "error", model: "ai", errorMessage: msg, status: "draft" },
    });
    return { error: msg };
  }

  const parsed = parseWeekDraftResponse(aiResult.text);
  if (!parsed) {
    console.error("[week-plan/draft] parse failed. Raw response head:", aiResult.text.slice(0, 800));
    await prisma.weeklyPlan.upsert({
      where: { userId_weekStart: { userId, weekStart: nextMonday } },
      update: { provider: aiResult.provider, model: aiResult.model, rawResponse: aiResult.text, errorMessage: "parse_failed", generatedAt: now, status: "draft" },
      create: { userId, weekStart: nextMonday, provider: aiResult.provider, model: aiResult.model, rawResponse: aiResult.text, errorMessage: "parse_failed", status: "draft" },
    });
    return { error: "Plan-Antwort war kein gueltiges JSON" };
  }

  // Persistieren
  await prisma.weeklyPlan.upsert({
    where: { userId_weekStart: { userId, weekStart: nextMonday } },
    update: {
      provider: aiResult.provider, model: aiResult.model, generatedAt: now,
      weekOverview: parsed.weekFocus, schedule: null, watchouts: null,
      proposedSlots: parsed as unknown as object,
      rawResponse: aiResult.text, errorMessage: null, status: "draft",
    },
    create: {
      userId, weekStart: nextMonday,
      provider: aiResult.provider, model: aiResult.model,
      weekOverview: parsed.weekFocus,
      proposedSlots: parsed as unknown as object,
      rawResponse: aiResult.text, status: "draft",
    },
  });

  return {
    ok: true,
    weekStart: format(nextMonday, "yyyy-MM-dd"),
    weekEnd: format(nextSunday, "yyyy-MM-dd"),
    provider: aiResult.provider,
    model: aiResult.model,
    plan: parsed,
    events: nextWeekEvents,
  };
}

// Hilfsmittel fuer die Seite: existierende Kalender-Events holt das Frontend direkt
// ueber /api/calendar/range?from=...&to=... (siehe fetchEventsForRange).
