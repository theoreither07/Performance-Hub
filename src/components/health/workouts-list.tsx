"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Activity, Bike, Dumbbell, Footprints, Mountain, Waves, ChevronDown, MessageSquare, Check } from "lucide-react";
import { format, parseISO } from "date-fns";
import { de } from "@/lib/i18n/date-locale";
import { cn } from "@/lib/utils/cn";

interface Workout {
  id: string;
  date: string;
  startTime: string;
  type: string;
  name: string | null;
  durationSec: number;
  distanceM: number | null;
  calories: number | null;
  avgHr: number | null;
  maxHr: number | null;
  trainingLoad: number | null;
  aerobicEffect: number | null;
  anaerobicEffect: number | null;
  rpe: number | null;
  feeling: number | null;
  notes: string | null;
  source: string;
}

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  running: Footprints,
  cycling: Bike,
  strength: Dumbbell,
  yoga: Activity,
  swimming: Waves,
  hiking: Mountain,
  rowing: Activity,
  other: Activity,
};

const TYPE_LABEL: Record<string, string> = {
  running: "Laufen",
  cycling: "Radfahren",
  strength: "Krafttraining",
  yoga: "Yoga",
  swimming: "Schwimmen",
  hiking: "Wandern",
  rowing: "Rudern",
  other: "Sonstiges",
};

function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}min`;
}

function formatDistance(m: number | null): string | null {
  if (m === null || m === 0) return null;
  if (m >= 1000) return `${(m / 1000).toFixed(2)} km`;
  return `${Math.round(m)} m`;
}

export function WorkoutsList({
  days = 14,
  dateKey,
  title,
  bare = false,
}: {
  days?: number;
  /** Wenn gesetzt: nur Workouts dieses Tages anzeigen (YYYY-MM-DD). Loesst todayOnly ab. */
  dateKey?: string;
  title?: string;
  bare?: boolean;
}) {
  // Wenn ein Datum gesetzt ist, ziehen wir ein groesseres Lade-Fenster (Default 60 Tage),
  // damit auch zurueckliegende Tage im Cache verfuegbar sind.
  const queryDays = dateKey ? Math.max(days, 60) : days;
  const { data, isLoading } = useQuery<{ workouts: Workout[] }>({
    queryKey: ["workouts", queryDays],
    queryFn: async () => {
      const res = await fetch(`/api/workouts?days=${queryDays}`);
      if (!res.ok) throw new Error("workouts");
      return res.json();
    },
    staleTime: 60_000,
  });

  const allWorkouts = data?.workouts ?? [];
  const todayKey = format(new Date(), "yyyy-MM-dd");
  const workouts = dateKey ? allWorkouts.filter((w) => w.date === dateKey) : allWorkouts;
  const isToday = dateKey === todayKey;

  const inner = (
    <>
      {isLoading && <p className="text-sm text-muted-foreground">Laden...</p>}
      {!isLoading && workouts.length === 0 && (
        <p className="text-sm text-muted-foreground py-4 text-center">
          {dateKey ? (isToday ? "Heute noch kein Training." : "An diesem Tag kein Training.") : "Noch keine Trainings synchronisiert."}
        </p>
      )}
      <div className="space-y-2">
        {workouts.map((w) => (
          <WorkoutRow key={w.id} workout={w} />
        ))}
      </div>
    </>
  );

  if (bare) {
    return (
      <div className="space-y-2">
        <p className="text-sm font-medium flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          {title ?? "Trainings"} <span className="text-muted-foreground font-normal">({workouts.length})</span>
        </p>
        {inner}
      </div>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          {title ?? "Trainings"} ({workouts.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">{inner}</CardContent>
    </Card>
  );
}

function WorkoutRow({ workout: w }: { workout: Workout }) {
  const Icon = ICONS[w.type] ?? Activity;
  const dist = formatDistance(w.distanceM);
  const [expanded, setExpanded] = React.useState(false);
  const hasFeedback = w.rpe !== null || w.feeling !== null || (w.notes && w.notes.trim().length > 0);

  return (
    <div className="rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 p-2.5 text-left"
      >
        <div className="h-9 w-9 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
          <Icon className="h-4 w-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium truncate">
              {w.name ?? TYPE_LABEL[w.type] ?? w.type}
            </p>
            {w.source === "manual" && (
              <span className="text-[9px] uppercase tracking-wider text-muted-foreground border rounded px-1 py-0.5">manual</span>
            )}
            {hasFeedback && <MessageSquare className="h-3 w-3 text-primary shrink-0" />}
          </div>
          <p className="text-xs text-muted-foreground">
            {format(parseISO(w.startTime), "EEE, d. MMM HH:mm", { locale: de })}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-medium tabular-nums">{formatDuration(w.durationSec)}</p>
          <p className="text-xs text-muted-foreground tabular-nums">
            {[dist, w.avgHr ? `${Math.round(w.avgHr)} bpm` : null, w.trainingLoad ? `${Math.round(w.trainingLoad)} TL` : null]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <ChevronDown
          className={cn("h-4 w-4 text-muted-foreground transition-transform shrink-0", expanded && "rotate-180")}
        />
      </button>
      {expanded && <WorkoutFeedback workout={w} />}
    </div>
  );
}

function WorkoutFeedback({ workout: w }: { workout: Workout }) {
  const qc = useQueryClient();
  const [rpe, setRpe] = React.useState<number | null>(w.rpe);
  const [feeling, setFeeling] = React.useState<number | null>(w.feeling);
  const [notes, setNotes] = React.useState(w.notes ?? "");
  const [savedAt, setSavedAt] = React.useState<Date | null>(null);

  const save = useMutation({
    mutationFn: async (payload: { rpe: number | null; feeling: number | null; notes: string }) => {
      const res = await fetch(`/api/workouts/${w.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...payload, notes: payload.notes || null }),
      });
      if (!res.ok) throw new Error("save");
      return res.json();
    },
    onSuccess: () => {
      setSavedAt(new Date());
      qc.invalidateQueries({ queryKey: ["workouts"] });
    },
  });

  const submit = () => save.mutate({ rpe, feeling, notes });

  return (
    <div className="px-3 pb-3 pt-1 space-y-3 border-t border-border/20">
      <div className="grid grid-cols-2 gap-3">
        <Scale label="RPE" hint="1=easy / 10=max" value={rpe} onChange={(v) => { setRpe(v); save.mutate({ rpe: v, feeling, notes }); }} />
        <Scale label="Gefuehl" hint="1=mies / 10=top" value={feeling} onChange={(v) => { setFeeling(v); save.mutate({ rpe, feeling: v, notes }); }} good />
      </div>
      <div className="space-y-1.5">
        <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Notizen</label>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={submit}
          placeholder="Wie war das Training? Was war besonders / was hat nicht funktioniert?"
          rows={2}
          className="text-sm"
        />
      </div>
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>
          {savedAt ? `Gespeichert ${format(savedAt, "HH:mm:ss")}` : "Aenderungen werden automatisch gespeichert"}
        </span>
        {save.isPending && <span>Speichere...</span>}
        {savedAt && !save.isPending && <Check className="h-3 w-3 text-emerald-400" />}
      </div>
    </div>
  );
}

