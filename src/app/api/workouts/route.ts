import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getCurrentUser } from "@/lib/api/get-user";
import { subDays, startOfDay } from "date-fns";
import { naiveViennaToUtc } from "@/lib/utils/vienna-tz";

export const dynamic = "force-dynamic";

/**
 * GET /api/workouts?days=30
 * Listet Workouts (Garmin + manuell) der letzten N Tage.
 */
export async function GET(req: Request) {
  await getCurrentUser();
  const { searchParams } = new URL(req.url);
  const days = Math.min(365, Math.max(1, Number(searchParams.get("days") ?? "30")));
  const since = startOfDay(subDays(new Date(), days - 1));

  const workouts = await prisma.workoutSession.findMany({
    where: { date: { gte: since } },
    orderBy: { startTime: "desc" },
  });

  return NextResponse.json({
    workouts: workouts.map((w) => ({
      id: w.id,
      garminActivityId: w.garminActivityId ? w.garminActivityId.toString() : null,
      date: w.date.toISOString().slice(0, 10),
      startTime: naiveViennaToUtc(w.startTime).toISOString(),
      type: w.type,
      name: w.name,
      durationSec: w.durationSec,
      distanceM: w.distanceM,
      calories: w.calories,
      avgHr: w.avgHr,
      maxHr: w.maxHr,
      avgPower: w.avgPower,
      trainingLoad: w.trainingLoad,
      aerobicEffect: w.aerobicEffect,
      anaerobicEffect: w.anaerobicEffect,
      hrZones: w.hrZones,
      notes: w.notes,
      rpe: w.rpe,
      feeling: w.feeling,
      source: w.source,
    })),
  });
}

const createSchema = z.object({
  date: z.string(),
  startTime: z.string().optional(),
  type: z.string(),
  name: z.string().optional(),
  durationSec: z.number().int().min(1),
  distanceM: z.number().optional(),
  calories: z.number().optional(),
  avgHr: z.number().optional(),
  maxHr: z.number().optional(),
  avgPower: z.number().optional(),
  notes: z.string().optional(),
});

/**
 * POST /api/workouts
 * Manuelles Workout anlegen.
 */
export async function POST(req: Request) {
  await getCurrentUser();
  const body = createSchema.parse(await req.json());
  const date = new Date(body.date);
  const startTime = body.startTime ? new Date(body.startTime) : date;
  const w = await prisma.workoutSession.create({
    data: {
      date,
      startTime,
      type: body.type,
      name: body.name ?? null,
      durationSec: body.durationSec,
      distanceM: body.distanceM ?? null,
      calories: body.calories ?? null,
      avgHr: body.avgHr ?? null,
      maxHr: body.maxHr ?? null,
      avgPower: body.avgPower ?? null,
      notes: body.notes ?? null,
      source: "manual",
    },
  });
  return NextResponse.json({ id: w.id });
}
