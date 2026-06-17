/**
 * Manuelle Tabula rasa: loescht ALLE Trainings-Events einer Woche
 * (Coach-Managed + parseTrainingFromTitle-Matches). Business + private bleiben unangetastet.
 *
 * Auth: entweder User-Session ODER X-Cron-Token Header (fuer Server-Trigger).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getCurrentUser } from "@/lib/api/get-user";
import { clearWeekTrainingsForUser } from "@/lib/coach/week-plan-clear";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const PRIMARY_EMAIL = process.env.PRIMARY_EMAIL ?? "";

const schema = z.object({
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function POST(req: Request) {
  const body = req.body ? schema.parse(await req.json().catch(() => ({}))) : {};

  // Cron-Token-Auth bevorzugt (wenn Header da)
  const expected = process.env.COACH_CRON_TOKEN;
  const provided = req.headers.get("x-cron-token");
  let userId: string;
  if (provided && expected && provided === expected) {
    const u = await prisma.user.findUnique({ where: { email: PRIMARY_EMAIL } });
    if (!u) return NextResponse.json({ error: "primary user not found" }, { status: 404 });
    userId = u.id;
  } else {
    const user = await getCurrentUser();
    userId = user.id;
  }

  const result = await clearWeekTrainingsForUser(userId, body.weekStart);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status ?? 502 });
  return NextResponse.json(result);
}
