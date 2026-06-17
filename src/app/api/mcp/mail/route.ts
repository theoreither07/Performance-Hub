import { NextResponse } from "next/server";
import { checkMcpAuth } from "@/lib/api/mcp-auth";
import { fetchMessages, getUnreadCounts } from "@/lib/api/gmail";

export const dynamic = "force-dynamic";

// GET /api/mcp/mail?account=PRIVATE|BUSINESS&query=...&max=N
// Default-Query: unread im Inbox. Andere Beispiele:
//   "is:starred", "from:max@example.com", "after:2026/05/01", "label:wichtig"
export async function GET(req: Request) {
  const denied = checkMcpAuth(req);
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const summaryOnly = searchParams.get("summary") === "1";

  if (summaryOnly) {
    const counts = await getUnreadCounts();
    return NextResponse.json({ unreadCounts: counts });
  }

  const account = searchParams.get("account");
  const query = searchParams.get("query") ?? "is:unread in:inbox";
  const max = Number(searchParams.get("max") ?? "20");

  const messages = await fetchMessages({
    accountKind: account === "PRIVATE" || account === "BUSINESS" ? account : undefined,
    query,
    maxResults: max,
  });

  return NextResponse.json({
    query,
    account: account ?? "both",
    messages,
  });
}
