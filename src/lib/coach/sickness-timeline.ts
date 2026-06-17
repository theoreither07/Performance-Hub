/**
 * Berechnet Sickness-Timeline der letzten 7 Tage relativ zu einem Anker-Tag (z.B. Plan-Mo).
 * Nutzt detectSickness aus daily-adjustment.ts und einen 14d-HRV-Baseline.
 */

import { format, subDays, differenceInCalendarDays } from "date-fns";
import { detectSickness } from "./daily-adjustment";

const DOW_DE = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

export type RampUpStage = "none" | "test-day" | "easy-only" | "moderate-cap" | "full";

export interface SicknessDayDetail {
  date: string;
  dow: string;
  isSick: boolean;
  markers: string[];
  /** Tage zwischen diesem Tag und planMonday (positiv = liegt VOR Plan-Mo). */
  daysAgo: number;
}

export interface SicknessTimeline {
  daysSinceSickness: number | null;
  hadRecentSickness: boolean;
  days: SicknessDayDetail[];
  rampUpStage: RampUpStage;
  rampUpRationale: string;
}

interface MetricsByDate {
  [yyyymmdd: string]: { [kind: string]: number };
}

/**
 * Computes 14d-rolling-baseline (mean) bis vor 14 Tagen — vor der jeweils gepruefften Day.
 * Konservativ: nutzt die letzten 14d aller verfuegbaren overnight-HRV-Werte.
 */
function rollingMean(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x));
  if (v.length === 0) return null;
  return v.reduce((a, b) => a + b, 0) / v.length;
}

function stddev(values: number[], mean: number): number {
  const v = values.filter((x) => Number.isFinite(x));
  if (v.length < 2) return 0;
  const variance = v.reduce((s, x) => s + (x - mean) ** 2, 0) / v.length;
  return Math.sqrt(variance);
}

export function computeSicknessTimeline(
  metricsByDate: MetricsByDate,
  planMonday: Date,
): SicknessTimeline {
  // 7-Tage-Window vor Plan-Mo (inkl. Sonntag = Tag vor Mo).
  const dayAnchors: Date[] = [];
  for (let i = 1; i <= 7; i++) {
    dayAnchors.push(subDays(planMonday, i));
  }
  // dayAnchors[0] = Sa? Nein — i=1 → planMo-1 = So. Reverse: wir wollen vom juengsten (So) zum aeltesten.
  // Reihenfolge: dayAnchors[0]=So (1d ago), [1]=Sa (2d), [2]=Fr (3d), ..., [6]=Mo (7d).

  // HRV-Baseline: 14d-Mean & SD aus allen verfuegbaren HRV-Werten der letzten 28 Tage VOR planMonday.
  const hrvHistory: number[] = [];
  const rhrHistory: number[] = [];
  for (let i = 1; i <= 28; i++) {
    const d = subDays(planMonday, i);
    const key = format(d, "yyyy-MM-dd");
    const m = metricsByDate[key];
    if (!m) continue;
    if (typeof m.hrv_overnight === "number") hrvHistory.push(m.hrv_overnight);
    if (typeof m.rhr === "number") rhrHistory.push(m.rhr);
  }
  const hrvBaseline = rollingMean(hrvHistory);
  const rhrBaseline = rollingMean(rhrHistory);
  const rhrSd = rhrBaseline !== null ? stddev(rhrHistory, rhrBaseline) : 0;

  const days: SicknessDayDetail[] = dayAnchors.map((d) => {
    const key = format(d, "yyyy-MM-dd");
    const m = metricsByDate[key] ?? {};
    const dowIdx = (d.getDay() + 6) % 7;
    const hrv = typeof m.hrv_overnight === "number" ? m.hrv_overnight : null;
    const sleepMin = typeof m.sleep_minutes === "number" ? m.sleep_minutes : null;
    const bbLow = typeof m.body_battery_low === "number" ? m.body_battery_low : null;
    const rhr = typeof m.rhr === "number" ? m.rhr : null;

    const hrvDropPct = hrv !== null && hrvBaseline !== null && hrvBaseline > 0
      ? ((hrv - hrvBaseline) / hrvBaseline) * 100
      : null;
    const rhrZ = rhr !== null && rhrBaseline !== null && rhrSd > 0
      ? (rhr - rhrBaseline) / rhrSd
      : null;
    const sleepHours = sleepMin !== null ? sleepMin / 60 : null;

    const { isSick, markers } = detectSickness({
      hrvDropPct,
      sleepHoursLastNight: sleepHours,
      bodyBatteryMaxToday: bbLow, // we proxy with bbLow (min over day) — konservativ
      rhrZ,
    });

    return {
      date: key,
      dow: DOW_DE[dowIdx],
      isSick,
      markers,
      daysAgo: differenceInCalendarDays(planMonday, d),
    };
  });

  // Juengster Sick-Day finden (kleinster daysAgo wo isSick=true).
  const sickDays = days.filter((d) => d.isSick).sort((a, b) => a.daysAgo - b.daysAgo);
  const daysSinceSickness = sickDays.length > 0 ? sickDays[0].daysAgo : null;
  const hadRecentSickness = sickDays.length > 0;

  // Ramp-Up-Stufe nach Tagen seit letzter Sick-Day (relativ zu planMo).
  let rampUpStage: RampUpStage = "full";
  let rampUpRationale = "Keine Krankheits-Indikatoren in den letzten 7 Tagen — normaler Plan.";
  if (daysSinceSickness !== null) {
    const markerSummary = sickDays[0].markers.join(", ");
    if (daysSinceSickness <= 2) {
      rampUpStage = "test-day";
      rampUpRationale = `Letzter Sick-Day vor ${daysSinceSickness}d (${sickDays[0].dow} ${sickDays[0].date}, ${markerSummary}). Mo = Test-Tag: nur Oberkoerper LEICHT oder Rest. Kein Lauf, kein Legday, keine Intervalle. Di abhaengig vom Mo-Feeling.`;
    } else if (daysSinceSickness <= 4) {
      rampUpStage = "easy-only";
      rampUpRationale = `Letzter Sick-Day vor ${daysSinceSickness}d. Z1/Z2 erlaubt, KEINE Intervalle, KEINE harten Krafttage. Doppel-Splits OK wenn Tag-1-2-Reaktion gruen war.`;
    } else if (daysSinceSickness <= 6) {
      rampUpStage = "moderate-cap";
      rampUpRationale = `Letzter Sick-Day vor ${daysSinceSickness}d. Fast normal, cap RPE 7. Long-Cardio 20-30% kuerzer als sonst.`;
    } else {
      rampUpStage = "full";
      rampUpRationale = `Letzter Sick-Day vor ${daysSinceSickness}d — Recovery-Window vorbei. Normaler Plan moeglich, aber 1 Test-Session frueh in der Woche zur Sicherheit.`;
    }
  }

  return {
    daysSinceSickness,
    hadRecentSickness,
    days,
    rampUpStage,
    rampUpRationale,
  };
}
