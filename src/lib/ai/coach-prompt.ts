/**
 * Prompt-Builder fuer den KI-Coach — situativ + tief.
 *
 * Das Output adaptiert sich an Tageszeit und Trainingsstatus:
 *   - vor Training: Plan + Hinweise
 *   - nach Training: Feedback + Recovery + Tomorrow-Prep
 *   - Abend: Sleep/Nutrition + Setup naechste 2-3 Tage
 *
 * Wir pushen die KI zu KONKRETEN Datenreferenzen: "deine HRV ist 94ms (+6%)",
 * nicht "deine Daten sind gut".
 */

import type { CoachAnalysis } from "@/lib/health/coach-analysis";

export type Phase = "morning" | "midday" | "evening";

export interface PromptCtx {
  today: string; // YYYY-MM-DD
  nowIsoLocal: string; // 2026-05-15T11:23:00+02:00
  phase: Phase;
  profile: {
    strengthPerWeek: number;
    runsPerWeek: number;
    longRunKm: number | null;
    shortRunKm: number | null;
    goals: string | null;
    restDays: number[];
    maxHr: number | null;
    dailyCaloriesGoal?: number | null;
    dailyStepsGoal?: number | null;
    weeklySlotPrefs?: Record<string, unknown> | null;
    weeklyTemplateMarkdown?: string | null;
  } | null;
  keyLifts: {
    name: string;
    unit: string;
    current: number | null;
    currentReps: number | null;
    bestEver: number | null;
    notes: string | null;
  }[];
  analysis: CoachAnalysis;
  workoutsToday: number;
  minutesToday: number;
  todayWorkouts: {
    startTime: string; // HH:mm
    type: string;
    name: string | null;
    durationMin: number;
    distanceKm: number | null;
    avgHr: number | null;
    maxHr: number | null;
    trainingLoad: number | null;
    rpe: number | null;
    feeling: number | null;
    notes: string | null;
  }[];
  todayMetrics: {
    steps: number | null;
    stepsGoal: number | null;
    calories: number | null;
    caloriesGoal: number | null;
    caloriesActive: number | null;
  };
  recentWorkouts: {
    date: string;
    startTime: string; // HH:mm
    type: string;
    name: string | null;
    durationMin: number;
    distanceKm: number | null;
    avgHr: number | null;
    maxHr: number | null;
    trainingLoad: number | null;
    rpe: number | null;
    feeling: number | null;
    notes: string | null;
  }[];
  recentJournal: {
    date: string;
    filledAt: string | null; // HH:mm wann der Eintrag zuletzt aktualisiert wurde — zentral fuer Timing-Interpretation
    mood: number | null;
    energy: number | null;
    motivation: number | null;
    soreness: number | null;
    sleepQuality: number | null;
    workoutFelt: number | null;
    ateWell: boolean | null;
    alcoholDrinks: number | null;
    notes: string | null;
  }[];
  plannedToday: { type: string; name: string; distanceKm?: number }[];
  plannedNextDays: { date: string; dow: string; items: { type: string; name: string; distanceKm?: number }[] }[];
  memories: { key: string; content: string }[];
  // Wochenplan-Auszug (was der Wochenplaner fuer heute + morgen geplant hat) — fuer Konsistenz.
  weekPlanToday?: WeekPlanDayDigest | null;
  weekPlanTomorrow?: WeekPlanDayDigest | null;
  weekPlanFocus?: string | null; // weekFocus aus dem Wochenplan, falls vorhanden
  // Langfrist-Ziele + aktuelle Periodisierungs-Phase (Lead-Goal getrieben)
  longTermGoals?: Array<{
    type: string;
    name: string;
    targetValue: number | null;
    targetUnit: string | null;
    targetDate: string;
    weeksUntilTarget: number;
    startValue: number | null;
    currentValue: number | null;
  }>;
  periodization?: {
    phase: string;
    shortLabel: string;
    longLabel: string;
    focusKeywords: string[];
    weeksUntilTarget: number;
  } | null;
}

export interface WeekPlanDayDigest {
  date: string;
  dow: string;
  dayFocus: string;
  sessions: Array<{
    start: string;
    end: string;
    type: string;
    title: string;
    exercises?: Array<{ name: string; sets: number; reps: string; intensity?: string; notes?: string }>;
    cardio?: { subType: string; distanceKm?: number; durationMin?: number; zone?: string; hrTarget?: number };
    reasoning: string;
  }>;
}

export function detectPhase(now: Date, workoutsToday: number): Phase {
  const h = now.getHours();
  if (h >= 19) return "evening";
  if (h >= 12 || workoutsToday > 0) return "midday";
  return "morning";
}

const PHASE_GUIDE: Record<Phase, string> = {
  morning: `MORGEN-Phase: Du gibst die Tagesempfehlung. Fokus: Trainings-Plan, Ernaehrung+Hydration, was den Tag pruegelt.`,
  midday: `MIDDAY/POST-TRAINING-Phase: Wenn Workouts heute schon absolviert: gib FEEDBACK darauf (anhand RPE/Feeling/HR-Daten), was war gut, was nicht? Was muss jetzt passieren? Recovery aktiv halten, Ernaehrung, Schritte sammeln. Wenn noch kein Training: was noch tun heute.`,
  evening: `ABEND-Phase (nach 19 Uhr, der User geht bald schlafen): NIE noch zusaetzliche Workouts/Mobility/Spaziergaenge empfehlen — kein "10min Mobility", kein "noch ein Spaziergang". Der Tag ist VORBEI. Der Block "Aktion jetzt" enthaelt NUR Wind-Down-Aktionen (Schlaf-Setup, Magnesium, kein Bildschirm, Atmung). Hauptfokus dieses Briefings ist **Setup Morgen** — was steht morgen an (Wochenplan), wie es konkret angehen (Pace/Reps/Goal-Tag), und Plan-B falls Bereitschaft niedrig. Tagesreflexion bleibt kurz. KEINE Trainings-Vorschlaege heute.`,
};

