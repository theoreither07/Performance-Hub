"use client";

/**
 * Pace-vs-Puls-Trend — zeigt Laufoekonomie ueber Zeit: bei vergleichbarer
 * Anstrengung (Z1/Z2, HF < 81% MaxHF) sollte die Pace mit der Zeit schneller
 * werden bzw. die HF bei gleichem Tempo sinken. Zwei unabhaengig normalisierte
 * Linien (Pace + HF) ueber die letzten 60 Tage, im Stil der bestehenden Sparklines.
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Activity } from "lucide-react";
import { format, parseISO } from "date-fns";
import { de } from "@/lib/i18n/date-locale";

interface Workout {
  date: string;
  type: string;
  durationSec: number;
  distanceM: number | null;
  avgHr: number | null;
}
interface WorkoutsResponse { workouts: Workout[] }
interface ProfileResponse { maxHr?: number | null }

function paceFmt(secondsPerKm: number): string {
  const m = Math.floor(secondsPerKm / 60);
  const s = Math.round(secondsPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")}/km`;
}

const PACE_COLOR = "#AAFF00";
const HR_COLOR = "#FB7185";

export function PaceHrTrendCard() {
  const workoutsQ = useQuery<WorkoutsResponse>({
    queryKey: ["workouts-running", 60],
    queryFn: async () => {
      const res = await fetch("/api/workouts?days=60&type=running");
      if (!res.ok) throw new Error("w");
      return res.json();
    },
    staleTime: 5 * 60_000,
  });
  const profileQ = useQuery<ProfileResponse>({
    queryKey: ["training-profile"],
    queryFn: async () => {
      const res = await fetch("/api/training-profile");
      if (!res.ok) throw new Error("p");
      return res.json();
    },
    staleTime: 10 * 60_000,
  });

  const maxHr = profileQ.data?.maxHr ?? 190;

  const points = (workoutsQ.data?.workouts ?? [])
    .filter((w) => w.type === "running" && (w.distanceM ?? 0) > 1500 && w.durationSec > 600 && w.avgHr !== null)
    .filter((w) => (w.avgHr as number) / maxHr < 0.81) // nur Z1/Z2 — sonst verzerrt Anstrengung den Vergleich
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((w) => ({
      date: w.date,
      paceSecKm: w.durationSec / ((w.distanceM as number) / 1000),
      hr: w.avgHr as number,
    }));

  const chart = (() => {
    if (points.length < 3) return null;
    const W = 600, H = 90;
    const paces = points.map((p) => p.paceSecKm);
    const hrs = points.map((p) => p.hr);
    const paceMin = Math.min(...paces), paceMax = Math.max(...paces);
    const paceRange = paceMax - paceMin || 1;
    const hrMin = Math.min(...hrs), hrMax = Math.max(...hrs);
    const hrRange = hrMax - hrMin || 1;

    // Pace invertiert: schnelleres (kleineres) sec/km -> Linie steigt nach oben.
    const paceY = (v: number) => H - ((paceMax - v) / paceRange) * (H - 4) - 2;
    const hrY = (v: number) => H - ((v - hrMin) / hrRange) * (H - 4) - 2;
    const x = (i: number) => (i / (points.length - 1)) * W;

    const pacePts = points.map((p, i) => `${x(i)},${paceY(p.paceSecKm)}`).join(" ");
    const hrPts = points.map((p, i) => `${x(i)},${hrY(p.hr)}`).join(" ");

    return (
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-24">
        <polyline points={hrPts} fill="none" stroke={HR_COLOR} strokeWidth={1.5} opacity={0.85} strokeLinecap="round" strokeLinejoin="round" />
        <polyline points={pacePts} fill="none" stroke={PACE_COLOR} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
        {points.map((p, i) => <circle key={`hr-${i}`} cx={x(i)} cy={hrY(p.hr)} r={1.5} fill={HR_COLOR} />)}
        {points.map((p, i) => <circle key={`pace-${i}`} cx={x(i)} cy={paceY(p.paceSecKm)} r={1.5} fill={PACE_COLOR} />)}
      </svg>
    );
  })();

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 font-semibold">
            <Activity className="h-3.5 w-3.5 text-primary" /> Pace vs. Puls
          </p>
          <span className="text-[10px] text-muted-foreground">60d · Z1/Z2 · {points.length} Läufe</span>
        </div>

        {chart ? (
          <>
            {chart}
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: PACE_COLOR }} />
                Pace {paceFmt(points[0].paceSecKm)} → {paceFmt(points[points.length - 1].paceSecKm)}
              </span>
              <span className="flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: HR_COLOR }} />
                Puls {points[0].hr.toFixed(0)} → {points[points.length - 1].hr.toFixed(0)} bpm
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground">
              {format(parseISO(points[0].date), "d. MMM", { locale: de })} – {format(parseISO(points[points.length - 1].date), "d. MMM", { locale: de })}
              {" · "}Pace steigt = schneller, Puls sinkt = ökonomischer
            </p>
          </>
        ) : (
          <p className="text-[10px] text-muted-foreground italic">
            Noch zu wenige lockere Läufe (Z1/Z2, HF unter 81% MaxHF) für einen Trend. Min. 3 in 60 Tagen nötig.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
