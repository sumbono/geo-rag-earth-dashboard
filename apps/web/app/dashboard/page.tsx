"use client";

import dynamic from "next/dynamic";
import { useRef, useState } from "react";
import BboxDraw, { type BboxDrawHandle } from "../../components/BboxDraw";
import DetailPanel from "../../components/DetailPanel";
import EmptyState from "../../components/EmptyState";
import FirstRunGuide from "../../components/FirstRunGuide";
// Aliased: a bare `Map` import would shadow the global `Map` constructor
// that `unionByIdMax` below needs (`new Map(...)` would build a component).
import MapView, { type MapHandle } from "../../components/Map";
import ResultsPanel from "../../components/ResultsPanel";
import SearchBar from "../../components/SearchBar";
import TelemetryChart from "../../components/TelemetryChart";
import { ApiError, searchVector } from "../../lib/api";
import type { SearchResult } from "../../lib/types";

// three.js must never load during SSR — client-only, loaded on demand when
// the 3D tab is first opened.
const View3D = dynamic(() => import("../../components/View3D"), { ssr: false });

/** Main-viewport tabs: the map (default), the Task 20 3D view, and the
 *  Task 21 telemetry chart. */
type Tab = "map" | "3d" | "telemetry";

const TABS: { id: Tab; label: string }[] = [
  { id: "map", label: "Map" },
  { id: "3d", label: "3D" },
  { id: "telemetry", label: "Telemetry" },
];

/**
 * Union of two result lists keyed by id — a shared id keeps the higher score
 * (Task 19: bbox hits merge into whatever the panel already shows; Map.set
 * preserves the first-inserted position, so vector order survives).
 */
function unionByIdMax(
  prev: SearchResult[],
  next: SearchResult[],
): SearchResult[] {
  const merged = new Map<string, SearchResult>();
  for (const result of prev) merged.set(result.id, result);
  for (const result of next) {
    const current = merged.get(result.id);
    if (current === undefined || result.score > current.score) {
      merged.set(result.id, result);
    }
  }
  return [...merged.values()];
}

/**
 * Authenticated dashboard: SearchBar runs vector search, results flow into
 * the Map and ResultsPanel; picking a row or marker opens the DetailPanel.
 * After a search returns nothing the EmptyState offers example queries —
 * before any search the FirstRunGuide explains how search works (`searched` gate).
 *
 * Task 19: the page owns draw mode, the last-searched text (`currentQuery`,
 * captured at submit so later edits don't leak into the bbox `q`), and the
 * merge — BboxDraw runs the two-click machine and POSTs; its hits are unioned
 * into `results` by id with max score winning.
 *
 * Task 7: draw mode became `drawShape: "rect" | "polygon" | null` — the page
 * owns both flags and BboxDraw derives its pressed-states from the exact
 * pair `active={drawShape !== null}` / `polygonMode={drawShape === "polygon"}`
 * (armed in either mode keeps the keydown listeners attached). Arming one
 * tool disarms the other and clears the preview/polygon layers; polygon
 * hits merge through the same `handleBboxResults` union path.
 *
 * Task 20: a Map | 3D | Telemetry tab bar (aria-pressed toggles) swaps the
 * main viewport — the map grid, the client-only Three.js `<View3D>` of the
 * same results, or the Task 21 `<TelemetryChart>` (D3 line chart of one
 * buoy's 24h window). Search, bbox draw, errors and the DetailPanel live
 * outside the tabs.
 */
