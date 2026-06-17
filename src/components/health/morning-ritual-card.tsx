"use client";

/**
 * Morgens-Ritual-Card. Derived state aus existing Daten (kein extra Schema):
 *   - Garmin synced (HRV oder Sleep heute in DB?)
 *   - Gewicht heute eingetragen?
 *   - Journal heute gefüllt (mood/energy)?
 *   - Coach-Briefing gelesen (gibt's für heute)?
 *
 * Action-Button pro Item: triggert Sync / scrollt zur Card / öffnet Journal.
 * Sichtbar nur morgens (vor 14 Uhr) — danach ausgeblendet damit kein Lärm.
 */
import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { Check, CheckCircle2, Circle, RefreshCw, Sunrise } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils/cn";

interface ScoreResponse {
  todayRaw?: { sleepMinutes: number | null; hrvMs: number | null; sleepMinutesFallback?: boolean; hrvFallback?: boolean };
}
interface WeightResponse { entries: Array<{ date: string }> }
interface JournalResponse {
  entries: Array<{
    date: string;
    mood: number | null;
    energy: number | null;
    soreness?: number | null;
    sleepQuality?: number | null;
    workoutFelt?: string | null;
    notes?: string | null;
    ateWell?: boolean | null;
    alcoholDrinks?: number | null;
  }>;
}
const READ_KEY = (today: string) => `coach-briefing-read-${today}`;
interface RecoResponse { recommendation: { generatedAt: string } | null }

