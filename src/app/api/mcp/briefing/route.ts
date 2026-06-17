import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { checkMcpAuth } from "@/lib/api/mcp-auth";
import { fetchEventsForRange } from "@/lib/api/google-calendar";
import { getUnreadCounts, fetchMessages } from "@/lib/api/gmail";
import { startOfDay, endOfDay, addDays, subDays, format } from "date-fns";

export const dynamic = "force-dynamic";

const PRIMARY_EMAIL = process.env.PRIMARY_EMAIL ?? "";

async function getUserId(): Promise<string> {
  const u = await prisma.user.findUnique({ where: { email: PRIMARY_EMAIL } });
  if (!u) throw new Error("Primary user not found");
  return u.id;
}

function avg(arr: { value: number }[] | undefined, n = 7): number | null {
  if (!arr || arr.length === 0) return null;
  const slice = arr.slice(-n);
  return slice.reduce((s, v) => s + v.value, 0) / slice.length;
}

function latest(arr: { value: number; date: string }[] | undefined): number | null {
  if (!arr || arr.length === 0) return null;
  return arr[arr.length - 1].value;
}

/**
 * GET /api/mcp/briefing?days=1
 * Liefert ein kompaktes Briefing fuer Coaching-Prompts:
 * - Heutige Termine (+ optional naechste N Tage)
 * - Offene Top-Priority Todos pro Bereich
 * - Health-Highlights (HRV, Schlaf, Body Battery, Readiness)
 * - Habits-Status
 * - Wetter Wien
 * - Tagesweisheit (Kevin Kelly)
 * - Ungelesen-Mail-Counts
 */
