"use client";

import * as React from "react";
import { cn } from "@/lib/utils/cn";
import { STATUS_COLOR } from "@/components/charts";

interface ScoreRingProps {
  value: number; // 0..100
  size?: number;
  stroke?: number;
  label?: string;
  sublabel?: string;
  /** Tailwind stroke class, default emerald/amber/red dynamisch. */
  strokeClassName?: string;
  className?: string;
  /** Wenn true, pulst der Ring sanft (z.B. "live sync laeuft"). */
  pulse?: boolean;
}

function autoStrokeColor(value: number): string {
  if (value >= 80) return STATUS_COLOR.good;
  if (value >= 60) return STATUS_COLOR.warning;
  if (value >= 40) return STATUS_COLOR.serious;
  return STATUS_COLOR.critical;
}

export function ScoreRing({
  value,
  size = 160,
  stroke = 12,
  label,
  sublabel,
  strokeClassName,
  className,
  pulse = false,
}: ScoreRingProps) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, value));
  const offset = c - (clamped / 100) * c;
  const autoColor = autoStrokeColor(clamped);

  return (
    <div
      className={cn("relative inline-flex items-center justify-center", className)}
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        className={cn("rotate-[-90deg]", pulse && "animate-pulse-soft")}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          className="stroke-muted/30"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          className={cn(strokeClassName, "transition-all duration-700 ease-out")}
          stroke={strokeClassName ? undefined : autoColor}
          strokeDasharray={c}
          strokeDashoffset={offset}
          style={{
            ["--ring-circ" as string]: `${c}`,
            ["--ring-target" as string]: `${offset}`,
          }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <span className="text-3xl sm:text-4xl font-bold tabular-nums leading-none">
          {Math.round(clamped)}
        </span>
        {label && (
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">
            {label}
          </span>
        )}
        {sublabel && (
          <span className="text-[10px] text-muted-foreground/80 mt-0.5">{sublabel}</span>
        )}
      </div>
    </div>
  );
}
