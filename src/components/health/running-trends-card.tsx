"use client";

/**
 * Laeufe-Trends — 90-Tage-Gesamtuebersicht ueber alle Laeufe (nicht nur Z1/Z2
 * wie PaceHrTrendCard): Pace-Verlauf, woechentliches Distanz-Volumen, Puls-Trend.
 * Ergaenzt PaceHrTrendCard (Laufoekonomie-Frage), beantwortet die Volumen-/
 * Ueberblicksfrage.
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Route } from "lucide-react";
import { format, parseISO, startOfWeek } from "date-fns";
import { de } from "@/lib/i18n/date-locale";
import { TrendChart, BarChart, PRIMARY_SERIES_COLOR, CATEGORICAL_PALETTE } from "@/components/charts";

interface Workout {
  date: string;
  type: string;
  durationSec: number;
  distanceM: number | null;
  avgHr: number | null;
}
interface WorkoutsResponse { workouts: Workout[] }

const HR_COLOR = CATEGORICAL_PALETTE[5];

function paceFmt(secondsPerKm: number): string {
  const m = Math.floor(secondsPerKm / 60);
  const s = Math.round(secondsPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")}/km`;
}

export function RunningTrendsCard() {
  const workoutsQ = useQuery<WorkoutsResponse>({
    queryKey: ["workouts-running", 90],
    queryFn: async () => {
      const res = await fetch("/api/workouts?days=90&type=running");
      if (!res.ok) throw new Error("w");
      return res.json();
    },
    staleTime: 5 * 60_000,
  });

  const runs = (workoutsQ.data?.workouts ?? [])
    .filter((w) => w.type === "running" && (w.distanceM ?? 0) > 500 && w.durationSec > 120)
    .sort((a, b) => a.date.localeCompare(b.date));

  const pacePoints = runs
    .filter((w) => w.distanceM)
    .map((w) => ({ date: w.date, paceSecKm: w.durationSec / ((w.distanceM as number) / 1000) }));

  const hrPoints = runs
    .filter((w) => w.avgHr !== null)
    .map((w) => ({ date: w.date, hr: w.avgHr as number }));

  const weeklyVolume = (() => {
    const byWeek = new Map<string, number>();
    for (const w of runs) {
      const weekStart = format(startOfWeek(parseISO(w.date), { weekStartsOn: 1 }), "yyyy-MM-dd");
      byWeek.set(weekStart, (byWeek.get(weekStart) ?? 0) + (w.distanceM ?? 0) / 1000);
    }
    return Array.from(byWeek.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([week, km]) => ({ week, km: Math.round(km * 10) / 10 }));
  })();

  const hasData = runs.length >= 3;

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 font-semibold">
            <Route className="h-3.5 w-3.5 text-primary" /> Läufe — 90 Tage
          </p>
          <span className="text-[10px] text-muted-foreground">{runs.length} Läufe</span>
        </div>

        {hasData ? (
          <>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Pace-Verlauf</p>
              <TrendChart
                data={pacePoints}
                series={[{ key: "paceSecKm", label: "Pace", color: PRIMARY_SERIES_COLOR }]}
                xKey="date"
                height={130}
                reverseY
                yTickFormatter={(v) => paceFmt(v)}
                valueFormatter={(v) => paceFmt(v)}
                xTickFormatter={(d) => format(parseISO(d), "d.M.", { locale: de })}
              />
            </div>

            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Wöchentliches Volumen</p>
              <BarChart
                data={weeklyVolume}
                series={[{ key: "km", label: "km/Woche", color: PRIMARY_SERIES_COLOR }]}
                xKey="week"
                height={130}
                unit=" km"
                xTickFormatter={(d) => format(parseISO(d), "d.M.", { locale: de })}
              />
            </div>

            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Puls-Trend</p>
              <TrendChart
                data={hrPoints}
                series={[{ key: "hr", label: "Puls", color: HR_COLOR }]}
                xKey="date"
                height={130}
                unit=" bpm"
                xTickFormatter={(d) => format(parseISO(d), "d.M.", { locale: de })}
              />
            </div>
          </>
        ) : (
          <p className="text-[10px] text-muted-foreground italic">
            Noch zu wenige Läufe in den letzten 90 Tagen fuer einen Trend.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
