/**
 * Test-Push (User-Session) — schickt eine Test-Notification an alle eigenen Subscriptions.
 * UI nutzt das zum Verifizieren ob Notifications laufen.
 */
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/api/get-user";
import { sendPushToUser } from "@/lib/push/web-push";

export const dynamic = "force-dynamic";

export async function POST() {
  const user = await getCurrentUser();
  const result = await sendPushToUser(user.id, {
    title: "Test-Notification ✓",
    body: "Push-Notifications funktionieren. Coach kann dir jetzt morgens & abends senden.",
    url: "/health",
    tag: "test",
  });
  return NextResponse.json({ ok: true, ...result });
}
