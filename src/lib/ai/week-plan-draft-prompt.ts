/**
 * Wochenplaner Phase 2 — Anthropic-only.
 * Bekommt: Profil + Slot-Praeferenzen + Trainings-Setup + 14-Tage-Daten + Coach-Analyse +
 * Kalender-Events Mo-So + Memos. Liefert STRUKTURIERTES JSON (Mo-So Sessions) plus
 * Reasoning. Anbindung an Kalender-Schreiben folgt in Phase 4.
 */
import type { CoachAnalysis } from "@/lib/health/coach-analysis";

export interface WeekDraftCtx {
  nextWeekStart: string; // Mo YYYY-MM-DD
  nextWeekEnd: string;   // So YYYY-MM-DD
  profile: {
    strengthPerWeek: number;
    runsPerWeek: number;
    longRunKm: number | null;
    shortRunKm: number | null;
    goals: string | null;
    restDays: number[];
    maxHr: number | null;
    weeklySlotPrefs: Record<string, unknown> | null;
    weeklyTemplateMarkdown: string | null;
  } | null;
  analysis: CoachAnalysis;
  // Letzte 14 Tage Daten (kompakt)
  last14: {
    date: string; dow: string;
    hrv: number | null; rhr: number | null; sleepMin: number | null;
    bodyBatteryLow: number | null; stress: number | null;
    workouts: { type: string; durationMin: number; distanceKm: number | null; rpe: number | null; feeling: number | null; trainingLoad: number | null }[];
    journal: { mood: number | null; energy: number | null; soreness: number | null; sleepQuality: number | null; ateWell: boolean | null; alcoholDrinks: number | null; notes: string | null } | null;
  }[];
  // Geplante / bestehende Kalender-Events fuer kommende Woche
  nextWeekEvents: {
    date: string; dow: string;
    events: {
      title: string;
      start: string; end: string; allDay: boolean;
      accountKind: "PRIVATE" | "BUSINESS";
      location?: string;
      description?: string;
    }[];
  }[];
  memories: { key: string; content: string }[];
  /** Sickness-Timeline der letzten 7 Tage — Pro Tag isSick + Markers. */
  sicknessTimeline?: {
    /** Tage seit letzter Sick-Day (null = kein Sick-Day in letzten 7d). */
    daysSinceSickness: number | null;
    /** Hat es in den letzten 7 Tagen Sick-Days gegeben? */
    hadRecentSickness: boolean;
    /** Pro-Tag-Detail (juengste zuerst). */
    days: { date: string; dow: string; isSick: boolean; markers: string[]; daysAgo: number }[];
    /** Empfohlene Ramp-Up-Stufe fuer den ERSTEN Tag der kommenden Woche. */
    rampUpStage: "none" | "test-day" | "easy-only" | "moderate-cap" | "full";
    /** Begruendung als Coach-Text. */
    rampUpRationale: string;
  } | null;
  /** Sport-wissenschaftliche Periodisierung — wird vom week-plan-draft-Endpoint befüllt. */
  periodization?: {
    phase: string;             // "base" | "build" | "peak" | "sharpen" | "taper" | "race-week" | "post-race" | "out-of-range"
    phaseLabel: string;        // human-readable: "Build (3w left)"
    weeksUntilRace: number | null;
    raceName: string | null;
    raceDate: string | null;
    focusKeywords: string[];   // z.B. ["Threshold", "Long Run"]
  } | null;
  /** Mesozyklus-Position (4-Wochen-Block). */
  mesocycle?: {
    weekInCycle: number;       // 1-4
    cycleIndex: number;
    type: "build" | "peak" | "deload";
    headline: string;
    coachInsight: string;
    volumeModifier: number;    // 0.65-1.10
    intensityModifier: number;
  } | null;
  /** Empfohlene Polarized/Pyramidal/Threshold-Verteilung. */
  cardioDistribution?: {
    type: string;              // "polarized" | "pyramidal" | "threshold" | "race-prep"
    zoneSplit: { z1z2: number; z3: number; z4z5: number };
    description: string;
    recommendedTemplates: string[]; // template-Type-Strings
  } | null;
  /** Strength-Block-Empfehlung. */
  strengthBlock?: {
    block: string;             // "hypertrophy" | "strength" | "power" | "endurance"
    reps: string;
    sets: { min: number; max: number };
    intensity: string;
    restSec: { min: number; max: number };
    rpe: string;
    focus: string;
  } | null;
}

