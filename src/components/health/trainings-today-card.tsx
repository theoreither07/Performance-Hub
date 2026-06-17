"use client";

/**
 * Strukturierte Trainings-Heute-Karte — liest direkt aus WeeklyPlan.proposedSlots,
 * KEIN AI-Prose-Rendering. Pro Session:
 *   - Zeit (06:30 - 08:30)
 *   - Titel + Goal-Tag
 *   - Plan-Intensitaet (X/10) + Coach-Adjust (Y/10) basierend auf heutiger Bereitschaft
 *   - Uebungen mit Sets×Reps×Intensitaet + Notes
 *   - Cardio-Block (Zone/HR/Distanz/Pace)
 *   - Worauf achten (Reasoning aus Plan)
 *
 * Wenn kein Plan existiert: kleiner Hinweis + Link auf /health/wochenplan.
 */

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import { Activity, AlertCircle, CheckCircle2, ChevronDown, ChevronRight, Clock, Dumbbell, Footprints, HeartPulse, Loader2, Play, RefreshCw, Sparkles, Target } from "lucide-react";
import { format, startOfWeek } from "date-fns";
import { haptics } from "@/lib/ui/haptics";

interface Exercise {
  name: string;
  sets: number;
  reps: string;
  intensity?: string;
  notes?: string;
}

interface CardioBlock {
  subType?: string;
  distanceKm?: number;
  durationMin?: number;
  zone?: string;
  hrTarget?: number;
}

interface Session {
  start: string;
  end: string;
  type: string;
  title: string;
  intensityStrength?: number;
  intensityCardio?: number;
  exercises?: Exercise[];
  cardio?: CardioBlock | null;
  reasoning?: string;
  conflicts?: string[];
}

interface PlanDay {
  date: string;
  dow: string;
  dayFocus: string;
  sessions: Session[];
}

interface PlanResponse {
  plan: {
    id: string;
    weekStart: string;
    proposedSlots: { days?: PlanDay[]; weekFocus?: string } | null;
    isForCurrentWeek: boolean;
  } | null;
}

interface ScoreResponse {
  days: Array<{ total: number; suggestion: { level: string } }>;
}

function adjustForReadiness(planIntensity: number, readiness: number | null, isGoalSession: boolean): {
  coachAdjust: number;
  reason: string;
} {
  if (readiness === null) return { coachAdjust: planIntensity, reason: "Bereitschaft unbekannt — Plan halten, eigenes Gefühl prüfen" };
  if (readiness >= 80) return { coachAdjust: planIntensity, reason: "Top-Bereitschaft — Plan 1:1, kannst Gas geben" };
  if (readiness >= 65) {
    if (planIntensity >= 7 && !isGoalSession) {
      return { coachAdjust: planIntensity - 1, reason: "Moderate Bereitschaft — Plan -1" };
    }
    return { coachAdjust: planIntensity, reason: isGoalSession ? "Bereitschaft moderat aber Goal-Block — Plan halten" : "Plan halten" };
  }
  if (readiness >= 50) {
    if (planIntensity >= 7) {
      return { coachAdjust: Math.max(4, planIntensity - 2), reason: "Niedrige Bereitschaft — Volumen + Intensität runter (-2 bis -3)" };
    }
    return { coachAdjust: planIntensity, reason: "Bereitschaft niedrig — leichte Session ok, sauber bleiben" };
  }
  return { coachAdjust: planIntensity >= 5 ? 2 : Math.min(planIntensity, 2), reason: "Sehr niedrige Bereitschaft — Session zu Mobility umwidmen" };
}

function GoalTagFromSession(type: string, title: string, intensityStrength?: number, intensityCardio?: number): string {
  const t = title.toLowerCase();
  if (type === "mobility" || t.includes("recovery") || t.includes("mobility")) return "[Recovery]";
  if (type === "strength") return "[Krafterhalt]";
  if (type === "cardio") {
    if (t.includes("long") || t.includes("threshold") || t.includes("tempo") || (intensityCardio ?? 0) >= 6) return "[HM-Sub-1:40]";
    if (t.includes("interval") || t.includes("4×4") || t.includes("hiit")) return "[VO2max-Up]";
    return "[HM-Sub-1:40]";
  }
  return "[Sustain]";
}

