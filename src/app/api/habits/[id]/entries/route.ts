import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getCurrentUser } from "@/lib/api/get-user";
import { startOfDay } from "date-fns";

export const dynamic = "force-dynamic";

const toggleSchema = z.object({
  date: z.string().optional(),  // ISO date, default = today
  done: z.boolean(),             // true = mark, false = unmark
  note: z.string().optional(),
  value: z.number().optional(),
});

/**
 * POST /api/habits/:id/entries
 * Toggle eintrag fuer einen Tag (default heute).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  const { id: habitId } = await params;
  const body = toggleSchema.parse(await req.json());

  const habit = await prisma.habit.findUnique({ where: { id: habitId } });
  if (!habit || habit.userId !== user.id) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const date = startOfDay(body.date ? new Date(body.date) : new Date());

  if (body.done) {
    await prisma.habitEntry.upsert({
      where: { habitId_date: { habitId, date } },
      update: { note: body.note ?? null, value: body.value ?? null },
      create: { habitId, date, note: body.note ?? null, value: body.value ?? null },
    });
  } else {
    await prisma.habitEntry.deleteMany({ where: { habitId, date } });
  }

  return NextResponse.json({ ok: true });
}
