import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { checkMcpAuth } from "@/lib/api/mcp-auth";
import { subDays, startOfDay, format } from "date-fns";

export const dynamic = "force-dynamic";

const PRIMARY_EMAIL = process.env.PRIMARY_EMAIL ?? "";

/**
 * GET /api/mcp/coach-review?days=7
 * Tieferer strukturierter Dump fuer den KI-Trainer-Coach am Wochenende.
 * Liefert pro Tag: Workouts (inkl RPE/Feeling/Notes), Journal, Health-Metriken-Daily.
 * Plus 30d-Trends + TrainingProfile + Goals.
 */
export async function GET(req: Request) {
  const denied = checkMcpAuth(req);
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const days = Math.min(60, Math.max(1, Number(searchParams.get("days") ?? "7")));
  const longDays = Math.min(180, Math.max(days, Number(searchParams.get("longDays") ?? "30")));
  const now = new Date();
  const since = startOfDay(subDays(now, days - 1));
  const longSince = startOfDay(subDays(now, longDays - 1));

  const user = await prisma.user.findUnique({ where: { email: PRIMARY_EMAIL } });
  if (!user) return NextResponse.json({ error: "user not found" }, { status: 404 });

  const [workouts, workoutsLong, journal, profile, metrics, metricsLong] = await Promise.all([
    prisma.workoutSession.findMany({
      where: { date: { gte: since } },
      orderBy: { startTime: "asc" },
    }),
    prisma.workoutSession.findMany({
      where: { date: { gte: longSince } },
      select: {
        date: true,
        type: true,
        durationSec: true,
        distanceM: true,
        trainingLoad: true,
        rpe: true,
        feeling: true,
      },
      orderBy: { startTime: "asc" },
    }),
    prisma.dailyJournal.findMany({
      where: { userId: user.id, date: { gte: since } },
      orderBy: { date: "asc" },
    }),
    prisma.trainingProfile.findUnique({ where: { userId: user.id } }),
    prisma.healthMetric.findMany({
      where: { date: { gte: since } },
      orderBy: [{ kind: "asc" }, { date: "asc" }],
    }),
    prisma.healthMetric.findMany({
      where: { date: { gte: longSince } },
      orderBy: [{ kind: "asc" }, { date: "asc" }],
    }),
  ]);

  // Trends: aktuell letzte days vs vergleichbarer Zeitraum davor (innerhalb longDays)
  function avgKind(arr: typeof metrics, kind: string, fromDays: number, toDays: number): number | null {
    const fromKey = format(subDays(now, fromDays - 1), "yyyy-MM-dd");
    const toKey = format(subDays(now, toDays), "yyyy-MM-dd");
    const vals = arr
      .filter((m) => m.kind === kind)
      .map((m) => ({ d: format(m.date, "yyyy-MM-dd"), v: m.value }))
      .filter((m) => m.d >= fromKey && m.d < toKey)
      .map((m) => m.v);
    if (vals.length === 0) return null;
    return vals.reduce((s, v) => s + v, 0) / vals.length;
  }

  const trendKinds = ["hrv_overnight", "sleep_minutes", "rhr", "body_battery_high", "body_battery_low", "training_readiness"];
  const trends: Record<string, { current: number | null; previous: number | null; delta: number | null }> = {};
  for (const k of trendKinds) {
    const current = avgKind(metrics, k, days, 0);
    const previous = avgKind(metricsLong, k, days * 2, days);
    const delta = current !== null && previous !== null ? current - previous : null;
    trends[k] = { current, previous, delta };
  }

  // Per-day-Aggregation
  const byDate = new Map<string, {
    date: string;
    workouts: typeof workouts;
    journal: typeof journal[number] | null;
  }>();
  for (let i = 0; i < days; i++) {
    const d = format(subDays(now, i), "yyyy-MM-dd");
    byDate.set(d, { date: d, workouts: [], journal: null });
  }
  for (const w of workouts) {
    const key = format(w.date, "yyyy-MM-dd");
    const entry = byDate.get(key);
    if (entry) entry.workouts.push(w);
  }
  for (const j of journal) {
    const key = format(j.date, "yyyy-MM-dd");
    const entry = byDate.get(key);
    if (entry) entry.journal = j;
  }

  // Workouts compactly
  const workoutSummary = workouts.map((w) => ({
    id: w.id,
    date: format(w.date, "yyyy-MM-dd"),
    type: w.type,
    name: w.name,
    durationMin: Math.round(w.durationSec / 60),
    distanceKm: w.distanceM ? +(w.distanceM / 1000).toFixed(2) : null,
    avgHr: w.avgHr,
    maxHr: w.maxHr,
    trainingLoad: w.trainingLoad,
    aerobicEffect: w.aerobicEffect,
    anaerobicEffect: w.anaerobicEffect,
    rpe: w.rpe,
    feeling: w.feeling,
    notes: w.notes,
    source: w.source,
  }));

  // Nutrition + Stress Patterns
  const ateWellDays = journal.filter((j) => j.ateWell === true).length;
  const ateBadlyDays = journal.filter((j) => j.ateWell === false).length;
  const totalAlcohol = journal.reduce((s, j) => s + (j.alcoholDrinks ?? 0), 0);
  const avgMood = avg(journal.map((j) => j.mood));
  const avgEnergy = avg(journal.map((j) => j.energy));
  const avgSoreness = avg(journal.map((j) => j.soreness));
  const avgSleepQuality = avg(journal.map((j) => j.sleepQuality));

  // Long-period summary (30d)
  const longByType: Record<string, { count: number; minutes: number; distanceKm: number }> = {};
  for (const w of workoutsLong) {
    longByType[w.type] = longByType[w.type] ?? { count: 0, minutes: 0, distanceKm: 0 };
    longByType[w.type].count++;
    longByType[w.type].minutes += Math.round(w.durationSec / 60);
    if (w.distanceM) longByType[w.type].distanceKm += w.distanceM / 1000;
  }

  return NextResponse.json({
    period: {
      from: format(since, "yyyy-MM-dd"),
      to: format(now, "yyyy-MM-dd"),
      days,
      longDays,
    },
    profile,
    workoutsSummary: workoutSummary,
    workoutsLongByType: Object.entries(longByType).map(([type, v]) => ({
      type,
      count: v.count,
      minutes: v.minutes,
      distanceKm: +v.distanceKm.toFixed(1),
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
    nutritionSummary: {
      goodDays: ateWellDays,
      badDays: ateBadlyDays,
      totalAlcoholDrinks: totalAlcohol,
      avgMood,
      avgEnergy,
      avgSoreness,
      avgSleepQuality,
    },
    healthTrends: trends,
    daily: Array.from(byDate.values())
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((d) => ({
        date: d.date,
        workouts: d.workouts.length,
        workoutTypes: d.workouts.map((w) => w.type),
        totalMinutes: d.workouts.reduce((s, w) => s + Math.round(w.durationSec / 60), 0),
        journalSet: !!d.journal,
      })),
  });
}

function avg(arr: (number | null)[]): number | null {
  const vals = arr.filter((v): v is number => v !== null);
  if (vals.length === 0) return null;
  return +(vals.reduce((s, v) => s + v, 0) / vals.length).toFixed(2);
}
