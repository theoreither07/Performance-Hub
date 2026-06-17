"use client";

/**
 * Phase-1 Hero-Karte. Loest TodayCard + AiCoachCard + IntensityIndicator ab.
 *
 * Architektur:
 *   1) BEREITSCHAFT (one composite score) + 4 transparente Rohwerte (Sleep, HRV, Subj, Load)
 *   2) Coach-Status-Headline + Suggestion-Level (Recovery/Easy/Moderate/Hard)
 *   3) AKTION JETZT — der erste Coach-Vorschlag (1-3 Saetze)
 *   4) Klappbar: Volle Coach-Text-Sektionen + Garmin-Sekundaerwerte
 */

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils/cn";
import {
  Activity, AlertTriangle, ChevronDown, Dumbbell, Footprints, HeartPulse, Moon,
  RefreshCw, Sparkles, Sunrise, Target, TrendingDown, TrendingUp,
} from "lucide-react";
import { addDays, format, parseISO } from "date-fns";
import { de } from "@/lib/i18n/date-locale";
import { SleepInsightsModal } from "@/components/health/sleep-insights-modal";

type Level = "recover" | "easy" | "moderate" | "hard";
type Recovery = "green" | "yellow" | "red" | "unknown";

interface PlannedSlim {
  type: string;
  name: string;
  distanceKm?: number | null;
}

interface DayScore {
  date: string;
  total: number;
  recovery: Recovery;
  components: {
    subjective: number | null;
    hrv: number | null;
    sleep: number | null;
    rhr: number | null;
    load: number | null;
    bodyBattery: number | null;
  };
  suggestion: { level: Level; headline: string; reason: string[] };
  acwr: number | null;
  workoutsToday: number;
  workoutMinutesToday: number;
  plannedToday?: PlannedSlim[];
  plannedTomorrow?: PlannedSlim[];
  waitingForGarmin?: boolean;
}

interface WeeklyProgress {
  strengthDone: number;
  strengthTarget: number;
  runsDone: number;
  runsTarget: number;
  hasLongRun: boolean;
}

interface Recommendation {
  id: string;
  generatedAt: string;
  provider: string;
  model: string;
  phase: string | null;
  statusFocus: string | null;
  actionsNow: string | null;
  eveningPrep: string | null;
  tomorrowSetup: string | null;
  strengthIntensity: number | null;
  cardioIntensity: number | null;
  intensityReason: string | null;
  errorMessage: string | null;
}

interface ScoreResponse {
  days: DayScore[];
  weekly?: WeeklyProgress | null;
  profile?: { longRunKm: number | null } | null;
  todayRaw?: {
    sleepMinutes: number | null;
    sleepMinutesDate?: string | null;
    sleepMinutesFallback?: boolean;
    sleepScore: number | null;
    hrvMs: number | null;
    hrvDate?: string | null;
    hrvFallback?: boolean;
    rhrBpm: number | null;
    rhrDate?: string | null;
    rhrFallback?: boolean;
  };
}

const LEVEL_LABEL: Record<Level, string> = {
  recover: "Recovery",
  easy: "Easy",
  moderate: "Moderat",
  hard: "Hart",
};

const LEVEL_RING: Record<Level, string> = {
  recover: "stroke-blue-400",
  easy: "stroke-emerald-400",
  moderate: "stroke-amber-400",
  hard: "stroke-red-400",
};

const LEVEL_BADGE: Record<Level, string> = {
  recover: "bg-blue-500/20 text-blue-300 border-blue-500/40",
  easy: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
  moderate: "bg-amber-500/20 text-amber-300 border-amber-500/40",
  hard: "bg-red-500/20 text-red-300 border-red-500/40",
};

function scoreColor(s: number): string {
  if (s >= 80) return "text-emerald-400";
  if (s >= 60) return "text-amber-400";
  if (s >= 40) return "text-orange-400";
  return "text-red-400";
}

function scoreRing(s: number): string {
  if (s >= 80) return "stroke-emerald-400";
  if (s >= 60) return "stroke-amber-400";
  if (s >= 40) return "stroke-orange-400";
  return "stroke-red-400";
}

