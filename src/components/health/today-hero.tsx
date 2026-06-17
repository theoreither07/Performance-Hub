"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { addDays, format, parseISO, subDays } from "date-fns";
import { de } from "@/lib/i18n/date-locale";
import { ChevronLeft, ChevronRight, ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScoreRing } from "@/components/health/score-ring";
import { InsightTile } from "@/components/health/insight-tile";
import { buildInsight } from "@/lib/health/insights";
import { haptics } from "@/lib/ui/haptics";
import { cn } from "@/lib/utils/cn";

type Level = "recover" | "easy" | "moderate" | "hard";

interface DayScoreSlim {
  date: string;
  total: number;
  suggestion: { level: Level; headline: string; reason: string[] };
  waitingForGarmin?: boolean;
}

interface ScoreApiResponse {
  days: DayScoreSlim[];
}

interface MetricsResponse {
  metrics: Record<string, { date: string; value: number }[]>;
}

interface VitalityResponse {
  score: number;
  startScore: number;
  headline: string;
}

const LEVEL_LABEL: Record<Level, string> = {
  recover: "Recovery",
  easy: "Easy",
  moderate: "Moderat",
  hard: "Hart",
};

const LEVEL_BADGE: Record<Level, string> = {
  recover: "bg-blue-500/20 text-blue-300 border-blue-500/40",
  easy: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
  moderate: "bg-amber-500/20 text-amber-300 border-amber-500/40",
  hard: "bg-red-500/20 text-red-300 border-red-500/40",
};

const SWIPE_THRESHOLD = 60; // px horizontal

