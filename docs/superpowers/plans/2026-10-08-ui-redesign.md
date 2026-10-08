# UI/UX Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the four critical and six major UI/UX findings from the Hallmark audit — first-run guidance, search suggestions, free-polygon drawing, interactive info display, plus the visual-system pass — so a first-time visitor can discover and use the app without external instructions.

**Architecture:** Three phases over the existing Next.js 15 app. Phase A (Tasks 1–2) adds first-run discovery on the dashboard. Phase B (Tasks 3–5) is a Hallmark redesign pass: design decisions approved via preview gate first, then a `tokens.css` foundation, then landing/dashboard conformance. Phase C (Tasks 6–9) deepens interaction: live draw feedback, free-polygon search (frontend machine + new API endpoint), and cross-highlight/prev-next/popup lifecycle. Task 10 integrates, regenerates assets, and ships.

**Tech Stack:** Next.js 15 (App Router, client components), TypeScript, plain CSS custom properties (no CSS framework), maplibre-gl v6 (existing), Three.js (existing), D3 (existing), FastAPI + SQLAlchemy/GeoAlchemy2 + pgvector (existing), Vitest + RTL, Playwright. **No new runtime npm/pip dependencies** (fonts self-hosted via `next/font` — no new package).

**Spec:** `/home/bono/portfolio/geo-rag-ui-audit.md` (the Hallmark audit — 15 findings, each with file:line and fix). The plan argues from the audit; executors read both. The five user-reported issues are audit findings 3 (guidance/value), 4 (suggestions), 5 (polygon draw), 6→10 (interactive info), and the design pass covers 1–2 + 7–9 + minors 11–15.

## Global Constraints

- All suites stay green at every task boundary: `cd apps/api && ../.venv/bin/pytest -q -m "not ml"` (75+), `cd etl && ../.venv/bin/pytest -q -m "not smoke"` (38+), `cd apps/web && npm test` (70+), `npx tsc --noEmit`, `npm run build`, `.venv/bin/ruff check .` (exit 0).
- E2E selectors that must keep working (Task 10 runs them): heading `Geo-RAG Earth Dashboard`, `data-testid="gif-slot"`, `data-testid="demo-access-card"`, GitHub link name `/github repository/i`, login link, `aria-pressed` tab buttons, `OSM streets` toggle, dashboard search submit flow.
- **No new runtime dependencies.** Two font files via `next/font/google` are allowed (build-time fetch, next/font caches); no npm packages, no pip packages.
- After Task 3: every color/font/easing/focus value in `apps/web` CSS references a `tokens.css` token — no inline hex/OKLCH in TSX `style={{}}` for colors (layout-only inline styles tolerated where a token adds nothing); `--color-danger` is the only red; `#1d4ed8` is removed from the palette entirely.
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
5. **Polygon e2e racing the map** — canvas clicks before the style loads no-op (the bbox e2e already waits; polygon must too). → pinned in Task 10: `waitFor` on map load sentinel before vertex clicks, mirroring the existing bbox steps.

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
├── redesign-decisions.md            # T3: created — approved Hallmark decisions
├── screenshots/, demo.gif           # T10: regenerated
└── superpowers/plans/2026-10-08-ui-redesign.md   # this file
```

---

### Task 1: First-run guidance panel (audit critical #3)

**Files:**
- Create: `apps/web/lib/suggestions.ts`, `apps/web/components/FirstRunGuide.tsx`, `apps/web/__tests__/guidance.test.tsx`
- Modify: `apps/web/components/EmptyState.tsx` (import shared constant), `apps/web/app/dashboard/page.tsx` (render guide)

**Interfaces:**
- Consumes: page state `searched: boolean`, `results: SearchResult[]`, existing `handleSuggest(suggested: string)` on the page.
- Produces: `lib/suggestions.ts` exports `export const EXAMPLE_QUERIES = ["turquoise coastal water", "desert near shoreline", "cloud patterns"] as const;` (moved verbatim from `EmptyState.tsx:8-12` — EmptyState imports it). `<FirstRunGuide visible={boolean} onSuggest={(query: string) => void} />` — rendered by the page when `!searched && results.length === 0`.

- [ ] **Step 1: Write the failing tests**

```tsx
// apps/web/__tests__/guidance.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import FirstRunGuide from "../components/FirstRunGuide";

