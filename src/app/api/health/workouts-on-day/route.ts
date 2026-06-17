/**
 * GET /api/health/workouts-on-day?date=YYYY-MM-DD
 *
 * Liefert alle Workouts an einem Tag (slim) — wird vom "Workout-Picker" beim
 * "Erledigt"-Klick in der TrainingsTodayCard genutzt: User waehlt explizit welche
 * Garmin-Activity zur geplanten Session gehoert.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getCurrentUser } from "@/lib/api/get-user";
import { viennaHhMm } from "@/lib/utils/vienna-tz";

export const dynamic = "force-dynamic";

/**
 * TZ-SAFE Datum-Match: Python-Sync schreibt Workout.date als naive Vienna-Datum,
 * Prisma liest's als UTC-midnight. Wir nutzen einen direkten UTC-Match, kein date-fns
 * `startOfDay()` (das im Container Vienna-TZ-shift macht und Workouts vom Vortag
 * mit reinzieht).
 *
 * startTime wird auch als naive Vienna-time in DB geschrieben, von Prisma als UTC
 * gelesen — wir formatieren via getUTCHours/Minutes für korrekte Anzeige.
 */
function pad(n: number): string { return n.toString().padStart(2, "0"); }

export async function GET(req: Request) {
  await getCurrentUser();
  const { searchParams } = new URL(req.url);
  const dateStr = searchParams.get("date");
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return NextResponse.json({ error: "date param erforderlich (YYYY-MM-DD)" }, { status: 400 });
  }
  const [y, m, d] = dateStr.split("-").map(Number);
  // Exakter Tag-Match per UTC-midnight (DB-Column ist @db.Date = nur Datum, UTC normalisiert).
  const dayStart = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  const dayEnd = new Date(Date.UTC(y, m - 1, d, 23, 59, 59));
  const workouts = await prisma.workoutSession.findMany({
    where: { date: { gte: dayStart, lte: dayEnd } },
    orderBy: { startTime: "asc" },
  });
  // Defense: dedup per ID/garminActivityId UND prüfe dass date wirklich der angefragte Tag ist
  const filtered = workouts.filter((w) => {
    const wDate = `${w.date.getUTCFullYear()}-${pad(w.date.getUTCMonth() + 1)}-${pad(w.date.getUTCDate())}`;
    return wDate === dateStr;
  });
  // Dedup per garminActivityId (sollte unique sein, aber defense in depth) UND per id.
  const seenIds = new Set<string>();
  const seenGarmin = new Set<string>();
  const unique = filtered.filter((w) => {
    if (seenIds.has(w.id)) return false;
    seenIds.add(w.id);
    if (w.garminActivityId != null) {
      const gid = w.garminActivityId.toString();
      if (seenGarmin.has(gid)) return false;
      seenGarmin.add(gid);
    }
    return true;
  });
  return NextResponse.json({
    workouts: unique.map((w) => ({
      id: w.id,
      type: w.type,
      name: w.name,
      // TZ-fix via util: Vienna-Wall-Time aus naive-as-UTC startTime.
      startTime: viennaHhMm(w.startTime),
      durationMin: Math.round(w.durationSec / 60),
      distanceKm: w.distanceM ? +(w.distanceM / 1000).toFixed(2) : null,
      avgHr: w.avgHr,
      trainingLoad: w.trainingLoad ? Math.round(w.trainingLoad) : null,
      source: w.source,
    })),
  });
}
