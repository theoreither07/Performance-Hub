import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { checkMcpAuth } from "@/lib/api/mcp-auth";
import { subDays, startOfDay, format } from "date-fns";
import { naiveViennaToUtc } from "@/lib/utils/vienna-tz";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = checkMcpAuth(req);
  if (denied) return denied;
  const { searchParams } = new URL(req.url);
  const days = Math.min(180, Math.max(1, Number(searchParams.get("days") ?? "30")));
  const since = startOfDay(subDays(new Date(), days - 1));
  const workouts = await prisma.workoutSession.findMany({
    where: { date: { gte: since } },
    orderBy: { startTime: "desc" },
  });
  return NextResponse.json({
    workouts: workouts.map((w) => ({
      id: w.id,
      garminActivityId: w.garminActivityId ? w.garminActivityId.toString() : null,
      date: format(w.date, "yyyy-MM-dd"),
      startTime: naiveViennaToUtc(w.startTime).toISOString(),
      type: w.type,
      name: w.name,
      durationSec: w.durationSec,
      distanceM: w.distanceM,
      calories: w.calories,
      avgHr: w.avgHr,
      maxHr: w.maxHr,
      trainingLoad: w.trainingLoad,
      aerobicEffect: w.aerobicEffect,
      anaerobicEffect: w.anaerobicEffect,
      source: w.source,
      notes: w.notes,
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
  notes: z.string().optional(),
});

export async function POST(req: Request) {
  const denied = checkMcpAuth(req);
  if (denied) return denied;
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
      notes: body.notes ?? null,
      source: "manual",
    },
  });
  return NextResponse.json({ id: w.id });
}
