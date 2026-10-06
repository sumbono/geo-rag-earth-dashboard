"use client";

import { useState } from "react";
import DetailPanel from "../../components/DetailPanel";
import EmptyState from "../../components/EmptyState";
import Map from "../../components/Map";
import ResultsPanel from "../../components/ResultsPanel";
import SearchBar from "../../components/SearchBar";
import { ApiError, searchVector } from "../../lib/api";
import type { SearchResult } from "../../lib/types";

/**
 * Authenticated dashboard: SearchBar runs vector search, results flow into
 * the Map and ResultsPanel; picking a row or marker opens the DetailPanel.
 * After a search returns nothing the EmptyState offers example queries —
 * before any search the page stays blank (`searched` gate).
 */
export default function DashboardPage() {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleSearchStart() {
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

  /** EmptyState suggestion → same single POST as a manual search. */
  async function handleSuggest(query: string) {
    handleSearchStart();
    try {
      handleResults(await searchVector(query));
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
        onSearchStart={handleSearchStart}
        onResults={handleResults}
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
        <Map results={results} onPick={setSelectedId} />
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
