"use client";

import { line, scaleLinear, scaleTime, utcFormat } from "d3";
import { useEffect, useMemo, useState } from "react";
import { ApiError, apiFetch } from "../lib/api";
import type { TelemetryPoint } from "../lib/types";

/** The five seeded Red Sea buoys (Task 10). */
const BUOYS = [
  "buoy-rs-1",
  "buoy-rs-2",
  "buoy-rs-3",
  "buoy-rs-4",
  "buoy-rs-5",
] as const;

/** Logical canvas width; the SVG scales to its container via `viewBox`. */
const WIDTH = 640;
const HEIGHT = 260;
const MARGIN = { top: 16, right: 16, bottom: 28, left: 52 };

const LINE_STROKE = "#0b6f8f"; // var(--accent)
const GRID_STROKE = "#e1e8ee";
const AXIS_STROKE = "#d7e0e8";
const LABEL_FILL = "#4a5b6a";

/** Always-UTC tick label ("06 Oct 14:00") regardless of the host timezone. */
const X_TICK_FORMAT = utcFormat("%d %b %H:%M");

/** Neat tick label: "0.3", not "0.30000000000000004". */
function tickLabel(tick: number): string {
  return String(Number(tick.toFixed(2)));
}

/** Model handed to the renderer: scales, ticks and the line path — all
 *  computed by d3, all rendered by React (same split as ScoreBarChart). */
interface ChartModel {
  path: string;
  xTickLabels: { x: number; label: string }[];
  yTicks: { y: number; label: string }[];
}

/**
 * D3 line chart for one buoy's 24-hour telemetry window (Task 21): fetches on
 * mount (default `buoy-rs-1`, refetched on selector change), x = time with UTC
 * axis labels via `d3.utcFormat`, y = value. d3 is confined to scales and path
 * shape — React owns every SVG node, so there is no DOM takeover and nothing
 * to clean up. Loading, empty ("No telemetry") and error states are rendered
 * in place of the chart.
 */
export default function TelemetryChart() {
  const [buoyId, setBuoyId] = useState<string>(BUOYS[0]);
  const [points, setPoints] = useState<TelemetryPoint[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    // Back to the loading state for the new buoy; the abort in cleanup means
    // a stale response never lands (no setState after unmount).
    setPoints(null);
    setError(null);
    apiFetch<{ points: TelemetryPoint[]; count: number }>(
      `/api/telemetry/query?buoy_id=${buoyId}&hours=24`,
      { signal: controller.signal },
    )
      .then((data) => {
        if (!controller.signal.aborted) setPoints(data.points);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          err instanceof ApiError
            ? err.message
            : "Telemetry unavailable. Please try again.",
        );
      });
    return () => controller.abort();
  }, [buoyId]);

  const chart = useMemo<ChartModel | null>(() => {
    if (points === null || points.length === 0) return null;

    const data = points.map((point) => ({
      t: new Date(point.ts),
      v: point.value,
    }));

    // Degenerate extents (one sample, or a flat series) would collapse a
    // scale's domain to a single point — pad so the geometry stays defined.
    let t0 = +data[0].t;
    let t1 = t0;
    let v0 = data[0].v;
    let v1 = v0;
    for (const datum of data) {
      const t = +datum.t;
      if (t < t0) t0 = t;
      if (t > t1) t1 = t;
      if (datum.v < v0) v0 = datum.v;
      if (datum.v > v1) v1 = datum.v;
    }
    if (t0 === t1) {
      t0 -= 30 * 60 * 1000;
      t1 += 30 * 60 * 1000;
    }
    if (v0 === v1) {
      v0 -= 1;
      v1 += 1;
    }

    const x = scaleTime()
      .domain([new Date(t0), new Date(t1)])
      .range([MARGIN.left, WIDTH - MARGIN.right]);
    const y = scaleLinear()
      .domain([v0, v1])
      .nice()
      .range([HEIGHT - MARGIN.bottom, MARGIN.top]);

    const path = line<{ t: Date; v: number }>()
      .x((datum) => x(datum.t))
      .y((datum) => y(datum.v))(data);

    return {
      path: path ?? "",
      xTickLabels: x.ticks(4).map((tick) => ({
        x: x(tick),
        label: X_TICK_FORMAT(tick),
      })),
      yTicks: y.ticks(4).map((tick) => ({
        y: y(tick),
        label: tickLabel(tick),
      })),
    };
  }, [points]);

  return (
    <div
      className="telemetry-chart"
      style={{ display: "flex", flexDirection: "column", gap: 8 }}
    >
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <label htmlFor="telemetry-buoy">Buoy</label>
        <select
          id="telemetry-buoy"
          value={buoyId}
          onChange={(event) => setBuoyId(event.target.value)}
        >
          {BUOYS.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
      </div>

      {error !== null && (
        <p role="alert" style={{ margin: 0, color: "#b91c1c" }}>
          {error}
        </p>
      )}
      {error === null && points === null && (
        <p role="status" style={{ margin: 0 }}>
          Loading telemetry…
        </p>
      )}
      {error === null && points !== null && points.length === 0 && (
        <p style={{ margin: 0 }}>No telemetry</p>
      )}
      {error === null && chart !== null && (
        <svg
          className="telemetry-chart__svg"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-label={`Telemetry for ${buoyId}: ${points?.length ?? 0} points`}
          style={{
            display: "block",
            width: "100%",
            maxWidth: WIDTH,
            height: "auto",
          }}
        >
          {/* Recessive grid + value labels along the y axis. */}
          {chart.yTicks.map((tick) => (
            <g key={tick.label}>
              <line
                x1={MARGIN.left}
                x2={WIDTH - MARGIN.right}
                y1={tick.y}
                y2={tick.y}
                stroke={GRID_STROKE}
                strokeWidth={1}
              />
              <text
                x={MARGIN.left - 6}
                y={tick.y}
                textAnchor="end"
                dominantBaseline="middle"
                fontSize={10}
                fill={LABEL_FILL}
              >
                {tick.label}
              </text>
            </g>
          ))}
          {/* Time axis baseline + UTC tick labels. */}
          <line
            x1={MARGIN.left}
            x2={WIDTH - MARGIN.right}
            y1={HEIGHT - MARGIN.bottom}
            y2={HEIGHT - MARGIN.bottom}
            stroke={AXIS_STROKE}
            strokeWidth={1}
          />
          {chart.xTickLabels.map((tick) => (
            <text
              key={tick.label + tick.x}
              x={tick.x}
              y={HEIGHT - MARGIN.bottom + 14}
              textAnchor="middle"
              fontSize={10}
              fill={LABEL_FILL}
            >
              {tick.label}
            </text>
          ))}
          <path
            className="telemetry-chart__line"
            d={chart.path}
            fill="none"
            stroke={LINE_STROKE}
            strokeWidth={2}
          />
        </svg>
      )}
    </div>
  );
}
