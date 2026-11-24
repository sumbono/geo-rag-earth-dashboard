/**
 * Probe 2 — targeted: (1) does a nonsense query resolve or hang? (2) a TRUE
 * empty-bbox draw (high zoom, tile-free area); (3) vector-search latency.
 */
import { chromium } from "playwright";
import path from "node:path";

const BASE = "https://geo.sumbono.dev";
const OUT = process.env.PLAY_OUT;
const notes = [];
const note = (c, t) => { notes.push(`[${c}] ${t}`); console.log(`[${c}] ${t}`); };

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();

try {
  await page.goto(BASE + "/login");
  await page.getByLabel("Username").fill("demo");
  await page.getByLabel("Password").fill("demo-pass-123");
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await page.waitForURL(/\/dashboard$/);
  await page.getByRole("searchbox", { name: "Search" }).waitFor();

  // ── (3) latency of a normal search ────────────────────────────────────────
  const search = page.getByRole("searchbox", { name: "Search" });
  await search.fill("ship wake on dark water");
  const req = page.waitForResponse((r) => r.url().includes("/api/search/vector") && r.request().method() === "POST", { timeout: 60_000 });
  const t0 = Date.now();
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const res = await req;
  note("latency", `vector search POST → ${res.status()} in ${Date.now() - t0}ms`);
  await page.getByRole("list", { name: "Search results" }).waitFor({ timeout: 60_000 });

  // ── (1) nonsense query, watch the actual response ─────────────────────────
  await search.fill("xyzzy quantum banana telepathy");
  const nreq = page.waitForResponse((r) => r.url().includes("/api/search/vector") && r.request().method() === "POST", { timeout: 90_000 });
  const t1 = Date.now();
  await page.getByRole("button", { name: "Search", exact: true }).click();
  try {
    const nres = await nreq;
    note("weak-query", `nonsense query → HTTP ${nres.status()} in ${Date.now() - t1}ms`);
  } catch {
    note("weak-query", `nonsense query: NO RESPONSE after 90s (hang?) — elapsed ${Date.now() - t1}ms`);
  }
  // Give the UI 5 more seconds to settle, then capture final state
  await page.waitForTimeout(5000);
  const listVisible = await page.getByRole("list", { name: "Search results" }).isVisible().catch(() => false);
  const mainText = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  note("weak-query", `final UI: list=${listVisible}; text=${JSON.stringify(mainText.slice(0, 320))}`);
  if (listVisible) {
    const rows = await page.getByTestId("result-row").allInnerTexts();
    note("weak-query", `rows(${rows.length}): ${rows.slice(0, 4).map((r) => r.replace(/\s+/g, " ")).join(" | ")}`);
  }
  await page.screenshot({ path: path.join(OUT, "b01-nonsense-query-final.png") });

  // ── (2) TRUE empty area: zoom deep into central Asia, small box ───────────
  await page.goto(BASE + "/dashboard");
  await page.getByRole("searchbox", { name: "Search" }).waitFor();
  await page.getByRole("button", { name: "Draw area" }).click();
  const canvas = page.locator(".maplibregl-canvas");
  await canvas.waitFor();
  // Drag-pan far from the Red Sea first, then zoom in (deep inland = no tiles)
  const box = await canvas.boundingBox();
  await canvas.click({ position: { x: box.width * 0.5, y: box.height * 0.5 } }); // arm corner A… then Esc to abort? simpler: use map drag
  await page.keyboard.press("Escape"); // abort draw, use pure pan
  // Pan east ~3 viewports (map drag)
  for (let i = 0; i < 3; i++) {
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.5, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(400);
  }
  await page.mouse.wheel(0, -4000); // zoom IN deep (small ground area)
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: "Draw area" }).click();
  const cbox = await canvas.boundingBox();
  const res2 = page.waitForResponse((r) => r.url().includes("/api/search/bbox") && r.request().method() === "POST", { timeout: 60_000 });
  await canvas.click({ position: { x: cbox.width * 0.4, y: cbox.height * 0.4 } });
  await page.getByRole("status").filter({ hasText: "Corner A" }).waitFor({ timeout: 10_000 }).catch(() => {});
  await canvas.click({ position: { x: cbox.width * 0.55, y: cbox.height * 0.55 } });
  try {
    const r2 = await res2;
    const body = await r2.json().catch(() => null);
    note("empty-draw", `bbox POST → ${r2.status()}, results=${body?.results?.length ?? "?"}`);
  } catch {
    note("empty-draw", "no bbox response in 60s");
  }
  await page.waitForTimeout(1500);
  const emptyText = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  note("empty-draw", `final UI: ${JSON.stringify(emptyText.slice(0, 300))}`);
  await page.screenshot({ path: path.join(OUT, "b02-true-empty-area.png") });
} finally {
  await browser.close();
}
console.log("\n--- NOTES ---");
for (const n of notes) console.log(n);
