/**
 * Google Calendar Sync — schlank via direkt fetch() (ohne `googleapis` Paket).
 *
 * Spart ~3 MB Bundle-Size + Build-Time. Coverage identisch zur vorherigen Version
 * (calendarList Sync, fetchEventsForRange mit Dedup).
 */
import { prisma } from "@/lib/db/prisma";
import type { CalendarEvent } from "@/types/domain";
import { getAccessToken, calendarList, calendarEventsList } from "@/lib/api/google-fetch";

// Domain-Mapping: Kalender mit dieser Domain im Owner werden als BUSINESS
// gelabelt, egal ueber welchen Account-Connect sie reinkommen.
// Komma-getrennt aus BUSINESS_EMAIL_DOMAINS, sonst aus der Domain von GOOGLE_BUSINESS_EMAIL.
const BUSINESS_DOMAINS = (
  process.env.BUSINESS_EMAIL_DOMAINS ??
  (process.env.GOOGLE_BUSINESS_EMAIL?.split("@")[1] ?? "")
)
  .split(",")
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);

function classifyCalendar(calendarId: string, defaultKind: "PRIVATE" | "BUSINESS"): "PRIVATE" | "BUSINESS" {
  const lower = calendarId.toLowerCase();
  for (const dom of BUSINESS_DOMAINS) {
    if (lower.endsWith(`@${dom}`)) return "BUSINESS";
  }
  return defaultKind;
}

/**
 * Syncronisiert die Kalender-Liste eines Google-Accounts in unsere DB.
 * Behaelt enabled-State bestehender Eintraege.
 */
export async function syncCalendarsForAccount(googleAccountId: string): Promise<void> {
  const acc = await prisma.googleAccount.findUnique({ where: { id: googleAccountId } });
  if (!acc || !acc.refreshToken) return;

  const accessToken = await getAccessToken(acc.refreshToken);
  const res = await calendarList(accessToken, 250);
  const items = res.items ?? [];

  for (const cal of items) {
    if (!cal.id || !cal.summary) continue;
    await prisma.calendar.upsert({
      where: {
        googleAccountId_calendarId: {
          googleAccountId,
          calendarId: cal.id,
        },
      },
      update: {
        summary: cal.summary,
        description: cal.description ?? null,
        backgroundColor: cal.backgroundColor ?? null,
        accessRole: cal.accessRole ?? null,
        primary: cal.primary ?? false,
        syncedAt: new Date(),
      },
      create: {
        googleAccountId,
        calendarId: cal.id,
        summary: cal.summary,
        description: cal.description ?? null,
        backgroundColor: cal.backgroundColor ?? null,
        accessRole: cal.accessRole ?? null,
        primary: cal.primary ?? false,
        // Default: primary an, geteilte aus.
        // Holiday-Kalender wie "de.austrian#holiday@..." standardmaessig aus.
        enabled: cal.primary === true,
      },
    });
  }
}

export async function fetchEventsForRange(timeMin: Date, timeMax: Date): Promise<CalendarEvent[]> {
  const accounts = await prisma.googleAccount.findMany({
    where: { refreshToken: { not: "" } },
    include: { calendars: { where: { enabled: true } } },
  });
  if (accounts.length === 0) return [];

  const allEvents: CalendarEvent[] = [];

  for (const acc of accounts) {
    if (acc.calendars.length === 0) continue;
    try {
      const accessToken = await getAccessToken(acc.refreshToken);

      for (const cal of acc.calendars) {
        try {
          const res = await calendarEventsList(accessToken, cal.calendarId, {
            timeMin: timeMin.toISOString(),
            timeMax: timeMax.toISOString(),
            singleEvents: true,
            orderBy: "startTime",
            maxResults: 100,
          });
          for (const ev of res.items ?? []) {
            const start = ev.start?.dateTime ?? ev.start?.date;
            const end = ev.end?.dateTime ?? ev.end?.date;
            if (!start || !end) continue;
            if (ev.status === "cancelled") continue;

            const kind = classifyCalendar(cal.calendarId, acc.kind);

            allEvents.push({
              id: `${acc.kind}-${cal.calendarId}-${ev.id}`,
              accountEmail: acc.email,
              accountKind: kind,
              title: ev.summary ?? "(Kein Titel)",
              start,
              end,
              location: ev.location ?? undefined,
              description: ev.description ?? undefined,
              allDay: !ev.start?.dateTime,
            });
          }
        } catch (innerErr) {
          console.error(`[calendar] ${acc.email} cal=${cal.calendarId} failed`, innerErr);
        }
      }
    } catch (err) {
      console.error(`[calendar] Account ${acc.email} failed`, err);
    }
  }

  // Dedup gleiche Events
  const seen = new Set<string>();
  const deduped = allEvents.filter((ev) => {
    const key = `${ev.title}|${ev.start}|${ev.end}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  deduped.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  return deduped;
}