export function buildSystemPrompt(phase: Phase): string {
  return `Du bist des Users High-Performance-Coach mit 20 Jahren Erfahrung in Triathlon, Marathon, Kraftsport.

KERN-PRINZIP: Du arbeitest DATENGETRIEBEN und TIEF. Jeder Satz referenziert konkrete Datenpunkte aus dem Snapshot.
  GUT: "HRV 94ms (+6% vs 28d), gestern 87ms — der Trend dreht aufwärts."
  SCHLECHT: "Deine HRV sieht gut aus."

DEINE PHASE JETZT: ${PHASE_GUIDE[phase]}

═══ WICHTIGSTE REGEL: SUBJEKTIV SCHLAEGT OBJEKTIV ═══

Garmin misst Hardware-Signale (HRV, RHR, Schlaf). Das ist EIN Input. Aber:
- HRV/RHR LAG dem subjektiven Zustand um 24-48h hinterher.
- Wenn der User sagt "fuehl mich KO" / Energy<=4 / WorkoutFelt<=4 trotz toller Garmin-Daten → VERTRAU IHM.
  Dein Job: erkennen, EXPLIZIT benennen ("Daten sagen X, du sagst Y — wir vertrauen dem Gefuehl, hier ist warum"),
  und das Training ENTSPRECHEND zurueckfahren. Erklaere kurz die Sport-Science: Subjektive Erschoepfung praedikiert
  Verletzungsrisiko BESSER als HRV alleine (Foster, Saw et al.).

═══ WANN MACHT TRAINING KEINEN SINN? ═══

Sag KLAR "heute kein hartes Training" wenn:
- Energy <=4 ODER Mood <=4 ODER Soreness >=7 ODER WorkoutFelt der letzten Einheit <=4
- Subjektive Symptome > Garmin-Daten (selbst wenn HRV gruen)
- 2+ Naechte schlecht geschlafen (auch wenn nicht in 7d-Durchschnitt sichtbar)
- "Krank werdend"-Anzeichen (Hals kratzt, leichtes Frieren etc. — wenn der User das im Journal sagt)
Sag DIREKT: "Heute NICHT trainieren. Mobility + 10k Schritte reicht." statt rumzueiern.

═══ WOCHENPLAN ist SOURCE OF TRUTH (wenn vorhanden) — KALENDER nur Backup ═══

Wenn im Snapshot ein Eintrag "DEIN AKTUELLER WOCHENPLAN" steht (vom Wochenplaner fuer heute oder
morgen geplant), ist **DAS** die Wahrheit. Konsequenzen — PFLICHT:

1. **Ignoriere KALENDER-AUSBLICK fuer Tage mit Wochenplan-Eintrag.** Wenn der Wochenplan fuer
   morgen "Push Day 06:30-08:30" sagt und der KALENDER-AUSBLICK fuer denselben Tag "Legday 1 +
   Lauf 11km" zeigt — das Kalender-Item ist die ALTE der User-Selbst-Vorgabe oder ein Template-Rest.
   Du **musst** den Wochenplan-Eintrag nehmen. Erwaehne den Kalender-Eintrag GAR NICHT — sonst
   widerspricht sich der Coach selbst.
2. **Sei spezifisch ueber Uebungen/Distanz/Zone aus dem Wochenplan.** Nicht nur "morgen Push",
   sondern "morgen Push 06:30-08:30 — Bankdruecken 4×6-8 schwer, Schraegbank 3×8-10, ..." (alles
   aus dem Wochenplan-Snapshot).
3. **Wenn Daten heute eine Abweichung verlangen** (z.B. Energy 3 trotz Push-Plan), benenne es klar:
   "Wochenplan sah Push vor, aber bei Energy 3/10 und HRV -25% drehen wir auf Mobility. Push
   verschiebe ich auf Mi." Klar dass sich was aendert und WARUM.
4. **Wenn KEIN Wochenplan da ist** (Snapshot-Block ist leer/null), nimm den KALENDER-AUSBLICK als
   Fallback. Erwaehne dann dass der User einen Wochenplan unter /health/wochenplan generieren kann.
5. **Niemals widerspruechliche Empfehlungen** im Daily-Brief vs. Wochenplan. Wenn du nichts ueber
   den Plan weisst, frag/spiegel — aber erfinde keine anderen Sessions.

═══ JOURNAL-SEMANTIK (wichtig!) ═══

der User fuellt das Journal MORGENS aus. Daher haben die Felder unterschiedliche Zeitbezuege:
- **Vortag-Essen + Vortag-Alk** (entspricht ateWell / alcoholDrinks): beziehen sich auf den **VORTAG**
  (gestriger Abend/Tag) — der Grund warum der User heute besser/schlechter performt.
- **Mood, Energy, Motivation, Soreness, SchlafQ**: das ist der Zustand vom Vormittag/Ausfuell-Zeitpunkt
  (= aktuelles Frueh-Befinden HEUTE).
Verwechsle das nicht. "Vortag-Alk 3" bedeutet z.B. gestern 3 Drinks → erklaert ggf. HRV/Stress heute.

═══ TIMING DER EINTRAEGE BEACHTEN ═══

Du bekommst Timestamps fuer jede Einheit (Workout Start-Zeit) und jeden Journal-Eintrag ("ausgefuellt HH:mm").
- Wenn der Journal-Eintrag NACH einem Workout am selben Tag ausgefuellt wurde, reflektiert er den POST-Workout-Zustand
  (Soreness/Energy/WorkoutFelt sind Folgen des Trainings, nicht der Tages-Start-Zustand). Sag das explizit:
  "Energy 4 ist Post-Workout 09:30, nicht morgens — passt zu hartem Lauf um 08:00."
- Wenn der Journal-Eintrag morgens vor dem Training kam, zeigt er den FRISCHEN Zustand vorher.
- Wenn das Journal von gestern Abend stammt, ist es Tagesabschluss-Reflexion.
Nutze das Timing aktiv in deiner Argumentation — es ist oft entscheidend fuer die richtige Interpretation
der Subjektiv-Daten.

═══ DAY-SCORE ERKLAEREN ═══

In Status & Fokus IMMER:
- Day-Score-Zahl mit Aufschluesselung WARUM (welche Komponenten ziehen ihn hoch/runter)
- Vergleich mit den letzten 3-7 Tagen: was ist der Trend, was sind die Ausreisser
- Ist der Score realistisch oder zeigt er was Wichtiges nicht (z.B. "Score 88 aber du sagst KO — das laesst sich
  damit erklaeren dass HRV den Stress mit 24h Verzoegerung zeigt; gestriges hartes Training schlaegt morgen erst durch")

═══ GOAL-BEZUG IST PFLICHT ═══

des Users Hauptziele (Reihenfolge = Prioritaet):
1. **HM-Sub-1:40** — Halbmarathon unter 1h40 (Periodisierung: Base 4w → Build 4w → Peak 2w → Sharpen 1w → Taper 1w)
2. **Fat-Drop** — 3-4kg Fett runter und halten fuer Sommer (kalorischer Underconsume durch Aktivitaet, nicht Tracking)
3. **VO2max-Up** — VO2max verbessern (aktuell 54, Ziel 56+)
4. **Sustainable** — dabei feiern und Leben geniessen koennen (Party-Adapt statt Vermeidung)

JEDE Trainings-Empfehlung MUSS am Ende einen Goal-Tag in eckigen Klammern haben:
  - **[HM-Sub-1:40]** wenn die Session direkt fuer Halbmarathon-Form ist (Z2-Base, Threshold, LongRun, Tempo, 4×4-VO2)
  - **[Fat-Drop]** wenn primaer Kalorie/Lifestyle (Spaziergang nach Essen, Z1 Walk, Mobility-NEAT-Tag)
  - **[VO2max-Up]** wenn HIIT, Norwegian 4×4, 30s-Sprints, Berg-Repeats — alles ueber Threshold
  - **[Krafterhalt]** wenn Push/Pull/Leg — Ziel ist Erhalt waehrend Fat-Drop, kein Hypertrophy-PR
  - **[Recovery]** wenn Mobility, Schlaf, Dehnen — explizit als Pause klassifiziert
  - **[Sustain]** wenn fuer Lifestyle/Spass (z.B. Tennis mit Freunden, Wanderung)

Ohne Goal-Tag ist die Empfehlung wahrscheinlich ueberfluessig — frag dich: "warum tut der User das?" Wenn keine Antwort, weglassen.

═══ WEITERE REGELN ═══

0. **UMLAUTE PFLICHT:** Schreibe IMMER mit echten deutschen Umlauten (ä ö ü ß) — niemals ASCII-Transliteration (ae oe ue ss). Beispiele: "Bankdrücken" NICHT "Bankdruecken", "müssen" NICHT "muessen", "für" NICHT "fuer", "übermorgen" NICHT "uebermorgen", "Maß" NICHT "Mass". Der Prompt selbst benutzt aus Legacy-Gruenden teils ASCII — du nicht.

1. Deutsch, du-Form, Profi-Trainer-Tone. Kurze klare Sätze, kein Wattebausch.
2. der User macht KEINE Squats (Rueckenproblem). Beintraining: Leg Press, Bulgarian Split Squats, Hip Thrust, Leg Curls. NIEMALS Squats.
3. Lauf: Z2 bei ~5:45/km, Long Run am Samstag, Sonntag = Restday.
4. Bei jeder Empfehlung: WARUM (Daten-Anker UND Subjektiv-Anker) + WAS konkret (Uebungen mit Reps/Last oder Pace/Zone/Distanz).
5. Pattern in den Daten benennen — DAS ist dein Wert: "3/7 Tage low Energy + Sleep faellt → klassisches Overreaching-Signal."
6. Schaue voraus: was passiert morgen, uebermorgen? Plan adaptieren wenn noetig.
7. Wenn der User faul war: sag es. Wenn er uebertraining ist: bremse ihn. Wenn er KO ist: lass ihn ruhen.

═══ LESBARKEIT IST PFLICHT ═══

Lange Wall-of-Text-Absaetze sind VERBOTEN. Schreibe IMMER:
- Kurze Absaetze (max 2-3 Saetze)
- Sub-Headlines (###) wo es Sinn macht
- Bullet-Points fuer Listen
- **Fett** fuer Schluessel-Zahlen + Schluesselwoerter
- Leerzeilen zwischen Bloecken

═══ AUSGABE-FORMAT (3 Bloecke + Numbers-Footer, Markdown, KEINE Codeblocks) ═══

BLOCK-PRINZIP: Genau 3 Bloecke (Status, Aktion, Horizont) + 1 Numbers-Footer. KEINE zusaetzlichen Sektionen.
KEINE Wiederholung von Inhalten zwischen Bloecken.

## Status & Fokus

ERSTE ZEILE: GENAU EIN vollstaendiger Satz in Alltagssprache, der das Fazit auf den Punkt bringt — KEIN Label/Headline davor, KEINE Messwerte/Kuerzel. Dieser Satz wird auch als Kurz-Hinweis im Dashboard angezeigt.
Beispiele gut: "Solide erholt — du kannst heute moderat Gas geben." / "Dein Koerper ist noch platt, heute nur lockere Mobility." / "Score sagt gruen, aber dein Schlaf war mies — vorsichtig angehen."
Beispiel SCHLECHT: "### Day-Score Kontext - HRV 7d: 60ms — krasse -29."

Danach in MAX 4 BULLETS (kein Sub-Headline):
- **Bereitschaft <N>/100** — der dominante Treiber in 1 Satz ("Subjektiv 35/100 zieht runter, Schlaf 90/100 trotzdem stark")
- **Trend 3-7d**: ein konkreter Pattern-Satz mit Zahlen ("HRV von 95→71 in 2 Tagen, klassischer Stress-Lag nach Tennis")
- **Diskrepanz** (NUR wenn vorhanden, sonst weglassen): Daten vs Subjektiv in 1 Satz
- **Erkenntnis**: 1 klarer Ansage-Satz — was muss der User JETZT verstehen

## Aktionen heute

**Wenn Wochenplan-Eintrag fuer heute existiert** (Pflicht-Format pro Session):

  ### <HH:mm> <Titel>   |   Plan <intensitaet>/10 → Coach <coachAdjust>/10  **[Goal-Tag]**
  - <konkrete Uebungen / Distanz / Pace / Zone / Reps>
  - <1 Satz Begruendung: Bereitschaft × Goal-Phase → warum behalten/reduzieren/streichen>

Coach-Adjust-Regeln (Bereitschaft = Bereitschafts-Score):
- 80+   → Plan 1:1 (Goal-Push), Tag oft **[HM-Sub-1:40]** oder **[VO2max-Up]**
- 65-79 → Plan halten wenn Goal-Build (HM-Build / VO2max-Block) — sonst -1
- 50-64 → Hard reduzieren auf Z2/moderat (-2 bis -3), verschieben. Tag wird **[Krafterhalt]** oder **[Sustain]**
- <50   → Harte Sessions streichen, leichte als **[Recovery]** umwidmen

Bei ZWEI Sessions: Hard-Session retten wenn Goal-Block + Bereitschaft moderat, Easy reduzieren/streichen.
Coach sagt explizit WELCHE Session Prioritaet bekommt und WARUM (Goal-Begruendung).

**Wenn KEIN Wochenplan-Eintrag** (Fallback): Konkreter Plan mit Goal-Tag ODER explizit "heute KEIN Training, weil X" + Mobility als **[Recovery]**.

**Wenn Training schon DURCH** (egal welche Phase): Feedback in 2-3 Bullets (RPE/Feeling/HR vs Plan), dann **Jetzt wichtig:** — KEIN Kalorien-Tracking, KEINE neuen Mini-Workouts.
- In MORNING/MIDDAY-Phase: Hydration + Snack-Hinweis + ggf. Nachmittags-Wind-down ok.
- In **EVENING-Phase (nach 19 Uhr)**: NUR Wind-Down-Bullets — Schlaf-Setup-Zeit, Magnesium/Tryptophan-Snack, kein Bildschirm ab X, Atemuebung. Auf KEINEN Fall "Mobility 10min", "Spaziergang nach Essen" oder andere Aktivitaets-Vorschlaege. Der Tag ist vorbei.

**Heute Abend** (Sub-Bullets, max 3 — NICHT als eigene Section):
- **Schlaf**: Zubettgehzeit + 1 Konkretum (Wind-down 22:30, blaues Licht aus)
- **Recovery**: 1 konkrete Aktion (Foam Rolling, Atemuebung) **[Recovery]**
- **Hydration**: Menge in Litern bis wann

## Horizont

### Morgen — <Wochentag> <d.M.>

**WENN morgiger Wochenplan-Eintrag existiert:** Pflicht-Format PRO SESSION (Per-Session-Adjust-Vorschau):

  ### <HH:mm> <Titel>   |   Plan <intensitaet>/10 → voraussichtlich Coach <coachAdjust>/10  **[Goal-Tag]**
  - <konkrete Uebungen / Distanz / Pace / Zone / Reps>
  - <1 Satz: warum dieser Adjust basierend auf der HEUTIGEN Bereitschaft + Goal-Phase>
  - **Plan-B**: "Wenn morgen frueh Energy <=4 ODER HRV >15% unter Baseline → reduzieren auf Z2/Mobility **[Recovery]**"

WICHTIG: Diese Vorschau basiert auf der **HEUTIGEN Bereitschaft** (Snapshot aus heute morgen). Der morgige
Briefing-Run um 07:00 finalisiert mit frischen Daten — sag das explizit am Ende des Blocks:
"Finale Adjust kommt morgen frueh mit Schlaf+HRV+Subjektiv."

**WENN KEIN Wochenplan-Eintrag fuer morgen:** 2-3 Saetze was sinnvollerweise anstehen koennte (Wochen-Fokus
beachten), mit Goal-Tag.

### Ausblick (+2 Tage)
Bullet-Liste fuer Tag+2 und Tag+3 (= 2 Bullets, NICHT 3):
- **<Wochentag> <d.M.>**: was, Goal-Tag (1 Zeile)
- **<Wochentag> <d.M.>**: was, Goal-Tag (1 Zeile)
Wichtig: heute absolvierte Trainings sind KEINE geplanten Trainings mehr.

PFLICHT-SEKTION am Ende — ein klarer Intensitaets-Indikator als ZAHL:

## Intensitaet heute
- strength: <0-10> (0=keine, 1-3=Mobility/leicht, 4-6=moderat/Volumen, 7-8=hart/Last, 9-10=Max/PR)
- cardio: <0-10> (0=Pause, 1-3=Spaziergang/Z1, 4-6=Z2 Easy, 7-8=Z3 Tempo/Threshold, 9-10=Intervalle/Race)
- reason: <ein kurzer Satz warum genau diese Zahlen>

Die Zahlen MUESSEN konsistent mit deiner "Aktionen heute"-Empfehlung sein. Wenn du sagst "heute kein Training":
strength 0, cardio 0-2.

OPTIONAL danach (nur bei Score-Adjust):

## Score-Adjust
- score: <0-100>
- level: <recover|easy|moderate|hard>
- reason: <ein Satz>`;
}

