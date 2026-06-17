import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getCurrentUser } from "@/lib/api/get-user";

export const dynamic = "force-dynamic";

const GOAL_TYPES = ["race", "weight", "vo2max", "5km_tt", "10km_tt"] as const;

const POST_SCHEMA = z.object({
  type: z.enum(GOAL_TYPES),
  name: z.string().min(2).max(120),
  targetValue: z.number().nullable().optional(),
  targetUnit: z.string().max(20).nullable().optional(),
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  startValue: z.number().nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
  active: z.boolean().optional(),
});

const PATCH_SCHEMA = POST_SCHEMA.partial().extend({
  id: z.string(),
});

export async function GET() {
  const user = await getCurrentUser();
  const goals = await prisma.longTermGoal.findMany({
    where: { userId: user.id },
    orderBy: [{ active: "desc" }, { targetDate: "asc" }],
  });
  return NextResponse.json({ goals });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  const body = await req.json().catch(() => null);
  const parsed = POST_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", details: parsed.error.flatten() }, { status: 400 });
  }
  const created = await prisma.longTermGoal.create({
    data: {
      userId: user.id,
      type: parsed.data.type,
      name: parsed.data.name,
      targetValue: parsed.data.targetValue ?? null,
      targetUnit: parsed.data.targetUnit ?? null,
      targetDate: new Date(parsed.data.targetDate),
      startDate: parsed.data.startDate ? new Date(parsed.data.startDate) : new Date(),
      startValue: parsed.data.startValue ?? null,
      notes: parsed.data.notes ?? null,
      active: parsed.data.active ?? true,
    },
  });
  return NextResponse.json({ goal: created });
}

export async function PATCH(req: Request) {
  const user = await getCurrentUser();
  const body = await req.json().catch(() => null);
  const parsed = PATCH_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", details: parsed.error.flatten() }, { status: 400 });
  }
  const { id, ...rest } = parsed.data;
  const updated = await prisma.longTermGoal.updateMany({
    where: { id, userId: user.id },
    data: {
      ...(rest.type !== undefined && { type: rest.type }),
      ...(rest.name !== undefined && { name: rest.name }),
      ...(rest.targetValue !== undefined && { targetValue: rest.targetValue }),
      ...(rest.targetUnit !== undefined && { targetUnit: rest.targetUnit }),
      ...(rest.targetDate !== undefined && { targetDate: new Date(rest.targetDate) }),
      ...(rest.startDate !== undefined && { startDate: new Date(rest.startDate) }),
      ...(rest.startValue !== undefined && { startValue: rest.startValue }),
      ...(rest.notes !== undefined && { notes: rest.notes }),
      ...(rest.active !== undefined && { active: rest.active }),
    },
  });
  return NextResponse.json({ updated: updated.count });
}

export async function DELETE(req: Request) {
  const user = await getCurrentUser();
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id_required" }, { status: 400 });
  await prisma.longTermGoal.deleteMany({ where: { id, userId: user.id } });
  return NextResponse.json({ ok: true });
}
