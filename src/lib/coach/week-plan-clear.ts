/**
 * Loescht die Trainings-Events der Ziel-Woche (Coach-Managed + User-Trainings-Pattern).
 * Business + andere private Termine bleiben unangetastet.
 */
import { prisma } from "@/lib/db/prisma";
import { addDays, format, startOfWeek } from "date-fns";
import { parseTrainingFromTitle } from "@/lib/health/parse-training";
import { getAccessToken, calendarEventsList, calendarEventDelete } from "@/lib/api/google-fetch";

export interface ClearResult {
  ok: true;
  deletedCoach: number;
  deletedUserTrainings: number;
  weekStart: string;
  warnings: string[];
}

export interface ClearError {
  error: string;
  status?: number;
}

export async function clearWeekTrainingsForUser(
  userId: string,
  weekStartIso?: string,
): Promise<ClearResult | ClearError> {
  const now = new Date();
  let weekStart: Date;
  if (weekStartIso && /^\d{4}-\d{2}-\d{2}$/.test(weekStartIso)) {
    weekStart = new Date(weekStartIso + "T00:00:00");
  } else {
    weekStart = startOfWeek(now, { weekStartsOn: 1 });
  }
  const weekStartKey = format(weekStart, "yyyy-MM-dd");
  const weekEnd = addDays(weekStart, 7);

  const acc = await prisma.googleAccount.findFirst({ where: { userId, kind: "PRIVATE" } });
  if (!acc || !acc.refreshToken) {
    return { error: "Privater Google-Account nicht verbunden. In /settings neu verbinden.", status: 400 };
  }
  const scopes: string[] = acc.scopes ?? [];
  const hasWrite = scopes.some((s) => s === "https://www.googleapis.com/auth/calendar.events" || s === "https://www.googleapis.com/auth/calendar");
  if (!hasWrite) {
    return { error: "Schreibrecht fehlt — privaten Account in /settings neu verbinden.", status: 403 };
  }

  const accessToken = await getAccessToken(acc.refreshToken);
  const warnings: string[] = [];

  let deletedCoach = 0;
  try {
    const list = await calendarEventsList(accessToken, "primary", {
      timeMin: weekStart.toISOString(),
      timeMax: weekEnd.toISOString(),
      privateExtendedProperty: "coach_managed=true",
      maxResults: 250,
      singleEvents: true,
    });
    for (const ev of list.items ?? []) {
      if (!ev.id) continue;
      try {
        await calendarEventDelete(accessToken, "primary", ev.id);
        deletedCoach += 1;
      } catch (err) {
        warnings.push(`Coach-Event "${ev.summary}": ${(err as Error).message}`);
      }
    }
  } catch (err) {
    warnings.push(`Coach-Events list: ${(err as Error).message}`);
  }

  let deletedUserTrainings = 0;
  try {
    const list2 = await calendarEventsList(accessToken, "primary", {
      timeMin: weekStart.toISOString(),
      timeMax: weekEnd.toISOString(),
      maxResults: 500,
      singleEvents: true,
    });
    for (const ev of list2.items ?? []) {
      if (!ev.id || !ev.summary) continue;
      const isCoach = ev.extendedProperties?.private?.coach_managed === "true";
      if (isCoach) continue;
      const matched = parseTrainingFromTitle(ev.summary);
      if (!matched) continue;
      try {
        await calendarEventDelete(accessToken, "primary", ev.id);
        deletedUserTrainings += 1;
      } catch (err) {
        warnings.push(`User-Training "${ev.summary}": ${(err as Error).message}`);
      }
    }
  } catch (err) {
    warnings.push(`User-Training list: ${(err as Error).message}`);
  }

  return { ok: true, deletedCoach, deletedUserTrainings, weekStart: weekStartKey, warnings };
}