describe("FirstRunGuide", () => {
  it("renders the how-it-works steps and the value explainer when visible", () => {
    render(<FirstRunGuide visible onSuggest={() => {}} />);
    expect(screen.getByRole("heading", { name: /how this works/i })).toBeInTheDocument();
    expect(screen.getByText(/score/i)).toHaveTextContent(/0/i); // score 0–1 explained
    expect(screen.getByText(/capture date/i)).toBeInTheDocument();
  });

  it("renders nothing when not visible", () => {
    render(<FirstRunGuide visible={false} onSuggest={() => {}} />);
    expect(screen.queryByRole("heading", { name: /how this works/i })).not.toBeInTheDocument();
  });

  it("suggestion buttons call onSuggest with the query text", async () => {
    const onSuggest = vi.fn();
    render(<FirstRunGuide visible onSuggest={onSuggest} />);
    await userEvent.click(screen.getByRole("button", { name: "turquoise coastal water" }));
    expect(onSuggest).toHaveBeenCalledWith("turquoise coastal water");
  });
});
```

Page-level test (appended to `apps/web/__tests__/guidance.test.tsx`), mocking `lib/api`:

```tsx
import DashboardPage from "../app/dashboard/page";
// fetch mock: POST /api/search/vector → { results: [ ...one SearchResult ] }

