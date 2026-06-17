"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { Scale, TrendingDown, TrendingUp } from "lucide-react";
import { format, parseISO, subDays } from "date-fns";
import { cn } from "@/lib/utils/cn";

interface WeightEntry {
  date: string;
  weightKg: number;
  note: string | null;
}

interface WeightResponse {
  entries: WeightEntry[];
}

export function WeightCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const todayKey = format(new Date(), "yyyy-MM-dd");
  const [draft, setDraft] = React.useState<string>("");

  const list = useQuery<WeightResponse>({
    queryKey: ["body-weight"],
    queryFn: async () => {
      const res = await fetch("/api/health/weight");
      if (!res.ok) throw new Error("weight");
      return res.json();
    },
    staleTime: 5 * 60_000,
  });

  const todayEntry = list.data?.entries.find((e) => e.date === todayKey);
  React.useEffect(() => {
    if (todayEntry) setDraft(String(todayEntry.weightKg));
  }, [todayEntry]);

  const save = useMutation({
    mutationFn: async (kg: number) => {
      const res = await fetch("/api/health/weight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weightKg: kg, date: todayKey }),
      });
      if (!res.ok) throw new Error("save");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["body-weight"] });
      toast.success("Gewicht gespeichert");
    },
    onError: () => toast.error("Speichern fehlgeschlagen", "Versuchs gleich nochmal."),
  });

  // 7d Trend Berechnung
  const trend = (() => {
    const entries = list.data?.entries ?? [];
    if (entries.length < 2) return null;
    const recent7 = entries.filter((e) => parseISO(e.date) >= subDays(new Date(), 7));
    const prev7 = entries.filter((e) => {
      const d = parseISO(e.date);
      return d >= subDays(new Date(), 14) && d < subDays(new Date(), 7);
    });
    if (recent7.length === 0 || prev7.length === 0) return null;
    const avgR = recent7.reduce((s, e) => s + e.weightKg, 0) / recent7.length;
    const avgP = prev7.reduce((s, e) => s + e.weightKg, 0) / prev7.length;
    return { delta: avgR - avgP, currentAvg: avgR };
  })();

  // Mini-Sparkline (letzte 30d)
  const sparklinePoints = (() => {
    const entries = (list.data?.entries ?? []).slice(-30);
    if (entries.length < 2) return null;
    const W = 200, H = 30;
    const values = entries.map((e) => e.weightKg);
    const min = Math.min(...values), max = Math.max(...values);
    const range = max - min || 1;
    return entries.map((e, i) => {
      const x = (i / (entries.length - 1)) * W;
      const y = H - ((e.weightKg - min) / range) * (H - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
  })();

  const submit = () => {
    const n = parseFloat(draft.replace(",", "."));
    if (isNaN(n) || n < 30 || n > 250) {
      toast.error("Ungueltiger Wert", "Bitte 30-250 kg eingeben.");
      return;
    }
    save.mutate(n);
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 font-semibold">
            <Scale className="h-3.5 w-3.5 text-primary" /> Gewicht heute
          </p>
          {trend && (
            <span className={cn(
              "text-[10px] tabular-nums flex items-center gap-1",
              trend.delta < -0.1 ? "text-emerald-300" : trend.delta > 0.1 ? "text-red-300" : "text-muted-foreground",
            )}>
              {trend.delta < 0 ? <TrendingDown className="h-3 w-3" /> : <TrendingUp className="h-3 w-3" />}
              {trend.delta >= 0 ? "+" : ""}{trend.delta.toFixed(1)} kg /7d
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <input
            type="text"
            inputMode="decimal"
            placeholder="kg"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            className="h-9 flex-1 rounded-md border border-border/40 bg-background px-3 text-base tabular-nums"
          />
          <Button size="sm" onClick={submit} disabled={save.isPending || draft.trim().length === 0}>
            {save.isPending ? "..." : todayEntry ? "Update" : "Speichern"}
          </Button>
        </div>

        {sparklinePoints && (
          <div className="space-y-1">
            <svg viewBox="0 0 200 30" className="w-full h-6" preserveAspectRatio="none">
              <polyline points={sparklinePoints} fill="none" stroke="#AAFF00" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <p className="text-[10px] text-muted-foreground text-right">
              30d Trend · {(list.data?.entries.length ?? 0)} Eintraege
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