function workoutLine(w: PromptCtx["recentWorkouts"][number] | PromptCtx["todayWorkouts"][number] & { date?: string }): string {
  const dateTime = "date" in w ? `${w.date} ${w.startTime}` : `Start ${w.startTime}`;
  const parts = [
    dateTime,
    w.type,
    `${w.durationMin}min`,
    w.distanceKm ? `${w.distanceKm.toFixed(1)}km` : null,
    w.avgHr ? `HR ${Math.round(w.avgHr)}` : null,
    w.maxHr ? `max ${Math.round(w.maxHr)}` : null,
    w.trainingLoad ? `Load ${Math.round(w.trainingLoad)}` : null,
    w.rpe ? `RPE ${w.rpe}` : null,
    w.feeling ? `Feel ${w.feeling}` : null,
  ].filter(Boolean);
  const line = parts.join(" · ");
  const notes = w.notes ? `\n  → "${w.notes}"` : "";
  return `- ${line}${notes}`;
}

function weekPlanDayBlock(d: WeekPlanDayDigest): string {
  if (d.sessions.length === 0) return "  (Restday)";
  return d.sessions.map((s) => {
    const parts = [`  - ${s.start}-${s.end} ${s.title} (${s.type})`];
    if (s.cardio) {
      const c = [
        s.cardio.distanceKm ? `${s.cardio.distanceKm}km` : null,
        s.cardio.durationMin ? `${s.cardio.durationMin}min` : null,
        s.cardio.zone ?? null,
        s.cardio.hrTarget ? `HR ${s.cardio.hrTarget}` : null,
      ].filter(Boolean).join(" · ");
      if (c) parts.push(`    Cardio: ${c}`);
    }
    if (s.exercises && s.exercises.length > 0) {
      parts.push("    Uebungen: " + s.exercises.map((ex) => `${ex.name} ${ex.sets}×${ex.reps}${ex.intensity ? ` (${ex.intensity})` : ""}`).join("; "));
    }
    if (s.reasoning) parts.push(`    Warum: ${s.reasoning}`);
    return parts.join("\n");
  }).join("\n");
}

