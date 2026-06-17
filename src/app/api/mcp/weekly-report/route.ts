import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { checkMcpAuth } from "@/lib/api/mcp-auth";
import { fetchEventsForRange } from "@/lib/api/google-calendar";
import {
  startOfWeek,
  endOfWeek,
  addWeeks,
  subDays,
  format,
  isAfter,
} from "date-fns";

export const dynamic = "force-dynamic";

const PRIMARY_EMAIL = process.env.PRIMARY_EMAIL ?? "";

async function getUserId(): Promise<string> {
  const u = await prisma.user.findUnique({ where: { email: PRIMARY_EMAIL } });
  if (!u) throw new Error("Primary user not found");
  return u.id;
}

/**
 * GET /api/mcp/weekly-report
 * Review der letzten Woche + Setup fuer die kommende Woche.
 * Liefert:
 *  - Erledigte vs offene Todos der letzten 7 Tage (pro Bereich)
 *  - Habits: completion-rate letzte 7 Tage pro Habit
 *  - Health-Trend: avg HRV, Schlaf, RHR letzte 7 vs vorletzte 7 Tage
 *  - Kalender naechste Woche (Terminreichtum)
 *  - Anstehende Deadlines naechste 14 Tage
 */
export async function GET(req: Request) {
  const denied = checkMcpAuth(req);
  if (denied) return denied;

  const userId = await getUserId();
  const now = new Date();
  const last7Start = subDays(now, 7);
  const last14Start = subDays(now, 14);
  const nextWeekStart = startOfWeek(addWeeks(now, 1), { weekStartsOn: 1 });
  const nextWeekEnd = endOfWeek(addWeeks(now, 1), { weekStartsOn: 1 });

  const [todosCompletedLast7, todosOpenAll, habits, health, upcomingEvents, upcomingDeadlines] =
    await Promise.all([
      prisma.todo.findMany({
        where: {
          userId,
          status: "DONE",
          completedAt: { gte: last7Start },
        },
        include: { project: { select: { name: true } } },
        orderBy: { completedAt: "desc" },
      }),
      prisma.todo.findMany({
        where: {
          userId,
          status: { in: ["TODO", "IN_PROGRESS", "WAITING"] },
        },
      }),
      prisma.habit.findMany({
        where: { userId, archived: false },
        include: { entries: { where: { date: { gte: last7Start } } } },
        orderBy: { sortOrder: "asc" },
      }),
      prisma.healthMetric.findMany({
        where: { date: { gte: last14Start }, kind: { in: ["hrv_overnight", "sleep_minutes", "rhr", "body_battery_high", "training_readiness"] } },
        orderBy: { date: "asc" },
      }),
      fetchEventsForRange(nextWeekStart, nextWeekEnd),
      prisma.todo.findMany({
        where: {
          userId,
          status: { in: ["TODO", "IN_PROGRESS", "WAITING"] },
          dueDate: { gte: now, lte: subDays(now, -14) },
        },
        include: { project: { select: { name: true } } },
        orderBy: { dueDate: "asc" },
      }),
    ]);

  // Health: compare last7 vs prev7
  const last7: Record<string, number[]> = {};
  const prev7: Record<string, number[]> = {};
  const sevenDaysAgo = subDays(now, 7);
  for (const m of health) {
    const target = isAfter(m.date, sevenDaysAgo) ? last7 : prev7;
    target[m.kind] = target[m.kind] ?? [];
    target[m.kind].push(m.value);
  }
  const trend = (kind: string) => {
    const a = last7[kind] ?? [];
    const b = prev7[kind] ?? [];
    if (a.length === 0) return null;
    const avgA = a.reduce((s, v) => s + v, 0) / a.length;
    if (b.length === 0) return { last7: avgA, prev7: null, deltaPct: null };
    const avgB = b.reduce((s, v) => s + v, 0) / b.length;
    return { last7: avgA, prev7: avgB, deltaPct: avgB ? ((avgA - avgB) / avgB) * 100 : null };
  };

  // Todos breakdown
  const byArea = (todos: typeof todosOpenAll) => ({
    PRIVATE: todos.filter((t) => t.area === "PRIVATE").length,
    FH: todos.filter((t) => t.area === "FH").length,
    BUSINESS: todos.filter((t) => t.area === "BUSINESS").length,
  });

  return NextResponse.json({
    period: { from: last7Start.toISOString(), to: now.toISOString() },
    completed: {
      total: todosCompletedLast7.length,
      byArea: byArea(todosCompletedLast7),
      list: todosCompletedLast7.map((t) => ({
        title: t.title,
        area: t.area,
        priority: t.priority,
        project: t.project?.name ?? null,
        completedAt: t.completedAt?.toISOString() ?? null,
      })),
    },
    open: {
      total: todosOpenAll.length,
      byArea: byArea(todosOpenAll),
      overdue: todosOpenAll.filter((t) => t.dueDate && isAfter(now, t.dueDate)).length,
    },
    habits: habits.map((h) => ({
      name: h.name,
      target: h.targetPerWeek,
      done: h.entries.length,
      missed: Math.max(0, h.targetPerWeek - h.entries.length),
      rate: h.entries.length / h.targetPerWeek,
    })),
    health: {
      hrv: trend("hrv_overnight"),
      sleep_minutes: trend("sleep_minutes"),
      rhr: trend("rhr"),
      body_battery_high: trend("body_battery_high"),
      training_readiness: trend("training_readiness"),
    },
    nextWeek: {
      eventCount: upcomingEvents.length,
      businessEvents: upcomingEvents.filter((e) => e.accountKind === "BUSINESS").length,
      privateEvents: upcomingEvents.filter((e) => e.accountKind === "PRIVATE").length,
      events: upcomingEvents.map((e) => ({ title: e.title, start: e.start, kind: e.accountKind })),
    },
    upcomingDeadlines: upcomingDeadlines.map((t) => ({
      title: t.title,
      area: t.area,
      priority: t.priority,
      dueDate: t.dueDate?.toISOString(),
      project: t.project?.name ?? null,
    })),
  });
}
