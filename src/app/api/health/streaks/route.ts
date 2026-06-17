import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/api/get-user";
import { getHealthContext } from "@/lib/health/metrics-cache";
import { computeStreaks } from "@/lib/health/streaks";
import { format } from "date-fns";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  const ctx = await getHealthContext(user.id);
  const streaks = computeStreaks({
    today: new Date(),
    metrics: ctx.metrics.map((m) => ({ date: format(m.date, "yyyy-MM-dd"), kind: m.kind, value: m.value })),
    journal: ctx.journal.map((j) => ({ date: format(j.date, "yyyy-MM-dd"), mood: j.mood, energy: j.energy })),
    workouts: ctx.workouts.map((w) => ({ date: format(w.date, "yyyy-MM-dd"), type: w.type, distanceM: w.distanceM, avgHr: w.avgHr, maxHr: w.maxHr })),
    profile: ctx.profile ? { longRunKm: ctx.profile.longRunKm, maxHr: ctx.profile.maxHr } : null,
  });
  return NextResponse.json({ streaks });
}
