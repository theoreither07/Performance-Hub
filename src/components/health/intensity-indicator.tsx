"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Dumbbell, Activity, Info } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface Reco {
  strengthIntensity: number | null;
  cardioIntensity: number | null;
  intensityReason: string | null;
}

function levelLabel(n: number): string {
  if (n === 0) return "Pause";
  if (n <= 3) return "Leicht";
  if (n <= 6) return "Moderat";
  if (n <= 8) return "Hart";
  return "Maximum";
}

function levelColor(n: number): string {
  if (n === 0) return "text-blue-300";
  if (n <= 3) return "text-emerald-300";
  if (n <= 6) return "text-amber-300";
  if (n <= 8) return "text-orange-300";
  return "text-red-300";
}

function ringColor(n: number): string {
  if (n === 0) return "stroke-blue-400";
  if (n <= 3) return "stroke-emerald-400";
  if (n <= 6) return "stroke-amber-400";
  if (n <= 8) return "stroke-orange-400";
  return "stroke-red-400";
}

function IntensityGauge({ value, label, icon: Icon }: {
  value: number;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  const radius = 36;
  const circ = 2 * Math.PI * radius;
  const pct = value / 10;
  const offset = circ - pct * circ;
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative h-24 w-24">
        <svg className="-rotate-90" viewBox="0 0 84 84" width="96" height="96">
          <circle cx="42" cy="42" r={radius} strokeWidth="7" fill="none" className="stroke-muted/30" />
          <circle
            cx="42"
            cy="42"
            r={radius}
            strokeWidth="7"
            fill="none"
            strokeDasharray={circ}
            strokeDashoffset={offset}
            strokeLinecap="round"
            className={ringColor(value)}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <p className={cn("text-2xl font-bold leading-none tabular-nums", levelColor(value))}>
            {value.toFixed(value % 1 === 0 ? 0 : 1)}
          </p>
          <p className="text-[9px] text-muted-foreground mt-0.5">/ 10</p>
        </div>
      </div>
      <div className="text-center">
        <p className="flex items-center justify-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
          <Icon className="h-3 w-3" />
          {label}
        </p>
        <p className={cn("text-sm font-semibold mt-0.5", levelColor(value))}>{levelLabel(value)}</p>
      </div>
    </div>
  );
}

export function IntensityIndicator() {
  const { data, isLoading } = useQuery<{ recommendation: Reco | null }>({
    queryKey: ["coach-recommendation"],
    queryFn: async () => {
      const res = await fetch("/api/coach/generate");
      if (!res.ok) throw new Error("reco");
      return res.json();
    },
    staleTime: 5 * 60_000,
  });

  if (isLoading || !data?.recommendation) return null;
  const r = data.recommendation;
  if (r.strengthIntensity === null && r.cardioIntensity === null) return null;

  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center gap-2 mb-4">
          <Info className="h-4 w-4 text-primary" />
          <p className="text-xs uppercase tracking-wider font-medium text-muted-foreground">Heute vorgeschlagene Intensitaet</p>
        </div>
        <div className="grid grid-cols-2 gap-6">
          {r.strengthIntensity !== null && (
            <IntensityGauge value={r.strengthIntensity} label="Kraft" icon={Dumbbell} />
          )}
          {r.cardioIntensity !== null && (
            <IntensityGauge value={r.cardioIntensity} label="Cardio / Lauf" icon={Activity} />
          )}
        </div>
        {r.intensityReason && (
          <p className="text-xs text-muted-foreground mt-4 pt-4 border-t border-border/30 italic">
            {r.intensityReason}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
