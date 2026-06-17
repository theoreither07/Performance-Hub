import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getCurrentUser } from "@/lib/api/get-user";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().nullable().optional(),
  icon: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  targetPerWeek: z.number().int().min(1).max(7).optional(),
  archived: z.boolean().optional(),
});

async function assertOwner(habitId: string, userId: string) {
  const h = await prisma.habit.findUnique({ where: { id: habitId } });
  if (!h || h.userId !== userId) throw new Error("not_found");
  return h;
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  const { id } = await params;
  await assertOwner(id, user.id);
  const body = patchSchema.parse(await req.json());
  const habit = await prisma.habit.update({
    where: { id },
    data: {
      name: body.name,
      description: body.description === undefined ? undefined : body.description,
      icon: body.icon === undefined ? undefined : body.icon,
      color: body.color === undefined ? undefined : body.color,
      targetPerWeek: body.targetPerWeek,
      archived: body.archived,
    },
  });
  return NextResponse.json({ id: habit.id });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  const { id } = await params;
  await assertOwner(id, user.id);
  await prisma.habit.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
