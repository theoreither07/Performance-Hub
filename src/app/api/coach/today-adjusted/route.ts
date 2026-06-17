/**
 * GET /api/coach/today-adjusted
 *
 * Liefert die HEUTIGEN geplanten Sessions, adaptiert an den aktuellen Tageszustand.
 * Nutzt:
 *   - Heutigen Wochenplan (aktuelle Woche)
 *   - Bereitschafts-Score
 *   - Sickness-Indikatoren (HRV-Drop, Sleep, BB)
 *   - Post-Sickness-Ramp-Up-Tracking (letzte 5 Tage)
 *
 * Output: adjusted sessions + global reason + recommendations.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getCurrentUser } from "@/lib/api/get-user";
import { startOfDay, startOfWeek, subDays, format } from "date-fns";
import {
  adjustTodaySessions,
  detectSickness,
  type DayState,
  type PlanSessionInput,
  type SicknessIndicators,
} from "@/lib/coach/daily-adjustment";

export const dynamic = "force-dynamic";

interface PlanDay {
  date: string;
  dow: string;
  dayFocus?: string;
  sessions: Array<PlanSessionInput & { start?: string; end?: string }>;
}

interface PlanProposed {
  days?: PlanDay[];
}

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
  const monday = startOfDay(startOfWeek(now, { weekStartsOn: 1 }));

  // 1) Heutige Plan-Sessions aus Wochenplan
  const plan = await prisma.weeklyPlan.findUnique({
    where: { userId_weekStart: { userId: user.id, weekStart: monday } },
  });
  const proposed = (plan?.proposedSlots ?? null) as PlanProposed | null;
  const todayPlanDay = proposed?.days?.find((d) => d.date === todayKey);
  const sessions: PlanSessionInput[] = (todayPlanDay?.sessions ?? []).map((s) => ({
    type: s.type as PlanSessionInput["type"],
    title: s.title,
    intensityStrength: s.intensityStrength ?? null,
    intensityCardio: s.intensityCardio ?? null,
    exercises: s.exercises,
    cardio: s.cardio ?? null,
    reasoning: s.reasoning,
  }));

  // 2) Bereitschafts-Score holen
  let readiness: number | null = null;
  try {
    const scoreRes = await fetch("http://localhost:3000/api/health/score?days=1", { cache: "no-store" }).catch(() => null);
    if (scoreRes && scoreRes.ok) {
      const j = await scoreRes.json();
      readiness = j?.days?.[0]?.total ?? null;
      if (j?.days?.[0]?.waitingForGarmin) readiness = null;
    }
  } catch {
    readiness = null;
  }

  // 3) Sickness-Indikatoren der letzten 14 Tage berechnen
  const since = startOfDay(subDays(now, 14));
  const metrics = await prisma.healthMetric.findMany({
    where: { date: { gte: since } },
    orderBy: [{ kind: "asc" }, { date: "asc" }],
  });
  const byKindDate: Record<string, Map<string, number>> = {};
  for (const m of metrics) {
    const k = format(m.date, "yyyy-MM-dd");
    (byKindDate[m.kind] ??= new Map()).set(k, m.value);
  }
  const valuesFor = (kind: string, dateKey: string): number | null => byKindDate[kind]?.get(dateKey) ?? null;

  // Baselines (14d, exklusive heute)
  const baseValues = (kind: string): number[] => {
    const arr: number[] = [];
    if (!byKindDate[kind]) return arr;
    for (const [d, v] of byKindDate[kind]) {
      if (d < todayKey) arr.push(v);
    }
    return arr.slice(-14);
  };
  const hrvBase = meanStd(baseValues("hrv_overnight"));
  const rhrBase = meanStd(baseValues("rhr"));

  const hrvToday = valuesFor("hrv_overnight", todayKey);
  const rhrToday = valuesFor("rhr", todayKey);
  const sleepToday = valuesFor("sleep_minutes", todayKey);
  const bbHighToday = valuesFor("body_battery_high", todayKey);

  const indicators: SicknessIndicators = {
    hrvDropPct: (hrvToday !== null && hrvBase) ? ((hrvToday - hrvBase.mean) / hrvBase.mean) * 100 : null,
    sleepHoursLastNight: sleepToday !== null ? sleepToday / 60 : null,
    bodyBatteryMaxToday: bbHighToday,
    rhrZ: (rhrToday !== null && rhrBase) ? (rhrToday - rhrBase.mean) / rhrBase.std : null,
  };

  // 4) Post-Sickness-Tracking: war in den letzten 1-5 Tagen Sickness?
  let daysSinceSickness: number | null = null;
  for (let i = 1; i <= 5; i++) {
    const dKey = format(subDays(now, i), "yyyy-MM-dd");
    const dayHrv = valuesFor("hrv_overnight", dKey);
    const daySleep = valuesFor("sleep_minutes", dKey);
    const dayBb = valuesFor("body_battery_high", dKey);
    const dayRhr = valuesFor("rhr", dKey);
    const dayInd: SicknessIndicators = {
      hrvDropPct: (dayHrv !== null && hrvBase) ? ((dayHrv - hrvBase.mean) / hrvBase.mean) * 100 : null,
      sleepHoursLastNight: daySleep !== null ? daySleep / 60 : null,
      bodyBatteryMaxToday: dayBb,
      rhrZ: (dayRhr !== null && rhrBase) ? (dayRhr - rhrBase.mean) / rhrBase.std : null,
    };
    if (detectSickness(dayInd).isSick) {
      daysSinceSickness = i;
      break;
    }
  }

  const state: DayState = { readinessScore: readiness, indicators, daysSinceSickness };
  const result = adjustTodaySessions(sessions, state);

  return NextResponse.json({
    date: todayKey,
    state: {
      readiness,
      hrvToday,
      hrvDropPct: indicators.hrvDropPct,
      sleepHours: indicators.sleepHoursLastNight,
      bodyBatteryMax: bbHighToday,
      daysSinceSickness,
    },
    adjustment: result,
    originalSessions: sessions,
    dayFocus: todayPlanDay?.dayFocus ?? null,
  });
}
