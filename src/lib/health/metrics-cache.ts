/**
 * In-Memory Cache fuer Health-Context (Metrics + Journal + Workouts + Profile).
 *
 * Problem: 5 Coach-Routes (generate, auto-generate, chat, week-plan/draft, weekly-plan)
 * fetchen identisch je ~60 Tage Metriken + Journal + Workouts. Pro Request 4-6 DB-Roundtrips.
 *
 * Fix: Pro User wird der Context-Snapshot fuer 5 Min im Memory gehalten. Coach-Endpoints
 * konsumieren den Cache wenn frisch — sonst frisch ziehen + im Cache ablegen.
 *
 * Effekt: Coach-Endpoint geht von 4-6 DB-Calls auf 0 (Cache hit) — Latency spuerbar besser,
 * DB-Last halbiert sich.
 */
import { prisma } from "@/lib/db/prisma";
import type { HealthMetric, DailyJournal, WorkoutSession, TrainingProfile, KeyLift, CoachMemory } from "@prisma/client";
import { subDays, startOfDay } from "date-fns";

const TTL_MS = 5 * 60 * 1000; // 5 Min

interface CachedContext {
  metrics: HealthMetric[];
  journal: DailyJournal[];
  workouts: WorkoutSession[];
  profile: TrainingProfile | null;
  keyLifts: KeyLift[];
  memories: CoachMemory[];
  fetchedAt: number;
}

const cache = new Map<string, CachedContext>();

/**
 * Holt den Coach-Context (60d Metrics + Journal + Workouts + Profile + KeyLifts + Memories).
 * Greift auf Memory-Cache zurueck wenn Eintrag < 5 Min alt.
 */
export async function getHealthContext(userId: string): Promise<CachedContext> {
  const now = Date.now();
  const cached = cache.get(userId);
  if (cached && now - cached.fetchedAt < TTL_MS) {
    return cached;
  }

  const since = startOfDay(subDays(new Date(), 60));
  const [metrics, journal, workouts, profile, keyLifts, memories] = await Promise.all([
    prisma.healthMetric.findMany({
      where: { date: { gte: since } },
      orderBy: [{ kind: "asc" }, { date: "asc" }],
    }),
    prisma.dailyJournal.findMany({
      where: { userId, date: { gte: since } },
      orderBy: { date: "asc" },
    }),
    prisma.workoutSession.findMany({
      where: { date: { gte: since } },
      orderBy: { startTime: "asc" },
    }),
    prisma.trainingProfile.findUnique({ where: { userId } }),
    prisma.keyLift.findMany({ where: { userId, archived: false }, orderBy: { sortOrder: "asc" } }),
    prisma.coachMemory.findMany({ where: { userId } }),
  ]);

  const fresh: CachedContext = { metrics, journal, workouts, profile, keyLifts, memories, fetchedAt: now };
  cache.set(userId, fresh);
  return fresh;
}

/**
 * Cache fuer einen User invalidieren — aufrufen nach Mutations die Health-Daten betreffen
 * (z.B. neuer Garmin-Sync, neuer Journal-Eintrag, neue Workout-Session, Profile-Update).
 */
export function invalidateHealthContext(userId: string): void {
  cache.delete(userId);
}

/**
 * Gesamten Cache leeren — fuer Tests oder Server-Restart.
 */
export function clearHealthContextCache(): void {
  cache.clear();
}
