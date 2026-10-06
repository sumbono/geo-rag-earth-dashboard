"use client";

import { useRef, useState } from "react";
import BboxDraw, { type BboxDrawHandle } from "../../components/BboxDraw";
import DetailPanel from "../../components/DetailPanel";
import EmptyState from "../../components/EmptyState";
// Aliased: a bare `Map` import would shadow the global `Map` constructor
// that `unionByIdMax` below needs (`new Map(...)` would build a component).
import MapView, { type MapHandle } from "../../components/Map";
import ResultsPanel from "../../components/ResultsPanel";
import SearchBar from "../../components/SearchBar";
import { ApiError, searchVector } from "../../lib/api";
import type { SearchResult } from "../../lib/types";

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
 * before any search the page stays blank (`searched` gate).
 *
 * Task 19: the page owns draw mode, the last-searched text (`currentQuery`,
 * captured at submit so later edits don't leak into the bbox `q`), and the
 * merge — BboxDraw runs the two-click machine and POSTs; its hits are unioned
 * into `results` by id with max score winning.
 */
export default function DashboardPage() {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drawMode, setDrawMode] = useState(false);
  const [currentQuery, setCurrentQuery] = useState("");
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

  /** Arming draw mode starts a fresh canvas: drop the previous box. */
  function handleToggleDraw() {
    const next = !drawMode;
    setDrawMode(next);
    if (next) mapRef.current?.setRectangle(null);
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
    <main
      className="dashboard"
      style={{ display: "flex", flexDirection: "column", gap: 12, padding: 16 }}
    >
      <SearchBar
        query={query}
        onQueryChange={setQuery}
        onSearchStart={handleSearchStart}
        onResults={handleResults}
        onError={handleError}
      />
      <BboxDraw
        ref={bboxDrawRef}
        active={drawMode}
        onToggle={handleToggleDraw}
        currentQuery={currentQuery}
        onResults={handleBboxResults}
        onRectangle={(bbox) => mapRef.current?.setRectangle(bbox)}
        onError={handleError}
      />
      {error !== null && (
        <p role="alert" style={{ margin: 0, color: "#b91c1c" }}>
          {error}
        </p>
      )}
      {loading && (
        <p role="status" style={{ margin: 0 }}>
          Searching…
        </p>
      )}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) 300px",
          gap: 12,
          alignItems: "start",
        }}
      >
        <MapView
          ref={mapRef}
          results={results}
          onPick={setSelectedId}
          onMapClick={
            drawMode
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
        ) : null}
      </div>
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
