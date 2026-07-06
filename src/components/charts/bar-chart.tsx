"use client";

import * as React from "react";
import {
  ResponsiveContainer,
  BarChart as RBarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import { CATEGORICAL_PALETTE, CHART_GRIDLINE, CHART_AXIS, CHART_SURFACE } from "./chart-theme";

export interface BarSeries {
  key: string;
  label: string;
  color?: string;
}

interface BarChartProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any[];
  series: BarSeries[];
  xKey: string;
  height?: number;
  xTickFormatter?: (value: string) => string;
  yTickFormatter?: (value: number) => string;
  unit?: string;
}

function ChartTooltip({
  active,
  payload,
  label,
  unit,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number | string; color?: string }[];
  label?: string;
  unit?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-sm">
      <p className="text-muted-foreground mb-1">{label}</p>
      {payload.map((p, i) => (
        <p key={i} className="flex items-center gap-1.5 font-medium">
          <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: p.color }} />
          {p.value}
          {unit}
          <span className="text-muted-foreground font-normal">{p.name}</span>
        </p>
      ))}
    </div>
  );
}

function ChartLegend({ series }: { series: BarSeries[] }) {
  if (series.length < 2) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground mt-1">
      {series.map((s, i) => (
        <span key={s.key} className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-sm" style={{ background: s.color ?? CATEGORICAL_PALETTE[i % CATEGORICAL_PALETTE.length] }} />
          {s.label}
        </span>
      ))}
    </div>
  );
}

/** Shared bar/column primitive — weekly volume, per-category totals, etc. */
export function BarChart({ data, series, xKey, height = 160, xTickFormatter, yTickFormatter, unit = "" }: BarChartProps) {
  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <RBarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} barGap={4} barCategoryGap="20%">
          <CartesianGrid strokeDasharray="0" stroke={CHART_GRIDLINE} vertical={false} />
          <XAxis
            dataKey={xKey}
            tick={{ fill: CHART_AXIS, fontSize: 11 }}
            tickFormatter={xTickFormatter}
            axisLine={{ stroke: CHART_GRIDLINE }}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: CHART_AXIS, fontSize: 11 }}
            tickFormatter={yTickFormatter}
            axisLine={false}
            tickLine={false}
            width={40}
          />
          <Tooltip content={<ChartTooltip unit={unit} />} cursor={{ fill: CHART_SURFACE, opacity: 0.4 }} />
          {series.map((s, i) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.label}
              fill={s.color ?? CATEGORICAL_PALETTE[i % CATEGORICAL_PALETTE.length]}
              radius={[4, 4, 0, 0]}
              maxBarSize={24}
            />
          ))}
        </RBarChart>
      </ResponsiveContainer>
      <ChartLegend series={series} />
    </div>
  );
}
