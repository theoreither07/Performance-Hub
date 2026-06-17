/**
 * Sportwissenschaftliche Bausteine für Bereitschafts- und Vitality-Score.
 *
 * Quellen:
 *  - HRV Plews-Methode: 7d-Rolling-Mean + CV. Plews et al. 2013, Sports Med.
 *    Status: balanced / coping / sympathetic / parasympathetic.
 *  - Training Stress Balance (Coggan): CTL (42d EWMA) - ATL (7d EWMA) = Form/Frische.
 *  - Type-specific Recovery Half-Lives: aus Coaching-Literatur (Tudor Bompa,
 *    Verkhoshansky) — Strength braucht ~24-48h, Z2 ~4-8h, Threshold ~12-24h.
 *  - Sleep-Composite (REM+Deep) — Walker "Why We Sleep", Plus Hirshkowitz Sleep
 *    Consistency Studie.
 *  - Heat-HRV-Bias: 5-15% HRV-Drop bei Temperatur > 25°C ohne Performance-Verlust
 *    (Buchheit 2010).
 *  - Alkohol-Carry-Over: 2 Drinks → 12% HRV-Drop, 24-48h Halbwertszeit
 *    (Pietilä et al. 2018).
 */

// ============================================================
// HRV — Plews-Methode
// ============================================================

export interface HrvSeries {
  values: { date: string; value: number }[]; // chronologisch, oldest first
}

export type HrvStatus = "balanced" | "coping" | "sympathetic" | "parasympathetic" | "unknown";

export interface HrvAnalysis {
  /** Rolling 7-day mean (heute zurückgerechnet). */
  rmean7d: number | null;
  /** Coefficient of Variation (Std/Mean × 100) der letzten 7 Tage. */
  cv7d: number | null;
  /** Mean RMSSD der letzten 28d als Baseline für Vergleich. */
  baseline28d: { mean: number; std: number } | null;
  /** z-score von rmean7d vs baseline28d. */
  trendZ: number | null;
  /** Hauptstatus. */
  status: HrvStatus;
  /** Headline für UI. */
  insight: string;
}

function mean(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}
function std(arr: number[], m?: number): number {
  const mu = m ?? mean(arr);
  const v = arr.reduce((a, b) => a + (b - mu) ** 2, 0) / arr.length;
  return Math.sqrt(v);
}

export function analyzeHrv(series: HrvSeries, todayKey: string): HrvAnalysis {
  // Filter explizit by DATE-Range (nicht by Position), damit fehlende Tage nicht das
  // Window verschieben. Letzte 7 Kalendertage inkl. heute, vorherige 28 davor.
  const today = new Date(todayKey + "T12:00:00Z");
  const ymd = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  const since7 = new Date(today);
  since7.setUTCDate(today.getUTCDate() - 6);
  const since28 = new Date(today);
  since28.setUTCDate(today.getUTCDate() - 28);
  const since28End = new Date(today);
  since28End.setUTCDate(today.getUTCDate() - 1);

  const recent7 = series.values
    .filter((v) => v.date >= ymd(since7) && v.date <= todayKey)
    .map((v) => v.value);
  const recent28 = series.values
    .filter((v) => v.date >= ymd(since28) && v.date <= ymd(since28End))
    .map((v) => v.value);

  const rmean7d = recent7.length >= 4 ? mean(recent7) : null;
  const cv7d = recent7.length >= 4 ? (std(recent7, rmean7d ?? undefined) / (rmean7d || 1)) * 100 : null;

  const baseline28d = recent28.length >= 14
    ? { mean: mean(recent28), std: std(recent28) || 1 }
    : null;

  const trendZ = (rmean7d !== null && baseline28d)
    ? (rmean7d - baseline28d.mean) / baseline28d.std
    : null;

  // Plews-Status-Klassifikation:
  //   balanced: trendZ in [-0.3, +0.5], CV in normalem Bereich (~5-10%)
  //   sympathetic overload: rmean7d ↓ UND CV ↑ (NS-System unter Stress, schlechte Erholung)
  //   parasympathetic: rmean7d hoch UND CV hoch (Adaption, oft pre-Peak — vorsicht aber auch Overreaching)
  //   coping: rmean7d in Mitte, leicht erhöhte CV
  let status: HrvStatus = "unknown";
  let insight = "Zu wenige HRV-Daten — Baseline kommt nach ~2 Wochen.";
  if (trendZ !== null && cv7d !== null) {
    const cvHigh = cv7d > 8;
    if (trendZ < -0.7 && cvHigh) {
      status = "sympathetic";
      insight = `HRV ${trendZ.toFixed(1)}σ unter 28d-Baseline + erhöhte Variabilität — sympathisch dominant. Reduzieren, Schlaf priorisieren.`;
    } else if (trendZ > 0.7 && cvHigh) {
      status = "parasympathetic";
      insight = `HRV ${trendZ.toFixed(1)}σ über Baseline aber CV hoch — Adaptation oder beginnendes Overreaching. Belastung halten, beobachten.`;
    } else if (trendZ < -0.4) {
      status = "coping";
      insight = `HRV-Trend leicht unter Baseline — System bewältigt. Mittlere Intensität ok, hartes Training nicht heute.`;
    } else {
      status = "balanced";
      insight = `HRV-Trend balanced (${trendZ >= 0 ? "+" : ""}${trendZ.toFixed(1)}σ vs Baseline, CV ${cv7d.toFixed(1)}%). Volle Belastung möglich.`;
    }
  }

  return { rmean7d, cv7d, baseline28d, trendZ, status, insight };
}

