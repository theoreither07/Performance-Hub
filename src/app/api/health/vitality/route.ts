/**
 * GET /api/health/vitality
 *
 * Liefert den aktuellen Live-Vitality-Score (0-100), Faktor-Aufschlüsselung,
 * Headline + Stundenverlauf seit 06:00. Pure-Compute über computeLiveVitality.
 *
 * Persistiert optional gestrigen End-of-Day Snapshot in DailyVitalitySnapshot,
 * damit morgens der Carry-Over-Bonus/-Malus angewendet werden kann.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getCurrentUser } from "@/lib/api/get-user";
import { computeLiveVitality, type VitalityInput } from "@/lib/health/live-vitality";
import { startOfDay, endOfDay, subDays, format } from "date-fns";
import { naiveViennaToUtc } from "@/lib/utils/vienna-tz";

export const dynamic = "force-dynamic";

function meanStd(vals: number[]): { mean: number; std: number } | null {
  if (vals.length < 3) return null;
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
  return { mean, std: Math.sqrt(variance) || 1 };
}

export async function GET() {
  const user = await getCurrentUser();
  const now = new Date();
  const todayKey = format(now, "yyyy-MM-dd");
  const yesterday = subDays(now, 1);
  const yesterdayKey = format(yesterday, "yyyy-MM-dd");
  const since = startOfDay(subDays(now, 16));

  const [metrics, workouts, journal, yesterdaySnap, journalRecent] = await Promise.all([
    prisma.healthMetric.findMany({
      where: { date: { gte: since, lte: endOfDay(now) } },
      orderBy: [{ kind: "asc" }, { date: "asc" }],
    }),
    // Last 72h Workouts (für Drain-Berechnung — gestern's Strength drainiert heute noch).
    // Filter über date column (todays + yesterday + 2 days ago).
    prisma.workoutSession.findMany({
      where: { date: { gte: startOfDay(subDays(now, 3)), lte: endOfDay(now) } },
      orderBy: { startTime: "asc" },
    }),
    prisma.dailyJournal.findUnique({
      where: { userId_date: { userId: user.id, date: startOfDay(now) } },
    }),
    prisma.dailyVitalitySnapshot.findUnique({
      where: { userId_date: { userId: user.id, date: startOfDay(yesterday) } },
    }).catch(() => null),
    prisma.dailyJournal.findMany({
      where: { userId: user.id, date: { gte: startOfDay(subDays(now, 3)), lte: startOfDay(now) } },
      orderBy: { date: "desc" },
    }),
  ]);

  // Aktuelle Wien-Temperatur für Heat-Compensation (best effort, kein Fail wenn down).
  let outdoorTempC: number | null = null;
  try {
    const weatherRes = await fetch(`http://localhost:3000/api/weather`, { cache: "no-store" }).catch(() => null);
    if (weatherRes && weatherRes.ok) {
      const w = await weatherRes.json();
      outdoorTempC = typeof w?.current?.temp === "number" ? w.current.temp : null;
    }
  } catch {
    outdoorTempC = null;
  }

  // Metriken nach kind+date pivot
  const byKind: Record<string, Array<{ date: string; value: number }>> = {};
  for (const m of metrics) {
    const k = format(m.date, "yyyy-MM-dd");
    (byKind[m.kind] ??= []).push({ date: k, value: m.value });
  }
  const latestToday = (kind: string): number | null => {
    const arr = byKind[kind] ?? [];
    const t = arr.find((v) => v.date === todayKey);
    return t?.value ?? null;
  };
  const last14d = (kind: string): { mean: number; std: number } | null => {
    const arr = (byKind[kind] ?? []).filter((v) => v.date < todayKey).slice(-14);
    return meanStd(arr.map((v) => v.value));
  };

  const input: VitalityInput = {
    now,
    todayKey,
    hrvOvernight: latestToday("hrv_overnight"),
    hrvBaseline14d: last14d("hrv_overnight"),
    sleepMinutes: latestToday("sleep_minutes"),
    sleepScore: latestToday("sleep_score"),
    rhrToday: latestToday("rhr"),
    rhrBaseline14d: last14d("rhr"),
    bodyBatteryHigh: latestToday("body_battery_high"),
    bodyBatteryLow: latestToday("body_battery_low"),
    stressAvgToday: latestToday("stress_avg"),
    stressBaseline14d: last14d("stress_avg"),
    vo2max: latestToday("vo2max"),
    journalEnergy: journal?.energy ?? null,
    journalMood: journal?.mood ?? null,
    journalSoreness: journal?.soreness ?? null,
    // TZ-Korrektur: Python schreibt startTime naive Vienna-time, Prisma liest als UTC.
    // Wir korrigieren zur echten UTC, damit `now - startTime` korrekte Stunden ergibt
    // und heutige Workouts nicht fälschlich als "Zukunft" gefiltert werden.
    todayWorkouts: workouts.map((w) => ({
      startTime: naiveViennaToUtc(w.startTime),
      durationMin: Math.round(w.durationSec / 60),
      type: w.type,
      trainingLoad: w.trainingLoad,
      rpe: w.rpe,
      feeling: w.feeling,
    })),
    stepsToday: latestToday("steps"),
    activeMinutesToday: latestToday("active_minutes"),
    yesterdayEndVitality: yesterdaySnap?.endScore ?? null,
    outdoorTempC,
    yesterdayAlcoholDrinks: journalRecent.find((j) => format(j.date, "yyyy-MM-dd") === yesterdayKey)?.alcoholDrinks ?? null,
    twoDaysAgoAlcoholDrinks: journalRecent.find((j) => {
      const k2 = format(subDays(now, 2), "yyyy-MM-dd");
      return format(j.date, "yyyy-MM-dd") === k2;
    })?.alcoholDrinks ?? null,
    hrvSeries: byKind["hrv_overnight"] ? { values: byKind["hrv_overnight"] } : undefined,
  };

  const result = computeLiveVitality(input);

  // End-of-Day Snapshot: wenn jetzt >= 22:30, persist today's snapshot (idempotent).
  if (now.getHours() >= 22 || (now.getHours() === 22 && now.getMinutes() >= 30)) {
    try {
      await prisma.dailyVitalitySnapshot.upsert({
        where: { userId_date: { userId: user.id, date: startOfDay(now) } },
        update: { endScore: result.score, computedAt: now, factors: result.factors as unknown as object },
        create: {
          userId: user.id,
          date: startOfDay(now),
          endScore: result.score,
          computedAt: now,
          factors: result.factors as unknown as object,
        },
      });
    } catch {
      // Schema noch nicht migriert? - dann silently skip
    }
  }

  return NextResponse.json({
    date: todayKey,
    score: result.score,
    startScore: result.startScore,
    headline: result.headline,
    factors: result.factors,
    hourly: result.hourly,
    yesterdayEndVitality: input.yesterdayEndVitality,
  });
}
