/**
 * GET /api/export?days=N
 *
 * Vollstaendiger JSON-Dump aller Personal-Dashboard-Daten des eingeloggten Users
 * im gewuenschten Zeitraum. days={7,14,30,180,365} oder beliebige Zahl.
 *
 * Antwort traegt Content-Disposition fuer Browser-Download.
 */
import { NextResponse } from "next/server";
import { format, startOfDay, subDays } from "date-fns";
import { prisma } from "@/lib/db/prisma";
import { getCurrentUser } from "@/lib/api/get-user";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  const url = new URL(req.url);
  const daysParam = parseInt(url.searchParams.get("days") ?? "30", 10);
  const days = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(daysParam, 3650) : 30;

  const now = new Date();
  const from = startOfDay(subDays(now, days - 1));
  const userId = user.id;

  const [
    profile,
    keyLifts,
    journals,
    workouts,
    recommendations,
    weeklyPlans,
    chatMessages,
    metrics,
    memories,
    googleAccounts,
  ] = await Promise.all([
    prisma.trainingProfile.findUnique({ where: { userId } }),
    prisma.keyLift.findMany({ where: { userId }, orderBy: { name: "asc" } }),
    prisma.dailyJournal.findMany({ where: { userId, date: { gte: from } }, orderBy: { date: "asc" } }),
    // WorkoutSession + HealthMetric sind global (single-user-Modell, kein userId-Spalten)
    prisma.workoutSession.findMany({ where: { date: { gte: from } }, orderBy: { startTime: "asc" } }),
    prisma.coachRecommendation.findMany({ where: { userId, date: { gte: from } }, orderBy: { date: "asc" } }),
    prisma.weeklyPlan.findMany({ where: { userId, weekStart: { gte: from } }, orderBy: { weekStart: "asc" } }),
    prisma.coachChatMessage.findMany({ where: { userId, createdAt: { gte: from } }, orderBy: { createdAt: "asc" } }),
    prisma.healthMetric.findMany({ where: { date: { gte: from } }, orderBy: [{ date: "asc" }, { kind: "asc" }] }),
    prisma.coachMemory.findMany({ where: { userId }, orderBy: { updatedAt: "desc" } }),
    prisma.googleAccount.findMany({
      where: { userId },
      // KEINE refreshToken/accessToken exportieren — sicherheitsrelevant
      select: { id: true, email: true, kind: true, createdAt: true, updatedAt: true },
    }),
  ]);

  const payload = {
    meta: {
      exportedAt: now.toISOString(),
      rangeDays: days,
      from: format(from, "yyyy-MM-dd"),
      to: format(now, "yyyy-MM-dd"),
      userEmail: user.email,
      counts: {
        journals: journals.length,
        workouts: workouts.length,
        recommendations: recommendations.length,
        weeklyPlans: weeklyPlans.length,
        chatMessages: chatMessages.length,
        metrics: metrics.length,
        memories: memories.length,
        keyLifts: keyLifts.length,
        googleAccounts: googleAccounts.length,
      },
    },
    profile,
    keyLifts,
    journals,
    workouts,
    recommendations,
    weeklyPlans,
    chatMessages,
    metrics,
    memories,
    googleAccounts,
  };

  const filename = `dashboard-export_${format(now, "yyyyMMdd_HHmm")}_${days}d.json`;
  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
