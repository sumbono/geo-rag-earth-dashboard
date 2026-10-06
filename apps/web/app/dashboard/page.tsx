"use client";

import { useState } from "react";
import Map from "../../components/Map";
import ResultsPanel from "../../components/ResultsPanel";
import SearchBar from "../../components/SearchBar";
import { ApiError } from "../../lib/api";
import type { SearchResult } from "../../lib/types";

/**
 * Authenticated dashboard (Task 17): SearchBar runs vector search through
 * `apiFetch`, results flow into the Map (score-colored markers, fly-to-first)
 * and the ResultsPanel list. Picking a row or marker selects the hit — the
 * richer empty/detail states belong to Task 18.
 */
export default function DashboardPage() {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleSearchStart() {
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
        <ResultsPanel
          results={results}
          selectedId={selectedId}
          onPick={setSelectedId}
        />
      </div>
    </main>
  );
}
