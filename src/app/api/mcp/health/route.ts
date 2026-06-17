import { NextResponse } from "next/server";
import { checkMcpAuth } from "@/lib/api/mcp-auth";
import { prisma } from "@/lib/db/prisma";
import { subDays, startOfDay } from "date-fns";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = checkMcpAuth(req);
  if (denied) return denied;
  const { searchParams } = new URL(req.url);
  const days = Math.min(180, Math.max(1, Number(searchParams.get("days") ?? "14")));
  const since = startOfDay(subDays(new Date(), days - 1));

  const metrics = await prisma.healthMetric.findMany({
    where: { date: { gte: since } },
    orderBy: [{ date: "asc" }],
  });

  const byKind: Record<string, { date: string; value: number }[]> = {};
  for (const m of metrics) {
    const key = m.kind;
    byKind[key] = byKind[key] ?? [];
    byKind[key].push({ date: m.date.toISOString().slice(0, 10), value: m.value });
  }

  const summary: Record<string, { latest: number | null; avg7: number | null }> = {};
  for (const [kind, arr] of Object.entries(byKind)) {
    const latest = arr[arr.length - 1]?.value ?? null;
    const last7 = arr.slice(-7);
    const avg7 = last7.length > 0 ? last7.reduce((s, v) => s + v.value, 0) / last7.length : null;
    summary[kind] = { latest, avg7 };
  }

  return NextResponse.json({ days, summary, series: byKind });
}
