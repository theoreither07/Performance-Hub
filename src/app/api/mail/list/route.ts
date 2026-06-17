import { NextResponse } from "next/server";
import { fetchMessages } from "@/lib/api/gmail";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const account = searchParams.get("account");
  const query = searchParams.get("query") ?? "is:unread in:inbox";
  const max = Number(searchParams.get("max") ?? "25");

  const messages = await fetchMessages({
    accountKind: account === "PRIVATE" || account === "BUSINESS" ? account : undefined,
    query,
    maxResults: max,
  });

  return NextResponse.json({ messages });
}
