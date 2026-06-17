/**
 * Tiered Context-Builder fuer den Coach-Chat.
 *
 * Datendichte gestaffelt:
 *   - Tag 0-2 (letzte 3 Tage): SEHR genau — alle Metriken, Workouts mit allen Feldern, volles Journal
 *   - Tag 3-6 (letzte 7 Tage): genauer — Workouts mit RPE/Feel, Journal-Kernwerte, Tagesmetriken
 *   - Tag 7-13 (letzte 14 Tage): grob — pro Tag eine Zeile mit Schluesselzahlen
 */

import { format, differenceInCalendarDays, parseISO } from "date-fns";
import type { CoachAnalysis } from "@/lib/health/coach-analysis";

export interface ChatContextInput {
  today: string;
  analysis: CoachAnalysis;
  profile: {
    strengthPerWeek: number;
    runsPerWeek: number;
    longRunKm: number | null;
    shortRunKm: number | null;
    goals: string | null;
    restDays: number[];
    maxHr: number | null;
    dailyStepsGoal: number | null;
    dailyCaloriesGoal: number | null;
    weeklySlotPrefs: Record<string, unknown> | null;
    weeklyTemplateMarkdown: string | null;
  } | null;
  keyLifts: { name: string; unit: string; current: number | null; currentReps: number | null; notes: string | null }[];
  // Alle relevanten Rohdaten der letzten 14 Tage
  metricsByDate: Record<string, Record<string, number>>; // date -> kind -> value
  workouts: {
    date: string; startTime: string; type: string; name: string | null;
    durationMin: number; distanceKm: number | null; avgHr: number | null; maxHr: number | null;
    trainingLoad: number | null; rpe: number | null; feeling: number | null; notes: string | null;
  }[];
  journal: {
    date: string; filledAt: string | null; mood: number | null; energy: number | null; motivation: number | null;
    soreness: number | null; sleepQuality: number | null; workoutFelt: number | null;
    ateWell: boolean | null; alcoholDrinks: number | null; notes: string | null;
  }[];
  memories: { key: string; content: string }[];
  // heutige Empfehlung (falls vorhanden) damit der Chat darauf Bezug nehmen kann
  todayRecommendation: {
    statusFocus: string | null; actionsNow: string | null;
    strengthIntensity: number | null; cardioIntensity: number | null; adjustedScore: number | null;
  } | null;
  // Aktueller Wochenplan-Auszug (heute + morgen + naechste 3 Tage + Fokus)
  weekPlan: {
    focus: string | null;
    today: ChatWeekPlanDay | null;
    tomorrow: ChatWeekPlanDay | null;
    upcoming: ChatWeekPlanDay[]; // Tag+2, Tag+3, ...
  } | null;
}

export interface ChatWeekPlanDay {
  date: string;
  dow: string;
  dayFocus: string;
  sessions: Array<{
    start: string; end: string;
    type: string; title: string;
    exercises?: Array<{ name: string; sets: number; reps: string; intensity?: string }>;
    cardio?: { distanceKm?: number; durationMin?: number; zone?: string };
    reasoning?: string;
  }>;
}

function daysAgo(today: string, date: string): number {
  return differenceInCalendarDays(parseISO(today), parseISO(date));
}

function chatSlotPrefsBlock(s: Record<string, unknown>): string {
  const get = (k: string): string => (typeof s[k] === "string" ? (s[k] as string) : "—");
  const fb = Array.isArray(s.noonFallbacks) ? (s.noonFallbacks as string[]).join(", ") : "—";
  const sun = s.sundayLightOnly === false ? "voll trainierbar" : "Light-Default";
  return `Mo-Fr frueh ${get("morningStart")}-${get("morningEnd")} (Sommer-Lauf bevorzugt) · mittag ${get("noonPreferred")}-${get("noonEnd")} (Intervalle hier, nuechtern morgens) · Sa Long ${get("satLongStart")}-${get("satLongEnd")} · So ${sun} · Doppelsessions/Tag ok`;
}

