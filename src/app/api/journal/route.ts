import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getCurrentUser } from "@/lib/api/get-user";
import { subDays, startOfDay } from "date-fns";

export const dynamic = "force-dynamic";

/**
 * TZ-sicher: parsed "YYYY-MM-DD" als UTC-noon Date, sodass Postgres @db.Date
 * den richtigen Tag speichert (verhindert Vienna→UTC-Drift bei Mitternacht-Werten).
 *
 * Beispiel: "2026-06-03" → 2026-06-03 12:00:00 UTC → Postgres date "2026-06-03".
 * Vorher: startOfDay(new Date("2026-06-03")) → 2026-06-02 22:00:00 UTC → date "2026-06-02".
 */
function parseDateSafe(input: string | Date): Date {
  if (input instanceof Date) {
    const y = input.getUTCFullYear();
    const m = input.getUTCMonth();
    const d = input.getUTCDate();
    return new Date(Date.UTC(y, m, d, 12, 0, 0));
  }
  const match = input.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return startOfDay(new Date(input));
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0));
}

/**
 * GET /api/journal?days=30
 * Liefert Journal-Eintraege der letzten N Tage (Tage ohne Eintrag werden weggelassen).
 *
 * GET /api/journal?date=YYYY-MM-DD
 * Liefert genau einen Eintrag (oder null).
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  const { searchParams } = new URL(req.url);
  const dateParam = searchParams.get("date");

  if (dateParam) {
    const date = parseDateSafe(dateParam);
    const entry = await prisma.dailyJournal.findUnique({
      where: { userId_date: { userId: user.id, date } },
    });
    return NextResponse.json({ entry: entry ? serialize(entry) : null });
  }

  const days = Math.min(365, Math.max(1, Number(searchParams.get("days") ?? "30")));
  const since = startOfDay(subDays(new Date(), days - 1));
  const entries = await prisma.dailyJournal.findMany({
    where: { userId: user.id, date: { gte: since } },
    orderBy: { date: "desc" },
  });
  return NextResponse.json({ entries: entries.map(serialize) });
}

const upsertSchema = z.object({
  date: z.string(),
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

/**
 * POST /api/journal
 * Upsert auf (userId, date). Idempotent.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  const body = upsertSchema.parse(await req.json());
  const date = parseDateSafe(body.date);

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
    where: { userId_date: { userId: user.id, date } },
    update: data,
    create: { userId: user.id, date, ...data },
  });
  return NextResponse.json({ entry: serialize(entry) });
}

function serialize(e: {
  id: string;
  date: Date;
  mood: number | null;
  energy: number | null;
  motivation: number | null;
  soreness: number | null;
  workoutFelt: number | null;
  sleepQuality: number | null;
  ateWell: boolean | null;
  alcoholDrinks: number | null;
  notes: string | null;
  updatedAt: Date;
}) {
  // Serialize date als YYYY-MM-DD via UTC. Mit dem UTC-noon-Save geht das tag-stabil.
  return {
    id: e.id,
    date: `${e.date.getUTCFullYear()}-${String(e.date.getUTCMonth() + 1).padStart(2, "0")}-${String(e.date.getUTCDate()).padStart(2, "0")}`,
    mood: e.mood,
    energy: e.energy,
    motivation: e.motivation,
    soreness: e.soreness,
    workoutFelt: e.workoutFelt,
    sleepQuality: e.sleepQuality,
    ateWell: e.ateWell,
    alcoholDrinks: e.alcoholDrinks,
    notes: e.notes,
    updatedAt: e.updatedAt.toISOString(),
  };
}
