# Design — Geo-RAG Earth Dashboard

A locked design system for this app. Every page redesign reads this file before
emitting code. Do not regenerate per page — extend or amend this file when the
system needs to grow. (Multi-page Hallmark flow: confirmed by the user 2026-10-08.)

## Genre

**modern-minimal** — the dev-tool / instrument-panel register (Stripe / Linear
school). Calm, precise, technical. Declarative copy that names the X concretely;
no hype adjectives (seamless / robust / supercharge are banned words).

## Macrostructure family

One base per page type. Pages within a family share the family's shape; they
vary only in component archetypes.

- **Marketing pages (landing): Workbench (05)** — the product in use is the
  primary content. The walkthrough GIF is the hero proof, not decoration.
  Knobs: hero split ratio, GIF frame width, which of the how-it-works steps
  lead.
- **App pages (dashboard, login): Workbench-family application chrome** —
  toolbar row + main viewport + side panel; tokens carry the system.
  Knobs: panel width (300 px default), tab-strip voice. Login gets a
  centered form card — a tool surface, not a marketing hero (the centered-hero
  ban applies to heroes, not forms).
- **Content pages:** none yet. Add a family here before any docs/about page.

## Theme — Cobalt, brand-teal variant (amendment)

Cobalt's discipline (cool engineered paper, hairlines not shadows, one signal
accent, mono labels, tight radii) with the **accent slot bound to this app's
existing teal** instead of canonical electric blue — the teal predates this
redesign and is the app's identity. Recorded as a theme amendment: future
Cobalt features (code-as-hero, status chips) use the teal signal.

- `--color-paper`       `oklch(98.5% 0.004 250)` — cool near-white ground, never `#fff`
- `--color-paper-2`     `oklch(99.3% 0.002 250)` — raised surface (cards, inputs)
- `--color-ink`         `oklch(24% 0.02 258)` — cool charcoal, never `#000`
- `--color-ink-2`       `oklch(34% 0.018 257)` — body copy
- `--color-ink-soft`    `oklch(52% 0.015 257)` — secondary text
- `--color-rule`        `oklch(90% 0.006 250)` — the 1px hairline that does all structural work
- `--color-rule-2`      `oklch(85% 0.008 250)` — stronger hairline (focusable surfaces)
- `--color-accent`      `#0b6f8f` ≈ `oklch(46% 0.10 221)` — **the teal signal** (< 5% of any viewport: links/hover, focus rings, the one primary button, active states, `200 OK` chips)
- `--color-accent-strong` `#08556e` — hover/pressed
- `--color-accent-soft` `#e3f2f7` — rare wash (selected-row tint only)
- `--color-accent-ink`  `oklch(99% 0.004 245)` — text on accent fills
- `--color-danger`      `#b42318` ≈ `oklch(51% 0.19 24)` — **the only red** (replaces both legacy reds)
- `--color-focus`       = `--color-accent`
- `--color-graphite`    `oklch(22% 0.016 260)` — the one dark band's ground
- `--color-graphite-ink` `oklch(92% 0.01 250)` — text on graphite
- `--color-graphite-rule` `oklch(35% 0.015 260)` — hairlines on graphite

## Typography

- **Display:** Space Grotesk, weight 500–600, tracking `-0.02em` … `-0.03em`, roman always (italic headings banned)
- **Body:** Inter, weight 400–500
- **Mono:** JetBrains Mono, weight 400–500 — UPPERCASE labels at `0.06em`
  tracking (eyebrows, status, kbd hints) **and all data values** (scores,
  coordinates, timestamps, credentials) with `font-variant-numeric: tabular-nums`
- Loaded via `next/font/google` — three families, variables
  `--font-display-local`, `--font-body-local`, `--font-mono-local`
  *(amendment: plan's "two font families" widened to three — mono is Cobalt's
  label voice; user-confirmed 2026-10-08)*
- Type scale: `--text-display: clamp(2.5rem, 5vw + 0.5rem, 4.75rem)`,
  `--text-2xl: clamp(1.75rem, 3vw, 2.5rem)`, `--text-xl: 1.5rem`,
  `--text-lg: 1.25rem`, `--text-md: 1.125rem`, `--text-base: 1rem`,
  `--text-sm: 0.875rem`, `--text-xs: 0.75rem`

## Spacing

