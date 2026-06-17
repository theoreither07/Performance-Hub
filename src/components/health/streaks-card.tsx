"use client";

/**
 * Streaks-Card mit Mini-Heatmap. GitHub-Style.
 *
 * Pro Streak: aktuelle Streak-Zahl + Best + 30-Tage-Rate + 30 kleine Squares
 * (grün = hit, leer = miss). Hover (Title) zeigt Datum.
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Flame, Trophy } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface StreakDay { date: string; hit: boolean }
interface StreakSummary {
  key: string;
  label: string;
  description: string;
  days: StreakDay[];
  current: number;
  best: number;
  rate30d: number;
}
interface StreaksResponse { streaks: StreakSummary[] }

export function StreaksCard() {
  const q = useQuery<StreaksResponse>({
    queryKey: ["health-streaks"],
    queryFn: async () => {
      const res = await fetch("/api/health/streaks");
      if (!res.ok) throw new Error("streaks");
      return res.json();
    },
    staleTime: 5 * 60_000,
  });

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 font-semibold">
            <Flame className="h-3.5 w-3.5 text-primary" /> Streaks &amp; Routinen
          </p>
          <p className="text-[10px] text-muted-foreground">Letzte 30 Tage</p>
        </div>

        {q.isLoading ? (
          <p className="text-xs text-muted-foreground">Lade Streaks...</p>
        ) : (
          <div className="space-y-2.5">
            {(q.data?.streaks ?? []).map((s) => (
              <StreakRow key={s.key} streak={s} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StreakRow({ streak }: { streak: StreakSummary }) {
  const ratePct = Math.round(streak.rate30d * 100);
  const hot = streak.current >= 7;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="flex items-center gap-1.5 min-w-0">
          <span className="font-medium text-foreground truncate" title={streak.description}>{streak.label}</span>
        </span>
        <div className="flex items-center gap-2 shrink-0">
          <span className={cn(
            "tabular-nums font-bold flex items-center gap-0.5",
            hot ? "text-amber-300" : streak.current > 0 ? "text-emerald-300" : "text-muted-foreground",
          )}>
            {hot && <Flame className="h-3 w-3" />}
            {streak.current}d
          </span>
          {streak.best > streak.current && streak.best > 0 && (
            <span className="text-muted-foreground text-[10px] flex items-center gap-0.5" title="Best Streak">
              <Trophy className="h-2.5 w-2.5" /> {streak.best}
            </span>
          )}
          <span className="text-muted-foreground tabular-nums">{ratePct}%</span>
        </div>
      </div>
      <div className="flex gap-[2px]">
        {streak.days.map((d) => (
          <div
            key={d.date}
            title={`${d.date} — ${d.hit ? "ok" : "nope"}`}
            className={cn(
              "h-3 flex-1 min-w-[6px] rounded-[2px]",
              d.hit ? "bg-emerald-500/70" : "bg-muted/30",
            )}
          />
        ))}
      </div>
    </div>
  );
}