export async function GET(req: Request) {
  const denied = checkMcpAuth(req);
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const daysAhead = Math.min(7, Math.max(1, Number(searchParams.get("days") ?? "1")));
  const userId = await getUserId();
  const today = new Date();
  const todayKey = format(today, "yyyy-MM-dd");

  // Parallel laden
  const [
    todayEvents,
    openTodos,
    overdueTodos,
    health,
    habits,
    weather,
    advice,
    mailCounts,
    importantMails,
  ] = await Promise.all([
    fetchEventsForRange(startOfDay(today), endOfDay(addDays(today, daysAhead - 1))),
    prisma.todo.findMany({
      where: {
        userId,
        status: { in: ["TODO", "IN_PROGRESS", "WAITING"] },
        OR: [
          { dueDate: { lte: endOfDay(addDays(today, daysAhead - 1)) } },
          { priority: { in: ["HIGH", "URGENT"] } },
        ],
      },
      include: { project: { select: { name: true, area: true } } },
      orderBy: [{ dueDate: "asc" }, { priority: "desc" }],
      take: 30,
    }),
    prisma.todo.findMany({
      where: {
        userId,
        status: { in: ["TODO", "IN_PROGRESS", "WAITING"] },
        dueDate: { lt: startOfDay(today) },
      },
      orderBy: { dueDate: "asc" },
      take: 10,
    }),
    prisma.healthMetric.findMany({
      where: { date: { gte: startOfDay(subDays(today, 13)) } },
      orderBy: { date: "asc" },
    }),
    prisma.habit.findMany({
      where: { userId, archived: false },
      include: { entries: { where: { date: { gte: startOfDay(subDays(today, 6)) } } } },
      orderBy: { sortOrder: "asc" },
    }),
    (async () => {
      try {
        const res = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${process.env.WEATHER_LAT ?? 48.2082}&longitude=${process.env.WEATHER_LON ?? 16.3738}&current=temperature_2m,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code&timezone=Europe%2FVienna&forecast_days=${daysAhead}`,
          { next: { revalidate: 600 } },
        );
        return await res.json();
      } catch {
        return null;
      }
    })(),
    (async () => {
      const count = await prisma.advice.count();
      if (count === 0) return null;
      // Same algorithm as the daily widget
      let h = 2166136261;
      for (let i = 0; i < todayKey.length; i++) {
        h ^= todayKey.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      const idx = Math.abs(h) % count;
      const list = await prisma.advice.findMany({ orderBy: { id: "asc" }, skip: idx, take: 1 });
      return list[0] ?? null;
    })(),
    (async () => {
      try {
        return await getUnreadCounts();
      } catch {
        return null;
      }
    })(),
    (async () => {
      try {
        return await fetchMessages({
          query: "is:unread in:inbox -category:promotions -category:social -category:updates",
          maxResults: 8,
        });
      } catch {
        return null;
      }
    })(),
  ]);

  // Health pivot
  const byKind: Record<string, { date: string; value: number }[]> = {};
  for (const m of health) {
    const k = m.kind;
    byKind[k] = byKind[k] ?? [];
    byKind[k].push({ date: format(m.date, "yyyy-MM-dd"), value: m.value });
  }

  // Habits pivot
  const habitsToday = habits.map((h) => {
    const todayDone = h.entries.some((e) => format(e.date, "yyyy-MM-dd") === todayKey);
    const last7Done = h.entries.length;
    return {
      id: h.id,
      name: h.name,
      doneToday: todayDone,
      last7DaysDone: last7Done,
      targetPerWeek: h.targetPerWeek,
    };
  });

  // Mail short summary
  const importantMailsSummary = importantMails
    ? importantMails.map((m) => ({
        from: m.from,
        subject: m.subject,
        accountKind: m.accountKind,
        snippet: m.snippet.slice(0, 200),
      }))
    : null;

  return NextResponse.json({
    date: today.toISOString(),
    daysAhead,
    calendar: {
      events: todayEvents.map((e) => ({
        title: e.title,
        start: e.start,
        end: e.end,
        kind: e.accountKind,
        location: e.location ?? null,
        allDay: e.allDay,
      })),
      counts: {
        total: todayEvents.length,
        business: todayEvents.filter((e) => e.accountKind === "BUSINESS").length,
        private: todayEvents.filter((e) => e.accountKind === "PRIVATE").length,
      },
    },
    todos: {
      overdue: overdueTodos.map((t) => ({
        id: t.id,
        title: t.title,
        area: t.area,
        priority: t.priority,
        dueDate: t.dueDate?.toISOString() ?? null,
      })),
      relevant: openTodos.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        area: t.area,
        priority: t.priority,
        status: t.status,
        dueDate: t.dueDate?.toISOString() ?? null,
        estimatedMinutes: t.estimatedMinutes,
        project: t.project?.name ?? null,
      })),
    },
    health: {
      hrv: { latest: latest(byKind.hrv_overnight), avg7: avg(byKind.hrv_overnight) },
      sleep_minutes: { latest: latest(byKind.sleep_minutes), avg7: avg(byKind.sleep_minutes) },
      sleep_score: { latest: latest(byKind.sleep_score), avg7: avg(byKind.sleep_score) },
      body_battery_high: { latest: latest(byKind.body_battery_high), avg7: avg(byKind.body_battery_high) },
      body_battery_low: { latest: latest(byKind.body_battery_low), avg7: avg(byKind.body_battery_low) },
      rhr: { latest: latest(byKind.rhr), avg7: avg(byKind.rhr) },
      training_readiness: { latest: latest(byKind.training_readiness), avg7: avg(byKind.training_readiness) },
      stress_avg: { latest: latest(byKind.stress_avg), avg7: avg(byKind.stress_avg) },
      steps: { latest: latest(byKind.steps), avg7: avg(byKind.steps) },
    },
    habits: habitsToday,
    weather: weather && weather.current ? {
      current: {
        temperature: weather.current.temperature_2m,
        weatherCode: weather.current.weather_code,
        windSpeed: weather.current.wind_speed_10m,
      },
      daily: (weather.daily?.time ?? []).map((d: string, i: number) => ({
        date: d,
        tempMin: weather.daily.temperature_2m_min[i],
        tempMax: weather.daily.temperature_2m_max[i],
        precipitation: weather.daily.precipitation_sum[i],
        weatherCode: weather.daily.weather_code[i],
      })),
    } : null,
    advice: advice ? { text: advice.text, category: advice.category } : null,
    mail: {
      unreadCounts: mailCounts ?? [],
      importantSample: importantMailsSummary,
    },
  });
}
