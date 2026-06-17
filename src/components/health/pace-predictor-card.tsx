"use client";

/**
 * Pace-Predictor / Running-Profile Card.
 *
 * Aus den letzten 21 Tagen Lauf-Workouts:
 *   - Aktuelle Z2-Pace (avgHr unter 81% MaxHr) — mit Trend +/−
 *   - Geschätzte Threshold-Pace (avgHr 87-92% MaxHr)
 *   - Bei aktivem race-Goal: hochgerechnete Race-Time (linear extrapoliert auf Distanz)
 *
 * Da der User aktuell kein Race im Goal hat, zeigen wir die Zonen-Paces ohne Race-Prediction.
 * Sobald ein Race-LongTermGoal aktiv ist, kommt unten ein Race-Forecast-Block dazu.
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Footprints, TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface Workout {
  date: string;
  type: string;
  durationSec: number;
  distanceM: number | null;
  avgHr: number | null;
  maxHr: number | null;
}
interface WorkoutsResponse { workouts: Workout[] }
interface ProfileResponse { maxHr?: number | null; longRunKm?: number | null }
interface Goal { id: string; type: string; targetValue: number | null; targetUnit: string | null }
interface GoalsResponse { goals: Goal[] }

function paceFmt(secondsPerKm: number): string {
  const m = Math.floor(secondsPerKm / 60);
  const s = Math.round(secondsPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")}/km`;
}

function classifyZone(avgHr: number | null, maxHr: number): "Z1" | "Z2" | "Z3" | "Z4" | "Z5" | null {
  if (avgHr === null) return null;
  const pct = avgHr / maxHr;
  if (pct < 0.6) return "Z1";
  if (pct < 0.72) return "Z2";
  if (pct < 0.81) return "Z2"; // High Z2 mit 81% Schwelle
  if (pct < 0.87) return "Z3";
  if (pct < 0.92) return "Z4";
  return "Z5";
}

export function PacePredictorCard() {
  const workoutsQ = useQuery<WorkoutsResponse>({
    queryKey: ["workouts-running", 21],
    queryFn: async () => {
      const res = await fetch("/api/workouts?days=21&type=running");
      if (!res.ok) throw new Error("w");
      return res.json();
    },
    staleTime: 5 * 60_000,
  });
  const profileQ = useQuery<ProfileResponse>({
    queryKey: ["training-profile"],
    queryFn: async () => {
      const res = await fetch("/api/training-profile");
      if (!res.ok) throw new Error("p");
      return res.json();
    },
    staleTime: 10 * 60_000,
  });
  const goalsQ = useQuery<GoalsResponse>({
    queryKey: ["long-term-goals"],
    queryFn: async () => {
      const res = await fetch("/api/coach/long-term-goals");
      if (!res.ok) throw new Error("g");
      return res.json();
    },
    staleTime: 5 * 60_000,
  });

  const maxHr = profileQ.data?.maxHr ?? 190;
  const runs = (workoutsQ.data?.workouts ?? []).filter((w) => w.type === "running" && (w.distanceM ?? 0) > 1500 && w.durationSec > 600 && w.avgHr !== null);

  // Z2-Paces
  const z2Runs = runs.filter((w) => classifyZone(w.avgHr, maxHr) === "Z2");
  const recent7 = z2Runs.filter((w) => new Date(w.date) >= new Date(Date.now() - 7 * 86400000));
  const prev14 = z2Runs.filter((w) => {
    const d = new Date(w.date);
    return d < new Date(Date.now() - 7 * 86400000) && d >= new Date(Date.now() - 21 * 86400000);
  });
  function avgPace(arr: Workout[]): number | null {
    if (arr.length === 0) return null;
    const totalDist = arr.reduce((s, w) => s + (w.distanceM ?? 0), 0);
    const totalSec = arr.reduce((s, w) => s + w.durationSec, 0);
    if (totalDist < 1000) return null;
    return totalSec / (totalDist / 1000);
  }
  const z2PaceRecent = avgPace(recent7);
  const z2PacePrev = avgPace(prev14);
  const z2Trend = z2PaceRecent !== null && z2PacePrev !== null ? z2PaceRecent - z2PacePrev : null;

  // Threshold-Pace = avgPace der Runs in Z3/Z4
  const tempoRuns = runs.filter((w) => {
    const z = classifyZone(w.avgHr, maxHr);
    return z === "Z3" || z === "Z4";
  });
  const thresholdPace = avgPace(tempoRuns);

  // Race-Forecast (falls aktives race-Goal)
  const raceGoal = (goalsQ.data?.goals ?? []).find((g) => g.type === "race");
  let raceForecast: { distanceKm: number; minutes: number; goalMinutes: number; gap: number } | null = null;
  if (raceGoal && thresholdPace !== null && raceGoal.targetValue !== null) {
    // HM = 21.1km. Bei 5km-TT andere Distanz. Annahme: race-Goal targetUnit = "min" und distance HM
    const distKm = 21.1; // TODO: könnte aus goal name parsed werden
    const estimateSec = thresholdPace * 1.08 * distKm; // 8% Slowdown vs Threshold für HM
    const estimateMin = estimateSec / 60;
    raceForecast = {
      distanceKm: distKm,
      minutes: estimateMin,
      goalMinutes: raceGoal.targetValue,
      gap: estimateMin - raceGoal.targetValue,
    };
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 font-semibold">
            <Footprints className="h-3.5 w-3.5 text-primary" /> Running-Profil
          </p>
          <span className="text-[10px] text-muted-foreground">Letzte 21d · {runs.length} Läufe</span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-muted/30 p-3 space-y-0.5">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Z2-Pace</p>
            <p className="text-base font-bold tabular-nums">
              {z2PaceRecent !== null ? paceFmt(z2PaceRecent) : "—"}
            </p>
            {z2Trend !== null && (
              <p className={cn(
                "text-[10px] tabular-nums flex items-center gap-1",
                z2Trend < -2 ? "text-emerald-300" : z2Trend > 2 ? "text-amber-300" : "text-muted-foreground",
              )}>
                {z2Trend < 0 ? <TrendingDown className="h-2.5 w-2.5" /> : <TrendingUp className="h-2.5 w-2.5" />}
                {Math.abs(z2Trend) < 60 ? `${z2Trend >= 0 ? "+" : ""}${z2Trend.toFixed(0)}s/km vs 7-14d` : ""}
              </p>
            )}
          </div>
          <div className="rounded-lg bg-muted/30 p-3 space-y-0.5">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Threshold-Pace</p>
            <p className="text-base font-bold tabular-nums">
              {thresholdPace !== null ? paceFmt(thresholdPace) : "—"}
            </p>
            <p className="text-[10px] text-muted-foreground">
              avg Z3/Z4 · {tempoRuns.length} Sessions
            </p>
          </div>
        </div>

        {raceForecast && (
          <div className={cn(
            "rounded-lg border p-3 space-y-1",
            raceForecast.gap <= 0 ? "border-emerald-500/30 bg-emerald-500/5" : "border-amber-500/30 bg-amber-500/5",
          )}>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Race-Forecast (21.1 km)</p>
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-xl font-bold tabular-nums">
                {Math.floor(raceForecast.minutes / 60)}:{String(Math.round(raceForecast.minutes % 60)).padStart(2, "0")}
              </p>
              <span className={cn(
                "text-xs font-bold tabular-nums",
                raceForecast.gap <= 0 ? "text-emerald-300" : "text-amber-300",
              )}>
                Ziel {Math.floor(raceForecast.goalMinutes / 60)}:{String(Math.round(raceForecast.goalMinutes % 60)).padStart(2, "0")}
                {raceForecast.gap !== 0 && ` (${raceForecast.gap > 0 ? "+" : ""}${Math.round(raceForecast.gap)}m)`}
              </span>
            </div>
          </div>
        )}

        {z2Runs.length < 3 && (
          <p className="text-[10px] text-muted-foreground italic">
            Noch zu wenige Z2-Läufe für stabile Schätzung. Min. 3 in 21d empfohlen.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
