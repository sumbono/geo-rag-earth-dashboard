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
 */
test("dashboard: login → search → detail → bbox draw → telemetry chart", async ({
  page,
}) => {
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
});
