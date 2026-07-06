import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getCurrentUser } from "@/lib/api/get-user";
import { subDays, startOfDay, format } from "date-fns";

export const dynamic = "force-dynamic";

/**
 * GET /api/health/nutrition?days=30
 * Ernaehrung (MyFitnessPal-Sync) pro Tag + Kalorienbilanz gegen Garmin-Verbrauch
 * (HealthMetric kind="calories", von garmin-sync geschrieben).
 */
export async function GET(req: Request) {
  await getCurrentUser();
  const { searchParams } = new URL(req.url);
  const days = Math.min(365, Math.max(1, Number(searchParams.get("days") ?? "30")));
  const since = startOfDay(subDays(new Date(), days - 1));

  const [nutrition, burned] = await Promise.all([
    prisma.nutritionLog.findMany({
      where: { date: { gte: since } },
      orderBy: { date: "asc" },
    }),
    prisma.healthMetric.findMany({
      where: { kind: "calories", date: { gte: since } },
      orderBy: { date: "asc" },
    }),
  ]);

  const burnedByDate = new Map(burned.map((m) => [format(m.date, "yyyy-MM-dd"), m.value]));

  return NextResponse.json({
    days: nutrition.map((n) => {
      const dateKey = format(n.date, "yyyy-MM-dd");
      const caloriesOut = burnedByDate.get(dateKey) ?? null;
      const caloriesIn = n.calories;
      return {
        date: dateKey,
        caloriesIn,
        caloriesOut,
        balance: caloriesIn !== null && caloriesOut !== null ? caloriesIn - caloriesOut : null,
        protein: n.protein,
        carbs: n.carbs,
        fat: n.fat,
        sodium: n.sodium,
        sugar: n.sugar,
        fiber: n.fiber,
        water: n.water,
        meals: n.meals,
      };
    }),
  });
}
