import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { checkMcpAuth } from "@/lib/api/mcp-auth";
import { startOfDay, subDays, format } from "date-fns";

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
  const { searchParams } = new URL(req.url);
  const userId = await getUserId();
  const dateParam = searchParams.get("date");

  if (dateParam) {
    const date = startOfDay(new Date(dateParam));
    const entry = await prisma.dailyJournal.findUnique({
      where: { userId_date: { userId, date } },
    });
    return NextResponse.json({ entry });
  }
  const days = Math.min(60, Math.max(1, Number(searchParams.get("days") ?? "14")));
  const since = startOfDay(subDays(new Date(), days - 1));
  const entries = await prisma.dailyJournal.findMany({
    where: { userId, date: { gte: since } },
    orderBy: { date: "desc" },
  });
  return NextResponse.json({
    entries: entries.map((e) => ({ ...e, date: format(e.date, "yyyy-MM-dd") })),
  });
}

const upsertSchema = z.object({
  date: z.string().optional(),
  mood: z.number().int().min(1).max(10).nullable().optional(),
  energy: z.number().int().min(1).max(10).nullable().optional(),
  motivation: z.number().int().min(1).max(10).nullable().optional(),
  soreness: z.number().int().min(1).max(10).nullable().optional(),
  workoutFelt: z.number().int().min(1).max(10).nullable().optional(),
  sleepQuality: z.number().int().min(1).max(10).nullable().optional(),
  ateWell: z.boolean().nullable().optional(),
  alcoholDrinks: z.number().int().min(0).max(30).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
});

export async function POST(req: Request) {
  const denied = checkMcpAuth(req);
  if (denied) return denied;
  const userId = await getUserId();
  const body = upsertSchema.parse(await req.json());
  const date = startOfDay(body.date ? new Date(body.date) : new Date());

  const data = {
    mood: body.mood ?? null,
    energy: body.energy ?? null,
    motivation: body.motivation ?? null,
    soreness: body.soreness ?? null,
    workoutFelt: body.workoutFelt ?? null,
    sleepQuality: body.sleepQuality ?? null,
    ateWell: body.ateWell ?? null,
    alcoholDrinks: body.alcoholDrinks ?? null,
    notes: body.notes ?? null,
  };
  const entry = await prisma.dailyJournal.upsert({
    where: { userId_date: { userId, date } },
    update: data,
    create: { userId, date, ...data },
  });
  return NextResponse.json({ id: entry.id, date: format(entry.date, "yyyy-MM-dd") });
}
