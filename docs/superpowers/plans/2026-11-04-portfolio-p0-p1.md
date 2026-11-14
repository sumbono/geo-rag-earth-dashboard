# Portfolio P0/P1 Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the six P0/P1 problems from the product-owner audit — app chrome/logout, junk-query confidence gap, recency-caption mislabel, shareable URLs, landing engineering showcase, empty-area explanation — all ranked for the portfolio lens (fullstack + DevOps + architecture showcase).

**Architecture:** Entirely **web-only** (zero API/schema changes): a new `AppHeader` (wordmark/GitHub/Share/Log out) on the dashboard; a `mode` prop on `ResultsPanel` ("ranked" | "recency") driving a weak-match banner and a mode-correct caption; an optional `hint` on `EmptyState` for spatial misses; a landing "How it's built" band built from CSS chips (CSP forbids external badge images); and a pure `lib/urlState.ts` (encode/parse `?q=&bbox=&tile=`) with `history.replaceState` sync plus a Share button. Bbox restore rides a new optional `runBbox` method on `BboxDrawHandle`.

**Tech Stack:** Next.js App Router (client components), MapLibre handles already on the page, vitest + Testing Library, `next/navigation` `useRouter` (same pattern as `AuthGuard`/`login`).

**Spec:** `/home/bono/portfolio/geo-product-audit-2026-11-04/product-owner-audit.md` (§3 problems 1–6, §4 F1/F4). Repo at `/home/bono/portfolio/geo-rag-earth-dashboard`; implement from a branch cut at `main` (post PRs #5/#6 and the ops fix).

**Planning date:** 2026-11-04. **Plan file follows this repo's convention** (`docs/superpowers/plans/YYYY-MM-DD-*.md` — see `2026-10-08-ui-redesign.md`).

## Global Constraints

- Web-only: no FastAPI, no DB, no migration, no new npm dependencies.
- Design system: `var(--color-*)` / `var(--space-*)` tokens only; no raw hex; classes `button` / `button--ghost` / `button--primary`.
- CSP constraint: `img-src` allows only self + ESRI + OSM — **no external badge/shield images**; badges are text/CSS chips; GitHub links are `href`s.
- URL sync uses `history.replaceState` only (never `pushState` — Back must not walk search states).
- Mode derivation (shared by Tasks 2 and 3): `mode = currentQuery !== "" ? "ranked" : "recency"` — text/suggestion searches set `currentQuery` via `handleSearchStart`; bbox-only draws do not (verified: `handleBboxResults` never touches `currentQuery`).
- Test floors after every task: `npx vitest run`, `npx tsc --noEmit`, `npx eslint .` (0 errors, **54** pre-existing warnings — re-baselined by triple-pass verification 2026-11-04).
- Router mocks: `vitest.setup.ts` gains a global `vi.mock("next/navigation", …)` (Task 1) — `AppHeader.useRouter` throws in Next 15 without router context, and 8 suites render `DashboardPage` unmocked today (they pass only because nothing in the unit-test tree calls `useRouter` — `AuthGuard` lives in `dashboard/layout.tsx`, which tests bypass). File-level mocks in `authguard.test.tsx`/`login.test.tsx` keep precedence over the setup mock.
- Logout semantics: `POST /api/auth/logout` (clears refresh row + cookies server-side) **then** `router.replace("/login")` — on POST failure still route to login (session may already be dead).
- Demo creds stay public; no auth-model changes.

## Review Focus (failure modes the spec implies, pinned to owning tasks)

1. **URL restore loops / double-fires.** A `?q=` restore must run the search exactly once and `replaceState` must not re-trigger the restore effect. → Task 5 pins a run-once ref guard and asserts a single `POST /api/search/vector`.
2. **Bbox restore double-fire.** Restoring `?bbox=` draws the rectangle AND searches exactly once — `mapRef.setRectangle` is visual only; the search comes solely from `runBbox`. → Task 5 test asserts one `POST /api/search/bbox`.
3. **Weak-match false alarms.** A legitimate-but-hard query must get an *invitation* to refine, not a failure verdict — and the floor must sit in the observed band: junk tops **0.27**, the good on-theme query tops **0.30** (audit §3 evidence), so `WEAK_MATCH_FLOOR = 0.28` (strictly above junk, ≤ good). → Task 2 tests pin 0.27 → banner, **0.30 → no banner (good-query regression pin)**, 0.45 → no banner, recency → suppressed.
4. **Clipboard availability.** `navigator.clipboard` can be absent (insecure context/jsdom). → Task 5: optional chaining + visible fallback status showing the URL.
5. **Share/restore must not break existing counts.** `replaceState` adds no fetches; restore adds fetches only when params exist. → Task 5 tests: no params → zero extra requests; `?q=` → exactly one search POST.

---

### Task 1: App header with Share slot + Log out (P0-1)

**Files:**
- Create: `apps/web/components/AppHeader.tsx`
- Create: `apps/web/__tests__/app-header.test.tsx`
- Modify: `apps/web/vitest.setup.ts` (global `next/navigation` mock — see Step 0)
- Modify: `apps/web/app/dashboard/page.tsx` (render header above `<SearchBar>`)
- Modify: `apps/web/app/globals.css` (`.dash-header` layout)

**Interfaces:**
- Consumes: `apiFetch` from `lib/api`; `useRouter` from `next/navigation` (pattern: `AuthGuard.tsx`, `login/page.tsx:17,33`).
- Produces: `<AppHeader />` with optional `onShare?: () => void`: wordmark link `Geo-RAG Earth Dashboard` → `/`, GitHub link → `https://github.com/sumbono/geo-rag-earth-dashboard`, `Share` ghost button (rendered only when `onShare` provided — Task 5 wires it), `Log out` ghost button.

- [ ] **Step 0: Global router mock (required before AppHeader renders anywhere).** Next 15's `useRouter()` throws "invariant expected app router to be mounted" without context, and **8 suites render `DashboardPage` unmocked today** (search_ui, bbox_draw, dashboard-styles, detail_panel, guidance, interactive-info, telemetry_chart, view3d — they pass only because nothing in that tree calls `useRouter` yet; `AuthGuard` lives in `dashboard/layout.tsx`, which unit tests bypass). Add to `apps/web/vitest.setup.ts` (existing file-level mocks in `authguard.test.tsx`/`login.test.tsx` keep precedence over the setup mock):

```ts
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/dashboard",
  useSearchParams: () => new URLSearchParams(),
}));
```

(`vitest.setup.ts` needs `import { vi } from "vitest";` if not already imported.) **Verify immediately:** `npx vitest run` → all 119 existing tests still green — the first full run after this step is the conflict check (file-level vs setup-level mock coexistence).

- [ ] **Step 1: Write the failing test** (`apps/web/__tests__/app-header.test.tsx`):

```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
}));

import AppHeader from "../components/AppHeader";

describe("AppHeader (P0 chrome)", () => {
  beforeEach(() => replace.mockClear());

  it("renders wordmark link home, GitHub link, and logout button", () => {
    render(<AppHeader />);
    expect(screen.getByRole("link", { name: /geo-rag earth dashboard/i })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "GitHub" })).toHaveAttribute(
      "href",
      "https://github.com/sumbono/geo-rag-earth-dashboard",
    );
    expect(screen.getByRole("button", { name: "Log out" })).toBeInTheDocument();
  });

  it("POSTs /api/auth/logout then routes to /login", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    render(<AppHeader />);
    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/auth/logout",
        expect.objectContaining({ method: "POST", credentials: "include" }),
      ),
    );
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
    vi.unstubAllGlobals();
  });

  it("still routes to /login when the logout POST fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    render(<AppHeader />);
    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Run to verify failure:** `npx vitest run __tests__/app-header.test.tsx` → FAIL (module not found).
- [ ] **Step 3: Implement `AppHeader.tsx`:**

```tsx
"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch } from "../lib/api";

export default function AppHeader({ onShare }: { onShare?: () => void }) {
  const router = useRouter();
  async function handleLogout() {
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
    } catch {
      // session may already be dead — route to login either way
    }
    router.replace("/login");
  }
  return (
    <header className="dash-header">
      <Link href="/" className="dash-header__brand">Geo-RAG Earth Dashboard</Link>
      <nav className="dash-header__actions">
        <a className="button button--ghost" href="https://github.com/sumbono/geo-rag-earth-dashboard">GitHub</a>
        {onShare && (
          <button type="button" className="button button--ghost" data-testid="share-button" onClick={onShare}>
            Share
          </button>
        )}
        <button type="button" className="button button--ghost" onClick={handleLogout}>Log out</button>
      </nav>
    </header>
  );
}
```

- [ ] **Step 4: Wire + style:** dashboard `page.tsx` — render `<AppHeader />` immediately above `<SearchBar …>` inside `<main>`; `globals.css`:

```css
.dash-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-sm);
  margin-bottom: var(--space-2xs);
}
.dash-header__actions { display: flex; gap: var(--space-2xs); align-items: center; }
```

- [ ] **Step 5: Full gates:** `npx vitest run && npx tsc --noEmit && npx eslint .` → green.
- [ ] **Step 6: Commit:** `git add apps/web && git commit -m "feat: app header with logout (P0 chrome)"`.

---

### Task 2: Mode-aware results framing — weak-match banner + recency caption (P0-2 + P1-5)

**Files:**
- Modify: `apps/web/components/ResultsPanel.tsx` (new `mode` prop, banner, caption switch)
- Modify: `apps/web/app/dashboard/page.tsx` (derive + pass `mode`)
- Modify: `apps/web/app/globals.css` (`.weak-match` styles — tokens only)
- Modify: `apps/web/__tests__/results-panel.test.tsx`

**Interfaces:**
- Consumes: `SearchResult[]`; page state `currentQuery` (`""` ⇒ recency).
- Produces: `ResultsPanelProps.mode?: "ranked" | "recency"` (default `"ranked"` — existing renders stay valid). Ranked + `results[0].score < WEAK_MATCH_FLOOR` → `<p role="status" data-testid="weak-match-notice">Low-confidence matches (top {results[0].score.toFixed(2)}) — this query may be outside the indexed imagery. Try describing a scene, e.g. “turquoise water near a reef”.</p>`; recency → caption `Newest first in this area — no text query yet.` and no notice (scores are not cosine). `const WEAK_MATCH_FLOOR = 0.28;` module const — **calibrated to the observed band**: junk-query tops 0.27, the good on-theme query tops 0.30 (audit evidence), so the floor sits strictly above junk and at/below good (`0.27 < 0.28 ≤ 0.30`); the dataset is a fixed 100-chip sample, so a data-pinned constant is defensible — keep the tuning rationale in the const's comment.

- [ ] **Step 1: Failing tests** (append to `results-panel.test.tsx`):

```tsx
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
```

- [ ] **Step 2: Run → FAIL.** `npx vitest run __tests__/results-panel.test.tsx`
- [ ] **Step 3: Implement:** `mode` prop default `"ranked"`; caption switches on mode; banner after the caption `<p>` when `mode === "ranked" && results.length > 0 && results[0].score < WEAK_MATCH_FLOOR`, copy interpolating `results[0].score.toFixed(2)` (never raw float); `.weak-match` CSS in `globals.css` with `var(--color-ink-soft)` + `var(--space-2xs)` tokens. Page passes `mode={currentQuery !== "" ? "ranked" : "recency"}`.
- [ ] **Step 4: Re-run tests + full gates** → green.
- [ ] **Step 5: Commit:** `git commit -am "feat: weak-match notice and mode-aware results caption"`.

---

### Task 3: Empty-area explanation hint (P1-6)

**Files:**
- Modify: `apps/web/components/EmptyState.tsx` (optional `hint?: string`)
- Modify: `apps/web/app/dashboard/page.tsx` (pass hint when spatial)
- Create: `apps/web/__tests__/empty-state.test.tsx`

**Interfaces:**
- Consumes: same `mode` derivation as Task 2 (`currentQuery === ""` after a spatial-only search).
- Produces: `EmptyStateProps.hint?: string` → `<p data-testid="empty-hint">{hint}</p>` above suggestions (heading unchanged); dashboard passes `currentQuery === "" ? "Nothing indexed in this area — the dashed outline on the map shows what's searchable." : undefined`.

- [ ] **Step 1: Failing test** (new file):

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import EmptyState from "../components/EmptyState";

describe("EmptyState hint (P1)", () => {
  it("shows the coverage hint when provided", () => {
    render(<EmptyState onSuggest={() => {}} hint="Nothing indexed in this area" />);
    expect(screen.getByTestId("empty-hint")).toHaveTextContent("Nothing indexed in this area");
  });
  it("renders plain suggestions without a hint by default", () => {
    render(<EmptyState onSuggest={() => {}} />);
    expect(screen.queryByTestId("empty-hint")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run → FAIL.** **Step 3: Implement** optional prop + conditional `<p data-testid="empty-hint">` (tokens: `var(--color-ink-soft)`, `var(--text-sm)`). **Step 4: Page wiring** at the `searched ? (loading ? null : <EmptyState …>)` branch (`dashboard/page.tsx:273-276` — verified by triple-pass; the hint rides inside EmptyState so the Issue-8 loading gate prevents any mid-flight flash).
- [ ] **Step 5: Gates → green; commit:** `git commit -am "feat: empty-area hint ties zero-results to the coverage outline"`.

---

### Task 4: Landing engineering band (P0-3)

**Files:**
- Modify: `apps/web/app/page.tsx` (new `<section>` between `.hero` (closes ~line 74) and `.preview` (line ~77))
- Modify: `apps/web/app/globals.css` (`.stack` band + `.stack__chips` + `.stack__chip`)
- Modify: `apps/web/__tests__/landing.test.tsx`

**Interfaces:**
- Consumes: nothing (copy + links only).
- Produces: `<section aria-label="How it's built">` with pitch `Built end-to-end — FastAPI · PostGIS + pgvector · RemoteCLIP embeddings · Next.js · MapLibre GL · Docker · GitHub Actions`, `<div data-testid="stack-chips">` with chips `PostGIS/pgvector`, `RemoteCLIP`, `FastAPI`, `Next.js`, `MapLibre`, `Docker`, `CI + ~250 tests`, and `<a href={repo}>Source & architecture →</a>`. **No external images** (CSP). HTML comment reserves a demo-video slot for the owner's future asset.

- [ ] **Step 1: Failing test** (append to `landing.test.tsx`):

```tsx
it("shows the engineering band (P0 showcase)", () => {
  render(<Page />);
  const chips = screen.getByTestId("stack-chips");
  expect(chips).toHaveTextContent("PostGIS/pgvector");
  expect(chips).toHaveTextContent("RemoteCLIP");
  expect(chips).toHaveTextContent("CI + ~250 tests");
  expect(screen.getByRole("region", { name: "How it's built" })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run → FAIL.** **Step 3: Implement section** (dark band echoing `.how` for visual rhythm; chips):

```css
.stack__chips { display: flex; flex-wrap: wrap; gap: var(--space-2xs); }
.stack__chip {
  border: 1px solid var(--color-rule);
  border-radius: var(--radius-control);
  padding: var(--space-2xs) var(--space-xs);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
}
```

- [ ] **Step 4: Gates → green; commit:** `git commit -am "feat: landing engineering band for the 60-second skim"`.

---

### Task 5: URL state + Share (P1-4) — `?q=`, `?bbox=`, `?tile=`

**Files:**
- Create: `apps/web/lib/urlState.ts`
- Create: `apps/web/__tests__/url-state.test.tsx`
- Modify: `apps/web/components/BboxDraw.tsx` (add optional `runBbox?: (bbox: Bbox) => void` to `BboxDrawHandle`)
- Modify: `apps/web/app/dashboard/page.tsx` (restore effect, replaceState sync, `onShare`, share-status `<p role="status">`)
- Modify: `apps/web/__tests__/search_ui.test.tsx` (URL-restore case)

**Interfaces:**
- Consumes: `handleSuggest(q)` (complete text-search path, `page.tsx:182-186`), `mapRef.setRectangle`, `bboxDrawRef`, `selectedId`, `currentQuery`, `results`; `BboxDraw` internal `runSearch(bbox)` (`BboxDraw.tsx:160`).
- Produces (pure):
  - `parseUrlState(search: string): { q?: string; bbox?: [[number, number], [number, number]]; tile?: string }` — tolerant: bad arity / non-finite / malformed percent-encoding ⇒ part omitted, never throws.
  - `buildUrlState(state): string` — `""` or `?q=…&bbox=w,s,e,n&tile=…`; drops empty/null; `encodeURIComponent` on `q`; bbox numbers via `Number.isFinite`.
  - `replaceUrlState(state): void` — `history.replaceState(null, "", buildUrlState(state) || window.location.pathname)`.
  - `BboxDrawHandle.runBbox?(bbox)` — calls internal `runSearch(bbox)` **once** and emits `onRectangle(bbox)` (visual only on the map side; no second search).

- [ ] **Step 1: Failing pure tests** (`__tests__/url-state.test.tsx`):

```ts
import { describe, expect, it } from "vitest";
import { buildUrlState, parseUrlState } from "../lib/urlState";

describe("urlState (P1 shareability)", () => {
  it("round-trips q, bbox and tile", () => {
    const built = buildUrlState({ q: "turquoise water", bbox: [[38, 21], [39, 22]], tile: "abc-123" });
    const parsed = parseUrlState(built);
    expect(parsed.q).toBe("turquoise water");
    expect(parsed.bbox).toEqual([[38, 21], [39, 22]]);
    expect(parsed.tile).toBe("abc-123");
  });

  it("drops absent parts and tolerates garbage", () => {
    expect(buildUrlState({ q: "", bbox: null, tile: null })).toBe("");
    expect(parseUrlState("?bbox=not,numbers")).toEqual({});
    expect(parseUrlState("?bbox=1,2,3")).toEqual({});
    expect(() => parseUrlState("?q=%E0%A4%A")).not.toThrow();
  });
});
```

- [ ] **Step 2: Run → FAIL** (module missing). **Step 3: Implement `lib/urlState.ts`** (~40 lines; `Number.isFinite` guards both directions; parse via `URLSearchParams`).

- [ ] **Step 4: Failing page-level tests.** The `next/navigation` mock comes **globally from `vitest.setup.ts` (Task 1 Step 0)** — no per-file mock needed. Three pins (they cover the two desk-fix behaviors from the 2026-11-05 revision — a fix without a failing test is not verified):

**(a) `?q=` restore — exactly one search.** Append to `search_ui.test.tsx` (existing harness: `stubFetch`, `render(<DashboardPage/>)`, `sampleResults` at :95, submit via `submitQuery` at :117). **URL cleanup goes inside the file's EXISTING `afterEach` at :143** (add one line — `window.history.replaceState(null, "", "/dashboard");` — before the global unstub; do not add a second `afterEach` block). Note the existing afterEach also asserts zero console errors/warnings, so these tests must stay console-clean:

```tsx
it("restores ?q= on mount with exactly one search POST (P1)", async () => {
  window.history.replaceState(null, "", "/dashboard?q=turquoise%20water");
  stubFetch(200, { results: [] });
  render(<DashboardPage />);
  await waitFor(() => {
    const searchCalls = fetchMock.mock.calls.filter(([u]) => String(u).includes("/api/search/vector"));
    expect(searchCalls).toHaveLength(1);
  });
});
```

**(b) Pending-tile APPLY-OR-CLEAR — the 2026-11-05 fix must be pinned both ways.** Hit: restored tile present in first results → detail opens. Miss: restored tile absent from first results → cleared, so a LATER search containing it must NOT open the detail (the uncleared-ref bug this prevents):

```tsx
it("applies the restored tile when first results contain it (P1)", async () => {
  window.history.replaceState(null, "", "/dashboard?q=water&tile=tile-1");
  stubFetch(200, { results: sampleResults }); // sampleResults[0].id = "tile-1"
  render(<DashboardPage />);
  expect(await screen.findByRole("region", { name: "Tile details" })).toBeInTheDocument();
});

it("clears a missing restored tile — a later search containing it never opens the detail (P1)", async () => {
  window.history.replaceState(null, "", "/dashboard?q=water&tile=ghost-id");
  const resp = (body: unknown) =>
    new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  fetchMock
    .mockImplementationOnce(() => Promise.resolve(resp({ results: sampleResults }))) // miss → clear
    .mockImplementationOnce(() =>
      Promise.resolve(resp({ results: [...sampleResults, { ...sampleResults[0], id: "ghost-id" }] })),
    );
  vi.stubGlobal("fetch", fetchMock);
  render(<DashboardPage />);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  submitQuery("reef"); // second search now CONTAINS ghost-id
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  await new Promise((r) => setTimeout(r, 0));
  expect(screen.queryByRole("region", { name: "Tile details" })).not.toBeInTheDocument();
});
```

**(c) Rect-as-state URL sync — the other desk fix** (append to `bbox_draw.test.tsx`, reusing its URL-keyed `stubFetch`, `toggleDraw()`, `drawClick(lon, lat)` helpers exactly as the merge test at :236-256):

```tsx
it("syncs ?bbox= after a completed draw and drops it on disarm (P1)", async () => {
  stubFetch({
    "/api/search/vector": { results: vectorResults },
    "/api/search/bbox": { results: bboxResults },
  });
  render(<DashboardPage />);
  submitQuery("water");
  expect(await screen.findByText("0.88")).toBeInTheDocument();

  toggleDraw();
  drawClick(40, 23);
  drawClick(38, 21);
  // The rect machine normalizes corners to [[w,s],[e,n]] before onRectangle
  // (merge test at :251-255 asserts body [[38,21],[40,23]]) — so lastRect
  // (and the URL) carries 38,21,40,23, not the raw click order.
  await waitFor(() => expect(window.location.search).toContain("bbox=38,21,40,23"));

  // Disarm (toggle off) must clear lastRect STATE → the sync effect rewrites
  // the URL. A ref could never do this (no dep changes) — this pin prevents
  // regressing to the stale-?bbox= bug.
  toggleDraw();
  await waitFor(() => expect(window.location.search).not.toContain("bbox="));
});
```

(Bbox serialization order in (c) is `w,s,e,n` from `[[40,23],[38,21]]` — assert against whatever `buildUrlState` emits for those corners; adjust the literal to the serializer's output on first RED run if the corners normalize differently.) **Also extend `bbox_draw.test.tsx`'s existing `afterEach` (:166) with `window.history.replaceState(null, "", "/dashboard");`** — a failed assertion mid-(c) would otherwise leak `?bbox=` into later tests in that file (the happy path self-cleans only because the disarm step rewrites the URL back to bare `/pathname`).

- [ ] **Step 5: Run → FAIL** (no restore; zero vector calls). **Step 6: Implement page wiring:**

```tsx
// Restore ONCE (run-once ref — Review Focus #1)
const restoredRef = useRef(false);
const pendingTileRef = useRef<string | null>(null); // applied when results land
useEffect(() => {
  if (restoredRef.current) return;
  restoredRef.current = true;
  const s = parseUrlState(window.location.search);
  if (s.q) {
    setQuery(s.q);
    void handleSuggest(s.q);            // complete text-search path
  }
  if (s.bbox) {
    // runBbox emits onRectangle → map draws it; the ONE search POST is runBbox's.
    bboxDrawRef.current?.runBbox?.(s.bbox);
  }
  if (s.tile) pendingTileRef.current = s.tile; // NOT setSelectedId here:
  // handleResults() calls setSelectedId(null) when the restore search lands
  // (page.tsx:110), which would wipe an eagerly-set selection; and a tile-only
  // URL fetches nothing, so selection must wait for results either way.
}, []);
```

  - **Pending-tile application — APPLY-OR-CLEAR (post-revision desk fix):** inside `handleResults(next)` after `setResults(next)`:

```ts
if (pendingTileRef.current !== null) {
  if (next.some((r) => r.id === pendingTileRef.current)) {
    setSelectedId(pendingTileRef.current);
  }
  pendingTileRef.current = null; // clear on MISS too — never stay armed
}
```

    Clearing on a miss is mandatory: an uncleared ref would pop the detail open on some *later, unrelated* search that happens to contain the id. A tile id absent from the restore results is dropped (URL sync then clears it — correct: not in this result set). Tile-only URLs with no `q`/`bbox` fetch nothing and open nothing — documented behavior, not a defect.
  - **Rectangle as STATE, not a ref (post-revision desk fix):** `const [lastRect, setLastRect] = useState<Bbox | null>(null);` — the sync effect must *depend* on the rect so clearing it rewrites the URL. A ref would leave a stale `?bbox=` after disarm (no dep changes → effect never re-runs). Wire: BboxDraw's `onRectangle={(bbox) => { mapRef.current?.setRectangle(bbox); setLastRect(bbox); }}`; `handleToggleRect` disarm branch also calls `setLastRect(null)`.
  - **Sync effect:**

```tsx
useEffect(() => {
  if (!searched) return;
  replaceUrlState({
    q: currentQuery || undefined,
    bbox: lastRect,                      // state — clearing it re-fires this effect
    tile: selectedId,
  });
}, [searched, currentQuery, selectedId, results, lastRect]);
```

  - `BboxDraw`: add `runBbox` via `useImperativeHandle`: `(bbox) => { void runSearch(bbox); onRectangle(bbox); }` — **one** search (restore's `onRectangle` draws the rect and sets `lastRect`; no separate `mapRef.setRectangle` needed).
  - **Share:** dashboard passes `onShare` to AppHeader: `replaceUrlState(currentState)` then `navigator.clipboard?.writeText(window.location.href)` → `shareStatus` state. Render `<p role="status">{shareStatus}</p>` **only when `shareStatus !== null`** — an unconditional status node breaks strict `getByRole("status")` queries in `search_ui.test.tsx:246` and `telemetry_chart.test.tsx:137`, and empty nodes still match. Missing clipboard → `shareStatus = "Copy from the address bar: " + window.location.href` (Review Focus #4). AppHeader stays dumb (it only calls `onShare`).
  - No-params guard: `searched === false` + empty params → sync no-ops, restore no-ops → zero extra fetches (Review Focus #5).

- [ ] **Step 7: Run page test + full gates → green.**
- [ ] **Step 8: Commit:** `git commit -am "feat: shareable URL state (?q/?bbox/?tile) + Share button"`.

---

## Post-implementation checklist

1. Real browser: header shows Log out; junk query (`xyzzy quantum banana telepathy`) shows the low-confidence notice; bbox-only draw shows "Newest first"; far draw with zero results shows the coverage hint; open a copied `?q=` link in a fresh session → exactly one auto-search; Share copies the URL.
2. All suites green in CI on the PR; no API/OpenAPI change (`check-live.sh` still expects 12 paths — unaffected).
3. Landing: engineering band between hero and preview; zero CSP `img-src` violations in console.

## Known deferrals (ledger on execution)

- Polygon URL restore (`?poly=`) — deferred: ring encoding + `runPolygon` exposure for low share-value vs effort.
- Demo video asset — owner records a 60–90 s walkthrough; slot reserved in Task 4's section comment, not built here.
- Architecture depth page (audit F3) — Sprint B, separate plan.

## Triple-pass verification record

Methodology: `/home/bono/portfolio/TRIPLE_PASS_VERIFICATION.md` (adapted for a web-only 5-task plan). Verifier: independent reviewer subagent, 2026-11-04, every check cited file:line against the worktree (baseline re-run: 22 files / 119 tests green, tsc clean, eslint 0 errors / 54 warnings).

- **Pass 1:** mode derivation ✅ (handleSearchStart is the sole writer; blank submits impossible); runBbox ✅ (close-path state reset makes a mount-time restore coherent); router style ✅; CSP claim ✅ (next.config.ts:50 img-src); Task 4 anchors ✅. **Two ❌ defects:** (a) `useRouter` in AppHeader throws in Next 15 without router context → 8 DashboardPage suites break (AuthGuard is in layout.tsx, bypassed by unit tests — the suites pass today only because nothing calls `useRouter` in-tree); (b) `WEAK_MATCH_FLOOR = 0.35` mis-calibrated — the audit's own good-query evidence tops at 0.30, so the banner would fire on every real query.
- **Pass 2:** logout-vs-silent-refresh ✅ (logout deliberately not in NO_SILENT_REFRESH; dead session → catch → replace); bbox-in-URL timing ✅ (ref set before setResults re-fires the effect); role=status vs e2e alert assert ✅; jsdom URL APIs ✅. **Two ❌ defects:** (c) `?tile=` restore dead-on-arrival — `handleResults` calls `setSelectedId(null)` (page.tsx:110), wiping an eager selection; tile-only URLs fetch nothing; (d) unconditional share-status `<p role="status">` breaks strict `getByRole("status")` at search_ui.test.tsx:246 and telemetry_chart.test.tsx:137.
- **Pass 3:** web-only claim ✅ (no API/DB/route changes; check-live's 12 paths untouched); optional-props-only naming ✅ (non-breaking); blast radius 🟡 — `vitest.setup.ts` + 8 suites were undeclared; gate count stale (51→54); stale line anchors; Task 2 missing globals.css in Files.
- **Verdict: solid with four required fixes — all 11 revisions applied to this document:** (1) floor → 0.28 with 0.27/0.30/0.45 pins incl. the good-query regression test; (2) Task 1 Step 0 global router mock + immediate full-suite check; (3) pending-tile handling in `handleResults`; (4) share-status rendered only when set; plus `toFixed(2)` copy, globals.css in Files, anchor 273-276, test rename, afterEach URL cleanup, 54-warnings baseline, and rectangle-clear handling.
- **Second desk check (2026-11-05, of the revisions themselves — the verifier could not review post-revision text):** found and fixed **2 defects introduced by the revision round**: (a) pending-tile ref cleared only on hit — an uncleared `?tile=` would pop the detail open on a later unrelated search → now apply-or-clear on first results completion; (b) rect tracked in a **ref** while the sync effect's deps don't change on clear → stale `?bbox=` after disarm → converted to **state** `lastRect` and added to the effect deps (clearing rewrites the URL). Both verified present in the snippets above; no `lastRectRef` remains anywhere in this document.
- **Third pass (2026-11-14, baseline re-run + TDD-standard gap):** baseline re-verified live — **119/119 tests green**, worktree clean since `1ef1c2a` (the plan's assumed baseline still holds 9 days on; `search_ui` already had `sampleResults` :95, `submitQuery` :117, and an `afterEach` :143 whose URL cleanup the plan now extends instead of adding a second block). Found and closed one remaining gap: **the two 2026-11-05 desk fixes had no pinning tests** (a fix without a failing test is not verified) — Task 5 Step 4 now pins all three: (a) `?q=` restore = exactly one POST, (b) pending-tile apply **and** clear (hit opens; miss-then-later-hit must NOT open — the exact uncleared-ref bug), (c) rect-as-state sync (`?bbox=` appears after draw with the machine's **normalized** corners `38,21,40,23`, disappears on disarm — the exact stale-URL bug). Also corrected the (c) literal to the normalized order the merge test proves.
- **Lowest-risk execution-time check:** the first full `npx vitest run` after Task 1 Step 0 — proves the setup-level router mock coexists with the file-level mocks in `authguard.test.tsx`/`login.test.tsx` (file-level should win).
- **Status: waiting for your approval to proceed** — this plan is never auto-executed.
