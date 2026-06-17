import { NextResponse } from "next/server";
import { fetchEventsForRange } from "@/lib/api/google-calendar";
import { startOfDay, endOfDay, addDays } from "date-fns";

export const dynamic = "force-dynamic";

export async function GET() {
  const events = await fetchEventsForRange(startOfDay(new Date()), endOfDay(addDays(new Date(), 7)));
  return NextResponse.json({ events });
}
