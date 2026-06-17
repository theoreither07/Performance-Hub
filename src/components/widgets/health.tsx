"use client";

import { Card, CardContent } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";
import { Activity, Dumbbell, Flame, Footprints, Sparkles, Sunrise } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { format } from "date-fns";
import Link from "next/link";

type Recovery = "green" | "yellow" | "red" | "unknown";
type Level = "recover" | "easy" | "moderate" | "hard";

interface DayScore {
  total: number;
  recovery: Recovery;
  suggestion: { level: Level; headline: string };
  tomorrow: { level: Level; headline: string };
  workoutsToday: number;
  workoutMinutesToday: number;
}

interface ScoreResponse {
  days: DayScore[];
  daily: {
    steps: number | null;
    stepsGoal: number | null;
    calories: number | null;
    caloriesGoal: number | null;
    caloriesActive: number | null;
  };
  aiHint: { text: string; level: string | null; at: string } | null;
}

const RECOVERY_DOT: Record<Recovery, string> = {
  green: "bg-emerald-400",
  yellow: "bg-amber-400",
  red: "bg-red-400",
  unknown: "bg-muted-foreground",
};

const LEVEL_LABEL: Record<Level, string> = {
  recover: "Recovery",
  easy: "Leicht",
  moderate: "Moderat",
  hard: "Hart",
};

const LEVEL_COLOR: Record<Level, string> = {
  recover: "text-blue-300",
  easy: "text-emerald-300",
  moderate: "text-amber-300",
  hard: "text-red-300",
};

function scoreColor(s: number): string {
  if (s >= 75) return "text-emerald-400";
  if (s >= 55) return "text-amber-400";
  if (s >= 35) return "text-orange-400";
  return "text-red-400";
}

function scoreRingColor(s: number): string {
  if (s >= 75) return "stroke-emerald-400";
  if (s >= 55) return "stroke-amber-400";
  if (s >= 35) return "stroke-orange-400";
  return "stroke-red-400";
}

function MiniDonut({ value }: { value: number }) {
  const radius = 22;
  const circ = 2 * Math.PI * radius;
  const offset = circ - (value / 100) * circ;
  return (
    <div className="relative h-14 w-14 shrink-0">
      <svg className="-rotate-90" viewBox="0 0 56 56" width="56" height="56">
        <circle cx="28" cy="28" r={radius} strokeWidth="5" fill="none" className="stroke-muted/30" />
        <circle
          cx="28"
          cy="28"
          r={radius}
          strokeWidth="5"
          fill="none"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className={scoreRingColor(value)}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <p className={cn("text-lg font-bold leading-none tabular-nums", scoreColor(value))}>{value}</p>
      </div>
    </div>
  );
}

