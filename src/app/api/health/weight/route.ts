import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getCurrentUser } from "@/lib/api/get-user";
import { format, subDays } from "date-fns";

export const dynamic = "force-dynamic";

const POST_SCHEMA = z.object({
  weightKg: z.number().min(30).max(250),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  note: z.string().max(200).nullable().optional(),
});

export async function POST(req: Request) {
  const user = await getCurrentUser();
  const body = await req.json().catch(() => null);
  const parsed = POST_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", details: parsed.error.flatten() }, { status: 400 });
  }
  const dateStr = parsed.data.date ?? format(new Date(), "yyyy-MM-dd");
  // UTC-Midnight damit @db.Date korrekt speichert (sonst TZ-Drift)
  const dateUtc = new Date(dateStr + "T00:00:00Z");
  const entry = await prisma.bodyWeightEntry.upsert({
    where: { userId_date: { userId: user.id, date: dateUtc } },
    update: { weightKg: parsed.data.weightKg, note: parsed.data.note ?? null },
    create: { userId: user.id, date: dateUtc, weightKg: parsed.data.weightKg, note: parsed.data.note ?? null },
  });
  return NextResponse.json({
    ok: true,
    entry: { date: format(entry.date, "yyyy-MM-dd"), weightKg: entry.weightKg, note: entry.note },
  });
}

export async function GET() {
  const user = await getCurrentUser();
  const since = subDays(new Date(), 90);
  const entries = await prisma.bodyWeightEntry.findMany({
    where: { userId: user.id, date: { gte: since } },
    orderBy: { date: "asc" },
  });
  return NextResponse.json({
    entries: entries.map((e) => ({
      date: format(e.date, "yyyy-MM-dd"),
      weightKg: e.weightKg,
      note: e.note,
    })),
  });
}

export async function DELETE(req: Request) {
  const user = await getCurrentUser();
  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date_required" }, { status: 400 });
  }
  await prisma.bodyWeightEntry.deleteMany({
    where: { userId: user.id, date: new Date(date + "T00:00:00Z") },
  });
  return NextResponse.json({ ok: true });
}
