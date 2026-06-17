"use client";

import { useQuery } from "@tanstack/react-query";
import { CollapsibleCard } from "@/components/ui/collapsible-card";
import { cn } from "@/lib/utils/cn";
import {
  Activity,
  AlertTriangle,
  Brain,
  HeartPulse,
  Moon,
  TrendingDown,
  TrendingUp,
  Minus,
  Calendar,
  Target,
  Sparkles,
} from "lucide-react";
import { format } from "date-fns";

type Status = "ready" | "building" | "fatigued" | "overreached" | "burnout" | "undertrained";
type Trend = "up" | "down" | "stable" | "unknown";
type WeekStrategyType = "build" | "maintain" | "deload" | "recovery" | "ramp-up";

interface Coach {
  status: Status;
  deloadRecommended: boolean;
  flags: { key: string; severity: number; description: string }[];
  signals: {
    wellness7d: number | null;
    wellness28d: number | null;
    wellnessTrend: Trend;
    hrv7d: number | null;
    hrvDeviationPct: number | null;
    hrvTrend: Trend;
    rhr7d: number | null;
    rhrDeltaBpm: number | null;
    rhrTrend: Trend;
    sleepMin7d: number | null;
    sleepTrend: Trend;
    bodyBatteryHigh7d: number | null;
    bodyBatteryHigh14dTrend: number | null;
    daysSinceFullyRecovered: number | null;
    consecutiveLowEnergyDays: number;
    lowEnergyDaysLast7: number;
    highSorenessDaysLast7: number;
    acwr: number | null;
    monotony: number | null;
    strain: number | null;
    vo2max: number | null;
    vo2maxDelta14d: number | null;
    vo2maxDelta30d: number | null;
    vo2maxTrend: Trend;
    z2EfficiencyTrend: Trend;
    z2HrTrend14d: number | null;
    strengthSessions7d: number;
    strengthSessions28d: number;
    weeklyCompliance: {
      strength: { planned: number; actual: number };
      runs: { planned: number; actual: number };
      hasLongRun: boolean;
    };
  };
  weekStrategy: {
    type: WeekStrategyType;
    headline: string;
    rationale: string[];
    hardSessionsTarget: number;
    totalSessionsTarget: number;
    volumeAdjustmentPct: number;
  };
  tomorrow: { level: string; headline: string; focus: string; rationale: string[]; reminders: string[] };
  observations: string[];
  trajectory: {
    fitness: Trend;
    wellness: Trend;
    vo2max: Trend;
    z2Efficiency: Trend;
  };
}

const STATUS_COLOR: Record<Status, string> = {
  ready: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
  building: "bg-blue-500/20 text-blue-300 border-blue-500/40",
  fatigued: "bg-amber-500/20 text-amber-300 border-amber-500/40",
  overreached: "bg-orange-500/20 text-orange-300 border-orange-500/40",
  burnout: "bg-red-500/20 text-red-300 border-red-500/40",
  undertrained: "bg-purple-500/20 text-purple-300 border-purple-500/40",
};

const STATUS_LABEL: Record<Status, string> = {
  ready: "Bereit",
  building: "Aufbau",
  fatigued: "Ermüdet",
  overreached: "Überlastet",
  burnout: "Burnout",
  undertrained: "Unterfordert",
};

const STATUS_DESCRIPTION: Record<Status, string> = {
  ready: "Voll erholt — Belastung passt, Plan voll durchziehen",
  building: "Im Aufbau — moderater Stress, kein Risiko",
  fatigued: "Mehrere Fatigue-Signale — Intensitaet runter",
  overreached: "Akute Überlastung — Deload-Woche empfohlen",
  burnout: "Systemische Erschöpfung — Recovery-Woche zwingend",
  undertrained: "Belastung unter chronischem Schnitt — Volumen hochfahren",
};

const WEEK_LABEL: Record<WeekStrategyType, string> = {
  build: "Build",
  maintain: "Maintain",
  deload: "Deload",
  recovery: "Recovery",
  "ramp-up": "Ramp-Up",
};

