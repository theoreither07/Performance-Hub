import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getCurrentUser } from "@/lib/api/get-user";
import { format, subDays } from "date-fns";

export const dynamic = "force-dynamic";

/**
 * Voice-Food-Memory: der User spricht (iOS Tastatur-Mic) eine Kurzzusammenfassung
 * dessen was er VORGESTERN/GESTERN gegessen hat. Wird als CoachMemory mit Key
 * `food-<YYYY-MM-DD>` gespeichert und vom Coach im Prompt referenziert.
 *
 * Keine Detail-Tracking, kein Kalorien-Zaehlen — nur lose Memory.
 */

const POST_SCHEMA = z.object({
  text: z.string().min(2).max(1500),
  // Datum auf das sich der Eintrag bezieht (Default: gestern, weil der User es morgens fuellt)
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function POST(req: Request) {
  const user = await getCurrentUser();
  const body = await req.json().catch(() => null);
  const parsed = POST_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", details: parsed.error.flatten() }, { status: 400 });
  }
  const date = parsed.data.date ?? format(subDays(new Date(), 1), "yyyy-MM-dd");
  const key = `food-${date}`;
  const text = parsed.data.text.trim();
  const memory = await prisma.coachMemory.upsert({
    where: { userId_key: { userId: user.id, key } },
    update: { content: text },
    create: { userId: user.id, key, content: text },
  });
  return NextResponse.json({ ok: true, memory: { key: memory.key, content: memory.content, updatedAt: memory.updatedAt } });
}

export async function GET() {
  const user = await getCurrentUser();
  // Letzte 14 Eintraege food-*
  const memories = await prisma.coachMemory.findMany({
    where: { userId: user.id, key: { startsWith: "food-" } },
    orderBy: { key: "desc" },
    take: 14,
  });
  return NextResponse.json({
    entries: memories.map((m) => ({
      date: m.key.replace(/^food-/, ""),
      content: m.content,
      updatedAt: m.updatedAt.toISOString(),
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
  await prisma.coachMemory.deleteMany({ where: { userId: user.id, key: `food-${date}` } });
  return NextResponse.json({ ok: true });
}