function ReadyDonut({ value, level, sublabel }: { value: number; level: Level; sublabel: string }) {
  const radius = 56;
  const circ = 2 * Math.PI * radius;
  const offset = circ - (value / 100) * circ;
  return (
    <div className="relative h-36 w-36 shrink-0">
      <svg className="-rotate-90" viewBox="0 0 140 140" width="144" height="144">
        <circle cx="70" cy="70" r={radius} strokeWidth="10" fill="none" className="stroke-muted/30" />
        <circle
          cx="70" cy="70" r={radius} strokeWidth="10" fill="none"
          strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
          className={cn("transition-all duration-700", scoreRing(value))}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <p className={cn("text-4xl font-black tabular-nums leading-none", scoreColor(value))}>{value}</p>
        <p className="text-[9px] uppercase tracking-wider text-muted-foreground mt-1 text-center px-2 leading-tight">{sublabel}</p>
        <span className={cn("mt-1.5 px-2 py-0.5 rounded-full text-[9px] uppercase tracking-wider font-medium border", LEVEL_BADGE[level])}>
          {LEVEL_LABEL[level]}
        </span>
      </div>
    </div>
  );
}

function Sparkline({ values, tone }: { values: (number | null)[]; tone: "good" | "warn" | "bad" | "neutral" }) {
  const numeric = values.filter((v): v is number => v !== null);
  if (numeric.length < 2) return null;
  const W = 60;
  const H = 14;
  const min = Math.min(...numeric);
  const max = Math.max(...numeric);
  const range = max - min || 1;
  const stroke =
    tone === "good" ? "#34d399"
    : tone === "warn" ? "#fbbf24"
    : tone === "bad" ? "#f87171"
    : "#a1a1aa";
  const pts: string[] = [];
  values.forEach((v, i) => {
    if (v === null) return;
    const x = (i / Math.max(1, values.length - 1)) * W;
    const y = H - ((v - min) / range) * (H - 2) - 1;
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  });
  if (pts.length < 2) return null;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-3 mt-0.5" preserveAspectRatio="none">
      <polyline points={pts.join(" ")} fill="none" stroke={stroke} strokeWidth={1} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  hint,
  tone,
  sparkline,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  hint?: string;
  tone?: "good" | "warn" | "bad" | "neutral";
  sparkline?: (number | null)[];
}) {
  const toneCls =
    tone === "good" ? "text-emerald-300"
    : tone === "warn" ? "text-amber-300"
    : tone === "bad" ? "text-red-300"
    : "text-foreground";
  return (
    <div className="rounded-lg bg-muted/30 px-3 py-2 space-y-0.5 min-w-0">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3 w-3 shrink-0" />
        <span className="truncate">{label}</span>
      </div>
      <p className={cn("text-sm font-bold tabular-nums truncate", toneCls)}>{value}</p>
      {hint && <p className="text-[10px] text-muted-foreground truncate">{hint}</p>}
      {sparkline && sparkline.length >= 2 && <Sparkline values={sparkline} tone={tone ?? "neutral"} />}
    </div>
  );
}