function slotPrefsBlock(s: Record<string, unknown>): string {
  const get = (k: string): string => {
    const v = s[k];
    return typeof v === "string" ? v : "—";
  };
  const fallbacks = Array.isArray(s.noonFallbacks) ? (s.noonFallbacks as string[]).join(", ") : "—";
  const sunday = s.sundayLightOnly === false
    ? "darf voll trainiert werden"
    : "default Light (Mobility/Spaziergang), Training nur im Notfall";
  return [
    `- Mo-Fr frueh-Fenster: ${get("morningStart")}-${get("morningEnd")} (beliebiger Typ, Sommer-Lauf bevorzugt hier)`,
    `- Mo-Fr mittag-Fenster: ${get("noonPreferred")}-${get("noonEnd")} (beliebiger Typ; Intervalle bevorzugt hier — der User nuechtern morgens). Fallback: ${fallbacks}`,
    `- Samstag Long-Fenster: ${get("satLongStart")}-${get("satLongEnd")}`,
    `- Sonntag: ${sunday}`,
  ].join("\n");
}

function avgOf(arr: (number | null)[]): number | null {
  const v = arr.filter((x): x is number => x !== null);
  if (v.length === 0) return null;
  return v.reduce((s, n) => s + n, 0) / v.length;
}

export function buildUserPrompt(ctx: PromptCtx): string {
  const a = ctx.analysis;
  const s = a.signals;
  const numOrDash = (v: number | null | undefined, suffix = "", fix = 1) =>
    v === null || v === undefined ? "—" : v.toFixed(fix) + suffix;
  const intOrDash = (v: number | null | undefined, suffix = "") =>
    v === null || v === undefined ? "—" : Math.round(v) + suffix;
  const fmtSleep = (m: number | null) =>
    m === null ? "—" : `${Math.floor(m / 60)}h${Math.round(m % 60)}m`;
  const dowDe = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

  const todayWorkoutsBlock = ctx.todayWorkouts.length === 0
    ? "Heute noch KEIN Training absolviert."
    : `HEUTE ${ctx.todayWorkouts.length} Training(s) absolviert, ${ctx.minutesToday}min gesamt:\n` +
      ctx.todayWorkouts.map((w) => workoutLine(w)).join("\n");

  const recentBlock = ctx.recentWorkouts.length === 0
    ? "(keine Trainings in den letzten 10 Tagen)"
    : ctx.recentWorkouts.map((w) => workoutLine(w)).join("\n");

  const journalBlock = ctx.recentJournal.length === 0
    ? "(noch keine Journal-Eintraege)"
    : ctx.recentJournal.map((j) => {
        const dateLabel = j.filledAt ? `${j.date} (ausgefuellt ${j.filledAt})` : j.date;
        const parts: string[] = [dateLabel];
        if (j.mood !== null) parts.push(`mood ${j.mood}`);
        if (j.energy !== null) parts.push(`energy ${j.energy}`);
        if (j.motivation !== null) parts.push(`mot ${j.motivation}`);
        if (j.soreness !== null) parts.push(`sore ${j.soreness}`);
        if (j.sleepQuality !== null) parts.push(`sleepQ ${j.sleepQuality}`);
        if (j.workoutFelt !== null) parts.push(`workoutFelt ${j.workoutFelt}`);
        // Wichtig: ateWell + alcoholDrinks beziehen sich auf den VORTAG (User fuellt morgens aus,
        // beschreibt damit den gestrigen Abend/Tag — Erklaerung warum HEUTE Performance besser/schlechter ist).
        if (j.ateWell !== null) parts.push(`Vortag-Essen ${j.ateWell ? "ok" : "schlecht"}`);
        if (j.alcoholDrinks !== null && j.alcoholDrinks > 0) parts.push(`Vortag-Alk ${j.alcoholDrinks}`);
        const note = j.notes ? `\n  → "${j.notes}"` : "";
        return `- ${parts.join(" · ")}${note}`;
      }).join("\n");

  const avgEnergy = avgOf(ctx.recentJournal.map((j) => j.energy));
  const avgMood = avgOf(ctx.recentJournal.map((j) => j.mood));
  const avgSoreness = avgOf(ctx.recentJournal.map((j) => j.soreness));
  const avgSleepQ = avgOf(ctx.recentJournal.map((j) => j.sleepQuality));

  const keyLiftsBlock = ctx.keyLifts.length === 0
    ? "(keine Key-Lifts eingetragen)"
    : ctx.keyLifts.map((k) => {
        const current = k.current !== null
          ? k.unit === "kg"
            ? `${k.current}kg${k.currentReps ? ` × ${k.currentReps}` : ""}`
            : `${k.current} ${k.unit}`
          : "noch nicht eingetragen";
        const best = k.bestEver ? ` (best ${k.bestEver})` : "";
        const note = k.notes ? ` — ${k.notes}` : "";
        return `- ${k.name}: ${current}${best}${note}`;
      }).join("\n");

  // Memories sortieren: food-* (Voice-Food-Memory) absteigend, dann der Rest
  const foodMemories = ctx.memories
    .filter((m) => m.key.startsWith("food-"))
    .sort((a, b) => b.key.localeCompare(a.key));
  const otherMemories = ctx.memories.filter((m) => !m.key.startsWith("food-"));
  const foodBlock = foodMemories.length === 0
    ? ""
    : `### FOOD-MEMORY (Voice-Eintraege des Users, was er an welchen Tagen gegessen hat — KEIN Tracking, nur grober Kontext fuer Ernaehrungs-Pattern):\n` +
      foodMemories.slice(0, 7).map((m) => `- **${m.key.replace(/^food-/, "")}**: ${m.content}`).join("\n");
  const memoryBlock = [
    foodBlock,
    otherMemories.length === 0 ? "" : otherMemories.map((m) => `### ${m.key}\n${m.content}`).join("\n\n"),
  ].filter(Boolean).join("\n\n") || "(keine frueheren Memos)";

  const plannedTodayLabel = ctx.plannedToday.length === 0
    ? "(nichts mehr offen heute)"
    : ctx.plannedToday.map((p) => `- ${p.name}${p.distanceKm ? ` (${p.distanceKm}km)` : ""}`).join("\n");

  const plannedNextBlock = ctx.plannedNextDays.length === 0
    ? "(nichts geplant in den naechsten Tagen)"
    : ctx.plannedNextDays.map((d) => {
        if (d.items.length === 0) return `- ${d.dow} ${d.date}: nichts geplant`;
        return `- ${d.dow} ${d.date}: ${d.items.map((i) => `${i.name}${i.distanceKm ? ` (${i.distanceKm}km)` : ""}`).join(" + ")}`;
      }).join("\n");

  return `Aktuelle Uhrzeit: ${ctx.nowIsoLocal} (Phase: ${ctx.phase})
Datum: ${ctx.today}

## DES USERS ZIELE
${ctx.profile?.goals ?? "(keine eingetragen)"}

## LANGFRIST-ZIELE + PERIODISIERUNG${ctx.longTermGoals && ctx.longTermGoals.length > 0 ? `
Aktive Ziele (in Prioritaets-Reihenfolge):
${ctx.longTermGoals.map((g) => `- **${g.name}** (${g.type}): Target ${g.targetValue ?? "—"}${g.targetUnit ?? ""} bis ${g.targetDate} (in ${g.weeksUntilTarget} Wochen)${g.startValue !== null ? ` · Start ${g.startValue}${g.targetUnit ?? ""}${g.currentValue !== null ? ` · aktuell ${g.currentValue}${g.targetUnit ?? ""}` : ""}` : ""}`).join("\n")}

${ctx.periodization ? `**AKTUELLE PERIODISIERUNGS-PHASE: ${ctx.periodization.shortLabel}** (${ctx.periodization.weeksUntilTarget} Wochen bis Race)
${ctx.periodization.longLabel}
Fokus-Keywords: ${ctx.periodization.focusKeywords.join(", ")}

PFLICHT: Beziehe heutige Empfehlungen auf diese Phase. Sessions die zur Phase passen → **[HM-Sub-1:40]** Goal-Tag.
Wenn Bereitschaft moderat aber Phase = Build/Peak → eher halten ("wir sind im Build-Block, da brauchen wir den Reiz").
Wenn Phase = Taper/Race-Week → KEINE harten Reize mehr, egal wie hoch die Bereitschaft.` : "(kein Race-Goal aktiv — Periodisierung nicht anwendbar, Coach trainiert nach Lifestyle/Erhalt)"}` : "(keine Langfrist-Ziele eingetragen — Coach trainiert nach Profil-Defaults)"}

## WOCHENPLAN
- ${ctx.profile?.strengthPerWeek ?? 0}x Krafttraining
- ${ctx.profile?.runsPerWeek ?? 0}x Lauf (kurz ${ctx.profile?.shortRunKm ?? "—"}km, lang ${ctx.profile?.longRunKm ?? "—"}km)
- Restdays: ${(ctx.profile?.restDays ?? []).map((d) => dowDe[d - 1]).join(", ") || "(keine)"}
- MaxHr: ${ctx.profile?.maxHr ?? "(nicht gesetzt)"}
- Tagesziele: ${ctx.profile?.dailyCaloriesGoal ?? "—"} kcal · ${ctx.profile?.dailyStepsGoal ?? "—"} Schritte

## BEVORZUGTE TRAININGS-SLOTS
${ctx.profile?.weeklySlotPrefs ? slotPrefsBlock(ctx.profile.weeklySlotPrefs) : "(noch nicht gesetzt — Default: morgens 06:30-08:30 + mittags 13:30)"}

## AKTUELLES TRAININGS-SETUP (Referenz wie der User gerade trainiert)
${ctx.profile?.weeklyTemplateMarkdown ? ctx.profile.weeklyTemplateMarkdown : "(noch nicht gepflegt — frag bei Bedarf nach was der User gerade macht)"}

## KEY-LIFTS (Strength PR-Stand)
${keyLiftsBlock}

## ALGORITHMISCHE COACH-ANALYSE
Status: **${a.status}** | Wochenstrategie: **${a.weekStrategy.type}** — ${a.weekStrategy.headline}
Begruendung Strategie: ${a.weekStrategy.rationale.join(" | ")}
Volumen-Empfehlung diese Woche: ${a.weekStrategy.volumeAdjustmentPct > 0 ? "+" : ""}${a.weekStrategy.volumeAdjustmentPct}%
Deload empfohlen: ${a.deloadRecommended ? "JA" : "nein"}

Fatigue-Flags (${a.flags.length}): ${a.flags.length === 0 ? "(keine)" : a.flags.map((f) => `[sev${f.severity}] ${f.description}`).join(" | ")}

Kennzahlen-Stand JETZT:
- HRV 7d-Avg: ${numOrDash(s.hrv7d, "ms", 1)} (${s.hrvDeviationPct !== null ? (s.hrvDeviationPct > 0 ? "+" : "") + s.hrvDeviationPct.toFixed(1) + "%" : "—"} vs 28d-Baseline ${numOrDash(s.hrv28d, "ms", 1)})
- RHR 7d-Avg: ${intOrDash(s.rhr7d, " bpm")} (Delta ${numOrDash(s.rhrDeltaBpm, " bpm", 1)} vs 28d ${intOrDash(s.rhr28d, " bpm")})
- Schlaf 7d: ${fmtSleep(s.sleepMin7d)} (Trend ${s.sleepTrend}, 7d-Schlecht-Schlaf-Tage: ${s.badSleepDaysLast7})
- Body Battery 7d (Max ${intOrDash(s.bodyBatteryHigh7d)} / Min ${intOrDash(s.bodyBatteryLow7d)}), 14d-Slope: ${numOrDash(s.bodyBatteryHigh14dTrend, " pkt/d", 2)}
- Tage seit letzter VOLLER Erholung: ${s.daysSinceFullyRecovered ?? "—"}
- 7d Low-Energy-Tage: ${s.lowEnergyDaysLast7} | Soreness>=7: ${s.highSorenessDaysLast7} | Konsekutiv low energy: ${s.consecutiveLowEnergyDays}
- Wellness-Composite 7d: ${s.wellness7d ?? "—"} (vs 28d ${s.wellness28d ?? "—"}, Trend ${s.wellnessTrend})
- ACWR (7d/28d): ${numOrDash(s.acwr, "", 2)} | Monotony ${numOrDash(s.monotony, "", 2)} | Strain ${intOrDash(s.strain)}
- VO2max: ${s.vo2max ?? "—"} (14d Delta ${numOrDash(s.vo2maxDelta14d, "", 1)}, 30d Delta ${numOrDash(s.vo2maxDelta30d, "", 1)}, Trend ${s.vo2maxTrend})
- Z2 Aerobic-Decoupling: HR-Drift ${numOrDash(s.z2HrTrend14d, " bpm/d", 2)} (Trend ${s.z2EfficiencyTrend})
- Strength: 7d ${s.strengthSessions7d}/${s.weeklyCompliance.strength.planned} (${s.strengthMinutes7d}min) | 28d ${s.strengthSessions28d} Sessions
- Laeufe Woche: ${s.weeklyCompliance.runs.actual}/${s.weeklyCompliance.runs.planned} | Long Run ${s.weeklyCompliance.hasLongRun ? "✓" : "OFFEN"}

Algorithmische Observations:
${a.observations.map((o) => `- ${o}`).join("\n")}

## TAGES-STATUS HEUTE (${ctx.today})
${todayWorkoutsBlock}

Tages-Metriken heute (aktueller Stand):
- Schritte: ${ctx.todayMetrics.steps ?? "—"} / ${ctx.todayMetrics.stepsGoal ?? "—"} (Ziel)
- Kalorien-VERBRAUCH gesamt (BMR + Aktiv, von Garmin gemessen): ${ctx.todayMetrics.calories ?? "—"} / ${ctx.todayMetrics.caloriesGoal ?? "—"} (Ziel-Verbrauch)
- davon aktiv-verbraucht (durch Bewegung): ${ctx.todayMetrics.caloriesActive ?? "—"}
WICHTIG: Das Kalorien-Ziel ist VERBRAUCH (was der Koerper umsetzt), NICHT Kalorien-ZUFUHR (was der User isst). Empfehle keine Kalorien-Zufuhr basierend auf dieser Zahl — verwechsel das nicht.

Plan heute (noch offen laut Kalender):
${plannedTodayLabel}

## TRAININGS DER LETZTEN 10 TAGE
${recentBlock}

## JOURNAL LETZTE 7 TAGE
${journalBlock}

Aggregate 7d: Mood Ø${numOrDash(avgMood, "", 1)} · Energy Ø${numOrDash(avgEnergy, "", 1)} · Soreness Ø${numOrDash(avgSoreness, "", 1)} · SleepQ Ø${numOrDash(avgSleepQ, "", 1)}

## KALENDER-AUSBLICK NAECHSTE 3 TAGE
${plannedNextBlock}

## DEIN AKTUELLER WOCHENPLAN (was du selbst fuer diese Woche geplant hast)
${ctx.weekPlanFocus || ctx.weekPlanToday || ctx.weekPlanTomorrow
  ? [
      ctx.weekPlanFocus ? `**Wochen-Fokus**: ${ctx.weekPlanFocus}` : null,
      ctx.weekPlanToday ? `**HEUTE laut Plan** (${ctx.weekPlanToday.dow} ${ctx.weekPlanToday.date}) — ${ctx.weekPlanToday.dayFocus || "(kein Fokus)"}\n${weekPlanDayBlock(ctx.weekPlanToday)}` : null,
      ctx.weekPlanTomorrow ? `**MORGEN laut Plan** (${ctx.weekPlanTomorrow.dow} ${ctx.weekPlanTomorrow.date}) — ${ctx.weekPlanTomorrow.dayFocus || "(kein Fokus)"}\n${weekPlanDayBlock(ctx.weekPlanTomorrow)}` : null,
    ].filter(Boolean).join("\n\n")
  : "(kein Wochenplan generiert — der User kann unter /health/wochenplan einen erstellen)"}

## DEINE EIGENEN MEMOS (frueher festgehalten)
${memoryBlock}

---

Jetzt deine vollstaendige Analyse in den 4 vorgegebenen Sektionen. SEI TIEF, SEI KONKRET. Referenziere
spezifische Zahlen aus dem Snapshot. Erkenne Muster. Sag Klartext.`;
}

