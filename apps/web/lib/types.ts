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
