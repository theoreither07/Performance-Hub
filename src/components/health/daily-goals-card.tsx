"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils/cn";
import { format } from "date-fns";
import { Target, Flame, Footprints, Zap } from "lucide-react";

interface DailyResponse {
  daily: {
    steps: number | null;
    stepsGoal: number | null;
    calories: number | null;
    caloriesGoal: number | null;
    caloriesActive: number | null;
    caloriesBmr: number | null;
  };
}

export function DailyGoalsCard() {
  const todayKey = format(new Date(), "yyyy-MM-dd");
  const { data, isLoading } = useQuery<DailyResponse>({
    queryKey: ["health-score", "daily", todayKey],
    queryFn: async () => {
      const res = await fetch("/api/health/score?days=1");
      if (!res.ok) throw new Error("daily");
      return res.json();
    },
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: true,
  });

  if (isLoading || !data?.daily) return null;
  const d = data.daily;
  if (!d.stepsGoal && !d.caloriesGoal) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Target className="h-4 w-4 text-primary" /> Tagesziele
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {d.stepsGoal && (
            <Goal
              icon={Footprints}
              label="Schritte"
              value={d.steps}
              goal={d.stepsGoal}
              format={(n) => n.toLocaleString("de-DE")}
              tone="primary"
            />
          )}
          {d.caloriesGoal && (
            <Goal
              icon={Flame}
              label="Kalorien (Gesamt-Verbrauch)"
              value={d.calories}
              goal={d.caloriesGoal}
              format={(n) => `${Math.round(n)} kcal`}
              tone="orange"
              sub={d.caloriesBmr !== null ? `Grundumsatz (BMR) ${Math.round(d.caloriesBmr)} kcal` : null}
            />
          )}
        </div>
        {/* Aktiv verbrannte Kalorien — eigene Zeile, die trainings-relevante Zahl */}
        {d.caloriesActive !== null && (
          <div className="mt-4 flex items-center justify-between rounded-lg bg-orange-500/10 border border-orange-500/20 px-4 py-3">
            <div className="flex items-center gap-2">
              <Flame className="h-4 w-4 text-orange-400" />
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Aktiv verbrannt</p>
                <p className="text-[10px] text-muted-foreground">durch Bewegung & Training (ohne Grundumsatz)</p>
              </div>
            </div>
            <p className="text-2xl font-bold text-orange-300 tabular-nums">{Math.round(d.caloriesActive)} <span className="text-sm font-normal text-muted-foreground">kcal</span></p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Goal({
  icon: Icon,
  label,
  value,
  goal,
  format,
  tone,
  sub,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number | null;
  goal: number;
  format: (n: number) => string;
  tone: "primary" | "orange";
  sub?: string | null;
}) {
  const v = value ?? 0;
  const pct = Math.min(100, (v / goal) * 100);
  const done = pct >= 100;
  const remaining = Math.max(0, goal - v);
  const barColor = done ? "bg-emerald-400" : tone === "orange" ? "bg-orange-400" : "bg-primary";
  const valueColor = done ? "text-emerald-300" : tone === "orange" ? "text-orange-300" : "text-foreground";

  return (
    <div className="p-3 rounded-lg bg-muted/30 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
        </div>
        {done && <Zap className="h-3.5 w-3.5 text-emerald-400" />}
      </div>
      <div className="flex items-baseline gap-2">
        <p className={cn("text-2xl font-bold tabular-nums", valueColor)}>{format(v)}</p>
        <p className="text-xs text-muted-foreground">/ {format(goal)}</p>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", barColor)} style={{ width: `${pct}%` }} />
      </div>
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>
          {done ? "Ziel erreicht ✓" : `noch ${format(remaining)}`}
        </span>
        {sub && <span>{sub}</span>}
      </div>
    </div>
  );
}