4-point named scale (`--space-3xs: 0.25rem` … `--space-3xl: 7rem` per the
token block). Pages use named tokens, never raw values. Section rhythm: one
dark graphite band per marketing page, `--space-3xl` between major bands.

## Motion

- `--ease-out: cubic-bezier(0.16, 1, 0.3, 1)` — the only easing for UI state
- Durations: `--dur-fast: 150ms`, `--dur-base: 220ms`, reveal `600ms`
- Reveal pattern: one IntersectionObserver, `.reveal` fade + 10px rise, once
- No bounce, no parallax, no autoplay; `prefers-reduced-motion` ships static
- Focus rings appear **instantly**, never animated

## Microinteractions stance

- Silent success (no "Done!" toasts); toasts only for failures
- Hover delay 800 ms · focus delay 0 ms on tooltips
- Optimistic + Undo over confirmations; modals only for irreversible actions
- Loading: delay-show 150 ms, min visible 300 ms; skeletons where layout is known

## CTA voice

- **Primary:** solid `--color-accent` fill, **6px radius**, `--color-accent-ink`
  label, verb-first ("Explore the map", "Log in")
- **Secondary:** typographic or hairline-outline in ink — never a second solid
- No pills on buttons (pills belong to Coral); no gradients, ever

## Known omissions (deliberate)

- **⌘K command palette — deferred.** Canonical Cobalt ships a working palette
  behind a nav ⌘K affordance; a dead affordance is worse than none, so this
  system's bordered nav omits ⌘K until the palette is actually built.
  Amend this file when/if it ships.

## What pages MUST share

- The wordmark/lockup and this accent teal, ≤ 5% per viewport
- Space Grotesk + Inter + JetBrains Mono
- 6px control radius / 10px card radius (replaces the legacy 14px)
- Hairline structure (`--color-rule`) — **no drop-shadow cards** beyond
  `0 1px 2px` on the one raised surface
- Danger red = `--color-danger` only; mono tabular data values
- Stamp: `/* Hallmark · genre: modern-minimal · macrostructure: <name> ·
  design-system: design.md · designed-as-app */`

## What pages MAY differ on

- Macrostructure within the family (hero split, panel width, band order)
- Hero/workbench archetype details
- Marketing pages only: one dark graphite band; app pages never

## Exports

### tokens.css (canonical — consumed by `apps/web`)

```css
:root {
  --color-paper: oklch(98.5% 0.004 250);
  --color-paper-2: oklch(99.3% 0.002 250);
  --color-ink: oklch(24% 0.02 258);
  --color-ink-2: oklch(34% 0.018 257);
  --color-ink-soft: oklch(52% 0.015 257);
  --color-rule: oklch(90% 0.006 250);
  --color-rule-2: oklch(85% 0.008 250);
  --color-accent: #0b6f8f;
  --color-accent-strong: #08556e;
  --color-accent-soft: #e3f2f7;
  --color-accent-ink: oklch(99% 0.004 245);
  --color-danger: #b42318;
  --color-focus: #0b6f8f;
  --color-graphite: oklch(22% 0.016 260);
  --color-graphite-ink: oklch(92% 0.01 250);
  --color-graphite-rule: oklch(35% 0.015 260);

  --font-display: var(--font-display-local), "Space Grotesk", sans-serif;
  --font-body: var(--font-body-local), "Inter", sans-serif;
  --font-mono: var(--font-mono-local), ui-monospace, monospace;

  --space-3xs: 0.25rem; --space-2xs: 0.5rem; --space-xs: 0.75rem;
  --space-sm: 1rem; --space-md: 1.5rem; --space-lg: 2rem;
  --space-xl: 3rem; --space-2xl: 4.5rem; --space-3xl: 7rem;

  --text-display: clamp(2.5rem, 5vw + 0.5rem, 4.75rem);
  --text-2xl: clamp(1.75rem, 3vw, 2.5rem);
  --text-xl: 1.5rem; --text-lg: 1.25rem; --text-md: 1.125rem;
  --text-base: 1rem; --text-sm: 0.875rem; --text-xs: 0.75rem;

  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --dur-fast: 150ms; --dur-base: 220ms; --dur-reveal: 600ms;
  --radius-control: 6px; --radius-card: 10px;
  --rule: 1px solid var(--color-rule);
}
```

Tailwind / DTCG / shadcn mappings: generate on request from these values
(project uses plain CSS — no consumer exists yet).
