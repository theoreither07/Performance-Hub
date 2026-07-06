"use client";

/**
 * Kalorienbilanz — Kalorien rein (MyFitnessPal-Sync, mfp-sync/) vs. Kalorien raus
 * (Garmin "calories"-Metrik, Tages-TDEE) als Trend + aktuellster Tages-Snapshot.
 * Dual-Linie im gleichen SVG-Stil wie die uebrigen Sparklines/Trend-Cards.
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Flame } from "lucide-react";
import { format, parseISO } from "date-fns";
import { de } from "@/lib/i18n/date-locale";
import { cn } from "@/lib/utils/cn";

interface NutritionDay {
  date: string;
  caloriesIn: number | null;
  caloriesOut: number | null;
  balance: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
}
interface NutritionResponse { days: NutritionDay[] }

const IN_COLOR = "#FDBA74"; // amber-300 — Kalorien rein
const OUT_COLOR = "#AAFF00"; // primary — Kalorien raus

export function CalorieBalanceCard() {
  const q = useQuery<NutritionResponse>({
    queryKey: ["nutrition-balance", 30],
    queryFn: async () => {
      const res = await fetch("/api/health/nutrition?days=30");
      if (!res.ok) throw new Error("nutrition");
      return res.json();
    },
    staleTime: 5 * 60_000,
  });

  const days = q.data?.days ?? [];
  const withBoth = days.filter((d) => d.caloriesIn !== null && d.caloriesOut !== null);
  const latest = withBoth[withBoth.length - 1] ?? null;

  const chart = (() => {
    if (withBoth.length < 3) return null;
    const W = 600, H = 90;
    const all = withBoth.flatMap((d) => [d.caloriesIn as number, d.caloriesOut as number]);
    const min = Math.min(...all), max = Math.max(...all);
    const range = max - min || 1;
    const y = (v: number) => H - ((v - min) / range) * (H - 4) - 2;
    const x = (i: number) => (i / (withBoth.length - 1)) * W;

    const inPts = withBoth.map((d, i) => `${x(i)},${y(d.caloriesIn as number)}`).join(" ");
    const outPts = withBoth.map((d, i) => `${x(i)},${y(d.caloriesOut as number)}`).join(" ");

    return (
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-24">
        <polyline points={outPts} fill="none" stroke={OUT_COLOR} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
        <polyline points={inPts} fill="none" stroke={IN_COLOR} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
        {withBoth.map((d, i) => <circle key={`out-${i}`} cx={x(i)} cy={y(d.caloriesOut as number)} r={1.5} fill={OUT_COLOR} />)}
        {withBoth.map((d, i) => <circle key={`in-${i}`} cx={x(i)} cy={y(d.caloriesIn as number)} r={1.5} fill={IN_COLOR} />)}
      </svg>
    );
  })();

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 font-semibold">
            <Flame className="h-3.5 w-3.5 text-primary" /> Kalorienbilanz
          </p>
          <span className="text-[10px] text-muted-foreground">30d · MyFitnessPal</span>
        </div>

        {latest ? (
          <>
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-lg bg-muted/30 p-3 space-y-0.5">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Rein</p>
                <p className="text-base font-bold tabular-nums">{Math.round(latest.caloriesIn as number)}</p>
              </div>
              <div className="rounded-lg bg-muted/30 p-3 space-y-0.5">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Raus</p>
                <p className="text-base font-bold tabular-nums">{Math.round(latest.caloriesOut as number)}</p>
              </div>
              <div className="rounded-lg bg-muted/30 p-3 space-y-0.5">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Bilanz</p>
                <p className={cn(
                  "text-base font-bold tabular-nums",
                  (latest.balance ?? 0) < -100 ? "text-emerald-300" : (latest.balance ?? 0) > 100 ? "text-amber-300" : "text-muted-foreground",
                )}>
                  {(latest.balance ?? 0) >= 0 ? "+" : ""}{Math.round(latest.balance ?? 0)}
                </p>
              </div>
            </div>

            {(latest.protein !== null || latest.carbs !== null || latest.fat !== null) && (
              <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                {latest.protein !== null && <span>P {Math.round(latest.protein)}g</span>}
                {latest.carbs !== null && <span>C {Math.round(latest.carbs)}g</span>}
                {latest.fat !== null && <span>F {Math.round(latest.fat)}g</span>}
              </div>
            )}

            {chart && (
              <>
                {chart}
                <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: IN_COLOR }} /> Rein
                  </span>
                  <span>{format(parseISO(withBoth[0].date), "d. MMM", { locale: de })} – {format(parseISO(withBoth[withBoth.length - 1].date), "d. MMM", { locale: de })}</span>
                  <span className="flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: OUT_COLOR }} /> Raus
                  </span>
                </div>
              </>
            )}
            <p className="text-[10px] text-muted-foreground">
              Letzter Sync: {format(parseISO(latest.date), "d. MMM", { locale: de })}
            </p>
          </>
        ) : (
          <p className="text-[10px] text-muted-foreground italic">
            Noch keine MyFitnessPal-Daten. Einmalig <code>MFP_USERNAME</code>/<code>MFP_PASSWORD</code> in <code>.env</code> setzen und <code>python mfp-sync/sync.py</code> ausfuehren.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
