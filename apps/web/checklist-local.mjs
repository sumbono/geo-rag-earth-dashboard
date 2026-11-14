/**
 * Post-implementation real-browser checklist (plan DoD #1) against the LOCAL
 * stack (next dev :3000 → uvicorn :8001, seeded fixture DB, real RemoteCLIP).
 * Screenshots → $CHECKLIST_OUT. Run: node apps/web/checklist-local.mjs
 */
import { chromium } from "playwright";
import path from "node:path";

const BASE = "http://127.0.0.1:3000";
const OUT = process.env.CHECKLIST_OUT;
if (!OUT) throw new Error("set CHECKLIST_OUT");

const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok, extra });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);
};

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await context.newPage();
const consoleErrors = [];
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

async function shot(name, opts = {}) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), ...opts });
}

try {
  // 1. Landing engineering band
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  const chips = page.getByTestId("stack-chips");
  check("landing: engineering band chips visible", (await chips.count()) === 1 && (await chips.isVisible()));
  check("landing: stack chip PostGIS", ((await chips.textContent()) ?? "").includes("PostGIS/pgvector"));
  await shot("c01-landing-band", { fullPage: true });

  // 2. Login → header chrome. Warm the dashboard route first: next dev
  // compiles routes on demand and the first compile outlasts waitForURL.
  await page.goto(BASE + "/dashboard", { waitUntil: "load", timeout: 90_000 });
  await page.goto(BASE + "/login");
  await page.getByLabel("Username").fill("demo");
  await page.getByLabel("Password").fill("demo-pass-123");
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await page.waitForURL(/\/dashboard$/, { timeout: 90_000 });
  await page.getByRole("searchbox", { name: "Search" }).waitFor();
  check("dashboard: header Log out visible", await page.getByRole("button", { name: "Log out" }).isVisible());
  check("dashboard: Share visible", await page.getByTestId("share-button").isVisible());
  await shot("c02-dashboard-header");

  // 3. Good search → rank + relative caption
  const vectorCalls = () =>
    page.evaluate(() => performance.getEntriesByType("resource").filter((r) => r.name.includes("/api/search/vector")).length);
  await page.getByRole("searchbox", { name: "Search" }).fill("turquoise coastal water");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("list", { name: "Search results" }).waitFor({ timeout: 60_000 });
  const firstRow = page.getByTestId("result-row").first();
  check("search: rank #1 on first row", ((await firstRow.textContent()) ?? "").startsWith("#1"));
  check("search: relative-similarity caption", ((await page.getByTestId("score-caption").textContent()) ?? "").includes("Relative similarity"));
  await shot("c03-search-ranks");

  // 4. Junk query → weak-match notice (real encoder band: junk ~0.27 < 0.28)
  await page.getByRole("searchbox", { name: "Search" }).fill("xyzzy quantum banana telepathy");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("list", { name: "Search results" }).waitFor({ timeout: 60_000 });
  await page.waitForTimeout(500);
  const notice = page.getByTestId("weak-match-notice");
  const hasNotice = await notice.count();
  const topScore = ((await firstRow.textContent()) ?? "").replace(/\s+/g, " ");
  check("junk query: weak-match notice", hasNotice === 1, hasNotice ? "" : `absent; first row=${topScore}`);
  await shot("c04-junk-weak-match");

  // 5. Fresh dashboard, bbox-only draw over TILES → recency caption.
  // Fit the map to the real coverage footprint first (via the observational
  // __maplibreMap handle) so the drawn box cannot miss the tile strip.
  await page.goto(BASE + "/dashboard");
  await page.getByRole("searchbox", { name: "Search" }).waitFor();
  await page.waitForTimeout(1500);
  const bounds = await page.evaluate(async () => {
    const res = await fetch("/api/coverage", { credentials: "include" });
    const fc = await res.json();
    const ring = fc.features[0].geometry.coordinates[0];
    const lons = ring.map((p) => p[0]);
    const lats = ring.map((p) => p[1]);
    return [
      [Math.min(...lons), Math.min(...lats)],
      [Math.max(...lons), Math.max(...lats)],
    ];
  });
  await page.evaluate((b) => {
    const el = document.querySelector(".maplibregl-map");
    el?.__maplibreMap?.fitBounds(b, { padding: 120, duration: 0 });
  }, bounds);
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: "Draw area" }).click();
  const canvas = page.locator(".maplibregl-canvas");
  await canvas.waitFor();
  const box = await canvas.boundingBox();
  await canvas.click({ position: { x: box.width * 0.4, y: box.height * 0.4 } });
  await page.getByRole("status").filter({ hasText: "Corner A" }).waitFor({ timeout: 15_000 });
  await canvas.click({ position: { x: box.width * 0.6, y: box.height * 0.6 } });
  const list = page.getByRole("list", { name: "Search results" });
  try {
    await list.waitFor({ timeout: 30_000 });
    const caption = (await page.getByTestId("score-caption").textContent()) ?? "";
    check("bbox-only draw: recency caption", caption.includes("Newest first"), caption.slice(0, 60));
    await shot("c05-recency-caption");
  } catch {
    check("bbox-only draw: recency caption", false, "no results list (empty draw)");
    await shot("c05-recency-caption");
  }

  // 6. Empty area → coverage hint (drag to a tile-free ocean area, zoom in)
  await page.goto(BASE + "/dashboard");
  await page.getByRole("searchbox", { name: "Search" }).waitFor();
  await page.getByRole("button", { name: "Draw area" }).click();
  await canvas.waitFor();
  await page.waitForTimeout(1000);
  const b2 = await canvas.boundingBox();
  // drag the map to the South Atlantic, then zoom deep for a small ground box
  await page.mouse.move(b2.x + b2.width * 0.5, b2.y + b2.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(b2.x + b2.width * 0.95, b2.y + b2.height * 0.1, { steps: 15 });
  await page.mouse.up();
  await page.waitForTimeout(600);
  await page.mouse.wheel(0, -3500);
  await page.waitForTimeout(900);
  await canvas.click({ position: { x: b2.width * 0.4, y: b2.height * 0.4 } });
  await page.getByRole("status").filter({ hasText: "Corner A" }).waitFor({ timeout: 15_000 }).catch(() => {});
  await canvas.click({ position: { x: b2.width * 0.5, y: b2.height * 0.5 } });
  try {
    await page.getByTestId("empty-hint").waitFor({ timeout: 20_000 });
    check("empty area: coverage hint", true);
  } catch {
    const main = (await page.locator("main").innerText()).replace(/\s+/g, " ");
    check("empty area: coverage hint", false, main.slice(0, 160));
  }
  await shot("c06-empty-hint");

  // 7. ?q= restore → exactly one vector fetch, results appear.
  // Fresh context has NO session — log in first or AuthGuard bounces to
  // /login before the restore can ever run.
  const ctx2 = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const p2 = await ctx2.newPage();
  await p2.goto(BASE + "/login", { waitUntil: "load", timeout: 90_000 });
  await p2.getByLabel("Username").fill("demo");
  await p2.getByLabel("Password").fill("demo-pass-123");
  await p2.getByRole("button", { name: "Log in", exact: true }).click();
  await p2.waitForURL(/\/dashboard$/, { timeout: 90_000 });
  const vectorFetches = [];
  p2.on("request", (r) => r.url().includes("/api/search/vector") && r.method() === "POST" && vectorFetches.push(r.url()));
  await p2.goto(BASE + "/dashboard?q=turquoise%20water", { waitUntil: "load" });
  await p2.getByRole("list", { name: "Search results" }).waitFor({ timeout: 60_000 });
  await p2.waitForTimeout(800);
  check("restore ?q=: exactly one search POST", vectorFetches.length === 1, `${vectorFetches.length} calls`);
  check("restore ?q=: results visible", (await p2.getByTestId("result-row").count()) > 0);
  await p2.screenshot({ path: path.join(OUT, "c07-restore-q.png") });

  // 8. Share → status text (clipboard exists on secure localhost → "Link copied";
  //    fallback path acceptable too)
  await p2.getByTestId("share-button").click();
  try {
    const status = await p2.getByRole("status").first().textContent({ timeout: 5000 });
    check("Share: status feedback", /copied|address bar/i.test(status ?? ""), (status ?? "").slice(0, 60));
  } catch {
    check("Share: status feedback", false, "no status node");
  }
  await p2.screenshot({ path: path.join(OUT, "c08-share-status.png") });
  await ctx2.close();

  // 9. Log out → /login (last)
  await page.getByRole("button", { name: "Log out" }).click();
  await page.waitForURL(/\/login$/, { timeout: 15_000 });
  check("logout → /login", page.url().includes("/login"));
  await shot("c09-after-logout");

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