it("shows the guide before the first search and hides it once results exist", async () => {
  render(<DashboardPage />);
  expect(screen.getByRole("heading", { name: /how this works/i })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Search" })); // type first
  // ...type a query, submit, await results
  expect(screen.queryByRole("heading", { name: /how this works/i })).not.toBeInTheDocument();
});

it("shows the guide again on a fresh mount with no prior search", () => {
  const { unmount } = render(<DashboardPage />);
  unmount();
  render(<DashboardPage />);
  expect(screen.getByRole("heading", { name: /how this works/i })).toBeInTheDocument();
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
- Modify: `apps/web/components/SearchBar.tsx`
- Test: `apps/web/__tests__/search-suggestions.test.tsx` (created)

**Interfaces:**
- Consumes: `EXAMPLE_QUERIES` from `lib/suggestions.ts` (Task 1); page passes a new optional prop.
- Produces: `SearchBarProps` gains `onSuggest: (query: string) => void` — the page wires it to its existing `handleSuggest` (same function EmptyState uses). Chips render **above the submit button, always** (not gated on results).

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/__tests__/search-suggestions.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

it("clicking a chip calls onSuggest exactly once", async () => {
  const onSuggest = vi.fn();
  render(<SearchBar {...base} onSuggest={onSuggest} />);
  await userEvent.click(screen.getByRole("button", { name: "cloud patterns" }));
  expect(onSuggest).toHaveBeenCalledTimes(1);
  expect(onSuggest).toHaveBeenCalledWith("cloud patterns");
});
```

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

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npm test`
Expected: PASS — all files (guidance + existing search_ui tests still green: SearchBar's single-POST contract unchanged for typed submits)

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/SearchBar.tsx apps/web/app/dashboard/page.tsx apps/web/__tests__/search-suggestions.test.tsx
git commit -m "feat: always-visible example-query chips under the search bar"
```

---

### Task 3: Hallmark redesign — approved decisions + design-system foundation (audit criticals #1–#2 groundwork, majors #8–#9)

**Files:**
- Controller gate (Step 1) — no files
- Create: `apps/web/tokens.css`, `docs/redesign-decisions.md`
- Modify: `apps/web/app/layout.tsx` (font + token import), `apps/web/app/globals.css` (append-only migration of base rules)

**Interfaces:**
- Consumes: audit findings 1–2 (centered template, one-font), 8 (body gradient), 9 (default easing), 10 (focus rings); existing `:root` tokens at `globals.css:1-12`.
- Produces: `tokens.css` defines — `--color-paper`, `--color-surface`, `--color-ink`, `--color-ink-soft`, `--color-accent`, `--color-accent-strong`, `--color-accent-soft`, `--color-danger`, `--color-border`, `--font-display`, `--font-body`, `--space-1..8` (4pt scale), `--text-display/-s/-2xl/-xl/-lg/-base/-sm`, `--ease-out: cubic-bezier(0.16, 1, 0.3, 1)`, `--dur-fast: 120ms`, `--dur-base: 200ms`, `--focus-ring: 2px solid var(--color-accent)`, `--radius`, `--shadow` — plus `docs/redesign-decisions.md` recording macrostructure/theme/palette/font pair/nav+footer archetypes from the approved preview. `layout.tsx` imports `./tokens.css` before `./globals.css` and loads the two fonts via `next/font/google` with `variable` names `--font-display` / `--font-body`.

- [ ] **Step 1: Hallmark redesign preview gate (controller, not a subagent)**

Run the `hallmark redesign` verb against the landing (`app/page.tsx` + `globals.css`) with the audit as context. The preview MUST (audit constraints): kill the centered-hero template (asymmetric, left-biased), introduce a display+body **pairing** (self-hosted via `next/font/google`), flat tinted paper (no body gradient), preserve the existing teal accent family as anchor (pre-flight rule: preserve palette), preserve the e2e landmarks (see Global Constraints). Emit the preview block; **STOP and get user approval of the preview** before Step 2. Record the approved picks (macrostructure, theme tokens with OKLCH values, font pair, nav archetype, footer archetype) in `docs/redesign-decisions.md`.

- [ ] **Step 2: Write `tokens.css` from the approved decisions**

Every value comes from `redesign-decisions.md` — the full token list from Interfaces. Example skeleton (values = the approved decisions):

```css
/* Hallmark · macrostructure: <approved name> · tone: <approved tone> · anchor hue: teal (preserved) */
:root {
  --color-paper: <oklch from decisions>;      /* flat — replaces body gradient */
  --color-surface: <oklch>;
  --color-ink: <oklch>;
  --color-ink-soft: <oklch>;
  --color-accent: #0b6f8f;                    /* preserved teal family */
  --color-accent-strong: #08556e;
  --color-accent-soft: <tint>;
  --color-danger: <red oklch>;                /* THE only red (audit #15) */
  --color-border: <oklch>;
  --font-display: var(--font-display-local);
  --font-body: var(--font-body-local);
  --space-1: 4px;  --space-2: 8px;  --space-3: 12px;  --space-4: 16px;
  --space-5: 24px; --space-6: 32px; --space-7: 48px; --space-8: 64px;
  --text-display: clamp(2.4rem, 5.5vw, 4rem);
  --text-2xl: clamp(1.6rem, 3vw, 2.2rem);
  --text-xl: 1.4rem; --text-lg: 1.15rem; --text-base: 1rem; --text-sm: 0.875rem;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --dur-fast: 120ms; --dur-base: 200ms;
  --radius: 14px;
  --shadow: 0 10px 30px rgba(16, 32, 46, 0.08);
}
```

- [ ] **Step 3: Wire fonts + tokens in `layout.tsx`**

```tsx
import { <DisplayFont>, <BodyFont> } from "next/font/google";
import "./tokens.css";
import "./globals.css";

const display = <DisplayFont>({ subsets: ["latin"], variable: "--font-display-local", display: "swap" });
const body = <BodyFont>({ subsets: ["latin"], variable: "--font-body-local", display: "swap" });

// root layout: <body className={`${display.variable} ${body.variable}`}>
```

(Exact font component names = the approved pairing from `redesign-decisions.md`.)

- [ ] **Step 4: Migrate base rules in `globals.css` (append-only — never remove the file's existing structure wholesale)**

- `body`: `background: var(--color-paper)` (delete the `linear-gradient` at `:25`), `font-family: var(--font-body)`.
- Headings (`.hero h1`, `.auth__card h1`, add a generic `h1, h2, h3`): `font-family: var(--font-display)`, `font-style: normal` (roman, never italic).
- `.button`: `transition: background-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);` (kills browser `ease`, audit #9); add

```css
.button:focus-visible,
a:focus-visible,
[role="button"]:focus-visible {
  outline: var(--focus-ring);
  outline-offset: 2px;
}
```

(fixes audit #10; instant, never animated). Swap raw hex for tokens: `#b3261e` → `var(--color-danger)` (`:324`), `#ffffff` in `.button--primary` → `var(--color-surface)` or a dedicated `--color-on-accent` token added to `tokens.css`. Delete dead `.preview__hint` (`:243-246`, audit #14).

- [ ] **Step 5: Run suites + build**

Run: `cd apps/web && npm test && npx tsc --noEmit && npm run build`
Expected: all PASS — existing tests assert behavior, not colors; if any test asserted a migrated hex, update the test to the token role, not the old value.

- [ ] **Step 6: Commit**

```bash
git add apps/web/tokens.css apps/web/app/layout.tsx apps/web/app/globals.css docs/redesign-decisions.md
git commit -m "feat: design-system foundation — tokens, font pairing, flat paper, focus rings, easing"
```

---

### Task 4: Landing restructure to the approved macrostructure (audit critical #1)

**Files:**
- Modify: `apps/web/app/page.tsx`, `apps/web/app/globals.css` (landing section rules only)
- Test: `apps/web/__tests__/landing.test.tsx` (extend)

**Interfaces:**
- Consumes: approved macrostructure + archetypes (`docs/redesign-decisions.md`), tokens from Task 3.
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

- [ ] **Step 3: Restructure `page.tsx` + landing CSS per `redesign-decisions.md`**

- Kill `.hero { text-align: center }` → left-biased grid (audit #1): headline column + actions/demo-card column per the approved macrostructure (exact layout = decisions doc; constraint: headline and CTA no longer centered, hero height = content height).
- Headline uses `var(--font-display)` + `var(--text-display)`; ≤ 50 chars (current headline is 22 — keep).
- Eyebrow pill (`.hero__eyebrow`) only if the approved macrostructure calls for it — the audit flags badge-pills as template furniture; drop if the decisions doc doesn't mandate it.
- Footer: adopts the approved footer archetype (closes the page — no centered sitemap echo).
- All values via tokens (no new hex).

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
- Modify: `apps/web/app/dashboard/page.tsx`, `apps/web/components/ResultsPanel.tsx`, `apps/web/components/EmptyState.tsx`, `apps/web/components/BboxDraw.tsx` (styles only), `apps/web/app/globals.css` (append dashboard rules)
- Test: `apps/web/__tests__/dashboard-styles.test.tsx` (created)

**Interfaces:**
- Consumes: tokens from Task 3; existing test contracts (results row content, `role="search"`, tab `aria-pressed`).
- Produces: CSS classes `.dashboard`, `.dash-row`, `.dash-alert`, `.dash-status` (layout migrated out of inline `style={{}}` where it carries color/spacing tokens); `ResultsPanel` rows use `var(--color-accent)` for selected (NOT `#1d4ed8`), `aria-current` instead of `aria-pressed`, `font-variant-numeric: tabular-nums` on the row; one danger token used by the alert; dashed borders → solid hairline.

- [ ] **Step 1: Write the failing tests**

```tsx
// apps/web/__tests__/dashboard-styles.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  // the class is the token-migrated container; css assertion lives in the snapshot of globals.css scan below
});

it("no raw palette hex remains in dashboard components (audit #7)", async () => {
  const fs = await import("node:fs/promises");
  const files = ["app/dashboard/page.tsx", "components/ResultsPanel.tsx", "components/EmptyState.tsx", "components/BboxDraw.tsx"];
  for (const file of files) {
    const src = await fs.readFile(new URL(`../${file}`, import.meta.url), "utf8");
    const hexes = src.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect(hexes, `${file} contains raw hex: ${hexes}`).toEqual([]);
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx vitest run __tests__/dashboard-styles.test.tsx`
Expected: FAIL — `aria-pressed` still present on rows; raw hex found in `dashboard/page.tsx` (`#b91c1c`) and `ResultsPanel.tsx` (`#1d4ed8`, `#ffffff`, `rgba(...)`)

- [ ] **Step 3: Implement**

- `ResultsPanel.tsx`: row → `className="results-row"` + `aria-current={selected ? "true" : undefined}` (drop `aria-pressed`); selected styling moves to CSS: `.results-row[aria-current="true"] { background: var(--color-accent); color: var(--color-on-accent, #fff); }`; `.results-row { font-variant-numeric: tabular-nums; }`; borders/background all token-based; delete the dead `results.length === 0` placeholder branch (`:23-25` — page never mounts it empty; audit noted it).
- `dashboard/page.tsx`: replace inline `style={{…}}` with classes `.dashboard`, `.dash-row`, `.dash-alert`, `.dash-status`; error color → `var(--color-danger)` (kills `#b91c1c`).
- `EmptyState.tsx` / `BboxDraw.tsx`: dashed borders → `1px solid var(--color-border)` (audit #11); fallback-hex vars (`var(--surface, #ffffff)`) → plain `var(--color-surface)`.
- `globals.css` append: the `.results-row`, `.guide` (Task 1 may have added minimal styles — harmonize), `.dash-*` rules with tokens only.

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
import { render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import BboxDraw, { type BboxDrawHandle } from "../components/BboxDraw";
import { type RefObject } from "react";

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

it("click 1 previews the degenerate box, click 2 completes it", async () => {
  const { ref, onPreview, onRectangle } = setup();
  ref.current!.handleMapClick([39.0, 21.0]);
  expect(onPreview).toHaveBeenCalledWith([[39, 21], [39, 21]]);
  ref.current!.handleMapClick([39.2, 21.2]);
  expect(onPreview).toHaveBeenLastCalledWith([[39.0, 21.0], [39.2, 21.2]]);
  expect(onRectangle).toHaveBeenCalledWith([[39.0, 21.0], [39.2, 21.2]]);
});

it("rectangle is emitted BEFORE the request resolves (visual-first)", async () => {
  const { ref, onRectangle, onResults } = setup();
  let resolveFetch!: (v: { results: never[] }) => void;
  global.fetch = vi.fn(() => new Promise((r) => { resolveFetch = r; })) as never;
  ref.current!.handleMapClick([39.0, 21.0]);
  ref.current!.handleMapClick([39.2, 21.2]);
  expect(onRectangle).toHaveBeenCalledTimes(1);   // fired while fetch is pending
  expect(onResults).not.toHaveBeenCalled();
  resolveFetch({ results: [] });
  await waitFor(() => expect(onResults).toHaveBeenCalledTimes(1));
});

it("Esc clears the preview", async () => {
  const { ref, onPreview } = setup();
  ref.current!.handleMapClick([39.0, 21.0]);
  await userEvent.keyboard("{Escape}");
  expect(onPreview).toHaveBeenLastCalledWith(null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx vitest run __tests__/draw-feedback.test.tsx`
Expected: FAIL — `onPreview` prop does not exist

- [ ] **Step 3: Implement**

`Map.tsx`: add `setPreviewRectangle` to `MapHandle` — draws GeoJSON polygon into a `draw-preview` source/layer with `line-dasharray: [2, 2]`, `line-color: var/accent`, cleared on `null` and on `map.remove()` cleanup (share the helper shape with `setRectangle`; preview layer id distinct from the persisted `draw-rectangle` layer).

`BboxDraw.tsx`: add `onPreview` prop; in `handleMapClick`:
- click 1: `onPreview([lonLat, lonLat])` alongside `setCorner`.
- Esc / disarm: `onPreview(null)`.
- click 2 (after normalization): `onPreview(bbox)` is already implied by completing the box — call `onRectangle(bbox)` **before** `void runSearch(bbox)` (move the existing call from `runSearch`'s success path at `:73` to `handleMapClick` after normalization), clear preview (`onPreview(null)` — the persisted rectangle takes over), then POST. On fetch error the page keeps the rectangle + shows the alert (update the `BboxDraw` docstring comment at `:36-39` accordingly).

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
- Produces: `BboxDraw` gains a second toggle **"Draw polygon"** (`shape: "rect" | "polygon" | null` internal; only one shape armed at a time — arming one disarms the other via one shared `onToggle` for rect and a new `onTogglePolygon` for polygon, page owns both flags). Polygon machine: each map click appends a vertex (`[lon,lat]`, cap 64); Enter key or map double-click closes (≥3 vertices required); Esc clears vertices but keeps armed; close → `POST /api/search/polygon` body `{polygon: [[lon,lat], ...], q: currentQuery || null}` → `onResults` (same merge path) + `onPolygon(polygon)` so Map can draw the finalized shape (`MapHandle.setPolygon(coords: [number,number][] | null)` — solid line layer `draw-polygon`, cleared on arm/disarm). Status strip shows `N vertices — click to add, Enter/double-click to close (Esc clears).`

- [ ] **Step 1: Write the failing tests**

```tsx
// apps/web/__tests__/polygon-draw.test.tsx
import { render, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { vi } from "vitest";
import BboxDraw, { type BboxDrawHandle } from "../components/BboxDraw";
import { type RefObject } from "react";

function setup() {
  const onPolygon = vi.fn();
  const onResults = vi.fn();
  const onError = vi.fn();
  const ref: RefObject<BboxDrawHandle | null> = { current: null };
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ results: [] }) })) as never;
  render(
    <BboxDraw ref={ref} active polygonMode onToggle={() => {}} onTogglePolygon={() => {}} currentQuery="water" onResults={onResults} onRectangle={() => {}} onPreview={() => {}} onPolygon={onPolygon} onError={onError} />,
  );
  return { ref, onPolygon, onResults, onError };
}

it("accumulates vertices and refuses to close with fewer than 3", async () => {
  const { ref, onPolygon } = setup();
  ref.current!.handleMapClick([39.0, 21.0]);
  ref.current!.handleMapClick([39.1, 21.0]);
  await userEvent.keyboard("{Enter}");
  expect(onPolygon).not.toHaveBeenCalled();
  ref.current!.handleMapClick([39.05, 21.1]);
  await userEvent.keyboard("{Enter}");
  expect(onPolygon).toHaveBeenCalledWith([[39.0, 21.0], [39.1, 21.0], [39.05, 21.1]]);
});

it("POSTs /api/search/polygon with polygon and q, then lifts results", async () => {
  const { ref, onResults } = setup();
  ref.current!.handleMapClick([39.0, 21.0]);
  ref.current!.handleMapClick([39.1, 21.0]);
  ref.current!.handleMapClick([39.05, 21.1]);
  await userEvent.keyboard("{Enter}");
  await waitFor(() => expect(onResults).toHaveBeenCalledTimes(1));
  expect(global.fetch).toHaveBeenCalledWith("/api/search/polygon", expect.objectContaining({
    method: "POST",
    body: JSON.stringify({ polygon: [[39, 21], [39.1, 21], [39.05, 21.1]], q: "water" }),
  }));
});

it("Esc clears vertices without sending", async () => {
  const { ref, onPolygon } = setup();
  ref.current!.handleMapClick([39.0, 21.0]);
  ref.current!.handleMapClick([39.1, 21.0]);
  await userEvent.keyboard("{Escape}");
  await userEvent.keyboard("{Enter}");
  expect(onPolygon).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx vitest run __tests__/polygon-draw.test.tsx`
Expected: FAIL — `polygonMode` / `onTogglePolygon` / `onPolygon` props do not exist

- [ ] **Step 3: Implement**

`BboxDraw.tsx` — new state `vertices: [number, number][]` (reset on arm/disarm/Esc/after send). New props: `polygonMode: boolean`, `onTogglePolygon: () => void`, `onPolygon: (polygon: [number, number][]) => void`. Routing: when `polygonMode` and `active`-equivalent flag is on, `handleMapClick` appends to `vertices` (cap 64 — silently ignore beyond, status strip says `64 vertex cap`) instead of the rect machine; `runPolygon(polygon)` posts `/search/polygon` via `apiFetch`, calls `onResults` + disarms via `onTogglePolygon()`. Keydown: Enter closes (≥3), Esc clears `vertices`. UI: second ghost toggle button `aria-pressed={polygonMode}` labeled `Draw polygon`, mutually exclusive with `Draw area` (arming one calls the other's off-handler via the page). Status strip mirrors the rect variant with vertex count.

`Map.tsx`: `setPolygon(coords: [number,number][] | null)` on `MapHandle` — GeoJSON LineString (auto-close ring on render) in layer `draw-polygon`, solid accent line + 15% fill; cleared on null. Map double-click closes the polygon: map emits double-click as two rapid clicks — **suppress the duplicate vertex** by ignoring a click within 250 ms and <1e-6° of the previous vertex when `vertices.length >= 3`, then treat it as close (this implements "double-click closes" without a second event type).

`dashboard/page.tsx`: `drawShape: "rect" | "polygon" | null` state replaces the boolean (arming one clears the other + clears preview/polygon layers); wires `onPolygon` to draw the finalized shape.

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
- Produces: `POST /search/polygon` body `{"polygon": [[lon, lat], ...], "q": str | null, "limit": int = 12}` → `VectorSearchResponse` (same `SearchResult[]`); validation → 422 for: <3 points, >64 points, non-finite coordinate, out of ±180/±90, zero-area (collinear) ring; duplicate closing vertex (last == first) accepted and normalized (dropped before build). Server builds `POLYGON((...))` WKT → `ST_GeomFromText(…, 4326)`; filter `ST_Intersects(Tile.bbox, poly)`; with `q`: cosine-rank within filter; without: `captured_at DESC`; `limit = min(limit, 12)`.

- [ ] **Step 1: Write the failing tests**

```python
# apps/api/tests/test_search_polygon.py
import pytest

pytestmark = pytest.mark.db

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
    ([[[39.0, 21.0]] * 3][0] + [], "malformed"),  # placeholder replaced below
])
def test_polygon_validation_422(create_client, login, polygon, reason):
    assert create_client.post("/search/polygon", json={"polygon": polygon}).status_code == 422, reason

def test_too_many_points_422(create_client, login):
    pts = [[39.0 + i * 0.001, 21.0 + (i % 2) * 0.001] for i in range(65)]
    assert create_client.post("/search/polygon", json={"polygon": pts}).status_code == 422

def test_closed_ring_normalized_and_returns_only_intersects(create_client, login, seeded_tiles):
    ring = _polygon() + [_polygon()[0]]  # duplicate closing vertex
    r = create_client.post("/search/polygon", json={"polygon": ring})
    assert r.status_code == 200
    ids = {row["id"] for row in r.json()["results"]}
    # seeded tiles span 35.0–35.5E / 20.0–20.01N; this triangle (39E/21N) intersects none
    assert ids == set()

def test_polygon_with_q_ranks_within_filter(create_client, login, seeded_tiles):
    # a box-shaped ring around the seeded band, with the coral query
    ring = [[35.0, 19.99], [35.6, 19.99], [35.6, 20.02], [35.0, 20.02]]
    r = create_client.post("/search/polygon", json={"polygon": ring, "q": "turquoise coral reef"})
    assert r.status_code == 200
    results = r.json()["results"]
    assert 0 < len(results) <= 12
    coral = next(x for x in seeded_tiles if x["id"] == str(seeded_tiles["coral"].id))
    assert results[0]["id"] == coral["id"]
    scores = [row["score"] for row in results]
    assert scores == sorted(scores, reverse=True)
```

*(The malformed-entry parametrize row is written as a plain `bad_shape` fixture instead: `{"polygon": [[39.0, 21.0], [39.1, 21.0], "not-a-point"]}` → 422 — implement the test file with that as its own test, not a parametrize placeholder.)*

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && ../.venv/bin/pytest tests/test_search_polygon.py -v`
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
    poly = ST_GeomFromText(wkt, 4326)
    stmt = select(...).where(ST_Intersects(Tile.bbox, poly))  # same row-mapping as /search/vector
    if payload.q:
        vec = get_encoder(settings).encode_text(payload.q)
        assert vec.shape == (512,)
        stmt = stmt.order_by(Tile.embedding.cosine_distance(vec)).limit(min(payload.limit, 12))
    else:
        stmt = stmt.order_by(Tile.captured_at.desc()).limit(min(payload.limit, 12))
    # map rows with the shared _row_to_result — identical to /search/bbox no-q mode (score 0.0)
```

*(Exact select/mapping lines mirror the `/search/bbox` implementation directly above it in the same file — copy its column list and `_row_to_result` usage; import `ST_GeomFromText` from `geoalchemy2` alongside the existing `ST_Intersects`/`ST_MakeEnvelope` imports, and `math` at module top.)*

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && ../.venv/bin/pytest tests/test_search_polygon.py tests/test_auth.py -v`
Expected: PASS — including authz sweep (add `"/search/polygon"` to the sweep's POST path list in `test_auth.py` and assert 401)

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
- Produces: page state `hoveredId: string | null`; `ResultsPanelProps` gains `onHover: (id: string | null) => void` (fires on row mouseenter/focus → id, mouseleave/blur → null); `Map` gains `hoveredId?: string | null` prop (marker color/size ramp shifts for the hovered feature — no per-result listeners, single paint derived from props); `View3D` gains `hoveredId?: string | null` (highlighted point scaled ×1.4 + accent color); `DetailPanelProps` gains `onNavigate: (delta: 1 | -1) => void` → prev/next buttons + `ArrowLeft`/`ArrowRight` key handlers; `MapHandle.setPopupContent` replaced: single `maplibregl.Popup` instance in a ref, closed before reopen, content built with `document.createElement` + `textContent` (no `setHTML`).

- [ ] **Step 1: Write the failing tests**

```tsx
// apps/web/__tests__/interactive-info.test.tsx
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

it("DetailPanel prev/next navigates through results", async () => {
  const onNavigate = vi.fn();
  const onClose = vi.fn();
  render(<DetailPanel tile={results[0]} results={results} onClose={onClose} onNavigate={onNavigate} />);
  await userEvent.click(screen.getByRole("button", { name: /previous/i }));
  expect(onNavigate).toHaveBeenCalledWith(-1);
  await userEvent.click(screen.getByRole("button", { name: /next/i }));
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

Map popup test (in the same file, maplibre mocked as in `search_ui.test.tsx`): after clicking a marker twice, assert the mock Popup constructor was instantiated **once per open with the previous one `.remove()`d** — pin via a call-count on `remove` (the mock exposes instances).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx vitest run __tests__/interactive-info.test.tsx`
Expected: FAIL — `onHover` / `onNavigate` props do not exist

- [ ] **Step 3: Implement**

- `dashboard/page.tsx`: add `hoveredId` state; pass `onHover={setHoveredId}` to ResultsPanel, `hoveredId` to MapView and View3D; `handlePrevNext(delta)` computes next index modulo `results.length` and sets `selectedId` (no-op when `results.length < 2` or nothing selected — but allow opening detail on first result if none selected: if `selectedId === null && results.length > 0 && delta === 1` → select index 0).
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

Append to `apps/web/e2e/dashboard.spec.ts` (mirror the file's existing wait/selector style):

```ts
test("first-run guide and suggestion chips lead to results", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel(/username/i).fill("demo");
  await page.getByLabel(/password/i).fill("demo-pass-123");
  await page.getByRole("button", { name: /log in|sign in|submit/i }).click();
  await page.waitForURL("**/dashboard");
  // Guide visible before any search (Review Focus #2)
  await expect(page.getByRole("heading", { name: /how this works/i })).toBeVisible();
  // Chip → results (Review Focus satisfied: exactly one search POST)
  const searchPromise = page.waitForResponse((r) => r.url().includes("/api/search/vector") && r.request().method() === "POST");
  await page.getByRole("button", { name: "turquoise coastal water" }).first().click();
  await searchPromise;
  await expect(page.getByRole("heading", { name: /how this works/i })).toHaveCount(0);
  await expect(page.getByTestId("result-row").first()).toBeVisible(); // rows carry data-testid="result-row" (added in Task 5 markup — see note)
});

test("polygon draw searches an area", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel(/username/i).fill("demo");
  await page.getByLabel(/password/i).fill("demo-pass-123");
  await page.getByRole("button", { name: /log in|sign in|submit/i }).click();
  await page.waitForURL("**/dashboard");
  await page.getByRole("button", { name: "Draw polygon" }).click();
  await page.locator(".maplibregl-canvas").waitFor({ state: "visible" });
  await page.waitForTimeout(600); // style load — mirrors the bbox steps' wait (Review Focus #5)
  const canvas = page.locator(".maplibregl-canvas");
  const box = (await canvas.boundingBox())!;
  for (const [fx, fy] of [[0.45, 0.40], [0.60, 0.40], [0.55, 0.55]]) {
    await canvas.click({ position: { x: box.width * fx, y: box.height * fy } });
  }
  const req = page.waitForResponse((r) => r.url().includes("/api/search/polygon"));
  await page.keyboard.press("Enter");
  const res = await req;
  expect(res.status()).toBe(200);
});
```

**Note:** `data-testid="result-row"` is added to each `<li>`/row in `ResultsPanel` during this task (one-line addition — do it in Step 3 with a matching RTL assertion).

- [ ] **Step 2: Run the full local gates**

Run: `cd apps/api && ../.venv/bin/pytest -q -m "not ml"` ; `cd etl && ../.venv/bin/pytest -q -m "not smoke"` ; `cd apps/web && npm test && npx tsc --noEmit && npm run build` ; repo root: `.venv/bin/ruff check .`
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
2. **Placeholder scan:** Task 8's parametrize row flagged and replaced inline with a concrete `bad_shape` test; font names deferred to the preview gate by design (controller gate, documented); no TBD/TODO/"similar to Task N".
3. **Type consistency:** `onSuggest(query: string)` identical in Tasks 1/2 (page's `handleSuggest`); `SearchResult` untouched; `MapHandle` grows `setPreviewRectangle` (T6) then `setPolygon` (T7) — both additive; `BboxDrawHandle.handleMapClick` unchanged signature across T6/T7; `onHover`/`onNavigate` defined only in Task 9 and consumed there.
4. **Review Focus:** all five lines have owning tests — polygon validation matrix (T8 Step 1), guide visibility lifecycle (T1 Step 1 page tests), landmark preservation (T4 Step 1 + full Playwright T10), hover/popup cleanup (T9 Step 1 + existing unmount tests), polygon e2e race (T10 Step 1 wait + T7 deterministic unit tests).
