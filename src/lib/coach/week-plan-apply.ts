/**
 * Wochenplaner Phase 4 — Kalender-Schreibung.
 *
 * Schreibt den proposedSlots-Plan in den PRIMARY Kalender des PRIVATEN Accounts.
 * Marker: extendedProperties.private.coach_managed="true" + planId — damit wir beim
 * naechsten Apply alte Coach-Events sauber loeschen und ersetzen koennen, ohne Business-
 * oder andere private Termine anzutasten.
 */
import { prisma } from "@/lib/db/prisma";
import { addDays, format, startOfDay, startOfWeek } from "date-fns";
import { parseTrainingFromTitle } from "@/lib/health/parse-training";
import {
  getAccessToken,
  calendarEventsList,
  calendarEventInsert,
  calendarEventDelete,
} from "@/lib/api/google-fetch";

export interface ApplyResult {
  ok: true;
  created: number;
  deletedCoach: number;
  deletedUserTrainings: number;
  weekStart: string;
  warnings: string[];
}

export interface ApplyError {
  error: string;
  status?: number;
}

interface ProposedSession {
  start: string; end: string;
  type: string;
  title: string;
  intensityStrength?: number;
  intensityCardio?: number;
  exercises?: Array<{ name: string; sets: number; reps: string; intensity?: string; notes?: string }>;
  cardio?: { subType?: string; distanceKm?: number; durationMin?: number; zone?: string; hrTarget?: number };
  reasoning?: string;
}

interface ProposedDay {
  date: string; dow: string;
  dayFocus?: string;
  sessions: ProposedSession[];
}

interface ProposedPlan {
  weekFocus?: string;
  days: ProposedDay[];
}


function buildEventDescription(s: ProposedSession): string {
  const parts: string[] = [];
  if (s.exercises && s.exercises.length > 0) {
    parts.push("Uebungen:");
    for (const ex of s.exercises) {
      const intensity = ex.intensity ? ` · ${ex.intensity}` : "";
      const notes = ex.notes ? ` — ${ex.notes}` : "";
      parts.push(`• ${ex.name}: ${ex.sets} × ${ex.reps}${intensity}${notes}`);
    }
  }
  if (s.cardio) {
    const c = s.cardio;
    const lines: string[] = [];
    if (c.subType) lines.push(`Art: ${c.subType}`);
    if (c.distanceKm) lines.push(`Distanz: ${c.distanceKm} km`);
    if (c.durationMin) lines.push(`Dauer: ${c.durationMin} min`);
    if (c.zone) lines.push(`Zone: ${c.zone}`);
    if (c.hrTarget) lines.push(`HR-Ziel: ${c.hrTarget} bpm`);
    if (lines.length > 0) parts.push("Cardio:\n" + lines.map((l) => `• ${l}`).join("\n"));
  }
  const intensity: string[] = [];
  if (s.intensityStrength && s.intensityStrength > 0) intensity.push(`Kraft ${s.intensityStrength}/10`);
  if (s.intensityCardio && s.intensityCardio > 0) intensity.push(`Cardio ${s.intensityCardio}/10`);
  if (intensity.length > 0) parts.push(`Intensitaet: ${intensity.join(" · ")}`);
  if (s.reasoning) parts.push(`\nWarum:\n${s.reasoning}`);
  parts.push("\n— vom Coach generiert (Plan in Dashboard /health/wochenplan)");
  return parts.join("\n");
}

