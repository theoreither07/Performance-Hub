import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { subDays, startOfDay } from "date-fns";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const days = Math.min(180, Math.max(1, Number(searchParams.get("days") ?? "30")));

  const since = startOfDay(subDays(new Date(), days - 1));

  const [metrics, lastRun] = await Promise.all([
    prisma.healthMetric.findMany({
      where: { date: { gte: since } },
      orderBy: [{ date: "asc" }, { kind: "asc" }],
    }),
    prisma.garminSyncRun.findFirst({ orderBy: { startedAt: "desc" } }),
  ]);

  // Pivot: pro kind ein Array mit { date, value, meta }
  const byKind: Record<string, { date: string; value: number; meta: unknown }[]> = {};
  for (const m of metrics) {
    const key = m.kind;
    byKind[key] = byKind[key] ?? [];
    byKind[key].push({
      date: m.date.toISOString().slice(0, 10),
      value: m.value,
      meta: m.meta,
    });
  }

  return NextResponse.json({
    metrics: byKind,
    lastSync: lastRun
      ? {
          startedAt: lastRun.startedAt.toISOString(),
          finishedAt: lastRun.finishedAt?.toISOString() ?? null,
          success: lastRun.success,
          metricsWritten: lastRun.metricsWritten,
          error: lastRun.error,
        }
      : null,
  });
}