function intensityChip(value: number): { label: string; cls: string } {
  if (value >= 8) return { label: "HART", cls: "bg-red-500/20 text-red-300 border-red-500/40" };
  if (value >= 6) return { label: "MODERAT", cls: "bg-amber-500/20 text-amber-300 border-amber-500/40" };
  if (value >= 3) return { label: "LEICHT", cls: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40" };
  return { label: "RECOVERY", cls: "bg-blue-500/20 text-blue-300 border-blue-500/40" };
}

function typeIcon(type: string): React.ComponentType<{ className?: string }> {
  if (type === "strength") return Dumbbell;
  if (type === "cardio") return Footprints;
  if (type === "mobility") return HeartPulse;
  return Activity;
}

interface AdjustmentResponse {
  date: string;
  state: {
    readiness: number | null;
    hrvDropPct: number | null;
    sleepHours: number | null;
    bodyBatteryMax: number | null;
    daysSinceSickness: number | null;
  };
  adjustment: {
    level: "sickness" | "critical" | "low" | "mid" | "good" | "peak";
    isSickness: boolean;
    isRecoveryRamp: boolean;
    globalReason: string;
    recommendations: string[];
    sessions: Array<Session & { wasAdjusted: boolean; original?: Session; adjustmentReason?: string }>;
  };
}

export function TrainingsTodayCard() {
  const todayKey = format(new Date(), "yyyy-MM-dd");
  // Aktuelle Wochen-Montag — EXPLIZIT mitgeben, sonst defaultet die Route auf NAECHSTE Woche
  // und es gibt keinen Eintrag fuer heute.
  const thisMondayKey = format(startOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd");

  // Daily Auto-Adjustment laden
  const adjustQ = useQuery<AdjustmentResponse>({
    queryKey: ["coach-today-adjusted", todayKey],
    queryFn: async () => {
      const res = await fetch("/api/coach/today-adjusted");
      if (!res.ok) throw new Error("adjustment");
      return res.json();
    },
    staleTime: 5 * 60_000,
  });

  const planQ = useQuery<PlanResponse>({
    queryKey: ["coach-week-plan-draft", thisMondayKey],
    queryFn: async () => {
      const res = await fetch(`/api/coach/week-plan/draft?weekStart=${thisMondayKey}`);
      if (!res.ok) throw new Error("draft");
      return res.json();
    },
    staleTime: 60_000,
  });

  const scoreQ = useQuery<ScoreResponse>({
    queryKey: ["health-score", "training-today", todayKey],
    queryFn: async () => {
      const res = await fetch("/api/health/score?days=1");
      if (!res.ok) throw new Error("score");
      return res.json();
    },
    staleTime: 60_000,
  });

  // Gespeicherte Coach-Feedbacks heute (Reload-überlebend)
  const feedbacksQ = useQuery<{ feedbacks: Array<{ sessionTitle: string; summary: SessionFeedback }> }>({
    queryKey: ["session-feedbacks", todayKey],
    queryFn: async () => {
      const res = await fetch(`/api/coach/session-feedback?date=${todayKey}`);
      if (!res.ok) throw new Error("feedbacks");
      return res.json();
    },
    staleTime: 60_000,
  });
  const feedbackByTitle = React.useMemo(() => {
    const m = new Map<string, SessionFeedback>();
    for (const f of feedbacksQ.data?.feedbacks ?? []) m.set(f.sessionTitle, f.summary);
    return m;
  }, [feedbacksQ.data]);

  const todayPlan = React.useMemo<PlanDay | null>(() => {
    const days = planQ.data?.plan?.proposedSlots?.days;
    if (!Array.isArray(days)) return null;
    return days.find((d) => d.date === todayKey) ?? null;
  }, [planQ.data, todayKey]);

  const readiness = scoreQ.data?.days[0]?.total ?? null;

  // Wir definieren "Goal-Session" als Sessions die zur HM-Form direkt beitragen (Cardio Z3+/Long/Threshold)
  const isGoalSession = (s: Session): boolean => {
    if (s.type === "cardio") {
      const t = s.title.toLowerCase();
      if (t.includes("long") || t.includes("threshold") || t.includes("tempo") || (s.intensityCardio ?? 0) >= 6) return true;
    }
    return false;
  };

  if (planQ.isLoading) {
    return (
      <Card>
        <CardContent className="p-4">
          <p className="text-sm text-muted-foreground">Lade Trainings-Plan...</p>
        </CardContent>
      </Card>
    );
  }

  if (!todayPlan || todayPlan.sessions.length === 0) {
    return (
      <Card>
        <CardContent className="p-4 space-y-2">
          <p className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 font-semibold">
            <Target className="h-3.5 w-3.5 text-primary" /> Heutige Trainings
          </p>
          <p className="text-sm text-muted-foreground">
            Heute kein Wochenplan-Eintrag.{" "}
            <Link href="/health/wochenplan" className="text-primary underline">Plan generieren</Link>.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 font-semibold">
            <Target className="h-3.5 w-3.5 text-primary" /> Heute · {todayPlan.dow}
          </p>
          {readiness !== null && (
            <span className="text-[10px] text-muted-foreground">
              Bereitschaft <span className="text-foreground font-bold tabular-nums">{readiness}</span>
            </span>
          )}
        </div>
        {todayPlan.dayFocus && (
          <p className="text-sm text-foreground/90 italic">{todayPlan.dayFocus}</p>
        )}

        {/* Daily Auto-Adjustment Banner — zeigt Anpassungs-Logik des Coaches */}
        {adjustQ.data && adjustQ.data.adjustment.level !== "good" && adjustQ.data.adjustment.level !== "peak" && (
          <div className={cn(
            "rounded-lg border p-3 space-y-2",
            adjustQ.data.adjustment.isSickness ? "border-red-500/40 bg-red-500/10"
              : adjustQ.data.adjustment.level === "critical" ? "border-orange-500/40 bg-orange-500/10"
              : adjustQ.data.adjustment.level === "low" ? "border-amber-500/40 bg-amber-500/10"
              : "border-blue-500/40 bg-blue-500/10",
          )}>
            <div className="flex items-start gap-2">
              <AlertCircle className={cn(
                "h-4 w-4 mt-0.5 shrink-0",
                adjustQ.data.adjustment.isSickness ? "text-red-300"
                  : adjustQ.data.adjustment.level === "critical" ? "text-orange-300"
                  : adjustQ.data.adjustment.level === "low" ? "text-amber-300"
                  : "text-blue-300",
              )} />
              <div className="flex-1 min-w-0">
                <p className="text-xs uppercase tracking-wider font-bold mb-0.5">
                  {adjustQ.data.adjustment.isSickness ? "Sickness erkannt"
                    : adjustQ.data.adjustment.isRecoveryRamp ? `Recovery-Ramp (Tag ${adjustQ.data.state.daysSinceSickness} nach Krankheit)`
                    : adjustQ.data.adjustment.level === "critical" ? "Kritische Bereitschaft"
                    : adjustQ.data.adjustment.level === "low" ? "Niedrige Bereitschaft"
                    : "Coach-Anpassung"}
                </p>
                <p className="text-sm leading-snug text-foreground/95">{adjustQ.data.adjustment.globalReason}</p>
                {adjustQ.data.adjustment.recommendations.length > 0 && (
                  <ul className="mt-2 space-y-0.5 text-xs">
                    {adjustQ.data.adjustment.recommendations.map((r, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-foreground/80">
                        <span className="text-muted-foreground mt-0.5">›</span>
                        <span>{r}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {adjustQ.data.state.hrvDropPct !== null && (
                  <p className="text-[10px] text-muted-foreground mt-1.5 tabular-nums">
                    HRV {adjustQ.data.state.hrvDropPct.toFixed(0)}% vs Baseline
                    {adjustQ.data.state.sleepHours !== null && ` · ${adjustQ.data.state.sleepHours.toFixed(1)}h Schlaf`}
                    {adjustQ.data.state.bodyBatteryMax !== null && ` · BB max ${adjustQ.data.state.bodyBatteryMax}`}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="space-y-3">
          {todayPlan.sessions.map((s, i) => {
            // Adjusted Session lookup per Index (matchen via title oder position)
            const adjusted = adjustQ.data?.adjustment.sessions[i];
            const useAdjusted = adjusted?.wasAdjusted ?? false;
            const sessionToShow = useAdjusted ? {
              ...s,
              type: adjusted!.type,
              title: adjusted!.title,
              exercises: adjusted!.exercises ?? s.exercises,
              cardio: adjusted!.cardio ?? s.cardio,
              reasoning: adjusted!.reasoning ?? s.reasoning,
            } as Session : s;
            return (
              <SessionCard
                key={i}
                session={sessionToShow}
                readiness={readiness}
                isGoal={isGoalSession(s)}
                sessionDate={todayKey}
                initialFeedback={feedbackByTitle.get(s.title) ?? null}
                isAdjusted={useAdjusted}
                adjustmentReason={adjusted?.adjustmentReason}
                originalTitle={useAdjusted ? s.title : undefined}
              />
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function buildHowToSteps(s: Session, coachAdjust: number, reason: string): string[] {
  const steps: string[] = [];
  steps.push(`Aufwaerm-Phase 8-10 min: dynamische Mobility (Hüfte/Schulter), 2-3 min lockeres Cardio.`);
  if (s.type === "strength") {
    steps.push(`Erste Übung: 2 Warm-up-Saetze mit ~50% des Arbeitsgewichts, dann erst die Arbeitssaetze (${s.exercises?.[0]?.sets ?? 4} × ${s.exercises?.[0]?.reps ?? "8"}).`);
    steps.push(`Tempo: 2-3 Sek. exzentrisch, 0-1 Sek. Pause, kontrolliert hoch. Letzte 2 Wdh. mit RIR 1-2.`);
    steps.push(`Pause zwischen Saetzen: ${coachAdjust >= 7 ? "90-180 sec (schwere Saetze)" : "60-90 sec"}.`);
    steps.push(`Nach jeder Uebung kurz checken: Form sauber? Wenn die Bahn schlechter wird, Saetze beenden statt erzwingen.`);
  } else if (s.type === "cardio" || s.type === "long_cardio") {
    const zone = s.cardio?.zone ?? (coachAdjust >= 6 ? "Z3/Threshold" : "Z2");
    const hrCap = s.cardio?.hrTarget ? `HR < ${s.cardio.hrTarget} bpm` : "Atmung Nase moeglich, Sprechen mit kurzen Saetzen";
    steps.push(`Erste 10 min Build-Up: locker beginnen, dann auf ${zone} hochfahren.`);
    steps.push(`Steady-State: Cadence stabil halten (rund 175-180 spm), ${hrCap}.`);
    if (s.cardio?.distanceKm) steps.push(`Pacing-Anker: ${s.cardio.distanceKm} km. Bei Bedarf 1-2 km vor Schluss tempo etwas hochziehen.`);
    steps.push(`Cool-down: letzte 5 min lockern, Atem normalisieren.`);
  } else if (s.type === "mobility") {
    steps.push(`5-8 Stationen je 60-90 sec: Hüftöffner, Brust-/Schulter-Öffnung, Ankle-Mobility, Thoracic-Spine-Rotation.`);
    steps.push(`Atmung: durch Nase ein-/aus, 4 sec ein / 6 sec aus. Beruhigt Vagus-Tonus.`);
    steps.push(`Kein RPE > 4. Fokus ist Range-of-Motion, nicht Burn.`);
  }
  steps.push(`Coach-Empfehlung heute: ${reason.toLowerCase()}.`);
  steps.push(`Nach der Session: 30-60 g Protein in 60 min, viel Wasser, kurzer Walk hilft Recovery-Start.`);
  return steps;
}

interface SessionFeedback {
  headline: string;
  bullets: string[];
  nextSetup: string;
}

interface WorkoutOption {
  id: string;
  type: string;
  name: string | null;
  startTime: string;
  durationMin: number;
  distanceKm: number | null;
  avgHr: number | null;
  trainingLoad: number | null;
  source: string;
}

function SessionCard({
  session: s, readiness, isGoal, sessionDate, initialFeedback,
  isAdjusted, adjustmentReason, originalTitle,
}: {
  session: Session;
  readiness: number | null;
  isGoal: boolean;
  sessionDate: string;
  initialFeedback: SessionFeedback | null;
  isAdjusted?: boolean;
  adjustmentReason?: string;
  originalTitle?: string;
}) {
  const qc = useQueryClient();
  const Icon = typeIcon(s.type);
  const planIntensity = s.type === "strength" ? (s.intensityStrength ?? 5) : (s.intensityCardio ?? 4);
  const { coachAdjust, reason } = adjustForReadiness(planIntensity, readiness, isGoal);
  const chip = intensityChip(coachAdjust);
  const goalTag = GoalTagFromSession(s.type, s.title, s.intensityStrength, s.intensityCardio);
  const intensityAdjusted = coachAdjust !== planIntensity;
  const [howToOpen, setHowToOpen] = React.useState(false);
  const [feedback, setFeedback] = React.useState<SessionFeedback | null>(initialFeedback);

  // Wenn initialFeedback nachträglich rein kommt (Query lädt) → setzen.
  React.useEffect(() => {
    if (initialFeedback && !feedback) setFeedback(initialFeedback);
  }, [initialFeedback, feedback]);

  const howToSteps = React.useMemo(() => buildHowToSteps(s, coachAdjust, reason), [s, coachAdjust, reason]);

  // Workout-Picker-State: nach Erledigt-Klick zeigen wir erst Picker, dann Coach-Analyse.
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [showOtherTypes, setShowOtherTypes] = React.useState(false);

  // Tages-Workouts laden (für Picker) — nur wenn picker offen
  const workoutsQ = useQuery<{ workouts: WorkoutOption[] }>({
    queryKey: ["workouts-on-day", sessionDate],
    queryFn: async () => {
      const res = await fetch(`/api/health/workouts-on-day?date=${sessionDate}`);
      if (!res.ok) throw new Error("workouts");
      return res.json();
    },
    enabled: pickerOpen,
    staleTime: 30_000,
  });

  // Type-Match-Helper: passt der Workout-Type zum Plan-SessionType?
  const matchesType = React.useCallback((workoutType: string): boolean => {
    const wt = workoutType.toLowerCase();
    if (s.type === "strength") return wt.includes("strength") || wt.includes("weight");
    if (s.type === "cardio" || s.type === "long_cardio") {
      return wt.includes("run") || wt.includes("cycl") || wt.includes("bike")
        || wt.includes("swim") || wt.includes("cardio") || wt.includes("hik")
        || wt.includes("row") || wt.includes("walk") || wt.includes("ski");
    }
    if (s.type === "mobility") return wt.includes("yoga") || wt.includes("stretch") || wt.includes("mobility");
    return false;
  }, [s.type]);

  // Workouts in Matches + Andere splitten (mit Dedup per id — falls Server doch dupliziert)
  const { matchingWorkouts, otherWorkouts } = React.useMemo(() => {
    const all = workoutsQ.data?.workouts ?? [];
    const seen = new Set<string>();
    const deduped = all.filter((w) => {
      if (seen.has(w.id)) return false;
      seen.add(w.id);
      return true;
    });
    return {
      matchingWorkouts: deduped.filter((w) => matchesType(w.type)),
      otherWorkouts: deduped.filter((w) => !matchesType(w.type)),
    };
  }, [workoutsQ.data, matchesType]);

  const submitFeedback = useMutation({
    mutationFn: async (opts: { workoutId?: string; noTracker?: boolean }) => {
      const res = await fetch("/api/coach/session-feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionDate,
          sessionTitle: s.title,
          sessionType: s.type,
          plannedIntensity: planIntensity,
          exercises: s.exercises,
          cardio: s.cardio ?? undefined,
          workoutId: opts.workoutId,
          noTracker: opts.noTracker,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Coach-Analyse fehlgeschlagen");
      return data.summary as SessionFeedback;
    },
    onSuccess: (sum) => {
      setFeedback(sum);
      setPickerOpen(false);
      haptics.success();
      qc.invalidateQueries({ queryKey: ["health-score"] });
      qc.invalidateQueries({ queryKey: ["session-feedbacks"] });
      qc.invalidateQueries({ queryKey: ["vitality"] });
    },
    onError: () => haptics.warn(),
  });

  const triggerSync = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/sync/refresh-all", { method: "POST" });
      if (!res.ok) throw new Error("sync");
      return res.json();
    },
    onSuccess: () => {
      haptics.tap();
      // SW-Cache purgen + nach 15s neu fetchen
      setTimeout(() => {
        if (typeof navigator !== "undefined" && navigator.serviceWorker?.controller) {
          navigator.serviceWorker.controller.postMessage({ type: "purge-health-cache" });
        }
        qc.invalidateQueries({ queryKey: ["workouts-on-day"] });
      }, 15_000);
    },
  });

  // AUTO-ASSIGN: wenn picker offen UND Tages-Workouts geladen UND EXAKT 1 Type-Match
  //   → direkt submitFeedback aufrufen, keinen Picker zeigen. Klare Zuordnung.
  const autoAssignTriedRef = React.useRef(false);
  React.useEffect(() => {
    if (!pickerOpen) {
      autoAssignTriedRef.current = false;
      return;
    }
    if (autoAssignTriedRef.current) return;
    if (workoutsQ.isLoading || !workoutsQ.data) return;
    if (submitFeedback.isPending || submitFeedback.isSuccess) return;
    if (matchingWorkouts.length === 1) {
      autoAssignTriedRef.current = true;
      submitFeedback.mutate({ workoutId: matchingWorkouts[0].id });
    }
  }, [pickerOpen, workoutsQ.isLoading, workoutsQ.data, matchingWorkouts, submitFeedback]);

  return (
    <div className="rounded-lg border border-border/40 overflow-hidden">
      {/* Header */}
      <div className="bg-muted/20 p-3 space-y-1.5">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            <Icon className="h-4 w-4 text-primary shrink-0" />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <p className="font-bold text-sm leading-tight">{s.title}</p>
                {isAdjusted && (
                  <Badge variant="outline" className="text-[9px] uppercase tracking-wider border-amber-500/40 bg-amber-500/10 text-amber-300">
                    Coach-Anpassung
                  </Badge>
                )}
              </div>
              {originalTitle && (
                <p className="text-[10px] text-muted-foreground line-through">{originalTitle}</p>
              )}
              <p className="text-[10px] text-muted-foreground flex items-center gap-1 mt-0.5">
                <Clock className="h-2.5 w-2.5" />
                <span className="tabular-nums">{s.start}–{s.end}</span>
                <span className="text-primary ml-1 font-medium">{goalTag}</span>
              </p>
            </div>
          </div>
          <Badge variant="outline" className={cn("text-[10px] uppercase tracking-wider font-bold border", chip.cls)}>
            {chip.label}
          </Badge>
        </div>
        {adjustmentReason && isAdjusted && (
          <p className="text-[11px] text-amber-200/80 italic leading-snug pt-1 border-t border-amber-500/20">
            {adjustmentReason}
          </p>
        )}
        {/* Intensität-Display */}
        <div className="flex items-center gap-2 text-[11px] pt-1 border-t border-border/30">
          <span className="text-muted-foreground">Plan</span>
          <span className="font-bold tabular-nums">{planIntensity}/10</span>
          <span className="text-muted-foreground">→ Coach</span>
          <span className={cn("font-bold tabular-nums", intensityAdjusted ? "text-amber-300" : "text-emerald-300")}>{coachAdjust}/10</span>
          <span className="text-muted-foreground italic flex-1 truncate" title={reason}>· {reason}</span>
        </div>
      </div>

      {/* Cardio-Block */}
      {s.cardio && (
        <div className="px-3 py-2 border-t border-border/30 space-y-1 text-xs">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Cardio</p>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5">
            {s.cardio.zone && <span><span className="text-muted-foreground">Zone:</span> <span className="font-bold">{s.cardio.zone}</span></span>}
            {s.cardio.hrTarget && <span><span className="text-muted-foreground">HR:</span> <span className="font-bold tabular-nums">&lt;{s.cardio.hrTarget}bpm</span></span>}
            {s.cardio.distanceKm && <span><span className="text-muted-foreground">Distanz:</span> <span className="font-bold tabular-nums">{s.cardio.distanceKm}km</span></span>}
            {s.cardio.durationMin && <span><span className="text-muted-foreground">Dauer:</span> <span className="font-bold tabular-nums">~{s.cardio.durationMin}min</span></span>}
          </div>
        </div>
      )}

      {/* Übungen */}
      {s.exercises && s.exercises.length > 0 && (
        <div className="px-3 py-2 border-t border-border/30 space-y-1.5">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Übungen</p>
          <ul className="space-y-1.5 text-xs">
            {s.exercises.map((ex, j) => (
              <li key={j} className="flex items-start gap-2">
                <ChevronRight className="h-3 w-3 text-primary shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-bold">{ex.name}</span>
                    <span className="tabular-nums text-muted-foreground">{ex.sets}×{ex.reps}</span>
                    {ex.intensity && <span className="text-[10px] uppercase tracking-wider text-amber-300/80">{ex.intensity}</span>}
                  </div>
                  {ex.notes && <p className="text-[11px] text-muted-foreground italic leading-snug mt-0.5">{ex.notes}</p>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Worauf achten */}
      {s.reasoning && (
        <div className="px-3 py-2 border-t border-border/30 bg-amber-500/5">
          <p className="text-[10px] uppercase tracking-wider text-amber-300 flex items-center gap-1.5 mb-1 font-semibold">
            <AlertCircle className="h-2.5 w-2.5" /> Worauf achten
          </p>
          <p className="text-xs text-foreground/90 leading-snug">{s.reasoning}</p>
        </div>
      )}

      {/* Konflikte mit Kalender */}
      {s.conflicts && s.conflicts.length > 0 && (
        <div className="px-3 py-2 border-t border-border/30 bg-blue-500/5">
          <p className="text-[10px] uppercase tracking-wider text-blue-300 mb-1">Kalender-Hinweis</p>
          <p className="text-xs text-muted-foreground italic">{s.conflicts.join(" · ")}</p>
        </div>
      )}

      {/* "Wie angehen" — klappbar, step-by-step Anleitung */}
      <div className="border-t border-border/30">
        <button
          type="button"
          onClick={() => { setHowToOpen((v) => !v); haptics.tap(); }}
          className="w-full px-3 py-2 flex items-center justify-between gap-2 hover:bg-muted/10 transition-colors"
          aria-expanded={howToOpen}
        >
          <span className="text-[10px] uppercase tracking-wider text-primary font-semibold flex items-center gap-1.5">
            <Play className="h-3 w-3" /> Wie angehen — Step by Step
          </span>
          <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", howToOpen && "rotate-180")} />
        </button>
        {howToOpen && (
          <ol className="px-3 pb-3 space-y-1.5 text-xs text-foreground/90">
            {howToSteps.map((step, i) => (
              <li key={i} className="flex gap-2 leading-snug">
                <span className="shrink-0 h-4 w-4 rounded-full bg-primary/15 text-primary text-[10px] font-bold flex items-center justify-center tabular-nums mt-0.5">{i + 1}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        )}
      </div>

      {/* "Erledigt"-Button + Workout-Picker + Coach-Feedback */}
      <div className="border-t border-border/30 p-3 space-y-2">
        {!feedback && !pickerOpen && !submitFeedback.isPending && (
          <Button
            type="button"
            onClick={() => { setPickerOpen(true); haptics.tap(); }}
            size="sm"
            variant="outline"
            className="w-full text-xs"
          >
            <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
            Workout erledigt — Coach-Analyse
          </Button>
        )}

        {pickerOpen && !feedback && (
          <WorkoutPicker
            sessionType={s.type}
            matchingWorkouts={matchingWorkouts}
            otherWorkouts={otherWorkouts}
            isLoading={workoutsQ.isLoading}
            showOtherTypes={showOtherTypes}
            setShowOtherTypes={setShowOtherTypes}
            onPickWorkout={(id) => { haptics.tap(); submitFeedback.mutate({ workoutId: id }); }}
            onNoTracker={() => { haptics.tap(); submitFeedback.mutate({ noTracker: true }); }}
            onCancel={() => { setPickerOpen(false); setShowOtherTypes(false); haptics.tap(); }}
            onSync={() => triggerSync.mutate()}
            syncPending={triggerSync.isPending}
            submitPending={submitFeedback.isPending}
          />
        )}

        {submitFeedback.isPending && (
          <Button type="button" disabled size="sm" variant="outline" className="w-full text-xs">
            <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            Coach analysiert...
          </Button>
        )}
        {submitFeedback.isError && (
          <p className="text-[11px] text-red-400 italic">
            {(submitFeedback.error as Error)?.message}
          </p>
        )}
        {feedback && (
          <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-3 space-y-2">
            <div className="flex items-start gap-2">
              <Sparkles className="h-3.5 w-3.5 text-emerald-300 shrink-0 mt-0.5" />
              <p className="text-sm font-semibold text-emerald-100 leading-snug">{feedback.headline}</p>
            </div>
            {feedback.bullets.length > 0 && (
              <ul className="space-y-1 ml-5">
                {feedback.bullets.map((b, i) => (
                  <li key={i} className="text-xs text-foreground/90 flex items-start gap-1.5 leading-snug">
                    <span className="text-emerald-400/70 mt-0.5">›</span>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            )}
            {feedback.nextSetup && (
              <p className="text-[11px] text-emerald-200/80 italic border-t border-emerald-500/20 pt-2 ml-5">
                Setup morgen: {feedback.nextSetup}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

interface WorkoutPickerProps {
  sessionType: string;
  matchingWorkouts: WorkoutOption[];
  otherWorkouts: WorkoutOption[];
  isLoading: boolean;
  showOtherTypes: boolean;
  setShowOtherTypes: (v: boolean) => void;
  onPickWorkout: (id: string) => void;
  onNoTracker: () => void;
  onCancel: () => void;
  onSync: () => void;
  syncPending: boolean;
  submitPending: boolean;
}

function WorkoutPicker({
  sessionType,
  matchingWorkouts,
  otherWorkouts,
  isLoading,
  showOtherTypes,
  setShowOtherTypes,
  onPickWorkout,
  onNoTracker,
  onCancel,
  onSync,
  syncPending,
  submitPending,
}: WorkoutPickerProps) {
  const sessionTypeLabel = sessionType === "strength" ? "Kraft"
    : sessionType === "cardio" || sessionType === "long_cardio" ? "Cardio"
    : sessionType === "mobility" ? "Mobility"
    : sessionType;

  return (
    <div className="rounded-lg border border-border/40 bg-muted/10 p-3 space-y-2.5">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
          Workout fuer diese Session
        </p>
        <button
          type="button"
          onClick={onSync}
          disabled={syncPending}
          className="text-[10px] text-primary hover:underline flex items-center gap-1 disabled:opacity-50"
        >
          {syncPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Sync
        </button>
      </div>

      {isLoading && (
        <p className="text-xs text-muted-foreground italic py-2">Lade Tages-Workouts...</p>
      )}

      {!isLoading && matchingWorkouts.length === 0 && otherWorkouts.length === 0 && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-200">
          Keine Workouts heute in Garmin. Klick „Ohne Tracker" wenn du es manuell absolviert hast.
        </div>
      )}

      {/* Type-Matches: prominent oben */}
      {matchingWorkouts.length > 0 && (
        <div className="space-y-1.5">
          {matchingWorkouts.length > 1 && (
            <p className="text-[10px] text-muted-foreground">
              {matchingWorkouts.length} passende {sessionTypeLabel}-Workouts heute — waehle einen:
            </p>
          )}
          <ul className="space-y-1">
            {matchingWorkouts.map((w) => (
              <li key={w.id}>
                <WorkoutPickItem workout={w} onClick={() => onPickWorkout(w.id)} disabled={submitPending} highlighted />
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Andere Workout-Typen — klappbar, weniger prominent */}
      {otherWorkouts.length > 0 && (
        <div className="space-y-1.5">
          <button
            type="button"
            onClick={() => setShowOtherTypes(!showOtherTypes)}
            className="w-full flex items-center justify-between gap-2 text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors py-1"
          >
            <span>
              {matchingWorkouts.length === 0
                ? `Andere Workouts heute (kein ${sessionTypeLabel}-Match)`
                : `Anderer Typ — ${otherWorkouts.length}`}
            </span>
            <ChevronDown className={cn("h-3 w-3 transition-transform", showOtherTypes && "rotate-180")} />
          </button>
          {showOtherTypes && (
            <ul className="space-y-1">
              {otherWorkouts.map((w) => (
                <li key={w.id}>
                  <WorkoutPickItem workout={w} onClick={() => onPickWorkout(w.id)} disabled={submitPending} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Bottom-Actions */}
      <div className="flex flex-col sm:flex-row gap-2 pt-2 border-t border-border/40">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onNoTracker}
          disabled={submitPending}
          className="flex-1 text-[11px]"
        >
          Ohne Tracker absolviert
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onCancel}
          disabled={submitPending}
          className="text-[11px]"
        >
          Abbrechen
        </Button>
      </div>
    </div>
  );
}

function WorkoutPickItem({ workout: w, onClick, disabled, highlighted }: { workout: WorkoutOption; onClick: () => void; disabled: boolean; highlighted?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "w-full text-left rounded border px-2.5 py-2 transition-all active:scale-[0.98] disabled:opacity-50",
        highlighted
          ? "border-primary/50 bg-primary/5 hover:bg-primary/15 hover:border-primary"
          : "border-border/40 bg-card hover:bg-muted/20 hover:border-border/60",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={cn("font-bold text-xs capitalize", highlighted && "text-primary")}>{w.type}</span>
            {w.name && <span className="text-[11px] text-muted-foreground truncate">· {w.name}</span>}
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground tabular-nums mt-0.5">
            <span>{w.startTime}</span>
            <span>·</span>
            <span>{w.durationMin} min</span>
            {w.distanceKm && <><span>·</span><span>{w.distanceKm} km</span></>}
            {w.avgHr && <><span>·</span><span>HR {w.avgHr}</span></>}
            {w.trainingLoad && <><span>·</span><span>TL {w.trainingLoad}</span></>}
          </div>
        </div>
        <ChevronRight className={cn("h-3.5 w-3.5 shrink-0", highlighted ? "text-primary" : "text-muted-foreground")} />
      </div>
    </button>
  );
}
