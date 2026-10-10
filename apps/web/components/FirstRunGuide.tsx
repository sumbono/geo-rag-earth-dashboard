"use client";

import { EXAMPLE_QUERIES } from "../lib/suggestions";

export interface FirstRunGuideProps {
  /** Shown only before the first search (`!searched && results.length === 0`). */
  visible: boolean;
  /** Runs the chosen example query (page-owned search path). */
  onSuggest: (query: string) => void;
}

/**
 * First-run guidance (audit critical #3): explains how search works and what
 * the values mean before any search has run, with runnable example queries.
 * Deliberately text + chips only — the EmptyState owns the no-result case.
 */
export default function FirstRunGuide({ visible, onSuggest }: FirstRunGuideProps) {
  if (!visible) return null;
  return (
    <section aria-label="How this works" className="guide">
      <h2 className="guide__title">How this works</h2>
      <ol className="guide__steps">
        <li>Describe a place in plain words — e.g. “shallow turquoise water near a reef”.</li>
        <li>Results rank by <strong>score</strong>: 1.00 is a near-exact semantic match, 0.00 unrelated.</li>
        <li>Each row’s date is the satellite <strong>capture date</strong>; click a result for details, imagery and location.</li>
      </ol>
      <p className="guide__examples-label">Try one:</p>
      <div className="guide__examples">
        {EXAMPLE_QUERIES.map((query) => (
          <button key={query} type="button" className="button button--ghost" onClick={() => onSuggest(query)}>
            {query}
          </button>
        ))}
      </div>
    </section>
  );
}
