"use client";

/**
 * Pace-vs-Puls-Trend — zeigt Laufoekonomie ueber Zeit: bei vergleichbarer
 * Anstrengung (Z1/Z2, HF < 81% MaxHF) sollte die Pace mit der Zeit schneller
 * werden bzw. die HF bei gleichem Tempo sinken.
 *
 * Zwei gestapelte Charts mit eigener (echter) Achse je Groesse, synchronisiert
 * per syncId fuer gemeinsames Hover/Crosshair — kein Dual-Axis-Overlay mehr:
 * Pace (min:km) und Puls (bpm) sind beide Werte, die ein Laeufer absolut lesen
 * will (Renn-Pacing, HF-Zonen-Bewusstsein), Indexieren auf eine gemeinsame
 * Basis wuerde genau diese Information wegwerfen.
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Activity } from "lucide-react";
import { format, parseISO } from "date-fns";
import { de } from "@/lib/i18n/date-locale";
import { TrendChart, PRIMARY_SERIES_COLOR, CATEGORICAL_PALETTE } from "@/components/charts";

interface Workout {
  date: string;
  type: string;
  durationSec: number;
  distanceM: number | null;
  avgHr: number | null;
}
interface WorkoutsResponse { workouts: Workout[] }
interface ProfileResponse { maxHr?: number | null }

const HR_COLOR = CATEGORICAL_PALETTE[5]; // red — distinct from the lime pace line

function paceFmt(secondsPerKm: number): string {
  const m = Math.floor(secondsPerKm / 60);
  const s = Math.round(secondsPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")}/km`;
}

export function PaceHrTrendCard() {
  const workoutsQ = useQuery<WorkoutsResponse>({
    queryKey: ["workouts-running", 60],
    queryFn: async () => {
      const res = await fetch("/api/workouts?days=60&type=running");
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

  const maxHr = profileQ.data?.maxHr ?? 190;

  const points = (workoutsQ.data?.workouts ?? [])
    .filter((w) => w.type === "running" && (w.distanceM ?? 0) > 1500 && w.durationSec > 600 && w.avgHr !== null)
    .filter((w) => (w.avgHr as number) / maxHr < 0.81) // nur Z1/Z2 — sonst verzerrt Anstrengung den Vergleich
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((w) => ({
      date: w.date,
      paceSecKm: w.durationSec / ((w.distanceM as number) / 1000),
      hr: w.avgHr as number,
    }));

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 font-semibold">
            <Activity className="h-3.5 w-3.5 text-primary" /> Pace vs. Puls
          </p>
          <span className="text-[10px] text-muted-foreground">60d · Z1/Z2 · {points.length} Läufe</span>
        </div>

        {points.length >= 3 ? (
          <>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Pace (min/km)</p>
              <TrendChart
                data={points}
                series={[{ key: "paceSecKm", label: "Pace", color: PRIMARY_SERIES_COLOR }]}
                xKey="date"
                syncId="pace-hr"
                height={110}
                reverseY
                hideXAxisLabels
                yTickFormatter={(v) => paceFmt(v)}
                valueFormatter={(v) => paceFmt(v)}
                xTickFormatter={(d) => format(parseISO(d), "d.M.", { locale: de })}
              />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Puls (bpm)</p>
              <TrendChart
                data={points}
                series={[{ key: "hr", label: "Puls", color: HR_COLOR }]}
                xKey="date"
                syncId="pace-hr"
                height={110}
                unit=" bpm"
                xTickFormatter={(d) => format(parseISO(d), "d.M.", { locale: de })}
              />
            </div>
            <p className="text-[10px] text-muted-foreground">
              {format(parseISO(points[0].date), "d. MMM", { locale: de })} – {format(parseISO(points[points.length - 1].date), "d. MMM", { locale: de })}
              {" · "}Pace {paceFmt(points[0].paceSecKm)} → {paceFmt(points[points.length - 1].paceSecKm)}
              {" · "}Puls {points[0].hr.toFixed(0)} → {points[points.length - 1].hr.toFixed(0)} bpm
            </p>
          </>
        ) : (
          <p className="text-[10px] text-muted-foreground italic">
            Noch zu wenige lockere Läufe (Z1/Z2, HF unter 81% MaxHF) für einen Trend. Min. 3 in 60 Tagen nötig.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
