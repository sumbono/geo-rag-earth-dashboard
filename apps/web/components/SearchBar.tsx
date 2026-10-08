"use client";

import { useState, type FormEvent } from "react";
import { searchVector } from "../lib/api";
import { EXAMPLE_QUERIES } from "../lib/suggestions";
import type { SearchResult } from "../lib/types";

export interface SearchBarProps {
  /** The active query — owned by the page so suggestion clicks can sync it. */
  query: string;
  /** Page-side setter for the query text. */
  onQueryChange: (query: string) => void;
  /** Called at submit time so the page can flip its loading flag on. */
  onSearchStart: () => void;
  /** Lifts the ranked hits up to the page that owns map + list state. */
  onResults: (results: SearchResult[]) => void;
  /** Anything `apiFetch` throws (ApiError, network failure) for the page to render. */
  onError: (error: unknown) => void;
  /** Example-chip click — the page runs the search (same path as EmptyState). */
  onSuggest: (query: string) => void;
}

/**
 * Vector-search input (Task 17). One submit → one `POST /api/search/vector`
 * with `{query}`; the parsed `{results}` are handed straight to the page via
 * `onResults`. The query text lives on the page so EmptyState suggestions
 * keep the input in sync with the search they just ran. Submit stays
 * disabled until there is a non-blank query, so the backend's `min_length=1`
 * 422 is unreachable from this form.
 */
export default function SearchBar({
  query,
  onQueryChange,
  onSearchStart,
  onResults,
  onError,
  onSuggest,
}: SearchBarProps) {
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSearchStart();
    setSubmitting(true);
    try {
      onResults(await searchVector(query));
    } catch (error) {
      onError(error);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      role="search"
      onSubmit={handleSubmit}
      noValidate
      style={{ display: "flex", flexDirection: "column", gap: 8 }}
    >
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <label htmlFor="dashboard-search" style={{ fontWeight: 600 }}>
          Search
        </label>
        <input
          id="dashboard-search"
          name="q"
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="water, reef, coastline…"
          autoComplete="off"
          style={{ flex: 1, minWidth: 0, padding: "8px 10px" }}
        />
        <button
          type="submit"
          className="button button--primary"
          disabled={submitting || query.trim() === ""}
        >
          {submitting ? "Searching…" : "Search"}
        </button>
      </div>
      {/* role="group" so aria-label is exposed — ARIA ignores it on role-less generics (R-2a) */}
      <div className="searchbar__suggestions" role="group" aria-label="Example queries">
        {EXAMPLE_QUERIES.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            className="button button--ghost searchbar__chip"
            onClick={() => onSuggest(suggestion)}
          >
            {suggestion}
          </button>
        ))}
      </div>
    </form>
  );
}
