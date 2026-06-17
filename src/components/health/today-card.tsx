"use client";

import * as React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils/cn";
import { Activity, Battery, Dumbbell, HeartPulse, Info, Moon, Sunrise, TrendingDown, TrendingUp } from "lucide-react";
import { format } from "date-fns";

type Level = "recover" | "easy" | "moderate" | "hard";
type Recovery = "green" | "yellow" | "red" | "unknown";

interface DayScore {
  date: string;
  total: number;
  recovery: Recovery;
  acwr: number | null;
  components: {
    sleep: number | null;
    hrv: number | null;
    rhr: number | null;
    bodyBattery: number | null;
    subjective: number | null;
  };
  suggestion: {
    level: Level;
    headline: string;
    reason: string[];
  };
  tomorrow: {
    level: Level;
    headline: string;
    focus: string;
    reminders: string[];
  };
  workoutsToday: number;
  workoutMinutesToday: number;
  hasJournal: boolean;
  waitingForGarmin?: boolean;
}

interface ScoreResponse {
  days: DayScore[];
}

const RECOVERY_COLOR: Record<Recovery, string> = {
  green: "bg-emerald-500/20 text-emerald-400 border-emerald-500/40",
  yellow: "bg-amber-500/20 text-amber-400 border-amber-500/40",
  red: "bg-red-500/20 text-red-400 border-red-500/40",
  unknown: "bg-muted text-muted-foreground border-border",
};

const RECOVERY_LABEL: Record<Recovery, string> = {
  green: "Bereit",
  yellow: "Vorsichtig",
  red: "Erholen",
  unknown: "Unbekannt",
};

const LEVEL_LABEL: Record<Level, string> = {
  recover: "Recovery",
  easy: "Leicht",
  moderate: "Moderat",
  hard: "Hart",
};

const LEVEL_COLOR: Record<Level, string> = {
  recover: "bg-blue-500/20 text-blue-400 border-blue-500/40",
  easy: "bg-emerald-500/20 text-emerald-400 border-emerald-500/40",
  moderate: "bg-amber-500/20 text-amber-400 border-amber-500/40",
  hard: "bg-red-500/20 text-red-400 border-red-500/40",
};

function scoreColor(s: number): string {
  if (s >= 75) return "text-emerald-400";
  if (s >= 55) return "text-amber-400";
  if (s >= 35) return "text-orange-400";
  return "text-red-400";
}

function scoreBg(s: number): string {
  if (s >= 75) return "bg-emerald-400";
  if (s >= 55) return "bg-amber-400";
  if (s >= 35) return "bg-orange-400";
  return "bg-red-400";
}

function Donut({ value, onClick }: { value: number; onClick?: () => void }) {
  const radius = 48;
  const circ = 2 * Math.PI * radius;
  const offset = circ - (value / 100) * circ;
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative h-32 w-32 group focus:outline-none"
      title="Klick fuer Erklaerung"
    >
      <svg className="-rotate-90" viewBox="0 0 110 110" width="128" height="128">
        <circle cx="55" cy="55" r={radius} stroke="currentColor" strokeWidth="8" fill="none" className="text-muted/30" />
        <circle
          cx="55"
          cy="55"
          r={radius}
          stroke="currentColor"
          strokeWidth="8"
          fill="none"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className={scoreColor(value)}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <p className={cn("text-4xl font-bold", scoreColor(value))}>{value}</p>
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5 flex items-center gap-0.5">
          Day Score <Info className="h-2.5 w-2.5 opacity-50 group-hover:opacity-100" />
        </p>
      </div>
    </button>
  );
}