export function buildChatContext(ctx: ChatContextInput): string {
  const a = ctx.analysis;
  const s = a.signals;
  const dowDe = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

  const fmtMetric = (date: string, kind: string, suffix = "") => {
    const v = ctx.metricsByDate[date]?.[kind];
    return v === undefined ? "—" : `${Math.round(v)}${suffix}`;
  };
  const fmtSleep = (date: string) => {
    const v = ctx.metricsByDate[date]?.sleep_minutes;
    return v === undefined ? "—" : `${Math.floor(v / 60)}h${Math.round(v % 60)}m`;
  };

  // Workouts + Journal nach Datum
  const workoutsByDate: Record<string, typeof ctx.workouts> = {};
  for (const w of ctx.workouts) (workoutsByDate[w.date] ??= []).push(w);
  const journalByDate: Record<string, (typeof ctx.journal)[number]> = {};
  for (const j of ctx.journal) journalByDate[j.date] = j;

  // Alle Daten der letzten 14 Tage
  const allDates: string[] = [];
  for (let i = 0; i < 14; i++) {
    const d = parseISO(ctx.today);
    d.setDate(d.getDate() - i);
    allDates.push(format(d, "yyyy-MM-dd"));
  }

  const detailLines: string[] = []; // 0-2 Tage
  const mediumLines: string[] = []; // 3-6 Tage
  const coarseLines: string[] = []; // 7-13 Tage

  for (const date of allDates) {
    const ago = daysAgo(ctx.today, date);
    const dow = dowDe[(parseISO(date).getDay() + 6) % 7];
    const ws = workoutsByDate[date] ?? [];
    const j = journalByDate[date];
    const label = ago === 0 ? "HEUTE" : ago === 1 ? "gestern" : `${dow} ${date.slice(5)}`;

    if (ago <= 2) {
      // SEHR genau
      let block = `### ${label} (${date})`;
      block += `\n  Metriken: HRV ${fmtMetric(date, "hrv_overnight", "ms")} · RHR ${fmtMetric(date, "rhr", "bpm")} · Schlaf ${fmtSleep(date)} · BB-Max ${fmtMetric(date, "body_battery_high")} · BB-Min ${fmtMetric(date, "body_battery_low")} · Stress ${fmtMetric(date, "stress_avg")} · Schritte ${fmtMetric(date, "steps")} · Kalorien-Verbrauch ${fmtMetric(date, "calories")} (aktiv ${fmtMetric(date, "calories_active")})`;
      if (ws.length === 0) {
        block += `\n  Training: keins`;
      } else {
        for (const w of ws) {
          const parts = [`Start ${w.startTime}`, `${w.type}`, `${w.durationMin}min`];
          if (w.distanceKm) parts.push(`${w.distanceKm.toFixed(1)}km`);
          if (w.avgHr) parts.push(`HR ${Math.round(w.avgHr)}/${w.maxHr ? Math.round(w.maxHr) : "?"}`);
          if (w.trainingLoad) parts.push(`Load ${Math.round(w.trainingLoad)}`);
          if (w.rpe) parts.push(`RPE ${w.rpe}`);
          if (w.feeling) parts.push(`Feel ${w.feeling}`);
          block += `\n  Training: ${parts.join(" · ")}${w.notes ? ` — "${w.notes}"` : ""}`;
        }
      }
      if (j) {
        const jp: string[] = [];
        if (j.filledAt) jp.push(`ausgefuellt ${j.filledAt}`);
        if (j.mood !== null) jp.push(`Mood ${j.mood}`);
        if (j.energy !== null) jp.push(`Energy ${j.energy}`);
        if (j.motivation !== null) jp.push(`Motivation ${j.motivation}`);
        if (j.soreness !== null) jp.push(`Soreness ${j.soreness}`);
        if (j.sleepQuality !== null) jp.push(`SchlafQ ${j.sleepQuality}`);
        if (j.workoutFelt !== null) jp.push(`WorkoutFelt ${j.workoutFelt}`);
        // ateWell + alcoholDrinks beziehen sich auf den VORTAG (Morgens ausgefuellt fuer gestern Abend)
        if (j.ateWell !== null) jp.push(`Vortag-Essen ${j.ateWell ? "ok" : "schlecht"}`);
        if (j.alcoholDrinks !== null && j.alcoholDrinks > 0) jp.push(`Vortag-Alk ${j.alcoholDrinks}`);
        block += `\n  Journal: ${jp.join(" · ") || "leer"}${j.notes ? ` — "${j.notes}"` : ""}`;
      } else {
        block += `\n  Journal: kein Eintrag`;
      }
      detailLines.push(block);
    } else if (ago <= 6) {
      // genauer — eine kompakte Zeile + Journal-Notiz
      const wTxt = ws.length === 0 ? "kein Training" : ws.map((w) => `${w.type} ${w.durationMin}min${w.rpe ? ` RPE${w.rpe}` : ""}${w.feeling ? ` Feel${w.feeling}` : ""}`).join(", ");
      const jTxt = j ? `Mood ${j.mood ?? "—"}/En ${j.energy ?? "—"}/Sore ${j.soreness ?? "—"}/SchlafQ ${j.sleepQuality ?? "—"}${j.alcoholDrinks ? `/Vortag-Alk ${j.alcoholDrinks}` : ""}` : "kein Journal";
      mediumLines.push(`- ${label}: HRV ${fmtMetric(date, "hrv_overnight")} · RHR ${fmtMetric(date, "rhr")} · Schlaf ${fmtSleep(date)} | ${wTxt} | ${jTxt}${j?.notes ? ` — "${j.notes}"` : ""}`);
    } else {
      // grob
      const wTxt = ws.length === 0 ? "frei" : ws.map((w) => w.type).join("+");
      coarseLines.push(`- ${label}: HRV ${fmtMetric(date, "hrv_overnight")} · RHR ${fmtMetric(date, "rhr")} · Schlaf ${fmtSleep(date)} · ${wTxt}${j?.energy != null ? ` · En ${j.energy}` : ""}`);
    }
  }

  const keyLiftsBlock = ctx.keyLifts.length === 0
    ? "(keine)"
    : ctx.keyLifts.map((k) => {
        const cur = k.current !== null ? (k.unit === "kg" ? `${k.current}kg${k.currentReps ? `×${k.currentReps}` : ""}` : `${k.current} ${k.unit}`) : "—";
        return `${k.name}: ${cur}${k.notes ? ` (${k.notes})` : ""}`;
      }).join(" | ");

  const memoryBlock = ctx.memories.length === 0
    ? "(keine)"
    : ctx.memories.map((m) => `### ${m.key}\n${m.content}`).join("\n\n");

  const rec = ctx.todayRecommendation;
  const recBlock = rec
    ? `Status/Fokus heute: ${rec.statusFocus?.replace(/\n+/g, " ").slice(0, 300) ?? "—"}\nIntensitaet-Empfehlung: Kraft ${rec.strengthIntensity ?? "—"}/10, Cardio ${rec.cardioIntensity ?? "—"}/10`
    : "(noch keine KI-Empfehlung heute generiert)";

  const renderPlanDay = (d: ChatWeekPlanDay): string => {
    if (d.sessions.length === 0) return `  ${d.dow} ${d.date} — Restday (${d.dayFocus || "—"})`;
    const ses = d.sessions.map((s) => {
      const c = s.cardio
        ? ` [${[s.cardio.distanceKm ? `${s.cardio.distanceKm}km` : null, s.cardio.durationMin ? `${s.cardio.durationMin}min` : null, s.cardio.zone].filter(Boolean).join(" · ")}]`
        : "";
      const ex = s.exercises && s.exercises.length > 0
        ? ` Uebungen: ${s.exercises.slice(0, 4).map((e) => `${e.name} ${e.sets}×${e.reps}`).join(", ")}${s.exercises.length > 4 ? "..." : ""}`
        : "";
      return `${s.start}-${s.end} ${s.title} (${s.type})${c}${ex}`;
    }).join(" | ");
    return `  ${d.dow} ${d.date} (${d.dayFocus || "—"}): ${ses}`;
  };

  const weekPlanBlock = ctx.weekPlan
    ? [
        ctx.weekPlan.focus ? `Wochen-Fokus: ${ctx.weekPlan.focus}` : null,
        ctx.weekPlan.today ? `HEUTE laut Plan:\n${renderPlanDay(ctx.weekPlan.today)}` : null,
        ctx.weekPlan.tomorrow ? `MORGEN laut Plan:\n${renderPlanDay(ctx.weekPlan.tomorrow)}` : null,
        ctx.weekPlan.upcoming.length > 0 ? `Naechste Tage:\n${ctx.weekPlan.upcoming.map(renderPlanDay).join("\n")}` : null,
      ].filter(Boolean).join("\n\n")
    : "(noch kein Wochenplan vorhanden)";

  return `# DATEN-SNAPSHOT (Stand ${ctx.today})

## ZIELE & PLAN
${ctx.profile?.goals ?? "(keine)"}
Wochenplan: ${ctx.profile?.strengthPerWeek ?? 0}x Kraft, ${ctx.profile?.runsPerWeek ?? 0}x Lauf (kurz ${ctx.profile?.shortRunKm ?? "—"}km, lang ${ctx.profile?.longRunKm ?? "—"}km) · Restdays ${(ctx.profile?.restDays ?? []).map((d) => dowDe[d - 1]).join(",") || "—"} · MaxHr ${ctx.profile?.maxHr ?? "—"}
Tagesziele: ${ctx.profile?.dailyStepsGoal ?? "—"} Schritte, ${ctx.profile?.dailyCaloriesGoal ?? "—"} kcal Verbrauch
Key-Lifts: ${keyLiftsBlock}

### Bevorzugte Trainings-Slots
${ctx.profile?.weeklySlotPrefs ? chatSlotPrefsBlock(ctx.profile.weeklySlotPrefs) : "(nicht gesetzt)"}

### Aktuelles Trainings-Setup (Referenz)
${ctx.profile?.weeklyTemplateMarkdown ? ctx.profile.weeklyTemplateMarkdown : "(nicht gepflegt)"}

## ALGORITHMISCHE ANALYSE (heute)
Status: ${a.status} · Wochenstrategie: ${a.weekStrategy.type} (${a.weekStrategy.headline}) · Deload empfohlen: ${a.deloadRecommended ? "JA" : "nein"}
Fatigue-Flags: ${a.flags.length === 0 ? "keine" : a.flags.map((f) => `${f.description}`).join(" | ")}
HRV 7d ${s.hrv7d?.toFixed(0) ?? "—"}ms (${s.hrvDeviationPct !== null ? (s.hrvDeviationPct > 0 ? "+" : "") + s.hrvDeviationPct.toFixed(0) + "%" : "—"}) · RHR 7d ${s.rhr7d?.toFixed(0) ?? "—"} · ACWR ${s.acwr?.toFixed(2) ?? "—"} · Monotony ${s.monotony?.toFixed(2) ?? "—"} · Tage seit voll erholt ${s.daysSinceFullyRecovered ?? "—"} · Low-Energy 7d ${s.lowEnergyDaysLast7}

## HEUTIGE KI-EMPFEHLUNG
${recBlock}

## AKTUELLER WOCHENPLAN
${weekPlanBlock}

## LETZTE 3 TAGE (sehr genau)
${detailLines.join("\n\n")}

## TAG 4-7 (genauer)
${mediumLines.join("\n") || "(keine Daten)"}

## TAG 8-14 (grob)
${coarseLines.join("\n") || "(keine Daten)"}

## DEINE FRUEHEREN MEMOS
${memoryBlock}`;
}
