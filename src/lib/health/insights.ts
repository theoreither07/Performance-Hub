/**
 * Insights pro Metrik: aus rohen Garmin-Werten generieren wir kurze Schluss-
 * folgerungen ("HRV +3 vs 14d, bereit fuer hartes Training"), nicht nur Zahlen.
 *
 * Verbraucht: { date, value }-Reihen aus /api/health/metrics. Daraus berechnen
 * wir baseline (14d), z-score gegen baseline, und mappen das auf einen Ton.
 */

export type Trend = "up" | "down" | "flat";
export type Tone = "good" | "neutral" | "warn" | "info";

export interface Insight {
  kind: string;
  label: string;
  unit: string;
  value: number | null;
  /** "+3 vs 14d-Schnitt" — relative Differenz, schon formatiert. */
  delta: string | null;
  trend: Trend;
  tone: Tone;
  /** Eine Zeile, taugt fuer Tile-Anzeige. */
  headline: string;
  /** Ein Satz, fuer Modal-Hauptaussage. */
  insight: string;
}

interface Point {
  date: string;
  value: number;
}

const KIND_META: Record<string, { label: string; unit: string; goodDirection: "up" | "down" }> = {
  hrv_overnight: { label: "HRV", unit: "ms", goodDirection: "up" },
  sleep_minutes: { label: "Schlaf", unit: "h", goodDirection: "up" },
  sleep_score: { label: "Schlaf-Score", unit: "/100", goodDirection: "up" },
  rhr: { label: "Ruhepuls", unit: "bpm", goodDirection: "down" },
  stress_avg: { label: "Stress", unit: "/100", goodDirection: "down" },
  body_battery_high: { label: "Body Battery max", unit: "%", goodDirection: "up" },
  body_battery_low: { label: "Body Battery min", unit: "%", goodDirection: "up" },
  vo2max: { label: "VO2max", unit: "ml/kg/min", goodDirection: "up" },
  steps: { label: "Schritte", unit: "", goodDirection: "up" },
};

function meanStd(vals: number[]): { mean: number; std: number } | null {
  if (vals.length < 3) return null;
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
  return { mean, std: Math.sqrt(variance) || 1 };
}

function formatValue(kind: string, v: number): string {
  if (kind === "sleep_minutes") {
    const h = Math.floor(v / 60);
    const m = Math.round(v % 60);
    return `${h}h ${m.toString().padStart(2, "0")}`;
  }
  if (kind === "hrv_overnight" || kind === "rhr") return Math.round(v).toString();
  if (kind === "sleep_score" || kind === "stress_avg") return Math.round(v).toString();
  if (kind === "vo2max") return v.toFixed(1);
  if (kind === "steps") return Math.round(v).toLocaleString("de-DE");
  return Math.round(v).toString();
}

function formatDelta(kind: string, delta: number): string {
  const sign = delta > 0 ? "+" : "";
  if (kind === "sleep_minutes") {
    const min = Math.round(delta);
    return `${sign}${min} min`;
  }
  if (kind === "vo2max") return `${sign}${delta.toFixed(1)}`;
  return `${sign}${Math.round(delta)}`;
}

/**
 * Hauptfunktion: berechnet einen Insight aus den letzten N Werten.
 * Nimmt die letzten 14 Tage als baseline, vergleicht heute (oder letzten Tag) damit.
 */
