import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ResultsPanel from "../components/ResultsPanel";
import type { SearchResult } from "../lib/types";

const TWO: SearchResult[] = [
  {
    id: "a",
    thumb_url: "/api/thumbs/a",
    bbox: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
    score: 0.91,
    captured_at: "2026-10-05T00:00:00Z",
  },
  {
    id: "b",
    thumb_url: "/api/thumbs/b",
    bbox: [[[2, 2], [3, 2], [3, 3], [2, 3], [2, 2]]],
    score: 0.42,
    captured_at: "2026-10-04T00:00:00Z",
  },
];

describe("ResultsPanel relative-similarity framing (fix-improve Task 2)", () => {
  it("shows a #1..#n rank on each row in DOM order", () => {
    render(<ResultsPanel results={TWO} onPick={() => {}} />);
    expect(screen.getByText("#1")).toBeInTheDocument();
    expect(screen.getByText("#2")).toBeInTheDocument();
    const rows = screen.getAllByTestId("result-row");
    // Rank is exposed to assistive tech (no aria-hidden): it is part of the
    // row's accessible name, so the first row starts with "#1".
    expect(rows[0].textContent).toMatch(/^#1/);
    expect(rows[1].textContent).toMatch(/^#2/);
  });

  it("renders the relative-similarity caption above the list", () => {
    render(<ResultsPanel results={TWO} onPick={() => {}} />);
    expect(screen.getByTestId("score-caption")).toHaveTextContent(
      /relative similarity within these results/i,
    );
  });

  it("omits the export toolbar when export callbacks are absent", () => {
    render(<ResultsPanel results={TWO} onPick={() => {}} />);
    expect(screen.queryByTestId("results-toolbar")).not.toBeInTheDocument();
  });

  it("renders a single root element so the dashboard grid keeps one item (fix-pass Critical 2)", () => {
    // ResultsPanel is a direct child of `.dash-grid` (2-col grid): a fragment
    // of toolbar+caption+ul would auto-place three grid items and push the
    // results list below the map's full height. One wrapper = one grid item.
    const { container } = render(
      <ResultsPanel
        results={TWO}
        onPick={() => {}}
        onExportGeoJSON={() => {}}
        onExportCSV={() => {}}
      />,
    );
    expect(container.children).toHaveLength(1);
  });
});

describe("ResultsPanel weak-match + recency framing (P0/P1 Task 2)", () => {
  it("shows no weak-match notice for a healthy top score (TWO[0] = 0.91)", () => {
    render(<ResultsPanel results={TWO} onPick={() => {}} />);
    expect(screen.queryByTestId("weak-match-notice")).not.toBeInTheDocument();
  });

  it("shows the notice for junk-query scores (0.27 — audit-observed band)", () => {
    const weak: SearchResult[] = TWO.map((r, i) => ({ ...r, score: 0.27 - i * 0.01 }));
    render(<ResultsPanel results={weak} onPick={() => {}} />);
    expect(screen.getByTestId("weak-match-notice")).toHaveTextContent(/low-confidence/i);
    expect(screen.getByTestId("weak-match-notice")).toHaveTextContent("top 0.27"); // toFixed(2) pin
  });

  it("shows NO notice at 0.30 — the good on-query top score (regression pin)", () => {
    // Audit evidence: "turquoise coastal water" tops at 0.30. A floor above
    // this would banner every real query — the exact failure this pin prevents.
    const good: SearchResult[] = TWO.map((r, i) => ({ ...r, score: 0.3 - i * 0.01 }));
    render(<ResultsPanel results={good} onPick={() => {}} />);
    expect(screen.queryByTestId("weak-match-notice")).not.toBeInTheDocument();
  });

  it("shows NO notice at 0.45 (well clear of the floor)", () => {
    const ok: SearchResult[] = TWO.map((r, i) => ({ ...r, score: 0.45 - i * 0.01 }));
    render(<ResultsPanel results={ok} onPick={() => {}} />);
    expect(screen.queryByTestId("weak-match-notice")).not.toBeInTheDocument();
  });

  it("recency mode swaps the caption and never shows the weak-match notice", () => {
    const recency = TWO.map((r) => ({ ...r, score: 0 }));
    render(<ResultsPanel results={recency} onPick={() => {}} mode="recency" />);
    expect(screen.getByTestId("score-caption")).toHaveTextContent(/newest first in this area/i);
    expect(screen.queryByTestId("weak-match-notice")).not.toBeInTheDocument();
  });
});
