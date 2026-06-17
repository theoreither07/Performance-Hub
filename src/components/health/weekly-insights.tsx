"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils/cn";
import { format, parseISO, startOfWeek, differenceInDays } from "date-fns";
import { de } from "@/lib/i18n/date-locale";
import { CalendarDays, Dumbbell } from "lucide-react";

type Recovery = "green" | "yellow" | "red" | "unknown";

interface DayScore {
  date: string;
  total: number;
  recovery: Recovery;
  acwr: number | null;
  suggestion: { level: string; headline: string };
  hasJournal: boolean;
}

interface Workout {
  date: string;
  type: string;
  durationSec: number;
}

const RECOVERY_BG: Record<Recovery, string> = {
  green: "bg-emerald-500/30 border-emerald-500/50",
  yellow: "bg-amber-500/30 border-amber-500/50",
  red: "bg-red-500/30 border-red-500/50",
  unknown: "bg-muted border-border",
};

export function WeeklyInsights() {
  // Wir laden 7 Tage zurueck (max Mo+So), filtern dann auf "diese Woche bis heute"
  const monday = startOfWeek(new Date(), { weekStartsOn: 1 });
  const daysSinceMonday = Math.min(7, differenceInDays(new Date(), monday) + 1);

  const { data, isLoading } = useQuery<{ days: DayScore[] }>({
    queryKey: ["health-score", "week", daysSinceMonday],
    queryFn: async () => {
      const res = await fetch(`/api/health/score?days=${daysSinceMonday}`);
      if (!res.ok) throw new Error("score");
      return res.json();
    },
    staleTime: 5 * 60_000,
  });

  const { data: workoutsData } = useQuery<{ workouts: Workout[] }>({
    queryKey: ["workouts", daysSinceMonday],
    queryFn: async () => {
      const res = await fetch(`/api/workouts?days=${daysSinceMonday}`);
      if (!res.ok) throw new Error("workouts");
      return res.json();
    },
    staleTime: 60_000,
  });

  if (isLoading || !data) return null;

  // Reverse to chrono order (Monday first)
  const days = [...data.days].reverse();

  // Workouts pro Tag zaehlen
  const workoutsByDate = new Map<string, number>();
  for (const w of workoutsData?.workouts ?? []) {
    workoutsByDate.set(w.date, (workoutsByDate.get(w.date) ?? 0) + 1);
  }

  const valid = days.filter((d) => d.total > 0);
  const avgScore = valid.length > 0 ? valid.reduce((s, d) => s + d.total, 0) / valid.length : 0;
  const topFormDays = days.filter((d) => d.recovery === "green").length;
  const stressedDays = days.filter((d) => d.recovery === "red").length;
  const trainingDays = days.filter((d) => (workoutsByDate.get(d.date) ?? 0) > 0).length;
  const totalWorkouts = days.reduce((s, d) => s + (workoutsByDate.get(d.date) ?? 0), 0);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-primary" /> Diese Woche
          </span>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-normal">
            {format(monday, "d. MMM", { locale: de })} – heute
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-7 gap-1.5">
          {Array.from({ length: 7 }).map((_, i) => {
            const d = days[i];
            const isFuture = !d;
            const workouts = d ? workoutsByDate.get(d.date) ?? 0 : 0;
            const dayLabel = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"][i];
            return (
              <div key={i} className="text-center">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{dayLabel}</p>
                <div
                  className={cn(
                    "aspect-square rounded-lg border flex flex-col items-center justify-center font-bold relative",
                    isFuture ? "bg-muted/20 border-dashed border-border/30" : RECOVERY_BG[d.recovery],
                  )}
                  title={d ? `${d.suggestion.headline} (${d.total})` : "noch nicht"}
                >
                  {isFuture ? (
                    <span className="text-xs text-muted-foreground">–</span>
                  ) : (
                    <>
                      <span className="text-lg leading-none">{d.total > 0 ? d.total : "—"}</span>
                      {workouts > 0 && (
                        <span className="absolute bottom-0.5 right-0.5 flex items-center gap-0.5 text-[8px] text-foreground/80 font-normal">
                          <Dumbbell className="h-2 w-2" />
                          {workouts}
                        </span>
                      )}
                    </>
                  )}
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">
                  {d ? format(parseISO(d.date), "d.M.") : ""}
                </p>
              </div>
            );
          })}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
          <Stat label="Ø Score" value={Math.round(avgScore).toString()} tone="primary" />
          <Stat label="Top Form" value={topFormDays.toString()} tone="good" hint="grün" />
          <Stat label="Trainings" value={`${totalWorkouts}`} hint={`${trainingDays}d`} tone="primary" />
          <Stat label="Stress" value={stressedDays.toString()} tone={stressedDays > 2 ? "bad" : "neutral"} hint="rot" />
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone: "good" | "bad" | "neutral" | "primary";
}) {
  const color =
    tone === "good"
      ? "text-emerald-400"
      : tone === "bad"
        ? "text-red-400"
        : tone === "primary"
          ? "text-primary"
          : "text-foreground";
  return (
    <div className="p-3 rounded-lg bg-muted/30">
      <div className="flex items-baseline justify-between">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
        {hint && <p className="text-[9px] text-muted-foreground">{hint}</p>}
      </div>
      <p className={cn("text-2xl font-bold mt-0.5", color)}>{value}</p>
    </div>
  );
}
