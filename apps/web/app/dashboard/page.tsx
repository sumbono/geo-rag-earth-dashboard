"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import AppHeader from "../../components/AppHeader";
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
import { downloadText, resultsToCSV, resultsToGeoJSON } from "../../lib/export";
import { parseUrlState, replaceUrlState } from "../../lib/urlState";
import type { Bbox, SearchResult } from "../../lib/types";

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
  // Cross-highlight (Task 9): the row under the pointer/keyboard focus —
  // fed to Map (marker paint) and View3D (point scale/accent) as one prop.
  const [hoveredId, setHoveredId] = useState<string | null>(null);
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
  // Focus intent for the next DetailPanel mount (Task 9 fix R1): the tile
  // `key` remounts the panel on every prev/next, so the pressed button is a
  // new DOM node — this tells it which button to re-focus.
  const pendingFocusRef = useRef<"prev" | "next" | null>(null);
  // P0/P1 Task 5 — shareable URL state.
  // lastRect is STATE (not a ref): the sync effect depends on it, so clearing
  // it on re-arm re-fires the effect and drops ?bbox= from the URL.
  const [lastRect, setLastRect] = useState<Bbox | null>(null);
  const [shareStatus, setShareStatus] = useState<string | null>(null);
  const restoredRef = useRef(false);
  const pendingTileRef = useRef<string | null>(null);
  // How many restore fetches (?q= and/or ?bbox=) are still in flight — the
  // tile intent is only applied-or-cleared once ALL of them have produced
  // results (final-review Critical: the bbox path flows through
  // handleBboxResults, and q+bbox links race the two responses).
  const restorePendingFetchesRef = useRef(0);

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
    setHoveredId(null);
    setLoading(false);
    setError(null);
    // One restore fetch (vector path) has produced results — the tile intent
    // itself is applied-or-cleared by the results effect below, once every
    // restore fetch has finished (q+bbox links must see the union).
    if (restorePendingFetchesRef.current > 0) restorePendingFetchesRef.current -= 1;
  }

  /** Prev/next step through the ranked hits with wrap-around (Task 9).
   *  Early-returns when there is nothing to cycle: fewer than 2 results, or
   *  no selection — the ArrowLeft/Right listener lives inside DetailPanel,
   *  which only mounts once something is selected, so a "select index 0 from
   *  nothing" branch would be unreachable dead code (finding 21); the first
   *  selection always happens by click. */
  function handlePrevNext(delta: 1 | -1) {
    if (results.length < 2 || selectedId === null) return;
    const index = results.findIndex((result) => result.id === selectedId);
    if (index === -1) return;
    // Set BEFORE the state update so the remounting panel receives it.
    pendingFocusRef.current = delta > 0 ? "next" : "prev";
    setSelectedId(results[(index + delta + results.length) % results.length].id);
  }

  // Consume the focus intent after the commit that applied it (child effects
  // run first, so the panel has already focused). Clearing here means a later
  // unrelated remount — close/reopen, fresh search — never steals focus.
  useEffect(() => {
    pendingFocusRef.current = null;
  });

  function handleError(err: unknown) {
    setError(
      err instanceof ApiError ? err.message : "Search failed. Please try again.",
    );
    setLoading(false);
    // A failed restore search drops the tile intent entirely — an armed ref
    // after an error would pop the detail open on some later unrelated search
    // (final-review error-path pin).
    pendingTileRef.current = null;
    restorePendingFetchesRef.current = 0;
  }

  /** Bbox hits merge into the panel (union by id, max score wins) — they do
   *  not clear the selection, which is still present in the union. */
  function handleBboxResults(incoming: SearchResult[]) {
    setSearched(true);
    setError(null);
    setResults((prev) => unionByIdMax(prev, incoming));
    // Second possible restore fetch (bbox path) — same handshake as
    // handleResults; the results effect applies-or-clears the tile intent.
    if (restorePendingFetchesRef.current > 0) restorePendingFetchesRef.current -= 1;
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
    if (next === "rect") {
      // Re-arm = fresh canvas: the persisted rect is dropped (pre-existing
      // behavior) — lastRect must drop with it or ?bbox= goes stale (Task 5).
      // Mid-draw toggle-off (next === null) deliberately keeps both.
      mapRef.current?.setRectangle(null);
      setLastRect(null);
    }
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

  // P0/P1 Task 5 — restore ONCE from the URL. Run-once ref: replaceState
  // never re-fires this effect (Review Focus #1's single-POST pin).
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    const s = parseUrlState(window.location.search);
    if (s.q) {
      setQuery(s.q);
      void handleSuggest(s.q); // complete text-search path
    }
    if (s.bbox) {
      // runBbox emits onRectangle → map draws it + setLastRect; the ONE
      // search POST is runBbox's (Review Focus #2).
      bboxDrawRef.current?.runBbox?.(s.bbox);
    }
    if (s.tile) {
      // NOT setSelectedId here — both result handlers null the selection when
      // a restore search lands, and tile-only URLs fetch nothing. The tile
      // intent is applied-or-cleared by the results effect once every queued
      // restore fetch (counted below) has produced results; a tile-only URL
      // has no fetches, so it is dropped immediately (opens nothing).
      const queued = (s.q ? 1 : 0) + (s.bbox ? 1 : 0);
      restorePendingFetchesRef.current = queued;
      pendingTileRef.current = queued > 0 ? s.tile : null;
    }
    // Deliberate run-once semantics (see comment above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Apply-or-clear the restored tile exactly once, after ALL restore fetches
  // have produced results (final-review Critical: the bbox path reaches
  // results via handleBboxResults, and q+bbox links race two responses —
  // clearing on the first completion would drop the tile from the union).
  useEffect(() => {
    if (pendingTileRef.current === null) return;
    if (restorePendingFetchesRef.current > 0) return; // sibling still in flight
    if (results.some((r) => r.id === pendingTileRef.current)) {
      setSelectedId(pendingTileRef.current);
    }
    pendingTileRef.current = null; // clear on MISS too — never stay armed
  }, [results]);

  // P0/P1 Task 5 — keep the URL in sync after user actions. lastRect is in
  // the deps as STATE so clearing it (re-arm) re-fires and drops ?bbox=.
  useEffect(() => {
    if (!searched) return;
    replaceUrlState({
      q: currentQuery || undefined,
      bbox: lastRect,
      // While a restore is still in flight the tile lives only in the ref —
      // include it so `searched` flipping true does not transiently drop
      // ?tile= from a shared link (final-review Important).
      tile: selectedId ?? pendingTileRef.current,
    });
    // `results` participates so a union-refresh with a new selection context
    // re-syncs; the URL content itself derives from the named state.
  }, [searched, currentQuery, selectedId, results, lastRect]);

  const selectedTile =
    selectedId === null
      ? null
      : (results.find((result) => result.id === selectedId) ?? null);

  return (
    <main className="dashboard">
      <AppHeader
        onShare={() => {
          replaceUrlState({
            q: currentQuery || undefined,
            bbox: lastRect,
            tile: selectedId ?? pendingTileRef.current,
          });
          if (navigator.clipboard?.writeText) {
            void navigator.clipboard.writeText(window.location.href).then(
              () => setShareStatus("Link copied"),
              () =>
                setShareStatus(
                  "Copy from the address bar: " + window.location.href,
                ),
            );
          } else {
            // Insecure context / jsdom: show the URL for manual copy (RF#4).
            setShareStatus("Copy from the address bar: " + window.location.href);
          }
        }}
      />
      {shareStatus !== null && (
        <p role="status" className="dash-share-status">
          {shareStatus}
        </p>
      )}
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
        onRectangle={(bbox) => {
          mapRef.current?.setRectangle(bbox);
          setLastRect(bbox);
        }}
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
            hoveredId={hoveredId}
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
              onHover={setHoveredId}
              mode={currentQuery !== "" ? "ranked" : "recency"}
              onExportGeoJSON={() =>
                downloadText(
                  "search-results.geojson",
                  "application/geo+json",
                  resultsToGeoJSON(results),
                )
              }
              onExportCSV={() =>
                downloadText("search-results.csv", "text/csv", resultsToCSV(results))
              }
            />
          ) : searched ? (
            // Issue 8: gate on `loading` so a first (or repeat) search in
            // flight never flashes EmptyState before the response lands.
            loading ? null : (
              <EmptyState
                onSuggest={handleSuggest}
                hint={
                  currentQuery === ""
                    ? "Nothing indexed in this area — the dashed outline on the map shows what's searchable."
                    : undefined
                }
              />
            )
          ) : (
            <FirstRunGuide visible onSuggest={handleSuggest} />
          )}
        </div>
      )}
      {tab === "3d" && <View3D results={results} hoveredId={hoveredId} />}
      {tab === "telemetry" && <TelemetryChart />}
      {selectedTile !== null && (
        <DetailPanel
          key={selectedTile.id}
          tile={selectedTile}
          results={results}
          onClose={() => setSelectedId(null)}
          onNavigate={handlePrevNext}
          initialFocus={pendingFocusRef.current ?? undefined}
        />
      )}
    </main>
  );
}
