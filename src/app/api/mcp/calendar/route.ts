import { NextResponse } from "next/server";
import { checkMcpAuth } from "@/lib/api/mcp-auth";
import { fetchEventsForRange } from "@/lib/api/google-calendar";
import { startOfDay, endOfDay, addDays } from "date-fns";

export const dynamic = "force-dynamic";

// GET /api/mcp/calendar?days=1   (1 = heute, 7 = naechste Woche)
export async function GET(req: Request) {
  const denied = checkMcpAuth(req);
  if (denied) return denied;
  const { searchParams } = new URL(req.url);
  const days = Math.min(31, Math.max(1, Number(searchParams.get("days") ?? "1")));

  const from = startOfDay(new Date());
  const to = endOfDay(addDays(new Date(), days - 1));
  const events = await fetchEventsForRange(from, to);
  return NextResponse.json({ from: from.toISOString(), to: to.toISOString(), events });
}
