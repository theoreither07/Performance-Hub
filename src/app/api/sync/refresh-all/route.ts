import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/api/get-user";
import { invalidateHealthContext } from "@/lib/health/metrics-cache";
import fs from "fs/promises";

export const dynamic = "force-dynamic";

/**
 * POST /api/sync/refresh-all
 * Triggert eine frische Datenholung von externen Quellen:
 *   - Garmin: schreibt Trigger-Datei im shared /data Volume,
 *     der garmin-sync Loop greift sie und fuehrt python sync.py aus.
 *   - Server-In-Memory-HealthContext-Cache invalidieren (5min TTL),
 *     damit Score-Endpoint nach dem Garmin-Sync nicht weiterhin alte
 *     gecachete Metriken liefert.
 *
 * Die UI ruft danach React-Query-Invalidate + SW-Cache-Purge auf.
 */
export async function POST() {
  const user = await getCurrentUser();

  const triggered: string[] = [];
  const errors: string[] = [];

  // Garmin
  try {
    await fs.writeFile("/data/trigger-sync", String(Date.now()));
    triggered.push("garmin");
  } catch (e) {
    errors.push(`garmin: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Server-Cache leeren — wird beim naechsten Score/Coach-Request frisch nachgeladen.
  invalidateHealthContext(user.id);
  triggered.push("health-context-cache");

  return NextResponse.json({ ok: true, triggered, errors, at: new Date().toISOString() });
}
