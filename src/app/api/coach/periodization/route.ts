/**
 * GET /api/coach/periodization
 *
 * Liefert die aktuelle Sport-wissenschaftliche Periodisierungs-Position:
 *  - Race-Phase (base/build/peak/sharpen/taper/race-week)
 *  - Mesozyklus (4-Wochen-Block)
 *  - Empfohlene Cardio-Distribution + Strength-Block für DIESE Woche
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getCurrentUser } from "@/lib/api/get-user";
import { format } from "date-fns";
import { pickLeadGoal, computePeriodization } from "@/lib/coach/periodization";
import { computeMesocycle } from "@/lib/coach/mesocycle";
import { WEEKLY_DISTRIBUTIONS, STRENGTH_TEMPLATES, pickDistribution, pickStrengthBlock } from "@/lib/coach/workout-templates";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  const now = new Date();

  const [longTermGoals, firstWorkout] = await Promise.all([
    prisma.longTermGoal.findMany({
      where: { userId: user.id, active: true },
      orderBy: { targetDate: "asc" },
    }),
    prisma.workoutSession.findFirst({ orderBy: { date: "asc" } }),
  ]);

  const leadGoal = pickLeadGoal(longTermGoals);
  const periodizationState = leadGoal ? computePeriodization(now, leadGoal) : null;
  const phase = periodizationState?.phase ?? "out-of-range";
  const raceType = leadGoal?.type ?? null;

  const meso = computeMesocycle(now, firstWorkout?.date);

  const distributionType = pickDistribution(phase, raceType);
  const distribution = WEEKLY_DISTRIBUTIONS[distributionType];

  const strengthBlock = STRENGTH_TEMPLATES[pickStrengthBlock(phase, raceType, meso.weekInCycle)];

  return NextResponse.json({
    periodization: periodizationState ? {
      phase: periodizationState.phase,
      phaseLabel: periodizationState.shortLabel,
      longLabel: periodizationState.longLabel,
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
    },
    cardioDistribution: {
      type: distribution.type,
      zoneSplit: distribution.zoneSplit,
      description: distribution.description,
    },
    strengthBlock: {
      block: strengthBlock.block,
      reps: strengthBlock.reps,
      sets: strengthBlock.sets,
      intensity: strengthBlock.intensity,
      rpe: strengthBlock.rpe,
      focus: strengthBlock.focus,
    },
  });
}
