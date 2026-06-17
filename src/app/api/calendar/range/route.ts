import { NextResponse } from "next/server";
import { fetchEventsForRange } from "@/lib/api/google-calendar";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");

  if (!fromParam || !toParam) {
    return NextResponse.json({ error: "from/to required (ISO)" }, { status: 400 });
  }

  const from = new Date(fromParam);
  const to = new Date(toParam);
  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    return NextResponse.json({ error: "invalid dates" }, { status: 400 });
  }
  // Schutz vor zu grossen Ranges (Monatsansicht braucht max ~42 Tage)
  const maxRange = 1000 * 60 * 60 * 24 * 90;
  if (to.getTime() - from.getTime() > maxRange) {
    return NextResponse.json({ error: "range too large" }, { status: 400 });
  }

  const events = await fetchEventsForRange(from, to);
  return NextResponse.json({ events });
}
