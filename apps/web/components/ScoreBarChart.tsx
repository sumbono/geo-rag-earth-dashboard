"use client";

import { useMemo } from "react";
import { scaleLinear } from "d3";
import type { SearchResult } from "../lib/types";

export interface ScoreBarChartProps {
  /** Ranked hits to draw — one horizontal bar each. */
  results: SearchResult[];
  /** Id of the bar to highlight (the tile open in the detail panel). */
  selectedId: string;
}

/** Logical canvas width; the SVG scales to its container via `viewBox`. */
const WIDTH = 640;
const ROW_HEIGHT = 22;
const BAR_HEIGHT = 12;
const MARGIN = { top: 8, right: 44, bottom: 24, left: 8 };

// Design tokens, not literals (audit #7) — applied via `style` because SVG
// presentation attributes don't reliably resolve var() across browsers.
const BAR_FILL = "var(--color-ink-soft)";
const BAR_FILL_SELECTED = "var(--color-accent)"; // the teal signal (design.md)
const GRID_STROKE = "var(--color-rule)";
const AXIS_STROKE = "var(--color-rule-2)";
const LABEL_FILL = "var(--color-ink-soft)";
const VALUE_FILL = "var(--color-ink)";

/** Neat tick label: "0.3", not "0.30000000000000004". */
function tickLabel(tick: number): string {
  return String(Number(tick.toFixed(2)));
}

/**
 * Horizontal score chart (Task 18): x = score over the [0, 1] domain, one bar
 * per result, the selected bar in the accent color, and a numeric label on
 * every bar. React owns the whole SVG — d3 only supplies the scale and its
 * ticks, so there is no d3 DOM takeover and nothing to clean up. The `viewBox`
 * makes the chart reflow with its container without a resize observer.
 */
export default function ScoreBarChart({
  results,
  selectedId,
}: ScoreBarChartProps) {
  const x = useMemo(
    () =>
      scaleLinear()
        .domain([0, 1])
        .range([MARGIN.left, WIDTH - MARGIN.right]),
    [],
  );
  const ticks = useMemo(() => x.ticks(5), [x]);

  const plotHeight = Math.max(results.length * ROW_HEIGHT, ROW_HEIGHT);
  const baselineY = MARGIN.top + plotHeight;
  const height = baselineY + MARGIN.bottom;

  return (
    <svg
      className="score-chart"
      viewBox={`0 0 ${WIDTH} ${height}`}
      role="img"
      aria-label={`Relevance scores for ${results.length} results`}
      style={{ display: "block", width: "100%", maxWidth: WIDTH, height: "auto" }}
    >
      {/* Recessive grid + tick labels along the score axis. */}
      {ticks.map((tick) => (
        <g key={tick}>
          <line
            x1={x(tick)}
            x2={x(tick)}
            y1={MARGIN.top}
            y2={baselineY}
            style={{ stroke: GRID_STROKE }}
            strokeWidth={1}
          />
          <text
            x={x(tick)}
            y={baselineY + 14}
            textAnchor="middle"
            fontSize={10}
            style={{ fill: LABEL_FILL }}
          >
            {tickLabel(tick)}
          </text>
        </g>
      ))}
      <line
        x1={MARGIN.left}
        x2={WIDTH - MARGIN.right}
        y1={baselineY}
        y2={baselineY}
        style={{ stroke: AXIS_STROKE }}
        strokeWidth={1}
      />

      {results.map((result, index) => {
        const selected = result.id === selectedId;
        const barWidth = Math.max(x(result.score) - x(0), 0);
        const y =
          MARGIN.top + index * ROW_HEIGHT + (ROW_HEIGHT - BAR_HEIGHT) / 2;
        return (
          <g key={result.id}>
            <rect
              className={
                selected ? "score-bar score-bar--selected" : "score-bar"
              }
              data-id={result.id}
              x={x(0)}
              y={y}
              width={barWidth}
              height={BAR_HEIGHT}
              rx={2}
              style={{ fill: selected ? BAR_FILL_SELECTED : BAR_FILL }}
            >
              <title>{`${result.id}: ${result.score.toFixed(2)}`}</title>
            </rect>
            <text
              className="score-bar__value"
              x={x(result.score) + 6}
              y={y + BAR_HEIGHT / 2}
              dominantBaseline="middle"
              fontSize={11}
              style={{ fill: VALUE_FILL }}
            >
              {result.score.toFixed(2)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
