import { NextResponse } from "next/server";
import { getUnreadCounts } from "@/lib/api/gmail";

export const dynamic = "force-dynamic";

export async function GET() {
  const counts = await getUnreadCounts();
  return NextResponse.json({ counts });
}
