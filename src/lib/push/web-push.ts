/**
 * Web-Push-Helper. Setzt VAPID-Keys aus env + sendet Push-Messages.
 */
import webpush from "web-push";
import { prisma } from "@/lib/db/prisma";

const publicKey = process.env.VAPID_PUBLIC_KEY ?? "";
const privateKey = process.env.VAPID_PRIVATE_KEY ?? "";
const subject = process.env.VAPID_SUBJECT ?? "mailto:admin@example.com";

let configured = false;
function ensureConfig() {
  if (configured) return true;
  if (!publicKey || !privateKey) return false;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return true;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string; // wohin beim Klick navigieren
  tag?: string; // Replace-Tag (so dass nicht mehrere Notifications stapeln)
}

export async function sendPushToUser(userId: string, payload: PushPayload): Promise<{ sent: number; removed: number }> {
  if (!ensureConfig()) return { sent: 0, removed: 0 };

  const subs = await prisma.pushSubscription.findMany({ where: { userId } });
  let sent = 0;
  let removed = 0;

  for (const s of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload),
      );
      sent += 1;
    } catch (err) {
      const e = err as { statusCode?: number; body?: string };
      // 404/410 = Subscription nicht mehr gueltig → loeschen
      if (e.statusCode === 404 || e.statusCode === 410) {
        await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => {});
        removed += 1;
      } else {
        console.error("[push] send failed", e.statusCode, e.body);
      }
    }
  }
  return { sent, removed };
}