export function TodayHero() {
  const todayKey = format(new Date(), "yyyy-MM-dd");
  const [offsetDays, setOffsetDays] = React.useState(0); // 0 = heute, -1 = gestern, etc.
  const dayKey = format(subDays(new Date(), -offsetDays), "yyyy-MM-dd");
  const isToday = offsetDays === 0;
  const isPast = offsetDays < 0;

  const scoreQ = useQuery<ScoreApiResponse>({
    queryKey: ["health-score", 7],
    queryFn: async () => {
      const res = await fetch("/api/health/score?days=7");
      if (!res.ok) throw new Error("score");
      return res.json();
    },
    staleTime: 60_000,
  });
  const metricsQ = useQuery<MetricsResponse>({
    queryKey: ["health-metrics", 30],
    queryFn: async () => {
      const res = await fetch("/api/health/metrics?days=30");
      if (!res.ok) throw new Error("metrics");
      return res.json();
    },
    staleTime: 5 * 60_000,
  });

  const vitalityQ = useQuery<VitalityResponse>({
    queryKey: ["vitality"],
    queryFn: async () => {
      const res = await fetch("/api/health/vitality");
      if (!res.ok) throw new Error("vitality");
      return res.json();
    },
    staleTime: 5 * 60_000,
    refetchInterval: 10 * 60_000,
    enabled: isToday,
  });

  const score = scoreQ.data?.days.find((d) => d.date === dayKey)
    ?? (offsetDays === 0 ? scoreQ.data?.days[scoreQ.data.days.length - 1] : undefined);

  // Day-Swipe: touch handlers
  const touchStartX = React.useRef<number | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0]?.clientX ?? null;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current == null) return;
    const dx = (e.changedTouches[0]?.clientX ?? 0) - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(dx) < SWIPE_THRESHOLD) return;
    if (dx > 0) {
      // swipe rechts → vorheriger Tag (zurueck)
      setOffsetDays((d) => Math.max(-13, d - 1));
      haptics.tap();
    } else if (offsetDays < 0) {
      // swipe links → naechster Tag (vorwaerts), max heute
      setOffsetDays((d) => Math.min(0, d + 1));
      haptics.tap();
    }
  };

  // Insight-Tiles: HRV, Sleep, RHR, Stress
  const insights = React.useMemo(() => {
    if (!metricsQ.data) return null;
    const m = metricsQ.data.metrics;
    return {
      hrv: buildInsight("hrv_overnight", m.hrv_overnight ?? []),
      sleep: buildInsight("sleep_minutes", m.sleep_minutes ?? []),
      rhr: buildInsight("rhr", m.rhr ?? []),
      stress: buildInsight("stress_avg", m.stress_avg ?? []),
    };
  }, [metricsQ.data]);

  // Level → CTA
  const level = score?.suggestion?.level ?? "easy";
  const ctaHref = level === "recover" ? "/health" : "/health/wochenplan";
  const ctaLabel = score?.waitingForGarmin
    ? "Warten auf Garmin"
    : level === "recover"
    ? "Heute regenerieren"
    : level === "hard"
    ? "Jetzt loslegen"
    : "Plan ansehen";

  // Day-Picker-Label
  const dayLabel = isToday
    ? "Heute"
    : offsetDays === -1
    ? "Gestern"
    : format(parseISO(dayKey), "EEEE d. MMM", { locale: de });

  return (
    <Card
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      className="overflow-hidden touch-pan-y"
    >
      <CardContent className="p-5 sm:p-6">
        {/* Day-Navigation */}
        <div className="flex items-center justify-between mb-4">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => {
              setOffsetDays((d) => Math.max(-13, d - 1));
              haptics.tap();
            }}
            aria-label="Vorheriger Tag"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="flex flex-col items-center">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">
              {dayLabel}
            </span>
            {!isToday && (
              <button
                type="button"
                onClick={() => { setOffsetDays(0); haptics.tap(); }}
                className="text-[10px] text-primary hover:underline"
              >
                Zurueck zu Heute
              </button>
            )}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => {
              if (offsetDays < 0) {
                setOffsetDays((d) => Math.min(0, d + 1));
                haptics.tap();
              }
            }}
            disabled={isToday}
            aria-label="Naechster Tag"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {/* Hero-Section: Ring + Verdict + CTA */}
        {scoreQ.isLoading ? (
          <div className="flex flex-col sm:flex-row items-center gap-5">
            <Skeleton className="h-40 w-40 rounded-full" />
            <div className="flex-1 w-full space-y-3">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-7 w-3/4" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-9 w-32" />
            </div>
          </div>
        ) : score ? (
          <div className="flex flex-col sm:flex-row items-center sm:items-stretch gap-5">
            <div className="flex-shrink-0 flex items-center justify-center gap-3 sm:gap-4">
              <div className="flex flex-col items-center">
                <ScoreRing
                  value={score.waitingForGarmin ? 0 : score.total}
                  size={130}
                  stroke={10}
                  label="Bereitschaft"
                  pulse={!!score.waitingForGarmin}
                />
              </div>
              {isToday && vitalityQ.data && (
                <div className="flex flex-col items-center">
                  <ScoreRing
                    value={vitalityQ.data.score}
                    size={110}
                    stroke={9}
                    label="Vitality jetzt"
                  />
                  {vitalityQ.data.startScore !== vitalityQ.data.score && (
                    <span className="text-[10px] text-muted-foreground tabular-nums mt-0.5">
                      Start {vitalityQ.data.startScore} · jetzt {vitalityQ.data.score}
                    </span>
                  )}
                </div>
              )}
            </div>
            <div className="flex-1 flex flex-col justify-center text-center sm:text-left gap-2 min-w-0">
              <div className="flex items-center justify-center sm:justify-start gap-2 flex-wrap">
                <Badge className={cn("border", LEVEL_BADGE[level])}>
                  {LEVEL_LABEL[level]}
                </Badge>
                {score.waitingForGarmin && (
                  <Badge variant="outline" className="border-amber-500/40 text-amber-300">
                    Warte auf Sync
                  </Badge>
                )}
              </div>
              <p className="text-lg sm:text-xl font-semibold leading-tight">
                {score.suggestion.headline}
              </p>
              {score.suggestion.reason.length > 0 && (
                <p className="text-xs text-muted-foreground italic leading-snug">
                  {score.suggestion.reason[0]}
                </p>
              )}
              <div className="pt-2">
                <Button
                  asChild
                  size="sm"
                  className="w-full sm:w-auto"
                  disabled={!!score.waitingForGarmin}
                  onClick={() => haptics.tap()}
                >
                  <Link href={ctaHref}>
                    {ctaLabel} <ArrowRight className="h-4 w-4 ml-1.5" />
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center text-sm text-muted-foreground py-6">
            Kein Score fuer {dayLabel} verfuegbar.
          </div>
        )}

        {/* Insight-Tiles */}
        {insights && isToday && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-5">
            <InsightTile insight={insights.hrv} history={metricsQ.data?.metrics.hrv_overnight ?? []} />
            <InsightTile insight={insights.sleep} history={metricsQ.data?.metrics.sleep_minutes ?? []} />
            <InsightTile insight={insights.rhr} history={metricsQ.data?.metrics.rhr ?? []} />
            <InsightTile insight={insights.stress} history={metricsQ.data?.metrics.stress_avg ?? []} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
