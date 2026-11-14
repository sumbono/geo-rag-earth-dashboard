"use client";

import { EXAMPLE_QUERIES } from "../lib/suggestions";

export interface EmptyStateProps {
  /** Hands the chosen example query back so the page can run the search. */
  onSuggest: (query: string) => void;
  /** Optional explanation above the suggestions (P0/P1 Task 3): the dashboard
   *  passes the coverage-outline hint when the empty result came from a
   *  spatial-only search. Absent by default so text-search empties stay plain. */
  hint?: string;
}

/**
 * Empty search result (Task 18): shown by the dashboard only after a search
 * has run and returned nothing. Three example queries run a fresh search on
 * click — first visit before any search shows the FirstRunGuide instead.
 */
export default function EmptyState({ onSuggest, hint }: EmptyStateProps) {
  return (
    <section
      aria-label="No results"
      className="empty-state"
      style={{
        background: "var(--color-paper-2)",
        border: "var(--rule)",
        borderRadius: "var(--radius-card)",
        padding: "var(--space-sm)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-2xs)",
      }}
    >
      <p style={{ margin: 0, fontWeight: 600 }}>No results</p>
      {hint && (
        <p
          data-testid="empty-hint"
          style={{ margin: 0, color: "var(--color-ink-soft)", fontSize: "var(--text-sm)" }}
        >
          {hint}
        </p>
      )}
      <p style={{ margin: 0, color: "var(--color-ink-soft)", fontSize: "var(--text-sm)" }}>
        Try one of these searches:
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2xs)" }}>
        {EXAMPLE_QUERIES.map((query) => (
          <button
            key={query}
            type="button"
            className="button button--ghost"
            onClick={() => onSuggest(query)}
            style={{ cursor: "pointer", textAlign: "left", padding: "var(--space-2xs) var(--space-sm)" }}
          >
            {query}
          </button>
        ))}
      </div>
    </section>
  );
}
