"use client";

/**
 * Periodisierungs-Card im Health/Plan-Tab.
 * Zeigt:
 *  - Aktuelle Race-Phase (base/build/peak/sharpen/taper/race-week)
 *  - Wochen bis Race-Datum
 *  - Mesozyklus-Position (Woche 1-4)
 *  - Empfohlene Cardio-Distribution + Strength-Block
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar, Dumbbell, Layers, Target } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface PeriodizationResponse {
  periodization: {
    phase: string;
    phaseLabel: string;
    longLabel: string;
    weeksUntilRace: number | null;
    raceName: string | null;
    raceDate: string | null;
    focusKeywords: string[];
  } | null;
  mesocycle: {
    weekInCycle: number;
    cycleIndex: number;
    type: string;
    headline: string;
    coachInsight: string;
  };
  cardioDistribution: {
    type: string;
    zoneSplit: { z1z2: number; z3: number; z4z5: number };
    description: string;
  };
  strengthBlock: {
    block: string;
    reps: string;
    sets: { min: number; max: number };
    intensity: string;
    rpe: string;
    focus: string;
  };
}

const PHASE_COLOR: Record<string, string> = {
  base: "bg-blue-500/20 text-blue-300 border-blue-500/40",
  build: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
  peak: "bg-red-500/20 text-red-300 border-red-500/40",
  sharpen: "bg-amber-500/20 text-amber-300 border-amber-500/40",
  taper: "bg-violet-500/20 text-violet-300 border-violet-500/40",
  "race-week": "bg-primary/30 text-primary border-primary/60",
  "post-race": "bg-sky-500/20 text-sky-300 border-sky-500/40",
  "out-of-range": "bg-muted/40 text-muted-foreground border-muted/60",
};

const MESO_COLOR: Record<string, string> = {
  build: "bg-emerald-500/15 text-emerald-300",
  peak: "bg-red-500/15 text-red-300",
  deload: "bg-blue-500/15 text-blue-300",
};

export function PeriodizationCard() {
  const q = useQuery<PeriodizationResponse>({
    queryKey: ["periodization"],
    queryFn: async () => {
      const res = await fetch("/api/coach/periodization");
      if (!res.ok) throw new Error("periodization");
      return res.json();
    },
    staleTime: 30 * 60_000,
  });

  if (q.isLoading || !q.data) return null;
  const p = q.data;

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <p className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 font-semibold">
          <Target className="h-3.5 w-3.5 text-primary" /> Periodisierung
        </p>

        {/* Race-Phase */}
        {p.periodization && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge className={cn("border text-xs uppercase tracking-wider font-bold", PHASE_COLOR[p.periodization.phase])}>
                {p.periodization.phaseLabel}
              </Badge>
              {p.periodization.raceName && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  {p.periodization.raceName}{" "}
                  {p.periodization.weeksUntilRace !== null && (
                    <span className="tabular-nums">· {p.periodization.weeksUntilRace}w weg</span>
                  )}
                </span>
              )}
            </div>
            <p className="text-xs text-foreground/90 leading-snug">{p.periodization.longLabel}</p>
            {p.periodization.focusKeywords.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {p.periodization.focusKeywords.map((k) => (
                  <Badge key={k} variant="outline" className="text-[10px]">{k}</Badge>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Mesozyklus */}
        <div className="space-y-1 border-t border-border/30 pt-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1">
              <Layers className="h-3 w-3 text-primary" /> Mesozyklus
            </span>
            <Badge className={cn("text-[10px]", MESO_COLOR[p.mesocycle.type])}>
              {p.mesocycle.headline}
            </Badge>
          </div>
          <p className="text-[11px] text-muted-foreground italic leading-snug">{p.mesocycle.coachInsight}</p>
        </div>

        {/* Cardio + Strength */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 border-t border-border/30 pt-2">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">
              Cardio diese Woche
            </p>
            <p className="text-xs font-bold capitalize">{p.cardioDistribution.type}</p>
            <p className="text-[10px] text-muted-foreground tabular-nums">
              {p.cardioDistribution.zoneSplit.z1z2}% Z1-Z2 · {p.cardioDistribution.zoneSplit.z3}% Z3 · {p.cardioDistribution.zoneSplit.z4z5}% Z4-Z5
            </p>
            <p className="text-[10px] text-muted-foreground italic mt-0.5 leading-snug">{p.cardioDistribution.description}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1 flex items-center gap-1">
              <Dumbbell className="h-3 w-3" /> Strength-Block
            </p>
            <p className="text-xs font-bold capitalize">{p.strengthBlock.block}</p>
            <p className="text-[10px] text-muted-foreground tabular-nums">
              {p.strengthBlock.reps} reps · {p.strengthBlock.sets.min}-{p.strengthBlock.sets.max} sets · {p.strengthBlock.intensity}
            </p>
            <p className="text-[10px] text-muted-foreground italic mt-0.5 leading-snug">{p.strengthBlock.focus}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
