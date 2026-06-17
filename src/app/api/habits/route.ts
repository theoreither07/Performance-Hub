import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getCurrentUser } from "@/lib/api/get-user";
import { subDays, startOfDay, format } from "date-fns";

export const dynamic = "force-dynamic";

/**
 * GET /api/habits
 * Liefert alle aktiven Habits mit:
 *   - last 30 days entries
 *   - current streak (consecutive days back from today including today)
 *   - completion-rate ueber die last 30 days
 */
export async function GET() {
  const user = await getCurrentUser();
  const since = startOfDay(subDays(new Date(), 29));
  const todayKey = format(new Date(), "yyyy-MM-dd");

  const habits = await prisma.habit.findMany({
    where: { userId: user.id, archived: false },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: {
      entries: {
        where: { date: { gte: since } },
        orderBy: { date: "desc" },
      },
    },
  });

  const result = habits.map((h) => {
    const days = new Set(h.entries.map((e) => format(e.date, "yyyy-MM-dd")));

    // streak: consecutive days from today (or yesterday if today not yet done)
    let streak = 0;
    let cursor = new Date();
    cursor.setHours(0, 0, 0, 0);
    // Allow "missing today" — count streak from yesterday if today empty
    if (!days.has(format(cursor, "yyyy-MM-dd"))) {
      cursor = subDays(cursor, 1);
    }
    while (days.has(format(cursor, "yyyy-MM-dd"))) {
      streak++;
      cursor = subDays(cursor, 1);
    }

    return {
      id: h.id,
      name: h.name,
      description: h.description,
      icon: h.icon,
      color: h.color,
      targetPerWeek: h.targetPerWeek,
      doneToday: days.has(todayKey),
      streak,
      last30: Array.from({ length: 30 }).map((_, i) => {
        const d = subDays(new Date(), 29 - i);
        const k = format(d, "yyyy-MM-dd");
        return { date: k, done: days.has(k) };
      }),
      completionRate30: days.size / 30,
    };
  });

  return NextResponse.json({ habits: result });
}

const createSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().optional(),
  icon: z.string().optional(),
  color: z.string().optional(),
  targetPerWeek: z.number().int().min(1).max(7).optional(),
});

export async function POST(req: Request) {
  const user = await getCurrentUser();
  const body = createSchema.parse(await req.json());
  const last = await prisma.habit.findFirst({
    where: { userId: user.id },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  const habit = await prisma.habit.create({
    data: {
      userId: user.id,
      name: body.name,
      description: body.description ?? null,
      icon: body.icon ?? null,
      color: body.color ?? null,
      targetPerWeek: body.targetPerWeek ?? 7,
      sortOrder: (last?.sortOrder ?? 0) + 1,
    },
  });
  return NextResponse.json({ id: habit.id, name: habit.name });
}