function Scale({
  label,
  hint,
  value,
  onChange,
  good = false,
}: {
  label: string;
  hint: string;
  value: number | null;
  onChange: (v: number | null) => void;
  good?: boolean;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</label>
        <span className="text-[9px] text-muted-foreground">{hint}</span>
      </div>
      <div className="flex gap-0.5">
        {Array.from({ length: 10 }).map((_, i) => {
          const n = i + 1;
          const active = value !== null && n <= value;
          const isExtreme = good ? n >= 7 : n >= 8;
          const isLow = good ? n <= 3 : n <= 3;
          return (
            <button
              key={n}
              type="button"
              onClick={() => onChange(value === n ? null : n)}
              className={cn(
                "h-6 flex-1 rounded text-[9px] font-medium border min-w-0 transition-all",
                active
                  ? isExtreme
                    ? good
                      ? "bg-emerald-500/30 border-emerald-500/60 text-emerald-300"
                      : "bg-red-500/30 border-red-500/60 text-red-300"
                    : isLow
                      ? good
                        ? "bg-red-500/30 border-red-500/60 text-red-300"
                        : "bg-emerald-500/30 border-emerald-500/60 text-emerald-300"
                      : "bg-amber-500/30 border-amber-500/60 text-amber-300"
                  : "bg-muted/30 border-border/40 text-muted-foreground hover:bg-muted/60",
              )}
            >
              {n}
            </button>
          );
        })}
      </div>
    </div>
  );
}