const WEEK_COLOR: Record<WeekStrategyType, string> = {
  build: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  maintain: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  deload: "bg-orange-500/15 text-orange-300 border-orange-500/30",
  recovery: "bg-red-500/15 text-red-300 border-red-500/30",
  "ramp-up": "bg-blue-500/15 text-blue-300 border-blue-500/30",
};

function TrendIcon({ trend }: { trend: Trend }) {
  if (trend === "up") return <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />;
  if (trend === "down") return <TrendingDown className="h-3.5 w-3.5 text-red-400" />;
  if (trend === "stable") return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
  return null;
}

function formatSleep(min: number | null): string {
  if (min === null) return "—";
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return `${h}h${m}m`;
}

export function CoachCard() {
  const todayKey = format(new Date(), "yyyy-MM-dd");
  const { data, isLoading } = useQuery<{ coach: Coach }>({
    queryKey: ["health-score", 1, todayKey],
    queryFn: async () => {
      const res = await fetch("/api/health/score?days=1");
      if (!res.ok) throw new Error("score");
      return res.json();
    },
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });

  if (isLoading || !data?.coach) return null;
  const c = data.coach;

  return (
    <CollapsibleCard
      icon={<Brain className="h-4 w-4 text-primary shrink-0" />}
      title={
        <span className="flex items-center gap-2 flex-wrap">
          Coach-Analyse
          <span className={cn("px-2 py-0.5 rounded-full text-[9px] uppercase tracking-wider font-medium border", STATUS_COLOR[c.status])}>
            {STATUS_LABEL[c.status]}
          </span>
          <span className={cn("px-2 py-0.5 rounded-full text-[9px] uppercase tracking-wider font-medium border", WEEK_COLOR[c.weekStrategy.type])}>
            {WEEK_LABEL[c.weekStrategy.type]}
          </span>
        </span>
      }
      subtitle={STATUS_DESCRIPTION[c.status]}
      defaultOpen={false}
    >
      <div className="space-y-5">
        {/* Wochenstrategie */}
        <div className="rounded-lg bg-muted/30 p-3 space-y-1.5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold flex items-center gap-2">
              <Target className="h-3.5 w-3.5 text-primary" />
              {c.weekStrategy.headline}
            </p>
            <span className="text-[10px] text-muted-foreground">
              {c.weekStrategy.hardSessionsTarget} hart · {c.weekStrategy.totalSessionsTarget} gesamt
              {c.weekStrategy.volumeAdjustmentPct !== 0 && (
                <>
                  {" "}
                  ·{" "}
                  <span
                    className={
                      c.weekStrategy.volumeAdjustmentPct > 0 ? "text-emerald-400" : "text-orange-400"
                    }
                  >
                    {c.weekStrategy.volumeAdjustmentPct > 0 ? "+" : ""}
                    {c.weekStrategy.volumeAdjustmentPct}% Volumen
                  </span>
                </>
              )}
            </span>
          </div>
          <ul className="space-y-0.5">
            {c.weekStrategy.rationale.map((r, i) => (
              <li key={i} className="text-xs text-muted-foreground flex gap-2">
                <span className="text-primary/60">·</span>
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Fatigue Flags wenn vorhanden */}
        {c.flags.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
              Fatigue-Signale ({c.flags.length})
            </div>
            <div className="flex flex-wrap gap-1.5">
              {c.flags.map((f) => (
                <span
                  key={f.key}
                  className={cn(
                    "px-2 py-0.5 rounded text-[10px] font-medium border",
                    f.severity >= 3
                      ? "bg-red-500/15 text-red-300 border-red-500/30"
                      : f.severity === 2
                        ? "bg-orange-500/15 text-orange-300 border-orange-500/30"
                        : "bg-amber-500/10 text-amber-300 border-amber-500/30",
                  )}
                  title={`Severity ${f.severity}/3`}
                >
                  {f.description}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Key Signals Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
          <SignalTile
            label="Tage seit voll erholt"
            value={c.signals.daysSinceFullyRecovered}
            format={(v) => `${v}d`}
            tone={(v) => (v === null ? "neutral" : v <= 2 ? "good" : v <= 7 ? "neutral" : "bad")}
          />
          <SignalTile
            label="HRV 7d"
            value={c.signals.hrv7d}
            sub={c.signals.hrvDeviationPct !== null ? `${c.signals.hrvDeviationPct > 0 ? "+" : ""}${c.signals.hrvDeviationPct.toFixed(0)}% vs 28d` : null}
            format={(v) => `${v?.toFixed(0) ?? "—"}ms`}
            trend={c.signals.hrvTrend}
            tone={(v, sub) => {
              if (v === null || sub === null) return "neutral";
              const pct = c.signals.hrvDeviationPct;
              if (pct === null) return "neutral";
              if (pct >= 3) return "good";
              if (pct <= -5) return "bad";
              return "neutral";
            }}
          />
          <SignalTile
            label="RHR 7d"
            value={c.signals.rhr7d}
            sub={c.signals.rhrDeltaBpm !== null ? `${c.signals.rhrDeltaBpm > 0 ? "+" : ""}${c.signals.rhrDeltaBpm.toFixed(1)} vs 28d` : null}
            format={(v) => `${v?.toFixed(0) ?? "—"} bpm`}
            trend={c.signals.rhrTrend}
            tone={() => {
              const d = c.signals.rhrDeltaBpm;
              if (d === null) return "neutral";
              if (d <= -1) return "good";
              if (d >= 2) return "bad";
              return "neutral";
            }}
          />
          <SignalTile
            label="Schlaf 7d"
            value={c.signals.sleepMin7d}
            format={(v) => formatSleep(v)}
            trend={c.signals.sleepTrend}
            tone={(v) => {
              if (v === null) return "neutral";
              if (v >= 7 * 60 + 30) return "good";
              if (v < 7 * 60) return "bad";
              return "neutral";
            }}
          />
          <SignalTile
            label="ACWR 7d/28d"
            value={c.signals.acwr}
            format={(v) => v?.toFixed(2) ?? "—"}
            sub={c.signals.acwr !== null ? acwrLabel(c.signals.acwr) : null}
            tone={() => {
              if (c.signals.acwr === null) return "neutral";
              if (c.signals.acwr < 0.8) return "neutral";
              if (c.signals.acwr <= 1.3) return "good";
              if (c.signals.acwr <= 1.5) return "neutral";
              return "bad";
            }}
          />
          <SignalTile
            label="Wellness 7d"
            value={c.signals.wellness7d}
            format={(v) => v?.toString() ?? "—"}
            sub={c.signals.wellness28d !== null ? `Ø28d ${c.signals.wellness28d}` : null}
            trend={c.signals.wellnessTrend}
            tone={(v) => {
              if (v === null) return "neutral";
              if (v >= 70) return "good";
              if (v < 50) return "bad";
              return "neutral";
            }}
          />
        </div>

        {/* Performance Trajektorie */}
        <div className="pt-2 border-t border-border/30 space-y-2">
          <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <Activity className="h-3.5 w-3.5 text-primary" /> Performance-Trajektorie
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="flex items-center justify-between">
              <span>VO2max</span>
              <span className="flex items-center gap-1.5 text-right">
                {c.signals.vo2max !== null ? (
                  <>
                    <span className="font-medium tabular-nums">{c.signals.vo2max.toFixed(1)}</span>
                    {c.signals.vo2maxDelta30d !== null ? (
                      <span
                        className={cn(
                          "tabular-nums text-[11px]",
                          c.signals.vo2maxDelta30d > 0.3
                            ? "text-emerald-400"
                            : c.signals.vo2maxDelta30d < -0.3
                              ? "text-red-400"
                              : "text-muted-foreground",
                        )}
                      >
                        {c.signals.vo2maxDelta30d > 0 ? "+" : ""}
                        {c.signals.vo2maxDelta30d.toFixed(1)} / 30d
                      </span>
                    ) : (
                      <span className="text-[10px] text-muted-foreground">noch kein Delta</span>
                    )}
                    <TrendIcon trend={c.signals.vo2maxTrend} />
                  </>
                ) : (
                  <span className="text-[11px] text-muted-foreground">noch nicht von Garmin geliefert</span>
                )}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Z2-Effizienz (HR-Drift)</span>
              <span className="flex items-center gap-1.5">
                {c.signals.z2HrTrend14d !== null ? (
                  <span
                    className={cn(
                      "tabular-nums",
                      c.signals.z2HrTrend14d < -0.2
                        ? "text-emerald-400"
                        : c.signals.z2HrTrend14d > 0.2
                          ? "text-red-400"
                          : "text-muted-foreground",
                    )}
                  >
                    {c.signals.z2HrTrend14d > 0 ? "+" : ""}
                    {(c.signals.z2HrTrend14d * 14).toFixed(1)} bpm/14d
                  </span>
                ) : (
                  <span className="text-[11px] text-muted-foreground">noch zu wenig Z2-Daten</span>
                )}
                <TrendIcon trend={c.signals.z2EfficiencyTrend} />
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Wellness 7d</span>
              <span className="flex items-center gap-1.5">
                <span className="font-medium tabular-nums">{c.signals.wellness7d ?? "—"}</span>
                {c.signals.wellness7d !== null && c.signals.wellness28d !== null && (
                  <span className="text-[10px] text-muted-foreground">vs {c.signals.wellness28d}</span>
                )}
                <TrendIcon trend={c.trajectory.wellness} />
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Fitness gesamt</span>
              <span className="flex items-center gap-1.5">
                <span className="text-[11px] text-muted-foreground capitalize">
                  {c.trajectory.fitness === "up"
                    ? "verbessert"
                    : c.trajectory.fitness === "down"
                      ? "rueckläufig"
                      : c.trajectory.fitness === "stable"
                        ? "stabil"
                        : "unklar"}
                </span>
                <TrendIcon trend={c.trajectory.fitness} />
              </span>
            </div>
          </div>
        </div>

        {/* Observations */}
        {c.observations.length > 0 && (
          <div className="pt-2 border-t border-border/30 space-y-1.5">
            <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-primary" /> Was die Daten sagen
            </div>
            <ul className="space-y-1">
              {c.observations.map((o, i) => (
                <li key={i} className="text-xs text-muted-foreground flex gap-2">
                  <span className="text-primary/60 shrink-0">·</span>
                  <span>{o}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </CollapsibleCard>
  );
}

function acwrLabel(acwr: number): string {
  if (acwr < 0.8) return "unterfordert";
  if (acwr <= 1.3) return "optimal";
  if (acwr <= 1.5) return "hoch";
  return "Risiko";
}

function SignalTile({
  label,
  value,
  format,
  sub,
  trend,
  tone,
}: {
  label: string;
  value: number | null;
  format: (v: number | null) => string;
  sub?: string | null;
  trend?: Trend;
  tone?: (v: number | null, sub: string | null | undefined) => "good" | "bad" | "neutral";
}) {
  const t = tone ? tone(value, sub) : "neutral";
  const valueClass =
    t === "good" ? "text-emerald-300" : t === "bad" ? "text-red-300" : "text-foreground";
  return (
    <div className="p-2.5 rounded-md bg-muted/30">
      <div className="flex items-center justify-between mb-0.5">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
        {trend && <TrendIcon trend={trend} />}
      </div>
      <p className={cn("text-lg font-bold leading-tight tabular-nums", valueClass)}>{format(value)}</p>
      {sub && <p className="text-[9px] text-muted-foreground">{sub}</p>}
    </div>
  );
}