export default function DashboardPage() {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Which draw tool is armed — page-owned, mutually exclusive (Task 7):
  // null (off) | "rect" ("Draw area") | "polygon" ("Draw polygon").
  const [drawShape, setDrawShape] = useState<"rect" | "polygon" | null>(null);
  const [currentQuery, setCurrentQuery] = useState("");
  const [tab, setTab] = useState<Tab>("map");
  const mapRef = useRef<MapHandle | null>(null);
  const bboxDrawRef = useRef<BboxDrawHandle | null>(null);

  /** `searchText` covers suggestion clicks (state not yet flushed); a plain
   *  SearchBar submit passes nothing and reads the live input value. */
  function handleSearchStart(searchText?: string) {
    setCurrentQuery(searchText ?? query);
    setSearched(true);
    setLoading(true);
    setError(null);
  }

  function handleResults(next: SearchResult[]) {
    setResults(next);
    setSelectedId(null);
    setLoading(false);
    setError(null);
  }

  function handleError(err: unknown) {
    setError(
      err instanceof ApiError ? err.message : "Search failed. Please try again.",
    );
    setLoading(false);
  }

  /** Bbox hits merge into the panel (union by id, max score wins) — they do
   *  not clear the selection, which is still present in the union. */
  function handleBboxResults(incoming: SearchResult[]) {
    setSearched(true);
    setError(null);
    setResults((prev) => unionByIdMax(prev, incoming));
  }

  /** Rect toggle — the "Draw area" button AND the rect machine's own
   *  close-time `onToggle`. Arms rect (dropping the previous box — the
   *  pre-existing fresh-canvas behavior) or disarms; either way the preview
   *  + polygon layers are cleared (arming one tool clears the other's
   *  geometry). The completed rectangle survives its close-time disarm
   *  because BboxDraw re-emits onPreview/onRectangle AFTER this returns. */
  function handleToggleRect() {
    const next = drawShape === "rect" ? null : "rect";
    setDrawShape(next);
    mapRef.current?.setPreviewRectangle(null);
    mapRef.current?.setPolygon(null);
    if (next === "rect") mapRef.current?.setRectangle(null);
  }

  /** Polygon toggle: arms polygon (fresh vertices in BboxDraw) or disarms.
   *  Clears the preview + polygon layers either way; the completed polygon
   *  survives its own close-time disarm because runPolygon disarms BEFORE
   *  calling onPolygon (disarm → handoff → request, mirroring the rect
   *  machine), so this clear always runs before the shape is drawn. */
  function handleTogglePolygon() {
    const next = drawShape === "polygon" ? null : "polygon";
    setDrawShape(next);
    mapRef.current?.setPreviewRectangle(null);
    mapRef.current?.setPolygon(null);
  }

  /** EmptyState suggestion → same single POST as a manual search. */
  async function handleSuggest(suggested: string) {
    setQuery(suggested);
    handleSearchStart(suggested);
    try {
      handleResults(await searchVector(suggested));
    } catch (err) {
      handleError(err);
    }
  }

  const selectedTile =
    selectedId === null
      ? null
      : (results.find((result) => result.id === selectedId) ?? null);

  return (
    <main className="dashboard">
      <SearchBar
        query={query}
        onQueryChange={setQuery}
        onSearchStart={handleSearchStart}
        onResults={handleResults}
        onError={handleError}
        onSuggest={handleSuggest}
      />
      <BboxDraw
        ref={bboxDrawRef}
        active={drawShape !== null}
        polygonMode={drawShape === "polygon"}
        onToggle={handleToggleRect}
        onTogglePolygon={handleTogglePolygon}
        currentQuery={currentQuery}
        onResults={handleBboxResults}
        onRectangle={(bbox) => mapRef.current?.setRectangle(bbox)}
        onPreview={(bbox) => mapRef.current?.setPreviewRectangle(bbox)}
        onPolygon={(polygon) => mapRef.current?.setPolygon(polygon)}
        onError={handleError}
      />
      <div className="dash-row" role="group" aria-label="View">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            className={
              tab === id ? "button button--primary" : "button button--ghost"
            }
            aria-pressed={tab === id}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {error !== null && (
        <p role="alert" className="dash-alert">
          {error}
        </p>
      )}
      {loading && (
        <p role="status" className="dash-status">
          Searching…
        </p>
      )}
      {tab === "map" && (
        <div className="dash-grid">
          <MapView
            ref={mapRef}
            results={results}
            onPick={setSelectedId}
            onMapClick={
              drawShape !== null
                ? (lonLat) => bboxDrawRef.current?.handleMapClick(lonLat)
                : undefined
            }
          />
          {results.length > 0 ? (
            <ResultsPanel
              results={results}
              selectedId={selectedId}
              onPick={setSelectedId}
            />
          ) : searched ? (
            <EmptyState onSuggest={handleSuggest} />
          ) : (
            <FirstRunGuide visible onSuggest={handleSuggest} />
          )}
        </div>
      )}
      {tab === "3d" && <View3D results={results} />}
      {tab === "telemetry" && <TelemetryChart />}
      {selectedTile !== null && (
        <DetailPanel
          key={selectedTile.id}
          tile={selectedTile}
          results={results}
          onClose={() => setSelectedId(null)}
        />
      )}
    </main>
  );
}
