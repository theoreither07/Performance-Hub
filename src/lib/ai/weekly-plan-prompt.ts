/**
 * Wochenplan-Prompt — wird Samstag Abend / Sonntag generiert.
 *
 * Schaut auf die letzten 7-30 Tage Daten + Goals + Status und gibt einen
 * konkreten Trainingsplan fuer die KOMMENDE Woche (Mo-So) aus.
 */

import type { CoachAnalysis } from "@/lib/health/coach-analysis";

export interface WeeklyPlanCtx {
  thisWeekEnd: string; // Sonntag der gerade endenden Woche
  nextWeekStart: string; // Montag der kommenden Woche
  nextWeekEnd: string; // Sonntag der kommenden Woche
  profile: {
    strengthPerWeek: number;
    runsPerWeek: number;
    longRunKm: number | null;
    shortRunKm: number | null;
    goals: string | null;
    restDays: number[];
    maxHr: number | null;
    weeklySlotPrefs?: Record<string, unknown> | null;
    weeklyTemplateMarkdown?: string | null;
  } | null;
  keyLifts: { name: string; unit: string; current: number | null; currentReps: number | null; notes: string | null }[];
  analysis: CoachAnalysis;
  last7Workouts: {
    date: string; type: string; durationMin: number; distanceKm: number | null;
    avgHr: number | null; trainingLoad: number | null;
    rpe: number | null; feeling: number | null;
  }[];
  last7Journal: {
    date: string; mood: number | null; energy: number | null; motivation: number | null;
    soreness: number | null; sleepQuality: number | null; workoutFelt: number | null;
  }[];
  // Kalender-Plan fuer naechste Woche aus Google Cal
  nextWeekCalendarPlan: { date: string; dow: string; items: { type: string; name: string; distanceKm?: number }[] }[];
  // Aggregate diese vergangene Woche
  thisWeekTotals: {
    strengthSessions: number;
    runSessions: number;
    longRunDone: boolean;
    totalMinutes: number;
    totalLoad: number;
  };
}

export function buildWeeklyPlanSystemPrompt(): string {
  return `Du bist des Users High-Performance-Coach. Du planst die KOMMENDE Trainingswoche basierend auf:
- Wie die vergangene Woche lief (Compliance, Recovery-Status, subjektives Befinden)
- Goals + Wochenziele aus dem Profil
- Erkannte Pattern aus den letzten 30 Tagen
- Kalender-Termine fuer die naechste Woche (was ist schon geplant)

KERN-PRINZIPIEN:

1. **Anpassung an Realitaet**: Wenn letzte Woche schwer war (Overreaching-Signale, schlechte Compliance,
   Krankheits-Anzeichen), planst du KEINE Volume-Steigerung. Dann Deload oder Maintenance.

2. **Sport-Science-Grundregel**: Variation > Volumen. Monotony >1.5 ist Warnsignal. Plan muss klar
   hart/leicht/Pause trennen — kein "alles mittel".

3. **Periodisierung**:
   - Long Run am Samstag (des Users Routine)
   - Sonntag = Restday (des Users Wunsch)
   - 1 Quality Run (Tempo/Intervalle) + 1-2 Easy Runs (Z2)
   - Krafttraining: Push/Pull/Legs Split oder Oberkoerper/Beine je nach Volumen
   - Vor Long Run KEIN Beintraining (mind. 1 Tag dazwischen)

4. **Constraints**: KEINE Squats (Rueckenproblem). Beintraining = Leg Press, Bulgarian Split Squats,
   Hip Thrust, Leg Curls. Lauf Z2 ~5:45/km.

5. **Wenn Kalender-Termine schon Trainings enthalten** (z.B. "Krafttraining: Oberkoerper"): respektiere die,
   adaptiere nur Intensitaet/Volumen falls noetig.

═══ AUSGABE-FORMAT (3 Sektionen, Markdown, KEINE Codeblocks) ═══

## Wochen-Fokus

### Status nach dieser Woche
2-3 Bullets mit den Schluessel-Erkenntnissen aus der vergangenen Woche (Compliance, Pattern, Recovery).

### Strategie naechste Woche
1-2 Saetze: **Build / Maintain / Deload / Ramp-Up** und WARUM (kurz, knapp).

### Volumen-Adjust
- Lauf: X km gesamt (vs. letzte Woche Y) — Begruendung
- Kraft: X Sessions (vs. letzte Woche Y) — Begruendung

## Wochenplan

Bullet-Liste pro Tag, KURZ und PRAEGNANT:

- **Mo (DD.MM)**: Sport — konkrete Uebungen / Pace / HR / Dauer / **Reps×Sets×Last bei Kraft**
- **Di**: ...
- **Mi**: ...
- **Do**: ...
- **Fr**: ...
- **Sa**: Long Run XXkm — Pace/HR-Cap konkret
- **So**: Restday — optional Mobility/Walk

Bei jedem Tag MAX 2 Zeilen. Konkret. Wenn Kalender schon was hat: referenziere es.

## Worauf achten

### Adaptions-Regeln
3-4 Bullets — wann anpassen:
- Wenn HRV X Tage in Folge unter Y → ...
- Wenn 2 Tage Low-Energy → ...
- Wenn Soreness >=7 morgens → ...

### Performance-Indikatoren
2-3 Bullets — was diese Woche ueberwachen:
- VO2max-Trend
- Z2-HR-Drift
- Plan-Compliance

### Quick-Check Sonntag naechste Woche
1 Satz: was muss ich am Ende der Woche evaluieren um die nochnaechste Woche zu planen.`;
}