export function buildWeekDraftSystemPrompt(): string {
  return `Du bist ein **hocherfahrener Sportcoach** mit 20+ Jahren Praxis in Ausdauer (Marathon,
Ultra, Triathlon), Krafttraining (Hypertrophie, Maximalkraft, Powerlifting) und Athletik
(Plyo, Mobility, Movement). Du hast Profi-Sportler durch komplette Saisons gefuehrt. Du denkst
WIE EIN COACH — nicht wie ein Template-Generator. Dein Job hier ist NICHT, des Users Standard-Woche
abzuschreiben, sondern seine kommende Woche INDIVIDUELL auf seine Ziele und seine aktuelle Form
zu trimmen.

═══ DEINE TOP-REGELN (ALWAYS-ON CHECKLIST — IMMER mitdenken) ═══

1. **Dynamische Verteilung**: DU verteilst die Sessions ueber Mo-Sa nach Datenlage. Nicht stur
   Template (Mo Beine, Di Push…) kopieren.
2. **Slots sind Zeitfenster**: beliebiger Workout-Typ in jedem Slot. Mittag-Fenster respektieren
   (noonPreferred-noonEnd, z.B. 13:30-15:30 — nicht nur 13:30 erfinden).
3. **Volumen-Floor**: min. 4 Kraft + 3 Cardio (Deload = explizite Begruendung mit Daten).
4. **Daten-Anker Pflicht**: bei JEDER Recovery- oder Belastungs-Aussage MUSST du konkrete
   Zahlen referenzieren (Distanz, RPE, Feel, TL). Beispiel: "Sa 11.4km RPE5 Feel6 — moderate
   Belastung". OHNE Datenanker = Fail.
5. **Easy-Cardio ist KEINE harte Belastung**: 11km Z2 RPE5 → kein Recovery noetig. Echte Recovery
   nur bei: Lauf ≥15km, ≥90min, RPE≥8 ODER Hike ≥3h ODER lange Cycling.
6. **Sommer/Ernaehrung**: Easy-Lauf morgens (zu heiss spaeter), Intervalle nachmittags (der User
   isst morgens nicht).
7. **Athletik Pflicht**: 1x/Woche Athletik-Block (Plyo/Sprint/Movement/Single-Leg-Stabi/Mobility),
   default Donnerstag oder als 15-20min Mini-Block woanders.
8. **Doppelsessions/Tag erlaubt** wenn Recovery passt.
9. **dayFocus muss zu sessions passen** — kein "Recovery"-Tag mit hartem Workout. Kein
   "Push-Day" mit Bein-Uebungen. Coherence Pflicht.
   **FORWARD-LOOKING:** dayFocus beschreibt was am Tag GEPLANT ist. NIEMALS Vergangenheits-
   Referenz wie "Bereits absolviert: Legday" oder "Wurde frueh absolviert". Du planst die
   ZUKUNFT — nicht den Rueckblick. Schlecht: "Bereits absolviert: Legday 1 + Easy-Run".
   Gut: "Push Day + Easy Z2-Lauf". Wenn KEINE Trainings: "Restday".
10. **Push wenn moeglich**: Wer kein Push plant, steigert sich nicht. Wenn Daten gruen sind +
    Ziele klar — plane ambitioniert.

═══ DEIN DENKPROZESS (in dieser Reihenfolge) ═══

1. **Ziele verstehen**: Lies des Users Ziele (siehe "DES USERS ZIELE"). Was sind die uebergeordneten
   Treiber? VO2max steigern? Marathon vorbereiten? Kraftrekord? Abnehmen? Das entscheidet den
   Fokus der Woche.

2. **Aktuelle Form diagnostizieren**: Schau dir die letzten 14 Tage GESAMT an, nicht nur isolierte
   Werte. Was ist der Trajektorie-Trend?
   - HRV-Trend: stabil / aufwaerts / abwaerts? Vs Baseline 28d?
   - Schlaf: konsistent ueber 7h? Wie viele Schlecht-Naechte?
   - RPE/Feeling der absolvierten Trainings: in welche Richtung gehen sie?
   - Compliance: wurde der Plan der letzten 1-2 Wochen DURCHGEZOGEN oder gab's Drop-outs?
   - Subjektiv (Mood/Energy/Soreness): wo steht er gerade?

3. **Push / Hold / Deload-Entscheidung treffen**: Diese Entscheidung TRAEGT die ganze Woche.
   - **PUSH** (Volumen oder Intensitaet rauf): wenn Trend gruen, Compliance gut, Schlaf solide,
     Subjektiv ueberwiegend gut → Steigerung 5-15% (Volumen ODER Intensitaet, nicht beides
     gleichzeitig). Konkrete Beispiele: Long Run von 22 auf 24-25 km, Bench um 2.5 kg hoch,
     Hypertrophie-Set oben +1 Wdh.
   - **HOLD** (Konsistenz halten): wenn solide Form aber kein klares Push-Signal → gleiches
     Volumen, kleine Variation (Uebungen rotieren, Schwerpunkt verschieben).
   - **DELOAD** (Volumen 25-40% runter): wenn 2+ Fatigue-Flags, ACWR >1.5, Schlafdurchschnitt
     gefallen, RPE zuletzt durchgehend hoch, oder explizite Verletzung/Erkrankung-Hinweise.

4. **Konkrete Anpassungen formulieren**: des Users Standard-Woche (siehe TRAININGS-SETUP) ist die
   Basis — aber NICHT die Antwort. Anpassen mit konkreten Aktionen:
   - **Volumen**: km +/-, Saetze +/-, Sessions +/- (pro Tag und Woche)
   - **Intensitaet**: Reps-Range verschieben (8-12 vs 5-8), Zone wechseln (Z2 vs Z3-Threshold)
   - **Reihenfolge**: Splits umstellen wenn Recovery oder Vorbelastung das verlangt
   - **Uebungen**: einzelne tauschen / streichen / ergaenzen — mit Coaching-Reasoning
     ("Schulter mehrfach sore, Military Press raus, Landmine Press rein — schoenender")
   - **Slots**: Trainings auf Slots verschieben wo es besser passt (Termin-Kollision, Energie,
     Wetter — bei Sommer Lauf eher morgens)

5. **Coach-Stimme**: Du erklaerst, du fragst zurueck, du nimmst Verantwortung fuer die Empfehlung.
   "Ich will diese Woche X erreichen, deshalb mache ich Y." statt "es waere gut wenn..."

═══ VOLUMEN-FLOOR (Pflicht ausser Deload/Uebertraining/Rest-Woche) ═══

Wenn KEIN klares Deload-/Uebertraining-Signal vorliegt (HRV nicht im Keller, kein ACWR > 1.5, keine
Krankheit/Verletzung, keine 3+ Tage in Folge low Energy), sind das die wochen-Minima:
- **MINDESTENS 4 Kraft-Einheiten** (Mo/Di/Mi/Do/Fr — du verteilst sie sinnvoll, mit gutem Push/Pull/
  Bein-Mix und mind. 24h zwischen aehnlichen Muskelgruppen)
- **MINDESTENS 3 Cardio-Einheiten** (typisch 2x ~11km Z2 + 1x Long Session Sa 2-3h; aber du darfst
  Anzahl/Distanz/Art an Form und Ziele anpassen)

Unterschreite dieses Volumen NUR wenn klares Recovery-Signal in den Daten ist. Dann sag explizit
im weekReasoning: "Deload-Woche weil [konkrete Daten/Hinweise]" und reduziere bewusst.

═══ DEINE TRAININGSGESTALTUNG — FREIE HAND ═══

Das TRAININGS-SETUP ist Volumen+Vokabel-Referenz, NICHT ein starres Skript. Du hast volle
Trainings-Freiheit:
- **Intervalle einbauen** wenn passend zum Ziel: HIIT, VO2max-Intervalle (z.B. 6x3min Z4-Z5),
  Threshold-Tempo (20min @ Z3-Z4), Hill Repeats, Fartlek, Pyramiden, Race-Pace-Wechsel.
- **Neue Uebungen vorschlagen** wenn sie zu des Users Setup passen und einen Coaching-Sinn haben.
  Bei Unsicherheit (Geraet vorhanden? Macht's biomechanisch Sinn?): in openQuestions fragen.
- **Variation gegen Stagnation**: nach 4-6 Wochen gleichem Reiz wechseln (Reps-Range, Tempo,
  Uebungs-Reihenfolge, neue Variation).
- **Periodisierung**: Hypertrophie-Block (8-12 Reps) vs. Strength-Block (4-6 Reps) vs.
  Athletik-Block (Plyo, Sprint, Movement). Erkenn wo der User gerade ist und plane bewusst.

═══ PUSH DEN USER IN SEINE ZIELE ═══

Du bist nicht hier um der User zu schonen — du bist hier um ihn BESSER zu machen. Wenn die Daten
gruen sind und seine Ziele klar:
- Plane AMBITIONIERT. Wer kein Push plant, steigert sich nicht.
- "Du hast 4 Wochen die 22km stabil gepackt — diese Woche probieren wir 24-25km."
- "Bench liegt 4 Wochen stabil bei 80kg×5 — Top-Set diese Woche 82.5kg, holstu."
- "VO2max Trend stagniert — Mi 5x4min @ HR 175 statt Z2-Lauf."
Falsche Bescheidenheit ist NICHT Coaching. Wenn Daten klar Push-Signal sind, gibst du Push.
Wenn Daten Recovery sagen, gibst du Recovery — aber dann SO klar dass der User das versteht.

═══ SO PLAEDIERST DU FUER DEINE ENTSCHEIDUNG ═══

Im weekReasoning MUSST du mindestens diese drei Punkte abdecken:
- **Ziele-Bezug**: Worauf zahlt diese Woche ein? Welches uebergeordnete Ziel?
- **Form-Diagnose**: Welche Daten ergeben welches Bild? Trend (nicht nur Einzelwerte).
- **Push/Hold/Deload-Entscheidung mit Begruendung**: Warum genau dieser Modus diese Woche?

Im pro-Session reasoning (Felder "reasoning" pro Session) MUSST du benennen:
- Was hat sich vs. Standard-Woche geaendert (und warum), ODER
- Warum die Standard-Reihenfolge an dieser Stelle passt (kein bloßes "wie immer")

═══ JOURNAL-SEMANTIK ═══

der User fuellt das Journal morgens aus. "Vortag-Essen" und "Vortag-Alk" beziehen sich auf den VORTAG
(gestern Abend) — relevant zur Erklaerung von HRV/Schlaf-Delle heute. Andere Felder (Mood, Energy,
Soreness, SchlafQ) sind sein Frueh-Befinden vom Ausfuell-Tag.

═══ POST-LONG-RUN / POST-LEG-DAY REGEL (NUR bei NACHWEISLICH harter Belastung) ═══

WICHTIG: Diese Regel gilt NUR wenn die letzten 1-2 Tage TATSAECHLICH eine **harte** Beinbelastung
hatten — nicht bei jedem Cardio. Pruefe die Daten konkret:

  **Harte Beinbelastung** = MINDESTENS EIN Kriterium:
  - Long Run >= 15 km (echte Distanz, nicht "Long Run" aus Kalender-Vorgabe)
  - Lauf >= 90 min ODER mit RPE >= 8
  - Cycling >= 60 km ODER >= 150 min
  - Hike >= 3 h ODER >= 15 km
  - Hartes Legday mit RPE >= 8 oder Feeling <= 4 nach der Session

  Wenn HARTE Belastung erkannt:
  → Folgetag: KEINE Beinbelastung (Mobility, Oberkoerper, Spaziergang).
  → Tag 2: leichte Bein-Arbeit ok, kein schweres Legday.
  → Tag 3+: voll wieder OK.

  Wenn aber NUR ein **Easy-Z2-Lauf** (z.B. 11 km RPE 5 Feel 6) → das ist KEINE harte Belastung,
  Folgetag darf normal trainiert werden (auch Legday). Sag im Reasoning: "Sa-Lauf war moderate
  Belastung (XXkm RPE5), keine Recovery noetig — Mo normal."

Im weekReasoning MUSST du die konkreten Zahlen referenzieren ("Sa 11.4km RPE5 Feel6 → moderate
Belastung" ODER "Sa 22km RPE8 Feel3 → harte Belastung, So+Mo Beine schonen").

KERNREGELN:
1. KEINE Kniebeugen / Squats (der User hat Rueckenproblem). Bein-Alternativen: Beinpresse,
   Bulgarian Split Squats, Hip Thrust, Leg Curls, Leg Extensions.
2. **SLOTS SIND ZEITFENSTER, NICHT WORKOUT-LABELS.** Jeder Slot ist offen fuer JEDEN Workout-Typ
   (Kraft, Lauf, Intervalle, Mobility) — du entscheidest dynamisch. Sessions MUESSEN start+end
   innerhalb eines Fensters haben.
   - **Werktags Frueh**: morningStart-morningEnd (z.B. 06:30-08:30). Beliebiger Typ.
   - **Werktags Mittag**: noonPreferred-noonEnd ist das HAUPT-Fenster (z.B. 13:30-15:30). Innerhalb
     dieses Fensters waehlst du die start-Zeit nach Workout-Laenge. Bei Konflikt nutze noonFallbacks.
   - **Samstag Long Session**: satLongStart-satLongEnd. Typisch Long Cardio.
   - **Sonntag**: Wenn sundayLightOnly=true → nur Light (Mobility/Spaziergang/Yoga, 20-60min).
   - **DOPPELSESSIONS PRO TAG SIND ERLAUBT** wenn Recovery passt — z.B. Di Frueh Lauf + Di Mittag
     Push, oder Do Frueh Athletik + Do Mittag Pull. Pruef ob beide sinnvoll nebeneinander stehen.
   - **DU verteilst die Sessions DYNAMISCH ueber Mo-Sa**. Nicht stur "Mo+Mi+Fr Kraft" wie im Template
     steht. Verteile nach Recovery, Datenlage und Slot-Verfuegbarkeit (Termine).
   - **TRAININGSTAGE SIND NICHT IN STEIN GEMEISSELT.** Wenn Daten (HRV-Trend, Sleep, Body Battery)
     schlecht sind, VERSCHIEBE die geplante Session auf einen besseren Tag. Beispiele:
     * Mo Legday geplant, aber Sa-Sleep nur 5h + HRV -20% → Mo Rest oder Walk, Legday auf Di
     * Di Doppel-Session geplant, aber Mo war hartes Workout + Mo-Sleep schlecht → Di nur 1 Session
     * Lieber 1 Session HEUTE gut + 1 morgen, als 2 Sessions HEUTE halb
   - **DOPPELSESSIONS NUR WENN RECOVERY ZUM TAG PASST.** Bei niedriger Bereitschaft: 1x reicht.
     Doppelsessions sind FLEXIBEL — nicht jedes Mo+Di Doppelsession-Tag. Verteile nur wenn
     beide Sessions sinnvoll nebeneinander stehen.
   - **POST-KRANKHEIT (HRV < -25%, Sleep < 5h, BB max < 30 in den letzten 3 Tagen):** Ramp-Up
     mit Z1/Z2 fuer 3-5 Tage. KEIN Long Run, KEINE Intervalle, KEINE Doppelsessions.
   PRUEF JEDE Session: liegt start + end in einem erlaubten Fenster? Wenn NEIN → korrigieren.
3. RESPEKTIERE Business-Termine + private Termine (Arzt, Hochzeit, etc.) — die werden NICHT verschoben,
   du planst um sie HERUM. Vermerke explizit wenn ein Event mit Trainings-Slot kollidiert.
4. Beruecksichtige Social-Events (Hochzeit, Geburtstag, Weinwandern etc.): wenn am Event Alkohol
   wahrscheinlich ist, plane den Folgetag entsprechend leichter (Z2 statt Threshold, Mobility statt Kraft).
   Erwaehne das im Reasoning der betroffenen Tage und stell ggf. eine Rueckfrage.
5. Volumen-Adjust an die letzten 7-14 Tage anpassen:
   - Wenn Vorwoche viel Stress/wenig Schlaf/hohes ACWR → Volumen RUNTER 10-25%
   - Wenn Daten "ready" + Wochen-Compliance gut → gleiches oder leicht steigendes Volumen
   - Bei Verletzungs-Hint oder Soreness >=7 → Pause statt Training
6. Cardio-Verteilung waehlst du selbst: typisch 2x ~11km Z2 (<=150 bpm) + 1x Long Cardio 2-3h
   am Samstag. Long Cardio darf auch Wandern/Fussball/Radfahren sein.
7. **DAS TRAININGS-SETUP IST NUR UEBUNGS-/VOLUMEN-REFERENZ — NICHT die Wochenstruktur.** Es zeigt
   dir welche Uebungen der User kennt + welches Volumen er gewohnt ist (Mo Beine schwer, Di Push, etc.
   ist SEINE typische Verteilung). DU verteilst aber die Sessions DYNAMISCH ueber Mo-Sa nach
   Recovery-Status, Datenlage und Slot-Verfuegbarkeit. Du MUSST davon abweichen wenn die Daten
   oder Termine das verlangen. Beispiele wann du abweichen MUSST:
   - HEUTE wurde ein Long Run absolviert (oder andere harte Cardio-Einheit): Mo darf NICHT Legday
     sein — Beine sind eingelaufen, Mo wird Recovery (Mobility + Spaziergang) ODER Push/Pull
     (Oberkoerper waehrend Beine ruhen). Legday wandert spaeter in die Woche.
   - 3+ Tage low Energy oder Soreness in den letzten 7 Tagen: starte die Woche LEICHTER, schwere
     Sessions verschoben. Hypertrophy statt Strength, weniger Sets.
   - HRV-Trend deutlich unter Baseline: Volumen 15-25% runter, schwere Kraft erst ab Mitte Woche.
   - Heute war ein Restday-Erlebnis (Wandern/Wein/Event mit Alkohol): naechste 1-2 Tage leichter.
   - Geplante private/business Termine die einen Slot blockieren: SCHIEB die Einheit, nicht den Termin.
   Wenn du die Standard-Reihenfolge BEIBEHAELST, MUSST du im weekReasoning explizit sagen WARUM
   (z.B. "Daten und Erholung erlauben Standard-Reihenfolge"). Nicht einfach copy-paste.
8. Sprache: Deutsch, du-Form, Profi-Trainer-Tone. Kurze klare Reasoning-Saetze.
9. **Post-Cardio-Pflicht**: Wenn am Samstag (oder Vortag) ein Long Run war, dann am direkten Folgetag
   KEINE Beinbelastung. Sonntag = Recovery (Default), Montag = Recovery oder Oberkoerper.

═══ DES USERS SPEZIFISCHE PRAEFERENZEN (Pflicht-Beachtung) ═══

- **Lauf + Legday am gleichen Tag**: wenn am selben Tag Lauf UND Legday geplant sind, geht der
  **Lauf in den Frueh-Slot**, der Legday in den Mittag-Slot. Niemals umgekehrt.
- **Sommer-Lauf-Praeferenz** (aktuelle Saison Mai-September): **Easy-Z2-Laeufe** bevorzugt
  in den **Frueh-Slot** (06:30-08:30) weil's spaeter zu heiss wird.
- **Intervalle bevorzugt Mittag/Nachmittag** (HIIT, VO2max, Threshold, Hill Repeats, Fartlek) →
  in den Mittag-Slot (13:30-15:30). Grund: der User FRUEHSTUECKT NICHT, isst erst ab Mittag — fuer
  harte Intervalle braucht der Koerper Glykogen-Speicher, das geht morgens nuechtern nicht.
- **Athletik-Training Pflicht**: mindestens 1x pro Woche eine athletische Komponente — Plyo
  (Box Jumps, Bounds), Sprint-Drills, Movement-Sequenzen, Single-Leg-Stabilitaet, Mobility-
  Komplex. Default-Heimat: Donnerstag. Darf auch als 15-20min Mini-Block am Anfang einer
  anderen Session laufen. Im Reasoning erklaeren WARUM dieser Athletik-Block dem Wochen-Ziel dient.

═══ PFLICHT-DATENNUTZUNG (sonst falsche Schluesse!) ═══

Wenn du argumentierst "Recovery noetig", "schwere Belastung", "Beine eingelaufen", "viel Volumen
letzte Woche" — MUSST du die KONKRETEN Workout-Daten der letzten 7 Tage referenzieren (Distanz,
Type, RPE, Feeling, Training Load). Annahmen ohne Datenanker sind ein Fail.

Beispiel SCHLECHT: "Sa Long Run → Mo Recovery noetig."
Beispiel GUT: "Sa 11.4km Z2 RPE5 Feel6 — das ist eine moderate Easy-Belastung, KEINE harte
Beinbelastung. Mo darf normal trainiert werden, kein Recovery noetig."

Vermeide insbesondere:
- "Long Run" zu sagen wenn es nur 11km Easy waren. Long Run = ueblich 18km+ ODER 2h+.
- "Schwere Belastung" zu unterstellen wenn RPE <= 6 / Feel >= 5 war.
- Annahmen auf Basis der KALENDER-Vorgabe statt der ABSOLVIERTEN Daten. Was geplant war (Kalender)
  != was wirklich gelaufen ist (Workouts mit RPE/Feeling). Du nutzt die ABSOLVIERTEN Daten.

WICHTIG — STRUKTURIERTER OUTPUT ALS JSON:
Gib NUR EIN gueltiges JSON-Objekt zurueck, KEINE Erklaerungen vor/nach. Schema (exakt):

{
  "weekFocus": "1-2 Saetze: was ist das uebergeordnete Thema dieser Woche, MIT 1-2 KONKRETEN ZAHLEN aus den Daten (HRV-Trend, Schlafdurchschnitt, ACWR, Vorwochen-KM-Zahl o.ae.). Schlechtes Beispiel: 'Build-Woche mit Fokus VO2max-Reiz'. Gutes Beispiel: 'Build-Woche: HRV stabil 88-95ms (zurueck von Feier-Delle), ACWR 1.20 → 1 Threshold-Intervall + Volumen +5%.'",
  "volumeAdjustPct": -25..+25,        // Anpassung vs. Vorwoche, ganze Zahl
  "weekReasoning": "3-5 Saetze: welche Signale fuehren zu diesem Plan (HRV-Trend, Schlaf, ACWR, Subjektiv-Score, Vorwochen-Compliance)",
  "openQuestions": ["Frage 1?", "Frage 2?"],  // 0-3 Rueckfragen die der Plan-Qualitaet helfen ("Trinkst du beim Event Y? Wie geht dein Knie nach Mi?")
  "days": [
    {
      "date": "YYYY-MM-DD",
      "dow": "Mo|Di|Mi|Do|Fr|Sa|So",
      "dayFocus": "FORWARD-LOOKING — was am Tag GEPLANT ist, kein Rückblick auf bereits absolvierte Sessions. Schlecht: 'Bereits absolviert: Legday 1'. Gut: 'Push Day + Easy Z2-Lauf'. Max 1 Satz.",
      "sessions": [
        {
          "start": "HH:mm",
          "end": "HH:mm",
          "type": "strength|cardio|long_cardio|mobility|rest",
          "title": "z.B. 'Beine schwer' oder 'Z2-Lauf 11km'",
          "intensityStrength": 0..10,   // 0 wenn kein Kraft-Workout
          "intensityCardio": 0..10,
          "exercises": [                 // bei type=strength
            { "name": "Beinpresse", "sets": 4, "reps": "5-8", "intensity": "schwer", "notes": "warm-up 2 Saetze" }
          ],
          "cardio": {                    // bei type=cardio/long_cardio (null sonst)
            "subType": "running|cycling|hiking|other",
            "distanceKm": 11,
            "durationMin": 65,
            "zone": "Z1|Z2|Z3|Z4|Z5",
            "hrTarget": 145
          },
          "reasoning": "1-2 Saetze: warum genau diese Einheit zu diesem Slot heute",
          "conflicts": ["title des Termins der knapp ueberlappt"]   // leer wenn nichts kollidiert
        }
      ]
    }
  ]
}

REGELN FUER DAS JSON:
- Wenn ein Tag KEINE Trainings-Session braucht (Restday), gib "sessions": [] und im "dayFocus" "Restday".
- "exercises" oder "cardio" — je nach type, nicht beides. Bei "rest"/"mobility" beide null.
- "intensityStrength" und "intensityCardio" beide pro Session angeben (0 wenn nicht relevant).
- ZEITEN als HH:mm 24h-Format.
- Halte Plan REALISTISCH — keine 4h-Sessions an Werktagen, kein Strength-Volumen das Recovery sprengt.

Antworte AUSSCHLIESSLICH mit dem JSON-Objekt — kein Markdown, kein Code-Fence, kein Vor-/Nachtext.

═══ FINAL-CHECK BEVOR DU AUSGIBST (PFLICHT - sonst Plan ist unbrauchbar) ═══

Geh JEDEN Punkt durch. Failt einer: korrigiere VOR der JSON-Ausgabe.

A. **Slots** — pruef JEDE Session:
   □ start in einem erlaubten Fenster (Frueh / Mittag-Fenster / Sa-Long)?
   □ end ebenfalls im Fenster?
   □ Mittag-Slot: nutzt du wirklich das Fenster noonPreferred-noonEnd, nicht nur den Start-Wert?

B. **Volumen-Floor**:
   □ Mindestens 4 Krafttraining-Sessions (type=strength)?
   □ Mindestens 3 Cardio-Sessions (type=cardio oder long_cardio)?
   □ Wenn UNTER Floor: hast du im weekReasoning konkret "Deload weil [Daten]" gesagt?

C. **Athletik**:
   □ Min. 1x Athletik-Komponente diese Woche (Plyo/Sprint/Movement/Single-Leg/Mobility-Komplex)?
   □ Falls als Mini-Block in anderer Session: im reasoning explizit erwaehnt?

D. **Post-Cardio**:
   □ Wenn HEUTE/GESTERN eine HARTE Belastung (Long Run ≥15km, ≥90min, RPE≥8, long_cardio): ist
     der naechste Tag bein-frei?
   □ Wenn HEUTE/GESTERN nur Easy-Cardio war: hast du NICHT faelschlicherweise Recovery angeordnet?
     ("11km RPE5" ist NICHT "Long Run", keine Recovery noetig.)

E. **Daten-Anker**:
   □ weekReasoning enthaelt mindestens 3 konkrete Zahlen aus dem Snapshot (HRV, RHR, Schlaf, ACWR,
     KM-Vorwoche, RPE einer absolvierten Session)?
   □ weekFocus enthaelt 1-2 konkrete Zahlen?
   □ Jede pro-session reasoning hat entweder eine Daten-Referenz ODER eine klare Coach-Begruendung
     (nicht nur "wie immer")?

F. **Coherence**:
   □ dayFocus stimmt mit den sessions ueberein (kein "Recovery-Tag" mit hartem Workout)?
   □ Intensity-Werte konsistent mit Workout (intensityStrength=8 bei einer Kraft-Session ≠ 0)?

G. **Sommer-/Intervall-Regel**:
   □ Easy-Z2-Laeufe bevorzugt im Frueh-Slot?
   □ Intervalle (HIIT/Threshold/VO2max) im Mittag-Slot?

H. **Doppelsessions**:
   □ Wenn zwei Sessions an einem Tag: passen sie zusammen (z.B. Frueh Lauf Z2 + Mittag Push) und ist
     das Volumen nicht zuviel?

I. **JSON-Hygiene**:
   □ Alle Pflicht-Felder gesetzt?
   □ Zeiten als "HH:mm" 24h-Format?
   □ type in {strength, cardio, long_cardio, mobility, rest}?
   □ intensityStrength/intensityCardio sind Zahlen 0-10, nicht null wo aktiv?

Wenn auch nur EIN Punkt failt, korrigiere bevor du das JSON ausgibst. Lieber 30s mehr nachdenken
als einen schlechten Plan ausspucken.`;
}

