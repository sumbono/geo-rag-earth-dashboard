import { expect, test } from "@playwright/test";
import fs from "fs";
import path from "path";

/**
 * Task 24 — asset recording, not a second e2e gate.
 *
 * Produces the repo's README/landing assets from the real compose stack:
 *
 *   - docs/screenshots/landing.png            (landing page with filled slots)
 *   - docs/screenshots/dashboard-with-results.png
 *   - docs/screenshots/detail-panel.png
 *   …each mirrored byte-identically into apps/web/public/screenshots/ (the
 *   landing page's static source) by saveShot() below — regeneration writes
 *   BOTH locations so README and landing can never diverge.
 *   - test-results/gif-frames/*.jpg — an ordered screenshot sequence of the
 *     e2e flow (login → search → detail → bbox → telemetry), assembled into
 *     docs/demo.gif (and mirrored to apps/web/public/demo.gif) by
 *     apps/web/scripts/make_gif.py.
 *
 * Why a screenshot sequence and not Playwright's `video: "on"` → ffmpeg:
 * the videos could not be verified reliably here (frame-order probes of the
 * webm output disagreed with themselves), and the one recording that did
 * decode cleanly still truncated the settled chart out of its tail — the
 * GIF kept ending on "Loading telemetry…". A screenshot per beat is ordered
 * by construction, includes the settled ending, and needs no decoder.
 *
 * CI skips this file: CI's e2e contract is exactly ONE flow
 * (dashboard.spec.ts). This spec is local tooling — regenerate assets with
 * `npx playwright test e2e/recording.spec.ts` against a running stack,
 * then `python apps/web/scripts/make_gif.py`.
 */

const SHOTS_DIR = path.resolve(__dirname, "../../../docs/screenshots");
// The landing page serves the same PNGs from apps/web/public/ — every save
// below copies to both so regeneration can never desync the two mirrors.
const PUBLIC_SHOTS_DIR = path.resolve(__dirname, "../public/screenshots");
const FRAMES_DIR = path.resolve(__dirname, "../test-results/gif-frames");

/** Screenshot to docs/screenshots/ and mirror into apps/web/public/screenshots/. */
async function saveShot(
  page: import("@playwright/test").Page,
  name: string,
  opts: { fullPage?: boolean } = {},
) {
  const dest = path.join(SHOTS_DIR, name);
  await page.screenshot({ path: dest, ...opts });
  fs.mkdirSync(PUBLIC_SHOTS_DIR, { recursive: true });
  fs.copyFileSync(dest, path.join(PUBLIC_SHOTS_DIR, name));
}

test.skip(
  !!process.env.CI,
  "asset-recording spec (Task 24) — local only; dashboard.spec.ts is CI's one e2e flow",
);

test.use({ viewport: { width: 1440, height: 900 } });

/**
 * Capture `page.screenshot` every `intervalMs` until stopped, in numbered
 * order. Screenshots serialize with interactions on the same page, so the
 * sequence reflects real flow order; the runner caps at `max` frames so a
 * slow encoder wait cannot blow the GIF budget.
 */
function startFrameCapture(page: import("@playwright/test").Page) {
  fs.rmSync(FRAMES_DIR, { recursive: true, force: true });
  fs.mkdirSync(FRAMES_DIR, { recursive: true });
  let i = 0;
  let stop = false;
  const MAX_FRAMES = 40;
  const loop = (async () => {
    while (!stop && i < MAX_FRAMES) {
      const buf = await page.screenshot({ type: "jpeg", quality: 80 });
      fs.writeFileSync(
        path.join(FRAMES_DIR, `f${String(i).padStart(3, "0")}.jpg`),
        buf,
      );
      i += 1;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  })();
  return async () => {
    stop = true;
    await loop;
    return i;
  };
}

test("record: login → search → detail → bbox → telemetry (frames + screenshots)", async ({
  page,
}) => {
  const stopCapture = startFrameCapture(page);

  // Same beats as dashboard.spec.ts, plus the two dashboard screenshots.
  await page.goto("/login");
  await page.getByLabel("Username").fill("demo");
  await page.getByLabel("Password").fill("demo-pass-123");
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  const searchInput = page.getByRole("searchbox", { name: "Search" });
  await expect(searchInput).toBeVisible();
  await searchInput.fill("water");
  await page.getByRole("button", { name: "Search", exact: true }).click();

  const results = page.getByRole("list", { name: "Search results" });
  // Generous: a fresh api container cold-loads the encoder on first search.
  await expect(results).toBeVisible({ timeout: 60_000 });
  await expect(results.getByRole("button").first()).toBeVisible();
  // Give the map a beat to fly to the markers before the screenshot.
  await page.waitForTimeout(2_000);
  await saveShot(page, "dashboard-with-results.png");

  await results.getByRole("button").first().click();
  const detail = page.getByRole("region", { name: "Tile details" });
  await expect(detail).toBeVisible();
  await page.waitForTimeout(1_000);
  await saveShot(page, "detail-panel.png");

  // bbox draw (two map clicks) — same relative positions as dashboard.spec.ts
  const drawToggle = page.getByRole("button", { name: "Draw area" });
  await drawToggle.click();
  const canvas = page.locator(".maplibregl-canvas");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const bboxResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/search/bbox") &&
      response.request().method() === "POST",
    { timeout: 60_000 },
  );
  await canvas.click({
    position: { x: box!.width * 0.15, y: box!.height * 0.2 },
  });
  await canvas.click({
    position: { x: box!.width * 0.8, y: box!.height * 0.75 },
  });
  expect((await bboxResponse).ok()).toBe(true);

  // telemetry chart
  await page
    .getByRole("group", { name: "View" })
    .getByRole("button", { name: "Telemetry", exact: true })
    .click();
  await expect(
    page.getByRole("img", { name: /^Telemetry for buoy-rs-1/ }),
  ).toBeVisible({ timeout: 30_000 });

  // Hold on the settled chart so the GIF ends on it, not on "Loading…" —
  // the video writer used to truncate exactly here (see file header).
  await page.waitForTimeout(1_500);

  const frames = await stopCapture();
  console.log(`[recording] captured ${frames} frames → ${FRAMES_DIR}`);
});

test("screenshot: landing page with filled preview slots", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Geo-RAG Earth Dashboard" }),
  ).toBeVisible();
  // The slot image is a local static asset — wait for it so the shot
  // never captures a half-painted preview.
  await page
    .getByTestId("gif-slot")
    .locator("img")
    .waitFor({ state: "visible" });
  await page.waitForTimeout(500);
  await saveShot(page, "landing.png", { fullPage: true });
});