export async function applyWeekPlanForUser(
  userId: string,
  weekStartIso?: string,
): Promise<ApplyResult | ApplyError> {
  const now = new Date();

  // Welche Woche? Default: kommende Woche (Mo). Override via weekStartIso (YYYY-MM-DD).
  // TZ-SAFE: parse as UTC midnight, sonst weicht @db.Date durch UTC-Konversion 1 Tag ab.
  let weekStart: Date;
  if (weekStartIso && /^\d{4}-\d{2}-\d{2}$/.test(weekStartIso)) {
    weekStart = new Date(weekStartIso + "T00:00:00Z");
  } else {
    const nextMo = startOfWeek(addDays(now, 7), { weekStartsOn: 1 });
    weekStart = new Date(format(nextMo, "yyyy-MM-dd") + "T00:00:00Z");
  }
  const weekStartKey = format(weekStart, "yyyy-MM-dd");
  const weekEnd = addDays(weekStart, 7);

  // Plan laden — TZ-tolerant: scanne alle Plaene der letzten 14d und matche per format(weekStart, "yyyy-MM-dd")
  // (statt rauf-stoplernden startOfDay-Lookup der durch TZ-Drift den Plan verfehlen kann)
  const candidatePlans = await prisma.weeklyPlan.findMany({
    where: { userId, weekStart: { gte: new Date(format(weekStart, "yyyy-MM-dd") + "T00:00:00Z"), lte: new Date(format(addDays(weekStart, 1), "yyyy-MM-dd") + "T23:59:59Z") } },
    orderBy: { weekStart: "desc" },
  });
  const plan = candidatePlans.find((p) => format(p.weekStart, "yyyy-MM-dd") === weekStartKey) ?? candidatePlans[0] ?? null;
  const proposed = plan?.proposedSlots as ProposedPlan | null;
  if (!plan || !proposed || !Array.isArray(proposed.days) || proposed.days.length === 0) {
    return { error: "Kein Plan zum Uebertragen vorhanden — erst 'Trainings-Woche planen'.", status: 400 };
  }

  // Privaten Account ermitteln (Source-of-Truth fuer Kalender-Schreibung)
  const acc = await prisma.googleAccount.findFirst({
    where: { userId, kind: "PRIVATE" },
  });
  if (!acc || !acc.refreshToken) {
    return { error: "Privater Google-Account nicht verbunden. In /settings neu verbinden.", status: 400 };
  }

  // Scope-Check: hat der Account write-Scope?
  const scopes: string[] = acc.scopes ?? [];
  const hasWrite = scopes.some((s) => s === "https://www.googleapis.com/auth/calendar.events" || s === "https://www.googleapis.com/auth/calendar");
  if (!hasWrite) {
    return {
      error: "Schreibrecht fehlt — privaten Account in /settings neu verbinden (Coach braucht Calendar-Write-Scope).",
      status: 403,
    };
  }

  const accessToken = await getAccessToken(acc.refreshToken);
  const warnings: string[] = [];

  // 1a) Bestehende Coach-Managed-Events der Ziel-Woche im Primary-Kalender finden + loeschen
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
        warnings.push(`Konnte Coach-Event "${ev.summary}" nicht loeschen: ${(err as Error).message}`);
      }
    }
  } catch (err) {
    warnings.push(`Konnte alte Coach-Events nicht auflisten: ${(err as Error).message}`);
  }

  // 1b) User-eigene Trainings-Termine der Woche loeschen.
  // WICHTIG: bei recurring Trainings (z.B. "Krafttraining: Push Day" jede Woche) loeschen wir
  // das MASTER-Event (recurringEventId) — sonst kommt der Termin naechste Woche wieder.
  let deletedUserTrainings = 0;
  const recurringMastersToDelete = new Set<string>();
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
      // Recurring? Master-ID merken, master spaeter loeschen (1× pro Series)
      if (ev.recurringEventId) {
        recurringMastersToDelete.add(ev.recurringEventId);
        continue; // einzelne Instanz nicht loeschen, das macht der Master-Delete
      }
      // Einzelnes Event direkt loeschen
      try {
        await calendarEventDelete(accessToken, "primary", ev.id);
        deletedUserTrainings += 1;
      } catch (err) {
        warnings.push(`Konnte User-Trainings-Event "${ev.summary}" nicht loeschen: ${(err as Error).message}`);
      }
    }
  } catch (err) {
    warnings.push(`Konnte User-Trainings-Events nicht auflisten: ${(err as Error).message}`);
  }

  // Recurring Master-Events loeschen — das entfernt die Serie KOMPLETT (auch zukuenftige Wochen).
  // Wenn der User das nicht wollte, kann er manuell wieder neu anlegen.
  for (const masterId of recurringMastersToDelete) {
    try {
      await calendarEventDelete(accessToken, "primary", masterId);
      deletedUserTrainings += 1;
      warnings.push(`Recurring Training-Serie geloescht (Master ${masterId}). Falls du das nicht wolltest, manuell neu anlegen.`);
    } catch (err) {
      warnings.push(`Konnte recurring Master ${masterId} nicht loeschen: ${(err as Error).message}`);
    }
  }

  // 2) Neue Events schreiben
  let created = 0;
  for (const day of proposed.days) {
    if (!Array.isArray(day.sessions) || day.sessions.length === 0) continue;
    for (const s of day.sessions) {
      if (s.type === "rest") continue;
      const startIso = `${day.date}T${s.start}:00`;
      const endIso = `${day.date}T${s.end}:00`;
      const startD = new Date(startIso);
      const endD = new Date(endIso);
      if (isNaN(startD.getTime()) || isNaN(endD.getTime()) || endD <= startD) {
        warnings.push(`Ueberspringe ${day.date} ${s.start}-${s.end} (${s.title}): ungueltige Zeit.`);
        continue;
      }
      try {
        await calendarEventInsert(accessToken, "primary", {
          summary: `[Coach] ${s.title}`,
          description: buildEventDescription(s),
          start: { dateTime: startIso, timeZone: process.env.TZ || "Europe/Vienna" },
          end: { dateTime: endIso, timeZone: process.env.TZ || "Europe/Vienna" },
          extendedProperties: {
            private: {
              coach_managed: "true",
              plan_id: plan.id,
              session_type: s.type,
            },
          },
          // Farb-IDs Google Calendar: 1=Lavender, 2=Sage, 10=Basil(grün), 8=Graphite
          colorId:
            s.type === "strength" ? "10" :
            s.type === "cardio" || s.type === "long_cardio" ? "1" :
            s.type === "mobility" ? "8" :
            "1",
          reminders: { useDefault: true },
        });
        created += 1;
      } catch (err) {
        warnings.push(`Konnte Event ${day.date} ${s.start} "${s.title}" nicht anlegen: ${(err as Error).message}`);
      }
    }
  }

  // 3) Plan-Status updaten
  await prisma.weeklyPlan.update({
    where: { id: plan.id },
    data: { status: "applied" },
  });

  return {
    ok: true,
    created,
    deletedCoach,
    deletedUserTrainings,
    weekStart: weekStartKey,
    warnings,
  };
}