// ============================================================
// Training Stress Balance — CTL / ATL / TSB
// ============================================================

export interface LoadPoint { date: string; load: number; }

export interface TsbAnalysis {
  /** Chronic Training Load — 42d Exponential Weighted Moving Average. */
  ctl: number;
  /** Acute Training Load — 7d EWMA. */
  atl: number;
  /** Training Stress Balance = CTL - ATL. Positiv = frisch, negativ = ermüdet. */
  tsb: number;
  /** "fresh" / "race-ready" / "neutral" / "fatigued" / "overload". */
  zone: "fresh" | "race-ready" | "neutral" | "fatigued" | "overload";
  insight: string;
  /** Score-Komponente 0-100: Bereitschafts-Beitrag aus TSB. */
  scoreComponent: number;
}

function ewma(points: LoadPoint[], todayKey: string, halflife: number): number {
  // Klassische Coggan-Formel: λ = exp(-1/halflife). Tag für Tag iterieren.
  const lambda = Math.exp(-1 / halflife);
  // Map date→load
  const byDate = new Map(points.map((p) => [p.date, p.load]));
  // Iteriere die letzten ~halflife*3 Tage
  const days = Math.ceil(halflife * 3.5);
  const ymd = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  const today = new Date(todayKey + "T12:00:00Z");
  let acc = 0;
  for (let i = days; i >= 0; i--) {
    const t = new Date(today);
    t.setUTCDate(today.getUTCDate() - i);
    const k = ymd(t);
    const load = byDate.get(k) ?? 0;
    acc = lambda * acc + (1 - lambda) * load;
  }
  return acc;
}

export function analyzeTsb(loads: LoadPoint[], todayKey: string): TsbAnalysis {
  const ctl = ewma(loads, todayKey, 42);
  const atl = ewma(loads, todayKey, 7);
  const tsb = ctl - atl;

  let zone: TsbAnalysis["zone"] = "neutral";
  let insight = "";
  if (tsb > 25) {
    zone = "fresh";
    insight = `TSB +${tsb.toFixed(0)}: sehr frisch, fast detrained. Belastung wieder hochfahren.`;
  } else if (tsb > 10) {
    zone = "race-ready";
    insight = `TSB +${tsb.toFixed(0)}: Form-Peak Window. Hartes Training oder Race möglich.`;
  } else if (tsb > -10) {
    zone = "neutral";
    insight = `TSB ${tsb.toFixed(0)}: Maintenance — solider Build-State.`;
  } else if (tsb > -30) {
    zone = "fatigued";
    insight = `TSB ${tsb.toFixed(0)}: ermüdet — leicht halten, sonst Plateau-Risiko.`;
  } else {
    zone = "overload";
    insight = `TSB ${tsb.toFixed(0)}: Überlastung. Hartes Training jetzt = Verletzungs-/Burnout-Risiko.`;
  }

  // Mapping TSB → Score-Komponente 0-100:
  // TSB +15 (race-ready) = 90, TSB 0 = 70, TSB -20 = 40, TSB -40 = 15
  const scoreComponent = Math.max(0, Math.min(100, 70 + tsb * 1.2));

  return { ctl, atl, tsb, zone, insight, scoreComponent };
}

