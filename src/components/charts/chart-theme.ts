/**
 * Chart color/chrome tokens for Recharts-based charts.
 *
 * Categorical palette validated with the dataviz skill's validator against
 * this app's actual dark card surface (#1a1a1a, ~= --card: 0 0% 10%):
 *
 *   node <dataviz-skill>/scripts/validate_palette.js \
 *     "#3987e5,#199e70,#c98500,#008300,#9085e9,#e66767,#d55181,#d95926" \
 *     --mode dark --surface "#1a1a1a"
 *   => ALL CHECKS PASS (worst adjacent CVD ΔE 10.3 — floor band, mitigated by
 *      direct labels/legend on any chart using 4+ series).
 *
 * Re-run that command if CHART_SURFACE below ever changes.
 */

export const CHART_SURFACE = "#1a1a1a";
export const CHART_GRIDLINE = "#2c2c2a";
export const CHART_AXIS = "#898781";

export const CATEGORICAL_PALETTE = [
  "#3987e5", // 1 blue   — priv-anchor
  "#199e70", // 2 aqua
  "#c98500", // 3 yellow
  "#008300", // 4 green
  "#9085e9", // 5 violet — fh-anchor
  "#e66767", // 6 red
  "#d55181", // 7 magenta
  "#d95926", // 8 orange
] as const;

/** Brand-lime, reserved for single-series emphasis (e.g. "the one line that's you"). */
export const PRIMARY_SERIES_COLOR = "#AAFF00";

export const STATUS_COLOR = {
  good: "#0ca30c",
  warning: "#fab219",
  serious: "#ec835a",
  critical: "#d03b3b",
} as const;

export function categoricalColor(index: number): string {
  return CATEGORICAL_PALETTE[index % CATEGORICAL_PALETTE.length];
}
