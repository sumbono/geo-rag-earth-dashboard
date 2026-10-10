# UI/UX Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the four critical and six major UI/UX findings from the Hallmark audit — first-run guidance, search suggestions, free-polygon drawing, interactive info display, plus the visual-system pass — so a first-time visitor can discover and use the app without external instructions.

**Architecture:** Three phases over the existing Next.js 15 app. Phase A (Tasks 1–2) adds first-run discovery on the dashboard. Phase B (Tasks 3–5) is a Hallmark redesign pass: design decisions approved via preview gate first, then a `tokens.css` foundation, then landing/dashboard conformance. Phase C (Tasks 6–9) deepens interaction: live draw feedback, free-polygon search (frontend machine + new API endpoint), and cross-highlight/prev-next/popup lifecycle. Task 10 integrates, regenerates assets, and ships.

**Tech Stack:** Next.js 15 (App Router, client components), TypeScript, plain CSS custom properties (no CSS framework), maplibre-gl v6 (existing), Three.js (existing), D3 (existing), FastAPI + SQLAlchemy/GeoAlchemy2 + pgvector (existing), Vitest + RTL, Playwright. **No new runtime npm/pip dependencies** (fonts self-hosted via `next/font` — no new package).

**Spec:** `/home/bono/portfolio/geo-rag-ui-audit.md` (the Hallmark audit — 15 findings, each with file:line and fix) **+ `design.md` at the repo root** (the locked design system — user-confirmed 2026-10-08; it wins over any per-build reference on visual questions). The plan argues from these; executors read both. The five user-reported issues are audit findings 3 (guidance/value), 4 (suggestions), 5 (polygon draw), 6→10 (interactive info), and the design pass covers 1–2 + 7–9 + minors 11–15.

## Global Constraints

