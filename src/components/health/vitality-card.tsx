"use client";

/**
 * Live-Vitality-Card — aktueller Zustand-Score über den Tag.
 * Ergänzt den morgens-Bereitschafts-Score: das hier ist das LIVE-Update.
 *
 * Zeigt:
 *  - Score-Ring (0-100) + Headline ("Voll im Saft" / "Tank fast leer")
 *  - Stundenverlauf seit 06:00 als Sparkline
 *  - Faktor-Breakdown (klappbar): Was hat den Score wohin verschoben?
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils/cn";
import { Card, CardContent } from "@/components/ui/card";
import { ScoreRing } from "@/components/health/score-ring";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity, ChevronDown, Sparkles, TrendingDown, TrendingUp } from "lucide-react";

interface VitalityFactor {
  key: string;
  label: string;
  delta: number;
  tone: "positive" | "negative" | "neutral";
  detail: string;
}

interface VitalityResponse {
  date: string;
  score: number;
  startScore: number;
  headline: string;
  factors: VitalityFactor[];
  hourly: Array<{ hour: number; score: number }>;
  yesterdayEndVitality: number | null;
}

const TONE_COLOR: Record<VitalityFactor["tone"], string> = {
  positive: "text-emerald-300",
  negative: "text-red-300",
  neutral: "text-muted-foreground",
};

function sparklinePath(hourly: Array<{ hour: number; score: number }>, w = 200, h = 40): string {
  if (hourly.length < 2) return "";
  const min = Math.min(...hourly.map((p) => p.score), 0);
  const max = Math.max(...hourly.map((p) => p.score), 100);
  const range = Math.max(1, max - min);
  return hourly
    .map((p, i) => {
      const x = (i / (hourly.length - 1)) * w;
      const y = h - ((p.score - min) / range) * (h - 6) - 3;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export function VitalityCard() {
  const q = useQuery<VitalityResponse>({
    queryKey: ["vitality"],
    queryFn: async () => {
      const res = await fetch("/api/health/vitality");
      if (!res.ok) throw new Error("vitality");
      return res.json();
    },
    staleTime: 5 * 60_000,
    refetchInterval: 10 * 60_000, // alle 10 min frisch
  });

  const [factorsOpen, setFactorsOpen] = React.useState(false);

  if (q.isLoading) {
    return (
      <Card>
        <CardContent className="p-5 flex gap-4 items-center">
          <Skeleton className="h-28 w-28 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-2 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (q.isError || !q.data) {
    return null;
  }

  const v = q.data;
  const delta = v.score - v.startScore;
  const path = sparklinePath(v.hourly, 200, 40);

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-5 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 font-semibold">
            <Sparkles className="h-3.5 w-3.5 text-primary" /> Live Vitality
          </p>
          <span className="text-[10px] text-muted-foreground tabular-nums">jetzt</span>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <ScoreRing value={v.score} size={120} stroke={10} label="aktuell" />
          <div className="flex-1 min-w-0 space-y-2">
            <p className="text-base font-semibold leading-snug">{v.headline}</p>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Start heute Morgen: <span className="tabular-nums text-foreground">{v.startScore}</span></span>
              <span className={cn("font-bold tabular-nums flex items-center gap-0.5", delta < -5 ? "text-red-300" : delta > 5 ? "text-emerald-300" : "text-muted-foreground")}>
                {delta > 0 ? <TrendingUp className="h-3 w-3" /> : delta < 0 ? <TrendingDown className="h-3 w-3" /> : null}
                {delta > 0 ? "+" : ""}{delta}
              </span>
            </div>
            {path && (
              <svg viewBox="0 0 200 40" className="w-full h-10">
                <path d={path} fill="none" strokeWidth={2} className="stroke-primary/70" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
            {v.yesterdayEndVitality !== null && (
              <p className="text-[10px] text-muted-foreground italic">
                Gestern Abend: <span className="tabular-nums text-foreground/80">{v.yesterdayEndVitality}/100</span> → fließt heute morgens als Carry-Over rein.
              </p>
            )}
          </div>
        </div>

        {/* Faktor-Breakdown klappbar */}
        {v.factors.length > 0 && (
          <details className="group border-t border-border/30 pt-2 -mx-1" open={factorsOpen}>
            <summary
              onClick={(e) => { e.preventDefault(); setFactorsOpen(!factorsOpen); }}
              className="cursor-pointer list-none flex items-center justify-between gap-2 px-1 py-1 hover:bg-muted/10 rounded select-none"
            >
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1.5">
                <Activity className="h-3 w-3" /> Was den Score bewegt ({v.factors.length})
              </span>
              <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", factorsOpen && "rotate-180")} />
            </summary>
            <ul className="space-y-1 pt-2 px-1">
              {v.factors.map((f) => (
                <li key={f.key} className="flex items-baseline gap-2 text-xs">
                  <span className={cn("font-bold tabular-nums w-9 text-right shrink-0", TONE_COLOR[f.tone])}>
                    {f.delta > 0 ? "+" : ""}{f.delta}
                  </span>
                  <div className="min-w-0 flex-1">
                    <span className="font-medium text-foreground">{f.label}</span>
                    <span className="text-muted-foreground"> · {f.detail}</span>
                  </div>
                </li>
              ))}
            </ul>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
