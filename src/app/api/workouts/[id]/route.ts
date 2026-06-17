import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getCurrentUser } from "@/lib/api/get-user";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  type: z.string().optional(),
  name: z.string().optional(),
  notes: z.string().nullable().optional(),
  durationSec: z.number().int().min(1).optional(),
  distanceM: z.number().optional(),
  calories: z.number().optional(),
  avgHr: z.number().optional(),
  maxHr: z.number().optional(),
  rpe: z.number().int().min(1).max(10).nullable().optional(),
  feeling: z.number().int().min(1).max(10).nullable().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await getCurrentUser();
  const { id } = await params;
  const body = patchSchema.parse(await req.json());
  const w = await prisma.workoutSession.update({ where: { id }, data: body });
  return NextResponse.json({ id: w.id });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await getCurrentUser();
  const { id } = await params;
  await prisma.workoutSession.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