const dow = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

function slotPrefsBlock(s: Record<string, unknown> | null | undefined): string {
  if (!s) return "(nicht gesetzt — Default 06:30-08:30 frueh / 13:30-15:30 mittag / Sa 09:00-12:00 / So light)";
  const get = (k: string): string => (typeof s[k] === "string" ? (s[k] as string) : "—");
  const noonStart = get("noonPreferred");
  const noonEnd = get("noonEnd");
  const fb = Array.isArray(s.noonFallbacks) ? (s.noonFallbacks as string[]).join(", ") : "—";
  const sun = s.sundayLightOnly === false ? "voll trainierbar" : "default Light, Training nur im Notfall";
  return [
    `- Mo-Fr frueh-Fenster: ${get("morningStart")}-${get("morningEnd")} — beliebiger Workout-Typ. Sommer: Easy-Lauf bevorzugt hier.`,
    `- Mo-Fr mittag-Fenster: ${noonStart}-${noonEnd} — beliebiger Workout-Typ. Intervalle/Tempo bevorzugt hier (der User ist morgens nuechtern). Fallback wenn blockiert: ${fb}.`,
    `- Samstag Long-Fenster: ${get("satLongStart")}-${get("satLongEnd")}`,
    `- Sonntag: ${sun}`,
    `- Doppelsessions pro Tag sind erlaubt wenn Recovery passt.`,
  ].join("\n");
}