function firstSentence(text: string | null): string {
  if (!text) return "";
  const stripped = text
    .replace(/`+/g, "")
    .replace(/\*+/g, "")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  // Erstes prosa-Stueck holen, leading "Label - " entfernen
  const noLead = stripped.replace(/^[A-Za-zÄÖÜäöüß0-9 /-]{3,30}?(?: [-–—] |: )/, "").trim();
  const m = noLead.match(/^[^.!?]+[.!?]+/);
  const s = m ? m[0].trim() : noLead.slice(0, 160);
  return s.length > 160 ? s.slice(0, 157) + "..." : s;
}

function Markdown({ text }: { text: string }) {
  // Sehr kompakter Markdown-Render fuer Coach-Output
  const lines = text.split("\n");
  return (
    <div className="space-y-2 text-sm">
      {lines.map((line, i) => {
        if (!line.trim()) return null;
        if (line.startsWith("### ")) {
          return (
            <p
              key={i}
              className="text-xs uppercase tracking-wider text-primary/80 font-semibold mt-3"
              dangerouslySetInnerHTML={{ __html: formatBold(line.replace(/^### /, "")) }}
            />
          );
        }
        if (line.startsWith("## ")) return null; // Sektion-Header skippen, sind in Tabs
        if (/^[-*]\s/.test(line)) {
          const inner = line.replace(/^[-*]\s+/, "");
          return (
            <p key={i} className="text-foreground/90 pl-3 relative leading-relaxed">
              <span className="absolute left-0 text-primary">›</span>
              <span dangerouslySetInnerHTML={{ __html: formatBold(inner) }} />
            </p>
          );
        }
        return (
          <p key={i} className="text-foreground/90 leading-relaxed" dangerouslySetInnerHTML={{ __html: formatBold(line) }} />
        );
      })}
    </div>
  );
}

function ProgressRow({
  icon: Icon,
  label,
  done,
  target,
  unit,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  done: number;
  target: number;
  unit?: string;
}) {
  const pct = target > 0 ? Math.min(100, (done / target) * 100) : 0;
  const isDone = target > 0 && done >= target;
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-[11px]">
        <Icon className="h-3 w-3 text-muted-foreground shrink-0" />
        <span className="text-muted-foreground">{label}</span>
        <span className={cn("font-bold tabular-nums", isDone ? "text-emerald-300" : "text-foreground")}>
          {done}/{target}
          {unit ? <span className="text-muted-foreground font-normal">{unit}</span> : null}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-muted/40 overflow-hidden">
        <div
          className={cn(
            "h-full transition-all duration-500",
            isDone ? "bg-emerald-400" : pct >= 50 ? "bg-amber-400" : "bg-primary/70",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function nextSessionLabel(
  today: string,
  plannedToday: PlannedSlim[] | undefined,
  plannedTomorrow: PlannedSlim[] | undefined,
): string | null {
  const pickFirst = (items?: PlannedSlim[]) => (items && items.length > 0 ? items[0] : null);
  const heute = pickFirst(plannedToday);
  if (heute) {
    const tail = heute.distanceKm ? ` ${heute.distanceKm}km` : "";
    return `Heute · ${heute.name}${tail}`;
  }
  const morgen = pickFirst(plannedTomorrow);
  if (morgen) {
    const tail = morgen.distanceKm ? ` ${morgen.distanceKm}km` : "";
    const dow = format(addDays(parseISO(today), 1), "EEE", { locale: de });
    return `Morgen (${dow}) · ${morgen.name}${tail}`;
  }
  return null;
}

function formatBold(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*([^*]+)\*\*/g, '<strong class="font-bold text-foreground">$1</strong>');
}

export function CoachHero() {
  const todayKey = format(new Date(), "yyyy-MM-dd");
  const qc = useQueryClient();
  const [sleepModalOpen, setSleepModalOpen] = React.useState(false);
  const scoreQ = useQuery<ScoreResponse>({
    queryKey: ["health-score", "hero", todayKey],
    queryFn: async () => {
      const res = await fetch("/api/health/score?days=7");
      if (!res.ok) throw new Error("score");
      return res.json();
    },
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: true,
  });
  const recoQ = useQuery<{ recommendation: Recommendation | null }>({
    queryKey: ["coach-recommendation", todayKey],
    queryFn: async () => {
      const res = await fetch("/api/coach/generate");
      if (!res.ok) throw new Error("reco");
      return res.json();
    },
    staleTime: 60_000,
  });
  const regen = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/coach/generate", { method: "POST" });
      if (!res.ok) throw new Error("regen");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["coach-recommendation"] });
      qc.invalidateQueries({ queryKey: ["health-score"] });
    },
  });

  // days array kommt absteigend von der API (heute auf Index 0). Fuer Sparklines drehen wir
  // chronologisch um: Index 0 = vor 6 Tagen, Index 6 = heute.
  const today = scoreQ.data?.days[0];
  const reco = recoQ.data?.recommendation;
  const trend = React.useMemo(() => {
    const days = scoreQ.data?.days ?? [];
    if (days.length < 2) return null;
    const asc = [...days].reverse();
    return {
      sleep: asc.map((d) => d.components.sleep),
      hrv: asc.map((d) => d.components.hrv),
      subjective: asc.map((d) => d.components.subjective),
      load: asc.map((d) => d.components.load),
    };
  }, [scoreQ.data]);
  const dataFetchedAt = scoreQ.dataUpdatedAt
    ? format(new Date(scoreQ.dataUpdatedAt), "HH:mm")
    : null;
  const nowHour = new Date().getHours();
  const isEvening = nowHour >= 19 || nowHour < 5 || reco?.phase === "evening";

  if (scoreQ.isLoading || !today) {
    return (
      <Card>
        <CardContent className="p-5">
          <p className="text-sm text-muted-foreground">Lade Bereitschaft...</p>
        </CardContent>
      </Card>
    );
  }

  if (today.waitingForGarmin) {
    return (
      <Card className="border-amber-500/30">
        <CardContent className="p-5 space-y-2">
          <p className="text-[10px] uppercase tracking-wider text-amber-300">Warte auf Garmin-Sync</p>
          <h2 className="text-lg font-bold">Bereitschaft noch nicht berechenbar</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Schlaf- und HRV-Daten fuer heute fehlen noch. Bereitschaft erscheint sobald Garmin gesynct hat.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Component-Werte fuer die 4 Metrik-Tiles
  const c = today.components;
  // Roh-Schlafdauer direkt aus API (kein Back-Compute aus dem geclampten Score).
  const sleepMin = scoreQ.data?.todayRaw?.sleepMinutes ?? null;
  // Roh-HRV in ms — falls vorhanden (Garmin Overnight HRV).
  const hrvMs = scoreQ.data?.todayRaw?.hrvMs ?? null;

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-5 space-y-4">
        {/* Top: Donut + 4 Metrik-Tiles */}
        <div className="flex flex-col md:flex-row gap-5 items-center md:items-start">
          <ReadyDonut
            value={today.total}
            level={today.suggestion.level}
            sublabel={isEvening ? "Snapshot heute morgen" : "Bereitschaft"}
          />
          <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-2 w-full">
            <button
              type="button"
              onClick={() => setSleepModalOpen(true)}
              className="text-left focus:outline-none focus:ring-2 focus:ring-primary/40 rounded-lg"
              aria-label="Sleep-Insights oeffnen"
            >
              <Metric
                icon={Moon}
                label="Schlaf · tap"
                value={sleepMin !== null ? `${Math.floor(Math.round(sleepMin) / 60)}h ${Math.round(sleepMin) % 60}min` : "—"}
                hint={
                  sleepMin === null
                    ? "noch keine Daten"
                    : scoreQ.data?.todayRaw?.sleepMinutesFallback
                    ? `Stand ${scoreQ.data?.todayRaw?.sleepMinutesDate ?? "?"} (Garmin nicht aktuell)`
                    : c.sleep !== null
                    ? `${Math.round(c.sleep)}/100`
                    : undefined
                }
                tone={c.sleep === null ? "neutral" : c.sleep >= 70 ? "good" : c.sleep >= 45 ? "warn" : "bad"}
                sparkline={trend?.sleep}
              />
            </button>
            <Metric
              icon={HeartPulse}
              label="HRV"
              value={hrvMs !== null ? `${Math.round(hrvMs)}ms` : "—"}
              hint={
                hrvMs === null
                  ? "noch keine Daten"
                  : scoreQ.data?.todayRaw?.hrvFallback
                  ? `Stand ${scoreQ.data?.todayRaw?.hrvDate ?? "?"} (Garmin nicht aktuell)`
                  : c.hrv !== null
                  ? `Score ${Math.round(c.hrv)}/100 vs 28d`
                  : undefined
              }
              tone={c.hrv === null ? "neutral" : c.hrv >= 70 ? "good" : c.hrv >= 45 ? "warn" : "bad"}
              sparkline={trend?.hrv}
            />
            <Metric
              icon={Sparkles}
              label="Subjektiv"
              value={c.subjective !== null ? `${Math.round(c.subjective)}` : "—"}
              hint={c.subjective !== null ? "Energy/Mood/Sore" : "Journal fehlt"}
              tone={c.subjective === null ? "neutral" : c.subjective >= 70 ? "good" : c.subjective >= 45 ? "warn" : "bad"}
              sparkline={trend?.subjective}
            />
            <Metric
              icon={Activity}
              label="Load"
              value={today.acwr !== null ? today.acwr.toFixed(2) : "—"}
              hint={
                today.acwr === null ? "noch keine Trainings"
                : today.acwr >= 0.8 && today.acwr <= 1.3 ? "optimal"
                : today.acwr < 0.8 ? "untertrainiert"
                : today.acwr <= 1.5 ? "hoch"
                : "Risiko"
              }
              tone={
                today.acwr === null ? "neutral"
                : today.acwr >= 0.8 && today.acwr <= 1.3 ? "good"
                : today.acwr <= 1.5 && today.acwr >= 0.6 ? "warn"
                : "bad"
              }
              sparkline={trend?.load}
            />
          </div>
        </div>
        {dataFetchedAt && (
          <p className="text-[10px] text-muted-foreground -mt-2 text-right">
            Stand {dataFetchedAt} · Subjektiv & Load aktualisieren live
          </p>
        )}

        {/* Coach Suggestion + Headline */}
        <div className="border-t border-border/30 pt-3 space-y-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Sparkles className="h-3 w-3 text-primary" /> {isEvening ? "Tages-Reflexion" : "Empfehlung heute"}
          </p>
          <h2 className="text-lg font-bold leading-tight">{today.suggestion.headline}</h2>
          {reco?.statusFocus && (
            <p className="text-sm text-muted-foreground italic leading-relaxed">
              {firstSentence(reco.statusFocus)}
            </p>
          )}
          {today.suggestion.reason && today.suggestion.reason.length > 0 && (
            <ul className="space-y-0.5 text-xs text-muted-foreground">
              {today.suggestion.reason.slice(0, 3).map((r, i) => (
                <li key={i} className="pl-3 relative">
                  <span className="absolute left-0 text-muted-foreground/60">·</span>
                  {r}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Aktion JETZT */}
        {reco?.actionsNow && (
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-1">
            <p className="text-[10px] uppercase tracking-wider text-primary font-semibold flex items-center gap-1.5">
              <Sunrise className="h-3 w-3" /> {isEvening ? "Wind-Down jetzt" : "Aktion jetzt"}
            </p>
            <Markdown text={reco.actionsNow.slice(0, 1200)} />
          </div>
        )}

        {/* Setup MORGEN — prominent wenn evening (sonst in klappbar) */}
        {isEvening && reco?.tomorrowSetup && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-1">
            <p className="text-[10px] uppercase tracking-wider text-emerald-300 font-semibold flex items-center gap-1.5">
              <Sunrise className="h-3 w-3" /> Setup Morgen
            </p>
            <Markdown text={reco.tomorrowSetup.slice(0, 1500)} />
          </div>
        )}

        {/* Wochen-Fokus — Progress Kraft/Cardio/Long + Naechste Session */}
        {scoreQ.data?.weekly && (scoreQ.data.weekly.strengthTarget > 0 || scoreQ.data.weekly.runsTarget > 0) && (
          <div className="rounded-lg border border-border/30 p-3 space-y-2">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1.5">
              <Target className="h-3 w-3" /> Wochen-Fokus
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {scoreQ.data.weekly.strengthTarget > 0 && (
                <ProgressRow
                  icon={Dumbbell}
                  label="Kraft"
                  done={scoreQ.data.weekly.strengthDone}
                  target={scoreQ.data.weekly.strengthTarget}
                />
              )}
              {scoreQ.data.weekly.runsTarget > 0 && (
                <ProgressRow
                  icon={Footprints}
                  label="Cardio"
                  done={scoreQ.data.weekly.runsDone}
                  target={scoreQ.data.weekly.runsTarget}
                />
              )}
              {(scoreQ.data.profile?.longRunKm ?? 0) > 0 && (
                <ProgressRow
                  icon={TrendingUp}
                  label="Long Run"
                  done={scoreQ.data.weekly.hasLongRun ? 1 : 0}
                  target={1}
                  unit={` (≥${Math.round((scoreQ.data.profile?.longRunKm ?? 0) * 0.85)}km)`}
                />
              )}
            </div>
            {(() => {
              const label = nextSessionLabel(today.date, today.plannedToday, today.plannedTomorrow);
              return label ? (
                <p className="text-xs text-muted-foreground pt-1 border-t border-border/30">
                  <span className="text-primary">›</span> Nächste: <span className="text-foreground font-medium">{label}</span>
                </p>
              ) : null;
            })()}
          </div>
        )}

        {/* Intensitaet-Hint vom Coach */}
        {(reco?.strengthIntensity !== null || reco?.cardioIntensity !== null) && reco && (
          <div className="flex flex-wrap gap-2 text-xs">
            {reco.strengthIntensity !== null && (
              <Badge variant="outline" className="gap-1">
                <Dumbbell className="h-3 w-3" /> Kraft {reco.strengthIntensity}/10
              </Badge>
            )}
            {reco.cardioIntensity !== null && (
              <Badge variant="outline" className="gap-1">
                <Footprints className="h-3 w-3" /> Cardio {reco.cardioIntensity}/10
              </Badge>
            )}
            {reco.intensityReason && (
              <span className="text-muted-foreground italic">{reco.intensityReason}</span>
            )}
          </div>
        )}

        {/* Klappbar: Heute Abend + Setup morgen + Garmin-Sekundaerwerte */}
        <details className="group rounded-lg border border-border/30">
          <summary className="cursor-pointer list-none select-none flex items-center justify-between p-3 hover:bg-muted/10 transition-colors">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">Mehr — Setup morgen, Garmin-Werte</span>
            <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <div className="px-3 pb-3 space-y-3">
            {reco?.eveningPrep && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Heute Abend</p>
                <Markdown text={reco.eveningPrep} />
              </div>
            )}
            {reco?.tomorrowSetup && !isEvening && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Setup Morgen</p>
                <Markdown text={reco.tomorrowSetup} />
              </div>
            )}
            {c.bodyBattery !== null && (
              <div className="border-t border-border/30 pt-3">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Garmin-Sekundaerwerte</p>
                <div className="flex flex-wrap gap-2 text-xs">
                  <Badge variant="outline">Body Battery Low / Readiness {Math.round(c.bodyBattery)}</Badge>
                  <span className="text-muted-foreground italic">
                    Composite von Garmin. Nicht in Bereitschaft eingerechnet (Black-Box).
                  </span>
                </div>
              </div>
            )}
            {reco?.errorMessage && (
              <div className="border-t border-border/30 pt-3 text-xs text-amber-300 flex items-start gap-1.5">
                <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" /> {reco.errorMessage}
              </div>
            )}
            <div className="flex items-center justify-between pt-2 border-t border-border/30">
              <p className="text-[10px] text-muted-foreground">
                {reco ? `Generiert ${format(new Date(reco.generatedAt), "d. MMM HH:mm")} · ${reco.provider}` : "Kein Coach-Output"}
              </p>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => regen.mutate()}
                disabled={regen.isPending}
                className="h-7 text-xs"
              >
                <RefreshCw className={cn("h-3.5 w-3.5 mr-1", regen.isPending && "animate-spin")} />
                Neu generieren
              </Button>
            </div>
          </div>
        </details>
      </CardContent>
      <SleepInsightsModal open={sleepModalOpen} onClose={() => setSleepModalOpen(false)} />
    </Card>
  );
}
