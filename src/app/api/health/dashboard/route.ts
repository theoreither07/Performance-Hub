/**
 * Bulk-Endpoint fuer die Health-Page.
 *
 * Statt 6+ parallele Requests (score, coach/generate, weekplan/draft, journal,
 * calendar/today, training-profile) fasst dieser eine GET-Route alles zusammen.
 *
 * Effekt: 1 HTTP Round-Trip statt 6 → spart Auth-Overhead, TLS-Handshakes,
 * Server-Compile-Pfade, und macht die First-Paint-Zeit deutlich kuerzer.
 *
 * Stale-While-Revalidate-Pattern: Endpoint ist im SW als SWR registriert →
 * der Browser sieht JSON sofort aus Cache, Hintergrund-Refetch updated leise.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getCurrentUser } from "@/lib/api/get-user";
import { subDays, addDays, startOfDay, startOfWeek, format } from "date-fns";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  const now = new Date();
  const todayKey = format(now, "yyyy-MM-dd");

  // Parallel alles holen das die Health-Page-Komponenten unten brauchen.
  // Jede Query ist kurz/billig — Bottleneck ist Netz-Latenz, nicht DB-Compute.
  // Score wird BEWUSST NICHT hier inkludiert — er hat eigene komplexe Logik in /api/health/score.
  // Die UI macht weiterhin 2 Requests (dashboard + score) statt 6+ → trotzdem 3× besser.
  const [reco, plan, journalToday, profile, longTermGoals, foodMemories] = await Promise.all([
    // 1) Coach-Empfehlung heute
    prisma.coachRecommendation.findUnique({
      where: { userId_date: { userId: user.id, date: startOfDay(now) } },
      select: {
        id: true, generatedAt: true, provider: true, model: true,
        phase: true, statusFocus: true, actionsNow: true,
        eveningPrep: true, tomorrowSetup: true,
        strengthIntensity: true, cardioIntensity: true, intensityReason: true,
        errorMessage: true,
      },
    }),
    // 3) Wochenplan (current oder next)
    prisma.weeklyPlan.findFirst({
      where: { userId: user.id, weekStart: { gte: subDays(now, 14) } },
      orderBy: { weekStart: "desc" },
      select: {
        id: true, weekStart: true, generatedAt: true, status: true,
        weekOverview: true, schedule: true, watchouts: true, proposedSlots: true,
      },
    }),
    // 4) Heute-Journal
    prisma.dailyJournal.findUnique({
      where: { userId_date: { userId: user.id, date: startOfDay(now) } },
    }),
    // 5) Training Profile
    prisma.trainingProfile.findUnique({ where: { userId: user.id } }),
    // 6) Active Long-Term Goals
    prisma.longTermGoal.findMany({
      where: { userId: user.id, active: true },
      orderBy: { targetDate: "asc" },
    }),
    // 7) Recent Food Memories (5)
    prisma.coachMemory.findMany({
      where: { userId: user.id, key: { startsWith: "food-" } },
      orderBy: { key: "desc" },
      take: 5,
    }),
  ]);

  return NextResponse.json({
    recommendation: reco,
    plan: plan ? {
      id: plan.id,
      weekStart: format(plan.weekStart, "yyyy-MM-dd"),
      generatedAt: plan.generatedAt.toISOString(),
      status: plan.status,
      weekOverview: plan.weekOverview,
      schedule: plan.schedule,
      watchouts: plan.watchouts,
      proposedSlots: plan.proposedSlots,
    } : null,
    journalToday,
    profile,
    longTermGoals: longTermGoals.map((g) => ({
      ...g,
      targetDate: format(g.targetDate, "yyyy-MM-dd"),
      startDate: format(g.startDate, "yyyy-MM-dd"),
    })),
    foodMemories: foodMemories.map((m) => ({
      date: m.key.replace(/^food-/, ""),
      content: m.content,
      updatedAt: m.updatedAt.toISOString(),
    })),
    serverTime: now.toISOString(),
  });
}
