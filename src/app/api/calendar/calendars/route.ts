import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { syncCalendarsForAccount } from "@/lib/api/google-calendar";
import { getCurrentUser } from "@/lib/api/get-user";

export const dynamic = "force-dynamic";

/**
 * GET: Liste aller Kalender des Users (alle Accounts).
 * Query ?sync=1 triggert vorher einen Sync mit Google.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  const { searchParams } = new URL(req.url);
  const shouldSync = searchParams.get("sync") === "1";

  const accounts = await prisma.googleAccount.findMany({
    where: { userId: user.id, refreshToken: { not: "" } },
    include: { _count: { select: { calendars: true } } },
  });

  // Auto-sync: wenn ein verbundener Account noch keine Calendars hat,
  // einmalig im Hintergrund synchronisieren (passiert bei Accounts die vor
  // dem Calendar-Sync-Feature verbunden wurden).
  const needsAutoSync = accounts.some((a) => a._count.calendars === 0);
  if (shouldSync || needsAutoSync) {
    for (const acc of accounts) {
      if (!shouldSync && acc._count.calendars > 0) continue;
      try {
        await syncCalendarsForAccount(acc.id);
      } catch (err) {
        console.error(`[calendars] sync failed for ${acc.email}`, err);
      }
    }
  }

  const calendars = await prisma.calendar.findMany({
    where: { googleAccount: { userId: user.id } },
    include: { googleAccount: { select: { email: true, kind: true } } },
    orderBy: [{ primary: "desc" }, { summary: "asc" }],
  });

  return NextResponse.json({
    calendars: calendars.map((c) => ({
      id: c.id,
      calendarId: c.calendarId,
      summary: c.summary,
      description: c.description,
      backgroundColor: c.backgroundColor,
      accessRole: c.accessRole,
      primary: c.primary,
      enabled: c.enabled,
      accountEmail: c.googleAccount.email,
      accountKind: c.googleAccount.kind,
    })),
  });
}

const patchSchema = z.object({
  updates: z.array(z.object({ id: z.string(), enabled: z.boolean() })),
});

export async function PATCH(req: Request) {
  const user = await getCurrentUser();
  const body = patchSchema.parse(await req.json());

  for (const upd of body.updates) {
    // Sicherheit: nur Calendars des aktuellen Users updaten
    const cal = await prisma.calendar.findFirst({
      where: { id: upd.id, googleAccount: { userId: user.id } },
    });
    if (!cal) continue;
    await prisma.calendar.update({
      where: { id: upd.id },
      data: { enabled: upd.enabled },
    });
  }

  return NextResponse.json({ ok: true });
}
