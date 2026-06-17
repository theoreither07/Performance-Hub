/**
 * Wochenplaner Phase 3 — POST verfeinert einen bestehenden Wochenplan-Draft basierend auf
 * des Users Text-Feedback. Dünner Wrapper um refineWeekPlanForUser (Library), damit auch der
 * Chat-Coach die Logik aufrufen kann.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/api/get-user";
import { refineWeekPlanForUser } from "@/lib/coach/week-plan-refine";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const refineSchema = z.object({
  feedback: z.string().min(1).max(4000),
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser();
    const body = refineSchema.parse(await req.json());
    console.log("[week-plan/refine] POST start", { userId: user.id, weekStart: body.weekStart, feedbackLen: body.feedback.length });
    const result = await refineWeekPlanForUser(user.id, body.feedback, body.weekStart);
    if ("error" in result) {
      console.error("[week-plan/refine] returned error:", result.error);
      return NextResponse.json({ error: result.error }, { status: result.status ?? 502 });
    }
    console.log("[week-plan/refine] POST success");
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[week-plan/refine] FATAL:", err);
    return NextResponse.json({ error: `Server-Fehler: ${msg}` }, { status: 500 });
  }
}
