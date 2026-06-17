import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

// Deterministisch zufaelliger Advice pro Tag:
// Aus dem Datum (YYYY-MM-DD in Europe/Vienna) einen 32-bit-Hash bilden
// und modulo Anzahl der Advices nehmen. So sieht der User jeden Tag denselben
// Spruch, aber jeden Tag einen anderen.
function dailySeed(date: Date): number {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Vienna", year: "numeric", month: "2-digit", day: "2-digit" });
  const key = f.format(date);
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

export async function GET() {
  const count = await prisma.advice.count();
  if (count === 0) {
    return NextResponse.json({ advice: null });
  }
  const idx = dailySeed(new Date()) % count;
  // Skip-basiert holen — wir nutzen kein Id-Ordering, das ist robust
  // gegenueber geloeschten Eintraegen.
  const advice = await prisma.advice.findMany({
    orderBy: { id: "asc" },
    skip: idx,
    take: 1,
  });
  return NextResponse.json({ advice: advice[0] ?? null });
}
