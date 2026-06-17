"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils/cn";
import { HeartPulse, Moon, Battery, Activity, Footprints, Brain } from "lucide-react";

interface HealthResponse {
  metrics: Record<string, { date: string; value: number }[]>;
}

interface Metric {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  value: string;
  delta: { value: number; better: boolean } | null;
  hint?: string;
}

function avg(arr: { value: number }[] | undefined, n: number): number | null {
  if (!arr || arr.length === 0) return null;
  const slice = arr.slice(-n);
  if (slice.length === 0) return null;
  return slice.reduce((s, v) => s + v.value, 0) / slice.length;
}

function last(arr: { value: number }[] | undefined): number | null {
  if (!arr || arr.length === 0) return null;
  return arr[arr.length - 1].value;
}

function fmtDelta(latest: number | null, baseline: number | null, betterIsHigher: boolean) {
  if (latest === null || baseline === null) return null;
  const diff = latest - baseline;
  if (Math.abs(diff) < 0.5) return null;
  return { value: diff, better: betterIsHigher ? diff > 0 : diff < 0 };
}

export function TodayMetrics() {
  const { data, isLoading } = useQuery<HealthResponse>({
    queryKey: ["health-metrics", 30],
    queryFn: async () => {
      const res = await fetch("/api/health/metrics?days=30");
      if (!res.ok) throw new Error("health");
      return res.json();
    },
    staleTime: 10 * 60_000,
  });

  if (isLoading || !data) return null;

  const hrv = data.metrics.hrv_overnight;
  const rhr = data.metrics.rhr;
  const sleep = data.metrics.sleep_minutes;
  const sleepScore = data.metrics.sleep_score;
  const bb = data.metrics.body_battery_high;
  const steps = data.metrics.steps;
  const readiness = data.metrics.training_readiness;
  const stress = data.metrics.stress_avg;

  const lastSleep = last(sleep);
  const sleepStr =
    lastSleep !== null
      ? `${Math.floor(lastSleep / 60)}h ${Math.round(lastSleep % 60)}m`
      : "—";
  const sleepScoreVal = last(sleepScore);
  const sleepHint = sleepScoreVal !== null ? `Score ${Math.round(sleepScoreVal)}` : undefined;

  const items: Metric[] = [
    {
      label: "Schlaf",
      icon: Moon,
      value: sleepStr,
      delta: fmtDelta(last(sleep), avg(sleep?.slice(0, -1), 14), true),
      hint: sleepHint,
    },
    {
      label: "HRV",
      icon: Brain,
      value: last(hrv) !== null ? `${Math.round(last(hrv)!)} ms` : "—",
      delta: fmtDelta(last(hrv), avg(hrv?.slice(0, -1), 14), true),
      hint: avg(hrv, 14) !== null ? `Ø ${Math.round(avg(hrv, 14)!)}` : undefined,
    },
    {
      label: "Resting HR",
      icon: HeartPulse,
      value: last(rhr) !== null ? `${Math.round(last(rhr)!)} bpm` : "—",
      delta: fmtDelta(last(rhr), avg(rhr?.slice(0, -1), 14), false),
      hint: avg(rhr, 14) !== null ? `Ø ${Math.round(avg(rhr, 14)!)}` : undefined,
    },
    {
      label: "Body Battery",
      icon: Battery,
      value: last(bb) !== null ? `${Math.round(last(bb)!)}` : "—",
      delta: null,
      hint: readiness ? `Readiness ${last(readiness) !== null ? Math.round(last(readiness)!) : "—"}` : undefined,
    },
    {
      label: "Schritte",
      icon: Footprints,
      value: last(steps) !== null ? Math.round(last(steps)!).toLocaleString("de-DE") : "—",
      delta: null,
      hint: avg(steps, 7) !== null ? `Ø ${Math.round(avg(steps, 7)!).toLocaleString("de-DE")}` : undefined,
    },
    {
      label: "Stress",
      icon: Activity,
      value: last(stress) !== null ? `${Math.round(last(stress)!)}` : "—",
      delta: fmtDelta(last(stress), avg(stress?.slice(0, -1), 14), false),
      hint: avg(stress, 14) !== null ? `Ø ${Math.round(avg(stress, 14)!)}` : undefined,
    },
  ];

  return (
    <Card>
      <CardContent className="p-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {items.map((m) => (
            <div key={m.label} className="p-3 rounded-lg bg-muted/30">
              <div className="flex items-center justify-between mb-1">
                <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <m.icon className="h-3 w-3" />
                  {m.label}
                </span>
                {m.delta && (
                  <span className={cn("text-[10px] font-medium", m.delta.better ? "text-emerald-400" : "text-red-400")}>
                    {m.delta.value > 0 ? "+" : ""}
                    {m.delta.value.toFixed(m.label === "HRV" || m.label === "Resting HR" ? 0 : 1)}
                  </span>
                )}
              </div>
              <p className="text-xl font-bold leading-tight">{m.value}</p>
              {m.hint && <p className="text-[10px] text-muted-foreground mt-0.5">{m.hint}</p>}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