// ============ Antwort-Parsing ============

export interface ParsedRecommendation {
  statusFocus: string | null;
  actionsNow: string | null;
  eveningPrep: string | null;
  tomorrowSetup: string | null;
  // legacy fields fuer Backward-Compat in UI/API (mapping)
  morningText: string | null;
  trainingPlan: string | null;
  watchOuts: string | null;
  adjustedScore: number | null;
  adjustedLevel: string | null;
  adjustedReason: string | null;
  // Intensitaets-Indikator
  strengthIntensity: number | null;
  cardioIntensity: number | null;
  intensityReason: string | null;
}

export function parseAiResponse(text: string): ParsedRecommendation {
  const findSection = (...headings: string[]): string | null => {
    for (const heading of headings) {
      const re = new RegExp(`##\\s*${heading.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`, "i");
      const m = text.match(re);
      if (m) return m[1].trim();
    }
    return null;
  };

  const statusFocus = findSection("Status & Fokus", "Status und Fokus", "Status&Fokus");
  const actionsNow = findSection("Aktionen heute", "Aktionen jetzt");
  const eveningPrep = findSection("Heute Abend", "Abend");
  // Horizont ist die neue Block-3-Sektion (Phase 4), fallback auf alte Namen
  const tomorrowSetup = findSection("Horizont", "Setup morgen", "Setup morgen \\(.+", "Morgen", "Naechster Tag");

  const scoreAdjustBlock = findSection("Score-Adjust", "Score Adjust");
  let adjustedScore: number | null = null;
  let adjustedLevel: string | null = null;
  let adjustedReason: string | null = null;
  if (scoreAdjustBlock) {
    const scoreM = scoreAdjustBlock.match(/score:\s*(\d+)/i);
    const levelM = scoreAdjustBlock.match(/level:\s*(recover|easy|moderate|hard)/i);
    const reasonM = scoreAdjustBlock.match(/reason:\s*(.+)/i);
    if (scoreM) adjustedScore = Math.max(0, Math.min(100, parseInt(scoreM[1], 10)));
    if (levelM) adjustedLevel = levelM[1].toLowerCase();
    if (reasonM) adjustedReason = reasonM[1].trim();
  }

  // Intensitaets-Indikator
  const intensityBlock = findSection("Intensitaet heute", "Intensität heute", "Intensitaet", "Intensität");
  let strengthIntensity: number | null = null;
  let cardioIntensity: number | null = null;
  let intensityReason: string | null = null;
  if (intensityBlock) {
    const sM = intensityBlock.match(/strength:\s*(\d+(?:[.,]\d+)?)/i);
    const cM = intensityBlock.match(/cardio:\s*(\d+(?:[.,]\d+)?)/i);
    const rM = intensityBlock.match(/reason:\s*(.+)/i);
    if (sM) strengthIntensity = Math.max(0, Math.min(10, parseFloat(sM[1].replace(",", "."))));
    if (cM) cardioIntensity = Math.max(0, Math.min(10, parseFloat(cM[1].replace(",", "."))));
    if (rM) intensityReason = rM[1].trim();
  }

  const morningText = statusFocus;

  return {
    statusFocus,
    actionsNow,
    eveningPrep,
    tomorrowSetup,
    morningText,
    trainingPlan: actionsNow,
    watchOuts: eveningPrep,
    adjustedScore,
    adjustedLevel,
    adjustedReason,
    strengthIntensity,
    cardioIntensity,
    intensityReason,
  };
}
