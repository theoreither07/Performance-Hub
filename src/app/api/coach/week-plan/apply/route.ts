/**
 * Phase 4 — POST schreibt den aktuellen Plan in den privaten Google-Kalender.
 * Alte Coach-Managed-Events der Ziel-Woche werden ersetzt; Business + nicht-Coach-Events
 * bleiben unangetastet.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/api/get-user";
import { applyWeekPlanForUser } from "@/lib/coach/week-plan-apply";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const schema = z.object({
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function POST(req: Request) {
  const user = await getCurrentUser();
  const body = req.body ? schema.parse(await req.json().catch(() => ({}))) : {};
  const result = await applyWeekPlanForUser(user.id, body.weekStart);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status ?? 502 });
  return NextResponse.json(result);
}