// ============================================================
// Type-spezifische Workout-Recovery-Halbwertszeiten
// ============================================================

/**
 * Halbwertszeit in Stunden, nach Workout-Type. Aus Coaching-Literatur:
 *  - Strength: 24h (DOMS-Peak 24-48h, primärer Drain in 24h)
 *  - Long Cardio: 24h (Glykogen-Depletion + Hormonal)
 *  - Threshold/Tempo Cardio: 18h
 *  - Z2 Cardio: 6h (aerob, schnell erholt)
 *  - Mobility: 2h (sehr leicht, eher erholend)
 *  - Default: 8h
 */
export function recoveryHalfLife(type: string, intensity?: number): number {
  const t = type.toLowerCase();
  if (t.includes("strength") || t.includes("weight")) return 24;
  if (t === "long_cardio" || t.includes("long")) return 24;
  if (t === "cardio") {
    // unterscheide nach Intensität — wenn ≥6/10 = Threshold/Tempo, sonst Z2.
    if ((intensity ?? 5) >= 6) return 18;
    return 6;
  }
  if (t.includes("mobility") || t.includes("yoga") || t.includes("stretch")) return 2;
  if (t.includes("run") || t.includes("cycl") || t.includes("bike")) return 8;
  return 8;
}

// ============================================================
// Sleep-Composite (Deep+REM, Sleep-Debt)
// ============================================================

export interface SleepInput {
  totalMin: number | null;
  deepMin?: number | null;
  remMin?: number | null;
  sleepScore?: number | null;
  /** Letzte 7 Tage Schlafdauer (für Sleep-Debt-Tracking). */
  recent7d?: number[];
  /** Personalisierte Schlaf-Bedürfnis-Stunden (default 7.5). */
  needHours?: number;
}

export interface SleepAnalysis {
  /** 0-100, gewichtet aus Dauer + Qualität (Deep+REM-Anteil). */
  score: number;
  /** Kumulatives Schlaf-Defizit über die letzten 7 Tage in Stunden. */
  debt7dH: number;
  /** Deep+REM-Anteil 0-1 (wenn Stages bekannt). */
  deepRemRatio: number | null;
  insight: string;
}