export function buildInsight(kind: string, points: Point[]): Insight {
  const meta = KIND_META[kind] ?? { label: kind, unit: "", goodDirection: "up" as const };
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const last = sorted[sorted.length - 1];
  const todayValue = last?.value ?? null;

  if (todayValue === null) {
    return {
      kind,
      label: meta.label,
      unit: meta.unit,
      value: null,
      delta: null,
      trend: "flat",
      tone: "neutral",
      headline: "—",
      insight: "Noch keine Daten von Garmin.",
    };
  }

  // Baseline = letzte 14 Tage VOR dem letzten Wert
  const baselineRaw = sorted.slice(-15, -1).map((p) => p.value);
  const baseline = meanStd(baselineRaw);

  const valueFmt = formatValue(kind, todayValue);

  if (!baseline) {
    return {
      kind,
      label: meta.label,
      unit: meta.unit,
      value: todayValue,
      delta: null,
      trend: "flat",
      tone: "info",
      headline: `${valueFmt} ${meta.unit}`.trim(),
      insight: `${valueFmt} ${meta.unit}. Baseline kommt nach ~2 Wochen Datenhistorie.`.trim(),
    };
  }

  const diff = todayValue - baseline.mean;
  const z = diff / baseline.std;
  const trend: Trend = Math.abs(diff) < baseline.std * 0.3 ? "flat" : diff > 0 ? "up" : "down";
  const goodIsUp = meta.goodDirection === "up";
  const isGood = (goodIsUp && z > 0.5) || (!goodIsUp && z < -0.5);
  const isBad = (goodIsUp && z < -0.7) || (!goodIsUp && z > 0.7);

  const tone: Tone = isGood ? "good" : isBad ? "warn" : "neutral";
  const deltaFmt = formatDelta(kind, diff);
  const headline = `${valueFmt} ${meta.unit}`.trim();

  let insight: string;
  if (kind === "hrv_overnight") {
    insight = isGood
      ? `HRV ${deltaFmt} vs 14d-Schnitt — Nervensystem ist frisch. Heute hartes Training moeglich.`
      : isBad
      ? `HRV ${deltaFmt} vs Schnitt — gedaempfte Erholung. Heute eher leicht oder Z2.`
      : `HRV nahe Baseline — solider Tag, plane wie geplant.`;
  } else if (kind === "sleep_minutes") {
    const hours = todayValue / 60;
    insight = hours < 6
      ? `${valueFmt} Schlaf — unter 6h. Verschiebe harte Einheit auf morgen.`
      : hours > 7.5
      ? `${valueFmt} Schlaf — hervorragend. Voller Tank fuer das Training.`
      : `${valueFmt} Schlaf — ok. Achte auf gleichmaessige Belastung.`;
  } else if (kind === "rhr") {
    insight = isBad
      ? `Ruhepuls ${deltaFmt} ueber Baseline — Koerper unter Stress. Heute leicht halten.`
      : isGood
      ? `Ruhepuls ${deltaFmt} unter Baseline — guter Erholungszustand.`
      : `Ruhepuls in Baseline-Naehe — normal.`;
  } else if (kind === "stress_avg") {
    insight = isBad
      ? `Stress ${deltaFmt} ueber Schnitt — Erholung priorisieren.`
      : isGood
      ? `Stress ${deltaFmt} unter Schnitt — gute Selbstregulation.`
      : `Stress im normalen Bereich.`;
  } else if (kind === "sleep_score") {
    insight = todayValue >= 80
      ? `Schlaf-Score ${valueFmt} — top Erholung.`
      : todayValue >= 60
      ? `Schlaf-Score ${valueFmt} — solide, aber kein Spitzentag.`
      : `Schlaf-Score ${valueFmt} — gedaempfte Erholung. Lockerer Tag empfohlen.`;
  } else if (kind === "vo2max") {
    insight = isGood
      ? `VO2max steigt — die Z2-Disziplin zahlt sich aus.`
      : isBad
      ? `VO2max leicht ruecklaeufig — vielleicht Belastung anpassen.`
      : `VO2max stabil.`;
  } else if (kind === "body_battery_high") {
    insight = todayValue >= 80
      ? `Body Battery Max ${valueFmt}% — vollgetankt.`
      : todayValue >= 50
      ? `Body Battery Max ${valueFmt}% — halb voll.`
      : `Body Battery Max ${valueFmt}% — wenig Reserve heute.`;
  } else {
    insight = `${headline}. ${deltaFmt} vs 14d-Schnitt.`;
  }

  return {
    kind,
    label: meta.label,
    unit: meta.unit,
    value: todayValue,
    delta: deltaFmt,
    trend,
    tone,
    headline,
    insight,
  };
}

/**
 * Mini-Sparkline-Pfad fuer SVG. Liefert nur den `d`-String fuer <path>.
 */
export function sparklinePath(points: Point[], w = 100, h = 28): string {
  if (points.length < 2) return "";
  const vals = points.map((p) => p.value);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;
  return points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * w;
      const y = h - ((p.value - min) / range) * (h - 4) - 2;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}
