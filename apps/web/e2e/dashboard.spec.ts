import { expect, test } from "@playwright/test";

/**
 * Task 22 — the ONE end-to-end flow, run against the compose stack
 * (fixture-seeded db from `fixtures/seed.sql.gz`, demo creds from
 * `.env.example` / docs: `demo` / `demo-pass-123`):
 *
 *   login → type query → results appear → click first result chip →
 *   detail panel visible → draw bbox (2 map clicks) → telemetry tab shows chart
 *
 * Selectors prefer roles/labels. The map exposes no test ids (app code stays
 * untouched by this task), so the canvas uses MapLibre's own stable
 * `.maplibregl-canvas` class and pixel positions derived from its box.
 *
 * R13(b) additions: the prod bundle must fetch maplibre's worker from the
 * static asset (`/maplibre-gl-worker.mjs`, not the page URL) and actually
 * render the worker-backed GeoJSON layers — result markers after search and
 * the drawn rectangle after a bbox click. The Map component exposes an
 * observational `container.__maplibreMap` handle for the layer queries.
 */

/** Feature count of a GeoJSON circle/fill layer rendered on the real map. */
function layerFeatureCount(page: import("@playwright/test").Page, layer: string) {
  return page.evaluate((layerId) => {
    const el = document.querySelector(".maplibregl-map") as
      | (HTMLDivElement & {
          __maplibreMap?: {
            queryRenderedFeatures: (q: { layers: string[] }) => unknown[];
          };
        })
      | null;
    if (!el?.__maplibreMap) return -1;
    try {
      return el.__maplibreMap.queryRenderedFeatures({ layers: [layerId] }).length;
    } catch {
      // Style/layers not ready yet — keep polling.
      return -1;
    }
  }, layer);
}

/** The proven demo login — shared by every flow in this spec (Task 10). */
async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Username").fill("demo");
  await page.getByLabel("Password").fill("demo-pass-123");
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  const searchInput = page.getByRole("searchbox", { name: "Search" });
  await expect(searchInput).toBeVisible();
}

