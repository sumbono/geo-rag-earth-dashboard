"use client";

import { EXAMPLE_QUERIES } from "../lib/suggestions";

export interface EmptyStateProps {
  /** Hands the chosen example query back so the page can run the search. */
  onSuggest: (query: string) => void;
}

/**
 * Empty search result (Task 18): shown by the dashboard only after a search
 * has run and returned nothing. Three example queries run a fresh search on
 * click — first visit before any search shows the FirstRunGuide instead.
 */
export default function EmptyState({ onSuggest }: EmptyStateProps) {
  return (
    <section
      aria-label="No results"
      className="empty-state"
      style={{
        background: "var(--surface, #ffffff)",
        border: "1px dashed var(--border, #d7e0e8)",
        borderRadius: 14,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <p style={{ margin: 0, fontWeight: 600 }}>No results</p>
      <p style={{ margin: 0, color: "var(--ink-soft, #4a5b6a)", fontSize: "0.9rem" }}>
        Try one of these searches:
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {EXAMPLE_QUERIES.map((query) => (
          <button
            key={query}
            type="button"
            className="button button--ghost"
            onClick={() => onSuggest(query)}
            style={{ cursor: "pointer", textAlign: "left", padding: "0.6rem 1rem" }}
          >
            {query}
          </button>
        ))}
      </div>
    </section>
  );
}