- All suites stay green at every task boundary: `cd apps/api && ../../.venv/bin/pytest -q -m "not ml"` (75+), `cd etl && ../.venv/bin/pytest -q -m "not smoke"` (38+), `cd apps/web && npm test` (70+), `npx tsc --noEmit`, `npm run build`, `.venv/bin/ruff check .` (exit 0).
- E2E selectors that must keep working (Task 10 runs them): heading `Geo-RAG Earth Dashboard`, `data-testid="gif-slot"`, `data-testid="demo-access-card"`, GitHub link name `/github repository/i`, login link, `aria-pressed` tab buttons, `OSM streets` toggle, dashboard search submit flow.
- **No new runtime dependencies.** Three font families via `next/font/google` are allowed — Space Grotesk, Inter, JetBrains Mono (design.md Typography; plan's earlier "two families" amended by user confirmation 2026-10-08); no npm packages, no pip packages.
- **`design.md` (repo root) is the binding design system** for every visual decision in Tasks 3–5: tokens, type, radii (6px control / 10px card), hairline structure, accent teal, mono data values, stamps. Where this plan and `design.md` disagree, `design.md` wins.
- **After Task 5** (end-of-plan, not after Task 3 — finding 12): every color/font/easing/focus value in `apps/web` CSS references a `tokens.css` token — no inline hex/OKLCH/rgb(a) in TSX `style={{}}` or component literals for CSS-applied colors (**exemption:** maplibre *paint property* constants inside `Map.tsx`/`View3D.tsx` — CSS vars don't resolve there; they must be named shared constants, e.g. `const ACCENT = "#0b6f8f"`, never magic literals scattered). `--color-danger` is the only red; `#1d4ed8` is removed from the palette entirely. The color-scan test (Task 5) is the enforcement point for its six dashboard files.
- API constants unchanged: `LIMIT 12` clamp on every search endpoint; UTC timestamps; SearchResult shape `{id, thumb_url, bbox, score, captured_at}` unchanged for the existing endpoints.
- Scrub rule: no application/job-targeting wording anywhere in UI copy, docs, or commits.
- Commit messages end with: `Co-Authored-By: Claude Code <noreply@anthropic.com>`
- Visual changes require regenerated assets before ship: `npx playwright test e2e/recording.spec.ts` (dual-writes `docs/screenshots/` + `apps/web/public/screenshots/`, demo.gif refresh if the walkthrough changed).
- Live deploy at task 10: `sudo docker compose -p geo-rag -f docker-compose.coolify.yml up -d --build web api` (or Coolify redeploy), then the full HTTPS verification checklist.

## Review Focus

1. **Self-intersecting or zero-area polygon** — a reasonable user sketching a bow-tie or a straight line expects a clear 422, never a Postgres/PostGIS 500. → pinned in Task 8's validation-matrix test (collinear points → 422; duplicate closing vertex accepted; 65 points → 422).
2. **First-run guidance that never leaves** — a user who has run a search must not keep seeing "How this works" over their results; a reload before any search SHOULD show it again (no persistence required). → pinned in Task 1: hidden once `results.length > 0` or `searched === true`, shown again on fresh mount.
3. **Redesign breaking the live e2e contract** — the Walkthrough e2e and recording rely on stable roles/testids while Tasks 3–5 restructure markup. → pinned in Task 4 (every protected selector preserved, asserted by a preserved-landmarks test) and Task 10 (full Playwright run).
4. **Hover cross-highlight leaks or flicker** — map/3D listeners re-bound on every `results` update would leak or thrash on repeated hovers. → pinned in Task 9: hover state is a single `hoveredId` prop (no per-result listeners), plus an unmount-cleanup test on the popup listener.
5. **Polygon e2e racing the map** — canvas clicks before the style loads no-op silently. → pinned in Task 10: after click 1, wait for the status strip matching `/^1 vertex —/` (Task 7 pins that exact singular format) with a 15s timeout — a cold stack fails loudly there instead of timing out on the response; no blind `waitForTimeout`.

---

## File Structure

```
apps/web/
├── app/
│   ├── globals.css                  # T3/T5: append tokens + migrated rules (append-only)
│   ├── layout.tsx                   # T3: font loading + tokens.css import
│   ├── page.tsx                     # T4: landing restructure
│   └── dashboard/page.tsx           # T1/T2/T9: guide wiring, chips, hoverId, prev/next
├── tokens.css                       # T3: created — all design tokens
├── components/
│   ├── FirstRunGuide.tsx            # T1: created — pre-search guidance panel
│   ├── SearchBar.tsx                # T2: suggestion chips
│   ├── EmptyState.tsx               # T1: imports shared EXAMPLE_QUERIES
│   ├── BboxDraw.tsx                 # T6/T7: live preview + polygon machine
│   ├── Map.tsx                      # T6/T7/T9: preview layers, polygon layer, hoveredId
│   ├── ResultsPanel.tsx             # T5/T9: tokenized rows, hover, aria-current
│   ├── DetailPanel.tsx              # T9: prev/next
│   └── View3D.tsx                   # T9: hoveredId highlight
├── lib/suggestions.ts               # T1: created — shared EXAMPLE_QUERIES
├── __tests__/                       # T1/T2/T5/T9: new + updated tests
├── e2e/dashboard.spec.ts            # T10: guidance + chips + polygon steps
└── e2e/recording.spec.ts            # T10: asset regeneration run
apps/api/
├── app/routers/search.py            # T8: POST /search/polygon
└── tests/test_search_polygon.py     # T8: created
docs/
├── screenshots/, demo.gif           # T10: regenerated
└── superpowers/plans/2026-10-08-ui-redesign.md   # this file
```

---

### Task 1: First-run guidance panel (audit critical #3)

**Files:**
- Create: `apps/web/lib/suggestions.ts`, `apps/web/components/FirstRunGuide.tsx`, `apps/web/__tests__/guidance.test.tsx`
- Modify: `apps/web/components/EmptyState.tsx` (import shared constant), `apps/web/app/dashboard/page.tsx` (render guide), `apps/web/__tests__/detail_panel.test.tsx` (first-visit assertion — Step 3b)

**Interfaces:**
- Consumes: page state `searched: boolean`, `results: SearchResult[]`, existing `handleSuggest(suggested: string)` on the page.
- Produces: `lib/suggestions.ts` exports `export const EXAMPLE_QUERIES = ["turquoise coastal water", "desert near shoreline", "cloud patterns"] as const;` (moved verbatim from `EmptyState.tsx:8-12` — EmptyState imports it). `<FirstRunGuide visible={boolean} onSuggest={(query: string) => void} />` — rendered by the page when `!searched && results.length === 0`.

- [ ] **Step 1: Write the failing tests**

```tsx
// apps/web/__tests__/guidance.test.tsx
// vitest has NO globals:true — every file imports its own bindings (repo convention).
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FirstRunGuide from "../components/FirstRunGuide";
import DashboardPage from "../app/dashboard/page";
import type { SearchResult } from "../lib/types";

// maplibre-gl needs WebGL → mocked wholesale (same boilerplate as search_ui.test.tsx)
const hoisted = vi.hoisted(() => {
  const mapInstances: any[] = [];
  class MockMap {
    options: any;
    setData = vi.fn();
    on = vi.fn();
    once = vi.fn();
    remove = vi.fn();
    isStyleLoaded = vi.fn(() => true);
    getSource = vi.fn((id?: string) => (id === "results" ? { setData: this.setData } : undefined));
    setLayoutProperty = vi.fn();
    setPaintProperty = vi.fn();
    getSourceRange = undefined;
    queryRenderedFeatures = vi.fn(() => []);
    setLayoutProperty2 = undefined;
    flyTo = vi.fn();
    constructor(options: any) {
      this.options = options;
      mapInstances.push(this);
    }
  }
  class MockPopup {
    setLngLat = vi.fn((): any => this);
    setHTML = vi.fn((): any => this);
    setDOMContent = vi.fn((): any => this);
    addTo = vi.fn((): any => this);
    remove = vi.fn();
  }
  return { MockMap, MockPopup, mapInstances };
});
vi.mock("maplibre-gl", () => ({
  default: { Map: hoisted.MockMap, Popup: hoisted.MockPopup },
  Map: hoisted.MockMap,
  Popup: hoisted.MockPopup,
  setWorkerUrl: vi.fn(),
  Marker: vi.fn(() => ({ setLngLat: vi.fn().mockReturnThis(), addTo: vi.fn().mockReturnThis(), remove: vi.fn(), setPopup: vi.fn().mockReturnThis() })),
  LngLatBounds: vi.fn(),
}));

// fetch harness (api.test.ts convention): stub globally, restore per test
const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ results: [] }), { status: 200, headers: { "Content-Type": "application/json" } }),
  );
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const ONE_RESULT: SearchResult = {
  id: "11111111-1111-1111-1111-111111111111",
  thumb_url: "/api/thumbs/11111111-1111-1111-1111-111111111111",
  bbox: [[[39, 21], [39.1, 21], [39.1, 21.1], [39, 21.1], [39, 21]]],
  score: 0.91,
  captured_at: "2025-09-29T08:04:26Z",
};

describe("FirstRunGuide", () => {
  it("renders the how-it-works steps and the value explainer when visible", () => {
    render(<FirstRunGuide visible onSuggest={() => {}} />);
    expect(screen.getByRole("heading", { name: /how this works/i })).toBeInTheDocument();
    // RTL getByText matches direct text nodes — pin through the <li> wrapper:
    expect(screen.getByText(/score/i).closest("li")).toHaveTextContent(/0\.00/);
    expect(screen.getByText(/capture date/i).closest("li")).toBeInTheDocument();
  });

  it("renders nothing when not visible", () => {
    render(<FirstRunGuide visible={false} onSuggest={() => {}} />);
    expect(screen.queryByRole("heading", { name: /how this works/i })).not.toBeInTheDocument();
  });

  it("suggestion buttons call onSuggest with the query text", () => {
    const onSuggest = vi.fn();
    render(<FirstRunGuide visible onSuggest={onSuggest} />);
    fireEvent.click(screen.getByRole("button", { name: "turquoise coastal water" }));
    expect(onSuggest).toHaveBeenCalledWith("turquoise coastal water");
  });
});

describe("dashboard first run", () => {
  it("shows the guide before the first search, hides it once results exist", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ results: [ONE_RESULT] }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    render(<DashboardPage />);
    expect(screen.getByRole("heading", { name: /how this works/i })).toBeInTheDocument();
    expect(screen.queryByText("No results")).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox", { name: /search/i }), { target: { value: "water" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("0.91")).toBeInTheDocument();  // result row (testid exists only from Task 5)
    expect(screen.queryByRole("heading", { name: /how this works/i })).not.toBeInTheDocument();
  });

  it("shows the guide again on a fresh mount with no prior search", () => {
    const { unmount } = render(<DashboardPage />);
    unmount();
    render(<DashboardPage />);
    expect(screen.getByRole("heading", { name: /how this works/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx vitest run __tests__/guidance.test.tsx`
Expected: FAIL — `Failed to resolve import "../components/FirstRunGuide"`

- [ ] **Step 3: Implement**

```tsx
// apps/web/lib/suggestions.ts
/** Example queries shared by the first-run guide and the empty state. */
export const EXAMPLE_QUERIES = [
  "turquoise coastal water",
  "desert near shoreline",
  "cloud patterns",
] as const;
```

```tsx
// apps/web/components/FirstRunGuide.tsx
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
```

`EmptyState.tsx`: delete its local `SUGGESTIONS` array (`:8-12`) and `import { EXAMPLE_QUERIES } from "../lib/suggestions";`, mapping over `EXAMPLE_QUERIES` instead (markup unchanged).

`dashboard/page.tsx` — inside the map-tab grid, replace the right-column ternary's final `null` (current `:208`) with the guide:

```tsx
{results.length > 0 ? (
  <ResultsPanel results={results} selectedId={selectedId} onPick={setSelectedId} />
) : searched ? (
  <EmptyState onSuggest={handleSuggest} />
) : (
  <FirstRunGuide visible onSuggest={handleSuggest} />
)}
```

- [ ] **Step 3b: Fix the pre-existing first-visit assertion the guide breaks**

`apps/web/__tests__/detail_panel.test.tsx:206–209` asserts the absence of the "turquoise coastal water" **button** on first render — the guide now renders exactly that button, so the suite would be red at this task's boundary. Rewrite the two lines to preserve the test's real intent (no *empty state* before a search), without touching the later suggestion-flow assertions in the same file (those are fixed in Task 2):

```tsx
    // First visit: no search has run, so no empty state (guide chips may show).
    expect(screen.queryByText("No results")).not.toBeInTheDocument();
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run __tests__/guidance.test.tsx __tests__/login.test.tsx`
Expected: PASS (new file green; EmptyState refactor keeps its existing tests green — if `login.test` is unrelated, the full `npm test` at Step 5 covers it)

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/suggestions.ts apps/web/components/FirstRunGuide.tsx apps/web/components/EmptyState.tsx apps/web/app/dashboard/page.tsx apps/web/__tests__/guidance.test.tsx
git commit -m "feat: first-run guidance panel with value explainer and example queries"
```

---

### Task 2: Always-visible search suggestion chips (audit critical #4)

**Files:**
- Modify: `apps/web/components/SearchBar.tsx`, `apps/web/__tests__/detail_panel.test.tsx`, `apps/web/__tests__/search_ui.test.tsx`, `apps/web/__tests__/bbox_draw.test.tsx` (chip-ambiguity scoping — Step 4)
- Test: `apps/web/__tests__/search-suggestions.test.tsx` (created)

**Interfaces:**
- Consumes: `EXAMPLE_QUERIES` from `lib/suggestions.ts` (Task 1); page passes a new optional prop.
- Produces: `SearchBarProps` gains `onSuggest: (query: string) => void` — the page wires it to its existing `handleSuggest` (same function EmptyState uses). Chips render **above the submit button, always** (not gated on results).

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/__tests__/search-suggestions.test.tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import SearchBar from "../components/SearchBar";

const base = {
  query: "",
  onQueryChange: () => {},
  onSearchStart: () => {},
  onResults: () => {},
  onError: () => {},
};

it("renders all three example chips without any prior search", () => {
  render(<SearchBar {...base} onSuggest={() => {}} />);
  for (const name of ["turquoise coastal water", "desert near shoreline", "cloud patterns"]) {
    expect(screen.getByRole("button", { name })).toBeInTheDocument();
  }
});

it("clicking a chip calls onSuggest exactly once", () => {
  const onSuggest = vi.fn();
  render(<SearchBar {...base} onSuggest={onSuggest} />);
  fireEvent.click(screen.getByRole("button", { name: "cloud patterns" }));
  expect(onSuggest).toHaveBeenCalledTimes(1);
  expect(onSuggest).toHaveBeenCalledWith("cloud patterns");
});
```

*(Repo convention note: this project uses `fireEvent` from `@testing-library/react` in every existing test file — `@testing-library/user-event` is NOT a dependency and must not be imported. All tests in this plan follow that convention.)*

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run __tests__/search-suggestions.test.tsx`
Expected: FAIL — chips not in the document (and/or missing `onSuggest` prop type)

- [ ] **Step 3: Implement**

In `SearchBar.tsx`: add to `SearchBarProps`:

```ts
  /** Example-chip click — the page runs the search (same path as EmptyState). */
  onSuggest: (query: string) => void;
```

Add `import { EXAMPLE_QUERIES } from "../lib/suggestions";` and render between the input and the submit button:

```tsx
      <div className="searchbar__suggestions" aria-label="Example queries">
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
```

Wrap the form contents in `flex-direction: column` row structure only if needed — keep the input+submit on one line, chips on the next (adjust the form's `style` to `display: "flex", flexDirection: "column", gap: 8` with an inner row div for input+button). In `dashboard/page.tsx`, pass `onSuggest={handleSuggest}` to `<SearchBar />`.

- [ ] **Step 4: Fix the five pre-existing assertions that always-visible chips break**

After any *empty* search there are now **two** buttons per example name (SearchBar chip + EmptyState suggestion), and chips exist pre-search — these existing tests hit strict-mode "found multiple elements" (or a vanished absence-assert). Scope them to the EmptyState section (its `aria-label="No results"` region) — add `within` to each file's RTL import if missing:

```tsx
// detail_panel.test.tsx — the three post-submit suggestion finds (~:214/:217/:220)
const empty = () => within(screen.getByRole("region", { name: "No results" }));
expect(await empty().findByRole("button", { name: "turquoise coastal water" })).toBeInTheDocument();
expect(empty().getByRole("button", { name: "desert near shoreline" })).toBeInTheDocument();
expect(empty().getByRole("button", { name: "cloud patterns" })).toBeInTheDocument();

// detail_panel.test.tsx — suggestion click (~:252): click the EmptyState copy
const suggestion = await within(screen.getByRole("region", { name: "No results" }))
  .findByRole("button", { name: "turquoise coastal water" });
fireEvent.click(suggestion);

// search_ui.test.tsx (~:201) — same scoping on its post-submit find
expect(
  await within(screen.getByRole("region", { name: "No results" }))
    .findByRole("button", { name: "turquoise coastal water" }),
).toBeInTheDocument();

// bbox_draw.test.tsx (~:348) — same scoping
expect(
  await within(screen.getByRole("region", { name: "No results" }))
    .findByRole("button", { name: "turquoise coastal water" }),
).toBeInTheDocument();
```

(The first-visit absence assertion in `detail_panel.test.tsx` is already rewritten in Task 1 Step 3b.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/web && npm test`
Expected: PASS — all files (guidance + the four updated files; SearchBar's single-POST contract for typed submits unchanged)

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/SearchBar.tsx apps/web/app/dashboard/page.tsx apps/web/__tests__/search-suggestions.test.tsx apps/web/__tests__/detail_panel.test.tsx apps/web/__tests__/search_ui.test.tsx apps/web/__tests__/bbox_draw.test.tsx
git commit -m "feat: always-visible example-query chips under the search bar"
```

---

### Task 3: Hallmark redesign — approved decisions + design-system foundation (audit criticals #1–#2 groundwork, majors #8–#9)

**Files:**
- Controller gate (Step 1) — no files
- Create: `apps/web/tokens.css`
- Modify: `apps/web/app/layout.tsx` (font + token import), `apps/web/app/globals.css` (append-only migration of base rules)

**Interfaces:**
- Consumes: **`design.md` (repo root — locked, user-confirmed 2026-10-08)**; audit findings 1–2 (centered template, one-font), 8 (body gradient), 9 (default easing), 10 (focus rings); existing `:root` tokens at `globals.css:1-12`.
- Produces: `apps/web/tokens.css` = the **`design.md` Exports → tokens.css block copied verbatim**, plus three runtime-only tokens it needs: `--focus-ring: 2px solid var(--color-accent)`, `--shadow-lift: 0 1px 2px oklch(24% 0.02 258 / 0.05)` (Cobalt's single allowed lift), `--dur-reveal: 600ms` (already in Exports — verify, don't duplicate). `layout.tsx` imports `./tokens.css` BEFORE `./globals.css` and loads **three** families via `next/font/google`: `Space_Grotesk` → `variable: "--font-display-local"`, `Inter` → `"--font-body-local"`, `JetBrains_Mono` → `"--font-mono-local"`, all `display: "swap"`, applied as className variables on `<body>`. No `docs/redesign-decisions.md` — `design.md` IS the decisions file (the earlier plan draft's gate produced it; do not create a second source of truth).

- [ ] **Step 1: Read the locked system**

Run: `cat design.md`
Expected: the full system (genre modern-minimal · macrostructure families · Cobalt-teal theme tokens · typography · motion · microinteractions · CTA voice · stamps). **This file is the spec for everything below — no preview gate remains; it was confirmed 2026-10-08.** If any Step below conflicts with `design.md`, stop and report DONE_WITH_CONCERNS naming the conflict (design.md wins per Global Constraints).

- [ ] **Step 2: Write `apps/web/tokens.css` from `design.md`**

Copy the `### tokens.css (canonical)` block from `design.md` verbatim into a new `apps/web/tokens.css`, then append the three runtime tokens from the Interfaces block (`--focus-ring`, `--shadow-lift`, `--dur-reveal` if absent). First line comment:

```css
/* Hallmark · genre: modern-minimal · macrostructure: app chrome (Workbench family) · design-system: design.md · designed-as-app */
```

- [ ] **Step 3: Wire fonts + tokens in `layout.tsx`**

```tsx
import { Space_Grotesk, Inter, JetBrains_Mono } from "next/font/google";
import "./tokens.css";
import "./globals.css";

const display = Space_Grotesk({ subsets: ["latin"], variable: "--font-display-local", display: "swap", weight: ["500", "600"] });
const body = Inter({ subsets: ["latin"], variable: "--font-body-local", display: "swap", weight: ["400", "500"] });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono-local", display: "swap", weight: ["400", "500"] });

// root layout <body>:
//   className={`${display.variable} ${body.variable} ${mono.variable}`}
```

> **Build-time network note (finding 26):** `next/font/google` fetches these
> fonts at **build time** — `npm run build` and the Docker image build require
> network (or a warm Next font cache). Record this in the README's
> troubleshooting note; if a deployment target ever turns out to be
> network-restricted at build, switch to `next/font/local` with vendored
> woff2 files (same three variable names — no other code changes).

- [ ] **Step 4: Migrate `globals.css` onto the system (in-place edit; no file deletions)**

1. **Kill the legacy token block and legacy names.** Delete the old `:root` (`globals.css:1-12` — `--bg/--surface/--ink/--accent/...`) and mechanically rename every reference in the file to the `design.md` names: `var(--bg)` → `var(--color-paper)`, `var(--surface)` → `var(--color-paper-2)`, `var(--ink)` → `var(--color-ink)`, `var(--ink-soft)` → `var(--color-ink-soft)`, `var(--accent)` → `var(--color-accent)`, `var(--accent-strong)` → `var(--color-accent-strong)`, `var(--accent-soft)` → `var(--color-accent-soft)`, `var(--border)` → `var(--color-rule)`, `var(--radius)` → `var(--radius-card)`, **`var(--shadow)` → `var(--shadow-lift)`** (finding 18 — legacy `--shadow` is consumed at `:126/:226/:281`; without the rename the declarations go invalid and silently drop). (JSX files also carry `var(--surface, #ffffff)`-style fallbacks — Task 5 removes those; here fix only `globals.css`.)
2. `body { background: var(--color-paper); color: var(--color-ink-2); font-family: var(--font-body); }` — **delete the `linear-gradient`** at `:25` (audit #8). Never `#fff`/`#000` (design.md).
3. Headings (`h1, h2, h3`, `.hero h1`, `.auth__card h1`): `font-family: var(--font-display); font-style: normal; letter-spacing: -0.02em;` (roman always).
4. `.button` (audit #9 + design.md radii): `border-radius: var(--radius-control); transition: background-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);` (kills browser `ease` and the old 999px pills — Cobalt bans pill CTAs). Primary: `background: var(--color-accent); color: var(--color-accent-ink);` hover → `var(--color-accent-strong)`. Ghost: hairline `var(--color-rule-2)` border, ink text.
5. Focus rings (audit #10, instant, never animated):

```css
.button:focus-visible,
a:focus-visible,
[role="button"]:focus-visible,
input:focus-visible {
  outline: var(--focus-ring);
  outline-offset: 2px;
}
```

6. Dead CSS: delete `.preview__hint` (`:243-246`, audit #14). Migrate the two legacy reds (`#b3261e` `.auth__error`, plus any others) → `var(--color-danger)` (audit #15). Card surfaces: `.demo-card/.auth__card/.preview__slot` → `border: var(--rule); border-radius: var(--radius-card); box-shadow: none` (hairlines do the work — design.md signature 2), except a single `var(--shadow-lift)` allowed on `.demo-card`.

- [ ] **Step 5: Run suites + build**

Run: `cd apps/web && npm test && npx tsc --noEmit && npm run build`
Expected: all PASS — existing tests assert behavior, not colors; if any test asserted a migrated hex, update the test to the token role, not the old value.

- [ ] **Step 6: Commit**

```bash
git add apps/web/tokens.css apps/web/app/layout.tsx apps/web/app/globals.css
git commit -m "feat: design-system foundation — tokens, font pairing, flat paper, focus rings, easing"
```

---

### Task 4: Landing restructure to the approved macrostructure (audit critical #1)

**Files:**
- Modify: `apps/web/app/page.tsx`, `apps/web/app/globals.css` (landing section rules only)
- Test: `apps/web/__tests__/landing.test.tsx` (extend)

**Interfaces:**
- Consumes: `design.md` (locked macrostructure families, nav/footer specs) and the tokens from Task 3.
- Produces: restructured landing that PRESERVES these landmarks exactly (e2e + tests depend): `<h1>` text `Geo-RAG Earth Dashboard`, `data-testid="gif-slot"` figure with `src="/demo.gif"`, `data-testid="demo-access-card"` with both creds + "Public sandbox with sample data", header GitHub link `href="https://github.com/sumbono/geo-rag-earth-dashboard"` with `target/rel/aria-label`, `Link` to `/login` (Get started + Log in), footer present.

- [ ] **Step 1: Write the failing landmark-preservation test (first — pins the contract the redesign must not break)**

```tsx
// appended to apps/web/__tests__/landing.test.tsx
it("keeps every e2e landmark after the redesign", () => {
  render(<Page />);
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Geo-RAG Earth Dashboard");
  expect(screen.getByTestId("gif-slot")).toBeInTheDocument();
  const card = screen.getByTestId("demo-access-card");
  expect(card).toHaveTextContent("demo");
  expect(card).toHaveTextContent("demo-pass-123");
  expect(card).toHaveTextContent(/public sandbox with sample data/i);
  expect(screen.getByRole("link", { name: /github repository/i })).toBeInTheDocument();
  expect(screen.getAllByRole("link").some((a) => a.getAttribute("href") === "/login")).toBe(true);
});
```

- [ ] **Step 2: Run to verify it passes BEFORE restructuring (it encodes today's state)**

Run: `cd apps/web && npx vitest run __tests__/landing.test.tsx`
Expected: PASS (guards against regression during Step 3)

- [ ] **Step 3: Restructure `page.tsx` + landing CSS to the Workbench/Cobalt shape (`design.md`)**

New landing structure, in DOM order (all values via tokens; no new hex):

1. **Bordered nav** (design.md § Nav and footer): flush full-width, `border-bottom: var(--rule)`, wordmark left (`--font-display`, 600); right side = GitHub link + **Log in as a hairline/ghost button** — never a second solid fill: accent discipline is exactly ONE solid accent button per viewport, and that button is the hero's "Get started" (finding 25). No floating pill, no `⌘K` (known omission).
2. **Hero — two-column, title LEFT / proof RIGHT** (genre-canonical, kills audit #1's centering): left = `<h1>` "Geo-RAG Earth Dashboard" (`var(--font-display)`, `var(--text-display)`, ≤50 chars — current is fine) + lede (the existing pitch, kept) + actions (solid "Get started" → `/login`, typographic "Log in" secondary); right = the **demo-access card** (keeps `data-testid="demo-access-card"` + exact creds + "Public sandbox with sample data" copy). `.hero { text-align: center }` and the `.hero__eyebrow` pill are deleted (template furniture — audit #1).
3. **Workbench band**: the walkthrough GIF in a hairline-framed full-width figure — this is the hero *proof* (keeps `data-testid="gif-slot"`, `src="/demo.gif"`, width/height attrs).
4. **One dark graphite band** (design.md signature 8): "How it works" — 3 numbered steps (describe in plain words → ranked by score 0–1 → click for details/imagery/location) + the what-you-get line (score = semantic match, date = satellite capture) on `--color-graphite` with `--color-graphite-ink` text, mono uppercase step labels. This is audit #3's explainer absorbed into the landing design (the dashboard's `FirstRunGuide` from Task 1 keeps its in-app copy — they reinforce, not conflict).
5. **Single-line inline footer** (design.md § Nav and footer): one **text-only** line — wordmark · one tagline phrase · small credit, **no links at all** (finding 25: a footer GitHub link would collide with the header's `aria-label="GitHub repository"` in the landmark test, and links would add a second accent target) — `border-top: var(--rule)`, `--color-ink-soft`, `--text-sm` (replaces the centered footer, audit #1).

All landmarks preserved per Global Constraints; every element token-styled.

- [ ] **Step 4: Run tests + build**

Run: `cd apps/web && npm test && npx tsc --noEmit && npm run build`
Expected: PASS — landmarks test + all existing landing tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/page.tsx apps/web/app/globals.css apps/web/__tests__/landing.test.tsx
git commit -m "feat: landing restructure — asymmetric hero per approved macrostructure"
```

---

### Task 5: Dashboard design pass — tokens, states, a11y (audit majors #7, minors #11–#13/#15)

**Files:**
- Modify: `apps/web/app/dashboard/page.tsx`, `apps/web/components/ResultsPanel.tsx`, `apps/web/components/EmptyState.tsx`, `apps/web/components/BboxDraw.tsx` (styles only), `apps/web/components/DetailPanel.tsx`, `apps/web/components/TelemetryChart.tsx` (raw-hex cleanup — Step 3d), `apps/web/components/SearchBar.tsx` (one-line `role="group"` on the suggestions div — Step 3e, Task 2 rulings R-1a/R-2a), `apps/web/app/globals.css` (append dashboard + guide + searchbar rules), `apps/web/__tests__/search_ui.test.tsx` (row assertion update — Step 3c)
- Test: `apps/web/__tests__/dashboard-styles.test.tsx` (created)

**Interfaces:**
- Consumes: tokens from Task 3; existing test contracts (results row content, `role="search"`, tab `aria-pressed`).
- Produces: CSS classes `.dashboard`, `.dash-row`, `.dash-alert`, `.dash-status` (layout migrated out of inline `style={{}}` where it carries color/spacing tokens); `ResultsPanel` rows use `var(--color-accent)` for selected (NOT `#1d4ed8`), `aria-current` instead of `aria-pressed`, `font-variant-numeric: tabular-nums` on the row; one danger token used by the alert; dashed borders → solid hairline.

- [ ] **Step 1: Write the failing tests**

```tsx
// apps/web/__tests__/dashboard-styles.test.tsx
import { render, screen } from "@testing-library/react";
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

it("row score+date container carries tabular-nums (audit #12)", async () => {
  render(<ResultsPanel results={results} onPick={() => {}} />);
  const row = screen.getByRole("button", { name: /0\.91/ });
  expect(row.className).toContain("results-row");
  // pin the CSS itself — the class is useless if the rule is missing (finding 22)
  const fs = await import("node:fs/promises");
  const css = await fs.readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const rule = css.match(/\.results-row\s*\{[^}]+\}/);
  expect(rule).not.toBeNull();
  expect(rule![0]).toContain("font-variant-numeric: tabular-nums");
});

it("no raw palette colors remain in dashboard components (audit #7)", async () => {
  const fs = await import("node:fs/promises");
  const files = ["app/dashboard/page.tsx", "components/ResultsPanel.tsx", "components/EmptyState.tsx", "components/BboxDraw.tsx", "components/DetailPanel.tsx", "components/TelemetryChart.tsx"];
  for (const file of files) {
    const src = await fs.readFile(new URL(`../${file}`, import.meta.url), "utf8");
    const raw = [
      ...(src.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []),
      ...(src.match(/rgba?\([^)]*\)/g) ?? []),  // rgba() counts as raw color too
    ];
    expect(raw, `${file} contains raw colors: ${raw}`).toEqual([]);
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx vitest run __tests__/dashboard-styles.test.tsx`
Expected: FAIL — `aria-pressed` still present on rows; raw hex found in `dashboard/page.tsx` (`#b91c1c`) and `ResultsPanel.tsx` (`#1d4ed8`, `#ffffff`, `rgba(...)`)

- [ ] **Step 3: Implement**

- `ResultsPanel.tsx`: row → `className="results-row"` **plus `data-testid="result-row"`** (Task 10's e2e selects it — this is where that testid is added); `aria-current={selected ? "true" : undefined}` (drop `aria-pressed`); selected styling per design.md (`accent-soft` is the selected-row tint): `.results-row { font-variant-numeric: tabular-nums; font-family: var(--font-mono); } .results-row[aria-current="true"] { background: var(--color-accent-soft); color: var(--color-ink); border-color: var(--color-accent); }`; score/date values in `var(--font-mono)`; hairline borders `1px solid var(--color-rule)`, radius `var(--radius-control)`; delete the dead `results.length === 0` placeholder branch (`:23-25` — page never mounts it empty; audit noted it).
- `dashboard/page.tsx`: replace inline `style={{…}}` with classes `.dashboard`, `.dash-row`, `.dash-alert`, `.dash-status`; error color → `var(--color-danger)` (kills `#b91c1c`).
- `EmptyState.tsx` / `BboxDraw.tsx`: dashed borders → `1px solid var(--color-rule)` (audit #11 — note: `--color-rule`, not the nonexistent `--color-border`, finding 11); fallback-hex vars (`var(--surface, #ffffff)`, `var(--ink-soft, #4a5b6a)`) → `var(--color-paper-2)` / `var(--color-ink-soft)` with **no hex fallbacks**.
- **Step 3c:** update the row-state assertion in `search_ui.test.tsx` (~:318–320): `toHaveAttribute("aria-pressed", "true")` → `toHaveAttribute("aria-current", "true")` (Rows now use aria-current — coverage-map note for audit #13).
- **Step 3d (finding 12):** raw-hex cleanup in the two files this task now owns: `TelemetryChart.tsx` (~:156 `#b91c1c` → `var(--color-danger)`) and `DetailPanel.tsx` (`#e1e8ee` → `var(--color-rule)`, `#ffffff` → `var(--color-paper-2)`, `var(--accent, #0b6f8f)` → `var(--color-accent)` with the hex fallback dropped). After this, the color-scan test's file list must ALSO include these two files — update the scan array in `dashboard-styles.test.tsx` to six files.
- `globals.css` append: the `.results-row`, `.guide` + its BEM children (`.guide__title/.guide__steps/.guide__examples-label/.guide__examples` — ruling R-1a: Task 1 shipped the classes unstyled), `.searchbar__suggestions`/`.searchbar__chip` (ruling R-2a: chips currently render flush — add `gap` on the container; Task 2 shipped unstyled), and `.dash-*` rules — tokens only.
- **Step 3e (ruling R-2a):** `SearchBar.tsx` — the suggestions wrapper is a bare `<div aria-label="Example queries">`; ARIA ignores `aria-label` on role-less generics. Add `role="group"` to that div (one line).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npm test && npx tsc --noEmit && npm run build`
Expected: PASS — including the existing search_ui/detail_panel tests (they assert behavior; if any asserted the old blue style, update to assert `aria-current`/class instead)

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/dashboard/page.tsx apps/web/components/ResultsPanel.tsx apps/web/components/EmptyState.tsx apps/web/components/BboxDraw.tsx apps/web/app/globals.css apps/web/__tests__/dashboard-styles.test.tsx
git commit -m "feat: dashboard design pass — tokens, aria-current rows, tabular-nums, single danger color"
```

---

### Task 6: Live draw feedback on the map (audit major #5, part 1)

**Files:**
- Modify: `apps/web/components/Map.tsx`, `apps/web/components/BboxDraw.tsx`
- Test: `apps/web/__tests__/draw-feedback.test.tsx` (created)

**Interfaces:**
- Consumes: existing `MapHandle` (`setRectangle(bbox | null)`), `BboxDrawHandle.handleMapClick(lonLat)`, page's `onRectangle` wiring.
- Produces: `MapHandle` gains `setPreviewRectangle(bbox: [[number, number], [number, number]] | null): void` — renders a dashed, non-persisted rectangle layer (distinct layer id `draw-preview`); `BboxDrawProps` gains `onPreview: (bbox: [[number, number], [number, number]] | null) => void` (page forwards to `mapRef.current?.setPreviewRectangle`). Order change: at corner B, `onRectangle(bbox)` fires BEFORE `runSearch` (visual-first; on fetch error the box stays and the page's alert explains — user sees what they drew).

- [ ] **Step 1: Write the failing tests**

```tsx
// apps/web/__tests__/draw-feedback.test.tsx
import { fireEvent, render, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import BboxDraw, { type BboxDrawHandle } from "../components/BboxDraw";
import { type RefObject } from "react";

// fetch harness per api.test.ts: stub globally, restore after each test
const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ results: [] }), { status: 200, headers: { "Content-Type": "application/json" } }),
  );
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

// maplibre mocked as in search_ui.test.tsx; expose handle via ref
function setup() {
  const onPreview = vi.fn();
  const onRectangle = vi.fn();
  const onResults = vi.fn();
  const onError = vi.fn();
  const ref: RefObject<BboxDrawHandle | null> = { current: null };
  render(
    <BboxDraw ref={ref} active onToggle={() => {}} currentQuery="" onResults={onResults} onRectangle={onRectangle} onPreview={onPreview} onError={onError} />,
  );
  return { ref, onPreview, onRectangle, onResults, onError };
}

it("click 1 previews the degenerate box; click 2 previews the completed box, hands off to onRectangle, then clears the preview", () => {
  const { ref, onPreview, onRectangle } = setup();
  ref.current!.handleMapClick([39.0, 21.0]);
  expect(onPreview).toHaveBeenLastCalledWith([[39, 21], [39, 21]]);
  ref.current!.handleMapClick([39.2, 21.2]);
  // exact sequence at corner B (finding 8): preview(completed) → onRectangle(completed) → preview(null) → POST
  expect(onPreview).toHaveBeenCalledWith([[39.0, 21.0], [39.2, 21.2]]);
  expect(onPreview).toHaveBeenLastCalledWith(null);
  expect(onRectangle).toHaveBeenCalledWith([[39.0, 21.0], [39.2, 21.2]]);
});

it("rectangle is emitted BEFORE the request resolves (visual-first)", async () => {
  const { ref, onRectangle, onResults } = setup();
  let resolveFetch!: (value: Response) => void;
  fetchMock.mockReturnValueOnce(new Promise((resolve) => { resolveFetch = resolve; }));
  ref.current!.handleMapClick([39.0, 21.0]);
  ref.current!.handleMapClick([39.2, 21.2]);
  expect(onRectangle).toHaveBeenCalledTimes(1);   // fired while fetch is pending
  expect(onResults).not.toHaveBeenCalled();
  resolveFetch(new Response(JSON.stringify({ results: [] }), { status: 200 }));
  await waitFor(() => expect(onResults).toHaveBeenCalledTimes(1));
});

it("Esc clears the preview", () => {
  const { ref, onPreview } = setup();
  ref.current!.handleMapClick([39.0, 21.0]);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(onPreview).toHaveBeenLastCalledWith(null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx vitest run __tests__/draw-feedback.test.tsx`
Expected: FAIL — `onPreview` prop does not exist

- [ ] **Step 3: Implement**

`Map.tsx`: add `setPreviewRectangle` to `MapHandle` — draws GeoJSON polygon into a `draw-preview` source/layer with `line-dasharray: [2, 2]` and `line-color: ACCENT_HEX` where `const ACCENT_HEX = "#0b6f8f";` is a module-level shared constant (finding 17: maplibre paint properties cannot resolve CSS custom properties — the previous draft's `var/accent` was both a typo and unresolvable; this hex is the *paint-constant exemption* named in Global Constraints, and the same constant must be reused by Task 7's `draw-polygon` layer); cleared on `null` and on `map.remove()` cleanup (share the helper shape with `setRectangle`; preview layer id distinct from the persisted `draw-rectangle` layer).

`BboxDraw.tsx`: add `onPreview` prop; in `handleMapClick`:
- click 1: `onPreview([lonLat, lonLat])` alongside `setCorner`.
- Esc / disarm: `onPreview(null)`.
- click 2 — **exact sequence (finding 8):** after normalization, emit in this order: `onPreview(completedBox)` → `onRectangle(completedBox)` (moved here from `runSearch`'s success path at `:73` — the persisted layer takes over) → `onPreview(null)` (clear the dashed preview) → `void runSearch(bbox)`. On fetch error the page keeps the rectangle + shows the alert (update the `BboxDraw` docstring comment at `:36-39` accordingly).

`dashboard/page.tsx`: pass `onPreview={(bbox) => mapRef.current?.setPreviewRectangle(bbox)}`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npm test`
Expected: PASS — including Task 19's original bbox tests (adjust `runSearch`-ordering assertions if any assumed rectangle-after-success: update them to the new visual-first contract and note it in the commit body)

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/Map.tsx apps/web/components/BboxDraw.tsx apps/web/app/dashboard/page.tsx apps/web/__tests__/draw-feedback.test.tsx
git commit -m "feat: live on-map draw preview; rectangle renders before the fetch resolves"
```

---

### Task 7: Free-polygon draw machine (frontend) (audit major #5, part 2)

**Files:**
- Modify: `apps/web/components/Map.tsx`, `apps/web/components/BboxDraw.tsx`, `apps/web/app/dashboard/page.tsx`
- Test: `apps/web/__tests__/polygon-draw.test.tsx` (created)

**Interfaces:**
- Consumes: Task 6's `setPreviewRectangle` pattern; `apiFetch` (existing).
- Produces: `BboxDraw` gains a second toggle **"Draw polygon"** (`shape: "rect" | "polygon" | null` internal; only one shape armed at a time — arming one disarms the other via one shared `onToggle` for rect and a new `onTogglePolygon` for polygon, page owns both flags). Polygon machine: each map click appends a vertex (`[lon,lat]`, cap 64); Enter key or map double-click closes (≥3 vertices required); Esc clears vertices but keeps armed; close → `POST /api/search/polygon` body `{polygon: [[lon,lat], ...], q: currentQuery || null}` → `onResults` (same merge path) + `onPolygon(polygon)` so Map can draw the finalized shape (`MapHandle.setPolygon(coords: [number,number][] | null)` — solid line layer `draw-polygon`, cleared on arm/disarm). Status strip shows exactly `` `${n} ${n === 1 ? "vertex" : "vertices"} — click to add, Enter/double-click to close (Esc clears).` `` (singular/plural pinned — Task 10's e2e sentinel greps `^1 vertex —`, which is only true AFTER click 1 registers on a loaded map style; the "0 vertices" text must NOT match that pattern).

- [ ] **Step 1: Write the failing tests**

```tsx
// apps/web/__tests__/polygon-draw.test.tsx
import { fireEvent, render, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import BboxDraw, { type BboxDrawHandle } from "../components/BboxDraw";
import { type RefObject } from "react";

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ results: [] }), { status: 200, headers: { "Content-Type": "application/json" } }),
  );
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function setup() {
  const onPolygon = vi.fn();
  const onResults = vi.fn();
  const onError = vi.fn();
  const ref: RefObject<BboxDrawHandle | null> = { current: null };
  render(
    <BboxDraw ref={ref} active polygonMode onToggle={() => {}} onTogglePolygon={() => {}} currentQuery="water" onResults={onResults} onRectangle={() => {}} onPreview={() => {}} onPolygon={onPolygon} onError={onError} />,
  );
  return { ref, onPolygon, onResults, onError };
}

it("accumulates vertices and refuses to close with fewer than 3", () => {
  const { ref, onPolygon } = setup();
  ref.current!.handleMapClick([39.0, 21.0]);
  ref.current!.handleMapClick([39.1, 21.0]);
  fireEvent.keyDown(window, { key: "Enter" });
  expect(onPolygon).not.toHaveBeenCalled();
  ref.current!.handleMapClick([39.05, 21.1]);
  fireEvent.keyDown(window, { key: "Enter" });
  expect(onPolygon).toHaveBeenCalledWith([[39.0, 21.0], [39.1, 21.0], [39.05, 21.1]]);
});

it("POSTs /api/search/polygon with polygon and q, then lifts results", async () => {
  const { ref, onResults } = setup();
  ref.current!.handleMapClick([39.0, 21.0]);
  ref.current!.handleMapClick([39.1, 21.0]);
  ref.current!.handleMapClick([39.05, 21.1]);
  fireEvent.keyDown(window, { key: "Enter" });
  await waitFor(() => expect(onResults).toHaveBeenCalledTimes(1));
  expect(fetchMock).toHaveBeenCalledWith("/api/search/polygon", expect.objectContaining({
    method: "POST",
    body: JSON.stringify({ polygon: [[39, 21], [39.1, 21], [39.05, 21.1]], q: "water" }),
  }));
});

it("Esc clears vertices without sending", () => {
  const { ref, onPolygon } = setup();
  ref.current!.handleMapClick([39.0, 21.0]);
  ref.current!.handleMapClick([39.1, 21.0]);
  fireEvent.keyDown(window, { key: "Escape" });
  fireEvent.keyDown(window, { key: "Enter" });
  expect(onPolygon).not.toHaveBeenCalled();
});

it("double-click near the last vertex closes (no duplicate vertex appended)", () => {
  const { ref, onPolygon } = setup();
  ref.current!.handleMapClick([39.0, 21.0]);
  ref.current!.handleMapClick([39.1, 21.0]);
  ref.current!.handleMapClick([39.05, 21.1]);
  // second rapid click ~20ms later, 1e-7° from the last vertex → close, not append
  ref.current!.handleMapClick([39.05 + 1e-7, 21.1 + 1e-7]);
  expect(onPolygon).toHaveBeenCalledWith([[39.0, 21.0], [39.1, 21.0], [39.05, 21.1]]);
});
```

**Branch precedence (binding):** `handleMapClick` checks `polygonMode` FIRST, then `active` — during polygon draw the page passes `active=true` AND `polygonMode=true` simultaneously (that's the real combination; the rect machine must be unreachable in that state via the `if/else if` order), and the unit test pins exactly this pair.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx vitest run __tests__/polygon-draw.test.tsx`
Expected: FAIL — `polygonMode` / `onTogglePolygon` / `onPolygon` props do not exist

- [ ] **Step 3: Implement**

`BboxDraw.tsx` — new state `vertices: [number, number][]` (reset on arm/disarm/Esc/after send) and a `lastClickAtRef = useRef<number>(0)` for the close gesture. New props are **optional** (finding 13 — Task 6's tests render without them and `tsc` must stay green): `polygonMode?: boolean`, `onTogglePolygon?: () => void`, `onPolygon?: (polygon: [number, number][]) => void`.

Routing and gating (finding 15 — exact page wiring, mirrored here so unit tests match the real combination):
- The page passes **`active={drawShape !== null}`** (armed in EITHER mode — this is what keeps the keydown listeners attached during polygon draw) and **`polygonMode={drawShape === "polygon"}`**. The T7 unit test already renders exactly this pair (`active polygonMode`), so unit and page agree.
- `handleMapClick`: `if (polygonMode)` → polygon branch (append vertex, cap 64 — silently ignore beyond, status strip says `64 vertex cap`); `else if (!active)` → return; else → the rect machine (unchanged).
- Keydown effect depends on `[active]` and branches internally: **Enter** closes polygon when `polygonMode && vertices.length >= 3` (rect mode: no-op); **Esc** clears `vertices` when `polygonMode`, else clears the rect corner (existing behavior).
- Button pressed-states are **derived**, never new props: "Draw area" → `aria-pressed={active && !polygonMode}`; "Draw polygon" → `aria-pressed={active && polygonMode}`.
- Close gesture — **double-click, owned by BboxDraw (finding 16 — Map cannot close or send; it only forwards clicks):** inside the polygon branch, before appending: if `vertices.length >= 3` AND `Date.now() - lastClickAtRef.current < 250` AND the new point is within `1e-6°` of the last vertex → **do not append; treat this click as close** (same path as Enter), reset `lastClickAtRef`; else append and set `lastClickAtRef.current = Date.now()`.
- `runPolygon(polygon)` posts `/search/polygon` via `apiFetch`, calls `onPolygon?.(polygon)` + `onResults` + disarms via `onTogglePolygon?.()`. Status strip mirrors the rect variant with vertex count.

`Map.tsx`: `setPolygon(coords: [number,number][] | null)` on `MapHandle` — GeoJSON LineString (auto-close ring on render) in layer `draw-polygon`, **solid `ACCENT_HEX` line (the same module constant from Task 6) + 15% fill** (paint exemption applies — no CSS vars); cleared on null. Map only forwards clicks (the double-click close lives in BboxDraw per above).

`dashboard/page.tsx`: `drawShape: "rect" | "polygon" | null` state replaces the old boolean. Wiring: `active={drawShape !== null}`, `polygonMode={drawShape === "polygon"}`, rect-toggle handler sets `drawShape` to `"rect"` or `null`, polygon-toggle handler sets `"polygon"` or `null` (arming one clears the other AND clears the preview/polygon layers), `onPolygon` draws the finalized shape. This is the exact combination the unit tests render.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npm test && npx tsc --noEmit`
Expected: PASS — rect tests from Tasks 19/6 still green (rect and polygon paths are mutually exclusive)

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/Map.tsx apps/web/components/BboxDraw.tsx apps/web/app/dashboard/page.tsx apps/web/__tests__/polygon-draw.test.tsx
git commit -m "feat: free-polygon draw machine with vertex preview and close gestures"
```

---

### Task 8: `POST /search/polygon` API (audit major #5, server side)

**Files:**
- Modify: `apps/api/app/routers/search.py`
- Test: `apps/api/tests/test_search_polygon.py` (created)

**Interfaces:**
- Consumes: existing `verify_jwt` dependency, `get_encoder`, `_row_to_result`, `SearchResult` response model, `limiter` (60/minute pattern already on the router), `Tile.bbox` Geometry.
- Produces: `POST /search/polygon` body `{"polygon": [[lon, lat], ...], "q": str | null, "limit": int = 12}` → `VectorSearchResponse` (same `SearchResult[]`); validation → 422 for: <3 points, >64 points, non-finite coordinate, out of ±180/±90, zero-area (collinear) ring; duplicate closing vertex (last == first) accepted and normalized (dropped before build). Server builds `POLYGON((...))` WKT → `func.ST_GeomFromText(…, 4326)`; filter `func.ST_Intersects(Tile.bbox, poly)`; with `q`: cosine-rank within filter; without: `captured_at DESC`; **`limit` is validated by the model (`Field(default=12, ge=1, le=12)` → out-of-range is 422; there is NO separate clamp — one mechanism, finding 28)**.

- [ ] **Step 1: Write the failing tests**

```python
# apps/api/tests/test_search_polygon.py
import pytest
import sqlalchemy as sa

from app.models import Tile
from tests.helpers import login   # repo convention: a FUNCTION, not a fixture

pytestmark = pytest.mark.db


@pytest.fixture()
def isolate_tiles(engine_session):
    """Wipe `tiles` before and after every test in this file.

    conftest's `seeded_tiles` APPENDS 50 rows per call (no wipe), so repeated
    seeded tests would accumulate duplicates: exact-count/set assertions here
    would break, and leftover coral rows (identical embedding = distance ties)
    would make test_search_vector's rank-1 assertion ambiguous — that file
    sorts alphabetically after this one. Verbatim copy of the fixture in
    test_search_bbox.py:28-43 (finding 10). Autouse resolves before
    explicitly requested same-scope fixtures, so the wipe precedes
    `seeded_tiles`.
    """
    engine_session.execute(sa.delete(Tile))
    engine_session.commit()
    yield
    engine_session.execute(sa.delete(Tile))
    engine_session.commit()


def _polygon(n_extra=0):
    # non-degenerate triangle + optional extras (CCW, non-collinear)
    pts = [[39.0, 21.0], [39.2, 21.0], [39.1, 21.15]]
    return pts[: 3 + n_extra]

def test_polygon_requires_auth(create_client):
    assert create_client.post("/search/polygon", json={"polygon": _polygon()}).status_code == 401

@pytest.mark.parametrize("polygon, reason", [
    ([[39.0, 21.0], [39.1, 21.0]], "fewer than 3 points"),
    ([[39.0, 21.0], [39.1, 21.0], [39.2, 21.0]], "collinear zero area"),
    ([[181.0, 21.0], [181.1, 21.0], [181.05, 21.1]], "out of bounds"),
])
def test_polygon_validation_422(create_client, polygon, reason):
    # Repo convention: helpers.py login(client) is a FUNCTION, not a fixture —
    # call it explicitly; there is no pytest fixture named `login`.
    login(create_client)
    assert create_client.post("/search/polygon", json={"polygon": polygon}).status_code == 422, reason

def test_too_many_points_422(create_client):
    login(create_client)
    pts = [[39.0 + i * 0.001, 21.0 + (i % 2) * 0.001] for i in range(65)]
    assert create_client.post("/search/polygon", json={"polygon": pts}).status_code == 422

def test_closed_ring_normalized_and_returns_only_intersects(create_client, isolate_tiles, seeded_tiles):
    login(create_client)
    ring = _polygon() + [_polygon()[0]]  # duplicate closing vertex
    r = create_client.post("/search/polygon", json={"polygon": ring})
    assert r.status_code == 200
    ids = {row["id"] for row in r.json()["results"]}
    # seeded tiles span 35.0–35.5E / 20.0–20.01N; this triangle (39E/21N) intersects none
    assert ids == set()

def test_polygon_with_q_ranks_within_filter(create_client, isolate_tiles, seeded_tiles):
    login(create_client)
    # a box-shaped ring around the seeded band, with the coral query
    ring = [[35.0, 19.99], [35.6, 19.99], [35.6, 20.02], [35.0, 20.02]]
    r = create_client.post("/search/polygon", json={"polygon": ring, "q": "turquoise coral reef"})
    assert r.status_code == 200
    results = r.json()["results"]
    assert 0 < len(results) <= 12
    # seeded_tiles is a dict {coral: Tile, ...} — index it, never iterate rows off it
    assert results[0]["id"] == str(seeded_tiles["coral"].id)
    scores = [row["score"] for row in results]
    assert scores == sorted(scores, reverse=True)

def test_non_point_entries_422(create_client):
    login(create_client)
    bad_shape = {"polygon": [[39.0, 21.0], [39.1, 21.0], "not-a-point"]}
    assert create_client.post("/search/polygon", json=bad_shape).status_code == 422
```

*(The `parametrize` in `test_polygon_validation_422` carries exactly the three valid rows shown — collinear, out-of-bounds, <3 points — plus this standalone `bad_shape` test. No placeholder rows. All tests call `login(create_client)` explicitly — the repo has no `login` fixture.)*

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && ../../.venv/bin/pytest tests/test_search_polygon.py -v`
Expected: FAIL — 404 route not found

- [ ] **Step 3: Implement**

```python
# appended to apps/api/app/routers/search.py

def _validate_polygon(points: list) -> list:
    """Return a normalized closed ring or raise 422 (Review Focus #1)."""
    if not isinstance(points, list) or len(points) < 3 or len(points) > 64:
        raise HTTPException(status_code=422, detail="polygon must have 3 to 64 points")
    ring: list[list[float]] = []
    for point in points:
        if (
            not isinstance(point, (list, tuple))
            or len(point) != 2
            or not all(isinstance(c, (int, float)) and math.isfinite(c) for c in point)
        ):
            raise HTTPException(status_code=422, detail="each point must be [lon, lat] numbers")
        lon, lat = float(point[0]), float(point[1])
        if not (-180 <= lon <= 180 and -90 <= lat <= 90):
            raise HTTPException(status_code=422, detail="coordinates out of bounds")
        ring.append([lon, lat])
    if ring[0] == ring[-1]:
        ring = ring[:-1]  # duplicate closing vertex normalized away
    if len(ring) < 3:
        raise HTTPException(status_code=422, detail="polygon must have 3 to 64 points")
    # shoelace — zero area (collinear or degenerate) is a user mistake, not a 500
    area = abs(
        sum(
            ring[i][0] * ring[(i + 1) % len(ring)][1]
            - ring[(i + 1) % len(ring)][0] * ring[i][1]
            for i in range(len(ring))
        )
    ) / 2.0
    if area <= 1e-12:
        raise HTTPException(status_code=422, detail="polygon has no area")
    return ring


class PolygonSearchRequest(BaseModel):
    polygon: list
    q: str | None = None
    limit: int = Field(default=12, ge=1, le=12)


@router.post("/search/polygon", response_model=VectorSearchResponse)
@limiter.limit("60/minute")
def search_polygon(
    payload: PolygonSearchRequest,
    request: Request,
    settings: Settings = Depends(get_settings),
    session: Session = Depends(get_db),
    _: User = Depends(verify_jwt),
) -> VectorSearchResponse:
    ring = _validate_polygon(payload.polygon)
    wkt = "POLYGON((" + ", ".join(f"{lon} {lat}" for lon, lat in ring) + f", {ring[0][0]} {ring[0][1]}))"  # closed
    poly = func.ST_GeomFromText(wkt, 4326)   # func pattern — search.py has NO direct geoalchemy2 symbol imports (finding 19)
    stmt = select(...).where(ST_Intersects(Tile.bbox, poly))  # same row-mapping as /search/vector
    if payload.q:
        vec = get_encoder(settings).encode_text(payload.q)
        assert vec.shape == (512,)
        stmt = stmt.order_by(Tile.embedding.cosine_distance(vec)).limit(min(payload.limit, 12))
    else:
        stmt = stmt.order_by(Tile.captured_at.desc()).limit(min(payload.limit, 12))
    # map rows with the shared _row_to_result — identical to /search/bbox no-q mode (score 0.0)
```

*(Exact select/mapping lines mirror the `/search/bbox` implementation directly above it in the same file — copy its column list and `_row_to_result` usage. Imports actually needed: add `math` at module top and extend the existing `from fastapi import …` line with `HTTPException` (it is NOT currently imported — finding 19). All PostGIS calls use the file's existing `func.*` pattern (`func.ST_GeomFromText` joins the existing `func.ST_Intersects`/`func.ST_MakeEnvelope` usage) — no geoalchemy2 symbol imports.)*

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && ../../.venv/bin/pytest tests/test_search_polygon.py tests/test_auth.py -v`
Expected: PASS — including authz sweep: add `"/search/polygon"` in **BOTH** places in `test_auth.py` (the `routes` list around :61 **and** the `is_post` tuple around :68 — only one of them → 405/no-dispatch ≠ 401 fails the sweep; finding 20) and assert 401

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/routers/search.py apps/api/tests/test_search_polygon.py apps/api/tests/test_auth.py
git commit -m "feat: POST /search/polygon — validated ring → ST_Intersects search"
```

---

### Task 9: Interactive info display — cross-highlight, prev/next, popup lifecycle (audit major #6)

**Files:**
- Modify: `apps/web/app/dashboard/page.tsx`, `apps/web/components/ResultsPanel.tsx`, `apps/web/components/Map.tsx`, `apps/web/components/View3D.tsx`, `apps/web/components/DetailPanel.tsx`
- Test: `apps/web/__tests__/interactive-info.test.tsx` (created)

**Interfaces:**
- Consumes: `SearchResult[]`, existing `selectedId` state, `MapHandle`, `DetailPanel {tile, results, onClose}`.
- Produces: page state `hoveredId: string | null`; `ResultsPanelProps` gains **`onHover?: (id: string | null) => void`** (OPTIONAL — finding 13: Task 5's tests render ResultsPanel without it and `tsc` must stay green; fires on row mouseenter/focus → id, mouseleave/blur → null); `Map` gains `hoveredId?: string | null` prop (marker color/size ramp shifts for the hovered feature — no per-result listeners, single paint derived from props); `View3D` gains `hoveredId?: string | null` (highlighted point scaled ×1.4 + accent color); `DetailPanelProps` gains **`onNavigate?: (delta: 1 | -1) => void`** (OPTIONAL — finding 13: existing `detail_panel.test.tsx` renders without it) → prev/next buttons + `ArrowLeft`/`ArrowRight` key handlers; `MapHandle.setPopupContent` replaced: single `maplibregl.Popup` instance in a ref, closed before reopen, content built with `document.createElement` + `textContent` (no `setHTML`).

- [ ] **Step 1: Write the failing tests**

```tsx
// apps/web/__tests__/interactive-info.test.tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { vi } from "vitest";
import ResultsPanel from "../components/ResultsPanel";
import DetailPanel from "../components/DetailPanel";
import type { SearchResult } from "../lib/types";

const mk = (id: string, score: number): SearchResult => ({
  id, thumb_url: `/api/thumbs/${id}`,
  bbox: [[[39, 21], [39.1, 21], [39.1, 21.1], [39, 21.1], [39, 21]]],
  score, captured_at: "2025-09-29T08:04:26Z",
});
const results = [mk("a", 0.91), mk("b", 0.42), mk("c", 0.10)];

it("row hover/focus emits onHover(id) and leave emits null", () => {
  const onHover = vi.fn();
  render(<ResultsPanel results={results} selectedId="a" onPick={() => {}} onHover={onHover} />);
  const row = screen.getByRole("button", { name: /0\.91/ });
  fireEvent.focus(row);  expect(onHover).toHaveBeenLastCalledWith("a");
  fireEvent.blur(row);   expect(onHover).toHaveBeenLastCalledWith(null);
});

it("DetailPanel prev/next navigates through results", () => {
  const onNavigate = vi.fn();
  const onClose = vi.fn();
  render(<DetailPanel tile={results[0]} results={results} onClose={onClose} onNavigate={onNavigate} />);
  fireEvent.click(screen.getByRole("button", { name: /previous/i }));
  expect(onNavigate).toHaveBeenCalledWith(-1);
  fireEvent.click(screen.getByRole("button", { name: /next/i }));
  expect(onNavigate).toHaveBeenCalledWith(1);
});

it("arrow keys navigate when the panel is focused", () => {
  const onNavigate = vi.fn();
  render(<DetailPanel tile={results[0]} results={results} onClose={vi.fn()} onNavigate={onNavigate} />);
  fireEvent.keyDown(window, { key: "ArrowRight" });
  expect(onNavigate).toHaveBeenCalledWith(1);
  fireEvent.keyDown(window, { key: "ArrowLeft" });
  expect(onNavigate).toHaveBeenCalledWith(-1);
});
```

Map popup tests (in the same file, maplibre mocked as in `search_ui.test.tsx`):

- **Step 1a — extend the mock first (finding 23):** the hoisted `MockPopup` class currently has only `setLngLat`/`setHTML`/`addTo`, and **the class is copy-pasted in multiple test files** — add `setDOMContent = vi.fn((): any => this);` and `remove = vi.fn();` to **every** copy (grep the repo: `grep -rln "class MockPopup" apps/web/__tests__`). Without this, the second marker click throws `ref.current.remove is not a function`.
- **Step 1b — single-instance lifecycle:** after clicking a marker twice, assert the previous popup instance's `remove` was called and the new content went through `setDOMContent` (**not** `setHTML`) — pin via instance call-counts from the mock's `popups` array.
- **Step 1c — unmount cleanup (finding 24, pins Review Focus 4):** open a popup (marker click), `unmount()` the map, assert the last popup instance's `remove` was called and `map.remove` was called (the existing unmount helpers in `search_ui.test.tsx` show the pattern).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx vitest run __tests__/interactive-info.test.tsx`
Expected: FAIL — `onHover` / `onNavigate` props do not exist

- [ ] **Step 3: Implement**

- `dashboard/page.tsx`: add `hoveredId` state; pass `onHover={setHoveredId}` to ResultsPanel, `hoveredId` to MapView and View3D; `handlePrevNext(delta)` computes next index modulo `results.length` and sets `selectedId`, returning early when `results.length < 2` **or `selectedId === null`** (finding 21: the ArrowLeft/Right listener lives inside DetailPanel, which only mounts when something is selected — a "select index 0 by keyboard from nothing" branch would be unreachable dead code; first selection happens by click).
- `ResultsPanel.tsx`: rows get `onMouseEnter/onMouseLeave/onFocus/onBlur` → `onHover(id|null)`; keep `aria-current` selection from Task 5.
- `Map.tsx`: derive marker paint from `hoveredId` (hovered feature → accent color + larger radius in the existing `circle-color`/`circle-radius` expressions; no listeners added).
- `View3D.tsx`: hovered point → `scale ×1.4` + accent color (single re-render from props; reuse the existing rebuild effect).
- `DetailPanel.tsx`: header row with `‹ Previous` / `Next ›` buttons (`aria-label="Previous result"` / `"Next result"`) calling `onNavigate(±1)`; a `useEffect` binding `window keydown` ArrowLeft/ArrowRight → `onNavigate`, cleaned up on unmount.
- `Map.tsx` popup: replace `setHTML` string interpolation with a `useRef<popup instance>`; before `setLngLat(...).addTo(map)` call `ref.current?.remove()`; build content:

```ts
const el = document.createElement("div");
const score = document.createElement("strong");
score.textContent = `Score ${feature.score_display}`;   // textContent, never innerHTML
const date = document.createElement("div");
date.textContent = feature.date;
el.append(score, date);
popup.setDOMContent(el);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npm test && npx tsc --noEmit && npm run build`
Expected: PASS — including prior Map/search_ui tests (update popup tests that asserted `setHTML` to assert `setDOMContent` + single-instance `remove`)

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/dashboard/page.tsx apps/web/components/ResultsPanel.tsx apps/web/components/Map.tsx apps/web/components/View3D.tsx apps/web/components/DetailPanel.tsx apps/web/__tests__/interactive-info.test.tsx
git commit -m "feat: cross-highlight, detail prev/next, single DOM-built map popup"
```

---

### Task 10: Integration, assets, e2e, ship

**Files:**
- Modify: `apps/web/e2e/dashboard.spec.ts`, `README.md` (only if copy drifted), `docs/screenshots/*` + `apps/web/public/screenshots/*` + `docs/demo.gif` + `apps/web/public/demo.gif` (regenerated)
- Test: the full suites (run, not authored here)

**Interfaces:**
- Consumes: everything from Tasks 1–9; recording spec (regenerates assets, dual-writes).
- Produces: e2e covering the three new user flows; refreshed assets; live deployment.

- [ ] **Step 1: Extend the e2e (fail first — new steps reference not-yet-tested UI, run against the current build to see the guidance assertions fail)**

Append to `apps/web/e2e/dashboard.spec.ts`. **Reuse the spec file's existing proven login block verbatim** (the helper/steps the current `dashboard: login → search → …` test already uses — do not re-invent selectors like guessed button names; extract it into a local `async function login(page)` inside the spec if it isn't one already, and call it from all three tests). Then append:

```ts
test("first-run guide and suggestion chips lead to results", async ({ page }) => {
  await login(page);
  // Guide visible before any search (Review Focus #2)
  await expect(page.getByRole("heading", { name: /how this works/i })).toBeVisible();
  // Chip → results (exactly one search POST)
  const searchPromise = page.waitForResponse((r) => r.url().includes("/api/search/vector") && r.request().method() === "POST");
  await page.getByRole("button", { name: "turquoise coastal water" }).first().click();
  await searchPromise;
  await expect(page.getByRole("heading", { name: /how this works/i })).toHaveCount(0);
  await expect(page.getByTestId("result-row").first()).toBeVisible(); // testid added in Task 5's ResultsPanel step
});

test("polygon draw searches an area", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: "Draw polygon" }).click();
  await page.locator(".maplibregl-canvas").waitFor({ state: "visible" });
  const canvas = page.locator(".maplibregl-canvas");
  const box = (await canvas.boundingBox())!;
  // Sentinel instead of a blind timeout (finding 14 / Review Focus #5): click 1,
  // then WAIT for the status strip to report the first vertex — that text can only
  // appear if the click registered on a loaded style, so a slow cold stack fails
  // loudly here instead of silently no-op'ing every vertex.
  await canvas.click({ position: { x: box.width * 0.45, y: box.height * 0.40 } });
  // exact pattern: only the POST-click-1 status ("1 vertex — …") matches; the
  // pre-click "0 vertices" text does not (Task 7 pins the format)
  await expect(page.getByRole("status").filter({ hasText: /^1 vertex —/ }).first()).toBeVisible({ timeout: 15_000 });
  for (const [fx, fy] of [[0.60, 0.40], [0.55, 0.55]]) {
    await canvas.click({ position: { x: box.width * fx, y: box.height * fy } });
  }
  const req = page.waitForResponse((r) => r.url().includes("/api/search/polygon"));
  await page.keyboard.press("Enter");
  const res = await req;
  expect(res.status()).toBe(200);
});
```

**Note:** `data-testid="result-row"` is added to each row in `ResultsPanel` by **Task 5's implementation step** (already in this plan) — Task 10 only consumes it; no markup change happens in this task.

- [ ] **Step 2: Run the full local gates**

Run: `cd apps/api && ../../.venv/bin/pytest -q -m "not ml"` ; `cd etl && ../.venv/bin/pytest -q -m "not smoke"` ; `cd apps/web && npm test && npx tsc --noEmit && npm run build` ; repo root: `.venv/bin/ruff check .`
Expected: all PASS

- [ ] **Step 3: Run e2e against a rebuilt stack**

```bash
sudo docker compose -p geo-rag -f docker-compose.coolify.yml up -d --build web api
cd apps/web && npx playwright test
```
Expected: PASS — old flow + both new tests (if `docker compose` e2e env needs the fixture stack: `sudo docker compose up -d db` first per the e2e config's webServer).

- [ ] **Step 4: Regenerate assets (visuals changed)**

```bash
cd apps/web && npx playwright test e2e/recording.spec.ts
```
Then verify `git status` shows dual-written `docs/` + `public/` pairs identical (md5), and `docs/demo.gif` refreshed if the walkthrough changed. Update README only if its copy no longer matches (quickstart/creds unchanged).

- [ ] **Step 5: Commit + push + PR**

```bash
git add -A
git commit -m "feat: UI/UX redesign integration — e2e coverage, regenerated assets"
git push -u origin feat/ui-redesign
gh pr create --base main --head feat/ui-redesign --title "UI/UX redesign: guidance, suggestions, polygon draw, interactive info, design system" --body "Implements the Hallmark audit fixes (4 critical, 6 major, most minors) across three phases. Suites: api/etl/web green, e2e extended with first-run + polygon flows, assets regenerated."
```

- [ ] **Step 6: Deploy live + verify**

```bash
sudo docker compose -p geo-rag -f docker-compose.coolify.yml up -d --build web api
```
Verify: `curl -sI https://geo.sumbono.dev/` (headers intact), landing 200 with new structure, login→guide visible, polygon search 200 via authenticated curl, telemetry/thumbs unchanged (200), unauth 401. Record results in the PR body update.

---

## Self-Review (executed by plan author)

1. **Spec coverage:** audit #3 → Task 1; #4 → Task 2; #1/#2 → Tasks 3–4 (preview gate + build); #8/#9/#10 + #14 → Task 3; #7/#11/#12/#13/#15 → Task 5; #5 → Tasks 6 (feedback) + 7 (polygon FE) + 8 (polygon API); #6 → Task 9; e2e/ship → Task 10. All 15 findings mapped; the 5 user issues = audit 3,4,5(→6,7,8),6(→9). **No gaps.**
2. **Placeholder scan:** Task 8's parametrize row flagged and replaced inline with a concrete `bad_shape` test; font names are concrete (Space_Grotesk/Inter/JetBrains_Mono — the preview gate resolved into `design.md` before execution); no TBD/TODO/"similar to Task N".
3. **Type consistency:** `onSuggest(query: string)` identical in Tasks 1/2 (page's `handleSuggest`); `SearchResult` untouched; `MapHandle` grows `setPreviewRectangle` (T6) then `setPolygon` (T7) — both additive; `BboxDrawHandle.handleMapClick` unchanged signature across T6/T7; `onHover`/`onNavigate` defined only in Task 9 and consumed there.
4. **Review Focus:** all five lines have owning tests — polygon validation matrix (T8 Step 1), guide visibility lifecycle (T1 Step 1 page tests), landmark preservation (T4 Step 1 + full Playwright T10), hover/popup cleanup (T9 Step 1 + existing unmount tests), polygon e2e race (T10 Step 1 wait + T7 deterministic unit tests).

**Triple-pass verification (2026-10-08) applied:** fixed 5 Pass-2 defects before execution — T8's `seeded_tiles` dict-iteration bug (compare `str(seeded_tiles["coral"].id)` directly), T8's malformed parametrize row removed + standalone `bad_shape` test, T5's color-scan extended to `rgb()/rgba(`, T10's login steps changed to reuse the spec's proven block, T7's double-click-close sentence made unambiguous (second rapid click = close, never append).

**Harness-adversarial pass (2026-10-08) applied:** fixed 4 more — user-event imports → `fireEvent` (package never installed), `login` fixture → explicit `login(client)` calls, `result-row` testid ownership pinned to T5, fetch mocking → `vi.stubGlobal` harness; plus rect/polygon precedence clause.

**Design gate resolved (2026-10-08):** user confirmed the multi-page design system; `design.md` written at repo root (modern-minimal · Cobalt-teal · Workbench families · Space Grotesk/Inter/JetBrains Mono · bordered nav · Ft2 footer · ⌘K deferred). Tasks 3–5 rewritten to consume it directly — no open decisions remain in this plan.

**Independent adversarial review (2026-10-08, fresh-context subagent) applied:** 10 criticals + 7 majors + 11 minors found and fixed — broken `../.venv` pytest path (→`../../.venv`), six test files missing vitest core imports, Task 1 page tests without the maplibre/fetch mock boilerplate, impossible `result-row` await at T1, RTL `getByText` scope bug, T1/T2 breaking five pre-existing assertions (scoped via `within` + Step 3b), T6 preview-order contradiction, orphaned `redesign-decisions.md` references, missing `isolate_tiles` in the polygon test file, wrong token names in T5, end-of-plan (not post-T3) color constraint + DetailPanel/TelemetryChart added to T5's file set, optional cross-task props (`polygonMode?`/`onHover?`/`onNavigate?`) for tsc across task boundaries, exact page wiring for `active`/`polygonMode`, double-click close moved into BboxDraw + unit test, maplibre paint hex constant (CSS vars don't resolve), shadow rename map entry, `func.ST_GeomFromText` + HTTPException imports, sweep in BOTH lists, limit-validation single mechanism, footer without links + single solid button, `next/font` network note, vertex-status e2e sentinel with pinned format, and the tabular-nums test now asserting the CSS itself.
