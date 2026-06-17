/**
 * POST /api/coach/session-feedback
 *
 * Nach Abschluss eines geplanten Trainings: Coach gibt kurze Analyse + 2-3 Take-aways
 * basierend auf der absolvierten Workout-Session (Garmin oder manuell) und dem geplanten
 * Slot. Antwort = strukturierte Bullets, kein langer Prose-Block.
 *
 * Input:
 *   { sessionDate: YYYY-MM-DD, sessionTitle, sessionType,
 *     plannedIntensity, exercises?, cardio? }
 *
 * Output:
 *   { ok, summary: { headline, bullets: string[], nextSetup: string },
 *     workoutMatched: bool }
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getCurrentUser } from "@/lib/api/get-user";
import { completeWithAnthropic } from "@/lib/ai/client";
import { startOfDay, endOfDay, subDays, format } from "date-fns";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/coach/session-feedback?date=YYYY-MM-DD
// Liefert alle gespeicherten Coach-Analysen für einen Tag — UI lädt sie damit
// nach Reload erhalten bleiben.
export async function GET(req: Request) {
  const user = await getCurrentUser();
  const { searchParams } = new URL(req.url);
  const dateStr = searchParams.get("date");
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return NextResponse.json({ feedbacks: [] });
  }
  // TZ-safe: parse als UTC-noon → Postgres @db.Date speichert/lookup-ed sauber.
  const [y, m, day] = dateStr.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1, day, 12, 0, 0));
  const rows = await prisma.workoutSessionFeedback.findMany({
    where: { userId: user.id, sessionDate: startOfDay(d) },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({
    feedbacks: rows.map((r) => ({
      sessionTitle: r.sessionTitle,
      sessionType: r.sessionType,
      summary: {
        headline: r.headline,
        bullets: (r.bullets as string[]) ?? [],
        nextSetup: r.nextSetup ?? "",
      },
      workoutId: r.workoutId,
      noTracker: r.noTracker,
      createdAt: r.createdAt.toISOString(),
    })),
  });
}

const schema = z.object({
  sessionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sessionTitle: z.string().min(1).max(200),
  sessionType: z.enum(["strength", "cardio", "long_cardio", "mobility", "rest"]),
  plannedIntensity: z.number().min(0).max(10).optional(),
  exercises: z
    .array(
      z.object({
        name: z.string(),
        sets: z.number().optional(),
        reps: z.string().optional(),
        intensity: z.string().optional(),
      }),
    )
    .optional(),
  cardio: z
    .object({
      zone: z.string().optional(),
      distanceKm: z.number().optional(),
      durationMin: z.number().optional(),
      hrTarget: z.number().optional(),
    })
    .optional()
    .nullable(),
  // User-Wahl: welcher Garmin-Workout (id) gehoert zu dieser Plan-Session?
  // "none" = explizit ohne Tracker absolviert. Wenn nicht gesetzt → Auto-Match per type.
  workoutId: z.string().optional(),
  noTracker: z.boolean().optional(),
});

const SYSTEM = `Du bist des Users Trainer. Er hat eine geplante Session als "erledigt" markiert. Gib eine kurze, ehrliche Nach-Workout-Analyse genau ZU DIESER geplanten Session.

KRITISCHE REGELN — STRIKT BEFOLGEN:
- Die "geplante Session" oben im Kontext ist DIE Session ueber die du Feedback gibst. Nicht andere Workouts vom gleichen Tag.
- Wenn ein "Plan-MATCHED Workout" im Kontext steht, ist das der Garmin-Track DIESER Session — analysier den.
- Wenn KEIN passender Workout in DB gefunden wurde, hat der User die Session OHNE Watch gemacht (z.B. Legday ohne Tracker). NIE schreiben "statt X bist du Y gelaufen". Du gibst Feedback ZUM PLAN ohne Tracker-Daten, NUTZT nur Form-Indikatoren (HRV, Sleep, Journal).
- "ANDERE Workouts am Tag" sind nur Kontext — NICHT die Session ueber die du Feedback gibst. EXAKTE ANZAHL nutzen — NICHT erfinden!

🚨 WORTWAHL-REGEL (ABSOLUTE PRIORITÄT — Verstöße = Fehler):
- "HISTORISCHE Vergleichs-Sessions" sind IMMER aus vergangenen Tagen — NIEMALS heute.
- Wenn du eine historische Session erwähnst, IMMER explizit benennen: "gestern", "vorgestern", "vor 3 Tagen", "letzten Sonntag".
- NIEMALS sagen: "Zweiter Lauf", "Erste Strength", "Lauf danach", "Workout drauf" wenn das eine HISTORISCHE Session ist. Das ist verwirrend und falsch.
- Beispiele:
  ❌ FALSCH: "Zweiter Lauf (11.5km, HR 142) + Krafttraining danach"
  ✅ RICHTIG: "Gestern morgens 11.5km Lauf + mittags Krafttraining"
  ❌ FALSCH: "Strength am Abend"
  ✅ RICHTIG: "Strength gestern Abend"
- Wenn du heutige UND historische Sessions im Kontext zusammenfassen willst (z.B. fuer Volumen-Beobachtung), trenne sie KLAR: "Heute X + gestern Y + vorgestern Z".

ZÄHL-REGEL:
- ZAEHLE die Workouts im Kontext-Block "ANDERE Workouts am Tag" — wenn dort "KEINE" steht, gab es nur die EINE heutige Session. Erfinde NIE "Zweiter Lauf heute" o.Ä.

ACTIVITY-DETAILS NUTZEN (wenn vorhanden):
- "Pace-Drift" negativ = Slowdown (Ermuedung), positiv = Schneller-Werden (gutes Pacing oder kalter Start).
- "HF-Drift" > +8 bpm Start→Ende = Cardiac Drift (Dehydration, Hitze, Ueberforderung).
- "Cadence-Drift" negativ = Schritte werden langsamer (Form-Verlust).
- Bei Z2-Lauf: HF-Drift < +5 bpm ist top, > +10 ein Warnsignal.
- Bei Long-Run: ein 5% Slowdown im letzten Viertel ist normal, > 10% deutet auf Glykogen-Mangel oder zu schnelles Start-Pace.

Stil:
- Du-Form, direkt, kurze Saetze. KEIN Wattebausch.
- KORREKTE deutsche Umlaute (ä ö ü ß) — NICHT "ae oe ue ss". Beispiel: "Bankdrücken" NICHT "Bankdruecken", "muessen" NICHT, sondern "müssen".
- Pattern in Daten zeigen: "HF blieb in Z2-Range trotz Hitze — guter Pacing-Beweis."
- Konkret an Daten/Vergleich ankern, nicht generisch.

Format STRIKT JSON (keine zusaetzlichen Felder, keine Markdown-Tags drumherum):
{
  "headline": "<1 praegnanter Satz: was war die Session, wie liefs (oder: kein Tracker, deshalb anhand Plan/Form)?>",
  "bullets": [
    "<Konkret-Befund 1 — Daten-Anker oder Plan-Beobachtung>",
    "<Konkret-Befund 2 — was war auffaellig oder bemerkenswert>",
    "<Konkret-Befund 3 — Vergleich vs Plan/Baseline ODER (bei fehlendem Tracker) sanfter Hinweis 'kuenftig via + manuell loggen'>"
  ],
  "nextSetup": "<1 Satz: was bedeutet das fuer morgen/naechste Session?>"
}

2-3 bullets reichen, kein Filler.`;

export async function POST(req: Request) {
  const user = await getCurrentUser();
  const body = schema.parse(await req.json());

  // TZ-safe Date-Parse — explizit UTC.
  const [_y, _m, _d] = body.sessionDate.split("-").map(Number);
  const day = new Date(Date.UTC(_y, _m - 1, _d, 12, 0, 0));
  const dayStart = startOfDay(day);
  const dayEnd = endOfDay(day);

  // ALLE Workouts des Tages laden + DEFENSIV im JS by exakte Datums-Komponenten filtern.
  // Hintergrund: Postgres' `date column >= timestamptz` in WHERE hat ein Cast-Quirk
  // der gestrige Workouts unter heutigem Filter zurückgibt. JS-Filter macht's eindeutig.
  const rawWorkouts = await prisma.workoutSession.findMany({
    where: { date: { gte: dayStart, lte: dayEnd } },
    orderBy: { startTime: "asc" },
  });
  const todayWorkouts = rawWorkouts.filter((w) => {
    return w.date.getUTCFullYear() === _y
      && w.date.getUTCMonth() + 1 === _m
      && w.date.getUTCDate() === _d;
  });

  // Type-Match: passe Workout zum Plan-SessionType.
  const matchType = (sessionType: string, workoutType: string): boolean => {
    const wt = workoutType.toLowerCase();
    if (sessionType === "strength") return wt.includes("strength") || wt.includes("weight");
    if (sessionType === "cardio" || sessionType === "long_cardio") {
      return wt.includes("run") || wt.includes("cycl") || wt.includes("bike")
        || wt.includes("swim") || wt.includes("cardio") || wt.includes("hik")
        || wt.includes("row") || wt.includes("walk") || wt.includes("ski");
    }
    if (sessionType === "mobility") return wt.includes("yoga") || wt.includes("stretch") || wt.includes("mobility");
    return false;
  };

  // PRIORITAET der Zuweisung:
  //  1) body.workoutId — User hat explizit gewaehlt
  //  2) body.noTracker — User sagt "ohne Watch" → kein Workout
  //  3) Auto-Match by type
  let matchedWorkout: (typeof todayWorkouts)[number] | null = null;
  if (body.workoutId) {
    matchedWorkout = todayWorkouts.find((w) => w.id === body.workoutId) ?? null;
  } else if (!body.noTracker) {
    matchedWorkout = todayWorkouts.find((w) => matchType(body.sessionType, w.type)) ?? null;
  }
  const otherWorkouts = todayWorkouts.filter((w) => w !== matchedWorkout);
  const workoutMatched = matchedWorkout !== null;
  const workout = matchedWorkout;
  const userExplicitNoTracker = body.noTracker === true;

  // 14d Kontext fuer Vergleich
  const since = startOfDay(subDays(day, 14));
  const [metrics, recent, journal] = await Promise.all([
    prisma.healthMetric.findMany({
      where: { date: { gte: since, lte: dayEnd } },
      orderBy: [{ kind: "asc" }, { date: "asc" }],
    }),
    prisma.workoutSession.findMany({
      where: { date: { gte: since, lt: dayStart } },
      orderBy: { startTime: "desc" },
      take: 14,
    }),
    prisma.dailyJournal.findUnique({
      where: { userId_date: { userId: user.id, date: dayStart } },
    }),
  ]);

  // HRV / Sleep heute fuer Form-Status
  const todayHrv = metrics.find(
    (m) => m.kind === "hrv_overnight" && format(m.date, "yyyy-MM-dd") === body.sessionDate,
  )?.value ?? null;
  const todaySleep = metrics.find(
    (m) => m.kind === "sleep_minutes" && format(m.date, "yyyy-MM-dd") === body.sessionDate,
  )?.value ?? null;

  // Letzten vergleichbaren Workouts (gleicher Type)
  const sameType = recent.filter((w) => w.type === body.sessionType).slice(0, 3);

  const ctxLines: string[] = [];
  ctxLines.push(`Datum: ${body.sessionDate}`);
  ctxLines.push(`Geplante Session: ${body.sessionTitle} (Type: ${body.sessionType}, geplante Intensitaet: ${body.plannedIntensity ?? "—"}/10)`);
  if (body.exercises && body.exercises.length > 0) {
    ctxLines.push("Geplante Uebungen:");
    for (const ex of body.exercises) {
      ctxLines.push(`  - ${ex.name}${ex.sets ? ` ${ex.sets}×${ex.reps ?? "?"}` : ""}${ex.intensity ? ` @ ${ex.intensity}` : ""}`);
    }
  }
  if (body.cardio) {
    ctxLines.push(`Geplantes Cardio: ${body.cardio.zone ?? ""} ${body.cardio.distanceKm ?? "?"}km ${body.cardio.durationMin ?? "?"}min HR<${body.cardio.hrTarget ?? "?"}`.trim());
  }

  if (workout) {
    const durationMin = Math.round(workout.durationSec / 60);
    const distanceKm = workout.distanceM ? (workout.distanceM / 1000).toFixed(2) : null;
    ctxLines.push(
      `Plan-MATCHED Workout (Garmin/manuell, Type passt zu Plan): ${workout.type}${workout.name ? ` "${workout.name}"` : ""}, ${durationMin} min${distanceKm ? `, ${distanceKm} km` : ""}${workout.avgHr ? `, avgHR ${workout.avgHr}` : ""}${workout.maxHr ? `, maxHR ${workout.maxHr}` : ""}${workout.trainingLoad ? `, TL ${Math.round(workout.trainingLoad)}` : ""}${workout.rpe ? `, RPE ${workout.rpe}` : ""}${workout.feeling ? `, Feeling ${workout.feeling}` : ""}.`,
    );

    // Activity-Details laden wenn vorhanden (Lap-Splits, HR-Curve, Pace-Drift)
    const detail = await prisma.workoutDetail.findUnique({ where: { workoutId: workout.id } }).catch(() => null);
    if (detail) {
      ctxLines.push("Activity-Details (Garmin):");
      if (detail.paceDriftPct !== null) {
        const drift = detail.paceDriftPct;
        const label = drift < -3 ? "Slowdown" : drift > 3 ? "negativer Drift (schneller)" : "stabil";
        ctxLines.push(`  - Pace-Drift letztes vs erstes Viertel: ${drift.toFixed(1)}% (${label})`);
      }
      if (detail.cadenceDriftPct !== null) {
        ctxLines.push(`  - Cadence-Drift: ${detail.cadenceDriftPct.toFixed(1)}%`);
      }
      if (detail.hrMaxAt !== null) {
        const minIn = Math.round(detail.hrMaxAt / 60);
        ctxLines.push(`  - HR-Max-Peak ${workout.maxHr ?? "?"} bei Minute ${minIn} der Session`);
      }
      const hrCurve = detail.hrCurve as Array<{ tSec: number; hr: number }> | null;
      if (Array.isArray(hrCurve) && hrCurve.length >= 3) {
        // Ersten + mittleren + letzten Punkt erwähnen für Drift-Visualisierung
        const first = hrCurve[0];
        const mid = hrCurve[Math.floor(hrCurve.length / 2)];
        const last = hrCurve[hrCurve.length - 1];
        ctxLines.push(`  - HF-Verlauf: Start ${first.hr} bpm → Mitte ${mid.hr} → Ende ${last.hr} (Drift ${last.hr - first.hr > 5 ? "+" : ""}${last.hr - first.hr} bpm)`);
      }
      const laps = detail.laps as Array<{ distance?: number; duration?: number; averageHR?: number; averageSpeed?: number }> | null;
      if (Array.isArray(laps) && laps.length > 1 && laps.length <= 25) {
        const slowdownDetected = laps.length >= 4 && laps[0].averageSpeed && laps[laps.length - 1].averageSpeed
          ? ((laps[laps.length - 1].averageSpeed! / laps[0].averageSpeed! - 1) * 100).toFixed(1)
          : null;
        ctxLines.push(`  - ${laps.length} Laps/Splits${slowdownDetected ? ` (Pace ${slowdownDetected}% Drift Lap1→letzte)` : ""}`);
      }
    }
  } else {
    ctxLines.push(
      `KEIN passender Workout in DB gefunden (Plan-Type "${body.sessionType}" hat keinen Match unter den Tages-Sessions). der User hat die Session selbst als ERLEDIGT markiert — er hat sie WAHRSCHEINLICH gemacht, aber nicht via Garmin getrackt (z.B. Krafttraining ohne Watch oder kurze Mobility). Gib eine konstruktive Analyse basierend auf Plan + Form-Indikatoren (HRV/Sleep/Journal). KEINE Aussagen wie "statt Plan hast du X gemacht" — der Plan-Workout ist erledigt, es fehlt nur die DB-Spur. Erwaehne in genau EINEM Bullet sanft, dass das manuelle Loggen via "+" im Health-Bereich kuenftig die Analyse praeziser macht.`,
    );
  }

  if (otherWorkouts.length > 0) {
    ctxLines.push(`ANDERE Workouts am Tag ${body.sessionDate} (NICHT die geplante Session — nur Tagestotal-Kontext, Anzahl ${otherWorkouts.length}):`);
    for (const ow of otherWorkouts) {
      const durationMin = Math.round(ow.durationSec / 60);
      const distanceKm = ow.distanceM ? (ow.distanceM / 1000).toFixed(2) : null;
      ctxLines.push(
        `  - ${ow.type}${ow.name ? ` "${ow.name}"` : ""}, ${durationMin} min${distanceKm ? `, ${distanceKm} km` : ""}${ow.avgHr ? `, avgHR ${ow.avgHr}` : ""}${ow.trainingLoad ? `, TL ${Math.round(ow.trainingLoad)}` : ""}.`,
      );
    }
  } else {
    ctxLines.push(`ANDERE Workouts am Tag ${body.sessionDate}: KEINE (nur diese eine Session am Tag).`);
  }

  if (todayHrv !== null) ctxLines.push(`HRV nachts: ${Math.round(todayHrv)} ms`);
  if (todaySleep !== null) ctxLines.push(`Schlafdauer: ${Math.round(todaySleep)} min (${(todaySleep / 60).toFixed(1)} h)`);
  if (journal) {
    ctxLines.push(
      `Journal: Energy ${journal.energy ?? "—"}, Mood ${journal.mood ?? "—"}, Soreness ${journal.soreness ?? "—"}, SleepQuality ${journal.sleepQuality ?? "—"}${journal.workoutFelt ? `, WorkoutFelt "${journal.workoutFelt}"` : ""}${journal.notes ? `, Notes: ${journal.notes.slice(0, 200)}` : ""}.`,
    );
  }

  if (sameType.length > 0) {
    ctxLines.push(`HISTORISCHE Vergleichs-Sessions (gleicher Type, VOR ${body.sessionDate}, nur fuer Trend-Vergleich — sind NICHT am gleichen Tag wie die heutige Session! Im Output IMMER mit "gestern/vorgestern/vor X Tagen" referenzieren, NIE als "zweiter X"):`);
    const today = new Date(body.sessionDate + "T12:00:00Z");
    for (const w of sameType) {
      const durationMin = Math.round(w.durationSec / 60);
      const distanceKm = w.distanceM ? (w.distanceM / 1000).toFixed(2) : null;
      const wDate = format(w.date, "yyyy-MM-dd");
      // Berechne Abstand in Tagen zu heute, plus expliziter Label.
      const wDateObj = new Date(wDate + "T12:00:00Z");
      const daysAgo = Math.round((today.getTime() - wDateObj.getTime()) / (24 * 3600 * 1000));
      const dayLabel = daysAgo === 1 ? "GESTERN"
        : daysAgo === 2 ? "VORGESTERN"
        : `VOR ${daysAgo} TAGEN`;
      ctxLines.push(
        `  - ${dayLabel} (${wDate}): ${durationMin} min${distanceKm ? `, ${distanceKm} km` : ""}${w.avgHr ? `, avgHR ${w.avgHr}` : ""}${w.trainingLoad ? `, TL ${Math.round(w.trainingLoad)}` : ""}${w.rpe ? `, RPE ${w.rpe}` : ""}.`,
      );
    }
  }

  const userMsg = ctxLines.join("\n");

  try {
    const ai = await completeWithAnthropic(
      [
        { role: "system", content: SYSTEM },
        { role: "user", content: userMsg },
      ],
      900,
    );
    // JSON aus Antwort extrahieren
    const match = ai.text.match(/\{[\s\S]*\}/);
    if (!match) {
      return NextResponse.json({
        ok: false,
        error: "Coach-Antwort kein JSON",
        raw: ai.text,
        workoutMatched,
      }, { status: 502 });
    }
    const parsed = JSON.parse(match[0]) as {
      headline?: string;
      bullets?: string[];
      nextSetup?: string;
    };
    const summary = {
      headline: parsed.headline ?? "Workout erledigt.",
      bullets: Array.isArray(parsed.bullets) ? parsed.bullets.slice(0, 5) : [],
      nextSetup: parsed.nextSetup ?? "",
    };

    // Persistieren — Reload-überlebend, eindeutig per (userId, sessionDate, sessionTitle).
    try {
      await prisma.workoutSessionFeedback.upsert({
        where: {
          userId_sessionDate_sessionTitle: {
            userId: user.id,
            sessionDate: dayStart,
            sessionTitle: body.sessionTitle,
          },
        },
        update: {
          sessionType: body.sessionType,
          plannedIntensity: body.plannedIntensity ?? null,
          workoutId: body.workoutId ?? null,
          noTracker: userExplicitNoTracker,
          headline: summary.headline,
          bullets: summary.bullets,
          nextSetup: summary.nextSetup,
          provider: ai.provider,
          model: ai.model,
        },
        create: {
          userId: user.id,
          sessionDate: dayStart,
          sessionTitle: body.sessionTitle,
          sessionType: body.sessionType,
          plannedIntensity: body.plannedIntensity ?? null,
          workoutId: body.workoutId ?? null,
          noTracker: userExplicitNoTracker,
          headline: summary.headline,
          bullets: summary.bullets,
          nextSetup: summary.nextSetup,
          provider: ai.provider,
          model: ai.model,
        },
      });
    } catch (e) {
      // Persistence-Fail darf das Feedback nicht zerstören — nur loggen.
      console.warn("[session-feedback] persist failed:", e);
    }

    return NextResponse.json({
      ok: true,
      summary,
      workoutMatched,
      provider: ai.provider,
      model: ai.model,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg, workoutMatched }, { status: 502 });
  }
}
