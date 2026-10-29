/** Axis-aligned search box `[[west, south], [east, north]]` (bbox API contract). */
export type Bbox = [[number, number], [number, number]];

/** One search hit — field names match the API contract (Tasks 7/10) exactly. */
export interface SearchResult {
  id: string;
  thumb_url: string;
  bbox: number[][][];
  score: number;
  captured_at: string;
}

/** One telemetry sample — field names match `GET /telemetry/query` (Task 10). */
export interface TelemetryPoint {
  ts: string;
  value: number;
}

/** `GET /api/coverage` response — every indexed tile's footprint (fix-improve Task 4). */
export interface CoverageFC {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    geometry: { type: "Polygon"; coordinates: number[][][] };
    properties: { id: string; captured_at: string };
  }>;
}
