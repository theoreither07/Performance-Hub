"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { ChevronDown, Download } from "lucide-react";
import { cn } from "@/lib/utils/cn";

const RANGES: { days: number; label: string }[] = [
  { days: 7, label: "7 Tage" },
  { days: 14, label: "14 Tage" },
  { days: 30, label: "30 Tage" },
  { days: 180, label: "6 Monate" },
  { days: 365, label: "1 Jahr" },
];

export function DataExport() {
  const [days, setDays] = React.useState(30);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function startExport() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/export?days=${days}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      // Dateiname aus Content-Disposition ziehen
      const cd = res.headers.get("content-disposition") ?? "";
      const m = cd.match(/filename="([^"]+)"/);
      const filename = m?.[1] ?? `dashboard-export_${days}d.json`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="group rounded-xl border border-border/40 overflow-hidden">
      <summary className="cursor-pointer px-5 py-4 text-sm font-medium hover:bg-muted/20 transition-colors select-none flex items-center justify-between">
        <span className="flex items-center gap-2">
          <Download className="h-4 w-4 text-muted-foreground" /> Datenexport
        </span>
        <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="px-5 pb-5 pt-1 space-y-3">
        <p className="text-xs text-muted-foreground">
          Vollstaendiger JSON-Export aller Daten: Profil, Key-Lifts, Workouts, Journal-Eintraege,
          Coach-Empfehlungen, Wochenplaene, Chat-Verlauf, Daily Metrics, Memos.
          Refresh-Tokens werden aus Sicherheitsgruenden NICHT exportiert.
        </p>
        <div className="space-y-1.5">
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Zeitraum</label>
          <div className="flex flex-wrap gap-1.5">
            {RANGES.map((r) => (
              <button
                key={r.days}
                type="button"
                onClick={() => setDays(r.days)}
                className={cn(
                  "px-3 py-1.5 rounded-md text-xs font-medium border transition-colors",
                  days === r.days
                    ? "bg-primary/15 border-primary/40 text-primary"
                    : "bg-muted/30 border-border/40 hover:bg-muted/60",
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
        <Button type="button" size="sm" onClick={startExport} disabled={busy}>
          <Download className="h-3.5 w-3.5 mr-1" />
          {busy ? "Erstelle..." : `Export starten (${days} Tage)`}
        </Button>
      </div>
    </details>
  );
}
