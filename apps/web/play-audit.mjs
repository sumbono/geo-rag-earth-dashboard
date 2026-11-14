/**
 * Product-owner play audit against LIVE geo.sumbono.dev (untracked).
 * Scenario-driven exploration: edges, weak queries, empty states, detail/3D,
 * mobile viewport, perf timings, session/shareability checks.
 * Screenshots + observations go to $PLAY_OUT. Run: node apps/web/play-audit.mjs
 */
import { chromium } from "playwright";
import path from "node:path";

const BASE = "https://geo.sumbono.dev";
const OUT = process.env.PLAY_OUT;
if (!OUT) throw new Error("set PLAY_OUT");

const notes = [];
const note = (cat, text) => {
  notes.push(`[${cat}] ${text}`);
  console.log(`[${cat}] ${text}`);
};

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await context.newPage();
const consoleErrors = [];
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));

async function shot(name, opts = {}) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), ...opts });
}

async function login() {
  await page.goto(BASE + "/login");
  await page.getByLabel("Username").fill("demo");
  await page.getByLabel("Password").fill("demo-pass-123");
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await page.waitForURL(/\/dashboard$/, { timeout: 30_000 });
}

try {
  // ── A. Landing first impression ───────────────────────────────────────────
  const t0 = Date.now();
  await page.goto(BASE + "/", { waitUntil: "load" });
  const nav = await page.evaluate(() => {
    const n = performance.getEntriesByType("navigation")[0];
    return { ttfb: Math.round(n.responseStart), dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd) };
  });
  note("perf", `landing: ttfb=${nav.ttfb}ms dcl=${nav.dcl}ms load=${nav.load}ms (wall ${Date.now() - t0}ms)`);
  const links = await page.evaluate(() =>
    Array.from(document.querySelectorAll("a")).map((a) => ({ text: a.textContent?.trim().slice(0, 40), href: a.getAttribute("href") })),
  );
  note("landing", `links: ${JSON.stringify(links)}`);
  await shot("a01-landing-full", { fullPage: true });

  // ── B. Bad-login UX ───────────────────────────────────────────────────────
  await page.goto(BASE + "/login");
  await page.getByLabel("Username").fill("demo");
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await page.waitForTimeout(1500);
  const errVisible = await page.getByRole("alert").count().catch(() => 0);
  const pageText = await page.locator("main, body").first().innerText();
  note("login-edge", `wrong password → alert count=${errVisible}; text snippet: ${JSON.stringify(pageText.slice(0, 220))}`);
  await shot("a02-login-wrong-password");

  // ── C. Fresh dashboard (first-run) ────────────────────────────────────────
  await login();
  const dashT0 = Date.now();
  await page.getByRole("searchbox", { name: "Search" }).waitFor();
  const t1 = Date.now();
  await login(); // second load for timing warmth
  note("perf", `dashboard interactive after login (warm): ~${Date.now() - t1}ms wait`);

  // Is there a logout control anywhere?
  const logoutCount = await page.getByRole("button", { name: /log ?out/i }).count();
  const logoutLink = await page.getByRole("link", { name: /log ?out/i }).count();
  note("session", `logout control present: buttons=${logoutCount} links=${logoutLink}`);
  const headerHtml = await page.locator("header, nav").first().innerHTML().catch(() => "(no header/nav)");
  note("chrome", `header/nav: ${headerHtml.replace(/\s+/g, " ").slice(0, 300)}`);
  await shot("a03-dashboard-first-run");

  // ── D. Weak/nonsense query behavior ───────────────────────────────────────
  const search = page.getByRole("searchbox", { name: "Search" });
  await search.fill("xyzzy quantum banana telepathy");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const list = page.getByRole("list", { name: "Search results" });
  const weakAppeared = await list.isVisible({ timeout: 60_000 }).catch(() => false);
  if (weakAppeared) {
    const rows = await page.getByTestId("result-row").allInnerTexts();
    note("weak-query", `nonsense query returned ${rows.length} rows; scores shown: ${rows.map((r) => r.replace(/\s+/g, " ")).join(" | ").slice(0, 300)}`);
  } else {
    const empty = await page.locator("main").innerText();
    note("weak-query", `nonsense query → no list; main text: ${JSON.stringify(empty.slice(0, 260))}`);
  }
  await shot("a04-weak-query-nonsense");

  // ── E. Does the URL reflect search state (shareability)? ──────────────────
  note("shareability", `URL after search: ${page.url()}`);

  // ── F. Bbox draw in an empty region (no tiles) → empty state copy ────────
  await page.goto(BASE + "/dashboard");
  await page.getByRole("searchbox", { name: "Search" }).waitFor();
  await page.getByRole("button", { name: "Draw area" }).click();
  const canvas = page.locator(".maplibregl-canvas");
  await canvas.waitFor();
  // Zoom way out first so a far-south Atlantic click has no tiles
  await page.mouse.wheel(0, 6000);
  await page.waitForTimeout(1500);
  const box = await canvas.boundingBox();
  await canvas.click({ position: { x: box.width * 0.2, y: box.height * 0.8 } });
  await page.getByRole("status").filter({ hasText: "Corner A" }).waitFor({ timeout: 10_000 }).catch(() => {});
  await canvas.click({ position: { x: box.width * 0.35, y: box.height * 0.9 } });
  await page.waitForTimeout(2500);
  const mainAfter = await page.locator("main").innerText();
  note("empty-draw", `main text after far draw: ${JSON.stringify(mainAfter.replace(/\s+/g, " ").slice(0, 300))}`);
  await shot("a05-empty-draw-state");

  // ── G. Detail panel interactions (prev/next/false-color) ──────────────────
  await search.fill("coastal water");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("list", { name: "Search results" }).waitFor({ timeout: 60_000 });
  await page.getByTestId("result-row").first().click();
  const detail = page.getByRole("region", { name: "Tile details" });
  await detail.waitFor({ timeout: 15_000 });
  const detailButtons = await detail.getByRole("button").allInnerTexts();
  note("detail", `buttons: ${JSON.stringify(detailButtons)}`);
  const falseBtn = detail.getByRole("button", { name: /false/i }).first();
  if (await falseBtn.count()) {
    await falseBtn.click();
    await page.waitForTimeout(800);
    note("detail", "false-color toggled OK");
  }
  const nextBtn = detail.getByRole("button", { name: /next/i }).first();
  if (await nextBtn.count()) {
    await nextBtn.click();
    await page.waitForTimeout(600);
    note("detail", "next navigation clicked OK");
  }
  await shot("a06-detail-false-color");

  // ── H. 3D tab ─────────────────────────────────────────────────────────────
  await page.getByRole("group", { name: "View" }).getByRole("button", { name: "3D", exact: true }).click();
  await page.waitForTimeout(2500);
  const hasCanvas3d = await page.locator("canvas").count();
  note("3d", `canvas elements after 3D tab: ${hasCanvas3d}`);
  await shot("a07-3d-view");

  // ── I. Telemetry buoy switch ──────────────────────────────────────────────
  await page.getByRole("group", { name: "View" }).getByRole("button", { name: "Telemetry", exact: true }).click();
  await page.getByTestId("telemetry-sim-note").waitFor({ timeout: 15_000 });
  const buoySelect = page.getByLabel("Buoy");
  await buoySelect.selectOption({ index: 2 });
  await page.waitForTimeout(1200);
  const line = await page.locator(".telemetry-chart__line").getAttribute("d");
  note("telemetry", `after buoy switch, line path len=${line?.length ?? 0}`);
  await shot("a08-telemetry-buoy-switch");

  // ── J. Keyboard focus spot-check (a11y) ───────────────────────────────────
  await page.getByRole("group", { name: "View" }).getByRole("button", { name: "Map", exact: true }).click();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  const focused = await page.evaluate(() => {
    const el = document.activeElement;
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { tag: el.tagName, text: (el.textContent || "").trim().slice(0, 40), outline: cs.outlineStyle + " " + cs.outlineWidth, boxShadow: cs.boxShadow.slice(0, 60) };
  });
  note("a11y", `2nd tab focus: ${JSON.stringify(focused)}`);
  await shot("a09-keyboard-focus");

  // ── K. Mobile viewport ────────────────────────────────────────────────────
  const mobile = await context.newPage();
  await mobile.setViewportSize({ width: 390, height: 844 });
  await mobile.goto(BASE + "/", { waitUntil: "load" });
  await mobile.screenshot({ path: path.join(OUT, "a10-mobile-landing.png"), fullPage: true });
  const hOverflow = await mobile.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
  note("mobile", `landing horizontal overflow: ${hOverflow}`);
  await mobile.goto(BASE + "/login");
  await mobile.getByLabel("Username").fill("demo");
  await mobile.getByLabel("Password").fill("demo-pass-123");
  await mobile.getByRole("button", { name: "Log in", exact: true }).click();
  await mobile.waitForURL(/\/dashboard$/, { timeout: 30_000 }).catch(() => {});
  await mobile.waitForTimeout(2500);
  await mobile.screenshot({ path: path.join(OUT, "a11-mobile-dashboard.png"), fullPage: false });
  const mOverflow = await mobile.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
  note("mobile", `dashboard horizontal overflow: ${mOverflow}`);
  await mobile.close();

  // ── L. Session persistence (refresh keeps you in?) ────────────────────────
  await page.goto(BASE + "/dashboard");
  await page.getByRole("searchbox", { name: "Search" }).waitFor({ timeout: 15_000 }).catch(() => {});
  const stillIn = page.url().includes("/dashboard");
  note("session", `after direct /dashboard reload: ${stillIn ? "stays logged in" : "kicked out"} (url=${page.url()})`);

  note("console", `console errors during play: ${consoleErrors.length ? consoleErrors.slice(0, 5).join(" || ") : "none"}`);
} finally {
  await browser.close();
}

console.log("\n--- NOTES ---");
for (const n of notes) console.log(n);
