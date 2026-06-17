"use client";

/**
 * Sleep-Insights Modal — Detail-Breakdown beim Klick auf Sleep-Tile.
 *
 * Zeigt:
 *  - Heute: Stunden + Score
 *  - 7d/28d Schnitt
 *  - Detection: weniger Tiefschlaf als Schnitt? Alk gestern im Journal?
 *  - Korrelation Sleep × Subjektiv (mood/energy am Folgetag)
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Moon, TrendingDown, TrendingUp, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface MetricSeries { date: string; value: number }
interface MetricsResponse { metrics: Record<string, MetricSeries[]> }
interface JournalResponse { items: Array<{ date: string; alcoholDrinks: number | null; mood: number | null; energy: number | null }> }

export function SleepInsightsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const metricsQ = useQuery<MetricsResponse>({
    queryKey: ["health-metrics", 30],
    queryFn: async () => {
      const res = await fetch("/api/health/metrics?days=30");
      if (!res.ok) throw new Error("m");
      return res.json();
    },
    staleTime: 5 * 60_000,
    enabled: open,
  });
  const journalQ = useQuery<JournalResponse>({
    queryKey: ["journal"],
    queryFn: async () => {
      const res = await fetch("/api/journal");
      if (!res.ok) throw new Error("j");
      return res.json();
    },
    staleTime: 5 * 60_000,
    enabled: open,
  });

  const sleepMins = metricsQ.data?.metrics.sleep_minutes ?? [];
  const sleepScores = metricsQ.data?.metrics.sleep_score ?? [];
  const todayMins = sleepMins[sleepMins.length - 1]?.value ?? null;
  const todayScore = sleepScores[sleepScores.length - 1]?.value ?? null;
  const avg7 = sleepMins.slice(-7).reduce((s, v) => s + v.value, 0) / Math.max(1, sleepMins.slice(-7).length);
  const avg28 = sleepMins.reduce((s, v) => s + v.value, 0) / Math.max(1, sleepMins.length);

  // Alk-Detection: gestern Journal alcoholDrinks > 0?
  const journal = journalQ.data?.items ?? [];
  const sortedJ = [...journal].sort((a, b) => b.date.localeCompare(a.date));
  const yesterdayAlk = sortedJ[1]?.alcoholDrinks ?? 0;

  // Korrelation: top 5 schlechte Schlaf-Tage → wie war Mood/Energy am Folgetag?
  const sortedSleep = [...sleepMins].sort((a, b) => a.value - b.value).slice(0, 5);
  const followupMood: number[] = [];
  for (const s of sortedSleep) {
    const next = sortedJ.find((j) => j.date > s.date);
    if (next?.mood !== null && next?.mood !== undefined) followupMood.push(next.mood);
  }
  const avgMoodAfterBadSleep = followupMood.length
    ? followupMood.reduce((s, v) => s + v, 0) / followupMood.length
    : null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Moon className="h-4 w-4 text-primary" /> Sleep-Analyse
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* Hauptzahlen */}
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-muted/30 p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Heute</p>
              <p className="text-xl font-black tabular-nums">
                {todayMins !== null ? `${Math.floor(todayMins / 60)}h ${Math.round(todayMins % 60)}m` : "—"}
              </p>
              <p className="text-[10px] text-muted-foreground">Score {todayScore ?? "—"}/100</p>
            </div>
            <div className="rounded-lg bg-muted/30 p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">28d Schnitt</p>
              <p className="text-xl font-black tabular-nums">
                {avg28 ? `${Math.floor(avg28 / 60)}h ${Math.round(avg28 % 60)}m` : "—"}
              </p>
              <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                7d: {avg7 ? `${Math.floor(avg7 / 60)}h ${Math.round(avg7 % 60)}m` : "—"}
                {todayMins && avg28 && (
                  todayMins > avg28 ? <TrendingUp className="h-2.5 w-2.5 text-emerald-300" /> : <TrendingDown className="h-2.5 w-2.5 text-amber-300" />
                )}
              </p>
            </div>
          </div>

          {/* Insights */}
          <div className="space-y-2">
            {yesterdayAlk > 0 && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 flex items-start gap-2 text-xs">
                <AlertCircle className="h-3.5 w-3.5 text-amber-300 shrink-0 mt-0.5" />
                <p className="text-foreground/90">
                  <span className="font-bold">Gestern {yesterdayAlk} Drink{yesterdayAlk === 1 ? "" : "s"} im Journal.</span>{" "}
                  Erwarte ~−15-20 % Tiefschlaf & ~−10 % HRV.
                </p>
              </div>
            )}
            {todayMins !== null && todayMins < avg28 - 30 && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 flex items-start gap-2 text-xs">
                <AlertCircle className="h-3.5 w-3.5 text-red-300 shrink-0 mt-0.5" />
                <p className="text-foreground/90">
                  <span className="font-bold">{Math.round((avg28 - todayMins) / 60 * 100) / 100}h unter Schnitt.</span>{" "}
                  Coach wird heute hartes Training um -1 reduzieren.
                </p>
              </div>
            )}
            {avgMoodAfterBadSleep !== null && (
              <div className="rounded-lg border border-border/30 p-3 text-xs">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Korrelation</p>
                <p className="text-foreground/90">
                  Nach deinen 5 schlechtesten Schlaf-Nächten war dein Mood am Folgetag im Schnitt{" "}
                  <span className="font-bold tabular-nums">{avgMoodAfterBadSleep.toFixed(1)}/10</span>.
                </p>
              </div>
            )}
          </div>

          {/* Mini-Heatmap der letzten 28 Tage */}
          <div className="space-y-1.5">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Verlauf 28d (Dunkel = lang)</p>
            <div className="flex gap-[2px]">
              {sleepMins.slice(-28).map((s) => {
                const intensity = s.value / 600; // 0..1 (10h = max)
                return (
                  <div
                    key={s.date}
                    title={`${s.date}: ${Math.floor(s.value / 60)}h ${Math.round(s.value % 60)}m`}
                    className={cn("h-6 flex-1 min-w-[6px] rounded-[2px]")}
                    style={{ backgroundColor: `rgba(56, 189, 248, ${Math.min(0.9, intensity)})` }}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