export function MorningRitualCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const todayKey = format(new Date(), "yyyy-MM-dd");
  const hour = new Date().getHours();
  const isMorningWindow = hour < 14;

  const scoreQ = useQuery<ScoreResponse>({
    queryKey: ["health-score", "hero", todayKey],
    queryFn: async () => {
      const res = await fetch("/api/health/score?days=1");
      if (!res.ok) throw new Error("score");
      return res.json();
    },
    staleTime: 60_000,
  });
  const weightQ = useQuery<WeightResponse>({
    queryKey: ["body-weight"],
    queryFn: async () => {
      const res = await fetch("/api/health/weight");
      if (!res.ok) throw new Error("w");
      return res.json();
    },
    staleTime: 60_000,
  });
  const journalQ = useQuery<JournalResponse>({
    queryKey: ["journal"],
    queryFn: async () => {
      const res = await fetch("/api/journal");
      if (!res.ok) throw new Error("j");
      return res.json();
    },
    staleTime: 60_000,
  });
  const recoQ = useQuery<RecoResponse>({
    queryKey: ["coach-recommendation", todayKey],
    queryFn: async () => {
      const res = await fetch("/api/coach/generate");
      if (!res.ok) throw new Error("r");
      return res.json();
    },
    staleTime: 60_000,
  });

  const syncMut = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/sync/refresh-all", { method: "POST" });
      if (!res.ok) throw new Error("sync");
      return res.json();
    },
    onSuccess: () => {
      toast.success("Sync angestossen", "Daten in ~15-30 Sek hier.");
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: ["health-score"] });
      }, 15_000);
    },
  });

  const todayRaw = scoreQ.data?.todayRaw;
  const garminToday =
    todayRaw &&
    todayRaw.sleepMinutes !== null &&
    !todayRaw.sleepMinutesFallback &&
    todayRaw.hrvMs !== null &&
    !todayRaw.hrvFallback;

  const weightToday = (weightQ.data?.entries ?? []).some((e) => e.date === todayKey);

  // Journal "gefuellt" = MINDESTENS EIN sinnvolles Feld gesetzt (nicht nur mood+energy strikt).
  // User kann auch nur notes/soreness/sleepQuality usw. eintragen — das zaehlt auch.
  const journalToday = (journalQ.data?.entries ?? []).some((j) => {
    if (j.date !== todayKey) return false;
    return (
      j.mood !== null
      || j.energy !== null
      || (j.soreness ?? null) !== null
      || (j.sleepQuality ?? null) !== null
      || !!j.workoutFelt
      || (j.notes != null && j.notes.trim().length > 0)
      || j.ateWell !== null
      || (j.alcoholDrinks ?? null) !== null
    );
  });

  // Coach-Briefing "gelesen" = User hat /coach mind. 1x heute geoeffnet.
  // Track via localStorage. (Wenn kein Briefing existiert, automatisch nicht "gelesen".)
  const briefingExists = !!recoQ.data?.recommendation?.generatedAt;
  const [briefingRead, setBriefingRead] = React.useState<boolean>(false);
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const check = () => setBriefingRead(localStorage.getItem(READ_KEY(todayKey)) === "1");
    check();
    // Live-Update wenn User von /coach zurueck zu /health navigiert (focus/visibility/storage).
    window.addEventListener("focus", check);
    window.addEventListener("visibilitychange", check);
    window.addEventListener("storage", check);
    return () => {
      window.removeEventListener("focus", check);
      window.removeEventListener("visibilitychange", check);
      window.removeEventListener("storage", check);
    };
  }, [todayKey]);
  const recoToday = briefingExists && briefingRead;
  const markBriefingRead = () => {
    if (typeof window !== "undefined") localStorage.setItem(READ_KEY(todayKey), "1");
    setBriefingRead(true);
  };

  const items = [
    { key: "garmin", label: "Garmin gesynct", done: !!garminToday, action: () => syncMut.mutate(), actionLabel: syncMut.isPending ? "..." : "Sync" },
    { key: "weight", label: "Gewicht eingetragen", done: weightToday, scrollTo: "weight-card" },
    { key: "journal", label: "Journal gefüllt", done: journalToday, scrollTo: "journal-card" },
    { key: "reco", label: "Coach-Briefing gelesen", done: recoToday, href: "/coach", onClick: markBriefingRead },
  ];
  const doneCount = items.filter((i) => i.done).length;
  const allDone = doneCount === items.length;

  if (!isMorningWindow && allDone) return null; // ausblenden wenn nachmittag + alles erledigt

  return (
    <Card className={cn("overflow-hidden", allDone && "border-emerald-500/40 bg-emerald-500/5")}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 font-semibold">
            <Sunrise className="h-3.5 w-3.5 text-primary" /> Morgens-Ritual
          </p>
          <span className="text-[10px] text-muted-foreground tabular-nums">{doneCount}/{items.length}</span>
        </div>

        <ul className="space-y-1.5">
          {items.map((it) => (
            <li key={it.key} className="flex items-center gap-2 text-sm">
              {it.done ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-300 shrink-0" />
              ) : (
                <Circle className="h-4 w-4 text-muted-foreground shrink-0" />
              )}
              <span className={cn("flex-1", it.done ? "text-muted-foreground line-through" : "text-foreground/90")}>
                {it.label}
              </span>
              {!it.done && it.action && (
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={it.action} disabled={syncMut.isPending}>
                  <RefreshCw className={cn("h-3 w-3 mr-1", syncMut.isPending && "animate-spin")} /> {it.actionLabel}
                </Button>
              )}
              {!it.done && it.href && (
                <a
                  href={it.href}
                  onClick={() => { if (it.onClick) it.onClick(); }}
                  className="text-xs text-primary hover:underline"
                >
                  öffnen
                </a>
              )}
              {!it.done && it.scrollTo && (
                <button
                  type="button"
                  onClick={() => {
                    const target = document.getElementById(it.scrollTo!);
                    if (target) {
                      target.scrollIntoView({ behavior: "smooth", block: "start" });
                      // Visual feedback: kurz pulsen
                      target.classList.add("ring-2", "ring-primary/60", "transition-shadow");
                      setTimeout(() => target.classList.remove("ring-2", "ring-primary/60"), 1500);
                    }
                  }}
                  className="text-xs text-primary hover:underline"
                >
                  unten →
                </button>
              )}
            </li>
          ))}
        </ul>

        {allDone && (
          <p className="text-xs text-emerald-300 italic flex items-center gap-1.5">
            <Check className="h-3 w-3" /> Alles bereit. Guter Start.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
