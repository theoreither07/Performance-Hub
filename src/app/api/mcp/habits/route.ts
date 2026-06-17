import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { checkMcpAuth } from "@/lib/api/mcp-auth";
import { subDays, startOfDay, format } from "date-fns";

export const dynamic = "force-dynamic";

const PRIMARY_EMAIL = process.env.PRIMARY_EMAIL ?? "";

async function getUserId(): Promise<string> {
  const u = await prisma.user.findUnique({ where: { email: PRIMARY_EMAIL } });
  if (!u) throw new Error("Primary user not found");
  return u.id;
}

export async function GET(req: Request) {
  const denied = checkMcpAuth(req);
  if (denied) return denied;
  const userId = await getUserId();
  const since = startOfDay(subDays(new Date(), 29));
  const todayKey = format(new Date(), "yyyy-MM-dd");

  const habits = await prisma.habit.findMany({
    where: { userId, archived: false },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: { entries: { where: { date: { gte: since } } } },
  });

  return NextResponse.json({
    habits: habits.map((h) => {
      const days = new Set(h.entries.map((e) => format(e.date, "yyyy-MM-dd")));
      let streak = 0;
      let cursor = new Date();
      cursor.setHours(0, 0, 0, 0);
      if (!days.has(format(cursor, "yyyy-MM-dd"))) cursor = subDays(cursor, 1);
      while (days.has(format(cursor, "yyyy-MM-dd"))) {
        streak++;
        cursor = subDays(cursor, 1);
      }
      return {
        id: h.id,
        name: h.name,
        targetPerWeek: h.targetPerWeek,
        doneToday: days.has(todayKey),
        streak,
        last30Days: days.size,
        completionRate30: days.size / 30,
      };
    }),
  });
}

const createSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().optional(),
  color: z.string().optional(),
  targetPerWeek: z.number().int().min(1).max(7).optional(),
});

export async function POST(req: Request) {
  const denied = checkMcpAuth(req);
  if (denied) return denied;
  const userId = await getUserId();
  const body = createSchema.parse(await req.json());
  const last = await prisma.habit.findFirst({
    where: { userId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  const habit = await prisma.habit.create({
    data: {
      userId,
      name: body.name,
      description: body.description ?? null,
      color: body.color ?? null,
      targetPerWeek: body.targetPerWeek ?? 7,
      sortOrder: (last?.sortOrder ?? 0) + 1,
    },
  });
  return NextResponse.json({ id: habit.id, name: habit.name });
}
