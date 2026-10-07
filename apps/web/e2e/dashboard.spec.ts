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

test("dashboard: login → search → detail → bbox draw → telemetry chart", async ({
  page,
}) => {
  // R13(b): collect worker-load failures; none may ever fire.
  const workerErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" && msg.text().includes("Worker failed")) {
      workerErrors.push(msg.text());
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
  await page.goto("/login");
  await page.getByLabel("Username").fill("demo");
  await page.getByLabel("Password").fill("demo-pass-123");
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  const searchInput = page.getByRole("searchbox", { name: "Search" });
  await expect(searchInput).toBeVisible();

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
});
