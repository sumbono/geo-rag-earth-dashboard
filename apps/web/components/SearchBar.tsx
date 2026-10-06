"use client";

import { useState, type FormEvent } from "react";
import { apiFetch } from "../lib/api";
import type { SearchResult } from "../lib/types";

export interface SearchBarProps {
  /** Called at submit time so the page can flip its loading flag on. */
  onSearchStart: () => void;
  /** Lifts the ranked hits up to the page that owns map + list state. */
  onResults: (results: SearchResult[]) => void;
  /** Anything `apiFetch` throws (ApiError, network failure) for the page to render. */
  onError: (error: unknown) => void;
}

/**
 * Vector-search input (Task 17). One submit → one `POST /api/search/vector`
 * with `{query}`; the parsed `{results}` are handed straight to the page via
 * `onResults`. Submit stays disabled until there is a non-blank query, so the
 * backend's `min_length=1` 422 is unreachable from this form.
 */
export default function SearchBar({
  onSearchStart,
  onResults,
  onError,
}: SearchBarProps) {
  const [query, setQuery] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSearchStart();
    setSubmitting(true);
    try {
      const data = await apiFetch<{ results: SearchResult[] }>(
        "/api/search/vector",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query }),
        },
      );
      onResults(data.results);
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
      style={{ display: "flex", gap: 8, alignItems: "center" }}
    >
      <label htmlFor="dashboard-search" style={{ fontWeight: 600 }}>
        Search
      </label>
      <input
        id="dashboard-search"
        name="q"
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
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
    </form>
  );
}