function ScoreInfoPanel({ value, components, recovery }: {
  value: number;
  components: { sleep: number | null; hrv: number | null; rhr: number | null; bodyBattery: number | null; subjective: number | null };
  recovery: Recovery;
}) {
  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3 text-sm">
      <div className="flex items-start gap-2">
        <Info className="h-4 w-4 text-primary mt-0.5 shrink-0" />
        <div className="space-y-1">
          <p className="font-semibold">Was sagt der Day Score?</p>
          <p className="text-muted-foreground text-xs leading-relaxed">
            Eine Zahl 0-100 die deinen aktuellen Erholungs-Zustand zusammenfasst. Gemischt aus
            Schlaf (30%), HRV vs 28d-Baseline (25%), Resting HR vs Baseline (20%),
            Bereitschaft / Body Battery (15%), Subjektiv aus Journal (10%).
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
        {[
          { k: "Schlaf 30%", v: components.sleep },
          { k: "HRV 25%", v: components.hrv },
          { k: "RHR 20%", v: components.rhr },
          { k: "Bereitschaft 15%", v: components.bodyBattery },
          { k: "Subjektiv 10%", v: components.subjective },
        ].map((c) => (
          <div key={c.k} className="bg-muted/30 rounded p-2">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{c.k}</p>
            <p className={cn("font-bold mt-0.5", c.v === null ? "text-muted-foreground" : scoreColor(c.v))}>
              {c.v === null ? "—" : Math.round(c.v)}
            </p>
          </div>
        ))}
      </div>
      <div className="text-xs text-muted-foreground space-y-1">
        <p>
          <span className="font-medium text-foreground">Skala</span>: 75+ super,
          55-74 ok, 35-54 schwach, &lt;35 kritisch. Dein Score: <span className={cn("font-bold", scoreColor(value))}>{value}</span>.
        </p>
        <p>
          <span className="font-medium text-foreground">Recovery-Status</span> ist eine Ampel aus
          HRV+RHR+Schlaf alleine — geht es deinem Koerper gut? Aktuell: {recovery}.
        </p>
        {components.subjective === null && (
          <p className="text-amber-300/90">
            <span className="font-medium">Subjektiv leer</span>: noch kein Journal-Eintrag heute oder gestern.
            Trag im Tages-Journal unten Mood/Energy/Soreness ein — fliesst dann mit 10% in den Score.
          </p>
        )}
      </div>
    </div>
  );
}

function MiniBar({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number | null;
  icon: React.ComponentType<{ className?: string }>;
}) {
  const v = value ?? 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Icon className="h-3 w-3" />
          {label}
        </span>
        <span className={cn("font-medium", value === null ? "text-muted-foreground" : scoreColor(v))}>
          {value === null ? "—" : Math.round(v)}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all", value === null ? "bg-muted" : scoreBg(v))}
          style={{ width: value === null ? "0%" : `${v}%` }}
        />
      </div>
    </div>
  );
}

export function TodayCard() {
  const todayKey = format(new Date(), "yyyy-MM-dd");
  const { data, isLoading } = useQuery<ScoreResponse>({
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

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">Berechne Day Score...</CardContent>
      </Card>
    );
  }

  const today = data?.days[0];
  if (!today) return null;

  if (today.waitingForGarmin) {
    return <WaitingForGarminCard date={today.date} />;
  }

  return <TodayCardInner today={today} />;
}

function WaitingForGarminCard({ date }: { date: string }) {
  return (
    <Card className="overflow-hidden border-amber-500/30">
      <CardContent className="p-5 space-y-2">
        <p className="text-[10px] uppercase tracking-wider text-amber-300">Warte auf Garmin-Sync</p>
        <h2 className="text-lg font-bold">Day-Score noch nicht berechenbar</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Fuer {format(new Date(date), "EEEE, d. MMM")} liegen noch keine Schlaf- oder HRV-Daten von
          Garmin vor. Ohne diese Recovery-Signale ist eine Score-Berechnung nicht aussagekraeftig.
          Sobald die Daten synchronisiert sind (meist nach dem ersten Sync am Morgen), erscheint hier
          dein Score und die Empfehlung.
        </p>
        <p className="text-xs text-muted-foreground">
          Tipp: rechts oben auf den Refresh-Button klicken um einen Sync anzustossen.
        </p>
      </CardContent>
    </Card>
  );
}