test("dashboard: login → search → detail → bbox draw → telemetry chart", async ({
  page,
}) => {
  // ── 0. spec §6 security headers as actually delivered on `/` ────────────
  // (web vitest can only see next.config's export; this is the live proof.)
  const home = await page.request.get("/");
  expect(home.ok()).toBe(true);
  const homeHeaders = home.headers();
  expect(homeHeaders["x-frame-options"]).toBe("SAMEORIGIN");
  expect(homeHeaders["x-content-type-options"]).toBe("nosniff");
  expect(homeHeaders["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(homeHeaders["content-security-policy"]).toContain("frame-ancestors 'self'");
  expect(homeHeaders["content-security-policy"]).toContain("default-src 'self'");
  expect(homeHeaders["x-powered-by"]).toBeUndefined();

  // R13(b): collect worker-load failures; none may ever fire.
  const workerErrors: string[] = [];
  // Spec §6: a CSP that actually works — no `Refused to …` violations may
  // appear anywhere in the flow (tiles, worker, hydration, charts).
  const cspViolations: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" && msg.text().includes("Worker failed")) {
      workerErrors.push(msg.text());
    }
    if (msg.type() === "error" && msg.text().includes("Refused to")) {
      cspViolations.push(msg.text());
    }
  });
  // R13(b): the worker must load from the static asset (200), proving the
  // fix — the pre-fix build resolved `new Worker('')` to the page URL and
  // failed with "Worker failed to load".
  const workerLoaded = page.waitForResponse(
    (response) =>
      /\/maplibre-gl-worker\.mjs(\?.*)?$/.test(response.url()) &&
      response.ok(),
    { timeout: 60_000 },
  );

  // ── 1. login (demo credentials) ─────────────────────────────────────────
  await login(page);
  const searchInput = page.getByRole("searchbox", { name: "Search" });

  // ── 2. type a query → ranked results appear ─────────────────────────────
  await searchInput.fill("water");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const results = page.getByRole("list", { name: "Search results" });
  // Generous timeout: the api container may cold-load the encoder on the
  // very first search of a fresh stack (measured ~14s locally, weights
  // fetched inside the container).
  await expect(results).toBeVisible({ timeout: 60_000 });
  await expect(results.getByRole("button").first()).toBeVisible();

  // ── R13(b): worker loaded + result markers actually rendered ────────────
  await workerLoaded;
  // The `results` GeoJSON source only paints through the worker, so a
  // non-empty `result-markers` query after the fly-to is the end-to-end
  // proof that markers/overlays render in the containerized prod build.
  await expect
    .poll(() => layerFeatureCount(page, "result-markers"), { timeout: 30_000 })
    .toBeGreaterThan(0);

  // ── 2b. OSM streets toggle — the APEX tile host must pass the CSP ──────
  // The layer starts visibility:"none", so nothing fetches
  // `https://tile.openstreetmap.org` until this toggle — the original e2e
  // blind spot: a CSP listing only `https://*.tile.openstreetmap.org` blocks
  // the bare apex (wildcards match subdomains, never the apex itself) and
  // the zero-violations assert below never saw it. Click, confirm the
  // aria-pressed state, then let EITHER the first OSM tile response OR a
  // CSP refusal resolve the race; the definitive gate is the end-of-flow
  // `cspViolations` assert — a regression fails it with the refusal text.
  const osmToggle = page.getByRole("button", { name: "OSM streets" });
  await expect(osmToggle).toHaveAttribute("aria-pressed", "false");
  await osmToggle.click();
  await expect(osmToggle).toHaveAttribute("aria-pressed", "true");
  await Promise.race([
    page
      .waitForResponse(
        (response) => response.url().includes("tile.openstreetmap.org"),
        { timeout: 20_000 },
      )
      .catch(() => undefined), // host slow/unreachable ≠ CSP defect
    (async () => {
      while (cspViolations.length === 0) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    })(),
  ]);

  // ── 3. click the first result chip → detail panel visible ───────────────
  await results.getByRole("button").first().click();
  const detail = page.getByRole("region", { name: "Tile details" });
  await expect(detail).toBeVisible();
  await expect(detail.getByRole("heading", { name: "Tile details" })).toBeVisible();
  await expect(detail.getByRole("button", { name: "Close" })).toBeVisible();

  // ── 4. draw a bbox: arm the tool, two clicks on the map ─────────────────
  const drawToggle = page.getByRole("button", { name: "Draw area" });
  await drawToggle.click();
  await expect(drawToggle).toHaveAttribute("aria-pressed", "true");
  const canvas = page.locator(".maplibregl-canvas");
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  // Relative positions keep the clicks deterministic across viewports and
  // clear of the centre (fly-to marker + popup) and the OSM toggle (top-right).
  const cornerA = { x: box!.width * 0.15, y: box!.height * 0.2 };
  const cornerB = { x: box!.width * 0.8, y: box!.height * 0.75 };
  const bboxResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes("/api/search/bbox") &&
      response.request().method() === "POST",
    { timeout: 60_000 },
  );
  await canvas.click({ position: cornerA });
  await expect(
    page.getByRole("status").filter({ hasText: "Corner A" }),
  ).toBeVisible();
  await canvas.click({ position: cornerB });
  const bboxResponse = await bboxResponsePromise;
  expect(bboxResponse.ok()).toBe(true);
  // A completed draw disarms the tool, and nothing surfaced an error.
  // Scoped to <main>: Next's route announcer (#__next-route-announcer__) is a
  // permanent visually-hidden role=alert outside the app's own error <p>s.
  await expect(drawToggle).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
  // R13(b): the drawn search rectangle is GeoJSON too — it must render
  // (pre-fix it never did; both layers share the broken worker path).
  await expect
    .poll(() => layerFeatureCount(page, "draw-rectangle"), { timeout: 30_000 })
    .toBeGreaterThan(0);

  // ── 5. telemetry tab shows the chart ────────────────────────────────────
  await page
    .getByRole("group", { name: "View" })
    .getByRole("button", { name: "Telemetry", exact: true })
    .click();
  const chart = page.getByRole("img", { name: /^Telemetry for buoy-rs-1/ });
  await expect(chart).toBeVisible({ timeout: 30_000 });
  // The D3 line path must actually carry geometry, not just exist.
  await expect(page.locator(".telemetry-chart__line")).toHaveAttribute(
    "d",
    /.{10,}/,
  );

  // R13(b): no "Worker failed to load" may have been logged anywhere in the flow.
  expect(workerErrors).toEqual([]);
  // Spec §6: the security headers never broke the app — no CSP refusal
  // (script/style/img/connect/worker) was logged across the whole flow.
  expect(cspViolations).toEqual([]);
});

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
