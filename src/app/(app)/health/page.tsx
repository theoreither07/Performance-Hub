"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addDays, format, parseISO, subDays } from "date-fns";
import { de } from "@/lib/i18n/date-locale";
import { TodayHero } from "@/components/health/today-hero";
import { TodayMetrics } from "@/components/health/today-metrics";
import { WorkoutsList } from "@/components/health/workouts-list";
import { JournalForm } from "@/components/health/journal-form";
import { WeeklyInsights } from "@/components/health/weekly-insights";
import { CoachCard } from "@/components/health/coach-card";
import { DailyGoalsCard } from "@/components/health/daily-goals-card";
import { WeeklyPlanCard } from "@/components/health/weekly-plan-card";
import { ManualWorkoutDialog } from "@/components/health/manual-workout-dialog";
import { FoodVoiceCard } from "@/components/health/food-voice-card";
import { CalorieBalanceCard } from "@/components/health/calorie-balance-card";
import { LongTermGoalsCard } from "@/components/health/long-term-goals-card";
import { TrainingsTodayCard } from "@/components/health/trainings-today-card";
import { WeightCard } from "@/components/health/weight-card";
import { StreaksCard } from "@/components/health/streaks-card";
import { MorningRitualCard } from "@/components/health/morning-ritual-card";
import { VitalityCard } from "@/components/health/vitality-card";
import { PeriodizationCard } from "@/components/health/periodization-card";
import { PacePredictorCard } from "@/components/health/pace-predictor-card";
import { PaceHrTrendCard } from "@/components/health/pace-hr-trend-card";
import { RunningTrendsCard } from "@/components/health/running-trends-card";
import { HealthTabs, HealthTabsDesktop, type HealthTab } from "@/components/health/health-tabs";
import { SyncFab } from "@/components/health/sync-fab";
import { Skeleton, SkeletonCard } from "@/components/ui/skeleton";
import { usePullRefresh } from "@/hooks/use-pull-refresh";
import { useToast } from "@/components/ui/toast";
import { haptics } from "@/lib/ui/haptics";
import { ChevronLeft, ChevronRight, NotebookPen, Plus, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { PageHeader } from "@/components/layout/page-header";
import { TrendChart, PRIMARY_SERIES_COLOR } from "@/components/charts";

interface HealthResponse {
  metrics: Record<string, { date: string; value: number; meta: unknown }[]>;
  lastSync: {
    startedAt: string;
    finishedAt: string | null;
    success: boolean;
    metricsWritten: number;
    error: string | null;
  } | null;
}

const KIND_LABELS: Record<string, string> = {
  hrv_overnight: "HRV (nachts, ms)",
  sleep_minutes: "Schlaf (min)",
  sleep_score: "Schlaf-Score",
  body_battery_high: "Body Battery Max",
  body_battery_low: "Body Battery Min",
  rhr: "Resting HR (bpm)",
  vo2max: "VO2max",
  stress_avg: "Stress (avg)",
  steps: "Schritte",
  calories: "Kalorien",
  training_readiness: "Training Readiness",
};

function dayLabel(date: Date): string {
  const today = format(new Date(), "yyyy-MM-dd");
  const yesterday = format(subDays(new Date(), 1), "yyyy-MM-dd");
  const key = format(date, "yyyy-MM-dd");
  if (key === today) return "Heute";
  if (key === yesterday) return "Gestern";
  return format(date, "EEEE, d. MMM", { locale: de });
}

function isHealthTab(v: string | null): v is HealthTab {
  return v === "heute" || v === "trends" || v === "plan" || v === "profil";
}

export default function HealthPage() {
  // Next 15 verlangt Suspense um useSearchParams() — sonst bailout-Fehler bei Static-Gen
  return (
    <React.Suspense fallback={<div className="space-y-4"><SkeletonCard /><SkeletonCard /></div>}>
      <HealthPageInner />
    </React.Suspense>
  );
}

function HealthPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const todayKey = format(new Date(), "yyyy-MM-dd");
  const [selectedDate, setSelectedDate] = React.useState<string>(todayKey);
  const [manualOpen, setManualOpen] = React.useState(false);
  const selDate = React.useMemo(() => parseISO(selectedDate), [selectedDate]);
  const isToday = selectedDate === todayKey;
  const isFuture = selectedDate > todayKey;

  // Tab-State aus URL (?tab=heute|trends|plan|profil), Default heute
  const urlTab = searchParams?.get("tab");
  const activeTab: HealthTab = isHealthTab(urlTab) ? urlTab : "heute";
  const setActiveTab = React.useCallback(
    (tab: HealthTab) => {
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      if (tab === "heute") params.delete("tab");
      else params.set("tab", tab);
      const qs = params.toString();
      router.replace(qs ? `/health?${qs}` : "/health", { scroll: false });
    },
    [router, searchParams],
  );

  const { data, isLoading: metricsLoading } = useQuery<HealthResponse>({
    queryKey: ["health-metrics", 30],
    queryFn: async () => {
      const res = await fetch("/api/health/metrics?days=30");
      if (!res.ok) throw new Error("health");
      return res.json();
    },
    staleTime: 10 * 60_000,
  });

  const qc = useQueryClient();
  const toast = useToast();

  // Prefetch: Wochenplan + Score
  React.useEffect(() => {
    qc.prefetchQuery({
      queryKey: ["week-plan-draft"],
      queryFn: async () => {
        const res = await fetch("/api/coach/week-plan/draft");
        if (!res.ok) throw new Error("week-plan-draft");
        return res.json();
      },
      staleTime: 60_000,
    });
  }, [qc]);

  // Pull-to-Refresh — triggert refresh-all + invalidate
  const refreshAll = React.useCallback(async () => {
    haptics.tap();
    try {
      await fetch("/api/sync/refresh-all", { method: "POST" });
      toast.info("Sync gestartet", "Daten kommen in ~15-30 Sek.");
      setTimeout(() => {
        if (typeof navigator !== "undefined" && navigator.serviceWorker?.controller) {
          navigator.serviceWorker.controller.postMessage({ type: "purge-health-cache" });
        }
        qc.invalidateQueries({ queryKey: ["health-metrics"] });
        qc.invalidateQueries({ queryKey: ["health-score"] });
        qc.invalidateQueries({ queryKey: ["coach-recommendation"] });
        haptics.success();
      }, 15_000);
    } catch {
      haptics.warn();
      toast.error("Refresh fehlgeschlagen");
    }
  }, [qc, toast]);

  const pull = usePullRefresh({ onRefresh: refreshAll, threshold: 72 });

  return (
    <div
      {...pull.bind}
      className="relative pb-24 sm:pb-0"
      style={{ touchAction: "pan-y" }}
    >
      {/* Pull-to-Refresh-Indicator */}
      {pull.pullPx > 0 && (
        <div
          className="absolute left-1/2 -translate-x-1/2 z-20 flex flex-col items-center pointer-events-none"
          style={{ top: `${Math.min(pull.pullPx - 20, 60)}px` }}
        >
          <div
            className={cn(
              "h-9 w-9 rounded-full bg-card border border-border/60 shadow-md",
              "flex items-center justify-center",
              pull.state === "refreshing" && "animate-pulse-soft",
            )}
          >
            <RefreshCw
              className={cn(
                "h-4 w-4 transition-transform",
                pull.state === "ready" ? "text-primary rotate-180" : "text-muted-foreground",
                pull.state === "refreshing" && "animate-spin",
              )}
            />
          </div>
          <span className="text-[10px] text-muted-foreground mt-1">
            {pull.state === "ready"
              ? "Loslassen zum Sync"
              : pull.state === "refreshing"
              ? "Syncen…"
              : "Weiter ziehen"}
          </span>
        </div>
      )}

      <PageHeader
        className="mb-4"
        title="Health & Training"
        subtitle={<span className="hidden sm:inline">Dein KI-Trainer — Bereitschaft, Erholung, Plan.</span>}
      />

      <HealthTabsDesktop active={activeTab} onChange={setActiveTab} />

      {/* Tab-Content */}
      <div className="space-y-4 sm:space-y-6 mt-4">
        {activeTab === "heute" && (
          <>
            <MorningRitualCard />
            {metricsLoading ? <SkeletonCard /> : <TodayHero />}
            <VitalityCard />
            <TrainingsTodayCard />

            <Card id="journal-card">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <CardTitle className="text-base flex items-center gap-2">
                    <NotebookPen className="h-4 w-4 text-primary" /> {dayLabel(selDate)}
                    <span className="text-xs font-normal text-muted-foreground tabular-nums">({selectedDate})</span>
                  </CardTitle>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => { setSelectedDate(format(subDays(selDate, 1), "yyyy-MM-dd")); haptics.tap(); }}
                      aria-label="Vorheriger Tag"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <input
                      type="date"
                      value={selectedDate}
                      max={todayKey}
                      onChange={(e) => e.target.value && setSelectedDate(e.target.value)}
                      className="h-7 rounded-md border border-border/40 bg-background px-2 text-xs tabular-nums"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      disabled={isToday || isFuture}
                      onClick={() => { setSelectedDate(format(addDays(selDate, 1), "yyyy-MM-dd")); haptics.tap(); }}
                      aria-label="Naechster Tag"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                    {!isToday && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 ml-1 text-xs"
                        onClick={() => { setSelectedDate(todayKey); haptics.tap(); }}
                      >
                        Heute
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="space-y-2">
                  <WorkoutsList dateKey={selectedDate} bare title={isToday ? "Trainings heute" : "Trainings"} />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setManualOpen(true)}
                    className="h-7 w-full text-xs"
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" /> Manuelles Training hinzufuegen
                  </Button>
                </div>
                <div className="border-t border-border/40" />
                <JournalForm bare date={selectedDate} />
              </CardContent>
            </Card>
            <ManualWorkoutDialog
              open={manualOpen}
              onClose={() => setManualOpen(false)}
              defaultDate={selectedDate}
            />
            <div id="weight-card"><WeightCard /></div>
            <CalorieBalanceCard />
            <div id="food-card"><FoodVoiceCard /></div>
          </>
        )}

        {activeTab === "trends" && (
          <>
            <StreaksCard />
            <PacePredictorCard />
            <PaceHrTrendCard />
            <RunningTrendsCard />
            <WeeklyInsights />
            <WorkoutsList days={7} title="Diese Woche" />
            <TodayMetrics />

            <details className="group rounded-lg border border-border/40 px-4 py-3">
              <summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground select-none">
                Alle Health-Zeitreihen (30 Tage)
              </summary>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-3">
                {data && Object.entries(data.metrics).map(([kind, values]) => (
                  <Card key={kind}>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium">{KIND_LABELS[kind] ?? kind}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {values.length >= 2 && (
                        <TrendChart
                          data={values}
                          series={[{ key: "value", label: KIND_LABELS[kind] ?? kind, color: PRIMARY_SERIES_COLOR }]}
                          xKey="date"
                          height={100}
                          xTickFormatter={(d) => format(parseISO(d), "d.M.", { locale: de })}
                        />
                      )}
                      <div className="flex justify-between text-xs text-muted-foreground mt-1">
                        <span>{values.length > 0 ? format(parseISO(values[0].date), "d. MMM", { locale: de }) : ""}</span>
                        <span>Letzter: {values[values.length - 1]?.value.toFixed(1) ?? "—"}</span>
                        <span>{values.length > 0 ? format(parseISO(values[values.length - 1].date), "d. MMM", { locale: de }) : ""}</span>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </details>
          </>
        )}

        {activeTab === "plan" && (
          <>
            <PeriodizationCard />
            <DailyGoalsCard />
            <WeeklyPlanCard />
            <CoachCard />
          </>
        )}

        {activeTab === "profil" && (
          <>
            <LongTermGoalsCard />
            {data?.lastSync && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Sync-Status</CardTitle>
                </CardHeader>
                <CardContent className="text-sm space-y-1">
                  <p>
                    Letzter Sync:{" "}
                    <span className="tabular-nums text-muted-foreground">
                      {data.lastSync.finishedAt
                        ? format(parseISO(data.lastSync.finishedAt), "d. MMM HH:mm", { locale: de })
                        : "—"}
                    </span>
                  </p>
                  <p>
                    Status:{" "}
                    <span className={data.lastSync.success ? "text-emerald-300" : "text-red-300"}>
                      {data.lastSync.success ? "OK" : data.lastSync.error ? "Fehler" : "Unbekannt"}
                    </span>
                  </p>
                  {data.lastSync.error && (
                    <pre className="text-xs whitespace-pre-wrap text-muted-foreground overflow-x-auto max-h-40 mt-2">
                      {data.lastSync.error}
                    </pre>
                  )}
                </CardContent>
              </Card>
            )}
            {metricsLoading && (
              <>
                <Skeleton className="h-5 w-32" />
                <SkeletonCard />
              </>
            )}
          </>
        )}
      </div>

      {/* Floating Sync FAB — auf Mobile + Desktop sichtbar */}
      <SyncFab />

      {/* Bottom-Tab-Bar (nur Mobile) */}
      <HealthTabs active={activeTab} onChange={setActiveTab} />
    </div>
  );
}