function weeklyPlanSlotBlock(s: Record<string, unknown>): string {
  const get = (k: string): string => (typeof s[k] === "string" ? (s[k] as string) : "—");
  const fb = Array.isArray(s.noonFallbacks) ? (s.noonFallbacks as string[]).join(", ") : "—";
  const sun = s.sundayLightOnly === false ? "voll trainierbar" : "default Light, Training nur im Notfall";
  return [
    `- Mo-Fr frueh: ${get("morningStart")}-${get("morningEnd")}`,
    `- Mo-Fr mittag: bevorzugt ${get("noonPreferred")} (Fallback ${fb})`,
    `- Samstag Long: ${get("satLongStart")}-${get("satLongEnd")}`,
    `- Sonntag: ${sun}`,
  ].join("\n");
}

export function buildWeeklyPlanUserPrompt(ctx: WeeklyPlanCtx): string {
  const a = ctx.analysis;
  const s = a.signals;
  const numOrDash = (v: number | null | undefined, suffix = "", fix = 1) =>
    v === null || v === undefined ? "—" : v.toFixed(fix) + suffix;
  const dow = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

  const workoutLines = ctx.last7Workouts.length === 0
    ? "(keine)"
    : ctx.last7Workouts.map((w) => {
        const parts = [w.date, w.type, `${w.durationMin}min`];
        if (w.distanceKm) parts.push(`${w.distanceKm.toFixed(1)}km`);
        if (w.avgHr) parts.push(`HR ${Math.round(w.avgHr)}`);
        if (w.trainingLoad) parts.push(`Load ${Math.round(w.trainingLoad)}`);
        if (w.rpe) parts.push(`RPE ${w.rpe}`);
        if (w.feeling) parts.push(`Feel ${w.feeling}`);
        return `- ${parts.join(" · ")}`;
      }).join("\n");

  const journalLines = ctx.last7Journal.length === 0
    ? "(keine)"
    : ctx.last7Journal.map((j) => {
        const parts: string[] = [j.date];
        if (j.energy !== null) parts.push(`energy ${j.energy}`);
        if (j.mood !== null) parts.push(`mood ${j.mood}`);
        if (j.motivation !== null) parts.push(`mot ${j.motivation}`);
        if (j.soreness !== null) parts.push(`sore ${j.soreness}`);
        if (j.sleepQuality !== null) parts.push(`sleepQ ${j.sleepQuality}`);
        if (j.workoutFelt !== null) parts.push(`workout ${j.workoutFelt}`);
        return `- ${parts.join(" · ")}`;
      }).join("\n");

  const calLines = ctx.nextWeekCalendarPlan.map((d) => {
    if (d.items.length === 0) return `- ${d.dow} ${d.date}: nichts geplant`;
    return `- ${d.dow} ${d.date}: ${d.items.map((i) => `${i.name}${i.distanceKm ? ` (${i.distanceKm}km)` : ""}`).join(" + ")}`;
  }).join("\n");

  const keyLiftLines = ctx.keyLifts.length === 0
    ? "(keine)"
    : ctx.keyLifts.map((k) => {
        const cur = k.current !== null
          ? k.unit === "kg" ? `${k.current}kg${k.currentReps ? ` × ${k.currentReps}` : ""}` : `${k.current} ${k.unit}`
          : "—";
        return `- ${k.name}: ${cur}${k.notes ? ` — ${k.notes}` : ""}`;
      }).join("\n");

  return `Planung fuer Woche: **${ctx.nextWeekStart} (Mo) - ${ctx.nextWeekEnd} (So)**

## DES USERS ZIELE
${ctx.profile?.goals ?? "(keine eingetragen)"}

## WOCHENPLAN-VORGABE
- ${ctx.profile?.strengthPerWeek ?? 0}x Krafttraining
- ${ctx.profile?.runsPerWeek ?? 0}x Lauf (kurz ${ctx.profile?.shortRunKm ?? "—"}km, lang ${ctx.profile?.longRunKm ?? "—"}km)
- Restdays: ${(ctx.profile?.restDays ?? []).map((d) => dow[d - 1]).join(", ") || "(keine)"}
- MaxHr: ${ctx.profile?.maxHr ?? "—"}

## BEVORZUGTE TRAININGS-SLOTS
${ctx.profile?.weeklySlotPrefs ? weeklyPlanSlotBlock(ctx.profile.weeklySlotPrefs) : "(nicht gesetzt)"}

## AKTUELLES TRAININGS-SETUP (Referenz wie er gerade trainiert)
${ctx.profile?.weeklyTemplateMarkdown ? ctx.profile.weeklyTemplateMarkdown : "(nicht gepflegt)"}

## KEY-LIFTS
${keyLiftLines}

## DIESE WOCHE — WIE SIE LIEF
- Krafttraining: ${ctx.thisWeekTotals.strengthSessions}/${ctx.profile?.strengthPerWeek ?? 0}
- Laeufe: ${ctx.thisWeekTotals.runSessions}/${ctx.profile?.runsPerWeek ?? 0}
- Long Run: ${ctx.thisWeekTotals.longRunDone ? "✓ erledigt" : "✗ ausgefallen"}
- Gesamt-Minuten: ${ctx.thisWeekTotals.totalMinutes}
- Gesamt-Training-Load: ${Math.round(ctx.thisWeekTotals.totalLoad)}

## TRAININGS LETZTE 7 TAGE
${workoutLines}

## JOURNAL LETZTE 7 TAGE
${journalLines}

## ALGORITHMISCHE COACH-ANALYSE
Status: **${a.status}** · Wochenstrategie: **${a.weekStrategy.type}** — ${a.weekStrategy.headline}
Volumen-Empfehlung: ${a.weekStrategy.volumeAdjustmentPct > 0 ? "+" : ""}${a.weekStrategy.volumeAdjustmentPct}%
Deload empfohlen: ${a.deloadRecommended ? "JA" : "nein"}

Fatigue-Flags (${a.flags.length}): ${a.flags.length === 0 ? "(keine)" : a.flags.map((f) => `[sev${f.severity}] ${f.description}`).join(" | ")}

Schluessel-Kennzahlen:
- HRV 7d: ${numOrDash(s.hrv7d, "ms")} (${s.hrvDeviationPct !== null ? (s.hrvDeviationPct > 0 ? "+" : "") + s.hrvDeviationPct.toFixed(1) + "%" : "—"} vs 28d)
- RHR 7d: ${numOrDash(s.rhr7d, " bpm", 0)} (Delta ${numOrDash(s.rhrDeltaBpm, " bpm", 1)})
- Schlaf 7d: ${s.sleepMin7d !== null ? `${Math.floor(s.sleepMin7d / 60)}h${Math.round(s.sleepMin7d % 60)}m` : "—"}
- ACWR: ${numOrDash(s.acwr, "", 2)} | Monotony: ${numOrDash(s.monotony, "", 2)} | Strain: ${Math.round(s.strain ?? 0)}
- VO2max: ${s.vo2max ?? "—"} (30d Delta ${numOrDash(s.vo2maxDelta30d, "", 1)})
- Tage seit voll erholt: ${s.daysSinceFullyRecovered ?? "—"}
- Low-Energy-Tage 7d: ${s.lowEnergyDaysLast7} | Soreness>=7 7d: ${s.highSorenessDaysLast7}

Observations:
${a.observations.map((o) => `- ${o}`).join("\n")}

## KALENDER — NAECHSTE WOCHE (geplante Termine)
${calLines}

---

Jetzt deine Wochenplanung in den 3 Sektionen. Sei KONKRET, NICHT generisch. Plan muss reproduzierbar
sein — der User liest das einmal und weiss was er jeden Tag tut.`;
}

export interface ParsedWeeklyPlan {
  weekOverview: string | null;
  schedule: string | null;
  watchouts: string | null;
}

export function parseWeeklyPlanResponse(text: string): ParsedWeeklyPlan {
  const findSection = (...headings: string[]): string | null => {
    for (const heading of headings) {
      const re = new RegExp(`##\\s*${heading.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`, "i");
      const m = text.match(re);
      if (m) return m[1].trim();
    }
    return null;
  };
  return {
    weekOverview: findSection("Wochen-Fokus", "Wochenfokus"),
    schedule: findSection("Wochenplan", "Plan"),
    watchouts: findSection("Worauf achten", "Watch-Outs"),
  };
}