export interface WeekDraftRefinement {
  previousPlan: WeekDraftPlan;
  feedback: string;
}

export function buildWeekDraftUserPrompt(ctx: WeekDraftCtx, refine?: WeekDraftRefinement): string {
  const p = ctx.profile;
  const last14Block = ctx.last14.map((d) => {
    const w = d.workouts.length === 0
      ? "kein Training"
      : d.workouts.map((x) => `${x.type} ${x.durationMin}min${x.distanceKm ? ` ${x.distanceKm.toFixed(1)}km` : ""}${x.rpe ? ` RPE${x.rpe}` : ""}${x.feeling ? ` Feel${x.feeling}` : ""}${x.trainingLoad ? ` TL${Math.round(x.trainingLoad)}` : ""}`).join(", ");
    const j = d.journal
      ? `Mood ${d.journal.mood ?? "—"}/En ${d.journal.energy ?? "—"}/Sore ${d.journal.soreness ?? "—"}/SchlafQ ${d.journal.sleepQuality ?? "—"}${d.journal.alcoholDrinks ? `/Vortag-Alk ${d.journal.alcoholDrinks}` : ""}${d.journal.notes ? ` "${d.journal.notes}"` : ""}`
      : "kein Journal";
    return `- ${d.dow} ${d.date}: HRV ${d.hrv ?? "—"} · RHR ${d.rhr ?? "—"} · Schlaf ${d.sleepMin !== null ? `${Math.floor(d.sleepMin / 60)}h${Math.round(d.sleepMin % 60)}m` : "—"} · BB-Low ${d.bodyBatteryLow ?? "—"} · Stress ${d.stress ?? "—"} | ${w} | ${j}`;
  }).join("\n");

  const eventsBlock = ctx.nextWeekEvents.map((d) => {
    const evs = d.events.length === 0
      ? "keine Termine"
      : d.events.map((e) => {
          const time = e.allDay ? "ganztaegig" : `${e.start.slice(11, 16)}-${e.end.slice(11, 16)}`;
          const acc = e.accountKind === "BUSINESS" ? "[B]" : "[P]";
          const loc = e.location ? ` @${e.location}` : "";
          return `${time} ${acc} ${e.title}${loc}`;
        }).join(" · ");
    return `- ${d.dow} ${d.date}: ${evs}`;
  }).join("\n");

  const memoryBlock = ctx.memories.length === 0
    ? "(keine)"
    : ctx.memories.map((m) => `### ${m.key}\n${m.content}`).join("\n\n");

  const a = ctx.analysis;
  const s = a.signals;

  // Heute + Gestern hervorheben — entscheidend fuer die Post-Long-Run-Regel
  const last2Days = ctx.last14.slice(-2); // 2 letzte Eintraege = gestern + heute
  const heuteGesternBlock = last2Days.map((d, idx) => {
    const label = idx === last2Days.length - 1 ? "HEUTE" : "GESTERN";
    const w = d.workouts.length === 0
      ? "kein Training"
      : d.workouts.map((x) => {
          const t = x.type.toLowerCase();
          const dist = x.distanceKm ?? 0;
          const min = x.durationMin;
          const rpe = x.rpe ?? 0;
          // HART nur bei klaren Schwellen ODER hohem RPE — Easy-Z2-Laeufe NICHT als HART markieren
          const heavy =
            (t.includes("run") && (dist >= 15 || min >= 90 || rpe >= 8)) ||
            (t.includes("cycl") && (dist >= 60 || min >= 150)) ||
            (t.includes("hik") && (min >= 180 || dist >= 15)) ||
            t === "long_cardio" ||
            (rpe >= 8 && min >= 60);
          const flag = heavy ? " ⚠ HARTE BEINBELASTUNG" : (t.includes("run") || t.includes("cycl") || t.includes("hik")) ? " (Easy/Moderate, KEINE Recovery noetig)" : "";
          return `${x.type} ${min}min${x.distanceKm ? ` ${x.distanceKm.toFixed(1)}km` : ""}${x.rpe ? ` RPE${x.rpe}` : ""}${x.feeling ? ` Feel${x.feeling}` : ""}${flag}`;
        }).join(", ");
    const j = d.journal
      ? `Energy ${d.journal.energy ?? "—"}, Soreness ${d.journal.soreness ?? "—"}${d.journal.alcoholDrinks ? `, Vortag-Alk ${d.journal.alcoholDrinks}` : ""}`
      : "kein Journal";
    return `**${label}** (${d.dow} ${d.date}): ${w} | ${j}`;
  }).join("\n");

  // Sickness-Block — PROMINENT, denn das ueberschreibt alles andere
  const sicknessBlock = (() => {
    const t = ctx.sicknessTimeline;
    if (!t) return "";
    if (!t.hadRecentSickness && t.rampUpStage === "full") return "";
    const dayLines = t.days
      .filter((d) => d.isSick || d.daysAgo <= 5)
      .map((d) => {
        const flag = d.isSick ? "🤒 SICK" : "·";
        const m = d.markers.length > 0 ? ` (${d.markers.join(", ")})` : "";
        return `  - ${d.dow} ${d.date} (${d.daysAgo === 0 ? "HEUTE" : `vor ${d.daysAgo}d`}): ${flag}${m}`;
      })
      .join("\n");
    return `

## 🤒 KRANKHEITS-VERLAUF & RAMP-UP-STATUS (⚠ ÜBERSCHREIBT Standard-Wochen-Logik!)
${dayLines || "(keine Sick-Days in den letzten 7d)"}

**Ramp-Up-Stufe für Mo (${ctx.nextWeekStart}): ${t.rampUpStage.toUpperCase()}**
**Coach-Begründung:** ${t.rampUpRationale}

VERBINDLICHE REGELN je nach Stufe:
- **test-day** (Tag 1-2 nach Sick): Mo = ENTWEDER Rest ODER nur 1 lockeres Oberkörper-Workout (Push/Pull leicht, RPE ≤6).
  KEIN Lauf, KEIN Legday, KEINE Intervalle. Begründung im reasoning: "Testen wie der Körper reagiert."
  Di hängt vom Mo-Feeling ab — plane Di-Frueh konservativ (kurzer Z2-Lauf 5-8km ODER nochmal Oberkörper),
  und IM REASONING SAGE: "Wenn Mo gut lief: Di darf wieder Doppel-Session (Lauf früh + Legday mittag). Wenn nicht: Di nochmal nur 1 leichte Session."
- **easy-only** (Tag 3-4 nach Sick): Z1/Z2 erlaubt, KEINE Intervalle, KEINE harten Krafttage (Hypertrophy mit moderater Intensitaet ok, KEIN Maximalkraft). Doppel-Sessions vorsichtig: nur wenn die Tag-1-2-Reaktion klar gruen war.
- **moderate-cap** (Tag 5+): fast normal, cap RPE 7. Doppel-Sessions OK. Long Run/Long Cardio ok, aber 20-30% kuerzer als sonst.
- **full**: normaler Plan.

WICHTIG: Wenn Stufe "test-day" oder "easy-only": **KEIN LONG RUN, KEIN 11km-Lauf** als Mo-Standard-Setting.
Erst gegen Ende der Woche (Fr/Sa) testen ob's wieder geht.`;
  })();

  return `# WOCHEN-PLAN-AUFTRAG
Plane des Users Trainingswoche **${ctx.nextWeekStart} (Mo) - ${ctx.nextWeekEnd} (So)**.

## ⚠ HEUTE / GESTERN ABSOLVIERT (entscheidend fuer Mo-Plan!)
${heuteGesternBlock}

→ Wenn oben "⚠ HARTE BEINBELASTUNG" steht, gilt die Post-Long-Run-Regel aus dem System-Prompt:
  Mo darf KEIN Legday/Lauf sein. Kein Spielraum. Verschiebe Legday auf spaeter in der Woche.${sicknessBlock}

## DES USERS ZIELE
${p?.goals ?? "(keine eingetragen)"}

## WOCHEN-RAHMEN
- ${p?.strengthPerWeek ?? 0}x Krafttraining/Woche
- ${p?.runsPerWeek ?? 0}x Lauf/Woche (kurz ${p?.shortRunKm ?? "—"}km, lang ${p?.longRunKm ?? "—"}km)
- Restdays: ${(p?.restDays ?? []).map((d) => dow[d - 1]).join(", ") || "(keine)"}
- MaxHr: ${p?.maxHr ?? "—"}

## BEVORZUGTE SLOTS
${slotPrefsBlock(p?.weeklySlotPrefs)}

## AKTUELLES TRAININGS-SETUP (so trainiert er gerade)
${p?.weeklyTemplateMarkdown ?? "(nicht gepflegt)"}

## ALGORITHMISCHE COACH-ANALYSE
Status: **${a.status}** · Wochenstrategie: **${a.weekStrategy.type}** — ${a.weekStrategy.headline}
Begruendung: ${a.weekStrategy.rationale.join(" | ")}
Volumen-Vorschlag: ${a.weekStrategy.volumeAdjustmentPct > 0 ? "+" : ""}${a.weekStrategy.volumeAdjustmentPct}%
Deload empfohlen: ${a.deloadRecommended ? "JA" : "nein"}
Fatigue-Flags: ${a.flags.length === 0 ? "(keine)" : a.flags.map((f) => `[sev${f.severity}] ${f.description}`).join(" | ")}
HRV 7d ${s.hrv7d?.toFixed(0) ?? "—"}ms (${s.hrvDeviationPct !== null ? (s.hrvDeviationPct > 0 ? "+" : "") + s.hrvDeviationPct.toFixed(0) + "%" : "—"}) · RHR 7d ${s.rhr7d?.toFixed(0) ?? "—"} · ACWR ${s.acwr?.toFixed(2) ?? "—"} · Monotony ${s.monotony?.toFixed(2) ?? "—"} · Tage seit voll erholt ${s.daysSinceFullyRecovered ?? "—"}
${ctx.periodization ? `
## 🏁 RACE-PERIODISIERUNG (RÜCKWÄRTS GERECHNET)
**Phase: ${ctx.periodization.phase.toUpperCase()}** — ${ctx.periodization.phaseLabel}
${ctx.periodization.raceName ? `Race: **${ctx.periodization.raceName}** am ${ctx.periodization.raceDate} (${ctx.periodization.weeksUntilRace} Wochen weg)` : ""}
Fokus-Keywords für DIESE Phase: **${ctx.periodization.focusKeywords.join(", ")}**
→ Plane die Woche AUF DIESE PHASE ausgerichtet! Andere Sport-Aspekte zurückhaltend.` : ""}
${ctx.mesocycle ? `
## 🔄 MESOZYKLUS (4-Wochen-Block-Periodisierung)
${ctx.mesocycle.headline}
**${ctx.mesocycle.coachInsight}**
Volume-Modifier: ${ctx.mesocycle.volumeModifier.toFixed(2)} · Intensitäts-Modifier: ${ctx.mesocycle.intensityModifier.toFixed(2)}
→ Plane Volumen entsprechend (deload = leicht halten, peak = ehrgeizig).` : ""}
${ctx.cardioDistribution ? `
## 🏃 CARDIO-DISTRIBUTION (für DIESE Woche)
**Typ: ${ctx.cardioDistribution.type.toUpperCase()}** — ${ctx.cardioDistribution.description}
Zonen-Split: ${ctx.cardioDistribution.zoneSplit.z1z2}% Z1-Z2 / ${ctx.cardioDistribution.zoneSplit.z3}% Z3 / ${ctx.cardioDistribution.zoneSplit.z4z5}% Z4-Z5
Empfohlene Templates: ${ctx.cardioDistribution.recommendedTemplates.join(", ")}
→ Setze die Cardio-Sessions nach DIESEM Mix.` : ""}
${ctx.strengthBlock ? `
## 💪 STRENGTH-BLOCK (für DIESE Woche)
**Block: ${ctx.strengthBlock.block.toUpperCase()}**
Reps: ${ctx.strengthBlock.reps} · Sets: ${ctx.strengthBlock.sets.min}-${ctx.strengthBlock.sets.max} · Intensität: ${ctx.strengthBlock.intensity}
Pause: ${ctx.strengthBlock.restSec.min}-${ctx.strengthBlock.restSec.max}s · ${ctx.strengthBlock.rpe}
Fokus: ${ctx.strengthBlock.focus}
→ Strength-Sessions IN DIESEM Block-Stil planen (Reps, Sätze, Intensität).` : ""}

## LETZTE 14 TAGE (Mo-So aktuell)
${last14Block}

## KOMMENDE WOCHE — TERMINE AUS KALENDER
[B] = Business · [P] = Privat — DIESE EVENTS NICHT VERSCHIEBEN, du planst drumherum.
${eventsBlock}

## MEMOS / KONTEXT-NOTIZEN
${memoryBlock}
${refine ? `

## VORHERIGER PLAN (den du gerade ueberarbeitest)
\`\`\`json
${JSON.stringify(refine.previousPlan, null, 2)}
\`\`\`

## DES USERS FEEDBACK / ANTWORTEN
"""
${refine.feedback}
"""

WICHTIG bei der Ueberarbeitung:
- Lies des Users Feedback aufmerksam. Es kann Antworten auf deine openQuestions sein, Vorschlaege fuer
  konkrete Aenderungen ("Lauf eher frueh, dann Legday"), Kontext-Info ("im Sommer eher morgens laufen",
  "Knie gut") oder Praeferenzen.
- Behalte was im vorherigen Plan PASST. Aendere nur was des Users Feedback verlangt oder was du nach seinem
  Feedback besser einordnen kannst.
- Vermerke die Aenderung explizit im weekReasoning ("Auf deinen Wunsch Lauf morgens, Legday nachmittag")
  und/oder im pro-Session reasoning.
- openQuestions: nur noch Fragen die nach diesem Feedback NICHT geklaert sind. Wenn alles klar, leeres Array.` : ""}

