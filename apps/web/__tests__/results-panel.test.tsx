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
});
