"use client";

import * as React from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import { CATEGORICAL_PALETTE, CHART_GRIDLINE, CHART_AXIS, CHART_SURFACE } from "./chart-theme";

export interface TrendSeries {
  key: string;
  label: string;
  color?: string;
  /** Renders as a dashed reference/forecast line instead of a solid data line. */
  dashed?: boolean;
  /** Renders as a filled area (subtle wash) instead of a plain line. */
  area?: boolean;
}

interface TrendChartProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any[];
  series: TrendSeries[];
  xKey: string;
  height?: number;
  /** Recharts syncId — pairs this chart's hover/crosshair with other charts sharing the same id. */
  syncId?: string;
  xTickFormatter?: (value: string) => string;
  yTickFormatter?: (value: number) => string;
  /** Reverses the Y domain (e.g. pace: smaller seconds/km should read "higher" on the chart). */
  reverseY?: boolean;
  yDomain?: [number | "auto" | "dataMin", number | "auto" | "dataMax"];
  /** Suppresses the x-axis tick labels (used on the top chart of a stacked syncId pair). */
  hideXAxisLabels?: boolean;
  unit?: string;
  /** Formats the raw numeric value for tooltip display (e.g. seconds -> "5:20"). Falls back to the raw value + unit. */
  valueFormatter?: (value: number) => string;
}

function ChartTooltip({
  active,
  payload,
  label,
  unit,
  valueFormatter,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number | string; color?: string }[];
  label?: string;
  unit?: string;
  valueFormatter?: (value: number) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-sm">
      <p className="text-muted-foreground mb-1">{label}</p>
      {payload.map((p, i) => (
        <p key={i} className="flex items-center gap-1.5 font-medium">
          <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: p.color }} />
          {valueFormatter && typeof p.value === "number" ? valueFormatter(p.value) : <>{p.value}{unit}</>}
          <span className="text-muted-foreground font-normal">{p.name}</span>
        </p>
      ))}
    </div>
  );
}

function ChartLegend({ series }: { series: TrendSeries[] }) {
  if (series.length < 2) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground mt-1">
      {series.map((s, i) => (
        <span key={s.key} className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-3 rounded-full" style={{ background: s.color ?? CATEGORICAL_PALETTE[i % CATEGORICAL_PALETTE.length] }} />
          {s.label}
        </span>
      ))}
    </div>
  );
}

/**
 * Shared single-axis line/area trend chart. Structurally single-Y-axis only —
 * there is no yAxisId prop, so a dual-axis overlay isn't representable here.
 * For two differently-scaled series, use two TrendChart instances with a
 * shared `syncId` instead (small multiples with synced hover/crosshair).
 */
export function TrendChart({
  data,
  series,
  xKey,
  height = 160,
  syncId,
  xTickFormatter,
  yTickFormatter,
  reverseY = false,
  yDomain,
  hideXAxisLabels = false,
  unit = "",
  valueFormatter,
}: TrendChartProps) {
  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} syncId={syncId} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="0" stroke={CHART_GRIDLINE} vertical={false} />
          <XAxis
            dataKey={xKey}
            tick={hideXAxisLabels ? false : { fill: CHART_AXIS, fontSize: 11 }}
            tickFormatter={xTickFormatter}
            axisLine={{ stroke: CHART_GRIDLINE }}
            tickLine={false}
            height={hideXAxisLabels ? 4 : undefined}
          />
          <YAxis
            tick={{ fill: CHART_AXIS, fontSize: 11 }}
            tickFormatter={yTickFormatter}
            axisLine={false}
            tickLine={false}
            width={40}
            reversed={reverseY}
            domain={yDomain}
          />
          <Tooltip
            content={<ChartTooltip unit={unit} valueFormatter={valueFormatter} />}
            cursor={{ stroke: CHART_GRIDLINE }}
          />
          {series.map((s, i) => {
            const color = s.color ?? CATEGORICAL_PALETTE[i % CATEGORICAL_PALETTE.length];
            if (s.area) {
              return (
                <Area
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.label}
                  stroke={color}
                  fill={color}
                  fillOpacity={0.1}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 5, strokeWidth: 2, stroke: CHART_SURFACE }}
                />
              );
            }
            return (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stroke={color}
                strokeWidth={2}
                strokeDasharray={s.dashed ? "4 3" : undefined}
                dot={false}
                activeDot={{ r: 5, strokeWidth: 2, stroke: CHART_SURFACE }}
              />
            );
          })}
        </ComposedChart>
      </ResponsiveContainer>
      <ChartLegend series={series} />
    </div>
  );
}
