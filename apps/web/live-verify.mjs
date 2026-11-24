/**
 * Live browser verification of geo.sumbono.dev (untracked ops script).
 * Real Chromium against the PROD site: landing copy, demo login, search,
 * Phase-1 affordances (rank/caption/export/coverage layer/sim-note/chart),
 * detail panel, bbox + polygon draws, console/CSP/worker health.
 * Screenshots + downloaded files land in $LIVE_VERIFY_OUT.
 *
 * Run: node apps/web/live-verify.mjs
 */
import { chromium } from "playwright";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

const BASE = "https://geo.sumbono.dev";
const OUT = process.env.LIVE_VERIFY_OUT;
if (!OUT) throw new Error("set LIVE_VERIFY_OUT to a screenshots directory");

const results = [];
function check(name, ok, extra = "") {
  results.push({ name, ok, extra });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);
}

function layerFeatureCount(page, layer) {
  return page.evaluate((layerId) => {
    const el = document.querySelector(".maplibregl-map");
    if (!el?.__maplibreMap) return -1;
    try {
      return el.__maplibreMap.queryRenderedFeatures({ layers: [layerId] }).length;
    } catch {
      return -1;
    }
  }, layer);
}

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await context.newPage();

const consoleErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));

// Install BEFORE any navigation: both fire at map mount (dashboard load),
// which happens during the login step — a later listener misses them even
// when the requests succeed (the rendered layers prove that).
const coverageResponse = page
  .waitForResponse((r) => r.url().includes("/api/coverage") && r.ok(), { timeout: 60_000 })
  .catch(() => null);
const workerLoaded = page
  .waitForResponse((r) => /\/maplibre-gl-worker\.mjs(\?.*)?$/.test(r.url()) && r.ok(), { timeout: 60_000 })
  .catch(() => null);