function TodayCardInner({ today }: { today: DayScore }) {
  const [showInfo, setShowInfo] = React.useState(false);
  const acwrText =
    today.acwr === null
      ? "Noch keine Trainingsdaten"
      : today.acwr < 0.8
        ? `Unterfordert (${today.acwr.toFixed(2)})`
        : today.acwr <= 1.3
          ? `Optimal (${today.acwr.toFixed(2)})`
          : today.acwr <= 1.5
            ? `Hoch (${today.acwr.toFixed(2)})`
            : `Risiko (${today.acwr.toFixed(2)})`;

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-5 space-y-4">
        {showInfo && (
          <ScoreInfoPanel
            value={today.total}
            components={today.components}
            recovery={today.recovery}
          />
        )}
        <div className="flex flex-col lg:flex-row gap-6 items-start">
          <div className="flex flex-col items-center gap-3 lg:w-44 shrink-0">
            <Donut value={today.total} onClick={() => setShowInfo((v) => !v)} />
            <div className="flex flex-wrap gap-2 justify-center">
              <span className={cn("px-2.5 py-0.5 rounded-full text-[10px] uppercase tracking-wider font-medium border", RECOVERY_COLOR[today.recovery])}>
                Recovery: {RECOVERY_LABEL[today.recovery]}
              </span>
              <span className={cn("px-2.5 py-0.5 rounded-full text-[10px] uppercase tracking-wider font-medium border", LEVEL_COLOR[today.suggestion.level])}>
                {LEVEL_LABEL[today.suggestion.level]}
              </span>
            </div>
          </div>

          <div className="flex-1 space-y-4 min-w-0">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Empfehlung heute</p>
              <h2 className="text-xl font-bold mt-0.5">{today.suggestion.headline}</h2>
              <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                {today.suggestion.reason.map((r, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-primary mt-0.5">·</span>
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              <MiniBar label="Schlaf" value={today.components.sleep} icon={Moon} />
              <MiniBar label="HRV" value={today.components.hrv} icon={HeartPulse} />
              <MiniBar label="RHR" value={today.components.rhr} icon={HeartPulse} />
              <MiniBar label="Bereitschaft" value={today.components.bodyBattery} icon={Battery} />
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground pt-1">
              <div className="flex items-center gap-1.5">
                <Dumbbell className="h-3.5 w-3.5" />
                <span>Heute trainiert:</span>
                <span className="font-medium text-foreground">
                  {today.workoutsToday === 0
                    ? "nichts"
                    : `${today.workoutsToday}x · ${today.workoutMinutesToday}min`}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <Activity className="h-3.5 w-3.5" />
                <span>ACWR 7/28d:</span>
                <span className="font-medium text-foreground">{acwrText}</span>
                {today.acwr !== null && today.acwr > 1.3 && <TrendingUp className="h-3.5 w-3.5 text-amber-400" />}
                {today.acwr !== null && today.acwr < 0.8 && <TrendingDown className="h-3.5 w-3.5 text-blue-400" />}
              </div>
            </div>
          </div>
        </div>

        {today.tomorrow && (
          <div className="mt-5 pt-5 border-t border-border/40">
            <div className="flex items-start gap-3">
              <div className="h-9 w-9 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
                <Sunrise className="h-4 w-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Morgen</p>
                  <span className={cn("px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wider font-medium border", LEVEL_COLOR[today.tomorrow.level])}>
                    {LEVEL_LABEL[today.tomorrow.level]}
                  </span>
                </div>
                <p className="text-base font-semibold">{today.tomorrow.headline}</p>
                <p className="text-sm text-muted-foreground">
                  <span className="text-primary">› </span>
                  {today.tomorrow.focus}
                </p>
                {today.tomorrow.reminders.length > 0 && (
                  <ul className="space-y-0.5 pt-1">
                    {today.tomorrow.reminders.map((r, i) => (
                      <li key={i} className="text-xs text-muted-foreground flex gap-2">
                        <span className="text-primary/60">·</span>
                        <span>{r}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
