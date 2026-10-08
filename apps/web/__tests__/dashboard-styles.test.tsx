import { readFileSync } from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest"; // vitest has NO globals:true — repo convention
import ResultsPanel from "../components/ResultsPanel";
import type { SearchResult } from "../lib/types";

const results: SearchResult[] = [
  { id: "a", thumb_url: "/api/thumbs/a", bbox: [[[39, 21], [39.1, 21], [39.1, 21.1], [39, 21.1], [39, 21]]], score: 0.91, captured_at: "2025-09-29T08:04:26Z" },
  { id: "b", thumb_url: "/api/thumbs/b", bbox: [[[39.2, 21], [39.3, 21], [39.3, 21.1], [39.2, 21.1], [39.2, 21]]], score: 0.42, captured_at: "2025-09-29T08:04:23Z" },
];

it("selected row uses aria-current, not aria-pressed (audit #13)", () => {
  render(<ResultsPanel results={results} selectedId="a" onPick={() => {}} />);
  expect(screen.getByRole("button", { name: /0\.91/ })).toHaveAttribute("aria-current", "true");
  expect(screen.getByRole("button", { name: /0\.91/ })).not.toHaveAttribute("aria-pressed");
});

it("row score+date container carries tabular-nums (audit #12)", () => {
  render(<ResultsPanel results={results} onPick={() => {}} />);
  const row = screen.getByRole("button", { name: /0\.91/ });
  expect(row.className).toContain("results-row");
  // pin the CSS itself — the class is useless if the rule is missing (finding 22)
  const css = readFileSync(path.resolve(process.cwd(), "app/globals.css"), "utf8");
  const rule = css.match(/\.results-row\s*\{[^}]+\}/);
  expect(rule).not.toBeNull();
  expect(rule![0]).toContain("font-variant-numeric: tabular-nums");
});

it("no raw palette colors remain in dashboard components (audit #7)", () => {
  const files = ["app/dashboard/page.tsx", "components/ResultsPanel.tsx", "components/EmptyState.tsx", "components/BboxDraw.tsx", "components/DetailPanel.tsx", "components/TelemetryChart.tsx"];
  for (const file of files) {
    const src = readFileSync(path.resolve(process.cwd(), file), "utf8");
    const raw = [
      ...(src.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []),
      ...(src.match(/rgba?\([^)]*\)/g) ?? []),  // rgba() counts as raw color too
    ];
    expect(raw, `${file} contains raw colors: ${raw}`).toEqual([]);
  }
});