export function analyzeSleep(input: SleepInput): SleepAnalysis {
  const need = Math.max(360, (input.needHours ?? 7.5) * 60); // mind. 6h, kein div-by-zero
  const total = input.totalMin;
  if (total === null) {
    return { score: 50, debt7dH: 0, deepRemRatio: null, insight: "Keine Schlafdaten." };
  }

  // Dauer-Score: needHours → 100, (need - 2.5h) → 50, (need - 5h, mind. 5h floor) → 0
  // 60 min Range pro 50 pts ist sportwissenschaftlich gängig.
  const denom = Math.max(60, need - 300);
  const durationScore = Math.max(0, Math.min(100, ((total - (need - 300)) / denom) * 50 + 50));

  // Qualität: Deep+REM-Anteil (wenn vorhanden). Ideal ~ 35-45% des Total.
  let qualityScore = durationScore;
  let deepRemRatio: number | null = null;
  if (input.deepMin != null && input.remMin != null && total > 0) {
    deepRemRatio = (input.deepMin + input.remMin) / total;
    // Optimal 0.35-0.45 → 100. <0.20 → 30. >0.55 → 80 (zu viel REM = Stress)
    if (deepRemRatio >= 0.35 && deepRemRatio <= 0.48) qualityScore = 95;
    else if (deepRemRatio >= 0.28) qualityScore = 75;
    else if (deepRemRatio >= 0.20) qualityScore = 55;
    else qualityScore = 35;
  } else if (input.sleepScore != null) {
    qualityScore = input.sleepScore;
  }

  // Gewichteter Composite — Dauer 60%, Qualität 40%
  const score = Math.round(durationScore * 0.6 + qualityScore * 0.4);

  // Sleep-Debt: Σ(need - actual_i) für letzte 7 Tage, nur Defizit zählt
  const debt7dMin = (input.recent7d ?? []).reduce((acc, m) => acc + Math.max(0, need - m), 0);
  const debt7dH = Math.round((debt7dMin / 60) * 10) / 10;

  let insight: string;
  if (debt7dH > 5) {
    insight = `Sleep-Debt ${debt7dH}h über 7 Tage — Erholungs-Reserve aufgebraucht. Heute ist langer Schlaf Pflicht.`;
  } else if (debt7dH > 2) {
    insight = `Sleep-Debt ${debt7dH}h kumuliert — Anzeichen für leichten Defizit.`;
  } else if (deepRemRatio !== null && deepRemRatio < 0.25) {
    insight = `Schlaf-Qualität schwach (Deep+REM nur ${Math.round(deepRemRatio * 100)}%) — neurale Erholung gedämpft.`;
  } else if (score >= 80) {
    insight = `Schlaf top: ${(total / 60).toFixed(1)}h, Qualität gut.`;
  } else {
    insight = `Schlaf solide.`;
  }

  return { score, debt7dH, deepRemRatio, insight };
}

// ============================================================
// Heat-Compensation (HRV-Bias bei Hitze)
// ============================================================

export interface HeatAdjustment {
  /** Wieviele Punkte wird der HRV-Score nach oben korrigiert (5-15 bei Hitze). */
  bonusPoints: number;
  insight: string | null;
}

export function heatCompensation(tempC: number | null): HeatAdjustment {
  if (tempC === null || tempC < 25) return { bonusPoints: 0, insight: null };
  // 25-28°C → 5pt, 28-32°C → 10pt, >32°C → 15pt
  if (tempC < 28) return { bonusPoints: 5, insight: `Hitze ${Math.round(tempC)}°C: HRV-Drop kompensiert (+5).` };
  if (tempC < 32) return { bonusPoints: 10, insight: `Hitze ${Math.round(tempC)}°C: deutlicher HRV-Bias kompensiert (+10).` };
  return { bonusPoints: 15, insight: `Hitze ${Math.round(tempC)}°C: starker HRV-Drop kompensiert (+15) — trainiere kühler oder kürzer.` };
}

// ============================================================
// Alkohol-Carry-Over
// ============================================================

export interface AlcoholPenalty {
  /** Negative Punkte für Bereitschafts/Vitality-Score. */
  penalty: number;
  insight: string | null;
}

/**
 * Pietilä et al. 2018: 2+ Drinks → 12% HRV-Reduktion, 24-48h Carry-Over.
 * Wir geben einen Score-Penalty basierend auf alcoholDrinks der LETZTEN 2 Tage.
 */
export function alcoholCarryOver(yesterdayDrinks: number | null, twoDaysAgoDrinks: number | null): AlcoholPenalty {
  const y = yesterdayDrinks ?? 0;
  const t = twoDaysAgoDrinks ?? 0;
  if (y === 0 && t === 0) return { penalty: 0, insight: null };
  // Penalty: gestern 1.0× Effekt, vor 2 Tagen 0.4× (Halbwertszeit ~30h)
  const penaltyRaw = y * 4 + t * 1.5;
  const penalty = Math.min(20, penaltyRaw);
  if (penalty < 2) return { penalty: 0, insight: null };
  const parts: string[] = [];
  if (y > 0) parts.push(`gestern ${y} Drinks`);
  if (t > 0) parts.push(`vorgestern ${t}`);
  return {
    penalty,
    insight: `Alkohol-Carry-Over (${parts.join(", ")}): ~12% HRV-Drop wirkt noch (−${Math.round(penalty)}).`,
  };
}