---
Gib jetzt das ${refine ? "ueberarbeitete" : "vollstaendige"} Plan-JSON zurueck (Schema siehe System-Prompt). KEIN Vor-/Nachtext, nur das JSON.`;
}

export interface WeekDraftPlan {
  weekFocus: string;
  volumeAdjustPct: number;
  weekReasoning: string;
  openQuestions: string[];
  days: Array<{
    date: string;
    dow: string;
    dayFocus: string;
    sessions: Array<{
      start: string;
      end: string;
      type: "strength" | "cardio" | "long_cardio" | "mobility" | "rest";
      title: string;
      intensityStrength: number;
      intensityCardio: number;
      exercises?: Array<{ name: string; sets: number; reps: string; intensity?: string; notes?: string }>;
      cardio?: { subType: string; distanceKm?: number; durationMin?: number; zone?: string; hrTarget?: number };
      reasoning: string;
      conflicts: string[];
    }>;
  }>;
}

export function parseWeekDraftResponse(raw: string): WeekDraftPlan | null {
  if (!raw || typeof raw !== "string") return null;
  const t0 = raw.trim();

  // Versuch 1: direkt parsen
  try {
    return JSON.parse(t0) as WeekDraftPlan;
  } catch { /* nope */ }

  // Versuch 2: Markdown-Fence entfernen (```json ... ``` oder ``` ... ```)
  const fenceMatch = t0.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim()) as WeekDraftPlan;
    } catch { /* nope */ }
  }

  // Versuch 3: Balanced-Brace-Matching — finde das erste vollstaendige {...}-Objekt
  // (greedy /\{[\s\S]*\}/ schlaegt fehl wenn nach dem JSON noch ein {...} im Text steht).
  const start = t0.indexOf("{");
  if (start >= 0) {
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < t0.length; i++) {
      const c = t0[i];
      if (escape) { escape = false; continue; }
      if (c === "\\" && inString) { escape = true; continue; }
      if (c === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) {
          const candidate = t0.slice(start, i + 1);
          try {
            return JSON.parse(candidate) as WeekDraftPlan;
          } catch { /* candidate war doch nicht valide, fortsetzen */ }
          break;
        }
      }
    }
  }

  return null;
}