function ProgressBar({
  label,
  icon: Icon,
  value,
  goal,
  format,
  tone = "primary",
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  value: number | null;
  goal: number | null;
  format: (n: number) => string;
  tone?: "primary" | "orange";
}) {
  const v = value ?? 0;
  const g = goal ?? 0;
  const pct = g > 0 ? Math.min(100, (v / g) * 100) : 0;
  const done = pct >= 100;
  const barColor = done
    ? "bg-emerald-400"
    : tone === "orange"
      ? "bg-orange-400"
      : "bg-primary";
  return (
    <div className="space-y-1 min-w-0">
      <div className="flex items-center justify-between text-xs gap-2">
        <span className="flex items-center gap-1.5 text-muted-foreground truncate">
          <Icon className="h-3 w-3 shrink-0" />
          {label}
        </span>
        <span className="tabular-nums whitespace-nowrap">
          <span className={cn("font-semibold", done && "text-emerald-300")}>{value !== null ? format(v) : "—"}</span>
          {goal !== null && <span className="text-muted-foreground"> / {format(g)}</span>}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", barColor)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// Kalorien-Balken mit zwei Segmenten: aktiv verbrannt (hell) als Teil des
// Gesamt-Verbrauchs (gedaempft). Aktiv ist immer Teilmenge von Gesamt (Gesamt = BMR + aktiv).
// Kompakt fuer das 2-Spalten-Grid: Gesamt/Ziel oben, Aktiv-Wert als kleine Zeile unten.
function CaloriesBar({
  active,
  total,
  goal,
}: {
  active: number | null;
  total: number | null;
  goal: number;
}) {
  const a = active ?? 0;
  const t = total ?? 0;
  const totalPct = goal > 0 ? Math.min(100, (t / goal) * 100) : 0;
  const activePct = goal > 0 ? Math.min(100, (a / goal) * 100) : 0;
  const done = totalPct >= 100;
  return (
    <div className="space-y-1 min-w-0">
      <div className="flex items-center justify-between text-xs gap-2">
        <span className="flex items-center gap-1.5 text-muted-foreground truncate">
          <Flame className="h-3 w-3 shrink-0" />
          Kalorien
        </span>
        <span className="tabular-nums whitespace-nowrap">
          <span className={cn("font-semibold", done && "text-emerald-300")}>{Math.round(t)}</span>
          <span className="text-muted-foreground"> / {Math.round(goal)}</span>
        </span>
      </div>
      <div className="relative h-1.5 rounded-full bg-muted overflow-hidden">
        {/* Gesamt-Verbrauch (Grundumsatz + aktiv) — gedaempft */}
        <div
          className={cn("absolute inset-y-0 left-0 rounded-full transition-all", done ? "bg-emerald-400/40" : "bg-orange-400/35")}
          style={{ width: `${totalPct}%` }}
        />
        {/* Aktiv verbrannt — heller Abschnitt vorne */}
        {active !== null && (
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-orange-400 transition-all"
            style={{ width: `${activePct}%` }}
          />
        )}
      </div>
      {active !== null && (
        <p className="text-[10px] tabular-nums text-orange-300/80">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-orange-400 mr-1 align-middle" />
          {Math.round(a)} aktiv verbrannt
        </p>
      )}
    </div>
  );
}

export function HealthWidget() {
  const todayKey = format(new Date(), "yyyy-MM-dd");
  const { data, isLoading } = useQuery<ScoreResponse>({
    queryKey: ["health-score", "widget", todayKey],
    queryFn: async () => {
      const res = await fetch("/api/health/score?days=1");
      if (!res.ok) throw new Error("score");
      return res.json();
    },
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });

  if (isLoading) return null;
  const today = data?.days[0];
  if (!today) return null;

  const d = data?.daily;
  const stepsRemaining = d?.stepsGoal && d?.steps !== null && d?.steps !== undefined
    ? Math.max(0, d.stepsGoal - d.steps)
    : null;
  const caloriesRemaining = d?.caloriesGoal && d?.calories !== null && d?.calories !== undefined
    ? Math.max(0, d.caloriesGoal - d.calories)
    : null;

  // "Was du heute noch tun solltest" — eine Zeile
  const todoToday: string[] = [];
  if (today.workoutsToday === 0) {
    todoToday.push(`Training: ${today.suggestion.headline}`);
  } else {
    todoToday.push(`✓ ${today.workoutsToday}x trainiert (${today.workoutMinutesToday}min)`);
  }
  if (stepsRemaining !== null && stepsRemaining > 0 && stepsRemaining < 5000) {
    todoToday.push(`+${stepsRemaining.toLocaleString("de-DE")} Schritte fuer Ziel`);
  }
  if (caloriesRemaining !== null && caloriesRemaining > 200 && today.workoutsToday > 0) {
    todoToday.push(`+${caloriesRemaining} kcal fuer Ziel`);
  }

  return (
    <Link href="/health" className="block group">
      <Card className="group-hover:border-primary/40 transition-colors">
        <CardContent className="p-3.5 space-y-3">
          {/* Top-Zeile: Score + Status + Empfehlung */}
          <div className="flex items-center gap-3">
            <MiniDonut value={today.total} />
            <div className="flex-1 min-w-0 space-y-0.5">
              <div className="flex items-center gap-2 text-xs">
                <span className="flex items-center gap-1.5">
                  <span className={cn("h-2 w-2 rounded-full", RECOVERY_DOT[today.recovery])} />
                  <span className="text-muted-foreground">Recovery</span>
                </span>
                <span className="text-muted-foreground">·</span>
                <span className={cn("font-medium uppercase text-[10px] tracking-wider", LEVEL_COLOR[today.suggestion.level])}>
                  {LEVEL_LABEL[today.suggestion.level]}
                </span>
                {today.workoutsToday > 0 && (
                  <>
                    <span className="text-muted-foreground">·</span>
                    <span className="flex items-center gap-1 text-emerald-300">
                      <Dumbbell className="h-3 w-3" />
                      {today.workoutsToday}x {today.workoutMinutesToday}min
                    </span>
                  </>
                )}
              </div>
              <p className="text-sm font-medium truncate">{today.suggestion.headline}</p>
            </div>
          </div>

          {/* Daily Goals: nur wenn gesetzt — nebeneinander */}
          {(d?.stepsGoal || d?.caloriesGoal) && (
            <div className="grid grid-cols-2 gap-3 pt-1 items-start">
              {d?.stepsGoal && (
                <ProgressBar
                  label="Schritte"
                  icon={Footprints}
                  value={d.steps}
                  goal={d.stepsGoal}
                  format={(n) => n.toLocaleString("de-DE")}
                />
              )}
              {d?.caloriesGoal && (
                <CaloriesBar active={d.caloriesActive} total={d.calories} goal={d.caloriesGoal} />
              )}
            </div>
          )}

          {/* KI-Coach-1-Zeiler — wenn vorhanden, ersetzt den "Morgen"-Hinweis */}
          {data?.aiHint ? (
            <div className="flex items-start gap-1.5 text-[11px] pt-1 border-t border-border/30">
              <Sparkles className="h-3 w-3 text-primary mt-0.5 shrink-0" />
              <p className="text-foreground/90 italic flex-1">{data.aiHint.text}</p>
            </div>
          ) : today.tomorrow ? (
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground pt-1 border-t border-border/30">
              <Sunrise className="h-3 w-3 text-primary/70" />
              <span className="text-muted-foreground">Morgen:</span>
              <span className="truncate font-medium text-foreground">{today.tomorrow.headline.replace(/^Morgen:\s*/i, "")}</span>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </Link>
  );
}
