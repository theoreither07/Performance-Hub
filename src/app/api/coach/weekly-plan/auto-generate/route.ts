import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { generateWeeklyPlanForUser } from "../route";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

const PRIMARY_EMAIL = process.env.PRIMARY_EMAIL ?? "";

export async function POST(req: Request) {
  const expected = process.env.COACH_CRON_TOKEN;
  const provided = req.headers.get("x-cron-token");
  if (!expected || expected.length < 16) {
    return NextResponse.json({ error: "COACH_CRON_TOKEN not configured" }, { status: 503 });
  }
  if (provided !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const user = await prisma.user.findUnique({ where: { email: PRIMARY_EMAIL } });
  if (!user) return NextResponse.json({ error: "primary user not found" }, { status: 404 });

  const result = await generateWeeklyPlanForUser(user.id);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 502 });
  return NextResponse.json({ ok: true, provider: result.provider, model: result.model, weekStart: result.weekStart });
}
