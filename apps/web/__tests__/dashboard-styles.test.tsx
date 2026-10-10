import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest"; // vitest has NO globals:true — repo convention
import DetailPanel from "../components/DetailPanel";
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
  // Every dashboard component — the list grows with `components/`, so a new
  // panel cannot ship raw hex by being forgotten here.
  const files = [
    "app/dashboard/page.tsx",
    ...readdirSync(path.resolve(process.cwd(), "components"))
      .filter((name) => name.endsWith(".tsx"))
      .map((name) => `components/${name}`),
  ];
  // Named paint constants are allowed (MapLibre/three.js cannot resolve CSS
  // custom properties — see Map.tsx ACCENT_HEX); anonymous inline hex/rgba
  // is not (audit #7). CSS `var(--color-*)` never matches these patterns.
  const NAMED_COLOR_BINDING =
    /(?:const|let|var)\s+[A-Za-z_][A-Za-z0-9_]*\s*=\s*["'](?:#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))["']/g;
  const offenders: string[] = [];
  for (const file of files) {
    const src = readFileSync(path.resolve(process.cwd(), file), "utf8");
    const anonymous = src.replace(NAMED_COLOR_BINDING, "");
    const raw = [
      ...(anonymous.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []),
      ...(anonymous.match(/rgba?\([^)]*\)/g) ?? []),  // rgba() counts as raw color too
    ];
    if (raw.length > 0) offenders.push(`${file} contains raw colors: ${raw}`);
  }
  expect(offenders).toEqual([]);
});

// Separate block — audit #10 residual: results rows and DetailPanel chips
// must share the focus-visible ring (finding 22's "pin the CSS" idiom).
it("results rows and detail chips get the focus-visible ring (audit #10)", () => {
  render(
    <DetailPanel tile={results[0]} results={results} onClose={() => {}} />,
  );
  for (const name of [
    "Previous result",
    "Next result",
    "Close",
    "True color",
    "False color",
  ]) {
    const control = screen.getByRole("button", { name });
    expect(control.className, `DetailPanel "${name}"`).toContain("chip");
  }

  render(<ResultsPanel results={results} onPick={() => {}} />);
  expect(screen.getByRole("button", { name: /0\.91/ }).className).toContain(
    "results-row",
  );

  // pin the CSS itself — the classes are useless if the rule is missing
  const css = readFileSync(path.resolve(process.cwd(), "app/globals.css"), "utf8");
  const rule = css.match(/\.button:focus-visible[\s\S]*?\{[^}]+\}/);
  expect(rule).not.toBeNull();
  expect(rule![0]).toContain("outline: var(--focus-ring)");
  expect(rule![0]).toContain("button:focus-visible");
  expect(rule![0]).toContain(".chip:focus-visible");
  expect(rule![0]).toContain(".results-row:focus-visible");
});
