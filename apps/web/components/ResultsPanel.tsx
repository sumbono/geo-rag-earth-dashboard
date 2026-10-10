"use client";

import type { SearchResult } from "../lib/types";

export interface ResultsPanelProps {
  results: SearchResult[];
  /** Currently picked hit — highlighted row; owned by the page. */
  selectedId?: string | null;
  onPick: (id: string) => void;
  /** Cross-highlight feed (Task 9): row hover/focus → `id`, leave/blur →
   *  `null`. Optional so existing renders without it stay valid (finding 13);
   *  the page mirrors it onto the map/3D `hoveredId` paint. */
  onHover?: (id: string | null) => void;
}

/**
 * Ranked search hits (Task 17): one row per result showing `score` at 2
 * decimal places and `captured_at`'s UTC date (ISO slice 0..10). Clicking a
 * row calls `onPick(id)`; the page mirrors that onto the map selection.
 * Selection is exposed as `aria-current` (a row marks position in a list —
 * audit #13), not `aria-pressed`. Rows are styled by `.results-row` in
 * globals.css (mono + tabular-nums data, accent-soft selected tint).
 * The page only mounts this panel when `results.length > 0` — the empty
 * case is the EmptyState's (Task 18).
 */
export default function ResultsPanel({
  results,
  selectedId,
  onPick,
  onHover,
}: ResultsPanelProps) {
  return (
    <ul
      aria-label="Search results"
      style={{
        listStyle: "none",
        margin: 0,
        padding: 0,
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-2xs)",
        maxHeight: "min(60vh, 560px)",
        overflowY: "auto",
      }}
    >
      {results.map((result) => {
        const selected = result.id === selectedId;
        return (
          <li key={result.id}>
            <button
              type="button"
              className="results-row"
              data-testid="result-row"
              aria-current={selected ? "true" : undefined}
              onClick={() => onPick(result.id)}
              onMouseEnter={() => onHover?.(result.id)}
              onMouseLeave={() => onHover?.(null)}
              onFocus={() => onHover?.(result.id)}
              onBlur={() => onHover?.(null)}
            >
              <span>{result.score.toFixed(2)}</span>
              <span>{result.captured_at.slice(0, 10)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
