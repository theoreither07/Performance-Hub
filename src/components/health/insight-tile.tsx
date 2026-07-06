"use client";

import * as React from "react";
import { cn } from "@/lib/utils/cn";
import { haptics } from "@/lib/ui/haptics";
import { type Insight, type Tone, sparklinePath } from "@/lib/health/insights";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { TrendingDown, TrendingUp, Minus } from "lucide-react";
import { format, parseISO } from "date-fns";
import { de } from "@/lib/i18n/date-locale";
import { TrendChart, STATUS_COLOR, CATEGORICAL_PALETTE } from "@/components/charts";

const TONE_BG: Record<Tone, string> = {
  good: "bg-emerald-500/10 border-emerald-500/30",
  neutral: "bg-card border-border/40",
  warn: "bg-amber-500/10 border-amber-500/30",
  info: "bg-blue-500/10 border-blue-500/30",
};

const TONE_TEXT: Record<Tone, string> = {
  good: "text-emerald-300",
  neutral: "text-foreground",
  warn: "text-amber-300",
  info: "text-blue-300",
};

const TONE_STROKE: Record<Tone, string> = {
  good: "stroke-emerald-400",
  neutral: "stroke-foreground/60",
  warn: "stroke-amber-400",
  info: "stroke-blue-400",
};

const TONE_HEX: Record<Tone, string> = {
  good: STATUS_COLOR.good,
  neutral: CATEGORICAL_PALETTE[0],
  warn: STATUS_COLOR.warning,
  info: CATEGORICAL_PALETTE[0],
};

interface InsightTileProps {
  insight: Insight;
  history: { date: string; value: number }[];
  className?: string;
}

export function InsightTile({ insight, history, className }: InsightTileProps) {
  const [open, setOpen] = React.useState(false);
  const TrendIcon = insight.trend === "up" ? TrendingUp : insight.trend === "down" ? TrendingDown : Minus;
  const path = sparklinePath(history.slice(-14), 100, 28);

  const handleOpen = () => {
    haptics.tap();
    setOpen(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className={cn(
          "relative rounded-xl border p-3 text-left transition-all",
          "hover:scale-[1.01] active:scale-[0.99]",
          "focus:outline-none focus:ring-2 focus:ring-primary/60",
          TONE_BG[insight.tone],
          className,
        )}
      >
        <div className="flex items-center justify-between gap-2 mb-1">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {insight.label}
          </span>
          <TrendIcon className={cn("h-3 w-3", TONE_TEXT[insight.tone])} />
        </div>
        <div className="flex items-baseline gap-1">
          <span className={cn("text-xl sm:text-2xl font-bold tabular-nums", TONE_TEXT[insight.tone])}>
            {insight.value === null ? "—" : insight.headline.split(" ")[0]}
          </span>
          {insight.unit && (
            <span className="text-[10px] text-muted-foreground">{insight.unit}</span>
          )}
        </div>
        {insight.delta && (
          <p className="text-[10px] text-muted-foreground mt-0.5 tabular-nums">{insight.delta} vs 14d</p>
        )}
        {path && (
          <svg viewBox="0 0 100 28" className="w-full h-6 mt-1.5">
            <path d={path} fill="none" strokeWidth={1.5} className={TONE_STROKE[insight.tone]} />
          </svg>
        )}
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              {insight.label}
              <TrendIcon className={cn("h-4 w-4", TONE_TEXT[insight.tone])} />
            </SheetTitle>
            <SheetDescription className="text-base text-foreground/90">
              {insight.insight}
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-4">
            <div className="flex items-baseline gap-3">
              <span className={cn("text-4xl font-bold tabular-nums", TONE_TEXT[insight.tone])}>
                {insight.value === null ? "—" : insight.headline.split(" ")[0]}
              </span>
              <span className="text-sm text-muted-foreground">{insight.unit}</span>
              {insight.delta && (
                <span className="text-sm text-muted-foreground tabular-nums ml-auto">
                  {insight.delta} vs 14d-Schnitt
                </span>
              )}
            </div>
            {history.length >= 2 && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                  Letzte 14 Tage
                </p>
                <TrendChart
                  data={history.slice(-14)}
                  series={[{ key: "value", label: insight.label, color: TONE_HEX[insight.tone] }]}
                  xKey="date"
                  height={120}
                  unit={insight.unit ? ` ${insight.unit}` : ""}
                  xTickFormatter={(d) => format(parseISO(d), "d.M.", { locale: de })}
                />
              </div>
            )}
            <div className="border-t border-border/40 pt-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
                Verlauf (30 Tage)
              </p>
              <ul className="text-xs text-muted-foreground space-y-1 max-h-48 overflow-y-auto tabular-nums">
                {history.slice(-30).reverse().map((p) => (
                  <li key={p.date} className="flex justify-between border-b border-border/20 py-1">
                    <span>{p.date}</span>
                    <span className="text-foreground/80">{p.value.toFixed(1)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
