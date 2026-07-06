"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Target, Trash2, TrendingDown, TrendingUp, Trophy } from "lucide-react";
import { format, parseISO, differenceInDays } from "date-fns";
import { de } from "@/lib/i18n/date-locale";
import { cn } from "@/lib/utils/cn";
import { PRIMARY_SERIES_COLOR, STATUS_COLOR } from "@/components/charts";

// Mini-Sparkline mit Forecast-Line + IST-Linie.
// Vergleicht aktuellen Trend gegen "muss-haben"-Linie (linear Start→Ziel).
function GoalTrajectory({
  values,
  startValue,
  targetValue,
  startDate,
  targetDate,
}: {
  values: number[];
  startValue: number | null;
  targetValue: number | null;
  startDate: string;
  targetDate: string;
}) {
  if (values.length < 2) {
    return startValue !== null && targetValue !== null ? (
      <span className="text-[10px] text-muted-foreground italic">noch keine Verlaufsdaten</span>
    ) : null;
  }
  const W = 90, H = 22;
  const allValues = [...values, ...(startValue !== null ? [startValue] : []), ...(targetValue !== null ? [targetValue] : [])];
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const range = max - min || 1;

  // IST-Linie
  const actualPts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * W;
    const y = H - ((v - min) / range) * (H - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");

  // FORECAST-Linie (Start → Ziel, linear über die gleiche X-Breite)
  let forecast: string | null = null;
  if (startValue !== null && targetValue !== null) {
    const y0 = H - ((startValue - min) / range) * (H - 4) - 2;
    const y1 = H - ((targetValue - min) / range) * (H - 4) - 2;
    forecast = `0,${y0.toFixed(1)} ${W},${y1.toFixed(1)}`;
  }

  // Status: auf Kurs / hinter Plan? — KORRIGIERT: zeit-basierter Fortschritt.
  // Vorher: `values.length / 30` nutzte Anzahl Datenpunkte als Proxy für Zeit → falsch.
  let status: "track" | "behind" | "ahead" | null = null;
  if (startValue !== null && targetValue !== null && values.length > 0) {
    const last = values[values.length - 1];
    const now = new Date();
    const start = new Date(startDate);
    const target = new Date(targetDate);
    const totalMs = target.getTime() - start.getTime();
    const elapsedMs = Math.max(0, now.getTime() - start.getTime());
    // progressRatio: 0 = ganz am Anfang, 1 = Ziel-Datum erreicht
    const progressRatio = totalMs > 0 ? Math.min(1, elapsedMs / totalMs) : 1;
    const expected = startValue + (targetValue - startValue) * progressRatio;
    const target_lower = targetValue < startValue;
    if (target_lower) {
      status = last <= expected ? "track" : "behind";
      if (last <= targetValue + (startValue - targetValue) * 0.1) status = "ahead";
    } else {
      status = last >= expected ? "track" : "behind";
      if (last >= targetValue - (targetValue - startValue) * 0.1) status = "ahead";
    }
  }

  return (
    <div className="flex items-center gap-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-20 h-5" preserveAspectRatio="none">
        {forecast && <polyline points={forecast} fill="none" stroke="rgba(160,160,160,0.5)" strokeWidth={1} strokeDasharray="3 2" />}
        <polyline points={actualPts} fill="none" stroke={PRIMARY_SERIES_COLOR} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {status && (
        <span
          className="text-[9px] uppercase tracking-wider font-bold"
          style={{ color: status === "behind" ? STATUS_COLOR.warning : STATUS_COLOR.good }}
        >
          {status === "track" ? "on track" : status === "ahead" ? "ahead" : "behind"}
        </span>
      )}
    </div>
  );
}

interface Goal {
  id: string;
  type: "race" | "weight" | "vo2max" | "5km_tt" | "10km_tt";
  name: string;
  targetValue: number | null;
  targetUnit: string | null;
  targetDate: string;
  startDate: string;
  startValue: number | null;
  active: boolean;
  notes: string | null;
}

interface GoalsResponse {
  goals: Goal[];
}

const TYPE_LABELS: Record<string, string> = {
  race: "Race",
  weight: "Gewicht",
  vo2max: "VO2max",
  "5km_tt": "5km Time-Trial",
  "10km_tt": "10km Time-Trial",
};

const TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  race: Trophy,
  weight: TrendingDown,
  vo2max: TrendingUp,
  "5km_tt": Trophy,
  "10km_tt": Trophy,
};