try {
  // ── 1. Landing ────────────────────────────────────────────────────────────
  const home = await page.goto(BASE + "/", { waitUntil: "networkidle" });
  check("landing: 200", home.status() === 200, `status ${home.status()}`);
  const html = await page.content();
  check("landing: honest scope copy", html.includes("100 Sentinel-2 chips"));
  check("landing: relative-score copy", html.includes("relative to your query"));
  check("landing: no old absolute-score copy", !/1\.00\s*near-exact/i.test(html));
  check("landing: demo creds card", html.includes("demo-pass-123"));
  await page.screenshot({ path: path.join(OUT, "01-landing.png"), fullPage: true });

  // ── 2. Login ──────────────────────────────────────────────────────────────
  await page.goto(BASE + "/login");
  await page.getByLabel("Username").fill("demo");
  await page.getByLabel("Password").fill("demo-pass-123");
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await page.waitForURL(/\/dashboard$/, { timeout: 30_000 });
  await page.getByRole("searchbox", { name: "Search" }).waitFor({ state: "visible" });
  check("login: demo session reaches dashboard", true);
  await page.screenshot({ path: path.join(OUT, "02-dashboard-first-run.png") });

  // First-run guide (relative-score rewrite lives here too)
  const guideHtml = await page.content();
  check("dashboard: guide relative-score copy", guideHtml.includes("relative to your query"));
  check("dashboard: guide has no 1.00/0.00 framing", !/1\.00 is a near-exact/i.test(guideHtml));

  // ── 3. Search ─────────────────────────────────────────────────────────────
  const searchInput = page.getByRole("searchbox", { name: "Search" });
  await searchInput.fill("turquoise coastal water");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const resultsList = page.getByRole("list", { name: "Search results" });
  await resultsList.waitFor({ state: "visible", timeout: 60_000 });
  check("search: results list appears", true);

  // Phase 1 — ranks + caption + export toolbar
  const firstRow = page.getByTestId("result-row").first();
  check("phase1: rank #1 on first row", (await firstRow.textContent())?.startsWith("#1") ?? false);
  const caption = page.getByTestId("score-caption");
  check("phase1: relative-similarity caption", (await caption.textContent())?.includes("Relative similarity") ?? false);
  const toolbar = page.getByTestId("results-toolbar");
  check("phase1: export toolbar visible", await toolbar.isVisible());

  // GeoJSON download
  const [geojsonDownload] = await Promise.all([
    page.waitForEvent("download", { timeout: 15_000 }),
    page.getByTestId("export-geojson").click(),
  ]);
  const geojsonPath = path.join(OUT, geojsonDownload.suggestedFilename());
  await geojsonDownload.saveAs(geojsonPath);
  const fc = JSON.parse(await readFile(geojsonPath, "utf8"));
  const okGeojson =
    fc.type === "FeatureCollection" &&
    Array.isArray(fc.features) &&
    fc.features.length > 0 &&
    fc.features[0].geometry?.type === "Polygon" &&
    Array.isArray(fc.features[0].geometry.coordinates?.[0]?.[0]);
  check("phase1: GeoJSON download is valid FeatureCollection", okGeojson, `${fc.features?.length} features -> ${geojsonDownload.suggestedFilename()}`);

  // CSV download
  const [csvDownload] = await Promise.all([
    page.waitForEvent("download", { timeout: 15_000 }),
    page.getByTestId("export-csv").click(),
  ]);
  const csvPath = path.join(OUT, csvDownload.suggestedFilename());
  await csvDownload.saveAs(csvPath);
  const csv = await readFile(csvPath, "utf8");
  check("phase1: CSV download has header + rows", csv.startsWith("id,score,captured_at") && csv.trim().split("\n").length > 1, `${csv.trim().split("\n").length} lines`);

  // Coverage + markers actually rendered on the live map
  const cov = await coverageResponse;
  check("phase1: /api/coverage fetched 200", cov !== null);
  const deadline = Date.now() + 30_000;
  let covCount = -1;
  while (Date.now() < deadline && covCount <= 0) {
    covCount = await layerFeatureCount(page, "coverage-outline");
    if (covCount <= 0) await page.waitForTimeout(500);
  }
  check("phase1: coverage-outline layer renders on map", covCount > 0, `${covCount} features`);
  const markerDeadline = Date.now() + 30_000;
  let markerCount = -1;
  while (Date.now() < markerDeadline && markerCount <= 0) {
    markerCount = await layerFeatureCount(page, "result-markers");
    if (markerCount <= 0) await page.waitForTimeout(500);
  }
  check("map: result-markers render (worker healthy)", markerCount > 0, `${markerCount} markers`);
  check("map: worker asset loaded", (await workerLoaded) !== null);
  await page.screenshot({ path: path.join(OUT, "03-results-with-ranks-exports-coverage.png") });

  // ── 4. Detail panel ───────────────────────────────────────────────────────
  await firstRow.click();
  const detail = page.getByRole("region", { name: "Tile details" });
  await detail.waitFor({ state: "visible", timeout: 15_000 });
  check("detail: panel opens on row pick", true);
  await page.screenshot({ path: path.join(OUT, "04-detail-panel.png") });
  await detail.getByRole("button", { name: "Close" }).click();

  // ── 5. Bbox draw (two map clicks) ─────────────────────────────────────────
  const drawToggle = page.getByRole("button", { name: "Draw area" });
  await drawToggle.click();
  const canvas = page.locator(".maplibregl-canvas");
  await canvas.waitFor({ state: "visible" });
  const box = await canvas.boundingBox();
  const bboxResponsePromise = page.waitForResponse(
    (r) => r.url().includes("/api/search/bbox") && r.request().method() === "POST",
    { timeout: 60_000 },
  );
  await canvas.click({ position: { x: box.width * 0.15, y: box.height * 0.2 } });
  await page.getByRole("status").filter({ hasText: "Corner A" }).waitFor({ timeout: 10_000 });
  await canvas.click({ position: { x: box.width * 0.8, y: box.height * 0.75 } });
  const bboxRes = await bboxResponsePromise;
  check("draw: bbox search POST 200", bboxRes.status() === 200, `status ${bboxRes.status()}`);
  await page.screenshot({ path: path.join(OUT, "05-after-bbox-draw.png") });

  // ── 6. Polygon draw (3 vertices + Enter) ──────────────────────────────────
  await page.getByRole("button", { name: "Draw polygon" }).click();
  const pbox = await canvas.boundingBox();
  await canvas.click({ position: { x: pbox.width * 0.45, y: pbox.height * 0.4 } });
  await page.getByRole("status").filter({ hasText: /^1 vertex —/ }).first().waitFor({ timeout: 15_000 });
  for (const [fx, fy] of [[0.6, 0.4], [0.55, 0.55]]) {
    await canvas.click({ position: { x: pbox.width * fx, y: pbox.height * fy } });
  }
  const polyPromise = page.waitForResponse((r) => r.url().includes("/api/search/polygon"), { timeout: 60_000 });
  await page.keyboard.press("Enter");
  const polyRes = await polyPromise;
  check("draw: polygon search 200", polyRes.status() === 200, `status ${polyRes.status()}`);
  await page.screenshot({ path: path.join(OUT, "06-after-polygon-search.png") });

  // ── 7. Telemetry tab ──────────────────────────────────────────────────────
  await page.getByRole("group", { name: "View" }).getByRole("button", { name: "Telemetry", exact: true }).click();
  const simNote = page.getByTestId("telemetry-sim-note");
  await simNote.waitFor({ state: "visible", timeout: 15_000 });
  check("phase1: simulated-series label", (await simNote.textContent())?.includes("Simulated demo series") ?? false);
  const chart = page.getByRole("img", { name: /^Telemetry for buoy-rs-1/ });
  await chart.waitFor({ state: "visible", timeout: 30_000 });
  const lineD = await page.locator(".telemetry-chart__line").getAttribute("d");
  check("telemetry: chart line carries geometry (real data)", (lineD?.length ?? 0) >= 10, `path len ${lineD?.length}`);
  await page.screenshot({ path: path.join(OUT, "07-telemetry-chart-live.png") });

  // ── 8. Console health ─────────────────────────────────────────────────────
  const severe = consoleErrors.filter(
    (e) => e.includes("Worker failed") || e.includes("Refused to") || e.startsWith("pageerror"),
  );
  check("console: no worker/CSP/page errors", severe.length === 0, severe.slice(0, 3).join(" | ") || "clean");
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("FAILED:");
  for (const f of failed) console.log(`  - ${f.name}${f.extra ? ` (${f.extra})` : ""}`);
  process.exit(1);
}
