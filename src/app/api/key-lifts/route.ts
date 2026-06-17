import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getCurrentUser } from "@/lib/api/get-user";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  const lifts = await prisma.keyLift.findMany({
    where: { userId: user.id, archived: false },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return NextResponse.json({ lifts });
}

const upsertSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(60),
  unit: z.enum(["kg", "reps", "bw"]).default("kg"),
  current: z.number().nullable().optional(),
  currentReps: z.number().int().min(0).max(50).nullable().optional(),
  bestEver: z.number().nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  sortOrder: z.number().int().optional(),
});

export async function POST(req: Request) {
  const user = await getCurrentUser();
  const body = upsertSchema.parse(await req.json());
  if (body.id) {
    const lift = await prisma.keyLift.update({
      where: { id: body.id },
      data: {
        name: body.name,
        unit: body.unit,
        current: body.current ?? null,
        currentReps: body.currentReps ?? null,
        bestEver: body.bestEver ?? null,
        notes: body.notes ?? null,
        sortOrder: body.sortOrder ?? 0,
      },
    });
    return NextResponse.json({ lift });
  }
  const lift = await prisma.keyLift.upsert({
    where: { userId_name: { userId: user.id, name: body.name } },
    update: {
      unit: body.unit,
      current: body.current ?? null,
      currentReps: body.currentReps ?? null,
      bestEver: body.bestEver ?? null,
      notes: body.notes ?? null,
      sortOrder: body.sortOrder ?? 0,
    },
    create: {
      userId: user.id,
      name: body.name,
      unit: body.unit,
      current: body.current ?? null,
      currentReps: body.currentReps ?? null,
      bestEver: body.bestEver ?? null,
      notes: body.notes ?? null,
      sortOrder: body.sortOrder ?? 0,
    },
  });
  return NextResponse.json({ lift });
}

export async function DELETE(req: Request) {
  const user = await getCurrentUser();
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await prisma.keyLift.update({
    where: { id },
    data: { archived: true },
  });
  return NextResponse.json({ ok: true });
}