export function LongTermGoalsCard() {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = React.useState(false);

  const list = useQuery<GoalsResponse>({
    queryKey: ["long-term-goals"],
    queryFn: async () => {
      const res = await fetch("/api/coach/long-term-goals");
      if (!res.ok) throw new Error("goals");
      return res.json();
    },
    staleTime: 5 * 60_000,
  });

  // Fuer Sparklines: Gewicht + VO2max-Verlauf holen
  const weights = useQuery<{ entries: Array<{ date: string; weightKg: number }> }>({
    queryKey: ["body-weight"],
    queryFn: async () => {
      const res = await fetch("/api/health/weight");
      if (!res.ok) throw new Error("w");
      return res.json();
    },
    staleTime: 5 * 60_000,
  });
  const vo2 = useQuery<{ metrics?: Record<string, { date: string; value: number }[]> }>({
    queryKey: ["health-metrics", 90, "vo2"],
    queryFn: async () => {
      const res = await fetch("/api/health/metrics?days=90");
      if (!res.ok) throw new Error("m");
      return res.json();
    },
    staleTime: 10 * 60_000,
  });

  function sparklineFor(type: string): number[] {
    if (type === "weight") return (weights.data?.entries ?? []).map((e) => e.weightKg);
    if (type === "vo2max") return (vo2.data?.metrics?.vo2max ?? []).map((m) => m.value);
    return [];
  }

  const del = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/coach/long-term-goals?id=${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("del");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["long-term-goals"] }),
  });

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 font-semibold">
            <Target className="h-3.5 w-3.5 text-primary" /> Langfrist-Ziele
          </p>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowAdd((v) => !v)}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Neu
          </Button>
        </div>

        {showAdd && <AddGoalForm onDone={() => { setShowAdd(false); qc.invalidateQueries({ queryKey: ["long-term-goals"] }); }} />}

        {list.data?.goals.length === 0 && !showAdd && (
          <p className="text-xs text-muted-foreground italic">
            Noch keine Langfrist-Ziele. Coach plant ohne Periodisierung — Klick "Neu" um z.B. Halbmarathon-Race anzulegen.
          </p>
        )}

        <ul className="space-y-2">
          {list.data?.goals.map((g) => {
            const Icon = TYPE_ICONS[g.type] ?? Target;
            const days = differenceInDays(parseISO(g.targetDate), new Date());
            const weeks = Math.round(days / 7);
            return (
              <li key={g.id} className={cn("rounded-lg border p-3 group", g.active ? "border-border/40" : "border-border/20 opacity-60")}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 text-xs">
                      <Icon className="h-3.5 w-3.5 text-primary shrink-0" />
                      <span className="font-bold text-foreground truncate">{g.name}</span>
                      <span className="text-muted-foreground">· {TYPE_LABELS[g.type]}</span>
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                      {g.targetValue !== null && (
                        <span>Target: <span className="text-foreground tabular-nums">{g.targetValue}{g.targetUnit ?? ""}</span></span>
                      )}
                      <span>{format(parseISO(g.targetDate), "d. MMM yyyy", { locale: de })}</span>
                      <span className={cn(
                        "font-medium tabular-nums",
                        days < 0 ? "text-muted-foreground" : weeks <= 2 ? "text-red-300" : weeks <= 8 ? "text-amber-300" : "text-emerald-300",
                      )}>
                        {days < 0 ? "vorbei" : `in ${weeks}w`}
                      </span>
                    </div>
                    {g.startValue !== null && g.targetValue !== null && (
                      <div className="text-[10px] text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
                        <span>Start {g.startValue}{g.targetUnit ?? ""} → Ziel {g.targetValue}{g.targetUnit ?? ""}</span>
                        <GoalTrajectory
                          values={sparklineFor(g.type)}
                          startValue={g.startValue}
                          targetValue={g.targetValue}
                          startDate={g.startDate}
                          targetDate={g.targetDate}
                        />
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => del.mutate(g.id)}
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive shrink-0 transition-opacity"
                    aria-label="Loeschen"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

function AddGoalForm({ onDone }: { onDone: () => void }) {
  const [type, setType] = React.useState<Goal["type"]>("race");
  const [name, setName] = React.useState<string>("");
  const [targetValue, setTargetValue] = React.useState<string>("");
  const [targetUnit, setTargetUnit] = React.useState<string>("min");
  const [targetDate, setTargetDate] = React.useState<string>("");
  const [startValue, setStartValue] = React.useState<string>("");

  React.useEffect(() => {
    if (type === "race") setTargetUnit("min");
    else if (type === "weight") setTargetUnit("kg");
    else if (type === "vo2max") setTargetUnit("");
    else setTargetUnit("min");
  }, [type]);

  const save = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/coach/long-term-goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          name: name || `${TYPE_LABELS[type]} ${targetDate}`,
          targetValue: targetValue ? Number(targetValue) : null,
          targetUnit: targetUnit || null,
          targetDate,
          startValue: startValue ? Number(startValue) : null,
        }),
      });
      if (!res.ok) throw new Error("save");
    },
    onSuccess: onDone,
  });

  // Quick-Templates für häufige Race-Goals — füllen die Form mit sinnvollen Defaults
  const applyTemplate = (tpl: { type: Goal["type"]; name: string; unit: string; value: string; placeholder?: string }) => {
    setType(tpl.type);
    setName(tpl.name);
    setTargetUnit(tpl.unit);
    setTargetValue(tpl.value);
  };

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
      <div className="flex flex-wrap gap-1">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground w-full mb-0.5">Vorlagen:</span>
        <button type="button" onClick={() => applyTemplate({ type: "race", name: "Halbmarathon", unit: "min", value: "100" })}
          className="text-[11px] px-2 py-0.5 rounded border border-border/40 hover:bg-primary/10 hover:border-primary/50 transition-colors">
          🏃 HM Sub-1:40
        </button>
        <button type="button" onClick={() => applyTemplate({ type: "race", name: "Marathon", unit: "min", value: "210" })}
          className="text-[11px] px-2 py-0.5 rounded border border-border/40 hover:bg-primary/10 hover:border-primary/50 transition-colors">
          🏃 Marathon Sub-3:30
        </button>
        <button type="button" onClick={() => applyTemplate({ type: "race", name: "10km Race", unit: "min", value: "45" })}
          className="text-[11px] px-2 py-0.5 rounded border border-border/40 hover:bg-primary/10 hover:border-primary/50 transition-colors">
          🏃 10km Sub-45
        </button>
        <button type="button" onClick={() => applyTemplate({ type: "5km_tt", name: "5km TT", unit: "min", value: "20" })}
          className="text-[11px] px-2 py-0.5 rounded border border-border/40 hover:bg-primary/10 hover:border-primary/50 transition-colors">
          ⏱ 5km Sub-20
        </button>
        <button type="button" onClick={() => applyTemplate({ type: "vo2max", name: "VO2max Ziel", unit: "ml/min/kg", value: "58" })}
          className="text-[11px] px-2 py-0.5 rounded border border-border/40 hover:bg-primary/10 hover:border-primary/50 transition-colors">
          💪 VO2max 58+
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Typ</span>
          <select value={type} onChange={(e) => setType(e.target.value as Goal["type"])} className="h-8 rounded-md border border-border/40 bg-background px-2 text-sm">
            <option value="race">Race (z.B. Halbmarathon)</option>
            <option value="weight">Gewicht</option>
            <option value="vo2max">VO2max</option>
            <option value="5km_tt">5km Time-Trial</option>
            <option value="10km_tt">10km Time-Trial</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Datum / Termin</span>
          <input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} className="h-8 rounded-md border border-border/40 bg-background px-2 text-sm" />
        </label>
        <label className="flex flex-col gap-1 text-xs col-span-1 sm:col-span-2">
          <span className="text-muted-foreground">Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="z.B. Halbmarathon Wien 2026" className="h-8 rounded-md border border-border/40 bg-background px-2 text-sm" />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Ziel-Wert {targetUnit && `(${targetUnit})`}</span>
          <input type="number" step="0.1" value={targetValue} onChange={(e) => setTargetValue(e.target.value)} placeholder={type === "race" ? "100 (= 1h40min)" : type === "weight" ? "75" : "56"} className="h-8 rounded-md border border-border/40 bg-background px-2 text-sm tabular-nums" />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Aktueller Wert {targetUnit && `(${targetUnit})`}</span>
          <input type="number" step="0.1" value={startValue} onChange={(e) => setStartValue(e.target.value)} placeholder="optional" className="h-8 rounded-md border border-border/40 bg-background px-2 text-sm tabular-nums" />
        </label>
      </div>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onDone}>Abbrechen</Button>
        <Button size="sm" className="h-7 text-xs" onClick={() => save.mutate()} disabled={save.isPending || !targetDate}>
          {save.isPending ? "Speichere..." : "Anlegen"}
        </Button>
      </div>
    </div>
  );
}
